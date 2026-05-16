import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
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

  test('should start in closed state', () => {
    expect(cb.getState()).toBe('closed');
  });

  test('should remain closed on successful execution', async () => {
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getState()).toBe('closed');
  });

  test('should open after reaching failure threshold', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    expect(cb.getState()).toBe('open');
  });

  test('should reject calls when open', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitBreakerOpenError);
  });

  test('should transition to half-open after timeout', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    expect(cb.getState()).toBe('open');
    await delay(150);
    expect(cb.getState()).toBe('half-open');
  });

  test('should close after enough successes in half-open', async () => {
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

  test('should reopen on failure in half-open', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    await delay(150);
    expect(cb.getState()).toBe('half-open');
    try { await cb.execute(failFn); } catch {}
    expect(cb.getState()).toBe('open');
  });

  test('forceOpen should transition to open state', () => {
    cb.forceOpen();
    expect(cb.getState()).toBe('open');
  });

  test('forceClose should transition to closed state', async () => {
    const failFn = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failFn); } catch {}
    }
    cb.forceClose();
    expect(cb.getState()).toBe('closed');
  });

  test('reset should clear all counters and state', async () => {
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

  test('should emit stateChange event', async () => {
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

  test('should emit failure event', async () => {
    let failureEmitted = false;
    cb.on('failure', () => { failureEmitted = true; });
    try { await cb.execute(() => Promise.reject(new Error('fail'))); } catch {}
    expect(failureEmitted).toBe(true);
  });

  test('should emit success event', async () => {
    let successEmitted = false;
    cb.on('success', () => { successEmitted = true; });
    await cb.execute(() => Promise.resolve('ok'));
    expect(successEmitted).toBe(true);
  });

  test('should track metrics correctly', async () => {
    await cb.execute(() => Promise.resolve('ok'));
    await cb.execute(() => Promise.resolve('ok'));
    try { await cb.execute(() => Promise.reject(new Error('fail'))); } catch {}
    const metrics = cb.getMetrics();
    expect(metrics.successCount).toBe(2);
    expect(metrics.failureCount).toBe(1);
    expect(metrics.lastFailureTime).not.toBeNull();
  });

  test('should work with time-based window', async () => {
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

  test('off should remove event listener', async () => {
    let count = 0;
    const handler = () => { count++; };
    cb.on('success', handler);
    await cb.execute(() => Promise.resolve('ok'));
    expect(count).toBe(1);
    cb.off('success', handler);
    await cb.execute(() => Promise.resolve('ok'));
    expect(count).toBe(1);
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

  test('should allow execution within limit', async () => {
    const result = await bulkhead.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  test('should track active count', async () => {
    let resolveFirst: () => void;
    const first = bulkhead.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    expect(bulkhead.getActiveCount()).toBe(1);
    resolveFirst!();
    await first;
    expect(bulkhead.getActiveCount()).toBe(0);
  });

  test('should report available slots', () => {
    expect(bulkhead.getAvailableSlots()).toBe(2);
  });

  test('should queue excess requests', async () => {
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

  test('should reject when full', async () => {
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

  test('should timeout queued items', async () => {
    const bh = new Bulkhead({ maxConcurrent: 1, maxQueueSize: 1, queueTimeout: 50 });
    let resolveFirst: () => void;
    bh.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    const p = bh.execute(() => Promise.resolve('queued'));
    await expect(p).rejects.toThrow(BulkheadQueueTimeoutError);
    resolveFirst!();
  });

  test('should report queue size correctly', async () => {
    let resolveFirst: () => void;
    bulkhead.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    bulkhead.execute(() => new Promise<void>(resolve => { resolveFirst = resolve; }));
    bulkhead.execute(() => Promise.resolve('q1'));
    expect(bulkhead.getQueueSize()).toBe(1);
    resolveFirst!();
  });
});

// ============================================================
// Retry with Backoff Tests
// ============================================================
describe('RetryWithBackoff', () => {
  test('should succeed on first attempt', async () => {
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'fixed', baseDelay: 1 });
    const result = await retry.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  test('should retry on failure and succeed', async () => {
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

  test('should throw after max retries', async () => {
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

  test('should use exponential backoff delays', async () => {
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

  test('should use linear backoff delays', async () => {
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

  test('should use fixed backoff delays', async () => {
    const delays: number[] = [];
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'fixed', baseDelay: 5 });
    retry.onRetry((_attempt, _error, delay) => delays.push(delay));

    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}

    expect(delays.every(d => d === 5)).toBe(true);
  });

  test('should respect max delay', async () => {
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

  test('should filter by retryable error types', async () => {
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

  test('should filter by retryable patterns', async () => {
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

  test('should filter by custom predicate', async () => {
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

  test('should track retry history', async () => {
    const retry = new RetryWithBackoff({ maxRetries: 2, strategy: 'fixed', baseDelay: 1 });
    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}
    const history = retry.getHistory();
    expect(history.length).toBe(2);
    expect(history[0].attempt).toBe(1);
    expect(history[1].attempt).toBe(2);
  });

  test('should clear history', async () => {
    const retry = new RetryWithBackoff({ maxRetries: 2, strategy: 'fixed', baseDelay: 1 });
    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}
    retry.clearHistory();
    expect(retry.getHistory().length).toBe(0);
  });

  test('should support custom delay function', async () => {
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

  test('should use exponential_with_jitter strategy', async () => {
    const delays: number[] = [];
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'exponential_with_jitter', baseDelay: 1, jitterFactor: 0.5 });
    retry.onRetry((_attempt, _error, delay) => delays.push(delay));
    try {
      await retry.execute(() => Promise.reject(new Error('fail')));
    } catch {}
    expect(delays.length).toBe(3);
    // All delays should be positive
    expect(delays.every(d => d > 0)).toBe(true);
  });
});

// ============================================================
// Timeout Guard Tests
// ============================================================
describe('TimeoutGuard', () => {
  test('should resolve before timeout', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const result = await guard.wrap(() => Promise.resolve('ok'), 1000);
    expect(result).toBe('ok');
  });

  test('should reject on timeout', async () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 30, strategy: 'reject' });
    await expect(
      guard.wrap(() => new Promise(() => {}), 30),
    ).rejects.toThrow(TimeoutError);
  });

  test('should resolve with default on timeout', async () => {
    const guard = new TimeoutGuard({
      defaultTimeoutMs: 30,
      strategy: 'resolve_with_default',
      defaultReturnValue: 'default',
    });
    const result = await guard.wrap(() => new Promise(() => {}), 30);
    expect(result).toBe('default');
  });

  test('should create timer', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const timer = guard.createTimer(1000, 'test');
    expect(timer).toBeDefined();
    expect(timer.isExpired()).toBe(false);
    guard.cancelTimer('test');
  });

  test('should extend timer', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const timer = guard.createTimer(1000, 'extendable');
    expect(timer.getRemaining()).toBeGreaterThan(0);
    timer.extend(2000);
    guard.cancelTimer('extendable');
  });

  test('should cancel timer', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const timer = guard.createTimer(1000, 'cancelable');
    timer.cancel();
    expect(timer.isExpired()).toBe(true);
  });

  test('should cancel all timers', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    guard.createTimer(1000, 't1');
    guard.createTimer(1000, 't2');
    expect(guard.getActiveTimerCount()).toBe(2);
    guard.cancelAll();
    expect(guard.getActiveTimerCount()).toBe(0);
  });

  test('should fire warning callback', async () => {
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

  test('should parse string timeout in createTimer', () => {
    const guard = new TimeoutGuard({ defaultTimeoutMs: 5000, strategy: 'reject' });
    const timer = guard.createTimer('1000', 'string-timer');
    expect(timer).toBeDefined();
    guard.cancelTimer('string-timer');
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

  test('should register a check', () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    const health = checker.getComponentHealth('db');
    expect(health.name).toBe('db');
  });

  test('should report healthy for passing check', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    const report = await checker.checkHealth();
    expect(report.components['db'].level).toBe('healthy');
  });

  test('should report unhealthy for failing check', async () => {
    checker.registerCheck('db', () => Promise.reject(new Error('down')));
    const report = await checker.checkHealth();
    expect(report.components['db'].level).toBe('unhealthy');
  });

  test('should report overall status as healthy', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    checker.registerCheck('cache', () => Promise.resolve({ healthy: true }));
    const report = await checker.checkHealth();
    expect(report.status).toBe('healthy');
  });

  test('should report overall status as unhealthy', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    checker.registerCheck('cache', () => Promise.reject(new Error('down')));
    const report = await checker.checkHealth();
    expect(report.status).toBe('unhealthy');
  });

  test('should track consecutive failures', async () => {
    checker.registerCheck('db', () => Promise.reject(new Error('down')));
    await checker.checkHealth();
    await checker.checkHealth();
    const health = checker.getComponentHealth('db');
    expect(health.consecutiveFailures).toBe(2);
  });

  test('should track consecutive successes', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    await checker.checkHealth();
    await checker.checkHealth();
    const health = checker.getComponentHealth('db');
    expect(health.consecutiveSuccesses).toBe(2);
  });

  test('should emit health change events', async () => {
    const changes: string[] = [];
    checker.onHealthChange((name, _old, _new) => changes.push(name));
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    await checker.checkHealth();
    expect(changes.length).toBeGreaterThan(0);
  });

  test('should respect check timeout', async () => {
    checker.registerCheck('slow', () => new Promise(() => {}), 'liveness', undefined, 30);
    const report = await checker.checkHealth();
    expect(report.components['slow'].level).toBe('unhealthy');
  });

  test('should remove check', () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    checker.removeCheck('db');
    const health = checker.getComponentHealth('db');
    expect(health.level).toBe('unknown');
  });

  test('should support different check types', () => {
    checker.registerCheck('liveness', () => Promise.resolve({ healthy: true }), 'liveness');
    checker.registerCheck('readiness', () => Promise.resolve({ healthy: true }), 'readiness');
    checker.registerCheck('startup', () => Promise.resolve({ healthy: true }), 'startup');
    expect(checker.getComponentHealth('liveness').type).toBe('liveness');
    expect(checker.getComponentHealth('readiness').type).toBe('readiness');
    expect(checker.getComponentHealth('startup').type).toBe('startup');
  });

  test('should report unknown for no checks', async () => {
    const report = await checker.checkHealth();
    expect(report.status).toBe('unknown');
  });

  test('should include timestamp in report', async () => {
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    const report = await checker.checkHealth();
    expect(report.timestamp).toBeDefined();
    expect(report.timestamp).toBeGreaterThan(0);
  });
});

// ============================================================
// Fallback Provider Tests
// ============================================================
describe('FallbackProvider', () => {
  test('should return primary result on success', async () => {
    const fp = new FallbackProvider<string>();
    const result = await fp.execute(() => Promise.resolve('primary'));
    expect(result).toBe('primary');
  });

  test('should use default_value fallback', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback' });
    const result = await fp.execute(
      () => Promise.reject(new Error('fail')),
    );
    expect(result).toBe('fallback');
  });

  test('should use alternative_function fallback', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'alternative_function', alternativeFn: () => Promise.resolve('alt') });
    const result = await fp.execute(
      () => Promise.reject(new Error('fail')),
    );
    expect(result).toBe('alt');
  });

  test('should use cached_value fallback', async () => {
    const fp = new FallbackProvider<string>();
    fp.setCachedValue('cached');
    fp.addFallback({ strategy: 'cached_value' });
    const result = await fp.execute(
      () => Promise.reject(new Error('fail')),
    );
    expect(result).toBe('cached');
  });

  test('should throw_custom_error fallback', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'throw_custom_error', customError: new Error('custom') });
    await expect(
      fp.execute(() => Promise.reject(new Error('fail'))),
    ).rejects.toThrow('custom');
  });

  test('should match fallback by error type', async () => {
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

  test('should match fallback by error pattern', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback', errorPattern: /timeout/i });
    const result = await fp.execute(
      () => Promise.reject(new Error('Connection timeout')),
    );
    expect(result).toBe('fallback');
  });

  test('should track metrics', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback' });
    await fp.execute(() => Promise.resolve('primary'));
    try { await fp.execute(() => Promise.reject(new Error('fail'))); } catch {}
    const metrics = fp.getMetrics();
    expect(metrics.primarySuccessCount).toBe(1);
    expect(metrics.primaryFailureCount).toBe(1);
    expect(metrics.fallbackSuccessCount).toBe(1);
  });

  test('should reset metrics', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback' });
    await fp.execute(() => Promise.resolve('primary'));
    fp.resetMetrics();
    const metrics = fp.getMetrics();
    expect(metrics.primarySuccessCount).toBe(0);
  });

  test('should accept inline fallbacks', async () => {
    const fp = new FallbackProvider<string>();
    const result = await fp.execute(
      () => Promise.reject(new Error('fail')),
      [{ strategy: 'default_value', value: 'inline' }],
    );
    expect(result).toBe('inline');
  });

  test('should respect priority order', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'low', priority: 10 });
    fp.addFallback({ strategy: 'default_value', value: 'high', priority: 1 });
    const result = await fp.execute(
      () => Promise.reject(new Error('fail')),
    );
    expect(result).toBe('high');
  });

  test('should cache value from successful primary', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'cached_value' });
    await fp.execute(() => Promise.resolve('primary'));
    expect(fp.getCachedValue()).toBe('primary');
  });

  test('should remove fallback by strategy', async () => {
    const fp = new FallbackProvider<string>();
    fp.addFallback({ strategy: 'default_value', value: 'fallback' });
    fp.removeFallback('default_value');
    // No fallback should be available now
    await expect(fp.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
  });
});

// ============================================================
// Chaos Engine Tests
// ============================================================
describe('ChaosEngine', () => {
  test('should inject a fault', () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    expect(engine.getActiveFaults().length).toBe(1);
  });

  test('should remove a fault', () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    engine.removeFault('f1');
    expect(engine.getActiveFaults().length).toBe(0);
  });

  test('should inject error fault', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    await expect(engine.execute('op', () => Promise.resolve('ok'))).rejects.toThrow();
  });

  test('should inject latency fault', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'latency', probability: 1.0, latencyMs: 20 });
    const start = Date.now();
    const result = await engine.execute('op', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  test('should not inject when disabled', async () => {
    const engine = new ChaosEngine({ enabled: false });
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    const result = await engine.execute('op', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  test('should target specific operations', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0, targetOperation: 'specific' });
    const result = await engine.execute('other', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  test('should respect probability', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 0 });
    const result = await engine.execute('op', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  test('should auto-recover after duration', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0, duration: 50 });
    expect(engine.getActiveFaults().length).toBe(1);
    await delay(60);
    expect(engine.getActiveFaults().length).toBe(0);
  });

  test('should enforce max concurrent faults', () => {
    const engine = new ChaosEngine({ maxConcurrentFaults: 2 });
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    engine.injectFault({ id: 'f2', type: 'error', probability: 1.0 });
    expect(() => engine.injectFault({ id: 'f3', type: 'error', probability: 1.0 })).toThrow();
  });

  test('should clear all faults', () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    engine.injectFault({ id: 'f2', type: 'error', probability: 1.0 });
    engine.clearAll();
    expect(engine.getActiveFaults().length).toBe(0);
  });

  test('should track fault stats', () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'error', probability: 1.0 });
    const stats = engine.getFaultStats();
    expect(stats['f1']).toBeDefined();
    expect(stats['f1'].triggerCount).toBe(0);
  });

  test('should enable and disable', () => {
    const engine = new ChaosEngine();
    expect(engine.isEnabled()).toBe(true);
    engine.disable();
    expect(engine.isEnabled()).toBe(false);
    engine.enable();
    expect(engine.isEnabled()).toBe(true);
  });

  test('should inject resource_exhaustion fault', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'resource_exhaustion', probability: 1.0 });
    await expect(engine.execute('op', () => Promise.resolve('ok'))).rejects.toThrow('resource exhaustion');
  });

  test('should inject network_partition fault', async () => {
    const engine = new ChaosEngine();
    engine.injectFault({ id: 'f1', type: 'network_partition', probability: 1.0 });
    await expect(engine.execute('op', () => Promise.resolve('ok'))).rejects.toThrow('network partition');
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

  test('should create a snapshot', () => {
    const snapshot = manager.createSnapshot({ key: 'value' });
    expect(snapshot.id).toBeDefined();
    expect(snapshot.state).toEqual({ key: 'value' });
    expect(snapshot.version).toBe(1);
  });

  test('should list snapshots', () => {
    manager.createSnapshot({ v: 1 });
    manager.createSnapshot({ v: 2 });
    const list = manager.listSnapshots();
    expect(list.length).toBe(2);
  });

  test('should restore from snapshot', async () => {
    const snapshot = manager.createSnapshot({ key: 'original' });
    const restored = await manager.restore(snapshot.id);
    expect(restored).toEqual({ key: 'original' });
  });

  test('should throw on restore of non-existent snapshot', async () => {
    await expect(manager.restore('nonexistent')).rejects.toThrow();
  });

  test('should deep clone state', async () => {
    const original = { nested: { value: 1 } };
    const snapshot = manager.createSnapshot(original);
    original.nested.value = 999;
    const restored = await manager.restore(snapshot.id);
    expect((restored as { nested: { value: number } }).nested.value).toBe(1);
  });

  test('should cleanup old snapshots', () => {
    manager.createSnapshot({ v: 1 });
    manager.createSnapshot({ v: 2 });
    manager.createSnapshot({ v: 3 });
    const deleted = manager.cleanup(1);
    expect(deleted).toBeGreaterThanOrEqual(0);
    expect(manager.getSnapshotCount()).toBeLessThanOrEqual(1);
  });

  test('should delete specific snapshot', () => {
    const snap = manager.createSnapshot({ v: 1 });
    expect(manager.deleteSnapshot(snap.id)).toBe(true);
    expect(manager.getSnapshotCount()).toBe(0);
  });

  test('should track version', () => {
    manager.createSnapshot({ v: 1 });
    manager.createSnapshot({ v: 2 });
    expect(manager.getVersion()).toBe(2);
  });

  test('should emit events', () => {
    const events: string[] = [];
    manager.onEvent(e => events.push(e.type));
    manager.createSnapshot({ v: 1 });
    expect(events).toContain('snapshot_created');
  });

  test('should support partial restore', async () => {
    const snapshot = manager.createSnapshot({ key: 'value' });
    const restored = await manager.restore(snapshot.id, 'partial_restore');
    expect(restored).toBeDefined();
    expect((restored as Record<string, unknown>)._restoredFrom).toBe(snapshot.id);
  });

  test('should get event log', () => {
    manager.createSnapshot({ v: 1 });
    const log = manager.getEventLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].type).toBe('snapshot_created');
  });

  test('should include metadata in snapshot', () => {
    const snap = manager.createSnapshot({ v: 1 }, { source: 'test' });
    expect(snap.metadata?.source).toBe('test');
  });

  test('should enforce max snapshots', () => {
    const mgr = new StateRecoveryManager({ maxSnapshots: 2 });
    mgr.createSnapshot({ v: 1 });
    mgr.createSnapshot({ v: 2 });
    mgr.createSnapshot({ v: 3 });
    expect(mgr.getSnapshotCount()).toBeLessThanOrEqual(2);
  });

  test('should get snapshot by id', () => {
    const snap = manager.createSnapshot({ v: 1 });
    const retrieved = manager.getSnapshot(snap.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(snap.id);
  });

  test('should return undefined for non-existent snapshot', () => {
    expect(manager.getSnapshot('nonexistent')).toBeUndefined();
  });

  test('should emit restore event', async () => {
    const events: string[] = [];
    manager.onEvent(e => events.push(e.type));
    const snap = manager.createSnapshot({ v: 1 });
    await manager.restore(snap.id);
    expect(events).toContain('snapshot_restored');
  });

  test('should emit delete event', () => {
    const events: string[] = [];
    manager.onEvent(e => events.push(e.type));
    const snap = manager.createSnapshot({ v: 1 });
    manager.deleteSnapshot(snap.id);
    expect(events).toContain('snapshot_deleted');
  });
});

// ============================================================
// Graceful Shutdown Tests
// ============================================================
describe('GracefulShutdownManager', () => {
  test('should start not shutting down', () => {
    const mgr = new GracefulShutdownManager();
    expect(mgr.isShuttingDown()).toBe(false);
  });

  test('should register handler', () => {
    const mgr = new GracefulShutdownManager();
    mgr.register(() => Promise.resolve(), 'cleanup', 'test-handler');
    expect(mgr.getStatus().pendingHandlers).toContain('test-handler');
  });

  test('should execute shutdown', async () => {
    const mgr = new GracefulShutdownManager();
    let called = false;
    mgr.register(async () => { called = true; }, 'cleanup', 'h1');
    await mgr.shutdown('test');
    expect(mgr.isShuttingDown()).toBe(true);
    expect(called).toBe(true);
  });

  test('should track in-flight requests', () => {
    const mgr = new GracefulShutdownManager();
    mgr.incrementInFlight();
    mgr.incrementInFlight();
    expect(mgr.getInFlightCount()).toBe(2);
    mgr.decrementInFlight();
    expect(mgr.getInFlightCount()).toBe(1);
  });

  test('should not decrement below zero', () => {
    const mgr = new GracefulShutdownManager();
    mgr.decrementInFlight();
    expect(mgr.getInFlightCount()).toBe(0);
  });

  test('should report status', async () => {
    const mgr = new GracefulShutdownManager();
    mgr.register(() => Promise.resolve(), 'cleanup', 'h1');
    await mgr.shutdown();
    const status = mgr.getStatus();
    expect(status.isShuttingDown).toBe(true);
    expect(status.completedHandlers).toContain('h1');
  });

  test('should execute handlers in phase order', async () => {
    const order: string[] = [];
    const mgr = new GracefulShutdownManager();
    mgr.register(async () => { order.push('stop'); }, 'stop_accepting', 'stop');
    mgr.register(async () => { order.push('cleanup'); }, 'cleanup', 'cleanup');
    await mgr.shutdown();
    expect(order.indexOf('stop')).toBeLessThan(order.indexOf('cleanup'));
  });

  test('should handle handler failure gracefully', async () => {
    const mgr = new GracefulShutdownManager();
    mgr.register(() => Promise.reject(new Error('handler fail')), 'cleanup', 'fail-handler');
    mgr.register(() => Promise.resolve(), 'cleanup', 'ok-handler');
    await mgr.shutdown();
    const status = mgr.getStatus();
    expect(status.failedHandlers).toContain('fail-handler');
    expect(status.completedHandlers).toContain('ok-handler');
  });

  test('should emit shutdown events', async () => {
    const phases: string[] = [];
    const mgr = new GracefulShutdownManager();
    mgr.onShutdownEvent((phase) => phases.push(phase));
    mgr.register(() => Promise.resolve(), 'stop_accepting', 'h1');
    await mgr.shutdown();
    expect(phases.length).toBeGreaterThan(0);
  });

  test('should remove handler', () => {
    const mgr = new GracefulShutdownManager();
    mgr.register(() => Promise.resolve(), 'cleanup', 'removable');
    mgr.removeHandler('removable');
    expect(mgr.getStatus().pendingHandlers).not.toContain('removable');
  });

  test('should handle multiple shutdown calls', async () => {
    const mgr = new GracefulShutdownManager();
    let count = 0;
    mgr.register(async () => { count++; }, 'cleanup', 'h1');
    await mgr.shutdown();
    await mgr.shutdown(); // second call should be no-op
    expect(count).toBe(1);
  });

  test('should record shutdown reason', async () => {
    const mgr = new GracefulShutdownManager();
    await mgr.shutdown('SIGTERM');
    expect(mgr.getStatus().reason).toBe('SIGTERM');
  });

  test('should record start time', async () => {
    const mgr = new GracefulShutdownManager();
    const before = Date.now();
    await mgr.shutdown();
    expect(mgr.getStatus().startTime).toBeGreaterThanOrEqual(before);
  });
});

// ============================================================
// Observability Tests
// ============================================================
describe('ResilienceObservability', () => {
  test('should create dashboard', () => {
    const obs = new ResilienceObservability();
    const dashboard = obs.getDashboard();
    expect(dashboard.timestamp).toBeDefined();
    expect(dashboard.circuitBreakers).toEqual([]);
    expect(dashboard.bulkheads).toEqual([]);
  });

  test('should register circuit breaker', () => {
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

  test('should register bulkhead', () => {
    const obs = new ResilienceObservability();
    const bh = new Bulkhead({ maxConcurrent: 5, maxQueueSize: 10 });
    obs.registerBulkhead('api', bh);
    const dashboard = obs.getDashboard();
    expect(dashboard.bulkheads.length).toBe(1);
    expect(dashboard.bulkheads[0].name).toBe('api');
  });

  test('should register retry', () => {
    const obs = new ResilienceObservability();
    const retry = new RetryWithBackoff({ maxRetries: 3, strategy: 'fixed', baseDelay: 1 });
    obs.registerRetry('api', retry);
    const dashboard = obs.getDashboard();
    expect(dashboard.retries.length).toBe(1);
  });

  test('should register health checker', () => {
    const obs = new ResilienceObservability();
    const checker = new HealthChecker();
    checker.registerCheck('db', () => Promise.resolve({ healthy: true }));
    obs.registerHealthChecker('db', checker);
    const dashboard = obs.getDashboard();
    expect(dashboard.healthChecks.length).toBe(1);
  });

  test('should unregister components', () => {
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

  test('should evaluate alert rules', () => {
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

  test('should resolve alerts when condition clears', () => {
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

  test('should generate prometheus metrics', () => {
    const obs = new ResilienceObservability();
    const metrics = obs.getPrometheusMetrics();
    expect(metrics).toContain('# HELP');
    expect(metrics).toContain('# TYPE');
  });

  test('should track open circuit breakers in summary', async () => {
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

  test('should track historical data', () => {
    const obs = new ResilienceObservability();
    obs.getDashboard();
    obs.getDashboard();
    const history = obs.getHistoricalData();
    expect(history.length).toBe(2);
  });

  test('should clear history', () => {
    const obs = new ResilienceObservability();
    obs.getDashboard();
    obs.clearHistory();
    expect(obs.getHistoricalData().length).toBe(0);
  });

  test('should include summary counts', () => {
    const obs = new ResilienceObservability();
    const dashboard = obs.getDashboard();
    expect(dashboard.summary.totalCircuitBreakers).toBe(0);
    expect(dashboard.summary.totalBulkheads).toBe(0);
    expect(dashboard.summary.totalRetries).toBe(0);
  });

  test('should support alert severity levels', () => {
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

  test('should manually resolve alert', () => {
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

  test('should get all alerts including resolved', () => {
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
});
