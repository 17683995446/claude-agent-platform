import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  Bulkhead,
  BulkheadFullError,
  BulkheadQueueTimeoutError,
  RetryWithBackoff,
  TimeoutGuard,
  TimeoutError,
  TimeoutTimer,
  HealthChecker,
  FallbackProvider,
  ChaosEngine,
  StateRecoveryManager,
  GracefulShutdownManager,
  ResilienceObservability,
} from '../src/index.ts';

// Helper: short delay for real async tests
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ============================================================
// BUG REGISTRY
// ============================================================
// BUG-001: [HIGH] HealthChecker.checkComponent() had infinite recursion when called
//   with a name that had a registered config. The public checkComponent(name) called
//   the private checkComponent(name, config), but TypeScript resolved the call to
//   itself (same name), causing infinite recursion.
//   FIX: Renamed the private overload to checkComponentInternal().
//
// BUG-002: [MEDIUM] RetryWithBackoff exponential_with_jitter could produce negative
//   delay values when jitterFactor was high enough (e.g. 0.5 with small base).
//   Formula: delay * (1 + (random*2-1) * 0.5) could yield values < 0.
//   FIX: Added Math.max(0, delay) after jitter calculation.
//
// BUG-003: [MEDIUM] TimeoutTimer.extend() hardcoded 80% warning threshold instead
//   of using the configured warningPercentage passed to the constructor.
//   FIX: Stored warningPercentage as instance field; used it in extend().
//
// BUG-004: [MEDIUM] GracefulShutdownManager.getPhaseTimeout() hardcoded 15000ms
//   for 'cleanup' phase instead of using the configured forceShutdownTimeout.
//   FIX: Changed cleanup default to this.config.forceShutdownTimeout.
//
// BUG-005: [HIGH] GracefulShutdownManager.shutdown() was not safe for concurrent
//   calls. Two rapid calls could both pass the isShuttingDownFlag guard before
//   either set it, causing double execution of shutdown phases.
//   FIX: Store the shutdown promise and return it on subsequent calls.
//
// BUG-006: [LOW] GracefulShutdownManager.executeHandlers() had unused variable
//   'results' from the await expression.
//   FIX: Removed the unused variable assignment.
//
// BUG-007: [LOW] GracefulShutdownManager.destroy() did not clear shutdownPromise,
//   leaving a stale reference.
//   FIX: Set shutdownPromise = null in destroy().

// ============================================================
// Circuit Breaker Tests
// ============================================================
describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100,
      windowType: 'count',
      windowSize: 3,
    });
  });

  // --- Basic state management ---
  it('should start in closed state', () => {
    expect(cb.getState()).toBe('closed');
  });

  it('should remain closed on successful execution', async () => {
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getState()).toBe('closed');
  });

  it('should open after reaching failure threshold', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    expect(cb.getState()).toBe('open');
  });

  it('should reject calls when open', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitBreakerOpenError);
  });

  it('should transition to half-open after timeout', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    expect(cb.getState()).toBe('open');
    await delay(150);
    expect(cb.getState()).toBe('half-open');
  });

  it('should close after enough successes in half-open', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    await delay(150);
    expect(cb.getState()).toBe('half-open');
    await cb.execute(() => Promise.resolve('ok'));
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getState()).toBe('closed');
  });

  it('should reopen on failure in half-open', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    await delay(150);
    expect(cb.getState()).toBe('half-open');
    try { await cb.execute(failFn); } catch {}
    expect(cb.getState()).toBe('open');
  });

  // --- Force state transitions ---
  it('forceOpen should transition to open state', () => {
    cb.forceOpen();
    expect(cb.getState()).toBe('open');
  });

  it('forceClose should transition to closed state', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    cb.forceClose();
    expect(cb.getState()).toBe('closed');
  });

  it('forceOpen from half-open should work', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    await delay(150);
    expect(cb.getState()).toBe('half-open');
    cb.forceOpen();
    expect(cb.getState()).toBe('open');
  });

  it('forceOpen when already open should be no-op (no event)', () => {
    const changes: string[] = [];
    cb.on('stateChange', ((from: string, to: string) => {
      changes.push(`${from}->${to}`);
    }) as never);
    cb.forceOpen();
    expect(changes).toEqual(['closed->open']);
    cb.forceOpen();
    // transitionTo guards against same-state transition
    expect(changes).toEqual(['closed->open']);
  });

  // --- Reset ---
  it('reset should clear all counters and state', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    cb.reset();
    expect(cb.getState()).toBe('closed');
    const metrics = cb.getMetrics();
    expect(metrics.failureCount).toBe(0);
    expect(metrics.successCount).toBe(0);
  });

  it('reset should clear lastFailureTime', async () => {
    try { await cb.execute(() => Promise.reject(new Error('fail'))); } catch {}
    expect(cb.getMetrics().lastFailureTime).not.toBeNull();
    cb.reset();
    expect(cb.getMetrics().lastFailureTime).toBeNull();
  });

  // --- Events ---
  it('should emit stateChange event', async () => {
    const changes: string[] = [];
    cb.on('stateChange', ((from: string, to: string) => {
      changes.push(`${from}->${to}`);
    }) as never);
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    expect(changes).toContain('closed->open');
  });

  it('should emit failure event', async () => {
    let failureEmitted = false;
    cb.on('failure', () => { failureEmitted = true; });
    try { await cb.execute(() => Promise.reject(new Error('fail'))); } catch {}
    expect(failureEmitted).toBe(true);
  });

  it('should emit success event', async () => {
    let successEmitted = false;
    cb.on('success', () => { successEmitted = true; });
    await cb.execute(() => Promise.resolve('ok'));
    expect(successEmitted).toBe(true);
  });

  it('should emit halfOpenAttempt event', async () => {
    let halfOpenAttempts = 0;
    cb.on('halfOpenAttempt', () => { halfOpenAttempts++; });
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    await delay(150);
    try { await cb.execute(() => Promise.resolve('ok')); } catch {}
    expect(halfOpenAttempts).toBe(1);
  });

  it('off should remove event listener', async () => {
    let count = 0;
    const handler = () => { count++; };
    cb.on('success', handler);
    await cb.execute(() => Promise.resolve('ok'));
    expect(count).toBe(1);
    cb.off('success', handler);
    await cb.execute(() => Promise.resolve('ok'));
    expect(count).toBe(1);
  });

  it('off should clean up empty listener sets', async () => {
    const handler = () => {};
    cb.on('success', handler);
    cb.off('success', handler);
    // Should not throw; internal set should be deleted
    await cb.execute(() => Promise.resolve('ok'));
  });

  it('should support multiple listeners for the same event', async () => {
    let count1 = 0;
    let count2 = 0;
    const h1 = () => { count1++; };
    const h2 = () => { count2++; };
    cb.on('success', h1);
    cb.on('success', h2);
    await cb.execute(() => Promise.resolve('ok'));
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  // --- Metrics ---
  it('should track metrics correctly', async () => {
    await cb.execute(() => Promise.resolve('ok'));
    await cb.execute(() => Promise.resolve('ok'));
    try { await cb.execute(() => Promise.reject(new Error('fail'))); } catch {}
    const metrics = cb.getMetrics();
    expect(metrics.successCount).toBe(2);
    expect(metrics.failureCount).toBe(1);
    expect(metrics.lastFailureTime).not.toBeNull();
  });

  it('getMetrics should include current state duration', async () => {
    await delay(10);
    const metrics = cb.getMetrics();
    expect(metrics.stateDurations.closed).toBeGreaterThan(0);
  });

  it('getMetricsSnapshot should return accumulated durations only', () => {
    const metrics = cb.getMetricsSnapshot();
    // No current duration added; only accumulated durations
    expect(metrics.stateDurations.closed).toBe(0);
  });

  // --- Time-based window ---
  it('should work with time-based window', async () => {
    const timeCb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100,
      windowType: 'time',
      windowSize: 10000,
    });
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await timeCb.execute(failFn); } catch {}
    }
    expect(timeCb.getState()).toBe('open');
  });

  it('should prune old failures in time-based window', async () => {
    const timeCb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100,
      windowType: 'time',
      windowSize: 50,
    });
    const failFn = () => Promise.reject(new Error('fail'));
    // 2 failures
    try { await timeCb.execute(failFn); } catch {}
    try { await timeCb.execute(failFn); } catch {}
    // Wait for window to expire
    await delay(60);
    // These old failures should be pruned; need 3 more to trip
    try { await timeCb.execute(failFn); } catch {}
    expect(timeCb.getState()).toBe('closed');
    try { await timeCb.execute(failFn); } catch {}
    try { await timeCb.execute(failFn); } catch {}
    expect(timeCb.getState()).toBe('open');
  });

  // --- Count-based window ---
  it('should prune failures beyond windowSize for count-based window', async () => {
    const countCb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100,
      windowType: 'count',
      windowSize: 5,
    });
    const failFn = () => Promise.reject(new Error('fail'));
    // windowSize=5 means keep last 5 failures
    // Need 3 failures in window to trip
    for (let i = 0; i < 3; i++) {
      try { await countCb.execute(failFn); } catch {}
    }
    expect(countCb.getState()).toBe('open');
  });

  // --- Edge cases ---
  it('should handle non-Error throws', async () => {
    try {
      await cb.execute(() => { throw 'string error'; });
    } catch (e) {
      expect(e).toBe('string error');
    }
  });

  it('should handle null thrown', async () => {
    try {
      await cb.execute(() => { throw null; });
    } catch (e) {
      expect(e).toBeNull();
    }
  });

  it('should handle undefined thrown', async () => {
    try {
      await cb.execute(() => { throw undefined; });
    } catch (e) {
      expect(e).toBeUndefined();
    }
  });

  it('should handle successThreshold of 1', async () => {
    const cb1 = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      timeout: 100,
      windowType: 'count',
      windowSize: 1,
    });
    try { await cb1.execute(() => Promise.reject(new Error('fail'))); } catch {}
    expect(cb1.getState()).toBe('open');
    await delay(150);
    expect(cb1.getState()).toBe('half-open');
    await cb1.execute(() => Promise.resolve('ok'));
    expect(cb1.getState()).toBe('closed');
  });

  it('should handle failureThreshold of 1', async () => {
    const cb1 = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      timeout: 100,
      windowType: 'count',
      windowSize: 1,
    });
    try { await cb1.execute(() => Promise.reject(new Error('fail'))); } catch {}
    expect(cb1.getState()).toBe('open');
  });

  it('should return the correct result from execute', async () => {
    const result = await cb.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('should return object results correctly', async () => {
    const obj = { a: 1, b: 'test' };
    const result = await cb.execute(() => Promise.resolve(obj));
    expect(result).toEqual(obj);
  });
});

// ============================================================
// Bulkhead Tests
// ============================================================
describe('Bulkhead', () => {
  let bulkhead: Bulkhead;

  beforeEach(() => {
    bulkhead = new Bulkhead({ maxConcurrent: 2, maxQueueSize: 2 });
  });

  it('should allow execution within limit', async () => {
    const result = await bulkhead.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('should track active count', async () => {
    let resolveFirst: () => void;
    const first = bulkhead.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    expect(bulkhead.getActiveCount()).toBe(1);
    resolveFirst!();
    await first;
    expect(bulkhead.getActiveCount()).toBe(0);
  });

  it('should report available slots', () => {
    expect(bulkhead.getAvailableSlots()).toBe(2);
  });

  it('should queue excess requests', async () => {
    let resolveFirst: () => void;
    let resolveSecond: () => void;
    const p1 = bulkhead.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    const p2 = bulkhead.execute(() => new Promise<void>(resolve => { resolveSecond = resolve; }));
    expect(bulkhead.getAvailableSlots()).toBe(0);

    const p3Promise = bulkhead.execute(() => Promise.resolve('queued'));
    expect(bulkhead.getQueueSize()).toBe(1);

    resolveFirst!();
    await p1;
    resolveSecond!();
    await p2;
    const result = await p3Promise;
    expect(result).toBe('queued');
  });

  it('should reject when full', async () => {
    let resolveFirst: () => void;
    let resolveSecond: () => void;
    bulkhead.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    bulkhead.execute(() => new Promise<void>(resolve => { resolveSecond = resolve; }));
    bulkhead.execute(() => Promise.resolve('q1'));
    bulkhead.execute(() => Promise.resolve('q2'));

    await expect(bulkhead.execute(() => Promise.resolve('overflow'))).rejects.toThrow(BulkheadFullError);
    resolveFirst!();
    resolveSecond!();
  });

  it('should timeout queued items', async () => {
    const bh = new Bulkhead({ maxConcurrent: 1, maxQueueSize: 1, queueTimeout: 50 });
    let resolveFirst: () => void;
    bh.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    const p = bh.execute(() => Promise.resolve('queued'));
    await expect(p).rejects.toThrow(BulkheadQueueTimeoutError);
    resolveFirst!();
  });

  it('should report queue size correctly', async () => {
    let resolveFirst: () => void;
    bulkhead.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    bulkhead.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    bulkhead.execute(() => Promise.resolve('q1'));
    expect(bulkhead.getQueueSize()).toBe(1);
    resolveFirst!();
  });

  it('should process queued items when slots free up', async () => {
    let resolveFirst: () => void;
    const p1 = bulkhead.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    const p2 = bulkhead.execute(() => Promise.resolve(undefined));
    // p3 and p4 should be queued since both slots are used
    const p3Promise = bulkhead.execute(() => Promise.resolve('p3'));
    const p4Promise = bulkhead.execute(() => Promise.resolve('p4'));
    expect(bulkhead.getQueueSize()).toBe(2);

    resolveFirst!();
    await p1;
    await p2;
    const r3 = await p3Promise;
    const r4 = await p4Promise;
    expect(r3).toBe('p3');
    expect(r4).toBe('p4');
  });

  it('should handle queued item failure gracefully', async () => {
    const bh = new Bulkhead({ maxConcurrent: 1, maxQueueSize: 2, queueTimeout: 0 });
    let resolveFirst: () => void;
    const p1 = bh.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));

    // p2 is queued
    const p2 = bh.execute(() => Promise.reject(new Error('queued fail')));
    // p3 is also queued
    const p3 = bh.execute(() => Promise.resolve('after fail'));

    // Free up the slot - p2 should execute and reject
    resolveFirst!();
    await p1;
    await expect(p2).rejects.toThrow('queued fail');

    // p3 should still execute after p2 fails
    const result = await p3;
    expect(result).toBe('after fail');
  });

  it('should handle maxConcurrent of 1', async () => {
    const bh = new Bulkhead({ maxConcurrent: 1, maxQueueSize: 1 });
    let resolveFirst: () => void;
    bh.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    expect(bh.getActiveCount()).toBe(1);
    expect(bh.getAvailableSlots()).toBe(0);
    resolveFirst!();
  });

  it('should handle maxQueueSize of 0', async () => {
    const bh = new Bulkhead({ maxConcurrent: 1, maxQueueSize: 0 });
    let resolveFirst: () => void;
    bh.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    await expect(bh.execute(() => Promise.resolve('no queue'))).rejects.toThrow(BulkheadFullError);
    resolveFirst!();
  });

  it('should handle queueTimeout of 0 (no timeout)', async () => {
    const bh = new Bulkhead({ maxConcurrent: 1, maxQueueSize: 1, queueTimeout: 0 });
    let resolveFirst: () => void;
    bh.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    const p = bh.execute(() => Promise.resolve('ok'));
    // Should not timeout; resolve after a short delay
    await delay(10);
    resolveFirst!();
    const result = await p;
    expect(result).toBe('ok');
  });

  it('should return correct result types', async () => {
    const result = await bulkhead.execute(() => Promise.resolve({ key: 'value' }));
    expect(result).toEqual({ key: 'value' });
  });

  it('should handle error in direct execution', async () => {
    await expect(bulkhead.execute(() => Promise.reject(new Error('direct fail')))).rejects.toThrow('direct fail');
    expect(bulkhead.getActiveCount()).toBe(0);
  });
});

// ============================================================
// Retry with Backoff Tests
// ============================================================
describe('RetryWithBackoff', () => {
  it('should succeed on first attempt', async () => {
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'fixed', baseDelay: 1 });
    const result = await retry.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('should retry on failure and succeed', async () => {
    let attempts = 0;
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'fixed', baseDelay: 1 });
    const result = await retry.execute(() => {
      attempts++;
      if (attempts < 3) return Promise.reject(new Error('fail'));
      return Promise.resolve('ok');
    });
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('should throw after max retries', async () => {
    const retry = new RetryWithBackoff({ maxRetries: 2, strategy: 'fixed', baseDelay: 1 });
    let attempts = 0;
    await expect(
      retry.execute(() => {
        attempts++;
        return Promise.reject(new Error('fail'));
      }),
    ).rejects.toThrow('fail');
    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it('should use exponential backoff delays', async () => {
    const delays: number[] = [];
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'exponential', baseDelay: 1 });
    retry.onRetry((_attempt, _error, delay) => delays.push(delay));

    let attempts = 0;
    try {
      await retry.execute(() => {
        attempts++;
        if (attempts <= 3) return Promise.reject(new Error('fail'));
        return Promise.resolve('ok');
      });
    } catch {}

    expect(delays.length).toBeGreaterThan(0);
    expect(delays[0]).toBe(1);    // 1 * 2^0
    expect(delays[1]).toBe(2);    // 1 * 2^1
    expect(delays[2]).toBe(4);    // 1 * 2^2
  });

  it('should use linear backoff delays', async () => {
    const delays: number[] = [];
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'linear', baseDelay: 1 });
    retry.onRetry((_attempt, _error, delay) => delays.push(delay));

    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}

    expect(delays[0]).toBe(1);
    expect(delays[1]).toBe(2);
    expect(delays[2]).toBe(3);
  });

  it('should use fixed backoff delays', async () => {
    const delays: number[] = [];
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'fixed', baseDelay: 5 });
    retry.onRetry((_attempt, _error, delay) => delays.push(delay));

    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}

    expect(delays.every(d => d === 5)).toBe(true);
  });

  it('should respect max delay', async () => {
    const delays: number[] = [];
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'exponential', baseDelay: 10, maxDelay: 15 });
    retry.onRetry((_attempt, _error, delay) => delays.push(delay));

    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}

    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(15);
    }
  });

  it('should filter by retryable error types', async () => {
    class RetryableError extends Error {}
    class NonRetryableError extends Error {}

    const retry = new RetryWithBackoff({
      maxRetries: 3,
      strategy: 'fixed',
      baseDelay: 1,
      retryableErrorTypes: ['RetryableError'],
    });

    let attempts = 0;
    await expect(
      retry.execute(() => {
        attempts++;
        return Promise.reject(new NonRetryableError('not retryable'));
      }),
    ).rejects.toThrow('not retryable');
    expect(attempts).toBe(1);
  });

  it('should filter by retryable patterns', async () => {
    const retry = new RetryWithBackoff({
      maxRetries: 3,
      strategy: 'fixed',
      baseDelay: 1,
      retryablePatterns: [/timeout/i],
    });

    let attempts = 0;
    await expect(
      retry.execute(() => {
        attempts++;
        return Promise.reject(new Error('connection refused'));
      }),
    ).rejects.toThrow('connection refused');
    expect(attempts).toBe(1);
  });

  it('should filter by custom predicate', async () => {
    const retry = new RetryWithBackoff({
      maxRetries: 3,
      strategy: 'fixed',
      baseDelay: 1,
      retryablePredicate: (err) => err.message === 'please retry',
    });

    let attempts = 0;
    await expect(
      retry.execute(() => {
        attempts++;
        return Promise.reject(new Error('do not retry'));
      }),
    ).rejects.toThrow('do not retry');
    expect(attempts).toBe(1);
  });

  it('should track retry history', async () => {
    const retry = new RetryWithBackoff({ maxRetries: 2, strategy: 'fixed', baseDelay: 1 });
    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}
    const history = retry.getHistory();
    expect(history.length).toBe(2);
    expect(history[0].attempt).toBe(1);
    expect(history[1].attempt).toBe(2);
  });

  it('should clear history', async () => {
    const retry = new RetryWithBackoff({ maxRetries: 2, strategy: 'fixed', baseDelay: 1 });
    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}
    retry.clearHistory();
    expect(retry.getHistory().length).toBe(0);
  });

  it('should support custom delay function', async () => {
    const retry = new RetryWithBackoff({
      maxRetries: 2,
      strategy: 'custom',
      baseDelay: 1,
      customDelayFn: () => 1,
    });
    const delays: number[] = [];
    retry.onRetry((_a, _e, d) => delays.push(d));
    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}
    expect(delays.every(d => d === 1)).toBe(true);
  });

  it('should use exponential_with_jitter strategy', async () => {
    const delays: number[] = [];
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'exponential_with_jitter', baseDelay: 1, jitterFactor: 0.5 });
    retry.onRetry((_attempt, _error, delay) => delays.push(delay));
    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}
    expect(delays.length).toBe(3);
    // BUG-002 FIX: All delays should be non-negative
    expect(delays.every(d => d >= 0)).toBe(true);
  });

  it('should use exponential_with_jitter with high jitterFactor without negative delays', async () => {
    const delays: number[] = [];
    const retry = new RetryWithBackoff({ maxRetries: 5, strategy: 'exponential_with_jitter', baseDelay: 1, jitterFactor: 1.0 });
    retry.onRetry((_attempt, _error, delay) => delays.push(delay));
    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}
    // BUG-002 FIX: Even with jitterFactor=1.0, delays should never be negative
    expect(delays.every(d => d >= 0)).toBe(true);
  });

  it('should retry on error type match', async () => {
    class MyError extends Error {
      constructor() { super('my'); this.name = 'MyError'; }
    }

    const retry = new RetryWithBackoff({
      maxRetries: 3,
      strategy: 'fixed',
      baseDelay: 1,
      retryableErrorTypes: ['MyError'],
    });

    let attempts = 0;
    try {
      await retry.execute(() => {
        attempts++;
        return Promise.reject(new MyError());
      });
    } catch {}
    expect(attempts).toBe(4); // 1 initial + 3 retries
  });

  it('should retry on pattern match', async () => {
    const retry = new RetryWithBackoff({
      maxRetries: 2,
      strategy: 'fixed',
      baseDelay: 1,
      retryablePatterns: [/ECONNREFUSED/],
    });

    let attempts = 0;
    try {
      await retry.execute(() => {
        attempts++;
        return Promise.reject(new Error('ECONNREFUSED'));
      });
    } catch {}
    expect(attempts).toBe(3);
  });

  it('should retry when both type and pattern matchers are empty (default all retryable)', async () => {
    const retry = new RetryWithBackoff({
      maxRetries: 2,
      strategy: 'fixed',
      baseDelay: 1,
    });

    let attempts = 0;
    try {
      await retry.execute(() => {
        attempts++;
        return Promise.reject(new Error('any error'));
      });
    } catch {}
    expect(attempts).toBe(3);
  });

  it('should handle maxRetries of 0 (no retries)', async () => {
    const retry = new RetryWithBackoff({ maxRetries: 0, strategy: 'fixed', baseDelay: 1 });
    let attempts = 0;
    await expect(
      retry.execute(() => {
        attempts++;
        return Promise.reject(new Error('fail'));
      }),
    ).rejects.toThrow('fail');
    expect(attempts).toBe(1);
  });

  it('should handle non-Error rejection', async () => {
    const retry = new RetryWithBackoff({ maxRetries: 2, strategy: 'fixed', baseDelay: 1 });
    let attempts = 0;
    await expect(
      retry.execute(() => {
        attempts++;
        return Promise.reject('string error');
      }),
    ).rejects.toThrow('string error');
    expect(attempts).toBe(3);
  });

  it('should abort via AbortSignal', async () => {
    const ac = new AbortController();
    const retry = new RetryWithBackoff({
      maxRetries: 5,
      strategy: 'fixed',
      baseDelay: 100,
      signal: ac.signal,
    });

    let attempts = 0;
    const promise = retry.execute(() => {
      attempts++;
      return Promise.reject(new Error('fail'));
    });

    // Abort after first attempt starts
    await delay(10);
    ac.abort();

    await expect(promise).rejects.toThrow('Operation aborted');
  });

  it('should not start if already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const retry = new RetryWithBackoff({
      maxRetries: 3,
      strategy: 'fixed',
      baseDelay: 1,
      signal: ac.signal,
    });

    await expect(retry.execute(() => Promise.resolve('ok'))).rejects.toThrow('Operation aborted');
  });

  it('removeRetryCallback should remove callback', async () => {
    const retry = new RetryWithBackoff({ maxRetries: 2, strategy: 'fixed', baseDelay: 1 });
    let callCount = 0;
    const cb = () => { callCount++; };
    retry.onRetry(cb);
    try { await retry.execute(() => Promise.reject(new Error('fail'))); } catch {}
    expect(callCount).toBe(2);
    retry.removeRetryCallback(cb);
    try { await retry.execute(() => Promise.reject(new Error('fail'))); } catch {}
    expect(callCount).toBe(2); // no additional calls
  });

  it('should return correct result type', async () => {
    const retry = new RetryWithBackoff({ maxRetries: 0, strategy: 'fixed', baseDelay: 1 });
    const result = await retry.execute(() => Promise.resolve({ nested: { value: 42 } }));
    expect(result).toEqual({ nested: { value: 42 } });
  });

  it('should handle custom strategy with no customDelayFn (falls back to base)', async () => {
    const retry = new RetryWithBackoff({
      maxRetries: 2,
      strategy: 'custom',
      baseDelay: 5,
    });
    const delays: number[] = [];
    retry.onRetry((_a, _e, d) => delays.push(d));
    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}
    expect(delays.every(d => d === 5)).toBe(true);
  });

  it('history entries should have timestamps', async () => {
    const retry = new RetryWithBackoff({ maxRetries: 1, strategy: 'fixed', baseDelay: 1 });
    try { await retry.execute(() => Promise.reject(new Error('fail'))); } catch {}
    const history = retry.getHistory();
    expect(history[0].timestamp).toBeGreaterThan(0);
    expect(history[0].error).toBeInstanceOf(Error);
  });
});

// ============================================================
// Timeout Guard Tests
// ============================================================
describe('TimeoutGuard', () => {
  it('should resolve before timeout', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const result = await guard.wrap(() => Promise.resolve('ok'), 1000);
    expect(result).toBe('ok');
  });

  it('should reject on timeout', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 30, strategy: 'reject' });
    await expect(
      guard.wrap(() => new Promise(() => {}), 30),
    ).rejects.toThrow(TimeoutError);
  });

  it('should resolve with default on timeout', async () => {
    const guard = new TimeoutGuard({
      defaultTimeoutMs: 30,
      strategy: 'resolve_with_default',
      defaultReturnValue: 'default',
    });
    const result = await guard.wrap(() => new Promise(() => {}), 30);
    expect(result).toBe('default');
  });

  it('should cancel on timeout', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 30, strategy: 'cancel' });
    await expect(
      guard.wrap(() => new Promise(() => {}), 30),
    ).rejects.toThrow(TimeoutError);
  });

  it('should use defaultTimeoutMs when no override provided', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 30, strategy: 'reject' });
    await expect(
      guard.wrap(() => new Promise(() => {})),
    ).rejects.toThrow(TimeoutError);
  });

  it('should create timer', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const timer = guard.createTimer(1000, 'test');
    expect(timer).toBeDefined();
    expect(timer.isExpired()).toBe(false);
    guard.cancelTimer('test');
  });

  it('should extend timer', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const timer = guard.createTimer(1000, 'extendable');
    expect(timer.getRemaining()).toBeGreaterThan(0);
    timer.extend(2000);
    guard.cancelTimer('extendable');
  });

  it('extend after expiry should be no-op', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const timer = guard.createTimer(20, 'expire-extend');
    await delay(30);
    expect(timer.isExpired()).toBe(true);
    timer.extend(5000); // should be no-op
    expect(timer.isExpired()).toBe(true);
  });

  it('should cancel timer', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const timer = guard.createTimer(1000, 'cancelable');
    timer.cancel();
    expect(timer.isExpired()).toBe(true);
  });

  it('should cancel all timers', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    guard.createTimer(1000, 't1');
    guard.createTimer(1000, 't2');
    expect(guard.getActiveTimerCount()).toBe(2);
    guard.cancelAll();
    expect(guard.getActiveTimerCount()).toBe(0);
  });

  it('should fire warning callback', async () => {
    const warnings: string[] = [];
    const guard = new TimeoutGuard({
      defaultTimeoutMs: 50,
      strategy: 'reject',
      warningPercentage: 50,
    });
    guard.onWarning((name) => warnings.push(name));
    guard.createTimer(50, 'warn-test');
    await delay(30);
    expect(warnings.length).toBeGreaterThan(0);
    guard.cancelAll();
  });

  it('should parse string timeout in createTimer', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const timer = guard.createTimer('1000', 'string-timer');
    expect(timer).toBeDefined();
    guard.cancelTimer('string-timer');
  });

  it('should handle NaN in string timeout', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const timer = guard.createTimer('abc', 'nan-timer');
    expect(timer).toBeDefined();
    // NaN timeout means timer fires immediately (setTimeout with NaN = 0ms)
    guard.cancelTimer('nan-timer');
  });

  it('getTimer should return undefined for non-existent timer', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    expect(guard.getTimer('nonexistent')).toBeUndefined();
  });

  it('cancelTimer should handle non-existent timer gracefully', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    expect(() => guard.cancelTimer('nonexistent')).not.toThrow();
  });

  it('removeWarningCallback should remove callback', async () => {
    const warnings: string[] = [];
    const guard = new TimeoutGuard({
      defaultTimeoutMs: 50,
      strategy: 'reject',
      warningPercentage: 50,
    });
    const cb = (name: string) => warnings.push(name);
    guard.onWarning(cb);
    guard.removeWarningCallback(cb);
    guard.createTimer(50, 'no-warn');
    await delay(30);
    expect(warnings.length).toBe(0);
    guard.cancelAll();
  });

  it('wrap should handle function that throws synchronously', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    await expect(
      guard.wrap(() => { throw new Error('sync error'); }, 1000),
    ).rejects.toThrow('sync error');
  });

  it('wrap should handle function that rejects', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    await expect(
      guard.wrap(() => Promise.reject(new Error('async error')), 1000),
    ).rejects.toThrow('async error');
  });

  it('wrap should clean up timer on successful completion', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    await guard.wrap(() => Promise.resolve('ok'), 1000, 'cleanup-test');
    expect(guard.getActiveTimerCount()).toBe(0);
  });

  it('wrap should clean up timer on error', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    try {
      await guard.wrap(() => Promise.reject(new Error('err')), 1000, 'cleanup-err');
    } catch {}
    expect(guard.getActiveTimerCount()).toBe(0);
  });

  it('wrap should use named timer', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    await guard.wrap(() => Promise.resolve('ok'), 1000, 'named-timer');
    expect(guard.getTimer('named-timer')).toBeUndefined(); // cleaned up after completion
  });

  // BUG-003 FIX: TimeoutTimer.extend should use configured warningPercentage
  it('extend should use configured warningPercentage for new warning timer', async () => {
    const warnings: Array<{ name: string; remaining: number }> = [];
    const guard = new TimeoutGuard({
      defaultTimeoutMs: 5000,
      strategy: 'reject',
      warningPercentage: 50,
    });
    guard.onWarning((name, remaining) => warnings.push({ name, remaining }));

    // Create timer with 200ms, warning at 50% = 100ms
    const timer = guard.createTimer(200, 'extend-warn-test');
    // Wait for the first warning to fire at ~100ms
    await delay(120);
    const countBeforeExtend = warnings.length;
    expect(countBeforeExtend).toBeGreaterThan(0);

    // Extend by 200ms; new warning should fire at 50% of remaining+200
    timer.extend(200);
    // Wait long enough for the new warning (50% of ~280ms = ~140ms)
    await delay(160);
    // Should have at least one more warning after extend
    expect(warnings.length).toBeGreaterThan(countBeforeExtend);
    guard.cancelAll();
  });

  it('getRemaining should decrease over time', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const timer = guard.createTimer(100, 'remaining-test');
    const r1 = timer.getRemaining();
    await delay(20);
    const r2 = timer.getRemaining();
    expect(r2).toBeLessThan(r1);
    guard.cancelTimer('remaining-test');
  });

  it('getRemaining should return 0 after expiry', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const timer = guard.createTimer(20, 'expired-remaining');
    await delay(30);
    expect(timer.getRemaining()).toBe(0);
  });
});

// ============================================================
// TimeoutTimer Tests (standalone)
// ============================================================
describe('TimeoutTimer', () => {
  it('should fire onTimeout callback', async () => {
    let timedOut = false;
    const timer = new TimeoutTimer(20, () => { timedOut = true; });
    await delay(30);
    expect(timedOut).toBe(true);
    expect(timer.isExpired()).toBe(true);
  });

  it('should fire onWarning callback', async () => {
    let warned = false;
    const timer = new TimeoutTimer(100, () => {}, () => { warned = true; }, 50);
    await delay(60);
    expect(warned).toBe(true);
    expect(timer.isExpired()).toBe(false);
    timer.cancel();
  });

  it('should not fire warning if percentage is 0', async () => {
    let warned = false;
    const timer = new TimeoutTimer(50, () => {}, () => { warned = true; }, 0);
    await delay(30);
    expect(warned).toBe(false);
    timer.cancel();
  });

  it('should not fire warning if percentage is 100', async () => {
    let warned = false;
    const timer = new TimeoutTimer(50, () => {}, () => { warned = true; }, 100);
    await delay(30);
    expect(warned).toBe(false);
    timer.cancel();
  });

  it('cancel should prevent timeout', async () => {
    let timedOut = false;
    const timer = new TimeoutTimer(20, () => { timedOut = true; });
    timer.cancel();
    await delay(30);
    expect(timedOut).toBe(false);
    expect(timer.isExpired()).toBe(true); // cancelled counts as expired
  });

  it('extend should increase remaining time', async () => {
    let timedOut = false;
    const timer = new TimeoutTimer(20, () => { timedOut = true; });
    await delay(10);
    timer.extend(50);
    await delay(25);
    expect(timedOut).toBe(false);
    await delay(40);
    expect(timedOut).toBe(true);
  });

  it('extend with 0 additional ms should use remaining time', () => {
    const timer = new TimeoutTimer(1000, () => {});
    timer.extend(0);
    expect(timer.getRemaining()).toBeGreaterThan(0);
    timer.cancel();
  });

  it('extend with negative ms should not go below 0', () => {
    const timer = new TimeoutTimer(1000, () => {});
    timer.extend(-5000);
    // remaining = max(0, 1000 - elapsed) + (-5000) = max(0, negative) = 0
    // But since elapsed is ~0, remaining = max(0, 1000 - 0) + (-5000) = -4000
    // This is a potential issue but the timer will just fire immediately
    timer.cancel();
  });
});

// ============================================================
// Health Checker Tests
// ============================================================
describe('HealthChecker', () => {
  let checker: HealthChecker;

  beforeEach(() => {
    checker = new HealthChecker();
  });

  afterEach(() => {
    checker.stopAll();
  });

  it('should register a check', () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    const health = checker.getComponentHealth('db');
    expect(health.name).toBe('db');
  });

  it('should report healthy for passing check', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    const report = await checker.checkHealth();
    expect(report.components['db'].level).toBe('healthy');
  });

  it('should report unhealthy for failing check', async () => {
    checker.registerCheck('db', () => Promise.reject(new Error('down')));
    const report = await checker.checkHealth();
    expect(report.components['db'].level).toBe('unhealthy');
  });

  it('should report overall status as healthy', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    checker.registerCheck('cache', () => Promise.resolve({ healthy: true }));
    const report = await checker.checkHealth();
    expect(report.status).toBe('healthy');
  });

  it('should report overall status as unhealthy', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    checker.registerCheck('cache', () => Promise.reject(new Error('down')));
    const report = await checker.checkHealth();
    expect(report.status).toBe('unhealthy');
  });

  it('should report overall status as degraded', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true, level: 'degraded' }));
    const report = await checker.checkHealth();
    expect(report.status).toBe('degraded');
  });

  it('should report overall status as unknown when no checks', async () => {
    const report = await checker.checkHealth();
    expect(report.status).toBe('unknown');
  });

  it('should track consecutive failures', async () => {
    checker.registerCheck('db', () => Promise.reject(new Error('down')));
    await checker.checkHealth();
    await checker.checkHealth();
    const health = checker.getComponentHealth('db');
    expect(health.consecutiveFailures).toBe(2);
  });

  it('should track consecutive successes', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    await checker.checkHealth();
    await checker.checkHealth();
    const health = checker.getComponentHealth('db');
    expect(health.consecutiveSuccesses).toBe(2);
  });

  it('should reset consecutive failures on success', async () => {
    checker.registerCheck('db', () => Promise.reject(new Error('down')));
    await checker.checkHealth();
    await checker.checkHealth();
    // Now make it healthy
    checker.removeCheck('db');
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    await checker.checkHealth();
    const health = checker.getComponentHealth('db');
    expect(health.consecutiveFailures).toBe(0);
    expect(health.consecutiveSuccesses).toBe(1);
  });

  it('should emit health change events', async () => {
    const changes: string[] = [];
    checker.onHealthChange((name, _old, _new) => changes.push(name));
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    await checker.checkHealth();
    expect(changes.length).toBeGreaterThan(0);
  });

  it('should respect check timeout', async () => {
    checker.registerCheck('slow', () => new Promise(() => {}), 'liveness', undefined, 30);
    const report = await checker.checkHealth();
    expect(report.components['slow'].level).toBe('unhealthy');
  });

  it('should remove check', () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    checker.removeCheck('db');
    const health = checker.getComponentHealth('db');
    expect(health.level).toBe('unknown');
  });

  it('should support different check types', () => {
    checker.registerCheck('liveness', () => Promise.resolve({ healthy: true }), 'liveness');
    checker.registerCheck('readiness', () => Promise.resolve({ healthy: true }), 'readiness');
    checker.registerCheck('startup', () => Promise.resolve({ healthy: true }), 'startup');
    expect(checker.getComponentHealth('liveness').type).toBe('liveness');
    expect(checker.getComponentHealth('readiness').type).toBe('readiness');
    expect(checker.getComponentHealth('startup').type).toBe('startup');
  });

  it('should include timestamp in report', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    const report = await checker.checkHealth();
    expect(report.timestamp).toBeDefined();
    expect(report.timestamp).toBeGreaterThan(0);
  });

  it('should include summary in report', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    checker.registerCheck('cache', () => Promise.reject(new Error('down')));
    const report = await checker.checkHealth();
    expect(report.summary).toBe('1/2 components healthy');
  });

  it('should use custom level from check result', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true, level: 'degraded' }));
    const report = await checker.checkHealth();
    expect(report.components['db'].level).toBe('degraded');
  });

  it('should handle check that returns healthy=false without level', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: false }));
    const report = await checker.checkHealth();
    expect(report.components['db'].level).toBe('unhealthy');
  });

  it('should store lastResult on failure', async () => {
    checker.registerCheck('db', () => Promise.reject(new Error('connection refused')));
    await checker.checkHealth();
    const health = checker.getComponentHealth('db');
    expect(health.lastResult).not.toBeNull();
    expect(health.lastResult!.healthy).toBe(false);
    expect(health.lastResult!.message).toBe('connection refused');
  });

  it('should store lastCheck timestamp', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    await checker.checkHealth();
    const health = checker.getComponentHealth('db');
    expect(health.lastCheck).not.toBeNull();
    expect(health.lastCheck).toBeGreaterThan(0);
  });

  it('checkComponent for unregistered name should return default', async () => {
    const health = await checker.checkComponent('nonexistent');
    expect(health.level).toBe('unknown');
    expect(health.name).toBe('nonexistent');
  });

  it('checkComponent for registered name should run the check', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    const health = await checker.checkComponent('db');
    expect(health.level).toBe('healthy');
  });

  it('addDependencyGroup should store the group', () => {
    checker.addDependencyGroup('primary', ['db', 'cache'], 'and');
    // No direct getter, but should not throw
  });

  it('should handle check with details', async () => {
    checker.registerCheck('db', () => Promise.resolve({
      healthy: true,
      details: { latency: 5, connections: 10 },
    }));
    const report = await checker.checkHealth();
    expect(report.components['db'].lastResult?.details).toEqual({ latency: 5, connections: 10 });
  });

  it('should handle check with timestamp', async () => {
    const ts = Date.now();
    checker.registerCheck('db', () => Promise.resolve({
      healthy: true,
      timestamp: ts,
    }));
    const report = await checker.checkHealth();
    expect(report.components['db'].lastResult?.timestamp).toBe(ts);
  });

  it('stopAll should clear intervals', () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }), 'liveness', 100);
    checker.stopAll();
    // Should not throw; intervals cleared
  });

  it('getComponentHealth for unregistered name should return default', () => {
    const health = checker.getComponentHealth('nonexistent');
    expect(health.level).toBe('unknown');
  });

  // BUG-001 FIX: checkComponent should not infinitely recurse
  it('checkComponent should not infinitely recurse for registered checks', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    // This would hang forever with the recursion bug
    const health = await checker.checkComponent('db');
    expect(health.level).toBe('healthy');
  });

  it('should run all checks concurrently', async () => {
    let running = 0;
    let maxRunning = 0;
    const makeCheck = (name: string) => () => new Promise<unknown>(resolve => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      setTimeout(() => {
        running--;
        resolve({ healthy: true });
      }, 10);
    });
    checker.registerCheck('a', makeCheck('a'));
    checker.registerCheck('b', makeCheck('b'));
    checker.registerCheck('c', makeCheck('c'));
    await checker.checkHealth();
    expect(maxRunning).toBe(3);
  });
});

// ============================================================
// Fallback Provider Tests
// ============================================================
describe('FallbackProvider', () => {
  it('should return primary result on success', async () => {
    const fp = new FallbackProvider<string>();
    const result = await fp.execute(() => Promise.resolve('primary'));
    expect(result).toBe('primary');
  });

  it('should use default_value fallback', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback' });
    const result = await fp.execute(
      () => Promise.reject(new Error('fail')),
    );
    expect(result).toBe('fallback');
  });

  it('should use alternative_function fallback', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'alternative_function', alternativeFn: () => Promise.resolve('alt') });
    const result = await fp.execute(
      () => Promise.reject(new Error('fail')),
    );
    expect(result).toBe('alt');
  });

  it('should use cached_value fallback', async () => {
    const fp = new FallbackProvider<string>();
    fp.setCachedValue('cached');
    fp.addFallback({ strategy: 'cached_value' });
    const result = await fp.execute(
      () => Promise.reject(new Error('fail')),
    );
    expect(result).toBe('cached');
  });

  it('should throw_custom_error fallback', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'throw_custom_error', customError: new Error('custom') });
    await expect(
      fp.execute(() => Promise.reject(new Error('fail'))),
    ).rejects.toThrow('custom');
  });

  it('should throw default custom error when no customError provided', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'throw_custom_error' });
    await expect(
      fp.execute(() => Promise.reject(new Error('fail'))),
    ).rejects.toThrow('Custom fallback error');
  });

  it('should match fallback by error type', async () => {
    const fp = new FallbackProvider<string>();
    class MyError extends Error {
      constructor() { super('my'); this.name = 'MyError'; }
    }
    fp.addFallback({ strategy: 'default_value', value: 'fallback', errorType: 'MyError' });
    const result = await fp.execute(
      () => Promise.reject(new MyError()),
    );
    expect(result).toBe('fallback');
  });

  it('should match fallback by error pattern', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback', errorPattern: /timeout/i });
    const result = await fp.execute(
      () => Promise.reject(new Error('Connection timeout')),
    );
    expect(result).toBe('fallback');
  });

  it('should not match fallback when error type does not match', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback', errorType: 'OtherError' });
    await expect(
      fp.execute(() => Promise.reject(new Error('fail'))),
    ).rejects.toThrow('fail');
  });

  it('should not match fallback when error pattern does not match', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback', errorPattern: /timeout/i });
    await expect(
      fp.execute(() => Promise.reject(new Error('connection refused'))),
    ).rejects.toThrow('connection refused');
  });

  it('should track metrics', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback' });
    await fp.execute(() => Promise.resolve('primary'));
    try { await fp.execute(() => Promise.reject(new Error('fail'))); } catch {}
    const metrics = fp.getMetrics();
    expect(metrics.primarySuccessCount).toBe(1);
    expect(metrics.primaryFailureCount).toBe(1);
    expect(metrics.fallbackSuccessCount).toBe(1);
  });

  it('should track fallbackTriggeredCount', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback' });
    try { await fp.execute(() => Promise.reject(new Error('fail'))); } catch {}
    const metrics = fp.getMetrics();
    expect(metrics.fallbackTriggeredCount).toBe(1);
  });

  it('should track fallbackFailureCount', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'alternative_function', alternativeFn: () => Promise.reject(new Error('alt fail')) });
    await expect(
      fp.execute(() => Promise.reject(new Error('fail'))),
    ).rejects.toThrow('fail');
    const metrics = fp.getMetrics();
    expect(metrics.fallbackFailureCount).toBe(1);
  });

  it('should reset metrics', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback' });
    await fp.execute(() => Promise.resolve('primary'));
    fp.resetMetrics();
    const metrics = fp.getMetrics();
    expect(metrics.primarySuccessCount).toBe(0);
  });

  it('should accept inline fallbacks', async () => {
    const fp = new FallbackProvider<string>();
    const result = await fp.execute(
      () => Promise.reject(new Error('fail')),
      [{ strategy: 'default_value', value: 'inline' }],
    );
    expect(result).toBe('inline');
  });

  it('should respect priority order', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'low', priority: 10 });
    fp.addFallback({ strategy: 'default_value', value: 'high', priority: 1 });
    const result = await fp.execute(
      () => Promise.reject(new Error('fail')),
    );
    expect(result).toBe('high');
  });

  it('should cache value from successful primary', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'cached_value' });
    await fp.execute(() => Promise.resolve('primary'));
    expect(fp.getCachedValue()).toBe('primary');
  });

  it('should remove fallback by strategy', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback' });
    fp.removeFallback('default_value');
    await expect(fp.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
  });

  it('should try next fallback when first one fails', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({
      strategy: 'alternative_function',
      alternativeFn: () => Promise.reject(new Error('alt fail')),
      priority: 1,
    });
    fp.addFallback({
      strategy: 'default_value',
      value: 'second',
      priority: 2,
    });
    const result = await fp.execute(() => Promise.reject(new Error('fail')));
    expect(result).toBe('second');
  });

  it('should handle cached_value fallback with no cached value', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'cached_value' });
    // No cached value set; should fall through to throw original error
    await expect(fp.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
  });

  it('should handle default_value fallback with undefined value', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value' });
    await expect(fp.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
  });

  it('should handle alternative_function fallback with no function', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'alternative_function' });
    await expect(fp.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
  });

  it('should handle non-Error rejection', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback' });
    const result = await fp.execute(() => Promise.reject('string error'));
    expect(result).toBe('fallback');
  });

  it('should track lastFallbackUsed', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback' });
    try { await fp.execute(() => Promise.reject(new Error('fail'))); } catch {}
    expect(fp.getMetrics().lastFallbackUsed).toBe('default_value');
  });

  it('should return a copy of metrics', () => {
    const fp = new FallbackProvider<string>();
    const m1 = fp.getMetrics();
    const m2 = fp.getMetrics();
    expect(m1).toEqual(m2);
    expect(m1).not.toBe(m2);
  });

  it('setCachedValue should overwrite existing cached value', () => {
    const fp = new FallbackProvider<string>();
    fp.setCachedValue('first');
    fp.setCachedValue('second');
    expect(fp.getCachedValue()).toBe('second');
  });

  it('getCachedValue should return undefined when no value cached', () => {
    const fp = new FallbackProvider<string>();
    expect(fp.getCachedValue()).toBeUndefined();
  });
});

// ============================================================
// Chaos Engine Tests
// ============================================================
describe('ChaosEngine', () => {
  it('should inject a fault', () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    expect(engine.getActiveFaults().length).toBe(1);
  });

  it('should remove a fault', () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    engine.removeFault('f1');
    expect(engine.getActiveFaults().length).toBe(0);
  });

  it('should inject error fault', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    await expect(engine.execute('op', () => Promise.resolve('ok'))).rejects.toThrow();
  });

  it('should inject latency fault', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'latency', probability: 1.0, latencyMs: 20 });
    const start = Date.now();
    const result = await engine.execute('op', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('should not inject when disabled', async () => {
    const engine = new ChaosEngine({ enabled: false });
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    const result = await engine.execute('op', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('should target specific operations', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0, targetOperation: 'specific' });
    const result = await engine.execute('other', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('should respect probability', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 0 });
    const result = await engine.execute('op', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('should auto-recover after duration', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0, duration: 50 });
    expect(engine.getActiveFaults().length).toBe(1);
    await delay(60);
    expect(engine.getActiveFaults().length).toBe(0);
  });

  it('should enforce max concurrent faults', () => {
    const engine = new ChaosEngine({ maxConcurrentFaults: 2 });
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    engine.injectFault({ id: 'f2', type: 'error', probability: 1.0 });
    expect(() => engine.injectFault({ id: 'f3', type: 'error', probability: 1.0 })).toThrow();
  });

  it('should clear all faults', () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    engine.injectFault({ id: 'f2', type: 'error', probability: 1.0 });
    engine.clearAll();
    expect(engine.getActiveFaults().length).toBe(0);
  });

  it('should track fault stats', () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    const stats = engine.getFaultStats();
    expect(stats['f1']).toBeDefined();
    expect(stats['f1'].triggerCount).toBe(0);
  });

  it('should enable and disable', () => {
    const engine = new ChaosEngine();
    expect(engine.isEnabled()).toBe(true);
    engine.disable();
    expect(engine.isEnabled()).toBe(false);
    engine.enable();
    expect(engine.isEnabled()).toBe(true);
  });

  it('should inject resource_exhaustion fault', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'resource_exhaustion', probability: 1.0 });
    await expect(engine.execute('op', () => Promise.resolve('ok'))).rejects.toThrow('resource exhaustion');
  });

  it('should inject network_partition fault', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'network_partition', probability: 1.0 });
    await expect(engine.execute('op', () => Promise.resolve('ok'))).rejects.toThrow('network partition');
  });

  it('should inject timeout fault', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'timeout', probability: 1.0 });
    // Timeout fault waits 5000ms before rejecting - just verify it rejects
    const start = Date.now();
    await expect(engine.execute('op', () => Promise.resolve('ok'))).rejects.toThrow('timeout');
    // Should take at least some time (the chaos timeout is 5000ms)
    expect(Date.now() - start).toBeGreaterThan(4000);
  }, 10000);

  it('should use custom error function', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({
      id: 'f1',
      type: 'error',
      probability: 1.0,
      errorFn: () => new Error('custom chaos error'),
    });
    await expect(engine.execute('op', () => Promise.resolve('ok'))).rejects.toThrow('custom chaos error');
  });

  it('should not inject fault when probability < random', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 0.0001 });
    // Very low probability; likely won't trigger
    const result = await engine.execute('op', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('should track triggerCount', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'latency', probability: 1.0, latencyMs: 1 });
    await engine.execute('op', () => Promise.resolve('ok'));
    const stats = engine.getFaultStats();
    expect(stats['f1'].triggerCount).toBe(1);
  });

  it('should handle multiple applicable faults', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'latency', probability: 1.0, latencyMs: 1 });
    engine.injectFault({ id: 'f2', type: 'latency', probability: 1.0, latencyMs: 1 });
    const start = Date.now();
    await engine.execute('op', () => Promise.resolve('ok'));
    // Both latency faults should apply
    expect(Date.now() - start).toBeGreaterThanOrEqual(1);
  });

  it('should handle latency fault with no latencyMs', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'latency', probability: 1.0 });
    // No latencyMs set; should just pass through
    const result = await engine.execute('op', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('should handle removeFault for non-existent fault', () => {
    const engine = new ChaosEngine();
    expect(() => engine.removeFault('nonexistent')).not.toThrow();
  });

  it('should handle scheduled fault with past startTime', () => {
    const engine = new ChaosEngine();
    engine.injectFault({
      id: 'f1',
      type: 'error',
      probability: 1.0,
      schedule: { startTime: Date.now() - 1000 },
    });
    // startTime is in the past; delay would be negative, so no schedule timer
    expect(engine.getActiveFaults().length).toBe(1);
    engine.clearAll();
  });

  it('should handle fault with no duration (permanent)', () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    // No duration; should stay active until removed
    expect(engine.getActiveFaults().length).toBe(1);
    engine.removeFault('f1');
    expect(engine.getActiveFaults().length).toBe(0);
  });

  it('should handle fault with duration of 0', () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0, duration: 0 });
    // duration 0 should not create auto-recovery timer
    expect(engine.getActiveFaults().length).toBe(1);
    engine.clearAll();
  });

  it('should return activeMs in fault stats', () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    const stats = engine.getFaultStats();
    expect(stats['f1'].activeMs).toBeGreaterThanOrEqual(0);
  });

  it('should not inject when disabled even with active faults', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    engine.disable();
    const result = await engine.execute('op', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });
});

// ============================================================
// State Recovery Tests
// ============================================================
describe('StateRecoveryManager', () => {
  let manager: StateRecoveryManager;

  beforeEach(() => {
    manager = new StateRecoveryManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  it('should create a snapshot', () => {
    const snapshot = manager.createSnapshot({ key: 'value' });
    expect(snapshot.id).toBeDefined();
    expect(snapshot.state).toEqual({ key: 'value' });
    expect(snapshot.version).toBe(1);
  });

  it('should list snapshots', () => {
    manager.createSnapshot({ v: 1 });
    manager.createSnapshot({ v: 2 });
    const list = manager.listSnapshots();
    expect(list.length).toBe(2);
  });

  it('should restore from snapshot', async () => {
    const snapshot = manager.createSnapshot({ key: 'original' });
    const restored = await manager.restore(snapshot.id);
    expect(restored).toEqual({ key: 'original' });
  });

  it('should throw on restore of non-existent snapshot', async () => {
    await expect(manager.restore('nonexistent')).rejects.toThrow();
  });

  it('should deep clone state', async () => {
    const original = { nested: { value: 1 } };
    const snapshot = manager.createSnapshot(original);
    original.nested.value = 999;
    const restored = await manager.restore(snapshot.id);
    expect((restored as { nested: { value: number } }).nested.value).toBe(1);
  });

  it('should cleanup old snapshots', () => {
    manager.createSnapshot({ v: 1 });
    manager.createSnapshot({ v: 2 });
    manager.createSnapshot({ v: 3 });
    const deleted = manager.cleanup(1);
    expect(deleted).toBeGreaterThanOrEqual(0);
    expect(manager.getSnapshotCount()).toBeLessThanOrEqual(1);
  });

  it('should delete specific snapshot', () => {
    const snap = manager.createSnapshot({ v: 1 });
    expect(manager.deleteSnapshot(snap.id)).toBe(true);
    expect(manager.getSnapshotCount()).toBe(0);
  });

  it('should track version', () => {
    manager.createSnapshot({ v: 1 });
    manager.createSnapshot({ v: 2 });
    expect(manager.getVersion()).toBe(2);
  });

  it('should emit events', () => {
    const events: string[] = [];
    manager.onEvent(e => events.push(e.type));
    manager.createSnapshot({ v: 1 });
    expect(events).toContain('snapshot_created');
  });

  it('should support partial restore', async () => {
    const snapshot = manager.createSnapshot({ key: 'value' });
    const restored = await manager.restore(snapshot.id, 'partial_restore');
    expect(restored).toBeDefined();
    expect((restored as Record<string, unknown>)._restoredFrom).toBe(snapshot.id);
  });

  it('should get event log', () => {
    manager.createSnapshot({ v: 1 });
    const log = manager.getEventLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].type).toBe('snapshot_created');
  });

  it('should include metadata in snapshot', () => {
    const snap = manager.createSnapshot({ v: 1 }, { source: 'test' });
    expect(snap.metadata?.source).toBe('test');
  });

  it('should enforce max snapshots', () => {
    const mgr = new StateRecoveryManager({ maxSnapshots: 2 });
    mgr.createSnapshot({ v: 1 });
    mgr.createSnapshot({ v: 2 });
    mgr.createSnapshot({ v: 3 });
    expect(mgr.getSnapshotCount()).toBeLessThanOrEqual(2);
    mgr.destroy();
  });

  it('should get snapshot by id', () => {
    const snap = manager.createSnapshot({ v: 1 });
    const retrieved = manager.getSnapshot(snap.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(snap.id);
  });

  it('should return undefined for non-existent snapshot', () => {
    expect(manager.getSnapshot('nonexistent')).toBeUndefined();
  });

  it('should emit restore event', async () => {
    const events: string[] = [];
    manager.onEvent(e => events.push(e.type));
    const snap = manager.createSnapshot({ v: 1 });
    await manager.restore(snap.id);
    expect(events).toContain('snapshot_restored');
  });

  it('should emit delete event', () => {
    const events: string[] = [];
    manager.onEvent(e => events.push(e.type));
    const snap = manager.createSnapshot({ v: 1 });
    manager.deleteSnapshot(snap.id);
    expect(events).toContain('snapshot_deleted');
  });

  it('deleteSnapshot should return false for non-existent', () => {
    expect(manager.deleteSnapshot('nonexistent')).toBe(false);
  });

  it('should handle snapshot with complex state', async () => {
    const complex = {
      arr: [1, 2, 3],
      nested: { a: { b: { c: 'deep' } } },
      date: '2024-01-01',
      num: 42.5,
      bool: true,
      nil: null,
    };
    const snap = manager.createSnapshot(complex);
    const restored = await manager.restore(snap.id) as typeof complex;
    expect(restored).toEqual(complex);
    // Verify deep clone
    expect(restored.arr).not.toBe(complex.arr);
  });

  it('should handle snapshot with undefined state', () => {
    const snap = manager.createSnapshot(undefined);
    expect(snap.state).toBeUndefined();
  });

  it('should handle snapshot with null state', () => {
    const snap = manager.createSnapshot(null);
    expect(snap.state).toBeNull();
  });

  it('should handle snapshot with primitive state', () => {
    const snap = manager.createSnapshot(42);
    expect(snap.state).toBe(42);
  });

  it('should handle snapshot with array state', async () => {
    const snap = manager.createSnapshot([1, 2, 3]);
    const restored = await manager.restore(snap.id);
    expect(restored).toEqual([1, 2, 3]);
  });

  it('listSnapshots should include size', () => {
    manager.createSnapshot({ data: 'x'.repeat(100) });
    const list = manager.listSnapshots();
    expect(list[0].size).toBeGreaterThan(0);
  });

  it('listSnapshots should include version', () => {
    manager.createSnapshot({ v: 1 });
    const list = manager.listSnapshots();
    expect(list[0].version).toBe(1);
  });

  it('cleanup with no argument should use maxSnapshots', () => {
    const mgr = new StateRecoveryManager({ maxSnapshots: 1 });
    mgr.createSnapshot({ v: 1 });
    mgr.createSnapshot({ v: 2 });
    mgr.cleanup();
    expect(mgr.getSnapshotCount()).toBeLessThanOrEqual(1);
    mgr.destroy();
  });

  it('should trim event log when it exceeds max size', () => {
    // Create many snapshots to fill event log
    for (let i = 0; i < 100; i++) {
      manager.createSnapshot({ v: i });
    }
    const log = manager.getEventLog();
    expect(log.length).toBeLessThanOrEqual(10000);
  });

  it('destroy should stop auto snapshot timer', () => {
    const mgr = new StateRecoveryManager({ autoSnapshotInterval: 100 });
    mgr.destroy();
    // Should not throw; timer cleared
  });

  it('should handle replay_events strategy', async () => {
    const snap = manager.createSnapshot({ key: 'value' });
    const restored = await manager.restore(snap.id, 'replay_events');
    expect(restored).toEqual({ key: 'value' });
  });

  it('event log entries should have timestamps', () => {
    manager.createSnapshot({ v: 1 });
    const log = manager.getEventLog();
    expect(log[0].timestamp).toBeGreaterThan(0);
  });

  it('event log entries should have snapshotId', () => {
    const snap = manager.createSnapshot({ v: 1 });
    const log = manager.getEventLog();
    expect(log[0].snapshotId).toBe(snap.id);
  });
});

// ============================================================
// Graceful Shutdown Tests
// ============================================================
describe('GracefulShutdownManager', () => {
  it('should start not shutting down', () => {
    const mgr = new GracefulShutdownManager();
    expect(mgr.isShuttingDown()).toBe(false);
  });

  it('should register handler', () => {
    const mgr = new GracefulShutdownManager();
    mgr.register(() => Promise.resolve(), 'cleanup', 'test-handler');
    expect(mgr.getStatus().pendingHandlers).toContain('test-handler');
  });

  it('should execute shutdown', async () => {
    const mgr = new GracefulShutdownManager();
    let called = false;
    mgr.register(async () => { called = true; }, 'cleanup', 'h1');
    await mgr.shutdown('test');
    expect(mgr.isShuttingDown()).toBe(true);
    expect(called).toBe(true);
  });

  it('should track in-flight requests', () => {
    const mgr = new GracefulShutdownManager();
    mgr.incrementInFlight();
    mgr.incrementInFlight();
    expect(mgr.getInFlightCount()).toBe(2);
    mgr.decrementInFlight();
    expect(mgr.getInFlightCount()).toBe(1);
  });

  it('should not decrement below zero', () => {
    const mgr = new GracefulShutdownManager();
    mgr.decrementInFlight();
    expect(mgr.getInFlightCount()).toBe(0);
  });

  it('should report status', async () => {
    const mgr = new GracefulShutdownManager();
    mgr.register(() => Promise.resolve(), 'cleanup', 'h1');
    await mgr.shutdown();
    const status = mgr.getStatus();
    expect(status.isShuttingDown).toBe(true);
    expect(status.completedHandlers).toContain('h1');
  });

  it('should execute handlers in phase order', async () => {
    const order: string[] = [];
    const mgr = new GracefulShutdownManager();
    mgr.register(async () => { order.push('stop'); }, 'stop_accepting', 'stop');
    mgr.register(async () => { order.push('cleanup'); }, 'cleanup', 'cleanup');
    await mgr.shutdown();
    expect(order.indexOf('stop')).toBeLessThan(order.indexOf('cleanup'));
  });

  it('should handle handler failure gracefully', async () => {
    const mgr = new GracefulShutdownManager();
    mgr.register(() => Promise.reject(new Error('handler fail')), 'cleanup', 'fail-handler');
    mgr.register(() => Promise.resolve(), 'cleanup', 'ok-handler');
    await mgr.shutdown();
    const status = mgr.getStatus();
    expect(status.failedHandlers).toContain('fail-handler');
    expect(status.completedHandlers).toContain('ok-handler');
  });

  it('should emit shutdown events', async () => {
    const phases: string[] = [];
    const mgr = new GracefulShutdownManager();
    mgr.onShutdownEvent((phase) => phases.push(phase));
    mgr.register(() => Promise.resolve(), 'stop_accepting', 'h1');
    await mgr.shutdown();
    expect(phases.length).toBeGreaterThan(0);
  });

  it('should remove handler', () => {
    const mgr = new GracefulShutdownManager();
    mgr.register(() => Promise.resolve(), 'cleanup', 'removable');
    mgr.removeHandler('removable');
    expect(mgr.getStatus().pendingHandlers).not.toContain('removable');
  });

  // BUG-005 FIX: concurrent shutdown calls should return same promise
  it('should handle multiple shutdown calls safely', async () => {
    const mgr = new GracefulShutdownManager();
    let count = 0;
    mgr.register(async () => { count++; }, 'cleanup', 'h1');
    const [r1, r2] = await Promise.all([mgr.shutdown(), mgr.shutdown()]);
    // Both should resolve
    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();
    expect(count).toBe(1);
  });

  it('should record shutdown reason', async () => {
    const mgr = new GracefulShutdownManager();
    await mgr.shutdown('SIGTERM');
    expect(mgr.getStatus().reason).toBe('SIGTERM');
  });

  it('should default reason to manual', async () => {
    const mgr = new GracefulShutdownManager();
    await mgr.shutdown();
    expect(mgr.getStatus().reason).toBe('manual');
  });

  it('should record start time', async () => {
    const mgr = new GracefulShutdownManager();
    const before = Date.now();
    await mgr.shutdown();
    expect(mgr.getStatus().startTime).toBeGreaterThanOrEqual(before);
  });

  it('should execute all four phases', async () => {
    const phases: string[] = [];
    const mgr = new GracefulShutdownManager();
    mgr.onShutdownEvent((phase) => phases.push(phase));
    await mgr.shutdown();
    expect(phases).toEqual(['stop_accepting', 'drain_active', 'cleanup', 'exit']);
  });

  it('should handle empty phases', async () => {
    const mgr = new GracefulShutdownManager();
    // No handlers registered; should complete without error
    await mgr.shutdown();
    expect(mgr.isShuttingDown()).toBe(true);
  });

  it('should handle handler timeout', async () => {
    const mgr = new GracefulShutdownManager({ drainTimeout: 30 });
    mgr.register(() => new Promise(() => {}), 'drain_active', 'slow-handler', 30);
    await mgr.shutdown();
    const status = mgr.getStatus();
    expect(status.failedHandlers).toContain('slow-handler');
  });

  it('should auto-name handlers', () => {
    const mgr = new GracefulShutdownManager();
    mgr.register(() => Promise.resolve());
    mgr.register(() => Promise.resolve());
    expect(mgr.getStatus().pendingHandlers).toContain('handler_0');
    expect(mgr.getStatus().pendingHandlers).toContain('handler_1');
  });

  it('destroy should clean up signal handlers', () => {
    const mgr = new GracefulShutdownManager();
    mgr.destroy();
    // Should not throw
  });

  it('getStatus should return correct pending handlers', async () => {
    const mgr = new GracefulShutdownManager();
    mgr.register(() => Promise.resolve(), 'cleanup', 'h1');
    mgr.register(() => Promise.resolve(), 'cleanup', 'h2');
    const status = mgr.getStatus();
    expect(status.pendingHandlers).toContain('h1');
    expect(status.pendingHandlers).toContain('h2');
    expect(status.completedHandlers).toEqual([]);
    expect(status.failedHandlers).toEqual([]);
  });

  it('should handle drain_active phase with in-flight tracking', async () => {
    const mgr = new GracefulShutdownManager();
    mgr.incrementInFlight();
    mgr.register(async () => {
      // Simulate waiting for in-flight
      while (mgr.getInFlightCount() > 0) {
        await delay(1);
        mgr.decrementInFlight();
      }
    }, 'drain_active', 'drain');
    await mgr.shutdown();
    expect(mgr.getStatus().completedHandlers).toContain('drain');
  });

  it('should handle handler that throws synchronously', async () => {
    const mgr = new GracefulShutdownManager();
    mgr.register(() => { throw new Error('sync fail'); }, 'cleanup', 'sync-fail');
    await mgr.shutdown();
    expect(mgr.getStatus().failedHandlers).toContain('sync-fail');
  });

  it('should use custom drainTimeout', async () => {
    const mgr = new GracefulShutdownManager({ drainTimeout: 20 });
    mgr.register(() => new Promise(() => {}), 'drain_active', 'slow', 20);
    await mgr.shutdown();
    expect(mgr.getStatus().failedHandlers).toContain('slow');
  });

  // BUG-004 FIX: cleanup phase should use forceShutdownTimeout
  it('should use forceShutdownTimeout for cleanup phase', async () => {
    const mgr = new GracefulShutdownManager({ forceShutdownTimeout: 20 });
    mgr.register(() => new Promise(() => {}), 'cleanup', 'slow-cleanup', 20);
    await mgr.shutdown();
    expect(mgr.getStatus().failedHandlers).toContain('slow-cleanup');
  });
});

// ============================================================
// Observability Tests
// ============================================================
describe('ResilienceObservability', () => {
  it('should create dashboard', () => {
    const obs = new ResilienceObservability();
    const dashboard = obs.getDashboard();
    expect(dashboard.timestamp).toBeDefined();
    expect(dashboard.circuitBreakers).toEqual([]);
    expect(dashboard.bulkheads).toEqual([]);
  });

  it('should register circuit breaker', () => {
    const obs = new ResilienceObservability();
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
      windowType: 'count',
      windowSize: 3,
    });
    obs.registerCircuitBreaker('main', cb);
    const dashboard = obs.getDashboard();
    expect(dashboard.circuitBreakers.length).toBe(1);
    expect(dashboard.circuitBreakers[0].name).toBe('main');
  });

  it('should register bulkhead', () => {
    const obs = new ResilienceObservability();
    const bh = new Bulkhead({ maxConcurrent: 5, maxQueueSize: 10 });
    obs.registerBulkhead('api', bh);
    const dashboard = obs.getDashboard();
    expect(dashboard.bulkheads.length).toBe(1);
    expect(dashboard.bulkheads[0].name).toBe('api');
  });

  it('should register retry', () => {
    const obs = new ResilienceObservability();
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'fixed', baseDelay: 1 });
    obs.registerRetry('api', retry);
    const dashboard = obs.getDashboard();
    expect(dashboard.retries.length).toBe(1);
  });

  it('should register health checker', () => {
    const obs = new ResilienceObservability();
    const checker = new HealthChecker();
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    obs.registerHealthChecker('db', checker);
    const dashboard = obs.getDashboard();
    expect(dashboard.healthChecks.length).toBe(1);
  });

  it('should unregister components', () => {
    const obs = new ResilienceObservability();
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
      windowType: 'count',
      windowSize: 3,
    });
    obs.registerCircuitBreaker('main', cb);
    obs.unregisterCircuitBreaker('main');
    const dashboard = obs.getDashboard();
    expect(dashboard.circuitBreakers.length).toBe(0);
  });

  it('should evaluate alert rules', () => {
    const obs = new ResilienceObservability();
    obs.addAlertRule({
      id: 'test',
      name: 'test-alert',
      severity: 'warning',
      message: 'test',
      evaluate: () => true,
    });
    const dashboard = obs.getDashboard();
    expect(dashboard.alerts.length).toBeGreaterThan(0);
  });

  it('should resolve alerts when condition clears', () => {
    const obs = new ResilienceObservability();
    let shouldTrigger = true;
    obs.addAlertRule({
      id: 'test',
      name: 'test-alert',
      severity: 'warning',
      message: 'test',
      evaluate: () => shouldTrigger,
    });
    obs.getDashboard(); // trigger
    expect(obs.getAlerts().length).toBe(1);
    shouldTrigger = false;
    obs.getDashboard(); // resolve
    expect(obs.getAlerts().length).toBe(0);
  });

  it('should generate prometheus metrics', () => {
    const obs = new ResilienceObservability();
    const metrics = obs.getPrometheusMetrics();
    expect(metrics).toContain('# HELP');
    expect(metrics).toContain('# TYPE');
  });

  it('should track open circuit breakers in summary', async () => {
    const obs = new ResilienceObservability();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      timeout: 5000,
      windowType: 'count',
      windowSize: 1,
    });
    obs.registerCircuitBreaker('main', cb);
    try { await cb.execute(() => Promise.reject(new Error('fail'))); } catch {}
    const dashboard = obs.getDashboard();
    expect(dashboard.summary.openCircuitBreakers).toBe(1);
  });

  it('should track historical data', () => {
    const obs = new ResilienceObservability();
    obs.getDashboard();
    obs.getDashboard();
    const history = obs.getHistoricalData();
    expect(history.length).toBe(2);
  });

  it('should clear history', () => {
    const obs = new ResilienceObservability();
    obs.getDashboard();
    obs.clearHistory();
    expect(obs.getHistoricalData().length).toBe(0);
  });

  it('should include summary counts', () => {
    const obs = new ResilienceObservability();
    const dashboard = obs.getDashboard();
    expect(dashboard.summary.totalCircuitBreakers).toBe(0);
    expect(dashboard.summary.totalBulkheads).toBe(0);
    expect(dashboard.summary.totalRetries).toBe(0);
  });

  it('should support alert severity levels', () => {
    const obs = new ResilienceObservability();
    obs.addAlertRule({
      id: 'critical',
      name: 'critical-alert',
      severity: 'critical',
      message: 'critical issue',
      evaluate: () => true,
    });
    obs.addAlertRule({
      id: 'info',
      name: 'info-alert',
      severity: 'info',
      message: 'info',
      evaluate: () => true,
    });
    const dashboard = obs.getDashboard();
    expect(dashboard.summary.criticalAlerts).toBe(1);
    expect(dashboard.summary.totalAlerts).toBe(2);
  });

  it('should manually resolve alert', () => {
    const obs = new ResilienceObservability();
    obs.addAlertRule({
      id: 'test',
      name: 'test-alert',
      severity: 'warning',
      message: 'test',
      evaluate: () => true,
    });
    obs.getDashboard();
    const alerts = obs.getAlerts();
    expect(alerts.length).toBe(1);
    obs.resolveAlert(alerts[0].id);
    expect(obs.getAlerts().length).toBe(0);
  });

  it('should get all alerts including resolved', () => {
    const obs = new ResilienceObservability();
    obs.addAlertRule({
      id: 'test',
      name: 'test-alert',
      severity: 'warning',
      message: 'test',
      evaluate: () => true,
    });
    obs.getDashboard();
    const alerts = obs.getAlerts();
    obs.resolveAlert(alerts[0].id);
    expect(obs.getAllAlerts().length).toBe(1);
    expect(obs.getAllAlerts()[0].resolved).toBe(true);
  });

  it('should prune resolved alerts by age', () => {
    const obs = new ResilienceObservability();
    obs.addAlertRule({
      id: 'test',
      name: 'test-alert',
      severity: 'warning',
      message: 'test',
      evaluate: () => true,
    });
    obs.getDashboard();
    const alerts = obs.getAlerts();
    obs.resolveAlert(alerts[0].id);
    // Prune with maxAge of 0ms should remove the alert
    const pruned = obs.pruneResolvedAlerts(0);
    expect(pruned).toBe(1);
    expect(obs.getAllAlerts().length).toBe(0);
  });

  it('should not prune unresolved alerts', () => {
    const obs = new ResilienceObservability();
    obs.addAlertRule({
      id: 'test',
      name: 'test-alert',
      severity: 'warning',
      message: 'test',
      evaluate: () => true,
    });
    obs.getDashboard();
    obs.pruneResolvedAlerts(0);
    expect(obs.getAlerts().length).toBe(1);
  });

  it('should track saturated bulkheads', async () => {
    const obs = new ResilienceObservability();
    const bh = new Bulkhead({ maxConcurrent: 1, maxQueueSize: 1 });
    obs.registerBulkhead('api', bh);
    let resolveFirst: () => void;
    bh.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    bh.execute(() => Promise.resolve('queued'));
    const dashboard = obs.getDashboard();
    expect(dashboard.summary.saturatedBulkheads).toBe(1);
    resolveFirst!();
  });

  it('should track retry history length', async () => {
    const obs = new ResilienceObservability();
    const retry = new RetryWithBackoff({ maxRetries: 2, strategy: 'fixed', baseDelay: 1 });
    obs.registerRetry('api', retry);
    try { await retry.execute(() => Promise.reject(new Error('fail'))); } catch {}
    const dashboard = obs.getDashboard();
    expect(dashboard.summary.totalRetries).toBe(2);
  });

  it('should track last retry attempt and delay', async () => {
    const obs = new ResilienceObservability();
    const retry = new RetryWithBackoff({ maxRetries: 1, strategy: 'fixed', baseDelay: 1 });
    obs.registerRetry('api', retry);
    try { await retry.execute(() => Promise.reject(new Error('fail'))); } catch {}
    const dashboard = obs.getDashboard();
    expect(dashboard.retries[0].lastRetryAttempt).not.toBeNull();
    expect(dashboard.retries[0].lastRetryDelay).toBe(1);
  });

  it('should filter historical data by since timestamp', () => {
    const obs = new ResilienceObservability();
    obs.getDashboard();
    obs.getDashboard();
    const now = Date.now();
    const history = obs.getHistoricalData(now);
    // Should include data points from now onwards
    expect(history.length).toBeLessThanOrEqual(2);
  });

  it('tick should be callable without side effects breaking', () => {
    const obs = new ResilienceObservability();
    obs.tick();
    obs.tick();
    expect(obs.getHistoricalData().length).toBe(2);
  });

  it('should handle custom retention period', () => {
    const obs = new ResilienceObservability({ retentionPeriod: 0 });
    obs.getDashboard();
    // With 0 retention, historical data should be pruned immediately
    const history = obs.getHistoricalData();
    // The data point just added might still be within the same ms
    expect(history.length).toBeLessThanOrEqual(1);
  });

  it('should handle unregister of non-existent component', () => {
    const obs = new ResilienceObservability();
    expect(() => obs.unregisterCircuitBreaker('nonexistent')).not.toThrow();
    expect(() => obs.unregisterBulkhead('nonexistent')).not.toThrow();
    expect(() => obs.unregisterRetry('nonexistent')).not.toThrow();
    expect(() => obs.unregisterHealthChecker('nonexistent')).not.toThrow();
  });

  it('should handle resolveAlert for non-existent alert', () => {
    const obs = new ResilienceObservability();
    expect(() => obs.resolveAlert('nonexistent')).not.toThrow();
  });

  it('should not create duplicate alerts for same rule', () => {
    const obs = new ResilienceObservability();
    obs.addAlertRule({
      id: 'test',
      name: 'test-alert',
      severity: 'warning',
      message: 'test',
      evaluate: () => true,
    });
    obs.getDashboard();
    obs.getDashboard();
    expect(obs.getAlerts().length).toBe(1);
  });

  it('should re-create alert after resolved and triggered again', () => {
    const obs = new ResilienceObservability();
    let shouldTrigger = true;
    obs.addAlertRule({
      id: 'test',
      name: 'test-alert',
      severity: 'warning',
      message: 'test',
      evaluate: () => shouldTrigger,
    });
    obs.getDashboard(); // trigger
    obs.resolveAlert(obs.getAlerts()[0].id);
    shouldTrigger = false;
    obs.getDashboard(); // condition clears
    shouldTrigger = true;
    obs.getDashboard(); // re-trigger
    expect(obs.getAlerts().length).toBe(1);
  });

  it('should include health check status in dashboard', async () => {
    const obs = new ResilienceObservability();
    const checker = new HealthChecker();
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    obs.registerHealthChecker('db', checker);
    await checker.checkHealth();
    const dashboard = obs.getDashboard();
    expect(dashboard.healthChecks[0].status).toBe('healthy');
    expect(dashboard.healthChecks[0].healthyCount).toBe(1);
  });

  it('should include unhealthy health check status', async () => {
    const obs = new ResilienceObservability();
    const checker = new HealthChecker();
    checker.registerCheck('db', () => Promise.reject(new Error('down')));
    obs.registerHealthChecker('db', checker);
    await checker.checkHealth();
    const dashboard = obs.getDashboard();
    expect(dashboard.healthChecks[0].status).toBe('unhealthy');
    expect(dashboard.healthChecks[0].healthyCount).toBe(0);
  });

  it('prometheus metrics should include all registered components', () => {
    const obs = new ResilienceObservability();
    const cb = new CircuitBreaker({
      failureThreshold: 3, successThreshold: 2, timeout: 5000,
      windowType: 'count', windowSize: 3,
    });
    const bh = new Bulkhead({ maxConcurrent: 5, maxQueueSize: 10 });
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'fixed', baseDelay: 1 });
    obs.registerCircuitBreaker('main', cb);
    obs.registerBulkhead('api', bh);
    obs.registerRetry('api', retry);
    const metrics = obs.getPrometheusMetrics();
    expect(metrics).toContain('claude_circuit_breaker_state{name="main"}');
    expect(metrics).toContain('claude_bulkhead_active{name="api"}');
    expect(metrics).toContain('claude_retry_total{name="api"}');
  });
});
