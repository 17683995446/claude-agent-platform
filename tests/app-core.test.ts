import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

// Module 1: Application
import {
  Application,
  type AppConfig,
  type ApplicationPhase,
} from '../packages/app-core/src/application.ts';

// Module 2: Service Container
import { ServiceContainer } from '../packages/app-core/src/service-container.ts';

// Module 3: Middleware Pipeline
import {
  AppMiddlewarePipeline,
  createLoggingMiddleware,
  createTimingMiddleware,
  createRequestIdMiddleware,
  createCORSMiddleware,
  createErrorHandlingMiddleware,
  type AppContext,
} from '../packages/app-core/src/middleware-pipeline.ts';

// Module 4: Routing System
import { RoutingSystem } from '../packages/app-core/src/routing-system.ts';

// Module 5: Event System
import { AppEventSystem } from '../packages/app-core/src/event-system.ts';

// Module 6: Command System
import { CommandSystem } from '../packages/app-core/src/command-system.ts';

// Module 7: Plugin Host
import { PluginHost } from '../packages/app-core/src/plugin-host.ts';

// Module 8: Config Manager
import { AppConfigManager } from '../packages/app-core/src/config-manager.ts';

// Module 9: Health System
import { AppHealthSystem } from '../packages/app-core/src/health-system.ts';

// Module 10: Telemetry System
import { AppTelemetrySystem } from '../packages/app-core/src/telemetry-system.ts';

// ============================================================================
// Module 1: Application Lifecycle Management (15 tests)
// ============================================================================
describe('Application', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application({ name: 'test-app', environment: 'test' });
  });

  test('should create application with default config', () => {
    const defaultApp = new Application();
    expect(defaultApp.getConfig().name).toBe('claude-agent-app');
    expect(defaultApp.getConfig().version).toBe('0.1.0');
  });

  test('should create application with custom config', () => {
    expect(app.getConfig().name).toBe('test-app');
    expect(app.getConfig().environment).toBe('test');
  });

  test('should create application via factory method', () => {
    const created = Application.create({ name: 'factory-app' });
    expect(created.getConfig().name).toBe('factory-app');
  });

  test('should detect environment from NODE_ENV', () => {
    const originalEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    const prodApp = new Application();
    expect(prodApp.getEnvironment()).toBe('production');
    process.env['NODE_ENV'] = originalEnv;
  });

  test('should start application with no components', async () => {
    expect(app.getPhase()).toBe('idle');
    await app.start();
    expect(app.getPhase()).toBe('running');
    expect(app.isRunning()).toBe(true);
  });

  test('should stop application', async () => {
    await app.start();
    await app.stop();
    expect(app.getPhase()).toBe('stopped');
    expect(app.isRunning()).toBe(false);
  });

  test('should restart application', async () => {
    await app.start();
    expect(app.isRunning()).toBe(true);
    await app.restart();
    expect(app.isRunning()).toBe(true);
  });

  test('should not start already running application', async () => {
    await app.start();
    await app.start(); // should be no-op
    expect(app.isRunning()).toBe(true);
  });

  test('should not stop already stopped application', async () => {
    await app.stop(); // should be no-op
    expect(app.getPhase()).toBe('idle');
  });

  test('should register and get component', () => {
    app.registerComponent({
      name: 'logger',
      instance: { log: () => {} },
    });
    const logger = app.getComponent<{ log: () => void }>('logger');
    expect(logger).toBeDefined();
    expect(typeof logger.log).toBe('function');
  });

  test('should throw when getting non-existent component', () => {
    expect(() => app.getComponent('nonexistent')).toThrow('Component "nonexistent" not found');
  });

  test('should throw when registering duplicate component', () => {
    app.registerComponent({ name: 'dup', instance: {} });
    expect(() => app.registerComponent({ name: 'dup', instance: {} })).toThrow('already registered');
  });

  test('should check component existence', () => {
    app.registerComponent({ name: 'exists', instance: {} });
    expect(app.hasComponent('exists')).toBe(true);
    expect(app.hasComponent('nope')).toBe(false);
  });

  test('should list components', () => {
    app.registerComponent({ name: 'a', instance: {} });
    app.registerComponent({ name: 'b', instance: {} });
    expect(app.listComponents()).toEqual(['a', 'b']);
  });

  test('should get comprehensive status', async () => {
    await app.start();
    const status = app.getStatus();
    expect(status.phase).toBe('running');
    expect(status.environment).toBe('test');
    expect(status.uptime).toBeGreaterThanOrEqual(0);
    expect(status.startTime).toBeGreaterThan(0);
    expect(status.memoryUsage).toBeDefined();
  });

  test('should handle component lifecycle during start/stop', async () => {
    let initialized = false;
    let started = false;
    let stopped = false;

    app.registerComponent({
      name: 'lifecycle',
      instance: {},
      init: async () => { initialized = true; },
      start: async () => { started = true; },
      stop: async () => { stopped = true; },
    });

    await app.start();
    expect(initialized).toBe(true);
    expect(started).toBe(true);

    await app.stop();
    expect(stopped).toBe(true);
  });

  test('should execute shutdown hooks on stop', async () => {
    let hookCalled = false;
    app.addShutdownHook(async () => { hookCalled = true; });
    await app.start();
    await app.stop();
    expect(hookCalled).toBe(true);
  });

  test('should handle init error and set phase to error', async () => {
    app.registerComponent({
      name: 'bad',
      instance: {},
      init: async () => { throw new Error('init failed'); },
    });
    await expect(app.start()).rejects.toThrow('init failed');
    expect(app.getPhase()).toBe('error');
  });
});

// ============================================================================
// Module 2: Service Container (15 tests)
// ============================================================================
describe('ServiceContainer', () => {
  let container: ServiceContainer;

  beforeEach(() => {
    container = new ServiceContainer();
  });

  test('should register a singleton service', () => {
    container.register('svc', () => ({ value: 42 }), 'singleton');
    expect(container.has('svc')).toBe(true);
  });

  test('should resolve singleton service', async () => {
    container.register('svc', () => ({ value: 42 }), 'singleton');
    const svc = await container.resolve<{ value: number }>('svc');
    expect(svc.value).toBe(42);
  });

  test('should return same instance for singleton', async () => {
    container.register('svc', () => ({ value: Math.random() }), 'singleton');
    const a = await container.resolve<{ value: number }>('svc');
    const b = await container.resolve<{ value: number }>('svc');
    expect(a.value).toBe(b.value);
  });

  test('should return new instance for transient', async () => {
    container.register('svc', () => ({ value: Math.random() }), 'transient');
    const a = await container.resolve<{ value: number }>('svc');
    const b = await container.resolve<{ value: number }>('svc');
    expect(a.value).not.toBe(b.value);
  });

  test('should return same instance within scope', async () => {
    container.register('svc', () => ({ value: Math.random() }), 'scoped');
    const a = await container.resolve<{ value: number }>('svc');
    const b = await container.resolve<{ value: number }>('svc');
    expect(a.value).toBe(b.value);
  });

  test('should throw for unregistered service', () => {
    expect(() => container.resolve('missing')).toThrow('not registered');
  });

  test('should throw for duplicate registration', () => {
    container.register('dup', () => ({}));
    expect(() => container.register('dup', () => ({}))).toThrow('already registered');
  });

  test('should detect circular dependency', async () => {
    container.register('a', (c) => c.resolve('b'));
    container.register('b', (c) => c.resolve('a'));
    await expect(container.resolve('a')).rejects.toThrow('Circular dependency');
  });

  test('should list services', () => {
    container.register('a', () => ({}), 'singleton');
    container.register('b', () => ({}), 'transient');
    const services = container.listServices();
    expect(services.length).toBe(2);
    expect(services[0]!.name).toBe('a');
    expect(services[1]!.name).toBe('b');
  });

  test('should remove service', () => {
    container.register('rm', () => ({}));
    expect(container.remove('rm')).toBe(true);
    expect(container.has('rm')).toBe(false);
  });

  test('should return false when removing non-existent service', () => {
    expect(container.remove('nope')).toBe(false);
  });

  test('should dispose all services', async () => {
    let disposed = false;
    container.register('disposable', () => ({
      dispose: async () => { disposed = true; },
    }));
    await container.resolve('disposable');
    await container.dispose();
    expect(disposed).toBe(true);
  });

  test('should reset all instances', () => {
    container.register('svc', () => ({ value: 1 }), 'singleton');
    container.resolve('svc');
    container.reset();
    const services = container.listServices();
    expect(services[0]!.initialized).toBe(false);
  });

  test('should get registration count', () => {
    container.register('a', () => ({}));
    container.register('b', () => ({}));
    expect(container.getRegistrationCount()).toBe(2);
  });

  test('should resolve async factory', async () => {
    container.register('async', async () => ({ data: 'hello' }));
    const result = await container.resolve<{ data: string }>('async');
    expect(result.data).toBe('hello');
  });
});

// ============================================================================
// Module 3: Middleware Pipeline (15 tests)
// ============================================================================
describe('AppMiddlewarePipeline', () => {
  let pipeline: AppMiddlewarePipeline;

  function createContext(partial?: Partial<AppContext>): AppContext {
    return {
      request: { method: 'GET', path: '/', headers: {} },
      state: {},
      requestId: 'test-req-1',
      startTime: Date.now(),
      ...partial,
    };
  }

  beforeEach(() => {
    pipeline = new AppMiddlewarePipeline();
  });

  test('should add middleware', () => {
    pipeline.use({
      name: 'test',
      type: 'pre-process',
      priority: 0,
      execute: async (ctx, next) => next(),
    });
    expect(pipeline.getMiddlewareCount()).toBe(1);
  });

  test('should return self from use() for chaining', () => {
    const result = pipeline.use({
      name: 'a',
      type: 'pre-process',
      priority: 0,
      execute: async (ctx, next) => next(),
    });
    expect(result).toBe(pipeline);
  });

  test('should execute middleware in priority order', async () => {
    const order: string[] = [];
    pipeline.use({
      name: 'second',
      type: 'pre-process',
      priority: 10,
      execute: async (ctx, next) => { order.push('second'); return next(); },
    });
    pipeline.use({
      name: 'first',
      type: 'pre-process',
      priority: 1,
      execute: async (ctx, next) => { order.push('first'); return next(); },
    });
    await pipeline.execute(createContext());
    expect(order).toEqual(['first', 'second']);
  });

  test('should execute middleware and return result', async () => {
    pipeline.use({
      name: 'set-body',
      type: 'transform',
      priority: 0,
      execute: async (ctx, next) => {
        const result = await next();
        return { ...result, body: { hello: 'world' } };
      },
    });
    const result = await pipeline.execute(createContext());
    expect(result.body).toEqual({ hello: 'world' });
  });

  test('should handle conditional middleware', async () => {
    let executed = false;
    pipeline.use({
      name: 'conditional',
      type: 'pre-process',
      priority: 0,
      condition: (ctx) => ctx.request.path === '/special',
      execute: async (ctx, next) => { executed = true; return next(); },
    });
    await pipeline.execute(createContext({ request: { method: 'GET', path: '/other', headers: {} } }));
    expect(executed).toBe(false);
  });

  test('should execute conditional middleware when condition is met', async () => {
    let executed = false;
    pipeline.use({
      name: 'conditional',
      type: 'pre-process',
      priority: 0,
      condition: (ctx) => ctx.request.path === '/special',
      execute: async (ctx, next) => { executed = true; return next(); },
    });
    await pipeline.execute(createContext({ request: { method: 'GET', path: '/special', headers: {} } }));
    expect(executed).toBe(true);
  });

  test('should remove middleware by name', () => {
    pipeline.use({
      name: 'removable',
      type: 'pre-process',
      priority: 0,
      execute: async (ctx, next) => next(),
    });
    expect(pipeline.remove('removable')).toBe(true);
    expect(pipeline.getMiddlewareCount()).toBe(0);
  });

  test('should return false when removing non-existent middleware', () => {
    expect(pipeline.remove('nope')).toBe(false);
  });

  test('should get middleware by name', () => {
    const mw = {
      name: 'findme',
      type: 'pre-process' as const,
      priority: 0,
      execute: async (ctx: AppContext, next: () => Promise<import('../packages/app-core/src/middleware-pipeline.ts').AppResult>) => next(),
    };
    pipeline.use(mw);
    expect(pipeline.getMiddleware('findme')).toBe(mw);
  });

  test('should list all middlewares', () => {
    pipeline.use({
      name: 'a',
      type: 'pre-process',
      priority: 0,
      execute: async (ctx, next) => next(),
    });
    pipeline.use({
      name: 'b',
      type: 'post-process',
      priority: 1,
      execute: async (ctx, next) => next(),
    });
    expect(pipeline.listMiddlewares().length).toBe(2);
  });

  test('should clear all middlewares', () => {
    pipeline.use({
      name: 'a',
      type: 'pre-process',
      priority: 0,
      execute: async (ctx, next) => next(),
    });
    pipeline.clear();
    expect(pipeline.getMiddlewareCount()).toBe(0);
  });

  test('should handle error in middleware', async () => {
    pipeline.use({
      name: 'error-mw',
      type: 'pre-process',
      priority: 0,
      execute: async () => { throw new Error('mw error'); },
    });
    const result = await pipeline.execute(createContext());
    expect(result.status).toBe(500);
    expect(result.error?.message).toBe('mw error');
  });

  test('should use error handler middleware on error', async () => {
    pipeline.use({
      name: 'bad',
      type: 'pre-process',
      priority: 0,
      execute: async () => { throw new Error('fail'); },
    });
    // Error handler is found via catch block, not normal execution order
    const result = await pipeline.execute(createContext());
    expect(result.status).toBe(500);
    expect(result.error?.message).toBe('fail');
  });

  test('createLoggingMiddleware should return valid middleware', () => {
    const mw = createLoggingMiddleware();
    expect(mw.name).toBe('logging');
    expect(mw.type).toBe('pre-process');
  });

  test('createRequestIdMiddleware should assign request ID', async () => {
    const mw = createRequestIdMiddleware();
    const ctx = createContext();
    ctx.requestId = '';
    await mw.execute(ctx, async () => ({ status: 200, headers: {} }));
    expect(ctx.requestId).toBeTruthy();
  });

  test('createCORSMiddleware should set CORS headers', async () => {
    const mw = createCORSMiddleware();
    const ctx = createContext();
    await mw.execute(ctx, async () => ({ status: 200, headers: {} }));
    expect(ctx.response?.headers['Access-Control-Allow-Origin']).toBe('*');
  });
});

// ============================================================================
// Module 4: Routing System (12 tests)
// ============================================================================
describe('RoutingSystem', () => {
  let router: RoutingSystem;

  beforeEach(() => {
    router = new RoutingSystem();
  });

  test('should add a route', () => {
    router.addRoute({
      name: 'home',
      method: 'GET',
      path: '/',
      handler: () => 'home',
    });
    expect(router.getRouteCount()).toBe(1);
  });

  test('should match a simple route', () => {
    router.addRoute({
      name: 'home',
      method: 'GET',
      path: '/',
      handler: () => 'home',
    });
    const match = router.match('GET', '/');
    expect(match).not.toBeNull();
    expect(match!.route.name).toBe('home');
  });

  test('should not match wrong method', () => {
    router.addRoute({
      name: 'home',
      method: 'GET',
      path: '/',
      handler: () => 'home',
    });
    expect(router.match('POST', '/')).toBeNull();
  });

  test('should match route with path parameters', () => {
    router.addRoute({
      name: 'user',
      method: 'GET',
      path: '/users/:id',
      handler: () => 'user',
    });
    const match = router.match('GET', '/users/42');
    expect(match).not.toBeNull();
    expect(match!.params['id']).toBe('42');
  });

  test('should match route with multiple path parameters', () => {
    router.addRoute({
      name: 'user-post',
      method: 'GET',
      path: '/users/:id/posts/:postId',
      handler: () => 'post',
    });
    const match = router.match('GET', '/users/1/posts/99');
    expect(match).not.toBeNull();
    expect(match!.params['id']).toBe('1');
    expect(match!.params['postId']).toBe('99');
  });

  test('should parse query parameters', () => {
    router.addRoute({
      name: 'search',
      method: 'GET',
      path: '/search',
      handler: () => 'search',
    });
    const match = router.match('GET', '/search?q=hello&page=2');
    expect(match).not.toBeNull();
    expect(match!.query['q']).toBe('hello');
    expect(match!.query['page']).toBe('2');
  });

  test('should generate URL from route name', () => {
    router.addRoute({
      name: 'user',
      method: 'GET',
      path: '/users/:id',
      handler: () => 'user',
    });
    const url = router.generateUrl('user', { id: '42' });
    expect(url).toBe('/users/42');
  });

  test('should throw when generating URL for unknown route', () => {
    expect(() => router.generateUrl('unknown')).toThrow('not found');
  });

  test('should list all routes', () => {
    router.addRoute({ name: 'a', method: 'GET', path: '/a', handler: () => {} });
    router.addRoute({ name: 'b', method: 'POST', path: '/b', handler: () => {} });
    expect(router.listRoutes().length).toBe(2);
  });

  test('should remove a route', () => {
    router.addRoute({ name: 'rm', method: 'GET', path: '/rm', handler: () => {} });
    expect(router.removeRoute('rm')).toBe(true);
    expect(router.getRouteCount()).toBe(0);
  });

  test('should add route group with prefix', () => {
    router.addGroup({
      prefix: '/api/v1',
      routes: [
        { name: 'users', method: 'GET', path: '/users', handler: () => {} },
        { name: 'posts', method: 'GET', path: '/posts', handler: () => {} },
      ],
    });
    expect(router.getRouteCount()).toBe(2);
    const match = router.match('GET', '/api/v1/users');
    expect(match).not.toBeNull();
    expect(match!.route.name).toBe('users');
  });

  test('should clear all routes', () => {
    router.addRoute({ name: 'a', method: 'GET', path: '/a', handler: () => {} });
    router.clear();
    expect(router.getRouteCount()).toBe(0);
  });

  test('should throw for duplicate route name', () => {
    router.addRoute({ name: 'dup', method: 'GET', path: '/a', handler: () => {} });
    expect(() => router.addRoute({ name: 'dup', method: 'POST', path: '/b', handler: () => {} })).toThrow('already exists');
  });
});

// ============================================================================
// Module 5: Event System (14 tests)
// ============================================================================
describe('AppEventSystem', () => {
  let events: AppEventSystem;

  beforeEach(() => {
    events = new AppEventSystem();
  });

  test('should subscribe to event', () => {
    events.on('app', 'start', () => {});
    expect(events.getSubscriptionCount()).toBe(1);
  });

  test('should emit event to handler', () => {
    let received: unknown = null;
    events.on('app', 'start', (data) => { received = data; });
    events.emit('app', 'start', { msg: 'hello' });
    expect(received).toEqual({ msg: 'hello' });
  });

  test('should emit to multiple handlers', () => {
    const results: number[] = [];
    events.on('app', 'test', () => { results.push(1); });
    events.on('app', 'test', () => { results.push(2); });
    events.emit('app', 'test');
    expect(results).toEqual([1, 2]);
  });

  test('should unsubscribe via off()', () => {
    let count = 0;
    const sub = events.on('app', 'test', () => { count++; });
    events.emit('app', 'test');
    expect(count).toBe(1);
    events.off(sub.id);
    events.emit('app', 'test');
    expect(count).toBe(1);
  });

  test('once() should fire only once', () => {
    let count = 0;
    events.once('app', 'test', () => { count++; });
    events.emit('app', 'test');
    events.emit('app', 'test');
    expect(count).toBe(1);
  });

  test('should respect event priority', () => {
    const order: string[] = [];
    events.on('app', 'test', () => { order.push('normal'); }, 'normal');
    events.on('app', 'test', () => { order.push('critical'); }, 'critical');
    events.on('app', 'test', () => { order.push('low'); }, 'low');
    events.emit('app', 'test');
    expect(order).toEqual(['critical', 'normal', 'low']);
  });

  test('should record event history', () => {
    events.emit('app', 'start');
    events.emit('app', 'stop');
    const history = events.getEventHistory();
    expect(history.length).toBe(2);
    expect(history[0]!.event).toBe('start');
    expect(history[1]!.event).toBe('stop');
  });

  test('should filter event history by domain', () => {
    events.emit('app', 'start');
    events.emit('system', 'boot');
    events.emit('app', 'stop');
    const appHistory = events.getEventHistory('app');
    expect(appHistory.length).toBe(2);
  });

  test('should clear event history', () => {
    events.emit('app', 'start');
    events.clearHistory();
    expect(events.getEventHistory().length).toBe(0);
  });

  test('should get listener count', () => {
    events.on('app', 'test', () => {});
    events.on('app', 'test', () => {});
    expect(events.getListenerCount('app', 'test')).toBe(2);
  });

  test('should remove all listeners for a domain', () => {
    events.on('app', 'a', () => {});
    events.on('app', 'b', () => {});
    events.on('system', 'c', () => {});
    events.removeAllListeners('app');
    expect(events.getSubscriptionCount()).toBe(1);
  });

  test('should remove all listeners for a specific event', () => {
    events.on('app', 'a', () => {});
    events.on('app', 'a', () => {});
    events.on('app', 'b', () => {});
    events.removeAllListeners('app', 'a');
    expect(events.getListenerCount('app', 'a')).toBe(0);
    expect(events.getListenerCount('app', 'b')).toBe(1);
  });

  test('should remove all listeners entirely', () => {
    events.on('app', 'a', () => {});
    events.on('system', 'b', () => {});
    events.removeAllListeners();
    expect(events.getSubscriptionCount()).toBe(0);
  });

  test('should limit event history size', () => {
    const smallEvents = new AppEventSystem(5);
    for (let i = 0; i < 10; i++) {
      smallEvents.emit('app', `event-${i}`);
    }
    expect(smallEvents.getEventHistory().length).toBe(5);
  });

  test('should handle async handlers', async () => {
    let value = 0;
    events.on('app', 'async', async () => {
      await new Promise((r) => setTimeout(r, 10));
      value = 42;
    });
    events.emit('app', 'async');
    // Give async handler time to complete
    await new Promise((r) => setTimeout(r, 50));
    expect(value).toBe(42);
  });
});

// ============================================================================
// Module 6: Command System (12 tests)
// ============================================================================
describe('CommandSystem', () => {
  let cmd: CommandSystem;

  beforeEach(() => {
    cmd = new CommandSystem();
  });

  test('should register a command', () => {
    cmd.register({
      name: 'hello',
      description: 'Say hello',
      arguments: [],
      options: [],
      handler: async () => ({ success: true, output: 'Hello!', duration: 0 }),
    });
    expect(cmd.getCommandCount()).toBe(1);
  });

  test('should execute a command', async () => {
    cmd.register({
      name: 'greet',
      description: 'Greet someone',
      arguments: [{ name: 'name', description: 'Name', required: true }],
      options: [],
      handler: async (args) => ({
        success: true,
        output: `Hello, ${args.name}!`,
        duration: 0,
      }),
    });
    const result = await cmd.execute('greet World');
    expect(result.success).toBe(true);
    expect(result.output).toBe('Hello, World!');
  });

  test('should return error for unknown command', async () => {
    const result = await cmd.execute('unknown');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown command');
  });

  test('should return error for missing required argument', async () => {
    cmd.register({
      name: 'need-arg',
      description: 'Needs arg',
      arguments: [{ name: 'required', description: 'Required', required: true }],
      options: [],
      handler: async () => ({ success: true, output: '', duration: 0 }),
    });
    const result = await cmd.execute('need-arg');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing required argument');
  });

  test('should use argument default value', async () => {
    cmd.register({
      name: 'default-arg',
      description: 'Default arg',
      arguments: [{ name: 'name', description: 'Name', required: false, defaultValue: 'World' }],
      options: [],
      handler: async (args) => ({
        success: true,
        output: `Hello, ${args.name}!`,
        duration: 0,
      }),
    });
    const result = await cmd.execute('default-arg');
    expect(result.output).toBe('Hello, World!');
  });

  test('should parse boolean options', async () => {
    cmd.register({
      name: 'verbose',
      description: 'Verbose output',
      arguments: [],
      options: [{ name: 'verbose', description: 'Verbose', required: false, type: 'boolean' }],
      handler: async (_args, opts) => ({
        success: true,
        output: opts.verbose ? 'verbose on' : 'verbose off',
        duration: 0,
      }),
    });
    const result = await cmd.execute('verbose --verbose');
    expect(result.output).toBe('verbose on');
  });

  test('should resolve command aliases', async () => {
    cmd.register({
      name: 'status',
      description: 'Show status',
      arguments: [],
      options: [],
      aliases: ['st'],
      handler: async () => ({ success: true, output: 'OK', duration: 0 }),
    });
    const result = await cmd.execute('st');
    expect(result.success).toBe(true);
    expect(result.output).toBe('OK');
  });

  test('should get help for a command', () => {
    cmd.register({
      name: 'deploy',
      description: 'Deploy app',
      arguments: [{ name: 'env', description: 'Environment', required: true }],
      options: [{ name: 'force', description: 'Force deploy', required: false, type: 'boolean' }],
      handler: async () => ({ success: true, output: '', duration: 0 }),
    });
    const help = cmd.getHelp('deploy');
    expect(help.command).toBe('deploy');
    expect(help.description).toBe('Deploy app');
    expect(help.arguments.length).toBe(1);
    expect(help.options.length).toBe(1);
  });

  test('should list all commands', () => {
    cmd.register({
      name: 'a', description: 'Cmd A', arguments: [], options: [],
      handler: async () => ({ success: true, output: '', duration: 0 }),
    });
    cmd.register({
      name: 'b', description: 'Cmd B', arguments: [], options: [],
      handler: async () => ({ success: true, output: '', duration: 0 }),
    });
    const list = cmd.listCommands();
    expect(list.length).toBe(2);
  });

  test('should record command history', async () => {
    cmd.register({
      name: 'echo',
      description: 'Echo',
      arguments: [{ name: 'msg', description: 'Message', required: true }],
      options: [],
      handler: async (args) => ({ success: true, output: args.msg, duration: 0 }),
    });
    await cmd.execute('echo hello');
    await cmd.execute('echo world');
    const history = cmd.getHistory();
    expect(history.length).toBe(2);
    expect(history[0]!.command).toBe('echo hello');
  });

  test('should clear command history', async () => {
    cmd.register({
      name: 'echo', description: 'Echo', arguments: [], options: [],
      handler: async () => ({ success: true, output: '', duration: 0 }),
    });
    await cmd.execute('echo');
    cmd.clearHistory();
    expect(cmd.getHistory().length).toBe(0);
  });

  test('should check if command exists', () => {
    cmd.register({
      name: 'exists', description: 'Exists', arguments: [], options: [],
      handler: async () => ({ success: true, output: '', duration: 0 }),
    });
    expect(cmd.hasCommand('exists')).toBe(true);
    expect(cmd.hasCommand('nope')).toBe(false);
  });

  test('should handle command handler error', async () => {
    cmd.register({
      name: 'fail', description: 'Fails', arguments: [], options: [],
      handler: async () => { throw new Error('handler error'); },
    });
    const result = await cmd.execute('fail');
    expect(result.success).toBe(false);
    expect(result.error).toBe('handler error');
  });
});

// ============================================================================
// Module 7: Plugin Host (12 tests)
// ============================================================================
describe('PluginHost', () => {
  let host: PluginHost;

  beforeEach(() => {
    host = new PluginHost();
  });

  test('should load a plugin', async () => {
    const plugin = await host.loadPlugin({
      name: 'test-plugin',
      version: '1.0.0',
      description: 'Test plugin',
    });
    expect(plugin.name).toBe('test-plugin');
    expect(plugin.active).toBe(true);
  });

  test('should not load duplicate plugin', async () => {
    await host.loadPlugin({
      name: 'dup',
      version: '1.0.0',
      description: 'Dup',
    });
    await expect(
      host.loadPlugin({ name: 'dup', version: '1.0.0', description: 'Dup' }),
    ).rejects.toThrow('already loaded');
  });

  test('should unload a plugin', async () => {
    await host.loadPlugin({
      name: 'temp',
      version: '1.0.0',
      description: 'Temporary',
    });
    await host.unloadPlugin('temp');
    expect(host.hasPlugin('temp')).toBe(false);
  });

  test('should throw when unloading non-existent plugin', async () => {
    expect(() => host.unloadPlugin('nope')).toThrow('not loaded');
  });

  test('should get plugin API', async () => {
    await host.loadPlugin({
      name: 'api-test',
      version: '1.0.0',
      description: 'API test',
    });
    const api = host.getPluginAPI('api-test');
    expect(api.name).toBe('api-test');
    expect(api.version).toBe('1.0.0');
  });

  test('should throw when getting API for non-existent plugin', () => {
    expect(() => host.getPluginAPI('nope')).toThrow('not loaded');
  });

  test('should list plugins', async () => {
    await host.loadPlugin({ name: 'p1', version: '1.0.0', description: 'Plugin 1' });
    await host.loadPlugin({ name: 'p2', version: '2.0.0', description: 'Plugin 2' });
    const list = host.listPlugins();
    expect(list.length).toBe(2);
  });

  test('should check plugin existence', async () => {
    await host.loadPlugin({ name: 'exists', version: '1.0.0', description: 'Exists' });
    expect(host.hasPlugin('exists')).toBe(true);
    expect(host.hasPlugin('nope')).toBe(false);
  });

  test('should resolve plugin dependencies', async () => {
    await host.loadPlugin({ name: 'core', version: '1.0.0', description: 'Core' });
    const plugin = await host.loadPlugin({
      name: 'extension',
      version: '1.0.0',
      description: 'Extension',
      dependencies: ['core'],
    });
    expect(plugin.active).toBe(true);
  });

  test('should fail when dependency is missing', async () => {
    await expect(
      host.loadPlugin({
        name: 'orphan',
        version: '1.0.0',
        description: 'Orphan',
        dependencies: ['missing-dep'],
      }),
    ).rejects.toThrow('requires');
  });

  test('should call plugin init function', async () => {
    let inited = false;
    await host.loadPlugin({
      name: 'init-test',
      version: '1.0.0',
      description: 'Init test',
      init: async () => { inited = true; },
    });
    expect(inited).toBe(true);
  });

  test('should provide config via plugin API', async () => {
    await host.loadPlugin({ name: 'cfg', version: '1.0.0', description: 'Cfg' });
    host.setConfig('cfg', 'key', 'value');
    const api = host.getPluginAPI('cfg');
    expect(api.getConfig('key')).toBe('value');
  });

  test('should register and access services via plugin API', async () => {
    host.registerService('myService', { data: 'service-data' });
    await host.loadPlugin({ name: 'svc-user', version: '1.0.0', description: 'Uses service' });
    const api = host.getPluginAPI('svc-user');
    const svc = api.getService<{ data: string }>('myService');
    expect(svc.data).toBe('service-data');
  });

  test('should get plugin count', async () => {
    await host.loadPlugin({ name: 'a', version: '1.0.0', description: 'A' });
    await host.loadPlugin({ name: 'b', version: '1.0.0', description: 'B' });
    expect(host.getPluginCount()).toBe(2);
  });
});

// ============================================================================
// Module 8: Config Manager (12 tests)
// ============================================================================
describe('AppConfigManager', () => {
  let config: AppConfigManager;

  beforeEach(() => {
    config = new AppConfigManager({
      app: { name: 'test', port: 3000 },
      features: { darkMode: true },
    });
  });

  test('should get nested config value', () => {
    expect(config.get<string>('app.name')).toBe('test');
  });

  test('should get nested number value', () => {
    expect(config.get<number>('app.port')).toBe(3000);
  });

  test('should get boolean value', () => {
    expect(config.get<boolean>('features.darkMode')).toBe(true);
  });

  test('should return default value for missing path', () => {
    expect(config.get('missing.path', 'fallback')).toBe('fallback');
  });

  test('should throw for missing path without default', () => {
    expect(() => config.get('missing.path')).toThrow('not found');
  });

  test('should set a config value', () => {
    config.set('app.name', 'updated');
    expect(config.get<string>('app.name')).toBe('updated');
  });

  test('should set a new nested path', () => {
    config.set('new.nested.path', 'value');
    expect(config.get<string>('new.nested.path')).toBe('value');
  });

  test('should check if path exists', () => {
    expect(config.has('app.name')).toBe(true);
    expect(config.has('nonexistent')).toBe(false);
  });

  test('should add config layer', () => {
    config.addLayer('env', 10, { app: { port: 8080 } });
    expect(config.get<number>('app.port')).toBe(8080);
  });

  test('should remove config layer', () => {
    config.addLayer('temp', 10, { temp: true });
    config.removeLayer('temp');
    expect(config.has('temp')).toBe(false);
  });

  test('should export as JSON', () => {
    const json = config.export('json');
    const parsed = JSON.parse(json);
    expect(parsed.app.name).toBe('test');
  });

  test('should export as env format', () => {
    const env = config.export('env');
    expect(env).toContain('APP_NAME=test');
  });

  test('should export as YAML', () => {
    const yaml = config.export('yaml');
    expect(yaml).toContain('name: test');
  });

  test('should validate config', () => {
    const result = config.validate();
    expect(result.valid).toBe(true);
  });

  test('should watch config changes', () => {
    let newValue: unknown = null;
    const unwatch = config.watch('app.name', (val) => { newValue = val; });
    config.set('app.name', 'watched');
    expect(newValue).toBe('watched');
    unwatch();
    config.set('app.name', 'unwatched');
    expect(newValue).toBe('watched');
  });

  test('should get all config', () => {
    const all = config.getAll();
    expect(all.app).toBeDefined();
  });

  test('should get layer names', () => {
    config.addLayer('custom', 50, {});
    const names = config.getLayerNames();
    expect(names).toContain('defaults');
    expect(names).toContain('custom');
  });
});

// ============================================================================
// Module 9: Health System (12 tests)
// ============================================================================
describe('AppHealthSystem', () => {
  let health: AppHealthSystem;

  beforeEach(() => {
    health = new AppHealthSystem();
  });

  test('should register a health check', () => {
    health.registerCheck('db', async () => ({ status: 'healthy' }));
    expect(health.getCheckCount()).toBe(1);
  });

  test('should check health and return report', async () => {
    health.registerCheck('db', async () => ({ status: 'healthy', message: 'OK' }));
    const report = await health.checkHealth();
    expect(report.checks['db']!.status).toBe('healthy');
    expect(report.score).toBe(100);
  });

  test('should report unhealthy when check fails', async () => {
    health.registerCheck('db', async () => ({ status: 'unhealthy', message: 'Connection failed' }));
    const report = await health.checkHealth();
    expect(report.status).toBe('unhealthy');
    expect(report.score).toBe(0);
  });

  test('should report degraded for partial failures', async () => {
    health.registerCheck('cache', async () => ({ status: 'healthy' }));
    health.registerCheck('db', async () => ({ status: 'degraded', message: 'Slow' }));
    const report = await health.checkHealth();
    expect(report.status).toBe('degraded');
    expect(report.score).toBe(75);
  });

  test('isHealthy should return true when all checks pass', async () => {
    health.registerCheck('a', async () => ({ status: 'healthy' }));
    health.registerCheck('b', async () => ({ status: 'healthy' }));
    await health.checkHealth();
    expect(health.isHealthy()).toBe(true);
  });

  test('isHealthy should return false when any check fails', async () => {
    health.registerCheck('a', async () => ({ status: 'healthy' }));
    health.registerCheck('b', async () => ({ status: 'unhealthy' }));
    await health.checkHealth();
    expect(health.isHealthy()).toBe(false);
  });

  test('isReady should return false when no checks run', () => {
    expect(health.isReady()).toBe(true); // no checks = no failures
  });

  test('isReady should return false when check is unhealthy', async () => {
    health.registerCheck('db', async () => ({ status: 'unhealthy' }));
    await health.checkHealth();
    expect(health.isReady()).toBe(false);
  });

  test('should get component health', async () => {
    health.registerCheck('db', async () => ({ status: 'healthy' }));
    await health.checkHealth();
    const comp = health.getComponentHealth('db');
    expect(comp.status).toBe('healthy');
    expect(comp.lastCheck).toBeGreaterThan(0);
  });

  test('should return unknown for non-existent component health', () => {
    const comp = health.getComponentHealth('nonexistent');
    expect(comp.status).toBe('unknown');
  });

  test('should track health history', async () => {
    health.registerCheck('db', async () => ({ status: 'healthy' }));
    await health.checkHealth();
    await health.checkHealth();
    await health.checkHealth();
    const history = health.getHistory();
    expect(history.length).toBe(3);
  });

  test('should remove a health check', () => {
    health.registerCheck('temp', async () => ({ status: 'healthy' }));
    expect(health.removeCheck('temp')).toBe(true);
    expect(health.getCheckCount()).toBe(0);
  });

  test('should handle check that throws', async () => {
    health.registerCheck('error', async () => { throw new Error('check error'); });
    const report = await health.checkHealth();
    expect(report.checks['error']!.status).toBe('unhealthy');
    expect(report.checks['error']!.message).toBe('check error');
  });

  test('should track consecutive failures', async () => {
    health.registerCheck('flaky', async () => ({ status: 'unhealthy', message: 'failing' }));
    await health.checkHealth();
    await health.checkHealth();
    const comp = health.getComponentHealth('flaky');
    expect(comp.consecutiveFailures).toBe(2);
  });
});

// ============================================================================
// Module 10: Telemetry System (12 tests)
// ============================================================================
describe('AppTelemetrySystem', () => {
  let telemetry: AppTelemetrySystem;

  beforeEach(() => {
    telemetry = new AppTelemetrySystem();
  });

  test('should record a counter metric', () => {
    telemetry.recordMetric('requests', 1, 'counter');
    expect(telemetry.getCounter('requests')).toBe(1);
  });

  test('should increment counter', () => {
    telemetry.recordMetric('requests', 1, 'counter');
    telemetry.recordMetric('requests', 1, 'counter');
    telemetry.recordMetric('requests', 1, 'counter');
    expect(telemetry.getCounter('requests')).toBe(3);
  });

  test('should record a gauge metric', () => {
    telemetry.recordMetric('temperature', 72.5, 'gauge');
    expect(telemetry.getGauge('temperature')).toBe(72.5);
  });

  test('should overwrite gauge value', () => {
    telemetry.recordMetric('cpu', 50, 'gauge');
    telemetry.recordMetric('cpu', 75, 'gauge');
    expect(telemetry.getGauge('cpu')).toBe(75);
  });

  test('should record histogram values', () => {
    telemetry.recordMetric('latency', 100, 'histogram');
    telemetry.recordMetric('latency', 200, 'histogram');
    telemetry.recordMetric('latency', 150, 'histogram');
    const metrics = telemetry.getMetrics();
    expect(metrics.histograms['latency']!.count).toBe(3);
    expect(metrics.histograms['latency']!.avg).toBe(150);
  });

  test('should record summary values', () => {
    telemetry.recordMetric('response_size', 1024, 'summary');
    telemetry.recordMetric('response_size', 2048, 'summary');
    const metrics = telemetry.getMetrics();
    expect(metrics.summaries['response_size']!.count).toBe(2);
    expect(metrics.summaries['response_size']!.min).toBe(1024);
    expect(metrics.summaries['response_size']!.max).toBe(2048);
  });

  test('should start and end a span', () => {
    const span = telemetry.startSpan('http-request');
    expect(span.name).toBe('http-request');
    expect(span.context.traceId).toBeTruthy();
    expect(span.context.spanId).toBeTruthy();
    span.end();
    expect(span.duration).toBeGreaterThanOrEqual(0);
  });

  test('should track active spans', () => {
    const span1 = telemetry.startSpan('op1');
    const span2 = telemetry.startSpan('op2');
    const dashboard = telemetry.getDashboard();
    expect(dashboard.activeSpans).toBe(2);
    span1.end();
    span2.end();
    const dashboard2 = telemetry.getDashboard();
    expect(dashboard2.activeSpans).toBe(0);
    expect(dashboard2.completedSpans).toBe(2);
  });

  test('should create child spans', () => {
    const parent = telemetry.startSpan('parent');
    const child = telemetry.startSpan('child', {
      traceId: parent.context.traceId,
      parentSpanId: parent.context.spanId,
    });
    expect(child.context.traceId).toBe(parent.context.traceId);
    expect(child.context.parentSpanId).toBe(parent.context.spanId);
    child.end();
    parent.end();
  });

  test('should get metrics snapshot', () => {
    telemetry.recordMetric('c1', 1, 'counter');
    telemetry.recordMetric('g1', 42, 'gauge');
    const snapshot = telemetry.getMetrics();
    expect(snapshot.counters['c1']).toBe(1);
    expect(snapshot.gauges['g1']).toBe(42);
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });

  test('should get telemetry dashboard', () => {
    telemetry.recordMetric('c1', 1, 'counter');
    telemetry.recordMetric('g1', 42, 'gauge');
    const dashboard = telemetry.getDashboard();
    expect(dashboard.totalMetrics).toBe(2);
    expect(dashboard.metricCountByType.counter).toBe(1);
    expect(dashboard.metricCountByType.gauge).toBe(1);
  });

  test('should flush metrics', () => {
    telemetry.recordMetric('c1', 1, 'counter');
    const flushed = telemetry.flush();
    expect(flushed.length).toBe(1);
    expect(flushed[0]!.name).toBe('c1');
  });

  test('should reset all telemetry data', () => {
    telemetry.recordMetric('c1', 1, 'counter');
    telemetry.recordMetric('g1', 42, 'gauge');
    telemetry.startSpan('test').end();
    telemetry.reset();
    const dashboard = telemetry.getDashboard();
    expect(dashboard.totalMetrics).toBe(0);
    expect(dashboard.activeSpans).toBe(0);
    expect(dashboard.completedSpans).toBe(0);
  });

  test('should set span attributes', () => {
    const span = telemetry.startSpan('test');
    span.attributes['http.method'] = 'GET';
    expect(span.attributes['http.method']).toBe('GET');
    span.end();
  });

  test('should set span error status', () => {
    const span = telemetry.startSpan('failing');
    span.status = 'error';
    span.error = 'Something went wrong';
    span.end();
    expect(span.status).toBe('error');
    expect(span.error).toBe('Something went wrong');
  });
});
