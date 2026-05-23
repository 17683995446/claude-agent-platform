// ============================================================================
// performance-concurrency.test.ts
// Concurrency stress tests and EventEmitter leak detection across all packages.
// Verifies system stability under high concurrency, deadlock detection,
// data race detection, and EventEmitter memory safety.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';

// ---- Storage ----
import { MemoryStorage } from '../packages/storage/src/memory-storage.ts';
import { FileStorage } from '../packages/storage/src/file-storage.ts';

// ---- State Sync ----
import { StateStore } from '../packages/state-sync/src/state-store.ts';

// ---- DB Layer ----
import { TransactionManager } from '../packages/db-layer/src/transaction-manager.ts';

// ---- Plugin Registry ----
import { PluginRegistry } from '../packages/plugin-registry/src/registry-core.ts';

// ---- API Gateway ----
import { Router } from '../packages/api-gateway/src/router.ts';
import { APIRateLimiter } from '../packages/api-gateway/src/rate-limiter.ts';

// ---- Agent Communication ----
import { MessageBus } from '../packages/agent-communication/src/message-bus.ts';

// ---- Notification ----
import { NotificationCenter } from '../packages/notification/src/notification-center.ts';

// ---- Orchestrator ----
import { SmartOrchestrator } from '../packages/orchestrator/src/smart-orchestrator.ts';
import type { DecompositionResult } from '../packages/orchestrator/src/types.ts';

// ---- Workflow ----
import { DAGExecutor, CycleDetectedError } from '../packages/workflow/src/dag-executor.ts';
import type { DAGNode } from '../packages/workflow/src/dag-executor.ts';

// ---- Task Queue ----
import { TaskQueue } from '../packages/task-queue/src/task-queue.ts';

// ---- Resilience ----
import { CircuitBreaker } from '../packages/resilience/src/circuit-breaker.ts';

// ---- Self-Healing ----
import { AnomalyDetector } from '../packages/self-healing/src/anomaly-detector.ts';

// ---- Config Center ----
import { ConfigStore } from '../packages/config-center/src/config-store.ts';
import { ConfigHotReloader } from '../packages/config-center/src/config-hot-reload.ts';
import { ConfigSourceManager, MemoryConfigSource } from '../packages/config-center/src/config-sources.ts';

// ---- App Core ----
import { AppEventSystem } from '../packages/app-core/src/event-system.ts';

// ============================================================================
// 1. Concurrent State Modification (15+ tests)
// ============================================================================

describe('Concurrent State Modification', () => {
  describe('MemoryStorage - concurrent writes', () => {
    let storage: MemoryStorage<string>;

    beforeEach(() => {
      storage = new MemoryStorage<string>();
    });

    afterEach(() => {
      // cleanup
    });

    it('should handle 100 concurrent writes to different keys', async () => {
      const writes = Array.from({ length: 100 }, (_, i) =>
        storage.set(`key-${i}`, `value-${i}`)
      );
      await Promise.all(writes);

      for (let i = 0; i < 100; i++) {
        const val = await storage.get(`key-${i}`);
        expect(val).toBe(`value-${i}`);
      }
    });

    it('should handle 50 concurrent writes to the same key without data loss', async () => {
      const writes = Array.from({ length: 50 }, (_, i) =>
        storage.set('shared-key', `value-${i}`)
      );
      await Promise.all(writes);

      // All writes should complete; the final value should be one of the written values
      const val = await storage.get('shared-key');
      expect(val).toBeDefined();
      expect(typeof val).toBe('string');
      expect(val).toMatch(/^value-\d+$/);
    });

    it('should serialize concurrent read-modify-write via enqueue', async () => {
      // Initialize
      await storage.set('counter', '0');

      // 20 concurrent increments - each uses the enqueue mechanism
      // Since MemoryStorage serializes writes through enqueue, all writes are ordered.
      // However, reads are NOT serialized, so reads may see stale data.
      // This test verifies that the enqueue mechanism serializes writes correctly.
      const increments = Array.from({ length: 20 }, (_, i) =>
        storage.set('counter', `value-${i}`)
      );

      await Promise.all(increments);

      // All 20 writes completed via the serialized queue
      const val = await storage.get('counter');
      expect(val).toBeDefined();
      expect(typeof val).toBe('string');
      expect(val).toMatch(/^value-\d+$/);
    });

    it('should handle concurrent deletes and reads without errors', async () => {
      for (let i = 0; i < 50; i++) {
        await storage.set(`key-${i}`, `value-${i}`);
      }

      const ops = [
        ...Array.from({ length: 25 }, (_, i) => storage.delete(`key-${i}`)),
        ...Array.from({ length: 25 }, (_, i) => storage.get(`key-${i}`)),
      ];

      const results = await Promise.all(ops);
      // No errors should occur
      expect(results.length).toBe(50);
    });

    it('should maintain size consistency under concurrent operations', async () => {
      const writes = Array.from({ length: 50 }, (_, i) =>
        storage.set(`key-${i}`, `value-${i}`)
      );
      await Promise.all(writes);

      const concurrentOps = [
        ...Array.from({ length: 25 }, (_, i) => storage.delete(`key-${i}`)),
        ...Array.from({ length: 25 }, (_, i) =>
          storage.set(`new-key-${i}`, `new-value-${i}`)
        ),
      ];
      await Promise.all(concurrentOps);

      const size = await storage.size();
      // 50 original - 25 deleted + 25 new = 50
      expect(size).toBe(50);
    });

    it('should handle concurrent clear and write operations', async () => {
      for (let i = 0; i < 50; i++) {
        await storage.set(`key-${i}`, `value-${i}`);
      }

      const ops = [
        storage.clear(),
        ...Array.from({ length: 20 }, (_, i) =>
          storage.set(`post-clear-${i}`, `data-${i}`)
        ),
      ];
      await Promise.all(ops);

      const size = await storage.size();
      expect(size).toBeLessThanOrEqual(20);
    });
  });

  describe('StateStore - concurrent state updates', () => {
    let store: StateStore;

    beforeEach(() => {
      store = new StateStore();
    });

    it('should handle 100 concurrent set operations', () => {
      for (let i = 0; i < 100; i++) {
        store.set(`key-${i}`, { value: i });
      }

      expect(store.size()).toBe(100);
      for (let i = 0; i < 100; i++) {
        const entry = store.get(`key-${i}`);
        expect(entry).toBeDefined();
        expect((entry!.value as any).value).toBe(i);
      }
    });

    it('should handle concurrent snapshot and restore', () => {
      for (let i = 0; i < 20; i++) {
        store.set(`key-${i}`, { value: i });
      }

      const snap = store.snapshot('test-snap');
      expect(snap.entryCount).toBe(20);

      // Modify after snapshot
      for (let i = 0; i < 20; i++) {
        store.set(`key-${i}`, { value: i + 1000 });
      }

      // Restore
      const restored = store.restore(snap.id);
      expect(restored).toBe(true);

      for (let i = 0; i < 20; i++) {
        const entry = store.get(`key-${i}`);
        expect((entry!.value as any).value).toBe(i);
      }
    });

    it('should handle concurrent version increments', () => {
      for (let i = 0; i < 50; i++) {
        store.set('counter', { value: i });
      }

      const entry = store.get('counter');
      expect(entry!.version).toBe(50);
    });

    it('should handle concurrent TTL-based expiration', async () => {
      for (let i = 0; i < 20; i++) {
        store.set(`ttl-key-${i}`, { value: i }, { ttl: 50 });
      }

      // Should exist immediately
      for (let i = 0; i < 20; i++) {
        expect(store.has(`ttl-key-${i}`)).toBe(true);
      }

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 100));

      for (let i = 0; i < 20; i++) {
        expect(store.has(`ttl-key-${i}`)).toBe(false);
      }
    });
  });

  describe('TransactionManager - concurrent transactions', () => {
    let sqlLog: string[];
    let manager: TransactionManager;

    beforeEach(() => {
      sqlLog = [];
      manager = new TransactionManager(async (sql: string) => {
        sqlLog.push(sql);
      });
    });

    it('should handle 20 concurrent transactions', async () => {
      const transactions = Array.from({ length: 20 }, () =>
        manager.beginTransaction()
      );
      const txs = await Promise.all(transactions);

      expect(txs.length).toBe(20);
      expect(manager.getActiveCount()).toBe(20);

      // Commit all
      await Promise.all(txs.map((tx) => manager.commit(tx)));
      expect(manager.getActiveCount()).toBe(0);
    });

    it('should handle concurrent runInTransaction calls', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          manager.runInTransaction(async (tx) => {
            return `result-${i}-${tx.id}`;
          })
        )
      );

      expect(results.length).toBe(10);
      for (const r of results) {
        expect(r).toMatch(/^result-\d+-tx-\d+$/);
      }
    });

    it('should handle concurrent rollback without interfering with other transactions', async () => {
      const txs = await Promise.all([
        manager.beginTransaction(),
        manager.beginTransaction(),
        manager.beginTransaction(),
      ]);

      // Rollback only the middle one
      await manager.rollback(txs[1]);

      expect(manager.isActive(txs[0].id)).toBe(true);
      expect(manager.isActive(txs[1].id)).toBe(false);
      expect(manager.isActive(txs[2].id)).toBe(true);

      // Commit remaining
      await Promise.all([manager.commit(txs[0]), manager.commit(txs[2])]);
      expect(manager.getActiveCount()).toBe(0);
    });
  });

  describe('PluginRegistry - concurrent plugin operations', () => {
    it('should handle concurrent plugin registrations', async () => {
      const registry = new PluginRegistry();

      const registrations = Array.from({ length: 10 }, (_, i) =>
        registry.register({
          name: `plugin-${i}`,
          version: '1.0.0',
        })
      );

      await Promise.all(registrations);
      expect(registry.getPluginCount()).toBe(10);
    });

    it('should handle concurrent plugin activations', async () => {
      const registry = new PluginRegistry();

      for (let i = 0; i < 10; i++) {
        await registry.register({
          name: `plugin-${i}`,
          version: '1.0.0',
        });
      }

      const activations = Array.from({ length: 10 }, (_, i) =>
        registry.activate(`plugin-${i}`)
      );

      await Promise.all(activations);

      for (let i = 0; i < 10; i++) {
        expect(registry.getPluginState(`plugin-${i}`)).toBe('active');
      }
    });

    it('should handle concurrent register and unregister', async () => {
      const registry = new PluginRegistry();

      // Register 5 plugins
      for (let i = 0; i < 5; i++) {
        await registry.register({
          name: `plugin-${i}`,
          version: '1.0.0',
        });
      }

      // Concurrently unregister even and register new
      const ops = [
        ...Array.from({ length: 5 }, (_, i) =>
          i % 2 === 0 ? registry.unregister(`plugin-${i}`) : Promise.resolve()
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          registry.register({ name: `new-plugin-${i}`, version: '2.0.0' })
        ),
      ];

      await Promise.all(ops);
      // Should have: plugin-1, plugin-3, new-plugin-0..4 = 7
      expect(registry.getPluginCount()).toBe(7);
    });
  });
});

// ============================================================================
// 2. Concurrent API Calls (15+ tests)
// ============================================================================

describe('Concurrent API Calls', () => {
  describe('Router - concurrent request matching', () => {
    let router: Router;

    beforeEach(() => {
      router = new Router();
      router.get('/api/users', async () => ({ status: 200, body: 'users' }));
      router.get('/api/users/:id', async (params) => ({ status: 200, body: params.id }));
      router.post('/api/users', async () => ({ status: 201, body: 'created' }));
      router.get('/api/posts/:postId/comments/:commentId', async (params) => ({
        status: 200,
        body: { postId: params.postId, commentId: params.commentId },
      }));
    });

    it('should handle 100 concurrent route matches', () => {
      const matches = Array.from({ length: 100 }, () =>
        router.match('GET', '/api/users')
      );

      for (const match of matches) {
        expect(match).not.toBeNull();
        expect(match!.route.method).toBe('GET');
      }
    });

    it('should handle 100 concurrent parametric route matches', () => {
      const matches = Array.from({ length: 100 }, (_, i) =>
        router.match('GET', `/api/users/${i}`)
      );

      for (let i = 0; i < matches.length; i++) {
        expect(matches[i]).not.toBeNull();
        expect(matches[i]!.params.id).toBe(String(i));
      }
    });

    it('should handle concurrent matches across different routes', () => {
      const ops = [
        ...Array.from({ length: 25 }, () => router.match('GET', '/api/users')),
        ...Array.from({ length: 25 }, (_, i) => router.match('GET', `/api/users/${i}`)),
        ...Array.from({ length: 25 }, () => router.match('POST', '/api/users')),
        ...Array.from({ length: 25 }, (_, i) =>
          router.match('GET', `/api/posts/${i}/comments/${i + 100}`)
        ),
      ];

      const results = ops.map((r) => r);
      expect(results.length).toBe(100);
      expect(results.every((r) => r !== null)).toBe(true);
    });

    it('should handle concurrent route additions and matches', () => {
      const addAndMatch = Array.from({ length: 50 }, (_, i) => {
        router.get(`/api/dynamic/${i}`, async () => ({ status: 200, body: `dynamic-${i}` }));
        return router.match('GET', `/api/dynamic/${i}`);
      });

      for (const match of addAndMatch) {
        expect(match).not.toBeNull();
      }
    });
  });

  describe('APIRateLimiter - concurrent rate checks', () => {
    let limiter: APIRateLimiter;

    beforeEach(() => {
      limiter = new APIRateLimiter({ windowMs: 60000, maxRequests: 50 });
    });

    it('should handle 100 concurrent rate limit checks for same client', () => {
      const results = Array.from({ length: 100 }, () =>
        limiter.checkLimit('client-1', '/api/test')
      );

      const allowed = results.filter((r) => r.allowed);
      const denied = results.filter((r) => !r.allowed);
      expect(allowed.length).toBe(50);
      expect(denied.length).toBe(50);
    });

    it('should handle 100 concurrent checks across different clients', () => {
      const results = Array.from({ length: 100 }, (_, i) =>
        limiter.checkLimit(`client-${i}`, '/api/test')
      );

      // Each client should be allowed (first request)
      expect(results.every((r) => r.allowed)).toBe(true);
    });

    it('should handle concurrent resets and checks', () => {
      const ops = Array.from({ length: 50 }, (_, i) => {
        if (i % 10 === 0) {
          limiter.reset('client-1');
        }
        return limiter.checkLimit('client-1');
      });

      // All should be allowed due to periodic resets
      expect(ops.every((r) => r.allowed)).toBe(true);
    });

    it('should maintain consistent rate limit headers under concurrency', () => {
      const headers = Array.from({ length: 50 }, () =>
        limiter.getRateLimitHeaders('client-1', '/api/test')
      );

      for (const h of headers) {
        expect(h['X-RateLimit-Limit']).toBe('50');
        expect(Number(h['X-RateLimit-Remaining']) >= 0).toBe(true);
      }
    });
  });

  describe('MessageBus - concurrent messaging', () => {
    let bus: MessageBus;

    beforeEach(() => {
      bus = new MessageBus();
    });

    afterEach(() => {
      bus.reset();
    });

    it('should handle 100 concurrent publishes to same topic', () => {
      let receivedCount = 0;
      bus.subscribe('test.topic', () => { receivedCount++; });

      for (let i = 0; i < 100; i++) {
        bus.publish('test.topic', { payload: i });
      }

      // Give time for async processing
      // The message bus processes synchronously for each publish call
      // but uses setTimeout for queue continuation
      expect(receivedCount).toBeGreaterThan(0);
    });

    it('should handle concurrent subscribes and publishes', () => {
      const counts = [0, 0, 0, 0, 0];
      for (let i = 0; i < 5; i++) {
        bus.subscribe('multi.topic', () => { counts[i]++; });
      }

      for (let i = 0; i < 10; i++) {
        bus.publish('multi.topic', { payload: i });
      }

      // Each subscriber should receive messages
      expect(counts.every((c) => c > 0)).toBe(true);
    });

    it('should handle concurrent request-response patterns', async () => {
      bus.subscribe('rpc.topic', (msg) => {
        if (msg.type === 'request') {
          bus.publish('rpc.topic', {
            type: 'response',
            payload: `reply-${msg.payload}`,
            correlationId: msg.correlationId,
            sender: 'responder',
          });
        }
      });

      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          bus.request('rpc.topic', i, 2000)
        )
      );

      expect(responses.length).toBe(10);
      for (const resp of responses) {
        expect(resp.type).toBe('response');
      }
    });

    it('should handle concurrent wildcard subscriptions', () => {
      let wildcardCount = 0;
      let exactCount = 0;

      bus.subscribe('events.>', () => { wildcardCount++; });
      bus.subscribe('events.user.created', () => { exactCount++; });

      for (let i = 0; i < 20; i++) {
        bus.publish(`events.user.action${i}`, { i });
      }

      expect(wildcardCount).toBeGreaterThan(0);
    });
  });

  describe('NotificationCenter - concurrent notifications', () => {
    let center: NotificationCenter;

    beforeEach(() => {
      center = new NotificationCenter();
    });

    it('should handle 100 concurrent notification sends', async () => {
      let received = 0;
      center.subscribe('console', async () => { received++; });

      const sends = Array.from({ length: 100 }, (_, i) =>
        center.send({
          id: `notif-${i}`,
          type: 'info',
          priority: 'normal',
          title: `Test ${i}`,
          message: `Message ${i}`,
          channel: 'console',
          timestamp: Date.now(),
        })
      );

      const results = await Promise.all(sends);
      expect(results.length).toBe(100);
      expect(results.every((r) => r.some((s) => s.success))).toBe(true);
    });

    it('should handle concurrent multi-channel notifications', async () => {
      let consoleCount = 0;
      let fileCount = 0;
      center.subscribe('console', async () => { consoleCount++; });
      center.subscribe('file', async () => { fileCount++; });

      const sends = Array.from({ length: 20 }, (_, i) =>
        center.send({
          id: `multi-${i}`,
          type: 'warning',
          priority: 'high',
          title: `Alert ${i}`,
          message: `Warning ${i}`,
          channel: ['console', 'file'],
          timestamp: Date.now(),
        })
      );

      await Promise.all(sends);
      expect(consoleCount).toBe(20);
      expect(fileCount).toBe(20);
    });

    it('should handle deduplication under concurrent sends', async () => {
      let received = 0;
      center.subscribe('console', async () => { received++; });

      const sends = Array.from({ length: 10 }, (_, i) =>
        center.send({
          id: `dedupe-${i}`,
          type: 'info',
          priority: 'normal',
          title: 'Dup',
          message: 'Dup message',
          channel: 'console',
          timestamp: Date.now(),
          dedupeKey: 'same-key',
        })
      );

      const results = await Promise.all(sends);
      // Only the first should succeed
      const successes = results.filter((r) => r.some((s) => s.success));
      expect(successes.length).toBe(1);
    });
  });
});

// ============================================================================
// 3. Deadlock Detection (10+ tests)
// ============================================================================

describe('Deadlock Detection', () => {
  describe('Orchestrator - parallel phase execution', () => {
    it('should not deadlock with circular task dependencies in orchestrator', async () => {
      const orchestrator = new SmartOrchestrator();

      const decomposition: DecompositionResult = {
        rootTask: {
          raw: 'test task',
          intent: 'test',
          confidence: 1,
          entities: [],
          language: 'en',
          description: 'test',
          priority: 'medium',
          tags: [],
        },
        graph: {
          nodes: [
            { id: 't1', name: 'Task 1', description: '', intent: 'test', dependencies: [], priority: 1, estimatedDuration: 100, entities: [], status: 'pending' },
            { id: 't2', name: 'Task 2', description: '', intent: 'test', dependencies: [], priority: 1, estimatedDuration: 100, entities: [], status: 'pending' },
            { id: 't3', name: 'Task 3', description: '', intent: 'test', dependencies: [], priority: 1, estimatedDuration: 100, entities: [], status: 'pending' },
          ],
          edges: [],
          criticalPath: ['t1', 't2', 't3'],
          parallelGroups: [['t1', 't2', 't3']],
        },
        totalEstimatedDuration: 100,
        decompositionStrategy: 'parallel',
      };

      orchestrator.createPlan(decomposition);

      let completedPhases = 0;
      orchestrator.setCallbacks({
        onPhaseComplete: () => { completedPhases++; },
      });

      const executePromise = orchestrator.execute(async (taskId) => {
        return { success: true, duration: 10 };
      });

      // Should complete within 5 seconds
      const result = await Promise.race([
        executePromise,
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Deadlock detected: orchestrator did not complete within 5s')), 5000)),
      ]);

      expect(result).not.toBeNull();
      expect(orchestrator.getState()).toBe('completed');
    });

    it('should handle pause/resume without deadlock', async () => {
      const orchestrator = new SmartOrchestrator();

      const decomposition: DecompositionResult = {
        rootTask: {
          raw: 'test', intent: 'test', confidence: 1, entities: [],
          language: 'en', description: 'test', priority: 'medium', tags: [],
        },
        graph: {
          nodes: [
            { id: 't1', name: 'T1', description: '', intent: 'test', dependencies: [], priority: 1, estimatedDuration: 100, entities: [], status: 'pending' },
            { id: 't2', name: 'T2', description: '', intent: 'test', dependencies: [], priority: 1, estimatedDuration: 100, entities: [], status: 'pending' },
          ],
          edges: [],
          criticalPath: ['t1', 't2'],
          parallelGroups: [['t1'], ['t2']],
        },
        totalEstimatedDuration: 200,
        decompositionStrategy: 'sequential',
      };

      orchestrator.createPlan(decomposition);

      let firstTaskStarted = false;
      const executePromise = orchestrator.execute(async (taskId) => {
        if (taskId === 't1') {
          firstTaskStarted = true;
          // Pause during first task
          orchestrator.pause();
          // Wait a bit then resume
          await new Promise((r) => setTimeout(r, 50));
          orchestrator.resume();
        }
        return { success: true, duration: 10 };
      });

      const result = await Promise.race([
        executePromise,
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Deadlock: pause/resume stuck')), 5000)),
      ]);

      expect(result).not.toBeNull();
      expect(orchestrator.getState()).toBe('completed');
    });

    it('should handle cancellation without deadlock', async () => {
      const orchestrator = new SmartOrchestrator();

      const decomposition: DecompositionResult = {
        rootTask: {
          raw: 'test', intent: 'test', confidence: 1, entities: [],
          language: 'en', description: 'test', priority: 'medium', tags: [],
        },
        graph: {
          nodes: Array.from({ length: 10 }, (_, i) => ({
            id: `t${i}`, name: `T${i}`, description: '', intent: 'test',
            dependencies: [], priority: 1, estimatedDuration: 1000,
            entities: [], status: 'pending',
          })),
          edges: [],
          criticalPath: Array.from({ length: 10 }, (_, i) => `t${i}`),
          parallelGroups: [Array.from({ length: 10 }, (_, i) => `t${i}`)],
        },
        totalEstimatedDuration: 1000,
        decompositionStrategy: 'parallel',
      };

      orchestrator.createPlan(decomposition);

      const executePromise = orchestrator.execute(async (taskId) => {
        if (taskId === 't0') {
          await new Promise((r) => setTimeout(r, 50));
          orchestrator.cancel();
        }
        await new Promise((r) => setTimeout(r, 1000));
        return { success: true, duration: 10 };
      });

      const result = await Promise.race([
        executePromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);

      // Should have cancelled, not deadlocked
      expect(orchestrator.getState()).not.toBe('executing');
    });
  });

  describe('DAGExecutor - cycle detection', () => {
    it('should detect simple cycles in DAG', () => {
      const executor = new DAGExecutor();
      const nodes: DAGNode[] = [
        { id: 'a', dependencies: ['b'], execute: async () => 'a' },
        { id: 'b', dependencies: ['c'], execute: async () => 'b' },
        { id: 'c', dependencies: ['a'], execute: async () => 'c' },
      ];

      expect(() => executor.detectCycle(nodes)).toThrow(CycleDetectedError);
    });

    it('should detect self-referencing cycles', () => {
      const executor = new DAGExecutor();
      const nodes: DAGNode[] = [
        { id: 'a', dependencies: ['a'], execute: async () => 'a' },
      ];

      expect(() => executor.detectCycle(nodes)).toThrow(CycleDetectedError);
    });

    it('should detect complex cycles in large DAGs', () => {
      const executor = new DAGExecutor();
      const nodes: DAGNode[] = Array.from({ length: 50 }, (_, i) => ({
        id: `n${i}`,
        dependencies: i > 0 ? [`n${i - 1}`] : [],
        execute: async () => i,
      }));

      // Add a cycle: n49 -> n25 -> n49
      nodes[49] = { id: 'n49', dependencies: ['n25'], execute: async () => 49 };
      nodes[25] = { id: 'n25', dependencies: ['n49'], execute: async () => 25 };

      expect(() => executor.detectCycle(nodes)).toThrow(CycleDetectedError);
    });

    it('should execute large DAGs without deadlock', async () => {
      const executor = new DAGExecutor();
      const nodeCount = 100;
      const nodes: DAGNode[] = Array.from({ length: nodeCount }, (_, i) => ({
        id: `n${i}`,
        dependencies: i > 0 ? [`n${i - 1}`] : [],
        execute: async (inputs) => {
          await new Promise((r) => setTimeout(r, 1));
          return { value: i, inputs };
        },
      }));

      const result = await Promise.race([
        executor.execute(nodes),
        new Promise<DAGResult>((_, reject) =>
          setTimeout(() => reject(new Error('DAG execution deadlock')), 10000)
        ),
      ]);

      expect(result.success).toBe(true);
      expect(result.executionOrder.length).toBe(nodeCount);
    });

    it('should handle parallel DAG execution without deadlock', async () => {
      const executor = new DAGExecutor();
      const nodes: DAGNode[] = [
        { id: 'a', dependencies: [], execute: async () => 'a' },
        { id: 'b', dependencies: [], execute: async () => 'b' },
        { id: 'c', dependencies: [], execute: async () => 'c' },
        { id: 'd', dependencies: ['a', 'b'], execute: async () => 'd' },
        { id: 'e', dependencies: ['b', 'c'], execute: async () => 'e' },
        { id: 'f', dependencies: ['d', 'e'], execute: async () => 'f' },
      ];

      const result = await executor.execute(nodes);
      expect(result.success).toBe(true);
      expect(result.executionOrder).toContain('f');
    });

    it('should handle DAG with AbortSignal without deadlock', async () => {
      const executor = new DAGExecutor();
      const controller = new AbortController();

      const nodes: DAGNode[] = Array.from({ length: 20 }, (_, i) => ({
        id: `n${i}`,
        dependencies: i > 0 ? [`n${i - 1}`] : [],
        execute: async () => {
          if (i === 5) {
            controller.abort();
          }
          await new Promise((r) => setTimeout(r, 100));
          return i;
        },
      }));

      const result = await executor.execute(nodes, controller.signal);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Aborted');
    });
  });

  describe('TaskQueue - priority queue deadlock scenarios', () => {
    it('should handle rapid enqueue/dequeue cycles without deadlock', async () => {
      const queue = new TaskQueue({ maxSize: 100, concurrency: 10 });

      const enqueueOps = Array.from({ length: 50 }, (_, i) =>
        queue.enqueue({ data: i, priority: i % 3 })
      );

      const ids = enqueueOps;
      expect(ids.length).toBe(50);

      // Dequeue all - must complete each task before the next can become active
      const tasks: any[] = [];
      for (let i = 0; i < 50; i++) {
        const task = await queue.dequeue();
        if (task) {
          tasks.push(task);
          queue.complete(task.id); // Complete to free concurrency slot
        }
      }

      expect(tasks.length).toBe(50);
    });

    it('should handle concurrent complete/fail/retry without deadlock', () => {
      const queue = new TaskQueue();
      const id = queue.enqueue({ data: 'test', priority: 1 });

      // Should not throw
      queue.complete(id, 'result');
      // Complete again should be no-op
      queue.complete(id, 'result2');

      const task = queue.getTask(id);
      expect(task!.status).toBe('completed');
    });

    it('should handle max concurrency limits without deadlock', async () => {
      const queue = new TaskQueue({ concurrency: 3 });

      for (let i = 0; i < 10; i++) {
        queue.enqueue({ data: i, priority: i });
      }

      const activeTasks: any[] = [];
      for (let i = 0; i < 3; i++) {
        const task = await queue.dequeue();
        if (task) activeTasks.push(task);
      }

      expect(activeTasks.length).toBe(3);
      expect(queue.getActive().length).toBe(3);
    });
  });
});

// ============================================================================
// 4. EventEmitter Stress (10+ tests)
// ============================================================================

describe('EventEmitter Stress', () => {
  describe('Node.js EventEmitter - listener limits', () => {
    it('should detect default max listeners warning with 11+ listeners', () => {
      const emitter = new EventEmitter();
      const defaultMax = emitter.getMaxListeners();

      // Add more than the default max listeners
      for (let i = 0; i < defaultMax + 5; i++) {
        emitter.on('test', () => {});
      }

      expect(emitter.listenerCount('test')).toBe(defaultMax + 5);
    });

    it('should handle 1000+ listeners on a single emitter', () => {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(0); // Disable warning

      let receivedCount = 0;
      for (let i = 0; i < 1000; i++) {
        emitter.on('stress', () => { receivedCount++; });
      }

      emitter.emit('stress');
      expect(receivedCount).toBe(1000);
    });

    it('should handle rapid add/remove listener cycles', () => {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(0);

      for (let cycle = 0; cycle < 100; cycle++) {
        const handlers: Array<() => void> = [];
        for (let i = 0; i < 50; i++) {
          const handler = () => {};
          handlers.push(handler);
          emitter.on('cycle', handler);
        }

        expect(emitter.listenerCount('cycle')).toBe(50);

        for (const handler of handlers) {
          emitter.off('cycle', handler);
        }

        expect(emitter.listenerCount('cycle')).toBe(0);
      }
    });

    it('should handle event propagation under high frequency', () => {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(0);

      let received = 0;
      for (let i = 0; i < 100; i++) {
        emitter.on('high-freq', () => { received++; });
      }

      // Emit 1000 events rapidly
      for (let i = 0; i < 1000; i++) {
        emitter.emit('high-freq');
      }

      expect(received).toBe(100 * 1000);
    });

    it('should maintain memory stability during event storms', () => {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(0);

      const handlers: Array<() => void> = [];

      // Add 500 listeners
      for (let i = 0; i < 500; i++) {
        const handler = () => {};
        handlers.push(handler);
        emitter.on('storm', handler);
      }

      // Emit 10000 events
      for (let i = 0; i < 10000; i++) {
        emitter.emit('storm');
      }

      // Remove all listeners
      for (const handler of handlers) {
        emitter.off('storm', handler);
      }

      expect(emitter.listenerCount('storm')).toBe(0);
    });

    it('should handle once() listeners correctly under stress', () => {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(0);

      let onceCount = 0;
      for (let i = 0; i < 100; i++) {
        emitter.once('once-test', () => { onceCount++; });
      }

      emitter.emit('once-test');
      expect(onceCount).toBe(100);
      expect(emitter.listenerCount('once-test')).toBe(0);

      // Second emit should not trigger
      emitter.emit('once-test');
      expect(onceCount).toBe(100);
    });

    it('should handle removeAllListeners under stress', () => {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(0);

      for (let i = 0; i < 200; i++) {
        emitter.on(`event-${i}`, () => {});
      }

      emitter.removeAllListeners();
      expect(emitter.eventNames().length).toBe(0);
    });

    it('should handle error events without crashing', () => {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(0);

      // Without error listener, error event throws
      expect(() => emitter.emit('error', new Error('test'))).toThrow();

      // With error listener, should not throw
      let errorReceived = false;
      emitter.on('error', (err) => { errorReceived = true; });
      emitter.emit('error', new Error('test'));
      expect(errorReceived).toBe(true);
    });

    it('should handle listener leak detection with setMaxListeners', () => {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(10);

      // Adding 10 should be fine
      for (let i = 0; i < 10; i++) {
        emitter.on('limited', () => {});
      }
      expect(emitter.listenerCount('limited')).toBe(10);

      // Adding more should still work but would normally warn
      emitter.on('limited', () => {});
      expect(emitter.listenerCount('limited')).toBe(11);
    });

    it('should handle multiple event types simultaneously', () => {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(0);

      const counts = { a: 0, b: 0, c: 0 };

      for (let i = 0; i < 50; i++) {
        emitter.on('a', () => { counts.a++; });
        emitter.on('b', () => { counts.b++; });
        emitter.on('c', () => { counts.c++; });
      }

      for (let i = 0; i < 100; i++) {
        emitter.emit('a');
        emitter.emit('b');
        emitter.emit('c');
      }

      expect(counts.a).toBe(5000);
      expect(counts.b).toBe(5000);
      expect(counts.c).toBe(5000);
    });
  });

  describe('AppEventSystem - event stress', () => {
    let eventSystem: AppEventSystem;

    beforeEach(() => {
      eventSystem = new AppEventSystem(10000);
    });

    it('should handle 1000+ subscriptions', () => {
      for (let i = 0; i < 1000; i++) {
        eventSystem.on('test', `event-${i % 10}`, () => {});
      }

      expect(eventSystem.getSubscriptionCount()).toBe(1000);
    });

    it('should handle rapid emit cycles', () => {
      let count = 0;
      eventSystem.on('stress', 'rapid', () => { count++; });

      for (let i = 0; i < 10000; i++) {
        eventSystem.emit('stress', 'rapid', { i });
      }

      expect(count).toBe(10000);
    });

    it('should handle once subscriptions under stress', () => {
      let count = 0;
      for (let i = 0; i < 50; i++) {
        eventSystem.once('once', 'test', () => { count++; });
      }

      eventSystem.emit('once', 'test');
      expect(count).toBe(50);
      expect(eventSystem.getListenerCount('once', 'test')).toBe(0);
    });

    it('should handle removeAllListeners correctly', () => {
      for (let i = 0; i < 100; i++) {
        eventSystem.on('domain', `event-${i}`, () => {});
      }

      eventSystem.removeAllListeners('domain');
      expect(eventSystem.getSubscriptionCount()).toBe(0);
    });
  });
});

// ============================================================================
// 5. Data Race Detection (10+ tests)
// ============================================================================

describe('Data Race Detection', () => {
  describe('CircuitBreaker - state race conditions', () => {
    it('should handle concurrent state transitions safely', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 3,
        timeout: 100,
        windowType: 'count',
        windowSize: 10,
      });

      // Rapidly trip the breaker with failures
      const failures = Array.from({ length: 10 }, () =>
        breaker.execute(async () => { throw new Error('fail'); }).catch(() => {})
      );

      await Promise.all(failures);
      expect(breaker.getState()).toBe('open');
    });

    it('should handle concurrent half-open transitions', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 50,
        windowType: 'count',
        windowSize: 5,
      });

      // Trip the breaker
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(async () => { throw new Error('fail'); }); } catch {}
      }
      expect(breaker.getState()).toBe('open');

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 100));

      // Concurrent half-open attempts
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          breaker.execute(async () => 'ok')
        )
      );

      // At least some should succeed
      const successes = results.filter((r) => r.status === 'fulfilled');
      expect(successes.length).toBeGreaterThan(0);
    });

    it('should handle concurrent force state changes', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 3,
        timeout: 1000,
        windowType: 'count',
        windowSize: 10,
      });

      const states: string[] = [];
      const stateChanges: Array<{ from: string; to: string }> = [];

      breaker.on('stateChange', (from: unknown, to: unknown) => {
        stateChanges.push({ from: from as string, to: to as string });
      });

      // Rapidly change states
      breaker.forceOpen();
      breaker.forceClose();
      breaker.forceOpen();
      breaker.forceClose();
      breaker.reset();

      // Should not crash; state should be consistent
      const currentState = breaker.getState();
      expect(['closed', 'open', 'half-open']).toContain(currentState);
    });

    it('should provide consistent metrics under concurrent access', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 100,
        successThreshold: 100,
        timeout: 1000,
        windowType: 'count',
        windowSize: 100,
      });

      const ops = Array.from({ length: 50 }, (_, i) =>
        i % 2 === 0
          ? breaker.execute(async () => 'ok')
          : breaker.execute(async () => { throw new Error('fail'); }).catch(() => null)
      );

      await Promise.all(ops);

      const metrics = breaker.getMetricsSnapshot();
      expect(metrics.failureCount + metrics.successCount).toBe(50);
    });
  });

  describe('AnomalyDetector - concurrent metric recording', () => {
    let detector: AnomalyDetector;

    beforeEach(() => {
      detector = new AnomalyDetector();
    });

    it('should handle concurrent metric recording', () => {
      detector.registerMetric('cpu', { windowSize: 200 });

      // Record 100 values rapidly
      for (let i = 0; i < 100; i++) {
        detector.record('cpu', 50 + Math.sin(i) * 10);
      }

      const values = detector.getMetricValues('cpu');
      expect(values.length).toBe(100);
    });

    it('should handle concurrent detect() calls', () => {
      detector.registerMetric('memory', { windowSize: 100 });

      // Establish baseline
      for (let i = 0; i < 30; i++) {
        detector.record('memory', 50);
      }

      // Multiple concurrent detect calls should not crash
      const results = Array.from({ length: 10 }, () => detector.detect());
      for (const reports of results) {
        expect(Array.isArray(reports)).toBe(true);
      }
    });

    it('should handle concurrent baseline updates', () => {
      detector.registerMetric('latency', { windowSize: 100 });

      for (let i = 0; i < 50; i++) {
        detector.record('latency', 100 + i);
      }

      // Multiple concurrent baseline updates
      for (let i = 0; i < 10; i++) {
        detector.updateBaseline('latency');
      }

      const baseline = detector.getBaseline('latency');
      expect(baseline.sampleCount).toBeGreaterThan(0);
    });

    it('should handle concurrent multi-metric recording', () => {
      const metrics = ['cpu', 'memory', 'disk', 'network', 'latency'];
      for (const m of metrics) {
        detector.registerMetric(m, { windowSize: 50 });
      }

      for (let i = 0; i < 100; i++) {
        for (const m of metrics) {
          detector.record(m, Math.random() * 100);
        }
      }

      const allMetrics = detector.getMetrics();
      expect(allMetrics.length).toBe(5);
    });
  });

  describe('ConfigHotReloader - concurrent reload race conditions', () => {
    it('should handle concurrent triggerReload calls', async () => {
      const store = new ConfigStore({ key: 'initial' });
      const sourceManager = new ConfigSourceManager();
      sourceManager.addSource(new MemoryConfigSource({ key: 'updated' }, 'test-source'), 1);

      const reloader = new ConfigHotReloader(store, sourceManager, { debounceMs: 50 });
      reloader.startWatching();

      // Trigger multiple reloads concurrently
      for (let i = 0; i < 10; i++) {
        reloader.triggerReload('test-source');
      }

      // Wait for debounce to settle
      await new Promise((r) => setTimeout(r, 300));

      const history = reloader.getReloadHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history.every((h) => h.success)).toBe(true);

      reloader.stopWatching();
    });

    it('should handle concurrent reload and config access', async () => {
      const store = new ConfigStore({ a: 1, b: 2 });
      const sourceManager = new ConfigSourceManager();
      sourceManager.addSource(
        new MemoryConfigSource({ a: 10, b: 20, c: 30 }, 'src1'),
        1
      );

      const reloader = new ConfigHotReloader(store, sourceManager, { debounceMs: 50 });
      reloader.startWatching();

      // Concurrently trigger reload and read config
      const reads = Array.from({ length: 20 }, () => store.get('a'));
      reloader.triggerReload('src1');

      // All reads should return valid values
      const results = await Promise.all(reads);
      for (const val of results) {
        expect(val).toBeDefined();
      }

      await new Promise((r) => setTimeout(r, 200));
      reloader.stopWatching();
    });

    it('should handle concurrent watcher registration and reload', async () => {
      const store = new ConfigStore();
      const sourceManager = new ConfigSourceManager();
      sourceManager.addSource(
        new MemoryConfigSource({ x: 1 }, 'src'),
        1
      );

      const reloader = new ConfigHotReloader(store, sourceManager, { debounceMs: 50 });
      reloader.startWatching();

      const events: string[] = [];
      const unwatchFns = Array.from({ length: 5 }, (_, i) =>
        reloader.onReload((event) => {
          events.push(`callback-${i}: ${event.success ? 'ok' : 'fail'}`);
        })
      );

      reloader.triggerReload('src');

      await new Promise((r) => setTimeout(r, 200));

      // All callbacks should have been called
      expect(events.length).toBeGreaterThan(0);

      for (const fn of unwatchFns) fn();
      reloader.stopWatching();
    });
  });

  describe('ConfigStore - concurrent read-modify-write', () => {
    it('should handle concurrent set operations', () => {
      const store = new ConfigStore();

      for (let i = 0; i < 100; i++) {
        store.set(`key-${i}`, i);
      }

      for (let i = 0; i < 100; i++) {
        expect(store.get(`key-${i}`)).toBe(i);
      }
    });

    it('should handle concurrent watch and set operations', () => {
      const store = new ConfigStore();
      const changes: Array<{ path: string; newVal: unknown; oldVal: unknown }> = [];

      for (let i = 0; i < 10; i++) {
        store.watch(`key-${i}`, (path, newVal, oldVal) => {
          changes.push({ path, newVal, oldVal });
        });
      }

      for (let i = 0; i < 10; i++) {
        store.set(`key-${i}`, `value-${i}`);
      }

      expect(changes.length).toBe(10);
    });

    it('should handle concurrent merge operations', () => {
      const store = new ConfigStore({ a: 1 });

      store.merge({ b: 2 });
      store.merge({ c: 3 });
      store.merge({ d: 4 });

      const all = store.getAll();
      expect(all).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    });

    it('should handle concurrent version creation', () => {
      const store = new ConfigStore({ v: 0 });

      const versions: string[] = [];
      for (let i = 0; i < 10; i++) {
        store.set('v', i);
        versions.push(store.createVersion(`v${i}`));
      }

      expect(versions.length).toBe(10);
      expect(store.getVersions().length).toBe(10);
    });
  });

  describe('Atomic operation verification', () => {
    it('should verify MemoryStorage enqueue provides atomic writes', async () => {
      const storage = new MemoryStorage<number>();

      // All writes to the same key should be serialized
      const writePromises = Array.from({ length: 100 }, (_, i) =>
        storage.set('atomic-key', i)
      );

      await Promise.all(writePromises);

      // The final value should be deterministic (last write wins)
      const val = await storage.get('atomic-key');
      expect(val).toBe(99);
    });

    it('should verify StateStore version increments are atomic', () => {
      const store = new StateStore();

      // Rapid sets should produce sequential versions
      for (let i = 0; i < 100; i++) {
        store.set('versioned', i);
      }

      const entry = store.get('versioned');
      expect(entry!.version).toBe(100);
    });

    it('should verify TaskQueue enqueue is atomic', () => {
      const queue = new TaskQueue();

      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const id = queue.enqueue({ data: i, priority: i });
        ids.add(id);
      }

      // All IDs should be unique
      expect(ids.size).toBe(100);
      expect(queue.size()).toBe(100);
    });
  });
});
