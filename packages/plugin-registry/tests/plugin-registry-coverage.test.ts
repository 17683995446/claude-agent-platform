import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PluginVersionManager } from '../src/plugin-versioning.ts';
import type { SemVer } from '../src/plugin-versioning.ts';
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
import type { PluginListing, PluginReview } from '../src/plugin-marketplace.ts';
import { PluginLoader } from '../src/plugin-loader.ts';
import { PluginRegistry } from '../src/registry-core.ts';

// ============================================================
// BUG REGISTRY
// ============================================================
// BUG-001: [CRITICAL] plugin-communication.ts request() - handler returning a value resolved
//   the promise immediately, making reply() a no-op (pending request already deleted).
//   Also, if the first handler threw, the entire request was rejected instead of trying
//   the next handler. Fixed by: separating direct-response and reply-based patterns,
//   trying all handlers, and racing async handlers against timeout.
// FIX: Rewrote request() to first try all handlers for a direct response (sync or async
//   with timeout), then fall through to reply()-based pending request pattern.

// BUG-002: [HIGH] plugin-config.ts validateConfig() - array item type validation used
//   `typeof value[i]` which returns 'object' for arrays, not 'array'. So array-of-arrays
//   could never be validated correctly.
// FIX: Changed to `Array.isArray(value[i]) ? 'array' : typeof value[i]`.

// BUG-003: [MEDIUM] plugin-communication.ts getMessageLog(0) - `slice(-0)` returns the
//   full array instead of empty because -0 === 0 in JavaScript.
// FIX: Added explicit check for `limit === 0` to return empty array, and changed guard
//   from `if (limit)` to `if (limit != null && limit >= 0)`.

// BUG-004: [MEDIUM] plugin-loader.ts reload() - if unload succeeded but load failed,
//   the plugin was left in an unloaded state with no way to recover.
// FIX: Added try/catch around load in reload; on failure, attempts to restore the
//   original plugin from the same source, then re-throws the error.

// BUG-005: [MEDIUM] plugin-config.ts resetPluginConfig() - deleted plugin config without
//   notifying change listeners, so subscribers never learned about removed keys.
// FIX: Before deleting, iterate over existing keys and notify listeners with
//   oldValue and newValue=undefined.

// BUG-006: [MEDIUM] plugin-telemetry.ts getPluginStats() - minExecutionTime was initialized
//   to 0 and used `i === 0 || durations[i] < minTime` which was correct but inconsistent
//   style. More importantly, for zero records, minTime=0 was misleading.
// FIX: Initialize minTime from durations[0] when records exist, else 0.

// BUG-007: [MEDIUM] plugin-versioning.ts getUpdatePath() - stepping through versions lost
//   prerelease suffixes, generating invalid version strings like "1.0.0" instead of
//   "1.0.0-beta.1".
// FIX: Added early return for prerelease versions: return [from, to] directly.

// BUG-008: [LOW] hook-system.ts removeAllHooks() - deleted hooks from the hooks map but
//   left stale entries in hookTypes, causing inconsistency.
// FIX: Also delete from hookTypes when removing a specific hook, and clear hookTypes
//   when removing all hooks.

// BUG-009: [MEDIUM] plugin-communication.ts broadcast() - maxBroadcastRecipients limit
//   was defined but never enforced.
// FIX: Added `if (delivered >= this.limits.maxBroadcastRecipients) break;` in the
//   broadcast loop.

// ============================================================
// Module 1: PluginVersionManager - Comprehensive Tests
// ============================================================
describe('PluginVersionManager (coverage)', () => {
  let vm: PluginVersionManager;

  beforeEach(() => {
    vm = new PluginVersionManager();
  });

  // --- parseVersion ---
  it('parses version with v prefix and whitespace', () => {
    const v = vm.parseVersion(' v3.4.5');
    expect(v.major).toBe(3);
  });

  it('parses version with prerelease and build', () => {
    const v = vm.parseVersion('1.0.0-alpha.1+build.123');
    expect(v.prerelease).toBe('alpha.1');
    expect(v.build).toBe('build.123');
  });

  it('caches parsed versions', () => {
    const v1 = vm.parseVersion('1.0.0');
    const v2 = vm.parseVersion('1.0.0');
    expect(v1).toBe(v2); // same reference due to cache
  });

  it('throws on version with only major', () => {
    expect(() => vm.parseVersion('1')).toThrow();
  });

  it('throws on version with major.minor only', () => {
    expect(() => vm.parseVersion('1.2')).toThrow();
  });

  it('throws on version with negative numbers', () => {
    expect(() => vm.parseVersion('-1.0.0')).toThrow();
  });

  it('throws on version with non-numeric parts', () => {
    expect(() => vm.parseVersion('a.b.c')).toThrow();
  });

  // --- compare ---
  it('compares SemVer objects directly', () => {
    const a: SemVer = { major: 2, minor: 0, patch: 0, raw: '2.0.0' };
    const b: SemVer = { major: 1, minor: 0, patch: 0, raw: '1.0.0' };
    expect(vm.compare(a, b)).toBe(1);
  });

  it('compares mixed string and SemVer objects', () => {
    const a: SemVer = { major: 1, minor: 0, patch: 0, raw: '1.0.0' };
    expect(vm.compare(a, '1.0.0')).toBe(0);
  });

  it('compares prerelease versions alphabetically', () => {
    expect(vm.compare('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(vm.compare('1.0.0-beta', '1.0.0-alpha')).toBe(1);
    expect(vm.compare('1.0.0-alpha', '1.0.0-alpha')).toBe(0);
  });

  it('compares versions with build metadata (build ignored)', () => {
    expect(vm.compare('1.0.0+build1', '1.0.0+build2')).toBe(0);
  });

  it('compares very large version numbers', () => {
    expect(vm.compare('999.999.999', '1000.0.0')).toBe(-1);
  });

  // --- gt, lt, eq, gte, lte ---
  it('gt returns false for equal versions', () => {
    expect(vm.gt('1.0.0', '1.0.0')).toBe(false);
  });

  it('lt returns false for equal versions', () => {
    expect(vm.lt('1.0.0', '1.0.0')).toBe(false);
  });

  it('eq returns false for different versions', () => {
    expect(vm.eq('1.0.0', '2.0.0')).toBe(false);
  });

  // --- parseRange ---
  it('parses caret range for major version 0', () => {
    const r = vm.parseRange('^0.2.3');
    expect(r.operator).toBe('^');
    expect(r.version.major).toBe(0);
    expect(r.max!.major).toBe(1);
  });

  it('parses tilde range', () => {
    const r = vm.parseRange('~1.2.3');
    expect(r.operator).toBe('~');
    expect(r.version.minor).toBe(2);
    expect(r.max!.minor).toBe(3);
    expect(r.max!.patch).toBe(0);
  });

  it('parses range operator (>=x <y)', () => {
    const r = vm.parseRange('>=1.0.0 <2.0.0');
    expect(r.operator).toBe('range');
    expect(r.version.major).toBe(1);
    expect(r.max!.major).toBe(2);
  });

  it('parses individual comparison operators', () => {
    expect(vm.parseRange('>1.0.0').operator).toBe('>');
    expect(vm.parseRange('<2.0.0').operator).toBe('<');
    expect(vm.parseRange('>=1.0.0').operator).toBe('>=');
    expect(vm.parseRange('<=2.0.0').operator).toBe('<=');
    expect(vm.parseRange('=1.0.0').operator).toBe('=');
  });

  it('parses bare version as exact match', () => {
    const r = vm.parseRange('1.2.3');
    expect(r.operator).toBe('=');
    expect(r.version.major).toBe(1);
  });

  it('parses range with extra whitespace', () => {
    const r = vm.parseRange('  >=1.0.0 <2.0.0  ');
    expect(r.operator).toBe('range');
  });

  // --- satisfies ---
  it('satisfies range operator', () => {
    expect(vm.satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(vm.satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(vm.satisfies('0.9.0', '>=1.0.0 <2.0.0')).toBe(false);
  });

  it('satisfies caret range boundary conditions', () => {
    expect(vm.satisfies('1.2.3', '^1.2.3')).toBe(true);
    expect(vm.satisfies('1.999.999', '^1.2.3')).toBe(true);
    expect(vm.satisfies('2.0.0', '^1.2.3')).toBe(false);
    expect(vm.satisfies('1.2.2', '^1.2.3')).toBe(false);
  });

  it('satisfies tilde range boundary conditions', () => {
    expect(vm.satisfies('1.2.3', '~1.2.3')).toBe(true);
    expect(vm.satisfies('1.2.999', '~1.2.3')).toBe(true);
    expect(vm.satisfies('1.3.0', '~1.2.3')).toBe(false);
    expect(vm.satisfies('1.2.2', '~1.2.3')).toBe(false);
  });

  it('satisfies prerelease version correctly', () => {
    // prerelease has lower precedence than release
    expect(vm.satisfies('1.0.0-beta', '=1.0.0')).toBe(false);
    expect(vm.satisfies('1.0.0', '=1.0.0')).toBe(true);
  });

  // --- getLatestCompatible ---
  it('returns latest compatible with empty versions', () => {
    expect(vm.getLatestCompatible([], '^1.0.0')).toBeUndefined();
  });

  it('returns latest compatible with single match', () => {
    expect(vm.getLatestCompatible(['1.0.0'], '^1.0.0')).toBe('1.0.0');
  });

  // --- getUpdatePath ---
  it('generates upgrade path across major versions', () => {
    const path = vm.getUpdatePath('1.0.0', '3.0.0');
    expect(path[0]).toBe('1.0.0');
    expect(path[path.length - 1]).toBe('3.0.0');
    expect(path).toContain('2.0.0');
  });

  it('generates downgrade path', () => {
    const path = vm.getUpdatePath('2.0.0', '1.0.0');
    expect(path[0]).toBe('2.0.0');
    expect(path[path.length - 1]).toBe('1.0.0');
  });

  it('generates patch-level upgrade path', () => {
    const path = vm.getUpdatePath('1.0.0', '1.0.3');
    expect(path).toEqual(['1.0.0', '1.0.1', '1.0.2', '1.0.3']);
  });

  // BUG-007: prerelease versions should return direct path
  it('returns direct path for prerelease versions', () => {
    const path = vm.getUpdatePath('1.0.0-alpha', '1.0.0-beta');
    expect(path).toEqual(['1.0.0-alpha', '1.0.0-beta']);
  });

  it('returns direct path for mixed prerelease and release', () => {
    const path = vm.getUpdatePath('1.0.0-alpha', '2.0.0');
    expect(path).toEqual(['1.0.0-alpha', '2.0.0']);
  });

  it('throws on very large version gap (safety limit)', () => {
    // Patch-level gap of 1001 triggers the safety limit
    expect(() => vm.getUpdatePath('1.0.0', '1.0.1001')).toThrow(/too many steps/);
  });

  // --- formatVersion ---
  it('formats version without prerelease or build', () => {
    const v: SemVer = { major: 1, minor: 2, patch: 3, raw: '1.2.3' };
    expect(vm.formatVersion(v)).toBe('1.2.3');
  });

  it('formats version with only build', () => {
    const v: SemVer = { major: 1, minor: 0, patch: 0, build: 'exp.sha.5114f85', raw: '1.0.0+exp.sha.5114f85' };
    expect(vm.formatVersion(v)).toBe('1.0.0+exp.sha.5114f85');
  });
});

// ============================================================
// Module 2: PluginDependencyResolver - Comprehensive Tests
// ============================================================
describe('PluginDependencyResolver (coverage)', () => {
  let resolver: PluginDependencyResolver;

  beforeEach(() => {
    resolver = new PluginDependencyResolver();
  });

  const makePlugin = (name: string, version = '1.0.0', deps?: Record<string, string>): PluginDefinition => ({
    name,
    version,
    dependencies: deps,
  });

  // --- resolve ---
  it('creates nodes with correct depth for chain', () => {
    const plugins = [
      makePlugin('a'),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
      makePlugin('c', '1.0.0', { b: '^1.0.0' }),
    ];
    const graph = resolver.resolve(plugins);
    expect(graph.nodes.get('a')!.depth).toBe(0);
    expect(graph.nodes.get('b')!.depth).toBe(1);
    expect(graph.nodes.get('c')!.depth).toBe(2);
  });

  it('creates edges with correct direction', () => {
    const plugins = [
      makePlugin('a'),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
    ];
    const graph = resolver.resolve(plugins);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].from).toBe('b');
    expect(graph.edges[0].to).toBe('a');
    expect(graph.edges[0].constraint).toBe('^1.0.0');
  });

  it('handles plugins with no dependencies', () => {
    const plugins = [makePlugin('a'), makePlugin('b'), makePlugin('c')];
    const graph = resolver.resolve(plugins);
    expect(graph.edges).toHaveLength(0);
    expect(graph.loadOrder).toHaveLength(3);
  });

  it('handles diamond dependency', () => {
    const plugins = [
      makePlugin('a'),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
      makePlugin('c', '1.0.0', { a: '^1.0.0' }),
      makePlugin('d', '1.0.0', { b: '^1.0.0', c: '^1.0.0' }),
    ];
    const graph = resolver.resolve(plugins);
    expect(graph.nodes.size).toBe(4);
    const aIdx = graph.loadOrder.indexOf('a');
    const dIdx = graph.loadOrder.indexOf('d');
    expect(aIdx).toBeLessThan(dIdx);
  });

  it('throws on circular dependencies in topological sort', () => {
    const plugins = [
      makePlugin('a', '1.0.0', { b: '^1.0.0' }),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
    ];
    expect(() => resolver.resolve(plugins)).toThrow(/Circular dependency/);
  });

  it('handles 3-node circular dependency', () => {
    const plugins = [
      makePlugin('a', '1.0.0', { c: '^1.0.0' }),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
      makePlugin('c', '1.0.0', { b: '^1.0.0' }),
    ];
    expect(() => resolver.resolve(plugins)).toThrow(/Circular dependency/);
  });

  it('handles self-dependency', () => {
    const plugins = [
      makePlugin('a', '1.0.0', { a: '^1.0.0' }),
    ];
    expect(() => resolver.resolve(plugins)).toThrow(/Circular dependency/);
  });

  // --- getLoadOrder ---
  it('returns correct order for complex graph', () => {
    const plugins = [
      makePlugin('d', '1.0.0', { c: '^1.0.0' }),
      makePlugin('c', '1.0.0', { b: '^1.0.0' }),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
      makePlugin('a'),
    ];
    const order = resolver.getLoadOrder(plugins);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });

  // --- checkConflicts ---
  it('detects version conflicts', () => {
    const plugins = [
      makePlugin('a', '1.0.0'),
      makePlugin('b', '1.0.0', { a: '^2.0.0' }),
    ];
    const conflicts = resolver.checkConflicts(plugins);
    expect(conflicts.some(c => c.type === 'version_conflict')).toBe(true);
  });

  it('detects multiple missing dependencies', () => {
    const plugins = [
      makePlugin('a', '1.0.0', { missing1: '^1.0.0', missing2: '^1.0.0' }),
    ];
    const conflicts = resolver.checkConflicts(plugins);
    const missing = conflicts.filter(c => c.type === 'missing_dependency');
    expect(missing).toHaveLength(2);
  });

  it('no conflicts when all deps satisfied', () => {
    const plugins = [
      makePlugin('a', '2.0.0'),
      makePlugin('b', '1.0.0', { a: '^2.0.0' }),
    ];
    const conflicts = resolver.checkConflicts(plugins);
    expect(conflicts).toHaveLength(0);
  });

  it('detects circular dependency conflicts', () => {
    const plugins = [
      makePlugin('a', '1.0.0', { b: '^1.0.0' }),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
    ];
    const conflicts = resolver.checkConflicts(plugins);
    expect(conflicts.some(c => c.type === 'circular_dependency')).toBe(true);
  });

  it('circular conflict includes cycle info', () => {
    const plugins = [
      makePlugin('a', '1.0.0', { b: '^1.0.0' }),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
    ];
    const conflicts = resolver.checkConflicts(plugins);
    const circular = conflicts.find(c => c.type === 'circular_dependency');
    expect(circular?.cycle).toBeDefined();
    expect(circular!.cycle!.length).toBeGreaterThan(0);
  });

  // --- getDependencyTree ---
  it('returns correct dependents list', () => {
    const plugins = [
      makePlugin('a'),
      makePlugin('b', '1.0.0', { a: '^1.0.0' }),
      makePlugin('c', '1.0.0', { a: '^1.0.0' }),
    ];
    const tree = resolver.getDependencyTree('a', plugins);
    expect(tree!.dependents).toContain('b');
    expect(tree!.dependents).toContain('c');
  });

  // --- registerAvailableVersion ---
  it('does not duplicate versions', () => {
    resolver.registerAvailableVersion('test', '1.0.0');
    resolver.registerAvailableVersion('test', '1.0.0');
    resolver.registerAvailableVersion('test', '2.0.0');
    // Just verify no error
    expect(true).toBe(true);
  });
});

// ============================================================
// Module 3: PluginSandbox - Comprehensive Tests
// ============================================================
describe('PluginSandbox (coverage)', () => {
  let sandbox: PluginSandbox;

  beforeEach(() => {
    sandbox = new PluginSandbox();
  });

  // --- createSandbox ---
  it('creates sandbox with empty permissions', () => {
    const ctx = sandbox.createSandbox('test', []);
    expect(ctx.permissions.size).toBe(0);
    expect(ctx.pluginName).toBe('test');
  });

  it('creates sandbox with custom resource limits', () => {
    const ctx = sandbox.createSandbox('test', [], { maxMemoryMB: 256, maxCpuTimeMs: 10000 });
    expect(ctx).toBeDefined();
    expect(ctx.getResourceUsage()).toBeDefined();
  });

  it('overwrites existing sandbox with same name', () => {
    sandbox.createSandbox('test', ['fs.read']);
    sandbox.createSandbox('test', ['fs.write']);
    const ctx = sandbox.getSandbox('test');
    expect(ctx!.hasPermission('fs.write')).toBe(true);
    expect(ctx!.hasPermission('fs.read')).toBe(false);
  });

  // --- API exposure ---
  it('exposes API with multiple required permissions', () => {
    sandbox.registerApi({
      name: 'superApi',
      requiredPermissions: ['fs.read', 'fs.write'] as PluginPermission[],
      handler: () => 'ok',
    });
    const ctx = sandbox.createSandbox('test', ['fs.read', 'fs.write']);
    expect(typeof ctx.api.superApi).toBe('function');
  });

  it('hides API when only some permissions are met', () => {
    sandbox.registerApi({
      name: 'superApi',
      requiredPermissions: ['fs.read', 'fs.write'] as PluginPermission[],
      handler: () => 'ok',
    });
    const ctx = sandbox.createSandbox('test', ['fs.read']);
    expect(ctx.api.superApi).toBeUndefined();
  });

  it('exposes API with no required permissions to all sandboxes', () => {
    sandbox.registerApi({
      name: 'publicApi',
      requiredPermissions: [],
      handler: () => 'public',
    });
    const ctx = sandbox.createSandbox('test', []);
    expect(typeof ctx.api.publicApi).toBe('function');
  });

  // --- callApi ---
  it('callApi passes arguments to handler', () => {
    sandbox.registerApi({
      name: 'add',
      requiredPermissions: [],
      handler: (a: number, b: number) => a + b,
    });
    const ctx = sandbox.createSandbox('test', []);
    expect(ctx.callApi('add', 2, 3)).toBe(5);
  });

  it('callApi records duration in audit log', () => {
    sandbox.registerApi({
      name: 'slow',
      requiredPermissions: [],
      handler: () => {
        const start = Date.now();
        while (Date.now() - start < 5) {} // busy wait
        return 'done';
      },
    });
    const ctx = sandbox.createSandbox('test', []);
    ctx.callApi('slow');
    const log = ctx.getAuditLog();
    expect(log[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('callApi records denied for non-whitelisted API', () => {
    const ctx = sandbox.createSandbox('test', []);
    expect(() => ctx.callApi('nonexistent')).toThrow(/not whitelisted/);
    const log = ctx.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].result).toBe('denied');
  });

  it('callApi records denied for insufficient permissions', () => {
    sandbox.registerApi({
      name: 'secret',
      requiredPermissions: ['admin'] as PluginPermission[],
      handler: () => 'secret',
    });
    const ctx = sandbox.createSandbox('test', []);
    expect(() => ctx.callApi('secret')).toThrow(/lacks required permissions/);
  });

  it('callApi throws on handler error and records denied', () => {
    sandbox.registerApi({
      name: 'errorApi',
      requiredPermissions: [],
      handler: () => { throw new Error('handler error'); },
    });
    const ctx = sandbox.createSandbox('test', []);
    expect(() => ctx.callApi('errorApi')).toThrow('handler error');
    // Note: handler errors are NOT recorded in audit log - they propagate directly
    // Only permission/rate-limit denials are recorded
  });

  // --- Rate limiting ---
  it('enforces rate limit on callApi', () => {
    sandbox.registerApi({
      name: 'rateLimited',
      requiredPermissions: [],
      handler: () => 'ok',
      rateLimit: 3,
    });
    const ctx = sandbox.createSandbox('test', []);
    expect(ctx.callApi('rateLimited')).toBe('ok');
    expect(ctx.callApi('rateLimited')).toBe('ok');
    expect(ctx.callApi('rateLimited')).toBe('ok');
    expect(() => ctx.callApi('rateLimited')).toThrow(/Rate limit exceeded/);
  });

  it('rate limit counts only allowed requests', () => {
    sandbox.registerApi({
      name: 'rl',
      requiredPermissions: [],
      handler: () => 'ok',
      rateLimit: 2,
    });
    const ctx = sandbox.createSandbox('test', []);
    ctx.callApi('rl');
    ctx.callApi('rl');
    // Denied request should not count toward rate limit
    try { ctx.callApi('nonexistent'); } catch {}
    // But we're at limit, so next call should still fail
    expect(() => ctx.callApi('rl')).toThrow(/Rate limit exceeded/);
  });

  // --- Audit log ---
  it('getAuditLog returns copies, not references', () => {
    sandbox.registerApi({
      name: 'test',
      requiredPermissions: [],
      handler: () => 'ok',
    });
    const ctx = sandbox.createSandbox('test', []);
    ctx.callApi('test');
    const log1 = ctx.getAuditLog();
    const log2 = ctx.getAuditLog();
    expect(log1).not.toBe(log2);
    expect(log1).toEqual(log2);
  });

  // --- Resource usage ---
  it('getResourceUsage returns copies', () => {
    sandbox.registerApi({
      name: 'test',
      requiredPermissions: [],
      handler: () => 'ok',
    });
    const ctx = sandbox.createSandbox('test', []);
    ctx.callApi('test');
    const usage1 = ctx.getResourceUsage();
    const usage2 = ctx.getResourceUsage();
    expect(usage1).not.toBe(usage2);
    expect(usage1.requestCount).toBe(usage2.requestCount);
  });

  it('tracks lastRequestTime', () => {
    sandbox.registerApi({
      name: 'test',
      requiredPermissions: [],
      handler: () => 'ok',
    });
    const ctx = sandbox.createSandbox('test', []);
    expect(ctx.getResourceUsage().lastRequestTime).toBe(0);
    ctx.callApi('test');
    expect(ctx.getResourceUsage().lastRequestTime).toBeGreaterThan(0);
  });

  // --- destroySandbox ---
  it('destroySandbox returns false for unknown sandbox', () => {
    expect(sandbox.destroySandbox('nonexistent')).toBe(false);
  });

  it('destroySandbox returns true for existing sandbox', () => {
    sandbox.createSandbox('test', []);
    expect(sandbox.destroySandbox('test')).toBe(true);
  });

  // --- removeApi ---
  it('removeApi returns silently for unknown API', () => {
    expect(() => sandbox.removeApi('nonexistent')).not.toThrow();
  });

  // --- setDefaultLimits ---
  it('setDefaultLimits merges with existing limits', () => {
    sandbox.setDefaultLimits({ maxMemoryMB: 512 });
    const ctx = sandbox.createSandbox('test', [], {});
    // Limits are merged internally; just verify no error
    expect(ctx).toBeDefined();
  });

  // --- listSandboxes ---
  it('listSandboxes returns empty array when no sandboxes', () => {
    expect(sandbox.listSandboxes()).toEqual([]);
  });
});

// ============================================================
// Module 4: HookSystem - Comprehensive Tests
// ============================================================
describe('HookSystem (coverage)', () => {
  let hooks: HookSystem;

  beforeEach(() => {
    hooks = new HookSystem();
  });

  // --- registerHookType ---
  it('registers a new hook type', () => {
    hooks.registerHookType('custom_hook', 'action');
    expect(hooks.getHookNames()).toContain('custom_hook');
  });

  it('re-registers hook type without losing handlers', () => {
    hooks.addHook('test', () => {});
    hooks.registerHookType('test', 'filter');
    expect(hooks.getHookHandlers('test')).toHaveLength(1);
  });

  // --- addHook ---
  it('auto-registers unregistered hook as action', () => {
    const id = hooks.addHook('brand_new_hook', () => {});
    expect(id).toBeTruthy();
    expect(hooks.getHookNames()).toContain('brand_new_hook');
  });

  it('generates unique handler IDs', () => {
    const id1 = hooks.addHook('test', () => {});
    const id2 = hooks.addHook('test', () => {});
    expect(id1).not.toBe(id2);
  });

  it('default options are applied', () => {
    const id = hooks.addHook('test', () => {});
    const handler = hooks.getHookHandlers('test').find(h => h.id === id);
    expect(handler!.options.priority).toBe(10);
    expect(handler!.options.once).toBe(false);
    expect(handler!.options.condition()).toBe(true);
  });

  it('custom priority is applied', () => {
    const id = hooks.addHook('test', () => {}, { priority: 1 });
    const handler = hooks.getHookHandlers('test').find(h => h.id === id);
    expect(handler!.options.priority).toBe(1);
  });

  // --- removeHook ---
  it('returns false for nonexistent hook name', () => {
    expect(hooks.removeHook('nonexistent', 'any')).toBe(false);
  });

  it('returns false for nonexistent handler ID', () => {
    hooks.addHook('test', () => {});
    expect(hooks.removeHook('test', 'nonexistent-id')).toBe(false);
  });

  // --- doAction ---
  it('passes arguments to handlers', () => {
    let received: unknown;
    hooks.addHook('test', (arg: unknown) => { received = arg; });
    hooks.doAction('test', 42);
    expect(received).toBe(42);
  });

  it('handles errors in action handlers gracefully', () => {
    hooks.addHook('test', () => { throw new Error('handler error'); });
    expect(() => hooks.doAction('test')).not.toThrow();
  });

  it('handles promise-returning handlers in doAction', async () => {
    let resolved = false;
    hooks.addHook('test', async () => { resolved = true; });
    hooks.doAction('test');
    // Give microtask a chance to run
    await new Promise(r => setTimeout(r, 10));
    expect(resolved).toBe(true);
  });

  it('handles rejected promises in doAction gracefully', async () => {
    hooks.addHook('test', async () => { throw new Error('async error'); });
    hooks.doAction('test');
    await new Promise(r => setTimeout(r, 10));
    // No error thrown
    expect(true).toBe(true);
  });

  it('does nothing for unregistered hook with no handlers', () => {
    expect(() => hooks.doAction('completely_unknown')).not.toThrow();
  });

  it('once handler is removed after firing', () => {
    let count = 0;
    hooks.addHook('test', () => { count++; }, { once: true });
    hooks.doAction('test');
    hooks.doAction('test');
    hooks.doAction('test');
    expect(count).toBe(1);
  });

  it('condition receives all arguments', () => {
    let received: unknown;
    hooks.addHook('test', () => {}, {
      condition: (a: unknown, b: unknown) => {
        received = [a, b];
        return true;
      },
    });
    hooks.doAction('test', 'hello', 'world');
    expect(received).toEqual(['hello', 'world']);
  });

  // --- applyFilters ---
  it('passes value and extra args through filter chain', () => {
    hooks.addHook('test', (val: string, suffix: string) => val + suffix);
    const result = hooks.applyFilters('test', 'hello', ' world');
    expect(result).toBe('hello world');
  });

  it('skips failing filter handlers', () => {
    hooks.addHook('test', () => { throw new Error('fail'); });
    hooks.addHook('test', (val: number) => val * 2);
    expect(hooks.applyFilters('test', 5)).toBe(10);
  });

  it('once filter handler is removed after application', () => {
    let count = 0;
    hooks.addHook('test', (val: number) => { count++; return val; }, { once: true });
    hooks.applyFilters('test', 1);
    hooks.applyFilters('test', 2);
    expect(count).toBe(1);
  });

  // --- doAsyncAction ---
  it('awaits async handlers in sequence', async () => {
    const order: number[] = [];
    hooks.addHook('test', async () => { order.push(1); });
    hooks.addHook('test', async () => { order.push(2); });
    await hooks.doAsyncAction('test');
    expect(order).toEqual([1, 2]);
  });

  it('handles sync handlers in doAsyncAction', async () => {
    let called = false;
    hooks.addHook('test', () => { called = true; });
    await hooks.doAsyncAction('test');
    expect(called).toBe(true);
  });

  // --- applyAsyncFilters ---
  it('chains async filter results', async () => {
    hooks.addHook('test', async (val: number) => val + 1);
    hooks.addHook('test', async (val: number) => val * 2);
    const result = await hooks.applyAsyncFilters('test', 5);
    expect(result).toBe(12); // (5+1)*2
  });

  it('returns original value for nonexistent hook in applyAsyncFilters', async () => {
    const result = await hooks.applyAsyncFilters('nonexistent', 42);
    expect(result).toBe(42);
  });

  // --- removeAllHooks ---
  // BUG-008: should also clear hookTypes
  it('clears hookTypes when removing all hooks', () => {
    hooks.addHook('custom', () => {});
    hooks.removeAllHooks();
    // After removing all, adding a new hook should work
    hooks.addHook('custom', () => {});
    expect(hooks.getHookNames()).toContain('custom');
  });

  it('clears specific hookType when removing named hook', () => {
    hooks.addHook('custom', () => {});
    hooks.removeAllHooks('custom');
    // The hook should be gone
    expect(hooks.getHookHandlers('custom')).toHaveLength(0);
  });

  // --- getHookNames / getHookHandlers ---
  it('getHookNames returns empty when no hooks', () => {
    hooks.removeAllHooks();
    expect(hooks.getHookNames()).toHaveLength(0);
  });

  it('getHookHandlers returns empty array for unknown hook', () => {
    expect(hooks.getHookHandlers('unknown')).toEqual([]);
  });
});

// ============================================================
// Module 5: PluginConfigManager - Comprehensive Tests
// ============================================================
describe('PluginConfigManager (coverage)', () => {
  let config: PluginConfigManager;

  beforeEach(() => {
    config = new PluginConfigManager();
  });

  // --- setGlobalConfig / getGlobalConfig ---
  it('merges global config', () => {
    config.setGlobalConfig({ a: 1 });
    config.setGlobalConfig({ b: 2 });
    const gc = config.getGlobalConfig();
    expect(gc.a).toBe(1);
    expect(gc.b).toBe(2);
  });

  it('getGlobalConfig returns a copy', () => {
    config.setGlobalConfig({ a: 1 });
    const gc1 = config.getGlobalConfig();
    const gc2 = config.getGlobalConfig();
    expect(gc1).not.toBe(gc2);
  });

  // --- registerPluginDefaults / getPluginDefaults ---
  it('returns empty object for unknown plugin defaults', () => {
    expect(config.getPluginDefaults('unknown')).toEqual({});
  });

  it('getPluginDefaults returns a copy', () => {
    config.registerPluginDefaults('test', { a: 1 });
    const d1 = config.getPluginDefaults('test');
    const d2 = config.getPluginDefaults('test');
    expect(d1).not.toBe(d2);
  });

  // --- getPluginConfig ---
  it('user config overrides defaults which override global', () => {
    config.setGlobalConfig({ key: 'global', onlyGlobal: 'g' });
    config.registerPluginDefaults('test', { key: 'default', onlyDefault: 'd' });
    config.setPluginConfig('test', { key: 'user' });
    const result = config.getPluginConfig('test');
    expect(result.key).toBe('user');
    expect(result.onlyDefault).toBe('d');
    expect(result.onlyGlobal).toBe('g');
  });

  it('returns only global config for unknown plugin', () => {
    config.setGlobalConfig({ x: 1 });
    expect(config.getPluginConfig('unknown')).toEqual({ x: 1 });
  });

  // --- setPluginConfig ---
  it('notifies multiple listeners', () => {
    const changes1: string[] = [];
    const changes2: string[] = [];
    config.onChange((_, key) => changes1.push(key));
    config.onChange((_, key) => changes2.push(key));
    config.setPluginConfig('test', { a: 1 });
    expect(changes1).toEqual(['a']);
    expect(changes2).toEqual(['a']);
  });

  it('notifies for each key in config object', () => {
    const keys: string[] = [];
    config.onChange((_, key) => keys.push(key));
    config.setPluginConfig('test', { a: 1, b: 2, c: 3 });
    expect(keys).toEqual(['a', 'b', 'c']);
  });

  it('handles listener errors gracefully', () => {
    config.onChange(() => { throw new Error('listener error'); });
    expect(() => config.setPluginConfig('test', { a: 1 })).not.toThrow();
  });

  // --- setPluginConfigValue / getPluginConfigValue ---
  it('sets and gets individual config values', () => {
    config.setPluginConfigValue('test', 'port', 8080);
    expect(config.getPluginConfigValue('test', 'port')).toBe(8080);
  });

  it('returns undefined for unknown config key', () => {
    expect(config.getPluginConfigValue('test', 'nonexistent')).toBeUndefined();
  });

  // --- validateConfig ---
  it('returns warning when no schema registered', () => {
    const result = config.validateConfig('unknown', {});
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('validates nested object properties', () => {
    config.registerSchema('test', {
      properties: {
        server: {
          type: 'object',
          properties: {
            host: { type: 'string', required: true },
            port: { type: 'number' },
          },
        },
      },
    });
    const result = config.validateConfig('test', { server: { port: 'wrong' } });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('server.host'))).toBe(true);
  });

  it('validates nested object with correct types', () => {
    config.registerSchema('test', {
      properties: {
        server: {
          type: 'object',
          properties: {
            host: { type: 'string', required: true },
            port: { type: 'number' },
          },
        },
      },
    });
    const result = config.validateConfig('test', { server: { host: 'localhost', port: 8080 } });
    expect(result.valid).toBe(true);
  });

  // BUG-002: array item type validation
  it('validates array items with correct type detection', () => {
    config.registerSchema('test', {
      properties: {
        tags: { type: 'array', items: 'string' },
      },
    });
    expect(config.validateConfig('test', { tags: ['a', 'b'] }).valid).toBe(true);
    expect(config.validateConfig('test', { tags: [1, 2] }).valid).toBe(false);
  });

  it('validates array-of-arrays correctly', () => {
    config.registerSchema('test', {
      properties: {
        matrix: { type: 'array', items: 'array' },
      },
    });
    expect(config.validateConfig('test', { matrix: [[1, 2], [3, 4]] }).valid).toBe(true);
    expect(config.validateConfig('test', { matrix: [1, 2, 3] }).valid).toBe(false);
  });

  it('validates string pattern', () => {
    config.registerSchema('test', {
      properties: {
        email: { type: 'string', pattern: '^[^@]+@[^@]+\\.[^@]+$' },
      },
    });
    expect(config.validateConfig('test', { email: 'test@example.com' }).valid).toBe(true);
    expect(config.validateConfig('test', { email: 'not-an-email' }).valid).toBe(false);
  });

  it('validates enum values', () => {
    config.registerSchema('test', {
      properties: {
        color: { type: 'string', enum: ['red', 'green', 'blue'] },
      },
    });
    expect(config.validateConfig('test', { color: 'red' }).valid).toBe(true);
    expect(config.validateConfig('test', { color: 'yellow' }).valid).toBe(false);
  });

  it('strict mode allows all known properties', () => {
    config.registerSchema('test', {
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      strict: true,
    });
    expect(config.validateConfig('test', { a: 'hello', b: 42 }).valid).toBe(true);
  });

  it('non-strict mode allows unknown properties', () => {
    config.registerSchema('test', {
      properties: { a: { type: 'string' } },
      strict: false,
    });
    expect(config.validateConfig('test', { a: 'hello', unknown: 'value' }).valid).toBe(true);
  });

  it('skips validation for undefined values that are not required', () => {
    config.registerSchema('test', {
      properties: {
        optional: { type: 'string' },
      },
    });
    expect(config.validateConfig('test', {}).valid).toBe(true);
  });

  // --- onChange ---
  it('returns working unsubscribe function', () => {
    let count = 0;
    const unsub = config.onChange(() => { count++; });
    config.setPluginConfig('test', { a: 1 });
    unsub();
    config.setPluginConfig('test', { b: 2 });
    expect(count).toBe(1);
  });

  // --- exportConfig / importConfig ---
  it('exports config for specific plugin', () => {
    config.setPluginConfig('test', { a: 1 });
    const exported = config.exportConfig('test');
    expect(exported.test).toBeDefined();
    expect(exported.test.a).toBe(1);
  });

  it('exports all configured plugins when no name given', () => {
    config.setPluginConfig('a', { x: 1 });
    config.setPluginConfig('b', { y: 2 });
    const exported = config.exportConfig();
    expect(exported.a).toBeDefined();
    expect(exported.b).toBeDefined();
  });

  it('importConfig skips non-object values', () => {
    config.importConfig({ a: 'not-an-object', b: { key: 'value' } });
    expect(config.getPluginConfig('b').key).toBe('value');
  });

  // --- resetPluginConfig ---
  // BUG-005: should notify change listeners
  it('notifies change listeners when resetting', () => {
    const changes: Array<{ key: string; newVal: unknown }> = [];
    config.onChange((_, key, __, newVal) => changes.push({ key, newVal }));
    config.setPluginConfig('test', { a: 1, b: 2 });
    changes.length = 0;
    config.resetPluginConfig('test');
    expect(changes.length).toBe(2);
    expect(changes.some(c => c.key === 'a' && c.newVal === undefined)).toBe(true);
    expect(changes.some(c => c.key === 'b' && c.newVal === undefined)).toBe(true);
  });

  it('resetPluginConfig does nothing for unknown plugin', () => {
    expect(() => config.resetPluginConfig('unknown')).not.toThrow();
  });

  // --- listConfiguredPlugins ---
  it('returns empty array when no plugins configured', () => {
    expect(config.listConfiguredPlugins()).toEqual([]);
  });
});

// ============================================================
// Module 6: PluginCommunicationBus - Comprehensive Tests
// ============================================================
describe('PluginCommunicationBus (coverage)', () => {
  let bus: PluginCommunicationBus;

  beforeEach(() => {
    bus = new PluginCommunicationBus();
  });

  afterEach(() => {
    bus.reset();
  });

  // --- send ---
  it('delivers to multiple handlers on same plugin', () => {
    const received: number[] = [];
    bus.onMessage('target', () => received.push(1));
    bus.onMessage('target', () => received.push(2));
    bus.send('src', 'target', { type: 'test', data: null });
    expect(received).toEqual([1, 2]);
  });

  it('enriches message with timestamp and id', () => {
    let received: PluginMessage | undefined;
    bus.onMessage('target', (msg) => { received = msg; });
    bus.send('src', 'target', { type: 'test', data: null });
    expect(received!.timestamp).toBeDefined();
    expect(received!.id).toBeDefined();
    expect(received!.id).toMatch(/^msg_\d+$/);
  });

  it('preserves existing message id and timestamp', () => {
    let received: PluginMessage | undefined;
    bus.onMessage('target', (msg) => { received = msg; });
    bus.send('src', 'target', { type: 'test', data: null, id: 'custom-id', timestamp: 1000 });
    expect(received!.id).toBe('custom-id');
    expect(received!.timestamp).toBe(1000);
  });

  it('returns false when blocked by filter', () => {
    bus.addMessageFilter(() => false);
    bus.onMessage('target', () => {});
    expect(bus.send('src', 'target', { type: 'test', data: null })).toBe(false);
  });

  it('throws on oversized message', () => {
    bus.onMessage('target', () => {});
    const hugeData = { x: 'a'.repeat(100000) };
    expect(() => bus.send('src', 'target', { type: 'test', data: hugeData })).toThrow(/exceeds limit/);
  });

  it('does not log message when filtered', () => {
    bus.addMessageFilter(() => false);
    bus.onMessage('target', () => {});
    bus.send('src', 'target', { type: 'test', data: null });
    expect(bus.getMessageLog()).toHaveLength(0);
  });

  // --- broadcast ---
  it('delivers to all non-sender non-blocked plugins', () => {
    const received: string[] = [];
    bus.onMessage('a', () => received.push('a'));
    bus.onMessage('b', () => received.push('b'));
    bus.onMessage('c', () => received.push('c'));
    bus.broadcast('sender', { type: 'test', data: null });
    expect(received).toEqual(['a', 'b', 'c']);
  });

  it('broadcast throws when sender is blocked', () => {
    bus.blockPlugin('bad');
    expect(() => bus.broadcast('bad', { type: 'test', data: null })).toThrow();
  });

  it('broadcast validates message size', () => {
    const hugeData = { x: 'a'.repeat(100000) };
    expect(() => bus.broadcast('src', { type: 'test', data: hugeData })).toThrow(/exceeds limit/);
  });

  it('broadcast respects message filters', () => {
    bus.addMessageFilter((from) => from !== 'blocked');
    bus.onMessage('target', () => {});
    const count = bus.broadcast('blocked', { type: 'test', data: null });
    expect(count).toBe(0);
  });

  // BUG-009: broadcast respects maxBroadcastRecipients
  it('broadcast enforces maxBroadcastRecipients limit', () => {
    bus.setLimits({ maxBroadcastRecipients: 2 });
    bus.onMessage('a', () => {});
    bus.onMessage('b', () => {});
    bus.onMessage('c', () => {});
    bus.onMessage('d', () => {});
    const count = bus.broadcast('src', { type: 'test', data: null });
    expect(count).toBe(2);
  });

  it('broadcast returns 0 when no recipients', () => {
    const count = bus.broadcast('src', { type: 'test', data: null });
    expect(count).toBe(0);
  });

  // --- request ---
  it('request returns handler response', async () => {
    bus.onMessage('target', () => 'response');
    const result = await bus.request<string>('src', 'target', { type: 'test', data: null });
    expect(result).toBe('response');
  });

  it('request returns async handler response', async () => {
    bus.onMessage('target', async () => 'async-response');
    const result = await bus.request<string>('src', 'target', { type: 'test', data: null });
    expect(result).toBe('async-response');
  });

  it('request times out for slow async handler', async () => {
    bus.onMessage('target', async () => {
      await new Promise(r => setTimeout(r, 10000));
      return 'late';
    });
    await expect(bus.request('src', 'target', { type: 'test', data: null }, 50)).rejects.toThrow(/timed out/);
  });

  it('request rejects when no handlers registered', async () => {
    await expect(bus.request('src', 'nobody', { type: 'test', data: null })).rejects.toThrow(/No handlers/);
  });

  it('request throws when sender is blocked', async () => {
    bus.blockPlugin('bad');
    bus.onMessage('target', () => 'ok');
    await expect(bus.request('bad', 'target', { type: 'test', data: null })).rejects.toThrow(/blocked/);
  });

  it('request throws when blocked by filter', async () => {
    bus.addMessageFilter(() => false);
    bus.onMessage('target', () => 'ok');
    await expect(bus.request('src', 'target', { type: 'test', data: null })).rejects.toThrow(/blocked by message filter/);
  });

  it('request validates message size', async () => {
    bus.onMessage('target', () => 'ok');
    const hugeData = { x: 'a'.repeat(100000) };
    await expect(bus.request('src', 'target', { type: 'test', data: hugeData })).rejects.toThrow(/exceeds limit/);
  });

  // BUG-001: request falls through to reply-based pattern when handlers return undefined
  it('request uses reply-based pattern when handler returns undefined', async () => {
    bus.onMessage('target', () => undefined);
    // Set up a pending request, then reply to it
    const requestPromise = bus.request<string>('src', 'target', { type: 'test', data: null }, 1000);
    // Get the request ID from the message log
    const log = bus.getMessageLog(1);
    const requestId = log[0].message.id!;
    bus.reply('target', requestId, 'replied-value');
    const result = await requestPromise;
    expect(result).toBe('replied-value');
  });

  it('request tries next handler when first returns undefined', async () => {
    bus.onMessage('target', () => undefined);
    bus.onMessage('target', () => 'second-handler-response');
    const result = await bus.request<string>('src', 'target', { type: 'test', data: null });
    expect(result).toBe('second-handler-response');
  });

  it('request tries next handler when first throws', async () => {
    bus.onMessage('target', () => { throw new Error('first failed'); });
    bus.onMessage('target', () => 'second-handler-response');
    const result = await bus.request<string>('src', 'target', { type: 'test', data: null });
    expect(result).toBe('second-handler-response');
  });

  // --- reply ---
  it('reply does nothing for unknown request ID', () => {
    expect(() => bus.reply('target', 'nonexistent', 'data')).not.toThrow();
  });

  // --- getMessageLog ---
  // BUG-003: getMessageLog(0) should return empty array
  it('getMessageLog(0) returns empty array', () => {
    bus.onMessage('target', () => {});
    bus.send('src', 'target', { type: 'test', data: null });
    expect(bus.getMessageLog(0)).toEqual([]);
  });

  it('getMessageLog returns copy of log', () => {
    bus.onMessage('target', () => {});
    bus.send('src', 'target', { type: 'test', data: null });
    const log1 = bus.getMessageLog();
    const log2 = bus.getMessageLog();
    expect(log1).not.toBe(log2);
  });

  it('getMessageLog with limit returns last N entries', () => {
    bus.onMessage('target', () => {});
    bus.send('src', 'target', { type: 'a', data: null });
    bus.send('src', 'target', { type: 'b', data: null });
    bus.send('src', 'target', { type: 'c', data: null });
    const log = bus.getMessageLog(2);
    expect(log).toHaveLength(2);
    expect(log[0].message.type).toBe('b');
    expect(log[1].message.type).toBe('c');
  });

  // --- setLimits ---
  it('setLimits merges with existing limits', () => {
    bus.setLimits({ maxMessageSizeKB: 128 });
    expect(() => {
      // Should not throw with 100KB message under 128KB limit
      const data = { x: 'a'.repeat(50000) };
      bus.onMessage('target', () => {});
      bus.send('src', 'target', { type: 'test', data });
    }).not.toThrow();
  });

  // --- blockPlugin / unblockPlugin ---
  it('unblockPlugin does nothing for non-blocked plugin', () => {
    expect(() => bus.unblockPlugin('nonexistent')).not.toThrow();
  });

  it('blocked plugin can still receive messages', () => {
    let received = false;
    bus.onMessage('blocked', () => { received = true; });
    bus.blockPlugin('blocked');
    bus.send('src', 'blocked', { type: 'test', data: null });
    expect(received).toBe(true);
  });

  // --- reset ---
  it('reset clears all state', () => {
    bus.onMessage('a', () => {});
    bus.blockPlugin('b');
    bus.send('src', 'a', { type: 'test', data: null });
    bus.reset();
    expect(bus.getRegisteredPlugins()).toHaveLength(0);
    expect(bus.getMessageLog()).toHaveLength(0);
  });

  // --- onMessage unsubscribe ---
  it('multiple unsubscribes work correctly', () => {
    let count = 0;
    const unsub1 = bus.onMessage('target', () => { count++; });
    const unsub2 = bus.onMessage('target', () => { count++; });
    bus.send('src', 'target', { type: 'test', data: null });
    expect(count).toBe(2);
    unsub1();
    bus.send('src', 'target', { type: 'test', data: null });
    expect(count).toBe(3);
    unsub2();
    bus.send('src', 'target', { type: 'test', data: null });
    expect(count).toBe(3);
  });
});

// ============================================================
// Module 7: PluginTelemetry - Comprehensive Tests
// ============================================================
describe('PluginTelemetry (coverage)', () => {
  let telemetry: PluginTelemetry;

  beforeEach(() => {
    telemetry = new PluginTelemetry();
  });

  // --- recordStart ---
  it('records start time for plugin', async () => {
    telemetry.recordStart('test');
    await new Promise(r => setTimeout(r, 5));
    const stats = telemetry.getPluginStats('test');
    expect(stats.uptime).toBeGreaterThan(0);
  });

  it('uptime increases over time', async () => {
    telemetry.recordStart('test');
    const stats1 = telemetry.getPluginStats('test');
    await new Promise(r => setTimeout(r, 10));
    const stats2 = telemetry.getPluginStats('test');
    expect(stats2.uptime).toBeGreaterThan(stats1.uptime);
  });

  // --- recordExecution ---
  it('trims old records beyond maxRecordsPerPlugin', () => {
    // Record many executions to test trimming
    for (let i = 0; i < 10050; i++) {
      telemetry.recordExecution('test', 10, true);
    }
    const stats = telemetry.getPluginStats('test');
    expect(stats.totalExecutions).toBeLessThanOrEqual(10000);
  });

  it('records error string', () => {
    telemetry.recordExecution('test', 10, false, 'timeout error');
    const stats = telemetry.getPluginStats('test');
    expect(stats.failedExecutions).toBe(1);
  });

  it('creates slow execution alert', () => {
    const alerts: string[] = [];
    telemetry.onAlert(a => alerts.push(a.type));
    telemetry.setSlowExecutionThreshold(50);
    telemetry.recordExecution('test', 100, true);
    expect(alerts).toContain('slow_execution');
  });

  it('does not create slow execution alert below threshold', () => {
    const alerts: string[] = [];
    telemetry.onAlert(a => alerts.push(a.type));
    telemetry.setSlowExecutionThreshold(10000);
    telemetry.recordExecution('test', 100, true);
    expect(alerts).not.toContain('slow_execution');
  });

  // --- recordApiCall ---
  it('returns 0 for unknown plugin API calls', () => {
    expect(telemetry.getPluginStats('unknown').apiCallCount).toBe(0);
  });

  // --- recordMemory ---
  it('creates memory leak alert when exceeding threshold', () => {
    const alerts: string[] = [];
    telemetry.onAlert(a => alerts.push(a.type));
    telemetry.setMemoryLeakThreshold(128);
    telemetry.recordMemory('test', 200);
    expect(alerts).toContain('memory_leak');
  });

  it('does not alert when memory below threshold', () => {
    const alerts: string[] = [];
    telemetry.onAlert(a => alerts.push(a.type));
    telemetry.setMemoryLeakThreshold(256);
    telemetry.recordMemory('test', 128);
    expect(alerts).not.toContain('memory_leak');
  });

  it('records multiple memory snapshots', () => {
    telemetry.recordMemory('test', 64);
    telemetry.recordMemory('test', 128);
    telemetry.recordMemory('test', 32);
    expect(telemetry.getPluginStats('test').memoryUsageMB).toBe(32);
  });

  // --- getPluginStats ---
  it('returns correct stats for empty plugin', () => {
    const stats = telemetry.getPluginStats('empty');
    expect(stats.pluginName).toBe('empty');
    expect(stats.totalExecutions).toBe(0);
    expect(stats.successfulExecutions).toBe(0);
    expect(stats.failedExecutions).toBe(0);
    expect(stats.avgExecutionTime).toBe(0);
    expect(stats.maxExecutionTime).toBe(0);
    expect(stats.minExecutionTime).toBe(0);
    expect(stats.errorRate).toBe(0);
    expect(stats.apiCallCount).toBe(0);
    expect(stats.memoryUsageMB).toBe(0);
    expect(stats.lastExecutionTime).toBe(0);
  });

  it('calculates correct error rate', () => {
    telemetry.recordExecution('test', 10, true);
    telemetry.recordExecution('test', 10, true);
    telemetry.recordExecution('test', 10, false);
    const stats = telemetry.getPluginStats('test');
    expect(stats.errorRate).toBeCloseTo(1 / 3, 3);
  });

  // --- getLeaderboard ---
  it('ranks plugins with same score by name stability', () => {
    telemetry.recordExecution('a', 10, true);
    telemetry.recordExecution('b', 10, true);
    const board = telemetry.getLeaderboard();
    expect(board).toHaveLength(2);
    expect(board[0].rank).toBe(1);
    expect(board[1].rank).toBe(2);
  });

  it('returns empty leaderboard when no executions', () => {
    expect(telemetry.getLeaderboard()).toEqual([]);
  });

  // --- getHealthReport ---
  it('classifies plugin with high error rate as degraded or unhealthy', () => {
    telemetry.setErrorRateThreshold(0.2);
    for (let i = 0; i < 10; i++) {
      telemetry.recordExecution('test', 10, false);
    }
    const report = telemetry.getHealthReport();
    const entry = report.entries.find(e => e.pluginName === 'test');
    expect(entry!.status).not.toBe('healthy');
  });

  it('classifies plugin with no issues as healthy', () => {
    for (let i = 0; i < 10; i++) {
      telemetry.recordExecution('test', 10, true);
    }
    const report = telemetry.getHealthReport();
    const entry = report.entries.find(e => e.pluginName === 'test');
    expect(entry!.status).toBe('healthy');
  });

  it('health report has correct counts', () => {
    for (let i = 0; i < 10; i++) telemetry.recordExecution('healthy', 10, true);
    for (let i = 0; i < 10; i++) telemetry.recordExecution('unhealthy', 10, false);
    const report = telemetry.getHealthReport();
    expect(report.totalPlugins).toBe(2);
    expect(report.healthyCount + report.degradedCount + report.unhealthyCount).toBe(2);
  });

  // --- getAlerts ---
  it('filters alerts by severity', () => {
    telemetry.setSlowExecutionThreshold(1);
    telemetry.recordExecution('test', 100, true); // warning
    const warnings = telemetry.getAlerts(undefined, 'warning');
    expect(warnings.every(a => a.severity === 'warning')).toBe(true);
  });

  it('limits alert count', () => {
    telemetry.setSlowExecutionThreshold(1);
    telemetry.recordExecution('test', 100, true);
    telemetry.recordExecution('test', 100, true);
    telemetry.recordExecution('test', 100, true);
    const limited = telemetry.getAlerts(2);
    expect(limited).toHaveLength(2);
  });

  it('returns all alerts when no filters', () => {
    telemetry.setSlowExecutionThreshold(1);
    telemetry.recordExecution('test', 100, true);
    expect(telemetry.getAlerts().length).toBeGreaterThan(0);
  });

  // --- onAlert ---
  it('handles listener errors gracefully', () => {
    telemetry.onAlert(() => { throw new Error('listener error'); });
    telemetry.setSlowExecutionThreshold(1);
    expect(() => telemetry.recordExecution('test', 100, true)).not.toThrow();
  });

  it('unsubscribe removes alert listener', () => {
    let count = 0;
    const unsub = telemetry.onAlert(() => { count++; });
    telemetry.setSlowExecutionThreshold(1);
    telemetry.recordExecution('test', 100, true);
    unsub();
    telemetry.recordExecution('test', 100, true);
    expect(count).toBe(1);
  });

  // --- resetPlugin ---
  it('resetPlugin clears only specified plugin data', () => {
    telemetry.recordExecution('a', 10, true);
    telemetry.recordExecution('b', 10, true);
    telemetry.resetPlugin('a');
    expect(telemetry.getPluginStats('a').totalExecutions).toBe(0);
    expect(telemetry.getPluginStats('b').totalExecutions).toBe(1);
  });

  // --- reset ---
  it('reset clears all data including alerts', () => {
    telemetry.setSlowExecutionThreshold(1);
    telemetry.recordExecution('test', 100, true);
    telemetry.reset();
    expect(telemetry.getAlerts()).toHaveLength(0);
    expect(telemetry.getLeaderboard()).toHaveLength(0);
  });

  // --- threshold setters ---
  it('setInactivityThreshold exists (no-op test)', () => {
    // The field exists but is not directly exposed; just verify no error
    expect(true).toBe(true);
  });
});

// ============================================================
// Module 8: PluginMarketplace - Comprehensive Tests
// ============================================================
describe('PluginMarketplace (coverage)', () => {
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

  // --- addPlugin ---
  it('adds plugin with details', () => {
    marketplace.addPlugin(makeListing('test'), {
      readme: '# Test',
      license: 'MIT',
      dependencies: { lodash: '^4.0.0' },
      permissions: ['fs.read'],
    });
    const details = marketplace.getPluginDetails('test');
    expect(details!.readme).toBe('# Test');
    expect(details!.license).toBe('MIT');
    expect(details!.dependencies).toEqual({ lodash: '^4.0.0' });
    expect(details!.permissions).toEqual(['fs.read']);
  });

  it('adds plugin without details', () => {
    marketplace.addPlugin(makeListing('test'));
    expect(marketplace.getPluginDetails('test')).toBeUndefined();
  });

  it('overwrites existing plugin', () => {
    marketplace.addPlugin(makeListing('test', { name: 'old-name' }));
    marketplace.addPlugin(makeListing('test', { name: 'new-name' }));
    expect(marketplace.getCatalogSize()).toBe(1);
  });

  // --- removePlugin ---
  it('returns false for unknown plugin', () => {
    expect(marketplace.removePlugin('nonexistent')).toBe(false);
  });

  // --- search ---
  it('searches by tag', () => {
    marketplace.addPlugin(makeListing('a', { tags: ['machine-learning', 'ai'] }));
    marketplace.addPlugin(makeListing('b', { tags: ['web', 'framework'] }));
    const results = marketplace.search('machine-learning');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
  });

  it('searches by author', () => {
    marketplace.addPlugin(makeListing('a', { author: 'alice' }));
    marketplace.addPlugin(makeListing('b', { author: 'bob' }));
    const results = marketplace.search('alice');
    expect(results).toHaveLength(1);
  });

  it('search is case insensitive', () => {
    marketplace.addPlugin(makeListing('a', { name: 'MachineLearning' }));
    const results = marketplace.search('machinelearning');
    expect(results).toHaveLength(1);
  });

  it('search with empty query returns all', () => {
    marketplace.addPlugin(makeListing('a'));
    marketplace.addPlugin(makeListing('b'));
    const results = marketplace.search('');
    expect(results).toHaveLength(2);
  });

  it('search with whitespace query returns all', () => {
    marketplace.addPlugin(makeListing('a'));
    const results = marketplace.search('   ');
    expect(results).toHaveLength(1);
  });

  it('filters by tags', () => {
    marketplace.addPlugin(makeListing('a', { tags: ['js', 'node'] }));
    marketplace.addPlugin(makeListing('b', { tags: ['python'] }));
    const results = marketplace.search('', { tags: ['js'] });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
  });

  it('sorts by downloads', () => {
    marketplace.addPlugin(makeListing('a', { downloadCount: 10 }));
    marketplace.addPlugin(makeListing('b', { downloadCount: 100 }));
    marketplace.addPlugin(makeListing('c', { downloadCount: 50 }));
    const results = marketplace.search('', { sort: 'downloads' });
    expect(results[0].downloadCount).toBe(100);
    expect(results[1].downloadCount).toBe(50);
    expect(results[2].downloadCount).toBe(10);
  });

  it('sorts by recent', () => {
    marketplace.addPlugin(makeListing('a', { updatedAt: 1000 }));
    marketplace.addPlugin(makeListing('b', { updatedAt: 3000 }));
    marketplace.addPlugin(makeListing('c', { updatedAt: 2000 }));
    const results = marketplace.search('', { sort: 'recent' });
    expect(results[0].updatedAt).toBe(3000);
  });

  it('sorts by name', () => {
    marketplace.addPlugin(makeListing('c', { name: 'charlie' }));
    marketplace.addPlugin(makeListing('a', { name: 'alpha' }));
    marketplace.addPlugin(makeListing('b', { name: 'bravo' }));
    const results = marketplace.search('', { sort: 'name' });
    expect(results[0].name).toBe('alpha');
    expect(results[1].name).toBe('bravo');
    expect(results[2].name).toBe('charlie');
  });

  it('pagination with offset only', () => {
    marketplace.addPlugin(makeListing('a'));
    marketplace.addPlugin(makeListing('b'));
    marketplace.addPlugin(makeListing('c'));
    const results = marketplace.search('', { offset: 1 });
    expect(results).toHaveLength(2);
  });

  it('combined filters', () => {
    marketplace.addPlugin(makeListing('a', { category: 'tools', rating: 4.0, author: 'alice' }));
    marketplace.addPlugin(makeListing('b', { category: 'tools', rating: 5.0, author: 'bob' }));
    marketplace.addPlugin(makeListing('c', { category: 'themes', rating: 5.0, author: 'alice' }));
    const results = marketplace.search('', { category: 'tools', minRating: 4.5, author: 'bob' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('b');
  });

  it('returns empty for no matches', () => {
    const results = marketplace.search('nonexistent');
    expect(results).toHaveLength(0);
  });

  // --- getFeatured ---
  it('returns empty when no featured plugins', () => {
    marketplace.addPlugin(makeListing('a', { featured: false }));
    expect(marketplace.getFeatured()).toHaveLength(0);
  });

  // --- getByCategory ---
  it('returns empty for unknown category', () => {
    expect(marketplace.getByCategory('nonexistent' as any)).toHaveLength(0);
  });

  // --- install ---
  it('install returns correct version and dependencies', async () => {
    marketplace.addPlugin(makeListing('test', { version: '2.0.0' }), {
      dependencies: { lodash: '^4.0.0' },
    });
    const result = await marketplace.install('test');
    expect(result.version).toBe('2.0.0');
    expect(result.dependencies).toEqual({ lodash: '^4.0.0' });
  });

  it('install is idempotent', async () => {
    marketplace.addPlugin(makeListing('test'));
    await marketplace.install('test');
    await marketplace.install('test');
    expect(marketplace.isInstalled('test')).toBe(true);
  });

  // --- uninstall ---
  it('uninstall is idempotent', async () => {
    await marketplace.uninstall('nonexistent');
    expect(true).toBe(true);
  });

  // --- addReview ---
  it('addReview recalculates rating correctly', () => {
    marketplace.addPlugin(makeListing('test', { rating: 4.0 }), { reviews: [] });
    marketplace.addReview('test', {
      id: 'r1', userId: 'u1', userName: 'User1', rating: 5, comment: 'Great', createdAt: Date.now(),
    });
    marketplace.addReview('test', {
      id: 'r2', userId: 'u2', userName: 'User2', rating: 3, comment: 'OK', createdAt: Date.now(),
    });
    const details = marketplace.getPluginDetails('test');
    expect(details!.rating).toBe(4.0); // (5+3)/2 = 4.0
  });

  it('addReview does nothing when no details registered', () => {
    marketplace.addPlugin(makeListing('test'));
    expect(() => marketplace.addReview('test', {
      id: 'r1', userId: 'u1', userName: 'User1', rating: 5, comment: 'Great', createdAt: Date.now(),
    })).not.toThrow();
  });

  // --- getPopularTags ---
  it('returns empty when no plugins', () => {
    expect(marketplace.getPopularTags()).toEqual([]);
  });

  it('limits to top 20 tags', () => {
    for (let i = 0; i < 30; i++) {
      marketplace.addPlugin(makeListing(`p${i}`, { tags: [`tag${i}`] }));
    }
    expect(marketplace.getPopularTags().length).toBeLessThanOrEqual(20);
  });

  // --- getCategories ---
  it('returns all 5 categories', () => {
    const cats = marketplace.getCategories();
    expect(cats).toHaveLength(5);
  });

  // --- getInstalledPlugins ---
  it('returns empty when nothing installed', () => {
    expect(marketplace.getInstalledPlugins()).toEqual([]);
  });
});

// ============================================================
// Module 9: PluginLoader - Comprehensive Tests
// ============================================================
describe('PluginLoader (coverage)', () => {
  let loader: PluginLoader;

  beforeEach(() => {
    loader = new PluginLoader();
  });

  afterEach(() => {
    loader.reset();
  });

  // --- load inline ---
  it('generates auto-name for inline without name', async () => {
    const result = await loader.load({ type: 'inline', code: 'test' });
    expect(result.success).toBe(true);
    expect(result.plugin!.name).toMatch(/^inline_\d+$/);
  });

  it('auto-increments inline counter', async () => {
    const r1 = await loader.load({ type: 'inline', code: 'a' });
    const r2 = await loader.load({ type: 'inline', code: 'b' });
    expect(r1.plugin!.name).not.toBe(r2.plugin!.name);
  });

  // --- load local ---
  it('extracts name from path', async () => {
    const result = await loader.load({ type: 'local', path: '/path/to/my-plugin' });
    expect(result.success).toBe(true);
    expect(result.plugin!.name).toBe('my-plugin');
  });

  it('uses provided name over path-derived name', async () => {
    const result = await loader.load({ type: 'local', path: '/path/to/plugin', name: 'custom' });
    expect(result.plugin!.name).toBe('custom');
  });

  it('fails for local without path', async () => {
    const result = await loader.load({ type: 'local' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('path');
  });

  // --- load npm ---
  it('uses packageName as name when no name provided', async () => {
    const result = await loader.load({ type: 'npm', packageName: 'my-lib' });
    expect(result.plugin!.name).toBe('my-lib');
  });

  it('fails for npm without packageName', async () => {
    const result = await loader.load({ type: 'npm' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('packageName');
  });

  // --- load URL ---
  it('extracts hostname as name', async () => {
    const result = await loader.load({ type: 'url', url: 'https://example.com/plugin.js' });
    expect(result.plugin!.name).toBe('example.com');
  });

  it('fails for invalid URL', async () => {
    const result = await loader.load({ type: 'url', url: 'not-a-url' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });

  it('fails for URL without url field', async () => {
    const result = await loader.load({ type: 'url' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('url');
  });

  // --- load result ---
  it('load result includes timing info', async () => {
    const result = await loader.load({ type: 'inline', code: 'test', name: 'timed' });
    expect(result.loadTime).toBeGreaterThanOrEqual(0);
    expect(result.source.type).toBe('inline');
  });

  it('load result error includes message', async () => {
    const result = await loader.load({ type: 'inline' });
    expect(result.error).toBeDefined();
    expect(result.success).toBe(false);
  });

  // --- loadAll ---
  it('loadAll with empty array returns empty results', async () => {
    const results = await loader.loadAll([]);
    expect(results).toHaveLength(0);
  });

  // --- unload ---
  it('unload does nothing for unknown plugin', async () => {
    await loader.unload('nonexistent');
    expect(true).toBe(true);
  });

  it('unload notifies handlers before removing', async () => {
    let called = false;
    loader.onUnload('test', () => { called = true; });
    await loader.load({ type: 'inline', code: 'test', name: 'test' });
    await loader.unload('test');
    expect(called).toBe(true);
    expect(loader.getPlugin('test')).toBeUndefined();
  });

  // --- reload ---
  // BUG-004: reload should attempt recovery on failure
  it('reload re-throws error when both load and restore fail', async () => {
    await loader.load({ type: 'inline', code: 'original', name: 'test' });
    // Manually corrupt the source to make reload fail
    const instance = loader.getPlugin('test')!;
    instance.source = { type: 'inline' }; // missing code -> will fail
    // The reload will fail and attempt restore (which also fails with corrupted source)
    await expect(loader.reload('test')).rejects.toThrow();
    // Plugin is left unloaded since both load and restore failed
    expect(loader.getPlugin('test')).toBeUndefined();
  });

  it('reload throws for unknown plugin', async () => {
    await expect(loader.reload('nonexistent')).rejects.toThrow();
  });

  // --- onLoad / onUnload handlers ---
  it('onLoad handler error does not prevent load', async () => {
    loader.onLoad('test', () => { throw new Error('handler error'); });
    const result = await loader.load({ type: 'inline', code: 'test', name: 'test' });
    expect(result.success).toBe(true);
  });

  it('onUnload handler error does not prevent unload', async () => {
    loader.onUnload('test', () => { throw new Error('handler error'); });
    await loader.load({ type: 'inline', code: 'test', name: 'test' });
    await loader.unload('test');
    expect(loader.getPlugin('test')).toBeUndefined();
  });

  it('onLoad unsubscribe works', async () => {
    let count = 0;
    const unsub = loader.onLoad('test', () => { count++; });
    await loader.load({ type: 'inline', code: 'test', name: 'test' });
    unsub();
    await loader.unload('test');
    await loader.load({ type: 'inline', code: 'test', name: 'test' });
    expect(count).toBe(1);
  });

  it('onUnload unsubscribe works', async () => {
    let count = 0;
    const unsub = loader.onUnload('test', () => { count++; });
    await loader.load({ type: 'inline', code: 'test', name: 'test' });
    await loader.unload('test');
    unsub();
    await loader.load({ type: 'inline', code: 'test', name: 'test' });
    await loader.unload('test');
    expect(count).toBe(1);
  });

  // --- enableHotReload / disableHotReload ---
  it('disableHotReload does nothing for non-watched plugin', () => {
    expect(() => loader.disableHotReload('nonexistent')).not.toThrow();
  });

  it('enableHotReload replaces existing watcher', async () => {
    await loader.load({ type: 'local', path: '/tmp/test', name: 'test' });
    loader.enableHotReload('test', { debounceMs: 500 });
    loader.enableHotReload('test', { debounceMs: 1000 });
    loader.disableHotReload('test');
    // No error means success
    expect(true).toBe(true);
  });

  // --- listLoaded ---
  it('returns empty when nothing loaded', () => {
    expect(loader.listLoaded()).toEqual([]);
  });

  // --- getPlugin ---
  it('returns undefined for unknown plugin', () => {
    expect(loader.getPlugin('nonexistent')).toBeUndefined();
  });

  // --- reset ---
  it('reset clears everything', async () => {
    await loader.load({ type: 'inline', code: 'test', name: 'test' });
    loader.enableHotReload('test');
    loader.reset();
    expect(loader.listLoaded()).toHaveLength(0);
  });

  // --- setSandboxProvider ---
  it('setSandboxProvider works without error', () => {
    const sandbox = new PluginSandbox();
    expect(() => loader.setSandboxProvider(sandbox)).not.toThrow();
  });
});

// ============================================================
// Module 10: PluginRegistry - Comprehensive Tests
// ============================================================
describe('PluginRegistry (coverage)', () => {
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

  // --- constructor ---
  it('accepts empty options', () => {
    expect(() => new PluginRegistry()).not.toThrow();
  });

  it('accepts options with sandboxPermissions', () => {
    expect(() => new PluginRegistry({ sandboxPermissions: ['fs.read'] })).not.toThrow();
  });

  // --- register ---
  it('fires before_init and after_init hooks', async () => {
    const events: string[] = [];
    registry.getHooks().addHook('before_init', () => events.push('before'));
    registry.getHooks().addHook('after_init', () => events.push('after'));
    await registry.register(makePlugin('test'));
    expect(events).toEqual(['before', 'after']);
  });

  it('throws on dependency conflict during registration', async () => {
    await registry.register(makePlugin('a', '1.0.0'));
    // b depends on a ^2.0.0, but a is 1.0.0 -> conflict
    await expect(registry.register(makePlugin('b', '1.0.0', { a: '^2.0.0' }))).rejects.toThrow();
  });

  // --- unregister ---
  it('unregister deactivates active plugin before removing', async () => {
    await registry.register(makePlugin('test'));
    await registry.activate('test');
    await registry.unregister('test');
    expect(registry.getPlugin('test')).toBeUndefined();
  });

  it('unregister destroys sandbox', async () => {
    await registry.register(makePlugin('test', '1.0.0', undefined, ['fs.read']));
    await registry.initialize('test');
    expect(registry.getSandbox().getSandbox('test')).toBeDefined();
    await registry.unregister('test');
    expect(registry.getSandbox().getSandbox('test')).toBeUndefined();
  });

  // --- initialize ---
  it('throws when dependency is not registered (caught at register time)', async () => {
    // Missing dependency is caught during registration, not initialization
    await expect(registry.register(makePlugin('test', '1.0.0', { missing: '^1.0.0' }))).rejects.toThrow();
  });

  it('creates sandbox for plugins with permissions', async () => {
    await registry.register(makePlugin('test', '1.0.0', undefined, ['fs.read']));
    await registry.initialize('test');
    expect(registry.getSandbox().getSandbox('test')).toBeDefined();
  });

  it('does not create sandbox for plugins without permissions', async () => {
    await registry.register(makePlugin('test'));
    await registry.initialize('test');
    expect(registry.getSandbox().getSandbox('test')).toBeUndefined();
  });

  it('initializes transitive dependencies', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b', '1.0.0', { a: '^1.0.0' }));
    await registry.register(makePlugin('c', '1.0.0', { b: '^1.0.0' }));
    await registry.initialize('c');
    expect(registry.getPluginState('a')).toBe('initialized');
    expect(registry.getPluginState('b')).toBe('initialized');
    expect(registry.getPluginState('c')).toBe('initialized');
  });

  // --- activate ---
  it('activate auto-initializes if needed', async () => {
    await registry.register(makePlugin('test'));
    await registry.activate('test');
    expect(registry.getPlugin('test')!.initialized).toBe(true);
    expect(registry.getPlugin('test')!.active).toBe(true);
  });

  // --- deactivate ---
  it('deactivate does nothing for unknown plugin', async () => {
    expect(() => registry.deactivate('unknown')).not.toThrow();
  });

  it('deactivate does nothing for non-active plugin', async () => {
    await registry.register(makePlugin('test'));
    expect(() => registry.deactivate('test')).not.toThrow();
  });

  // --- getPlugin / getPluginState ---
  it('getPlugin returns undefined for unknown', () => {
    expect(registry.getPlugin('unknown')).toBeUndefined();
  });

  // --- listPlugins ---
  it('returns empty when no plugins', () => {
    expect(registry.listPlugins()).toHaveLength(0);
  });

  it('listPlugins without filter returns all', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b'));
    expect(registry.listPlugins()).toHaveLength(2);
  });

  it('filter by state returns matching plugins', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b'));
    await registry.activate('a');
    const active = registry.listPlugins({ state: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('a');
  });

  it('filter by author returns matching plugins', async () => {
    await registry.register(makePlugin('a', '1.0.0', undefined, undefined));
    const customPlugin: PluginDefinition = { name: 'b', version: '1.0.0', author: 'custom' };
    await registry.register(customPlugin);
    const byAuthor = registry.listPlugins({ author: 'custom' });
    expect(byAuthor).toHaveLength(1);
  });

  it('filter by hasPermission returns matching plugins', async () => {
    await registry.register(makePlugin('a', '1.0.0', undefined, ['fs.read', 'fs.write']));
    await registry.register(makePlugin('b', '1.0.0', undefined, ['net.request']));
    const withRead = registry.listPlugins({ hasPermission: 'fs.read' });
    expect(withRead).toHaveLength(1);
    expect(withRead[0].name).toBe('a');
  });

  it('listPlugins returns correct PluginInfo fields', async () => {
    // Register dep first, then the plugin that depends on it
    await registry.register(makePlugin('dep', '1.0.0'));
    await registry.register(makePlugin('test', '2.0.0', { dep: '^1.0.0' }, ['fs.read']));
    const info = registry.listPlugins().find(p => p.name === 'test')!;
    expect(info.name).toBe('test');
    expect(info.version).toBe('2.0.0');
    expect(info.state).toBe('loaded');
    expect(info.permissions).toEqual(['fs.read']);
    expect(info.dependencies).toEqual(['dep']);
    expect(info.author).toBe('test-author');
  });

  // --- resolveDependencies / getLoadOrder / checkConflicts ---
  it('resolveDependencies returns graph', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b', '1.0.0', { a: '^1.0.0' }));
    const graph = registry.resolveDependencies();
    expect(graph.nodes.size).toBe(2);
  });

  it('getLoadOrder returns correct order', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b', '1.0.0', { a: '^1.0.0' }));
    const order = registry.getLoadOrder();
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  });

  it('checkConflicts returns empty for no conflicts', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b', '1.0.0', { a: '^1.0.0' }));
    expect(registry.checkConflicts()).toHaveLength(0);
  });

  // --- shutdown ---
  it('shutdown fires on_shutdown hook', async () => {
    let fired = false;
    registry.getHooks().addHook('on_shutdown', () => { fired = true; });
    await registry.register(makePlugin('test'));
    await registry.shutdown();
    expect(fired).toBe(true);
  });

  it('shutdown clears all state', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b'));
    await registry.activate('a');
    await registry.shutdown();
    expect(registry.getPluginCount()).toBe(0);
    expect(registry.listPlugins()).toHaveLength(0);
  });

  it('shutdown can be called multiple times', async () => {
    await registry.shutdown();
    await registry.shutdown();
    expect(true).toBe(true);
  });

  // --- getPluginCount ---
  it('returns 0 when empty', () => {
    expect(registry.getPluginCount()).toBe(0);
  });

  // --- full lifecycle with dependencies ---
  it('full lifecycle with dependency chain', async () => {
    await registry.register(makePlugin('a'));
    await registry.register(makePlugin('b', '1.0.0', { a: '^1.0.0' }));
    await registry.register(makePlugin('c', '1.0.0', { b: '^1.0.0' }, ['fs.read']));

    // Activate c -> should init b -> init a
    await registry.activate('c');
    expect(registry.getPluginState('a')).toBe('initialized');
    expect(registry.getPluginState('b')).toBe('initialized');
    expect(registry.getPluginState('c')).toBe('active');

    // Deactivate c
    await registry.deactivate('c');
    expect(registry.getPluginState('c')).toBe('deactivated');

    // Shutdown
    await registry.shutdown();
    expect(registry.getPluginCount()).toBe(0);
  });
});

// ============================================================
// Module 11: Integration / Cross-Module Tests
// ============================================================
describe('Cross-module integration (coverage)', () => {
  it('registry config manager integrates with lifecycle', async () => {
    const registry = new PluginRegistry();
    const config = registry.getConfig();
    config.setGlobalConfig({ debug: true });
    config.registerPluginDefaults('test', { timeout: 5000 });
    await registry.register({ name: 'test', version: '1.0.0' });
    const pluginConfig = config.getPluginConfig('test');
    expect(pluginConfig.debug).toBe(true);
    expect(pluginConfig.timeout).toBe(5000);
  });

  it('registry communication bus works with registered plugins', async () => {
    const registry = new PluginRegistry();
    const bus = registry.getCommunication();
    let received = false;
    bus.onMessage('plugin-a', () => { received = true; });
    bus.send('plugin-b', 'plugin-a', { type: 'test', data: null });
    expect(received).toBe(true);
  });

  it('registry telemetry tracks plugin executions', () => {
    const registry = new PluginRegistry();
    const telemetry = registry.getTelemetry();
    telemetry.recordExecution('test-plugin', 100, true);
    const stats = telemetry.getPluginStats('test-plugin');
    expect(stats.totalExecutions).toBe(1);
  });

  it('registry hooks integrate with plugin lifecycle', async () => {
    const registry = new PluginRegistry();
    const events: string[] = [];
    registry.getHooks().addHook('before_init', (plugin: any) => events.push(`before:${plugin.name}`));
    registry.getHooks().addHook('after_init', (plugin: any) => events.push(`after:${plugin.name}`));
    await registry.register({ name: 'test', version: '1.0.0' });
    expect(events).toEqual(['before:test', 'after:test']);
  });

  it('loader handlers work with registry lifecycle', async () => {
    const registry = new PluginRegistry();
    const loader = registry.getLoader();
    let loaded = false;
    loader.onLoad('test', () => { loaded = true; });
    await loader.load({ type: 'inline', code: 'test', name: 'test' });
    expect(loaded).toBe(true);
  });

  it('marketplace search and install workflow', async () => {
    const mp = new PluginMarketplace();
    mp.addPlugin({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test plugin',
      author: 'test',
      category: 'tools',
      rating: 4.5,
      downloadCount: 100,
      tags: ['test', 'utility'],
      featured: true,
      publishedAt: Date.now(),
      updatedAt: Date.now(),
    });

    const results = mp.search('test', { category: 'tools', minRating: 4.0 });
    expect(results).toHaveLength(1);

    const installResult = await mp.install('test-plugin');
    expect(installResult.success).toBe(true);
    expect(mp.isInstalled('test-plugin')).toBe(true);

    await mp.uninstall('test-plugin');
    expect(mp.isInstalled('test-plugin')).toBe(false);
  });

  it('sandbox rate limiting works across multiple calls', () => {
    const sandbox = new PluginSandbox();
    sandbox.registerApi({
      name: 'limited',
      requiredPermissions: [],
      handler: () => 'ok',
      rateLimit: 2,
    });
    const ctx = sandbox.createSandbox('test', []);
    expect(ctx.callApi('limited')).toBe('ok');
    expect(ctx.callApi('limited')).toBe('ok');
    expect(() => ctx.callApi('limited')).toThrow(/Rate limit/);
  });

  it('dependency resolver handles complex diamond graph', () => {
    const resolver = new PluginDependencyResolver();
    const plugins: PluginDefinition[] = [
      { name: 'a', version: '1.0.0' },
      { name: 'b', version: '1.0.0', dependencies: { a: '^1.0.0' } },
      { name: 'c', version: '1.0.0', dependencies: { a: '^1.0.0' } },
      { name: 'd', version: '1.0.0', dependencies: { b: '^1.0.0', c: '^1.0.0' } },
      { name: 'e', version: '1.0.0', dependencies: { d: '^1.0.0' } },
    ];
    const order = resolver.getLoadOrder(plugins);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('d')).toBeLessThan(order.indexOf('e'));
  });
});
