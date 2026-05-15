import { describe, expect, it } from 'vitest';
import { parse } from 'graphql';
import { collectQueryMetrics } from '../src/query-metrics';

describe('collectQueryMetrics', () => {
  it('returns zero metrics when document is missing', () => {
    expect(collectQueryMetrics(undefined)).toEqual({
      queryDepth: 0,
      fieldCount: 0,
      complexityScore: 0,
    });
  });

  it('calculates field count and depth for nested selections', () => {
    const document = parse(`
      query DashboardOverview {
        viewer {
          id
          teams {
            slug
            members {
              id
            }
          }
        }
      }
    `);

    expect(collectQueryMetrics(document, 'DashboardOverview')).toEqual({
      queryDepth: 4,
      fieldCount: 6,
      complexityScore: 14,
    });
  });

  it('includes fields from fragments without double counting recursive spreads', () => {
    const document = parse(`
      query GetUser {
        viewer {
          ...UserFields
        }
      }

      fragment UserFields on User {
        id
        profile {
          avatarUrl
        }
      }
    `);

    expect(collectQueryMetrics(document, 'GetUser')).toEqual({
      queryDepth: 3,
      fieldCount: 4,
      complexityScore: 10,
    });
  });
});

