// ============================================================================
// Tests for @claude-agent/middleware
// ============================================================================
import { describe, test, expect } from 'bun:test';
import { MiddlewarePipeline, loggingMiddleware, errorHandlingMiddleware, timingMiddleware, authMiddleware, corsMiddleware, rateLimitMiddleware, requestIdMiddleware, stateMiddleware } from '../packages/middleware/src/index.js';

describe('@claude-agent/middleware', () => {
  describe('MiddlewarePipeline', () => {
    test('creates empty pipeline', () => {
      const pipeline = new MiddlewarePipeline();
      expect(pipeline.length).toBe(0);
    });

    test('adds middleware with use()', () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(timingMiddleware());
      expect(pipeline.length).toBe(1);
    });

    test('removes middleware', () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(timingMiddleware());
      pipeline.use(requestIdMiddleware());
      pipeline.remove(() => false);
      expect(pipeline.length).toBe(2);
      pipeline.remove(() => true);
      expect(pipeline.length).toBe(0);
    });

    test('executes middleware chain', async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(requestIdMiddleware());
      pipeline.use(timingMiddleware());
      const ctx = await pipeline.execute(new Request('http://localhost/test'));
      expect(ctx.state.get('requestId')).toBeDefined();
      expect(ctx.state.get('duration')).toBeDefined();
    });

    test('executes empty pipeline', async () => {
      const pipeline = new MiddlewarePipeline();
      const ctx = await pipeline.execute(new Request('http://localhost/test'));
      expect(ctx.state.size).toBe(0);
    });
  });

  describe('loggingMiddleware', () => {
    test('executes without error', async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(loggingMiddleware());
      const ctx = await pipeline.execute(new Request('http://localhost/test', { method: 'POST' }));
      expect(ctx).toBeDefined();
    });
  });

  describe('errorHandlingMiddleware', () => {
    test('catches errors', async () => {
      let caughtError: Error | undefined;
      const pipeline = new MiddlewarePipeline();
      pipeline.use(errorHandlingMiddleware({
        onError: (err, ctx) => { caughtError = err; },
      }));
      pipeline.use(async (ctx, next) => { throw new Error('test error'); });
      const ctx = await pipeline.execute(new Request('http://localhost/test'));
      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toBe('test error');
      expect(ctx.state.get('error')).toBeDefined();
    });
  });

  describe('timingMiddleware', () => {
    test('records duration', async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(timingMiddleware());
      const ctx = await pipeline.execute(new Request('http://localhost/test'));
      expect(ctx.state.get('duration')).toBeGreaterThanOrEqual(0);
    });
  });

  describe('authMiddleware', () => {
    test('allows valid token', async () => {
      const pipeline = new MiddlewarePipeline();
      let nextCalled = false;
      pipeline.use(authMiddleware({
        validateToken: async (token) => token === 'valid',
      }));
      pipeline.use(async (ctx, next) => { nextCalled = true; await next(); });
      const req = new Request('http://localhost/test', { headers: { Authorization: 'Bearer valid' } });
      await pipeline.execute(req);
      expect(nextCalled).toBe(true);
    });

    test('rejects invalid token', async () => {
      const pipeline = new MiddlewarePipeline();
      let nextCalled = false;
      pipeline.use(authMiddleware({
        validateToken: async (token) => token === 'valid',
      }));
      pipeline.use(async (ctx, next) => { nextCalled = true; await next(); });
      const req = new Request('http://localhost/test', { headers: { Authorization: 'Bearer invalid' } });
      await pipeline.execute(req);
      expect(nextCalled).toBe(false);
    });
  });

  describe('corsMiddleware', () => {
    test('sets cors origin for wildcard', async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(corsMiddleware(['*']));
      const req = new Request('http://localhost/test', { headers: { Origin: 'http://example.com' } });
      const ctx = await pipeline.execute(req);
      expect(ctx.state.get('cors.origin')).toBe('http://example.com');
    });
  });

  describe('rateLimitMiddleware', () => {
    test('allows under limit', async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(rateLimitMiddleware({ windowMs: 60000, maxRequests: 5 }));
      const ctx = await pipeline.execute(new Request('http://localhost/test'));
      expect(ctx.state.get('rateLimit.limited')).toBeFalsy();
    });
  });

  describe('requestIdMiddleware', () => {
    test('generates request id', async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(requestIdMiddleware());
      const ctx = await pipeline.execute(new Request('http://localhost/test'));
      expect(ctx.state.get('requestId')).toMatch(/^req-/);
    });
  });

  describe('stateMiddleware', () => {
    test('sets default state', async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(stateMiddleware({ userId: 'test-user' }));
      const ctx = await pipeline.execute(new Request('http://localhost/test'));
      expect(ctx.state.get('userId')).toBe('test-user');
    });
  });
});
