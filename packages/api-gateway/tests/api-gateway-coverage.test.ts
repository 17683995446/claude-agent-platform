// api-gateway-coverage.test.ts - Comprehensive test suite for api-gateway package

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Router, type RequestContext, type ResponseContext, type Middleware } from '../src/router.ts';
import { MiddlewareChain, errorHandler, loggingMiddleware, timingMiddleware } from '../src/middleware-chain.ts';
import { WebSocketManager, type WSConnection } from '../src/websocket-manager.ts';
import { APIRateLimiter } from '../src/rate-limiter.ts';
import { AuthMiddleware } from '../src/auth-middleware.ts';
import { APICache } from '../src/api-cache.ts';
import { RequestValidator } from '../src/request-validator.ts';
import { ResponseFormatter } from '../src/response-formatter.ts';
import { CORSHandler } from '../src/cors-handler.ts';
import { APIDocumentationGenerator } from '../src/api-documentation.ts';

// ============================================
// Router Tests
// ============================================
describe('Router', () => {
  let router: Router;

  beforeEach(() => {
    vi.useRealTimers();
    router = new Router();
  });

  afterEach(() => {
    vi.useRealTimers();
    router.clear();
  });

  describe('Route Registration', () => {
    it('should register GET route', () => {
      router.get('/users', async () => ({ status: 200, body: [] }));
      expect(router.listRoutes()).toHaveLength(1);
    });

    it('should register POST route', () => {
      router.post('/users', async () => ({ status: 201 }));
      expect(router.listRoutes()).toHaveLength(1);
    });

    it('should register PUT route', () => {
      router.put('/users/:id', async () => ({ status: 200 }));
      expect(router.listRoutes()).toHaveLength(1);
    });

    it('should register PATCH route', () => {
      router.patch('/users/:id', async () => ({ status: 200 }));
      expect(router.listRoutes()).toHaveLength(1);
    });

    it('should register DELETE route', () => {
      router.delete('/users/:id', async () => ({ status: 204 }));
      expect(router.listRoutes()).toHaveLength(1);
    });

    it('should register OPTIONS route', () => {
      router.options('/users', async () => ({ status: 200 }));
      expect(router.listRoutes()).toHaveLength(1);
    });

    it('should register HEAD route', () => {
      router.head('/users', async () => ({ status: 200 }));
      expect(router.listRoutes()).toHaveLength(1);
    });

    it('should register all methods with all()', () => {
      router.all('/resource', async () => ({ status: 200 }));
      expect(router.listRoutes()).toHaveLength(7);
    });

    it('should handle empty path', () => {
      router.get('/', async () => ({ status: 200 }));
      const match = router.match('GET', '/');
      expect(match).not.toBeNull();
    });

    it('should handle path with trailing slash', () => {
      router.get('/users/', async () => ({ status: 200 }));
      const match = router.match('GET', '/users/');
      expect(match).not.toBeNull();
    });
  });

  describe('Route Matching', () => {
    it('should match exact path', () => {
      router.get('/users', async () => ({ status: 200 }));
      const match = router.match('GET', '/users');
      expect(match).not.toBeNull();
    });

    it('should not match different method', () => {
      router.get('/users', async () => ({ status: 200 }));
      const match = router.match('POST', '/users');
      expect(match).toBeNull();
    });

    it('should not match different path', () => {
      router.get('/users', async () => ({ status: 200 }));
      const match = router.match('GET', '/posts');
      expect(match).toBeNull();
    });

    it('should extract path parameters', () => {
      router.get('/users/:id', async () => ({ status: 200 }));
      const match = router.match('GET', '/users/123');
      expect(match?.params).toEqual({ id: '123' });
    });

    it('should extract multiple path parameters', () => {
      router.get('/users/:userId/posts/:postId', async () => ({ status: 200 }));
      const match = router.match('GET', '/users/123/posts/456');
      expect(match?.params).toEqual({ userId: '123', postId: '456' });
    });

    it('should decode URL-encoded parameters', () => {
      router.get('/users/:name', async () => ({ status: 200 }));
      const match = router.match('GET', '/users/John%20Doe');
      expect(match?.params.name).toBe('John Doe');
    });

    it('should parse query string', () => {
      router.get('/users', async () => ({ status: 200 }));
      const match = router.match('GET', '/users?page=1&limit=10');
      expect(match?.query).toEqual({ page: '1', limit: '10' });
    });

    it('should handle empty query string value', () => {
      router.get('/users', async () => ({ status: 200 }));
      const match = router.match('GET', '/users?filter=');
      expect(match?.query).toEqual({ filter: '' });
    });

    it('should handle query string without value', () => {
      router.get('/users', async () => ({ status: 200 }));
      const match = router.match('GET', '/users?enabled');
      expect(match?.query).toEqual({ enabled: '' });
    });

    it('should decode URL-encoded query parameters', () => {
      router.get('/users', async () => ({ status: 200 }));
      const match = router.match('GET', '/users?name=John%20Doe');
      expect(match?.query.name).toBe('John Doe');
    });

    it('should match routes by priority', () => {
      router.get('/users/all', async () => ({ status: 200, body: 'all' }), { priority: 1 });
      router.get('/users/:id', async () => ({ status: 200, body: 'specific' }), { priority: 2 });
      const match = router.match('GET', '/users/all');
      expect(match?.route.path).toBe('/users/all');
    });

    it('should handle special characters in path', () => {
      router.get('/users/:id', async () => ({ status: 200 }));
      const match = router.match('GET', '/users/test-123_test');
      expect(match?.params.id).toBe('test-123_test');
    });

    it('should not match partial paths', () => {
      router.get('/users', async () => ({ status: 200 }));
      const match = router.match('GET', '/users/123');
      expect(match).toBeNull();
    });

    it('should not match if extra path segments', () => {
      router.get('/users/:id', async () => ({ status: 200 }));
      const match = router.match('GET', '/users/123/extra');
      expect(match).toBeNull();
    });
  });

  describe('Route Removal', () => {
    it('should remove existing route', () => {
      router.get('/users', async () => ({ status: 200 }));
      const removed = router.removeRoute('GET', '/users');
      expect(removed).toBe(true);
      expect(router.listRoutes()).toHaveLength(0);
    });

    it('should return false when removing non-existent route', () => {
      const removed = router.removeRoute('GET', '/nonexistent');
      expect(removed).toBe(false);
    });

    it('should handle case-insensitive method removal', () => {
      router.get('/users', async () => ({ status: 200 }));
      const removed = router.removeRoute('get', '/users');
      expect(removed).toBe(true);
    });
  });

  describe('Route Groups', () => {
    it('should create route group with prefix', () => {
      const middleware: Middleware = async (ctx, next) => next();
      router.group('/api/v1', [middleware], (r) => {
        r.get('/users', async () => ({ status: 200 }));
      });
      expect(router.listRoutes()[0].path).toBe('/api/v1/users');
    });

    it('should apply group middleware to routes', () => {
      const middleware: Middleware = async (ctx, next) => next();
      router.group('/api', [middleware], (r) => {
        r.get('/test', async () => ({ status: 200 }), { middleware: [] });
      });
      const route = router.listRoutes()[0];
      expect(route.options.middleware).toHaveLength(1);
    });
  });

  describe('Global Middleware', () => {
    it('should add global middleware', () => {
      const middleware: Middleware = async (ctx, next) => next();
      router.useGlobal(middleware);
      expect(router.getGlobalMiddleware()).toHaveLength(1);
    });

    it('should return copy of global middleware', () => {
      const middleware: Middleware = async (ctx, next) => next();
      router.useGlobal(middleware);
      const first = router.getGlobalMiddleware();
      first.pop();
      expect(router.getGlobalMiddleware()).toHaveLength(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty router', () => {
      expect(router.listRoutes()).toHaveLength(0);
      expect(router.match('GET', '/anything')).toBeNull();
    });

    it('should handle clear()', () => {
      router.get('/users', async () => ({ status: 200 }));
      router.useGlobal(async (ctx, next) => next());
      router.clear();
      expect(router.listRoutes()).toHaveLength(0);
      expect(router.getGlobalMiddleware()).toHaveLength(0);
    });

    it('should handle very long paths', () => {
      const longPath = '/a'.repeat(1000);
      router.get(longPath, async () => ({ status: 200 }));
      const match = router.match('GET', longPath);
      expect(match).not.toBeNull();
    });

    it('should handle paths with regex special characters', () => {
      router.get('/users/test.json', async () => ({ status: 200 }));
      const match = router.match('GET', '/users/test.json');
      expect(match).not.toBeNull();
    });
  });
});

// ============================================
// Middleware Chain Tests
// ============================================
describe('MiddlewareChain', () => {
  let chain: MiddlewareChain;

  beforeEach(() => {
    vi.useRealTimers();
    chain = new MiddlewareChain();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Basic Execution', () => {
    it('should execute empty chain', async () => {
      const context: RequestContext = { method: 'GET', path: '/', headers: {} };
      const response = await chain.execute(context);
      expect(response.status).toBe(200);
    });

    it('should execute single middleware', async () => {
      const middleware: Middleware = async (ctx, next) => {
        await next();
      };
      chain.use(middleware);
      const context: RequestContext = { method: 'GET', path: '/', headers: {} };
      const response = await chain.execute(context);
      expect(response.status).toBe(200);
    });

    it('should execute multiple middleware in order', async () => {
      const order: number[] = [];
      chain.use(async (ctx, next) => {
        order.push(1);
        await next();
      });
      chain.use(async (ctx, next) => {
        order.push(2);
        await next();
      });
      chain.use(async (ctx, next) => {
        order.push(3);
        await next();
      });
      await chain.execute({ method: 'GET', path: '/', headers: {} });
      expect(order).toEqual([1, 2, 3]);
    });

    it('should handle middleware that does not call next', async () => {
      chain.use(async (ctx, next) => {
        // Short circuit
      });
      const response = await chain.execute({ method: 'GET', path: '/', headers: {} });
      expect(response.status).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should handle synchronous errors', async () => {
      chain.use(async () => {
        throw new Error('Sync error');
      });
      const response = await chain.execute({ method: 'GET', path: '/', headers: {} });
      expect(response.status).toBe(500);
      expect((response.body as any).error).toBe('Sync error');
    });

    it('should handle error in middle of chain', async () => {
      const order: number[] = [];
      chain.use(async (ctx, next) => {
        order.push(1);
        try {
          await next();
          order.push(4);
        } catch (err) {
          order.push(5);
          throw err;
        }
      });
      chain.use(async () => {
        order.push(2);
        throw new Error('Middle error');
      });
      chain.use(async (ctx, next) => {
        order.push(3);
        await next();
      });
      const response = await chain.execute({ method: 'GET', path: '/', headers: {} });
      expect(response.status).toBe(500);
      expect(order).toEqual([1, 2, 5]);
    });

    it('should call onError handler', async () => {
      const errors: Error[] = [];
      chain = new MiddlewareChain({
        onError: (err) => errors.push(err),
      });
      chain.use(async () => {
        throw new Error('Test error');
      });
      await chain.execute({ method: 'GET', path: '/', headers: {} });
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Test error');
    });

    it('should handle non-Error throws', async () => {
      chain.use(async () => {
        throw 'String error';
      });
      const response = await chain.execute({ method: 'GET', path: '/', headers: {} });
      expect(response.status).toBe(500);
      expect((response.body as any).error).toBe('String error');
    });
  });

  describe('Short Circuit', () => {
    it('should short circuit with response', async () => {
      chain.use(async (ctx, next) => {
        chain.shortCircuit(ctx, { status: 403, body: { error: 'Forbidden' } });
      });
      const response = await chain.execute({ method: 'GET', path: '/', headers: {} });
      expect(response.status).toBe(403);
      expect((response.body as any).error).toBe('Forbidden');
    });

    it('should not execute remaining middleware after short circuit', async () => {
      let executed = false;
      chain.use(async (ctx, next) => {
        chain.shortCircuit(ctx, { status: 200 });
      });
      chain.use(async (ctx, next) => {
        executed = true;
        await next();
      });
      await chain.execute({ method: 'GET', path: '/', headers: {} });
      expect(executed).toBe(false);
    });
  });

  describe('Conditional Middleware', () => {
    it('should execute conditional middleware when condition is true', async () => {
      let executed = false;
      chain.useConditional(
        (ctx) => ctx.method === 'POST',
        async (ctx, next) => {
          executed = true;
          await next();
        }
      );
      await chain.execute({ method: 'POST', path: '/', headers: {} });
      expect(executed).toBe(true);
    });

    it('should skip conditional middleware when condition is false', async () => {
      let executed = false;
      chain.useConditional(
        (ctx) => ctx.method === 'POST',
        async (ctx, next) => {
          executed = true;
          await next();
        }
      );
      await chain.execute({ method: 'GET', path: '/', headers: {} });
      expect(executed).toBe(false);
    });
  });

  describe('Middleware Management', () => {
    it('should return middleware count', () => {
      expect(chain.length).toBe(0);
      chain.use(async (ctx, next) => next());
      expect(chain.length).toBe(1);
    });

    it('should get all middleware', () => {
      const mw1 = async (ctx: any, next: any) => next();
      const mw2 = async (ctx: any, next: any) => next();
      chain.use(mw1);
      chain.use(mw2);
      expect(chain.getMiddleware()).toHaveLength(2);
    });

    it('should return copy of middleware array', () => {
      chain.use(async (ctx, next) => next());
      const middleware = chain.getMiddleware();
      middleware.pop();
      expect(chain.length).toBe(1);
    });

    it('should remove middleware by index', () => {
      chain.use(async (ctx, next) => next());
      const removed = chain.remove(0);
      expect(removed).toBe(true);
      expect(chain.length).toBe(0);
    });

    it('should return false when removing invalid index', () => {
      const removed = chain.remove(0);
      expect(removed).toBe(false);
    });

    it('should clear all middleware', () => {
      chain.use(async (ctx, next) => next());
      chain.clear();
      expect(chain.length).toBe(0);
    });
  });

  describe('Built-in Middleware', () => {
    it('should create error handler middleware', async () => {
      const handler = errorHandler((err, ctx) => ({
        status: 400,
        body: { error: err.message },
      }));
      chain.use(handler);
      chain.use(async () => {
        throw new Error('Handled');
      });
      const response = await chain.execute({ method: 'GET', path: '/', headers: {} });
      expect(response.status).toBe(400);
    });

    it('should create logging middleware', async () => {
      const logs: string[] = [];
      chain.use(loggingMiddleware((msg) => logs.push(msg)));
      chain.use(async (ctx, next) => next());
      await chain.execute({ method: 'GET', path: '/test', headers: {} });
      expect(logs).toHaveLength(2);
      expect(logs[0]).toContain('[GET] /test');
    });

    it('should create timing middleware', async () => {
      chain.use(timingMiddleware());
      chain.use(async (ctx, next) => {
        await new Promise((r) => setTimeout(r, 10));
        await next();
      });
      const context: any = { method: 'GET', path: '/', headers: {} };
      await chain.execute(context);
      expect(context._timing).toBeGreaterThanOrEqual(10);
    });
  });
});

// ============================================
// WebSocket Manager Tests
// ============================================
describe('WebSocketManager', () => {
  let wsManager: WebSocketManager;

  beforeEach(() => {
    vi.useRealTimers();
    wsManager = new WebSocketManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    wsManager.clear();
  });

  describe('Connection Management', () => {
    it('should handle new connection', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      expect(wsManager.getConnection('conn1')).toBeDefined();
    });

    it('should disconnect connection', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      const disconnected = wsManager.disconnect('conn1');
      expect(disconnected).toBe(true);
      expect(wsManager.getConnection('conn1')).toBeUndefined();
    });

    it('should return false when disconnecting non-existent connection', () => {
      const disconnected = wsManager.disconnect('nonexistent');
      expect(disconnected).toBe(false);
    });

    it('should remove connection from all channels on disconnect', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(['channel1']),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      wsManager.joinChannel('conn1', 'channel1');
      wsManager.disconnect('conn1');
      expect(wsManager.getChannelMembers('channel1')).toHaveLength(0);
    });

    it('should get all connections', () => {
      const conn1: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      const conn2: WSConnection = {
        id: 'conn2',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(conn1);
      wsManager.handleConnection(conn2);
      expect(wsManager.getConnections()).toHaveLength(2);
    });
  });

  describe('Channel Management', () => {
    it('should join channel', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      const joined = wsManager.joinChannel('conn1', 'channel1');
      expect(joined).toBe(true);
      expect(wsManager.getChannelMembers('channel1')).toContain('conn1');
    });

    it('should return false when joining channel for non-existent connection', () => {
      const joined = wsManager.joinChannel('nonexistent', 'channel1');
      expect(joined).toBe(false);
    });

    it('should leave channel', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      wsManager.joinChannel('conn1', 'channel1');
      const left = wsManager.leaveChannel('conn1', 'channel1');
      expect(left).toBe(true);
      expect(wsManager.getChannelMembers('channel1')).not.toContain('conn1');
    });

    it('should return false when leaving channel for non-existent connection', () => {
      const left = wsManager.leaveChannel('nonexistent', 'channel1');
      expect(left).toBe(false);
    });

    it('should delete empty channels', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      wsManager.joinChannel('conn1', 'channel1');
      wsManager.leaveChannel('conn1', 'channel1');
      expect(wsManager.getChannels()).not.toContain('channel1');
    });

    it('should get all channels', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      wsManager.joinChannel('conn1', 'channel1');
      wsManager.joinChannel('conn1', 'channel2');
      expect(wsManager.getChannels()).toHaveLength(2);
    });
  });

  describe('Message Handling', () => {
    it('should handle message', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      const handler = vi.fn();
      wsManager.onMessage('test', handler);
      wsManager.handleMessage('conn1', { type: 'test', data: 'hello' });
      expect(handler).toHaveBeenCalled();
    });

    it('should handle pong message', () => {
      vi.useFakeTimers();
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      const beforePong = connection.lastPong;
      vi.advanceTimersByTime(1);
      wsManager.handleMessage('conn1', { type: 'pong' });
      expect(connection.lastPong).toBeGreaterThan(beforePong);
      vi.useRealTimers();
    });

    it('should handle join message', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      wsManager.handleMessage('conn1', { type: 'join', channel: 'test-channel' });
      expect(wsManager.getChannelMembers('test-channel')).toContain('conn1');
    });

    it('should handle leave message', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      wsManager.joinChannel('conn1', 'test-channel');
      wsManager.handleMessage('conn1', { type: 'leave', channel: 'test-channel' });
      expect(wsManager.getChannelMembers('test-channel')).not.toContain('conn1');
    });

    it('should not handle message for non-existent connection', () => {
      // Should not throw
      expect(() => {
        wsManager.handleMessage('nonexistent', { type: 'test' });
      }).not.toThrow();
    });

    it('should dispatch to wildcard handlers', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      const wildcardHandler = vi.fn();
      wsManager.onMessage('*', wildcardHandler);
      wsManager.handleMessage('conn1', { type: 'any', data: 'test' });
      expect(wildcardHandler).toHaveBeenCalled();
    });
  });

  describe('Sending Messages', () => {
    it('should send message to connection', () => {
      const sendMock = vi.fn();
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: sendMock },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      const sent = wsManager.send('conn1', { type: 'test', data: 'hello' });
      expect(sent).toBe(true);
      expect(sendMock).toHaveBeenCalled();
    });

    it('should return false when sending to non-existent connection', () => {
      const sent = wsManager.send('nonexistent', { type: 'test' });
      expect(sent).toBe(false);
    });

    it('should broadcast to channel', () => {
      const sendMock1 = vi.fn();
      const sendMock2 = vi.fn();
      const conn1: WSConnection = {
        id: 'conn1',
        socket: { send: sendMock1 },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      const conn2: WSConnection = {
        id: 'conn2',
        socket: { send: sendMock2 },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(conn1);
      wsManager.handleConnection(conn2);
      wsManager.joinChannel('conn1', 'channel1');
      wsManager.joinChannel('conn2', 'channel1');
      const count = wsManager.broadcast('channel1', { type: 'test' });
      expect(count).toBe(2);
      expect(sendMock1).toHaveBeenCalled();
      expect(sendMock2).toHaveBeenCalled();
    });

    it('should return 0 when broadcasting to non-existent channel', () => {
      const count = wsManager.broadcast('nonexistent', { type: 'test' });
      expect(count).toBe(0);
    });

    it('should broadcast to all connections', () => {
      const sendMock1 = vi.fn();
      const sendMock2 = vi.fn();
      const conn1: WSConnection = {
        id: 'conn1',
        socket: { send: sendMock1 },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      const conn2: WSConnection = {
        id: 'conn2',
        socket: { send: sendMock2 },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(conn1);
      wsManager.handleConnection(conn2);
      const count = wsManager.broadcastAll({ type: 'test' });
      expect(count).toBe(2);
    });
  });

  describe('Authentication', () => {
    it('should authenticate connection', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      const authenticated = wsManager.authenticate('conn1', 'user123');
      expect(authenticated).toBe(true);
      expect(wsManager.getConnection('conn1')?.authenticated).toBe(true);
      expect(wsManager.getConnection('conn1')?.userId).toBe('user123');
    });

    it('should return false when authenticating non-existent connection', () => {
      const authenticated = wsManager.authenticate('nonexistent', 'user123');
      expect(authenticated).toBe(false);
    });
  });

  describe('Event Handlers', () => {
    it('should call connect handlers', () => {
      const handler = vi.fn();
      wsManager.onConnect(handler);
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      expect(handler).toHaveBeenCalledWith(connection);
    });

    it('should call disconnect handlers', () => {
      const handler = vi.fn();
      wsManager.onDisconnect(handler);
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      wsManager.disconnect('conn1');
      expect(handler).toHaveBeenCalledWith(connection);
    });
  });

  describe('Heartbeat', () => {
    it('should start heartbeat', () => {
      wsManager.startHeartbeat();
      // Should not throw
      wsManager.stopHeartbeat();
    });

    it('should stop heartbeat', () => {
      wsManager.startHeartbeat();
      wsManager.stopHeartbeat();
      // Should not throw when stopping again
      wsManager.stopHeartbeat();
    });

    it('should not start multiple heartbeats', () => {
      wsManager.startHeartbeat();
      wsManager.startHeartbeat();
      // Should not throw
      wsManager.stopHeartbeat();
    });

    it('should disconnect timed out connections', () => {
      vi.useFakeTimers();
      const wsManagerWithShortTimeout = new WebSocketManager({
        heartbeatInterval: 1000,
        heartbeatTimeout: 500,
      });
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManagerWithShortTimeout.handleConnection(connection);
      wsManagerWithShortTimeout.startHeartbeat();
      
      vi.advanceTimersByTime(2000);
      
      expect(wsManagerWithShortTimeout.getConnection('conn1')).toBeUndefined();
      wsManagerWithShortTimeout.stopHeartbeat();
      vi.useRealTimers();
    });
  });

  describe('Statistics', () => {
    it('should return stats', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      wsManager.joinChannel('conn1', 'channel1');
      
      const stats = wsManager.getStats();
      expect(stats.totalConnections).toBe(1);
      expect(stats.activeConnections).toBe(1);
      expect(stats.channelsCount).toBe(1);
      expect(stats.connectionsPerChannel).toEqual({ channel1: 1 });
    });

    it('should track message counts', () => {
      const connection: WSConnection = {
        id: 'conn1',
        socket: { send: vi.fn() },
        channels: new Set(),
        authenticated: false,
        metadata: {},
        connectedAt: 0,
        lastPing: 0,
        lastPong: 0,
      };
      wsManager.handleConnection(connection);
      wsManager.handleMessage('conn1', { type: 'test' });
      wsManager.send('conn1', { type: 'response' });
      
      const stats = wsManager.getStats();
      expect(stats.totalMessagesReceived).toBe(1);
      expect(stats.totalMessagesSent).toBe(1);
    });
  });
});

// ============================================
// Rate Limiter Tests
// ============================================
describe('APIRateLimiter', () => {
  let rateLimiter: APIRateLimiter;

  beforeEach(() => {
    vi.useRealTimers();
    rateLimiter = new APIRateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Basic Rate Limiting', () => {
    it('should allow requests within limit', () => {
      const result = rateLimiter.checkLimit('client1');
      expect(result.allowed).toBe(true);
    });

    it('should block requests over limit', () => {
      rateLimiter = new APIRateLimiter({ maxRequests: 2, windowMs: 60000 });
      rateLimiter.checkLimit('client1');
      rateLimiter.checkLimit('client1');
      const result = rateLimiter.checkLimit('client1');
      expect(result.allowed).toBe(false);
    });

    it('should track remaining requests', () => {
      rateLimiter = new APIRateLimiter({ maxRequests: 5, windowMs: 60000 });
      const result = rateLimiter.checkLimit('client1');
      expect(result.remaining).toBe(4);
    });

    it('should reset after window expires', () => {
      vi.useFakeTimers();
      rateLimiter = new APIRateLimiter({ maxRequests: 1, windowMs: 1000 });
      rateLimiter.checkLimit('client1');
      
      vi.advanceTimersByTime(1001);
      
      const result = rateLimiter.checkLimit('client1');
      expect(result.allowed).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('Endpoint-specific Limits', () => {
    it('should apply endpoint-specific config', () => {
      rateLimiter.setEndpointConfig('/api/expensive', { maxRequests: 1, windowMs: 60000 });
      rateLimiter.checkLimit('client1', '/api/expensive');
      const result = rateLimiter.checkLimit('client1', '/api/expensive');
      expect(result.allowed).toBe(false);
    });

    it('should use default config for non-configured endpoints', () => {
      rateLimiter.setEndpointConfig('/api/expensive', { maxRequests: 1, windowMs: 60000 });
      rateLimiter.checkLimit('client1', '/api/normal');
      const result = rateLimiter.checkLimit('client1', '/api/normal');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Client Overrides', () => {
    it('should apply client-specific override', () => {
      rateLimiter.setClientOverride('vip-client', { maxRequests: 1000, windowMs: 60000 });
      for (let i = 0; i < 100; i++) {
        rateLimiter.checkLimit('vip-client');
      }
      const result = rateLimiter.checkLimit('vip-client');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Headers', () => {
    it('should return rate limit headers', () => {
      rateLimiter = new APIRateLimiter({ maxRequests: 10, windowMs: 60000 });
      rateLimiter.checkLimit('client1');
      const headers = rateLimiter.getRateLimitHeaders('client1');
      expect(headers['X-RateLimit-Limit']).toBe('10');
      expect(headers['X-RateLimit-Remaining']).toBe('9');
      expect(headers['X-RateLimit-Reset']).toBeDefined();
    });

    it('should return headers for non-existent client', () => {
      const headers = rateLimiter.getRateLimitHeaders('new-client');
      expect(headers['X-RateLimit-Limit']).toBe('100');
      expect(headers['X-RateLimit-Remaining']).toBe('100');
    });
  });

  describe('Reset', () => {
    it('should reset specific client', () => {
      rateLimiter = new APIRateLimiter({ maxRequests: 1, windowMs: 60000 });
      rateLimiter.checkLimit('client1');
      rateLimiter.reset('client1');
      const result = rateLimiter.checkLimit('client1');
      expect(result.allowed).toBe(true);
    });

    it('should reset specific endpoint for client', () => {
      rateLimiter = new APIRateLimiter({ maxRequests: 1, windowMs: 60000 });
      rateLimiter.checkLimit('client1', '/api/test');
      rateLimiter.reset('client1', '/api/test');
      const result = rateLimiter.checkLimit('client1', '/api/test');
      expect(result.allowed).toBe(true);
    });

    it('should reset all', () => {
      rateLimiter = new APIRateLimiter({ maxRequests: 1, windowMs: 60000 });
      rateLimiter.checkLimit('client1');
      rateLimiter.checkLimit('client2');
      rateLimiter.resetAll();
      expect(rateLimiter.checkLimit('client1').allowed).toBe(true);
      expect(rateLimiter.checkLimit('client2').allowed).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should return stats', () => {
      rateLimiter.checkLimit('client1');
      rateLimiter.checkLimit('client2');
      const stats = rateLimiter.getStats();
      expect(stats.totalClients).toBe(2);
    });

    it('should track hits and misses', () => {
      rateLimiter.checkLimit('client1');
      rateLimiter.checkLimit('client1');
      const stats = rateLimiter.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe('isAllowed Helper', () => {
    it('should return true when allowed', () => {
      expect(rateLimiter.isAllowed('client1')).toBe(true);
    });

    it('should return false when blocked', () => {
      rateLimiter = new APIRateLimiter({ maxRequests: 0, windowMs: 60000 });
      expect(rateLimiter.isAllowed('client1')).toBe(false);
    });
  });
});

// ============================================
// Auth Middleware Tests
// ============================================
describe('AuthMiddleware', () => {
  let authMiddleware: AuthMiddleware;

  beforeEach(() => {
    vi.useRealTimers();
    authMiddleware = new AuthMiddleware();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Bearer Token Authentication', () => {
    it('should authenticate valid bearer token', async () => {
      const middleware = authMiddleware.authenticate('bearer');
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { authorization: 'Bearer validtoken123' },
      };
      let nextCalled = false;
      await middleware(context, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
      expect(context._auth).toBeDefined();
    });

    it('should reject missing token', async () => {
      const middleware = authMiddleware.authenticate('bearer');
      const context: any = {
        method: 'GET',
        path: '/',
        headers: {},
      };
      await middleware(context, async () => {});
      expect(context._response.status).toBe(401);
    });

    it('should reject invalid bearer format', async () => {
      const middleware = authMiddleware.authenticate('bearer');
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { authorization: 'InvalidFormat' },
      };
      await middleware(context, async () => {});
      expect(context._response.status).toBe(401);
    });

    it('should reject short token', async () => {
      const middleware = authMiddleware.authenticate('bearer');
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { authorization: 'Bearer short' },
      };
      await middleware(context, async () => {});
      expect(context._response.status).toBe(401);
    });
  });

  describe('JWT Authentication', () => {
    it('should authenticate valid JWT', async () => {
      const middleware = authMiddleware.authenticate('jwt');
      // Create a simple base64 encoded JWT payload
      const payload = btoa(JSON.stringify({ sub: 'user123', roles: ['user'], scopes: ['read'] }));
      const token = `header.${payload}.signature`;
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { authorization: `Bearer ${token}` },
      };
      let nextCalled = false;
      await middleware(context, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    });

    it('should reject expired JWT', async () => {
      const middleware = authMiddleware.authenticate('jwt');
      const payload = btoa(JSON.stringify({ sub: 'user123', exp: Math.floor(Date.now() / 1000) - 1000 }));
      const token = `header.${payload}.signature`;
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { authorization: `Bearer ${token}` },
      };
      await middleware(context, async () => {});
      expect(context._response.status).toBe(401);
      expect(context._response.body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('should reject invalid JWT format', async () => {
      const middleware = authMiddleware.authenticate('jwt');
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { authorization: 'Bearer invalid' },
      };
      await middleware(context, async () => {});
      expect(context._response.status).toBe(401);
    });
  });

  describe('API Key Authentication', () => {
    it('should authenticate valid API key', async () => {
      const middleware = authMiddleware.authenticate('apikey');
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { 'x-api-key': 'key_valid123' },
      };
      let nextCalled = false;
      await middleware(context, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    });

    it('should reject invalid API key format', async () => {
      const middleware = authMiddleware.authenticate('apikey');
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { 'x-api-key': 'invalid' },
      };
      await middleware(context, async () => {});
      expect(context._response.status).toBe(401);
    });
  });

  describe('Basic Authentication', () => {
    it('should authenticate valid basic auth', async () => {
      const middleware = authMiddleware.authenticate('basic');
      const credentials = btoa('username:password');
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { authorization: credentials },
      };
      let nextCalled = false;
      await middleware(context, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    });

    it('should reject invalid base64', async () => {
      const middleware = authMiddleware.authenticate('basic');
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { authorization: '!!!invalid!!!' },
      };
      await middleware(context, async () => {});
      expect(context._response.status).toBe(401);
    });
  });

  describe('Token Lookup', () => {
    it('should look up token in query', async () => {
      const middleware = authMiddleware.authenticate('bearer', { tokenLookup: ['query'] });
      const context: any = {
        method: 'GET',
        path: '/',
        headers: {},
        query: { token: 'validtoken123456' },
      };
      let nextCalled = false;
      await middleware(context, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    });

    it('should look up token in cookie', async () => {
      const middleware = authMiddleware.authenticate('bearer', { tokenLookup: ['cookie'] });
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { cookie: 'token=validtoken123456' },
      };
      let nextCalled = false;
      await middleware(context, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    });
  });

  describe('Authorization', () => {
    it('should authorize by role', async () => {
      const middleware = authMiddleware.authorize(['admin']);
      const context: any = {
        _auth: {
          user: { id: 'user1', roles: ['admin'], scopes: [] },
          token: 'token',
          scheme: 'bearer',
        },
      };
      let nextCalled = false;
      await middleware(context, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    });

    it('should reject missing role', async () => {
      const middleware = authMiddleware.authorize(['admin']);
      const context: any = {
        _auth: {
          user: { id: 'user1', roles: ['user'], scopes: [] },
          token: 'token',
          scheme: 'bearer',
        },
      };
      await middleware(context, async () => {});
      expect(context._response.status).toBe(403);
    });

    it('should authorize by scope', async () => {
      const middleware = authMiddleware.authorize([], 'write');
      const context: any = {
        _auth: {
          user: { id: 'user1', roles: [], scopes: ['write'] },
          token: 'token',
          scheme: 'bearer',
        },
      };
      let nextCalled = false;
      await middleware(context, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    });

    it('should reject missing scope', async () => {
      const middleware = authMiddleware.authorize([], 'write');
      const context: any = {
        _auth: {
          user: { id: 'user1', roles: [], scopes: ['read'] },
          token: 'token',
          scheme: 'bearer',
        },
      };
      await middleware(context, async () => {});
      expect(context._response.status).toBe(403);
    });

    it('should reject when not authenticated', async () => {
      const middleware = authMiddleware.authorize(['admin']);
      const context: any = {};
      await middleware(context, async () => {});
      expect(context._response.status).toBe(401);
    });
  });

  describe('Custom Validators', () => {
    it('should use custom token validator', async () => {
      authMiddleware.setTokenValidator('bearer', (token) => {
        if (token === 'custom') {
          return { sub: 'custom-user', roles: ['custom'], scopes: [] };
        }
        return null;
      });
      const middleware = authMiddleware.authenticate('bearer');
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { authorization: 'Bearer custom' },
      };
      let nextCalled = false;
      await middleware(context, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    });

    it('should use custom token extractor', async () => {
      authMiddleware.setTokenExtractor((req, config) => {
        return req.headers['x-custom-auth'] || null;
      });
      const middleware = authMiddleware.authenticate('bearer');
      const context: any = {
        method: 'GET',
        path: '/',
        headers: { 'x-custom-auth': 'validtoken123456' },
      };
      let nextCalled = false;
      await middleware(context, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    });
  });

  describe('Response Generation', () => {
    it('should create auth failure response with WWW-Authenticate header', () => {
      const response = authMiddleware.createAuthFailureResponse(401, 'UNAUTHORIZED', 'Auth required', 'API');
      expect(response.status).toBe(401);
      expect(response.headers?.['WWW-Authenticate']).toBe('Bearer realm="API"');
    });

    it('should not add WWW-Authenticate for non-401 responses', () => {
      const response = authMiddleware.createAuthFailureResponse(403, 'FORBIDDEN', 'Access denied');
      expect(response.status).toBe(403);
      expect(response.headers?.['WWW-Authenticate']).toBeUndefined();
    });
  });
});

// ============================================
// API Cache Tests
// ============================================
describe('APICache', () => {
  let cache: APICache;

  beforeEach(() => {
    cache = new APICache();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Basic Operations', () => {
    it('should set and get cache entry', () => {
      cache.set('key1', {
        body: { data: 'test' },
        status: 200,
        headers: {},
        tags: [],
        createdAt: Date.now(),
        ttl: 60000,
      });
      const entry = cache.get('key1');
      expect(entry).toBeDefined();
      expect(entry?.body).toEqual({ data: 'test' });
    });

    it('should return undefined for non-existent key', () => {
      const entry = cache.get('nonexistent');
      expect(entry).toBeUndefined();
    });

    it('should return undefined for expired entry', () => {
      // Ensure real timers are being used
      vi.useRealTimers();
      const startTime = Date.now();
      cache.set('key1', {
        body: { data: 'test' },
        status: 200,
        headers: {},
        tags: [],
        createdAt: startTime,
        ttl: 1000,
      });
      // Manually advance time by waiting
      const entry1 = cache.get('key1');
      expect(entry1).toBeDefined(); // Should exist before expiration

      // Create a new cache entry that is already expired (past stale-while-revalidate window)
      // Stale window is 2x TTL, so we need age > 2 * TTL = 2000ms
      cache.set('key2', {
        body: { data: 'test2' },
        status: 200,
        headers: {},
        tags: [],
        createdAt: startTime - 3000, // Created 3 seconds ago (> 2x TTL)
        ttl: 1000, // TTL is 1 second
      });
      const entry2 = cache.get('key2');
      expect(entry2).toBeUndefined(); // Should be expired (past stale window)
    });

    it('should return stale entry for stale-while-revalidate', () => {
      vi.useFakeTimers();
      cache = new APICache({ defaultTTL: 1000 });
      cache.set('key1', {
        body: { data: 'test' },
        status: 200,
        headers: {},
        tags: [],
        createdAt: Date.now(),
        ttl: 1000,
      });
      // Advance past TTL but within 2x TTL (stale-while-revalidate window)
      vi.advanceTimersByTime(1500);
      const entry = cache.get('key1');
      expect(entry).toBeDefined();
      vi.useRealTimers();
    });

    it('should check if key exists', () => {
      cache.set('key1', {
        body: { data: 'test' },
        status: 200,
        headers: {},
        tags: [],
        createdAt: Date.now(),
        ttl: 60000,
      });
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });
  });

  describe('Invalidation', () => {
    it('should invalidate by pattern', () => {
      cache.set('users:1', { body: {}, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 60000 });
      cache.set('users:2', { body: {}, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 60000 });
      cache.set('posts:1', { body: {}, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 60000 });
      const count = cache.invalidate('users:.*');
      expect(count).toBe(2);
      expect(cache.has('users:1')).toBe(false);
      expect(cache.has('posts:1')).toBe(true);
    });

    it('should invalidate by tag', () => {
      cache.set('key1', { body: {}, status: 200, headers: {}, tags: ['users'], createdAt: Date.now(), ttl: 60000 });
      cache.set('key2', { body: {}, status: 200, headers: {}, tags: ['users'], createdAt: Date.now(), ttl: 60000 });
      cache.set('key3', { body: {}, status: 200, headers: {}, tags: ['posts'], createdAt: Date.now(), ttl: 60000 });
      const count = cache.invalidateByTag('users');
      expect(count).toBe(2);
    });

    it('should invalidate by multiple tags', () => {
      cache.set('key1', { body: {}, status: 200, headers: {}, tags: ['users', 'active'], createdAt: Date.now(), ttl: 60000 });
      cache.set('key2', { body: {}, status: 200, headers: {}, tags: ['posts'], createdAt: Date.now(), ttl: 60000 });
      const count = cache.invalidateByTags(['users', 'posts']);
      expect(count).toBe(2);
    });
  });

  describe('Key Generation', () => {
    it('should generate simple key', () => {
      const key = cache.generateKey('GET', '/users');
      expect(key).toBe('GET:/users');
    });

    it('should generate key with query params', () => {
      const key = cache.generateKey('GET', '/users', { page: '1', limit: '10' });
      expect(key).toBe('GET:/users?limit=10&page=1');
    });

    it('should generate key with headers', () => {
      const key = cache.generateKey('GET', '/users', undefined, { 'Accept': 'application/json' });
      expect(key).toBe('GET:/users|Accept:application/json');
    });

    it('should sort query params', () => {
      const key1 = cache.generateKey('GET', '/users', { z: '1', a: '2' });
      const key2 = cache.generateKey('GET', '/users', { a: '2', z: '1' });
      expect(key1).toBe(key2);
    });
  });

  describe('ETag and Last-Modified', () => {
    it('should generate ETag', () => {
      cache.set('key1', { body: { data: 'test' }, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 60000 });
      const entry = cache.get('key1');
      expect(entry?.etag).toBeDefined();
    });

    it('should check ETag match', () => {
      cache.set('key1', { body: { data: 'test' }, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 60000 });
      const entry = cache.get('key1');
      const matches = cache.checkETag('key1', entry?.etag);
      expect(matches).toBe(true);
    });

    it('should check weak ETag match', () => {
      cache.set('key1', { body: { data: 'test' }, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 60000 });
      const entry = cache.get('key1');
      const matches = cache.checkETag('key1', `W/${entry?.etag}`);
      expect(matches).toBe(true);
    });

    it('should check Last-Modified', () => {
      const now = new Date().toISOString();
      cache.set('key1', { body: {}, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 60000, lastModified: now });
      const matches = cache.checkLastModified('key1', now);
      expect(matches).toBe(true);
    });

    it('should return cache headers', () => {
      cache.set('key1', { body: {}, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 60000 });
      const headers = cache.getCacheHeaders('key1');
      expect(headers['ETag']).toBeDefined();
      expect(headers['Cache-Control']).toBeDefined();
    });
  });

  describe('Statistics', () => {
    it('should track hits and misses', () => {
      cache.get('nonexistent');
      cache.set('key1', { body: {}, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 60000 });
      cache.get('key1');
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should track stale hits', () => {
      vi.useFakeTimers();
      cache = new APICache({ defaultTTL: 1000 });
      cache.set('key1', { body: {}, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 1000 });
      vi.advanceTimersByTime(1500);
      cache.get('key1');
      const stats = cache.getStats();
      expect(stats.staleHits).toBe(1);
      vi.useRealTimers();
    });

    it('should return size', () => {
      cache.set('key1', { body: {}, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 60000 });
      cache.set('key2', { body: {}, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 60000 });
      expect(cache.getSize()).toBe(2);
    });
  });

  describe('Clear', () => {
    it('should clear all entries', () => {
      cache.set('key1', { body: {}, status: 200, headers: {}, tags: [], createdAt: Date.now(), ttl: 60000 });
      cache.clear();
      expect(cache.getSize()).toBe(0);
      expect(cache.getStats().hits).toBe(0);
    });
  });
});

// ============================================
// Request Validator Tests
// ============================================
describe('RequestValidator', () => {
  let validator: RequestValidator;

  beforeEach(() => {
    vi.useRealTimers();
    validator = new RequestValidator();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Content-Type Validation', () => {
    it('should validate content type', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: { 'content-type': 'application/json' } },
        { contentType: ['application/json'] }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject invalid content type', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: { 'content-type': 'text/plain' } },
        { contentType: ['application/json'] }
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('content-type');
    });

    it('should handle missing content type header', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: {} },
        { contentType: ['application/json'] }
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('Header Validation', () => {
    it('should validate required header', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: { 'x-api-key': 'key123' } },
        { headers: { 'X-API-Key': { required: true } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject missing required header', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: {} },
        { headers: { 'X-API-Key': { required: true } } }
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('header:X-API-Key');
    });

    it('should validate header pattern', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: { 'x-request-id': 'req-123' } },
        { headers: { 'X-Request-ID': { pattern: '^req-[0-9]+$' } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject header not matching pattern', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: { 'x-request-id': 'invalid' } },
        { headers: { 'X-Request-ID': { pattern: '^req-[0-9]+$' } } }
      );
      expect(result.valid).toBe(false);
    });

    it('should validate header values', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: { 'accept': 'application/json' } },
        { headers: { 'Accept': { values: ['application/json', 'application/xml'] } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject invalid header value', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: { 'accept': 'text/plain' } },
        { headers: { 'Accept': { values: ['application/json', 'application/xml'] } } }
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('Query Parameter Validation', () => {
    it('should validate required query param', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: {}, query: { page: '1' } },
        { query: { page: { type: 'string', required: true } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject missing required query param', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: {}, query: {} },
        { query: { page: { type: 'string', required: true } } }
      );
      expect(result.valid).toBe(false);
    });

    it('should validate string query param', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: {}, query: { name: 'John' } },
        { query: { name: { type: 'string', minLength: 2, maxLength: 50 } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should validate number query param', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: {}, query: { age: '25' } },
        { query: { age: { type: 'number', min: 0, max: 150 } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject invalid number', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: {}, query: { age: 'abc' } },
        { query: { age: { type: 'number' } } }
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('Path Parameter Validation', () => {
    it('should validate path param', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: {}, params: { id: '123' } },
        { pathParams: { id: { type: 'string', pattern: '^[0-9]+$' } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject invalid path param', () => {
      const result = validator.validateRequest(
        { method: 'GET', path: '/', headers: {}, params: { id: 'abc' } },
        { pathParams: { id: { type: 'string', pattern: '^[0-9]+$' } } }
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('Body Validation', () => {
    it('should validate required body', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: {}, body: { name: 'John' } },
        { body: { type: 'object', properties: { name: { type: 'string' } } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject missing required body', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: {} },
        { body: { type: 'object' } }
      );
      expect(result.valid).toBe(false);
    });

    it('should validate string field', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: {}, body: { name: 'John' } },
        { body: { type: 'object', properties: { name: { type: 'string', minLength: 2 } } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should validate number field', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: {}, body: { age: 25 } },
        { body: { type: 'object', properties: { age: { type: 'number', min: 0, max: 150 } } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should validate boolean field', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: {}, body: { active: true } },
        { body: { type: 'object', properties: { active: { type: 'boolean' } } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should validate array field', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: {}, body: { items: [1, 2, 3] } },
        { body: { type: 'object', properties: { items: { type: 'array', minItems: 1, maxItems: 10 } } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should validate nested object', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: {}, body: { user: { name: 'John', age: 25 } } },
        {
          body: {
            type: 'object',
            properties: {
              user: {
                type: 'object',
                properties: { name: { type: 'string' }, age: { type: 'number' } },
                required: ['name'],
              },
            },
          },
        }
      );
      expect(result.valid).toBe(true);
    });

    it('should validate enum values', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: {}, body: { status: 'active' } },
        { body: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'inactive'] } } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject invalid enum value', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: {}, body: { status: 'pending' } },
        { body: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'inactive'] } } } }
      );
      expect(result.valid).toBe(false);
    });

    it('should validate integer field', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: {}, body: { count: 5 } },
        { body: { type: 'object', properties: { count: { type: 'number', integer: true } } } }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject non-integer for integer field', () => {
      const result = validator.validateRequest(
        { method: 'POST', path: '/', headers: {}, body: { count: 5.5 } },
        { body: { type: 'object', properties: { count: { type: 'number', integer: true } } } }
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('File Upload Validation', () => {
    it('should validate file count', () => {
      const result = validator.validateRequest(
        {
          method: 'POST',
          path: '/',
          headers: {},
          files: [
            { name: 'file1.txt', size: 100, type: 'text/plain' },
            { name: 'file2.txt', size: 100, type: 'text/plain' },
          ],
        },
        { fileUpload: { maxCount: 5 } }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject too many files', () => {
      const result = validator.validateRequest(
        {
          method: 'POST',
          path: '/',
          headers: {},
          files: [
            { name: 'file1.txt', size: 100, type: 'text/plain' },
            { name: 'file2.txt', size: 100, type: 'text/plain' },
          ],
        },
        { fileUpload: { maxCount: 1 } }
      );
      expect(result.valid).toBe(false);
    });

    it('should validate file size', () => {
      const result = validator.validateRequest(
        {
          method: 'POST',
          path: '/',
          headers: {},
          files: [{ name: 'file.txt', size: 100, type: 'text/plain' }],
        },
        { fileUpload: { maxSizeBytes: 1024 } }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject file too large', () => {
      const result = validator.validateRequest(
        {
          method: 'POST',
          path: '/',
          headers: {},
          files: [{ name: 'file.txt', size: 2048, type: 'text/plain' }],
        },
        { fileUpload: { maxSizeBytes: 1024 } }
      );
      expect(result.valid).toBe(false);
    });

    it('should validate file type', () => {
      const result = validator.validateRequest(
        {
          method: 'POST',
          path: '/',
          headers: {},
          files: [{ name: 'file.jpg', size: 100, type: 'image/jpeg' }],
        },
        { fileUpload: { allowedTypes: ['image/jpeg', 'image/png'] } }
      );
      expect(result.valid).toBe(true);
    });

    it('should reject invalid file type', () => {
      const result = validator.validateRequest(
        {
          method: 'POST',
          path: '/',
          headers: {},
          files: [{ name: 'file.exe', size: 100, type: 'application/x-msdownload' }],
        },
        { fileUpload: { allowedTypes: ['image/jpeg', 'image/png'] } }
      );
      expect(result.valid).toBe(false);
    });
  });
});

// ============================================
// Response Formatter Tests
// ============================================
describe('ResponseFormatter', () => {
  let formatter: ResponseFormatter;

  beforeEach(() => {
    vi.useRealTimers();
    formatter = new ResponseFormatter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Success Responses', () => {
    it('should create success response', () => {
      const response = formatter.success({ name: 'John' });
      expect(response.success).toBe(true);
      expect(response.data).toEqual({ name: 'John' });
      expect(response.timestamp).toBeDefined();
    });

    it('should include meta in success response', () => {
      const response = formatter.success({ name: 'John' }, { requestId: 'req-123' });
      expect(response.meta?.requestId).toBe('req-123');
    });
  });

  describe('Error Responses', () => {
    it('should create error response', () => {
      const response = formatter.error('NOT_FOUND', 'Resource not found');
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('NOT_FOUND');
      expect(response.error?.message).toBe('Resource not found');
    });

    it('should include error details', () => {
      const response = formatter.error('VALIDATION_ERROR', 'Invalid input', { field: 'email' });
      expect(response.error?.details).toEqual({ field: 'email' });
    });
  });

  describe('Pagination', () => {
    it('should paginate array', () => {
      const data = [1, 2, 3, 4, 5];
      const response = formatter.paginate(data, 1, 2);
      expect(response.data).toEqual([1, 2]);
      expect(response.pagination.total).toBe(5);
      expect(response.pagination.totalPages).toBe(3);
    });

    it('should handle empty array', () => {
      const response = formatter.paginate([], 1, 10);
      expect(response.data).toEqual([]);
      expect(response.pagination.total).toBe(0);
      expect(response.pagination.totalPages).toBe(0);
    });

    it('should paginate with total', () => {
      const response = formatter.paginateWithTotal([1, 2], 100, 1, 10);
      expect(response.pagination.total).toBe(100);
      expect(response.pagination.totalPages).toBe(10);
    });
  });

  describe('Status Code Helpers', () => {
    it('should create created response', () => {
      const response = formatter.created({ id: '123' }, '/resources/123');
      expect(response.success).toBe(true);
      expect(response.meta?.location).toBe('/resources/123');
    });

    it('should create no content response', () => {
      const response = formatter.noContent();
      expect(response.success).toBe(true);
      expect(response.data).toBeUndefined();
    });

    it('should create not found response', () => {
      const response = formatter.notFound('User', '123');
      expect(response.error?.code).toBe('NOT_FOUND');
      expect(response.error?.message).toContain('User');
      expect(response.error?.message).toContain('123');
    });

    it('should create unauthorized response', () => {
      const response = formatter.unauthorized();
      expect(response.error?.code).toBe('UNAUTHORIZED');
    });

    it('should create forbidden response', () => {
      const response = formatter.forbidden();
      expect(response.error?.code).toBe('FORBIDDEN');
    });

    it('should create bad request response', () => {
      const response = formatter.badRequest('Invalid input', { field: 'email' });
      expect(response.error?.code).toBe('BAD_REQUEST');
    });

    it('should create internal error response', () => {
      const response = formatter.internalError();
      expect(response.error?.code).toBe('INTERNAL_ERROR');
    });

    it('should create too many requests response', () => {
      const response = formatter.tooManyRequests(60);
      expect(response.error?.code).toBe('TOO_MANY_REQUESTS');
      expect(response.error?.details).toEqual({ retryAfter: 60 });
    });
  });

  describe('HATEOAS Links', () => {
    it('should generate pagination links', () => {
      const links = formatter.generateHATEOASLinks('/api/users', 2, 10, 50);
      expect(links.find((l) => l.rel === 'self')).toBeDefined();
      expect(links.find((l) => l.rel === 'prev')).toBeDefined();
      expect(links.find((l) => l.rel === 'next')).toBeDefined();
      expect(links.find((l) => l.rel === 'first')).toBeDefined();
      expect(links.find((l) => l.rel === 'last')).toBeDefined();
    });

    it('should not include prev on first page', () => {
      const links = formatter.generateHATEOASLinks('/api/users', 1, 10, 50);
      expect(links.find((l) => l.rel === 'prev')).toBeUndefined();
    });

    it('should not include next on last page', () => {
      const links = formatter.generateHATEOASLinks('/api/users', 5, 10, 50);
      expect(links.find((l) => l.rel === 'next')).toBeUndefined();
    });
  });

  describe('Format Conversion', () => {
    it('should format as JSON', () => {
      const envelope = formatter.success({ name: 'John' });
      const formatted = formatter.format(envelope, 'json');
      expect(JSON.parse(formatted)).toEqual(envelope);
    });

    it('should format as XML', () => {
      const envelope = formatter.success({ name: 'John' });
      const formatted = formatter.format(envelope, 'xml');
      expect(formatted).toContain('<?xml');
      expect(formatted).toContain('<success>true</success>');
    });

    it('should escape XML special characters', () => {
      const envelope = formatter.success({ text: '<script>alert("xss")</script>' });
      const formatted = formatter.format(envelope, 'xml');
      expect(formatted).not.toContain('<script>');
      expect(formatted).toContain('&lt;script&gt;');
    });

    it('should format as msgpack (simulated)', () => {
      const envelope = formatter.success({ name: 'John' });
      const formatted = formatter.format(envelope, 'msgpack');
      expect(formatted).toContain('__msgpack');
    });

    it('should use default content type', () => {
      formatter.setDefaultContentType('xml');
      const envelope = formatter.success({ name: 'John' });
      const formatted = formatter.format(envelope);
      expect(formatted).toContain('<?xml');
    });
  });
});

// ============================================
// CORS Handler Tests
// ============================================
describe('CORSHandler', () => {
  let corsHandler: CORSHandler;

  beforeEach(() => {
    vi.useRealTimers();
    corsHandler = new CORSHandler();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Basic CORS', () => {
    it('should allow all origins by default', () => {
      const headers = corsHandler.handle({ method: 'GET', path: '/', headers: { origin: 'http://example.com' } });
      expect(headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('should allow specific origin', () => {
      corsHandler = new CORSHandler({ origin: 'http://example.com' });
      const headers = corsHandler.handle({ method: 'GET', path: '/', headers: { origin: 'http://example.com' } });
      expect(headers['Access-Control-Allow-Origin']).toBe('http://example.com');
    });

    it('should allow origin from array', () => {
      corsHandler = new CORSHandler({ origin: ['http://example.com', 'http://test.com'] });
      const headers = corsHandler.handle({ method: 'GET', path: '/', headers: { origin: 'http://test.com' } });
      expect(headers['Access-Control-Allow-Origin']).toBe('http://test.com');
    });

    it('should use function to check origin', () => {
      corsHandler = new CORSHandler({ origin: (o) => o.endsWith('.example.com') });
      const headers = corsHandler.handle({ method: 'GET', path: '/', headers: { origin: 'http://app.example.com' } });
      expect(headers['Access-Control-Allow-Origin']).toBe('http://app.example.com');
    });

    it('should reject non-matching origin', () => {
      corsHandler = new CORSHandler({ origin: (o) => o.endsWith('.example.com') });
      const headers = corsHandler.handle({ method: 'GET', path: '/', headers: { origin: 'http://evil.com' } });
      expect(headers['Access-Control-Allow-Origin']).toBe('');
    });

    it('should add Vary header for dynamic origins', () => {
      corsHandler = new CORSHandler({ origin: ['http://example.com'] });
      const headers = corsHandler.handle({ method: 'GET', path: '/', headers: { origin: 'http://example.com' } });
      expect(headers['Vary']).toBe('Origin');
    });
  });

  describe('Methods and Headers', () => {
    it('should include allowed methods', () => {
      const headers = corsHandler.handle({ method: 'GET', path: '/', headers: {} });
      expect(headers['Access-Control-Allow-Methods']).toContain('GET');
      expect(headers['Access-Control-Allow-Methods']).toContain('POST');
    });

    it('should include allowed headers', () => {
      const headers = corsHandler.handle({ method: 'GET', path: '/', headers: {} });
      expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    });

    it('should include exposed headers', () => {
      const headers = corsHandler.handle({ method: 'GET', path: '/', headers: {} });
      expect(headers['Access-Control-Expose-Headers']).toContain('X-RateLimit');
    });
  });

  describe('Credentials', () => {
    it('should include credentials header when enabled', () => {
      corsHandler = new CORSHandler({ credentials: true });
      const headers = corsHandler.handle({ method: 'GET', path: '/', headers: {} });
      expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    });

    it('should not include credentials header when disabled', () => {
      corsHandler = new CORSHandler({ credentials: false });
      const headers = corsHandler.handle({ method: 'GET', path: '/', headers: {} });
      expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
    });
  });

  describe('Max Age', () => {
    it('should include max age header', () => {
      corsHandler = new CORSHandler({ maxAge: 3600 });
      const headers = corsHandler.handle({ method: 'GET', path: '/', headers: {} });
      expect(headers['Access-Control-Max-Age']).toBe('3600');
    });
  });

  describe('Preflight Detection', () => {
    it('should detect preflight request', () => {
      const isPreflight = corsHandler.isPreflight({
        method: 'OPTIONS',
        path: '/',
        headers: { origin: 'http://example.com', 'access-control-request-method': 'POST' },
      });
      expect(isPreflight).toBe(true);
    });

    it('should not detect non-preflight request', () => {
      const isPreflight = corsHandler.isPreflight({
        method: 'GET',
        path: '/',
        headers: { origin: 'http://example.com' },
      });
      expect(isPreflight).toBe(false);
    });
  });

  describe('CORS Request Detection', () => {
    it('should detect CORS request', () => {
      const isCORS = corsHandler.isCORSRequest({
        method: 'GET',
        path: '/',
        headers: { origin: 'http://example.com', host: 'api.example.com' },
      });
      expect(isCORS).toBe(true);
    });

    it('should not detect same-origin request', () => {
      const isCORS = corsHandler.isCORSRequest({
        method: 'GET',
        path: '/',
        headers: { origin: 'http://example.com', host: 'example.com' },
      });
      expect(isCORS).toBe(false);
    });
  });

  describe('Route-specific Config', () => {
    it('should apply route-specific config', () => {
      corsHandler.setRouteConfig('/api/*', { origin: 'http://api.example.com' });
      const headers = corsHandler.handle(
        { method: 'GET', path: '/api/users', headers: { origin: 'http://api.example.com' } },
        '/api/*'
      );
      expect(headers['Access-Control-Allow-Origin']).toBe('http://api.example.com');
    });

    it('should remove route config', () => {
      corsHandler.setRouteConfig('/api/*', { origin: 'http://api.example.com' });
      corsHandler.removeRouteConfig('/api/*');
      const config = corsHandler.getRouteConfig('/api/*');
      expect(config).toBeUndefined();
    });
  });

  describe('Config Management', () => {
    it('should get default config', () => {
      const config = corsHandler.getDefaultConfig();
      expect(config.origin).toBe('*');
    });

    it('should update default config', () => {
      corsHandler.updateDefaultConfig({ credentials: true });
      const config = corsHandler.getDefaultConfig();
      expect(config.credentials).toBe(true);
    });
  });

  describe('Factory Methods', () => {
    it('should create default handler', () => {
      const handler = CORSHandler.createDefault();
      expect(handler).toBeInstanceOf(CORSHandler);
    });

    it('should create strict handler', () => {
      const handler = CORSHandler.createStrict(['http://example.com']);
      const config = handler.getDefaultConfig();
      expect(config.origin).toEqual(['http://example.com']);
      expect(config.credentials).toBe(true);
    });

    it('should create permissive handler', () => {
      const handler = CORSHandler.createPermissive();
      const config = handler.getDefaultConfig();
      expect(config.origin).toBe('*');
      expect(config.allowedHeaders).toContain('*');
    });
  });
});

// ============================================
// API Documentation Tests
// ============================================
describe('APIDocumentationGenerator', () => {
  let docGen: APIDocumentationGenerator;

  beforeEach(() => {
    vi.useRealTimers();
    docGen = new APIDocumentationGenerator();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Endpoint Registration', () => {
    it('should register endpoint', () => {
      docGen.registerEndpoint('/users', 'GET', {
        summary: 'List users',
        tags: ['users'],
      });
      const endpoints = docGen.getEndpoints();
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].route).toBe('/users');
    });

    it('should normalize route', () => {
      docGen.registerEndpoint('/users/', 'GET', { summary: 'List users' });
      const spec = docGen.generateOpenAPISpec();
      expect(spec.paths['/users']).toBeDefined();
    });

    it('should normalize method to uppercase', () => {
      docGen.registerEndpoint('/users', 'get', { summary: 'List users' });
      const spec = docGen.generateOpenAPISpec();
      expect(spec.paths['/users'].get).toBeDefined();
    });
  });

  describe('OpenAPI Spec Generation', () => {
    it('should generate OpenAPI spec', () => {
      docGen.registerEndpoint('/users', 'GET', {
        summary: 'List users',
        tags: ['users'],
        parameters: [{ name: 'page', in: 'query', type: 'integer' }],
        responses: { '200': { description: 'Success' } },
      });
      const spec = docGen.generateOpenAPISpec();
      expect(spec.openapi).toBe('3.0.0');
      expect(spec.info.title).toBe('API Documentation');
      expect(spec.paths['/users'].get.summary).toBe('List users');
    });

    it('should include security schemes', () => {
      docGen.addSecurityScheme('bearerAuth', { type: 'http', scheme: 'bearer' });
      const spec = docGen.generateOpenAPISpec();
      expect(spec.components?.securitySchemes?.bearerAuth).toBeDefined();
    });

    it('should include tags', () => {
      docGen.registerEndpoint('/users', 'GET', { summary: 'List users', tags: ['Users'] });
      docGen.addTag('Users', 'User management');
      const spec = docGen.generateOpenAPISpec();
      expect(spec.tags).toContainEqual({ name: 'Users', description: 'User management' });
    });

    it('should generate operationId', () => {
      docGen.registerEndpoint('/users', 'GET', { summary: 'List users' });
      const spec = docGen.generateOpenAPISpec();
      expect(spec.paths['/users'].get.operationId).toBe('getUsers');
    });

    it('should handle parameterized routes in operationId', () => {
      docGen.registerEndpoint('/users/:id', 'GET', { summary: 'Get user' });
      const spec = docGen.generateOpenAPISpec();
      expect(spec.paths['/users/:id'].get.operationId).toBe('getUsersById');
    });
  });

  describe('Markdown Generation', () => {
    it('should generate markdown', () => {
      docGen.registerEndpoint('/users', 'GET', {
        summary: 'List users',
        description: 'Get a list of all users',
        tags: ['Users'],
        parameters: [{ name: 'page', in: 'query', type: 'integer', description: 'Page number' }],
        responses: { '200': { description: 'Success' } },
      });
      const markdown = docGen.generateMarkdown();
      expect(markdown).toContain('# API Documentation');
      expect(markdown).toContain('## Users');
      expect(markdown).toContain('GET /users');
      expect(markdown).toContain('List users');
    });

    it('should mark deprecated endpoints', () => {
      docGen.registerEndpoint('/old', 'GET', { summary: 'Old endpoint', deprecated: true });
      const markdown = docGen.generateMarkdown();
      expect(markdown).toContain('**Deprecated**');
    });
  });

  describe('Explorer Data', () => {
    it('should generate explorer data', () => {
      docGen.registerEndpoint('/users', 'GET', { summary: 'List users', tags: ['users'] });
      const data = docGen.generateExplorerData();
      expect(data.routes).toHaveLength(1);
      expect(data.routes[0].method).toBe('GET');
      expect(data.routes[0].path).toBe('/users');
    });
  });

  describe('Constructor Options', () => {
    it('should use custom title', () => {
      docGen = new APIDocumentationGenerator({ title: 'My API' });
      const spec = docGen.generateOpenAPISpec();
      expect(spec.info.title).toBe('My API');
    });

    it('should use custom version', () => {
      docGen = new APIDocumentationGenerator({ version: '2.0.0' });
      const spec = docGen.generateOpenAPISpec();
      expect(spec.info.version).toBe('2.0.0');
    });

    it('should use custom description', () => {
      docGen = new APIDocumentationGenerator({ description: 'API description' });
      const spec = docGen.generateOpenAPISpec();
      expect(spec.info.description).toBe('API description');
    });
  });
});
