import gql from 'graphql-tag';

import { isQuerySubset, projectErrors, projectResult } from '../selectionSubset';

describe('isQuerySubset', () => {
  it('returns true for identical queries', () => {
    const query = gql`
      query {
        author {
          name
        }
      }
    `;
    expect(isQuerySubset(query, query)).toBe(true);
  });

  it('returns true when subset requests fewer fields', () => {
    const superset = gql`
      query {
        author {
          name
          age
          email
        }
      }
    `;
    const subset = gql`
      query {
        author {
          name
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(true);
  });

  it('returns false when subset requests fields not in superset', () => {
    const superset = gql`
      query {
        author {
          name
        }
      }
    `;
    const subset = gql`
      query {
        author {
          name
          email
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(false);
  });

  it('handles deeply nested selections', () => {
    const superset = gql`
      query {
        author {
          name
          address {
            city
            country
            zip
          }
        }
      }
    `;
    const subset = gql`
      query {
        author {
          name
          address {
            city
          }
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(true);
  });

  it('returns false when nested fields differ', () => {
    const superset = gql`
      query {
        author {
          address {
            city
          }
        }
      }
    `;
    const subset = gql`
      query {
        author {
          address {
            zip
          }
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(false);
  });

  it('handles fields with arguments', () => {
    const superset = gql`
      query {
        author(id: 1) {
          name
          email
        }
      }
    `;
    const subset = gql`
      query {
        author(id: 1) {
          name
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(true);
  });

  it('returns false when arguments differ', () => {
    const superset = gql`
      query {
        author(id: 1) {
          name
          email
        }
      }
    `;
    const subset = gql`
      query {
        author(id: 2) {
          name
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(false);
  });

  it('handles inline fragments with same type condition', () => {
    const superset = gql`
      query {
        node {
          ... on Author {
            name
            email
          }
        }
      }
    `;
    const subset = gql`
      query {
        node {
          ... on Author {
            name
          }
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(true);
  });

  it('returns false for inline fragments with different type conditions', () => {
    const superset = gql`
      query {
        node {
          ... on Author {
            name
            email
          }
        }
      }
    `;
    const subset = gql`
      query {
        node {
          ... on Editor {
            name
          }
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(false);
  });

  it('handles named fragment spreads', () => {
    const superset = gql`
      query {
        author {
          ...AuthorFields
        }
      }
      fragment AuthorFields on Author {
        name
        email
        age
      }
    `;
    const subset = gql`
      query {
        author {
          ...AuthorName
        }
      }
      fragment AuthorName on Author {
        name
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(true);
  });

  it('handles fields in different order', () => {
    const superset = gql`
      query {
        author {
          email
          name
        }
      }
    `;
    const subset = gql`
      query {
        author {
          name
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(true);
  });

  it('handles multiple top-level fields', () => {
    const superset = gql`
      query {
        author {
          name
        }
        book {
          title
          isbn
        }
      }
    `;
    const subset = gql`
      query {
        book {
          title
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(true);
  });

  it('returns false for different operation types', () => {
    const mutation = gql`
      mutation {
        createAuthor {
          name
        }
      }
    `;
    const query = gql`
      query {
        createAuthor {
          name
        }
      }
    `;
    expect(isQuerySubset(mutation, query)).toBe(false);
  });

  it('handles aliased fields', () => {
    const superset = gql`
      query {
        myAuthor: author {
          name
          email
        }
      }
    `;
    const subset = gql`
      query {
        myAuthor: author {
          name
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(true);
  });

  it('distinguishes aliased from non-aliased fields', () => {
    const superset = gql`
      query {
        myAuthor: author {
          name
        }
      }
    `;
    const subset = gql`
      query {
        author {
          name
        }
      }
    `;
    // Different response keys: "myAuthor" vs "author"
    expect(isQuerySubset(superset, subset)).toBe(false);
  });

  it('handles scalar fields without sub-selections', () => {
    const superset = gql`
      query {
        name
        age
        email
      }
    `;
    const subset = gql`
      query {
        name
        age
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(true);
  });

  it('returns false when directives differ on fields', () => {
    const superset = gql`
      query ($skip: Boolean!) {
        author {
          name @skip(if: $skip)
          email
        }
      }
    `;
    const subset = gql`
      query {
        author {
          name
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(false);
  });

  it('returns true when directives match on fields', () => {
    const superset = gql`
      query ($skip: Boolean!) {
        author {
          name @skip(if: $skip)
          email
        }
      }
    `;
    const subset = gql`
      query ($skip: Boolean!) {
        author {
          name @skip(if: $skip)
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(true);
  });

  it('handles named fragment spread with inline fragment for same type condition', () => {
    const superset = gql`
      query {
        node {
          ...AuthorFields
        }
      }
      fragment AuthorFields on Author {
        name
        email
      }
    `;
    const subset = gql`
      query {
        node {
          ... on Author {
            name
          }
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(true);
  });

  it('handles inline fragment in superset with named fragment in subset', () => {
    const superset = gql`
      query {
        node {
          ... on Author {
            name
            email
          }
        }
      }
    `;
    const subset = gql`
      query {
        node {
          ...AuthorName
        }
      }
      fragment AuthorName on Author {
        name
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(true);
  });

  it('returns false for named fragment with different type condition than inline fragment', () => {
    const superset = gql`
      query {
        node {
          ...AuthorFields
        }
      }
      fragment AuthorFields on Author {
        name
        email
      }
    `;
    const subset = gql`
      query {
        node {
          ... on Editor {
            name
          }
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(false);
  });

  it('returns false when @include directive is only on subset field', () => {
    const superset = gql`
      query {
        author {
          name
          email
        }
      }
    `;
    const subset = gql`
      query ($include: Boolean!) {
        author {
          name @include(if: $include)
        }
      }
    `;
    expect(isQuerySubset(superset, subset)).toBe(false);
  });
});

describe('projectResult', () => {
  it('projects result for subset query', () => {
    const superset = gql`
      query {
        author {
          name
          email
          age
        }
      }
    `;
    const subset = gql`
      query {
        author {
          name
        }
      }
    `;
    const data = {
      author: {
        name: 'Jonas',
        email: 'jonas@example.com',
        age: 30,
      },
    };
    expect(projectResult(data, superset, subset)).toEqual({
      author: {
        name: 'Jonas',
      },
    });
  });

  it('handles deeply nested projection', () => {
    const superset = gql`
      query {
        author {
          name
          address {
            city
            country
            zip
          }
        }
      }
    `;
    const subset = gql`
      query {
        author {
          address {
            city
          }
        }
      }
    `;
    const data = {
      author: {
        name: 'Jonas',
        address: {
          city: 'Berlin',
          country: 'Germany',
          zip: '10115',
        },
      },
    };
    expect(projectResult(data, superset, subset)).toEqual({
      author: {
        address: {
          city: 'Berlin',
        },
      },
    });
  });

  it('handles null values', () => {
    const superset = gql`
      query {
        author {
          name
          email
        }
      }
    `;
    const subset = gql`
      query {
        author {
          name
        }
      }
    `;
    const data = {
      author: null,
    };
    expect(projectResult(data, superset, subset)).toEqual({
      author: null,
    });
  });

  it('handles array results', () => {
    const superset = gql`
      query {
        authors {
          name
          email
        }
      }
    `;
    const subset = gql`
      query {
        authors {
          name
        }
      }
    `;
    const data = {
      authors: [
        { name: 'Jonas', email: 'jonas@example.com' },
        { name: 'Dhaivat', email: 'dhaivat@example.com' },
      ],
    };
    expect(projectResult(data, superset, subset)).toEqual({
      authors: [
        { name: 'Jonas' },
        { name: 'Dhaivat' },
      ],
    });
  });

  it('projects multiple top-level fields', () => {
    const superset = gql`
      query {
        author {
          name
        }
        book {
          title
          isbn
        }
      }
    `;
    const subset = gql`
      query {
        book {
          title
        }
      }
    `;
    const data = {
      author: { name: 'Jonas' },
      book: { title: 'GraphQL', isbn: '123' },
    };
    expect(projectResult(data, superset, subset)).toEqual({
      book: { title: 'GraphQL' },
    });
  });

  it('handles polymorphic types with inline fragments and __typename', () => {
    const superset = gql`
      query {
        node {
          ... on Author {
            __typename
            name
            email
          }
          ... on Editor {
            __typename
            name
            department
          }
        }
      }
    `;
    const subset = gql`
      query {
        node {
          ... on Author {
            __typename
            name
          }
        }
      }
    `;
    const data = {
      node: {
        __typename: 'Author',
        name: 'Jonas',
        email: 'jonas@example.com',
      },
    };
    expect(projectResult(data, superset, subset)).toEqual({
      node: {
        __typename: 'Author',
        name: 'Jonas',
      },
    });
  });

  it('handles polymorphic types with named fragments', () => {
    const superset = gql`
      query {
        node {
          ...AuthorFields
          ...EditorFields
        }
      }
      fragment AuthorFields on Author {
        __typename
        name
        email
      }
      fragment EditorFields on Editor {
        __typename
        name
        department
      }
    `;
    const subset = gql`
      query {
        node {
          ...AuthorName
        }
      }
      fragment AuthorName on Author {
        __typename
        name
      }
    `;
    const data = {
      node: {
        __typename: 'Author',
        name: 'Jonas',
        email: 'jonas@example.com',
      },
    };
    expect(projectResult(data, superset, subset)).toEqual({
      node: {
        __typename: 'Author',
        name: 'Jonas',
      },
    });
  });
});

describe('projectErrors', () => {
  it('keeps errors whose path matches subset fields', () => {
    const superset = gql`
      query {
        author {
          name
          email
        }
      }
    `;
    const subset = gql`
      query {
        author {
          name
        }
      }
    `;
    const errors = [
      { message: 'name failed', path: ['author', 'name'] },
      { message: 'email failed', path: ['author', 'email'] },
    ];
    expect(projectErrors(errors, superset, subset)).toEqual([
      { message: 'name failed', path: ['author', 'name'] },
    ]);
  });

  it('always includes errors without a path', () => {
    const superset = gql`
      query {
        author {
          name
          email
        }
      }
    `;
    const subset = gql`
      query {
        author {
          name
        }
      }
    `;
    const errors = [
      { message: 'request-level error' },
      { message: 'email failed', path: ['author', 'email'] },
    ];
    expect(projectErrors(errors, superset, subset)).toEqual([
      { message: 'request-level error' },
    ]);
  });

  it('handles errors with array index path segments', () => {
    const superset = gql`
      query {
        authors {
          name
          email
        }
      }
    `;
    const subset = gql`
      query {
        authors {
          name
        }
      }
    `;
    const errors = [
      { message: 'name failed', path: ['authors', 0, 'name'] },
      { message: 'email failed', path: ['authors', 1, 'email'] },
    ];
    expect(projectErrors(errors, superset, subset)).toEqual([
      { message: 'name failed', path: ['authors', 0, 'name'] },
    ]);
  });

  it('handles deeply nested error paths', () => {
    const superset = gql`
      query {
        author {
          address {
            city
            zip
          }
        }
      }
    `;
    const subset = gql`
      query {
        author {
          address {
            city
          }
        }
      }
    `;
    const errors = [
      { message: 'city failed', path: ['author', 'address', 'city'] },
      { message: 'zip failed', path: ['author', 'address', 'zip'] },
    ];
    expect(projectErrors(errors, superset, subset)).toEqual([
      { message: 'city failed', path: ['author', 'address', 'city'] },
    ]);
  });

  it('filters out errors for fields not in subset', () => {
    const superset = gql`
      query {
        author {
          name
          email
        }
        book {
          title
        }
      }
    `;
    const subset = gql`
      query {
        author {
          name
        }
      }
    `;
    const errors = [
      { message: 'name failed', path: ['author', 'name'] },
      { message: 'title failed', path: ['book', 'title'] },
    ];
    expect(projectErrors(errors, superset, subset)).toEqual([
      { message: 'name failed', path: ['author', 'name'] },
    ]);
  });
});
