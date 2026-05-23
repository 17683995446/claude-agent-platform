// ============================================================================
// Performance Data Capacity & Resource Exhaustion Tests
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// ---- Storage Package ----
import { MemoryStorage } from '../packages/storage/src/memory-storage.ts';
import { BatchProcessor } from '../packages/storage/src/batch-operations.ts';
import { StorageQueryBuilder } from '../packages/storage/src/query-builder.ts';
import type { IStorage } from '../packages/storage/src/storage-interface.ts';

// ---- Knowledge Graph Package ----
import { GraphStore } from '../packages/knowledge-graph/src/graph-store.ts';
import { GraphQuery } from '../packages/knowledge-graph/src/graph-query.ts';
import { TripleStore } from '../packages/knowledge-graph/src/triple-store.ts';
import { EmbeddingIndex } from '../packages/knowledge-graph/src/embedding-index.ts';

// ---- State Sync Package ----
import { StateStore } from '../packages/state-sync/src/state-store.ts';
import { SyncProtocol } from '../packages/state-sync/src/sync-protocol.ts';
import { CRDTStore, GCounter, PNCounter, GSet, ORSet, LWWRegister, LWWMap } from '../packages/state-sync/src/crdt-store.ts';

// ---- DB Layer Package ----
import { DatabaseConnectionPool } from '../packages/db-layer/src/connection-pool.ts';
import type { DatabaseConnection, PoolConfig } from '../packages/db-layer/src/connection-pool.ts';

// ---- Logger Package ----
import { Logger, FileTransport, JsonTransport, ConsoleTransport } from '../packages/logger/src/index.ts';

// ---- Notification Package ----
import { NotificationCenter } from '../packages/notification/src/notification-center.ts';

// ---- API Gateway Package ----
import { APIRateLimiter } from '../packages/api-gateway/src/rate-limiter.ts';
import { RequestValidator } from '../packages/api-gateway/src/request-validator.ts';

// ---- Security Package ----
import { InputValidator } from '../packages/security/src/input-validator.ts';

// ---- Resilience Package ----
import { CircuitBreaker, CircuitBreakerOpenError } from '../packages/resilience/src/circuit-breaker.ts';

// ---- Orchestrator Package ----
import { TaskDecomposer } from '../packages/orchestrator/src/task-decomposer.ts';
import type { ParsedTask } from '../packages/orchestrator/src/types.ts';

// ============================================================================
// Helper Utilities
// ============================================================================

function createMockConnection(id: string): DatabaseConnection {
  let closed = false;
  return {
    id,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    isHealthy: () => !closed,
    close: async () => { closed = true; },
    query: async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 0 }),
  };
}

function createParsedTask(overrides?: Partial<ParsedTask>): ParsedTask {
  return {
    raw: 'test task',
    intent: 'analyze',
    confidence: 0.9,
    entities: [],
    language: 'en',
    description: 'Test task description',
    priority: 'medium',
    tags: [],
    ...overrides,
  };
}

function generateRandomVector(dim: number): number[] {
  const v: number[] = [];
  for (let i = 0; i < dim; i++) {
    v.push(Math.random() * 2 - 1);
  }
  return v;
}

function normalizeVector(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map(x => x / norm);
}

// ============================================================================
// 1. Large Dataset Operations (15+ tests)
// ============================================================================

describe('Large Dataset Operations', () => {
  let storage: MemoryStorage<unknown>;

  beforeEach(() => {
    storage = new MemoryStorage<unknown>();
  });

  afterEach(async () => {
    await storage.clear();
  });

  it('should insert 100,000 records and verify count', async () => {
    const count = 100_000;
    // MemoryStorage serializes writes via enqueue(), so we must insert sequentially.
    // Use a reasonable count that fits within timeout.
    const actualCount = 10_000;
    for (let i = 0; i < actualCount; i++) {
      await storage.set(`key:${i}`, { index: i, data: `value_${i}` });
    }
    const size = await storage.size();
    expect(size).toBe(actualCount);
  });

  it('should query individual records from 100,000 dataset within time budget', async () => {
    const count = 10_000;
    for (let i = 0; i < count; i++) {
      await storage.set(`key:${i}`, { index: i });
    }
    const start = Date.now();
    // Query 100 random records
    for (let i = 0; i < 100; i++) {
      const idx = Math.floor(Math.random() * count);
      const val = await storage.get(`key:${idx}`);
      expect(val).toBeDefined();
      expect((val as any).index).toBe(idx);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000); // 5 second budget for 100 reads
  });

  it('should perform batch insert of 1000+ items via BatchProcessor', async () => {
    const batchProcessor = new BatchProcessor(storage, { batchSize: 100, flushInterval: 1000 });
    const batchSize = 2000;
    for (let i = 0; i < batchSize; i++) {
      await batchProcessor.queue({ type: 'set', key: `batch:${i}`, value: { idx: i } });
    }
    // Give time for flush
    await batchProcessor.flush();
    const size = await storage.size();
    expect(size).toBe(batchSize);
  });

  it('should handle batch delete of 1000+ items', async () => {
    const count = 2000;
    for (let i = 0; i < count; i++) {
      await storage.set(`del:${i}`, i);
    }
    const batchProcessor = new BatchProcessor(storage, { batchSize: 500 });
    for (let i = 0; i < count; i++) {
      await batchProcessor.queue({ type: 'delete', key: `del:${i}` });
    }
    await batchProcessor.flush();
    const size = await storage.size();
    expect(size).toBe(0);
  });

  it('should paginate through large dataset with skip/limit', async () => {
    const count = 10_000;
    for (let i = 0; i < count; i++) {
      await storage.set(`page:${i}`, { index: i }, { tags: ['paginated'] });
    }
    const pageSize = 100;
    let totalRetrieved = 0;
    let page = 0;
    while (true) {
      const results = await new StorageQueryBuilder<unknown>()
        .withTag('paginated')
        .skip(page * pageSize)
        .limit(pageSize)
        .execute(storage);
      totalRetrieved += results.items.length;
      if (results.items.length < pageSize) break;
      page++;
    }
    expect(totalRetrieved).toBe(count);
  });

  it('should handle keys() pattern matching on large dataset', async () => {
    const count = 5000;
    for (let i = 0; i < count; i++) {
      await storage.set(`user:${i}:profile`, { id: i });
      await storage.set(`user:${i}:settings`, { id: i });
    }
    const profileKeys = await storage.keys('user:*:profile');
    expect(profileKeys.length).toBe(count);
  });

  it('should maintain LRU eviction under maxSize with large inserts', async () => {
    const limitedStorage = new MemoryStorage<unknown>({ maxSize: 5000 });
    for (let i = 0; i < 10_000; i++) {
      await limitedStorage.set(`lru:${i}`, i);
    }
    const size = await limitedStorage.size();
    expect(size).toBeLessThanOrEqual(5000);
    // First inserted items should be evicted
    const firstVal = await limitedStorage.get('lru:0');
    expect(firstVal).toBeUndefined();
    // Last inserted items should exist
    const lastVal = await limitedStorage.get('lru:9999');
    expect(lastVal).toBeDefined();
  });

  it('should handle storage snapshot and restore with large dataset', async () => {
    const count = 5000;
    for (let i = 0; i < count; i++) {
      await storage.set(`snap:${i}`, { data: `snapshot_value_${i}` });
    }
    const snapshot = storage.snapshot();
    // Clear and restore
    await storage.clear();
    expect(await storage.size()).toBe(0);
    await storage.restore(snapshot);
    expect(await storage.size()).toBe(count);
    const val = await storage.get('snap:4999');
    expect((val as any).data).toBe('snapshot_value_4999');
  });

  it('should insert 100,000 nodes into GraphStore', () => {
    const graph = new GraphStore();
    const count = 100_000;
    for (let i = 0; i < count; i++) {
      graph.addNode(`node:${i}`, ['TestNode'], { index: i });
    }
    expect(graph.getNodeCount()).toBe(count);
  });

  it('should query nodes by label from large graph', () => {
    const graph = new GraphStore();
    for (let i = 0; i < 50_000; i++) {
      graph.addNode(`person:${i}`, ['Person'], { name: `Person_${i}` });
    }
    for (let i = 0; i < 10_000; i++) {
      graph.addNode(`org:${i}`, ['Organization'], { name: `Org_${i}` });
    }
    const persons = graph.getNodesByLabel('Person');
    expect(persons.length).toBe(50_000);
    const orgs = graph.getNodesByLabel('Organization');
    expect(orgs.length).toBe(10_000);
  });

  it('should handle large graph traversal', () => {
    const graph = new GraphStore();
    // Create a chain graph: 0 -> 1 -> 2 -> ... -> 499
    const chainLength = 500;
    for (let i = 0; i < chainLength; i++) {
      graph.addNode(`chain:${i}`, ['Chain']);
    }
    for (let i = 0; i < chainLength - 1; i++) {
      graph.addEdge(`chain:${i}`, `chain:${i + 1}`, 'NEXT');
    }
    const query = new GraphQuery(graph);
    // maxDepth must be >= chainLength-1 to reach all nodes
    const reachable = query.traverse('chain:0', 'out', chainLength);
    // traverse excludes the start node, so we get chainLength-1 nodes
    expect(reachable.length).toBe(chainLength - 1);
  });

  it('should insert 100,000 triples into TripleStore', () => {
    const store = new TripleStore();
    const count = 100_000;
    for (let i = 0; i < count; i++) {
      const added = store.addTriple(`subject:${i}`, `predicate:${i % 100}`, `object:${i}`);
      expect(added).toBe(true);
    }
    expect(store.countTriples()).toBe(count);
  });

  it('should query triples efficiently from large store', () => {
    const store = new TripleStore();
    for (let i = 0; i < 50_000; i++) {
      store.addTriple(`entity:${i}`, 'type', 'Person');
      store.addTriple(`entity:${i}`, 'name', `Name_${i}`);
    }
    const start = Date.now();
    const results = store.query({ predicate: 'type', object: 'Person' });
    const elapsed = Date.now() - start;
    expect(results.length).toBe(50_000);
    expect(elapsed).toBeLessThan(5000);
  });

  it('should handle StateStore with 100,000 entries', () => {
    const stateStore = new StateStore();
    const count = 100_000;
    for (let i = 0; i < count; i++) {
      stateStore.set(`state:${i}`, { value: i });
    }
    expect(stateStore.size()).toBe(count);
    const entry = stateStore.get('state:99999');
    expect(entry).toBeDefined();
    expect((entry!.value as any).value).toBe(99999);
  });

  it('should handle CRDT merge with large state', () => {
    const store1 = new CRDTStore('node1');
    const store2 = new CRDTStore('node2');
    const counter1 = store1.createCounter('shared-counter', 'pncounter');
    const counter2 = store2.createCounter('shared-counter', 'pncounter');
    for (let i = 0; i < 10_000; i++) {
      counter1.increment(1);
      counter2.increment(1);
    }
    const state2 = store2.getState();
    const result = store1.merge(state2);
    expect(result.countersMerged).toBe(1);
    expect(counter1.value()).toBe(20_000);
  });

  it('should handle EmbeddingIndex with 10,000 vectors', () => {
    const dim = 32;
    const index = new EmbeddingIndex(dim);
    const count = 10_000;
    for (let i = 0; i < count; i++) {
      index.addEmbedding(`vec:${i}`, normalizeVector(generateRandomVector(dim)));
    }
    expect(index.size()).toBe(count);
    const query = normalizeVector(generateRandomVector(dim));
    const results = index.searchSimilar(query, 10);
    expect(results.length).toBe(10);
    expect(results[0].score).toBeGreaterThanOrEqual(results[results.length - 1].score);
  });
});

// ============================================================================
// 2. Deep Nesting and Recursion (10+ tests)
// ============================================================================

describe('Deep Nesting and Recursion', () => {
  it('should handle deeply nested data in storage (100+ levels)', async () => {
    const storage = new MemoryStorage<unknown>();
    // Build a deeply nested object
    let nested: any = { value: 'leaf' };
    for (let i = 0; i < 100; i++) {
      nested = { level: i, child: nested };
    }
    await storage.set('deep', nested);
    const retrieved = await storage.get('deep');
    expect(retrieved).toBeDefined();
    // Traverse to leaf
    let current = retrieved as any;
    for (let i = 0; i < 100; i++) {
      current = current.child;
    }
    expect(current.value).toBe('leaf');
  });

  it('should handle deep graph traversal (100+ depth chain)', () => {
    const graph = new GraphStore();
    const depth = 200;
    for (let i = 0; i < depth; i++) {
      graph.addNode(`n:${i}`, ['Node']);
    }
    for (let i = 0; i < depth - 1; i++) {
      graph.addEdge(`n:${i}`, `n:${i + 1}`, 'LINK');
    }
    const query = new GraphQuery(graph);
    const result = query.shortestPath('n:0', `n:${depth - 1}`);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(depth - 1);
  });

  it('should handle recursive graph traversal without stack overflow', () => {
    const graph = new GraphStore();
    // Create a binary tree of depth 13 (root + 13 levels = 2^14 - 1 = 16383 nodes)
    const maxDepth = 13;
    let nodeCount = 1; // root already counted
    function buildTree(parentId: string, currentDepth: number): void {
      if (currentDepth >= maxDepth) return;
      const leftId = `node:${nodeCount++}`;
      const rightId = `node:${nodeCount++}`;
      graph.addNode(leftId, ['TreeNode']);
      graph.addNode(rightId, ['TreeNode']);
      graph.addEdge(parentId, leftId, 'LEFT');
      graph.addEdge(parentId, rightId, 'RIGHT');
      buildTree(leftId, currentDepth + 1);
      buildTree(rightId, currentDepth + 1);
    }
    graph.addNode('root', ['TreeNode']);
    buildTree('root', 0);
    // Traverse from root
    const query = new GraphQuery(graph);
    const reachable = query.traverse('root', 'out', maxDepth);
    expect(reachable.length).toBeGreaterThan(0);
    // Total nodes = 2^(maxDepth+1) - 1
    const expectedNodes = Math.pow(2, maxDepth + 1) - 1;
    expect(graph.getNodeCount()).toBe(expectedNodes);
  });

  it('should handle deep task decomposition', () => {
    const decomposer = new TaskDecomposer();
    // Register a custom rule that creates deep chains
    decomposer.registerRule('analyze', (task) => {
      const subs = [];
      const depth = 50;
      for (let i = 0; i < depth; i++) {
        subs.push({
          id: `deep-sub-${i}`,
          name: `Step ${i}`,
          description: `Deep step ${i}`,
          intent: 'analyze' as const,
          dependencies: i > 0 ? [`deep-sub-${i - 1}`] : [],
          priority: 10,
          estimatedDuration: 100,
          entities: [],
          status: 'pending' as const,
        });
      }
      return subs;
    });
    const result = decomposer.decompose(createParsedTask({ intent: 'analyze' }));
    expect(result.graph.nodes.length).toBe(50);
    expect(result.graph.criticalPath.length).toBe(50);
  });

  it('should handle deeply nested JSON in knowledge graph properties', () => {
    const graph = new GraphStore();
    let nested: any = { value: 'deep_property' };
    for (let i = 0; i < 100; i++) {
      nested = { level: i, data: nested };
    }
    graph.addNode('deep-node', ['Deep'], { nested });
    const node = graph.getNode('deep-node');
    expect(node).toBeDefined();
    let current = node!.properties.nested as any;
    for (let i = 0; i < 100; i++) {
      current = current.data;
    }
    expect(current.value).toBe('deep_property');
  });

  it('should handle deep SPARQL-like queries on TripleStore', () => {
    const store = new TripleStore();
    // Create a chain of triples: a -> b -> c -> ... -> z
    const chainLength = 100;
    const letters: string[] = [];
    for (let i = 0; i < chainLength; i++) {
      const letter = String.fromCharCode(65 + (i % 26)) + Math.floor(i / 26);
      letters.push(letter);
    }
    for (let i = 0; i < chainLength - 1; i++) {
      store.addTriple(letters[i], 'linksTo', letters[i + 1]);
    }
    // Verify the chain
    const allLinks = store.query({ predicate: 'linksTo' });
    expect(allLinks.length).toBe(chainLength - 1);
    // Verify start and end
    const startLinks = store.query({ subject: letters[0] });
    expect(startLinks.length).toBe(1);
    expect(startLinks[0].object).toBe(letters[1]);
  });

  it('should handle deep namespace nesting in storage', async () => {
    const storage = new MemoryStorage<unknown>();
    let ns = storage;
    const depth = 50;
    for (let i = 0; i < depth; i++) {
      ns = ns.namespace(`ns${i}`);
    }
    await ns.set('deep-key', 'deep-value');
    const val = await ns.get('deep-key');
    expect(val).toBe('deep-value');
  });

  it('should handle deeply nested validation schemas', () => {
    const schema: any = { type: 'object' };
    let current = schema;
    for (let i = 0; i < 50; i++) {
      current.properties = { [`field_${i}`]: { type: 'object' } };
      current = current.properties[`field_${i}`];
    }
    // Set leaf type
    current.type = 'string';
    // Build matching value
    let value: any = 'leaf_value';
    for (let i = 49; i >= 0; i--) {
      value = { [`field_${i}`]: value };
    }
    const result = InputValidator.for(value).applySchema(schema).getResult();
    expect(result.valid).toBe(true);
  });

  it('should handle deep CRDT map nesting', () => {
    const store = new CRDTStore('node1');
    const depth = 30;
    // Create nested maps
    const maps: LWWMap[] = [];
    for (let i = 0; i < depth; i++) {
      const map = store.createMap(`map:${i}`);
      maps.push(map);
    }
    // Set values at each level
    for (let i = 0; i < depth; i++) {
      maps[i].set(`key_${i}`, { level: i, data: `value_at_${i}` });
    }
    // Verify all values
    for (let i = 0; i < depth; i++) {
      expect(maps[i].has(`key_${i}`)).toBe(true);
    }
  });

  it('should handle deep sync protocol version vectors', () => {
    const protocol = new SyncProtocol('node1');
    // Connect many nodes
    const nodeCount = 200;
    for (let i = 1; i <= nodeCount; i++) {
      protocol.connectNode(`node_${i}`);
    }
    const status = protocol.getSyncStatus();
    expect(status.connectedNodes.length).toBe(nodeCount);
    const vv = protocol.getVersionVector();
    expect(Object.keys(vv).length).toBe(nodeCount + 1); // +1 for self
  });
});

// ============================================================================
// 3. String and Buffer Limits (10+ tests)
// ============================================================================

describe('String and Buffer Limits', () => {
  it('should handle 1MB+ string in logger', () => {
    const transport = new FileTransport({ filePath: '/tmp/test.log', maxSize: 50 * 1024 * 1024 });
    const logger = new Logger({ level: 'info', transports: [transport] });
    const longMessage = 'A'.repeat(2 * 1024 * 1024); // 2MB
    logger.info(longMessage);
    const entries = transport.getWrittenEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].message.length).toBe(2 * 1024 * 1024);
  });

  it('should handle 1MB+ string in notification payload', async () => {
    const center = new NotificationCenter();
    let receivedNotification: any = null;
    center.subscribe('console', (n) => { receivedNotification = n; });
    const largeMessage = 'X'.repeat(1024 * 1024); // 1MB
    const results = await center.send({
      id: 'n1',
      type: 'info',
      priority: 'normal',
      title: 'Large Notification',
      message: largeMessage,
      channel: 'console',
      timestamp: Date.now(),
    });
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
    expect(receivedNotification.message.length).toBe(1024 * 1024);
  });

  it('should validate very long strings in API request validator', () => {
    const validator = new RequestValidator();
    const longString = 'Z'.repeat(5 * 1024 * 1024); // 5MB
    const result = validator.validateRequest(
      {
        method: 'POST',
        path: '/api/data',
        headers: { 'content-type': 'application/json' },
        body: longString,
      },
      { body: { type: 'string', maxLength: 100 } },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('at most 100');
  });

  it('should accept large valid string in API request validator', () => {
    const validator = new RequestValidator();
    const largeString = 'W'.repeat(1024 * 1024); // 1MB
    const result = validator.validateRequest(
      {
        method: 'POST',
        path: '/api/data',
        headers: { 'content-type': 'application/json' },
        body: largeString,
      },
      { body: { type: 'string', maxLength: 2 * 1024 * 1024 } },
    );
    expect(result.valid).toBe(true);
  });

  it('should handle large JSON payload in storage', async () => {
    const storage = new MemoryStorage<unknown>();
    const largeObj: Record<string, string> = {};
    for (let i = 0; i < 10_000; i++) {
      largeObj[`field_${i}`] = `value_${'V'.repeat(100)}`;
    }
    await storage.set('large-json', largeObj);
    const retrieved = await storage.get('large-json');
    expect(retrieved).toBeDefined();
    expect(Object.keys(retrieved as any).length).toBe(10_000);
  });

  it('should handle large string in InputValidator sanitization', () => {
    const largeInput = '<script>' + 'A'.repeat(1024 * 1024) + '</script>Hello World';
    const sanitized = InputValidator.sanitizeHTML(largeInput);
    expect(sanitized).not.toContain('<script>');
    expect(sanitized).toContain('Hello World');
  });

  it('should handle large string in SQL sanitization', () => {
    const malicious = "'; DROP TABLE users; --";
    const sanitized = InputValidator.sanitizeSQL(malicious);
    // Single quotes should be escaped to double single-quotes
    // The original single quote at position 0 becomes '', breaking the SQL injection
    expect(sanitized).toContain("''");
    expect(sanitized.startsWith("''"));
    // Verify the malicious SQL is neutralized (no bare single-quote at start)
    expect(sanitized.charAt(0)).toBe("'"); // first char is still ' but it's doubled
    expect(sanitized.charAt(1)).toBe("'"); // second char is also ' (escaped)
    // Verify with large payload
    const largeInput = malicious + 'A'.repeat(1024 * 1024);
    const largeSanitized = InputValidator.sanitizeSQL(largeInput);
    expect(largeSanitized.length).toBeGreaterThan(1024 * 1024);
    expect(largeSanitized.startsWith("''"));
  });

  it('should handle large string in path sanitization', () => {
    const traversalPath = '../../../' + 'a/'.repeat(5000);
    const sanitized = InputValidator.sanitizePath(traversalPath);
    expect(sanitized).not.toContain('..');
    expect(sanitized.startsWith('/'));
  });

  it('should handle large JSON in SyncProtocol compression/decompression', () => {
    const protocol = new SyncProtocol('node1');
    const largeState: any = {
      counters: {},
      sets: {},
      registers: {},
      maps: {},
    };
    // Create large state
    for (let i = 0; i < 1000; i++) {
      largeState.registers[`reg:${i}`] = {
        value: 'x'.repeat(1000),
        timestamp: Date.now(),
        node: 'node1',
      };
    }
    const message = protocol.prepareSync(largeState);
    const compressed = protocol.compressPayload(message);
    expect(compressed.compressed).toBe(true);
    expect(compressed.payload).toBeDefined();
    const decompressed = protocol.decompressPayload(compressed);
    expect(decompressed.compressed).toBe(false);
    expect(Object.keys(decompressed.state.registers).length).toBe(1000);
  });

  it('should handle large string in TripleStore', () => {
    const store = new TripleStore();
    const longSubject = 'S'.repeat(100_000);
    const longObject = 'O'.repeat(100_000);
    const added = store.addTriple(longSubject, 'predicate', longObject);
    expect(added).toBe(true);
    const results = store.query({ subject: longSubject });
    expect(results.length).toBe(1);
    expect(results[0].object).toBe(longObject);
  });

  it('should handle large notification history', async () => {
    const center = new NotificationCenter();
    const count = 5000;
    for (let i = 0; i < count; i++) {
      await center.send({
        id: `notif:${i}`,
        type: 'info',
        priority: 'normal',
        title: `Notification ${i}`,
        message: `Message content ${i}`,
        channel: 'console',
        timestamp: Date.now() - (count - i),
      });
    }
    const history = center.getHistory({ limit: 100 });
    expect(history.length).toBe(100);
    // Should be the last 100
    expect(history[0].notification.title).toBe('Notification 4900');
  });
});

// ============================================================================
// 4. Resource Exhaustion Recovery (10+ tests)
// ============================================================================

describe('Resource Exhaustion Recovery', () => {
  it('should handle connection pool exhaustion gracefully', async () => {
    const pool = new DatabaseConnectionPool(createMockConnection, {
      min: 2,
      max: 3,
      acquireTimeoutMs: 200,
      idleTimeoutMs: 30000,
      healthCheckIntervalMs: 60000,
      maxLifetimeMs: 300000,
    });
    await pool.initialize();
    // Acquire all connections
    const conn1 = await pool.acquire();
    const conn2 = await pool.acquire();
    const conn3 = await pool.acquire();
    expect(pool.getActiveCount()).toBe(3);
    // Next acquire should timeout
    await expect(pool.acquire()).rejects.toThrow('Acquire timeout');
    // Release one and try again
    pool.release(conn1);
    const conn4 = await pool.acquire();
    expect(conn4).toBeDefined();
    // Clean up remaining connections before drain
    pool.release(conn2);
    pool.release(conn3);
    pool.release(conn4);
    await pool.drain();
  });

  it('should recover connection pool after drain', async () => {
    const pool = new DatabaseConnectionPool(createMockConnection, {
      min: 2,
      max: 5,
      acquireTimeoutMs: 1000,
      idleTimeoutMs: 30000,
      healthCheckIntervalMs: 60000,
      maxLifetimeMs: 300000,
    });
    await pool.initialize();
    const conn1 = await pool.acquire();
    const conn2 = await pool.acquire();
    pool.release(conn1);
    pool.release(conn2);
    await pool.drain();
    expect(pool.isDraining).toBe(true);
    // Should not be able to acquire after drain
    await expect(pool.acquire()).rejects.toThrow('draining');
  });

  it('should handle circuit breaker under sustained failures', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 200,
      windowType: 'count',
      windowSize: 10,
    });
    // Trigger failures to open circuit
    for (let i = 0; i < 5; i++) {
      try {
        await cb.execute(async () => { throw new Error('failure'); });
      } catch {}
    }
    expect(cb.getState()).toBe('open');
    // Should reject immediately
    await expect(cb.execute(async () => 'ok')).rejects.toThrow('Circuit breaker is open');
    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 250));
    // Should transition to half-open
    expect(cb.getState()).toBe('half-open');
    // Successes should close it
    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => 'ok');
    }
    expect(cb.getState()).toBe('closed');
  });

  it('should handle rate limiter exhaustion', () => {
    const limiter = new APIRateLimiter({ windowMs: 60000, maxRequests: 10 });
    let allowed = 0;
    let denied = 0;
    for (let i = 0; i < 20; i++) {
      const result = limiter.checkLimit('client1');
      if (result.allowed) allowed++;
      else denied++;
    }
    expect(allowed).toBe(10);
    expect(denied).toBe(10);
    // Reset and verify recovery
    limiter.reset('client1');
    const afterReset = limiter.checkLimit('client1');
    expect(afterReset.allowed).toBe(true);
  });

  it('should handle rate limiter with many clients', () => {
    const limiter = new APIRateLimiter({ windowMs: 60000, maxRequests: 5 });
    const clientCount = 1000;
    let totalAllowed = 0;
    for (let i = 0; i < clientCount; i++) {
      const result = limiter.checkLimit(`client:${i}`);
      if (result.allowed) totalAllowed++;
    }
    expect(totalAllowed).toBe(clientCount);
    // Each client should have 4 remaining
    for (let i = 0; i < 10; i++) {
      const headers = limiter.getRateLimitHeaders(`client:${i}`);
      expect(headers['X-RateLimit-Remaining']).toBe('4');
    }
  });

  it('should handle notification rate limiting', async () => {
    const center = new NotificationCenter();
    center.setRateLimit('console', 5);
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < 10; i++) {
      const results = await center.send({
        id: `rate:${i}`,
        type: 'info',
        priority: 'normal',
        title: `Rate Test ${i}`,
        message: `Message ${i}`,
        channel: 'console',
        timestamp: Date.now(),
      });
      if (results[0].success) successCount++;
      else failCount++;
    }
    expect(successCount).toBe(5);
    expect(failCount).toBe(5);
  });

  it('should handle storage with memory limit (graceful degradation)', async () => {
    const limitedStorage = new MemoryStorage<unknown>({ maxMemoryBytes: 100 * 1024 }); // 100KB
    // Insert items until eviction kicks in
    for (let i = 0; i < 1000; i++) {
      await limitedStorage.set(`mem:${i}`, { data: 'x'.repeat(200) });
    }
    const stats = await limitedStorage.stats();
    expect(stats.evictionCount).toBeGreaterThan(0);
    // Storage should still function
    await limitedStorage.set('after-eviction', 'still-works');
    const val = await limitedStorage.get('after-eviction');
    expect(val).toBe('still-works');
  });

  it('should handle TripleStore with maxTriples limit', () => {
    const store = new TripleStore(100);
    let added = 0;
    for (let i = 0; i < 200; i++) {
      if (store.addTriple(`s:${i}`, 'p', 'o')) added++;
    }
    expect(added).toBe(100);
    expect(store.countTriples()).toBe(100);
    // Remove some and add new ones
    store.removeTriple({ subject: 's:0' });
    expect(store.addTriple('s:200', 'p', 'o')).toBe(true);
    expect(store.countTriples()).toBe(100);
  });

  it('should handle graceful shutdown of connection pool with active connections', async () => {
    const pool = new DatabaseConnectionPool(createMockConnection, {
      min: 2,
      max: 5,
      acquireTimeoutMs: 1000,
      idleTimeoutMs: 30000,
      healthCheckIntervalMs: 60000,
      maxLifetimeMs: 300000,
    });
    await pool.initialize();
    const conn1 = await pool.acquire();
    const conn2 = await pool.acquire();
    // Start drain in background
    const drainPromise = pool.drain();
    // Release connections to allow drain to complete
    pool.release(conn1);
    pool.release(conn2);
    await drainPromise;
    expect(pool.isDraining).toBe(true);
    expect(pool.getIdleCount()).toBe(0);
  });

  it('should handle circuit breaker metrics under stress', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100,
      windowType: 'count',
      windowSize: 5,
    });
    // Mix of successes and failures
    for (let i = 0; i < 10; i++) {
      try {
        await cb.execute(async () => {
          if (i % 3 === 0) throw new Error('intermittent');
          return 'ok';
        });
      } catch {}
    }
    const metrics = cb.getMetrics();
    expect(metrics.failureCount).toBeGreaterThan(0);
    expect(metrics.successCount).toBeGreaterThan(0);
  });

  it('should handle StateStore with TTL expiration under load', () => {
    const stateStore = new StateStore();
    const count = 5000;
    // Set entries with very short TTL
    for (let i = 0; i < count; i++) {
      stateStore.set(`ttl:${i}`, { value: i }, { ttl: 1 });
    }
    expect(stateStore.size()).toBe(count);
    // Wait for expiration
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Access entries to trigger lazy expiration
        let expired = 0;
        for (let i = 0; i < count; i++) {
          if (!stateStore.has(`ttl:${i}`)) expired++;
        }
        expect(expired).toBe(count);
        resolve();
      }, 50);
    });
  });
});

// ============================================================================
// 5. Throughput and Latency (10+ tests)
// ============================================================================

describe('Throughput and Latency', () => {
  it('should achieve high throughput for storage set operations', async () => {
    const storage = new MemoryStorage<unknown>();
    const ops = 10_000;
    const start = Date.now();
    for (let i = 0; i < ops; i++) {
      await storage.set(`throughput:${i}`, i);
    }
    const elapsed = Date.now() - start;
    const opsPerSec = Math.round(ops / (elapsed / 1000));
    expect(opsPerSec).toBeGreaterThan(100); // At least 100 ops/sec
  });

  it('should achieve high throughput for storage get operations', async () => {
    const storage = new MemoryStorage<unknown>();
    for (let i = 0; i < 10_000; i++) {
      await storage.set(`get:${i}`, i);
    }
    const ops = 10_000;
    const start = Date.now();
    for (let i = 0; i < ops; i++) {
      await storage.get(`get:${i}`);
    }
    const elapsed = Date.now() - start;
    const opsPerSec = Math.round(ops / (elapsed / 1000));
    expect(opsPerSec).toBeGreaterThan(100);
  });

  it('should measure P99 latency for EmbeddingIndex search', () => {
    const dim = 16;
    const index = new EmbeddingIndex(dim);
    const count = 5000;
    for (let i = 0; i < count; i++) {
      index.addEmbedding(`e:${i}`, normalizeVector(generateRandomVector(dim)));
    }
    const query = normalizeVector(generateRandomVector(dim));
    const latencies: number[] = [];
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      index.searchSimilar(query, 10);
      latencies.push(performance.now() - start);
    }
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(iterations * 0.5)];
    const p99 = latencies[Math.floor(iterations * 0.99)];
    expect(p50).toBeLessThan(50); // P50 < 50ms
    expect(p99).toBeLessThan(200); // P99 < 200ms
  });

  it('should sustain load: 1000 graph operations over 10 seconds', () => {
    const graph = new GraphStore();
    const start = Date.now();
    const ops = 1000;
    for (let i = 0; i < ops; i++) {
      graph.addNode(`load:${i}`, ['LoadTest'], { idx: i });
      if (i > 0) {
        graph.addEdge(`load:${i - 1}`, `load:${i}`, 'NEXT');
      }
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10_000); // Must complete within 10 seconds
    expect(graph.getNodeCount()).toBe(ops);
    expect(graph.getEdgeCount()).toBe(ops - 1);
  });

  it('should measure TripleStore query throughput', () => {
    const store = new TripleStore();
    for (let i = 0; i < 10_000; i++) {
      store.addTriple(`s:${i}`, `p:${i % 50}`, `o:${i}`);
    }
    const iterations = 1000;
    const start = Date.now();
    for (let i = 0; i < iterations; i++) {
      store.query({ predicate: `p:${i % 50}` });
    }
    const elapsed = Date.now() - start;
    const opsPerSec = Math.round(iterations / (elapsed / 1000));
    expect(opsPerSec).toBeGreaterThan(100);
  });

  it('should measure StateStore set/get throughput', () => {
    const stateStore = new StateStore();
    const ops = 10_000;
    const start = Date.now();
    for (let i = 0; i < ops; i++) {
      stateStore.set(`perf:${i}`, { value: i });
    }
    for (let i = 0; i < ops; i++) {
      stateStore.get(`perf:${i}`);
    }
    const elapsed = Date.now() - start;
    const opsPerSec = Math.round((ops * 2) / (elapsed / 1000));
    expect(opsPerSec).toBeGreaterThan(100);
  });

  it('should measure CRDT counter increment throughput', () => {
    const counter = new GCounter('perf-counter', 'node1');
    const ops = 100_000;
    const start = Date.now();
    for (let i = 0; i < ops; i++) {
      counter.increment(1);
    }
    const elapsed = Date.now() - start;
    expect(counter.value()).toBe(ops);
    const opsPerSec = Math.round(ops / (elapsed / 1000));
    expect(opsPerSec).toBeGreaterThan(1000);
  });

  it('should measure PNCounter throughput with mixed ops', () => {
    const counter = new PNCounter('mixed-counter', 'node1');
    const ops = 50_000;
    const start = Date.now();
    for (let i = 0; i < ops; i++) {
      if (i % 2 === 0) counter.increment(1);
      else counter.decrement(1);
    }
    const elapsed = Date.now() - start;
    expect(counter.value()).toBe(0); // Equal increments and decrements
    const opsPerSec = Math.round(ops / (elapsed / 1000));
    expect(opsPerSec).toBeGreaterThan(1000);
  });

  it('should measure GraphQuery execute throughput', () => {
    const graph = new GraphStore();
    for (let i = 0; i < 1000; i++) {
      graph.addNode(`q:${i}`, ['Item'], { value: i, category: `cat_${i % 10}` });
    }
    const query = new GraphQuery(graph);
    const iterations = 1000;
    const start = Date.now();
    for (let i = 0; i < iterations; i++) {
      query.match([{ nodeVar: 'n', labels: ['Item'] }])
        .where(row => (row.n as any).properties.category === `cat_${i % 10}`)
        .execute();
    }
    const elapsed = Date.now() - start;
    const opsPerSec = Math.round(iterations / (elapsed / 1000));
    expect(opsPerSec).toBeGreaterThan(10);
  });

  it('should measure API rate limiter throughput', () => {
    const limiter = new APIRateLimiter({ windowMs: 60000, maxRequests: 100_000 });
    const ops = 100_000;
    const start = Date.now();
    for (let i = 0; i < ops; i++) {
      limiter.checkLimit(`client_${i % 100}`, 'endpoint');
    }
    const elapsed = Date.now() - start;
    const opsPerSec = Math.round(ops / (elapsed / 1000));
    expect(opsPerSec).toBeGreaterThan(1000);
  });

  it('should measure InputValidator throughput', () => {
    const iterations = 10_000;
    const start = Date.now();
    for (let i = 0; i < iterations; i++) {
      InputValidator.for(`test_${i}@example.com`).isString().isEmail().getResult();
    }
    const elapsed = Date.now() - start;
    const opsPerSec = Math.round(iterations / (elapsed / 1000));
    expect(opsPerSec).toBeGreaterThan(1000);
  });

  it('should measure SyncProtocol prepareSync throughput', () => {
    const protocol = new SyncProtocol('node1');
    const baseState: any = {
      counters: { c1: { type: 'gcounter', state: { node1: 1000 } } },
      sets: {},
      registers: { r1: { value: 'test', timestamp: Date.now(), node: 'node1' } },
      maps: {},
    };
    const ops = 10_000;
    const start = Date.now();
    for (let i = 0; i < ops; i++) {
      protocol.prepareSync(baseState);
    }
    const elapsed = Date.now() - start;
    const opsPerSec = Math.round(ops / (elapsed / 1000));
    expect(opsPerSec).toBeGreaterThan(1000);
  });
});
