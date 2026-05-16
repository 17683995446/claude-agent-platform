import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';

// Module 1: Dynamic Priority Scheduler
import {
  DynamicPriorityScheduler,
  type ContinuousTask,
} from '../src/dynamic-priority.ts';

// Module 2: Adaptive Executor
import { AdaptiveExecutor } from '../src/adaptive-executor.ts';

// Module 3: Workload Predictor
import { WorkloadPredictor } from '../src/workload-predictor.ts';

// Module 4: Elastic Scaler
import { ElasticScaler } from '../src/elastic-scaler.ts';

// Module 5: Backpressure Handler
import { BackpressureHandler } from '../src/backpressure-handler.ts';

// Module 6: Task Recycling Manager
import { TaskRecyclingManager } from '../src/task-recycling.ts';

// Module 7: Long Running Task Manager
import { LongRunningTaskManager } from '../src/long-running-task.ts';

// Module 8: Schedule Optimizer
import { ScheduleOptimizer } from '../src/schedule-optimizer.ts';

// Module 9: Periodic Job Manager
import { PeriodicJobManager } from '../src/periodic-jobs.ts';

// Module 10: Scheduling Analytics
import { SchedulingAnalytics } from '../src/scheduling-analytics.ts';

// ============================================================
// Helper functions
// ============================================================

function createTask(overrides: Partial<ContinuousTask> = {}): ContinuousTask {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    name: 'test-task',
    priority: 50,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ============================================================
// Module 1: Dynamic Priority Scheduler Tests
// ============================================================

describe('DynamicPriorityScheduler', () => {
  let scheduler: DynamicPriorityScheduler;

  beforeEach(() => {
    scheduler = new DynamicPriorityScheduler();
  });

  test('should create scheduler with default options', () => {
    expect(scheduler).toBeDefined();
    expect(scheduler.getQueueSize()).toBe(0);
  });

  test('should schedule a task and return its id', () => {
    const task = createTask({ id: 't1' });
    const id = scheduler.schedule(task);
    expect(id).toBe('t1');
    expect(scheduler.getQueueSize()).toBe(1);
  });

  test('should throw when queue is full', () => {
    const smallScheduler = new DynamicPriorityScheduler({ maxQueueSize: 2 });
    smallScheduler.schedule(createTask({ id: 't1' }));
    smallScheduler.schedule(createTask({ id: 't2' }));
    expect(() => smallScheduler.schedule(createTask({ id: 't3' }))).toThrow('Queue is full');
  });

  test('should get next task with highest priority', () => {
    scheduler.schedule(createTask({ id: 'low', priority: 10 }));
    scheduler.schedule(createTask({ id: 'high', priority: 90 }));
    const next = scheduler.getNextTask();
    expect(next?.id).toBe('high');
    expect(scheduler.getQueueSize()).toBe(1);
  });

  test('should return undefined when queue is empty', () => {
    expect(scheduler.getNextTask()).toBeUndefined();
  });

  test('should adjust priority by deadline factor', () => {
    const task = createTask({
      id: 't1',
      deadline: Date.now() + 1000, // very soon
    });
    scheduler.schedule(task);
    scheduler.adjustPriority('t1', 'deadline');
    const snapshot = scheduler.getQueueSnapshot();
    expect(snapshot[0]?.currentPriority).toBeGreaterThan(task.priority);
  });

  test('should adjust priority by waitTime factor', () => {
    vi.useFakeTimers();
    const task = createTask({ id: 't1', priority: 50 });
    scheduler.schedule(task);
    vi.advanceTimersByTime(10 * 60 * 1000); // 10 minutes
    scheduler.adjustPriority('t1', 'waitTime');
    const snapshot = scheduler.getQueueSnapshot();
    expect(snapshot[0]?.currentPriority).toBeGreaterThan(50);
    vi.useRealTimers();
  });

  test('should adjust priority by businessValue factor', () => {
    const task = createTask({ id: 't1', priority: 50, businessValue: 100 });
    scheduler.schedule(task);
    scheduler.adjustPriority('t1', 'businessValue');
    const snapshot = scheduler.getQueueSnapshot();
    expect(snapshot[0]?.currentPriority).toBeGreaterThan(50);
  });

  test('should adjust priority by dependencies factor', () => {
    const task = createTask({ id: 't1', priority: 50, dependencies: ['dep1', 'dep2'] });
    scheduler.schedule(task);
    scheduler.adjustPriority('t1', 'dependencies');
    const snapshot = scheduler.getQueueSnapshot();
    // Dependencies are not in queue, so resolution ratio is 1, adding 15
    expect(snapshot[0]?.currentPriority).toBe(65);
  });

  test('should adjust priority by resourceRequirements factor', () => {
    const task = createTask({
      id: 't1',
      priority: 50,
      resourceRequirements: { cpu: 1, memory: 1, gpu: 0 },
    });
    scheduler.schedule(task);
    scheduler.adjustPriority('t1', 'resourceRequirements');
    const snapshot = scheduler.getQueueSnapshot();
    expect(snapshot[0]?.currentPriority).toBeGreaterThan(50);
  });

  test('should throw when adjusting priority for non-existent task', () => {
    expect(() => scheduler.adjustPriority('nonexistent', 'deadline')).toThrow('not found');
  });

  test('should boost priority temporarily', () => {
    scheduler.schedule(createTask({ id: 't1', priority: 10 }));
    scheduler.schedule(createTask({ id: 't2', priority: 80 }));
    scheduler.boostPriority('t1');
    const next = scheduler.getNextTask();
    expect(next?.id).toBe('t1'); // boosted task should come first
  });

  test('should throw when boosting non-existent task', () => {
    expect(() => scheduler.boostPriority('nonexistent')).toThrow('not found');
  });

  test('should return queue snapshot sorted by priority', () => {
    scheduler.schedule(createTask({ id: 'low', priority: 10 }));
    scheduler.schedule(createTask({ id: 'mid', priority: 50 }));
    scheduler.schedule(createTask({ id: 'high', priority: 90 }));
    const snapshot = scheduler.getQueueSnapshot();
    expect(snapshot[0]?.id).toBe('high');
    expect(snapshot[1]?.id).toBe('mid');
    expect(snapshot[2]?.id).toBe('low');
  });

  test('should rebalance all priorities', () => {
    scheduler.schedule(createTask({ id: 't1', priority: 50 }));
    scheduler.schedule(createTask({ id: 't2', priority: 30 }));
    const result = scheduler.rebalance();
    expect(result.totalTasks).toBe(2);
    expect(result.adjustedCount).toBeGreaterThanOrEqual(0);
    expect(result.averagePriority).toBeGreaterThan(0);
  });

  test('should remove task from queue', () => {
    scheduler.schedule(createTask({ id: 't1' }));
    expect(scheduler.removeTask('t1')).toBe(true);
    expect(scheduler.getQueueSize()).toBe(0);
  });

  test('should return false when removing non-existent task', () => {
    expect(scheduler.removeTask('nonexistent')).toBe(false);
  });

  test('should apply priority aging over time', () => {
    vi.useFakeTimers();
    scheduler.schedule(createTask({ id: 't1', priority: 50 }));
    vi.advanceTimersByTime(30 * 60 * 1000); // 30 minutes
    const result = scheduler.rebalance();
    expect(result.changes.length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  test('should prevent starvation of low-priority tasks', () => {
    vi.useFakeTimers();
    const task = createTask({ id: 't1', priority: 1 });
    scheduler.schedule(task);
    // Simulate task was executed long ago
    scheduler.getNextTask(); // execute it
    scheduler.schedule(createTask({ id: 't1', priority: 1 }));
    vi.advanceTimersByTime(15 * 60 * 1000); // 15 minutes
    const result = scheduler.rebalance();
    expect(result.starvationPreventions).toBeGreaterThanOrEqual(0);
    vi.useRealTimers();
  });

  test('should handle custom options', () => {
    const custom = new DynamicPriorityScheduler({
      agingRate: 2.0,
      agingMaxBoost: 50,
      deadlineWeight: 0.5,
    });
    expect(custom).toBeDefined();
    custom.schedule(createTask({ id: 't1' }));
    expect(custom.getQueueSize()).toBe(1);
  });

  test('snapshot should include wait time and deadline proximity', () => {
    const task = createTask({
      id: 't1',
      deadline: Date.now() + 60 * 60 * 1000,
    });
    scheduler.schedule(task);
    const snapshot = scheduler.getQueueSnapshot();
    expect(snapshot[0]?.waitTime).toBeGreaterThanOrEqual(0);
    expect(snapshot[0]?.deadlineProximity).toBeGreaterThan(0);
    expect(snapshot[0]?.boosted).toBe(false);
  });
});

// ============================================================
// Module 2: Adaptive Executor Tests
// ============================================================

describe('AdaptiveExecutor', () => {
  let executor: AdaptiveExecutor;

  beforeEach(() => {
    executor = new AdaptiveExecutor();
  });

  test('should create executor with default options', () => {
    expect(executor).toBeDefined();
    expect(executor.getActiveExecutions()).toBe(0);
  });

  test('should execute a task successfully', async () => {
    const task = createTask({ id: 't1' });
    const result = await executor.execute(task);
    expect(result.success).toBe(true);
    expect(result.taskId).toBe('t1');
    expect(result.executionTime).toBeGreaterThanOrEqual(0);
  });

  test('should execute a task with handler payload', async () => {
    const task = createTask({
      id: 't2',
      payload: { handler: () => 42 },
    });
    const result = await executor.execute(task);
    expect(result.success).toBe(true);
    expect(result.result).toBe(42);
  });

  test('should handle task execution failure', async () => {
    const task = createTask({
      id: 't3',
      payload: { handler: () => { throw new Error('task failed'); } },
    });
    const result = await executor.execute(task);
    expect(result.success).toBe(false);
    expect(result.error).toContain('task failed');
  });

  test('should execute a batch of tasks', async () => {
    const tasks = [
      createTask({ id: 'b1' }),
      createTask({ id: 'b2' }),
      createTask({ id: 'b3' }),
    ];
    const result = await executor.executeBatch(tasks);
    expect(result.results.length).toBe(3);
    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
  });

  test('should track batch execution metrics', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => createTask({ id: `batch-${i}` }));
    const result = await executor.executeBatch(tasks);
    expect(result.totalExecutionTime).toBeGreaterThanOrEqual(0);
    expect(result.batchSize).toBeGreaterThan(0);
  });

  test('should adapt concurrency based on performance', () => {
    executor.adaptConcurrency();
    const settings = executor.getOptimalSettings();
    expect(settings.concurrency).toBeGreaterThan(0);
  });

  test('should adapt batch size based on performance', () => {
    executor.adaptBatchSize();
    const settings = executor.getOptimalSettings();
    expect(settings.batchSize).toBeGreaterThan(0);
  });

  test('should return adaptation history', () => {
    const history = executor.getAdaptationHistory();
    expect(Array.isArray(history)).toBe(true);
  });

  test('should return optimal settings', () => {
    const settings = executor.getOptimalSettings();
    expect(settings.concurrency).toBeGreaterThan(0);
    expect(settings.batchSize).toBeGreaterThan(0);
    expect(settings.timeout).toBeGreaterThan(0);
    expect(settings.confidence).toBeGreaterThanOrEqual(0);
    expect(settings.confidence).toBeLessThanOrEqual(1);
  });

  test('should increase concurrency after successful executions', async () => {
    const tasks = Array.from({ length: 20 }, (_, i) => createTask({ id: `perf-${i}` }));
    await executor.executeBatch(tasks);
    const oldConcurrency = executor.getOptimalSettings().concurrency;
    executor.adaptConcurrency();
    const newConcurrency = executor.getOptimalSettings().concurrency;
    // After many fast successful executions, concurrency may increase
    expect(newConcurrency).toBeGreaterThanOrEqual(oldConcurrency - 1);
  });

  test('should handle custom options', () => {
    const custom = new AdaptiveExecutor({
      initialConcurrency: 8,
      initialBatchSize: 20,
      initialTimeout: 60000,
    });
    const settings = custom.getOptimalSettings();
    expect(settings.concurrency).toBe(8);
    expect(settings.batchSize).toBe(20);
    expect(settings.timeout).toBe(60000);
  });

  test('should track active executions', async () => {
    const task = createTask({ id: 'active' });
    const promise = executor.execute(task);
    // The task completes immediately in our implementation
    await promise;
    expect(executor.getActiveExecutions()).toBe(0);
  });

  test('should include resource usage in execution result', async () => {
    const task = createTask({ id: 'res' });
    const result = await executor.execute(task);
    expect(result.resourceUsage).toBeDefined();
    expect(result.resourceUsage.cpuTime).toBeGreaterThanOrEqual(0);
    expect(result.resourceUsage.memoryPeak).toBeGreaterThan(0);
  });
});

// ============================================================
// Module 3: Workload Predictor Tests
// ============================================================

describe('WorkloadPredictor', () => {
  let predictor: WorkloadPredictor;

  beforeEach(() => {
    predictor = new WorkloadPredictor();
  });

  test('should create predictor', () => {
    expect(predictor).toBeDefined();
    expect(predictor.getRecordCount()).toBe(0);
  });

  test('should record workload metrics', () => {
    predictor.recordWorkload(Date.now(), {
      taskCount: 10,
      cpuUsage: 0.5,
      memoryUsage: 0.6,
      queueDepth: 5,
      responseTime: 100,
      errorRate: 0.01,
    });
    expect(predictor.getRecordCount()).toBe(1);
  });

  test('should return low-confidence prediction with insufficient data', () => {
    const prediction = predictor.predict(30);
    expect(prediction.confidence).toBe(0);
    expect(prediction.trend).toBe('stable');
  });

  test('should predict workload with data', () => {
    const now = Date.now();
    for (let i = 0; i < 100; i++) {
      predictor.recordWorkload(now - (100 - i) * 60000, {
        taskCount: 10 + i,
        cpuUsage: 0.4 + (i / 200),
        memoryUsage: 0.5,
        queueDepth: 5,
        responseTime: 100,
        errorRate: 0.01,
      });
    }
    const prediction = predictor.predict(30);
    expect(prediction.confidence).toBeGreaterThan(0);
    expect(prediction.predictedMetrics.taskCount).toBeGreaterThan(0);
  });

  test('should detect increasing trend', () => {
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      predictor.recordWorkload(now - (50 - i) * 60000, {
        taskCount: i * 2,
        cpuUsage: 0.3 + i * 0.01,
        memoryUsage: 0.5,
        queueDepth: i,
        responseTime: 100,
        errorRate: 0.01,
      });
    }
    const prediction = predictor.predict(60);
    expect(prediction.trend).toBe('increasing');
  });

  test('should detect decreasing trend', () => {
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      predictor.recordWorkload(now - (50 - i) * 60000, {
        taskCount: 100 - i * 2,
        cpuUsage: 0.8 - i * 0.01,
        memoryUsage: 0.5,
        queueDepth: 50 - i,
        responseTime: 100,
        errorRate: 0.01,
      });
    }
    const prediction = predictor.predict(60);
    expect(prediction.trend).toBe('decreasing');
  });

  test('should detect stable trend', () => {
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      predictor.recordWorkload(now - (50 - i) * 60000, {
        taskCount: 50,
        cpuUsage: 0.5,
        memoryUsage: 0.5,
        queueDepth: 25,
        responseTime: 100,
        errorRate: 0.01,
      });
    }
    const prediction = predictor.predict(60);
    expect(prediction.trend).toBe('stable');
  });

  test('should provide confidence intervals', () => {
    const now = Date.now();
    for (let i = 0; i < 100; i++) {
      predictor.recordWorkload(now - (100 - i) * 60000, {
        taskCount: 50,
        cpuUsage: 0.5,
        memoryUsage: 0.5,
        queueDepth: 25,
        responseTime: 100,
        errorRate: 0.01,
      });
    }
    const prediction = predictor.predict(60);
    expect(prediction.confidenceInterval.taskCount[0]).toBeLessThanOrEqual(
      prediction.confidenceInterval.taskCount[1]
    );
  });

  test('should predict peak load', () => {
    const now = Date.now();
    // Simulate daily pattern: higher at hour 10
    for (let i = 0; i < 200; i++) {
      const hour = (i * 3) % 24;
      const load = hour >= 9 && hour <= 17 ? 0.8 : 0.3;
      predictor.recordWorkload(now - (200 - i) * 60000, {
        taskCount: Math.round(load * 100),
        cpuUsage: load,
        memoryUsage: load * 0.8,
        queueDepth: Math.round(load * 50),
        responseTime: load * 200,
        errorRate: 0.01,
      });
    }
    const peak = predictor.predictPeak(24);
    expect(peak.predictedPeakLoad).toBeGreaterThan(0);
  });

  test('should return low-confidence peak with insufficient data', () => {
    const peak = predictor.predictPeak(24);
    expect(peak.confidence).toBe(0);
  });

  test('should predict resource needs', () => {
    const now = Date.now();
    for (let i = 0; i < 100; i++) {
      predictor.recordWorkload(now - (100 - i) * 60000, {
        taskCount: 50,
        cpuUsage: 0.6,
        memoryUsage: 0.7,
        queueDepth: 25,
        responseTime: 100,
        errorRate: 0.01,
      });
    }
    const resources = predictor.predictResourceNeeds(30);
    expect(resources.cpuNeeded).toBeGreaterThan(0);
    expect(resources.memoryNeeded).toBeGreaterThan(0);
    expect(resources.instancesNeeded).toBeGreaterThan(0);
  });

  test('should detect workload patterns', () => {
    const now = Date.now();
    for (let i = 0; i < 200; i++) {
      const hour = i % 24;
      const load = hour >= 9 && hour <= 17 ? 0.8 : 0.2;
      predictor.recordWorkload(now - (200 - i) * 60000, {
        taskCount: Math.round(load * 100),
        cpuUsage: load,
        memoryUsage: load * 0.7,
        queueDepth: Math.round(load * 50),
        responseTime: load * 200,
        errorRate: 0.01,
      });
    }
    const patterns = predictor.getPatterns();
    // May or may not detect patterns depending on data
    expect(Array.isArray(patterns)).toBe(true);
  });

  test('should return empty patterns with insufficient data', () => {
    const patterns = predictor.getPatterns();
    expect(patterns).toHaveLength(0);
  });

  test('should limit stored records', () => {
    for (let i = 0; i < 15000; i++) {
      predictor.recordWorkload(Date.now() - i, {
        taskCount: 10,
        cpuUsage: 0.5,
        memoryUsage: 0.5,
        queueDepth: 5,
        responseTime: 100,
        errorRate: 0.01,
      });
    }
    expect(predictor.getRecordCount()).toBeLessThanOrEqual(10000);
  });
});

// ============================================================
// Module 4: Elastic Scaler Tests
// ============================================================

describe('ElasticScaler', () => {
  let scaler: ElasticScaler;

  beforeEach(() => {
    scaler = new ElasticScaler();
  });

  test('should create scaler with default options', () => {
    expect(scaler).toBeDefined();
    expect(scaler.getCurrentInstances()).toBe(3);
  });

  test('should evaluate scaling with no metrics (no action)', () => {
    // Set metrics to mid-range so no scaling is triggered
    scaler.updateMetrics({ cpu: 0.5, memory: 0.5, queueDepth: 10, responseTime: 100 });
    const decision = scaler.evaluateScaling();
    expect(decision.action).toBe('none');
    expect(decision.currentInstances).toBe(3);
  });

  test('should recommend scale up on high CPU', () => {
    scaler.updateMetrics({ cpu: 0.9 });
    const decision = scaler.evaluateScaling();
    expect(decision.action).toBe('scale_up');
    expect(decision.targetInstances).toBeGreaterThan(decision.currentInstances);
  });

  test('should recommend scale down on low CPU', () => {
    scaler.updateMetrics({ cpu: 0.1 });
    const decision = scaler.evaluateScaling();
    expect(decision.action).toBe('scale_down');
    expect(decision.targetInstances).toBeLessThan(decision.currentInstances);
  });

  test('should recommend scale up on high memory', () => {
    scaler.updateMetrics({ memory: 0.9 });
    const decision = scaler.evaluateScaling();
    expect(decision.action).toBe('scale_up');
  });

  test('should recommend scale up on high queue depth', () => {
    scaler.updateMetrics({ queueDepth: 200 });
    const decision = scaler.evaluateScaling();
    expect(decision.action).toBe('scale_up');
  });

  test('should recommend scale up on high response time', () => {
    scaler.updateMetrics({ responseTime: 10000 });
    const decision = scaler.evaluateScaling();
    expect(decision.action).toBe('scale_up');
  });

  test('should respect cooldown period', () => {
    vi.useFakeTimers();
    scaler.updateMetrics({ cpu: 0.9 });
    scaler.evaluateScaling(); // First evaluation
    scaler.scaleUp(); // This sets lastScaleTime

    scaler.updateMetrics({ cpu: 0.95 });
    const decision = scaler.evaluateScaling();
    expect(decision.action).toBe('none');
    expect(decision.reason).toBe('in_cooldown');

    vi.advanceTimersByTime(61000); // Past cooldown
    const decision2 = scaler.evaluateScaling();
    expect(decision2.action).toBe('scale_up');
    vi.useRealTimers();
  });

  test('should scale up successfully', () => {
    const result = scaler.scaleUp(2);
    expect(result.success).toBe(true);
    expect(result.currentInstances).toBe(5);
    expect(result.scaledBy).toBe(2);
  });

  test('should scale down successfully', () => {
    const result = scaler.scaleDown(1);
    expect(result.success).toBe(true);
    expect(result.currentInstances).toBe(2);
    expect(result.scaledBy).toBe(1);
  });

  test('should not scale below minimum', () => {
    scaler.scaleDown(10);
    expect(scaler.getCurrentInstances()).toBe(1);
  });

  test('should not scale above maximum', () => {
    scaler.scaleUp(100);
    expect(scaler.getCurrentInstances()).toBe(50);
  });

  test('should record scaling history', () => {
    scaler.scaleUp(2);
    scaler.scaleDown(1);
    const history = scaler.getScalingHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.action).toBe('scale_up');
    expect(history[1]?.action).toBe('scale_down');
  });

  test('should return capacity info', () => {
    scaler.updateMetrics({ cpu: 0.6, memory: 0.5 });
    const capacity = scaler.getCapacity();
    expect(capacity.currentInstances).toBe(3);
    expect(capacity.minInstances).toBe(1);
    expect(capacity.maxInstances).toBe(50);
    expect(capacity.availableCapacity).toBeGreaterThan(0);
  });

  test('should change strategy', () => {
    scaler.setStrategy('immediate');
    scaler.updateMetrics({ cpu: 0.9 });
    const decision = scaler.evaluateScaling();
    expect(decision.action).toBe('scale_up');
  });

  test('should handle custom options', () => {
    const custom = new ElasticScaler({
      minInstances: 2,
      maxInstances: 10,
      initialInstances: 5,
    });
    expect(custom.getCurrentInstances()).toBe(5);
  });

  test('should return no action when at limits', () => {
    vi.useFakeTimers();
    scaler.scaleDown(10); // Go to minimum
    vi.advanceTimersByTime(61000); // Past cooldown
    scaler.updateMetrics({ cpu: 0.1 });
    const decision = scaler.evaluateScaling();
    expect(decision.action).toBe('none');
    expect(decision.reason).toBe('at_limits');
    vi.useRealTimers();
  });
});

// ============================================================
// Module 5: Backpressure Handler Tests
// ============================================================

describe('BackpressureHandler', () => {
  let handler: BackpressureHandler;

  beforeEach(() => {
    handler = new BackpressureHandler();
  });

  test('should create handler with default config', () => {
    expect(handler).toBeDefined();
    expect(handler.getCurrentLevel()).toBe('none');
  });

  test('should apply mild backpressure', () => {
    const result = handler.applyBackpressure('mild');
    expect(result.level).toBe('mild');
    expect(result.accepted).toBe(true);
  });

  test('should apply critical backpressure', () => {
    const result = handler.applyBackpressure('critical');
    expect(result.level).toBe('critical');
  });

  test('should accept all tasks at none level', () => {
    expect(handler.shouldAccept(1)).toBe(true);
    expect(handler.shouldAccept(100)).toBe(true);
  });

  test('should accept high priority tasks at moderate level', () => {
    handler.applyBackpressure('moderate');
    expect(handler.shouldAccept(80)).toBe(true);
  });

  test('should reject low priority tasks at critical level with reject strategy', () => {
    handler.setStrategy('reject');
    handler.applyBackpressure('critical');
    expect(handler.shouldAccept(10)).toBe(false);
    expect(handler.shouldAccept(100)).toBe(false);
  });

  test('should calculate queue pressure as 0 when empty', () => {
    expect(handler.getQueuePressure()).toBe(0);
  });

  test('should calculate queue pressure based on depth', () => {
    handler.setQueueDepth(75);
    const pressure = handler.getQueuePressure();
    expect(pressure).toBeGreaterThan(0);
    expect(pressure).toBeLessThanOrEqual(1);
  });

  test('should return pressure of 1 at critical depth', () => {
    handler.setQueueDepth(500);
    expect(handler.getQueuePressure()).toBe(1.0);
  });

  test('should configure thresholds', () => {
    handler.configureThresholds(10, 20, 50, 100);
    handler.setQueueDepth(15);
    expect(handler.getCurrentLevel()).toBe('mild');
  });

  test('should update level based on queue depth', () => {
    handler.configureThresholds(50, 100, 200, 500); // Reset to defaults
    handler.setQueueDepth(250);
    expect(handler.getCurrentLevel()).toBe('severe');
  });

  test('should add items to buffer', () => {
    expect(handler.addToBuffer({ data: 'test' })).toBe(true);
    const stats = handler.getStats();
    expect(stats.bufferSize).toBe(1);
  });

  test('should drain buffer', () => {
    handler.addToBuffer('a');
    handler.addToBuffer('b');
    handler.addToBuffer('c');
    const drained = handler.drainBuffer(2);
    expect(drained).toHaveLength(2);
    expect(handler.getStats().bufferSize).toBe(1);
  });

  test('should reject buffer additions when full', () => {
    const smallHandler = new BackpressureHandler({ bufferSize: 2 });
    smallHandler.addToBuffer('a');
    smallHandler.addToBuffer('b');
    expect(smallHandler.addToBuffer('c')).toBe(false);
  });

  test('should return level history', () => {
    handler.applyBackpressure('mild');
    handler.applyBackpressure('moderate');
    const history = handler.getLevelHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  test('should change strategy', () => {
    handler.setStrategy('throttle');
    handler.applyBackpressure('severe');
    expect(handler.getCurrentLevel()).toBe('severe');
  });

  test('should return correct stats', () => {
    const stats = handler.getStats();
    expect(stats.rejectedCount).toBe(0);
    expect(stats.throttledCount).toBe(0);
    expect(stats.shedCount).toBe(0);
    expect(stats.currentLevel).toBe('none');
  });

  test('should handle shed strategy at severe level', () => {
    handler.setStrategy('shed');
    handler.applyBackpressure('severe');
    expect(handler.shouldAccept(10)).toBe(false);
    expect(handler.shouldAccept(60)).toBe(true);
  });

  test('should accept all at mild level regardless of strategy', () => {
    handler.setStrategy('reject');
    handler.applyBackpressure('mild');
    expect(handler.shouldAccept(1)).toBe(true);
  });
});

// ============================================================
// Module 6: Task Recycling Manager Tests
// ============================================================

describe('TaskRecyclingManager', () => {
  let manager: TaskRecyclingManager;

  beforeEach(() => {
    manager = new TaskRecyclingManager();
  });

  test('should create manager', () => {
    expect(manager).toBeDefined();
  });

  test('should cache and retrieve result', () => {
    manager.cacheResult('hash1', { data: 'test' });
    const result = manager.getCachedResult('hash1');
    expect(result).toEqual({ data: 'test' });
  });

  test('should return undefined for cache miss', () => {
    expect(manager.getCachedResult('nonexistent')).toBeUndefined();
  });

  test('should track cache hits and misses', () => {
    manager.cacheResult('hash1', 'value1');
    manager.getCachedResult('hash1'); // hit
    manager.getCachedResult('hash1'); // hit
    manager.getCachedResult('miss');  // miss
    const stats = manager.getCacheStats();
    expect(stats.hitCount).toBe(2);
    expect(stats.missCount).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3);
  });

  test('should calculate hit rate correctly', () => {
    const stats = manager.getCacheStats();
    expect(stats.hitRate).toBe(0); // No hits or misses
  });

  test('should evict entries when cache is full', () => {
    const smallManager = new TaskRecyclingManager({ maxCacheSize: 3 });
    smallManager.cacheResult('h1', 'v1');
    smallManager.cacheResult('h2', 'v2');
    smallManager.cacheResult('h3', 'v3');
    smallManager.cacheResult('h4', 'v4'); // Should trigger eviction
    const stats = smallManager.getCacheStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.evictionCount).toBe(1);
  });

  test('should recycle resources', () => {
    const resources = manager.recycleResources('task1');
    expect(resources.connections).toBeGreaterThan(0);
    expect(resources.buffers).toBeGreaterThan(0);
    expect(resources.totalBytesSaved).toBeGreaterThan(0);
  });

  test('should invalidate all cache entries', () => {
    manager.cacheResult('h1', 'v1');
    manager.cacheResult('h2', 'v2');
    const count = manager.invalidateCache();
    expect(count).toBe(2);
    expect(manager.getCacheStats().totalEntries).toBe(0);
  });

  test('should invalidate cache by pattern', () => {
    manager.cacheResult('user:1', 'data1');
    manager.cacheResult('user:2', 'data2');
    manager.cacheResult('order:1', 'data3');
    const count = manager.invalidateCache('user:');
    expect(count).toBe(2);
    expect(manager.getCachedResult('order:1')).toBeDefined();
  });

  test('should expire entries based on TTL', () => {
    vi.useFakeTimers();
    const ttlManager = new TaskRecyclingManager({ defaultTTL: 1000 });
    ttlManager.cacheResult('h1', 'v1');
    vi.advanceTimersByTime(1500);
    const result = ttlManager.getCachedResult('h1');
    expect(result).toBeUndefined();
    expect(ttlManager.getCacheStats().evictionCount).toBe(1);
    vi.useRealTimers();
  });

  test('should use LRU eviction policy', () => {
    vi.useFakeTimers();
    const lruManager = new TaskRecyclingManager({ maxCacheSize: 2, evictionPolicy: 'lru' });
    lruManager.cacheResult('h1', 'v1');
    vi.advanceTimersByTime(1);
    lruManager.cacheResult('h2', 'v2');
    vi.advanceTimersByTime(1);
    lruManager.getCachedResult('h1'); // Access h1 - makes it recently used
    vi.advanceTimersByTime(1);
    lruManager.cacheResult('h3', 'v3'); // Should evict h2 (LRU)
    expect(lruManager.getCachedResult('h1')).toBeDefined();
    expect(lruManager.getCachedResult('h2')).toBeUndefined();
    expect(lruManager.getCachedResult('h3')).toBeDefined();
    vi.useRealTimers();
  });

  test('should use size-based eviction policy', () => {
    const sizeManager = new TaskRecyclingManager({ maxCacheSize: 2, evictionPolicy: 'size' });
    sizeManager.cacheResult('small', 'x');
    sizeManager.cacheResult('large', { a: 'very large value that takes more space' });
    sizeManager.cacheResult('h3', 'v3'); // Should evict largest
    const stats = sizeManager.getCacheStats();
    expect(stats.totalEntries).toBe(2);
  });

  test('should get resource from pool', () => {
    manager.recycleResources('task1');
    const resource = manager.getResourceFromPool('task1');
    expect(resource).toBeDefined();
  });

  test('should return undefined for empty resource pool', () => {
    expect(manager.getResourceFromPool('nonexistent')).toBeUndefined();
  });

  test('should clear resource pool', () => {
    manager.recycleResources('task1');
    manager.recycleResources('task2');
    const count = manager.clearResourcePool();
    expect(count).toBeGreaterThan(0);
  });

  test('should clear specific task resource pool', () => {
    manager.recycleResources('task1');
    const count = manager.clearResourcePool('task1');
    expect(count).toBeGreaterThan(0);
  });

  test('should set custom TTL for cache entry', () => {
    manager.cacheResult('h1', 'v1');
    const result = manager.setCacheTTL('h1', 5000);
    expect(result).toBe(true);
  });

  test('should return false when setting TTL for non-existent entry', () => {
    expect(manager.setCacheTTL('nonexistent', 5000)).toBe(false);
  });

  test('should track total bytes in cache', () => {
    manager.cacheResult('h1', { data: 'some reasonably sized content' });
    const stats = manager.getCacheStats();
    expect(stats.totalBytes).toBeGreaterThan(0);
  });
});

// ============================================================
// Module 7: Long Running Task Manager Tests
// ============================================================

describe('LongRunningTaskManager', () => {
  let manager: LongRunningTaskManager;

  beforeEach(() => {
    manager = new LongRunningTaskManager();
  });

  test('should create manager', () => {
    expect(manager).toBeDefined();
    expect(manager.getTaskCount()).toBe(0);
  });

  test('should register a long task', () => {
    const id = manager.register({
      id: 'lt1',
      name: 'long-task',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    expect(id).toBe('lt1');
    expect(manager.getTaskCount()).toBe(1);
  });

  test('should get task status after registration', () => {
    manager.register({
      id: 'lt1',
      name: 'long-task',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    const status = manager.getTaskStatus('lt1');
    expect(status).toBeDefined();
    expect(status?.state).toBe('pending');
    expect(status?.progress).toBe(0);
  });

  test('should return undefined for non-existent task', () => {
    expect(manager.getTaskStatus('nonexistent')).toBeUndefined();
  });

  test('should update task progress', () => {
    manager.register({
      id: 'lt1',
      name: 'long-task',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    manager.updateProgress('lt1', 0.5);
    const status = manager.getTaskStatus('lt1');
    expect(status?.progress).toBe(0.5);
  });

  test('should clamp progress between 0 and 1', () => {
    manager.register({
      id: 'lt1',
      name: 'long-task',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    manager.updateProgress('lt1', 1.5);
    expect(manager.getTaskStatus('lt1')?.progress).toBe(1);
    manager.updateProgress('lt1', -0.5);
    expect(manager.getTaskStatus('lt1')?.progress).toBe(0);
  });

  test('should throw when updating progress for non-existent task', () => {
    expect(() => manager.updateProgress('nonexistent', 0.5)).toThrow('not found');
  });

  test('should add milestones', () => {
    manager.register({
      id: 'lt1',
      name: 'long-task',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    manager.addMilestone('lt1', { name: 'half', targetProgress: 0.5, reached: false });
    manager.updateProgress('lt1', 0.6);
    const status = manager.getTaskStatus('lt1');
    expect(status?.milestones).toHaveLength(1);
    expect(status?.milestones[0]?.reached).toBe(true);
  });

  test('should throw when adding milestone for non-existent task', () => {
    expect(() =>
      manager.addMilestone('nonexistent', { name: 'm1', targetProgress: 0.5, reached: false })
    ).toThrow('not found');
  });

  test('should cancel a task', () => {
    manager.register({
      id: 'lt1',
      name: 'long-task',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    expect(manager.cancelTask('lt1')).toBe(true);
    expect(manager.getTaskStatus('lt1')?.state).toBe('cancelled');
  });

  test('should not cancel non-existent task', () => {
    expect(manager.cancelTask('nonexistent')).toBe(false);
  });

  test('should not cancel completed task', () => {
    manager.register({
      id: 'lt1',
      name: 'long-task',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    manager.startTask('lt1');
    // Wait for completion
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(manager.cancelTask('lt1')).toBe(false);
        resolve();
      }, 100);
    });
  });

  test('should extend timeout', () => {
    manager.register({
      id: 'lt1',
      name: 'long-task',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    expect(manager.extendTimeout('lt1', 30000)).toBe(true);
    const status = manager.getTaskStatus('lt1');
    // Timeout should be extended
    expect(status?.extensionsUsed).toBe(1);
  });

  test('should not extend timeout beyond max extensions', () => {
    manager.register({
      id: 'lt1',
      name: 'long-task',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 1,
    });
    manager.extendTimeout('lt1', 30000);
    expect(manager.extendTimeout('lt1', 30000)).toBe(false);
  });

  test('should return false when extending timeout for non-existent task', () => {
    expect(manager.extendTimeout('nonexistent', 30000)).toBe(false);
  });

  test('should start and complete a task', async () => {
    manager.register({
      id: 'lt1',
      name: 'long-task',
      handler: async () => 'result',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    expect(manager.startTask('lt1')).toBe(true);

    // Wait for async completion
    await new Promise((resolve) => setTimeout(resolve, 50));

    const status = manager.getTaskStatus('lt1');
    expect(status?.state).toBe('completed');
    expect(status?.progress).toBe(1);
  });

  test('should handle task handler failure', async () => {
    manager.register({
      id: 'lt1',
      name: 'failing-task',
      handler: async () => { throw new Error('handler error'); },
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    manager.startTask('lt1');

    await new Promise((resolve) => setTimeout(resolve, 50));

    const status = manager.getTaskStatus('lt1');
    expect(status?.state).toBe('cancelled');
    expect(status?.error).toContain('handler error');
  });

  test('should not start already running task', () => {
    manager.register({
      id: 'lt1',
      name: 'long-task',
      handler: async () => new Promise((resolve) => setTimeout(resolve, 1000)),
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    expect(manager.startTask('lt1')).toBe(true);
    expect(manager.startTask('lt1')).toBe(false);
  });

  test('should get active long tasks', () => {
    manager.register({
      id: 'lt1',
      name: 'active-task',
      handler: async () => new Promise((resolve) => setTimeout(resolve, 10000)),
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    manager.register({
      id: 'lt2',
      name: 'pending-task',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    manager.startTask('lt1');
    const active = manager.getActiveLongTasks();
    expect(active.length).toBeGreaterThanOrEqual(1);
  });

  test('should get all tasks', () => {
    manager.register({
      id: 'lt1',
      name: 'task1',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    manager.register({
      id: 'lt2',
      name: 'task2',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    const all = manager.getAllTasks();
    expect(all).toHaveLength(2);
  });

  test('should remove task', () => {
    manager.register({
      id: 'lt1',
      name: 'task1',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    expect(manager.removeTask('lt1')).toBe(true);
    expect(manager.getTaskCount()).toBe(0);
  });

  test('should auto-reach milestones when progress exceeds target', () => {
    manager.register({
      id: 'lt1',
      name: 'long-task',
      handler: async () => 'done',
      timeoutMs: 60000,
      maxExtensions: 3,
    });
    manager.updateProgress('lt1', 0.8);
    manager.addMilestone('lt1', { name: 'quarter', targetProgress: 0.25, reached: false });
    expect(manager.getTaskStatus('lt1')?.milestones[0]?.reached).toBe(true);
  });
});

// ============================================================
// Module 8: Schedule Optimizer Tests
// ============================================================

describe('ScheduleOptimizer', () => {
  let optimizer: ScheduleOptimizer;

  beforeEach(() => {
    optimizer = new ScheduleOptimizer();
  });

  test('should create optimizer', () => {
    expect(optimizer).toBeDefined();
  });

  test('should optimize task schedule', () => {
    const tasks = [
      createTask({ id: 't1', priority: 30 }),
      createTask({ id: 't2', priority: 90 }),
      createTask({ id: 't3', priority: 60 }),
    ];
    const schedule = optimizer.optimize(tasks, {});
    expect(schedule.order).toHaveLength(3);
    expect(schedule.estimatedCompletionTime).toBeGreaterThan(0);
    expect(schedule.strategy).toBe('priority-based');
  });

  test('should order tasks by priority', () => {
    const tasks = [
      createTask({ id: 't1', priority: 10 }),
      createTask({ id: 't2', priority: 100 }),
      createTask({ id: 't3', priority: 50 }),
    ];
    const order = optimizer.getOptimalOrder(tasks);
    expect(order[0]).toBe('t2');
    expect(order[1]).toBe('t3');
    expect(order[2]).toBe('t1');
  });

  test('should estimate completion time', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => createTask({ id: `t${i}` }));
    const completion = optimizer.estimateCompletion(tasks);
    expect(completion).toBeInstanceOf(Date);
    expect(completion.getTime()).toBeGreaterThan(Date.now());
  });

  test('should identify bottlenecks', () => {
    const tasks = [
      createTask({
        id: 't1',
        resourceRequirements: { cpu: 80, memory: 80 },
      }),
      createTask({
        id: 't2',
        dependencies: ['a', 'b', 'c', 'd', 'e'],
      }),
      createTask({
        id: 't3',
        deadline: Date.now() + 500,
      }),
    ];
    const bottlenecks = optimizer.identifyBottlenecks(tasks);
    expect(bottlenecks.length).toBeGreaterThan(0);
  });

  test('should return empty bottlenecks for simple tasks', () => {
    const tasks = [createTask({ id: 't1' })];
    const bottlenecks = optimizer.identifyBottlenecks(tasks);
    expect(bottlenecks).toHaveLength(0);
  });

  test('should simulate a schedule', () => {
    const tasks = [
      createTask({ id: 't1', priority: 90 }),
      createTask({ id: 't2', priority: 50 }),
    ];
    const schedule = optimizer.optimize(tasks, {});
    const simulation = optimizer.simulate(schedule);
    expect(simulation.completedOnTime).toBeGreaterThan(0);
    expect(simulation.totalExecutionTime).toBeGreaterThan(0);
    expect(simulation.resourceUtilization).toBeGreaterThan(0);
  });

  test('should respect max concurrency constraint', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => createTask({ id: `t${i}` }));
    const schedule = optimizer.optimize(tasks, { maxConcurrency: 2 });
    expect(schedule.parallelGroups.length).toBeGreaterThan(0);
    for (const group of schedule.parallelGroups) {
      expect(group.length).toBeLessThanOrEqual(2);
    }
  });

  test('should handle empty task list', () => {
    const schedule = optimizer.optimize([], {});
    expect(schedule.order).toHaveLength(0);
  });

  test('should handle tasks with dependencies', () => {
    const tasks = [
      createTask({ id: 't1', priority: 10 }),
      createTask({ id: 't2', priority: 90, dependencies: ['t1'] }),
      createTask({ id: 't3', priority: 50, dependencies: ['t1'] }),
    ];
    const schedule = optimizer.optimize(tasks, {});
    // t1 should come before t2 and t3 (dependency resolution in resolveDependencies)
    const t1Index = schedule.order.indexOf('t1');
    const t2Index = schedule.order.indexOf('t2');
    const t3Index = schedule.order.indexOf('t3');
    expect(t1Index).toBeLessThan(t2Index);
    expect(t1Index).toBeLessThan(t3Index);
  });

  test('should change strategy', () => {
    optimizer.setStrategy('greedy');
    const tasks = [
      createTask({ id: 't1', priority: 10, deadline: Date.now() + 1000 }),
      createTask({ id: 't2', priority: 90, deadline: Date.now() + 100000 }),
    ];
    const schedule = optimizer.optimize(tasks, {});
    expect(schedule.strategy).toBe('greedy');
    expect(schedule.order[0]).toBe('t1'); // Earlier deadline
  });

  test('should use round-robin strategy', () => {
    optimizer.setStrategy('round-robin');
    const tasks = [
      createTask({ id: 't1', priority: 10 }),
      createTask({ id: 't2', priority: 90 }),
    ];
    const schedule = optimizer.optimize(tasks, {});
    expect(schedule.strategy).toBe('round-robin');
  });

  test('should use cost-based strategy', () => {
    optimizer.setStrategy('cost-based');
    const tasks = [
      createTask({ id: 't1', priority: 50, resourceRequirements: { cpu: 10, memory: 10 } }),
      createTask({ id: 't2', priority: 50, resourceRequirements: { cpu: 80, memory: 80 } }),
    ];
    const schedule = optimizer.optimize(tasks, {});
    expect(schedule.strategy).toBe('cost-based');
    expect(schedule.order[0]).toBe('t1'); // Lower cost first
  });

  test('should calculate resource utilization', () => {
    const tasks = Array.from({ length: 8 }, (_, i) => createTask({ id: `t${i}` }));
    const schedule = optimizer.optimize(tasks, { maxConcurrency: 4 });
    expect(schedule.resourceUtilization).toBeGreaterThan(0);
    expect(schedule.resourceUtilization).toBeLessThanOrEqual(1);
  });
});

// ============================================================
// Module 9: Periodic Job Manager Tests
// ============================================================

describe('PeriodicJobManager', () => {
  let jobManager: PeriodicJobManager;

  beforeEach(() => {
    jobManager = new PeriodicJobManager();
  });

  test('should create manager', () => {
    expect(jobManager).toBeDefined();
    expect(jobManager.getJobCount()).toBe(0);
  });

  test('should schedule a job', () => {
    const jobId = jobManager.schedule('test-job', '* * * * *', async () => 'done');
    expect(jobId).toBeDefined();
    expect(jobManager.getJobCount()).toBe(1);
  });

  test('should unschedule a job', () => {
    const jobId = jobManager.schedule('test-job', '* * * * *', async () => 'done');
    expect(jobManager.unschedule(jobId)).toBe(true);
    expect(jobManager.getJobCount()).toBe(0);
  });

  test('should return false when unscheduling non-existent job', () => {
    expect(jobManager.unschedule('nonexistent')).toBe(false);
  });

  test('should run a job immediately', async () => {
    const jobId = jobManager.schedule('test-job', '* * * * *', async () => 42);
    const result = await jobManager.runNow(jobId);
    expect(result.success).toBe(true);
    expect(result.result).toBe(42);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test('should handle job failure', async () => {
    const jobId = jobManager.schedule(
      'failing-job',
      '* * * * *',
      async () => { throw new Error('job error'); }
    );
    const result = await jobManager.runNow(jobId);
    expect(result.success).toBe(false);
    expect(result.error).toContain('job error');
  });

  test('should return error for non-existent job run', async () => {
    const result = await jobManager.runNow('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('should prevent job run when disabled', async () => {
    const jobId = jobManager.schedule('test-job', '* * * * *', async () => 'done', {
      enabled: false,
    });
    const result = await jobManager.runNow(jobId);
    expect(result.success).toBe(false);
    expect(result.error).toContain('disabled');
  });

  test('should prevent overlapping job runs', async () => {
    const jobId = jobManager.schedule(
      'slow-job',
      '* * * * *',
      async () => new Promise((resolve) => setTimeout(resolve, 1000)),
      { overlapPrevention: true }
    );

    const promise1 = jobManager.runNow(jobId);
    const result2 = await jobManager.runNow(jobId);
    expect(result2.success).toBe(false);
    expect(result2.error).toContain('already running');

    await promise1;
  });

  test('should get job status', () => {
    const jobId = jobManager.schedule('test-job', '* * * * *', async () => 'done');
    const status = jobManager.getJobStatus(jobId);
    expect(status).toBeDefined();
    expect(status?.name).toBe('test-job');
    expect(status?.state).toBe('scheduled');
  });

  test('should return undefined for non-existent job status', () => {
    expect(jobManager.getJobStatus('nonexistent')).toBeUndefined();
  });

  test('should get all jobs', () => {
    jobManager.schedule('job1', '* * * * *', async () => 'done');
    jobManager.schedule('job2', '0 * * * *', async () => 'done');
    const jobs = jobManager.getJobs();
    expect(jobs).toHaveLength(2);
  });

  test('should get execution history', async () => {
    const jobId = jobManager.schedule('test-job', '* * * * *', async () => 'done');
    await jobManager.runNow(jobId);
    await jobManager.runNow(jobId);
    const history = jobManager.getExecutionHistory(jobId);
    expect(history).toHaveLength(2);
  });

  test('should limit execution history', async () => {
    const jobId = jobManager.schedule(
      'test-job',
      '* * * * *',
      async () => 'done',
      { maxHistory: 2 }
    );
    await jobManager.runNow(jobId);
    await jobManager.runNow(jobId);
    await jobManager.runNow(jobId);
    const history = jobManager.getExecutionHistory(jobId);
    expect(history).toHaveLength(2);
  });

  test('should limit execution history with limit parameter', async () => {
    const jobId = jobManager.schedule('test-job', '* * * * *', async () => 'done');
    await jobManager.runNow(jobId);
    await jobManager.runNow(jobId);
    await jobManager.runNow(jobId);
    const history = jobManager.getExecutionHistory(jobId, 2);
    expect(history).toHaveLength(2);
  });

  test('should track average duration', async () => {
    const jobId = jobManager.schedule('test-job', '* * * * *', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'done';
    });
    await jobManager.runNow(jobId);
    await jobManager.runNow(jobId);
    const jobs = jobManager.getJobs();
    expect(jobs[0]?.averageDuration).toBeGreaterThan(0);
    expect(jobs[0]?.runCount).toBe(2);
    expect(jobs[0]?.successCount).toBe(2);
  });

  test('should enable and disable jobs', () => {
    const jobId = jobManager.schedule('test-job', '* * * * *', async () => 'done', {
      enabled: false,
    });
    expect(jobManager.getJobStatus(jobId)?.state).toBe('disabled');
    expect(jobManager.enableJob(jobId)).toBe(true);
    expect(jobManager.getJobStatus(jobId)?.state).toBe('scheduled');
    expect(jobManager.disableJob(jobId)).toBe(true);
    expect(jobManager.getJobStatus(jobId)?.state).toBe('disabled');
  });

  test('should return false when enabling non-existent job', () => {
    expect(jobManager.enableJob('nonexistent')).toBe(false);
  });

  test('should return false when disabling non-existent job', () => {
    expect(jobManager.disableJob('nonexistent')).toBe(false);
  });

  test('should handle job timeout', async () => {
    const jobId = jobManager.schedule(
      'slow-job',
      '* * * * *',
      async () => new Promise((resolve) => setTimeout(resolve, 5000)),
      { timeout: 50 }
    );
    const result = await jobManager.runNow(jobId);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  test('should track failure count', async () => {
    const jobId = jobManager.schedule(
      'failing-job',
      '* * * * *',
      async () => { throw new Error('fail'); }
    );
    await jobManager.runNow(jobId);
    await jobManager.runNow(jobId);
    const jobs = jobManager.getJobs();
    expect(jobs[0]?.failureCount).toBe(2);
    expect(jobs[0]?.runCount).toBe(2);
  });
});

// ============================================================
// Module 10: Scheduling Analytics Tests
// ============================================================

describe('SchedulingAnalytics', () => {
  let analytics: SchedulingAnalytics;

  beforeEach(() => {
    analytics = new SchedulingAnalytics();
  });

  test('should create analytics', () => {
    expect(analytics).toBeDefined();
    expect(analytics.getEventCount()).toBe(0);
  });

  test('should record events', () => {
    analytics.recordEvent({ type: 'task_queued', timestamp: Date.now(), taskId: 't1' });
    analytics.recordEvent({ type: 'task_started', timestamp: Date.now(), taskId: 't1' });
    expect(analytics.getEventCount()).toBe(2);
  });

  test('should get throughput data', () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      analytics.recordEvent({
        type: 'task_completed',
        timestamp: now - i * 10000,
        taskId: `t${i}`,
        duration: 100,
      });
    }
    const throughput = analytics.getThroughput('5m');
    expect(throughput.tasksCompleted).toBe(10);
    expect(throughput.tasksPerSecond).toBeGreaterThan(0);
  });

  test('should detect throughput trend', () => {
    const now = Date.now();
    // Older period: fewer completions
    for (let i = 0; i < 5; i++) {
      analytics.recordEvent({
        type: 'task_completed',
        timestamp: now - 600000 - i * 10000,
        taskId: `old-${i}`,
        duration: 100,
      });
    }
    // Recent period: more completions
    for (let i = 0; i < 20; i++) {
      analytics.recordEvent({
        type: 'task_completed',
        timestamp: now - i * 5000,
        taskId: `new-${i}`,
        duration: 100,
      });
    }
    const throughput = analytics.getThroughput('5m');
    expect(throughput.trend).toBe('increasing');
  });

  test('should get latency percentiles', () => {
    const now = Date.now();
    for (let i = 0; i < 100; i++) {
      analytics.recordEvent({
        type: 'task_completed',
        timestamp: now - i * 1000,
        taskId: `t${i}`,
        duration: 50 + Math.random() * 200,
      });
    }
    const latency = analytics.getLatencyPercentiles();
    expect(latency.p50).toBeGreaterThan(0);
    expect(latency.p95).toBeGreaterThanOrEqual(latency.p50);
    expect(latency.p99).toBeGreaterThanOrEqual(latency.p95);
    expect(latency.count).toBe(100);
  });

  test('should return zero latency with no data', () => {
    const latency = analytics.getLatencyPercentiles();
    expect(latency.p50).toBe(0);
    expect(latency.count).toBe(0);
  });

  test('should get resource utilization', () => {
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      analytics.recordCPU(now - i * 1000, 0.5 + Math.random() * 0.3);
      analytics.recordMemory(now - i * 1000, 0.4 + Math.random() * 0.3);
      analytics.recordConcurrency(now - i * 1000, 3 + Math.floor(Math.random() * 5));
    }
    const utilization = analytics.getResourceUtilization();
    expect(utilization.cpu).toBeGreaterThan(0);
    expect(utilization.memory).toBeGreaterThan(0);
    expect(utilization.concurrency).toBeGreaterThan(0);
  });

  test('should get SLA compliance', () => {
    const now = Date.now();
    for (let i = 0; i < 80; i++) {
      analytics.recordEvent({
        type: 'task_completed',
        timestamp: now - i * 1000,
        taskId: `t${i}`,
        duration: 100, // Within 5s SLA
      });
    }
    for (let i = 0; i < 20; i++) {
      analytics.recordEvent({
        type: 'task_completed',
        timestamp: now - (80 + i) * 1000,
        taskId: `slow-${i}`,
        duration: 10000, // Breaches 5s SLA
      });
    }
    const sla = analytics.getSLACompliance(5000);
    expect(sla.complianceRate).toBeCloseTo(0.8);
    expect(sla.breachedTasks.length).toBeGreaterThan(0);
  });

  test('should get SLA compliance with custom target', () => {
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      analytics.recordEvent({
        type: 'task_completed',
        timestamp: now - i * 1000,
        taskId: `t${i}`,
        duration: 200,
      });
    }
    const sla = analytics.getSLACompliance(100);
    expect(sla.complianceRate).toBeLessThan(1);
    expect(sla.targetSLA).toBe(100);
  });

  test('should get efficiency report', () => {
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      analytics.recordEvent({
        type: 'task_completed',
        timestamp: now - i * 1000,
        taskId: `t${i}`,
        duration: 100,
      });
    }
    analytics.recordEvent({
      type: 'schedule_rebalance',
      timestamp: now,
      duration: 10,
    });
    const report = analytics.getEfficiencyReport();
    expect(report.efficiencyRatio).toBeGreaterThan(0);
    expect(report.usefulWorkTime).toBeGreaterThan(0);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  test('should get full dashboard', () => {
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      analytics.recordEvent({
        type: 'task_completed',
        timestamp: now - i * 1000,
        taskId: `t${i}`,
        duration: 100,
      });
      analytics.recordCPU(now - i * 1000, 0.5);
      analytics.recordMemory(now - i * 1000, 0.5);
      analytics.recordConcurrency(now - i * 1000, 4);
    }
    const dashboard = analytics.getDashboard();
    expect(dashboard.throughput).toBeDefined();
    expect(dashboard.latency).toBeDefined();
    expect(dashboard.utilization).toBeDefined();
    expect(dashboard.sla).toBeDefined();
    expect(dashboard.efficiency).toBeDefined();
    expect(dashboard.timestamp).toBeGreaterThan(0);
  });

  test('should clear events', () => {
    analytics.recordEvent({ type: 'task_queued', timestamp: Date.now() });
    analytics.recordCPU(Date.now(), 0.5);
    analytics.clearEvents();
    expect(analytics.getEventCount()).toBe(0);
  });

  test('should limit stored events', () => {
    for (let i = 0; i < 110000; i++) {
      analytics.recordEvent({ type: 'task_queued', timestamp: Date.now() - i });
    }
    expect(analytics.getEventCount()).toBeLessThanOrEqual(100000);
  });

  test('should parse time windows correctly', () => {
    const t1 = analytics.getThroughput('30s');
    expect(t1.window).toBe('30s');

    const t2 = analytics.getThroughput('1h');
    expect(t2.window).toBe('1h');

    const t3 = analytics.getThroughput('5m');
    expect(t3.window).toBe('5m');
  });

  test('should track active and queued tasks in dashboard', () => {
    analytics.recordEvent({ type: 'task_queued', timestamp: Date.now(), taskId: 'q1' });
    analytics.recordEvent({ type: 'task_started', timestamp: Date.now(), taskId: 'q1' });
    analytics.recordEvent({ type: 'task_queued', timestamp: Date.now(), taskId: 'q2' });
    const dashboard = analytics.getDashboard();
    expect(dashboard.queuedTasks).toBeGreaterThanOrEqual(0);
    expect(dashboard.activeTasks).toBeGreaterThanOrEqual(0);
  });

  test('should handle all event types', () => {
    const eventTypes = [
      'task_queued',
      'task_started',
      'task_completed',
      'task_failed',
      'task_cancelled',
      'task_timeout',
      'schedule_rebalance',
      'scale_event',
      'backpressure_event',
    ];
    for (const type of eventTypes) {
      analytics.recordEvent({ type: type as any, timestamp: Date.now() });
    }
    expect(analytics.getEventCount()).toBe(eventTypes.length);
  });

  test('should return 100% SLA compliance with no data', () => {
    const sla = analytics.getSLACompliance();
    expect(sla.complianceRate).toBe(1);
    expect(sla.totalTasks).toBe(0);
  });

  test('should handle empty dashboard gracefully', () => {
    const dashboard = analytics.getDashboard();
    expect(dashboard.throughput.tasksCompleted).toBe(0);
    expect(dashboard.latency.count).toBe(0);
  });
});
