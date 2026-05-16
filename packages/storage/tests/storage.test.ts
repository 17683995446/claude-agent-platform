import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

import { MemoryStorage } from '../src/memory-storage.ts';
import { FileStorage } from '../src/file-storage.ts';
import { CacheStorage } from '../src/cache-storage.ts';
import { BatchProcessor } from '../src/batch-operations.ts';
import { EncryptedStorage } from '../src/storage-encryption.ts';
import { StorageMetrics } from '../src/storage-metrics.ts';
import { StorageMigrator } from '../src/storage-migration.ts';
import { StorageQueryBuilder } from '../src/query-builder.ts';
import { StorageUtils } from '../src/storage-utils.ts';
import type { IStorage } from '../src/storage-interface.ts';

// ============================================================
// MemoryStorage Tests
// ============================================================
describe('MemoryStorage', () => {
  let storage: MemoryStorage<string>;

  beforeEach(() => {
    storage = new MemoryStorage<string>();
  });

  test('should set and get a value', async () => {
    await storage.set('key1', 'value1');
    const value = await storage.get('key1');
    expect(value).toBe('value1');
  });

  test('should return undefined for non-existent key', async () => {
    const value = await storage.get('nonexistent');
    expect(value).toBeUndefined();
  });

  test('should delete a key', async () => {
    await storage.set('key1', 'value1');
    const deleted = await storage.delete('key1');
    expect(deleted).toBe(true);
    const value = await storage.get('key1');
    expect(value).toBeUndefined();
  });

  test('should return false when deleting non-existent key', async () => {
    const deleted = await storage.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  test('should check if key exists', async () => {
    await storage.set('key1', 'value1');
    expect(await storage.has('key1')).toBe(true);
    expect(await storage.has('nonexistent')).toBe(false);
  });

  test('should return all keys', async () => {
    await storage.set('key1', 'v1');
    await storage.set('key2', 'v2');
    await storage.set('key3', 'v3');
    const keys = await storage.keys();
    expect(keys).toHaveLength(3);
    expect(keys).toContain('key1');
    expect(keys).toContain('key2');
    expect(keys).toContain('key3');
  });

  test('should filter keys by pattern', async () => {
    await storage.set('user:1', 'a');
    await storage.set('user:2', 'b');
    await storage.set('item:1', 'c');
    const keys = await storage.keys('user:*');
    expect(keys).toHaveLength(2);
    expect(keys).toContain('user:1');
    expect(keys).toContain('user:2');
  });

  test('should clear all keys', async () => {
    await storage.set('key1', 'v1');
    await storage.set('key2', 'v2');
    await storage.clear();
    expect(await storage.size()).toBe(0);
  });

  test('should return correct size', async () => {
    await storage.set('key1', 'v1');
    await storage.set('key2', 'v2');
    expect(await storage.size()).toBe(2);
  });

  test('should support TTL and expire entries', async () => {
    await storage.set('key1', 'value1', { ttl: 50 });
    expect(await storage.get('key1')).toBe('value1');
    await sleep(100);
    expect(await storage.get('key1')).toBeUndefined();
  });

  test('should support tags', async () => {
    await storage.set('key1', 'v1', { tags: ['tagA', 'tagB'] });
    await storage.set('key2', 'v2', { tags: ['tagB', 'tagC'] });
    const tagAResults = await storage.getByTag('tagA');
    expect(tagAResults).toHaveLength(1);
    expect(tagAResults[0].value).toBe('v1');
    const tagBResults = await storage.getByTag('tagB');
    expect(tagBResults).toHaveLength(2);
  });

  test('should support metadata', async () => {
    await storage.set('key1', 'v1', { metadata: { foo: 'bar' } });
    const entry = await storage.getEntry('key1');
    expect(entry).toBeDefined();
    expect(entry!.metadata.foo).toBe('bar');
  });

  test('should track version', async () => {
    await storage.set('key1', 'v1');
    let entry = await storage.getEntry('key1');
    expect(entry!.version).toBe(1);
    await storage.set('key1', 'v2');
    entry = await storage.getEntry('key1');
    expect(entry!.version).toBe(2);
  });

  test('should support LRU eviction when maxSize reached', async () => {
    const lru = new MemoryStorage<string>({ maxSize: 3 });
    await lru.set('key1', 'v1');
    await lru.set('key2', 'v2');
    await lru.set('key3', 'v3');
    // key1 is the oldest
    await lru.set('key4', 'v4');
    expect(await lru.get('key1')).toBeUndefined();
    expect(await lru.get('key4')).toBe('v4');
  });

  test('should emit events on set and delete', async () => {
    const events: Array<{ type: string; key: string }> = [];
    storage.on((event) => {
      events.push({ type: event.type, key: event.key });
    });
    await storage.set('key1', 'v1');
    await storage.delete('key1');
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('set');
    expect(events[1].type).toBe('delete');
  });

  test('should emit evict event on LRU eviction', async () => {
    const lru = new MemoryStorage<string>({ maxSize: 2 });
    const events: Array<{ type: string; key: string }> = [];
    lru.on((event) => {
      events.push({ type: event.type, key: event.key });
    });
    await lru.set('key1', 'v1');
    await lru.set('key2', 'v2');
    await lru.set('key3', 'v3');
    const evictEvents = events.filter((e) => e.type === 'evict');
    expect(evictEvents).toHaveLength(1);
    expect(evictEvents[0].key).toBe('key1');
  });

  test('should create and restore snapshot', async () => {
    await storage.set('key1', 'v1');
    await storage.set('key2', 'v2');
    const snapshot = storage.snapshot();
    await storage.clear();
    expect(await storage.size()).toBe(0);
    await storage.restore(snapshot);
    expect(await storage.get('key1')).toBe('v1');
    expect(await storage.get('key2')).toBe('v2');
  });

  test('should support namespace isolation', async () => {
    const ns1 = storage.namespace('ns1');
    const ns2 = storage.namespace('ns2');
    await ns1.set('key', 'value1');
    await ns2.set('key', 'value2');
    expect(await ns1.get('key')).toBe('value1');
    expect(await ns2.get('key')).toBe('value2');
  });

  test('should return storage stats', async () => {
    await storage.set('key1', 'v1');
    await storage.get('key1'); // hit
    await storage.get('nonexistent'); // miss
    const stats = await storage.stats();
    expect(stats.totalKeys).toBe(1);
    expect(stats.hitRate).toBeGreaterThan(0);
    expect(stats.missRate).toBeGreaterThan(0);
  });

  test('should handle object values', async () => {
    const objStorage = new MemoryStorage<{ name: string; age: number }>();
    await objStorage.set('user:1', { name: 'Alice', age: 30 });
    const user = await objStorage.get('user:1');
    expect(user?.name).toBe('Alice');
    expect(user?.age).toBe(30);
  });

  test('should handle defaultTtl option', async () => {
    const ttlStorage = new MemoryStorage<string>({ defaultTtl: 50 });
    await ttlStorage.set('key1', 'v1');
    expect(await ttlStorage.get('key1')).toBe('v1');
    await sleep(100);
    expect(await ttlStorage.get('key1')).toBeUndefined();
  });
});

// ============================================================
// FileStorage Tests
// ============================================================
describe('FileStorage', () => {
  let storage: FileStorage<string>;
  let testDir: string;

  beforeEach(() => {
    testDir = join('/tmp', `storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    storage = new FileStorage<string>({ directory: testDir });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test('should set and get a value', async () => {
    await storage.set('key1', 'value1');
    const value = await storage.get('key1');
    expect(value).toBe('value1');
  });

  test('should persist data across instances', async () => {
    await storage.set('key1', 'value1');
    const storage2 = new FileStorage<string>({ directory: testDir });
    const value = await storage2.get('key1');
    expect(value).toBe('value1');
  });

  test('should delete a key', async () => {
    await storage.set('key1', 'value1');
    const deleted = await storage.delete('key1');
    expect(deleted).toBe(true);
    expect(await storage.get('key1')).toBeUndefined();
  });

  test('should check if key exists', async () => {
    await storage.set('key1', 'v1');
    expect(await storage.has('key1')).toBe(true);
    expect(await storage.has('nonexistent')).toBe(false);
  });

  test('should return all keys', async () => {
    await storage.set('key1', 'v1');
    await storage.set('key2', 'v2');
    const keys = await storage.keys();
    expect(keys).toHaveLength(2);
  });

  test('should clear all keys', async () => {
    await storage.set('key1', 'v1');
    await storage.set('key2', 'v2');
    await storage.clear();
    expect(await storage.size()).toBe(0);
  });

  test('should support TTL and expire entries', async () => {
    await storage.set('key1', 'value1', { ttl: 50 });
    expect(await storage.get('key1')).toBe('value1');
    await sleep(100);
    expect(await storage.get('key1')).toBeUndefined();
  });

  test('should support tags and metadata', async () => {
    await storage.set('key1', 'v1', { tags: ['tagA'], metadata: { source: 'test' } });
    const entry = await storage.getEntry('key1');
    expect(entry).toBeDefined();
    expect(entry!.tags).toContain('tagA');
    expect(entry!.metadata.source).toBe('test');
  });

  test('should support namespace isolation', async () => {
    const ns1 = storage.namespace('ns1');
    await ns1.set('key', 'value1');
    expect(await ns1.get('key')).toBe('value1');
    expect(await storage.get('ns1:key')).toBe('value1');
  });

  test('should handle object values', async () => {
    const objStorage = new FileStorage<{ name: string }>({ directory: testDir });
    await objStorage.set('key1', { name: 'Alice' });
    const value = await objStorage.get('key1');
    expect(value?.name).toBe('Alice');
  });

  test('should support sharding', async () => {
    const sharded = new FileStorage<string>({
      directory: testDir,
      sharding: true,
      shardCount: 4,
    });
    await sharded.set('key1', 'v1');
    await sharded.set('key2', 'v2');
    expect(await sharded.get('key1')).toBe('v1');
    expect(await sharded.get('key2')).toBe('v2');
  });

  test('should cleanup expired entries', async () => {
    await storage.set('key1', 'v1', { ttl: 50 });
    await storage.set('key2', 'v2');
    await sleep(100);
    const cleaned = await storage.cleanupExpired();
    expect(cleaned).toBe(1);
    expect(await storage.size()).toBe(1);
  });
});

// ============================================================
// CacheStorage Tests
// ============================================================
describe('CacheStorage', () => {
  let l1: MemoryStorage<string>;
  let l2: MemoryStorage<string>;
  let cache: CacheStorage<string>;

  beforeEach(() => {
    l1 = new MemoryStorage<string>();
    l2 = new MemoryStorage<string>();
    cache = new CacheStorage<string>({
      l1: { storage: l1 },
      l2: { storage: l2 },
    });
  });

  test('should set and get from L1', async () => {
    await cache.set('key1', 'value1');
    const value = await cache.get('key1');
    expect(value).toBe('value1');
  });

  test('should fall through to L2 when L1 misses', async () => {
    await l2.set('key1', 'value2');
    const value = await cache.get('key1');
    expect(value).toBe('value2');
    // Should be populated in L1
    expect(await l1.get('key1')).toBe('value2');
  });

  test('should delete from all levels', async () => {
    await cache.set('key1', 'value1');
    await cache.delete('key1');
    expect(await l1.get('key1')).toBeUndefined();
    expect(await l2.get('key1')).toBeUndefined();
  });

  test('should support mget', async () => {
    await cache.set('key1', 'v1');
    await cache.set('key2', 'v2');
    const results = await cache.mget(['key1', 'key2', 'key3']);
    expect(results.get('key1')).toBe('v1');
    expect(results.get('key2')).toBe('v2');
    expect(results.get('key3')).toBeUndefined();
  });

  test('should support mset', async () => {
    const entries = new Map<string, string>([
      ['key1', 'v1'],
      ['key2', 'v2'],
    ]);
    await cache.mset(entries);
    expect(await cache.get('key1')).toBe('v1');
    expect(await cache.get('key2')).toBe('v2');
  });

  test('should support mdelete', async () => {
    await cache.set('key1', 'v1');
    await cache.set('key2', 'v2');
    const count = await cache.mdelete(['key1', 'key2']);
    expect(count).toBe(2);
  });

  test('should track level stats', async () => {
    await cache.set('key1', 'v1');
    await cache.get('key1'); // L1 hit
    await cache.get('nonexistent'); // L1 miss, L2 miss
    const stats = cache.getLevelStats();
    expect(stats[0].hits).toBeGreaterThanOrEqual(1);
    expect(stats[0].misses).toBeGreaterThanOrEqual(1);
  });

  test('should support write-through policy', async () => {
    const wtCache = new CacheStorage<string>({
      l1: { storage: l1 },
      l2: { storage: l2 },
      writePolicy: 'write-through',
    });
    await wtCache.set('key1', 'value1');
    expect(await l1.get('key1')).toBe('value1');
    expect(await l2.get('key1')).toBe('value1');
  });

  test('should support write-back policy', async () => {
    const wbCache = new CacheStorage<string>({
      l1: { storage: l1 },
      l2: { storage: l2 },
      writePolicy: 'write-back',
    });
    await wbCache.set('key1', 'value1');
    expect(await l1.get('key1')).toBe('value1');
    // L2 may or may not be written yet (async)
    await sleep(50);
    expect(await l2.get('key1')).toBe('value1');
  });
});

// ============================================================
// BatchProcessor Tests
// ============================================================
describe('BatchProcessor', () => {
  let storage: MemoryStorage<string>;
  let batch: BatchProcessor;

  beforeEach(() => {
    storage = new MemoryStorage<string>();
    batch = new BatchProcessor(storage, { batchSize: 5, flushInterval: 100 });
  });

  test('should queue and flush operations', async () => {
    await batch.queue({ type: 'set', key: 'key1', value: 'v1' });
    await batch.queue({ type: 'set', key: 'key2', value: 'v2' });
    const result = await batch.flush();
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(await storage.get('key1')).toBe('v1');
    expect(await storage.get('key2')).toBe('v2');
  });

  test('should auto-flush when batch size reached', async () => {
    for (let i = 0; i < 5; i++) {
      await batch.queue({ type: 'set', key: `key${i}`, value: `v${i}` });
    }
    // Should have auto-flushed
    await sleep(50);
    expect(await storage.get('key0')).toBe('v0');
    expect(await storage.get('key4')).toBe('v4');
  });

  test('should deduplicate operations with same key', async () => {
    await batch.queue({ type: 'set', key: 'key1', value: 'v1' });
    await batch.queue({ type: 'set', key: 'key1', value: 'v2' });
    const result = await batch.flush();
    expect(result.succeeded).toBe(1);
    expect(await storage.get('key1')).toBe('v2');
  });

  test('should handle delete operations', async () => {
    await storage.set('key1', 'v1');
    await batch.queue({ type: 'delete', key: 'key1' });
    const result = await batch.flush();
    expect(result.succeeded).toBe(1);
    expect(await storage.get('key1')).toBeUndefined();
  });

  test('should handle skip-failed error strategy', async () => {
    const failingBatch = new BatchProcessor(storage, {
      errorStrategy: 'skip-failed',
    });
    // Queue a get on non-existent key (won't fail, but test the mechanism)
    await failingBatch.queue({ type: 'set', key: 'key1', value: 'v1' });
    const result = await failingBatch.flush();
    expect(result.succeeded).toBe(1);
  });

  test('should execute transactions successfully', async () => {
    const ops = [
      { type: 'set' as const, key: 'key1', value: 'v1' },
      { type: 'set' as const, key: 'key2', value: 'v2' },
    ];
    const result = await batch.transaction(ops);
    expect(result.succeeded).toBe(true);
    expect(result.operations).toBe(2);
    expect(await storage.get('key1')).toBe('v1');
    expect(await storage.get('key2')).toBe('v2');
  });

  test('should track progress', async () => {
    const progressUpdates: Array<{ total: number; completed: number }> = [];
    batch.onProgress((p) => progressUpdates.push({ total: p.total, completed: p.completed }));
    for (let i = 0; i < 3; i++) {
      await batch.queue({ type: 'set', key: `key${i}`, value: `v${i}` });
    }
    await batch.flush();
    expect(progressUpdates.length).toBe(3);
    expect(progressUpdates[2].completed).toBe(3);
  });

  test('should return queue size', () => {
    expect(batch.getQueueSize()).toBe(0);
  });
});

// ============================================================
// EncryptedStorage Tests
// ============================================================
describe('EncryptedStorage', () => {
  let inner: MemoryStorage<string>;
  let encrypted: EncryptedStorage<string>;

  beforeEach(() => {
    inner = new MemoryStorage<string>();
    encrypted = EncryptedStorage.wrap(inner, { passphrase: 'test-secret-key' });
  });

  test('should encrypt and decrypt values', async () => {
    await encrypted.set('key1', 'secret-value');
    const value = await encrypted.get('key1');
    expect(value).toBe('secret-value');
  });

  test('should store encrypted data in inner storage', async () => {
    await encrypted.set('key1', 'secret');
    const raw = await inner.get('key1');
    expect(raw).not.toBe('secret');
    expect(typeof raw).toBe('object');
    expect((raw as any).__encrypted).toBe(true);
  });

  test('should delete keys', async () => {
    await encrypted.set('key1', 'v1');
    const deleted = await encrypted.delete('key1');
    expect(deleted).toBe(true);
    expect(await encrypted.get('key1')).toBeUndefined();
  });

  test('should check if key exists', async () => {
    await encrypted.set('key1', 'v1');
    expect(await encrypted.has('key1')).toBe(true);
    expect(await encrypted.has('nonexistent')).toBe(false);
  });

  test('should return all keys', async () => {
    await encrypted.set('key1', 'v1');
    await encrypted.set('key2', 'v2');
    const keys = await encrypted.keys();
    expect(keys).toHaveLength(2);
  });

  test('should support object values', async () => {
    const objEncrypted = EncryptedStorage.wrap<{ name: string }>(
      new MemoryStorage<{ name: string }>(),
      { passphrase: 'secret' },
    );
    await objEncrypted.set('key1', { name: 'Alice' });
    const value = await objEncrypted.get('key1');
    expect(value?.name).toBe('Alice');
  });

  test('should support namespace', async () => {
    const ns = encrypted.namespace('test');
    await ns.set('key1', 'v1');
    expect(await ns.get('key1')).toBe('v1');
  });

  test('should handle tags and metadata', async () => {
    await encrypted.set('key1', 'v1', { tags: ['tagA'], metadata: { foo: 'bar' } });
    const entry = await encrypted.getEntry('key1');
    expect(entry).toBeDefined();
    expect(entry!.value).toBe('v1');
    expect(entry!.tags).toContain('tagA');
    expect(entry!.metadata.foo).toBe('bar');
  });
});

// ============================================================
// StorageMetrics Tests
// ============================================================
describe('StorageMetrics', () => {
  let metrics: StorageMetrics;

  beforeEach(() => {
    metrics = new StorageMetrics();
  });

  test('should record operations', () => {
    metrics.recordOperation('get', 5, true);
    metrics.recordOperation('get', 10, true);
    metrics.recordOperation('get', 3, false);
    const latency = metrics.getLatencyStats('get');
    expect(latency.count).toBe(3);
    expect(latency.min).toBe(3);
    expect(latency.max).toBe(10);
  });

  test('should calculate percentile latencies', () => {
    for (let i = 1; i <= 100; i++) {
      metrics.recordOperation('get', i, true);
    }
    const latency = metrics.getLatencyStats('get');
    expect(latency.p50).toBeGreaterThanOrEqual(49);
    expect(latency.p50).toBeLessThanOrEqual(51);
    expect(latency.p95).toBeGreaterThanOrEqual(94);
    expect(latency.p95).toBeLessThanOrEqual(96);
    expect(latency.p99).toBeGreaterThanOrEqual(98);
    expect(latency.p99).toBeLessThanOrEqual(100);
  });

  test('should track cache hits and misses', () => {
    metrics.recordCacheHit();
    metrics.recordCacheHit();
    metrics.recordCacheMiss();
    const report = metrics.getMetrics();
    expect(report.cacheHitRate).toBeCloseTo(2 / 3);
    expect(report.cacheMissRate).toBeCloseTo(1 / 3);
  });

  test('should track storage size', () => {
    metrics.recordSize(1024);
    metrics.recordSize(2048);
    const report = metrics.getMetrics();
    expect(report.totalSize).toBe(2048);
  });

  test('should return full metrics report', () => {
    metrics.recordOperation('get', 5, true);
    metrics.recordOperation('set', 10, true);
    metrics.recordOperation('delete', 3, false);
    const report = metrics.getMetrics();
    expect(report.operations.get).toBeDefined();
    expect(report.operations.set).toBeDefined();
    expect(report.operations.delete).toBeDefined();
    expect(report.operations.delete.errorCount).toBe(1);
    expect(report.uptime).toBeGreaterThanOrEqual(0);
  });

  test('should export Prometheus format', () => {
    metrics.recordOperation('get', 5, true);
    metrics.recordCacheHit();
    metrics.recordSize(1024);
    const prom = metrics.exportPrometheus();
    expect(prom).toContain('storage_cache_hit_rate');
    expect(prom).toContain('storage_total_size');
    expect(prom).toContain('storage_operation_count_total');
    expect(prom).toContain('storage_operation_duration_seconds');
  });

  test('should reset metrics', () => {
    metrics.recordOperation('get', 5, true);
    metrics.recordCacheHit();
    metrics.reset();
    const latency = metrics.getLatencyStats('get');
    expect(latency.count).toBe(0);
    const report = metrics.getMetrics();
    expect(report.cacheHitRate).toBe(0);
  });

  test('should return empty stats for unknown operations', () => {
    const latency = metrics.getLatencyStats('unknown');
    expect(latency.count).toBe(0);
    expect(latency.p50).toBe(0);
  });
});

// ============================================================
// StorageMigrator Tests
// ============================================================
describe('StorageMigrator', () => {
  let source: MemoryStorage<string>;
  let target: MemoryStorage<string>;
  let migrator: StorageMigrator;

  beforeEach(() => {
    source = new MemoryStorage<string>();
    target = new MemoryStorage<string>();
    migrator = new StorageMigrator();
  });

  test('should migrate all data', async () => {
    await source.set('key1', 'v1');
    await source.set('key2', 'v2');
    await source.set('key3', 'v3');
    const result = await migrator.migrate(source, target);
    expect(result.succeeded).toBe(true);
    expect(result.migrated).toBe(3);
    expect(await target.get('key1')).toBe('v1');
    expect(await target.get('key2')).toBe('v2');
    expect(await target.get('key3')).toBe('v3');
  });

  test('should support dry run mode', async () => {
    await source.set('key1', 'v1');
    const result = await migrator.migrate(source, target, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.migrated).toBe(1);
    expect(await target.get('key1')).toBeUndefined();
  });

  test('should support incremental migration', async () => {
    await source.set('key1', 'v1');
    await target.set('key1', 'v1');
    await source.set('key2', 'v2');
    const result = await migrator.migrate(source, target, { incremental: true });
    // key1 should be skipped (same version in target)
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  test('should support data transformation', async () => {
    await source.set('key1', 'v1');
    const result = await migrator.migrate(source, target, {
      transform: (entry) => ({
        ...entry,
        value: `transformed-${entry.value}`,
      }),
    });
    expect(result.migrated).toBe(1);
    expect(await target.get('key1')).toBe('transformed-v1');
  });

  test('should support conflict skip strategy', async () => {
    await source.set('key1', 'v1-new');
    await target.set('key1', 'v1-old');
    const result = await migrator.migrate(source, target, { conflictStrategy: 'skip' });
    expect(result.skipped).toBe(1);
    expect(await target.get('key1')).toBe('v1-old');
  });

  test('should support conflict overwrite strategy', async () => {
    await source.set('key1', 'v1-new');
    await target.set('key1', 'v1-old');
    const result = await migrator.migrate(source, target, { conflictStrategy: 'overwrite' });
    expect(result.migrated).toBe(1);
    expect(await target.get('key1')).toBe('v1-new');
  });

  test('should verify data integrity', async () => {
    await source.set('key1', 'v1');
    await migrator.migrate(source, target);
    const verifyResult = await migrator.verify(source, target);
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.checkedKeys).toBe(1);
  });

  test('should detect data mismatches in verification', async () => {
    await source.set('key1', 'v1');
    await target.set('key1', 'v2');
    const verifyResult = await migrator.verify(source, target);
    expect(verifyResult.valid).toBe(false);
    expect(verifyResult.mismatchedKeys).toContain('key1');
  });

  test('should support rollback', async () => {
    const backup = new MemoryStorage<string>();
    await source.set('key1', 'v1');
    await source.set('key2', 'v2');
    // Create backup
    await migrator.migrate(source, backup);
    // Modify target
    await target.set('key1', 'modified');
    // Rollback
    const rollbackResult = await migrator.rollback(target, backup);
    expect(rollbackResult.restored).toBe(2);
    expect(await target.get('key1')).toBe('v1');
  });

  test('should track progress', async () => {
    const progressUpdates: Array<{ total: number; completed: number }> = [];
    await source.set('key1', 'v1');
    await source.set('key2', 'v2');
    await migrator.migrate(source, target, {
      onProgress: (p) => progressUpdates.push({ total: p.total, completed: p.completed }),
    });
    expect(progressUpdates.length).toBe(2);
    expect(progressUpdates[1].completed).toBe(2);
  });
});

// ============================================================
// StorageQueryBuilder Tests
// ============================================================
describe('StorageQueryBuilder', () => {
  let storage: MemoryStorage<{ name: string; age: number; city: string }>;
  let queryBuilder: StorageQueryBuilder<{ name: string; age: number; city: string }>;

  beforeEach(async () => {
    storage = new MemoryStorage<{ name: string; age: number; city: string }>();
    await storage.set('user:1', { name: 'Alice', age: 30, city: 'NYC' }, { tags: ['admin'] });
    await storage.set('user:2', { name: 'Bob', age: 25, city: 'LA' }, { tags: ['user'] });
    await storage.set('user:3', { name: 'Charlie', age: 35, city: 'NYC' }, { tags: ['admin', 'user'] });
    await storage.set('user:4', { name: 'Diana', age: 28, city: 'SF' }, { tags: ['user'] });
    queryBuilder = new StorageQueryBuilder<{ name: string; age: number; city: string }>();
  });

  test('should filter by equality', async () => {
    const result = await queryBuilder.eq('value.city', 'NYC').execute(storage);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  test('should filter by greater than', async () => {
    const result = await queryBuilder.gt('value.age', 30).execute(storage);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Charlie');
  });

  test('should filter by less than', async () => {
    const result = await queryBuilder.lt('value.age', 28).execute(storage);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Bob');
  });

  test('should filter by between', async () => {
    const result = await queryBuilder.between('value.age', 25, 30).execute(storage);
    expect(result.items).toHaveLength(3);
  });

  test('should filter by contains', async () => {
    const result = await queryBuilder.contains('value.name', 'li').execute(storage);
    expect(result.items).toHaveLength(2); // Alice, Charlie
  });

  test('should filter by startsWith', async () => {
    const result = await queryBuilder.startsWith('value.name', 'A').execute(storage);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Alice');
  });

  test('should filter by endsWith', async () => {
    const result = await queryBuilder.endsWith('value.name', 'e').execute(storage);
    expect(result.items).toHaveLength(2); // Alice, Charlie
  });

  test('should filter by in operator', async () => {
    const result = await queryBuilder.in('value.city', ['NYC', 'SF']).execute(storage);
    expect(result.items).toHaveLength(3);
  });

  test('should filter by ne operator', async () => {
    const result = await queryBuilder.ne('value.city', 'NYC').execute(storage);
    expect(result.items).toHaveLength(2);
  });

  test('should filter by tag', async () => {
    const result = await queryBuilder.withTag('admin').execute(storage);
    expect(result.items).toHaveLength(2);
  });

  test('should support sorting ascending', async () => {
    const result = await queryBuilder.orderBy('value.age', 'asc').execute(storage);
    expect(result.items[0].age).toBe(25);
    expect(result.items[3].age).toBe(35);
  });

  test('should support sorting descending', async () => {
    const result = await queryBuilder.orderBy('value.age', 'desc').execute(storage);
    expect(result.items[0].age).toBe(35);
    expect(result.items[3].age).toBe(25);
  });

  test('should support skip and limit', async () => {
    const result = await queryBuilder
      .orderBy('value.age', 'asc')
      .skip(1)
      .limit(2)
      .execute(storage);
    expect(result.items).toHaveLength(2);
    expect(result.skipped).toBe(1);
    expect(result.limited).toBe(true);
    expect(result.items[0].age).toBe(28);
  });

  test('should support projection', async () => {
    const result = await queryBuilder.select('name', 'age').execute(storage);
    for (const item of result.items) {
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('age');
      expect(item).not.toHaveProperty('city');
    }
  });

  test('should support logical AND', async () => {
    const result = await queryBuilder
      .and(
        { field: 'value.city', operator: 'eq', value: 'NYC' },
        { field: 'value.age', operator: 'gt', value: 30 },
      )
      .execute(storage);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Charlie');
  });

  test('should support logical OR', async () => {
    const result = await queryBuilder
      .or(
        { field: 'value.name', operator: 'eq', value: 'Alice' },
        { field: 'value.name', operator: 'eq', value: 'Bob' },
      )
      .execute(storage);
    expect(result.items).toHaveLength(2);
  });

  test('should support logical NOT', async () => {
    const result = await queryBuilder
      .not({ field: 'value.city', operator: 'eq', value: 'NYC' })
      .execute(storage);
    expect(result.items).toHaveLength(2);
  });

  test('should build query specification', () => {
    const spec = queryBuilder
      .eq('value.city', 'NYC')
      .orderBy('value.age', 'asc')
      .skip(0)
      .limit(10)
      .select('name')
      .withTag('admin')
      .build();
    expect(spec.filters).toHaveLength(1);
    expect(spec.sort).toBeDefined();
    expect(spec.skip).toBe(0);
    expect(spec.limit).toBe(10);
    expect(spec.projection).toContain('name');
    expect(spec.tagFilter).toContain('admin');
  });

  test('should filter by regex', async () => {
    const result = await queryBuilder.regex('value.name', '^[A-C]').execute(storage);
    expect(result.items).toHaveLength(3); // Alice, Bob, Charlie
  });

  test('should filter by exists', async () => {
    const result = await queryBuilder.exists('value.city').execute(storage);
    expect(result.items).toHaveLength(4);
  });

  test('should filter by gte and lte', async () => {
    const result = await queryBuilder.gte('value.age', 28).lte('value.age', 30).execute(storage);
    expect(result.items).toHaveLength(2);
  });
});

// ============================================================
// StorageUtils Tests
// ============================================================
describe('StorageUtils', () => {
  let storage: MemoryStorage<string>;

  beforeEach(() => {
    storage = new MemoryStorage<string>();
  });

  test('should generate unique keys', () => {
    const key1 = StorageUtils.generateKey();
    const key2 = StorageUtils.generateKey();
    expect(key1).not.toBe(key2);
    expect(key1).toMatch(/^[0-9a-f-]+$/);
  });

  test('should generate keys with prefix', () => {
    const key = StorageUtils.generateKey('user');
    expect(key).toMatch(/^user:/);
  });

  test('should validate keys', () => {
    expect(StorageUtils.isValidKey('valid-key')).toBe(true);
    expect(StorageUtils.isValidKey('')).toBe(false);
    expect(StorageUtils.isValidKey('a'.repeat(513))).toBe(false);
    expect(StorageUtils.isValidKey('key\nwith\nnewlines')).toBe(false);
  });

  test('should extract namespace from key', () => {
    expect(StorageUtils.extractNamespace('user:123')).toBe('user');
    expect(StorageUtils.extractNamespace('no-namespace')).toBe('');
  });

  test('should serialize and deserialize values', () => {
    const obj = { name: 'Alice', age: 30 };
    const serialized = StorageUtils.serialize(obj);
    const deserialized = StorageUtils.deserialize<typeof obj>(serialized);
    expect(deserialized.name).toBe('Alice');
    expect(deserialized.age).toBe(30);
  });

  test('should deserialize with schema validation', () => {
    const data = JSON.stringify({ name: 'Alice', age: 30 });
    const result = StorageUtils.deserializeWithSchema(data, {
      name: (v) => typeof v === 'string',
      age: (v) => typeof v === 'number',
    });
    expect(result.name).toBe('Alice');
  });

  test('should throw on schema validation failure', () => {
    const data = JSON.stringify({ name: 'Alice' });
    expect(() =>
      StorageUtils.deserializeWithSchema(data, {
        name: (v) => typeof v === 'string',
        age: (v) => typeof v === 'number',
      }),
    ).toThrow('Missing required field: age');
  });

  test('should deep merge objects', () => {
    const target = { a: 1, b: { c: 2, d: 3 } };
    const source = { b: { c: 10, e: 4 }, f: 5 };
    const merged = StorageUtils.deepMerge(target, source);
    expect(merged.a).toBe(1);
    expect(merged.b.c).toBe(10);
    expect(merged.b.d).toBe(3);
    expect(merged.b.e).toBe(4);
    expect(merged.f).toBe(5);
  });

  test('should estimate size of values', () => {
    expect(StorageUtils.estimateSize(null)).toBe(4);
    expect(StorageUtils.estimateSize(42)).toBe(8);
    expect(StorageUtils.estimateSize('hello')).toBe(10);
    expect(StorageUtils.estimateSize([1, 2, 3])).toBeGreaterThan(0);
    expect(StorageUtils.estimateSize({ a: 1 })).toBeGreaterThan(0);
  });

  test('should perform health check', async () => {
    const result = await StorageUtils.checkHealth(storage);
    expect(result.healthy).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.latency).toBeGreaterThanOrEqual(0);
  });

  test('should compare two storages', async () => {
    const storage2 = new MemoryStorage<string>();
    await storage.set('key1', 'v1');
    await storage.set('key2', 'v2');
    await storage2.set('key1', 'v1');
    await storage2.set('key2', 'v2');
    const result = await StorageUtils.compare(storage, storage2);
    expect(result.identical).toBe(true);
    expect(result.onlyInFirst).toHaveLength(0);
    expect(result.onlyInSecond).toHaveLength(0);
    expect(result.differentValues).toHaveLength(0);
  });

  test('should detect differences in comparison', async () => {
    const storage2 = new MemoryStorage<string>();
    await storage.set('key1', 'v1');
    await storage.set('key2', 'v2');
    await storage2.set('key1', 'v1');
    await storage2.set('key2', 'v2-different');
    await storage2.set('key3', 'v3');
    const result = await StorageUtils.compare(storage, storage2);
    expect(result.identical).toBe(false);
    expect(result.onlyInSecond).toContain('key3');
    expect(result.differentValues).toContain('key2');
  });

  test('should export data as JSON', async () => {
    await storage.set('key1', 'v1');
    await storage.set('key2', 'v2');
    const exported = await StorageUtils.exportData(storage, 'json');
    const parsed = JSON.parse(exported);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].key).toBe('key1');
  });

  test('should export data as CSV', async () => {
    await storage.set('key1', 'v1');
    const exported = await StorageUtils.exportData(storage, 'csv');
    expect(exported).toContain('key,value');
    expect(exported).toContain('key1');
  });

  test('should import data from JSON', async () => {
    const data = JSON.stringify([
      { key: 'key1', value: 'v1' },
      { key: 'key2', value: 'v2' },
    ]);
    const count = await StorageUtils.importData(storage, data, 'json');
    expect(count).toBe(2);
    expect(await storage.get('key1')).toBe('v1');
  });

  test('should import data from CSV', async () => {
    const data = 'key,value\nkey1,"v1"\nkey2,"v2"';
    const count = await StorageUtils.importData(storage, data, 'csv');
    expect(count).toBe(2);
    expect(await storage.get('key1')).toBe('v1');
  });
});

// ============================================================
// Integration Tests
// ============================================================
describe('Integration', () => {
  test('should migrate data between MemoryStorage and FileStorage', async () => {
    const testDir = join('/tmp', `storage-integration-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const source = new MemoryStorage<string>();
      const target = new FileStorage<string>({ directory: testDir });

      await source.set('key1', 'value1');
      await source.set('key2', 'value2');
      await source.set('key3', 'value3');

      const migrator = new StorageMigrator();
      const result = await migrator.migrate(source, target);

      expect(result.succeeded).toBe(true);
      expect(result.migrated).toBe(3);
      expect(await target.get('key1')).toBe('value1');
      expect(await target.get('key2')).toBe('value2');
      expect(await target.get('key3')).toBe('value3');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should use encrypted storage with cache', async () => {
    const inner = new MemoryStorage<string>();
    const encrypted = EncryptedStorage.wrap(inner, { passphrase: 'secret' });
    const cache = new CacheStorage<string>({
      l1: { storage: new MemoryStorage<string>() },
      l2: { storage: encrypted },
    });

    await cache.set('key1', 'secret-data');
    const value = await cache.get('key1');
    expect(value).toBe('secret-data');

    // Verify inner storage has encrypted data
    const raw = await inner.get('key1');
    expect(raw).not.toBe('secret-data');
  });

  test('should use batch processor with encrypted storage', async () => {
    const inner = new MemoryStorage<string>();
    const encrypted = EncryptedStorage.wrap(inner, { passphrase: 'secret' });
    const batch = new BatchProcessor(encrypted);

    for (let i = 0; i < 10; i++) {
      await batch.queue({ type: 'set', key: `key${i}`, value: `value${i}` });
    }
    const result = await batch.flush();
    expect(result.succeeded).toBe(10);

    for (let i = 0; i < 10; i++) {
      expect(await encrypted.get(`key${i}`)).toBe(`value${i}`);
    }
  });

  test('should use metrics with memory storage', async () => {
    const storage = new MemoryStorage<string>();
    const metrics = new StorageMetrics();

    await storage.set('key1', 'v1');
    const start = Date.now();
    await storage.get('key1');
    metrics.recordOperation('get', Date.now() - start, true);

    const report = metrics.getMetrics();
    expect(report.operations.get).toBeDefined();
    expect(report.operations.get.count).toBe(1);
    expect(report.operations.get.successCount).toBe(1);
  });
});

// ============================================================
// Helper
// ============================================================
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
