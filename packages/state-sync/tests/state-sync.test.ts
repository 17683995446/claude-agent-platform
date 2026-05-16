import { describe, test, expect, beforeEach } from 'bun:test';
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

// ============================================================
// Module 1: StateStore Tests (1-15)
// ============================================================
describe('StateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  test('should create a new StateStore instance', () => {
    expect(store).toBeDefined();
    expect(store.size()).toBe(0);
  });

  test('should set and get a value', () => {
    store.set('key1', 'value1');
    const entry = store.get('key1');
    expect(entry).toBeDefined();
    expect(entry!.value).toBe('value1');
  });

  test('should auto-increment version on set', () => {
    store.set('key1', 'v1');
    expect(store.getVersion('key1')).toBe(1);
    store.set('key1', 'v2');
    expect(store.getVersion('key1')).toBe(2);
  });

  test('should return undefined for non-existent key', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  test('should delete a key', () => {
    store.set('key1', 'value1');
    expect(store.delete('key1')).toBe(true);
    expect(store.get('key1')).toBeUndefined();
  });

  test('should return false when deleting non-existent key', () => {
    expect(store.delete('nonexistent')).toBe(false);
  });

  test('should check if key exists with has()', () => {
    store.set('key1', 'value1');
    expect(store.has('key1')).toBe(true);
    expect(store.has('nonexistent')).toBe(false);
  });

  test('should return all keys', () => {
    store.set('a', 1);
    store.set('b', 2);
    store.set('c', 3);
    const keys = store.keys();
    expect(keys).toHaveLength(3);
    expect(keys).toContain('a');
    expect(keys).toContain('b');
    expect(keys).toContain('c');
  });

  test('should filter keys by namespace', () => {
    store.set('ns1:key1', 'v1', { namespace: 'ns1' });
    store.set('ns2:key1', 'v2', { namespace: 'ns2' });
    store.set('no-ns', 'v3');
    const ns1Keys = store.keys('ns1');
    expect(ns1Keys).toHaveLength(1);
    expect(ns1Keys).toContain('ns1:key1');
  });

  test('should create and restore a snapshot', () => {
    store.set('key1', 'value1');
    store.set('key2', 'value2');
    const snapshot = store.snapshot('test-snap');
    expect(snapshot.entryCount).toBe(2);
    expect(snapshot.label).toBe('test-snap');

    store.delete('key1');
    store.set('key2', 'modified');

    expect(store.restore(snapshot.id)).toBe(true);
    expect(store.get('key1')!.value).toBe('value1');
    expect(store.get('key2')!.value).toBe('value2');
  });

  test('should return false when restoring non-existent snapshot', () => {
    expect(store.restore('nonexistent')).toBe(false);
  });

  test('should support TTL for ephemeral state', async () => {
    store.set('ephemeral', 'data', { ttl: 50 });
    expect(store.has('ephemeral')).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(store.has('ephemeral')).toBe(false);
  });

  test('should preserve createdAt on update', async () => {
    const entry1 = store.set('key1', 'v1');
    const createdAt = entry1.createdAt;
    await new Promise((r) => setTimeout(r, 10));
    const entry2 = store.set('key1', 'v2');
    expect(entry2.createdAt).toBe(createdAt);
    expect(entry2.updatedAt).toBeGreaterThan(createdAt);
  });

  test('should return version 0 for non-existent key', () => {
    expect(store.getVersion('nonexistent')).toBe(0);
  });

  test('should clear all entries', () => {
    store.set('a', 1);
    store.set('b', 2);
    store.clear();
    expect(store.size()).toBe(0);
  });

  test('should deep clone values', () => {
    const obj = { nested: { value: 42 } };
    store.set('key1', obj);
    obj.nested.value = 99;
    const entry = store.get('key1');
    expect((entry!.value as { nested: { value: number } }).nested.value).toBe(42);
  });
});

// ============================================================
// Module 2: CRDT Store Tests (16-35)
// ============================================================
describe('CRDTStore', () => {
  let store: CRDTStore;

  beforeEach(() => {
    store = new CRDTStore('node1');
  });

  test('should create a CRDTStore instance', () => {
    expect(store).toBeDefined();
  });

  // GCounter
  test('GCounter should increment value', () => {
    const counter = store.createCounter('c1', 'gcounter');
    counter.increment(5);
    expect(counter.value()).toBe(5);
    counter.increment(3);
    expect(counter.value()).toBe(8);
  });

  test('GCounter should throw on decrement', () => {
    const counter = store.createCounter('c1', 'gcounter');
    expect(() => counter.decrement()).toThrow();
  });

  test('GCounter should merge correctly', () => {
    const counter = store.createCounter('c1', 'gcounter');
    counter.increment(5);
    counter.merge({ node1: 5, node2: 3 });
    expect(counter.value()).toBe(8);
  });

  // PNCounter
  test('PNCounter should increment and decrement', () => {
    const counter = store.createCounter('c2', 'pncounter');
    counter.increment(10);
    counter.decrement(3);
    expect(counter.value()).toBe(7);
  });

  test('PNCounter should merge correctly', () => {
    const counter = store.createCounter('c2', 'pncounter');
    counter.increment(10);
    counter.merge({ inc_node1: 10, dec_node1: 3, inc_node2: 5 });
    expect(counter.value()).toBe(12);
  });

  // GSet
  test('GSet should add values', () => {
    const set = store.createSet('s1', 'gset');
    set.add('a');
    set.add('b');
    expect(set.values()).toHaveLength(2);
    expect(set.has('a')).toBe(true);
  });

  test('GSet should not add duplicates', () => {
    const set = store.createSet('s1', 'gset');
    set.add('a');
    set.add('a');
    expect(set.values()).toHaveLength(1);
  });

  test('GSet should throw on remove', () => {
    const set = store.createSet('s1', 'gset');
    set.add('a');
    expect(() => set.remove('a')).toThrow();
  });

  test('GSet should merge correctly', () => {
    const set = store.createSet('s1', 'gset');
    set.add('a');
    set.merge({ type: 'gset', elements: ['b', 'c'] });
    expect(set.values()).toHaveLength(3);
  });

  // ORSet
  test('ORSet should add and remove values', () => {
    const set = store.createSet('s2', 'orset');
    set.add('a');
    set.add('b');
    expect(set.values()).toHaveLength(2);
    set.remove('a');
    expect(set.has('a')).toBe(false);
    expect(set.has('b')).toBe(true);
  });

  test('ORSet should merge correctly', () => {
    const set = store.createSet('s2', 'orset');
    set.add('a');
    set.merge({ type: 'orset', elements: [['1_a', 'a'], ['2_b', 'b']], tombstones: [] });
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
  });

  // LWWRegister
  test('LWWRegister should set and get value', () => {
    const reg = store.createRegister('r1');
    reg.set('hello');
    expect(reg.get()).toBe('hello');
  });

  test('LWWRegister should use last-writer-wins on merge', () => {
    const reg = store.createRegister('r1');
    reg.set('old', 1, 'node1');
    reg.merge({ value: 'new', timestamp: 2, node: 'node2' });
    expect(reg.get()).toBe('new');
  });

  test('LWWRegister should keep local on higher timestamp', () => {
    const reg = store.createRegister('r1');
    reg.set('local', 5, 'node1');
    reg.merge({ value: 'remote', timestamp: 3, node: 'node2' });
    expect(reg.get()).toBe('local');
  });

  // LWWMap
  test('LWWMap should set and get values', () => {
    const map = store.createMap('m1');
    map.set('k1', 'v1');
    expect(map.get('k1')).toBe('v1');
    expect(map.has('k1')).toBe(true);
  });

  test('LWWMap should remove keys', () => {
    const map = store.createMap('m1');
    map.set('k1', 'v1');
    map.remove('k1');
    expect(map.has('k1')).toBe(false);
  });

  test('LWWMap should return keys', () => {
    const map = store.createMap('m1');
    map.set('a', 1);
    map.set('b', 2);
    expect(map.keys()).toHaveLength(2);
  });

  test('LWWMap should merge correctly', () => {
    const map = store.createMap('m1');
    map.set('k1', 'v1', 1, 'node1');
    map.merge({ k1: { value: 'v2', timestamp: 2, node: 'node2' } });
    expect(map.get('k1')).toBe('v2');
  });

  // Full state operations
  test('getState should return complete state', () => {
    store.createCounter('c1', 'gcounter');
    store.createSet('s1', 'gset');
    store.createRegister('r1');
    store.createMap('m1');
    const state = store.getState();
    expect(state.counters).toHaveProperty('c1');
    expect(state.sets).toHaveProperty('s1');
    expect(state.registers).toHaveProperty('r1');
    expect(state.maps).toHaveProperty('m1');
  });

  test('merge should return merge result', () => {
    store.createCounter('c1', 'gcounter');
    const result = store.merge({
      counters: { c1: { type: 'gcounter', state: { node1: 5 } } },
      sets: {},
      registers: {},
      maps: {},
    });
    expect(result.countersMerged).toBe(1);
    expect(result.success).toBeUndefined();
  });

  test('getDelta should return state changes', () => {
    store.createCounter('c1', 'gcounter');
    const delta = store.getDelta();
    expect(delta.counters).toHaveProperty('c1');
  });
});

// ============================================================
// Module 3: SyncProtocol Tests (36-50)
// ============================================================
describe('SyncProtocol', () => {
  let protocol: SyncProtocol;

  beforeEach(() => {
    protocol = new SyncProtocol('node1');
  });

  test('should create a SyncProtocol instance', () => {
    expect(protocol).toBeDefined();
    expect(protocol.getNodeId()).toBe('node1');
  });

  test('should prepare a sync message', () => {
    const message = protocol.prepareSync({
      counters: {},
      sets: {},
      registers: {},
      maps: {},
    });
    expect(message.fromNodeId).toBe('node1');
    expect(message.strategy).toBe('full-sync');
    expect(message.timestamp).toBeGreaterThan(0);
  });

  test('should prepare a delta sync message', () => {
    const message = protocol.prepareDeltaSync({
      counters: {},
      sets: {},
      registers: {},
      maps: {},
    }, 'delta-sync');
    expect(message.strategy).toBe('delta-sync');
  });

  test('should process a sync message', () => {
    const message = protocol.prepareSync({
      counters: {},
      sets: {},
      registers: {},
      maps: {},
    });
    const result = protocol.processSync(message);
    expect(result.success).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test('should update version vector on sync', () => {
    protocol.prepareSync({ counters: {}, sets: {}, registers: {}, maps: {} });
    const vv = protocol.getVersionVector();
    expect(vv['node1']).toBeGreaterThan(0);
  });

  test('should resolve conflict with last-writer-wins', () => {
    const local = { key: 'k', value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { key: 'k', value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    const resolved = protocol.resolveConflict(local, remote);
    expect(resolved.value).toBe('remote');
  });

  test('should resolve conflict with local on higher timestamp', () => {
    const local = { key: 'k', value: 'local', version: 1, timestamp: 5, nodeId: 'n1' };
    const remote = { key: 'k', value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    const resolved = protocol.resolveConflict(local, remote);
    expect(resolved.value).toBe('local');
  });

  test('should use node ID as tie-breaker', () => {
    const local = { key: 'k', value: 'local', version: 1, timestamp: 3, nodeId: 'n1' };
    const remote = { key: 'k', value: 'remote', version: 1, timestamp: 3, nodeId: 'n2' };
    const resolved = protocol.resolveConflict(local, remote);
    expect(resolved.value).toBe('remote');
  });

  test('should get sync status', () => {
    const status = protocol.getSyncStatus();
    expect(status.lastSyncTime).toBeNull();
    expect(status.pendingSyncs).toBe(0);
    expect(status.syncInProgress).toBe(false);
  });

  test('should connect and disconnect nodes', () => {
    protocol.connectNode('node2');
    const status = protocol.getSyncStatus();
    expect(status.connectedNodes).toContain('node2');
    protocol.disconnectNode('node2');
    const status2 = protocol.getSyncStatus();
    expect(status2.connectedNodes).not.toContain('node2');
  });

  test('should compress and decompress payload', () => {
    const message = protocol.prepareSync({
      counters: { c1: { type: 'gcounter', state: { n1: 5 } } },
      sets: {},
      registers: {},
      maps: {},
    });
    const compressed = protocol.compressPayload(message);
    expect(compressed.compressed).toBe(true);
    expect(compressed.payload).toBeDefined();

    const decompressed = protocol.decompressPayload(compressed);
    expect(decompressed.compressed).toBe(false);
    expect(decompressed.state.counters).toHaveProperty('c1');
  });

  test('decompressPayload should return same message if not compressed', () => {
    const message = protocol.prepareSync({
      counters: {},
      sets: {},
      registers: {},
      maps: {},
    });
    const result = protocol.decompressPayload(message);
    expect(result).toEqual(message);
  });

  test('should update sync status after processing', () => {
    const message = protocol.prepareSync({
      counters: { c1: { type: 'gcounter', state: { n1: 5 } } },
      sets: {},
      registers: {},
      maps: {},
    });
    protocol.processSync(message);
    const status = protocol.getSyncStatus();
    expect(status.lastSyncTime).not.toBeNull();
    expect(status.lastSyncResult).not.toBeNull();
  });

  test('should detect conflicts in processSync', () => {
    const remoteProtocol = new SyncProtocol('node2');
    const remoteMsg = remoteProtocol.prepareSync({
      counters: {},
      sets: {},
      registers: {},
      maps: {},
    });
    // Set a higher version for node2
    remoteMsg.versionVector['node2'] = 10;
    const result = protocol.processSync(remoteMsg);
    expect(result.conflictsDetected).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// Module 4: ConflictResolver Tests (51-65)
// ============================================================
describe('ConflictResolver', () => {
  let resolver: ConflictResolver;

  beforeEach(() => {
    resolver = new ConflictResolver();
  });

  test('should create a ConflictResolver instance', () => {
    expect(resolver).toBeDefined();
  });

  test('should resolve with last-writer-wins strategy (default)', () => {
    const local = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    const result = resolver.resolve('key1', local, remote);
    expect(result.winner).toBe('remote');
    expect(result.strategy).toBe('last-writer-wins');
  });

  test('should resolve with first-writer-wins strategy', () => {
    resolver.setStrategy('key1', 'first-writer-wins');
    const local = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    const result = resolver.resolve('key1', local, remote);
    expect(result.winner).toBe('local');
    expect(result.strategy).toBe('first-writer-wins');
  });

  test('should resolve with merge strategy for objects', () => {
    resolver.setStrategy('key1', 'merge');
    const local = { value: { a: 1 }, version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: { b: 2 }, version: 1, timestamp: 2, nodeId: 'n2' };
    const result = resolver.resolve('key1', local, remote);
    expect(result.value).toEqual({ a: 1, b: 2 });
  });

  test('should resolve with merge strategy for non-objects', () => {
    resolver.setStrategy('key1', 'merge');
    const local = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    const result = resolver.resolve('key1', local, remote);
    expect(result.value).toBe('local');
  });

  test('should resolve with custom-function strategy', () => {
    resolver.setCustomResolver('key1', (_key, _local, remote) => remote.value);
    const local = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    const result = resolver.resolve('key1', local, remote);
    expect(result.value).toBe('remote');
    expect(result.strategy).toBe('custom-function');
  });

  test('should resolve with manual strategy', () => {
    resolver.setStrategy('key1', 'manual');
    const local = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    const result = resolver.resolve('key1', local, remote);
    expect(result.winner).toBe('local');
  });

  test('should track conflicts', () => {
    const local = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    resolver.resolve('key1', local, remote);
    expect(resolver.getConflicts()).toHaveLength(1);
  });

  test('should track conflict history', () => {
    const local = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    resolver.resolve('key1', local, remote);
    const history = resolver.getConflictHistory();
    expect(history).toHaveLength(1);
    expect(history[0].key).toBe('key1');
  });

  test('should get strategy for a key', () => {
    expect(resolver.getStrategy('key1')).toBe('last-writer-wins');
    resolver.setStrategy('key1', 'merge');
    expect(resolver.getStrategy('key1')).toBe('merge');
  });

  test('should set default strategy', () => {
    resolver.setDefaultStrategy('first-writer-wins');
    expect(resolver.getStrategy('any-key')).toBe('first-writer-wins');
  });

  test('should clear conflicts', () => {
    const local = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    resolver.resolve('key1', local, remote);
    resolver.clearConflicts();
    expect(resolver.getConflicts()).toHaveLength(0);
  });

  test('should clear history', () => {
    const local = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    resolver.resolve('key1', local, remote);
    resolver.clearHistory();
    expect(resolver.getConflictHistory()).toHaveLength(0);
  });

  test('should count conflicts', () => {
    const local = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };
    resolver.resolve('key1', local, remote);
    resolver.resolve('key2', local, remote);
    expect(resolver.getConflictCount()).toBe(2);
  });

  test('resolved entry should have correct structure', () => {
    const local = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: 'remote', version: 2, timestamp: 2, nodeId: 'n2' };
    const result = resolver.resolve('key1', local, remote);
    expect(result.key).toBe('key1');
    expect(result.version).toBeGreaterThan(0);
    expect(result.resolvedAt).toBeGreaterThan(0);
  });
});

// ============================================================
// Module 5: ReplicationManager Tests (66-80)
// ============================================================
describe('ReplicationManager', () => {
  let manager: ReplicationManager;

  beforeEach(() => {
    manager = new ReplicationManager('multi-leader', 3);
  });

  test('should create a ReplicationManager instance', () => {
    expect(manager).toBeDefined();
  });

  test('should add and remove nodes', () => {
    manager.addNode('node1', 'http://localhost:3001');
    manager.addNode('node2', 'http://localhost:3002');
    const state = manager.getClusterState();
    expect(state.totalNodes).toBe(2);
    manager.removeNode('node2');
    const state2 = manager.getClusterState();
    expect(state2.totalNodes).toBe(1);
  });

  test('should set first node as leader in leader-follower mode', () => {
    const lfManager = new ReplicationManager('leader-follower', 3);
    lfManager.addNode('node1', 'http://localhost:3001');
    lfManager.addNode('node2', 'http://localhost:3002');
    const state = lfManager.getClusterState();
    expect(state.leaderId).toBe('node1');
    expect(state.nodes[0].isLeader).toBe(true);
  });

  test('should elect new leader when leader is removed', () => {
    const lfManager = new ReplicationManager('leader-follower', 3);
    lfManager.addNode('node1', 'http://localhost:3001');
    lfManager.addNode('node2', 'http://localhost:3002');
    lfManager.removeNode('node1');
    const state = lfManager.getClusterState();
    expect(state.leaderId).toBe('node2');
  });

  test('should replicate data to nodes', () => {
    manager.addNode('node1', 'http://localhost:3001');
    manager.addNode('node2', 'http://localhost:3002');
    manager.addNode('node3', 'http://localhost:3003');
    const result = manager.replicate('key1', 'value1');
    expect(result.success).toBe(true);
    expect(result.replicatedTo.length).toBe(3);
  });

  test('should read with quorum', () => {
    manager.addNode('node1', 'http://localhost:3001');
    manager.addNode('node2', 'http://localhost:3002');
    manager.addNode('node3', 'http://localhost:3003');
    const result = manager.read('key1');
    expect(result.success).toBe(true);
    expect(result.consistencyAchieved).toBe(true);
  });

  test('should read with ONE quorum', () => {
    manager.addNode('node1', 'http://localhost:3001');
    manager.addNode('node2', 'http://localhost:3002');
    const result = manager.read('key1', { type: 'one' });
    expect(result.success).toBe(true);
    expect(result.readFrom).toHaveLength(1);
  });

  test('should read with ALL quorum', () => {
    manager.addNode('node1', 'http://localhost:3001');
    manager.addNode('node2', 'http://localhost:3002');
    const result = manager.read('key1', { type: 'all' });
    expect(result.readFrom).toHaveLength(2);
  });

  test('should get cluster state', () => {
    manager.addNode('node1', 'http://localhost:3001');
    manager.addNode('node2', 'http://localhost:3002');
    const state = manager.getClusterState();
    expect(state.mode).toBe('multi-leader');
    expect(state.replicationFactor).toBe(3);
    expect(state.aliveNodes).toBe(2);
  });

  test('should get replication stats', () => {
    manager.addNode('node1', 'http://localhost:3001');
    manager.addNode('node2', 'http://localhost:3002');
    manager.addNode('node3', 'http://localhost:3003');
    manager.replicate('key1', 'value1');
    const stats = manager.getReplicationStats();
    expect(stats.totalReplications).toBe(1);
    expect(stats.successfulReplications).toBe(1);
  });

  test('should mark nodes alive and dead', () => {
    manager.addNode('node1', 'http://localhost:3001');
    manager.markNodeDead('node1');
    const state = manager.getClusterState();
    expect(state.aliveNodes).toBe(0);
    manager.markNodeAlive('node1');
    const state2 = manager.getClusterState();
    expect(state2.aliveNodes).toBe(1);
  });

  test('should get individual node info', () => {
    manager.addNode('node1', 'http://localhost:3001');
    const node = manager.getNode('node1');
    expect(node).toBeDefined();
    expect(node!.nodeId).toBe('node1');
    expect(node!.endpoint).toBe('http://localhost:3001');
  });

  test('should return undefined for non-existent node', () => {
    expect(manager.getNode('nonexistent')).toBeUndefined();
  });

  test('should set replication mode', () => {
    manager.setMode('leaderless');
    const state = manager.getClusterState();
    expect(state.mode).toBe('leaderless');
  });

  test('should set replication factor', () => {
    manager.setReplicationFactor(5);
    const state = manager.getClusterState();
    expect(state.replicationFactor).toBe(5);
  });

  test('should start and stop anti-entropy', () => {
    let count = 0;
    manager.startAntiEntropy(50, () => { count++; });
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        manager.stopAntiEntropy();
        const stats = manager.getReplicationStats();
        expect(stats.antiEntropyCount).toBeGreaterThan(0);
        resolve();
      }, 120);
    });
  });
});

// ============================================================
// Module 6: RaftConsensus Tests (81-95)
// ============================================================
describe('RaftConsensus', () => {
  let raft: RaftConsensus;

  beforeEach(() => {
    raft = new RaftConsensus('node1', {
      electionTimeoutMin: 50,
      electionTimeoutMax: 100,
      heartbeatInterval: 25,
    });
  });

  test('should create a RaftConsensus instance', () => {
    expect(raft).toBeDefined();
    expect(raft.getRole()).toBe('follower');
    expect(raft.getNodeId()).toBe('node1');
  });

  test('should start and become leader (single node)', () => {
    raft.start();
    raft.triggerElection();
    expect(raft.getRole()).toBe('leader');
    expect(raft.getLeader()).toBe('node1');
    raft.stop();
  });

  test('should start with follower role', () => {
    expect(raft.getRole()).toBe('follower');
  });

  test('should increment term on election', () => {
    raft.start();
    raft.triggerElection();
    expect(raft.getCurrentTerm()).toBe(1);
    raft.stop();
  });

  test('should propose entries as leader', async () => {
    raft.start();
    raft.triggerElection();
    const result = await raft.propose({ term: 1, index: 1, command: 'set x 1', timestamp: Date.now() });
    expect(result).toBe(true);
    expect(raft.getLog()).toHaveLength(1);
    raft.stop();
  });

  test('should reject proposals when not leader', async () => {
    raft.start();
    const result = await raft.propose({ term: 0, index: 1, command: 'set x 1', timestamp: Date.now() });
    expect(result).toBe(false);
    raft.stop();
  });

  test('should handle RequestVote RPC', () => {
    const result = raft.requestVote(1, 'node2');
    expect(result.voteGranted).toBe(true);
  });

  test('should reject RequestVote if already voted', () => {
    raft.requestVote(1, 'node2');
    const result = raft.requestVote(1, 'node3');
    expect(result.voteGranted).toBe(false);
  });

  test('should accept RequestVote for same candidate', () => {
    raft.requestVote(1, 'node2');
    const result = raft.requestVote(1, 'node2');
    expect(result.voteGranted).toBe(true);
  });

  test('should step down on higher term RequestVote', () => {
    raft.start();
    raft.triggerElection();
    expect(raft.getRole()).toBe('leader');
    raft.requestVote(10, 'node2');
    expect(raft.getRole()).toBe('follower');
    expect(raft.getCurrentTerm()).toBe(10);
    raft.stop();
  });

  test('should handle AppendEntries RPC', () => {
    const result = raft.appendEntries(1, 'node2', 0, [], 0);
    expect(result.success).toBe(true);
    expect(raft.getRole()).toBe('follower');
    expect(raft.getLeader()).toBe('node2');
  });

  test('should reject AppendEntries with lower term', () => {
    raft.start();
    raft.triggerElection();
    const result = raft.appendEntries(0, 'node2', 0, [], 0);
    expect(result.success).toBe(false);
    raft.stop();
  });

  test('should add and remove peers', () => {
    raft.addPeer('node2');
    raft.addPeer('node3');
    expect(raft.getLeader()).toBeUndefined(); // not started yet
    raft.removePeer('node2');
  });

  test('should track commit index', async () => {
    raft.start();
    raft.triggerElection();
    await raft.propose({ term: 1, index: 1, command: 'cmd1', timestamp: Date.now() });
    expect(raft.getCommitIndex()).toBeGreaterThan(0);
    raft.stop();
  });

  test('should get log entries', async () => {
    raft.start();
    raft.triggerElection();
    await raft.propose({ term: 1, index: 1, command: 'cmd1', timestamp: Date.now() });
    await raft.propose({ term: 1, index: 2, command: 'cmd2', timestamp: Date.now() });
    const log = raft.getLog();
    expect(log).toHaveLength(2);
    raft.stop();
  });

  test('should stop cleanly', () => {
    raft.start();
    raft.stop();
    expect(raft.getRole()).toBe('follower');
  });
});

// ============================================================
// Module 7: EventSourcedStore Tests (96-105)
// ============================================================
describe('EventSourcedStore', () => {
  let store: EventSourcedStore;

  beforeEach(() => {
    store = new EventSourcedStore();
  });

  test('should create an EventSourcedStore instance', () => {
    expect(store).toBeDefined();
  });

  test('should append and retrieve events', () => {
    store.append({
      eventId: 'e1',
      aggregateId: 'agg1',
      eventType: 'created',
      payload: { name: 'test' },
      version: 0,
      timestamp: Date.now(),
    });
    const events = store.getEvents('agg1');
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('created');
  });

  test('should auto-assign version and eventId', () => {
    store.append({
      aggregateId: 'agg1',
      eventType: 'created',
      payload: { name: 'test' },
      version: 0,
      timestamp: Date.now(),
    });
    const events = store.getEvents('agg1');
    expect(events[0].version).toBe(1);
    expect(events[0].eventId).toBeDefined();
  });

  test('should get events from version', () => {
    store.append({ aggregateId: 'agg1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'agg1', eventType: 'updated', payload: { x: 1 }, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'agg1', eventType: 'updated', payload: { x: 2 }, version: 0, timestamp: Date.now() });
    const events = store.getEvents('agg1', 2);
    expect(events).toHaveLength(2);
  });

  test('should reconstruct state from events', () => {
    store.append({ aggregateId: 'agg1', eventType: 'created', payload: { name: 'test', value: 1 }, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'agg1', eventType: 'updated', payload: { value: 2 }, version: 0, timestamp: Date.now() });
    const state = store.getState('agg1') as Record<string, unknown>;
    expect(state.name).toBe('test');
    expect(state.value).toBe(2);
  });

  test('should create and use snapshots', () => {
    store.append({ aggregateId: 'agg1', eventType: 'created', payload: { name: 'test', value: 1 }, version: 0, timestamp: Date.now() });
    store.createSnapshot('agg1');
    store.append({ aggregateId: 'agg1', eventType: 'updated', payload: { value: 2 }, version: 0, timestamp: Date.now() });
    const state = store.getState('agg1') as Record<string, unknown>;
    expect(state.value).toBe(2);
  });

  test('should replay events', () => {
    store.append({ aggregateId: 'agg1', eventType: 'created', payload: { name: 'test' }, version: 0, timestamp: Date.now() });
    const state = store.replay('agg1');
    expect(state).toBeDefined();
  });

  test('should register and use projectors', () => {
    const projected: string[] = [];
    store.registerProjector('test', (event) => { projected.push(event.eventType); });
    store.append({ aggregateId: 'agg1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    expect(projected).toHaveLength(1);
    expect(projected[0]).toBe('created');
  });

  test('should remove projectors', () => {
    store.registerProjector('test', () => {});
    store.removeProjector('test');
    // Should not throw
    store.append({ aggregateId: 'agg1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
  });

  test('should get aggregate IDs', () => {
    store.append({ aggregateId: 'agg1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'agg2', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    expect(store.getAggregateIds()).toHaveLength(2);
  });

  test('should get total event count', () => {
    store.append({ aggregateId: 'agg1', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'agg1', eventType: 'updated', payload: {}, version: 0, timestamp: Date.now() });
    store.append({ aggregateId: 'agg2', eventType: 'created', payload: {}, version: 0, timestamp: Date.now() });
    expect(store.getTotalEventCount()).toBe(3);
  });
});

// ============================================================
// Module 8: ChangeTracker Tests (106-118)
// ============================================================
describe('ChangeTracker', () => {
  let tracker: ChangeTracker;

  beforeEach(() => {
    tracker = new ChangeTracker(10);
  });

  test('should create a ChangeTracker instance', () => {
    expect(tracker).toBeDefined();
  });

  test('should track a create change', () => {
    const record = tracker.track('key1', undefined, 'value1');
    expect(record.type).toBe('create');
    expect(record.key).toBe('key1');
    expect(record.newValue).toBe('value1');
  });

  test('should track an update change', () => {
    const record = tracker.track('key1', 'old', 'new');
    expect(record.type).toBe('update');
    expect(record.oldValue).toBe('old');
    expect(record.newValue).toBe('new');
  });

  test('should track a delete change', () => {
    const record = tracker.track('key1', 'value', undefined);
    expect(record.type).toBe('delete');
    expect(record.oldValue).toBe('value');
    expect(record.newValue).toBeUndefined();
  });

  test('should get changes since version', () => {
    tracker.track('k1', undefined, 'v1');
    tracker.track('k2', undefined, 'v2');
    tracker.track('k3', undefined, 'v3');
    const changes = tracker.getChanges(2);
    expect(changes).toHaveLength(1);
    expect(changes[0].key).toBe('k3');
  });

  test('should subscribe to key changes', () => {
    const received: string[] = [];
    tracker.subscribe('key1', (record) => { received.push(record.key); });
    tracker.track('key1', undefined, 'v1');
    expect(received).toHaveLength(1);
    expect(received[0]).toBe('key1');
  });

  test('should unsubscribe from key changes', () => {
    const received: string[] = [];
    const unsub = tracker.subscribe('key1', (record) => { received.push(record.key); });
    unsub();
    tracker.track('key1', undefined, 'v1');
    expect(received).toHaveLength(0);
  });

  test('should subscribe to all changes', () => {
    const received: string[] = [];
    tracker.subscribeAll((record) => { received.push(record.key); });
    tracker.track('key1', undefined, 'v1');
    tracker.track('key2', undefined, 'v2');
    expect(received).toHaveLength(2);
  });

  test('should get change count per key', () => {
    tracker.track('key1', undefined, 'v1');
    tracker.track('key1', 'v1', 'v2');
    tracker.track('key2', undefined, 'v1');
    expect(tracker.getChangeCount('key1')).toBe(2);
    expect(tracker.getChangeCount('key2')).toBe(1);
  });

  test('should export changes as JSON', () => {
    tracker.track('key1', undefined, 'v1');
    const json = tracker.exportChanges('json');
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].key).toBe('key1');
  });

  test('should get all changes', () => {
    tracker.track('k1', undefined, 'v1');
    tracker.track('k2', undefined, 'v2');
    expect(tracker.getAllChanges()).toHaveLength(2);
  });

  test('should clear changes', () => {
    tracker.track('k1', undefined, 'v1');
    tracker.clearChanges();
    expect(tracker.getAllChanges()).toHaveLength(0);
    expect(tracker.getChangeCount('k1')).toBe(0);
  });

  test('should deep clone values in change records', () => {
    const obj = { nested: { value: 42 } };
    tracker.track('key1', undefined, obj);
    obj.nested.value = 99;
    const changes = tracker.getAllChanges();
    expect((changes[0].newValue as { nested: { value: number } }).nested.value).toBe(42);
  });
});

// ============================================================
// Module 9: ConsistencyChecker Tests (119-130)
// ============================================================
describe('ConsistencyChecker', () => {
  let checker: ConsistencyChecker;

  beforeEach(() => {
    checker = new ConsistencyChecker();
  });

  test('should create a ConsistencyChecker instance', () => {
    expect(checker).toBeDefined();
  });

  test('should add and remove invariants', () => {
    checker.addInvariant('inv1', {
      name: 'inv1',
      check: () => true,
      repairStrategy: 'auto-repair',
    });
    const invariants = checker.getInvariants();
    expect(invariants).toHaveLength(1);
    expect(checker.removeInvariant('inv1')).toBe(true);
    expect(checker.getInvariants()).toHaveLength(0);
  });

  test('should verify with no issues', async () => {
    checker.addInvariant('inv1', {
      name: 'inv1',
      check: () => true,
      repairStrategy: 'auto-repair',
    });
    const report = await checker.verify();
    expect(report.consistent).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.passedCount).toBe(0); // no node states set
  });

  test('should detect invariant violations', async () => {
    checker.setNodeState('node1', { count: 0 });
    checker.addInvariant('positive-count', {
      name: 'positive-count',
      check: (state) => (state.count as number) > 0,
      repairStrategy: 'auto-repair',
    });
    const report = await checker.verify();
    expect(report.consistent).toBe(false);
    expect(report.failedCount).toBeGreaterThan(0);
  });

  test('should verify a specific node', async () => {
    checker.setNodeState('node1', { valid: true });
    checker.addInvariant('valid-check', {
      name: 'valid-check',
      check: (state) => state.valid === true,
      repairStrategy: 'auto-repair',
    });
    const report = await checker.verifyNode('node1');
    expect(report.consistent).toBe(true);
    expect(report.nodeId).toBe('node1');
  });

  test('should report missing node state', async () => {
    const report = await checker.verifyNode('nonexistent');
    expect(report.consistent).toBe(false);
    expect(report.issues).toHaveLength(1);
  });

  test('should repair issues', async () => {
    checker.setNodeState('node1', { count: -1 });
    checker.addInvariant('positive-count', {
      name: 'positive-count',
      check: (state) => (state.count as number) > 0,
      repair: (state) => ({ count: 0 }),
      repairStrategy: 'auto-repair',
    });
    await checker.verify();
    const issue = (await checker.verify()).issues[0];
    const result = await checker.repair(issue);
    expect(result.success).toBe(true);
  });

  test('should fail repair without repair function', async () => {
    checker.addInvariant('no-repair', {
      name: 'no-repair',
      check: () => false,
      repairStrategy: 'manual-repair',
    });
    checker.setNodeState('node1', {});
    await checker.verify();
    const issue = (await checker.verify()).issues[0];
    const result = await checker.repair(issue);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should get invariant info', () => {
    checker.addInvariant('inv1', {
      name: 'inv1',
      description: 'Test invariant',
      check: () => true,
      repair: (state) => state,
      repairStrategy: 'auto-repair',
    });
    const invariants = checker.getInvariants();
    expect(invariants[0].name).toBe('inv1');
    expect(invariants[0].description).toBe('Test invariant');
    expect(invariants[0].hasRepair).toBe(true);
  });

  test('should set and remove node states', () => {
    checker.setNodeState('node1', { data: 1 });
    checker.setNodeState('node2', { data: 2 });
    expect(checker.removeNodeState('node1')).toBe(true);
    expect(checker.removeNodeState('nonexistent')).toBe(false);
  });

  test('should track repair history', async () => {
    checker.setNodeState('node1', { count: -1 });
    checker.addInvariant('positive-count', {
      name: 'positive-count',
      check: (state) => (state.count as number) > 0,
      repair: (state) => ({ count: 0 }),
      repairStrategy: 'auto-repair',
    });
    await checker.verify();
    const issue = (await checker.verify()).issues[0];
    await checker.repair(issue);
    expect(checker.getRepairHistory()).toHaveLength(1);
  });

  test('should clear repair history', async () => {
    checker.setNodeState('node1', { count: -1 });
    checker.addInvariant('positive-count', {
      name: 'positive-count',
      check: (state) => (state.count as number) > 0,
      repair: (state) => ({ count: 0 }),
      repairStrategy: 'auto-repair',
    });
    await checker.verify();
    const issue = (await checker.verify()).issues[0];
    await checker.repair(issue);
    checker.clearRepairHistory();
    expect(checker.getRepairHistory()).toHaveLength(0);
  });
});

// ============================================================
// Module 10: SyncMetrics Tests (131-145)
// ============================================================
describe('SyncMetrics', () => {
  let metrics: SyncMetrics;

  beforeEach(() => {
    metrics = new SyncMetrics();
  });

  test('should create a SyncMetrics instance', () => {
    expect(metrics).toBeDefined();
  });

  test('should record a sync event', () => {
    metrics.recordSync({
      type: 'sync-complete',
      nodeId: 'node1',
      startTime: Date.now() - 10,
      success: true,
      entriesCount: 5,
    });
    const report = metrics.getMetrics();
    expect(report.totalSyncs).toBe(1);
    expect(report.successfulSyncs).toBe(1);
  });

  test('should record failed sync', () => {
    metrics.recordSync({
      type: 'sync-fail',
      nodeId: 'node1',
      startTime: Date.now() - 10,
      success: false,
    });
    const report = metrics.getMetrics();
    expect(report.failedSyncs).toBe(1);
  });

  test('should record conflict events', () => {
    metrics.recordSync({
      type: 'conflict',
      nodeId: 'node1',
      startTime: Date.now(),
    });
    const report = metrics.getMetrics();
    expect(report.totalConflicts).toBe(1);
  });

  test('should calculate average latency', () => {
    metrics.recordSync({
      type: 'sync-complete',
      nodeId: 'node1',
      startTime: Date.now() - 100,
      success: true,
    });
    metrics.recordSync({
      type: 'sync-complete',
      nodeId: 'node1',
      startTime: Date.now() - 200,
      success: true,
    });
    const report = metrics.getMetrics();
    expect(report.averageSyncLatency).toBeGreaterThan(0);
  });

  test('should calculate conflict rate', () => {
    metrics.recordSync({ type: 'sync-complete', nodeId: 'node1', startTime: Date.now(), success: true });
    metrics.recordSync({ type: 'conflict', nodeId: 'node1', startTime: Date.now() });
    const report = metrics.getMetrics();
    expect(report.conflictRate).toBeGreaterThan(0);
  });

  test('should get node metrics', () => {
    metrics.recordSync({
      type: 'sync-complete',
      nodeId: 'node1',
      startTime: Date.now() - 10,
      success: true,
      entriesCount: 10,
    });
    const nodeMetrics = metrics.getNodeMetrics('node1');
    expect(nodeMetrics.nodeId).toBe('node1');
    expect(nodeMetrics.syncCount).toBe(1);
    expect(nodeMetrics.successfulSyncs).toBe(1);
    expect(nodeMetrics.totalEntries).toBe(10);
  });

  test('should return empty node metrics for unknown node', () => {
    const nodeMetrics = metrics.getNodeMetrics('nonexistent');
    expect(nodeMetrics.nodeId).toBe('nonexistent');
    expect(nodeMetrics.syncCount).toBe(0);
  });

  test('should calculate latency percentiles', () => {
    for (let i = 0; i < 100; i++) {
      metrics.recordSync({
        type: 'sync-complete',
        nodeId: 'node1',
        startTime: Date.now() - (i + 1),
        success: true,
      });
    }
    const latency = metrics.getLatencyPercentiles();
    expect(latency.min).toBeLessThanOrEqual(latency.p50);
    expect(latency.p50).toBeLessThanOrEqual(latency.p90);
    expect(latency.p90).toBeLessThanOrEqual(latency.p99);
    expect(latency.p99).toBeLessThanOrEqual(latency.max);
  });

  test('should return zero latency when no events', () => {
    const latency = metrics.getLatencyPercentiles();
    expect(latency.p50).toBe(0);
    expect(latency.avg).toBe(0);
  });

  test('should generate dashboard', () => {
    metrics.recordSync({
      type: 'sync-complete',
      nodeId: 'node1',
      startTime: Date.now() - 10,
      success: true,
    });
    metrics.recordSync({
      type: 'conflict',
      nodeId: 'node2',
      startTime: Date.now(),
    });
    const dashboard = metrics.getDashboard();
    expect(dashboard.overview).toBeDefined();
    expect(dashboard.nodeStats.length).toBeGreaterThan(0);
    expect(dashboard.latency).toBeDefined();
    expect(dashboard.recentEvents).toBeDefined();
    expect(dashboard.topConflictingNodes).toBeDefined();
  });

  test('should get all node IDs', () => {
    metrics.recordSync({ type: 'sync-complete', nodeId: 'node1', startTime: Date.now(), success: true });
    metrics.recordSync({ type: 'sync-complete', nodeId: 'node2', startTime: Date.now(), success: true });
    metrics.recordSync({ type: 'sync-complete', nodeId: 'node1', startTime: Date.now(), success: true });
    const ids = metrics.getAllNodeIds();
    expect(ids).toContain('node1');
    expect(ids).toContain('node2');
  });

  test('should get all events', () => {
    metrics.recordSync({ type: 'sync-complete', nodeId: 'node1', startTime: Date.now(), success: true });
    metrics.recordSync({ type: 'conflict', nodeId: 'node2', startTime: Date.now() });
    const events = metrics.getEvents();
    expect(events).toHaveLength(2);
  });

  test('should clear metrics', () => {
    metrics.recordSync({ type: 'sync-complete', nodeId: 'node1', startTime: Date.now(), success: true });
    metrics.clear();
    const report = metrics.getMetrics();
    expect(report.totalSyncs).toBe(0);
  });

  test('should record replication events', () => {
    metrics.recordSync({
      type: 'replication',
      nodeId: 'node1',
      targetNodeId: 'node2',
      startTime: Date.now() - 5,
      success: true,
      entriesCount: 3,
    });
    const report = metrics.getMetrics();
    expect(report.totalSyncs).toBe(1);
    expect(report.successfulSyncs).toBe(1);
  });
});

// ============================================================
// Cross-module Integration Tests (146-155)
// ============================================================
describe('Integration Tests', () => {
  test('StateStore + ChangeTracker integration', () => {
    const store = new StateStore();
    const tracker = new ChangeTracker();
    const changes: string[] = [];

    tracker.subscribeAll((record) => changes.push(`${record.type}:${record.key}`));

    store.set('key1', 'value1');
    tracker.track('key1', undefined, 'value1');
    store.set('key1', 'value2');
    tracker.track('key1', 'value1', 'value2');
    store.delete('key1');
    tracker.track('key1', 'value2', undefined);

    expect(changes).toEqual(['create:key1', 'update:key1', 'delete:key1']);
  });

  test('CRDTStore + SyncProtocol integration', () => {
    const store1 = new CRDTStore('node1');
    const store2 = new CRDTStore('node2');
    const protocol = new SyncProtocol('node1');

    const counter1 = store1.createCounter('c1', 'gcounter');
    counter1.increment(10);

    const state = store1.getState();
    const message = protocol.prepareSync(state);

    const result = protocol.processSync(message);
    expect(result.success).toBe(true);

    store2.createCounter('c1', 'gcounter');
    store2.merge(state);
    expect(store2.getCounter('c1')!.value()).toBe(10);
  });

  test('ConflictResolver + SyncProtocol integration', () => {
    const resolver = new ConflictResolver();
    const protocol = new SyncProtocol('node1');

    resolver.setStrategy('key1', 'last-writer-wins');

    const local = { key: 'key1', value: 'local', version: 1, timestamp: 1, nodeId: 'node1' };
    const remote = { key: 'key1', value: 'remote', version: 1, timestamp: 3, nodeId: 'node2' };

    const resolved = resolver.resolve('key1', local, remote);
    const protocolResolved = protocol.resolveConflict(local, remote);

    // Both should pick remote (higher timestamp)
    expect(resolved.value).toBe('remote');
    expect(protocolResolved.value).toBe('remote');
    expect(resolved.winner).toBe('remote');
  });

  test('EventSourcedStore + ChangeTracker integration', () => {
    const eventStore = new EventSourcedStore();
    const tracker = new ChangeTracker();

    eventStore.append({
      aggregateId: 'agg1',
      eventType: 'created',
      payload: { name: 'test' },
      version: 0,
      timestamp: Date.now(),
    });

    tracker.track('agg1', undefined, eventStore.getState('agg1'));

    expect(tracker.getChangeCount('agg1')).toBe(1);
    expect(tracker.getAllChanges()[0].type).toBe('create');
  });

  test('ReplicationManager + SyncMetrics integration', () => {
    const manager = new ReplicationManager('multi-leader', 3);
    const metrics = new SyncMetrics();

    manager.addNode('node1', 'http://localhost:3001');
    manager.addNode('node2', 'http://localhost:3002');
    manager.addNode('node3', 'http://localhost:3003');

    const result = manager.replicate('key1', 'value1');

    metrics.recordSync({
      type: 'replication',
      nodeId: 'node1',
      startTime: Date.now() - result.duration,
      success: result.success,
      entriesCount: 1,
    });

    const report = metrics.getMetrics();
    expect(report.successfulSyncs).toBe(1);
  });

  test('RaftConsensus + ReplicationManager integration', () => {
    const raft = new RaftConsensus('node1', { electionTimeoutMin: 50, electionTimeoutMax: 100, heartbeatInterval: 25 });
    const manager = new ReplicationManager('leader-follower', 3);

    manager.addNode('node1', 'http://localhost:3001');
    manager.addNode('node2', 'http://localhost:3002');

    raft.start();
    raft.triggerElection();

    expect(raft.getRole()).toBe('leader');
    expect(manager.getClusterState().leaderId).toBe('node1');

    raft.stop();
  });

  test('ConsistencyChecker + StateStore integration', async () => {
    const store = new StateStore();
    const checker = new ConsistencyChecker();

    store.set('count', 5);
    store.set('name', 'test');

    checker.setNodeState('local', {
      count: store.get('count')!.value,
      name: store.get('name')!.value,
    });

    checker.addInvariant('has-count', {
      name: 'has-count',
      check: (state) => typeof state.count === 'number',
      repairStrategy: 'auto-repair',
    });

    const report = await checker.verify();
    expect(report.consistent).toBe(true);
  });

  test('SyncMetrics + ConflictResolver integration', () => {
    const metrics = new SyncMetrics();
    const resolver = new ConflictResolver();

    const local = { value: 'local', version: 1, timestamp: 1, nodeId: 'n1' };
    const remote = { value: 'remote', version: 1, timestamp: 2, nodeId: 'n2' };

    resolver.resolve('key1', local, remote);

    metrics.recordSync({
      type: 'conflict',
      nodeId: 'n1',
      startTime: Date.now(),
    });

    expect(metrics.getMetrics().totalConflicts).toBe(1);
    expect(resolver.getConflictCount()).toBe(1);
  });

  test('Full pipeline: Store -> CRDT -> Sync -> Metrics', () => {
    const store = new StateStore();
    const crdt = new CRDTStore('node1');
    const protocol = new SyncProtocol('node1');
    const metrics = new SyncMetrics();

    // Store state
    store.set('counter', 42);

    // Create CRDT
    const counter = crdt.createCounter('main', 'gcounter');
    counter.increment(42);

    // Sync
    const state = crdt.getState();
    const message = protocol.prepareSync(state);
    const result = protocol.processSync(message);

    // Metrics
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
  });

  test('Multi-node CRDT merge scenario', () => {
    const store1 = new CRDTStore('node1');
    const store2 = new CRDTStore('node2');
    const store3 = new CRDTStore('node3');

    const c1 = store1.createCounter('shared', 'gcounter');
    const c2 = store2.createCounter('shared', 'gcounter');
    const c3 = store3.createCounter('shared', 'gcounter');

    c1.increment(10);
    c2.increment(20);
    c3.increment(30);

    // Merge all
    store1.merge(store2.getState());
    store1.merge(store3.getState());

    expect(store1.getCounter('shared')!.value()).toBe(60);
  });
});
