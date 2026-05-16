// ============================================================================
// Tests for @claude-agent/repository
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { InMemoryRepository, CachedRepository, LoggingRepository } from '../packages/repository/src/index.js';

interface TestEntity { id: string; name: string; value: number; }

describe('@claude-agent/repository', () => {
  describe('InMemoryRepository', () => {
    let repo: InMemoryRepository<TestEntity>;

    beforeEach(() => { repo = new InMemoryRepository(); });

    test('saves and finds by id', async () => {
      await repo.save({ id: '1', name: 'test', value: 42 });
      const entity = await repo.findById('1');
      expect(entity).toBeDefined();
      expect(entity!.name).toBe('test');
    });

    test('returns null for unknown id', async () => {
      const entity = await repo.findById('unknown');
      expect(entity).toBeNull();
    });

    test('finds all with pagination', async () => {
      for (let i = 0; i < 5; i++) await repo.save({ id: String(i), name: `item-${i}`, value: i });
      const result = await repo.findAll({ limit: 2 });
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(5);
    });

    test('finds with filter', async () => {
      await repo.save({ id: '1', name: 'a', value: 1 });
      await repo.save({ id: '2', name: 'b', value: 2 });
      const results = await repo.find({ filter: (e) => e.value > 1 });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('2');
    });

    test('finds with sort', async () => {
      await repo.save({ id: '1', name: 'c', value: 3 });
      await repo.save({ id: '2', name: 'a', value: 1 });
      await repo.save({ id: '3', name: 'b', value: 2 });
      const results = await repo.find({ sort: (a, b) => a.name.localeCompare(b.name) });
      expect(results[0]!.name).toBe('a');
    });

    test('finds one matching entity', async () => {
      await repo.save({ id: '1', name: 'target', value: 1 });
      await repo.save({ id: '2', name: 'other', value: 2 });
      const result = await repo.findOne(e => e.name === 'target');
      expect(result).toBeDefined();
      expect(result!.id).toBe('1');
    });

    test('checks existence', async () => {
      await repo.save({ id: '1', name: 'test', value: 1 });
      expect(await repo.exists('1')).toBe(true);
      expect(await repo.exists('2')).toBe(false);
    });

    test('counts entities', async () => {
      await repo.save({ id: '1', name: 'a', value: 1 });
      await repo.save({ id: '2', name: 'b', value: 2 });
      expect(await repo.count()).toBe(2);
      expect(await repo.count(e => e.value > 1)).toBe(1);
    });

    test('updates entity', async () => {
      await repo.save({ id: '1', name: 'old', value: 1 });
      const updated = await repo.update('1', { name: 'new' });
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('new');
      expect(updated!.value).toBe(1);
    });

    test('returns null when updating unknown', async () => {
      const result = await repo.update('unknown', { name: 'new' });
      expect(result).toBeNull();
    });

    test('deletes entity', async () => {
      await repo.save({ id: '1', name: 'test', value: 1 });
      expect(await repo.delete('1')).toBe(true);
      expect(await repo.findById('1')).toBeNull();
    });

    test('clears all entities', async () => {
      await repo.save({ id: '1', name: 'test', value: 1 });
      repo.clear();
      expect(repo.size).toBe(0);
    });
  });

  describe('CachedRepository', () => {
    test('caches findById results', async () => {
      const inner = new InMemoryRepository<TestEntity>();
      const cached = new CachedRepository(inner, 60000);
      await cached.save({ id: '1', name: 'test', value: 1 });
      const first = await cached.findById('1');
      const second = await cached.findById('1');
      expect(first).toEqual(second);
    });

    test('invalidates cache on update', async () => {
      const inner = new InMemoryRepository<TestEntity>();
      const cached = new CachedRepository(inner, 60000);
      await cached.save({ id: '1', name: 'old', value: 1 });
      await cached.update('1', { name: 'new' });
      const result = await cached.findById('1');
      expect(result!.name).toBe('new');
    });

    test('invalidates cache on delete', async () => {
      const inner = new InMemoryRepository<TestEntity>();
      const cached = new CachedRepository(inner, 60000);
      await cached.save({ id: '1', name: 'test', value: 1 });
      await cached.delete('1');
      const result = await cached.findById('1');
      expect(result).toBeNull();
    });

    test('invalidates all cache', async () => {
      const inner = new InMemoryRepository<TestEntity>();
      const cached = new CachedRepository(inner, 60000);
      await cached.save({ id: '1', name: 'test', value: 1 });
      cached.invalidateAll();
      expect(await cached.findById('1')).toBeDefined();
    });
  });

  describe('LoggingRepository', () => {
    test('delegates to inner repository', async () => {
      const inner = new InMemoryRepository<TestEntity>();
      const logged = new LoggingRepository(inner);
      await logged.save({ id: '1', name: 'test', value: 1 });
      const result = await logged.findById('1');
      expect(result).toBeDefined();
      expect(result!.name).toBe('test');
    });

    test('delegates delete', async () => {
      const inner = new InMemoryRepository<TestEntity>();
      const logged = new LoggingRepository(inner);
      await logged.save({ id: '1', name: 'test', value: 1 });
      const deleted = await logged.delete('1');
      expect(deleted).toBe(true);
    });
  });
});
