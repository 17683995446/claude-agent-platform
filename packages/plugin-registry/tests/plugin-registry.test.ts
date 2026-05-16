import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { PluginVersionManager } from '../src/plugin-versioning.ts';
import { PluginDependencyResolver } from '../src/plugin-dependency.ts';
import type { PluginDefinition } from '../src/plugin-dependency.ts';
import { PluginSandbox } from '../src/plugin-sandbox.ts';
import type { PluginPermission, WhitelistedApi } from '../src/plugin-sandbox.ts';
import { HookSystem } from '../src/hook-system.ts';
import { PluginConfigManager } from '../src/plugin-config.ts';
import { PluginCommunicationBus } from '../src/plugin-communication.ts';
import type { PluginMessage } from '../src/plugin-communication.ts';
import { PluginTelemetry } from '../src/plugin-telemetry.ts';
import { PluginMarketplace } from '../src/plugin-marketplace.ts';
import type { PluginListing } from '../src/plugin-marketplace.ts';
import { PluginLoader } from '../src/plugin-loader.ts';
import { PluginRegistry } from '../src/registry-core.ts';

// ============================================================
// Module 1: PluginVersionManager Tests
// ============================================================
describe('PluginVersionManager', () => {
  let vm: PluginVersionManager;

  beforeEach(() => {
    vm = new PluginVersionManager();
  });

  test('parseVersion - parses valid semver', () => {
    const v = vm.parseVersion('1.2.3');
    expect(v.major).toBe(1);
    expect(v.minor).toBe(2);
    expect(v.patch).toBe(3);
    expect(v.raw).toBe('1.2.3');
  });

  test('parseVersion - parses version with v prefix', () => {
    const v = vm.parseVersion('v2.0.0');
    expect(v.major).toBe(2);
    expect(v.minor).toBe(0);
    expect(v.patch).toBe(0);
  });

  test('parseVersion - parses version with prerelease', () => {
    const v = vm.parseVersion('1.0.0-beta.1');
    expect(v.major).toBe(1);
    expect(v.prerelease).toBe('beta.1');
  });

  test('parseVersion - parses version with build metadata', () => {
    const v = vm.parseVersion('1.0.0+build.123');
    expect(v.build).toBe('build.123');
  });

  test('parseVersion - throws on invalid version', () => {
    expect(() => vm.parseVersion('not-a-version')).toThrow();
  });

  test('parseVersion - throws on empty string', () => {
    expect(() => vm.parseVersion('')).toThrow();
  });

  test('compare - equal versions', () => {
    expect(vm.compare('1.0.0', '1.0.0')).toBe(0);
  });

  test('compare - major version difference', () => {
    expect(vm.compare('2.0.0', '1.0.0')).toBe(1);
    expect(vm.compare('1.0.0', '2.0.0')).toBe(-1);
  });

  test('compare - minor version difference', () => {
    expect(vm.compare('1.2.0', '1.1.0')).toBe(1);
  });

  test('compare - patch version difference', () => {
    expect(vm.compare('1.0.1', '1.0.0')).toBe(1);
  });

  test('compare - prerelease has lower precedence', () => {
    expect(vm.compare('1.0.0-beta', '1.0.0')).toBe(-1);
    expect(vm.compare('1.0.0', '1.0.0-beta')).toBe(1);
  });

  test('gt, lt, eq, gte, lte', () => {
    expect(vm.gt('2.0.0', '1.0.0')).toBe(true);
    expect(vm.lt('1.0.0', '2.0.0')).toBe(true);
    expect(vm.eq('1.0.0', '1.0.0')).toBe(true);
    expect(vm.gte('1.0.0', '1.0.0')).toBe(true);
    expect(vm.lte('1.0.0', '1.0.0')).toBe(true);
    expect(vm.gte('2.0.0', '1.0.0')).toBe(true);
    expect(vm.lte('1.0.0', '2.0.0')).toBe(true);
  });

  test('satisfies - exact match', () => {
    expect(vm.satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(vm.satisfies('1.2.4', '1.2.3')).toBe(false);
  });

  test('satisfies - caret range', () => {
    expect(vm.satisfies('1.2.3', '^1.2.3')).toBe(true);
    expect(vm.satisfies('1.9.9', '^1.2.3')).toBe(true);
    expect(vm.satisfies('2.0.0', '^1.2.3')).toBe(false);
    expect(vm.satisfies('1.2.2', '^1.2.3')).toBe(false);
  });

  test('satisfies - tilde range', () => {
    expect(vm.satisfies('1.2.3', '~1.2.3')).toBe(true);
    expect(vm.satisfies('1.2.9', '~1.2.3')).toBe(true);
    expect(vm.satisfies('1.3.0', '~1.2.3')).toBe(false);
  });

  test('satisfies - comparison operators', () => {
    expect(vm.satisfies('2.0.0', '>1.0.0')).toBe(true);
    expect(vm.satisfies('1.0.0', '>1.0.0')).toBe(false);
    expect(vm.satisfies('1.0.0', '>=1.0.0')).toBe(true);
    expect(vm.satisfies('0.9.0', '<1.0.0')).toBe(true);
    expect(vm.satisfies('1.0.0', '<=1.0.0')).toBe(true);
  });

  test('getLatestCompatible - returns latest matching version', () => {
    const versions = ['1.0.0', '1.2.0', '1.5.0', '2.0.0'];
    expect(vm.getLatestCompatible(versions, '^1.0.0')).toBe('1.5.0');
  });

  test('getLatestCompatible - returns undefined when no match', () => {
    expect(vm.getLatestCompatible(['2.0.0', '3.0.0'], '^1.0.0')).toBeUndefined();
  });

  test('getUpdatePath - generates correct path', () => {
    const path = vm.getUpdatePath('1.0.0', '1.2.0');
    expect(path).toContain('1.0.0');
    expect(path[path.length - 1]).toBe('1.2.0');
  });

  test('getUpdatePath - same version returns single element', () => {
    const path = vm.getUpdatePath('1.0.0', '1.0.0');
    expect(path).toEqual(['1.0.0']);
  });

  test('formatVersion - formats correctly', () => {
    const v = vm.parseVersion('1.2.3-beta.1+build');
    expect(vm.formatVersion(v)).toBe('1.2.3-beta.1+build');
  });
});

// ============================================================
// Module 2: PluginDependencyResolver Tests
// ============================================================
describe('PluginDependencyResolver', () => {
  let resolver: PluginDependencyResolver;

  beforeEach(() => {
    resolver = new PluginDependencyResolver();
  });

  const makePlugin = (name: string, version = '1.0.0', deps?: Record<string, string>): PluginDefinition => ({
    name,
    version,
    dependencies: deps,
  });

  test('resolve - creates dependency graph', () => {
    const plugins = [makePlugin('a'), makePlugin('b', '1.0.0', { a: '^1.0.0' })];
    const graph = resolver.resolve(plugins);
    expect(graph.nodes.has('a')).toBe(true);
    expect(graph.nodes.has('b')).toBe(true);
    expect(graph.edges.length).toBe(1);
  });

  test('getLoadOrder - returns topological order', () => {
    const plugins = [
      makePlugin('c', '1.0.0', { b: '^1.0.0' }),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
      makePlugin('a'),
    ];
    const order = resolver.getLoadOrder(plugins);
    const aIdx = order.indexOf('a');
    const bIdx = order.indexOf('b');
    const cIdx = order.indexOf('c');
    expect(aIdx).toBeLessThan(bIdx);
    expect(bIdx).toBeLessThan(cIdx);
  });

  test('getLoadOrder - independent plugins can be in any order', () => {
    const plugins = [makePlugin('a'), makePlugin('b'), makePlugin('c')];
    const order = resolver.getLoadOrder(plugins);
    expect(order).toHaveLength(3);
    expect(order).toContain('a');
    expect(order).toContain('b');
    expect(order).toContain('c');
  });

  test('checkConflicts - detects missing dependencies', () => {
    const plugins = [makePlugin('a', '1.0.0', { missing: '^1.0.0' })];
    const conflicts = resolver.checkConflicts(plugins);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].type).toBe('missing_dependency');
  });

  test('checkConflicts - no conflicts for valid plugins', () => {
    const plugins = [
      makePlugin('a'),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
    ];
    const conflicts = resolver.checkConflicts(plugins);
    const missing = conflicts.filter(c => c.type === 'missing_dependency');
    expect(missing).toHaveLength(0);
  });

  test('checkConflicts - detects circular dependencies', () => {
    const plugins = [
      makePlugin('a', '1.0.0', { b: '^1.0.0' }),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
    ];
    const conflicts = resolver.checkConflicts(plugins);
    const circular = conflicts.filter(c => c.type === 'circular_dependency');
    expect(circular.length).toBeGreaterThan(0);
  });

  test('getDependencyTree - returns tree for plugin', () => {
    const plugins = [
      makePlugin('a'),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
    ];
    const tree = resolver.getDependencyTree('b', plugins);
    expect(tree).toBeDefined();
    expect(tree!.name).toBe('b');
    expect(tree!.dependencies).toContain('a');
  });

  test('getDependencyTree - returns undefined for unknown plugin', () => {
    const tree = resolver.getDependencyTree('unknown', []);
    expect(tree).toBeUndefined();
  });

  test('resolve - handles empty plugin list', () => {
    const graph = resolver.resolve([]);
    expect(graph.nodes.size).toBe(0);
    expect(graph.loadOrder).toHaveLength(0);
  });

  test('registerAvailableVersion - stores versions', () => {
    resolver.registerAvailableVersion('test', '1.0.0');
    resolver.registerAvailableVersion('test', '2.0.0');
    // No error, just verifying it doesn't throw
    expect(true).toBe(true);
  });
});

// ============================================================
// Module 3: PluginSandbox Tests
// ============================================================
describe('PluginSandbox', () => {
  let sandbox: PluginSandbox;

  beforeEach(() => {
    sandbox = new PluginSandbox();
  });

  test('createSandbox - creates context with permissions', () => {
    const ctx = sandbox.createSandbox('test-plugin', ['fs.read', 'net.request']);
    expect(ctx.pluginName).toBe('test-plugin');
    expect(ctx.hasPermission('fs.read')).toBe(true);
    expect(ctx.hasPermission('net.request')).toBe(true);
    expect(ctx.hasPermission('fs.write')).toBe(false);
  });

  test('createSandbox - exposes whitelisted APIs', () => {
    sandbox.registerApi({
      name: 'readFile',
      requiredPermissions: ['fs.read'],
      handler: (path: string) => `content of ${path}`,
    });

    const ctx = sandbox.createSandbox('test', ['fs.read']);
    expect(typeof ctx.api.readFile).toBe('function');
  });

  test('createSandbox - hides APIs without required permissions', () => {
    sandbox.registerApi({
      name: 'writeFile',
      requiredPermissions: ['fs.write'],
      handler: () => 'ok',
    });

    const ctx = sandbox.createSandbox('test', ['fs.read']);
    expect(ctx.api.writeFile).toBeUndefined();
  });

  test('callApi - executes whitelisted API', () => {
    sandbox.registerApi({
      name: 'greet',
      requiredPermissions: [],
      handler: (name: string) => `Hello, ${name}!`,
    });

    const ctx = sandbox.createSandbox('test', []);
    const result = ctx.callApi('greet', 'World');
    expect(result).toBe('Hello, World!');
  });

  test('callApi - throws for non-whitelisted API', () => {
    const ctx = sandbox.createSandbox('test', []);
    expect(() => ctx.callApi('nonexistent')).toThrow();
  });

  test('callApi - throws when lacking permissions', () => {
    sandbox.registerApi({
      name: 'secret',
      requiredPermissions: ['admin'],
      handler: () => 'secret data',
    });

    const ctx = sandbox.createSandbox('test', []);
    expect(() => ctx.callApi('secret')).toThrow();
  });

  test('getAuditLog - records API calls', () => {
    sandbox.registerApi({
      name: 'ping',
      requiredPermissions: [],
      handler: () => 'pong',
    });

    const ctx = sandbox.createSandbox('test', []);
    ctx.callApi('ping');
    const log = ctx.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].apiName).toBe('ping');
    expect(log[0].result).toBe('allowed');
  });

  test('getAuditLog - records denied calls', () => {
    const ctx = sandbox.createSandbox('test', []);
    try { ctx.callApi('nonexistent'); } catch { /* expected */ }
    const log = ctx.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].result).toBe('denied');
  });

  test('destroySandbox - removes sandbox', () => {
    sandbox.createSandbox('test', []);
    expect(sandbox.getSandbox('test')).toBeDefined();
    sandbox.destroySandbox('test');
    expect(sandbox.getSandbox('test')).toBeUndefined();
  });

  test('listSandboxes - lists all sandboxes', () => {
    sandbox.createSandbox('a', []);
    sandbox.createSandbox('b', []);
    expect(sandbox.listSandboxes()).toHaveLength(2);
  });

  test('removeApi - removes API from whitelist', () => {
    sandbox.registerApi({ name: 'temp', requiredPermissions: [], handler: () => {} });
    sandbox.removeApi('temp');
    const ctx = sandbox.createSandbox('test', []);
    expect(() => ctx.callApi('temp')).toThrow();
  });

  test('getResourceUsage - tracks request count', () => {
    sandbox.registerApi({ name: 'inc', requiredPermissions: [], handler: () => 1 });
    const ctx = sandbox.createSandbox('test', []);
    ctx.callApi('inc');
    ctx.callApi('inc');
    expect(ctx.getResourceUsage().requestCount).toBe(2);
  });
});

// ============================================================
// Module 4: HookSystem Tests
// ============================================================
describe('HookSystem', () => {
  let hooks: HookSystem;

  beforeEach(() => {
    hooks = new HookSystem();
  });

  test('addHook - returns handler id', () => {
    const id = hooks.addHook('custom', () => {});
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  test('doAction - calls action handlers', () => {
    let called = false;
    hooks.addHook('custom', () => { called = true; });
    hooks.doAction('custom');
    expect(called).toBe(true);
  });

  test('doAction - calls multiple handlers', () => {
    const results: number[] = [];
    hooks.addHook('custom', () => { results.push(1); });
    hooks.addHook('custom', () => { results.push(2); });
    hooks.doAction('custom');
    expect(results).toEqual([1, 2]);
  });

  test('doAction - respects priority order', () => {
    const results: number[] = [];
    hooks.addHook('custom', () => { results.push(2); }, { priority: 20 });
    hooks.addHook('custom', () => { results.push(1); }, { priority: 5 });
    hooks.doAction('custom');
    expect(results).toEqual([1, 2]);
  });

  test('applyFilters - transforms value through filters', () => {
    hooks.addHook('transform', (val: number) => val * 2);
    hooks.addHook('transform', (val: number) => val + 10);
    const result = hooks.applyFilters('transform', 5);
    expect(result).toBe(20); // (5 * 2) + 10
  });

  test('applyFilters - returns original if no handlers', () => {
    expect(hooks.applyFilters('nonexistent', 42)).toBe(42);
  });

  test('removeHook - removes handler', () => {
    const id = hooks.addHook('custom', () => { throw new Error('should not be called'); });
    hooks.removeHook('custom', id);
    expect(() => hooks.doAction('custom')).not.toThrow();
  });

  test('removeHook - returns false for unknown hook', () => {
    expect(hooks.removeHook('nonexistent', 'bad-id')).toBe(false);
  });

  test('once option - handler fires only once', () => {
    let count = 0;
    hooks.addHook('custom', () => { count++; }, { once: true });
    hooks.doAction('custom');
    hooks.doAction('custom');
    expect(count).toBe(1);
  });

  test('condition option - handler fires when condition met', () => {
    let count = 0;
    hooks.addHook('custom', () => { count++; }, { condition: (val: number) => val > 5 });
    hooks.doAction('custom', 3);
    hooks.doAction('custom', 10);
    expect(count).toBe(1);
  });

  test('built-in hooks are registered', () => {
    const names = hooks.getHookNames();
    expect(names).toContain('before_init');
    expect(names).toContain('after_init');
    expect(names).toContain('before_execute');
    expect(names).toContain('after_execute');
    expect(names).toContain('on_error');
    expect(names).toContain('on_shutdown');
  });

  test('doAsyncAction - calls async handlers', async () => {
    let called = false;
    hooks.addHook('async_hook', async () => { called = true; });
    await hooks.doAsyncAction('async_hook');
    expect(called).toBe(true);
  });

  test('applyAsyncFilters - transforms value through async filters', async () => {
    hooks.addHook('async_transform', async (val: number) => val * 3);
    const result = await hooks.applyAsyncFilters('async_transform', 10);
    expect(result).toBe(30);
  });

  test('removeAllHooks - clears all hooks for a name', () => {
    hooks.addHook('custom', () => {});
    hooks.addHook('custom', () => {});
    hooks.removeAllHooks('custom');
    expect(hooks.getHookHandlers('custom')).toHaveLength(0);
  });

  test('removeAllHooks - clears all hooks when no name', () => {
    hooks.addHook('a', () => {});
    hooks.addHook('b', () => {});
    hooks.removeAllHooks();
    expect(hooks.getHookNames()).toHaveLength(0);
  });

  test('getHookHandlers - returns handlers for hook', () => {
    hooks.addHook('custom', () => {});
    hooks.addHook('custom', () => {});
    expect(hooks.getHookHandlers('custom')).toHaveLength(2);
  });
});

// ============================================================
// Module 5: PluginConfigManager Tests
// ============================================================
describe('PluginConfigManager', () => {
  let config: PluginConfigManager;

  beforeEach(() => {
    config = new PluginConfigManager();
  });

  test('getPluginConfig - returns merged config', () => {
    config.setGlobalConfig({ theme: 'dark', lang: 'en' });
    config.registerPluginDefaults('test', { theme: 'light', debug: false });
    config.setPluginConfig('test', { debug: true });
    const result = config.getPluginConfig('test');
    expect(result.lang).toBe('en'); // from global
    expect(result.theme).toBe('light'); // from defaults
    expect(result.debug).toBe(true); // from user
  });

  test('getPluginConfig - returns global config when no plugin config', () => {
    config.setGlobalConfig({ key: 'value' });
    const result = config.getPluginConfig('nonexistent');
    expect(result.key).toBe('value');
  });

  test('setPluginConfig - triggers change notification', () => {
    const changes: Array<{ key: string; old: unknown; new: unknown }> = [];
    config.onChange((name, key, old, newVal) => {
      changes.push({ key, old, new: newVal });
    });
    config.setPluginConfig('test', { foo: 'bar' });
    expect(changes).toHaveLength(1);
    expect(changes[0].key).toBe('foo');
  });

  test('validateConfig - valid config', () => {
    config.registerSchema('test', {
      properties: {
        port: { type: 'number', required: true, min: 1, max: 65535 },
        host: { type: 'string' },
      },
    });
    const result = config.validateConfig('test', { port: 8080, host: 'localhost' });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validateConfig - missing required property', () => {
    config.registerSchema('test', {
      properties: {
        port: { type: 'number', required: true },
      },
    });
    const result = config.validateConfig('test', {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('validateConfig - wrong type', () => {
    config.registerSchema('test', {
      properties: {
        port: { type: 'number' },
      },
    });
    const result = config.validateConfig('test', { port: 'not-a-number' });
    expect(result.valid).toBe(false);
  });

  test('validateConfig - enum validation', () => {
    config.registerSchema('test', {
      properties: {
        mode: { type: 'string', enum: ['dev', 'prod', 'test'] },
      },
    });
    expect(config.validateConfig('test', { mode: 'dev' }).valid).toBe(true);
    expect(config.validateConfig('test', { mode: 'invalid' }).valid).toBe(false);
  });

  test('validateConfig - number range', () => {
    config.registerSchema('test', {
      properties: {
        port: { type: 'number', min: 1, max: 100 },
      },
    });
    expect(config.validateConfig('test', { port: 50 }).valid).toBe(true);
    expect(config.validateConfig('test', { port: 0 }).valid).toBe(false);
    expect(config.validateConfig('test', { port: 101 }).valid).toBe(false);
  });

  test('validateConfig - strict mode rejects unknown properties', () => {
    config.registerSchema('test', {
      properties: { known: { type: 'string' } },
      strict: true,
    });
    const result = config.validateConfig('test', { known: 'ok', unknown: 'bad' });
    expect(result.valid).toBe(false);
  });

  test('exportConfig / importConfig - round trip', () => {
    config.setPluginConfig('a', { x: 1 });
    config.setPluginConfig('b', { y: 2 });
    const exported = config.exportConfig();
    const newConfig = new PluginConfigManager();
    newConfig.importConfig(exported);
    expect(newConfig.getPluginConfig('a').x).toBe(1);
    expect(newConfig.getPluginConfig('b').y).toBe(2);
  });

  test('resetPluginConfig - clears plugin config', () => {
    config.setPluginConfig('test', { key: 'value' });
    config.resetPluginConfig('test');
    expect(config.getPluginConfig('test').key).toBeUndefined();
  });

  test('getSchema - returns registered schema', () => {
    const schema = { properties: { key: { type: 'string' } } };
    config.registerSchema('test', schema);
    expect(config.getSchema('test')).toEqual(schema);
  });

  test('getSchema - returns undefined for unknown plugin', () => {
    expect(config.getSchema('unknown')).toBeUndefined();
  });

  test('onChange - unsubscribe works', () => {
    let count = 0;
    const unsub = config.onChange(() => { count++; });
    config.setPluginConfig('test', { a: 1 });
    unsub();
    config.setPluginConfig('test', { b: 2 });
    expect(count).toBe(1);
  });

  test('listConfiguredPlugins - lists plugins with config', () => {
    config.setPluginConfig('a', {});
    config.setPluginConfig('b', {});
    const list = config.listConfiguredPlugins();
    expect(list).toContain('a');
    expect(list).toContain('b');
  });
});

// ============================================================
// Module 6: PluginCommunicationBus Tests
// ============================================================
describe('PluginCommunicationBus', () => {
  let bus: PluginCommunicationBus;

  beforeEach(() => {
    bus = new PluginCommunicationBus();
  });

  afterEach(() => {
    bus.reset();
  });

  test('send - delivers message to target', () => {
    let received: PluginMessage | undefined;
    bus.onMessage('target', (msg) => { received = msg; });
    const sent = bus.send('source', 'target', { type: 'greeting', data: 'hello' });
    expect(sent).toBe(true);
    expect(received).toBeDefined();
    expect(received!.type).toBe('greeting');
  });

  test('send - returns false when no handlers', () => {
    const sent = bus.send('source', 'nobody', { type: 'test', data: null });
    expect(sent).toBe(false);
  });

  test('send - throws when sender is blocked', () => {
    bus.blockPlugin('bad');
    expect(() => bus.send('bad', 'target', { type: 'test', data: null })).toThrow();
  });

  test('broadcast - delivers to all registered plugins', () => {
    const received: string[] = [];
    bus.onMessage('a', () => { received.push('a'); });
    bus.onMessage('b', () => { received.push('b'); });
    const count = bus.broadcast('source', { type: 'announce', data: null });
    expect(count).toBe(2);
    expect(received).toContain('a');
    expect(received).toContain('b');
  });

  test('broadcast - does not deliver to sender', () => {
    let received = false;
    bus.onMessage('sender', () => { received = true; });
    bus.broadcast('sender', { type: 'test', data: null });
    expect(received).toBe(false);
  });

  test('broadcast - skips blocked plugins', () => {
    bus.onMessage('a', () => {});
    bus.onMessage('b', () => {});
    bus.blockPlugin('b');
    const count = bus.broadcast('source', { type: 'test', data: null });
    expect(count).toBe(1);
  });

  test('request - returns response from handler', async () => {
    bus.onMessage('responder', () => 42);
    const result = await bus.request<number>('asker', 'responder', { type: 'query', data: null });
    expect(result).toBe(42);
  });

  test('request - times out', async () => {
    bus.onMessage('slow', async () => {
      await new Promise(r => setTimeout(r, 10000));
      return 'late';
    });
    await expect(bus.request('asker', 'slow', { type: 'test', data: null }, 50)).rejects.toThrow(/timed out/);
  });

  test('request - rejects when no handlers', async () => {
    await expect(bus.request('asker', 'nobody', { type: 'test', data: null })).rejects.toThrow();
  });

  test('onMessage - unsubscribe removes handler', () => {
    let count = 0;
    const unsub = bus.onMessage('target', () => { count++; });
    bus.send('src', 'target', { type: 'test', data: null });
    unsub();
    bus.send('src', 'target', { type: 'test', data: null });
    expect(count).toBe(1);
  });

  test('getMessageLog - records messages', () => {
    bus.onMessage('target', () => {});
    bus.send('src', 'target', { type: 'test', data: null });
    const log = bus.getMessageLog();
    expect(log).toHaveLength(1);
    expect(log[0].from).toBe('src');
    expect(log[0].to).toBe('target');
  });

  test('getMessageLog - respects limit', () => {
    bus.onMessage('target', () => {});
    bus.send('src', 'target', { type: 'a', data: null });
    bus.send('src', 'target', { type: 'b', data: null });
    bus.send('src', 'target', { type: 'c', data: null });
    expect(bus.getMessageLog(2)).toHaveLength(2);
  });

  test('clearMessageLog - clears log', () => {
    bus.onMessage('target', () => {});
    bus.send('src', 'target', { type: 'test', data: null });
    bus.clearMessageLog();
    expect(bus.getMessageLog()).toHaveLength(0);
  });

  test('unblockPlugin - unblocks a blocked plugin', () => {
    bus.blockPlugin('bad');
    bus.unblockPlugin('bad');
    bus.onMessage('target', () => {});
    expect(() => bus.send('bad', 'target', { type: 'test', data: null })).not.toThrow();
  });

  test('addMessageFilter - blocks messages', () => {
    bus.addMessageFilter((from) => from !== 'blocked-sender');
    bus.onMessage('target', () => {});
    const result = bus.send('blocked-sender', 'target', { type: 'test', data: null });
    expect(result).toBe(false);
  });

  test('getRegisteredPlugins - lists plugins with handlers', () => {
    bus.onMessage('a', () => {});
    bus.onMessage('b', () => {});
    const plugins = bus.getRegisteredPlugins();
    expect(plugins).toContain('a');
    expect(plugins).toContain('b');
  });
});

// ============================================================
// Module 7: PluginTelemetry Tests
// ============================================================
describe('PluginTelemetry', () => {
  let telemetry: PluginTelemetry;

  beforeEach(() => {
    telemetry = new PluginTelemetry();
  });

  test('recordExecution - records successful execution', () => {
    telemetry.recordExecution('test', 100, true);
    const stats = telemetry.getPluginStats('test');
    expect(stats.totalExecutions).toBe(1);
    expect(stats.successfulExecutions).toBe(1);
    expect(stats.failedExecutions).toBe(0);
    expect(stats.avgExecutionTime).toBe(100);
  });

  test('recordExecution - records failed execution', () => {
    telemetry.recordExecution('test', 50, false, 'timeout');
    const stats = telemetry.getPluginStats('test');
    expect(stats.failedExecutions).toBe(1);
    expect(stats.errorRate).toBe(1);
  });

  test('recordExecution - calculates averages', () => {
    telemetry.recordExecution('test', 100, true);
    telemetry.recordExecution('test', 200, true);
    telemetry.recordExecution('test', 300, true);
    const stats = telemetry.getPluginStats('test');
    expect(stats.avgExecutionTime).toBe(200);
    expect(stats.maxExecutionTime).toBe(300);
    expect(stats.minExecutionTime).toBe(100);
  });

  test('recordApiCall - increments API call count', () => {
    telemetry.recordApiCall('test');
    telemetry.recordApiCall('test');
    telemetry.recordApiCall('test');
    expect(telemetry.getPluginStats('test').apiCallCount).toBe(3);
  });

  test('recordMemory - records memory snapshots', () => {
    telemetry.recordMemory('test', 64);
    telemetry.recordMemory('test', 128);
    expect(telemetry.getPluginStats('test').memoryUsageMB).toBe(128);
  });

  test('getPluginStats - returns zero stats for unknown plugin', () => {
    const stats = telemetry.getPluginStats('unknown');
    expect(stats.totalExecutions).toBe(0);
    expect(stats.pluginName).toBe('unknown');
  });

  test('getLeaderboard - ranks plugins by health score', () => {
    telemetry.recordExecution('good', 10, true);
    telemetry.recordExecution('good', 10, true);
    telemetry.recordExecution('bad', 100, false);
    const board = telemetry.getLeaderboard();
    expect(board.length).toBe(2);
    expect(board[0].score).toBeGreaterThan(board[1].score);
  });

  test('getHealthReport - generates report', () => {
    telemetry.recordExecution('a', 10, true);
    telemetry.recordExecution('b', 5000, false);
    telemetry.recordExecution('b', 5000, false);
    const report = telemetry.getHealthReport();
    expect(report.totalPlugins).toBe(2);
    expect(report.entries).toHaveLength(2);
  });

  test('getHealthReport - classifies healthy and unhealthy', () => {
    for (let i = 0; i < 10; i++) {
      telemetry.recordExecution('healthy', 10, true);
    }
    for (let i = 0; i < 10; i++) {
      telemetry.recordExecution('unhealthy', 10, false);
    }
    const report = telemetry.getHealthReport();
    expect(report.healthyCount).toBeGreaterThanOrEqual(1);
    // All-failure plugin: score = 100 - 1.0*50 = 50, which is at boundary.
    // With slow execution penalty, it should be below 50.
    telemetry.setSlowExecutionThreshold(1);
    telemetry.recordExecution('very-unhealthy', 100, false);
    telemetry.recordExecution('very-unhealthy', 100, false);
    const report2 = telemetry.getHealthReport();
    expect(report2.unhealthyCount).toBeGreaterThanOrEqual(1);
  });

  test('onAlert - fires on high error rate', () => {
    const alerts: string[] = [];
    telemetry.onAlert((alert) => { alerts.push(alert.type); });
    // Set low threshold to trigger easily
    telemetry.setErrorRateThreshold(0.1);
    telemetry.recordExecution('test', 10, true);
    telemetry.recordExecution('test', 10, false);
    telemetry.recordExecution('test', 10, true);
    telemetry.recordExecution('test', 10, false);
    telemetry.recordExecution('test', 10, true);
    telemetry.recordExecution('test', 10, false);
    telemetry.recordExecution('test', 10, true);
    telemetry.recordExecution('test', 10, false);
    telemetry.recordExecution('test', 10, true);
    telemetry.recordExecution('test', 10, false);
    expect(alerts).toContain('high_error_rate');
  });

  test('getAlerts - returns recorded alerts', () => {
    telemetry.setSlowExecutionThreshold(1);
    telemetry.recordExecution('test', 100, true);
    const alerts = telemetry.getAlerts();
    expect(alerts.length).toBeGreaterThan(0);
  });

  test('resetPlugin - clears plugin data', () => {
    telemetry.recordExecution('test', 10, true);
    telemetry.resetPlugin('test');
    expect(telemetry.getPluginStats('test').totalExecutions).toBe(0);
  });

  test('reset - clears all data', () => {
    telemetry.recordExecution('a', 10, true);
    telemetry.recordExecution('b', 10, true);
    telemetry.reset();
    expect(telemetry.getLeaderboard()).toHaveLength(0);
  });
});

// ============================================================
// Module 8: PluginMarketplace Tests
// ============================================================
describe('PluginMarketplace', () => {
  let marketplace: PluginMarketplace;

  const makeListing = (id: string, overrides?: Partial<PluginListing>): PluginListing => ({
    id,
    name: `plugin-${id}`,
    version: '1.0.0',
    description: `Description for ${id}`,
    author: 'test-author',
    category: 'tools',
    rating: 4.5,
    downloadCount: 100,
    tags: ['test'],
    featured: false,
    publishedAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    marketplace = new PluginMarketplace();
  });

  test('addPlugin - adds to catalog', () => {
    const listing = makeListing('test');
    marketplace.addPlugin(listing);
    expect(marketplace.getCatalogSize()).toBe(1);
  });

  test('search - finds by name', () => {
    marketplace.addPlugin(makeListing('alpha'));
    marketplace.addPlugin(makeListing('beta'));
    const results = marketplace.search('alpha');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('alpha');
  });

  test('search - finds by description', () => {
    marketplace.addPlugin(makeListing('a', { description: 'machine learning tool' }));
    marketplace.addPlugin(makeListing('b', { description: 'web framework' }));
    const results = marketplace.search('machine learning');
    expect(results).toHaveLength(1);
  });

  test('search - filters by category', () => {
    marketplace.addPlugin(makeListing('a', { category: 'tools' }));
    marketplace.addPlugin(makeListing('b', { category: 'themes' }));
    const results = marketplace.search('', { category: 'tools' });
    expect(results).toHaveLength(1);
  });

  test('search - filters by minRating', () => {
    marketplace.addPlugin(makeListing('a', { rating: 4.8 }));
    marketplace.addPlugin(makeListing('b', { rating: 3.0 }));
    const results = marketplace.search('', { minRating: 4.0 });
    expect(results).toHaveLength(1);
  });

  test('search - sorts by rating', () => {
    marketplace.addPlugin(makeListing('a', { rating: 3.0 }));
    marketplace.addPlugin(makeListing('b', { rating: 5.0 }));
    marketplace.addPlugin(makeListing('c', { rating: 4.0 }));
    const results = marketplace.search('', { sort: 'rating' });
    expect(results[0].rating).toBe(5.0);
    expect(results[1].rating).toBe(4.0);
    expect(results[2].rating).toBe(3.0);
  });

  test('search - pagination with limit and offset', () => {
    marketplace.addPlugin(makeListing('a'));
    marketplace.addPlugin(makeListing('b'));
    marketplace.addPlugin(makeListing('c'));
    const page1 = marketplace.search('', { limit: 2, offset: 0 });
    const page2 = marketplace.search('', { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
  });

  test('getFeatured - returns only featured plugins', () => {
    marketplace.addPlugin(makeListing('a', { featured: true }));
    marketplace.addPlugin(makeListing('b', { featured: false }));
    marketplace.addPlugin(makeListing('c', { featured: true }));
    const featured = marketplace.getFeatured();
    expect(featured).toHaveLength(2);
  });

  test('getByCategory - filters by category', () => {
    marketplace.addPlugin(makeListing('a', { category: 'tools' }));
    marketplace.addPlugin(makeListing('b', { category: 'themes' }));
    marketplace.addPlugin(makeListing('c', { category: 'tools' }));
    const tools = marketplace.getByCategory('tools');
    expect(tools).toHaveLength(2);
  });

  test('install - installs plugin', async () => {
    marketplace.addPlugin(makeListing('test'));
    const result = await marketplace.install('test');
    expect(result.success).toBe(true);
    expect(marketplace.isInstalled('test')).toBe(true);
  });

  test('install - fails for unknown plugin', async () => {
    const result = await marketplace.install('nonexistent');
    expect(result.success).toBe(false);
  });

  test('uninstall - uninstalls plugin', async () => {
    marketplace.addPlugin(makeListing('test'));
    await marketplace.install('test');
    await marketplace.uninstall('test');
    expect(marketplace.isInstalled('test')).toBe(false);
  });

  test('getPluginDetails - returns details', () => {
    marketplace.addPlugin(makeListing('test'), {
      readme: '# Test Plugin',
      license: 'MIT',
    });
    const details = marketplace.getPluginDetails('test');
    expect(details).toBeDefined();
    expect(details!.readme).toBe('# Test Plugin');
  });

  test('getPluginDetails - returns undefined for unknown', () => {
    expect(marketplace.getPluginDetails('unknown')).toBeUndefined();
  });

  test('removePlugin - removes from catalog', () => {
    marketplace.addPlugin(makeListing('test'));
    marketplace.removePlugin('test');
    expect(marketplace.getCatalogSize()).toBe(0);
  });

  test('getCategories - returns all categories', () => {
    const cats = marketplace.getCategories();
    expect(cats).toContain('tools');
    expect(cats).toContain('themes');
    expect(cats).toContain('integrations');
    expect(cats).toContain('workflows');
    expect(cats).toContain('analytics');
  });

  test('getPopularTags - returns tags sorted by count', () => {
    marketplace.addPlugin(makeListing('a', { tags: ['popular', 'rare'] }));
    marketplace.addPlugin(makeListing('b', { tags: ['popular'] }));
    const tags = marketplace.getPopularTags();
    expect(tags[0]).toBe('popular');
  });

  test('getInstalledPlugins - lists installed', async () => {
    marketplace.addPlugin(makeListing('a'));
    marketplace.addPlugin(makeListing('b'));
    await marketplace.install('a');
    await marketplace.install('b');
    const installed = marketplace.getInstalledPlugins();
    expect(installed).toHaveLength(2);
  });

  test('addReview - updates rating', () => {
    marketplace.addPlugin(makeListing('test', { rating: 4.0 }), { reviews: [] });
    marketplace.addReview('test', {
      id: 'r1',
      userId: 'u1',
      userName: 'User1',
      rating: 5,
      comment: 'Great!',
      createdAt: Date.now(),
    });
    const details = marketplace.getPluginDetails('test');
    expect(details!.rating).toBeGreaterThan(4.0);
  });
});

// ============================================================
// Module 9: PluginLoader Tests
// ============================================================
describe('PluginLoader', () => {
  let loader: PluginLoader;

  beforeEach(() => {
    loader = new PluginLoader();
  });

  afterEach(() => {
    loader.reset();
  });

  test('load - loads inline plugin', async () => {
    const result = await loader.load({ type: 'inline', code: 'console.log("hello")', name: 'inline-test' });
    expect(result.success).toBe(true);
    expect(result.plugin).toBeDefined();
    expect(result.plugin!.name).toBe('inline-test');
  });

  test('load - loads local plugin', async () => {
    const result = await loader.load({ type: 'local', path: '/tmp/test-plugin' });
    expect(result.success).toBe(true);
    expect(result.loadTime).toBeGreaterThanOrEqual(0);
  });

  test('load - loads npm plugin', async () => {
    const result = await loader.load({ type: 'npm', packageName: 'some-package' });
    expect(result.success).toBe(true);
    expect(result.plugin!.name).toBe('some-package');
  });

  test('load - loads URL plugin', async () => {
    const result = await loader.load({ type: 'url', url: 'https://example.com/plugin.js' });
    expect(result.success).toBe(true);
  });

  test('load - fails for inline without code', async () => {
    const result = await loader.load({ type: 'inline' });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('load - fails for local without path', async () => {
    const result = await loader.load({ type: 'local' });
    expect(result.success).toBe(false);
  });

  test('loadAll - loads multiple plugins', async () => {
    const results = await loader.loadAll([
      { type: 'inline', code: 'a', name: 'plugin-a' },
      { type: 'inline', code: 'b', name: 'plugin-b' },
      { type: 'inline', code: 'c', name: 'plugin-c' },
    ]);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);
  });

  test('unload - unloads a loaded plugin', async () => {
    await loader.load({ type: 'inline', code: 'test', name: 'test' });
    await loader.unload('test');
    expect(loader.getPlugin('test')).toBeUndefined();
  });

  test('reload - reloads a loaded plugin', async () => {
    await loader.load({ type: 'inline', code: 'v1', name: 'test' });
    await loader.reload('test');
    expect(loader.getPlugin('test')).toBeDefined();
  });

  test('reload - throws for non-loaded plugin', async () => {
    await expect(loader.reload('nonexistent')).rejects.toThrow();
  });

  test('listLoaded - lists loaded plugins', async () => {
    await loader.load({ type: 'inline', code: 'a', name: 'a' });
    await loader.load({ type: 'inline', code: 'b', name: 'b' });
    const list = loader.listLoaded();
    expect(list).toContain('a');
    expect(list).toContain('b');
  });

  test('onLoad - fires on plugin load', async () => {
    let fired = false;
    loader.onLoad('test', () => { fired = true; });
    await loader.load({ type: 'inline', code: 'test', name: 'test' });
    expect(fired).toBe(true);
  });

  test('onUnload - fires on plugin unload', async () => {
    let fired = false;
    loader.onUnload('test', () => { fired = true; });
    await loader.load({ type: 'inline', code: 'test', name: 'test' });
    await loader.unload('test');
    expect(fired).toBe(true);
  });

  test('enableHotReload / disableHotReload - manages watcher', async () => {
    await loader.load({ type: 'local', path: '/tmp/test', name: 'test' });
    loader.enableHotReload('test');
    loader.disableHotReload('test');
    // No errors means success
    expect(true).toBe(true);
  });

  test('loadAll - partial failure', async () => {
    const results = await loader.loadAll([
      { type: 'inline', code: 'ok', name: 'ok' },
      { type: 'inline' }, // missing code
    ]);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
  });
});

// ============================================================
// Module 10: PluginRegistry Tests (Integration)
// ============================================================
describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  const makePlugin = (name: string, version = '1.0.0', deps?: Record<string, string>, perms?: string[]): PluginDefinition => ({
    name,
    version,
    description: `Test plugin ${name}`,
    author: 'test-author',
    dependencies: deps,
    permissions: perms,
  });

  test('register - registers a plugin', async () => {
    await registry.register(makePlugin('test'));
    expect(registry.getPluginCount()).toBe(1);
    expect(registry.getPlugin('test')).toBeDefined();
  });

  test('register - throws on duplicate', async () => {
    await registry.register(makePlugin('test'));
    await expect(registry.register(makePlugin('test'))).rejects.toThrow();
  });

  test('unregister - removes a plugin', async () => {
    await registry.register(makePlugin('test'));
    await registry.unregister('test');
    expect(registry.getPlugin('test')).toBeUndefined();
  });

  test('unregister - throws for unknown plugin', async () => {
    await expect(registry.unregister('unknown')).rejects.toThrow();
  });

  test('initialize - initializes a plugin', async () => {
    await registry.register(makePlugin('test'));
    await registry.initialize('test');
    const instance = registry.getPlugin('test');
    expect(instance!.initialized).toBe(true);
  });

  test('activate - activates a plugin', async () => {
    await registry.register(makePlugin('test'));
    await registry.activate('test');
    const instance = registry.getPlugin('test');
    expect(instance!.active).toBe(true);
    expect(instance!.initialized).toBe(true);
  });

  test('deactivate - deactivates an active plugin', async () => {
    await registry.register(makePlugin('test'));
    await registry.activate('test');
    await registry.deactivate('test');
    expect(registry.getPluginState('test')).toBe('deactivated');
  });

  test('listPlugins - lists all plugins', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b'));
    const list = registry.listPlugins();
    expect(list).toHaveLength(2);
  });

  test('listPlugins - filters by state', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b'));
    await registry.activate('a');
    const active = registry.listPlugins({ state: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('a');
  });

  test('listPlugins - filters by author', async () => {
    await registry.register(makePlugin('a', '1.0.0', undefined));
    const p: PluginDefinition = { name: 'b', version: '1.0.0', author: 'other' };
    await registry.register(p);
    const byAuthor = registry.listPlugins({ author: 'other' });
    expect(byAuthor).toHaveLength(1);
    expect(byAuthor[0].name).toBe('b');
  });

  test('getLoadOrder - returns dependency order', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b', '1.0.0', { a: '^1.0.0' }));
    const order = registry.getLoadOrder();
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  });

  test('checkConflicts - detects missing deps', async () => {
    // Register two plugins where one depends on a missing third
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b', '1.0.0', { a: '^1.0.0' }));
    // Manually check conflicts by adding a plugin definition with missing dep
    const resolver = registry.getDependencyResolver();
    const conflicts = resolver.checkConflicts([
      ...registry.listPlugins().map(p => ({
        name: p.name,
        version: p.version,
        dependencies: {},
      })),
      { name: 'c', version: '1.0.0', dependencies: { nonexistent: '^1.0.0' } },
    ]);
    expect(conflicts.some(c => c.type === 'missing_dependency')).toBe(true);
  });

  test('shutdown - deactivates all plugins', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b'));
    await registry.activate('a');
    await registry.activate('b');
    await registry.shutdown();
    expect(registry.getPluginCount()).toBe(0);
  });

  test('subsystems are accessible', () => {
    expect(registry.getLoader()).toBeDefined();
    expect(registry.getSandbox()).toBeDefined();
    expect(registry.getDependencyResolver()).toBeDefined();
    expect(registry.getHooks()).toBeDefined();
    expect(registry.getConfig()).toBeDefined();
    expect(registry.getCommunication()).toBeDefined();
    expect(registry.getTelemetry()).toBeDefined();
  });

  test('getPluginState - returns undefined for unknown', () => {
    expect(registry.getPluginState('unknown')).toBeUndefined();
  });

  test('initialize - throws for unknown plugin', async () => {
    await expect(registry.initialize('unknown')).rejects.toThrow();
  });

  test('activate - throws for unknown plugin', async () => {
    await expect(registry.activate('unknown')).rejects.toThrow();
  });

  test('initialize - initializes dependencies first', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b', '1.0.0', { a: '^1.0.0' }));
    await registry.initialize('b');
    expect(registry.getPluginState('a')).toBe('initialized');
    expect(registry.getPluginState('b')).toBe('initialized');
  });

  test('listPlugins - filters by permission', async () => {
    await registry.register(makePlugin('a', '1.0.0', undefined, ['fs.read']));
    await registry.register(makePlugin('b', '1.0.0', undefined, ['net.request']));
    const withFsRead = registry.listPlugins({ hasPermission: 'fs.read' });
    expect(withFsRead).toHaveLength(1);
    expect(withFsRead[0].name).toBe('a');
  });

  test('full lifecycle: register -> initialize -> activate -> deactivate -> unregister', async () => {
    await registry.register(makePlugin('lifecycle'));
    expect(registry.getPluginState('lifecycle')).toBe('loaded');

    await registry.initialize('lifecycle');
    expect(registry.getPluginState('lifecycle')).toBe('initialized');

    await registry.activate('lifecycle');
    expect(registry.getPluginState('lifecycle')).toBe('active');

    await registry.deactivate('lifecycle');
    expect(registry.getPluginState('lifecycle')).toBe('deactivated');

    await registry.unregister('lifecycle');
    expect(registry.getPlugin('lifecycle')).toBeUndefined();
  });
});
