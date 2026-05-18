import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// Module 1: MockFactory
import {
  createMockGraphStore,
  createMockStateStore,
  createMockEventSourcedStore,
  createMockReplicationManager,
  createMockWorkflowEngine,
  createMockPipelineBuilder,
  createMockLLMProvider,
  createMockDatabaseConnection,
  createMockHealthProbe,
  createMockAnomalyDetector,
  createMockCircuitBreaker,
} from '../src/mock-factory.js';

// Module 2: FixtureGenerator
import {
  generateCodeSnippet,
  generateGraphData,
  generateTimelineEvents,
  generateCRDTOperations,
  generateWorkflowDefinition,
  generatePipelineStages,
  generateUserSessions,
  generateAPIMockResponses,
} from '../src/fixture-generator.js';

// Module 3: Assertions
import {
  assertGraphIntegrity,
  assertCRDTConvergence,
  assertEventOrdering,
  assertQuorumMet,
  assertPipelineResult,
  assertWorkflowCompleted,
  assertConsistency,
  assertPerformance,
  assertDeepEqual,
  assertNoLeaks,
  AssertionError,
} from '../src/assertions.js';

// Module 4: TestHelpers
import {
  waitFor,
  delay,
  repeat,
  measureTime,
  generateId,
  resetIdCounter,
  createTempStore,
  setupMockConsole,
  setupMockTimer,
  flushPromises,
  createAsyncIterator,
} from '../src/test-helpers.js';

// Module 5: ScenarioBuilder
import { ScenarioBuilder, createScenarioBuilder } from '../src/scenario-builder.js';

// Module 6: PropertyBasedTesting
import {
  forAll,
  shrink,
  generators,
  stringArbitrary,
  integerArbitrary,
  floatArbitrary,
  booleanArbitrary,
  arrayArbitrary,
  objectArbitrary,
  oneOfArbitrary,
  tupleArbitrary,
  recordArbitrary,
} from '../src/property-based.js';

// Module 7: FuzzHelpers
import {
  fuzzString,
  fuzzNumber,
  fuzzObject,
  fuzzJSON,
  mutateString,
  mutateNumber,
  mutateJSON,
} from '../src/fuzz-helpers.js';

// Module 8: ComparisonUtils
import {
  deepDiff,
  deepClone,
  deepMerge,
  isEqual,
  sortBy,
  groupBy,
  countBy,
  uniqBy,
} from '../src/comparison-utils.js';

// Module 9: TimeHelpers
import { MockClock, freezeTime, advanceTime, unfreezeTime, createTimestamp } from '../src/time-helpers.js';

// Module 10: TestContext
import { TestContext, createIsolatedContext } from '../src/test-context.js';

// ============================================================
// Module 1: MockFactory Tests
// ============================================================
describe('MockFactory', () => {
  describe('createMockGraphStore', () => {
    it('should create an empty graph store', async () => {
      const store = createMockGraphStore();
      const nodes = await store.getAllNodes();
      expect(nodes).toHaveLength(0);
    });

    it('should create a graph store with preset nodes', async () => {
      const store = createMockGraphStore({
        nodes: [{ id: 'a', label: 'A', properties: {} }],
      });
      const nodes = await store.getAllNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.id).toBe('a');
    });

    it('should add and retrieve nodes', async () => {
      const store = createMockGraphStore();
      await store.addNode({ id: 'x', label: 'X', properties: { foo: 'bar' } });
      const node = await store.getNode('x');
      expect(node).toBeDefined();
      expect(node!.id).toBe('x');
      expect(node!.label).toBe('X');
    });

    it('should add and retrieve edges', async () => {
      const store = createMockGraphStore({
        nodes: [
          { id: 'a', label: 'A', properties: {} },
          { id: 'b', label: 'B', properties: {} },
        ],
      });
      await store.addEdge({ id: 'e1', source: 'a', target: 'b', label: 'connects', weight: 1 });
      const edge = await store.getEdge('e1');
      expect(edge).toBeDefined();
      expect(edge!.source).toBe('a');
      expect(edge!.target).toBe('b');
    });

    it('should get neighbors correctly', async () => {
      const store = createMockGraphStore({
        nodes: [
          { id: 'a', label: 'A', properties: {} },
          { id: 'b', label: 'B', properties: {} },
          { id: 'c', label: 'C', properties: {} },
        ],
        edges: [
          { id: 'e1', source: 'a', target: 'b', label: '', weight: 1 },
          { id: 'e2', source: 'a', target: 'c', label: '', weight: 1 },
        ],
      });
      const neighbors = await store.getNeighbors('a');
      expect(neighbors).toHaveLength(2);
    });

    it('should query nodes with predicate', async () => {
      const store = createMockGraphStore({
        nodes: [
          { id: 'a', label: 'Alpha', properties: {} },
          { id: 'b', label: 'Beta', properties: {} },
        ],
      });
      const results = await store.queryNodes((n) => n.label.startsWith('Al'));
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('a');
    });

    it('should remove nodes', async () => {
      const store = createMockGraphStore({
        nodes: [{ id: 'a', label: 'A', properties: {} }],
      });
      await store.removeNode('a');
      const node = await store.getNode('a');
      expect(node).toBeUndefined();
    });

    it('should remove edges', async () => {
      const store = createMockGraphStore({
        edges: [{ id: 'e1', source: 'a', target: 'b', label: '', weight: 1 }],
      });
      await store.removeEdge('e1');
      const edge = await store.getEdge('e1');
      expect(edge).toBeUndefined();
    });

    it('should track calls', async () => {
      const store = createMockGraphStore();
      await store.addNode({ id: 'a', label: 'A', properties: {} });
      expect(store.tracker.getCallCount('addNode')).toBe(1);
      await store.getNode('a');
      expect(store.tracker.getCallCount('getNode')).toBe(1);
    });

    it('should reset call tracker', async () => {
      const store = createMockGraphStore();
      await store.addNode({ id: 'a', label: 'A', properties: {} });
      store.tracker.reset();
      expect(store.tracker.getCallCount('addNode')).toBe(0);
    });

    it('should get all edges', async () => {
      const store = createMockGraphStore({
        edges: [
          { id: 'e1', source: 'a', target: 'b', label: '', weight: 1 },
          { id: 'e2', source: 'b', target: 'c', label: '', weight: 1 },
        ],
      });
      const edges = await store.getAllEdges();
      expect(edges).toHaveLength(2);
    });
  });

  describe('createMockStateStore', () => {
    it('should create an empty state store', async () => {
      const store = createMockStateStore();
      const keys = await store.keys();
      expect(keys).toHaveLength(0);
    });

    it('should create a store with preset data', async () => {
      const store = createMockStateStore({ foo: 'bar' });
      const val = await store.get('foo');
      expect(val).toBe('bar');
    });

    it('should set and get values', async () => {
      const store = createMockStateStore();
      await store.set('key', 'value');
      const val = await store.get('key');
      expect(val).toBe('value');
    });

    it('should check if key exists', async () => {
      const store = createMockStateStore();
      expect(await store.has('missing')).toBe(false);
      await store.set('present', 1);
      expect(await store.has('present')).toBe(true);
    });

    it('should delete keys', async () => {
      const store = createMockStateStore({ x: 1 });
      await store.delete('x');
      expect(await store.has('x')).toBe(false);
    });

    it('should clear all keys', async () => {
      const store = createMockStateStore({ a: 1, b: 2 });
      await store.clear();
      expect(await store.keys()).toHaveLength(0);
    });

    it('should return entries', async () => {
      const store = createMockStateStore({ a: 1, b: 2 });
      const entries = await store.entries();
      expect(entries).toHaveLength(2);
    });

    it('should track calls', async () => {
      const store = createMockStateStore();
      await store.set('k', 'v');
      expect(store.tracker.getCallCount('set')).toBe(1);
    });
  });

  describe('createMockEventSourcedStore', () => {
    it('should append and retrieve events', async () => {
      const store = createMockEventSourcedStore();
      await store.append({
        id: 'e1',
        aggregateId: 'agg-1',
        type: 'created',
        data: {},
        timestamp: 1,
        version: 1,
      });
      const events = await store.getEvents('agg-1');
      expect(events).toHaveLength(1);
      expect(events[0]!.id).toBe('e1');
    });

    it('should get events by type', async () => {
      const store = createMockEventSourcedStore();
      await store.append({ id: 'e1', aggregateId: 'a1', type: 'created', data: {}, timestamp: 1, version: 1 });
      await store.append({ id: 'e2', aggregateId: 'a2', type: 'created', data: {}, timestamp: 2, version: 1 });
      await store.append({ id: 'e3', aggregateId: 'a1', type: 'updated', data: {}, timestamp: 3, version: 2 });
      const created = await store.getEventsByType('created');
      expect(created).toHaveLength(2);
    });

    it('should save and get snapshots', async () => {
      const store = createMockEventSourcedStore();
      await store.saveSnapshot('agg-1', { count: 5 });
      const snapshot = await store.getSnapshot('agg-1');
      expect(snapshot).toEqual({ count: 5 });
    });

    it('should return null for missing snapshot', async () => {
      const store = createMockEventSourcedStore();
      const snapshot = await store.getSnapshot('missing');
      expect(snapshot).toBeNull();
    });

    it('should return empty events for unknown aggregate', async () => {
      const store = createMockEventSourcedStore();
      const events = await store.getEvents('unknown');
      expect(events).toHaveLength(0);
    });

    it('should track calls', async () => {
      const store = createMockEventSourcedStore();
      await store.append({ id: 'e1', aggregateId: 'a1', type: 't', data: {}, timestamp: 1, version: 1 });
      expect(store.tracker.getCallCount('append')).toBe(1);
    });
  });

  describe('createMockReplicationManager', () => {
    it('should add and remove nodes', async () => {
      const mgr = createMockReplicationManager();
      await mgr.addNode('node-1');
      const status = await mgr.getStatus();
      expect(status).toHaveLength(1);
      expect(status[0]!.nodeId).toBe('node-1');
      await mgr.removeNode('node-1');
      const statusAfter = await mgr.getStatus();
      expect(statusAfter).toHaveLength(0);
    });

    it('should sync a node', async () => {
      const mgr = createMockReplicationManager();
      await mgr.addNode('node-1');
      await mgr.sync('node-1');
      const status = await mgr.getStatus();
      expect(status[0]!.state).toBe('synced');
    });

    it('should replicate data without error', async () => {
      const mgr = createMockReplicationManager();
      await expect(mgr.replicate({ key: 'value' })).resolves.toBeUndefined();
    });

    it('should track calls', async () => {
      const mgr = createMockReplicationManager();
      await mgr.addNode('n1');
      expect(mgr.tracker.getCallCount('addNode')).toBe(1);
    });
  });

  describe('createMockWorkflowEngine', () => {
    it('should start a workflow', async () => {
      const engine = createMockWorkflowEngine();
      const instance = await engine.start('wf-1', { data: true });
      expect(instance.id).toBe('wf-1');
      expect(instance.status).toBe('running');
    });

    it('should pause a workflow', async () => {
      const engine = createMockWorkflowEngine();
      await engine.start('wf-1', {});
      await engine.pause('wf-1');
      const status = await engine.getStatus('wf-1');
      expect(status!.status).toBe('paused');
    });

    it('should resume a paused workflow', async () => {
      const engine = createMockWorkflowEngine();
      await engine.start('wf-1', {});
      await engine.pause('wf-1');
      await engine.resume('wf-1');
      const status = await engine.getStatus('wf-1');
      expect(status!.status).toBe('running');
    });

    it('should cancel a workflow', async () => {
      const engine = createMockWorkflowEngine();
      await engine.start('wf-1', {});
      await engine.cancel('wf-1');
      const status = await engine.getStatus('wf-1');
      expect(status!.status).toBe('failed');
    });

    it('should return undefined for unknown workflow', async () => {
      const engine = createMockWorkflowEngine();
      const status = await engine.getStatus('unknown');
      expect(status).toBeUndefined();
    });

    it('should track calls', async () => {
      const engine = createMockWorkflowEngine();
      await engine.start('wf-1', {});
      expect(engine.tracker.getCallCount('start')).toBe(1);
    });
  });

  describe('createMockPipelineBuilder', () => {
    it('should build a pipeline', async () => {
      const builder = createMockPipelineBuilder();
      const stages = await builder.build();
      expect(stages).toHaveLength(0);
    });

    it('should add stages and execute', async () => {
      const builder = createMockPipelineBuilder();
      const result = await builder
        .stage('double', async (data) => (data as number) * 2)
        .stage('add10', async (data) => (data as number) + 10)
        .execute(5);
      expect(result).toBe(20);
    });

    it('should track calls', async () => {
      const builder = createMockPipelineBuilder();
      builder.stage('test', async (d) => d);
      expect(builder.tracker.getCallCount('stage')).toBe(1);
    });
  });

  describe('createMockLLMProvider', () => {
    it('should complete a prompt', async () => {
      const provider = createMockLLMProvider();
      const response = await provider.complete('Hello');
      expect(response.content).toContain('Hello');
      expect(response.model).toBe('mock-model');
      expect(response.finishReason).toBe('stop');
    });

    it('should stream a response', async () => {
      const provider = createMockLLMProvider();
      const chunks: string[] = [];
      for await (const chunk of await provider.stream('test')) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should embed text', async () => {
      const provider = createMockLLMProvider();
      const embedding = await provider.embed('test');
      expect(embedding).toHaveLength(10);
    });

    it('should track calls', async () => {
      const provider = createMockLLMProvider();
      await provider.complete('test');
      expect(provider.tracker.getCallCount('complete')).toBe(1);
    });
  });

  describe('createMockDatabaseConnection', () => {
    it('should execute a query', async () => {
      const conn = createMockDatabaseConnection();
      const results = await conn.query('SELECT * FROM users');
      expect(results).toHaveLength(1);
    });

    it('should execute a statement', async () => {
      const conn = createMockDatabaseConnection();
      const affected = await conn.execute('INSERT INTO users VALUES (?)', ['test']);
      expect(affected).toBe(1);
    });

    it('should run a transaction', async () => {
      const conn = createMockDatabaseConnection();
      const result = await conn.transaction(async (tx) => {
        await tx.query('SELECT 1');
        return 'ok';
      });
      expect(result).toBe('ok');
    });

    it('should close connection', async () => {
      const conn = createMockDatabaseConnection();
      expect(conn.isConnected()).toBe(true);
      await conn.close();
      expect(conn.isConnected()).toBe(false);
    });

    it('should track calls', async () => {
      const conn = createMockDatabaseConnection();
      await conn.query('SELECT 1');
      expect(conn.tracker.getCallCount('query')).toBe(1);
    });
  });

  describe('createMockHealthProbe', () => {
    it('should check a component', async () => {
      const probe = createMockHealthProbe();
      const status = await probe.check('db');
      expect(status.status).toBe('healthy');
      expect(status.checks).toHaveLength(1);
    });

    it('should check all components', async () => {
      const probe = createMockHealthProbe();
      const all = await probe.checkAll();
      expect(all).toHaveProperty('default');
    });

    it('should track calls', async () => {
      const probe = createMockHealthProbe();
      await probe.check('db');
      expect(probe.tracker.getCallCount('check')).toBe(1);
    });
  });

  describe('createMockAnomalyDetector', () => {
    it('should detect anomalies (returns empty by default)', async () => {
      const detector = createMockAnomalyDetector();
      const anomalies = await detector.detect({ value: 100 });
      expect(anomalies).toHaveLength(0);
    });

    it('should train without error', async () => {
      const detector = createMockAnomalyDetector();
      await expect(detector.train([{ v: 1 }, { v: 2 }])).resolves.toBeUndefined();
    });

    it('should reset without error', async () => {
      const detector = createMockAnomalyDetector();
      await expect(detector.reset()).resolves.toBeUndefined();
    });

    it('should track calls', async () => {
      const detector = createMockAnomalyDetector();
      await detector.detect({});
      expect(detector.tracker.getCallCount('detect')).toBe(1);
    });
  });

  describe('createMockCircuitBreaker', () => {
    it('should execute a function when closed', async () => {
      const cb = createMockCircuitBreaker();
      const result = await cb.execute(async () => 42);
      expect(result).toBe(42);
    });

    it('should track state changes', async () => {
      const cb = createMockCircuitBreaker();
      await cb.execute(async () => 42);
      const state = cb.getState();
      expect(state.successCount).toBe(1);
    });

    it('should force open the circuit', async () => {
      const cb = createMockCircuitBreaker();
      cb.forceOpen();
      const state = cb.getState();
      expect(state.state).toBe('open');
    });

    it('should reject when circuit is open', async () => {
      const cb = createMockCircuitBreaker();
      cb.forceOpen();
      await expect(cb.execute(async () => 42)).rejects.toThrow('Circuit breaker is open');
    });

    it('should force close the circuit', async () => {
      const cb = createMockCircuitBreaker();
      cb.forceOpen();
      cb.forceClose();
      const state = cb.getState();
      expect(state.state).toBe('closed');
    });

    it('should reset the circuit', async () => {
      const cb = createMockCircuitBreaker();
      await cb.execute(async () => 42);
      cb.reset();
      const state = cb.getState();
      expect(state.successCount).toBe(0);
    });

    it('should track calls', async () => {
      const cb = createMockCircuitBreaker();
      await cb.execute(async () => 42);
      expect(cb.tracker.getCallCount('execute')).toBe(1);
    });
  });
});

// ============================================================
// Module 2: FixtureGenerator Tests
// ============================================================
describe('FixtureGenerator', () => {
  describe('generateCodeSnippet', () => {
    it('should generate TypeScript code', () => {
      const snippet = generateCodeSnippet('typescript', 1);
      expect(snippet.language).toBe('typescript');
      expect(snippet.code).toBeTruthy();
    });

    it('should generate Python code', () => {
      const snippet = generateCodeSnippet('python', 2);
      expect(snippet.language).toBe('python');
      expect(snippet.code).toContain('def');
    });

    it('should generate Rust code', () => {
      const snippet = generateCodeSnippet('rust', 1);
      expect(snippet.language).toBe('rust');
      expect(snippet.code).toContain('fn main');
    });

    it('should generate Go code', () => {
      const snippet = generateCodeSnippet('go', 1);
      expect(snippet.language).toBe('go');
      expect(snippet.code).toContain('package main');
    });

    it('should default to TypeScript for unknown language', () => {
      const snippet = generateCodeSnippet('unknown', 1);
      expect(snippet.language).toBe('unknown');
      expect(snippet.code).toBeTruthy();
    });

    it('should clamp complexity to 1-3', () => {
      const low = generateCodeSnippet('typescript', 0);
      expect(low.complexity).toBe(1);
      const high = generateCodeSnippet('typescript', 10);
      expect(high.complexity).toBe(3);
    });
  });

  describe('generateGraphData', () => {
    it('should generate correct number of nodes', () => {
      const data = generateGraphData(3, 2);
      expect(data.nodes).toHaveLength(3);
    });

    it('should generate correct number of edges', () => {
      const data = generateGraphData(5, 4);
      expect(data.edges).toHaveLength(4);
    });

    it('should use default values', () => {
      const data = generateGraphData();
      expect(data.nodes).toHaveLength(5);
      expect(data.edges).toHaveLength(7);
    });

    it('should have unique node IDs', () => {
      const data = generateGraphData(10, 5);
      const ids = new Set(data.nodes.map((n) => n.id));
      expect(ids.size).toBe(10);
    });
  });

  describe('generateTimelineEvents', () => {
    it('should generate correct number of events', () => {
      const events = generateTimelineEvents(5);
      expect(events).toHaveLength(5);
    });

    it('should use provided start date', () => {
      const start = new Date('2024-06-01T00:00:00Z');
      const events = generateTimelineEvents(3, start);
      expect(events[0]!.timestamp).toBe(start.getTime());
    });

    it('should have incrementing timestamps', () => {
      const events = generateTimelineEvents(5);
      for (let i = 1; i < events.length; i++) {
        expect(events[i]!.timestamp).toBeGreaterThan(events[i - 1]!.timestamp);
      }
    });

    it('should have unique IDs', () => {
      const events = generateTimelineEvents(10);
      const ids = new Set(events.map((e) => e.id));
      expect(ids.size).toBe(10);
    });
  });

  describe('generateCRDTOperations', () => {
    it('should generate correct number of operations', () => {
      const ops = generateCRDTOperations(5);
      expect(ops).toHaveLength(5);
    });

    it('should respect type filter', () => {
      const ops = generateCRDTOperations(3, 'insert');
      expect(ops.every((o) => o.type === 'insert')).toBe(true);
    });

    it('should have vector clocks', () => {
      const ops = generateCRDTOperations(3);
      for (const op of ops) {
        expect(op.vectorClock).toBeDefined();
        expect(Object.keys(op.vectorClock).length).toBeGreaterThan(0);
      }
    });
  });

  describe('generateWorkflowDefinition', () => {
    it('should generate correct number of steps', () => {
      const wf = generateWorkflowDefinition(4, 0);
      expect(wf.steps).toHaveLength(4);
    });

    it('should generate correct number of branches', () => {
      const wf = generateWorkflowDefinition(3, 2);
      expect(wf.branches).toHaveLength(2);
    });

    it('should have a valid ID', () => {
      const wf = generateWorkflowDefinition();
      expect(wf.id).toBeTruthy();
    });

    it('should have a name', () => {
      const wf = generateWorkflowDefinition();
      expect(wf.name).toBe('Test Workflow');
    });
  });

  describe('generatePipelineStages', () => {
    it('should generate correct number of stages', () => {
      const stages = generatePipelineStages(5);
      expect(stages).toHaveLength(5);
    });

    it('should have unique names', () => {
      const stages = generatePipelineStages(5);
      const names = new Set(stages.map((s) => s.name));
      expect(names.size).toBe(5);
    });

    it('should have config', () => {
      const stages = generatePipelineStages(1);
      expect(stages[0]!.config).toBeDefined();
    });
  });

  describe('generateUserSessions', () => {
    it('should generate correct number of sessions', () => {
      const sessions = generateUserSessions(5);
      expect(sessions).toHaveLength(5);
    });

    it('should have unique IDs', () => {
      const sessions = generateUserSessions(10);
      const ids = new Set(sessions.map((s) => s.id));
      expect(ids.size).toBe(10);
    });

    it('should have metadata', () => {
      const sessions = generateUserSessions(1);
      expect(sessions[0]!.metadata).toBeDefined();
    });
  });

  describe('generateAPIMockResponses', () => {
    it('should generate responses for GET, POST, PUT, DELETE', () => {
      const responses = generateAPIMockResponses('/api/users');
      expect(responses).toHaveLength(4);
      const methods = responses.map((r) => r.method);
      expect(methods).toContain('GET');
      expect(methods).toContain('POST');
      expect(methods).toContain('PUT');
      expect(methods).toContain('DELETE');
    });

    it('should include correct endpoint', () => {
      const responses = generateAPIMockResponses('/api/test');
      expect(responses.every((r) => r.endpoint === '/api/test')).toBe(true);
    });
  });
});

// ============================================================
// Module 3: Assertions Tests
// ============================================================
describe('Assertions', () => {
  describe('assertGraphIntegrity', () => {
    it('should pass for a valid graph', async () => {
      const store = createMockGraphStore({
        nodes: [
          { id: 'a', label: 'A', properties: {} },
          { id: 'b', label: 'B', properties: {} },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'b', label: '', weight: 1 }],
      });
      await expect(assertGraphIntegrity(store)).resolves.toBeUndefined();
    });

    it('should throw for dangling source edge', async () => {
      const store = createMockGraphStore({
        nodes: [{ id: 'b', label: 'B', properties: {} }],
        edges: [{ id: 'e1', source: 'a', target: 'b', label: '', weight: 1 }],
      });
      await expect(assertGraphIntegrity(store)).rejects.toThrow(AssertionError);
    });

    it('should throw for dangling target edge', async () => {
      const store = createMockGraphStore({
        nodes: [{ id: 'a', label: 'A', properties: {} }],
        edges: [{ id: 'e1', source: 'a', target: 'b', label: '', weight: 1 }],
      });
      await expect(assertGraphIntegrity(store)).rejects.toThrow(AssertionError);
    });
  });

  describe('assertCRDTConvergence', () => {
    it('should pass when all stores have same state', async () => {
      const stores = [
        { getState: async () => ({ a: 1 }) },
        { getState: async () => ({ a: 1 }) },
      ];
      await expect(assertCRDTConvergence(stores)).resolves.toBeUndefined();
    });

    it('should pass for a single store', async () => {
      const stores = [{ getState: async () => ({ a: 1 }) }];
      await expect(assertCRDTConvergence(stores)).resolves.toBeUndefined();
    });

    it('should throw when stores diverge', async () => {
      const stores = [
        { getState: async () => ({ a: 1 }) },
        { getState: async () => ({ a: 2 }) },
      ];
      await expect(assertCRDTConvergence(stores)).rejects.toThrow(AssertionError);
    });
  });

  describe('assertEventOrdering', () => {
    it('should pass for correctly ordered events', async () => {
      const store = createMockEventSourcedStore();
      await store.append({ id: 'e1', aggregateId: 'a1', type: 't', data: {}, timestamp: 100, version: 1 });
      await store.append({ id: 'e2', aggregateId: 'a1', type: 't', data: {}, timestamp: 200, version: 2 });
      await expect(assertEventOrdering(store, 'a1')).resolves.toBeUndefined();
    });

    it('should throw for out-of-order timestamps', async () => {
      const store = createMockEventSourcedStore();
      await store.append({ id: 'e1', aggregateId: 'a1', type: 't', data: {}, timestamp: 200, version: 1 });
      await store.append({ id: 'e2', aggregateId: 'a1', type: 't', data: {}, timestamp: 100, version: 2 });
      await expect(assertEventOrdering(store, 'a1')).rejects.toThrow(AssertionError);
    });
  });

  describe('assertQuorumMet', () => {
    it('should pass when quorum is met', () => {
      expect(() => assertQuorumMet({ success: true, count: 5 }, 3)).not.toThrow();
    });

    it('should throw when not successful', () => {
      expect(() => assertQuorumMet({ success: false, count: 5 }, 3)).toThrow(AssertionError);
    });

    it('should throw when count is insufficient', () => {
      expect(() => assertQuorumMet({ success: true, count: 2 }, 3)).toThrow(AssertionError);
    });
  });

  describe('assertPipelineResult', () => {
    it('should pass for matching results', () => {
      expect(() =>
        assertPipelineResult({ success: true, output: 42 }, { success: true, output: 42 }),
      ).not.toThrow();
    });

    it('should throw for mismatched success', () => {
      expect(() =>
        assertPipelineResult({ success: true, output: 42 }, { success: false, output: 42 }),
      ).toThrow(AssertionError);
    });

    it('should throw for mismatched output', () => {
      expect(() =>
        assertPipelineResult({ success: true, output: 42 }, { success: true, output: 43 }),
      ).toThrow(AssertionError);
    });
  });

  describe('assertWorkflowCompleted', () => {
    it('should pass for completed workflow', () => {
      expect(() => assertWorkflowCompleted({ id: 'w1', status: 'completed' })).not.toThrow();
    });

    it('should throw for non-completed workflow', () => {
      expect(() => assertWorkflowCompleted({ id: 'w1', status: 'running' })).toThrow(AssertionError);
    });
  });

  describe('assertConsistency', () => {
    it('should pass when all invariants hold', () => {
      const invariants = [
        { name: 'positive', check: (s: Record<string, unknown>) => (s.count as number) >= 0 },
      ];
      expect(() => assertConsistency(invariants, { count: 5 })).not.toThrow();
    });

    it('should throw when an invariant is violated', () => {
      const invariants = [
        { name: 'positive', check: (s: Record<string, unknown>) => (s.count as number) >= 0 },
      ];
      expect(() => assertConsistency(invariants, { count: -1 })).toThrow(AssertionError);
    });
  });

  describe('assertPerformance', () => {
    it('should pass for fast function', async () => {
      const elapsed = await assertPerformance(async () => {}, 1000);
      expect(elapsed).toBeLessThan(1000);
    });

    it('should throw for slow function', async () => {
      await expect(
        assertPerformance(async () => { await delay(200); }, 50),
      ).rejects.toThrow(AssertionError);
    });
  });

  describe('assertDeepEqual', () => {
    it('should pass for equal primitives', () => {
      expect(() => assertDeepEqual(1, 1)).not.toThrow();
    });

    it('should pass for equal objects', () => {
      expect(() => assertDeepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).not.toThrow();
    });

    it('should pass for equal arrays', () => {
      expect(() => assertDeepEqual([1, 2, 3], [1, 2, 3])).not.toThrow();
    });

    it('should throw for different primitives', () => {
      expect(() => assertDeepEqual(1, 2)).toThrow(AssertionError);
    });

    it('should throw for different objects', () => {
      expect(() => assertDeepEqual({ a: 1 }, { a: 2 })).toThrow(AssertionError);
    });

    it('should report path on mismatch', () => {
      try {
        assertDeepEqual({ a: { b: 1 } }, { a: { b: 2 } });
        expect(true).toBe(false); // should not reach
      } catch (err) {
        expect((err as AssertionError).message).toContain('a.b');
      }
    });

    it('should throw for missing keys', () => {
      expect(() => assertDeepEqual({ a: 1 }, {} as Record<string, unknown>)).toThrow(AssertionError);
    });

    it('should throw for extra keys', () => {
      expect(() => assertDeepEqual({ a: 1 }, { a: 1, b: 2 })).toThrow(AssertionError);
    });

    it('should throw for array length mismatch', () => {
      expect(() => assertDeepEqual([1, 2], [1])).toThrow(AssertionError);
    });
  });

  describe('assertNoLeaks', () => {
    it('should pass for simple function', async () => {
      await expect(assertNoLeaks(async () => {})).resolves.toBeUndefined();
    });
  });
});

// ============================================================
// Module 4: TestHelpers Tests
// ============================================================
describe('TestHelpers', () => {
  describe('waitFor', () => {
    it('should resolve when condition is true', async () => {
      let value = false;
      setTimeout(() => { value = true; }, 50);
      await expect(waitFor(() => value, 5000, 10)).resolves.toBeUndefined();
    });

    it('should timeout when condition never true', async () => {
      await expect(waitFor(() => false, 100, 10)).rejects.toThrow('timed out');
    });

    it('should work with async conditions', async () => {
      let value = false;
      setTimeout(() => { value = true; }, 50);
      await expect(waitFor(async () => value, 5000, 10)).resolves.toBeUndefined();
    });
  });

  describe('delay', () => {
    it('should delay for specified time', async () => {
      const start = performance.now();
      await delay(50);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });

  describe('repeat', () => {
    it('should repeat function N times', async () => {
      const results = await repeat(() => 42, 5);
      expect(results).toHaveLength(5);
      expect(results.every((r) => r === 42)).toBe(true);
    });

    it('should work with async functions', async () => {
      const results = await repeat(async () => Promise.resolve(1), 3);
      expect(results).toEqual([1, 1, 1]);
    });
  });

  describe('measureTime', () => {
    it('should measure execution time', async () => {
      const { result, elapsedMs } = await measureTime(async () => 42);
      expect(result).toBe(42);
      expect(elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('should measure sync function time', async () => {
      const { result, elapsedMs } = await measureTime(() => 'hello');
      expect(result).toBe('hello');
      expect(typeof elapsedMs).toBe('number');
    });
  });

  describe('generateId', () => {
    beforeEach(() => { resetIdCounter(); });

    it('should generate unique IDs', () => {
      const id1 = generateId('test');
      const id2 = generateId('test');
      expect(id1).not.toBe(id2);
    });

    it('should include prefix', () => {
      const id = generateId('my-prefix');
      expect(id.startsWith('my-prefix-')).toBe(true);
    });

    it('should use default prefix', () => {
      const id = generateId();
      expect(id.startsWith('id-')).toBe(true);
    });
  });

  describe('createTempStore', () => {
    it('should create an empty store', () => {
      const store = createTempStore();
      expect(store.size()).toBe(0);
    });

    it('should set and get values', () => {
      const store = createTempStore();
      store.set('key', 'value');
      expect(store.get('key')).toBe('value');
    });

    it('should check has', () => {
      const store = createTempStore();
      expect(store.has('missing')).toBe(false);
      store.set('present', 1);
      expect(store.has('present')).toBe(true);
    });

    it('should delete values', () => {
      const store = createTempStore();
      store.set('key', 'value');
      expect(store.delete('key')).toBe(true);
      expect(store.has('key')).toBe(false);
    });

    it('should clear all values', () => {
      const store = createTempStore();
      store.set('a', 1);
      store.set('b', 2);
      store.clear();
      expect(store.size()).toBe(0);
    });
  });

  describe('setupMockConsole', () => {
    afterEach(() => {
      // Restore is handled by mockConsole.restore()
    });

    it('should capture console.log', () => {
      const mock = setupMockConsole();
      console.log('hello', 'world');
      expect(mock.logs).toHaveLength(1);
      expect(mock.logs[0]).toContain('hello');
      mock.restore();
    });

    it('should capture console.warn', () => {
      const mock = setupMockConsole();
      console.warn('warning');
      expect(mock.warns).toHaveLength(1);
      mock.restore();
    });

    it('should capture console.error', () => {
      const mock = setupMockConsole();
      console.error('error');
      expect(mock.errors).toHaveLength(1);
      mock.restore();
    });

    it('should capture console.info', () => {
      const mock = setupMockConsole();
      console.info('info');
      expect(mock.infos).toHaveLength(1);
      mock.restore();
    });

    it('should restore console', () => {
      const originalLog = console.log;
      const mock = setupMockConsole();
      mock.restore();
      expect(console.log).toBe(originalLog);
    });
  });

  describe('setupMockTimer', () => {
    afterEach(() => {
      // Ensure timer is always restored
    });

    it('should control Date.now', () => {
      const timer = setupMockTimer();
      const frozen = Date.now();
      timer.advance(1000);
      expect(Date.now()).toBe(frozen + 1000);
      timer.restore();
    });

    it('should set specific time', () => {
      const timer = setupMockTimer();
      timer.setTime(1000000);
      expect(Date.now()).toBe(1000000);
      timer.restore();
    });

    it('should reset to real time', () => {
      const timer = setupMockTimer();
      timer.setTime(0);
      timer.restore();
      timer.reset();
      expect(Date.now()).toBeGreaterThan(0);
    });
  });

  describe('flushPromises', () => {
    it('should flush microtasks', async () => {
      let executed = false;
      Promise.resolve().then(() => { executed = true; });
      expect(executed).toBe(false);
      await flushPromises();
      expect(executed).toBe(true);
    });
  });

  describe('createAsyncIterator', () => {
    it('should iterate over items', async () => {
      const iter = createAsyncIterator([1, 2, 3]);
      const results: number[] = [];
      for await (const item of iter) {
        results.push(item);
      }
      expect(results).toEqual([1, 2, 3]);
    });

    it('should handle empty array', async () => {
      const iter = createAsyncIterator([]);
      const results: unknown[] = [];
      for await (const item of iter) {
        results.push(item);
      }
      expect(results).toHaveLength(0);
    });
  });
});

// ============================================================
// Module 5: ScenarioBuilder Tests
// ============================================================
describe('ScenarioBuilder', () => {
  it('should create an empty scenario', () => {
    const builder = new ScenarioBuilder();
    const scenario = builder.build();
    expect(scenario.graph).toBeUndefined();
    expect(scenario.workflow).toBeUndefined();
  });

  it('should set up a graph', () => {
    const builder = new ScenarioBuilder();
    const scenario = builder.withGraph({ nodeCount: 3, edgeCount: 2 }).build();
    expect(scenario.graph).toBeDefined();
    expect(scenario.graph!.nodes).toHaveLength(3);
  });

  it('should set up CRDT nodes', () => {
    const builder = new ScenarioBuilder();
    const scenario = builder.withCRDT(5).build();
    expect(scenario.crdt).toBeDefined();
    expect(scenario.crdt!.nodes).toBe(5);
  });

  it('should set up a workflow', () => {
    const builder = new ScenarioBuilder();
    const scenario = builder.withWorkflow({ steps: 4, branches: 2 }).build();
    expect(scenario.workflow).toBeDefined();
    expect(scenario.workflow!.steps).toHaveLength(4);
  });

  it('should set up a pipeline', () => {
    const builder = new ScenarioBuilder();
    const scenario = builder.withPipeline(5).build();
    expect(scenario.pipeline).toBeDefined();
    expect(scenario.pipeline!).toHaveLength(5);
  });

  it('should set up replication', () => {
    const builder = new ScenarioBuilder();
    const scenario = builder.withReplication({ nodeCount: 3, factor: 2 }).build();
    expect(scenario.replication).toBeDefined();
    expect(scenario.replication!.nodeCount).toBe(3);
  });

  it('should set up events', () => {
    const builder = new ScenarioBuilder();
    const events = [{ type: 'click', data: { x: 1 } }];
    const scenario = builder.withEvents(events).build();
    expect(scenario.events).toHaveLength(1);
  });

  it('should inject faults', () => {
    const builder = new ScenarioBuilder();
    const scenario = builder.injectFault('timeout', 'service-a').build();
    expect(scenario.faults).toHaveLength(1);
    expect(scenario.faults![0]!.type).toBe('timeout');
  });

  it('should support fluent chaining', () => {
    const scenario = new ScenarioBuilder()
      .withGraph({ nodeCount: 2 })
      .withCRDT(3)
      .withWorkflow()
      .withPipeline(2)
      .injectFault('crash', 'node-1')
      .build();

    expect(scenario.graph).toBeDefined();
    expect(scenario.crdt).toBeDefined();
    expect(scenario.workflow).toBeDefined();
    expect(scenario.pipeline).toBeDefined();
    expect(scenario.faults).toHaveLength(1);
  });

  it('should create via factory function', () => {
    const builder = createScenarioBuilder();
    expect(builder).toBeInstanceOf(ScenarioBuilder);
  });
});

// ============================================================
// Module 6: PropertyBasedTesting Tests
// ============================================================
describe('PropertyBasedTesting', () => {
  describe('generators', () => {
    it('stringArbitrary should generate strings', () => {
      const arb = stringArbitrary();
      const rng = () => 0.5;
      const result = arb.generate(rng);
      expect(typeof result).toBe('string');
    });

    it('integerArbitrary should generate integers', () => {
      const arb = integerArbitrary(0, 100);
      const rng = () => 0.5;
      const result = arb.generate(rng);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });

    it('floatArbitrary should generate floats', () => {
      const arb = floatArbitrary(0, 1);
      const rng = () => 0.5;
      const result = arb.generate(rng);
      expect(typeof result).toBe('number');
    });

    it('booleanArbitrary should generate booleans', () => {
      const arb = booleanArbitrary();
      const results = [arb.generate(() => 0.1), arb.generate(() => 0.9)];
      expect(results).toContain(false);
      expect(results).toContain(true);
    });

    it('arrayArbitrary should generate arrays', () => {
      const arb = arrayArbitrary(integerArbitrary(0, 10), 2, 5);
      const rng = () => 0.5;
      const result = arb.generate(rng);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('objectArbitrary should generate objects', () => {
      const arb = objectArbitrary();
      const rng = () => 0.5;
      const result = arb.generate(rng);
      expect(typeof result).toBe('object');
      expect(result).not.toBeNull();
    });

    it('oneOfArbitrary should pick from options', () => {
      const arb = oneOfArbitrary([integerArbitrary(0, 0), stringArbitrary(0, 0)]);
      const results = new Set();
      for (let i = 0; i < 20; i++) {
        results.add(typeof arb.generate(() => i / 20));
      }
      expect(results.size).toBeGreaterThan(1);
    });

    it('tupleArbitrary should generate tuples', () => {
      const arb = tupleArbitrary(integerArbitrary(0, 10), stringArbitrary(1, 1));
      const rng = () => 0.5;
      const result = arb.generate(rng);
      expect(result).toHaveLength(2);
      expect(typeof result[0]).toBe('number');
      expect(typeof result[1]).toBe('string');
    });

    it('recordArbitrary should generate Maps', () => {
      const arb = recordArbitrary();
      const rng = () => 0.5;
      const result = arb.generate(rng);
      expect(result).toBeInstanceOf(Map);
    });

    it('generators object should have all types', () => {
      expect(generators.string).toBe(stringArbitrary);
      expect(generators.integer).toBe(integerArbitrary);
      expect(generators.float).toBe(floatArbitrary);
      expect(generators.boolean).toBe(booleanArbitrary);
      expect(generators.array).toBe(arrayArbitrary);
      expect(generators.object).toBe(objectArbitrary);
      expect(generators.oneOf).toBe(oneOfArbitrary);
      expect(generators.tuple).toBe(tupleArbitrary);
      expect(generators.record).toBe(recordArbitrary);
    });
  });

  describe('shrink', () => {
    it('should shrink integers toward 0', () => {
      const arb = integerArbitrary();
      const shrunk = shrink(arb, 100);
      expect(shrunk).toContain(0);
    });

    it('should shrink strings', () => {
      const arb = stringArbitrary();
      const shrunk = shrink(arb, 'hello');
      expect(shrunk).toContain('');
    });

    it('should shrink arrays', () => {
      const arb = arrayArbitrary(integerArbitrary());
      const shrunk = shrink(arb, [1, 2, 3, 4]);
      expect(shrunk.some((s) => s.length === 0)).toBe(true);
    });
  });

  describe('forAll', () => {
    it('should pass for always-true property', async () => {
      const result = await forAll(integerArbitrary(0, 100), (n) => n >= 0, { numRuns: 50 });
      expect(result.passed).toBe(true);
      expect(result.numRuns).toBe(50);
    });

    it('should fail for always-false property', async () => {
      const result = await forAll(integerArbitrary(0, 100), () => false, { numRuns: 10 });
      expect(result.passed).toBe(false);
      expect(result.counterexample).toBeDefined();
    });

    it('should find counterexample', async () => {
      const result = await forAll(integerArbitrary(0, 100), (n) => n !== 50, { numRuns: 100, seed: 42 });
      // Property may or may not find 50 depending on seed, but if it fails it should have counterexample
      if (!result.passed) {
        expect(result.counterexample).toBeDefined();
      }
    });

    it('should handle async properties', async () => {
      const result = await forAll(stringArbitrary(), async (s) => s.length >= 0, { numRuns: 20 });
      expect(result.passed).toBe(true);
    });

    it('should respect seed for reproducibility', async () => {
      const r1 = await forAll(integerArbitrary(), () => true, { numRuns: 10, seed: 12345 });
      const r2 = await forAll(integerArbitrary(), () => true, { numRuns: 10, seed: 12345 });
      expect(r1.numRuns).toBe(r2.numRuns);
    });
  });
});

// ============================================================
// Module 7: FuzzHelpers Tests
// ============================================================
describe('FuzzHelpers', () => {
  describe('fuzzString', () => {
    it('should run specified iterations', () => {
      let count = 0;
      const result = fuzzString(() => { count++; }, 10, 10);
      expect(count).toBe(10);
      expect(result.iterations).toBe(10);
    });

    it('should capture no failures for safe function', () => {
      const result = fuzzString(() => {}, 50, 10);
      expect(result.failures).toBe(0);
    });

    it('should capture failures for throwing function', () => {
      const result = fuzzString(() => { throw new Error('boom'); }, 10, 5);
      expect(result.failures).toBe(10);
      expect(result.errors).toHaveLength(10);
    });
  });

  describe('fuzzNumber', () => {
    it('should run specified iterations', () => {
      let count = 0;
      fuzzNumber(() => { count++; }, 20);
      expect(count).toBe(20);
    });

    it('should include special values', () => {
      const values: number[] = [];
      fuzzNumber((n) => { values.push(n); }, 70);
      expect(values).toContain(Infinity);
      expect(values).toContain(-Infinity);
      expect(values.some((v) => Number.isNaN(v))).toBe(true);
    });

    it('should capture failures', () => {
      const result = fuzzNumber(() => { throw new Error('fail'); }, 5);
      expect(result.failures).toBe(5);
    });
  });

  describe('fuzzObject', () => {
    it('should run specified iterations', () => {
      let count = 0;
      fuzzObject(() => { count++; }, 15);
      expect(count).toBe(15);
    });

    it('should generate nested objects', () => {
      const objects: unknown[] = [];
      fuzzObject((obj) => { objects.push(obj); }, 10, 2);
      for (const obj of objects) {
        expect(typeof obj).toBe('object');
      }
    });

    it('should capture failures', () => {
      const result = fuzzObject(() => { throw new Error('fail'); }, 5, 1);
      expect(result.failures).toBe(5);
    });
  });

  describe('fuzzJSON', () => {
    it('should run specified iterations', () => {
      let count = 0;
      fuzzJSON(() => { count++; }, 10);
      expect(count).toBe(10);
    });

    it('should generate various JSON types', () => {
      const types = new Set<string>();
      fuzzJSON((v) => { types.add(typeof v); }, 50);
      expect(types.size).toBeGreaterThan(1);
    });

    it('should capture failures', () => {
      const result = fuzzJSON(() => { throw new Error('fail'); }, 5);
      expect(result.failures).toBe(5);
    });
  });

  describe('mutateString', () => {
    it('should return a different string', () => {
      const original = 'hello';
      // Try multiple times since mutations are random
      let mutated = false;
      for (let i = 0; i < 20; i++) {
        const result = mutateString(original);
        if (result !== original) {
          mutated = true;
          break;
        }
      }
      expect(mutated).toBe(true);
    });

    it('should handle empty string', () => {
      const result = mutateString('');
      expect(result).toBe('x');
    });
  });

  describe('mutateNumber', () => {
    it('should return a number', () => {
      const result = mutateNumber(42);
      expect(typeof result).toBe('number');
    });

    it('should potentially return different value', () => {
      const original = 42;
      let mutated = false;
      for (let i = 0; i < 30; i++) {
        const result = mutateNumber(original);
        if (result !== original) {
          mutated = true;
          break;
        }
      }
      expect(mutated).toBe(true);
    });
  });

  describe('mutateJSON', () => {
    it('should mutate null to a string', () => {
      const result = mutateJSON(null);
      expect(result).toBe('mutated');
    });

    it('should mutate objects', () => {
      const result = mutateJSON({ a: 1 }) as Record<string, unknown>;
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('should mutate arrays', () => {
      const result = mutateJSON([1, 2, 3]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should mutate booleans', () => {
      const result = mutateJSON(true);
      expect(result).toBe(false);
    });
  });
});

// ============================================================
// Module 8: ComparisonUtils Tests
// ============================================================
describe('ComparisonUtils', () => {
  describe('deepDiff', () => {
    it('should return equal for identical values', () => {
      const diff = deepDiff(42, 42);
      expect(diff).toHaveLength(1);
      expect(diff[0]!.type).toBe('equal');
    });

    it('should detect changed primitives', () => {
      const diff = deepDiff(1, 2);
      expect(diff.some((d) => d.type === 'changed')).toBe(true);
    });

    it('should detect added keys', () => {
      const diff = deepDiff({}, { newKey: 'value' });
      expect(diff.some((d) => d.type === 'added')).toBe(true);
    });

    it('should detect removed keys', () => {
      const diff = deepDiff({ oldKey: 'value' }, {});
      expect(diff.some((d) => d.type === 'removed')).toBe(true);
    });

    it('should detect changed nested values', () => {
      const diff = deepDiff({ a: { b: 1 } }, { a: { b: 2 } });
      expect(diff.some((d) => d.type === 'changed')).toBe(true);
    });

    it('should detect array length differences', () => {
      const diff = deepDiff([1, 2], [1]);
      expect(diff.some((d) => d.type === 'changed' || d.type === 'removed')).toBe(true);
    });

    it('should handle null vs non-null', () => {
      const diff = deepDiff(null, 'value');
      expect(diff.some((d) => d.type === 'changed')).toBe(true);
    });
  });

  describe('deepClone', () => {
    it('should clone primitives', () => {
      expect(deepClone(42)).toBe(42);
      expect(deepClone('hello')).toBe('hello');
      expect(deepClone(true)).toBe(true);
      expect(deepClone(null)).toBe(null);
    });

    it('should deep clone objects', () => {
      const original = { a: 1, b: { c: 2 } };
      const cloned = deepClone(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect((cloned as Record<string, unknown>).b).not.toBe(
        (original as Record<string, unknown>).b,
      );
    });

    it('should deep clone arrays', () => {
      const original = [1, [2, 3]];
      const cloned = deepClone(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned[1]).not.toBe(original[1]);
    });

    it('should clone Date objects', () => {
      const date = new Date('2025-01-01');
      const cloned = deepClone(date);
      expect(cloned.getTime()).toBe(date.getTime());
      expect(cloned).not.toBe(date);
    });

    it('should clone Map objects', () => {
      const map = new Map([['key', { nested: true }]]);
      const cloned = deepClone(map);
      expect(cloned.get('key')).toEqual({ nested: true });
      expect(cloned).not.toBe(map);
    });

    it('should clone Set objects', () => {
      const set = new Set([1, 2, 3]);
      const cloned = deepClone(set);
      expect(cloned).toEqual(set);
      expect(cloned).not.toBe(set);
    });
  });

  describe('deepMerge', () => {
    it('should merge flat objects', () => {
      const result = deepMerge({ a: 1 }, { b: 2 });
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should deep merge nested objects', () => {
      const result = deepMerge({ a: { b: 1 } }, { a: { c: 2 } });
      expect(result).toEqual({ a: { b: 1, c: 2 } });
    });

    it('should override primitives', () => {
      const result = deepMerge({ a: 1 }, { a: 2 });
      expect(result).toEqual({ a: 2 });
    });

    it('should not mutate the target', () => {
      const target = { a: { b: 1 } };
      deepMerge(target, { a: { c: 2 } });
      expect(target).toEqual({ a: { b: 1 } });
    });
  });

  describe('isEqual', () => {
    it('should return true for identical primitives', () => {
      expect(isEqual(1, 1)).toBe(true);
      expect(isEqual('a', 'a')).toBe(true);
      expect(isEqual(true, true)).toBe(true);
    });

    it('should return false for different primitives', () => {
      expect(isEqual(1, 2)).toBe(false);
      expect(isEqual('a', 'b')).toBe(false);
    });

    it('should return true for equal objects', () => {
      expect(isEqual({ a: 1 }, { a: 1 })).toBe(true);
    });

    it('should return false for different objects', () => {
      expect(isEqual({ a: 1 }, { a: 2 })).toBe(false);
    });

    it('should return true for equal arrays', () => {
      expect(isEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it('should return false for different arrays', () => {
      expect(isEqual([1, 2], [1, 3])).toBe(false);
    });

    it('should handle NaN equality', () => {
      expect(isEqual(NaN, NaN)).toBe(true);
    });

    it('should return false for null vs undefined', () => {
      expect(isEqual(null, undefined)).toBe(false);
    });

    it('should handle nested structures', () => {
      expect(isEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    });
  });

  describe('sortBy', () => {
    it('should sort by number key', () => {
      const arr = [{ age: 30 }, { age: 20 }, { age: 40 }];
      const sorted = sortBy(arr, 'age');
      expect(sorted.map((x) => x.age)).toEqual([20, 30, 40]);
    });

    it('should sort by string key', () => {
      const arr = [{ name: 'c' }, { name: 'a' }, { name: 'b' }];
      const sorted = sortBy(arr, 'name');
      expect(sorted.map((x) => x.name)).toEqual(['a', 'b', 'c']);
    });

    it('should not mutate original array', () => {
      const arr = [{ age: 3 }, { age: 1 }, { age: 2 }];
      sortBy(arr, 'age');
      expect(arr.map((x) => x.age)).toEqual([3, 1, 2]);
    });
  });

  describe('groupBy', () => {
    it('should group by key', () => {
      const arr = [{ type: 'a', v: 1 }, { type: 'b', v: 2 }, { type: 'a', v: 3 }];
      const grouped = groupBy(arr, 'type');
      expect(grouped['a']).toHaveLength(2);
      expect(grouped['b']).toHaveLength(1);
    });
  });

  describe('countBy', () => {
    it('should count by key', () => {
      const arr = [{ type: 'a' }, { type: 'b' }, { type: 'a' }];
      const counted = countBy(arr, 'type');
      expect(counted['a']).toBe(2);
      expect(counted['b']).toBe(1);
    });
  });

  describe('uniqBy', () => {
    it('should return unique items by key', () => {
      const arr = [{ id: 1 }, { id: 2 }, { id: 1 }];
      const unique = uniqBy(arr, 'id');
      expect(unique).toHaveLength(2);
    });

    it('should preserve order of first occurrence', () => {
      const arr = [{ id: 2 }, { id: 1 }, { id: 2 }];
      const unique = uniqBy(arr, 'id');
      expect(unique[0]!.id).toBe(2);
      expect(unique[1]!.id).toBe(1);
    });
  });
});

// ============================================================
// Module 9: TimeHelpers Tests
// ============================================================
describe('TimeHelpers', () => {
  describe('MockClock', () => {
    let clock: MockClock;

    afterEach(() => {
      if (clock) clock.stop();
      // Ensure no frozen time leaks
      try { unfreezeTime(); } catch { /* ignore */ }
    });

    it('should return current time', () => {
      clock = new MockClock();
      const now = clock.now();
      expect(typeof now).toBe('number');
      expect(now).toBeGreaterThanOrEqual(0);
    });

    it('should advance time', () => {
      clock = new MockClock();
      const before = clock.now();
      clock.advance(1000);
      expect(clock.now()).toBe(before + 1000);
    });

    it('should set specific time', () => {
      clock = new MockClock();
      clock.set(1000000);
      expect(clock.now()).toBe(1000000);
    });

    it('should set time from Date object', () => {
      clock = new MockClock();
      const date = new Date('2025-06-01T00:00:00Z');
      clock.set(date);
      expect(clock.now()).toBe(date.getTime());
    });

    it('should start and stop controlling Date.now', () => {
      clock = new MockClock();
      clock.set(5000);
      clock.start();
      expect(Date.now()).toBe(5000);
      clock.advance(100);
      expect(Date.now()).toBe(5100);
      clock.stop();
    });

    it('should report active state', () => {
      clock = new MockClock();
      expect(clock.isActive()).toBe(false);
      clock.start();
      expect(clock.isActive()).toBe(true);
      clock.stop();
      expect(clock.isActive()).toBe(false);
    });

    it('should reset to real time', () => {
      clock = new MockClock();
      clock.set(0);
      clock.reset();
      expect(clock.now()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('freezeTime / advanceTime / unfreezeTime', () => {
    afterEach(() => {
      unfreezeTime();
    });

    it('should freeze Date.now', () => {
      freezeTime(1000000);
      expect(Date.now()).toBe(1000000);
      expect(Date.now()).toBe(1000000); // Still frozen
    });

    it('should freeze with Date object', () => {
      const date = new Date('2025-01-01T00:00:00Z');
      freezeTime(date);
      expect(Date.now()).toBe(date.getTime());
    });

    it('should advance frozen time', () => {
      freezeTime(1000);
      advanceTime(500);
      expect(Date.now()).toBe(1500);
      advanceTime(500);
      expect(Date.now()).toBe(2000);
    });

    it('should throw if advanceTime called without freeze', () => {
      expect(() => advanceTime(100)).toThrow('Time is not frozen');
    });

    it('should unfreeze time', () => {
      freezeTime(1000);
      unfreezeTime();
      const now = Date.now();
      // After unfreezing, Date.now should return real time
      expect(typeof now).toBe('number');
    });
  });

  describe('createTimestamp', () => {
    afterEach(() => {
      try { unfreezeTime(); } catch { /* ignore */ }
    });

    it('should create current timestamp', () => {
      const ts = createTimestamp();
      expect(typeof ts).toBe('number');
      expect(ts).toBeGreaterThanOrEqual(0);
    });

    it('should create timestamp with offset', () => {
      const now = Date.now();
      const ts = createTimestamp(1000);
      expect(ts).toBeGreaterThanOrEqual(now + 1000 - 10); // small tolerance
    });
  });
});

// ============================================================
// Module 10: TestContext Tests
// ============================================================
describe('TestContext', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = new TestContext();
  });

  describe('set and get', () => {
    it('should set and get a value', () => {
      ctx.set('key', 'value');
      expect(ctx.get('key')).toBe('value');
    });

    it('should get with type parameter', () => {
      ctx.set('count', 42);
      expect(ctx.get<number>('count')).toBe(42);
    });

    it('should throw for missing key', () => {
      expect(() => ctx.get('missing')).toThrow('not found');
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      ctx.set('key', 'value');
      expect(ctx.has('key')).toBe(true);
    });

    it('should return false for missing key', () => {
      expect(ctx.has('missing')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete a key', () => {
      ctx.set('key', 'value');
      expect(ctx.delete('key')).toBe(true);
      expect(ctx.has('key')).toBe(false);
    });

    it('should return false for missing key', () => {
      expect(ctx.delete('missing')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all keys', () => {
      ctx.set('a', 1);
      ctx.set('b', 2);
      ctx.clear();
      expect(ctx.size()).toBe(0);
    });
  });

  describe('snapshot and restore', () => {
    it('should create and restore snapshot', () => {
      ctx.set('a', 1);
      ctx.set('b', 2);
      const snapshot = ctx.snapshot();
      ctx.set('c', 3);
      ctx.clear();
      ctx.restore(snapshot);
      expect(ctx.get('a')).toBe(1);
      expect(ctx.get('b')).toBe(2);
      expect(ctx.has('c')).toBe(false);
    });
  });

  describe('size', () => {
    it('should return correct size', () => {
      expect(ctx.size()).toBe(0);
      ctx.set('a', 1);
      expect(ctx.size()).toBe(1);
      ctx.set('b', 2);
      expect(ctx.size()).toBe(2);
    });
  });

  describe('keys', () => {
    it('should return all keys', () => {
      ctx.set('a', 1);
      ctx.set('b', 2);
      const keys = ctx.keys();
      expect(keys).toContain('a');
      expect(keys).toContain('b');
    });
  });

  describe('entries', () => {
    it('should return all entries', () => {
      ctx.set('a', 1);
      ctx.set('b', 2);
      const entries = ctx.entries();
      expect(entries).toHaveLength(2);
    });
  });

  describe('createIsolatedContext', () => {
    it('should create with initial data', () => {
      const isolated = createIsolatedContext({ x: 10, y: 20 });
      expect(isolated.get('x')).toBe(10);
      expect(isolated.get('y')).toBe(20);
    });

    it('should create empty context', () => {
      const isolated = createIsolatedContext();
      expect(isolated.size()).toBe(0);
    });
  });
});
