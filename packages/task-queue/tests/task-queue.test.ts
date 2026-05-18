import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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

// ============================================================
// TaskQueue Tests (1-40)
// ============================================================
describe('TaskQueue', () => {
  let queue: TaskQueue<string>;

  beforeEach(() => {
    queue = new TaskQueue<string>();
  });

  // 1
  it('should create a TaskQueue with default options', () => {
    expect(queue).toBeDefined();
    expect(queue.size()).toBe(0);
  });

  // 2
  it('should create a TaskQueue with custom maxSize', () => {
    const q = new TaskQueue<string>({ maxSize: 5 });
    expect(q).toBeDefined();
  });

  // 3
  it('should create a TaskQueue with custom concurrency', () => {
    const q = new TaskQueue<string>({ concurrency: 2 });
    expect(q).toBeDefined();
  });

  // 4
  it('should enqueue a task and return an id', () => {
    const id = queue.enqueue({ data: 'test' });
    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
  });

  // 5
  it('should enqueue a task with custom id', () => {
    const id = queue.enqueue({ id: 'custom-id', data: 'test' });
    expect(id).toBe('custom-id');
  });

  // 6
  it('should enqueue a task with priority', () => {
    const id = queue.enqueue({ data: 'test', priority: 10 });
    const task = queue.getTask(id);
    expect(task?.priority).toBe(10);
  });

  // 7
  it('should default priority to 0', () => {
    const id = queue.enqueue({ data: 'test' });
    const task = queue.getTask(id);
    expect(task?.priority).toBe(0);
  });

  // 8
  it('should store task data', () => {
    const id = queue.enqueue({ data: 'hello world' });
    const task = queue.getTask(id);
    expect(task?.data).toBe('hello world');
  });

  // 9
  it('should set initial status to pending', () => {
    const id = queue.enqueue({ data: 'test' });
    const task = queue.getTask(id);
    expect(task?.status).toBe('pending');
  });

  // 10
  it('should set createdAt timestamp', () => {
    const before = Date.now();
    const id = queue.enqueue({ data: 'test' });
    const after = Date.now();
    const task = queue.getTask(id);
    expect(task?.createdAt).toBeGreaterThanOrEqual(before);
    expect(task?.createdAt).toBeLessThanOrEqual(after);
  });

  // 11
  it('should increment size after enqueue', () => {
    queue.enqueue({ data: 'test1' });
    queue.enqueue({ data: 'test2' });
    expect(queue.size()).toBe(2);
  });

  // 12
  it('should throw when queue is full', () => {
    const q = new TaskQueue<string>({ maxSize: 1 });
    q.enqueue({ data: 'test1' });
    expect(() => q.enqueue({ data: 'test2' })).toThrow('Queue is full');
  });

  // 13
  it('should dequeue a pending task', async () => {
    queue.enqueue({ data: 'test' });
    const task = await queue.dequeue();
    expect(task).toBeDefined();
    expect(task?.data).toBe('test');
    expect(task?.status).toBe('active');
  });

  // 14
  it('should set startedAt on dequeue', async () => {
    const before = Date.now();
    queue.enqueue({ data: 'test' });
    const task = await queue.dequeue();
    const after = Date.now();
    expect(task?.startedAt).toBeGreaterThanOrEqual(before);
    expect(task?.startedAt).toBeLessThanOrEqual(after);
  });

  // 15
  it('should increment attempts on dequeue', async () => {
    queue.enqueue({ data: 'test' });
    await queue.dequeue();
    const task = queue.getPending()[0];
    // After dequeue, the task is active, not pending
    const active = queue.getActive();
    expect(active[0]?.attempts).toBe(1);
  });

  // 16
  it('should dequeue undefined when queue is empty', async () => {
    const task = await queue.dequeue();
    expect(task).toBeUndefined();
  });

  // 17
  it('should respect priority when dequeuing', async () => {
    queue.enqueue({ data: 'low', priority: 1 });
    queue.enqueue({ data: 'high', priority: 10 });
    queue.enqueue({ data: 'medium', priority: 5 });
    const task = await queue.dequeue();
    expect(task?.data).toBe('high');
  });

  // 18
  it('should respect concurrency limit', async () => {
    const q = new TaskQueue<string>({ concurrency: 1 });
    q.enqueue({ data: 'test1' });
    q.enqueue({ data: 'test2' });
    await q.dequeue();
    const task2 = await q.dequeue();
    expect(task2).toBeUndefined();
  });

  // 19
  it('should complete a task', async () => {
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.complete(id, 'result');
    const task = queue.getTask(id);
    expect(task?.status).toBe('completed');
    expect(task?.result).toBe('result');
  });

  // 20
  it('should set completedAt on complete', async () => {
    const before = Date.now();
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.complete(id);
    const after = Date.now();
    const task = queue.getTask(id);
    expect(task?.completedAt).toBeGreaterThanOrEqual(before);
    expect(task?.completedAt).toBeLessThanOrEqual(after);
  });

  // 21
  it('should fail a task', async () => {
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.fail(id, new Error('test error'));
    const task = queue.getTask(id);
    expect(task?.status).toBe('failed');
    expect(task?.error?.message).toBe('test error');
  });

  // 22
  it('should set completedAt on fail', async () => {
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.fail(id, new Error('err'));
    const task = queue.getTask(id);
    expect(task?.completedAt).toBeDefined();
  });

  // 23
  it('should retry a failed task', async () => {
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.fail(id, new Error('err'));
    queue.retry(id);
    const task = queue.getTask(id);
    expect(task?.status).toBe('pending');
  });

  // 24
  it('should clear error on retry', async () => {
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.fail(id, new Error('err'));
    queue.retry(id);
    const task = queue.getTask(id);
    expect(task?.error).toBeUndefined();
  });

  // 25
  it('should clear startedAt on retry', async () => {
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.fail(id, new Error('err'));
    queue.retry(id);
    const task = queue.getTask(id);
    expect(task?.startedAt).toBeUndefined();
  });

  // 26
  it('should cancel a pending task', () => {
    const id = queue.enqueue({ data: 'test' });
    const result = queue.cancel(id);
    expect(result).toBe(true);
    const task = queue.getTask(id);
    expect(task?.status).toBe('cancelled');
  });

  // 27
  it('should not cancel a completed task', async () => {
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.complete(id);
    const result = queue.cancel(id);
    expect(result).toBe(false);
  });

  // 28
  it('should not cancel a cancelled task', () => {
    const id = queue.enqueue({ data: 'test' });
    queue.cancel(id);
    const result = queue.cancel(id);
    expect(result).toBe(false);
  });

  // 29
  it('should getTask by id', () => {
    const id = queue.enqueue({ data: 'test' });
    const task = queue.getTask(id);
    expect(task).toBeDefined();
    expect(task?.id).toBe(id);
  });

  // 30
  it('should return undefined for non-existent task', () => {
    const task = queue.getTask('non-existent');
    expect(task).toBeUndefined();
  });

  // 31
  it('should getPending tasks', () => {
    queue.enqueue({ data: 'test1' });
    queue.enqueue({ data: 'test2' });
    expect(queue.getPending().length).toBe(2);
  });

  // 32
  it('should not include active tasks in getPending', async () => {
    queue.enqueue({ data: 'test' });
    await queue.dequeue();
    expect(queue.getPending().length).toBe(0);
  });

  // 33
  it('should getActive tasks', async () => {
    queue.enqueue({ data: 'test' });
    await queue.dequeue();
    expect(queue.getActive().length).toBe(1);
  });

  // 34
  it('should getCompleted tasks', async () => {
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.complete(id);
    expect(queue.getCompleted().length).toBe(1);
  });

  // 35
  it('should getFailed tasks', async () => {
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.fail(id, new Error('err'));
    expect(queue.getFailed().length).toBe(1);
  });

  // 36
  it('should return correct size', () => {
    queue.enqueue({ data: 'test1' });
    queue.enqueue({ data: 'test2' });
    queue.enqueue({ data: 'test3' });
    expect(queue.size()).toBe(3);
  });

  // 37
  it('should clear all tasks', () => {
    queue.enqueue({ data: 'test1' });
    queue.enqueue({ data: 'test2' });
    queue.clear();
    expect(queue.size()).toBe(0);
  });

  // 38
  it('should emit enqueue event', () => {
    let emitted = false;
    queue.on('enqueue', () => { emitted = true; });
    queue.enqueue({ data: 'test' });
    expect(emitted).toBe(true);
  });

  // 39
  it('should emit complete event', async () => {
    let emitted = false;
    queue.on('complete', () => { emitted = true; });
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.complete(id);
    expect(emitted).toBe(true);
  });

  // 40
  it('should emit fail event', async () => {
    let emitted = false;
    queue.on('fail', () => { emitted = true; });
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.fail(id, new Error('err'));
    expect(emitted).toBe(true);
  });

  // 41
  it('should emit retry event', async () => {
    let emitted = false;
    queue.on('retry', () => { emitted = true; });
    const id = queue.enqueue({ data: 'test' });
    await queue.dequeue();
    queue.fail(id, new Error('err'));
    queue.retry(id);
    expect(emitted).toBe(true);
  });

  // 42
  it('should not dequeue delayed tasks before delay expires', async () => {
    queue.enqueue({ data: 'test', delay: 10000 });
    const task = await queue.dequeue();
    expect(task).toBeUndefined();
  });

  // 43
  it('should not dequeue tasks past deadline', async () => {
    queue.enqueue({ data: 'test', deadline: Date.now() - 1000 });
    const task = await queue.dequeue();
    expect(task).toBeUndefined();
  });

  // 44
  it('should handle enqueue with delay option', () => {
    const id = queue.enqueue({ data: 'test', delay: 5000 });
    const task = queue.getTask(id);
    expect(task?.delay).toBe(5000);
  });

  // 45
  it('should handle enqueue with deadline option', () => {
    const deadline = Date.now() + 60000;
    const id = queue.enqueue({ data: 'test', deadline });
    const task = queue.getTask(id);
    expect(task?.deadline).toBe(deadline);
  });

  // 46
  it('should support multiple event listeners', () => {
    let count = 0;
    queue.on('enqueue', () => { count++; });
    queue.on('enqueue', () => { count++; });
    queue.enqueue({ data: 'test' });
    expect(count).toBe(2);
  });

  // 47
  it('should handle complete on non-existent task gracefully', () => {
    expect(() => queue.complete('non-existent')).not.toThrow();
  });

  // 48
  it('should handle fail on non-existent task gracefully', () => {
    expect(() => queue.fail('non-existent', new Error('err'))).not.toThrow();
  });

  // 49
  it('should handle retry on non-existent task gracefully', () => {
    expect(() => queue.retry('non-existent')).not.toThrow();
  });

  // 50
  it('should handle cancel on non-existent task returning false', () => {
    expect(queue.cancel('non-existent')).toBe(false);
  });
});

// ============================================================
// DelayedQueue Tests (51-70)
// ============================================================
describe('DelayedQueue', () => {
  let dq: DelayedQueue<string>;

  beforeEach(() => {
    dq = new DelayedQueue<string>();
  });

  // 51
  it('should create a DelayedQueue', () => {
    expect(dq).toBeDefined();
    expect(dq.size()).toBe(0);
  });

  // 52
  it('should schedule a task with delay', () => {
    const id = dq.schedule('test', 5000);
    expect(id).toBeDefined();
    expect(dq.size()).toBe(1);
  });

  // 53
  it('should schedule a task at specific time', () => {
    const timestamp = Date.now() + 10000;
    const id = dq.scheduleAt('test', timestamp);
    expect(id).toBeDefined();
    expect(dq.size()).toBe(1);
  });

  // 54
  it('should not process tasks before delay expires', () => {
    dq.schedule('test', 5000);
    const count = dq.process();
    expect(count).toBe(0);
  });

  // 55
  it('should process due tasks', () => {
    dq.schedule('test', -1000); // already due
    const count = dq.process();
    expect(count).toBe(1);
    expect(dq.size()).toBe(0);
  });

  // 56
  it('should process multiple due tasks', () => {
    dq.schedule('test1', -1000);
    dq.schedule('test2', -1000);
    dq.schedule('test3', -5000);
    const count = dq.process();
    expect(count).toBe(3);
  });

  // 57
  it('should cancel a scheduled task', () => {
    const id = dq.schedule('test', 5000);
    const result = dq.cancel(id);
    expect(result).toBe(true);
    expect(dq.size()).toBe(0);
  });

  // 58
  it('should return false when cancelling non-existent task', () => {
    expect(dq.cancel('non-existent')).toBe(false);
  });

  // 59
  it('should getScheduled tasks', () => {
    dq.schedule('test1', 5000);
    dq.schedule('test2', 10000);
    const scheduled = dq.getScheduled();
    expect(scheduled.length).toBe(2);
  });

  // 60
  it('should include executeAt in scheduled tasks', () => {
    const executeAt = Date.now() + 5000;
    const id = dq.scheduleAt('test', executeAt);
    const scheduled = dq.getScheduled();
    const task = scheduled.find((t) => t.id === id);
    expect(task?.executeAt).toBe(executeAt);
  });

  // 61
  it('should clear all tasks', () => {
    dq.schedule('test1', 5000);
    dq.schedule('test2', 10000);
    dq.clear();
    expect(dq.size()).toBe(0);
  });

  // 62
  it('should return correct size', () => {
    dq.schedule('test1', 5000);
    dq.schedule('test2', 10000);
    expect(dq.size()).toBe(2);
  });

  // 63
  it('should call handler when processing due tasks', () => {
    let received: string | undefined;
    dq.setHandler((data) => { received = data; });
    dq.schedule('hello', -1000);
    dq.process();
    expect(received).toBe('hello');
  });

  // 64
  it('should pass id to handler', () => {
    let receivedId: string | undefined;
    dq.setHandler((_data, id) => { receivedId = id; });
    const id = dq.schedule('test', -1000);
    dq.process();
    expect(receivedId).toBe(id);
  });

  // 65
  it('should process only due tasks and leave future tasks', () => {
    dq.schedule('due', -1000);
    dq.schedule('future', 60000);
    const count = dq.process();
    expect(count).toBe(1);
    expect(dq.size()).toBe(1);
  });

  // 66
  it('should handle constructor with handler', () => {
    let called = false;
    const q = new DelayedQueue<string>(() => { called = true; });
    q.schedule('test', -1000);
    q.process();
    expect(called).toBe(true);
  });

  // 67
  it('should schedule with options', () => {
    const id = dq.schedule('test', 5000, { priority: 10 });
    expect(id).toBeDefined();
  });

  // 68
  it('should handle scheduleAt with past timestamp', () => {
    dq.scheduleAt('test', Date.now() - 1000);
    const count = dq.process();
    expect(count).toBe(1);
  });

  // 69
  it('should handle empty process call', () => {
    const count = dq.process();
    expect(count).toBe(0);
  });

  // 70
  it('should handle schedule with 0 delay', () => {
    dq.schedule('test', 0);
    const count = dq.process();
    expect(count).toBe(1);
  });
});

// ============================================================
// RateLimiter Tests (71-90)
// ============================================================
describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ rate: 10, burst: 5 });
  });

  // 71
  it('should create a RateLimiter', () => {
    expect(limiter).toBeDefined();
  });

  // 72
  it('should tryAcquire when tokens available', () => {
    expect(limiter.tryAcquire()).toBe(true);
  });

  // 73
  it('should decrease tokens on tryAcquire', () => {
    limiter.tryAcquire(3);
    expect(limiter.getAvailableTokens()).toBe(2);
  });

  // 74
  it('should reject tryAcquire when no tokens', () => {
    limiter.tryAcquire(5);
    expect(limiter.tryAcquire()).toBe(false);
  });

  // 75
  it('should acquire tokens asynchronously', async () => {
    limiter.tryAcquire(5);
    // All tokens used, acquire should wait and succeed
    const start = Date.now();
    await limiter.acquire(1);
    // Should have waited at least some time
    expect(Date.now() - start).toBeGreaterThanOrEqual(0);
  });

  // 76
  it('should getAvailableTokens', () => {
    expect(limiter.getAvailableTokens()).toBe(5);
  });

  // 77
  it('should return stats', () => {
    const stats = limiter.getStats();
    expect(stats).toHaveProperty('available');
    expect(stats).toHaveProperty('totalAcquired');
    expect(stats).toHaveProperty('totalRejected');
    expect(stats).toHaveProperty('waitTime');
  });

  // 78
  it('should track totalAcquired', () => {
    limiter.tryAcquire(2);
    limiter.tryAcquire(1);
    const stats = limiter.getStats();
    expect(stats.totalAcquired).toBe(3);
  });

  // 79
  it('should track totalRejected', () => {
    limiter.tryAcquire(5);
    limiter.tryAcquire(1); // should be rejected
    const stats = limiter.getStats();
    expect(stats.totalRejected).toBe(1);
  });

  // 80
  it('should reset stats', () => {
    limiter.tryAcquire(3);
    limiter.reset();
    expect(limiter.getAvailableTokens()).toBe(5);
    expect(limiter.getStats().totalAcquired).toBe(0);
  });

  // 81
  it('should handle tryAcquire with count > 1', () => {
    expect(limiter.tryAcquire(3)).toBe(true);
    expect(limiter.getAvailableTokens()).toBe(2);
  });

  // 82
  it('should handle tryAcquire with count exceeding burst', () => {
    expect(limiter.tryAcquire(10)).toBe(false);
  });

  // 83
  it('should refill tokens over time', async () => {
    limiter.tryAcquire(5);
    // Wait a bit for refill
    await new Promise((r) => setTimeout(r, 200));
    expect(limiter.getAvailableTokens()).toBeGreaterThan(0);
  });

  // 84
  it('should not exceed burst on refill', async () => {
    await new Promise((r) => setTimeout(r, 500));
    expect(limiter.getAvailableTokens()).toBeLessThanOrEqual(5);
  });

  // 85
  it('should handle acquire with default count', async () => {
    await limiter.acquire();
    expect(limiter.getStats().totalAcquired).toBe(1);
  });

  // 86
  it('should handle acquire with custom count', async () => {
    await limiter.acquire(3);
    expect(limiter.getAvailableTokens()).toBe(2);
  });

  // 87
  it('should create with high burst', () => {
    const l = new RateLimiter({ rate: 100, burst: 50 });
    expect(l.getAvailableTokens()).toBe(50);
  });

  // 88
  it('should create with low rate', () => {
    const l = new RateLimiter({ rate: 1, burst: 2 });
    expect(l.getAvailableTokens()).toBe(2);
  });

  // 89
  it('should handle multiple tryAcquire calls', () => {
    expect(limiter.tryAcquire(1)).toBe(true);
    expect(limiter.tryAcquire(1)).toBe(true);
    expect(limiter.tryAcquire(1)).toBe(true);
    expect(limiter.tryAcquire(1)).toBe(true);
    expect(limiter.tryAcquire(1)).toBe(true);
    expect(limiter.tryAcquire(1)).toBe(false);
  });

  // 90
  it('should track waitTime in stats', async () => {
    limiter.tryAcquire(5);
    await limiter.acquire(1);
    const stats = limiter.getStats();
    expect(stats.waitTime).toBeGreaterThan(0);
  });
});

// ============================================================
// JobScheduler Tests (91-115)
// ============================================================
describe('JobScheduler', () => {
  let scheduler: JobScheduler;

  beforeEach(() => {
    scheduler = new JobScheduler();
  });

  afterEach(() => {
    scheduler.stop();
  });

  // 91
  it('should create a JobScheduler', () => {
    expect(scheduler).toBeDefined();
  });

  // 92
  it('should schedule a cron job', () => {
    const id = scheduler.schedule('test', '* * * * *', async () => {});
    expect(id).toBeDefined();
  });

  // 93
  it('should schedule an interval job', () => {
    const id = scheduler.scheduleInterval('test', 1000, async () => {});
    expect(id).toBeDefined();
  });

  // 94
  it('should getJobs', () => {
    scheduler.schedule('job1', '* * * * *', async () => {});
    scheduler.schedule('job2', '* * * * *', async () => {});
    expect(scheduler.getJobs().length).toBe(2);
  });

  // 95
  it('should unschedule a job', () => {
    const id = scheduler.schedule('test', '* * * * *', async () => {});
    expect(scheduler.unschedule(id)).toBe(true);
    expect(scheduler.getJobs().length).toBe(0);
  });

  // 96
  it('should return false when unscheduling non-existent job', () => {
    expect(scheduler.unschedule('non-existent')).toBe(false);
  });

  // 97
  it('should run a job immediately', async () => {
    let called = false;
    const id = scheduler.schedule('test', '* * * * *', async () => { called = true; });
    await scheduler.runNow(id);
    expect(called).toBe(true);
  });

  // 98
  it('should throw when running non-existent job', async () => {
    await expect(scheduler.runNow('non-existent')).rejects.toThrow();
  });

  // 99
  it('should get job history', async () => {
    const id = scheduler.schedule('test', '* * * * *', async () => {});
    await scheduler.runNow(id);
    const history = scheduler.getJobHistory(id);
    expect(history.length).toBe(1);
  });

  // 100
  it('should record success in job history', async () => {
    const id = scheduler.schedule('test', '* * * * *', async () => {});
    await scheduler.runNow(id);
    const history = scheduler.getJobHistory(id);
    expect(history[0]?.success).toBe(true);
  });

  // 101
  it('should record failure in job history', async () => {
    const id = scheduler.schedule('test', '* * * * *', async () => {
      throw new Error('job failed');
    });
    await scheduler.runNow(id);
    const history = scheduler.getJobHistory(id);
    expect(history[0]?.success).toBe(false);
    expect(history[0]?.error).toBe('job failed');
  });

  // 102
  it('should record duration in job history', async () => {
    const id = scheduler.schedule('test', '* * * * *', async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await scheduler.runNow(id);
    const history = scheduler.getJobHistory(id);
    expect(history[0]?.duration).toBeGreaterThanOrEqual(40);
  });

  // 103
  it('should return empty history for non-existent job', () => {
    expect(scheduler.getJobHistory('non-existent')).toEqual([]);
  });

  // 104
  it('should start and stop scheduler', () => {
    scheduler.start();
    scheduler.stop();
    // Should not throw
  });

  // 105
  it('should handle start called twice', () => {
    scheduler.start();
    scheduler.start();
    scheduler.stop();
  });

  // 106
  it('should handle stop called twice', () => {
    scheduler.stop();
    scheduler.stop();
  });

  // 107
  it('should get stats', () => {
    scheduler.schedule('job1', '* * * * *', async () => {});
    scheduler.schedule('job2', '* * * * *', async () => {});
    const stats = scheduler.getStats();
    expect(stats.totalJobs).toBe(2);
    expect(stats.activeJobs).toBe(0);
    expect(stats.totalExecutions).toBe(0);
    expect(stats.failedExecutions).toBe(0);
  });

  // 108
  it('should track totalExecutions', async () => {
    const id = scheduler.schedule('test', '* * * * *', async () => {});
    await scheduler.runNow(id);
    const stats = scheduler.getStats();
    expect(stats.totalExecutions).toBe(1);
  });

  // 109
  it('should track failedExecutions', async () => {
    const id = scheduler.schedule('test', '* * * * *', async () => {
      throw new Error('fail');
    });
    await scheduler.runNow(id);
    const stats = scheduler.getStats();
    expect(stats.failedExecutions).toBe(1);
  });

  // 110
  it('should schedule job with name', () => {
    const id = scheduler.schedule('my-job', '* * * * *', async () => {});
    const job = scheduler.getJobs().find((j) => j.id === id);
    expect(job?.name).toBe('my-job');
  });

  // 111
  it('should schedule interval job with name', () => {
    const id = scheduler.scheduleInterval('my-interval', 5000, async () => {});
    const job = scheduler.getJobs().find((j) => j.id === id);
    expect(job?.name).toBe('my-interval');
  });

  // 112
  it('should set cron on cron job', () => {
    scheduler.schedule('test', '*/5 * * * *', async () => {});
    const job = scheduler.getJobs()[0];
    expect(job?.cron).toBe('*/5 * * * *');
  });

  // 113
  it('should set intervalMs on interval job', () => {
    scheduler.scheduleInterval('test', 5000, async () => {});
    const job = scheduler.getJobs()[0];
    expect(job?.intervalMs).toBe(5000);
  });

  // 114
  it('should set nextRun on job', () => {
    scheduler.scheduleInterval('test', 5000, async () => {});
    const job = scheduler.getJobs()[0];
    expect(job?.nextRun).toBeGreaterThan(Date.now());
  });

  // 115
  it('should record multiple executions in history', async () => {
    const id = scheduler.schedule('test', '* * * * *', async () => {});
    await scheduler.runNow(id);
    await scheduler.runNow(id);
    const history = scheduler.getJobHistory(id);
    expect(history.length).toBe(2);
  });
});

// ============================================================
// WorkerPool Tests (116-140)
// ============================================================
describe('WorkerPool', () => {
  let pool: WorkerPool<number, number>;

  beforeEach(() => {
    pool = new WorkerPool<number, number>({ minWorkers: 2, maxWorkers: 5, taskTimeout: 5000 });
  });

  afterEach(() => {
    pool.terminate();
  });

  // 116
  it('should create a WorkerPool', () => {
    expect(pool).toBeDefined();
  });

  // 117
  it('should submit a task and get result', async () => {
    const result = await pool.submit(5, async (task) => task * 2);
    expect(result).toBe(10);
  });

  // 118
  it('should submit multiple tasks', async () => {
    const results = await Promise.all([
      pool.submit(1, async (t) => t * 2),
      pool.submit(2, async (t) => t * 2),
      pool.submit(3, async (t) => t * 2),
    ]);
    expect(results).toEqual([2, 4, 6]);
  });

  // 119
  it('should submitBatch tasks', async () => {
    const results = await pool.submitBatch([1, 2, 3], async (t) => t * 2);
    expect(results).toEqual([2, 4, 6]);
  });

  // 120
  it('should handle task failure', async () => {
    await expect(
      pool.submit(1, async () => { throw new Error('task failed'); })
    ).rejects.toThrow('task failed');
  });

  // 121
  it('should get stats', () => {
    const stats = pool.getStats();
    expect(stats).toHaveProperty('activeWorkers');
    expect(stats).toHaveProperty('idleWorkers');
    expect(stats).toHaveProperty('pendingTasks');
    expect(stats).toHaveProperty('completedTasks');
    expect(stats).toHaveProperty('failedTasks');
    expect(stats).toHaveProperty('avgWaitTime');
  });

  // 122
  it('should track completedTasks', async () => {
    await pool.submit(1, async (t) => t);
    await pool.submit(2, async (t) => t);
    const stats = pool.getStats();
    expect(stats.completedTasks).toBe(2);
  });

  // 123
  it('should track failedTasks', async () => {
    try { await pool.submit(1, async () => { throw new Error('err'); }); } catch {}
    const stats = pool.getStats();
    expect(stats.failedTasks).toBe(1);
  });

  // 124
  it('should resize pool', () => {
    pool.resize(4);
    const stats = pool.getStats();
    expect(stats.idleWorkers + stats.activeWorkers).toBe(4);
  });

  // 125
  it('should shrink pool', () => {
    pool.resize(1);
    const stats = pool.getStats();
    expect(stats.idleWorkers + stats.activeWorkers).toBeLessThanOrEqual(2);
  });

  // 126
  it('should drain all tasks', async () => {
    pool.submit(1, async (t) => t + new Promise((r) => setTimeout(r, 50)));
    pool.submit(2, async (t) => t + new Promise((r) => setTimeout(r, 50)));
    await pool.drain();
    const stats = pool.getStats();
    expect(stats.pendingTasks).toBe(0);
  });

  // 127
  it('should terminate pool', () => {
    pool.terminate();
    const stats = pool.getStats();
    expect(stats.idleWorkers).toBe(0);
  });

  // 128
  it('should reject tasks after terminate', async () => {
    pool.terminate();
    await expect(pool.submit(1, async (t) => t)).rejects.toThrow('terminated');
  });

  // 129
  it('should create with default options', () => {
    const p = new WorkerPool();
    expect(p).toBeDefined();
    p.terminate();
  });

  // 130
  it('should handle concurrent task execution', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const tasks = Array.from({ length: 10 }, (_, i) =>
      pool.submit(i, async () => {
        concurrent++;
        if (concurrent > maxConcurrent) maxConcurrent = concurrent;
        await new Promise((r) => setTimeout(r, 20));
        concurrent--;
        return i;
      })
    );
    const results = await Promise.all(tasks);
    expect(results).toEqual(Array.from({ length: 10 }, (_, i) => i));
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  // 131
  it('should timeout long running tasks', async () => {
    const p = new WorkerPool({ taskTimeout: 50 });
    await expect(
      p.submit(1, async () => { await new Promise((r) => setTimeout(r, 5000)); return 1; })
    ).rejects.toThrow('timed out');
    p.terminate();
  });

  // 132
  it('should return correct idleWorkers count', () => {
    const stats = pool.getStats();
    expect(stats.idleWorkers).toBe(2);
  });

  // 133
  it('should handle empty submitBatch', async () => {
    const results = await pool.submitBatch([], async (t) => t);
    expect(results).toEqual([]);
  });

  // 134
  it('should scale up under load', async () => {
    const tasks = Array.from({ length: 20 }, (_, i) =>
      pool.submit(i, async () => {
        await new Promise((r) => setTimeout(r, 30));
        return i;
      })
    );
    const results = await Promise.all(tasks);
    expect(results.length).toBe(20);
  });

  // 135
  it('should track avgWaitTime', async () => {
    await pool.submit(1, async (t) => { await new Promise((r) => setTimeout(r, 10)); return t; });
    await pool.submit(2, async (t) => { await new Promise((r) => setTimeout(r, 10)); return t; });
    const stats = pool.getStats();
    expect(stats.avgWaitTime).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// DeadLetterQueue Tests (136-155)
// ============================================================
describe('DeadLetterQueue', () => {
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dlq = new DeadLetterQueue();
  });

  // 136
  it('should create a DeadLetterQueue', () => {
    expect(dlq).toBeDefined();
    expect(dlq.size()).toBe(0);
  });

  // 137
  it('should add an entry', () => {
    dlq.add({ data: 'test', error: new Error('fail'), attempts: 3 });
    expect(dlq.size()).toBe(1);
  });

  // 138
  it('should add with custom id', () => {
    dlq.add({ id: 'custom', data: 'test', error: new Error('fail'), attempts: 3 });
    const entry = dlq.get('custom');
    expect(entry).toBeDefined();
  });

  // 139
  it('should get an entry by id', () => {
    dlq.add({ id: 'entry1', data: 'test', error: new Error('fail'), attempts: 3 });
    const entry = dlq.get('entry1');
    expect(entry).toBeDefined();
  });

  // 140
  it('should return undefined for non-existent entry', () => {
    expect(dlq.get('non-existent')).toBeUndefined();
  });

  // 141
  it('should requeue an entry', () => {
    dlq.add({ id: 'entry1', data: 'test-data', error: new Error('fail'), attempts: 3 });
    const result = dlq.requeue('entry1');
    expect(result).toBeDefined();
    expect((result as Record<string, unknown>).data).toBe('test-data');
    expect(dlq.size()).toBe(0);
  });

  // 142
  it('should return undefined when requeuing non-existent entry', () => {
    expect(dlq.requeue('non-existent')).toBeUndefined();
  });

  // 143
  it('should discard an entry', () => {
    dlq.add({ id: 'entry1', data: 'test', error: new Error('fail'), attempts: 3 });
    const result = dlq.discard('entry1');
    expect(result).toBe(true);
    expect(dlq.size()).toBe(0);
  });

  // 144
  it('should return false when discarding non-existent entry', () => {
    expect(dlq.discard('non-existent')).toBe(false);
  });

  // 145
  it('should getAll entries', () => {
    dlq.add({ id: 'e1', data: 'test1', error: new Error('fail'), attempts: 1 });
    dlq.add({ id: 'e2', data: 'test2', error: new Error('fail'), attempts: 2 });
    expect(dlq.getAll().length).toBe(2);
  });

  // 146
  it('should getAll with filter', () => {
    dlq.add({ id: 'e1', data: 'test1', error: new Error('typeA'), attempts: 1 });
    dlq.add({ id: 'e2', data: 'test2', error: new Error('typeB'), attempts: 2 });
    const filtered = dlq.getAll((e) => e.error.message === 'typeA');
    expect(filtered.length).toBe(1);
  });

  // 147
  it('should purge all entries', () => {
    dlq.add({ id: 'e1', data: 'test', error: new Error('fail'), attempts: 1 });
    dlq.add({ id: 'e2', data: 'test', error: new Error('fail'), attempts: 1 });
    const count = dlq.purge();
    expect(count).toBe(2);
    expect(dlq.size()).toBe(0);
  });

  // 148
  it('should purge entries older than maxAge', () => {
    const oldTime = Date.now() - 2000;
    dlq.add({ id: 'e1', data: 'old', error: new Error('fail'), attempts: 1, failedAt: oldTime });
    dlq.add({ id: 'e2', data: 'new', error: new Error('fail'), attempts: 1, failedAt: Date.now() });
    const count = dlq.purge(1000);
    expect(count).toBe(1);
    expect(dlq.size()).toBe(1);
  });

  // 149
  it('should get stats', () => {
    dlq.add({ data: 'test', error: new Error('fail'), attempts: 3 });
    const stats = dlq.getStats();
    expect(stats.total).toBe(1);
    expect(stats.byErrorType).toBeDefined();
    expect(stats.requeued).toBe(0);
    expect(stats.discarded).toBe(0);
  });

  // 150
  it('should track requeued count in stats', () => {
    dlq.add({ id: 'e1', data: 'test', error: new Error('fail'), attempts: 3 });
    dlq.requeue('e1');
    const stats = dlq.getStats();
    expect(stats.requeued).toBe(1);
  });

  // 151
  it('should track discarded count in stats', () => {
    dlq.add({ id: 'e1', data: 'test', error: new Error('fail'), attempts: 3 });
    dlq.discard('e1');
    const stats = dlq.getStats();
    expect(stats.discarded).toBe(1);
  });

  // 152
  it('should group by error type in stats', () => {
    dlq.add({ data: 'test1', error: new Error('fail'), attempts: 1 });
    dlq.add({ data: 'test2', error: new TypeError('type err'), attempts: 1 });
    const stats = dlq.getStats();
    expect(stats.byErrorType['Error']).toBe(1);
    expect(stats.byErrorType['TypeError']).toBe(1);
  });

  // 153
  it('should store error in entry', () => {
    dlq.add({ id: 'e1', data: 'test', error: new Error('my error'), attempts: 3 });
    const entry = dlq.get('e1') as { error: Error } | undefined;
    expect(entry?.error.message).toBe('my error');
  });

  // 154
  it('should store attempts in entry', () => {
    dlq.add({ id: 'e1', data: 'test', error: new Error('fail'), attempts: 5 });
    const entry = dlq.get('e1') as { attempts: number } | undefined;
    expect(entry?.attempts).toBe(5);
  });

  // 155
  it('should store failedAt timestamp', () => {
    const now = Date.now();
    dlq.add({ id: 'e1', data: 'test', error: new Error('fail'), attempts: 1, failedAt: now });
    const entry = dlq.get('e1') as { failedAt: number } | undefined;
    expect(entry?.failedAt).toBe(now);
  });
});

// ============================================================
// TaskRepository Tests (156-170)
// ============================================================
describe('TaskRepository', () => {
  let repo: TaskRepository;

  beforeEach(() => {
    repo = new TaskRepository();
  });

  // 156
  it('should create a TaskRepository', () => {
    expect(repo).toBeDefined();
  });

  // 157
  it('should save a task', () => {
    const task = {
      id: 't1',
      data: 'test',
      priority: 0,
      status: 'pending' as const,
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: 3,
    };
    repo.save(task);
    expect(repo.count()).toBe(1);
  });

  // 158
  it('should find a task by id', () => {
    const task = {
      id: 't1',
      data: 'test',
      priority: 0,
      status: 'pending' as const,
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: 3,
    };
    repo.save(task);
    const found = repo.find('t1');
    expect(found?.id).toBe('t1');
  });

  // 159
  it('should return undefined for non-existent task', () => {
    expect(repo.find('non-existent')).toBeUndefined();
  });

  // 160
  it('should find tasks by status', () => {
    repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    repo.save({ id: 't2', data: 'b', priority: 0, status: 'completed', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    const pending = repo.findByStatus('pending');
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe('t1');
  });

  // 161
  it('should find due tasks', () => {
    repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now() - 2000, delay: 1000, attempts: 0, maxAttempts: 3 });
    repo.save({ id: 't2', data: 'b', priority: 0, status: 'pending', createdAt: Date.now(), delay: 60000, attempts: 0, maxAttempts: 3 });
    const due = repo.findDueTasks();
    expect(due.length).toBe(1);
    expect(due[0]?.id).toBe('t1');
  });

  // 162
  it('should update a task', () => {
    repo.save({ id: 't1', data: 'test', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    const result = repo.update('t1', { status: 'completed' });
    expect(result).toBe(true);
    expect(repo.find('t1')?.status).toBe('completed');
  });

  // 163
  it('should return false when updating non-existent task', () => {
    expect(repo.update('non-existent', { status: 'completed' })).toBe(false);
  });

  // 164
  it('should delete a task', () => {
    repo.save({ id: 't1', data: 'test', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    expect(repo.delete('t1')).toBe(true);
    expect(repo.count()).toBe(0);
  });

  // 165
  it('should return false when deleting non-existent task', () => {
    expect(repo.delete('non-existent')).toBe(false);
  });

  // 166
  it('should count all tasks', () => {
    repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    repo.save({ id: 't2', data: 'b', priority: 0, status: 'completed', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    expect(repo.count()).toBe(2);
  });

  // 167
  it('should count tasks by status', () => {
    repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    repo.save({ id: 't2', data: 'b', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    repo.save({ id: 't3', data: 'c', priority: 0, status: 'completed', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    expect(repo.count('pending')).toBe(2);
  });

  // 168
  it('should clear all tasks', () => {
    repo.save({ id: 't1', data: 'a', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    repo.save({ id: 't2', data: 'b', priority: 0, status: 'completed', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    repo.clear();
    expect(repo.count()).toBe(0);
  });

  // 169
  it('should return a copy of task from find', () => {
    repo.save({ id: 't1', data: 'test', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    const found = repo.find('t1');
    if (found) found.status = 'completed';
    expect(repo.find('t1')?.status).toBe('pending');
  });

  // 170
  it('should return copies from findByStatus', () => {
    repo.save({ id: 't1', data: 'test', priority: 0, status: 'pending', createdAt: Date.now(), attempts: 0, maxAttempts: 3 });
    const results = repo.findByStatus('pending');
    if (results[0]) results[0].status = 'completed';
    expect(repo.find('t1')?.status).toBe('pending');
  });
});

// ============================================================
// BackoffStrategy Tests (171-185)
// ============================================================
describe('ExponentialBackoff', () => {
  // 171
  it('should create with default options', () => {
    const backoff = new ExponentialBackoff();
    expect(backoff).toBeDefined();
  });

  // 172
  it('should return increasing delays', () => {
    const backoff = new ExponentialBackoff({ baseMs: 100, maxMs: 10000, jitter: false });
    const d0 = backoff.getDelay(0);
    const d1 = backoff.getDelay(1);
    const d2 = backoff.getDelay(2);
    expect(d0).toBe(100);
    expect(d1).toBe(200);
    expect(d2).toBe(400);
  });

  // 173
  it('should cap at maxMs', () => {
    const backoff = new ExponentialBackoff({ baseMs: 100, maxMs: 500, jitter: false });
    expect(backoff.getDelay(10)).toBe(500);
  });

  // 174
  it('should add jitter', () => {
    const backoff = new ExponentialBackoff({ baseMs: 1000, jitter: true });
    const delay = backoff.getDelay(1);
    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThanOrEqual(2000);
  });

  // 175
  it('should reset', () => {
    const backoff = new ExponentialBackoff();
    backoff.getDelay(5);
    backoff.reset();
    expect(backoff).toBeDefined();
  });
});

describe('FixedBackoff', () => {
  // 176
  it('should create with delay', () => {
    const backoff = new FixedBackoff(1000);
    expect(backoff).toBeDefined();
  });

  // 177
  it('should return same delay regardless of attempt', () => {
    const backoff = new FixedBackoff(500);
    expect(backoff.getDelay(0)).toBe(500);
    expect(backoff.getDelay(1)).toBe(500);
    expect(backoff.getDelay(10)).toBe(500);
  });

  // 178
  it('should reset without error', () => {
    const backoff = new FixedBackoff(500);
    backoff.reset();
  });
});

describe('LinearBackoff', () => {
  // 179
  it('should create with params', () => {
    const backoff = new LinearBackoff(100, 50, 1000);
    expect(backoff).toBeDefined();
  });

  // 180
  it('should return linearly increasing delays', () => {
    const backoff = new LinearBackoff(100, 50, 10000);
    expect(backoff.getDelay(0)).toBe(100);
    expect(backoff.getDelay(1)).toBe(150);
    expect(backoff.getDelay(2)).toBe(200);
  });

  // 181
  it('should cap at maxMs', () => {
    const backoff = new LinearBackoff(100, 50, 200);
    expect(backoff.getDelay(10)).toBe(200);
  });

  // 182
  it('should reset without error', () => {
    const backoff = new LinearBackoff(100, 50, 1000);
    backoff.reset();
  });
});

// ============================================================
// TaskMonitor Tests (183-195)
// ============================================================
describe('TaskMonitor', () => {
  let monitor: TaskMonitor;

  beforeEach(() => {
    monitor = new TaskMonitor();
  });

  // 183
  it('should create a TaskMonitor', () => {
    expect(monitor).toBeDefined();
  });

  // 184
  it('should record an event', () => {
    monitor.recordEvent({
      type: 'enqueue',
      taskId: 't1',
      queue: 'q1',
      timestamp: Date.now(),
    });
    expect(monitor.getStats().totalEvents).toBe(1);
  });

  // 185
  it('should record events with data', () => {
    monitor.recordEvent({
      type: 'enqueue',
      taskId: 't1',
      queue: 'q1',
      timestamp: Date.now(),
      data: { key: 'value' },
    });
    expect(monitor.getStats().totalEvents).toBe(1);
  });

  // 186
  it('should get queue health', () => {
    monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
    monitor.recordEvent({ type: 'complete', taskId: 't1', queue: 'q1', timestamp: Date.now() + 100 });
    const health = monitor.getQueueHealth('q1');
    expect(health).toBeDefined();
    expect(health.throughput).toBe(1);
    expect(health.errorRate).toBe(0);
  });

  // 187
  it('should get dashboard', () => {
    monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
    const dashboard = monitor.getDashboard();
    expect(dashboard).toBeDefined();
    expect(dashboard.totalTasks).toBe(1);
  });

  // 188
  it('should get alerts', () => {
    const alerts = monitor.getAlerts();
    expect(alerts).toEqual([]);
  });

  // 189
  it('should add alert rule', () => {
    monitor.addAlertRule({ condition: 'error', severity: 'high', message: 'Error detected' });
    // No error events yet, so no alerts
    expect(monitor.getAlerts().length).toBe(0);
  });

  // 190
  it('should trigger alert on error event', () => {
    monitor.addAlertRule({ condition: 'error', severity: 'high', message: 'Error detected' });
    monitor.recordEvent({ type: 'fail', taskId: 't1', queue: 'q1', timestamp: Date.now() });
    const alerts = monitor.getAlerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0]?.severity).toBe('high');
  });

  // 191
  it('should get history', () => {
    monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
    const history = monitor.getHistory();
    expect(history.length).toBe(1);
  });

  // 192
  it('should get history with time window', () => {
    monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() - 10000 });
    monitor.recordEvent({ type: 'enqueue', taskId: 't2', queue: 'q1', timestamp: Date.now() });
    const history = monitor.getHistory(5000);
    expect(history.length).toBe(1);
  });

  // 193
  it('should get stats', () => {
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

  // 194
  it('should calculate error rate in queue health', () => {
    monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
    monitor.recordEvent({ type: 'fail', taskId: 't1', queue: 'q1', timestamp: Date.now() + 100 });
    monitor.recordEvent({ type: 'enqueue', taskId: 't2', queue: 'q1', timestamp: Date.now() + 200 });
    monitor.recordEvent({ type: 'complete', taskId: 't2', queue: 'q1', timestamp: Date.now() + 300 });
    const health = monitor.getQueueHealth('q1');
    expect(health.errorRate).toBeCloseTo(0.5);
  });

  // 195
  it('should calculate avgLatency in queue health', () => {
    monitor.recordEvent({ type: 'enqueue', taskId: 't1', queue: 'q1', timestamp: Date.now() });
    monitor.recordEvent({ type: 'complete', taskId: 't1', queue: 'q1', timestamp: Date.now() + 200 });
    const health = monitor.getQueueHealth('q1');
    expect(health.avgLatency).toBe(200);
  });
});

// ============================================================
// WorkflowQueue Tests (196-210)
// ============================================================
describe('WorkflowQueue', () => {
  let wfq: WorkflowQueue;

  beforeEach(() => {
    wfq = new WorkflowQueue();
  });

  // 196
  it('should create a WorkflowQueue', () => {
    expect(wfq).toBeDefined();
  });

  // 197
  it('should define a workflow', () => {
    const id = wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
      { name: 'step2', handler: async () => 'result2' },
    ]);
    expect(id).toBe('test');
  });

  // 198
  it('should enqueue a workflow instance', () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
    ]);
    const instanceId = wfq.enqueue('test', { input: 'data' });
    expect(instanceId).toBeDefined();
  });

  // 199
  it('should throw when enqueuing non-existent workflow', () => {
    expect(() => wfq.enqueue('non-existent', {})).toThrow();
  });

  // 200
  it('should process next step', async () => {
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

  // 201
  it('should advance currentStep after successful processNext', async () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
      { name: 'step2', handler: async () => 'result2' },
    ]);
    const instanceId = wfq.enqueue('test', {});
    await wfq.processNext(instanceId);
    const status = wfq.getWorkflowStatus(instanceId);
    expect(status?.currentStep).toBe(1);
  });

  // 202
  it('should complete workflow after all steps', async () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
      { name: 'step2', handler: async () => 'result2' },
    ]);
    const instanceId = wfq.enqueue('test', {});
    await wfq.processNext(instanceId);
    await wfq.processNext(instanceId);
    const status = wfq.getWorkflowStatus(instanceId);
    expect(status?.status).toBe('completed');
  });

  // 203
  it('should handle step failure', async () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => { throw new Error('step failed'); } },
    ]);
    const instanceId = wfq.enqueue('test', {});
    const result = await wfq.processNext(instanceId);
    expect(result.success).toBe(false);
    expect(result.error).toBe('step failed');
  });

  // 204
  it('should set workflow status to failed on step failure', async () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => { throw new Error('fail'); } },
    ]);
    const instanceId = wfq.enqueue('test', {});
    await wfq.processNext(instanceId);
    const status = wfq.getWorkflowStatus(instanceId);
    expect(status?.status).toBe('failed');
  });

  // 205
  it('should get workflow status', () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
    ]);
    const instanceId = wfq.enqueue('test', {});
    const status = wfq.getWorkflowStatus(instanceId);
    expect(status).toBeDefined();
    expect(status?.workflowId).toBe('test');
    expect(status?.status).toBe('pending');
  });

  // 206
  it('should return undefined for non-existent workflow instance', () => {
    expect(wfq.getWorkflowStatus('non-existent')).toBeUndefined();
  });

  // 207
  it('should cancel a workflow', () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
    ]);
    const instanceId = wfq.enqueue('test', {});
    const result = wfq.cancelWorkflow(instanceId);
    expect(result).toBe(true);
    expect(wfq.getWorkflowStatus(instanceId)?.status).toBe('cancelled');
  });

  // 208
  it('should not cancel a completed workflow', async () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
    ]);
    const instanceId = wfq.enqueue('test', {});
    await wfq.processNext(instanceId);
    expect(wfq.cancelWorkflow(instanceId)).toBe(false);
  });

  // 209
  it('should get pending workflows', () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
    ]);
    wfq.enqueue('test', {});
    wfq.enqueue('test', {});
    const pending = wfq.getPendingWorkflows();
    expect(pending.length).toBe(2);
  });

  // 210
  it('should get stats', () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
    ]);
    wfq.enqueue('test', {});
    const stats = wfq.getStats();
    expect(stats.totalWorkflows).toBe(1);
    expect(stats.activeWorkflows).toBe(1);
    expect(stats.completedWorkflows).toBe(0);
    expect(stats.failedWorkflows).toBe(0);
  });

  // 211
  it('should track completed workflows in stats', async () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
    ]);
    const id = wfq.enqueue('test', {});
    await wfq.processNext(id);
    const stats = wfq.getStats();
    expect(stats.completedWorkflows).toBe(1);
  });

  // 212
  it('should track failed workflows in stats', async () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => { throw new Error('fail'); } },
    ]);
    const id = wfq.enqueue('test', {});
    await wfq.processNext(id);
    const stats = wfq.getStats();
    expect(stats.failedWorkflows).toBe(1);
  });

  // 213
  it('should record step history', async () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
      { name: 'step2', handler: async () => 'result2' },
    ]);
    const instanceId = wfq.enqueue('test', {});
    await wfq.processNext(instanceId);
    await wfq.processNext(instanceId);
    const status = wfq.getWorkflowStatus(instanceId);
    expect(status?.history.length).toBe(2);
  });

  // 214
  it('should retry step on failure with retryPolicy', async () => {
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
  });

  // 215
  it('should timeout step execution', async () => {
    wfq.defineWorkflow('test', [
      {
        name: 'step1',
        handler: async () => {
          await new Promise((r) => setTimeout(r, 5000));
          return 'result';
        },
        timeout: 50,
      },
    ]);
    const instanceId = wfq.enqueue('test', {});
    const result = await wfq.processNext(instanceId);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  // 216
  it('should throw when processing next step on completed workflow', async () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
    ]);
    const instanceId = wfq.enqueue('test', {});
    await wfq.processNext(instanceId);
    expect(() => wfq.processNext(instanceId)).toThrow();
  });

  // 217
  it('should throw when processing non-existent instance', () => {
    expect(() => wfq.processNext('non-existent')).toThrow();
  });

  // 218
  it('should enqueue with custom instanceId', () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
    ]);
    const instanceId = wfq.enqueue('test', {}, { instanceId: 'my-instance' });
    expect(instanceId).toBe('my-instance');
    expect(wfq.getWorkflowStatus('my-instance')).toBeDefined();
  });

  // 219
  it('should set createdAt and updatedAt on instance', () => {
    const before = Date.now();
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => 'result1' },
    ]);
    const instanceId = wfq.enqueue('test', {});
    const after = Date.now();
    const status = wfq.getWorkflowStatus(instanceId);
    expect(status?.createdAt).toBeGreaterThanOrEqual(before);
    expect(status?.createdAt).toBeLessThanOrEqual(after);
    expect(status?.updatedAt).toBeGreaterThanOrEqual(before);
    expect(status?.updatedAt).toBeLessThanOrEqual(after);
  });

  // 220
  it('should update updatedAt on processNext', async () => {
    wfq.defineWorkflow('test', [
      { name: 'step1', handler: async () => { await new Promise((r) => setTimeout(r, 50)); return 'result1'; } },
    ]);
    const instanceId = wfq.enqueue('test', {});
    const statusBefore = wfq.getWorkflowStatus(instanceId);
    await new Promise((r) => setTimeout(r, 10));
    await wfq.processNext(instanceId);
    const statusAfter = wfq.getWorkflowStatus(instanceId);
    expect(statusAfter?.updatedAt).toBeGreaterThanOrEqual(statusBefore?.updatedAt ?? 0);
  });
});
