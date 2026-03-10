import {
  DocumentNode,
  SelectionSetNode,
  SelectionNode,
  FieldNode,
  InlineFragmentNode,
  FragmentSpreadNode,
  FragmentDefinitionNode,
} from 'graphql';

import {
  getOperationDefinition,
  createFragmentMap,
  resultKeyNameFromField,
} from "@apollo/client/utilities/internal";
import type { FragmentMap } from "@apollo/client/utilities/internal";
import { equal } from '@wry/equality';

/**
 * Returns true if `subset` requests only fields that are also present in
 * `superset`. Both documents must be query operations. Fragment definitions
 * are resolved inline before comparison.
 *
 * Only the operation selection sets are compared; operation names, variable
 * definitions and directives are ignored for the purpose of determining
 * whether one query is a data-subset of another.
 */
export function isQuerySubset(
  superset: DocumentNode,
  subset: DocumentNode,
): boolean {
  const superOp = getOperationDefinition(superset);
  const subOp = getOperationDefinition(subset);

  if (!superOp || !subOp) return false;

  // Both must be the same operation type (query, mutation, subscription)
  if (superOp.operation !== subOp.operation) return false;

  const superFragments = createFragmentMap(
    superset.definitions.filter(
      (d): d is FragmentDefinitionNode => d.kind === 'FragmentDefinition'
    )
  );
  const subFragments = createFragmentMap(
    subset.definitions.filter(
      (d): d is FragmentDefinitionNode => d.kind === 'FragmentDefinition'
    )
  );

  return isSelectionSubset(
    superOp.selectionSet,
    subOp.selectionSet,
    superFragments,
    subFragments,
  );
}

/**
 * Returns true if every selection in `subSelectionSet` is covered by
 * a corresponding selection in `superSelectionSet`.
 */
function isSelectionSubset(
  superSelectionSet: SelectionSetNode,
  subSelectionSet: SelectionSetNode,
  superFragments: FragmentMap,
  subFragments: FragmentMap,
): boolean {
  // Flatten both selection sets so fragments are resolved to their fields.
  // Uses type-condition-prefixed keys so that fields under different inline
  // fragment type conditions (e.g. `... on Author` vs `... on Editor`)
  // are not conflated.
  const superFields = flattenSelections(
    superSelectionSet, superFragments, true
  );
  const subFields = flattenSelections(
    subSelectionSet, subFragments, true
  );

  // Every field in the subset must have a matching field in the superset
  let isSubset = true;
  subFields.forEach((subField, key) => {
    if (!isSubset) return;
    const superField = superFields.get(key);
    if (!superField) { isSubset = false; return; }

    // Arguments must match exactly
    if (!argumentsEqual(superField, subField)) { isSubset = false; return; }

    // Directives must match exactly
    if (!directivesEqual(superField, subField)) { isSubset = false; return; }

    // Recursively check nested selection sets
    if (subField.selectionSet) {
      if (!superField.selectionSet) { isSubset = false; return; }
      if (!isSelectionSubset(
        superField.selectionSet,
        subField.selectionSet,
        superFragments,
        subFragments,
      )) {
        isSubset = false;
      }
    }
  });

  return isSubset;
}

/**
 * Flattens a selection set by resolving fragment spreads and inline fragments
 * into a map of response key -> FieldNode. When multiple fields share the
 * same response key (e.g. from different fragments), their sub-selections
 * are merged.
 *
 * When `prefixTypeConditions` is true, fields inside typed inline fragments
 * are keyed as `TypeName:fieldKey` to prevent fields under different type
 * conditions from being conflated during subset comparison.
 */
function flattenSelections(
  selectionSet: SelectionSetNode,
  fragments: FragmentMap,
  prefixTypeConditions: boolean = false,
): Map<string, FieldNode> {
  const result = new Map<string, FieldNode>();

  for (const selection of selectionSet.selections) {
    collectFields(selection, fragments, result, prefixTypeConditions);
  }

  return result;
}

function collectFields(
  selection: SelectionNode,
  fragments: FragmentMap,
  result: Map<string, FieldNode>,
  prefixTypeConditions: boolean,
  typeCondition?: string,
): void {
  switch (selection.kind) {
    case 'Field': {
      const baseKey = resultKeyNameFromField(selection);
      const key =
        prefixTypeConditions && typeCondition ?
          `${typeCondition}:${baseKey}`
        : baseKey;
      const existing = result.get(key);
      if (existing && existing.selectionSet && selection.selectionSet) {
        // Merge sub-selections (same field referenced multiple times,
        // e.g. from different fragments)
        result.set(key, {
          ...existing,
          selectionSet: {
            ...existing.selectionSet,
            selections: [
              ...existing.selectionSet.selections,
              ...selection.selectionSet.selections,
            ],
          },
        } as FieldNode);
      } else {
        result.set(key, selection);
      }
      break;
    }
    case 'InlineFragment': {
      const inlineFragment = selection as InlineFragmentNode;
      const tc = inlineFragment.typeCondition?.name.value;
      for (const inner of inlineFragment.selectionSet.selections) {
        collectFields(inner, fragments, result, prefixTypeConditions, tc);
      }
      break;
    }
    case 'FragmentSpread': {
      const fragment = fragments[(selection as FragmentSpreadNode).name.value];
      if (fragment) {
        const tc = fragment.typeCondition?.name.value;
        for (const inner of fragment.selectionSet.selections) {
          collectFields(inner, fragments, result, prefixTypeConditions, tc);
        }
      }
      break;
    }
  }
}

function argumentsEqual(a: FieldNode, b: FieldNode): boolean {
  const aArgs = a.arguments || [];
  const bArgs = b.arguments || [];
  if (aArgs.length !== bArgs.length) return false;
  if (aArgs.length === 0) return true;
  // Use deep equality on the sorted argument arrays
  return equal(
    [...aArgs].sort((x, y) => x.name.value.localeCompare(y.name.value)),
    [...bArgs].sort((x, y) => x.name.value.localeCompare(y.name.value)),
  );
}

function directivesEqual(a: FieldNode, b: FieldNode): boolean {
  const aDir = a.directives || [];
  const bDir = b.directives || [];
  if (aDir.length !== bDir.length) return false;
  if (aDir.length === 0) return true;
  return equal(
    [...aDir].sort((x, y) => x.name.value.localeCompare(y.name.value)),
    [...bDir].sort((x, y) => x.name.value.localeCompare(y.name.value)),
  );
}

/**
 * Given the result data from a superset query, project it down to only the
 * fields requested by the subset query. This avoids writing extraneous
 * fields to the cache that weren't requested.
 */
export function projectResult(
  data: Record<string, any>,
  supersetDoc: DocumentNode,
  subsetDoc: DocumentNode,
): Record<string, any> {
  const superOp = getOperationDefinition(supersetDoc);
  const subOp = getOperationDefinition(subsetDoc);
  if (!superOp || !subOp) return data;

  const superFragments = createFragmentMap(
    supersetDoc.definitions.filter(
      (d): d is FragmentDefinitionNode => d.kind === 'FragmentDefinition'
    )
  );
  const subFragments = createFragmentMap(
    subsetDoc.definitions.filter(
      (d): d is FragmentDefinitionNode => d.kind === 'FragmentDefinition'
    )
  );

  return projectSelections(
    data,
    superOp.selectionSet,
    subOp.selectionSet,
    superFragments,
    subFragments,
  );
}

function projectSelections(
  data: Record<string, any>,
  superSelectionSet: SelectionSetNode,
  subSelectionSet: SelectionSetNode,
  superFragments: FragmentMap,
  subFragments: FragmentMap,
): Record<string, any> {
  if (data == null || typeof data !== 'object') return data;

  // If the data is an array, project each element
  if (Array.isArray(data)) {
    return data.map(item =>
      projectSelections(
        item, superSelectionSet, subSelectionSet,
        superFragments, subFragments,
      )
    );
  }

  // projectResult uses un-prefixed keys since response data keys
  // don't include type condition prefixes.
  const superFields = flattenSelections(superSelectionSet, superFragments);
  const subFields = flattenSelections(subSelectionSet, subFragments);

  const result: Record<string, any> = {};

  subFields.forEach((subField, key) => {
    const superField = superFields.get(key);
    if (!superField) return;

    const value = data[key];
    if (value !== undefined) {
      if (
        subField.selectionSet &&
        superField.selectionSet &&
        value != null &&
        typeof value === 'object'
      ) {
        result[key] = projectSelections(
          value,
          superField.selectionSet,
          subField.selectionSet,
          superFragments,
          subFragments,
        );
      } else {
        result[key] = value;
      }
    }
  });

  return result;
}
