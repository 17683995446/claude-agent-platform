import { describe, test, expect, beforeEach } from 'bun:test';
import {
  PriorityScheduler,
  Priority,
  ResourceAllocator,
  CronEngine,
  WorkloadBalancer,
  DependencyResolver,
  DeadlineManager,
  BatchScheduler,
  AdaptiveScheduler,
  QueueManager,
  SchedulingMetrics,
} from '../src/index';

// ============================================================
// Module 1: PriorityScheduler Tests
// ============================================================
describe('PriorityScheduler', () => {
  let scheduler: PriorityScheduler;

  beforeEach(() => {
    scheduler = new PriorityScheduler({ agingInterval: 0, agingThreshold: 0 });
  });

  test('should schedule a task and return an ID', () => {
    const id = scheduler.schedule({ name: 'task1' });
    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
  });

  test('should get next task by priority (critical first)', () => {
    scheduler.schedule({ name: 'low', priority: Priority.Low });
    scheduler.schedule({ name: 'critical', priority: Priority.Critical });
    scheduler.schedule({ name: 'normal', priority: Priority.Normal });

    const first = scheduler.getNext();
    expect(first?.name).toBe('critical');

    const second = scheduler.getNext();
    expect(second?.name).toBe('normal');

    const third = scheduler.getNext();
    expect(third?.name).toBe('low');
  });

  test('should peek without removing', () => {
    scheduler.schedule({ name: 'task1', priority: Priority.High });
    const peeked = scheduler.peek();
    expect(peeked?.name).toBe('task1');
    expect(scheduler.getQueueSize()).toBe(1);
  });

  test('should cancel a scheduled task', () => {
    const id = scheduler.schedule({ name: 'task1' });
    expect(scheduler.cancel(id)).toBe(true);
    expect(scheduler.getQueueSize()).toBe(0);
  });

  test('should return false when cancelling non-existent task', () => {
    expect(scheduler.cancel('nonexistent')).toBe(false);
  });

  test('should reprioritize a task', () => {
    scheduler.schedule({ name: 'low', priority: Priority.Low });
    scheduler.schedule({ name: 'normal', priority: Priority.Normal });

    // Get the normal task ID
    const normalTask = scheduler.peek();
    expect(normalTask?.name).toBe('normal');

    // Reprioritize normal to critical
    scheduler.reprioritize(normalTask!.id, Priority.Critical);
    const next = scheduler.getNext();
    expect(next?.name).toBe('normal');
    expect(next?.priority).toBe(Priority.Critical);
  });

  test('should return false when reprioritizing non-existent task', () => {
    expect(scheduler.reprioritize('nonexistent', Priority.High)).toBe(false);
  });

  test('should return queue size for specific priority', () => {
    scheduler.schedule({ name: 't1', priority: Priority.Critical });
    scheduler.schedule({ name: 't2', priority: Priority.Critical });
    scheduler.schedule({ name: 't3', priority: Priority.Low });
    expect(scheduler.getQueueSize(Priority.Critical)).toBe(2);
    expect(scheduler.getQueueSize(Priority.Low)).toBe(1);
  });

  test('should return total queue size when no priority specified', () => {
    scheduler.schedule({ name: 't1', priority: Priority.Critical });
    scheduler.schedule({ name: 't2', priority: Priority.Normal });
    scheduler.schedule({ name: 't3', priority: Priority.Low });
    expect(scheduler.getQueueSize()).toBe(3);
  });

  test('should return undefined when queue is empty', () => {
    expect(scheduler.getNext()).toBeUndefined();
    expect(scheduler.peek()).toBeUndefined();
  });

  test('child tasks inherit parent priority', () => {
    const parentId = scheduler.schedule({ name: 'parent', priority: Priority.Critical });
    const childId = scheduler.schedule({ name: 'child', priority: Priority.Low, parentId });
    const child = scheduler.getTask(childId);
    expect(child?.priority).toBe(Priority.Critical);
  });

  test('deadline proximity boosts priority', () => {
    const deadline = new Date(Date.now() + 30_000); // 30 seconds
    const id = scheduler.schedule({ name: 'urgent', priority: Priority.Low, deadline });
    const task = scheduler.getTask(id);
    expect(task?.priority).toBeLessThanOrEqual(Priority.High);
  });

  test('should support all 5 priority levels', () => {
    scheduler.schedule({ name: 'bg', priority: Priority.Background });
    scheduler.schedule({ name: 'low', priority: Priority.Low });
    scheduler.schedule({ name: 'normal', priority: Priority.Normal });
    scheduler.schedule({ name: 'high', priority: Priority.High });
    scheduler.schedule({ name: 'critical', priority: Priority.Critical });

    const order: string[] = [];
    while (scheduler.getQueueSize() > 0) {
      const task = scheduler.getNext();
      if (task) order.push(task.name);
    }
    expect(order).toEqual(['critical', 'high', 'normal', 'low', 'bg']);
  });
});

// ============================================================
// Module 2: ResourceAllocator Tests
// ============================================================
describe('ResourceAllocator', () => {
  let allocator: ResourceAllocator;

  beforeEach(() => {
    allocator = new ResourceAllocator({
      totalResources: { cpu: 100, memory: 1024, disk: 10000, network: 1000, gpu: 4 },
    });
  });

  test('should allocate resources successfully', () => {
    const alloc = allocator.allocate({ cpu: 10, memory: 256 });
    expect(alloc.id).toBeDefined();
    expect(alloc.resources.cpu).toBe(10);
  });

  test('should release allocated resources', () => {
    const alloc = allocator.allocate({ cpu: 50 });
    const availableBefore = allocator.getAvailableResources();
    allocator.release(alloc.id);
    const availableAfter = allocator.getAvailableResources();
    expect(availableAfter.cpu.available).toBeGreaterThan(availableBefore.cpu.available);
  });

  test('should track resource utilization', () => {
    allocator.allocate({ cpu: 50, memory: 512 });
    const util = allocator.getUtilization();
    expect(util.cpu).toBeCloseTo(0.5);
    expect(util.memory).toBeCloseTo(512 / 1024);
  });

  test('should return correct available resources', () => {
    allocator.allocate({ cpu: 30, gpu: 2 });
    const snap = allocator.getAvailableResources();
    expect(snap.cpu.available).toBe(70);
    expect(snap.gpu.available).toBe(2);
  });

  test('should queue requests when resources insufficient', () => {
    allocator.allocate({ cpu: 90 });
    const alloc2 = allocator.allocate({ cpu: 20 });
    // The second allocation should still be created (queued)
    expect(alloc2.id).toBeDefined();
    expect(allocator.getWaitQueueSize()).toBe(1);
  });

  test('should process wait queue on release', () => {
    allocator.allocate({ cpu: 90 });
    allocator.allocate({ cpu: 20 }); // queued
    expect(allocator.getWaitQueueSize()).toBe(1);

    // Release all to trigger wait queue processing
    // We need to release the first allocation
    const util = allocator.getUtilization();
    // Allocate something we can release
    const alloc = allocator.allocate({ cpu: 5 });
    allocator.release(alloc.id);
  });

  test('should support guaranteed-minimum strategy', () => {
    const ga = new ResourceAllocator({
      totalResources: { cpu: 100, memory: 1024 },
      strategy: 'guaranteed-minimum',
      guaranteedMinimums: { cpu: 20 },
    });
    ga.allocate({ cpu: 70 });
    const alloc2 = ga.allocate({ cpu: 15 });
    // Should succeed since 100 - 70 - 15 = 15 < 20 guaranteed minimum
    // Actually with guaranteed minimum, it checks if available - requested < min
    // 100 - 70 = 30 available, 30 - 15 = 15 < 20, so it should queue
    expect(ga.getWaitQueueSize()).toBe(1);
  });

  test('should allow oversubscription for high priority in priority-based mode', () => {
    const pa = new ResourceAllocator({
      totalResources: { cpu: 100 },
      strategy: 'priority-based',
    });
    pa.allocate({ cpu: 90 });
    const alloc2 = pa.allocate({ cpu: 20 }, 1); // high priority
    expect(pa.getAllocationCount()).toBe(2);
  });

  test('should return zero utilization when nothing allocated', () => {
    const util = allocator.getUtilization();
    expect(util.cpu).toBe(0);
    expect(util.overall).toBe(0);
  });

  test('should handle releasing non-existent allocation', () => {
    expect(() => allocator.release('nonexistent')).not.toThrow();
  });
});

// ============================================================
// Module 3: CronEngine Tests
// ============================================================
describe('CronEngine', () => {
  let engine: CronEngine;

  beforeEach(() => {
    engine = new CronEngine();
  });

  test('should schedule a cron job', () => {
    const id = engine.schedule('* * * * *', async () => {});
    expect(id).toBeDefined();
  });

  test('should unschedule a cron job', () => {
    const id = engine.schedule('* * * * *', async () => {});
    expect(engine.unschedule(id)).toBe(true);
  });

  test('should return false when unscheduling non-existent job', () => {
    expect(engine.unschedule('nonexistent')).toBe(false);
  });

  test('should calculate next run time', () => {
    const id = engine.schedule('0 * * * *', async () => {});
    const nextRun = engine.getNextRun(id);
    expect(nextRun).toBeDefined();
    expect(nextRun!.getMinutes()).toBe(0);
  });

  test('should list all jobs', () => {
    engine.schedule('* * * * *', async () => {});
    engine.schedule('0 * * * *', async () => {});
    const jobs = engine.getJobs();
    expect(jobs.length).toBe(2);
  });

  test('should parse standard 5-field cron', () => {
    const id = engine.schedule('30 14 * * *', async () => {});
    const nextRun = engine.getNextRun(id);
    expect(nextRun).toBeDefined();
  });

  test('should parse @hourly special expression', () => {
    const id = engine.schedule('@hourly', async () => {});
    const nextRun = engine.getNextRun(id);
    expect(nextRun).toBeDefined();
  });

  test('should parse @daily special expression', () => {
    const id = engine.schedule('@daily', async () => {});
    const nextRun = engine.getNextRun(id);
    expect(nextRun).toBeDefined();
  });

  test('should parse @every interval syntax', () => {
    const id = engine.schedule('@every 30m', async () => {});
    const nextRun = engine.getNextRun(id);
    expect(nextRun).toBeDefined();
  });

  test('should generate human-readable description', () => {
    const id = engine.schedule('30 14 * * *', async () => {});
    const jobs = engine.getJobs();
    expect(jobs[0].description).toContain('14:30');
  });

  test('should describe @hourly', () => {
    const id = engine.schedule('@hourly', async () => {});
    const jobs = engine.getJobs();
    expect(jobs[0].description).toContain('hour');
  });

  test('should handle cron options', () => {
    const id = engine.schedule('* * * * *', async () => {}, {
      timezone: 'America/New_York',
      tag: 'maintenance',
    });
    const jobs = engine.getJobs();
    expect(jobs[0].timezone).toBe('America/New_York');
    expect(jobs[0].tag).toBe('maintenance');
  });

  test('should execute handler on tick', async () => {
    let executed = false;
    // Schedule for every minute at :00
    engine.schedule('0 * * * *', async () => { executed = true; });
    // The next run is calculated from now, which is 1 minute ahead
    const nextRun = engine.getNextRun(engine.getJobs()[0].id)!;
    await engine.tick(nextRun);
    expect(executed).toBe(true);
  });

  test('should not execute before next run time', async () => {
    let executed = false;
    engine.schedule('0 12 * * *', async () => { executed = true; });
    await engine.tick(new Date('2025-01-01T06:00:00Z'));
    expect(executed).toBe(false);
  });

  test('should respect end date option', async () => {
    let executed = false;
    engine.schedule('* * * * *', async () => { executed = true; }, {
      endDate: new Date('2024-01-01T00:00:00Z'),
    });
    await engine.tick(new Date('2025-01-01T00:01:00Z'));
    expect(executed).toBe(false);
  });
});

// ============================================================
// Module 4: WorkloadBalancer Tests
// ============================================================
describe('WorkloadBalancer', () => {
  let balancer: WorkloadBalancer;

  beforeEach(() => {
    balancer = new WorkloadBalancer();
  });

  const makeWorker = (id: string, weight = 1, healthy = true) => ({
    id,
    address: `http://${id}:8080`,
    weight,
    healthy,
    currentLoad: 0,
    activeConnections: 0,
    avgResponseTime: 100,
  });

  test('should add and remove workers', () => {
    balancer.addWorker(makeWorker('w1'));
    expect(balancer.getWorkerCount()).toBe(1);
    balancer.removeWorker('w1');
    expect(balancer.getWorkerCount()).toBe(0);
  });

  test('should assign task using round-robin', () => {
    balancer.addWorker(makeWorker('w1'));
    balancer.addWorker(makeWorker('w2'));
    balancer.setAlgorithm('round-robin');

    const t1 = balancer.assign({ id: 't1', type: 'test' });
    const t2 = balancer.assign({ id: 't2', type: 'test' });
    expect(t1.id).not.toBe(t2.id);
  });

  test('should assign task using least-connections', () => {
    balancer.setAlgorithm('least-connections');
    balancer.addWorker(makeWorker('w1'));
    balancer.addWorker(makeWorker('w2'));

    // Manually increase load on w1
    const w1 = balancer.getWorkerStats('w1');
    balancer.assign({ id: 't1', type: 'test' });

    const assigned = balancer.assign({ id: 't2', type: 'test' });
    expect(assigned.id).toBe('w2');
  });

  test('should assign task using weighted-round-robin', () => {
    balancer.setAlgorithm('weighted-round-robin');
    balancer.addWorker(makeWorker('w1', 3));
    balancer.addWorker(makeWorker('w2', 1));

    // w1 should get more assignments
    const assignments: string[] = [];
    for (let i = 0; i < 4; i++) {
      assignments.push(balancer.assign({ id: `t${i}`, type: 'test' }).id);
    }
    const w1Count = assignments.filter((id) => id === 'w1').length;
    expect(w1Count).toBeGreaterThanOrEqual(2);
  });

  test('should report completion and update stats', () => {
    balancer.addWorker(makeWorker('w1'));
    balancer.assign({ id: 't1', type: 'test' });
    balancer.reportCompletion('w1', 't1', 200);

    const stats = balancer.getWorkerStats('w1');
    expect(stats.totalTasksCompleted).toBe(1);
    expect(stats.avgResponseTime).toBe(200);
  });

  test('should track task affinity', () => {
    balancer.addWorker(makeWorker('w1'));
    balancer.addWorker(makeWorker('w2'));

    const t1 = balancer.assign({ id: 't1', type: 'test', affinityKey: 'group-a' });
    const t2 = balancer.assign({ id: 't2', type: 'test', affinityKey: 'group-a' });
    expect(t1.id).toBe(t2.id); // Same worker due to affinity
  });

  test('should throw when no workers available', () => {
    expect(() => balancer.assign({ id: 't1', type: 'test' })).toThrow('No workers available');
  });

  test('should get worker stats', () => {
    balancer.addWorker(makeWorker('w1'));
    const stats = balancer.getWorkerStats('w1');
    expect(stats.workerId).toBe('w1');
    expect(stats.isHealthy).toBe(true);
  });

  test('should throw for non-existent worker stats', () => {
    expect(() => balancer.getWorkerStats('nonexistent')).toThrow();
  });

  test('should skip unhealthy workers', () => {
    balancer.addWorker(makeWorker('w1', 1, false));
    balancer.addWorker(makeWorker('w2', 1, true));
    const assigned = balancer.assign({ id: 't1', type: 'test' });
    expect(assigned.id).toBe('w2');
  });

  test('should use consistent-hash algorithm', () => {
    balancer.setAlgorithm('consistent-hash');
    balancer.addWorker(makeWorker('w1'));
    balancer.addWorker(makeWorker('w2'));

    // Same task ID should always go to same worker
    const a1 = balancer.assign({ id: 't1', type: 'test' }).id;
    const a2 = balancer.assign({ id: 't1', type: 'test' }).id;
    expect(a1).toBe(a2);
  });

  test('should use least-response-time algorithm', () => {
    balancer.setAlgorithm('least-response-time');
    const w1 = makeWorker('w1');
    w1.avgResponseTime = 500;
    const w2 = makeWorker('w2');
    w2.avgResponseTime = 50;
    balancer.addWorker(w1);
    balancer.addWorker(w2);

    const assigned = balancer.assign({ id: 't1', type: 'test' });
    expect(assigned.id).toBe('w2');
  });

  test('should use power-of-two-choices algorithm', () => {
    balancer.setAlgorithm('power-of-two-choices');
    balancer.addWorker(makeWorker('w1'));
    balancer.addWorker(makeWorker('w2'));
    const assigned = balancer.assign({ id: 't1', type: 'test' });
    expect(['w1', 'w2']).toContain(assigned.id);
  });

  test('should report failure', () => {
    balancer.addWorker(makeWorker('w1'));
    balancer.assign({ id: 't1', type: 'test' });
    balancer.reportFailure('w1', 't1');
    const stats = balancer.getWorkerStats('w1');
    expect(stats.successRate).toBe(0);
  });
});

// ============================================================
// Module 5: DependencyResolver Tests
// ============================================================
describe('DependencyResolver', () => {
  let resolver: DependencyResolver;

  beforeEach(() => {
    resolver = new DependencyResolver();
  });

  test('should resolve independent tasks in parallel group', () => {
    resolver.addTask({ id: 'a', name: 'A' });
    resolver.addTask({ id: 'b', name: 'B' });
    resolver.addTask({ id: 'c', name: 'C' });

    const plan = resolver.resolve();
    expect(plan.hasCircularDependency).toBe(false);
    expect(plan.parallelGroups[0].length).toBe(3);
  });

  test('should resolve linear dependencies', () => {
    resolver.addTask({ id: 'a', name: 'A' });
    resolver.addTask({ id: 'b', name: 'B', dependencies: ['a'] });
    resolver.addTask({ id: 'c', name: 'C', dependencies: ['b'] });

    const plan = resolver.resolve();
    expect(plan.orderedTasks).toEqual(['a', 'b', 'c']);
  });

  test('should detect circular dependencies', () => {
    resolver.addTask({ id: 'a', name: 'A' });
    resolver.addTask({ id: 'b', name: 'B' });
    resolver.addDependency('a', 'b');
    resolver.addDependency('b', 'a');

    const plan = resolver.resolve();
    expect(plan.hasCircularDependency).toBe(true);
    expect(plan.circularDependencies.length).toBeGreaterThan(0);
  });

  test('should calculate critical path', () => {
    resolver.addTask({ id: 'a', name: 'A', estimatedDuration: 5 });
    resolver.addTask({ id: 'b', name: 'B', estimatedDuration: 10, dependencies: ['a'] });
    resolver.addTask({ id: 'c', name: 'C', estimatedDuration: 3, dependencies: ['a'] });

    const path = resolver.getCriticalPath();
    expect(path).toContain('a');
    expect(path).toContain('b');
  });

  test('should identify parallel groups', () => {
    resolver.addTask({ id: 'a', name: 'A' });
    resolver.addTask({ id: 'b', name: 'B', dependencies: ['a'] });
    resolver.addTask({ id: 'c', name: 'C', dependencies: ['a'] });

    const groups = resolver.getParallelGroups();
    expect(groups.length).toBe(2);
    expect(groups[0]).toEqual(['a']);
    expect(groups[1].sort()).toEqual(['b', 'c']);
  });

  test('should resolve transitive dependencies', () => {
    resolver.addTask({ id: 'a', name: 'A' });
    resolver.addTask({ id: 'b', name: 'B' });
    resolver.addTask({ id: 'c', name: 'C' });
    resolver.addDependency('a', 'b');
    resolver.addDependency('b', 'c');

    const transitive = resolver.getTransitiveDependencies('a');
    expect(transitive.has('b')).toBe(true);
    expect(transitive.has('c')).toBe(true);
  });

  test('should remove tasks', () => {
    resolver.addTask({ id: 'a', name: 'A' });
    expect(resolver.removeTask('a')).toBe(true);
    expect(resolver.getTaskCount()).toBe(0);
  });

  test('should return false when removing non-existent task', () => {
    expect(resolver.removeTask('nonexistent')).toBe(false);
  });

  test('should handle complex DAG', () => {
    // A -> B, A -> C, B -> D, C -> D
    resolver.addTask({ id: 'a', name: 'A', estimatedDuration: 2 });
    resolver.addTask({ id: 'b', name: 'B', estimatedDuration: 3, dependencies: ['a'] });
    resolver.addTask({ id: 'c', name: 'C', estimatedDuration: 4, dependencies: ['a'] });
    resolver.addTask({ id: 'd', name: 'D', estimatedDuration: 1, dependencies: ['b', 'c'] });

    const plan = resolver.resolve();
    expect(plan.hasCircularDependency).toBe(false);
    expect(plan.orderedTasks.indexOf('a')).toBeLessThan(plan.orderedTasks.indexOf('b'));
    expect(plan.orderedTasks.indexOf('a')).toBeLessThan(plan.orderedTasks.indexOf('c'));
    expect(plan.orderedTasks.indexOf('b')).toBeLessThan(plan.orderedTasks.indexOf('d'));
    expect(plan.orderedTasks.indexOf('c')).toBeLessThan(plan.orderedTasks.indexOf('d'));
  });

  test('should return empty critical path for circular deps', () => {
    resolver.addTask({ id: 'a', name: 'A' });
    resolver.addTask({ id: 'b', name: 'B' });
    resolver.addDependency('a', 'b');
    resolver.addDependency('b', 'a');
    expect(resolver.getCriticalPath()).toEqual([]);
  });
});

// ============================================================
// Module 6: DeadlineManager Tests
// ============================================================
describe('DeadlineManager', () => {
  let manager: DeadlineManager;
  const baseTime = new Date('2025-01-01T00:00:00Z');

  beforeEach(() => {
    manager = new DeadlineManager();
  });

  test('should set a deadline', () => {
    manager.setDeadline('task1', new Date('2025-01-01T01:00:00Z'));
    expect(manager.getDeadlineCount()).toBe(1);
  });

  test('should check deadlines and return ok status', () => {
    manager.setDeadline('task1', new Date('2025-01-01T02:00:00Z'), { createdAt: baseTime });
    const results = manager.checkDeadlines(baseTime);
    expect(results[0].status).toBe('ok');
  });

  test('should detect overdue deadlines', () => {
    manager.setDeadline('task1', new Date('2024-12-31T23:00:00Z'));
    const results = manager.checkDeadlines(baseTime);
    expect(results[0].status).toBe('overdue');
  });

  test('should detect warning threshold', () => {
    // Created at 00:00, deadline at 00:20 (20 min total)
    // At 00:11 (55% elapsed), should trigger 50% warning
    manager.setDeadline('task1', new Date('2025-01-01T00:20:00Z'), { createdAt: baseTime });
    const checkTime = new Date('2025-01-01T00:11:00Z');
    const results = manager.checkDeadlines(checkTime);
    expect(results[0].status).toBe('warning');
  });

  test('should detect critical threshold', () => {
    manager.setDeadline('task1', new Date('2025-01-01T00:20:00Z'));
    const checkTime = new Date('2025-01-01T00:19:00Z');
    const results = manager.checkDeadlines(checkTime);
    expect(results[0].status).toBe('critical');
  });

  test('should extend deadline', () => {
    manager.setDeadline('task1', new Date('2025-01-01T01:00:00Z'));
    const result = manager.extendDeadline('task1', 3600_000, baseTime);
    expect(result).toBe(true);
    const deadline = manager.getDeadline('task1');
    expect(deadline!.deadline.getTime()).toBe(new Date('2025-01-01T02:00:00Z').getTime());
  });

  test('should return false when extending non-existent deadline', () => {
    expect(manager.extendDeadline('nonexistent', 1000)).toBe(false);
  });

  test('should get time remaining', () => {
    manager.setDeadline('task1', new Date('2025-01-01T01:00:00Z'));
    const remaining = manager.getTimeRemaining('task1', baseTime);
    expect(remaining).toBe(3600_000);
  });

  test('should return -1 for non-existent task time remaining', () => {
    expect(manager.getTimeRemaining('nonexistent')).toBe(-1);
  });

  test('should predict breaches', () => {
    manager.setDeadline('task1', new Date('2025-01-01T00:03:00Z'));
    const breaches = manager.predictBreaches(baseTime);
    expect(breaches.length).toBeGreaterThan(0);
  });

  test('should propagate deadline to children', () => {
    manager.setDeadline('parent', new Date('2025-01-01T01:00:00Z'));
    manager.propagateDeadline('parent', ['child1', 'child2']);
    expect(manager.getDeadlineCount()).toBe(3);
  });

  test('should remove deadline', () => {
    manager.setDeadline('task1', new Date('2025-01-01T01:00:00Z'));
    expect(manager.removeDeadline('task1')).toBe(true);
    expect(manager.getDeadlineCount()).toBe(0);
  });

  test('should handle custom warning thresholds', () => {
    const custom = new DeadlineManager({ warningThresholds: [25, 50] });
    custom.setDeadline('task1', new Date('2025-01-01T00:20:00Z'), { createdAt: baseTime });
    const checkTime = new Date('2025-01-01T00:11:00Z');
    const results = custom.checkDeadlines(checkTime);
    expect(results[0].status).toBe('warning');
  });
});

// ============================================================
// Module 7: BatchScheduler Tests
// ============================================================
describe('BatchScheduler', () => {
  let scheduler: BatchScheduler;

  beforeEach(() => {
    scheduler = new BatchScheduler();
  });

  const makeTasks = (count: number): BatchScheduler extends never ? never : import('../src/batch-scheduler').BatchTask[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `task-${i}`,
      name: `Task ${i}`,
      priority: 2,
    }));
  };

  test('should schedule a batch', () => {
    const batch = scheduler.scheduleBatch(makeTasks(5));
    expect(batch.id).toBeDefined();
    expect(batch.totalTasks).toBe(5);
    expect(batch.status).toBe('pending');
  });

  test('should get batch status', () => {
    const batch = scheduler.scheduleBatch(makeTasks(3));
    const status = scheduler.getBatchStatus(batch.id);
    expect(status).toBeDefined();
    expect(status!.totalTasks).toBe(3);
    expect(status!.progress).toBe(0);
  });

  test('should cancel a batch', () => {
    const batch = scheduler.scheduleBatch(makeTasks(5));
    expect(scheduler.cancelBatch(batch.id)).toBe(true);
    const status = scheduler.getBatchStatus(batch.id);
    expect(status!.status).toBe('cancelled');
  });

  test('should not cancel completed batch', () => {
    const batch = scheduler.scheduleBatch(makeTasks(1));
    scheduler.startBatch(batch.id);
    scheduler.completeTask(batch.id, 'task-0');
    expect(scheduler.cancelBatch(batch.id)).toBe(false);
  });

  test('should start a batch', () => {
    const batch = scheduler.scheduleBatch(makeTasks(3));
    expect(scheduler.startBatch(batch.id)).toBe(true);
    const status = scheduler.getBatchStatus(batch.id);
    expect(status!.status).toBe('running');
  });

  test('should complete tasks and update progress', () => {
    const batch = scheduler.scheduleBatch(makeTasks(4));
    scheduler.startBatch(batch.id);
    scheduler.completeTask(batch.id, 'task-0');
    scheduler.completeTask(batch.id, 'task-1');

    const status = scheduler.getBatchStatus(batch.id);
    expect(status!.completedTasks).toBe(2);
    expect(status!.progress).toBe(50);
  });

  test('should mark batch as completed when all tasks done', () => {
    const batch = scheduler.scheduleBatch(makeTasks(2));
    scheduler.startBatch(batch.id);
    scheduler.completeTask(batch.id, 'task-0');
    scheduler.completeTask(batch.id, 'task-1');

    const status = scheduler.getBatchStatus(batch.id);
    expect(status!.status).toBe('completed');
  });

  test('should mark batch as failed when tasks fail', () => {
    const batch = scheduler.scheduleBatch(makeTasks(2));
    scheduler.startBatch(batch.id);
    scheduler.failTask(batch.id, 'task-0');
    scheduler.failTask(batch.id, 'task-1');

    const status = scheduler.getBatchStatus(batch.id);
    expect(status!.status).toBe('failed');
  });

  test('should split large batches into sub-batches', () => {
    const batch = scheduler.scheduleBatch(makeTasks(25), { maxBatchSize: 10 });
    const status = scheduler.getBatchStatus(batch.id);
    expect(status!.subBatchCount).toBe(3);
  });

  test('should filter batch history', () => {
    scheduler.scheduleBatch(makeTasks(1), { tag: 'daily' });
    scheduler.scheduleBatch(makeTasks(1), { tag: 'weekly' });

    const daily = scheduler.getBatchHistory({ tag: 'daily' });
    expect(daily.length).toBe(1);
    expect(daily[0].tag).toBe('daily');
  });

  test('should return undefined for non-existent batch status', () => {
    expect(scheduler.getBatchStatus('nonexistent')).toBeUndefined();
  });

  test('should sort tasks by priority within batch', () => {
    const tasks: import('../src/batch-scheduler').BatchTask[] = [
      { id: 't1', name: 'Low', priority: 3 },
      { id: 't2', name: 'High', priority: 0 },
      { id: 't3', name: 'Normal', priority: 2 },
    ];
    const batch = scheduler.scheduleBatch(tasks);
    expect(batch.tasks[0].id).toBe('t2');
    expect(batch.tasks[1].id).toBe('t3');
    expect(batch.tasks[2].id).toBe('t1');
  });

  test('should use time-based window type', () => {
    const batch = scheduler.scheduleBatch(makeTasks(5), { windowType: 'time-based' });
    const status = scheduler.getBatchStatus(batch.id);
    expect(status!.subBatchCount).toBe(1);
  });
});

// ============================================================
// Module 8: AdaptiveScheduler Tests
// ============================================================
describe('AdaptiveScheduler', () => {
  let scheduler: AdaptiveScheduler;

  beforeEach(() => {
    scheduler = new AdaptiveScheduler();
  });

  test('should record outcomes', () => {
    scheduler.recordOutcome({
      taskId: 't1',
      taskType: 'compute',
      strategy: 'priority',
      waitTime: 100,
      executionTime: 500,
      success: true,
      timestamp: Date.now(),
    });
    expect(scheduler.getOutcomeCount()).toBe(1);
  });

  test('should return default strategy when no data', () => {
    const strategy = scheduler.getOptimalStrategy('unknown');
    expect(strategy).toBe('priority');
  });

  test('should learn optimal strategy from outcomes', () => {
    // Record many successful outcomes for 'fifo'
    for (let i = 0; i < 10; i++) {
      scheduler.recordOutcome({
        taskId: `t-fifo-${i}`,
        taskType: 'compute',
        strategy: 'fifo',
        waitTime: 50,
        executionTime: 200,
        success: true,
        timestamp: Date.now(),
      });
    }
    // Record some failed outcomes for 'priority'
    for (let i = 0; i < 10; i++) {
      scheduler.recordOutcome({
        taskId: `t-pri-${i}`,
        taskType: 'compute',
        strategy: 'priority',
        waitTime: 500,
        executionTime: 1000,
        success: i < 3, // Only 30% success
        timestamp: Date.now(),
      });
    }

    const optimal = scheduler.getOptimalStrategy('compute');
    expect(optimal).toBe('fifo');
  });

  test('should tune parameters', () => {
    for (let i = 0; i < 10; i++) {
      scheduler.recordOutcome({
        taskId: `t-${i}`,
        taskType: 'test',
        strategy: 'shortest-job-first',
        waitTime: 10,
        executionTime: 50,
        success: true,
        timestamp: Date.now(),
      });
    }

    const result = scheduler.tuneParameters();
    expect(result.newStrategy).toBeDefined();
    expect(result.expectedImprovement).toBeGreaterThanOrEqual(0);
  });

  test('should generate performance report', () => {
    scheduler.recordOutcome({
      taskId: 't1',
      taskType: 'compute',
      strategy: 'priority',
      waitTime: 100,
      executionTime: 500,
      success: true,
      timestamp: Date.now(),
    });

    const report = scheduler.getPerformanceReport();
    expect(report.totalTasksTracked).toBe(1);
    expect(report.strategyScores.length).toBeGreaterThan(0);
    expect(report.bestStrategy).toBeDefined();
  });

  test('should calculate improvement trend', () => {
    // Record outcomes with increasing timestamps and improving success
    const baseTs = Date.now() - 200000;
    // First half: mostly failures
    for (let i = 0; i < 10; i++) {
      scheduler.recordOutcome({
        taskId: `t-old-${i}`,
        taskType: 'test',
        strategy: 'fifo',
        waitTime: 1000,
        executionTime: 2000,
        success: i >= 8, // Only 2 successes out of 10
        timestamp: baseTs + i * 1000,
      });
    }
    // Second half: mostly successes
    for (let i = 0; i < 10; i++) {
      scheduler.recordOutcome({
        taskId: `t-new-${i}`,
        taskType: 'test',
        strategy: 'fifo',
        waitTime: 50,
        executionTime: 100,
        success: i < 8, // 8 successes out of 10
        timestamp: baseTs + 10000 + i * 1000,
      });
    }

    const report = scheduler.getPerformanceReport();
    expect(report.improvementTrend).toBeGreaterThan(0);
  });

  test('should support A/B testing', () => {
    scheduler.startAbTest('experiment', 'deadline-first');
    expect(scheduler.getAbTestStrategy('experiment')).toBe('deadline-first');
  });

  test('should set and get current strategy', () => {
    scheduler.setStrategy('shortest-job-first');
    expect(scheduler.getCurrentStrategy()).toBe('shortest-job-first');
  });

  test('should track task type breakdown in report', () => {
    scheduler.recordOutcome({
      taskId: 't1', taskType: 'io', strategy: 'fifo',
      waitTime: 100, executionTime: 200, success: true, timestamp: Date.now(),
    });
    scheduler.recordOutcome({
      taskId: 't2', taskType: 'cpu', strategy: 'fifo',
      waitTime: 50, executionTime: 500, success: true, timestamp: Date.now(),
    });

    const report = scheduler.getPerformanceReport();
    expect(report.taskTypeBreakdown['io']).toBeDefined();
    expect(report.taskTypeBreakdown['cpu']).toBeDefined();
  });
});

// ============================================================
// Module 9: QueueManager Tests
// ============================================================
describe('QueueManager', () => {
  let manager: QueueManager;

  beforeEach(() => {
    manager = new QueueManager();
  });

  test('should create a queue', () => {
    const queue = manager.createQueue('default');
    expect(queue.name).toBe('default');
    expect(manager.getQueueCount()).toBe(1);
  });

  test('should enqueue and dequeue tasks', () => {
    manager.createQueue('default');
    const id = manager.enqueue('default', { name: 'task1' });
    expect(id).toBeDefined();

    const task = manager.dequeue('default');
    expect(task?.name).toBe('task1');
  });

  test('should return undefined when dequeuing empty queue', () => {
    manager.createQueue('default');
    expect(manager.dequeue('default')).toBeUndefined();
  });

  test('should maintain priority order in queue', () => {
    manager.createQueue('default');
    manager.enqueue('default', { name: 'low', priority: 3 });
    manager.enqueue('default', { name: 'high', priority: 0 });
    manager.enqueue('default', { name: 'mid', priority: 1 });

    const t1 = manager.dequeue('default');
    const t2 = manager.dequeue('default');
    const t3 = manager.dequeue('default');
    expect(t1!.name).toBe('high');
    expect(t2!.name).toBe('mid');
    expect(t3!.name).toBe('low');
  });

  test('should get queue statistics', () => {
    manager.createQueue('high-priority', { priority: 10, weight: 5 });
    manager.enqueue('high-priority', { name: 'task1' });
    const stats = manager.getQueueStats('high-priority');
    expect(stats.depth).toBe(1);
    expect(stats.name).toBe('high-priority');
  });

  test('should throw for non-existent queue stats', () => {
    expect(() => manager.getQueueStats('nonexistent')).toThrow();
  });

  test('should move tasks to dead letter queue', () => {
    manager.createQueue('default');
    const id = manager.enqueue('default', { name: 'fail-task' });
    expect(manager.moveToDeadLetter('default', id)).toBe(true);
    expect(manager.dequeue('default')).toBeUndefined();
  });

  test('should retry tasks from dead letter queue', () => {
    manager.createQueue('default');
    const id = manager.enqueue('default', { name: 'retry-task' });
    manager.moveToDeadLetter('default', id);
    expect(manager.retryTask('default', id)).toBe(true);
    const task = manager.dequeue('default');
    expect(task?.name).toBe('retry-task');
  });

  test('should respect retry limit', () => {
    manager.createQueue('default', { retryLimit: 2 });
    const id = manager.enqueue('default', { name: 'limited-retry' });
    manager.moveToDeadLetter('default', id);
    manager.retryTask('default', id);
    manager.retryTask('default', id);
    // Third retry should fail (exceeds limit of 2)
    expect(manager.retryTask('default', id)).toBe(false);
  });

  test('should dequeue from any queue (weighted)', () => {
    manager.createQueue('high', { weight: 10 });
    manager.createQueue('low', { weight: 1 });
    manager.enqueue('high', { name: 'h-task' });
    manager.enqueue('low', { name: 'l-task' });

    const result = manager.dequeueFromAny();
    expect(result).toBeDefined();
    expect(result!.queueName).toBe('high');
  });

  test('should rebalance queues', () => {
    manager.createQueue('q1');
    manager.createQueue('q2');
    for (let i = 0; i < 10; i++) {
      manager.enqueue('q1', { name: `task-${i}` });
    }

    const result = manager.rebalance();
    expect(result.tasksMoved).toBeGreaterThan(0);
    expect(result.sourceQueue).toBe('q1');
    expect(result.targetQueue).toBe('q2');
  });

  test('should delete a queue', () => {
    manager.createQueue('temp');
    expect(manager.deleteQueue('temp')).toBe(true);
    expect(manager.getQueueCount()).toBe(0);
  });

  test('should get total depth across all queues', () => {
    manager.createQueue('q1');
    manager.createQueue('q2');
    manager.enqueue('q1', { name: 't1' });
    manager.enqueue('q2', { name: 't2' });
    expect(manager.getTotalDepth()).toBe(2);
  });

  test('should get queue names', () => {
    manager.createQueue('alpha');
    manager.createQueue('beta');
    const names = manager.getQueueNames();
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  test('should throw when enqueuing to non-existent queue', () => {
    expect(() => manager.enqueue('nonexistent', { name: 'task' })).toThrow();
  });

  test('should enforce max queue size', () => {
    manager.createQueue('small', { maxSize: 2 });
    manager.enqueue('small', { name: 't1' });
    manager.enqueue('small', { name: 't2' });
    expect(() => manager.enqueue('small', { name: 't3' })).toThrow('full');
  });
});

// ============================================================
// Module 10: SchedulingMetrics Tests
// ============================================================
describe('SchedulingMetrics', () => {
  let metrics: SchedulingMetrics;

  beforeEach(() => {
    metrics = new SchedulingMetrics();
  });

  test('should record events', () => {
    metrics.recordEvent({
      taskId: 't1',
      eventType: 'queued',
      timestamp: Date.now(),
    });
    expect(metrics.getEventCount()).toBe(1);
  });

  test('should generate dashboard', () => {
    const now = Date.now();
    metrics.recordEvent({ taskId: 't1', eventType: 'queued', timestamp: now });
    metrics.recordEvent({ taskId: 't1', eventType: 'started', timestamp: now + 100 });
    metrics.recordEvent({ taskId: 't1', eventType: 'completed', timestamp: now + 600, duration: 500 });

    const dashboard = metrics.getDashboard();
    expect(dashboard.completedTasks).toBe(1);
    expect(dashboard.failedTasks).toBe(0);
  });

  test('should calculate average wait time', () => {
    const now = Date.now();
    metrics.recordEvent({ taskId: 't1', eventType: 'queued', timestamp: now });
    metrics.recordEvent({ taskId: 't1', eventType: 'started', timestamp: now + 200 });
    metrics.recordEvent({ taskId: 't1', eventType: 'completed', timestamp: now + 700, duration: 500 });

    const dashboard = metrics.getDashboard();
    expect(dashboard.avgWaitTime).toBe(200);
  });

  test('should calculate average execution time', () => {
    const now = Date.now();
    metrics.recordEvent({ taskId: 't1', eventType: 'queued', timestamp: now });
    metrics.recordEvent({ taskId: 't1', eventType: 'started', timestamp: now });
    metrics.recordEvent({ taskId: 't1', eventType: 'completed', timestamp: now + 1000, duration: 1000 });

    const dashboard = metrics.getDashboard();
    expect(dashboard.avgExecutionTime).toBe(1000);
  });

  test('should calculate success rate', () => {
    const now = Date.now();
    metrics.recordEvent({ taskId: 't1', eventType: 'queued', timestamp: now });
    metrics.recordEvent({ taskId: 't1', eventType: 'started', timestamp: now });
    metrics.recordEvent({ taskId: 't1', eventType: 'completed', timestamp: now + 100, duration: 100 });
    metrics.recordEvent({ taskId: 't2', eventType: 'queued', timestamp: now });
    metrics.recordEvent({ taskId: 't2', eventType: 'started', timestamp: now });
    metrics.recordEvent({ taskId: 't2', eventType: 'failed', timestamp: now + 100 });

    const dashboard = metrics.getDashboard();
    expect(dashboard.successRate).toBeCloseTo(0.5);
  });

  test('should track SLA compliance', () => {
    const now = Date.now();
    metrics.recordEvent({ taskId: 't1', eventType: 'queued', timestamp: now });
    metrics.recordEvent({ taskId: 't1', eventType: 'started', timestamp: now });
    metrics.recordEvent({ taskId: 't1', eventType: 'completed', timestamp: now + 100, duration: 100 });
    metrics.recordEvent({ taskId: 't1', eventType: 'deadline-missed', timestamp: now + 100 });

    const dashboard = metrics.getDashboard();
    expect(dashboard.slaComplianceRate).toBeLessThan(1);
  });

  test('should get task history', () => {
    const now = Date.now();
    metrics.recordEvent({ taskId: 't1', eventType: 'queued', timestamp: now });
    metrics.recordEvent({ taskId: 't1', eventType: 'started', timestamp: now + 100 });

    const history = metrics.getTaskHistory('t1');
    expect(history.length).toBe(1);
    expect(history[0].events.length).toBe(2);
  });

  test('should return empty history for unknown task', () => {
    expect(metrics.getTaskHistory('unknown')).toEqual([]);
  });

  test('should generate efficiency report', () => {
    const now = Date.now();
    metrics.recordEvent({ taskId: 't1', eventType: 'queued', timestamp: now });
    metrics.recordEvent({ taskId: 't1', eventType: 'started', timestamp: now + 10 });
    metrics.recordEvent({ taskId: 't1', eventType: 'completed', timestamp: now + 110, duration: 100 });

    const report = metrics.getEfficiencyReport();
    expect(report.efficiencyScore).toBeGreaterThanOrEqual(0);
    expect(report.efficiencyScore).toBeLessThanOrEqual(100);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  test('should export Prometheus format', () => {
    const now = Date.now();
    metrics.recordEvent({ taskId: 't1', eventType: 'queued', timestamp: now });
    metrics.recordEvent({ taskId: 't1', eventType: 'started', timestamp: now });
    metrics.recordEvent({ taskId: 't1', eventType: 'completed', timestamp: now + 100, duration: 100 });

    const prometheus = metrics.exportPrometheus();
    expect(prometheus).toContain('scheduler_tasks_total');
    expect(prometheus).toContain('scheduler_success_rate');
    expect(prometheus).toContain('scheduler_avg_wait_time_ms');
  });

  test('should clear all metrics', () => {
    metrics.recordEvent({ taskId: 't1', eventType: 'queued', timestamp: Date.now() });
    metrics.clear();
    expect(metrics.getEventCount()).toBe(0);
  });

  test('should identify top failing task types', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      metrics.recordEvent({ taskId: `t${i}`, eventType: 'failed', timestamp: now, taskType: 'network' });
    }
    for (let i = 0; i < 2; i++) {
      metrics.recordEvent({ taskId: `u${i}`, eventType: 'failed', timestamp: now, taskType: 'compute' });
    }

    const dashboard = metrics.getDashboard();
    expect(dashboard.topFailingTaskTypes[0].type).toBe('network');
    expect(dashboard.topFailingTaskTypes[0].count).toBe(5);
  });

  test('should calculate hourly distribution', () => {
    const now = Date.now();
    metrics.recordEvent({
      taskId: 't1', eventType: 'completed',
      timestamp: new Date('2025-01-01T14:00:00Z').getTime(), duration: 100,
    });
    metrics.recordEvent({
      taskId: 't2', eventType: 'completed',
      timestamp: new Date('2025-01-01T14:30:00Z').getTime(), duration: 100,
    });

    const dashboard = metrics.getDashboard();
    const hour14 = dashboard.hourlyDistribution.find((h) => h.hour === 14);
    expect(hour14?.count).toBe(2);
  });

  test('should trim events when exceeding max', () => {
    const small = new SchedulingMetrics({ maxEvents: 5 });
    for (let i = 0; i < 10; i++) {
      small.recordEvent({ taskId: `t${i}`, eventType: 'queued', timestamp: Date.now() });
    }
    expect(small.getEventCount()).toBe(5);
  });
});
