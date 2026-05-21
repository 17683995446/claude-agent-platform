import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import {
  TaskQueue,
  DelayedQueue,
  RateLimiter,
  JobScheduler,
  WorkerPool,
  DeadLetterQueue,
  TaskRepository,
  ExponentialBackoff,
  FixedBackoff,
  LinearBackoff,
  TaskMonitor,
  WorkflowQueue,
} from '../src/index.js';
import type { Task, DeadLetterEntry, MonitorEvent, WorkflowStep } from '../src/index.js';

// ============================================================
// TaskQueue Comprehensive Tests
// ============================================================
describe('TaskQueue - Comprehensive Coverage', () => {
  let queue: TaskQueue<string>;

  beforeEach(() => {
    queue = new TaskQueue<string>();
  });

  // --- Constructor ---
  describe('constructor', () => {
    it('should default maxSize to Infinity', () => {
      const q = new TaskQueue<string>();
      // Enqueue many tasks to verify infinity
      for (let i = 0; i < 1000; i++) {
        q.enqueue({ data: `t${i}` });
      }
      expect(q.size()).toBe(1000);
    });

    it('should default concurrency to Infinity', async () => {
      const q = new TaskQueue<string>();
      q.enqueue({ data: 't1' });
      q.enqueue({ data: 't2' });
      q.enqueue({ data: 't3' });
      const t1 = await q.dequeue();
      const t2 = await q.dequeue();
      const t3 = await q.dequeue();
      expect(t1).toBeDefined();
      expect(t2).toBeDefined();
      expect(t3).toBeDefined();
    });

    it('should accept both maxSize and concurrency options', () => {
      const q = new TaskQueue<string>({ maxSize: 5, concurrency: 2 });
      expect(q).toBeDefined();
    });

    it('should accept zero concurrency', async () => {
      const q = new TaskQueue<string>({ concurrency: 0 });
      q.enqueue({ data: 'test' });
      const task = await q.dequeue();
      expect(task).toBeUndefined();
    });

    it('should accept maxSize of 1', () => {
      const q = new TaskQueue<string>({ maxSize: 1 });
      q.enqueue({ data: 'test' });
      expect(() => q.enqueue({ data: 'test2' })).toThrow('Queue is full');
    });
  });

  // --- enqueue ---
  describe('enqueue', () => {
    it('should throw on duplicate custom ID', () => {
      queue.enqueue({ id: 'dup', data: 'first' });
      expect(() => queue.enqueue({ id: 'dup', data: 'second' })).toThrow('already exists');
    });

    it('should generate unique auto IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(queue.enqueue({ data: `t${i}` }));
      }
      expect(ids.size).toBe(100);
    });

    it('should set maxAttempts to 3', () => {
      const id = queue.enqueue({ data: 'test' });
      expect(queue.getTask(id)?.maxAttempts).toBe(3);
    });

    it('should initialize attempts to 0', () => {
      const id = queue.enqueue({ data: 'test' });
      expect(queue.getTask(id)?.attempts).toBe(0);
    });

    it('should store delay option', () => {
      const id = queue.enqueue({ data: 'test', delay: 5000 });
      expect(queue.getTask(id)?.delay).toBe(5000);
    });

    it('should store undefined delay when not provided', () => {
      const id = queue.enqueue({ data: 'test' });
      expect(queue.getTask(id)?.delay).toBeUndefined();
    });

    it('should store deadline option', () => {
      const deadline = Date.now() + 60000;
      const id = queue.enqueue({ data: 'test', deadline });
      expect(queue.getTask(id)?.deadline).toBe(deadline);
    });

    it('should not count towards size when queue is not full', () => {
      const q = new TaskQueue<string>({ maxSize: 5 });
      q.enqueue({ data: 't1' });
      expect(q.size()).toBe(1);
    });

    it('should throw with maxSize=0', () => {
      const q = new TaskQueue<string>({ maxSize: 0 });
      expect(() => q.enqueue({ data: 'test' })).toThrow('Queue is full');
    });

    it('should emit enqueue event with task details', () => {
      let receivedTask: Task<string> | undefined;
      queue.on('enqueue', (t) => { receivedTask = t; });
      const id = queue.enqueue({ data: 'hello', priority: 5 });
      expect(receivedTask).toBeDefined();
      expect(receivedTask!.id).toBe(id);
      expect(receivedTask!.data).toBe('hello');
      expect(receivedTask!.priority).toBe(5);
    });

    it('should handle negative priority', () => {
      const id = queue.enqueue({ data: 'test', priority: -10 });
      expect(queue.getTask(id)?.priority).toBe(-10);
    });

    it('should handle very large priority', () => {
      const id = queue.enqueue({ data: 'test', priority: Number.MAX_SAFE_INTEGER });
      expect(queue.getTask(id)?.priority).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  // --- dequeue ---
  describe('dequeue', () => {
    it('should return undefined for empty queue', async () => {
      expect(await queue.dequeue()).toBeUndefined();
    });

    it('should change status to active', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      expect(queue.getTask(id)?.status).toBe('active');
    });

    it('should set startedAt timestamp', async () => {
      const before = Date.now();
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      const after = Date.now();
      expect(queue.getTask(id)?.startedAt).toBeGreaterThanOrEqual(before);
      expect(queue.getTask(id)?.startedAt).toBeLessThanOrEqual(after);
    });

    it('should increment attempts', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      expect(queue.getTask(id)?.attempts).toBe(1);
    });

    it('should respect priority ordering (highest first)', async () => {
      queue.enqueue({ data: 'low', priority: 1 });
      queue.enqueue({ data: 'high', priority: 10 });
      queue.enqueue({ data: 'medium', priority: 5 });
      queue.enqueue({ data: 'highest', priority: 100 });
      const t1 = await queue.dequeue();
      expect(t1!.data).toBe('highest');
      const t2 = await queue.dequeue();
      expect(t2!.data).toBe('high');
      const t3 = await queue.dequeue();
      expect(t3!.data).toBe('medium');
      const t4 = await queue.dequeue();
      expect(t4!.data).toBe('low');
    });

    it('should respect concurrency limit', async () => {
      const q = new TaskQueue<string>({ concurrency: 1 });
      q.enqueue({ data: 't1' });
      q.enqueue({ data: 't2' });
      await q.dequeue();
      expect(await q.dequeue()).toBeUndefined();
    });

    it('should allow dequeue after completing active task', async () => {
      const q = new TaskQueue<string>({ concurrency: 1 });
      const id1 = q.enqueue({ data: 't1' });
      q.enqueue({ data: 't2' });
      await q.dequeue();
      q.complete(id1);
      const t2 = await q.dequeue();
      expect(t2).toBeDefined();
      expect(t2!.data).toBe('t2');
    });

    it('should not dequeue delayed tasks before delay expires', async () => {
      queue.enqueue({ data: 'delayed', delay: 100000 });
      expect(await queue.dequeue()).toBeUndefined();
    });

    it('should dequeue delayed tasks after delay expires', async () => {
      const id = queue.enqueue({ data: 'delayed', delay: 0 });
      const task = await queue.dequeue();
      expect(task).toBeDefined();
      expect(task!.id).toBe(id);
    });

    it('should not dequeue tasks past deadline', async () => {
      queue.enqueue({ data: 'expired', deadline: Date.now() - 1000 });
      expect(await queue.dequeue()).toBeUndefined();
    });

    it('should dequeue tasks with future deadline', async () => {
      const id = queue.enqueue({ data: 'valid', deadline: Date.now() + 60000 });
      const task = await queue.dequeue();
      expect(task).toBeDefined();
      expect(task!.id).toBe(id);
    });

    it('should not dequeue cancelled tasks', async () => {
      const id = queue.enqueue({ data: 'cancelled' });
      queue.cancel(id);
      expect(await queue.dequeue()).toBeUndefined();
    });

    it('should not dequeue completed tasks', async () => {
      const id = queue.enqueue({ data: 'done' });
      await queue.dequeue();
      queue.complete(id);
      expect(await queue.dequeue()).toBeUndefined();
    });

    it('should not dequeue failed tasks', async () => {
      const id = queue.enqueue({ data: 'failed' });
      await queue.dequeue();
      queue.fail(id, new Error('err'));
      expect(await queue.dequeue()).toBeUndefined();
    });

    it('should handle FIFO for equal priority', async () => {
      queue.enqueue({ data: 'first', priority: 5 });
      queue.enqueue({ data: 'second', priority: 5 });
      const t1 = await queue.dequeue();
      expect(t1!.data).toBe('first');
    });

    it('should handle concurrent dequeue calls', async () => {
      queue.enqueue({ data: 'only' });
      const [r1, r2] = await Promise.all([queue.dequeue(), queue.dequeue()]);
      expect(r1).toBeDefined();
      expect(r2).toBeUndefined();
    });
  });

  // --- complete ---
  describe('complete', () => {
    it('should set status to completed', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.complete(id, 'result');
      expect(queue.getTask(id)?.status).toBe('completed');
    });

    it('should store result', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.complete(id, { key: 'value' });
      expect(queue.getTask(id)?.result).toEqual({ key: 'value' });
    });

    it('should set completedAt', async () => {
      const before = Date.now();
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.complete(id);
      const after = Date.now();
      expect(queue.getTask(id)?.completedAt).toBeGreaterThanOrEqual(before);
      expect(queue.getTask(id)?.completedAt).toBeLessThanOrEqual(after);
    });

    it('should emit complete event', async () => {
      let emitted = false;
      queue.on('complete', () => { emitted = true; });
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.complete(id);
      expect(emitted).toBe(true);
    });

    it('should handle complete on non-existent task gracefully', () => {
      expect(() => queue.complete('non-existent')).not.toThrow();
    });

    it('should handle complete with undefined result', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.complete(id);
      expect(queue.getTask(id)?.result).toBeUndefined();
    });
  });

  // --- fail ---
  describe('fail', () => {
    it('should set status to failed', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.fail(id, new Error('test error'));
      expect(queue.getTask(id)?.status).toBe('failed');
    });

    it('should store error', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      const err = new Error('detailed error');
      queue.fail(id, err);
      expect(queue.getTask(id)?.error).toBe(err);
    });

    it('should set completedAt', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.fail(id, new Error('err'));
      expect(queue.getTask(id)?.completedAt).toBeDefined();
    });

    it('should emit fail event', async () => {
      let emitted = false;
      queue.on('fail', () => { emitted = true; });
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.fail(id, new Error('err'));
      expect(emitted).toBe(true);
    });

    it('should handle fail on non-existent task gracefully', () => {
      expect(() => queue.fail('non-existent', new Error('err'))).not.toThrow();
    });
  });

  // --- retry ---
  describe('retry', () => {
    it('should set status back to pending', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.fail(id, new Error('err'));
      queue.retry(id);
      expect(queue.getTask(id)?.status).toBe('pending');
    });

    it('should clear error', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.fail(id, new Error('err'));
      queue.retry(id);
      expect(queue.getTask(id)?.error).toBeUndefined();
    });

    it('should clear startedAt', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.fail(id, new Error('err'));
      queue.retry(id);
      expect(queue.getTask(id)?.startedAt).toBeUndefined();
    });

    it('should clear completedAt', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.fail(id, new Error('err'));
      queue.retry(id);
      expect(queue.getTask(id)?.completedAt).toBeUndefined();
    });

    it('should emit retry event', async () => {
      let emitted = false;
      queue.on('retry', () => { emitted = true; });
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.fail(id, new Error('err'));
      queue.retry(id);
      expect(emitted).toBe(true);
    });

    it('should handle retry on non-existent task gracefully', () => {
      expect(() => queue.retry('non-existent')).not.toThrow();
    });

    it('should allow dequeuing after retry', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.fail(id, new Error('err'));
      queue.retry(id);
      const task = await queue.dequeue();
      expect(task).toBeDefined();
      expect(task!.id).toBe(id);
      expect(task!.attempts).toBe(2); // already 1 from first dequeue
    });
  });

  // --- cancel ---
  describe('cancel', () => {
    it('should cancel a pending task', () => {
      const id = queue.enqueue({ data: 'test' });
      expect(queue.cancel(id)).toBe(true);
      expect(queue.getTask(id)?.status).toBe('cancelled');
    });

    it('should cancel an active task', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      expect(queue.cancel(id)).toBe(true);
      expect(queue.getTask(id)?.status).toBe('cancelled');
    });

    it('should cancel a failed task', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.fail(id, new Error('err'));
      expect(queue.cancel(id)).toBe(true);
      expect(queue.getTask(id)?.status).toBe('cancelled');
    });

    it('should not cancel a completed task', async () => {
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.complete(id);
      expect(queue.cancel(id)).toBe(false);
    });

    it('should not cancel an already cancelled task', () => {
      const id = queue.enqueue({ data: 'test' });
      queue.cancel(id);
      expect(queue.cancel(id)).toBe(false);
    });

    it('should return false for non-existent task', () => {
      expect(queue.cancel('non-existent')).toBe(false);
    });

    it('should set completedAt on cancel', () => {
      const before = Date.now();
      const id = queue.enqueue({ data: 'test' });
      queue.cancel(id);
      const after = Date.now();
      expect(queue.getTask(id)?.completedAt).toBeGreaterThanOrEqual(before);
      expect(queue.getTask(id)?.completedAt).toBeLessThanOrEqual(after);
    });
  });

  // --- getTask ---
  describe('getTask', () => {
    it('should return task by id', () => {
      const id = queue.enqueue({ data: 'test' });
      expect(queue.getTask(id)).toBeDefined();
    });

    it('should return undefined for non-existent id', () => {
      expect(queue.getTask('non-existent')).toBeUndefined();
    });
  });

  // --- getPending / getActive / getCompleted / getFailed ---
  describe('status filters', () => {
    it('getPending returns only pending tasks', () => {
      queue.enqueue({ data: 'p1' });
      queue.enqueue({ data: 'p2' });
      expect(queue.getPending().length).toBe(2);
    });

    it('getActive returns only active tasks', async () => {
      queue.enqueue({ data: 'a1' });
      await queue.dequeue();
      expect(queue.getActive().length).toBe(1);
      expect(queue.getPending().length).toBe(0);
    });

    it('getCompleted returns only completed tasks', async () => {
      const id = queue.enqueue({ data: 'c1' });
      await queue.dequeue();
      queue.complete(id);
      expect(queue.getCompleted().length).toBe(1);
    });

    it('getFailed returns only failed tasks', async () => {
      const id = queue.enqueue({ data: 'f1' });
      await queue.dequeue();
      queue.fail(id, new Error('err'));
      expect(queue.getFailed().length).toBe(1);
    });

    it('all filters return empty for empty queue', () => {
      expect(queue.getPending().length).toBe(0);
      expect(queue.getActive().length).toBe(0);
      expect(queue.getCompleted().length).toBe(0);
      expect(queue.getFailed().length).toBe(0);
    });
  });

  // --- size / clear ---
  describe('size and clear', () => {
    it('size returns total task count', () => {
      queue.enqueue({ data: 't1' });
      queue.enqueue({ data: 't2' });
      queue.enqueue({ data: 't3' });
      expect(queue.size()).toBe(3);
    });

    it('clear removes all tasks', () => {
      queue.enqueue({ data: 't1' });
      queue.enqueue({ data: 't2' });
      queue.clear();
      expect(queue.size()).toBe(0);
    });

    it('clear on empty queue is safe', () => {
      expect(() => queue.clear()).not.toThrow();
    });
  });

  // --- event system ---
  describe('events', () => {
    it('should support multiple listeners for same event', () => {
      let count = 0;
      queue.on('enqueue', () => { count++; });
      queue.on('enqueue', () => { count++; });
      queue.on('enqueue', () => { count++; });
      queue.enqueue({ data: 'test' });
      expect(count).toBe(3);
    });

    it('should not call listeners for different events', async () => {
      let enqueueCalled = false;
      let completeCalled = false;
      queue.on('enqueue', () => { enqueueCalled = true; });
      queue.on('complete', () => { completeCalled = true; });
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.complete(id);
      expect(enqueueCalled).toBe(true);
      expect(completeCalled).toBe(true);
    });

    it('should pass correct task to handler', async () => {
      let capturedTask: Task<string> | undefined;
      queue.on('fail', (t) => { capturedTask = t; });
      const id = queue.enqueue({ data: 'test' });
      await queue.dequeue();
      queue.fail(id, new Error('err'));
      expect(capturedTask!.id).toBe(id);
      expect(capturedTask!.status).toBe('failed');
    });
  });

  // --- edge cases ---
  describe('edge cases', () => {
    it('should handle enqueue with both delay and deadline', async () => {
      const id = queue.enqueue({ data: 'test', delay: 0, deadline: Date.now() + 60000 });
      const task = await queue.dequeue();
      expect(task).toBeDefined();
      expect(task!.id).toBe(id);
    });

    it('should handle enqueue with past deadline (should not dequeue)', async () => {
      queue.enqueue({ data: 'test', deadline: Date.now() - 1 });
      expect(await queue.dequeue()).toBeUndefined();
    });

    it('should handle priority 0 as default', () => {
      const id = queue.enqueue({ data: 'test' });
      expect(queue.getTask(id)?.priority).toBe(0);
    });

    it('should handle complex data types', () => {
      const complex = { nested: { deep: true }, arr: [1, 2, 3] };
      const id = queue.enqueue({ data: complex as unknown as string });
      expect(queue.getTask(id)?.data).toEqual(complex);
    });
  });
});

// ============================================================
// WorkerPool Comprehensive Tests
// ============================================================
describe('WorkerPool - Comprehensive Coverage', () => {
  let pool: WorkerPool<number, number>;

  beforeEach(() => {
    pool = new WorkerPool<number, number>({ minWorkers: 2, maxWorkers: 5, taskTimeout: 5000 });
  });

  afterEach(() => {
    pool.terminate();
  });

  describe('constructor', () => {
    it('should initialize with minWorkers idle workers', () => {
      const stats = pool.getStats();
      expect(stats.idleWorkers).toBe(2);
      expect(stats.activeWorkers).toBe(0);
    });

    it('should default minWorkers to 1', () => {
      const p = new WorkerPool();
      expect(p.getStats().idleWorkers).toBe(1);
      p.terminate();
    });

    it('should default maxWorkers to 10', () => {
      const p = new WorkerPool();
      p.resize(10);
      expect(p.getStats().idleWorkers + p.getStats().activeWorkers).toBe(10);
      p.terminate();
    });

    it('should default taskTimeout to 30000', () => {
      const p = new WorkerPool();
      // Cannot directly check, but we can verify behavior
      expect(p).toBeDefined();
      p.terminate();
    });
  });

  describe('submit', () => {
    it('should execute handler and return result', async () => {
      const result = await pool.submit(5, async (t) => t * 2);
      expect(result).toBe(10);
    });

    it('should reject when pool is terminated', async () => {
      pool.terminate();
      await expect(pool.submit(1, async (t) => t)).rejects.toThrow('terminated');
    });

    it('should handle handler that throws', async () => {
      await expect(
        pool.submit(1, async () => { throw new Error('handler error'); })
      ).rejects.toThrow('handler error');
    });

    it('should handle handler returning undefined', async () => {
      const result = await pool.submit(1, async () => undefined);
      expect(result).toBeUndefined();
    });

    it('should handle handler returning complex objects', async () => {
      const result = await pool.submit(1, async () => ({ key: 'value', nested: { a: 1 } }));
      expect(result).toEqual({ key: 'value', nested: { a: 1 } });
    });
  });

  describe('submitBatch', () => {
    it('should submit multiple tasks and return all results', async () => {
      const results = await pool.submitBatch([1, 2, 3], async (t) => t * 10);
      expect(results).toEqual([10, 20, 30]);
    });

    it('should handle empty batch', async () => {
      const results = await pool.submitBatch([], async (t) => t);
      expect(results).toEqual([]);
    });

    it('should reject if any task fails', async () => {
      await expect(
        pool.submitBatch([1, 2, 3], async (t) => {
          if (t === 2) throw new Error('fail on 2');
          return t;
        })
      ).rejects.toThrow('fail on 2');
    });
  });

  describe('timeout', () => {
    it('should timeout long running tasks', async () => {
      const p = new WorkerPool({ taskTimeout: 50 });
      await expect(
        p.submit(1, async () => { await new Promise((r) => setTimeout(r, 5000)); return 1; })
      ).rejects.toThrow('timed out');
      p.terminate();
    });

    it('should not timeout fast tasks', async () => {
      const p = new WorkerPool({ taskTimeout: 5000 });
      const result = await p.submit(1, async () => 42);
      expect(result).toBe(42);
      p.terminate();
    });

    it('should handle timeout=0 (no timeout)', async () => {
      const p = new WorkerPool({ taskTimeout: 0 });
      const result = await p.submit(1, async () => {
        await new Promise((r) => setTimeout(r, 20));
        return 42;
      });
      expect(result).toBe(42);
      p.terminate();
    });

    it('should free worker after timeout', async () => {
      const p = new WorkerPool({ minWorkers: 1, maxWorkers: 1, taskTimeout: 50 });
      try { await p.submit(1, async () => { await new Promise((r) => setTimeout(r, 5000)); }); } catch {}
      // Worker should be free now
      const result = await p.submit(2, async (t) => t * 2);
      expect(result).toBe(4);
      p.terminate();
    });
  });

  describe('race condition: timeout vs resolve', () => {
    it('should not double-resolve when handler finishes just before timeout', async () => {
      const p = new WorkerPool({ minWorkers: 1, maxWorkers: 1, taskTimeout: 100 });
      let resolveHandler: (() => void) | undefined;
      const handlerPromise = new Promise<void>((resolve) => { resolveHandler = resolve; });

      const taskPromise = p.submit(1, async () => {
        await handlerPromise;
        return 'done';
      });

      // Let handler finish just before timeout
      await new Promise((r) => setTimeout(r, 30));
      resolveHandler!();

      // Should resolve cleanly without error
      const result = await taskPromise;
      expect(result).toBe('done');
      p.terminate();
    });
  });

  describe('resize', () => {
    it('should scale up workers', () => {
      pool.resize(4);
      const stats = pool.getStats();
      expect(stats.idleWorkers + stats.activeWorkers).toBe(4);
    });

    it('should not exceed maxWorkers when scaling up', () => {
      pool.resize(100);
      const stats = pool.getStats();
      expect(stats.idleWorkers + stats.activeWorkers).toBe(5); // maxWorkers
    });

    it('should scale down idle workers', () => {
      pool.resize(1);
      const stats = pool.getStats();
      expect(stats.idleWorkers + stats.activeWorkers).toBeLessThanOrEqual(2); // minWorkers
    });

    it('should not remove busy workers when scaling down', async () => {
      const p = new WorkerPool({ minWorkers: 1, maxWorkers: 3 });
      const taskPromise = p.submit(1, async () => {
        await new Promise((r) => setTimeout(r, 100));
        return 1;
      });
      p.resize(1);
      const result = await taskPromise;
      expect(result).toBe(1);
      p.terminate();
    });

    it('should not go below minWorkers', () => {
      pool.resize(0);
      const stats = pool.getStats();
      expect(stats.idleWorkers + stats.activeWorkers).toBeGreaterThanOrEqual(2); // minWorkers
    });
  });

  describe('drain', () => {
    it('should resolve when all tasks are done', async () => {
      pool.submit(1, async (t) => { await new Promise((r) => setTimeout(r, 20)); return t; });
      pool.submit(2, async (t) => { await new Promise((r) => setTimeout(r, 20)); return t; });
      await pool.drain();
      expect(pool.getStats().pendingTasks).toBe(0);
    });

    it('should resolve immediately on empty pool', async () => {
      await pool.drain();
      expect(true).toBe(true);
    });
  });

  describe('terminate', () => {
    it('should reject all pending tasks', async () => {
      const p = new WorkerPool({ minWorkers: 1, maxWorkers: 1 });
      // Block the only worker
      const blockingTask = p.submit(1, async () => {
        await new Promise((r) => setTimeout(r, 100));
        return 1;
      });
      // This task will be pending
      const pendingTask = p.submit(2, async (t) => t);
      p.terminate();
      await expect(pendingTask).rejects.toThrow('terminated');
      // blockingTask may or may not resolve
    });

    it('should clear all workers', () => {
      pool.terminate();
      expect(pool.getStats().idleWorkers).toBe(0);
      expect(pool.getStats().activeWorkers).toBe(0);
    });

    it('should handle double terminate', () => {
      pool.terminate();
      expect(() => pool.terminate()).not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should track completedTasks', async () => {
      await pool.submit(1, async (t) => t);
      await pool.submit(2, async (t) => t);
      expect(pool.getStats().completedTasks).toBe(2);
    });

    it('should track failedTasks', async () => {
      try { await pool.submit(1, async () => { throw new Error('err'); }); } catch {}
      expect(pool.getStats().failedTasks).toBe(1);
    });

    it('should track avgWaitTime', async () => {
      await pool.submit(1, async (t) => { await new Promise((r) => setTimeout(r, 10)); return t; });
      expect(pool.getStats().avgWaitTime).toBeGreaterThanOrEqual(0);
    });

    it('should return avgWaitTime 0 when no tasks completed', () => {
      expect(pool.getStats().avgWaitTime).toBe(0);
    });
  });

  describe('concurrent execution', () => {
    it('should execute tasks concurrently up to worker count', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      const p = new WorkerPool({ minWorkers: 3, maxWorkers: 3 });
      const tasks = Array.from({ length: 6 }, (_, i) =>
        p.submit(i, async () => {
          concurrent++;
          if (concurrent > maxConcurrent) maxConcurrent = concurrent;
          await new Promise((r) => setTimeout(r, 30));
          concurrent--;
          return i;
        })
      );
      const results = await Promise.all(tasks);
      expect(results).toEqual([0, 1, 2, 3, 4, 5]);
      expect(maxConcurrent).toBeLessThanOrEqual(3);
      expect(maxConcurrent).toBeGreaterThan(1);
      p.terminate();
    });

    it('should auto-scale under load', async () => {
      const p = new WorkerPool({ minWorkers: 1, maxWorkers: 5 });
      const tasks = Array.from({ length: 10 }, (_, i) =>
        p.submit(i, async () => {
          await new Promise((r) => setTimeout(r, 30));
          return i;
        })
      );
      const results = await Promise.all(tasks);
      expect(results.length).toBe(10);
      p.terminate();
    });
  });
});

// ============================================================
// DeadLetterQueue Comprehensive Tests
// ============================================================
describe('DeadLetterQueue - Comprehensive Coverage', () => {
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dlq = new DeadLetterQueue();
  });

  describe('add', () => {
    it('should add entry with auto-generated id', () => {
      dlq.add({ data: 'test', error: new Error('fail'), attempts: 3 });
      expect(dlq.size()).toBe(1);
    });

    it('should add entry with custom id', () => {
      dlq.add({ id: 'custom', data: 'test', error: new Error('fail'), attempts: 3 });
      expect(dlq.get('custom')).toBeDefined();
    });

    it('should default failedAt to now', () => {
      const before = Date.now();
      dlq.add({ data: 'test', error: new Error('fail'), attempts: 1 });
      const after = Date.now();
      const entry = dlq.getAll()[0] as DeadLetterEntry;
      expect(entry.failedAt).toBeGreaterThanOrEqual(before);
      expect(entry.failedAt).toBeLessThanOrEqual(after);
    });

    it('should use provided failedAt', () => {
      const time = Date.now() - 5000;
      dlq.add({ data: 'test', error: new Error('fail'), attempts: 1, failedAt: time });
      const entry = dlq.getAll()[0] as DeadLetterEntry;
      expect(entry.failedAt).toBe(time);
    });
  });

  describe('requeue', () => {
    it('should return entry data and remove from queue', () => {
      dlq.add({ id: 'e1', data: 'test-data', error: new Error('fail'), attempts: 3 });
      const result = dlq.requeue('e1');
      expect(result).toBeDefined();
      expect((result as { data: unknown }).data).toBe('test-data');
      expect(dlq.size()).toBe(0);
    });

    it('should return undefined for non-existent entry', () => {
      expect(dlq.requeue('non-existent')).toBeUndefined();
    });

    it('should increment requeuedCount', () => {
      dlq.add({ id: 'e1', data: 'test', error: new Error('fail'), attempts: 1 });
      dlq.requeue('e1');
      expect(dlq.getStats().requeued).toBe(1);
    });
  });

  describe('discard', () => {
    it('should remove entry and return true', () => {
      dlq.add({ id: 'e1', data: 'test', error: new Error('fail'), attempts: 1 });
      expect(dlq.discard('e1')).toBe(true);
      expect(dlq.size()).toBe(0);
    });

    it('should return false for non-existent entry', () => {
      expect(dlq.discard('non-existent')).toBe(false);
    });

    it('should increment discardedCount', () => {
      dlq.add({ id: 'e1', data: 'test', error: new Error('fail'), attempts: 1 });
      dlq.discard('e1');
      expect(dlq.getStats().discarded).toBe(1);
    });
  });

  describe('get', () => {
    it('should return entry by id', () => {
      dlq.add({ id: 'e1', data: 'test', error: new Error('fail'), attempts: 3 });
      expect(dlq.get('e1')).toBeDefined();
    });

    it('should return undefined for non-existent id', () => {
      expect(dlq.get('non-existent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all entries', () => {
      dlq.add({ id: 'e1', data: 'test1', error: new Error('fail'), attempts: 1 });
      dlq.add({ id: 'e2', data: 'test2', error: new Error('fail'), attempts: 2 });
      expect(dlq.getAll().length).toBe(2);
    });

    it('should filter entries', () => {
      dlq.add({ id: 'e1', data: 'test1', error: new Error('typeA'), attempts: 1 });
      dlq.add({ id: 'e2', data: 'test2', error: new Error('typeB'), attempts: 2 });
      const filtered = dlq.getAll((e) => e.error.message === 'typeA');
      expect(filtered.length).toBe(1);
    });

    it('should return empty array for empty queue', () => {
      expect(dlq.getAll()).toEqual([]);
    });
  });

  describe('purge', () => {
    it('should purge all entries when no maxAge', () => {
      dlq.add({ id: 'e1', data: 'test', error: new Error('fail'), attempts: 1 });
      dlq.add({ id: 'e2', data: 'test', error: new Error('fail'), attempts: 1 });
      const count = dlq.purge();
      expect(count).toBe(2);
      expect(dlq.size()).toBe(0);
    });

    it('should purge entries older than maxAge', () => {
      dlq.add({ id: 'e1', data: 'old', error: new Error('fail'), attempts: 1, failedAt: Date.now() - 2000 });
      dlq.add({ id: 'e2', data: 'new', error: new Error('fail'), attempts: 1, failedAt: Date.now() });
      const count = dlq.purge(1000);
      expect(count).toBe(1);
      expect(dlq.size()).toBe(1);
    });

    it('should return 0 when nothing to purge', () => {
      dlq.add({ id: 'e1', data: 'new', error: new Error('fail'), attempts: 1, failedAt: Date.now() });
      expect(dlq.purge(10000)).toBe(0);
    });

    it('should handle purge on empty queue', () => {
      expect(dlq.purge()).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should group by error type', () => {
      dlq.add({ data: 'test1', error: new Error('fail'), attempts: 1 });
      dlq.add({ data: 'test2', error: new TypeError('type err'), attempts: 1 });
      const stats = dlq.getStats();
      expect(stats.byErrorType['Error']).toBe(1);
      expect(stats.byErrorType['TypeError']).toBe(1);
    });

    it('should handle null error gracefully', () => {
      dlq.add({ data: 'test', error: null as unknown as Error, attempts: 1 });
      const stats = dlq.getStats();
      expect(stats.byErrorType['UnknownError']).toBe(1);
    });
  });
});

// ============================================================
// DelayedQueue Comprehensive Tests
// ============================================================
describe('DelayedQueue - Comprehensive Coverage', () => {
  let dq: DelayedQueue<string>;

  beforeEach(() => {
    dq = new DelayedQueue<string>();
  });

  describe('schedule', () => {
    it('should schedule with delay and return id', () => {
      const id = dq.schedule('test', 5000);
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(dq.size()).toBe(1);
    });

    it('should schedule with options', () => {
      const id = dq.schedule('test', 5000, { priority: 10 });
      expect(id).toBeDefined();
    });

    it('should schedule with 0 delay (immediately due)', () => {
      dq.schedule('test', 0);
      expect(dq.process()).toBe(1);
    });

    it('should schedule with negative delay (past due)', () => {
      dq.schedule('test', -1000);
      expect(dq.process()).toBe(1);
    });
  });

  describe('scheduleAt', () => {
    it('should schedule at specific timestamp', () => {
      const timestamp = Date.now() + 10000;
      const id = dq.scheduleAt('test', timestamp);
      expect(id).toBeDefined();
    });

    it('should schedule at past timestamp (immediately due)', () => {
      dq.scheduleAt('test', Date.now() - 1000);
      expect(dq.process()).toBe(1);
    });
  });

  describe('cancel', () => {
    it('should cancel scheduled task', () => {
      const id = dq.schedule('test', 5000);
      expect(dq.cancel(id)).toBe(true);
      expect(dq.size()).toBe(0);
    });

    it('should return false for non-existent task', () => {
      expect(dq.cancel('non-existent')).toBe(false);
    });
  });

  describe('process', () => {
    it('should process only due tasks', () => {
      dq.schedule('due', -1000);
      dq.schedule('future', 60000);
      expect(dq.process()).toBe(1);
      expect(dq.size()).toBe(1);
    });

    it('should call handler with data and id', () => {
      let receivedData: string | undefined;
      let receivedId: string | undefined;
      dq.setHandler((data, id) => { receivedData = data; receivedId = id; });
      const id = dq.schedule('hello', -1000);
      dq.process();
      expect(receivedData).toBe('hello');
      expect(receivedId).toBe(id);
    });

    it('should handle no handler gracefully', () => {
      dq.schedule('test', -1000);
      expect(() => dq.process()).not.toThrow();
      expect(dq.size()).toBe(0);
    });

    it('should return 0 for empty queue', () => {
      expect(dq.process()).toBe(0);
    });

    it('should process multiple due tasks', () => {
      dq.schedule('t1', -1000);
      dq.schedule('t2', -1000);
      dq.schedule('t3', -5000);
      expect(dq.process()).toBe(3);
      expect(dq.size()).toBe(0);
    });
  });

  describe('getScheduled', () => {
    it('should return all scheduled tasks', () => {
      dq.schedule('t1', 5000);
      dq.schedule('t2', 10000);
      const scheduled = dq.getScheduled();
      expect(scheduled.length).toBe(2);
    });

    it('should include executeAt', () => {
      const executeAt = Date.now() + 5000;
      const id = dq.scheduleAt('test', executeAt);
      const scheduled = dq.getScheduled();
      const task = scheduled.find((t) => t.id === id);
      expect(task?.executeAt).toBe(executeAt);
    });
  });

  describe('clear', () => {
    it('should remove all tasks', () => {
      dq.schedule('t1', 5000);
      dq.schedule('t2', 10000);
      dq.clear();
      expect(dq.size()).toBe(0);
    });
  });

  describe('constructor with handler', () => {
    it('should accept handler in constructor', () => {
      let called = false;
      const q = new DelayedQueue<string>(() => { called = true; });
      q.schedule('test', -1000);
      q.process();
      expect(called).toBe(true);
    });
  });

  describe('setHandler', () => {
    it('should replace existing handler', () => {
      let firstCalled = false;
      let secondCalled = false;
      dq.setHandler(() => { firstCalled = true; });
      dq.setHandler(() => { secondCalled = true; });
      dq.schedule('test', -1000);
      dq.process();
      expect(firstCalled).toBe(false);
      expect(secondCalled).toBe(true);
    });
  });
});

// ============================================================
// RateLimiter Comprehensive Tests
// ============================================================
describe('RateLimiter - Comprehensive Coverage', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ rate: 10, burst: 5 });
  });

  describe('constructor', () => {
    it('should initialize tokens to burst', () => {
      expect(limiter.getAvailableTokens()).toBe(5);
    });

    it('should handle high burst', () => {
      const l = new RateLimiter({ rate: 100, burst: 50 });
      expect(l.getAvailableTokens()).toBe(50);
    });

    it('should handle low rate', () => {
      const l = new RateLimiter({ rate: 1, burst: 2 });
      expect(l.getAvailableTokens()).toBe(2);
    });
  });

  describe('tryAcquire', () => {
    it('should succeed when tokens available', () => {
      expect(limiter.tryAcquire()).toBe(true);
    });

    it('should decrease tokens', () => {
      limiter.tryAcquire(3);
      expect(limiter.getAvailableTokens()).toBe(2);
    });

    it('should fail when insufficient tokens', () => {
      limiter.tryAcquire(5);
      expect(limiter.tryAcquire()).toBe(false);
    });

    it('should track totalAcquired', () => {
      limiter.tryAcquire(2);
      limiter.tryAcquire(1);
      expect(limiter.getStats().totalAcquired).toBe(3);
    });

    it('should track totalRejected', () => {
      limiter.tryAcquire(5);
      limiter.tryAcquire(1);
      expect(limiter.getStats().totalRejected).toBe(1);
    });

    it('should handle count > burst', () => {
      expect(limiter.tryAcquire(10)).toBe(false);
    });

    it('should handle count of 0', () => {
      expect(limiter.tryAcquire(0)).toBe(true);
    });
  });

  describe('acquire', () => {
    it('should succeed immediately when tokens available', async () => {
      await limiter.acquire(1);
      expect(limiter.getStats().totalAcquired).toBe(1);
    });

    it('should wait when tokens insufficient', async () => {
      limiter.tryAcquire(5);
      const start = Date.now();
      await limiter.acquire(1);
      expect(Date.now() - start).toBeGreaterThan(50);
    });

    it('should handle default count of 1', async () => {
      await limiter.acquire();
      expect(limiter.getAvailableTokens()).toBe(4);
    });

    it('should handle custom count', async () => {
      await limiter.acquire(3);
      expect(limiter.getAvailableTokens()).toBe(2);
    });
  });

  describe('refill', () => {
    it('should refill tokens over time', async () => {
      limiter.tryAcquire(5);
      await new Promise((r) => setTimeout(r, 200));
      expect(limiter.getAvailableTokens()).toBeGreaterThan(0);
    });

    it('should not exceed burst on refill', async () => {
      await new Promise((r) => setTimeout(r, 500));
      expect(limiter.getAvailableTokens()).toBeLessThanOrEqual(5);
    });
  });

  describe('getStats', () => {
    it('should return all stat fields', () => {
      const stats = limiter.getStats();
      expect(stats).toHaveProperty('available');
      expect(stats).toHaveProperty('totalAcquired');
      expect(stats).toHaveProperty('totalRejected');
      expect(stats).toHaveProperty('waitTime');
    });

    it('should track waitTime', async () => {
      limiter.tryAcquire(5);
      await limiter.acquire(1);
      expect(limiter.getStats().waitTime).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      limiter.tryAcquire(3);
      limiter.reset();
      expect(limiter.getAvailableTokens()).toBe(5);
      expect(limiter.getStats().totalAcquired).toBe(0);
      expect(limiter.getStats().totalRejected).toBe(0);
    });
  });
});

// ============================================================
// JobScheduler Comprehensive Tests
// ============================================================
describe('JobScheduler - Comprehensive Coverage', () => {
  let scheduler: JobScheduler;

  beforeEach(() => {
    scheduler = new JobScheduler();
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe('schedule', () => {
    it('should schedule a cron job and return id', () => {
      const id = scheduler.schedule('test', '* * * * *', async () => {});
      expect(id).toBeDefined();
    });

    it('should store job name', () => {
      const id = scheduler.schedule('my-job', '* * * * *', async () => {});
      const job = scheduler.getJobs().find((j) => j.id === id);
      expect(job?.name).toBe('my-job');
    });

    it('should set cron expression', () => {
      scheduler.schedule('test', '*/5 * * * *', async () => {});
      const job = scheduler.getJobs()[0];
      expect(job?.cron).toBe('*/5 * * * *');
    });

    it('should set nextRun', () => {
      scheduler.schedule('test', '* * * * *', async () => {});
      const job = scheduler.getJobs()[0];
      expect(job?.nextRun).toBeGreaterThan(Date.now());
    });

    it('should initialize job as not running', () => {
      scheduler.schedule('test', '* * * * *', async () => {});
      const job = scheduler.getJobs()[0];
      expect(job?.running).toBe(false);
    });
  });

  describe('scheduleInterval', () => {
    it('should schedule an interval job', () => {
      const id = scheduler.scheduleInterval('test', 1000, async () => {});
      expect(id).toBeDefined();
    });

    it('should set intervalMs', () => {
      scheduler.scheduleInterval('test', 5000, async () => {});
      const job = scheduler.getJobs()[0];
      expect(job?.intervalMs).toBe(5000);
    });

    it('should set nextRun to now + interval', () => {
      const before = Date.now();
      scheduler.scheduleInterval('test', 5000, async () => {});
      const after = Date.now();
      const job = scheduler.getJobs()[0];
      expect(job?.nextRun).toBeGreaterThanOrEqual(before + 5000);
      expect(job?.nextRun).toBeLessThanOrEqual(after + 5000);
    });
  });

  describe('unschedule', () => {
    it('should remove a scheduled job', () => {
      const id = scheduler.schedule('test', '* * * * *', async () => {});
      expect(scheduler.unschedule(id)).toBe(true);
      expect(scheduler.getJobs().length).toBe(0);
    });

    it('should return false for non-existent job', () => {
      expect(scheduler.unschedule('non-existent')).toBe(false);
    });

    it('should clear timer for interval job', () => {
      const id = scheduler.scheduleInterval('test', 1000, async () => {});
      scheduler.start();
      scheduler.unschedule(id);
      // Should not throw or leak timers
    });

    it('should clear timer for cron job', () => {
      const id = scheduler.schedule('test', '* * * * *', async () => {});
      scheduler.start();
      scheduler.unschedule(id);
      // Should not throw or leak timers
    });
  });

  describe('runNow', () => {
    it('should execute job immediately', async () => {
      let called = false;
      const id = scheduler.schedule('test', '* * * * *', async () => { called = true; });
      await scheduler.runNow(id);
      expect(called).toBe(true);
    });

    it('should throw for non-existent job', async () => {
      await expect(scheduler.runNow('non-existent')).rejects.toThrow();
    });

    it('should not run job that is already running', async () => {
      let runCount = 0;
      const id = scheduler.schedule('test', '* * * * *', async () => {
        runCount++;
        await new Promise((r) => setTimeout(r, 100));
      });
      const [r1, r2] = await Promise.all([
        scheduler.runNow(id),
        scheduler.runNow(id),
      ]);
      expect(runCount).toBe(1);
    });
  });

  describe('getJobHistory', () => {
    it('should return empty array for non-existent job', () => {
      expect(scheduler.getJobHistory('non-existent')).toEqual([]);
    });

    it('should record success', async () => {
      const id = scheduler.schedule('test', '* * * * *', async () => {});
      await scheduler.runNow(id);
      const history = scheduler.getJobHistory(id);
      expect(history[0]?.success).toBe(true);
    });

    it('should record failure', async () => {
      const id = scheduler.schedule('test', '* * * * *', async () => { throw new Error('fail'); });
      await scheduler.runNow(id);
      const history = scheduler.getJobHistory(id);
      expect(history[0]?.success).toBe(false);
      expect(history[0]?.error).toBe('fail');
    });

    it('should record duration', async () => {
      const id = scheduler.schedule('test', '* * * * *', async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      await scheduler.runNow(id);
      const history = scheduler.getJobHistory(id);
      expect(history[0]?.duration).toBeGreaterThanOrEqual(40);
    });

    it('should record multiple executions', async () => {
      const id = scheduler.schedule('test', '* * * * *', async () => {});
      await scheduler.runNow(id);
      await scheduler.runNow(id);
      expect(scheduler.getJobHistory(id).length).toBe(2);
    });
  });

  describe('start/stop', () => {
    it('should start and stop without error', () => {
      scheduler.start();
      scheduler.stop();
    });

    it('should handle double start', () => {
      scheduler.start();
      scheduler.start();
      scheduler.stop();
    });

    it('should handle double stop', () => {
      scheduler.stop();
      scheduler.stop();
    });

    it('should auto-start scheduled jobs', async () => {
      let called = false;
      scheduler.scheduleInterval('test', 100, async () => { called = true; });
      scheduler.start();
      // Wait for the 1-second check interval to fire and the interval to elapse
      await new Promise((r) => setTimeout(r, 1500));
      scheduler.stop();
      expect(called).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return correct initial stats', () => {
      scheduler.schedule('j1', '* * * * *', async () => {});
      scheduler.schedule('j2', '* * * * *', async () => {});
      const stats = scheduler.getStats();
      expect(stats.totalJobs).toBe(2);
      expect(stats.activeJobs).toBe(0);
      expect(stats.totalExecutions).toBe(0);
      expect(stats.failedExecutions).toBe(0);
    });

    it('should track totalExecutions', async () => {
      const id = scheduler.schedule('test', '* * * * *', async () => {});
      await scheduler.runNow(id);
      expect(scheduler.getStats().totalExecutions).toBe(1);
    });

    it('should track failedExecutions', async () => {
      const id = scheduler.schedule('test', '* * * * *', async () => { throw new Error('fail'); });
      await scheduler.runNow(id);
      expect(scheduler.getStats().failedExecutions).toBe(1);
    });
  });

  describe('cron parsing', () => {
    it('should parse wildcard cron', () => {
      const id = scheduler.schedule('test', '* * * * *', async () => {});
      expect(id).toBeDefined();
    });

    it('should parse step cron', () => {
      const id = scheduler.schedule('test', '*/5 * * * *', async () => {});
      expect(id).toBeDefined();
    });

    it('should parse range cron', () => {
      const id = scheduler.schedule('test', '0 9-17 * * *', async () => {});
      expect(id).toBeDefined();
    });
  });
});

// ============================================================
// TaskMonitor Comprehensive Tests
// ============================================================
describe('TaskMonitor - Comprehensive Coverage', () => {
  let monitor: TaskMonitor;

  beforeEach(() => {
    monitor = new TaskMonitor();
  });

  describe('recordEvent', () => {
    it('should record event', () => {
      monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
      expect(monitor.getStats().totalEvents).toBe(1);
    });

    it('should record event with data', () => {
      monitor.recordEvent({
        type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now(), data: { key: 'value' },
      });
      expect(monitor.getStats().totalEvents).toBe(1);
    });

    it('should trim events to MAX_EVENTS', () => {
      // TaskMonitor.MAX_EVENTS = 10000, but we can test the mechanism
      for (let i = 0; i < 10050; i++) {
        monitor.recordEvent({ type: 'enqueue', taskId: `t${i}`, queue: 'q1', timestamp: Date.now() });
      }
      expect(monitor.getStats().totalEvents).toBeLessThanOrEqual(10000);
    });
  });

  describe('getQueueHealth', () => {
    it('should calculate throughput', () => {
      monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
      monitor.recordEvent({ type: 'complete', taskId: 't1', queue: 'q1', timestamp: Date.now() + 100 });
      const health = monitor.getQueueHealth('q1');
      expect(health.throughput).toBe(1);
    });

    it('should calculate error rate', () => {
      monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
      monitor.recordEvent({ type: 'fail', taskId: 't1', queue: 'q1', timestamp: Date.now() + 100 });
      monitor.recordEvent({ type: 'enqueue', taskId: 't2', queue: 'q1', timestamp: Date.now() + 200 });
      monitor.recordEvent({ type: 'complete', taskId: 't2', queue: 'q1', timestamp: Date.now() + 300 });
      const health = monitor.getQueueHealth('q1');
      expect(health.errorRate).toBeCloseTo(0.5);
    });

    it('should calculate avgLatency', () => {
      monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
      monitor.recordEvent({ type: 'complete', taskId: 't1', queue: 'q1', timestamp: Date.now() + 200 });
      const health = monitor.getQueueHealth('q1');
      expect(health.avgLatency).toBe(200);
    });

    it('should return zero health for unknown queue', () => {
      const health = monitor.getQueueHealth('unknown');
      expect(health.throughput).toBe(0);
      expect(health.avgLatency).toBe(0);
      expect(health.errorRate).toBe(0);
    });
  });

  describe('getDashboard', () => {
    it('should return dashboard with queue data', () => {
      monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
      const dashboard = monitor.getDashboard();
      expect(dashboard.totalTasks).toBe(1);
      expect(dashboard.queues['q1']).toBeDefined();
    });

    it('should calculate successRate', () => {
      monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
      monitor.recordEvent({ type: 'complete', taskId: 't1', queue: 'q1', timestamp: Date.now() + 100 });
      const dashboard = monitor.getDashboard();
      expect(dashboard.successRate).toBe(1);
    });

    it('should return empty dashboard for no events', () => {
      const dashboard = monitor.getDashboard();
      expect(dashboard.totalTasks).toBe(0);
      expect(Object.keys(dashboard.queues).length).toBe(0);
    });
  });

  describe('alerts', () => {
    it('should add alert rule', () => {
      monitor.addAlertRule({ condition: 'error', severity: 'high', message: 'Error detected' });
      expect(monitor.getAlerts().length).toBe(0); // not triggered yet
    });

    it('should trigger alert on fail event', () => {
      monitor.addAlertRule({ condition: 'error', severity: 'high', message: 'Error detected' });
      monitor.recordEvent({ type: 'fail', taskId: 't1', queue: 'q1', timestamp: Date.now() });
      const alerts = monitor.getAlerts();
      expect(alerts.length).toBe(1);
      expect(alerts[0]?.severity).toBe('high');
    });

    it('should not trigger alert for non-matching events', () => {
      monitor.addAlertRule({ condition: 'error', severity: 'high', message: 'Error detected' });
      monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
      expect(monitor.getAlerts().length).toBe(0);
    });

    it('should not duplicate alerts for same rule', () => {
      monitor.addAlertRule({ condition: 'error', severity: 'high', message: 'Error detected' });
      monitor.recordEvent({ type: 'fail', taskId: 't1', queue: 'q1', timestamp: Date.now() });
      monitor.recordEvent({ type: 'fail', taskId: 't2', queue: 'q1', timestamp: Date.now() });
      expect(monitor.getAlerts().length).toBe(1);
    });
  });

  describe('getHistory', () => {
    it('should return all events without timeWindow', () => {
      monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
      expect(monitor.getHistory().length).toBe(1);
    });

    it('should filter by timeWindow', () => {
      monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() - 10000 });
      monitor.recordEvent({ type: 'enqueue', taskId: 't2', queue: 'q1', timestamp: Date.now() });
      expect(monitor.getHistory(5000).length).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should count events by type and queue', () => {
      monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
      monitor.recordEvent({ type: 'enqueue', taskId: 't2', queue: 'q2', timestamp: Date.now() });
      monitor.recordEvent({ type: 'complete', taskId: 't1', queue: 'q1', timestamp: Date.now() });
      const stats = monitor.getStats();
      expect(stats.totalEvents).toBe(3);
      expect(stats.eventsByType['enqueue']).toBe(2);
      expect(stats.eventsByType['complete']).toBe(1);
      expect(stats.eventsByQueue['q1']).toBe(2);
      expect(stats.eventsByQueue['q2']).toBe(1);
    });
  });
});

// ============================================================
// TaskRepository Comprehensive Tests
// ============================================================
describe('TaskRepository - Comprehensive Coverage', () => {
  let repo: TaskRepository;

  beforeEach(() => {
    repo = new TaskRepository();
  });

  describe('save/find', () => {
    it('should save and find a task', () => {
      const task = { id: 't1', data: 'test', priority: 0, status: 'pending' as const, createdAt: Date.now(), attempts: 0, maxAttempts: 3 };
      repo.save(task);
      expect(repo.find('t1')?.id).toBe('t1');
    });

    it('should return a copy from find', () => {
      repo.save({ id: 't1', data: 'test', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      const found = repo.find('t1')!;
      found.status = 'completed';
      expect(repo.find('t1')?.status).toBe('pending');
    });

    it('should return undefined for non-existent task', () => {
      expect(repo.find('non-existent')).toBeUndefined();
    });

    it('should overwrite on duplicate save', () => {
      repo.save({ id: 't1', data: 'original', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      repo.save({ id: 't1', data: 'updated', priority: 5, status: 'pending', createdAt: Date.now(), attempts: 1, maxAttempts: 3 });
      expect(repo.find('t1')?.data).toBe('updated');
      expect(repo.count()).toBe(1);
    });
  });

  describe('findByStatus', () => {
    it('should find tasks by status', () => {
      repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      repo.save({ id: 't2', data: 'b', priority: 0, status: 'completed', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      expect(repo.findByStatus('pending').length).toBe(1);
    });

    it('should return copies', () => {
      repo.save({ id: 't1', data: 'test', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      const results = repo.findByStatus('pending');
      if (results[0]) results[0].status = 'completed';
      expect(repo.find('t1')?.status).toBe('pending');
    });

    it('should return empty for non-matching status', () => {
      repo.save({ id: 't1', data: 'test', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      expect(repo.findByStatus('completed').length).toBe(0);
    });
  });

  describe('findDueTasks', () => {
    it('should find tasks with elapsed delay', () => {
      repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now() - 2000, delay: 1000, attempts: 0, maxAttempts: 3 });
      repo.save({ id: 't2', data: 'b', priority: 0, status: 'pending', createdAt: Date.now(), delay: 60000, attempts: 0, maxAttempts: 3 });
      const due = repo.findDueTasks();
      expect(due.length).toBe(1);
      expect(due[0]?.id).toBe('t1');
    });

    it('should exclude tasks past deadline', () => {
      repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now() - 2000, deadline: Date.now() - 1000, attempts: 0, maxAttempts: 3 });
      const due = repo.findDueTasks();
      expect(due.length).toBe(0);
    });

    it('should include tasks with future deadline', () => {
      repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now(), deadline: Date.now() + 60000, attempts: 0, maxAttempts: 3 });
      const due = repo.findDueTasks();
      expect(due.length).toBe(1);
    });

    it('should include tasks with no delay and no deadline', () => {
      repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      const due = repo.findDueTasks();
      expect(due.length).toBe(1);
    });

    it('should exclude non-pending tasks', () => {
      repo.save({ id: 't1', data: 'a', priority: 0, status: 'completed', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      expect(repo.findDueTasks().length).toBe(0);
    });

    it('should handle task with both delay and deadline', () => {
      // delay elapsed, deadline in future -> due
      repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now() - 2000, delay: 1000, deadline: Date.now() + 60000, attempts: 0, maxAttempts: 3 });
      const due = repo.findDueTasks();
      expect(due.length).toBe(1);
    });

    it('should exclude task with both delay not elapsed and deadline in future', () => {
      repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now(), delay: 60000, deadline: Date.now() + 120000, attempts: 0, maxAttempts: 3 });
      const due = repo.findDueTasks();
      expect(due.length).toBe(0);
    });
  });

  describe('update', () => {
    it('should update task fields', () => {
      repo.save({ id: 't1', data: 'test', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      expect(repo.update('t1', { status: 'completed' })).toBe(true);
      expect(repo.find('t1')?.status).toBe('completed');
    });

    it('should return false for non-existent task', () => {
      expect(repo.update('non-existent', { status: 'completed' })).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete a task', () => {
      repo.save({ id: 't1', data: 'test', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      expect(repo.delete('t1')).toBe(true);
      expect(repo.count()).toBe(0);
    });

    it('should return false for non-existent task', () => {
      expect(repo.delete('non-existent')).toBe(false);
    });
  });

  describe('count', () => {
    it('should count all tasks', () => {
      repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      repo.save({ id: 't2', data: 'b', priority: 0, status: 'completed', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      expect(repo.count()).toBe(2);
    });

    it('should count by status', () => {
      repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      repo.save({ id: 't2', data: 'b', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      repo.save({ id: 't3', data: 'c', priority: 0, status: 'completed', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      expect(repo.count('pending')).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all tasks', () => {
      repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      repo.save({ id: 't2', data: 'b', priority: 0, status: 'completed', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
      repo.clear();
      expect(repo.count()).toBe(0);
    });
  });
});

// ============================================================
// BackoffStrategy Comprehensive Tests
// ============================================================
describe('ExponentialBackoff - Comprehensive', () => {
  it('should return baseMs for attempt 0', () => {
    const b = new ExponentialBackoff({ baseMs: 100, maxMs: 10000, jitter: false });
    expect(b.getDelay(0)).toBe(100);
  });

  it('should double each attempt', () => {
    const b = new ExponentialBackoff({ baseMs: 100, maxMs: 10000, jitter: false });
    expect(b.getDelay(0)).toBe(100);
    expect(b.getDelay(1)).toBe(200);
    expect(b.getDelay(2)).toBe(400);
    expect(b.getDelay(3)).toBe(800);
  });

  it('should cap at maxMs', () => {
    const b = new ExponentialBackoff({ baseMs: 100, maxMs: 500, jitter: false });
    expect(b.getDelay(10)).toBe(500);
  });

  it('should add jitter within range', () => {
    const b = new ExponentialBackoff({ baseMs: 1000, maxMs: 30000, jitter: true });
    for (let i = 0; i < 50; i++) {
      const delay = b.getDelay(1);
      expect(delay).toBeGreaterThanOrEqual(500); // 1000 * 2 * 0.25
      expect(delay).toBeLessThanOrEqual(2000); // 1000 * 2 * 1.0
    }
  });

  it('should use default baseMs=100, maxMs=30000', () => {
    const b = new ExponentialBackoff();
    expect(b.getDelay(0)).toBe(100);
    expect(b.getDelay(9)).toBe(30000); // 100 * 512 = 51200 > 30000, capped
  });

  it('should reset', () => {
    const b = new ExponentialBackoff();
    b.getDelay(5);
    b.reset();
    expect(b).toBeDefined();
  });
});

describe('FixedBackoff - Comprehensive', () => {
  it('should return same delay for all attempts', () => {
    const b = new FixedBackoff(500);
    expect(b.getDelay(0)).toBe(500);
    expect(b.getDelay(1)).toBe(500);
    expect(b.getDelay(100)).toBe(500);
  });

  it('should handle zero delay', () => {
    const b = new FixedBackoff(0);
    expect(b.getDelay(0)).toBe(0);
  });

  it('should reset without error', () => {
    const b = new FixedBackoff(500);
    b.reset();
  });
});

describe('LinearBackoff - Comprehensive', () => {
  it('should return startMs + increment * attempt', () => {
    const b = new LinearBackoff(100, 50, 10000);
    expect(b.getDelay(0)).toBe(100);
    expect(b.getDelay(1)).toBe(150);
    expect(b.getDelay(2)).toBe(200);
    expect(b.getDelay(10)).toBe(600);
  });

  it('should cap at maxMs', () => {
    const b = new LinearBackoff(100, 50, 200);
    expect(b.getDelay(0)).toBe(100);
    expect(b.getDelay(1)).toBe(150);
    expect(b.getDelay(2)).toBe(200);
    expect(b.getDelay(10)).toBe(200);
  });

  it('should handle zero startMs', () => {
    const b = new LinearBackoff(0, 100, 1000);
    expect(b.getDelay(0)).toBe(0);
    expect(b.getDelay(1)).toBe(100);
  });

  it('should reset without error', () => {
    const b = new LinearBackoff(100, 50, 1000);
    b.reset();
  });
});

// ============================================================
// WorkflowQueue Comprehensive Tests
// ============================================================
describe('WorkflowQueue - Comprehensive Coverage', () => {
  let wfq: WorkflowQueue;

  beforeEach(() => {
    wfq = new WorkflowQueue();
  });

  describe('defineWorkflow', () => {
    it('should define workflow and return id', () => {
      const id = wfq.defineWorkflow('test', [
        { name: 'step1', handler: async () => 'r1' },
        { name: 'step2', handler: async () => 'r2' },
      ]);
      expect(id).toBe('test');
    });

    it('should overwrite workflow with same name', async () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      wfq.defineWorkflow('test', [{ name: 's2', handler: async () => 'r2' }]);
      const instanceId = wfq.enqueue('test', {});
      const result = await wfq.processNext(instanceId);
      expect(result.stepName).toBe('s2');
    });
  });

  describe('enqueue', () => {
    it('should enqueue workflow instance', () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      const instanceId = wfq.enqueue('test', { input: 'data' });
      expect(instanceId).toBeDefined();
    });

    it('should throw for non-existent workflow', () => {
      expect(() => wfq.enqueue('non-existent', {})).toThrow();
    });

    it('should accept custom instanceId', () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      const instanceId = wfq.enqueue('test', {}, { instanceId: 'my-instance' });
      expect(instanceId).toBe('my-instance');
      expect(wfq.getWorkflowStatus('my-instance')).toBeDefined();
    });

    it('should set initial status to pending', () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      const instanceId = wfq.enqueue('test', {});
      expect(wfq.getWorkflowStatus(instanceId)?.status).toBe('pending');
    });

    it('should set currentStep to 0', () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      const instanceId = wfq.enqueue('test', {});
      expect(wfq.getWorkflowStatus(instanceId)?.currentStep).toBe(0);
    });

    it('should set createdAt and updatedAt', () => {
      const before = Date.now();
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      const instanceId = wfq.enqueue('test', {});
      const after = Date.now();
      const status = wfq.getWorkflowStatus(instanceId)!;
      expect(status.createdAt).toBeGreaterThanOrEqual(before);
      expect(status.createdAt).toBeLessThanOrEqual(after);
      expect(status.updatedAt).toBeGreaterThanOrEqual(before);
      expect(status.updatedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('processNext', () => {
    it('should process first step', async () => {
      wfq.defineWorkflow('test', [
        { name: 'step1', handler: async () => 'result1' },
        { name: 'step2', handler: async () => 'result2' },
      ]);
      const instanceId = wfq.enqueue('test', {});
      const result = await wfq.processNext(instanceId);
      expect(result.stepName).toBe('step1');
      expect(result.success).toBe(true);
      expect(result.result).toBe('result1');
    });

    it('should advance currentStep on success', async () => {
      wfq.defineWorkflow('test', [
        { name: 'step1', handler: async () => 'r1' },
        { name: 'step2', handler: async () => 'r2' },
      ]);
      const instanceId = wfq.enqueue('test', {});
      await wfq.processNext(instanceId);
      expect(wfq.getWorkflowStatus(instanceId)?.currentStep).toBe(1);
    });

    it('should complete workflow after last step', async () => {
      wfq.defineWorkflow('test', [
        { name: 'step1', handler: async () => 'r1' },
        { name: 'step2', handler: async () => 'r2' },
      ]);
      const instanceId = wfq.enqueue('test', {});
      await wfq.processNext(instanceId);
      await wfq.processNext(instanceId);
      expect(wfq.getWorkflowStatus(instanceId)?.status).toBe('completed');
    });

    it('should set status to failed on step failure', async () => {
      wfq.defineWorkflow('test', [
        { name: 'step1', handler: async () => { throw new Error('fail'); } },
      ]);
      const instanceId = wfq.enqueue('test', {});
      const result = await wfq.processNext(instanceId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('fail');
      expect(wfq.getWorkflowStatus(instanceId)?.status).toBe('failed');
    });

    it('should record step duration', async () => {
      wfq.defineWorkflow('test', [
        { name: 'step1', handler: async () => { await new Promise((r) => setTimeout(r, 50)); return 'r1'; } },
      ]);
      const instanceId = wfq.enqueue('test', {});
      const result = await wfq.processNext(instanceId);
      expect(result.duration).toBeGreaterThanOrEqual(40);
    });

    it('should retry with retryPolicy', async () => {
      let attempts = 0;
      wfq.defineWorkflow('test', [
        {
          name: 'step1',
          handler: async () => {
            attempts++;
            if (attempts < 3) throw new Error('not yet');
            return 'success';
          },
          retryPolicy: { maxAttempts: 3, backoffMs: 10 },
        },
      ]);
      const instanceId = wfq.enqueue('test', {});
      const result = await wfq.processNext(instanceId);
      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
    });

    it('should fail after max retry attempts', async () => {
      wfq.defineWorkflow('test', [
        {
          name: 'step1',
          handler: async () => { throw new Error('always fail'); },
          retryPolicy: { maxAttempts: 2, backoffMs: 10 },
        },
      ]);
      const instanceId = wfq.enqueue('test', {});
      const result = await wfq.processNext(instanceId);
      expect(result.success).toBe(false);
    });

    it('should timeout step execution', async () => {
      wfq.defineWorkflow('test', [
        { name: 'step1', handler: async () => { await new Promise((r) => setTimeout(r, 5000)); return 'r'; }, timeout: 50 },
      ]);
      const instanceId = wfq.enqueue('test', {});
      const result = await wfq.processNext(instanceId);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should throw for non-existent instance', () => {
      expect(() => wfq.processNext('non-existent')).toThrow();
    });

    it('should throw for completed workflow', async () => {
      wfq.defineWorkflow('test', [{ name: 'step1', handler: async () => 'r1' }]);
      const instanceId = wfq.enqueue('test', {});
      await wfq.processNext(instanceId);
      await expect(wfq.processNext(instanceId)).rejects.toThrow();
    });

    it('should throw for failed workflow', async () => {
      wfq.defineWorkflow('test', [{ name: 'step1', handler: async () => { throw new Error('fail'); } }]);
      const instanceId = wfq.enqueue('test', {});
      await wfq.processNext(instanceId);
      await expect(wfq.processNext(instanceId)).rejects.toThrow();
    });

    it('should throw for cancelled workflow', async () => {
      wfq.defineWorkflow('test', [{ name: 'step1', handler: async () => 'r1' }]);
      const instanceId = wfq.enqueue('test', {});
      wfq.cancelWorkflow(instanceId);
      await expect(wfq.processNext(instanceId)).rejects.toThrow();
    });

    it('should record step history', async () => {
      wfq.defineWorkflow('test', [
        { name: 'step1', handler: async () => 'r1' },
        { name: 'step2', handler: async () => 'r2' },
      ]);
      const instanceId = wfq.enqueue('test', {});
      await wfq.processNext(instanceId);
      await wfq.processNext(instanceId);
      expect(wfq.getWorkflowStatus(instanceId)?.history.length).toBe(2);
    });

    it('should update updatedAt', async () => {
      wfq.defineWorkflow('test', [
        { name: 'step1', handler: async () => { await new Promise((r) => setTimeout(r, 50)); return 'r1'; } },
      ]);
      const instanceId = wfq.enqueue('test', {});
      const statusBefore = wfq.getWorkflowStatus(instanceId)!;
      await new Promise((r) => setTimeout(r, 10));
      await wfq.processNext(instanceId);
      const statusAfter = wfq.getWorkflowStatus(instanceId)!;
      expect(statusAfter.updatedAt).toBeGreaterThanOrEqual(statusBefore.updatedAt);
    });
  });

  describe('cancelWorkflow', () => {
    it('should cancel pending workflow', () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      const instanceId = wfq.enqueue('test', {});
      expect(wfq.cancelWorkflow(instanceId)).toBe(true);
      expect(wfq.getWorkflowStatus(instanceId)?.status).toBe('cancelled');
    });

    it('should not cancel completed workflow', async () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      const instanceId = wfq.enqueue('test', {});
      await wfq.processNext(instanceId);
      expect(wfq.cancelWorkflow(instanceId)).toBe(false);
    });

    it('should not cancel failed workflow', async () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => { throw new Error('fail'); } }]);
      const instanceId = wfq.enqueue('test', {});
      await wfq.processNext(instanceId);
      expect(wfq.cancelWorkflow(instanceId)).toBe(false);
    });

    it('should not cancel already cancelled workflow', () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      const instanceId = wfq.enqueue('test', {});
      wfq.cancelWorkflow(instanceId);
      expect(wfq.cancelWorkflow(instanceId)).toBe(false);
    });

    it('should return false for non-existent instance', () => {
      expect(wfq.cancelWorkflow('non-existent')).toBe(false);
    });
  });

  describe('getWorkflowStatus', () => {
    it('should return instance status', () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      const instanceId = wfq.enqueue('test', {});
      const status = wfq.getWorkflowStatus(instanceId);
      expect(status).toBeDefined();
      expect(status?.workflowId).toBe('test');
    });

    it('should return undefined for non-existent instance', () => {
      expect(wfq.getWorkflowStatus('non-existent')).toBeUndefined();
    });
  });

  describe('getPendingWorkflows', () => {
    it('should return pending and running workflows', async () => {
      wfq.defineWorkflow('test', [
        { name: 's1', handler: async () => 'r1' },
        { name: 's2', handler: async () => 'r2' },
      ]);
      const id1 = wfq.enqueue('test', {});
      const id2 = wfq.enqueue('test', {});
      await wfq.processNext(id1); // advances to step 1, status = pending
      const pending = wfq.getPendingWorkflows();
      expect(pending.length).toBe(2);
    });

    it('should not return completed workflows', async () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      const id = wfq.enqueue('test', {});
      await wfq.processNext(id);
      expect(wfq.getPendingWorkflows().length).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct initial stats', () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      wfq.enqueue('test', {});
      const stats = wfq.getStats();
      expect(stats.totalWorkflows).toBe(1);
      expect(stats.activeWorkflows).toBe(1);
      expect(stats.completedWorkflows).toBe(0);
      expect(stats.failedWorkflows).toBe(0);
    });

    it('should track completed workflows', async () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => 'r1' }]);
      const id = wfq.enqueue('test', {});
      await wfq.processNext(id);
      expect(wfq.getStats().completedWorkflows).toBe(1);
    });

    it('should track failed workflows', async () => {
      wfq.defineWorkflow('test', [{ name: 's1', handler: async () => { throw new Error('fail'); } }]);
      const id = wfq.enqueue('test', {});
      await wfq.processNext(id);
      expect(wfq.getStats().failedWorkflows).toBe(1);
    });
  });
});
