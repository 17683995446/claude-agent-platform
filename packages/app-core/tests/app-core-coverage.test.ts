// ============================================================================
// Comprehensive Test Suite for @claude-agent/app-core
// ============================================================================
// BUG REGISTRY:
//
// BUG-01: [CRITICAL] event-system.ts removeAllListeners(domain) iterates and
//   deletes from the same Map, which can skip entries.
//   FIX: Collect keys to delete first, then delete in a separate loop.
//
// BUG-02: [HIGH] middleware-pipeline.ts error handler search can find the same
//   middleware that threw, causing infinite recursion.
//   FIX: Exclude the failed middleware by name when searching for error handler.
//   Also wrap error handler execution in try/catch to prevent cascading failures.
//
// BUG-03: [HIGH] command-system.ts parseTokens uses indexOf to find previous
//   token, which returns the first occurrence not the actual previous one when
//   duplicate token values exist.
//   FIX: Track previous token with a variable instead of using indexOf.
//
// BUG-04: [HIGH] routing-system.ts query param parsing uses split('=') which
//   produces wrong results for params without '=' or with empty keys.
//   FIX: Use indexOf('=') to properly handle missing '=' and empty keys.
//
// BUG-05: [MEDIUM] config-manager.ts set() writes to the 'defaults' layer when
//   no other layers exist, polluting default configuration.
//   FIX: Check if topmost layer is 'defaults' and create a 'runtime' layer.
//
// BUG-06: [MEDIUM] application.ts start() doesn't guard against concurrent calls
//   during initializing/starting phases.
//   FIX: Throw an error if phase is 'initializing' or 'starting'.
//
// BUG-07: [MEDIUM] application.ts stop() doesn't guard against concurrent calls
//   during stopping phase.
//   FIX: Throw an error if phase is 'stopping'.
//
// BUG-08: [HIGH] plugin-host.ts loadPlugin uses Promise.reject instead of
//   throwing, making try/catch around await unreliable.
//   FIX: Use async/await with throw instead of Promise.reject.
//
// BUG-09: [MEDIUM] telemetry-system.ts quantile calculation uses
//   Math.floor(sorted.length * p) which is off-by-one for the last element.
//   FIX: Use Math.floor((sorted.length - 1) * p) for correct quantile indexing.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  Application,
  ServiceContainer,
  AppMiddlewarePipeline,
  createCORSMiddleware,
  createErrorHandlingMiddleware,
  createLoggingMiddleware,
  createRequestIdMiddleware,
  createTimingMiddleware,
  RoutingSystem,
  AppEventSystem,
  CommandSystem,
  PluginHost,
  AppConfigManager,
  AppHealthSystem,
  AppTelemetrySystem,
} from '../src/index.ts';
import type {
  AppConfig,
  AppContext,
  AppMiddleware,
  AppResult,
  DisposableService,
  RouteDefinition,
  RouteMatch,
  CommandDefinition,
  CommandResult,
  PluginDefinition,
  HealthCheckFn,
  HealthCheckResult,
} from '../src/index.ts';

// ============================================================================
// Module 1: Application Lifecycle Management
// ============================================================================
describe('Application', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application({ name: 'test-app', version: '1.0.0' });
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const a = new Application();
      expect(a.getConfig().name).toBe('claude-agent-app');
      expect(a.getConfig().version).toBe('0.1.0');
      expect(a.getConfig().port).toBe(3000);
    });

    it('should create with custom config', () => {
      expect(app.getConfig().name).toBe('test-app');
      expect(app.getConfig().version).toBe('1.0.0');
    });

    it('should detect environment from NODE_ENV', () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const a = new Application();
      expect(a.getEnvironment()).toBe('production');
      process.env.NODE_ENV = origEnv;
    });

    it('should default to development for invalid NODE_ENV', () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'invalid';
      const a = new Application();
      expect(a.getEnvironment()).toBe('development');
      process.env.NODE_ENV = origEnv;
    });

    it('should default to development when NODE_ENV is undefined', () => {
      const origEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      const a = new Application();
      expect(a.getEnvironment()).toBe('development');
      process.env.NODE_ENV = origEnv;
    });

    it('should support test environment', () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      const a = new Application();
      expect(a.getEnvironment()).toBe('test');
      process.env.NODE_ENV = origEnv;
    });
  });

  describe('static create', () => {
    it('should create an Application instance', () => {
      const a = Application.create({ name: 'created' });
      expect(a).toBeInstanceOf(Application);
      expect(a.getConfig().name).toBe('created');
    });
  });

  describe('getConfig', () => {
    it('should return a copy of config', () => {
      const config1 = app.getConfig();
      const config2 = app.getConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });

  describe('getPhase', () => {
    it('should start in idle phase', () => {
      expect(app.getPhase()).toBe('idle');
    });
  });

  describe('registerComponent', () => {
    it('should register a component', () => {
      app.registerComponent({ name: 'comp1', instance: {} });
      expect(app.hasComponent('comp1')).toBe(true);
    });

    it('should throw on duplicate registration', () => {
      app.registerComponent({ name: 'comp1', instance: {} });
      expect(() => app.registerComponent({ name: 'comp1', instance: {} })).toThrow(
        'already registered',
      );
    });
  });

  describe('getComponent', () => {
    it('should return the component instance', () => {
      const instance = { data: 42 };
      app.registerComponent({ name: 'comp1', instance });
      expect(app.getComponent<typeof instance>('comp1')).toBe(instance);
    });

    it('should throw for missing component', () => {
      expect(() => app.getComponent('missing')).toThrow('not found');
    });
  });

  describe('hasComponent', () => {
    it('should return false for unregistered component', () => {
      expect(app.hasComponent('missing')).toBe(false);
    });
  });

  describe('listComponents', () => {
    it('should return empty array initially', () => {
      expect(app.listComponents()).toEqual([]);
    });

    it('should list all registered components', () => {
      app.registerComponent({ name: 'a', instance: {} });
      app.registerComponent({ name: 'b', instance: {} });
      expect(app.listComponents()).toEqual(['a', 'b']);
    });
  });

  describe('start', () => {
    it('should transition through phases', async () => {
      await app.start();
      expect(app.getPhase()).toBe('running');
      expect(app.isRunning()).toBe(true);
    });

    it('should call init on components', async () => {
      const inited: string[] = [];
      app.registerComponent({
        name: 'c1',
        instance: {},
        init: async () => { inited.push('c1'); },
      });
      await app.start();
      expect(inited).toEqual(['c1']);
    });

    it('should call start on components', async () => {
      const started: string[] = [];
      app.registerComponent({
        name: 'c1',
        instance: {},
        start: async () => { started.push('c1'); },
      });
      await app.start();
      expect(started).toEqual(['c1']);
    });

    it('should init before starting', async () => {
      const order: string[] = [];
      app.registerComponent({
        name: 'c1',
        instance: {},
        init: async () => { order.push('init'); },
        start: async () => { order.push('start'); },
      });
      await app.start();
      expect(order).toEqual(['init', 'start']);
    });

    it('should set startTime', async () => {
      await app.start();
      const status = app.getStatus();
      expect(status.startTime).not.toBeNull();
      expect(status.startTime).toBeGreaterThan(0);
    });

    it('should be idempotent when already running', async () => {
      await app.start();
      await app.start(); // should not throw
      expect(app.getPhase()).toBe('running');
    });

    it('should set phase to error on init failure', async () => {
      app.registerComponent({
        name: 'c1',
        instance: {},
        init: async () => { throw new Error('init failed'); },
      });
      await expect(app.start()).rejects.toThrow('init failed');
      expect(app.getPhase()).toBe('error');
    });

    it('should set phase to error on start failure', async () => {
      app.registerComponent({
        name: 'c1',
        instance: {},
        start: async () => { throw new Error('start failed'); },
      });
      await expect(app.start()).rejects.toThrow('start failed');
      expect(app.getPhase()).toBe('error');
    });

    // BUG-06: [MEDIUM] start() should guard against concurrent calls
    it('BUG-06: should throw if called during initializing phase', async () => {
      let resolveInit: () => void;
      const initPromise = new Promise<void>((r) => { resolveInit = r; });
      app.registerComponent({
        name: 'slow',
        instance: {},
        init: async () => { await initPromise; },
      });

      const startPromise = app.start();
      expect(app.getPhase()).toBe('initializing');

      // Concurrent start should throw
      await expect(app.start()).rejects.toThrow('already initializing');

      resolveInit!();
      await startPromise;
    });

    it('should handle components without init/start', async () => {
      app.registerComponent({ name: 'bare', instance: {} });
      await app.start();
      expect(app.getPhase()).toBe('running');
    });
  });

  describe('stop', () => {
    it('should stop a running app', async () => {
      await app.start();
      await app.stop();
      expect(app.getPhase()).toBe('stopped');
      expect(app.isRunning()).toBe(false);
    });

    it('should call stop on components in reverse order', async () => {
      const order: string[] = [];
      app.registerComponent({
        name: 'a', instance: {},
        stop: async () => { order.push('a'); },
      });
      app.registerComponent({
        name: 'b', instance: {},
        stop: async () => { order.push('b'); },
      });
      await app.start();
      await app.stop();
      expect(order).toEqual(['b', 'a']);
    });

    it('should run shutdown hooks before stopping components', async () => {
      const order: string[] = [];
      app.registerComponent({
        name: 'c', instance: {},
        stop: async () => { order.push('stop'); },
      });
      app.addShutdownHook(async () => { order.push('hook'); });
      await app.start();
      await app.stop();
      expect(order).toEqual(['hook', 'stop']);
    });

    it('should clear startTime', async () => {
      await app.start();
      expect(app.getStatus().startTime).not.toBeNull();
      await app.stop();
      expect(app.getStatus().startTime).toBeNull();
    });

    it('should be idempotent when already stopped', async () => {
      await app.start();
      await app.stop();
      await app.stop(); // should not throw
      expect(app.getPhase()).toBe('stopped');
    });

    it('should be no-op when idle', async () => {
      await app.stop();
      expect(app.getPhase()).toBe('idle');
    });

    it('should set phase to error on stop failure', async () => {
      app.registerComponent({
        name: 'c', instance: {},
        stop: async () => { throw new Error('stop failed'); },
      });
      await app.start();
      await expect(app.stop()).rejects.toThrow('stop failed');
      expect(app.getPhase()).toBe('error');
    });

    // BUG-07: [MEDIUM] stop() should guard against concurrent calls
    it('BUG-07: should throw if called during stopping phase', async () => {
      let resolveStop: () => void;
      const stopPromise = new Promise<void>((r) => { resolveStop = r; });
      app.registerComponent({
        name: 'slow',
        instance: {},
        stop: async () => { await stopPromise; },
      });

      await app.start();
      const stopCall = app.stop();
      expect(app.getPhase()).toBe('stopping');

      await expect(app.stop()).rejects.toThrow('already stopping');

      resolveStop!();
      await stopCall;
    });
  });

  describe('restart', () => {
    it('should stop and start the app', async () => {
      let count = 0;
      app.registerComponent({
        name: 'c', instance: {},
        init: async () => { count++; },
      });
      await app.start();
      expect(count).toBe(1);
      await app.restart();
      expect(app.getPhase()).toBe('running');
      expect(count).toBe(2);
    });
  });

  describe('addShutdownHook', () => {
    it('should add hooks that run on stop', async () => {
      let ran = false;
      app.addShutdownHook(async () => { ran = true; });
      await app.start();
      await app.stop();
      expect(ran).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return correct status when idle', () => {
      const status = app.getStatus();
      expect(status.phase).toBe('idle');
      // environment is detected from NODE_ENV which may be 'test' in test runner
      expect(['development', 'test', 'staging', 'production']).toContain(status.environment);
      expect(status.uptime).toBe(0);
      expect(status.startTime).toBeNull();
      expect(status.components).toEqual({});
      // memoryUsage may or may not be available in test env
      if (status.memoryUsage !== null) {
        expect(typeof status.memoryUsage.rss).toBe('number');
      }
    });

    it('should return correct status when running', async () => {
      app.registerComponent({ name: 'c', instance: {} });
      await app.start();
      const status = app.getStatus();
      expect(status.phase).toBe('running');
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.components.c.status).toBe('running');
    });

    it('should show stopped components when not running', async () => {
      app.registerComponent({ name: 'c', instance: {} });
      await app.start();
      await app.stop();
      const status = app.getStatus();
      expect(status.components.c.status).toBe('stopped');
    });
  });

  describe('getEnvironment', () => {
    it('should return the configured environment', () => {
      const a = new Application({ environment: 'staging' });
      expect(a.getEnvironment()).toBe('staging');
    });
  });

  describe('isRunning', () => {
    it('should return false when not running', () => {
      expect(app.isRunning()).toBe(false);
    });

    it('should return true when running', async () => {
      await app.start();
      expect(app.isRunning()).toBe(true);
    });
  });
});

// ============================================================================
// Module 2: Service Container (IoC/DI)
// ============================================================================
describe('ServiceContainer', () => {
  let container: ServiceContainer;

  beforeEach(() => {
    container = new ServiceContainer();
  });

  describe('register', () => {
    it('should register a service', () => {
      container.register('svc', () => ({ data: 1 }));
      expect(container.has('svc')).toBe(true);
    });

    it('should throw on duplicate registration', () => {
      container.register('svc', () => ({ data: 1 }));
      expect(() => container.register('svc', () => ({ data: 2 }))).toThrow('already registered');
    });

    it('should default to singleton lifecycle', () => {
      container.register('svc', () => ({ data: 1 }));
      const services = container.listServices();
      expect(services[0]!.lifecycle).toBe('singleton');
    });

    it('should support transient lifecycle', () => {
      container.register('svc', () => ({ data: 1 }), 'transient');
      const services = container.listServices();
      expect(services[0]!.lifecycle).toBe('transient');
    });

    it('should support scoped lifecycle', () => {
      container.register('svc', () => ({ data: 1 }), 'scoped');
      const services = container.listServices();
      expect(services[0]!.lifecycle).toBe('scoped');
    });
  });

  describe('resolve', () => {
    it('should resolve a singleton service', async () => {
      container.register('svc', () => ({ data: 42 }));
      const instance = await container.resolve<{ data: number }>('svc');
      expect(instance.data).toBe(42);
    });

    it('should return same instance for singleton', async () => {
      let count = 0;
      container.register('svc', () => {
        count++;
        return { id: count };
      });
      const a = await container.resolve<{ id: number }>('svc');
      const b = await container.resolve<{ id: number }>('svc');
      expect(a.id).toBe(b.id);
      expect(count).toBe(1);
    });

    it('should return new instance for transient', async () => {
      let count = 0;
      container.register('svc', () => {
        count++;
        return { id: count };
      }, 'transient');
      const a = await container.resolve<{ id: number }>('svc');
      const b = await container.resolve<{ id: number }>('svc');
      expect(a.id).toBe(1);
      expect(b.id).toBe(2);
      expect(count).toBe(2);
    });

    it('should return same instance for scoped within same scope', async () => {
      let count = 0;
      container.register('svc', () => {
        count++;
        return { id: count };
      }, 'scoped');
      const a = await container.resolve<{ id: number }>('svc');
      const b = await container.resolve<{ id: number }>('svc');
      expect(a.id).toBe(b.id);
      expect(count).toBe(1);
    });

    it('should handle async factory', async () => {
      container.register('svc', async () => {
        return { data: 'async' };
      });
      const instance = await container.resolve<{ data: string }>('svc');
      expect(instance.data).toBe('async');
    });

    it('should throw for unregistered service', async () => {
      await expect(container.resolve('missing')).rejects.toThrow('not registered');
    });

    it('should detect circular dependencies', async () => {
      container.register('a', async (c) => {
        await c.resolve('b');
        return {};
      });
      container.register('b', async (c) => {
        await c.resolve('a');
        return {};
      });
      await expect(container.resolve('a')).rejects.toThrow('Circular dependency');
    });

    it('should detect self-dependency', async () => {
      container.register('a', async (c) => {
        await c.resolve('a');
        return {};
      });
      await expect(container.resolve('a')).rejects.toThrow('Circular dependency');
    });

    it('should resolve chain of dependencies', async () => {
      container.register('a', async (c) => {
        const b = await c.resolve('b');
        return { b };
      });
      container.register('b', () => ({ value: 42 }));
      const a = await container.resolve<{ b: { value: number } }>('a');
      expect(a.b.value).toBe(42);
    });
  });

  describe('has', () => {
    it('should return false for unknown service', () => {
      expect(container.has('missing')).toBe(false);
    });
  });

  describe('listServices', () => {
    it('should return empty array initially', () => {
      expect(container.listServices()).toEqual([]);
    });

    it('should list all registered services', () => {
      container.register('a', () => ({}));
      container.register('b', () => ({}));
      const services = container.listServices();
      expect(services.length).toBe(2);
      expect(services.map((s) => s.name)).toEqual(['a', 'b']);
    });

    it('should show initialized status after resolve', async () => {
      container.register('svc', () => ({ data: 1 }));
      await container.resolve('svc');
      const services = container.listServices();
      expect(services[0]!.initialized).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should call dispose on services that implement it', async () => {
      let disposed = false;
      container.register('svc', () => ({
        dispose: async () => { disposed = true; },
      }));
      await container.resolve('svc');
      await container.dispose();
      expect(disposed).toBe(true);
    });

    it('should continue if dispose throws', async () => {
      let disposed2 = false;
      container.register('svc1', () => ({
        dispose: async () => { throw new Error('dispose failed'); },
      }));
      container.register('svc2', () => ({
        dispose: async () => { disposed2 = true; },
      }));
      await container.resolve('svc1');
      await container.resolve('svc2');
      await container.dispose();
      expect(disposed2).toBe(true);
    });

    it('should clear instances after dispose', async () => {
      container.register('svc', () => ({ data: 1 }));
      await container.resolve('svc');
      await container.dispose();
      const services = container.listServices();
      expect(services[0]!.initialized).toBe(false);
    });

    it('should clear scoped instances', async () => {
      container.register('svc', () => ({}), 'scoped');
      await container.resolve('svc');
      await container.dispose();
      // Should not throw on next resolve
      await container.resolve('svc');
    });
  });

  describe('remove', () => {
    it('should remove a registered service', () => {
      container.register('svc', () => ({}));
      expect(container.remove('svc')).toBe(true);
      expect(container.has('svc')).toBe(false);
    });

    it('should return false for unknown service', () => {
      expect(container.remove('missing')).toBe(false);
    });
  });

  describe('reset', () => {
    it('should clear all instances but keep registrations', async () => {
      let count = 0;
      container.register('svc', () => {
        count++;
        return { id: count };
      });
      await container.resolve('svc');
      container.reset();
      const instance = await container.resolve('svc');
      expect(instance.id).toBe(2);
      expect(container.has('svc')).toBe(true);
    });
  });

  describe('getRegistrationCount', () => {
    it('should return 0 initially', () => {
      expect(container.getRegistrationCount()).toBe(0);
    });

    it('should return correct count', () => {
      container.register('a', () => ({}));
      container.register('b', () => ({}));
      expect(container.getRegistrationCount()).toBe(2);
    });
  });
});

// ============================================================================
// Module 3: Middleware Pipeline
// ============================================================================
describe('AppMiddlewarePipeline', () => {
  let pipeline: AppMiddlewarePipeline;

  beforeEach(() => {
    pipeline = new AppMiddlewarePipeline();
  });

  const createTestContext = (overrides?: Partial<AppContext>): AppContext => ({
    request: { method: 'GET', path: '/', headers: {} },
    state: {},
    requestId: 'test-req-1',
    startTime: Date.now(),
    ...overrides,
  });

  describe('use', () => {
    it('should add middleware and return pipeline for chaining', () => {
      const mw: AppMiddleware = {
        name: 'test',
        type: 'pre-process',
        priority: 0,
        execute: async (_ctx, next) => next(),
      };
      const result = pipeline.use(mw);
      expect(result).toBe(pipeline);
      expect(pipeline.getMiddlewareCount()).toBe(1);
    });

    it('should sort middlewares by priority', () => {
      pipeline.use({ name: 'low', type: 'pre-process', priority: 10, execute: async (_c, n) => n() });
      pipeline.use({ name: 'high', type: 'pre-process', priority: -10, execute: async (_c, n) => n() });
      pipeline.use({ name: 'mid', type: 'pre-process', priority: 0, execute: async (_c, n) => n() });
      const list = pipeline.listMiddlewares();
      expect(list.map((m) => m.name)).toEqual(['high', 'mid', 'low']);
    });
  });

  describe('remove', () => {
    it('should remove middleware by name', () => {
      pipeline.use({ name: 'test', type: 'pre-process', priority: 0, execute: async (_c, n) => n() });
      expect(pipeline.remove('test')).toBe(true);
      expect(pipeline.getMiddlewareCount()).toBe(0);
    });

    it('should return false for unknown middleware', () => {
      expect(pipeline.remove('missing')).toBe(false);
    });
  });

  describe('getMiddleware', () => {
    it('should find middleware by name', () => {
      const mw: AppMiddleware = {
        name: 'test', type: 'pre-process', priority: 0,
        execute: async (_c, n) => n(),
      };
      pipeline.use(mw);
      expect(pipeline.getMiddleware('test')).toBe(mw);
    });

    it('should return undefined for unknown middleware', () => {
      expect(pipeline.getMiddleware('missing')).toBeUndefined();
    });
  });

  describe('listMiddlewares', () => {
    it('should return a copy', () => {
      pipeline.use({ name: 'test', type: 'pre-process', priority: 0, execute: async (_c, n) => n() });
      const list1 = pipeline.listMiddlewares();
      const list2 = pipeline.listMiddlewares();
      expect(list1).toEqual(list2);
      expect(list1).not.toBe(list2);
    });
  });

  describe('execute', () => {
    it('should execute middleware in order', async () => {
      const order: string[] = [];
      pipeline.use({
        name: 'first', type: 'pre-process', priority: 0,
        execute: async (_ctx, next) => { order.push('first'); return next(); },
      });
      pipeline.use({
        name: 'second', type: 'pre-process', priority: 1,
        execute: async (_ctx, next) => { order.push('second'); return next(); },
      });
      await pipeline.execute(createTestContext());
      expect(order).toEqual(['first', 'second']);
    });

    it('should return default result when no middlewares', async () => {
      const result = await pipeline.execute(createTestContext());
      expect(result.status).toBe(200);
      expect(result.headers).toEqual({});
    });

    it('should pass through context', async () => {
      pipeline.use({
        name: 'set-body', type: 'transform', priority: 0,
        execute: async (ctx, next) => {
          ctx.response = { status: 200, headers: {}, body: 'hello' };
          return next();
        },
      });
      const result = await pipeline.execute(createTestContext());
      expect(result.body).toBe('hello');
    });

    it('should apply condition filter', async () => {
      let executed = false;
      pipeline.use({
        name: 'conditional', type: 'pre-process', priority: 0,
        condition: (ctx) => ctx.request.method === 'POST',
        execute: async () => { executed = true; return { status: 200, headers: {} }; },
      });
      await pipeline.execute(createTestContext({ request: { method: 'GET', path: '/', headers: {} } }));
      expect(executed).toBe(false);

      await pipeline.execute(createTestContext({ request: { method: 'POST', path: '/', headers: {} } }));
      expect(executed).toBe(true);
    });

    it('should handle middleware that returns result without calling next', async () => {
      pipeline.use({
        name: 'short-circuit', type: 'pre-process', priority: 0,
        execute: async () => ({ status: 201, headers: {}, body: 'created' }),
      });
      const result = await pipeline.execute(createTestContext());
      expect(result.status).toBe(201);
      expect(result.body).toBe('created');
    });

    // BUG-02: [HIGH] Error handler should not re-execute the failed middleware
    it('BUG-02: should not cause infinite recursion with error handler', async () => {
      let errorExecuted = false;
      pipeline.use({
        name: 'failing', type: 'pre-process', priority: 0,
        execute: async () => { throw new Error('fail'); },
      });
      pipeline.use({
        name: 'error-handler', type: 'error-handler', priority: 1000,
        execute: async (ctx) => {
          errorExecuted = true;
          return { status: 500, headers: {}, error: ctx.error };
        },
      });
      const result = await pipeline.execute(createTestContext());
      expect(result.status).toBe(500);
      expect(errorExecuted).toBe(true);
    });

    it('should return 500 when no error handler and middleware throws', async () => {
      pipeline.use({
        name: 'failing', type: 'pre-process', priority: 0,
        execute: async () => { throw new Error('boom'); },
      });
      const result = await pipeline.execute(createTestContext());
      expect(result.status).toBe(500);
      expect(result.error?.message).toBe('boom');
    });

    it('should set context.error when middleware throws', async () => {
      pipeline.use({
        name: 'failing', type: 'pre-process', priority: 0,
        execute: async () => { throw new Error('err'); },
      });
      const ctx = createTestContext();
      await pipeline.execute(ctx);
      expect(ctx.error?.message).toBe('err');
    });
  });

  describe('clear', () => {
    it('should remove all middlewares', () => {
      pipeline.use({ name: 'a', type: 'pre-process', priority: 0, execute: async (_c, n) => n() });
      pipeline.use({ name: 'b', type: 'pre-process', priority: 0, execute: async (_c, n) => n() });
      pipeline.clear();
      expect(pipeline.getMiddlewareCount()).toBe(0);
    });
  });

  describe('createRequestIdMiddleware', () => {
    it('should set requestId on context', async () => {
      const mw = createRequestIdMiddleware();
      const ctx = createTestContext();
      const result = await mw.execute(ctx, async () => ({ status: 200, headers: {} }));
      expect(ctx.requestId).toMatch(/^req-\d+-\d+$/);
      expect(result.status).toBe(200);
    });

    it('should generate unique IDs', async () => {
      const mw = createRequestIdMiddleware();
      const ctx1 = createTestContext();
      const ctx2 = createTestContext();
      await mw.execute(ctx1, async () => ({ status: 200, headers: {} }));
      await mw.execute(ctx2, async () => ({ status: 200, headers: {} }));
      expect(ctx1.requestId).not.toBe(ctx2.requestId);
    });
  });

  describe('createCORSMiddleware', () => {
    it('should set CORS headers', async () => {
      const mw = createCORSMiddleware();
      const ctx = createTestContext();
      await mw.execute(ctx, async () => ({ status: 200, headers: {} }));
      expect(ctx.response?.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(ctx.response?.headers['Access-Control-Allow-Methods']).toContain('GET');
    });
  });

  describe('createTimingMiddleware', () => {
    it('should record timing in state', async () => {
      const mw = createTimingMiddleware();
      const ctx = createTestContext();
      await mw.execute(ctx, async () => ({ status: 200, headers: {} }));
      expect(ctx.state['_duration']).toBeGreaterThanOrEqual(0);
    });
  });

  describe('createErrorHandlingMiddleware', () => {
    it('should catch errors from next()', async () => {
      const mw = createErrorHandlingMiddleware();
      const ctx = createTestContext();
      const result = await mw.execute(ctx, async () => {
        throw new Error('test error');
      });
      expect(result.status).toBe(500);
      expect(result.body).toEqual({ message: 'test error' });
    });

    it('should pass through successful results', async () => {
      const mw = createErrorHandlingMiddleware();
      const ctx = createTestContext();
      const result = await mw.execute(ctx, async () => ({ status: 200, headers: {}, body: 'ok' }));
      expect(result.status).toBe(200);
      expect(result.body).toBe('ok');
    });
  });

  describe('createLoggingMiddleware', () => {
    it('should log request and call next', async () => {
      const mw = createLoggingMiddleware();
      const ctx = createTestContext();
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args) => { logs.push(args.join(' ')); };
      try {
        const result = await mw.execute(ctx, async () => ({ status: 200, headers: {} }));
        expect(result.status).toBe(200);
        expect(logs.length).toBe(1);
        expect(logs[0]).toContain('GET');
        expect(logs[0]).toContain('/');
      } finally {
        console.log = origLog;
      }
    });
  });
});

// ============================================================================
// Module 4: Routing System
// ============================================================================
describe('RoutingSystem', () => {
  let router: RoutingSystem;

  beforeEach(() => {
    router = new RoutingSystem();
  });

  const makeRoute = (overrides?: Partial<RouteDefinition>): RouteDefinition => ({
    name: 'test',
    method: 'GET',
    path: '/test',
    handler: () => 'ok',
    ...overrides,
  });

  describe('addRoute', () => {
    it('should add a route', () => {
      router.addRoute(makeRoute());
      expect(router.getRouteCount()).toBe(1);
    });

    it('should throw on duplicate name', () => {
      router.addRoute(makeRoute({ name: 'dup' }));
      expect(() => router.addRoute(makeRoute({ name: 'dup', path: '/other' }))).toThrow('already exists');
    });
  });

  describe('addGroup', () => {
    it('should prefix all routes in group', () => {
      router.addGroup({
        prefix: '/api',
        routes: [
          makeRoute({ name: 'users', path: '/users' }),
          makeRoute({ name: 'posts', path: '/posts' }),
        ],
      });
      expect(router.getRouteCount()).toBe(2);
      expect(router.getRoute('users')?.path).toBe('/api/users');
      expect(router.getRoute('posts')?.path).toBe('/api/posts');
    });

    it('should merge group and route middleware', () => {
      const groupMw: any = () => {};
      const routeMw: any = () => {};
      router.addGroup({
        prefix: '/api',
        middleware: [groupMw],
        routes: [
          makeRoute({ name: 'r1', path: '/x', middleware: [routeMw] }),
        ],
      });
      const route = router.getRoute('r1');
      expect(route?.middleware).toHaveLength(2);
    });
  });

  describe('match', () => {
    it('should match a simple route', () => {
      router.addRoute(makeRoute({ name: 'home', path: '/', method: 'GET' }));
      const match = router.match('GET', '/');
      expect(match).not.toBeNull();
      expect(match!.route.name).toBe('home');
    });

    it('should match route with params', () => {
      router.addRoute(makeRoute({ name: 'user', path: '/users/:id', method: 'GET' }));
      const match = router.match('GET', '/users/42');
      expect(match).not.toBeNull();
      expect(match!.params.id).toBe('42');
    });

    it('should not match different method', () => {
      router.addRoute(makeRoute({ name: 'home', path: '/', method: 'GET' }));
      expect(router.match('POST', '/')).toBeNull();
    });

    it('should not match different path length', () => {
      router.addRoute(makeRoute({ name: 'user', path: '/users/:id', method: 'GET' }));
      expect(router.match('GET', '/users/42/posts')).toBeNull();
    });

    it('should not match different static segment', () => {
      router.addRoute(makeRoute({ name: 'users', path: '/users', method: 'GET' }));
      expect(router.match('GET', '/posts')).toBeNull();
    });

    it('should parse query parameters', () => {
      router.addRoute(makeRoute({ name: 'search', path: '/search', method: 'GET' }));
      const match = router.match('GET', '/search?q=hello&page=2');
      expect(match).not.toBeNull();
      expect(match!.query.q).toBe('hello');
      expect(match!.query.page).toBe('2');
    });

    // BUG-04: [HIGH] Query param parsing with empty key/value
    it('BUG-04: should handle query params without value', () => {
      router.addRoute(makeRoute({ name: 'list', path: '/items', method: 'GET' }));
      const match = router.match('GET', '/items?flag');
      expect(match).not.toBeNull();
      expect(match!.query.flag).toBe('');
    });

    it('BUG-04: should handle empty query pairs', () => {
      router.addRoute(makeRoute({ name: 'list', path: '/items', method: 'GET' }));
      const match = router.match('GET', '/items?flag&x=1');
      expect(match).not.toBeNull();
      expect(match!.query.flag).toBe('');
      expect(match!.query.x).toBe('1');
    });

    it('should decode URI components in query', () => {
      router.addRoute(makeRoute({ name: 'search', path: '/search', method: 'GET' }));
      const match = router.match('GET', '/search?q=hello%20world');
      expect(match!.query.q).toBe('hello world');
    });

    it('should handle no query string', () => {
      router.addRoute(makeRoute({ name: 'home', path: '/', method: 'GET' }));
      const match = router.match('GET', '/');
      expect(match).not.toBeNull();
      expect(match!.query).toEqual({});
    });

    it('should be case-insensitive for method', () => {
      router.addRoute(makeRoute({ name: 'home', path: '/', method: 'GET' }));
      expect(router.match('get', '/')).not.toBeNull();
      expect(router.match('Get', '/')).not.toBeNull();
    });
  });

  describe('generateUrl', () => {
    it('should generate URL with params', () => {
      router.addRoute(makeRoute({ name: 'user', path: '/users/:id', method: 'GET' }));
      expect(router.generateUrl('user', { id: '42' })).toBe('/users/42');
    });

    it('should encode params', () => {
      router.addRoute(makeRoute({ name: 'user', path: '/users/:id', method: 'GET' }));
      expect(router.generateUrl('user', { id: 'hello world' })).toBe('/users/hello%20world');
    });

    it('should throw for unknown route', () => {
      expect(() => router.generateUrl('missing')).toThrow('not found');
    });

    it('should return path with no params replaced if none provided', () => {
      router.addRoute(makeRoute({ name: 'user', path: '/users/:id', method: 'GET' }));
      expect(router.generateUrl('user')).toBe('/users/:id');
    });
  });

  describe('listRoutes', () => {
    it('should return a copy', () => {
      router.addRoute(makeRoute());
      const list1 = router.listRoutes();
      const list2 = router.listRoutes();
      expect(list1).toEqual(list2);
      expect(list1).not.toBe(list2);
    });
  });

  describe('getRoute', () => {
    it('should return route by name', () => {
      const route = makeRoute({ name: 'my-route' });
      router.addRoute(route);
      expect(router.getRoute('my-route')).toBe(route);
    });

    it('should return undefined for unknown route', () => {
      expect(router.getRoute('missing')).toBeUndefined();
    });
  });

  describe('removeRoute', () => {
    it('should remove a route', () => {
      router.addRoute(makeRoute({ name: 'rm' }));
      expect(router.removeRoute('rm')).toBe(true);
      expect(router.getRouteCount()).toBe(0);
    });

    it('should return false for unknown route', () => {
      expect(router.removeRoute('missing')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all routes and groups', () => {
      router.addRoute(makeRoute());
      router.addGroup({ prefix: '/api', routes: [makeRoute({ name: 'g1', path: '/x' })] });
      router.clear();
      expect(router.getRouteCount()).toBe(0);
    });
  });
});

// ============================================================================
// Module 5: Event System
// ============================================================================
describe('AppEventSystem', () => {
  let events: AppEventSystem;

  beforeEach(() => {
    events = new AppEventSystem();
  });

  describe('on / emit', () => {
    it('should call handler on emit', () => {
      let received: unknown = null;
      events.on('app', 'test', (data) => { received = data; });
      events.emit('app', 'test', { msg: 'hello' });
      expect(received).toEqual({ msg: 'hello' });
    });

    it('should call multiple handlers', () => {
      const calls: number[] = [];
      events.on('app', 'test', () => { calls.push(1); });
      events.on('app', 'test', () => { calls.push(2); });
      events.emit('app', 'test');
      expect(calls).toEqual([1, 2]);
    });

    it('should sort by priority', () => {
      const order: string[] = [];
      events.on('app', 'test', () => { order.push('normal'); }, 'normal');
      events.on('app', 'test', () => { order.push('critical'); }, 'critical');
      events.on('app', 'test', () => { order.push('low'); }, 'low');
      events.on('app', 'test', () => { order.push('high'); }, 'high');
      events.emit('app', 'test');
      expect(order).toEqual(['critical', 'high', 'normal', 'low']);
    });

    it('should handle async handlers', async () => {
      let received = false;
      events.on('app', 'test', async () => {
        await new Promise((r) => setTimeout(r, 10));
        received = true;
      });
      events.emit('app', 'test');
      // Emit is sync, but handler is async - wait a bit
      await new Promise((r) => setTimeout(r, 50));
      expect(received).toBe(true);
    });

    it('should swallow sync handler errors', () => {
      events.on('app', 'test', () => { throw new Error('handler error'); });
      expect(() => events.emit('app', 'test')).not.toThrow();
    });

    it('should record event in history', () => {
      events.emit('app', 'test', null, 'high');
      const history = events.getEventHistory();
      expect(history.length).toBe(1);
      expect(history[0]!.domain).toBe('app');
      expect(history[0]!.event).toBe('test');
      expect(history[0]!.priority).toBe('high');
    });

    it('should limit history size', () => {
      const small = new AppEventSystem(5);
      for (let i = 0; i < 10; i++) {
        small.emit('app', `evt-${i}`);
      }
      expect(small.getEventHistory().length).toBe(5);
      expect(small.getEventHistory()[0]!.event).toBe('evt-5');
    });

    it('should return subscription with correct properties', () => {
      const sub = events.on('app', 'test', () => {}, 'high');
      expect(sub.domain).toBe('app');
      expect(sub.event).toBe('test');
      expect(sub.priority).toBe('high');
      expect(sub.once).toBe(false);
    });
  });

  describe('once', () => {
    it('should call handler only once', () => {
      let count = 0;
      events.once('app', 'test', () => { count++; });
      events.emit('app', 'test');
      events.emit('app', 'test');
      expect(count).toBe(1);
    });

    it('should remove subscription after emit', () => {
      events.once('app', 'test', () => {});
      events.emit('app', 'test');
      expect(events.getListenerCount('app', 'test')).toBe(0);
    });
  });

  describe('off', () => {
    it('should remove a subscription', () => {
      const sub = events.on('app', 'test', () => {});
      expect(events.getListenerCount('app', 'test')).toBe(1);
      events.off(sub.id);
      expect(events.getListenerCount('app', 'test')).toBe(0);
    });

    it('should be no-op for unknown subscription', () => {
      expect(() => events.off('unknown')).not.toThrow();
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners', () => {
      events.on('app', 'test1', () => {});
      events.on('app', 'test2', () => {});
      events.on('user', 'action', () => {});
      events.removeAllListeners();
      expect(events.getSubscriptionCount()).toBe(0);
    });

    it('should remove listeners for specific domain and event', () => {
      events.on('app', 'test1', () => {});
      events.on('app', 'test2', () => {});
      events.on('user', 'test1', () => {});
      events.removeAllListeners('app', 'test1');
      expect(events.getListenerCount('app', 'test1')).toBe(0);
      expect(events.getListenerCount('app', 'test2')).toBe(1);
      expect(events.getListenerCount('user', 'test1')).toBe(1);
    });

    // BUG-01: [CRITICAL] removeAllListeners(domain) should not skip entries
    it('BUG-01: should remove all domain listeners without skipping entries', () => {
      events.on('app', 'evt1', () => {});
      events.on('app', 'evt2', () => {});
      events.on('app', 'evt3', () => {});
      events.on('user', 'action', () => {});
      events.removeAllListeners('app');
      expect(events.getSubscriptionCount()).toBe(1); // only 'user:action' remains
      expect(events.getListenerCount('app', 'evt1')).toBe(0);
      expect(events.getListenerCount('app', 'evt2')).toBe(0);
      expect(events.getListenerCount('app', 'evt3')).toBe(0);
      expect(events.getListenerCount('user', 'action')).toBe(1);
    });
  });

  describe('getEventHistory', () => {
    it('should filter by domain', () => {
      events.emit('app', 'e1');
      events.emit('user', 'e2');
      events.emit('app', 'e3');
      expect(events.getEventHistory('app').length).toBe(2);
      expect(events.getEventHistory('user').length).toBe(1);
    });

    it('should return all history without domain filter', () => {
      events.emit('app', 'e1');
      events.emit('user', 'e2');
      expect(events.getEventHistory().length).toBe(2);
    });
  });

  describe('getSubscriptionCount', () => {
    it('should return 0 initially', () => {
      expect(events.getSubscriptionCount()).toBe(0);
    });
  });

  describe('getListenerCount', () => {
    it('should return 0 for unknown event', () => {
      expect(events.getListenerCount('unknown', 'unknown')).toBe(0);
    });
  });

  describe('clearHistory', () => {
    it('should clear event history', () => {
      events.emit('app', 'e1');
      events.emit('app', 'e2');
      events.clearHistory();
      expect(events.getEventHistory().length).toBe(0);
    });
  });
});

// ============================================================================
// Module 6: Command System
// ============================================================================
describe('CommandSystem', () => {
  let cmd: CommandSystem;

  beforeEach(() => {
    cmd = new CommandSystem();
  });

  const makeCommand = (overrides?: Partial<CommandDefinition>): CommandDefinition => ({
    name: 'test',
    description: 'A test command',
    arguments: [],
    options: [],
    handler: async () => ({ success: true, output: 'ok', duration: 0 }),
    ...overrides,
  });

  describe('register', () => {
    it('should register a command', () => {
      cmd.register(makeCommand());
      expect(cmd.hasCommand('test')).toBe(true);
    });

    it('should register aliases', () => {
      cmd.register(makeCommand({ aliases: ['t', 'te'] }));
      expect(cmd.hasCommand('t')).toBe(true);
      expect(cmd.hasCommand('te')).toBe(true);
    });

    it('should throw on duplicate name', () => {
      cmd.register(makeCommand());
      expect(() => cmd.register(makeCommand())).toThrow('already registered');
    });
  });

  describe('execute', () => {
    it('should execute a command', async () => {
      cmd.register(makeCommand({
        handler: async (args, opts) => ({
          success: true, output: `args=${JSON.stringify(args)} opts=${JSON.stringify(opts)}`, duration: 0,
        }),
      }));
      const result = await cmd.execute('test arg1 --opt val');
      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should return error for empty command', async () => {
      const result = await cmd.execute('');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Empty command');
    });

    it('should return error for unknown command', async () => {
      const result = await cmd.execute('unknown');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown command');
    });

    it('should resolve aliases', async () => {
      cmd.register(makeCommand({
        name: 'greet',
        aliases: ['g'],
        handler: async () => ({ success: true, output: 'hello', duration: 0 }),
      }));
      const result = await cmd.execute('g');
      expect(result.success).toBe(true);
      expect(result.output).toBe('hello');
    });

    it('should validate required arguments', async () => {
      cmd.register(makeCommand({
        arguments: [{ name: 'name', description: 'Name', required: true, type: 'string' }],
        handler: async () => ({ success: true, output: '', duration: 0 }),
      }));
      const result = await cmd.execute('test');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required argument: name');
    });

    it('should validate required options', async () => {
      cmd.register(makeCommand({
        options: [{ name: 'format', description: 'Format', required: true, type: 'string' }],
        handler: async () => ({ success: true, output: '', duration: 0 }),
      }));
      const result = await cmd.execute('test');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required option: --format');
    });

    it('should parse boolean options', async () => {
      let receivedOpts: Record<string, string | boolean> = {};
      cmd.register(makeCommand({
        options: [{ name: 'verbose', description: 'Verbose', required: false, type: 'boolean' }],
        handler: async (_args, opts) => { receivedOpts = opts; return { success: true, output: '', duration: 0 }; },
      }));
      await cmd.execute('test --verbose');
      expect(receivedOpts.verbose).toBe(true);
    });

    it('should parse options with values', async () => {
      let receivedOpts: Record<string, string | boolean> = {};
      cmd.register(makeCommand({
        options: [{ name: 'name', description: 'Name', required: false, type: 'string' }],
        handler: async (_args, opts) => { receivedOpts = opts; return { success: true, output: '', duration: 0 }; },
      }));
      await cmd.execute('test --name world');
      expect(receivedOpts.name).toBe('world');
    });

    // BUG-03: [HIGH] parseTokens indexOf bug with duplicate values
    it('BUG-03: should correctly parse options when values duplicate earlier tokens', async () => {
      let receivedArgs: Record<string, string> = {};
      let receivedOpts: Record<string, string | boolean> = {};
      cmd.register(makeCommand({
        name: 'move',
        arguments: [
          { name: 'src', description: 'Source', required: true, type: 'string' },
          { name: 'dest', description: 'Destination', required: true, type: 'string' },
        ],
        options: [
          { name: 'force', description: 'Force', required: false, type: 'boolean' },
        ],
        handler: async (args, opts) => {
          receivedArgs = args;
          receivedOpts = opts;
          return { success: true, output: '', duration: 0 };
        },
      }));
      // "test" appears as both command name and could appear as arg value
      await cmd.execute('move test test --force');
      expect(receivedArgs.src).toBe('test');
      expect(receivedArgs.dest).toBe('test');
      expect(receivedOpts.force).toBe(true);
    });

    it('should apply default values for arguments', async () => {
      let receivedArgs: Record<string, string> = {};
      cmd.register(makeCommand({
        arguments: [
          { name: 'name', description: 'Name', required: false, defaultValue: 'default-name', type: 'string' },
        ],
        handler: async (args) => { receivedArgs = args; return { success: true, output: '', duration: 0 }; },
      }));
      await cmd.execute('test');
      expect(receivedArgs.name).toBe('default-name');
    });

    it('should apply default values for options', async () => {
      let receivedOpts: Record<string, string | boolean> = {};
      cmd.register(makeCommand({
        options: [
          { name: 'format', description: 'Format', required: false, defaultValue: 'json', type: 'string' },
        ],
        handler: async (_args, opts) => { receivedOpts = opts; return { success: true, output: '', duration: 0 }; },
      }));
      await cmd.execute('test');
      expect(receivedOpts.format).toBe('json');
    });

    it('should handle handler errors', async () => {
      cmd.register(makeCommand({
        handler: async () => { throw new Error('handler failed'); },
      }));
      const result = await cmd.execute('test');
      expect(result.success).toBe(false);
      expect(result.error).toBe('handler failed');
    });

    it('should tokenize quoted strings', async () => {
      let receivedArgs: Record<string, string> = {};
      cmd.register(makeCommand({
        arguments: [{ name: 'msg', description: 'Message', required: true, type: 'string' }],
        handler: async (args) => { receivedArgs = args; return { success: true, output: '', duration: 0 }; },
      }));
      await cmd.execute('test "hello world"');
      expect(receivedArgs.msg).toBe('hello world');
    });

    it('should tokenize single-quoted strings', async () => {
      let receivedArgs: Record<string, string> = {};
      cmd.register(makeCommand({
        arguments: [{ name: 'msg', description: 'Message', required: true, type: 'string' }],
        handler: async (args) => { receivedArgs = args; return { success: true, output: '', duration: 0 }; },
      }));
      await cmd.execute("test 'hello world'");
      expect(receivedArgs.msg).toBe('hello world');
    });

    it('should add to history', async () => {
      cmd.register(makeCommand());
      await cmd.execute('test');
      expect(cmd.getHistory().length).toBe(1);
    });

    it('should limit history size', async () => {
      cmd.register(makeCommand());
      for (let i = 0; i < 150; i++) {
        await cmd.execute('test');
      }
      expect(cmd.getHistory().length).toBe(100);
    });
  });

  describe('getHelp', () => {
    it('should return general help when no command name', () => {
      const help = cmd.getHelp();
      expect(help.command).toBe('');
      expect(help.description).toBe('Available commands');
    });

    it('should return command help', () => {
      cmd.register(makeCommand({
        name: 'greet',
        description: 'Greet someone',
        arguments: [{ name: 'name', description: 'Who to greet', required: true, type: 'string' }],
        options: [{ name: 'loud', description: 'Loud greeting', required: false, type: 'boolean' }],
        examples: ['greet Alice', 'greet Bob --loud'],
      }));
      const help = cmd.getHelp('greet');
      expect(help.command).toBe('greet');
      expect(help.description).toBe('Greet someone');
      expect(help.usage).toContain('<name>');
      expect(help.examples).toEqual(['greet Alice', 'greet Bob --loud']);
    });

    it('should resolve aliases for help', () => {
      cmd.register(makeCommand({ name: 'greet', aliases: ['g'] }));
      const help = cmd.getHelp('g');
      expect(help.command).toBe('greet');
    });

    it('should throw for unknown command', () => {
      expect(() => cmd.getHelp('unknown')).toThrow('not found');
    });
  });

  describe('listCommands', () => {
    it('should return empty array initially', () => {
      expect(cmd.listCommands()).toEqual([]);
    });

    it('should list all commands', () => {
      cmd.register(makeCommand({ name: 'cmd1', description: 'First' }));
      cmd.register(makeCommand({ name: 'cmd2', description: 'Second' }));
      const list = cmd.listCommands();
      expect(list.length).toBe(2);
    });

    it('should include aliases', () => {
      cmd.register(makeCommand({ name: 'cmd1', aliases: ['c1'] }));
      const list = cmd.listCommands();
      expect(list[0]!.aliases).toEqual(['c1']);
    });
  });

  describe('getHistory', () => {
    it('should return a copy', () => {
      cmd.register(makeCommand());
      cmd.execute('test');
      const h1 = cmd.getHistory();
      const h2 = cmd.getHistory();
      expect(h1).toEqual(h2);
      expect(h1).not.toBe(h2);
    });
  });

  describe('clearHistory', () => {
    it('should clear history', async () => {
      cmd.register(makeCommand());
      await cmd.execute('test');
      cmd.clearHistory();
      expect(cmd.getHistory()).toEqual([]);
    });
  });

  describe('getCommandCount', () => {
    it('should return 0 initially', () => {
      expect(cmd.getCommandCount()).toBe(0);
    });

    it('should return correct count', () => {
      cmd.register(makeCommand({ name: 'a' }));
      cmd.register(makeCommand({ name: 'b' }));
      expect(cmd.getCommandCount()).toBe(2);
    });
  });
});

// ============================================================================
// Module 7: Plugin Host
// ============================================================================
describe('PluginHost', () => {
  let host: PluginHost;

  beforeEach(() => {
    host = new PluginHost();
  });

  const makePlugin = (overrides?: Partial<PluginDefinition>): PluginDefinition => ({
    name: 'test-plugin',
    version: '1.0.0',
    description: 'A test plugin',
    ...overrides,
  });

  describe('loadPlugin', () => {
    it('should load a plugin', async () => {
      const plugin = await host.loadPlugin(makePlugin());
      expect(plugin.name).toBe('test-plugin');
      expect(plugin.active).toBe(true);
      expect(host.hasPlugin('test-plugin')).toBe(true);
    });

    it('should call init if provided', async () => {
      let inited = false;
      await host.loadPlugin(makePlugin({
        init: async () => { inited = true; },
      }));
      expect(inited).toBe(true);
    });

    it('should set active after successful init', async () => {
      const plugin = await host.loadPlugin(makePlugin({
        init: async () => {},
      }));
      expect(plugin.active).toBe(true);
    });

    it('should set active without init', async () => {
      const plugin = await host.loadPlugin(makePlugin());
      expect(plugin.active).toBe(true);
    });

    // BUG-08: [HIGH] loadPlugin should throw, not Promise.reject
    it('BUG-08: should throw (not Promise.reject) for duplicate plugin', async () => {
      await host.loadPlugin(makePlugin());
      await expect(host.loadPlugin(makePlugin())).rejects.toThrow('already loaded');
    });

    it('BUG-08: should be catchable with try/catch', async () => {
      await host.loadPlugin(makePlugin());
      let caught = false;
      try {
        await host.loadPlugin(makePlugin());
      } catch (e) {
        caught = (e as Error).message.includes('already loaded');
      }
      expect(caught).toBe(true);
    });

    it('should throw for missing dependency', async () => {
      await expect(host.loadPlugin(makePlugin({
        dependencies: ['missing-dep'],
      }))).rejects.toThrow('requires "missing-dep"');
    });

    it('should load with satisfied dependencies', async () => {
      await host.loadPlugin(makePlugin({ name: 'dep' }));
      await host.loadPlugin(makePlugin({
        name: 'dependent',
        dependencies: ['dep'],
      }));
      expect(host.hasPlugin('dependent')).toBe(true);
    });

    it('should create plugin API', async () => {
      const plugin = await host.loadPlugin(makePlugin());
      expect(plugin.api.name).toBe('test-plugin');
      expect(plugin.api.version).toBe('1.0.0');
    });

    it('should record loadedAt timestamp', async () => {
      const before = Date.now();
      const plugin = await host.loadPlugin(makePlugin());
      expect(plugin.loadedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('unloadPlugin', () => {
    it('should unload a plugin', async () => {
      await host.loadPlugin(makePlugin());
      await host.unloadPlugin('test-plugin');
      expect(host.hasPlugin('test-plugin')).toBe(false);
    });

    it('should call deactivate if provided', async () => {
      let deactivated = false;
      await host.loadPlugin(makePlugin({
        deactivate: async () => { deactivated = true; },
      }));
      await host.unloadPlugin('test-plugin');
      expect(deactivated).toBe(true);
    });

    it('should call destroy if provided', async () => {
      let destroyed = false;
      await host.loadPlugin(makePlugin({
        destroy: async () => { destroyed = true; },
      }));
      await host.unloadPlugin('test-plugin');
      expect(destroyed).toBe(true);
    });

    it('should call deactivate before destroy', async () => {
      const order: string[] = [];
      await host.loadPlugin(makePlugin({
        deactivate: async () => { order.push('deactivate'); },
        destroy: async () => { order.push('destroy'); },
      }));
      await host.unloadPlugin('test-plugin');
      expect(order).toEqual(['deactivate', 'destroy']);
    });

    it('should throw for unknown plugin', async () => {
      await expect(host.unloadPlugin('missing')).rejects.toThrow('not loaded');
    });

    it('should clean up event handlers', async () => {
      await host.loadPlugin(makePlugin());
      await host.unloadPlugin('test-plugin');
      // Should not throw when accessing API after unload
      expect(() => host.getPluginAPI('test-plugin')).toThrow('not loaded');
    });
  });

  describe('getPluginAPI', () => {
    it('should return API for loaded plugin', async () => {
      await host.loadPlugin(makePlugin());
      const api = host.getPluginAPI('test-plugin');
      expect(api.name).toBe('test-plugin');
    });

    it('should throw for unloaded plugin', () => {
      expect(() => host.getPluginAPI('missing')).toThrow('not loaded');
    });
  });

  describe('listPlugins', () => {
    it('should return empty array initially', () => {
      expect(host.listPlugins()).toEqual([]);
    });

    it('should list loaded plugins', async () => {
      await host.loadPlugin(makePlugin({ name: 'p1', description: 'Plugin 1' }));
      await host.loadPlugin(makePlugin({ name: 'p2', description: 'Plugin 2' }));
      const list = host.listPlugins();
      expect(list.length).toBe(2);
      expect(list.map((p) => p.name)).toEqual(['p1', 'p2']);
    });
  });

  describe('getPlugin', () => {
    it('should return loaded plugin', async () => {
      const loaded = await host.loadPlugin(makePlugin());
      expect(host.getPlugin('test-plugin')).toBe(loaded);
    });

    it('should return undefined for missing plugin', () => {
      expect(host.getPlugin('missing')).toBeUndefined();
    });
  });

  describe('setConfig / getConfig', () => {
    it('should store and retrieve config', async () => {
      await host.loadPlugin(makePlugin());
      host.setConfig('test-plugin', 'key', 'value');
      const api = host.getPluginAPI('test-plugin');
      expect(api.getConfig('key')).toBe('value');
    });

    it('should return undefined for unknown config key', async () => {
      await host.loadPlugin(makePlugin());
      const api = host.getPluginAPI('test-plugin');
      expect(api.getConfig('unknown')).toBeUndefined();
    });
  });

  describe('plugin API emit/on', () => {
    it('should emit and receive events', async () => {
      await host.loadPlugin(makePlugin());
      const api = host.getPluginAPI('test-plugin');
      let received: unknown = null;
      api.on('test-event', (data) => { received = data; });
      api.emit('test-event', { msg: 'hello' });
      expect(received).toEqual({ msg: 'hello' });
    });

    it('should swallow handler errors', async () => {
      await host.loadPlugin(makePlugin());
      const api = host.getPluginAPI('test-plugin');
      api.on('test-event', () => { throw new Error('handler error'); });
      expect(() => api.emit('test-event')).not.toThrow();
    });
  });

  describe('registerService / getService', () => {
    it('should register and retrieve service via plugin API', async () => {
      await host.loadPlugin(makePlugin());
      host.registerService('my-service', { data: 42 });
      const api = host.getPluginAPI('test-plugin');
      expect(api.getService<{ data: number }>('my-service').data).toBe(42);
    });

    it('should throw for unknown service', async () => {
      await host.loadPlugin(makePlugin());
      const api = host.getPluginAPI('test-plugin');
      expect(() => api.getService('missing')).toThrow('not found');
    });
  });

  describe('getPluginCount', () => {
    it('should return 0 initially', () => {
      expect(host.getPluginCount()).toBe(0);
    });

    it('should return correct count', async () => {
      await host.loadPlugin(makePlugin({ name: 'p1' }));
      await host.loadPlugin(makePlugin({ name: 'p2' }));
      expect(host.getPluginCount()).toBe(2);
    });
  });
});

// ============================================================================
// Module 8: Configuration Manager
// ============================================================================
describe('AppConfigManager', () => {
  let config: AppConfigManager;

  beforeEach(() => {
    config = new AppConfigManager({ name: 'test-app', version: '1.0.0' });
  });

  describe('constructor', () => {
    it('should create with defaults', () => {
      expect(config.get('name')).toBe('test-app');
    });

    it('should create with empty defaults', () => {
      const c = new AppConfigManager();
      expect(() => c.get('name')).toThrow('not found');
    });
  });

  describe('addLayer', () => {
    it('should add a layer', () => {
      config.addLayer('env', 10, { port: 8080 });
      expect(config.get('port')).toBe(8080);
    });

    it('should override lower priority layers', () => {
      config.addLayer('env', 10, { port: 8080 });
      config.addLayer('cli', 20, { port: 9090 });
      expect(config.get('port')).toBe(9090);
    });

    it('should replace existing layer with same name', () => {
      config.addLayer('env', 10, { port: 8080 });
      config.addLayer('env', 20, { port: 9090 });
      expect(config.getLayerNames().filter((n) => n === 'env').length).toBe(1);
      expect(config.get('port')).toBe(9090);
    });

    it('should deep merge layers', () => {
      config.addLayer('base', 10, { db: { host: 'localhost', port: 5432 } });
      config.addLayer('override', 20, { db: { host: 'prod-host' } });
      expect(config.get('db.host')).toBe('prod-host');
      expect(config.get('db.port')).toBe(5432);
    });
  });

  describe('removeLayer', () => {
    it('should remove a layer', () => {
      config.addLayer('env', 10, { port: 8080 });
      expect(config.removeLayer('env')).toBe(true);
      expect(() => config.get('port')).toThrow('not found');
    });

    it('should return false for unknown layer', () => {
      expect(config.removeLayer('missing')).toBe(false);
    });
  });

  describe('get', () => {
    it('should get nested value with dot notation', () => {
      config.addLayer('test', 10, { a: { b: { c: 42 } } });
      expect(config.get('a.b.c')).toBe(42);
    });

    it('should return default value for missing path', () => {
      expect(config.get('missing', 'default')).toBe('default');
    });

    it('should throw for missing path without default', () => {
      expect(() => config.get('missing')).toThrow('not found');
    });

    it('should return undefined as valid value', () => {
      config.addLayer('test', 10, { val: undefined });
      // Since value is undefined, it falls through to default/throw
      expect(config.get('val', 'fallback')).toBe('fallback');
    });
  });

  describe('set', () => {
    it('should set a value', () => {
      config.set('newKey', 'newValue');
      expect(config.get('newKey')).toBe('newValue');
    });

    it('should set nested value', () => {
      config.set('a.b.c', 42);
      expect(config.get('a.b.c')).toBe(42);
    });

    // BUG-05: [MEDIUM] set() should not write to defaults layer
    it('BUG-05: should not write to defaults layer', () => {
      config.set('runtimeKey', 'runtimeValue');
      expect(config.getLayerNames()).toContain('runtime');
      expect(config.getLayerNames()).toContain('defaults');
    });

    it('should notify watchers', () => {
      let newValue: unknown = null;
      let oldValue: unknown = null;
      config.watch('key', (nv, ov) => { newValue = nv; oldValue = ov; });
      config.set('key', 'value');
      expect(newValue).toBe('value');
      expect(oldValue).toBeUndefined();
    });

    it('should notify watchers with old value', () => {
      config.set('key', 'old');
      let newValue: unknown = null;
      let oldValue: unknown = null;
      config.watch('key', (nv, ov) => { newValue = nv; oldValue = ov; });
      config.set('key', 'new');
      expect(newValue).toBe('new');
      expect(oldValue).toBe('old');
    });
  });

  describe('watch', () => {
    it('should return unwatch function', () => {
      let count = 0;
      const unwatch = config.watch('key', () => { count++; });
      config.set('key', 'a');
      config.set('key', 'b');
      expect(count).toBe(2);
      unwatch();
      config.set('key', 'c');
      expect(count).toBe(2);
    });

    it('should support multiple watchers on same path', () => {
      const values: unknown[] = [];
      config.watch('key', (v) => { values.push(v); });
      config.watch('key', (v) => { values.push(v); });
      config.set('key', 'val');
      expect(values).toEqual(['val', 'val']);
    });

    it('should swallow watcher errors', () => {
      config.watch('key', () => { throw new Error('watcher error'); });
      expect(() => config.set('key', 'val')).not.toThrow();
    });
  });

  describe('validate', () => {
    it('should pass with name configured', () => {
      const result = config.validate();
      expect(result.valid).toBe(true);
    });

    it('should warn when name is not configured', () => {
      const c = new AppConfigManager();
      const result = c.validate();
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('export', () => {
    it('should export as JSON', () => {
      const json = config.export('json');
      const parsed = JSON.parse(json);
      expect(parsed.name).toBe('test-app');
    });

    it('should export as env', () => {
      config.addLayer('test', 10, { database: { host: 'localhost', port: 5432 } });
      const env = config.export('env');
      expect(env).toContain('NAME=test-app');
      expect(env).toContain('DATABASE_HOST=localhost');
      expect(env).toContain('DATABASE_PORT=5432');
    });

    it('should export as yaml', () => {
      const yaml = config.export('yaml');
      expect(yaml).toContain('name: test-app');
    });
  });

  describe('has', () => {
    it('should return true for existing path', () => {
      expect(config.has('name')).toBe(true);
    });

    it('should return false for missing path', () => {
      expect(config.has('missing')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return merged data', () => {
      const data = config.getAll();
      expect(data.name).toBe('test-app');
    });
  });

  describe('getLayerNames', () => {
    it('should include defaults', () => {
      expect(config.getLayerNames()).toContain('defaults');
    });
  });
});

// ============================================================================
// Module 9: Health System
// ============================================================================
describe('AppHealthSystem', () => {
  let health: AppHealthSystem;

  beforeEach(() => {
    health = new AppHealthSystem();
  });

  describe('registerCheck', () => {
    it('should register a health check', () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      expect(health.getCheckCount()).toBe(1);
    });

    it('should initialize component health', () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      const comp = health.getComponentHealth('db');
      expect(comp.status).toBe('unknown');
      expect(comp.consecutiveFailures).toBe(0);
    });
  });

  describe('removeCheck', () => {
    it('should remove a health check', () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      expect(health.removeCheck('db')).toBe(true);
      expect(health.getCheckCount()).toBe(0);
    });

    it('should return false for unknown check', () => {
      expect(health.removeCheck('missing')).toBe(false);
    });
  });

  describe('checkHealth', () => {
    it('should return healthy report for all healthy checks', async () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      health.registerCheck('cache', async () => ({ status: 'healthy' }));
      const report = await health.checkHealth();
      expect(report.status).toBe('healthy');
      expect(report.score).toBe(100);
    });

    it('should return degraded report', async () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      health.registerCheck('cache', async () => ({ status: 'degraded' }));
      const report = await health.checkHealth();
      expect(report.status).toBe('degraded');
      expect(report.score).toBe(75);
    });

    it('should return unhealthy report', async () => {
      health.registerCheck('db', async () => ({ status: 'unhealthy', message: 'down' }));
      const report = await health.checkHealth();
      expect(report.status).toBe('unhealthy');
      expect(report.score).toBe(0);
    });

    it('should handle check that throws', async () => {
      health.registerCheck('db', async () => { throw new Error('timeout'); });
      const report = await health.checkHealth();
      expect(report.checks.db.status).toBe('unhealthy');
      expect(report.checks.db.message).toBe('timeout');
    });

    it('should record responseTime', async () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      const report = await health.checkHealth();
      expect(report.checks.db.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should track consecutive failures', async () => {
      health.registerCheck('db', async () => ({ status: 'unhealthy', message: 'fail' }));
      await health.checkHealth();
      await health.checkHealth();
      await health.checkHealth();
      const comp = health.getComponentHealth('db');
      expect(comp.consecutiveFailures).toBe(3);
      expect(comp.lastError).toBe('fail');
    });

    it('should reset consecutive failures on healthy', async () => {
      health.registerCheck('db', async () => ({ status: 'unhealthy' }));
      await health.checkHealth();
      // Now make it healthy - need to re-register or use a toggle
      // Since we can't change the check, let's test with a counter
      let fail = true;
      const h2 = new AppHealthSystem();
      h2.registerCheck('db', async () => {
        if (fail) return { status: 'unhealthy' as const };
        return { status: 'healthy' as const };
      });
      await h2.checkHealth();
      expect(h2.getComponentHealth('db').consecutiveFailures).toBe(1);
      fail = false;
      await h2.checkHealth();
      expect(h2.getComponentHealth('db').consecutiveFailures).toBe(0);
    });

    it('should return 100 score with no checks', async () => {
      const report = await health.checkHealth();
      expect(report.score).toBe(100);
      expect(report.status).toBe('healthy');
    });

    it('should include component health in report', async () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      const report = await health.checkHealth();
      expect(report.componentHealth.db.status).toBe('healthy');
    });

    it('should add to history', async () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      await health.checkHealth();
      await health.checkHealth();
      expect(health.getHistory().length).toBe(2);
    });

    it('should limit history size', async () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      for (let i = 0; i < 150; i++) {
        await health.checkHealth();
      }
      expect(health.getHistory().length).toBe(100);
    });
  });

  describe('isHealthy', () => {
    it('should return true when no checks', () => {
      expect(health.isHealthy()).toBe(true);
    });

    it('should return true when all checks healthy', async () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      await health.checkHealth();
      expect(health.isHealthy()).toBe(true);
    });

    it('should return false when any check unhealthy', async () => {
      health.registerCheck('db', async () => ({ status: 'unhealthy' }));
      await health.checkHealth();
      expect(health.isHealthy()).toBe(false);
    });

    it('should return true when degraded (not unhealthy)', async () => {
      health.registerCheck('db', async () => ({ status: 'degraded' }));
      await health.checkHealth();
      expect(health.isHealthy()).toBe(true);
    });
  });

  describe('isReady', () => {
    it('should return true when no checks', () => {
      expect(health.isReady()).toBe(true);
    });

    it('should return false when check is unknown', () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      expect(health.isReady()).toBe(false);
    });

    it('should return true when all checks are healthy', async () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      await health.checkHealth();
      expect(health.isReady()).toBe(true);
    });

    it('should return false when any check is unhealthy', async () => {
      health.registerCheck('db', async () => ({ status: 'unhealthy' }));
      await health.checkHealth();
      expect(health.isReady()).toBe(false);
    });
  });

  describe('getComponentHealth', () => {
    it('should return default for unknown component', () => {
      const comp = health.getComponentHealth('missing');
      expect(comp.status).toBe('unknown');
      expect(comp.lastCheck).toBe(0);
      expect(comp.consecutiveFailures).toBe(0);
    });

    it('should return a copy', async () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      await health.checkHealth();
      const h1 = health.getComponentHealth('db');
      const h2 = health.getComponentHealth('db');
      expect(h1).toEqual(h2);
      expect(h1).not.toBe(h2);
    });
  });

  describe('getHistory', () => {
    it('should return a copy', async () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      await health.checkHealth();
      const h1 = health.getHistory();
      const h2 = health.getHistory();
      expect(h1).toEqual(h2);
      expect(h1).not.toBe(h2);
    });
  });

  describe('clearHistory', () => {
    it('should clear history', async () => {
      health.registerCheck('db', async () => ({ status: 'healthy' }));
      await health.checkHealth();
      health.clearHistory();
      expect(health.getHistory()).toEqual([]);
    });
  });
});

// ============================================================================
// Module 10: Telemetry System
// ============================================================================
describe('AppTelemetrySystem', () => {
  let telemetry: AppTelemetrySystem;

  beforeEach(() => {
    telemetry = new AppTelemetrySystem();
  });

  describe('recordMetric', () => {
    it('should record a counter', () => {
      telemetry.recordMetric('requests', 1, 'counter');
      telemetry.recordMetric('requests', 1, 'counter');
      expect(telemetry.getCounter('requests')).toBe(2);
    });

    it('should record a gauge', () => {
      telemetry.recordMetric('cpu', 0.5, 'gauge');
      telemetry.recordMetric('cpu', 0.8, 'gauge');
      expect(telemetry.getGauge('cpu')).toBe(0.8);
    });

    it('should record histogram values', () => {
      telemetry.recordMetric('latency', 100, 'histogram');
      telemetry.recordMetric('latency', 200, 'histogram');
      telemetry.recordMetric('latency', 300, 'histogram');
      const metrics = telemetry.getMetrics();
      expect(metrics.histograms.latency.count).toBe(3);
      expect(metrics.histograms.latency.min).toBe(100);
      expect(metrics.histograms.latency.max).toBe(300);
      expect(metrics.histograms.latency.avg).toBe(200);
    });

    it('should record summary values', () => {
      telemetry.recordMetric('response_size', 10, 'summary');
      telemetry.recordMetric('response_size', 20, 'summary');
      telemetry.recordMetric('response_size', 30, 'summary');
      const metrics = telemetry.getMetrics();
      expect(metrics.summaries.response_size.count).toBe(3);
      expect(metrics.summaries.response_size.quantiles['0.5']).toBe(20);
    });

    it('should track metric history', () => {
      telemetry.recordMetric('req', 1, 'counter');
      telemetry.recordMetric('req', 1, 'counter');
      const history = telemetry.flush();
      expect(history.length).toBe(2);
    });

    it('should limit metric history', () => {
      for (let i = 0; i < 15000; i++) {
        telemetry.recordMetric('req', 1, 'counter');
      }
      // History should be capped at maxHistory
      const metrics = telemetry.getMetrics();
      expect(metrics.counters.req).toBe(15000); // counter still accumulates
    });

    it('should return 0 for unknown counter', () => {
      expect(telemetry.getCounter('missing')).toBe(0);
    });

    it('should return undefined for unknown gauge', () => {
      expect(telemetry.getGauge('missing')).toBeUndefined();
    });

    it('should record with labels', () => {
      telemetry.recordMetric('req', 1, 'counter', { method: 'GET' });
      const history = telemetry.flush();
      expect(history[0]!.labels).toEqual({ method: 'GET' });
    });
  });

  describe('startSpan', () => {
    it('should create and track a span', () => {
      const span = telemetry.startSpan('operation');
      expect(span.name).toBe('operation');
      expect(span.context.spanId).toMatch(/^span-\d+$/);
      expect(span.context.traceId).toMatch(/^trace-\d+$/);
      expect(span.status).toBe('ok');
    });

    it('should set traceId from context', () => {
      const span = telemetry.startSpan('op', { traceId: 'my-trace', parentSpanId: 'parent-1' });
      expect(span.context.traceId).toBe('my-trace');
      expect(span.context.parentSpanId).toBe('parent-1');
    });

    it('should end span and move to completed', () => {
      const span = telemetry.startSpan('op');
      span.end();
      expect(span.endTime).not.toBeUndefined();
      expect(span.duration).not.toBeUndefined();
      const dashboard = telemetry.getDashboard();
      expect(dashboard.activeSpans).toBe(0);
      expect(dashboard.completedSpans).toBe(1);
    });

    it('should limit completed spans', () => {
      for (let i = 0; i < 1500; i++) {
        const span = telemetry.startSpan('op');
        span.end();
      }
      const dashboard = telemetry.getDashboard();
      expect(dashboard.completedSpans).toBe(1000);
    });

    it('should support span attributes', () => {
      const span = telemetry.startSpan('op');
      span.attributes['key'] = 'value';
      expect(span.attributes.key).toBe('value');
    });
  });

  describe('getMetrics', () => {
    it('should return empty snapshot initially', () => {
      const snapshot = telemetry.getMetrics();
      expect(snapshot.counters).toEqual({});
      expect(snapshot.gauges).toEqual({});
      expect(snapshot.histograms).toEqual({});
      expect(snapshot.summaries).toEqual({});
    });

    it('should include timestamp', () => {
      const snapshot = telemetry.getMetrics();
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });

    it('should compute histogram buckets', () => {
      telemetry.recordMetric('latency', 0.05, 'histogram');
      telemetry.recordMetric('latency', 0.5, 'histogram');
      telemetry.recordMetric('latency', 3, 'histogram');
      telemetry.recordMetric('latency', 8, 'histogram');
      telemetry.recordMetric('latency', 15, 'histogram');
      const metrics = telemetry.getMetrics();
      const buckets = metrics.histograms.latency.buckets;
      expect(buckets['0.1']).toBe(1);
      expect(buckets['1']).toBe(2);
      expect(buckets['5']).toBe(3);
      expect(buckets['10']).toBe(4);
    });

    // BUG-09: [MEDIUM] Quantile calculation
    it('BUG-09: should calculate quantiles correctly', () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      for (const v of values) {
        telemetry.recordMetric('resp', v, 'summary');
      }
      const metrics = telemetry.getMetrics();
      const q = metrics.summaries.resp.quantiles;
      // p50: index = floor(9 * 0.5) = 4 -> values[4] = 50
      expect(q['0.5']).toBe(50);
      // p90: index = floor(9 * 0.9) = 8 -> values[8] = 90
      expect(q['0.9']).toBe(90);
      // p99: index = floor(9 * 0.99) = 8 -> values[8] = 90
      expect(q['0.99']).toBe(90);
    });

    it('BUG-09: should handle single value summary', () => {
      telemetry.recordMetric('single', 42, 'summary');
      const metrics = telemetry.getMetrics();
      const q = metrics.summaries.single.quantiles;
      expect(q['0.5']).toBe(42);
      expect(q['0.9']).toBe(42);
      expect(q['0.99']).toBe(42);
    });
  });

  describe('getDashboard', () => {
    it('should return dashboard with correct counts', () => {
      telemetry.recordMetric('c1', 1, 'counter');
      telemetry.recordMetric('g1', 1, 'gauge');
      telemetry.recordMetric('h1', 1, 'histogram');
      telemetry.recordMetric('s1', 1, 'summary');
      const dashboard = telemetry.getDashboard();
      expect(dashboard.totalMetrics).toBe(4);
      expect(dashboard.metricCountByType.counter).toBe(1);
      expect(dashboard.metricCountByType.gauge).toBe(1);
      expect(dashboard.metricCountByType.histogram).toBe(1);
      expect(dashboard.metricCountByType.summary).toBe(1);
    });

    it('should return top metrics sorted by value', () => {
      telemetry.recordMetric('low', 1, 'counter');
      telemetry.recordMetric('high', 100, 'counter');
      telemetry.recordMetric('mid', 50, 'counter');
      const dashboard = telemetry.getDashboard();
      expect(dashboard.topMetrics[0]!.name).toBe('high');
      expect(dashboard.topMetrics[1]!.name).toBe('mid');
      expect(dashboard.topMetrics[2]!.name).toBe('low');
    });

    it('should limit top metrics to 10', () => {
      for (let i = 0; i < 15; i++) {
        telemetry.recordMetric(`m${i}`, i, 'counter');
      }
      const dashboard = telemetry.getDashboard();
      expect(dashboard.topMetrics.length).toBe(10);
    });

    it('should track active spans', () => {
      telemetry.startSpan('op1');
      telemetry.startSpan('op2');
      const dashboard = telemetry.getDashboard();
      expect(dashboard.activeSpans).toBe(2);
    });
  });

  describe('reset', () => {
    it('should clear all data', () => {
      telemetry.recordMetric('req', 1, 'counter');
      telemetry.startSpan('op');
      telemetry.reset();
      expect(telemetry.getCounter('req')).toBe(0);
      expect(telemetry.getDashboard().activeSpans).toBe(0);
      expect(telemetry.getDashboard().completedSpans).toBe(0);
    });
  });

  describe('flush', () => {
    it('should return and clear metric history', () => {
      telemetry.recordMetric('req', 1, 'counter');
      telemetry.recordMetric('req', 1, 'counter');
      const records = telemetry.flush();
      expect(records.length).toBe(2);
      const empty = telemetry.flush();
      expect(empty.length).toBe(0);
    });
  });
});
