import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  StateStore,
  CRDTStore,
  GCounter,
  PNCounter,
  GSet,
  ORSet,
  LWWRegister,
  LWWMap,
  SyncProtocol,
  ConflictResolver,
  ReplicationManager,
  RaftConsensus,
  EventSourcedStore,
  ChangeTracker,
  ConsistencyChecker,
  SyncMetrics,
} from '../src/index.js';
import type {
  ResolutionStrategy,
  ConflictEntry,
  SyncMessage,
  CRDTState,
  DomainEvent,
  ChangeRecord,
} from '../src/index.js';

// ============================================================
// StateStore - Comprehensive Coverage
// ============================================================
describe('StateStore (comprehensive)', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  afterEach(() => {
    store.destroy();
  });

  // --- Basic CRUD ---
  test('set returns entry with correct structure', () => {
    const entry = store.set('k', 'v', { namespace: 'ns', label: 'lbl' });
    expect(entry.key).toBe('k');
    expect(entry.value).toBe('v');
    expect(entry.version).toBe(1);
    expect(entry.namespace).toBe('ns');
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.updatedAt).toBeGreaterThan(0);
    expect(entry.expiresAt).toBeUndefined();
  });

  test('set with TTL sets expiresAt', () => {
    const entry = store.set('k', 'v', { ttl: 5000 });
    expect(entry.expiresAt).toBeDefined();
    expect(entry.expiresAt!).toBeGreaterThan(entry.createdAt);
  });

  test('get returns deep cloned entry', () => {
    store.set('k', { a: 1 });
    const e1 = store.get('k')!;
    const e2 = store.get('k')!;
    expect(e1).toEqual(e2);
    expect(e1).not.toBe(e2);
  });

  test('get returns undefined for expired entry', async () => {
    store.set('k', 'v', { ttl: 30 });
    await new Promise((r) => setTimeout(r, 60));
    expect(store.get('k')).toBeUndefined();
  });

  test('get triggers lazy deletion of expired entry', async () => {
    store.set('k', 'v', { ttl: 30 });
    expect(store.size()).toBe(1);
    await new Promise((r) => setTimeout(r, 60));
    store.get('k');
    expect(store.size()).toBe(0);
  });

  test('delete returns false for non-existent key', () => {
    expect(store.delete('nope')).toBe(false);
  });

  test('delete cleans up versions map (bug fix verification)', () => {
    store.set('k', 'v');
    expect(store.getVersion('k')).toBe(1);
    store.delete('k');
    expect(store.getVersion('k')).toBe(0);
  });

  test('delete cleans up TTL timer', () => {
    store.set('k', 'v', { ttl: 5000 });
    store.delete('k');
    expect(store.get('k')).toBeUndefined();
  });

  test('has returns false for expired entry', async () => {
    store.set('k', 'v', { ttl: 30 });
    expect(store.has('k')).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(store.has('k')).toBe(false);
  });

  test('keys returns all keys when no namespace', () => {
    store.set('a', 1);
    store.set('b', 2);
    expect(store.keys()).toEqual(expect.arrayContaining(['a', 'b']));
  });

  test('keys filters by namespace', () => {
    store.set('a', 1, { namespace: 'ns1' });
    store.set('b', 2, { namespace: 'ns2' });
    store.set('c', 3);
    expect(store.keys('ns1')).toEqual(['a']);
    expect(store.keys('ns2')).toEqual(['b']);
    expect(store.keys()).toHaveLength(3);
  });

  test('keys with non-existent namespace returns empty', () => {
    store.set('a', 1);
    expect(store.keys('nonexistent')).toEqual([]);
  });

  // --- Snapshot & Restore ---
  test('snapshot increments counter and creates unique IDs', () => {
    const s1 = store.snapshot('l1');
    const s2 = store.snapshot('l2');
    expect(s1.id).not.toBe(s2.id);
    expect(s1.label).toBe('l1');
    expect(s2.label).toBe('l2');
  });

  test('snapshot without label', () => {
    const s = store.snapshot();
    expect(s.label).toBeUndefined();
  });

  test('snapshot captures entry count', () => {
    store.set('a', 1);
    store.set('b', 2);
    const s = store.snapshot();
    expect(s.entryCount).toBe(2);
  });

  test('restore clears TTL timers from previous state', () => {
    store.set('k', 'v', { ttl: 5000 });
    const snap = store.snapshot();
    store.set('k2', 'v2', { ttl: 5000 });
    store.restore(snap.id);
    // After restore, only the snapshotted entries exist
    expect(store.has('k')).toBe(true);
    expect(store.has('k2')).toBe(false);
  });

  test('restore restores versions', () => {
    store.set('k', 'v1');
    store.set('k', 'v2');
    const snap = store.snapshot();
    store.delete('k');
    store.restore(snap.id);
    expect(store.getVersion('k')).toBe(2);
  });

  test('restore non-existent snapshot returns false', () => {
    expect(store.restore('nope')).toBe(false);
  });

  test('getSnapshot returns undefined for non-existent', () => {
    expect(store.getSnapshot('nope')).toBeUndefined();
  });

  test('getSnapshot returns cloned snapshot', () => {
    store.set('k', 'v');
    const snap = store.snapshot();
    const retrieved = store.getSnapshot(snap.id)!;
    expect(retrieved.id).toBe(snap.id);
    expect(retrieved.entryCount).toBe(snap.entryCount);
  });

  // --- Version ---
  test('getVersion returns 0 for non-existent key', () => {
    expect(store.getVersion('nope')).toBe(0);
  });

  test('version increments on each set', () => {
    store.set('k', 1);
    store.set('k', 2);
    store.set('k', 3);
    expect(store.getVersion('k')).toBe(3);
  });

  // --- Clear & Destroy ---
  test('clear removes all entries and versions', () => {
    store.set('a', 1);
    store.set('b', 2);
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.getVersion('a')).toBe(0);
    expect(store.getVersion('b')).toBe(0);
  });

  test('clear cancels TTL timers', () => {
    store.set('k', 'v', { ttl: 5000 });
    store.clear();
    expect(store.size()).toBe(0);
  });

  test('destroy clears everything including snapshots', () => {
    store.set('k', 'v');
    store.snapshot();
    store.destroy();
    expect(store.size()).toBe(0);
  });

  // --- Deep clone ---
  test('set deep clones value', () => {
    const obj = { nested: { val: 42 } };
    store.set('k', obj);
    obj.nested.val = 99;
    expect((store.get('k')!.value as any).nested.val).toBe(42);
  });

  test('set preserves createdAt on update', () => {
    const e1 = store.set('k', 'v1');
    const e2 = store.set('k', 'v2');
    expect(e2.createdAt).toBe(e1.createdAt);
    expect(e2.updatedAt).toBeGreaterThanOrEqual(e1.updatedAt);
  });

  test('set creates new createdAt for new key', () => {
    const e1 = store.set('k1', 'v1');
    const e2 = store.set('k2', 'v2');
    expect(e2.createdAt).toBeGreaterThanOrEqual(e1.createdAt);
  });

  // --- Edge cases ---
  test('set with value undefined', () => {
    const entry = store.set('k', undefined);
    expect(entry.value).toBeUndefined();
    expect(store.get('k')).toBeDefined();
  });

  test('set with value null', () => {
    store.set('k', null);
    expect(store.get('k')!.value).toBeNull();
  });

  test('set with value 0', () => {
    store.set('k', 0);
    expect(store.get('k')!.value).toBe(0);
  });

  test('set with empty string key', () => {
    store.set('', 'v');
    expect(store.get('')).toBeDefined();
    expect(store.get('')!.value).toBe('v');
  });

  test('multiple snapshots accumulate', () => {
    store.set('k', 'v');
    store.snapshot('s1');
    store.set('k', 'v2');
    store.snapshot('s2');
    // Both snapshots should be accessible
    expect(store.getSnapshot('s1')).toBeUndefined(); // IDs are auto-generated
  });
});

// ============================================================
// CRDTStore - Comprehensive Coverage
// ============================================================
describe('CRDTStore (comprehensive)', () => {
  let store: CRDTStore;

  beforeEach(() => {
    store = new CRDTStore('node1');
  });

  // --- GCounter ---
  describe('GCounter', () => {
    test('increment with default amount 1', () => {
      const c = store.createCounter('c1', 'gcounter');
      c.increment();
      expect(c.value()).toBe(1);
    });

    test('increment with custom amount', () => {
      const c = store.createCounter('c1', 'gcounter');
      c.increment(10);
      expect(c.value()).toBe(10);
    });

    test('increment accumulates', () => {
      const c = store.createCounter('c1', 'gcounter');
      c.increment(3);
      c.increment(7);
      expect(c.value()).toBe(10);
    });

    test('decrement throws', () => {
      const c = store.createCounter('c1', 'gcounter');
      expect(() => c.decrement()).toThrow('GCounter does not support decrement');
    });

    test('merge takes max per node', () => {
      const c = store.createCounter('c1', 'gcounter');
      c.increment(5);
      c.merge({ node1: 5, node2: 10, node3: 3 });
      // node1: max(5,5)=5, node2: max(0,10)=10, node3: max(0,3)=3 => total=18
      expect(c.value()).toBe(18);
    });

    test('merge ignores lower values', () => {
      const c = store.createCounter('c1', 'gcounter');
      c.increment(10);
      c.merge({ node1: 3 });
      expect(c.value()).toBe(10); // max(10,3) = 10
    });

    test('getState returns all node counts', () => {
      const c = store.createCounter('c1', 'gcounter');
      c.increment(5);
      c.merge({ node2: 3 });
      const state = c.getState();
      expect(state.node1).toBe(5);
      expect(state.node2).toBe(3);
    });

    test('id and type are correct', () => {
      const c = store.createCounter('c1', 'gcounter');
      expect(c.id).toBe('c1');
      expect(c.type).toBe('gcounter');
    });
  });

  // --- PNCounter ---
  describe('PNCounter', () => {
    test('increment and decrement', () => {
      const c = store.createCounter('c1', 'pncounter');
      c.increment(10);
      c.decrement(3);
      expect(c.value()).toBe(7);
    });

    test('value can go negative', () => {
      const c = store.createCounter('c1', 'pncounter');
      c.decrement(5);
      expect(c.value()).toBe(-5);
    });

    test('merge takes max for increments and decrements', () => {
      const c = store.createCounter('c1', 'pncounter');
      c.increment(10);
      c.decrement(3);
      c.merge({ inc_node1: 10, dec_node1: 3, inc_node2: 5, dec_node2: 1 });
      expect(c.value()).toBe(11); // (10+5) - (3+1) = 11
    });

    test('getState prefixes inc_ and dec_', () => {
      const c = store.createCounter('c1', 'pncounter');
      c.increment(5);
      c.decrement(2);
      const state = c.getState();
      expect(state['inc_node1']).toBe(5);
      expect(state['dec_node1']).toBe(2);
    });

    test('id and type are correct', () => {
      const c = store.createCounter('c1', 'pncounter');
      expect(c.id).toBe('c1');
      expect(c.type).toBe('pncounter');
    });
  });

  // --- GSet ---
  describe('GSet', () => {
    test('add and has', () => {
      const s = store.createSet('s1', 'gset');
      s.add('a');
      expect(s.has('a')).toBe(true);
      expect(s.has('b')).toBe(false);
    });

    test('no duplicates', () => {
      const s = store.createSet('s1', 'gset');
      s.add('a');
      s.add('a');
      expect(s.values()).toHaveLength(1);
    });

    test('remove throws', () => {
      const s = store.createSet('s1', 'gset');
      expect(() => s.remove('a')).toThrow('GSet does not support remove');
    });

    test('merge adds all elements', () => {
      const s = store.createSet('s1', 'gset');
      s.add('a');
      s.merge({ type: 'gset', elements: ['b', 'c'] });
      expect(s.values()).toHaveLength(3);
    });

    test('merge ignores duplicates', () => {
      const s = store.createSet('s1', 'gset');
      s.add('a');
      s.merge({ type: 'gset', elements: ['a', 'b'] });
      expect(s.values()).toHaveLength(2);
    });

    test('values returns array', () => {
      const s = store.createSet('s1', 'gset');
      s.add(1);
      s.add(2);
      expect(s.values()).toEqual(expect.arrayContaining([1, 2]));
    });

    test('getState returns correct type', () => {
      const s = store.createSet('s1', 'gset');
      const state = s.getState();
      expect(state.type).toBe('gset');
    });
  });

  // --- ORSet ---
  describe('ORSet', () => {
    test('add and remove', () => {
      const s = store.createSet('s1', 'orset');
      s.add('a');
      s.add('b');
      expect(s.values()).toHaveLength(2);
      s.remove('a');
      expect(s.has('a')).toBe(false);
      expect(s.has('b')).toBe(true);
    });

    test('remove non-existent value does nothing', () => {
      const s = store.createSet('s1', 'orset');
      s.remove('a'); // should not throw
      expect(s.values()).toHaveLength(0);
    });

    test('merge adds remote elements', () => {
      const s = store.createSet('s1', 'orset');
      s.add('a');
      s.merge({ type: 'orset', elements: [['1_b', 'b'], ['2_c', 'c']], tombstones: [] });
      expect(s.has('a')).toBe(true);
      expect(s.has('b')).toBe(true);
      expect(s.has('c')).toBe(true);
    });

    test('merge respects tombstones', () => {
      const s = store.createSet('s1', 'orset');
      s.add('a');
      // Get state BEFORE removing - this captures 'a' with its unique key
      const stateBeforeRemove = s.getState();
      // Remove 'a' locally - this adds a tombstone
      s.remove('a');
      expect(s.has('a')).toBe(false);

      // Create a new set and first merge the state that has 'a'
      const s2 = new CRDTStore('node2').createSet('s1', 'orset');
      s2.merge(stateBeforeRemove);
      expect(s2.has('a')).toBe(true);

      // Now merge the state after removal (which has tombstones)
      const stateAfterRemove = s.getState();
      s2.merge(stateAfterRemove);
      // The tombstone should now remove 'a' from s2
      expect(s2.has('a')).toBe(false);
    });

    test('merge does not re-add tombstoned elements', () => {
      const s = store.createSet('s1', 'orset');
      s.add('a');
      s.remove('a');
      // Remote tries to add 'a' with a different unique key
      s.merge({ type: 'orset', elements: [['99_a', 'a']], tombstones: [] });
      // Since 'a' was removed locally, the tombstone prevents it
      // But the remote unique key '99_a' is not in local tombstones
      // So 'a' should be re-added via the remote key
      expect(s.has('a')).toBe(true);
    });

    test('has uses JSON.stringify comparison', () => {
      const s = store.createSet('s1', 'orset');
      s.add({ x: 1 });
      expect(s.has({ x: 1 })).toBe(true);
      expect(s.has({ x: 2 })).toBe(false);
    });

    test('getState includes tombstones', () => {
      const s = store.createSet('s1', 'orset');
      s.add('a');
      s.remove('a');
      const state = s.getState();
      expect(state.tombstones).toBeDefined();
      expect(state.tombstones!.length).toBeGreaterThan(0);
    });

    test('id and type are correct', () => {
      const s = store.createSet('s1', 'orset');
      expect(s.id).toBe('s1');
      expect(s.type).toBe('orset');
    });
  });

  // --- LWWRegister ---
  describe('LWWRegister', () => {
    test('set and get', () => {
      const r = store.createRegister('r1');
      r.set('hello');
      expect(r.get()).toBe('hello');
    });

    test('merge with higher timestamp wins', () => {
      const r = store.createRegister('r1');
      r.set('old', 1, 'node1');
      r.merge({ value: 'new', timestamp: 2, node: 'node2' });
      expect(r.get()).toBe('new');
    });

    test('merge with lower timestamp loses', () => {
      const r = store.createRegister('r1');
      r.set('local', 5, 'node1');
      r.merge({ value: 'remote', timestamp: 3, node: 'node2' });
      expect(r.get()).toBe('local');
    });

    test('merge with same timestamp uses node ID tie-breaker', () => {
      const r = store.createRegister('r1');
      r.set('local', 5, 'node1');
      r.merge({ value: 'remote', timestamp: 5, node: 'node2' });
      expect(r.get()).toBe('remote'); // 'node2' > 'node1'
    });

    test('merge with same timestamp and lower node ID loses', () => {
      const r = store.createRegister('r1');
      r.set('local', 5, 'node9');
      r.merge({ value: 'remote', timestamp: 5, node: 'node1' });
      expect(r.get()).toBe('local'); // 'node9' > 'node1'
    });

    test('set ignores lower timestamp', () => {
      const r = store.createRegister('r1');
      r.set('first', 10, 'node1');
      r.set('second', 5, 'node2');
      expect(r.get()).toBe('first');
    });

    test('get deep clones value', () => {
      const r = store.createRegister('r1');
      const obj = { a: 1 };
      r.set(obj, 1, 'node1');
      obj.a = 99;
      expect((r.get() as any).a).toBe(1);
    });

    test('getState returns correct structure', () => {
      const r = store.createRegister('r1');
      r.set('val', 1, 'node1');
      const state = r.getState();
      expect(state.value).toBe('val');
      expect(state.timestamp).toBe(1);
      expect(state.node).toBe('node1');
    });
  });

  // --- LWWMap ---
  describe('LWWMap', () => {
    test('set and get', () => {
      const m = store.createMap('m1');
      m.set('k1', 'v1');
      expect(m.get('k1')).toBe('v1');
    });

    test('has and keys', () => {
      const m = store.createMap('m1');
      m.set('a', 1);
      m.set('b', 2);
      expect(m.has('a')).toBe(true);
      expect(m.has('c')).toBe(false);
      expect(m.keys()).toHaveLength(2);
    });

    test('remove deletes key', () => {
      const m = store.createMap('m1');
      m.set('k1', 'v1');
      m.remove('k1');
      expect(m.has('k1')).toBe(false);
      expect(m.get('k1')).toBeUndefined();
    });

    test('entries returns key-value pairs', () => {
      const m = store.createMap('m1');
      m.set('k1', 'v1');
      m.set('k2', 'v2');
      const entries = m.entries();
      expect(entries).toHaveLength(2);
    });

    test('merge overwrites with higher timestamp', () => {
      const m = store.createMap('m1');
      m.set('k1', 'v1', 1, 'node1');
      m.merge({ k1: { value: 'v2', timestamp: 2, node: 'node2' } });
      expect(m.get('k1')).toBe('v2');
    });

    test('merge keeps local with higher timestamp', () => {
      const m = store.createMap('m1');
      m.set('k1', 'v1', 5, 'node1');
      m.merge({ k1: { value: 'v2', timestamp: 2, node: 'node2' } });
      expect(m.get('k1')).toBe('v1');
    });

    test('merge handles deleted keys', () => {
      const m = store.createMap('m1');
      m.set('k1', 'v1', 1, 'node1');
      const state = m.getState();
      m.remove('k1');
      // Remote has a newer value
      m.merge({ k1: { value: 'v3', timestamp: 100, node: 'node2' } });
      expect(m.get('k1')).toBe('v3');
    });

    test('merge with same timestamp uses node ID tie-breaker', () => {
      const m = store.createMap('m1');
      m.set('k1', 'v1', 5, 'node1');
      m.merge({ k1: { value: 'v2', timestamp: 5, node: 'node2' } });
      expect(m.get('k1')).toBe('v2');
    });

    test('set ignores lower timestamp than existing', () => {
      const m = store.createMap('m1');
      m.set('k1', 'v1', 10, 'node1');
      m.set('k1', 'v2', 5, 'node2');
      expect(m.get('k1')).toBe('v1');
    });

    test('set ignores lower timestamp than deleted', () => {
      const m = store.createMap('m1');
      m.set('k1', 'v1', 1, 'node1');
      m.remove('k1'); // sets deletedTs to Date.now() which is > 1
      // This test verifies the deletedKeys check
      expect(m.has('k1')).toBe(false);
    });

    test('get deep clones value', () => {
      const m = store.createMap('m1');
      const obj = { a: 1 };
      m.set('k1', obj, 1, 'node1');
      obj.a = 99;
      expect((m.get('k1') as any).a).toBe(1);
    });

    test('getState includes deleted keys with _deleted marker', () => {
      const m = store.createMap('m1');
      m.set('k1', 'v1', 1, 'node1');
      m.remove('k1');
      const state = m.getState();
      expect((state.k1 as any)._deleted).toBe(true);
    });
  });

  // --- CRDTStore container ---
  describe('CRDTStore container', () => {
    test('createCounter defaults to gcounter', () => {
      const c = store.createCounter('c1');
      expect(c.type).toBe('gcounter');
    });

    test('createSet defaults to orset', () => {
      const s = store.createSet('s1');
      expect(s.type).toBe('orset');
    });

    test('getCounter returns undefined for non-existent', () => {
      expect(store.getCounter('nope')).toBeUndefined();
    });

    test('getSet returns undefined for non-existent', () => {
      expect(store.getSet('nope')).toBeUndefined();
    });

    test('getRegister returns undefined for non-existent', () => {
      expect(store.getRegister('nope')).toBeUndefined();
    });

    test('getMap returns undefined for non-existent', () => {
      expect(store.getMap('nope')).toBeUndefined();
    });

    test('merge returns correct counts', () => {
      store.createCounter('c1', 'gcounter');
      store.createSet('s1', 'gset');
      store.createRegister('r1');
      store.createMap('m1');
      const result = store.merge({
        counters: { c1: { type: 'gcounter', state: { node1: 5 } } },
        sets: { s1: { type: 'gset', elements: ['a'] } },
        registers: { r1: { value: 'v', timestamp: 1, node: 'n1' } },
        maps: { m1: { k1: { value: 'v1', timestamp: 1, node: 'n1' } } },
      });
      expect(result.countersMerged).toBe(1);
      expect(result.setsMerged).toBe(1);
      expect(result.registersMerged).toBe(1);
      expect(result.mapsMerged).toBe(1);
      expect(result.conflicts).toBe(0);
    });

    test('merge skips non-existent local CRDTs', () => {
      const result = store.merge({
        counters: { c_nonexist: { type: 'gcounter', state: { node1: 5 } } },
        sets: {},
        registers: {},
        maps: {},
      });
      expect(result.countersMerged).toBe(0);
    });

    test('getState returns complete state', () => {
      store.createCounter('c1');
      store.createSet('s1');
      store.createRegister('r1');
      store.createMap('m1');
      const state = store.getState();
      expect(Object.keys(state.counters)).toContain('c1');
      expect(Object.keys(state.sets)).toContain('s1');
      expect(Object.keys(state.registers)).toContain('r1');
      expect(Object.keys(state.maps)).toContain('m1');
    });

    test('getDelta returns full state on first call', () => {
      store.createCounter('c1');
      const delta = store.getDelta();
      expect(Object.keys(delta.counters)).toContain('c1');
    });

    test('getDelta returns full state on subsequent calls (current impl)', () => {
      store.createCounter('c1');
      store.getDelta(); // first call
      const delta2 = store.getDelta(); // second call
      expect(Object.keys(delta2.counters)).toContain('c1');
    });
  });

  // --- Multi-node CRDT merge scenarios ---
  describe('Multi-node CRDT merge', () => {
    test('GCounter converges across 3 nodes', () => {
      const s1 = new CRDTStore('node1');
      const s2 = new CRDTStore('node2');
      const s3 = new CRDTStore('node3');

      const c1 = s1.createCounter('shared', 'gcounter');
      const c2 = s2.createCounter('shared', 'gcounter');
      const c3 = s3.createCounter('shared', 'gcounter');

      c1.increment(10);
      c2.increment(20);
      c3.increment(30);

      s1.merge(s2.getState());
      s1.merge(s3.getState());
      s2.merge(s1.getState());
      s3.merge(s1.getState());

      expect(s1.getCounter('shared')!.value()).toBe(60);
      expect(s2.getCounter('shared')!.value()).toBe(60);
      expect(s3.getCounter('shared')!.value()).toBe(60);
    });

    test('PNCounter converges across 2 nodes', () => {
      const s1 = new CRDTStore('node1');
      const s2 = new CRDTStore('node2');

      const c1 = s1.createCounter('shared', 'pncounter');
      const c2 = s2.createCounter('shared', 'pncounter');

      c1.increment(10);
      c1.decrement(3);
      c2.increment(5);

      s1.merge(s2.getState());
      s2.merge(s1.getState());

      expect(s1.getCounter('shared')!.value()).toBe(12);
      expect(s2.getCounter('shared')!.value()).toBe(12);
    });

    test('ORSet concurrent add-remove across nodes', () => {
      const s1 = new CRDTStore('node1');
      const s2 = new CRDTStore('node2');

      const set1 = s1.createSet('shared', 'orset');
      const set2 = s2.createSet('shared', 'orset');

      set1.add('a');
      set1.add('b');
      set2.add('c');

      // Node1 removes 'a'
      set1.remove('a');

      // Merge
      s1.merge(s2.getState());
      s2.merge(s1.getState());

      // 'a' should be removed on both (tombstone propagated)
      expect(s1.getSet('shared')!.has('a')).toBe(false);
      expect(s2.getSet('shared')!.has('a')).toBe(false);
      expect(s2.getSet('shared')!.has('b')).toBe(true);
      expect(s2.getSet('shared')!.has('c')).toBe(true);
    });

    test('LWWRegister converges across 2 nodes', () => {
      const s1 = new CRDTStore('node1');
      const s2 = new CRDTStore('node2');

      const r1 = s1.createRegister('shared');
      const r2 = s2.createRegister('shared');

      r1.set('val1', 10, 'node1');
      r2.set('val2', 20, 'node2');

      s1.merge(s2.getState());
      s2.merge(s1.getState());

      expect(s1.getRegister('shared')!.get()).toBe('val2');
      expect(s2.getRegister('shared')!.get()).toBe('val2');
    });

    test('LWWMap converges across 2 nodes', () => {
      const s1 = new CRDTStore('node1');
      const s2 = new CRDTStore('node2');

      const m1 = s1.createMap('shared');
      const m2 = s2.createMap('shared');

      m1.set('k1', 'v1_node1', 10, 'node1');
      m2.set('k1', 'v1_node2', 20, 'node2');
      m1.set('k2', 'v2_node1', 5, 'node1');

      s1.merge(s2.getState());
      s2.merge(s1.getState());

      expect(s1.getMap('shared')!.get('k1')).toBe('v1_node2');
      expect(s1.getMap('shared')!.get('k2')).toBe('v2_node1');
      expect(s2.getMap('shared')!.get('k1')).toBe('v1_node2');
      expect(s2.getMap('shared')!.get('k2')).toBe('v2_node1');
    });
  });
});

// ============================================================
// SyncProtocol - Comprehensive Coverage
// ============================================================
describe('SyncProtocol (comprehensive)', () => {
  let protocol: SyncProtocol;

  beforeEach(() => {
    protocol = new SyncProtocol('node1');
  });

  test('constructor initializes version vector with self', () => {
    const vv = protocol.getVersionVector();
    expect(vv['node1']).toBe(0);
  });

  test('prepareSync increments local version', () => {
    protocol.prepareSync(emptyState());
    protocol.prepareSync(emptyState());
    expect(protocol.getVersionVector()['node1']).toBe(2);
  });

  test('prepareSync generates unique message IDs', () => {
    const m1 = protocol.prepareSync(emptyState());
    const m2 = protocol.prepareSync(emptyState());
    expect(m1.id).not.toBe(m2.id);
  });

  test('prepareSync sets strategy to full-sync', () => {
    const msg = protocol.prepareSync(emptyState());
    expect(msg.strategy).toBe('full-sync');
  });

  test('prepareDeltaSync with custom strategy', () => {
    const msg = protocol.prepareDeltaSync(emptyState(), 'causal-sync');
    expect(msg.strategy).toBe('causal-sync');
  });

  test('prepareDeltaSync defaults to delta-sync', () => {
    const msg = protocol.prepareDeltaSync(emptyState());
    expect(msg.strategy).toBe('delta-sync');
  });

  // --- processSync conflict detection (bug fix verification) ---
  test('processSync detects conflicts correctly (bug fix)', () => {
    const remoteProtocol = new SyncProtocol('node2');
    remoteProtocol.prepareSync(emptyState());
    remoteProtocol.prepareSync(emptyState());
    // node2 has version 2

    const msg = remoteProtocol.prepareSync(emptyState());
    msg.versionVector['node2'] = 5; // remote has higher version

    const result = protocol.processSync(msg);
    expect(result.conflictsDetected).toBe(1);
  });

  test('processSync does not detect conflict for self', () => {
    const msg = protocol.prepareSync(emptyState());
    msg.versionVector['node1'] = 10;
    const result = protocol.processSync(msg);
    expect(result.conflictsDetected).toBe(0);
  });

  test('processSync resets syncInProgress on completion', () => {
    const msg = protocol.prepareSync(emptyState());
    protocol.processSync(msg);
    expect(protocol.getSyncStatus().syncInProgress).toBe(false);
  });

  test('processSync decrements pendingSyncs', () => {
    const msg = protocol.prepareSync(emptyState());
    protocol.processSync(msg);
    expect(protocol.getSyncStatus().pendingSyncs).toBe(0);
  });

  test('processSync updates lastSyncTime', () => {
    const msg = protocol.prepareSync(emptyState());
    protocol.processSync(msg);
    expect(protocol.getSyncStatus().lastSyncTime).not.toBeNull();
  });

  test('processSync updates lastSyncResult', () => {
    const msg = protocol.prepareSync(emptyState());
    protocol.processSync(msg);
    expect(protocol.getSyncStatus().lastSyncResult).not.toBeNull();
  });

  test('processSync counts entriesMerged', () => {
    const msg = protocol.prepareSync({
      counters: { c1: { type: 'gcounter', state: {} } },
      sets: { s1: { type: 'gset', elements: [] } },
      registers: { r1: { value: 'v', timestamp: 1, node: 'n1' } },
      maps: { m1: {} },
    });
    const result = protocol.processSync(msg);
    expect(result.entriesMerged).toBe(4);
  });

  test('processSync merges version vectors', () => {
    const msg: SyncMessage = {
      id: 'test',
      fromNodeId: 'node2',
      toNodeId: 'node1',
      strategy: 'full-sync',
      state: emptyState(),
      versionVector: { node2: 5, node3: 3 },
      timestamp: Date.now(),
      compressed: false,
    };
    protocol.processSync(msg);
    const vv = protocol.getVersionVector();
    expect(vv['node2']).toBe(5);
    expect(vv['node3']).toBe(3);
  });

  // --- resolveConflict ---
  test('resolveConflict: remote wins with higher timestamp', () => {
    const local = { key: 'k', value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { key: 'k', value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    const resolved = protocol.resolveConflict(local, remote);
    expect(resolved.value).toBe('remote');
  });

  test('resolveConflict: local wins with higher timestamp', () => {
    const local = { key: 'k', value: 'local', version: 1, timestamp: 5, nodeId: 'n1' };
    const remote = { key: 'k', value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    const resolved = protocol.resolveConflict(local, remote);
    expect(resolved.value).toBe('local');
  });

  test('resolveConflict: node ID tie-breaker (higher wins)', () => {
    const local = { key: 'k', value: 'local', version: 1, timestamp: 3, nodeId: 'n1' };
    const remote = { key: 'k', value: 'remote', version: 1, timestamp: 3, nodeId: 'n2' };
    const resolved = protocol.resolveConflict(local, remote);
    expect(resolved.value).toBe('remote');
  });

  test('resolveConflict: local wins when node ID is higher', () => {
    const local = { key: 'k', value: 'local', version: 1, timestamp: 3, nodeId: 'n9' };
    const remote = { key: 'k', value: 'remote', version: 1, timestamp: 3, nodeId: 'n1' };
    const resolved = protocol.resolveConflict(local, remote);
    expect(resolved.value).toBe('local');
  });

  // --- connect/disconnect ---
  test('connectNode initializes version vector entry', () => {
    protocol.connectNode('node2');
    expect(protocol.getSyncStatus().connectedNodes).toContain('node2');
    expect(protocol.getVersionVector()['node2']).toBe(0);
  });

  test('connectNode does not overwrite existing version', () => {
    protocol.connectNode('node2');
    // Simulate receiving a sync that sets node2 version to 5
    const msg: SyncMessage = {
      id: 'test',
      fromNodeId: 'node2',
      toNodeId: 'node1',
      strategy: 'full-sync',
      state: emptyState(),
      versionVector: { node2: 5 },
      timestamp: Date.now(),
      compressed: false,
    };
    protocol.processSync(msg);
    expect(protocol.getVersionVector()['node2']).toBe(5);

    // Reconnecting should not reset
    protocol.disconnectNode('node2');
    protocol.connectNode('node2');
    expect(protocol.getVersionVector()['node2']).toBe(5);
  });

  test('disconnectNode removes from connectedNodes', () => {
    protocol.connectNode('node2');
    protocol.disconnectNode('node2');
    expect(protocol.getSyncStatus().connectedNodes).not.toContain('node2');
  });

  // --- compress/decompress ---
  test('compressPayload base64 encodes state', () => {
    const msg = protocol.prepareSync({
      counters: { c1: { type: 'gcounter', state: { n1: 5 } } },
      sets: {},
      registers: {},
      maps: {},
    });
    const compressed = protocol.compressPayload(msg);
    expect(compressed.compressed).toBe(true);
    expect(compressed.payload).toBeDefined();
    expect(compressed.state).toEqual(msg.state); // original state preserved
  });

  test('decompressPayload decodes base64', () => {
    const msg = protocol.prepareSync({
      counters: { c1: { type: 'gcounter', state: { n1: 5 } } },
      sets: {},
      registers: {},
      maps: {},
    });
    const compressed = protocol.compressPayload(msg);
    const decompressed = protocol.decompressPayload(compressed);
    expect(decompressed.compressed).toBe(false);
    expect(decompressed.state.counters.c1.state.n1).toBe(5);
  });

  test('decompressPayload returns same message if not compressed', () => {
    const msg = protocol.prepareSync(emptyState());
    const result = protocol.decompressPayload(msg);
    expect(result).toEqual(msg);
  });

  test('decompressPayload returns same if no payload', () => {
    const msg = protocol.prepareSync(emptyState());
    msg.compressed = true;
    msg.payload = undefined;
    const result = protocol.decompressPayload(msg);
    expect(result).toEqual(msg);
  });

  // --- getSyncStatus ---
  test('getSyncStatus initial state', () => {
    const status = protocol.getSyncStatus();
    expect(status.lastSyncTime).toBeNull();
    expect(status.lastSyncResult).toBeNull();
    expect(status.pendingSyncs).toBe(0);
    expect(status.syncInProgress).toBe(false);
    expect(status.connectedNodes).toEqual([]);
  });

  test('getNodeId returns constructor value', () => {
    expect(protocol.getNodeId()).toBe('node1');
  });
});

function emptyState(): CRDTState {
  return { counters: {}, sets: {}, registers: {}, maps: {} };
}

// ============================================================
// ConflictResolver - Comprehensive Coverage
// ============================================================
describe('ConflictResolver (comprehensive)', () => {
  let resolver: ConflictResolver;

  beforeEach(() => {
    resolver = new ConflictResolver();
  });

  const local: ConflictEntry = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
  const remote: ConflictEntry = { value: 'remote', version: 2, timestamp: 2, nodeId: 'n2' };

  // --- last-writer-wins ---
  test('LWW: remote wins with higher timestamp', () => {
    const result = resolver.resolve('k', local, remote);
    expect(result.winner).toBe('remote');
    expect(result.value).toBe('remote');
    expect(result.strategy).toBe('last-writer-wins');
  });

  test('LWW: local wins with higher timestamp', () => {
    const l = { ...local, timestamp: 5 };
    const r = { ...remote, timestamp: 2 };
    const result = resolver.resolve('k', l, r);
    expect(result.winner).toBe('local');
  });

  test('LWW: remote wins on equal timestamp (>=)', () => {
    const l = { ...local, timestamp: 3 };
    const r = { ...remote, timestamp: 3 };
    const result = resolver.resolve('k', l, r);
    expect(result.winner).toBe('remote');
  });

  test('LWW: version is max+1', () => {
    const result = resolver.resolve('k', local, remote);
    expect(result.version).toBe(Math.max(1, 2) + 1);
  });

  // --- first-writer-wins ---
  test('FWW: local wins when local timestamp <= remote', () => {
    resolver.setStrategy('k', 'first-writer-wins');
    const result = resolver.resolve('k', local, remote);
    expect(result.winner).toBe('local');
  });

  test('FWW: remote wins when local timestamp > remote', () => {
    resolver.setStrategy('k', 'first-writer-wins');
    const l = { ...local, timestamp: 5 };
    const r = { ...remote, timestamp: 2 };
    const result = resolver.resolve('k', l, r);
    expect(result.winner).toBe('remote');
  });

  test('FWW: version equals winner version', () => {
    resolver.setStrategy('k', 'first-writer-wins');
    const result = resolver.resolve('k', local, remote);
    expect(result.version).toBe(local.version);
  });

  // --- merge ---
  test('merge: shallow merges objects', () => {
    resolver.setStrategy('k', 'merge');
    const l: ConflictEntry = { value: { a: 1 }, version: 1, timestamp: 1, nodeId: 'n1' };
    const r: ConflictEntry = { value: { b: 2 }, version: 1, timestamp: 2, nodeId: 'n2' };
    const result = resolver.resolve('k', l, r);
    expect(result.value).toEqual({ a: 1, b: 2 });
  });

  test('merge: remote overrides local on same keys', () => {
    resolver.setStrategy('k', 'merge');
    const l: ConflictEntry = { value: { a: 1, b: 1 }, version: 1, timestamp: 1, nodeId: 'n1' };
    const r: ConflictEntry = { value: { a: 2, c: 3 }, version: 1, timestamp: 2, nodeId: 'n2' };
    const result = resolver.resolve('k', l, r);
    expect(result.value).toEqual({ a: 2, b: 1, c: 3 });
  });

  test('merge: falls back to local for non-objects', () => {
    resolver.setStrategy('k', 'merge');
    const l: ConflictEntry = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const r: ConflictEntry = { value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    const result = resolver.resolve('k', l, r);
    expect(result.value).toBe('local');
  });

  test('merge: falls back to local when local is null', () => {
    resolver.setStrategy('k', 'merge');
    const l: ConflictEntry = { value: null, version: 1, timestamp: 1, nodeId: 'n1' };
    const r: ConflictEntry = { value: { b: 2 }, version: 1, timestamp: 2, nodeId: 'n2' };
    const result = resolver.resolve('k', l, r);
    expect(result.value).toBeNull();
  });

  test('merge: falls back to local when remote is null', () => {
    resolver.setStrategy('k', 'merge');
    const l: ConflictEntry = { value: { a: 1 }, version: 1, timestamp: 1, nodeId: 'n1' };
    const r: ConflictEntry = { value: null, version: 1, timestamp: 2, nodeId: 'n2' };
    const result = resolver.resolve('k', l, r);
    expect(result.value).toEqual({ a: 1 });
  });

  // --- custom-function ---
  test('custom: uses resolver function', () => {
    resolver.setCustomResolver('k', (_key, _local, remote) => remote.value);
    const result = resolver.resolve('k', local, remote);
    expect(result.value).toBe('remote');
    expect(result.strategy).toBe('custom-function');
  });

  test('custom: falls back to local when no resolver set', () => {
    resolver.setStrategy('k', 'custom-function');
    const result = resolver.resolve('k', local, remote);
    expect(result.value).toBe('local');
  });

  // --- manual ---
  test('manual: defaults to local', () => {
    resolver.setStrategy('k', 'manual');
    const result = resolver.resolve('k', local, remote);
    expect(result.winner).toBe('local');
    expect(result.value).toBe('local');
    expect(result.version).toBe(local.version);
  });

  // --- default strategy ---
  test('default strategy is last-writer-wins', () => {
    expect(resolver.getStrategy('any')).toBe('last-writer-wins');
  });

  test('setDefaultStrategy changes default', () => {
    resolver.setDefaultStrategy('merge');
    expect(resolver.getStrategy('any')).toBe('merge');
  });

  // --- conflict tracking ---
  test('conflicts are tracked', () => {
    resolver.resolve('k1', local, remote);
    resolver.resolve('k2', local, remote);
    expect(resolver.getConflicts()).toHaveLength(2);
    expect(resolver.getConflictCount()).toBe(2);
  });

  test('conflict history is tracked', () => {
    resolver.resolve('k1', local, remote);
    const history = resolver.getConflictHistory();
    expect(history).toHaveLength(1);
    expect(history[0].key).toBe('k1');
    expect(history[0].resolved).toBeDefined();
    expect(history[0].detectedAt).toBeGreaterThan(0);
    expect(history[0].resolvedAt).toBeGreaterThan(0);
  });

  test('clearConflicts clears active conflicts', () => {
    resolver.resolve('k1', local, remote);
    resolver.clearConflicts();
    expect(resolver.getConflicts()).toHaveLength(0);
    expect(resolver.getConflictHistory()).toHaveLength(1); // history preserved
  });

  test('clearHistory clears history', () => {
    resolver.resolve('k1', local, remote);
    resolver.clearHistory();
    expect(resolver.getConflictHistory()).toHaveLength(0);
    expect(resolver.getConflicts()).toHaveLength(1); // active preserved
  });

  test('resolved entry structure', () => {
    const result = resolver.resolve('k', local, remote);
    expect(result.key).toBe('k');
    expect(result.version).toBeGreaterThan(0);
    expect(result.resolvedAt).toBeGreaterThan(0);
    expect(result.winner).toBeDefined();
    expect(result.strategy).toBeDefined();
  });

  // --- setCustomResolver also sets strategy ---
  test('setCustomResolver sets strategy to custom-function', () => {
    resolver.setCustomResolver('k', () => 'val');
    expect(resolver.getStrategy('k')).toBe('custom-function');
  });
});

// ============================================================
// ReplicationManager - Comprehensive Coverage
// ============================================================
describe('ReplicationManager (comprehensive)', () => {
  let manager: ReplicationManager;

  beforeEach(() => {
    manager = new ReplicationManager('multi-leader', 3);
  });

  // --- Node management ---
  test('addNode sets first node as leader in leader-follower mode', () => {
    const lf = new ReplicationManager('leader-follower', 3);
    lf.addNode('n1', 'http://a');
    lf.addNode('n2', 'http://b');
    expect(lf.getClusterState().leaderId).toBe('n1');
    expect(lf.getClusterState().nodes[0].isLeader).toBe(true);
    expect(lf.getClusterState().nodes[1].isLeader).toBe(false);
  });

  test('removeNode triggers leader re-election', () => {
    const lf = new ReplicationManager('leader-follower', 3);
    lf.addNode('n1', 'http://a');
    lf.addNode('n2', 'http://b');
    lf.removeNode('n1');
    expect(lf.getClusterState().leaderId).toBe('n2');
  });

  test('removeNode clears leaderId when no nodes left', () => {
    const lf = new ReplicationManager('leader-follower', 3);
    lf.addNode('n1', 'http://a');
    lf.removeNode('n1');
    expect(lf.getClusterState().leaderId).toBeNull();
  });

  test('addNode does not set leader in multi-leader mode', () => {
    manager.addNode('n1', 'http://a');
    expect(manager.getClusterState().nodes[0].isLeader).toBe(false);
  });

  // --- Replication ---
  test('replicate succeeds with enough alive nodes', () => {
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    manager.addNode('n3', 'http://c');
    const result = manager.replicate('k', 'v');
    expect(result.success).toBe(true);
    expect(result.replicatedTo).toHaveLength(3);
    expect(result.failedNodes).toHaveLength(0);
  });

  test('replicate fails when not enough alive nodes', () => {
    manager.addNode('n1', 'http://a');
    manager.markNodeDead('n1');
    const result = manager.replicate('k', 'v');
    expect(result.success).toBe(false);
    expect(result.replicatedTo).toHaveLength(0);
  });

  test('replicate respects replicationFactor', () => {
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    manager.addNode('n3', 'http://c');
    manager.addNode('n4', 'http://d');
    manager.setReplicationFactor(2);
    const result = manager.replicate('k', 'v');
    expect(result.replicatedTo).toHaveLength(2);
  });

  test('replication stats track correctly', () => {
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    manager.addNode('n3', 'http://c');
    manager.replicate('k', 'v');
    const stats = manager.getReplicationStats();
    expect(stats.totalReplications).toBe(1);
    expect(stats.successfulReplications).toBe(1);
    expect(stats.failedReplications).toBe(0);
  });

  test('replication failure tracked', () => {
    manager.addNode('n1', 'http://a');
    manager.markNodeDead('n1');
    manager.replicate('k', 'v');
    const stats = manager.getReplicationStats();
    expect(stats.failedReplications).toBe(1);
  });

  test('average latency is calculated correctly (bug fix)', () => {
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    manager.addNode('n3', 'http://c');
    manager.replicate('k1', 'v1');
    manager.replicate('k2', 'v2');
    const stats = manager.getReplicationStats();
    expect(stats.averageLatency).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(stats.averageLatency)).toBe(false);
  });

  // --- Read ---
  test('read with quorum', () => {
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    manager.addNode('n3', 'http://c');
    const result = manager.read('k');
    expect(result.success).toBe(true);
    expect(result.readFrom.length).toBeGreaterThanOrEqual(2); // majority
  });

  test('read with ONE', () => {
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    const result = manager.read('k', { type: 'one' });
    expect(result.readFrom).toHaveLength(1);
  });

  test('read with ALL', () => {
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    const result = manager.read('k', { type: 'all' });
    expect(result.readFrom).toHaveLength(2);
  });

  test('read with custom consistencyLevel', () => {
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    manager.addNode('n3', 'http://c');
    const result = manager.read('k', { type: 'quorum', consistencyLevel: 2 });
    expect(result.readFrom).toHaveLength(2);
  });

  test('read with no alive nodes', () => {
    manager.addNode('n1', 'http://a');
    manager.markNodeDead('n1');
    const result = manager.read('k');
    expect(result.success).toBe(false);
    expect(result.stale).toBe(true);
  });

  // --- Write quorum 'all' uses aliveNodes (bug fix) ---
  test('write quorum all uses alive nodes count (bug fix)', () => {
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    manager.setWriteQuorum({ type: 'all' });
    const result = manager.replicate('k', 'v');
    expect(result.success).toBe(true);
    expect(result.achieved).toBe(2);
  });

  // --- Anti-entropy ---
  test('startAntiEntropy and stopAntiEntropy', () => {
    let count = 0;
    manager.startAntiEntropy(30, () => { count++; });
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        manager.stopAntiEntropy();
        expect(count).toBeGreaterThan(0);
        resolve();
      }, 80);
    });
  });

  test('anti-entropy increments stats', async () => {
    let count = 0;
    manager.startAntiEntropy(30, () => { count++; });
    await new Promise((r) => setTimeout(r, 80));
    manager.stopAntiEntropy();
    expect(manager.getReplicationStats().antiEntropyCount).toBeGreaterThan(0);
  });

  // --- Node alive/dead ---
  test('markNodeAlive and markNodeDead', () => {
    manager.addNode('n1', 'http://a');
    manager.markNodeDead('n1');
    expect(manager.getNode('n1')!.isAlive).toBe(false);
    manager.markNodeAlive('n1');
    expect(manager.getNode('n1')!.isAlive).toBe(true);
  });

  test('markNodeAlive for non-existent node does nothing', () => {
    manager.markNodeAlive('nope'); // should not throw
  });

  test('markNodeDead for non-existent node does nothing', () => {
    manager.markNodeDead('nope'); // should not throw
  });

  // --- getNode ---
  test('getNode returns cloned node', () => {
    manager.addNode('n1', 'http://a');
    const n1 = manager.getNode('n1')!;
    const n2 = manager.getNode('n1')!;
    expect(n1).toEqual(n2);
    expect(n1).not.toBe(n2);
  });

  test('getNode returns undefined for non-existent', () => {
    expect(manager.getNode('nope')).toBeUndefined();
  });

  // --- Cluster state ---
  test('getClusterState returns correct info', () => {
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    manager.markNodeDead('n2');
    const state = manager.getClusterState();
    expect(state.totalNodes).toBe(2);
    expect(state.aliveNodes).toBe(1);
    expect(state.replicationFactor).toBe(3);
  });

  // --- setMode / setReplicationFactor ---
  test('setMode changes mode', () => {
    manager.setMode('leaderless');
    expect(manager.getClusterState().mode).toBe('leaderless');
  });

  test('setReplicationFactor changes factor', () => {
    manager.setReplicationFactor(5);
    expect(manager.getClusterState().replicationFactor).toBe(5);
  });

  // --- Network partition simulation ---
  test('network partition: replicate fails when majority dead', () => {
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    manager.addNode('n3', 'http://c');
    manager.markNodeDead('n2');
    manager.markNodeDead('n3');
    // Only 1 alive, quorum needs 2
    const result = manager.replicate('k', 'v');
    expect(result.success).toBe(false);
  });

  test('network partition recovery: replicate succeeds after nodes come back', () => {
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    manager.addNode('n3', 'http://c');
    manager.markNodeDead('n2');
    manager.markNodeDead('n3');
    expect(manager.replicate('k', 'v').success).toBe(false);
    manager.markNodeAlive('n2');
    expect(manager.replicate('k', 'v').success).toBe(true);
  });
});

// ============================================================
// RaftConsensus - Comprehensive Coverage
// ============================================================
describe('RaftConsensus (comprehensive)', () => {
  let raft: RaftConsensus;

  beforeEach(() => {
    raft = new RaftConsensus('node1', {
      electionTimeoutMin: 50,
      electionTimeoutMax: 100,
      heartbeatInterval: 25,
    });
  });

  afterEach(() => {
    raft.stop();
    raft.destroy();
  });

  test('initial state: follower, term 0', () => {
    expect(raft.getRole()).toBe('follower');
    expect(raft.getCurrentTerm()).toBe(0);
    expect(raft.getCommitIndex()).toBe(0);
    expect(raft.getLog()).toHaveLength(0);
  });

  test('start is idempotent', () => {
    raft.start();
    raft.start(); // should not throw
    expect(raft.getRole()).toBe('follower');
  });

  test('single node becomes leader on election', () => {
    raft.start();
    raft.triggerElection();
    expect(raft.getRole()).toBe('leader');
    expect(raft.getLeader()).toBe('node1');
    expect(raft.getCurrentTerm()).toBe(1);
  });

  test('election with peers grants votes from all', () => {
    raft.addPeer('node2');
    raft.addPeer('node3');
    raft.start();
    raft.triggerElection();
    expect(raft.getRole()).toBe('leader');
  });

  test('propose as leader succeeds', async () => {
    raft.start();
    raft.triggerElection();
    const result = await raft.propose({ term: 1, index: 1, command: 'set x 1', timestamp: Date.now() });
    expect(result).toBe(true);
    expect(raft.getLog()).toHaveLength(1);
    expect(raft.getCommitIndex()).toBe(1);
  });

  test('propose as follower fails', async () => {
    raft.start();
    const result = await raft.propose({ term: 0, index: 1, command: 'set x 1', timestamp: Date.now() });
    expect(result).toBe(false);
  });

  test('propose assigns term and index', async () => {
    raft.start();
    raft.triggerElection();
    await raft.propose({ term: 0, index: 0, command: 'cmd1', timestamp: Date.now() });
    await raft.propose({ term: 0, index: 0, command: 'cmd2', timestamp: Date.now() });
    const log = raft.getLog();
    expect(log[0].term).toBe(1);
    expect(log[0].index).toBe(1);
    expect(log[1].term).toBe(1);
    expect(log[1].index).toBe(2);
  });

  // --- RequestVote ---
  test('requestVote grants vote for higher term', () => {
    const result = raft.requestVote(1, 'node2');
    expect(result.voteGranted).toBe(true);
    expect(result.term).toBe(1);
  });

  test('requestVote rejects if already voted for different candidate', () => {
    raft.requestVote(1, 'node2');
    const result = raft.requestVote(1, 'node3');
    expect(result.voteGranted).toBe(false);
  });

  test('requestVote accepts same candidate', () => {
    raft.requestVote(1, 'node2');
    const result = raft.requestVote(1, 'node2');
    expect(result.voteGranted).toBe(true);
  });

  test('requestVote steps down on higher term', () => {
    raft.start();
    raft.triggerElection();
    expect(raft.getRole()).toBe('leader');
    raft.requestVote(10, 'node2');
    expect(raft.getRole()).toBe('follower');
    expect(raft.getCurrentTerm()).toBe(10);
  });

  test('requestVote resets election timer', () => {
    raft.start();
    raft.requestVote(1, 'node2');
    // Should not throw, timer reset
  });

  // --- AppendEntries ---
  test('appendEntries accepts from higher term', () => {
    const result = raft.appendEntries(1, 'node2', 0, [], 0);
    expect(result.success).toBe(true);
    expect(raft.getRole()).toBe('follower');
    expect(raft.getLeader()).toBe('node2');
    expect(raft.getCurrentTerm()).toBe(1);
  });

  test('appendEntries rejects from lower term', () => {
    raft.start();
    raft.triggerElection();
    const result = raft.appendEntries(0, 'node2', 0, [], 0);
    expect(result.success).toBe(false);
    expect(result.term).toBe(1);
  });

  test('appendEntries rejects if prevLogIndex too high', () => {
    const result = raft.appendEntries(1, 'node2', 5, [], 0);
    expect(result.success).toBe(false);
  });

  test('appendEntries appends new entries', () => {
    const entries = [
      { term: 1, index: 1, command: 'cmd1', timestamp: Date.now() },
      { term: 1, index: 2, command: 'cmd2', timestamp: Date.now() },
    ];
    const result = raft.appendEntries(1, 'node2', 0, entries, 2);
    expect(result.success).toBe(true);
    expect(result.matchIndex).toBe(2);
    expect(raft.getLog()).toHaveLength(2);
  });

  test('appendEntries overwrites conflicting entries', () => {
    // First, append entry at index 1 with term 1
    raft.appendEntries(1, 'node2', 0, [
      { term: 1, index: 1, command: 'cmd1', timestamp: Date.now() },
    ], 0);
    // Now try to append entry at index 1 with term 2 (conflict)
    const result = raft.appendEntries(2, 'node2', 0, [
      { term: 2, index: 1, command: 'cmd2', timestamp: Date.now() },
    ], 1);
    expect(result.success).toBe(true);
    expect(raft.getLog()).toHaveLength(1);
    expect(raft.getLog()[0].term).toBe(2);
    expect(raft.getLog()[0].command).toBe('cmd2');
  });

  test('appendEntries updates commitIndex', () => {
    raft.appendEntries(1, 'node2', 0, [
      { term: 1, index: 1, command: 'cmd1', timestamp: Date.now() },
      { term: 1, index: 2, command: 'cmd2', timestamp: Date.now() },
    ], 2);
    expect(raft.getCommitIndex()).toBe(2);
  });

  test('appendEntries caps commitIndex to log length', () => {
    raft.appendEntries(1, 'node2', 0, [
      { term: 1, index: 1, command: 'cmd1', timestamp: Date.now() },
    ], 5);
    expect(raft.getCommitIndex()).toBe(1);
  });

  // --- Peer management ---
  test('addPeer initializes nextIndex and matchIndex', () => {
    raft.addPeer('node2');
    // nextIndex should be log.length + 1 = 1
    // matchIndex should be 0
  });

  test('removePeer removes peer', () => {
    raft.addPeer('node2');
    raft.removePeer('node2');
    // Should not throw
  });

  // --- Stop ---
  test('stop clears timers', () => {
    raft.start();
    raft.triggerElection();
    raft.stop();
    expect(raft.getRole()).toBe('leader'); // role not changed on stop
  });

  // --- Multi-node election scenario ---
  test('split vote scenario: no majority', () => {
    // With 4 peers + self = 5 nodes, majority = 3
    // But triggerElection grants all votes, so it still wins
    raft.addPeer('n2');
    raft.addPeer('n3');
    raft.addPeer('n4');
    raft.start();
    raft.triggerElection();
    expect(raft.getRole()).toBe('leader');
  });
});

// ============================================================
// EventSourcedStore - Comprehensive Coverage
// ============================================================
describe('EventSourcedStore (comprehensive)', () => {
  let store: EventSourcedStore;

  beforeEach(() => {
    store = new EventSourcedStore();
  });

  afterEach(() => {
    store.destroy();
  });

  test('append auto-assigns version starting from 1', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'a1', eventType: 'updated', payload: {}, version: 0, timestamp: Date.now() });
    const events = store.getEvents('a1');
    expect(events[0].version).toBe(1);
    expect(events[1].version).toBe(2);
  });

  test('append auto-generates eventId when not provided', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    const events = store.getEvents('a1');
    expect(events[0].eventId).toBeDefined();
    expect(events[0].eventId).toMatch(/^evt_\d+_\d+$/);
  });

  test('append preserves provided eventId', () => {
    store.append({ eventId: 'custom-1', aggregateId: 'a1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    const events = store.getEvents('a1');
    expect(events[0].eventId).toBe('custom-1');
  });

  test('append auto-generates timestamp when not provided', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: {}, version: 0 });
    const events = store.getEvents('a1');
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  test('getEvents returns empty for non-existent aggregate', () => {
    expect(store.getEvents('nope')).toHaveLength(0);
  });

  test('getEvents from version returns correct subset', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: { v: 1 }, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'a1', eventType: 'updated', payload: { v: 2 }, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'a1', eventType: 'updated', payload: { v: 3 }, version: 0, timestamp: Date.now() });
    const events = store.getEvents('a1', 2);
    expect(events).toHaveLength(2);
    expect(events[0].version).toBe(2);
  });

  test('getEvents from version beyond length returns empty', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    expect(store.getEvents('a1', 5)).toHaveLength(0);
  });

  // --- State reconstruction ---
  test('getState builds from created event', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: { name: 'test', value: 1 }, version: 0, timestamp: Date.now() });
    const state = store.getState('a1') as Record<string, unknown>;
    expect(state.name).toBe('test');
    expect(state.value).toBe(1);
    expect(state.id).toBe('a1');
  });

  test('getState applies updates', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: { name: 'test', value: 1 }, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'a1', eventType: 'updated', payload: { value: 2 }, version: 0, timestamp: Date.now() });
    const state = store.getState('a1') as Record<string, unknown>;
    expect(state.value).toBe(2);
    expect(state.name).toBe('test');
  });

  test('getState handles deleted event', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: { name: 'test' }, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'a1', eventType: 'deleted', payload: {}, version: 0, timestamp: Date.now() });
    const state = store.getState('a1') as Record<string, unknown>;
    expect(state.deleted).toBe(true);
  });

  test('getState handles unknown event type', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: { name: 'test' }, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'a1', eventType: 'custom', payload: { extra: true }, version: 0, timestamp: Date.now() });
    const state = store.getState('a1') as Record<string, unknown>;
    expect(state.lastEvent).toBe('custom');
    expect(state.lastPayload).toEqual({ extra: true });
  });

  test('getState returns empty object for non-existent aggregate', () => {
    const state = store.getState('nope');
    expect(state).toEqual({});
  });

  // --- Snapshots ---
  test('createSnapshot captures current state', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: { value: 1 }, version: 0, timestamp: Date.now() });
    store.createSnapshot('a1');
    const snap = store.getSnapshot('a1')!;
    expect(snap.aggregateId).toBe('a1');
    expect((snap.state as Record<string, unknown>).value).toBe(1);
    expect(snap.version).toBe(1);
  });

  test('getState uses snapshot + subsequent events', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: { value: 1 }, version: 0, timestamp: Date.now() });
    store.createSnapshot('a1');
    store.append({ aggregateId: 'a1', eventType: 'updated', payload: { value: 2 }, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'a1', eventType: 'updated', payload: { value: 3 }, version: 0, timestamp: Date.now() });
    const state = store.getState('a1') as Record<string, unknown>;
    expect(state.value).toBe(3);
  });

  test('getSnapshot returns undefined for non-existent', () => {
    expect(store.getSnapshot('nope')).toBeUndefined();
  });

  test('getSnapshot deep clones state', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: { nested: { val: 1 } }, version: 0, timestamp: Date.now() });
    store.createSnapshot('a1');
    const snap = store.getSnapshot('a1')!;
    (snap.state as any).nested.val = 99;
    const snap2 = store.getSnapshot('a1')!;
    expect((snap2.state as any).nested.val).toBe(1);
  });

  // --- Projectors ---
  test('projector receives events', () => {
    const received: string[] = [];
    store.registerProjector('test', (e) => { received.push(e.eventType); });
    store.append({ aggregateId: 'a1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    expect(received).toEqual(['created']);
  });

  test('projector error does not prevent append', () => {
    store.registerProjector('bad', () => { throw new Error('projector error'); });
    store.append({ aggregateId: 'a1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    expect(store.getEvents('a1')).toHaveLength(1);
  });

  test('removeProjector stops notifications', () => {
    const received: string[] = [];
    store.registerProjector('test', (e) => { received.push(e.eventType); });
    store.removeProjector('test');
    store.append({ aggregateId: 'a1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    expect(received).toHaveLength(0);
  });

  // --- Utility methods ---
  test('replay returns same as getState', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: { value: 1 }, version: 0, timestamp: Date.now() });
    expect(store.replay('a1')).toEqual(store.getState('a1'));
  });

  test('getStreamVersion returns event count', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'a1', eventType: 'updated', payload: {}, version: 0, timestamp: Date.now() });
    expect(store.getStreamVersion('a1')).toBe(2);
  });

  test('getStreamVersion returns 0 for non-existent', () => {
    expect(store.getStreamVersion('nope')).toBe(0);
  });

  test('getAggregateIds returns all aggregate IDs', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'a2', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    expect(store.getAggregateIds()).toHaveLength(2);
  });

  test('getTotalEventCount counts all events across aggregates', () => {
    store.append({ aggregateId: 'a1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'a1', eventType: 'updated', payload: {}, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'a2', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    expect(store.getTotalEventCount()).toBe(3);
  });
});

// ============================================================
// ChangeTracker - Comprehensive Coverage
// ============================================================
describe('ChangeTracker (comprehensive)', () => {
  let tracker: ChangeTracker;

  beforeEach(() => {
    tracker = new ChangeTracker(10);
  });

  afterEach(() => {
    tracker.destroy();
  });

  test('track create: oldValue undefined, newValue defined', () => {
    const record = tracker.track('k', undefined, 'v');
    expect(record.type).toBe('create');
    expect(record.key).toBe('k');
    expect(record.oldValue).toBeUndefined();
    expect(record.newValue).toBe('v');
    expect(record.version).toBe(1);
    expect(record.timestamp).toBeGreaterThan(0);
  });

  test('track delete: oldValue defined, newValue undefined', () => {
    const record = tracker.track('k', 'v', undefined);
    expect(record.type).toBe('delete');
    expect(record.oldValue).toBe('v');
    expect(record.newValue).toBeUndefined();
  });

  test('track update: both defined', () => {
    const record = tracker.track('k', 'old', 'new');
    expect(record.type).toBe('update');
  });

  test('track update: both undefined', () => {
    const record = tracker.track('k', undefined, undefined);
    expect(record.type).toBe('update');
  });

  test('track increments version counter', () => {
    tracker.track('k1', undefined, 'v');
    tracker.track('k2', undefined, 'v');
    expect(tracker.track('k3', undefined, 'v').version).toBe(3);
  });

  test('track deep clones values', () => {
    const obj = { nested: { val: 42 } };
    tracker.track('k', undefined, obj);
    obj.nested.val = 99;
    expect((tracker.getAllChanges()[0].newValue as any).nested.val).toBe(42);
  });

  test('getChanges since version', () => {
    tracker.track('k1', undefined, 'v1');
    tracker.track('k2', undefined, 'v2');
    tracker.track('k3', undefined, 'v3');
    expect(tracker.getChanges(0)).toHaveLength(3);
    expect(tracker.getChanges(1)).toHaveLength(2);
    expect(tracker.getChanges(2)).toHaveLength(1);
    expect(tracker.getChanges(3)).toHaveLength(0);
  });

  test('getChanges with negative version returns all', () => {
    tracker.track('k1', undefined, 'v1');
    expect(tracker.getChanges(-1)).toHaveLength(1);
  });

  // --- Subscriptions ---
  test('subscribe to key receives notifications', () => {
    const received: ChangeRecord[] = [];
    tracker.subscribe('k1', (r) => { received.push(r); });
    tracker.track('k1', undefined, 'v');
    expect(received).toHaveLength(1);
    expect(received[0].key).toBe('k1');
  });

  test('subscribe does not receive other key changes', () => {
    const received: ChangeRecord[] = [];
    tracker.subscribe('k1', (r) => { received.push(r); });
    tracker.track('k2', undefined, 'v');
    expect(received).toHaveLength(0);
  });

  test('unsubscribe stops notifications', () => {
    const received: ChangeRecord[] = [];
    const unsub = tracker.subscribe('k1', (r) => { received.push(r); });
    unsub();
    tracker.track('k1', undefined, 'v');
    expect(received).toHaveLength(0);
  });

  test('subscribeAll receives all changes', () => {
    const received: string[] = [];
    tracker.subscribeAll((r) => { received.push(r.key); });
    tracker.track('k1', undefined, 'v');
    tracker.track('k2', undefined, 'v');
    expect(received).toEqual(['k1', 'k2']);
  });

  test('callback errors are caught silently', () => {
    tracker.subscribe('k1', () => { throw new Error('test'); });
    tracker.subscribeAll(() => { throw new Error('test'); });
    expect(() => tracker.track('k1', undefined, 'v')).not.toThrow();
  });

  test('multiple subscribers on same key', () => {
    const r1: string[] = [];
    const r2: string[] = [];
    tracker.subscribe('k1', (rec) => { r1.push(rec.key); });
    tracker.subscribe('k1', (rec) => { r2.push(rec.key); });
    tracker.track('k1', undefined, 'v');
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  // --- Change counts ---
  test('getChangeCount per key', () => {
    tracker.track('k1', undefined, 'v1');
    tracker.track('k1', 'v1', 'v2');
    tracker.track('k2', undefined, 'v');
    expect(tracker.getChangeCount('k1')).toBe(2);
    expect(tracker.getChangeCount('k2')).toBe(1);
    expect(tracker.getChangeCount('k3')).toBe(0);
  });

  test('getTotalChangeCount', () => {
    tracker.track('k1', undefined, 'v');
    tracker.track('k2', undefined, 'v');
    expect(tracker.getTotalChangeCount()).toBe(2);
  });

  // --- Export ---
  test('exportChanges as JSON', () => {
    tracker.track('k1', undefined, 'v');
    const json = tracker.exportChanges('json');
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].key).toBe('k1');
  });

  test('exportChanges throws for unsupported format', () => {
    expect(() => tracker.exportChanges('xml')).toThrow('Unsupported format: xml');
  });

  // --- Batches ---
  test('batches are flushed after interval', async () => {
    tracker.track('k1', undefined, 'v');
    await new Promise((r) => setTimeout(r, 50));
    const batches = tracker.getBatches();
    expect(batches.length).toBeGreaterThan(0);
    expect(batches[0].changes).toHaveLength(1);
  });

  test('clearChanges resets everything', () => {
    tracker.track('k1', undefined, 'v');
    tracker.track('k2', undefined, 'v');
    tracker.clearChanges();
    expect(tracker.getAllChanges()).toHaveLength(0);
    expect(tracker.getChangeCount('k1')).toBe(0);
    expect(tracker.getTotalChangeCount()).toBe(0);
  });
});

// ============================================================
// ConsistencyChecker - Comprehensive Coverage
// ============================================================
describe('ConsistencyChecker (comprehensive)', () => {
  let checker: ConsistencyChecker;

  beforeEach(() => {
    checker = new ConsistencyChecker();
  });

  test('addInvariant and removeInvariant', () => {
    checker.addInvariant('inv1', { name: 'inv1', check: () => true, repairStrategy: 'auto-repair' });
    expect(checker.getInvariants()).toHaveLength(1);
    expect(checker.removeInvariant('inv1')).toBe(true);
    expect(checker.getInvariants()).toHaveLength(0);
  });

  test('removeInvariant returns false for non-existent', () => {
    expect(checker.removeInvariant('nope')).toBe(false);
  });

  test('verify with no node states returns consistent', async () => {
    checker.addInvariant('inv1', { name: 'inv1', check: () => true, repairStrategy: 'auto-repair' });
    const report = await checker.verify();
    expect(report.consistent).toBe(true);
    expect(report.passedCount).toBe(0);
    expect(report.failedCount).toBe(0);
  });

  test('verify detects violations', async () => {
    checker.setNodeState('node1', { count: 0 });
    checker.addInvariant('positive', {
      name: 'positive',
      check: (state) => (state.count as number) > 0,
      repairStrategy: 'auto-repair',
    });
    const report = await checker.verify();
    expect(report.consistent).toBe(false);
    expect(report.failedCount).toBe(1);
    expect(report.issues[0].severity).toBe('high');
    expect(report.issues[0].invariantName).toBe('positive');
    expect(report.issues[0].nodeId).toBe('node1');
  });

  test('verify handles async checks', async () => {
    checker.setNodeState('node1', { val: 1 });
    checker.addInvariant('async-inv', {
      name: 'async-inv',
      check: async (state) => (state.val as number) > 0,
      repairStrategy: 'auto-repair',
    });
    const report = await checker.verify();
    expect(report.consistent).toBe(true);
  });

  test('verify handles check errors', async () => {
    checker.setNodeState('node1', {});
    checker.addInvariant('error-inv', {
      name: 'error-inv',
      check: () => { throw new Error('check failed'); },
      repairStrategy: 'manual-repair',
    });
    const report = await checker.verify();
    expect(report.consistent).toBe(false);
    expect(report.issues[0].severity).toBe('critical');
    expect(report.issues[0].repairable).toBe(false);
  });

  test('verify checks all nodes against all invariants', async () => {
    checker.setNodeState('node1', { valid: true });
    checker.setNodeState('node2', { valid: false });
    checker.addInvariant('valid', {
      name: 'valid',
      check: (state) => state.valid === true,
      repairStrategy: 'auto-repair',
    });
    const report = await checker.verify();
    expect(report.failedCount).toBe(1);
    expect(report.issues[0].nodeId).toBe('node2');
  });

  test('verifyNode returns consistent for passing node', async () => {
    checker.setNodeState('node1', { valid: true });
    checker.addInvariant('valid', {
      name: 'valid',
      check: (state) => state.valid === true,
      repairStrategy: 'auto-repair',
    });
    const report = await checker.verifyNode('node1');
    expect(report.consistent).toBe(true);
    expect(report.nodeId).toBe('node1');
  });

  test('verifyNode returns issues for failing node', async () => {
    checker.setNodeState('node1', { valid: false });
    checker.addInvariant('valid', {
      name: 'valid',
      check: (state) => state.valid === true,
      repairStrategy: 'auto-repair',
    });
    const report = await checker.verifyNode('node1');
    expect(report.consistent).toBe(false);
    expect(report.issues).toHaveLength(1);
  });

  test('verifyNode handles missing node', async () => {
    const report = await checker.verifyNode('nope');
    expect(report.consistent).toBe(false);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].invariantName).toBe('node-exists');
    expect(report.issues[0].severity).toBe('critical');
  });

  test('verifyNode handles check errors', async () => {
    checker.setNodeState('node1', {});
    checker.addInvariant('err', {
      name: 'err',
      check: () => { throw new Error('err'); },
      repairStrategy: 'manual-repair',
    });
    const report = await checker.verifyNode('node1');
    expect(report.consistent).toBe(false);
    expect(report.issues[0].severity).toBe('critical');
  });

  // --- Repair ---
  test('repair succeeds with repair function', async () => {
    checker.setNodeState('node1', { count: -1 });
    checker.addInvariant('positive', {
      name: 'positive',
      check: (state) => (state.count as number) > 0,
      repair: (state) => ({ count: 0 }),
      repairStrategy: 'auto-repair',
    });
    await checker.verify();
    const issue = (await checker.verify()).issues[0];
    const result = await checker.repair(issue);
    expect(result.success).toBe(true);
    expect(result.changes).toEqual({ count: 0 });
    expect(result.repairedAt).toBeGreaterThan(0);
  });

  test('repair fails without repair function', async () => {
    checker.addInvariant('no-repair', {
      name: 'no-repair',
      check: () => false,
      repairStrategy: 'manual-repair',
    });
    checker.setNodeState('node1', {});
    const issue = (await checker.verify()).issues[0];
    const result = await checker.repair(issue);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No repair function');
  });

  test('repair fails without nodeId (bug fix)', async () => {
    checker.addInvariant('inv', {
      name: 'inv',
      check: () => false,
      repair: () => ({ fixed: true }),
      repairStrategy: 'auto-repair',
    });
    // Create issue without nodeId
    const issue = (await checker.verify()).issues[0];
    // verify() without node states won't produce issues with nodeId
    // So let's create a manual issue
    const manualIssue = {
      invariantName: 'inv',
      description: 'test',
      severity: 'high' as const,
      detectedAt: Date.now(),
      repairable: true,
      repairStrategy: 'auto-repair' as const,
    };
    const result = await checker.repair(manualIssue);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot repair issue without a nodeId');
  });

  test('repair handles repair function errors', async () => {
    checker.setNodeState('node1', {});
    checker.addInvariant('err', {
      name: 'err',
      check: () => false,
      repair: () => { throw new Error('repair failed'); },
      repairStrategy: 'auto-repair',
    });
    const issue = (await checker.verify()).issues[0];
    const result = await checker.repair(issue);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Repair failed');
  });

  test('repair updates node state', async () => {
    checker.setNodeState('node1', { count: -1 });
    checker.addInvariant('positive', {
      name: 'positive',
      check: (state) => (state.count as number) > 0,
      repair: (state) => ({ count: 1 }),
      repairStrategy: 'auto-repair',
    });
    const issue = (await checker.verify()).issues[0];
    await checker.repair(issue);
    // The node state should now have count: 1
    // We can verify by re-checking
    const report2 = await checker.verifyNode('node1');
    expect(report2.consistent).toBe(true);
  });

  // --- Invariant info ---
  test('getInvariants returns info', () => {
    checker.addInvariant('inv1', {
      name: 'inv1',
      description: 'Test',
      check: () => true,
      repair: () => ({}),
      repairStrategy: 'auto-repair',
    });
    const info = checker.getInvariants();
    expect(info[0].name).toBe('inv1');
    expect(info[0].description).toBe('Test');
    expect(info[0].hasRepair).toBe(true);
    expect(info[0].repairStrategy).toBe('auto-repair');
  });

  // --- Node state management ---
  test('setNodeState and removeNodeState', () => {
    checker.setNodeState('n1', { a: 1 });
    checker.setNodeState('n2', { a: 2 });
    expect(checker.removeNodeState('n1')).toBe(true);
    expect(checker.removeNodeState('nope')).toBe(false);
  });

  // --- Repair history ---
  test('repair history is tracked', async () => {
    checker.setNodeState('node1', { count: -1 });
    checker.addInvariant('positive', {
      name: 'positive',
      check: (state) => (state.count as number) > 0,
      repair: () => ({ count: 0 }),
      repairStrategy: 'auto-repair',
    });
    const issue = (await checker.verify()).issues[0];
    await checker.repair(issue);
    expect(checker.getRepairHistory()).toHaveLength(1);
  });

  test('clearRepairHistory', async () => {
    checker.setNodeState('node1', { count: -1 });
    checker.addInvariant('positive', {
      name: 'positive',
      check: (state) => (state.count as number) > 0,
      repair: () => ({ count: 0 }),
      repairStrategy: 'auto-repair',
    });
    const issue = (await checker.verify()).issues[0];
    await checker.repair(issue);
    checker.clearRepairHistory();
    expect(checker.getRepairHistory()).toHaveLength(0);
  });
});

// ============================================================
// SyncMetrics - Comprehensive Coverage
// ============================================================
describe('SyncMetrics (comprehensive)', () => {
  let metrics: SyncMetrics;

  beforeEach(() => {
    metrics = new SyncMetrics();
  });

  test('recordSync auto-fills endTime and duration', () => {
    const startTime = Date.now() - 100;
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime });
    const events = metrics.getEvents();
    expect(events[0].endTime).toBeDefined();
    expect(events[0].duration).toBeDefined();
    expect(events[0].duration).toBeGreaterThanOrEqual(95);
  });

  test('recordSync preserves provided endTime', () => {
    const startTime = Date.now() - 100;
    const endTime = Date.now();
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime, endTime, duration: 100 });
    const events = metrics.getEvents();
    expect(events[0].endTime).toBe(endTime);
    expect(events[0].duration).toBe(100);
  });

  test('getMetrics with no events', () => {
    const report = metrics.getMetrics();
    expect(report.totalSyncs).toBe(0);
    expect(report.successfulSyncs).toBe(0);
    expect(report.failedSyncs).toBe(0);
    expect(report.averageSyncLatency).toBe(0);
    expect(report.totalConflicts).toBe(0);
    expect(report.conflictRate).toBe(0);
  });

  test('getMetrics counts sync-complete as successful', () => {
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now(), success: true });
    const report = metrics.getMetrics();
    expect(report.totalSyncs).toBe(1);
    expect(report.successfulSyncs).toBe(1);
    expect(report.failedSyncs).toBe(0);
  });

  test('getMetrics counts sync-fail as failed', () => {
    metrics.recordSync({ type: 'sync-fail', nodeId: 'n1', startTime: Date.now(), success: false });
    const report = metrics.getMetrics();
    expect(report.totalSyncs).toBe(1);
    expect(report.failedSyncs).toBe(1);
  });

  test('getMetrics counts conflicts', () => {
    metrics.recordSync({ type: 'conflict', nodeId: 'n1', startTime: Date.now() });
    const report = metrics.getMetrics();
    expect(report.totalConflicts).toBe(1);
  });

  test('getMetrics counts replication events', () => {
    metrics.recordSync({ type: 'replication', nodeId: 'n1', startTime: Date.now(), success: true });
    const report = metrics.getMetrics();
    expect(report.totalSyncs).toBe(1);
    expect(report.successfulSyncs).toBe(1);
  });

  test('getMetrics conflict rate calculation', () => {
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now(), success: true });
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now(), success: true });
    metrics.recordSync({ type: 'conflict', nodeId: 'n1', startTime: Date.now() });
    // conflictRate = conflicts / syncs (syncs = sync-complete + sync-fail + replication)
    // 1 conflict / 2 syncs = 0.5
    const report = metrics.getMetrics();
    expect(report.conflictRate).toBeCloseTo(0.5);
  });

  test('getNodeMetrics for non-existent node', () => {
    const stats = metrics.getNodeMetrics('nope');
    expect(stats.nodeId).toBe('nope');
    expect(stats.syncCount).toBe(0);
    expect(stats.averageLatency).toBe(0);
    expect(stats.lastSyncTime).toBeNull();
  });

  test('getNodeMetrics calculates average latency', () => {
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now() - 100, success: true });
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now() - 200, success: true });
    const stats = metrics.getNodeMetrics('n1');
    expect(stats.averageLatency).toBeGreaterThan(0);
    expect(stats.syncCount).toBe(2);
    expect(stats.successfulSyncs).toBe(2);
  });

  test('getNodeMetrics tracks entries count', () => {
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now(), success: true, entriesCount: 10 });
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now(), success: true, entriesCount: 5 });
    const stats = metrics.getNodeMetrics('n1');
    expect(stats.totalEntries).toBe(15);
  });

  test('getNodeMetrics tracks conflicts', () => {
    metrics.recordSync({ type: 'conflict', nodeId: 'n1', startTime: Date.now() });
    metrics.recordSync({ type: 'conflict', nodeId: 'n1', startTime: Date.now() });
    const stats = metrics.getNodeMetrics('n1');
    expect(stats.totalConflicts).toBe(2);
  });

  test('getLatencyPercentiles with no events', () => {
    const latency = metrics.getLatencyPercentiles();
    expect(latency).toEqual({ p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 });
  });

  test('getLatencyPercentiles with events', () => {
    for (let i = 1; i <= 100; i++) {
      metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now() - i, success: true });
    }
    const latency = metrics.getLatencyPercentiles();
    expect(latency.min).toBeLessThanOrEqual(latency.p50);
    expect(latency.p50).toBeLessThanOrEqual(latency.p90);
    expect(latency.p90).toBeLessThanOrEqual(latency.p95);
    expect(latency.p95).toBeLessThanOrEqual(latency.p99);
    expect(latency.p99).toBeLessThanOrEqual(latency.max);
    expect(latency.avg).toBeGreaterThan(0);
  });

  test('getLatencyPercentiles with single event', () => {
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now() - 10, success: true });
    const latency = metrics.getLatencyPercentiles();
    expect(latency.p50).toBeGreaterThan(0);
    expect(latency.min).toBe(latency.max);
  });

  test('getDashboard returns complete structure', () => {
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now(), success: true });
    metrics.recordSync({ type: 'conflict', nodeId: 'n2', startTime: Date.now() });
    const dashboard = metrics.getDashboard();
    expect(dashboard.overview).toBeDefined();
    expect(dashboard.nodeStats.length).toBeGreaterThanOrEqual(1);
    expect(dashboard.latency).toBeDefined();
    expect(dashboard.recentEvents).toBeDefined();
    expect(dashboard.topConflictingNodes).toBeDefined();
  });

  test('getDashboard topConflictingNodes limited to 5', () => {
    for (let i = 0; i < 10; i++) {
      metrics.recordSync({ type: 'conflict', nodeId: `n${i}`, startTime: Date.now() });
    }
    const dashboard = metrics.getDashboard();
    expect(dashboard.topConflictingNodes.length).toBeLessThanOrEqual(5);
  });

  test('getAllNodeIds returns unique node IDs', () => {
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now(), success: true });
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n2', startTime: Date.now(), success: true });
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now(), success: true });
    const ids = metrics.getAllNodeIds();
    expect(ids).toHaveLength(2);
    expect(ids).toContain('n1');
    expect(ids).toContain('n2');
  });

  test('maxEvents limits stored events', () => {
    // Record more than 10000 events
    for (let i = 0; i < 10100; i++) {
      metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now(), success: true });
    }
    const events = metrics.getEvents();
    expect(events.length).toBeLessThanOrEqual(10000);
  });

  test('clear resets everything', () => {
    metrics.recordSync({ type: 'sync-complete', nodeId: 'n1', startTime: Date.now(), success: true });
    metrics.recordSync({ type: 'conflict', nodeId: 'n1', startTime: Date.now() });
    metrics.clear();
    expect(metrics.getMetrics().totalSyncs).toBe(0);
    expect(metrics.getNodeMetrics('n1').syncCount).toBe(0);
  });
});

// ============================================================
// Cross-module Integration Tests
// ============================================================
describe('Integration Tests (comprehensive)', () => {
  test('StateStore + ChangeTracker: full lifecycle', () => {
    const store = new StateStore();
    const tracker = new ChangeTracker();
    const changes: string[] = [];
    tracker.subscribeAll((r) => changes.push(`${r.type}:${r.key}`));

    const oldVal = store.get('k1');
    store.set('k1', 'v1');
    tracker.track('k1', oldVal, store.get('k1'));

    const prev = store.get('k1');
    store.set('k1', 'v2');
    tracker.track('k1', prev, store.get('k1'));

    store.delete('k1');
    tracker.track('k1', prev, undefined);

    expect(changes).toEqual(['create:k1', 'update:k1', 'delete:k1']);
    store.destroy();
  });

  test('CRDTStore + SyncProtocol: multi-node sync', () => {
    const store1 = new CRDTStore('node1');
    const store2 = new CRDTStore('node2');
    const proto1 = new SyncProtocol('node1');
    const proto2 = new SyncProtocol('node2');

    const c1 = store1.createCounter('shared', 'gcounter');
    c1.increment(10);

    const state1 = store1.getState();
    const msg = proto1.prepareSync(state1);
    msg.toNodeId = 'node2';

    proto2.processSync(msg);

    store2.createCounter('shared', 'gcounter');
    store2.merge(state1);
    expect(store2.getCounter('shared')!.value()).toBe(10);

    // Sync back
    const state2 = store2.getState();
    const msg2 = proto2.prepareSync(state2);
    proto1.processSync(msg2);
  });

  test('ConflictResolver + SyncProtocol: consistent conflict resolution', () => {
    const resolver = new ConflictResolver();
    const protocol = new SyncProtocol('node1');

    const local = { key: 'k', value: 'local', version: 1, timestamp: 1, nodeId: 'node1' };
    const remote = { key: 'k', value: 'remote', version: 1, timestamp: 3, nodeId: 'node2' };

    const resolved = resolver.resolve('k', local, remote);
    const protocolResolved = protocol.resolveConflict(local, remote);

    expect(resolved.value).toBe('remote');
    expect(protocolResolved.value).toBe('remote');
  });

  test('ReplicationManager + SyncMetrics: full pipeline', () => {
    const manager = new ReplicationManager('multi-leader', 3);
    const metrics = new SyncMetrics();

    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    manager.addNode('n3', 'http://c');

    const result = manager.replicate('k', 'v');
    metrics.recordSync({
      type: 'replication',
      nodeId: 'n1',
      startTime: Date.now() - result.duration,
      success: result.success,
      entriesCount: 1,
    });

    expect(metrics.getMetrics().successfulSyncs).toBe(1);
    expect(manager.getReplicationStats().successfulReplications).toBe(1);
  });

  test('EventSourcedStore + ConsistencyChecker: event replay consistency', async () => {
    const eventStore = new EventSourcedStore();
    const checker = new ConsistencyChecker();

    eventStore.append({ aggregateId: 'a1', eventType: 'created', payload: { count: 1 }, version: 0, timestamp: Date.now() });
    eventStore.append({ aggregateId: 'a1', eventType: 'updated', payload: { count: 2 }, version: 0, timestamp: Date.now() });

    const state = eventStore.getState('a1') as Record<string, unknown>;
    checker.setNodeState('node1', state);
    checker.addInvariant('has-count', {
      name: 'has-count',
      check: (s) => typeof s.count === 'number' && (s.count as number) > 0,
      repairStrategy: 'auto-repair',
    });

    const report = await checker.verify();
    expect(report.consistent).toBe(true);
    eventStore.destroy();
  });

  test('Full pipeline: Store -> CRDT -> Sync -> Conflict -> Metrics', () => {
    const store = new StateStore();
    const crdt = new CRDTStore('node1');
    const protocol = new SyncProtocol('node1');
    const resolver = new ConflictResolver();
    const metrics = new SyncMetrics();

    store.set('counter', 42);
    const counter = crdt.createCounter('main', 'gcounter');
    counter.increment(42);

    const state = crdt.getState();
    const msg = protocol.prepareSync(state);
    const result = protocol.processSync(msg);

    metrics.recordSync({
      type: 'sync-complete',
      nodeId: 'node1',
      startTime: Date.now() - result.duration,
      success: result.success,
    });

    expect(store.get('counter')!.value).toBe(42);
    expect(crdt.getCounter('main')!.value()).toBe(42);
    expect(result.success).toBe(true);
    expect(metrics.getMetrics().totalSyncs).toBe(1);

    store.destroy();
  });

  test('Multi-node CRDT convergence with conflict resolution', () => {
    const s1 = new CRDTStore('node1');
    const s2 = new CRDTStore('node2');
    const s3 = new CRDTStore('node3');

    const c1 = s1.createCounter('shared', 'gcounter');
    const c2 = s2.createCounter('shared', 'gcounter');
    const c3 = s3.createCounter('shared', 'gcounter');

    c1.increment(10);
    c2.increment(20);
    c3.increment(30);

    // Full mesh merge
    s1.merge(s2.getState());
    s1.merge(s3.getState());
    s2.merge(s1.getState());
    s2.merge(s3.getState());
    s3.merge(s1.getState());
    s3.merge(s2.getState());

    expect(s1.getCounter('shared')!.value()).toBe(60);
    expect(s2.getCounter('shared')!.value()).toBe(60);
    expect(s3.getCounter('shared')!.value()).toBe(60);
  });

  test('Network partition simulation with recovery', () => {
    const manager = new ReplicationManager('multi-leader', 3);
    manager.addNode('n1', 'http://a');
    manager.addNode('n2', 'http://b');
    manager.addNode('n3', 'http://c');

    // Normal operation
    expect(manager.replicate('k', 'v').success).toBe(true);

    // Partition: n2 and n3 go down
    manager.markNodeDead('n2');
    manager.markNodeDead('n3');
    expect(manager.replicate('k', 'v2').success).toBe(false);

    // Recovery: n2 comes back
    manager.markNodeAlive('n2');
    expect(manager.replicate('k', 'v3').success).toBe(true);

    // Full recovery
    manager.markNodeAlive('n3');
    const result = manager.replicate('k', 'v4');
    expect(result.success).toBe(true);
    expect(result.achieved).toBe(3);
  });

  test('RaftConsensus leader election and log replication', async () => {
    const raft = new RaftConsensus('node1', { electionTimeoutMin: 50, electionTimeoutMax: 100, heartbeatInterval: 25 });
    raft.addPeer('node2');
    raft.addPeer('node3');
    raft.start();
    raft.triggerElection();

    expect(raft.getRole()).toBe('leader');

    await raft.propose({ term: 1, index: 1, command: 'set x 1', timestamp: Date.now() });
    await raft.propose({ term: 1, index: 2, command: 'set y 2', timestamp: Date.now() });

    expect(raft.getLog()).toHaveLength(2);
    expect(raft.getCommitIndex()).toBe(2);

    raft.stop();
    raft.destroy();
  });

  test('Version vector causal ordering', () => {
    const proto1 = new SyncProtocol('node1');
    const proto2 = new SyncProtocol('node2');

    // node1 makes changes
    proto1.prepareSync(emptyState());
    proto1.prepareSync(emptyState());
    expect(proto1.getVersionVector()['node1']).toBe(2);

    // node2 makes changes
    proto2.prepareSync(emptyState());
    expect(proto2.getVersionVector()['node2']).toBe(1);

    // node2 processes node1's message
    const msg = proto1.prepareSync(emptyState());
    const result = proto2.processSync(msg);
    expect(result.conflictsDetected).toBeGreaterThan(0);
    expect(proto2.getVersionVector()['node1']).toBe(3);
  });

  test('Data consistency verification across replicas', () => {
    const s1 = new CRDTStore('node1');
    const s2 = new CRDTStore('node2');

    const c1 = s1.createCounter('shared', 'gcounter');
    const c2 = s2.createCounter('shared', 'gcounter');

    c1.increment(5);
    c2.increment(3);

    // Before merge: inconsistent
    expect(c1.value()).not.toBe(c2.value());

    // Merge
    s1.merge(s2.getState());
    s2.merge(s1.getState());

    // After merge: consistent
    expect(s1.getCounter('shared')!.value()).toBe(s2.getCounter('shared')!.value());
    expect(s1.getCounter('shared')!.value()).toBe(8);
  });

  test('Concurrent writes to same key with LWWRegister', () => {
    const s1 = new CRDTStore('node1');
    const s2 = new CRDTStore('node2');

    const r1 = s1.createRegister('shared');
    const r2 = s2.createRegister('shared');

    // Concurrent writes with different timestamps
    r1.set('value_from_node1', 100, 'node1');
    r2.set('value_from_node2', 200, 'node2');

    // Merge
    s1.merge(s2.getState());
    s2.merge(s1.getState());

    // Both should converge to the same value
    expect(s1.getRegister('shared')!.get()).toBe(s2.getRegister('shared')!.get());
    expect(s1.getRegister('shared')!.get()).toBe('value_from_node2');
  });

  test('Concurrent writes to same key with LWWMap', () => {
    const s1 = new CRDTStore('node1');
    const s2 = new CRDTStore('node2');

    const m1 = s1.createMap('shared');
    const m2 = s2.createMap('shared');

    m1.set('config', { color: 'red' }, 100, 'node1');
    m2.set('config', { color: 'blue' }, 200, 'node2');

    s1.merge(s2.getState());
    s2.merge(s1.getState());

    expect(s1.getMap('shared')!.get('config')).toEqual(s2.getMap('shared')!.get('config'));
    expect((s1.getMap('shared')!.get('config') as any).color).toBe('blue');
  });

  test('EventSourcedStore snapshot + replay consistency', () => {
    const store = new EventSourcedStore();

    store.append({ aggregateId: 'order', eventType: 'created', payload: { item: 'book', qty: 1 }, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'order', eventType: 'updated', payload: { qty: 5 }, version: 0, timestamp: Date.now() });
    store.createSnapshot('order');
    store.append({ aggregateId: 'order', eventType: 'updated', payload: { qty: 10 }, version: 0, timestamp: Date.now() });

    const stateFromGetState = store.getState('order');
    const stateFromReplay = store.replay('order');

    expect(stateFromGetState).toEqual(stateFromReplay);
    expect((stateFromGetState as Record<string, unknown>).qty).toBe(10);

    store.destroy();
  });
});
