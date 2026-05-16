// ============================================================================
// Tests for @claude-agent/decorators
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { LoggingDecorator, CachingDecorator, RetryDecorator, TimingDecorator, RateLimitDecorator, Service, decorate } from '../packages/decorators/src/index.js';

describe('@claude-agent/decorators', () => {
  describe('Service', () => {
    test('executes function', () => {
      const svc = decorate('add', (a: number, b: number) => a + b);
      expect(svc.execute(2, 3)).toBe(5);
    });
  });

  describe('LoggingDecorator', () => {
    test('executes and returns result', () => {
      const svc = decorate('double', (n: number) => n * 2);
      const decorated = new LoggingDecorator(svc);
      expect(decorated.execute(5)).toBe(10);
    });

    test('propagates errors', () => {
      const svc = decorate('fail', () => { throw new Error('test'); });
      const decorated = new LoggingDecorator(svc);
      expect(() => decorated.execute()).toThrow('test');
    });
  });

  describe('CachingDecorator', () => {
    test('caches async results', async () => {
      let calls = 0;
      const svc = decorate('expensive', async (key: string) => { calls++; return `result-${key}`; });
      const cached = new CachingDecorator(svc, { ttl: 60000 });
      const r1 = await cached.execute('a');
      const r2 = await cached.execute('a');
      expect(r1).toBe('result-a');
      expect(r2).toBe('result-a');
      expect(calls).toBe(1);
    });

    test('clears cache', async () => {
      const svc = decorate('test', async (key: string) => `result-${key}`);
      const cached = new CachingDecorator(svc, { ttl: 60000 });
      await cached.execute('a');
      cached.clearCache();
      expect(cached.getCacheSize()).toBe(0);
    });

    test('reports cache size', async () => {
      const svc = decorate('test', async (key: string) => `result-${key}`);
      const cached = new CachingDecorator(svc, { ttl: 60000 });
      await cached.execute('a');
      await cached.execute('b');
      expect(cached.getCacheSize()).toBe(2);
    });
  });

  describe('RetryDecorator', () => {
    test('succeeds on first try', async () => {
      const svc = decorate('ok', async () => 'success');
      const retry = new RetryDecorator(svc, { maxRetries: 3, delay: 10 });
      const result = await retry.execute();
      expect(result).toBe('success');
    });

    test('retries on failure', async () => {
      let attempts = 0;
      const svc = decorate('flaky', async () => {
        attempts++;
        if (attempts < 3) throw new Error('not yet');
        return 'success';
      });
      const retry = new RetryDecorator(svc, { maxRetries: 3, delay: 10 });
      const result = await retry.execute();
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    test('throws after max retries', async () => {
      const svc = decorate('always-fail', async () => { throw new Error('always'); });
      const retry = new RetryDecorator(svc, { maxRetries: 2, delay: 10 });
      await expect(retry.execute()).rejects.toThrow('always');
    });
  });

  describe('TimingDecorator', () => {
    test('records timing sync', () => {
      const svc = decorate('sync', (n: number) => n * 2);
      const timed = new TimingDecorator(svc);
      timed.execute(5);
      const stats = timed.getTimings();
      expect(stats.count).toBe(1);
      expect(stats.min).toBeGreaterThanOrEqual(0);
    });

    test('records timing async', async () => {
      const svc = decorate('async', async () => {
        await new Promise(r => setTimeout(r, 10));
        return 'done';
      });
      const timed = new TimingDecorator(svc);
      await timed.execute();
      const stats = timed.getTimings();
      expect(stats.count).toBe(1);
      expect(stats.min).toBeGreaterThanOrEqual(10);
    });

    test('clears timings', () => {
      const svc = decorate('test', () => 42);
      const timed = new TimingDecorator(svc);
      timed.execute();
      timed.clearTimings();
      expect(timed.getTimings().count).toBe(0);
    });
  });

  describe('RateLimitDecorator', () => {
    test('allows under limit', () => {
      const svc = decorate('limited', () => 'ok');
      const rateLimited = new RateLimitDecorator(svc, { maxCalls: 5, windowMs: 1000 });
      for (let i = 0; i < 5; i++) {
        expect(rateLimited.execute()).toBe('ok');
      }
    });

    test('throws over limit', () => {
      const svc = decorate('limited', () => 'ok');
      const rateLimited = new RateLimitDecorator(svc, { maxCalls: 2, windowMs: 1000 });
      rateLimited.execute();
      rateLimited.execute();
      expect(() => rateLimited.execute()).toThrow('Rate limit exceeded');
    });
  });
});
