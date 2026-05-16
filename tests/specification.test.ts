// ============================================================================
// Tests for @claude-agent/specification
// ============================================================================
import { describe, test, expect } from 'bun:test';
import { eq, ne, gt, gte, lt, lte, contains, inArray, between, regex, always, never, QueryBuilder, BaseSpecification } from '../packages/specification/src/index.js';

interface Item { id: number; name: string; age: number; status: string; }

const items: Item[] = [
  { id: 1, name: 'Alice', age: 30, status: 'active' },
  { id: 2, name: 'Bob', age: 25, status: 'inactive' },
  { id: 3, name: 'Charlie', age: 35, status: 'active' },
  { id: 4, name: 'David', age: 20, status: 'pending' },
  { id: 5, name: 'Eve', age: 30, status: 'active' },
];

describe('@claude-agent/specification', () => {
  describe('eq', () => {
    test('matches equal values', () => {
      const spec = eq('status', 'active');
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(3);
    });
  });

  describe('ne', () => {
    test('matches not equal values', () => {
      const spec = ne('status', 'active');
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(2);
    });
  });

  describe('gt', () => {
    test('matches greater than', () => {
      const spec = gt('age', 25);
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(3);
    });
  });

  describe('gte', () => {
    test('matches greater than or equal', () => {
      const spec = gte('age', 30);
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(3);
    });
  });

  describe('lt', () => {
    test('matches less than', () => {
      const spec = lt('age', 30);
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(2);
    });
  });

  describe('lte', () => {
    test('matches less than or equal', () => {
      const spec = lte('age', 25);
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(2);
    });
  });

  describe('contains', () => {
    test('matches substring', () => {
      const spec = contains('name', 'li');
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(2);
    });
  });

  describe('inArray', () => {
    test('matches array membership', () => {
      const spec = inArray('status', ['active', 'pending']);
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(4);
    });
  });

  describe('between', () => {
    test('matches range', () => {
      const spec = between('age', 25, 30);
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(3);
    });
  });

  describe('regex', () => {
    test('matches pattern', () => {
      const spec = regex('name', /^[A-C]/);
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(3);
    });
  });

  describe('always / never', () => {
    test('always returns true', () => {
      expect(items.filter(i => always<Item>().isSatisfiedBy(i))).toHaveLength(5);
    });
    test('never returns false', () => {
      expect(items.filter(i => never<Item>().isSatisfiedBy(i))).toHaveLength(0);
    });
  });

  describe('Composition', () => {
    test('and combines specifications', () => {
      const spec = eq('status', 'active').and(gte('age', 30));
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(3);
    });

    test('or combines specifications', () => {
      const spec = eq('name', 'Alice').or(eq('name', 'Bob'));
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(2);
    });

    test('not negates specification', () => {
      const spec = eq('status', 'active').not();
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(2);
    });

    test('complex composition', () => {
      const spec = eq('status', 'active').and(lt('age', 35)).or(eq('name', 'David'));
      expect(items.filter(i => spec.isSatisfiedBy(i))).toHaveLength(3);
    });
  });

  describe('QueryBuilder', () => {
    test('filters with where', () => {
      const results = new QueryBuilder<Item>()
        .where(eq('status', 'active'))
        .execute(items);
      expect(results).toHaveLength(3);
    });

    test('sorts with orderBy', () => {
      const results = new QueryBuilder<Item>()
        .orderBy('age', 'desc')
        .execute(items);
      expect(results[0]!.age).toBe(35);
    });

    test('paginates with skip and limit', () => {
      const results = new QueryBuilder<Item>()
        .orderBy('id')
        .skip(1)
        .limit(2)
        .execute(items);
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe(2);
    });

    test('combines filter, sort, and pagination', () => {
      const results = new QueryBuilder<Item>()
        .where(eq('status', 'active'))
        .orderBy('age')
        .limit(2)
        .execute(items);
      expect(results).toHaveLength(2);
      expect(results[0]!.age).toBe(30);
    });
  });
});
