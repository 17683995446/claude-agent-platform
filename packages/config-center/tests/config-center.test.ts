import { describe, test, expect, beforeEach } from 'bun:test';
import {
  ConfigStore,
  deepMerge,
  getByPath,
  setByPath,
  deleteByPath,
  hasByPath,
  ConfigSourceManager,
  MemoryConfigSource,
  ArgConfigSource,
  EnvConfigSource,
  ConfigValidator,
  ConfigEncryption,
  ConfigExporter,
  ConfigSnapshotManager,
  ConfigHotReloader,
  FeatureFlagManager,
  EnvironmentManager,
  ConfigAuditLog,
} from '../src/index.js';

// ============================================================
// Module 1: ConfigStore Tests
// ============================================================
describe('ConfigStore', () => {
  let store: ConfigStore;

  beforeEach(() => {
    store = new ConfigStore();
  });

  test('should create empty store', () => {
    expect(store.getAll()).toEqual({});
  });

  test('should create store with initial data', () => {
    const s = new ConfigStore({ port: 3000 });
    expect(s.get('port')).toBe(3000);
  });

  test('should set and get a simple value', () => {
    store.set('port', 3000);
    expect(store.get('port')).toBe(3000);
  });

  test('should set and get nested value with dot notation', () => {
    store.set('server.port', 3000);
    expect(store.get('server.port')).toBe(3000);
  });

  test('should set deeply nested value', () => {
    store.set('database.connection.pool.size', 10);
    expect(store.get('database.connection.pool.size')).toBe(10);
  });

  test('should return undefined for non-existent path', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  test('should check if path exists', () => {
    store.set('server.port', 3000);
    expect(store.has('server.port')).toBe(true);
    expect(store.has('server.host')).toBe(false);
  });

  test('should delete a value', () => {
    store.set('port', 3000);
    expect(store.delete('port')).toBe(true);
    expect(store.has('port')).toBe(false);
  });

  test('should return false when deleting non-existent path', () => {
    expect(store.delete('nonexistent')).toBe(false);
  });

  test('should delete nested value', () => {
    store.set('server.port', 3000);
    expect(store.delete('server.port')).toBe(true);
    expect(store.get('server.port')).toBeUndefined();
  });

  test('should merge configurations deeply', () => {
    store.set('server', { port: 3000, host: 'localhost' });
    store.merge({ server: { port: 8080, ssl: true } });
    expect(store.get('server.port')).toBe(8080);
    expect(store.get('server.host')).toBe('localhost');
    expect(store.get('server.ssl')).toBe(true);
  });

  test('should watch for changes', () => {
    const changes: Array<{ path: string; newValue: unknown; oldValue: unknown }> = [];
    store.watch('server.port', (path, newValue, oldValue) => {
      changes.push({ path, newValue, oldValue });
    });
    store.set('server.port', 3000);
    expect(changes).toHaveLength(1);
    expect(changes[0].newValue).toBe(3000);
  });

  test('should unwatch', () => {
    const changes: unknown[] = [];
    const unwatch = store.watch('port', () => changes.push(1));
    store.set('port', 3000);
    expect(changes).toHaveLength(1);
    unwatch();
    store.set('port', 8080);
    expect(changes).toHaveLength(1);
  });

  test('should clear all data', () => {
    store.set('port', 3000);
    store.set('host', 'localhost');
    store.clear();
    expect(store.getAll()).toEqual({});
  });

  test('should create version snapshots', () => {
    store.set('port', 3000);
    const versionId = store.createVersion('initial');
    expect(versionId).toBeTruthy();
    store.set('port', 8080);
    expect(store.getVersions()).toHaveLength(1);
  });

  test('should restore to a version', () => {
    store.set('port', 3000);
    store.createVersion('v1');
    store.set('port', 8080);
    expect(store.get('port')).toBe(8080);
    store.restoreVersion('v1');
    expect(store.get('port')).toBe(3000);
  });

  test('should return false for non-existent version restore', () => {
    expect(store.restoreVersion('nonexistent')).toBe(false);
  });

  test('getAll returns a shallow copy', () => {
    store.set('port', 3000);
    const copy = store.getAll();
    copy.port = 9999;
    expect(store.get('port')).toBe(3000);
  });
});

// ============================================================
// Helper functions tests
// ============================================================
describe('Helper Functions', () => {
  test('deepMerge merges objects', () => {
    const result = deepMerge({ a: 1, b: { c: 2 } }, { b: { d: 3 }, e: 4 });
    expect(result).toEqual({ a: 1, b: { c: 2, d: 3 }, e: 4 });
  });

  test('getByPath retrieves nested values', () => {
    expect(getByPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
    expect(getByPath({ a: 1 }, 'b.c')).toBeUndefined();
  });

  test('setByPath sets nested values', () => {
    const obj: Record<string, unknown> = {};
    setByPath(obj, 'a.b.c', 42);
    expect(obj).toEqual({ a: { b: { c: 42 } } });
  });

  test('deleteByPath removes nested values', () => {
    const obj: Record<string, unknown> = { a: { b: { c: 42 } } };
    expect(deleteByPath(obj, 'a.b.c')).toBe(true);
    expect(obj).toEqual({ a: { b: {} } });
  });

  test('hasByPath checks nested existence', () => {
    expect(hasByPath({ a: { b: 1 } }, 'a.b')).toBe(true);
    expect(hasByPath({ a: { b: 1 } }, 'a.c')).toBe(false);
  });
});

// ============================================================
// Module 2: Config Sources Tests
// ============================================================
describe('ConfigSourceManager', () => {
  let manager: ConfigSourceManager;

  beforeEach(() => {
    manager = new ConfigSourceManager();
  });

  test('should add and list sources', () => {
    const source = new MemoryConfigSource({ port: 3000 });
    manager.addSource(source, 1);
    expect(manager.getSourceNames()).toContain('memory');
  });

  test('should load all sources merged by priority', async () => {
    const low = new MemoryConfigSource({ port: 3000 }, 'low');
    const high = new MemoryConfigSource({ port: 8080, debug: true }, 'high');
    manager.addSource(low, 1);
    manager.addSource(high, 10);
    const result = await manager.loadAll();
    expect(result.port).toBe(8080);
    expect(result.debug).toBe(true);
  });

  test('should reload a specific source', async () => {
    const mem = new MemoryConfigSource({ port: 3000 }, 'mem');
    manager.addSource(mem, 1);
    mem.update({ port: 8080 });
    const result = await manager.reload('mem');
    expect(result.port).toBe(8080);
  });

  test('should throw when reloading non-existent source', async () => {
    await expect(manager.reload('nonexistent')).rejects.toThrow();
  });

  test('should remove a source', () => {
    const source = new MemoryConfigSource({}, 'test');
    manager.addSource(source, 1);
    expect(manager.removeSource('test')).toBe(true);
    expect(manager.getSourceNames()).not.toContain('test');
  });

  test('should get a source by name', () => {
    const source = new MemoryConfigSource({}, 'test');
    manager.addSource(source, 1);
    expect(manager.getSource('test')).toBe(source);
  });
});

describe('ArgConfigSource', () => {
  test('should parse --key=value format', async () => {
    const source = new ArgConfigSource(['--port=3000', '--host=localhost']);
    const result = await source.load();
    expect(result.port).toBe(3000);
    expect(result.host).toBe('localhost');
  });

  test('should parse boolean flags', async () => {
    const source = new ArgConfigSource(['--verbose', '--debug']);
    const result = await source.load();
    expect(result.verbose).toBe(true);
    expect(result.debug).toBe(true);
  });

  test('should parse flag with next arg value', async () => {
    const source = new ArgConfigSource(['--port', '3000']);
    const result = await source.load();
    expect(result.port).toBe(3000);
  });

  test('should convert dashes to dots', async () => {
    const source = new ArgConfigSource(['--server-port=3000']);
    const result = await source.load();
    expect(result.server?.port).toBe(3000);
  });
});

describe('EnvConfigSource', () => {
  test('should load environment variables', async () => {
    process.env.TEST_CONFIG_PORT = '3000';
    const source = new EnvConfigSource({ prefix: 'TEST_CONFIG_' });
    const result = await source.load();
    expect(result.port).toBe(3000);
    delete process.env.TEST_CONFIG_PORT;
  });

  test('should convert double underscore to nested keys', async () => {
    process.env.TEST_DB__HOST = 'localhost';
    const source = new EnvConfigSource({ prefix: 'TEST_', separator: '__' });
    const result = await source.load();
    expect(result.db.host).toBe('localhost');
    delete process.env.TEST_DB__HOST;
  });

  test('should parse boolean env values', async () => {
    process.env.TEST_DEBUG = 'true';
    const source = new EnvConfigSource({ prefix: 'TEST_' });
    const result = await source.load();
    expect(result.debug).toBe(true);
    delete process.env.TEST_DEBUG;
  });

  test('should parse number env values', async () => {
    process.env.TEST_PORT = '8080';
    const source = new EnvConfigSource({ prefix: 'TEST_' });
    const result = await source.load();
    expect(result.port).toBe(8080);
    delete process.env.TEST_PORT;
  });
});

describe('MemoryConfigSource', () => {
  test('should load stored data', async () => {
    const source = new MemoryConfigSource({ key: 'value' });
    const result = await source.load();
    expect(result.key).toBe('value');
  });

  test('should update data', async () => {
    const source = new MemoryConfigSource({ key: 'old' });
    source.update({ key: 'new' });
    const result = await source.load();
    expect(result.key).toBe('new');
  });
});

// ============================================================
// Module 3: Config Validation Tests
// ============================================================
describe('ConfigValidator', () => {
  let validator: ConfigValidator;

  beforeEach(() => {
    validator = new ConfigValidator();
  });

  test('should validate type string', () => {
    const result = validator.validate('name', 'hello', { type: 'string' });
    expect(result.valid).toBe(true);
  });

  test('should fail type mismatch', () => {
    const result = validator.validate('age', 'not-a-number', { type: 'number' });
    expect(result.valid).toBe(false);
    expect(result.errors[0].constraint).toBe('type');
  });

  test('should validate required field', () => {
    const result = validator.validate('name', undefined, { required: true });
    expect(result.valid).toBe(false);
    expect(result.errors[0].constraint).toBe('required');
  });

  test('should use default value when undefined', () => {
    const result = validator.validate('port', undefined, { default: 3000 });
    expect(result.valid).toBe(true);
    expect(result.value).toBe(3000);
  });

  test('should validate min constraint', () => {
    const result = validator.validate('age', 5, { type: 'number', min: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors[0].constraint).toBe('min');
  });

  test('should validate max constraint', () => {
    const result = validator.validate('age', 150, { type: 'number', max: 120 });
    expect(result.valid).toBe(false);
    expect(result.errors[0].constraint).toBe('max');
  });

  test('should validate minLength', () => {
    const result = validator.validate('name', 'ab', { type: 'string', minLength: 3 });
    expect(result.valid).toBe(false);
  });

  test('should validate maxLength', () => {
    const result = validator.validate('name', 'abcdef', { type: 'string', maxLength: 5 });
    expect(result.valid).toBe(false);
  });

  test('should validate pattern', () => {
    const result = validator.validate('email', 'invalid', { type: 'string', pattern: '^[\\w.-]+@[\\w.-]+\\.\\w+$' });
    expect(result.valid).toBe(false);
    expect(result.errors[0].constraint).toBe('pattern');
  });

  test('should validate enum', () => {
    const result = validator.validate('role', 'admin', { enum: ['user', 'guest'] });
    expect(result.valid).toBe(false);
    expect(result.errors[0].constraint).toBe('enum');
  });

  test('should validate with custom function', () => {
    const result = validator.validate('password', '123', {
      custom: (v) => (String(v).length < 6 ? 'Too short' : null),
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].constraint).toBe('custom');
  });

  test('should coerce value type', () => {
    const result = validator.validate('port', '3000', { type: 'number', coerce: true });
    expect(result.valid).toBe(true);
    expect(result.value).toBe(3000);
  });

  test('should validateAll with multiple schemas', () => {
    const report = validator.validateAll(
      { port: 3000, host: 'localhost' },
      {
        port: { type: 'number', min: 1, max: 65535 },
        host: { type: 'string', required: true },
      },
    );
    expect(report.valid).toBe(true);
  });

  test('should validateAll and report all errors', () => {
    const report = validator.validateAll(
      { port: -1, name: '' },
      {
        port: { type: 'number', min: 1 },
        name: { type: 'string', minLength: 1 },
      },
    );
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThanOrEqual(2);
  });

  test('should register and remove schemas', () => {
    validator.registerSchema('port', { type: 'number' });
    expect(validator.getSchemaPaths()).toContain('port');
    expect(validator.removeSchema('port')).toBe(true);
    expect(validator.getSchemaPaths()).not.toContain('port');
  });

  test('should validate cross-field dependencies', () => {
    const report = validator.validateAll(
      { useSSL: true },
      {
        useSSL: { type: 'boolean' },
        certPath: {
          type: 'string',
          dependencies: {
            useSSL: (_val, allValues) => (allValues.useSSL === true ? 'certPath is required when useSSL is true' : null),
          },
        },
      },
    );
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.constraint === 'dependency')).toBe(true);
  });
});

// ============================================================
// Module 4: Config Encryption Tests
// ============================================================
describe('ConfigEncryption', () => {
  let encryption: ConfigEncryption;

  beforeEach(() => {
    encryption = new ConfigEncryption();
  });

  test('should encrypt and decrypt a value', async () => {
    const encrypted = await encryption.encrypt('my-secret', 'master-key');
    expect(encryption.isEncrypted(encrypted)).toBe(true);
    const decrypted = await encryption.decrypt(encrypted, 'master-key');
    expect(decrypted).toBe('my-secret');
  });

  test('should detect encrypted values', () => {
    expect(encryption.isEncrypted('enc:abc123')).toBe(true);
    expect(encryption.isEncrypted('plain-text')).toBe(false);
    expect(encryption.isEncrypted('')).toBe(false);
  });

  test('should throw when decrypting non-encrypted value', async () => {
    await expect(encryption.decrypt('plain-text', 'key')).rejects.toThrow();
  });

  test('should throw when decrypting with wrong key', async () => {
    const encrypted = await encryption.encrypt('secret', 'key1');
    await expect(encryption.decrypt(encrypted, 'key2')).rejects.toThrow();
  });

  test('should set and get secrets via store', async () => {
    const store = new ConfigStore();
    await encryption.setSecret('db.password', 'mypassword', 'master', store);
    const raw = store.get('db.password');
    expect(encryption.isEncrypted(raw as string)).toBe(true);
    const value = await encryption.getSecret('db.password', 'master', store);
    expect(value).toBe('mypassword');
  });

  test('should throw when getting non-existent secret', async () => {
    const store = new ConfigStore();
    await expect(encryption.getSecret('missing', 'key', store)).rejects.toThrow();
  });

  test('should clear key cache', async () => {
    await encryption.encrypt('test', 'key');
    encryption.clearKeyCache();
    // Should still work after clearing cache (re-derives key)
    const encrypted = await encryption.encrypt('test', 'key');
    expect(encryption.isEncrypted(encrypted)).toBe(true);
  });

  test('should handle empty string encryption', async () => {
    const encrypted = await encryption.encrypt('', 'key');
    const decrypted = await encryption.decrypt(encrypted, 'key');
    expect(decrypted).toBe('');
  });
});

// ============================================================
// Module 5: Config Export Tests
// ============================================================
describe('ConfigExporter', () => {
  let store: ConfigStore;
  let exporter: ConfigExporter;

  beforeEach(() => {
    store = new ConfigStore({ server: { port: 3000, host: 'localhost' }, debug: true });
    exporter = new ConfigExporter(store);
  });

  test('should export as JSON', () => {
    const json = exporter.export('json');
    const parsed = JSON.parse(json);
    expect(parsed.server.port).toBe(3000);
  });

  test('should export as YAML-like', () => {
    const yaml = exporter.export('yaml');
    expect(yaml).toContain('port: 3000');
    expect(yaml).toContain('host: "localhost"');
  });

  test('should export as dotenv', () => {
    const dotenv = exporter.export('dotenv');
    expect(dotenv).toContain('SERVER_PORT=3000');
    expect(dotenv).toContain('DEBUG=true');
  });

  test('should export as TypeScript', () => {
    const ts = exporter.export('typescript');
    expect(ts).toContain('export const config');
    expect(ts).toContain('as const');
  });

  test('should mask secrets in export', () => {
    store.set('db.password', 'secret123');
    const json = exporter.export('json', { maskSecrets: true, secretPaths: ['db.password'] });
    const parsed = JSON.parse(json);
    expect(parsed.db.password).toBe('*****');
  });

  test('should include only specified paths', () => {
    const json = exporter.export('json', { include: ['server'] });
    const parsed = JSON.parse(json);
    expect(parsed.server).toBeDefined();
    expect(parsed.debug).toBeUndefined();
  });

  test('should exclude specified paths', () => {
    const json = exporter.export('json', { exclude: ['debug'] });
    const parsed = JSON.parse(json);
    expect(parsed.debug).toBeUndefined();
    expect(parsed.server).toBeDefined();
  });

  test('should import from JSON', () => {
    const data = exporter.export('json');
    const imported = exporter.importConfig(data, 'json');
    expect(imported.server.port).toBe(3000);
  });

  test('should import from dotenv', () => {
    const dotenv = 'DB_HOST=localhost\nDB_PORT=5432';
    const imported = exporter.importConfig(dotenv, 'dotenv');
    expect(imported.db.host).toBe('localhost');
    expect(imported.db.port).toBe(5432);
  });

  test('should diff two configurations', () => {
    const config1 = { port: 3000, host: 'localhost' };
    const config2 = { port: 8080, debug: true };
    const diff = exporter.diff(config1, config2);
    expect(diff.changed.some((c) => c.path === 'port')).toBe(true);
    expect(diff.added).toContain('debug');
    expect(diff.removed).toContain('host');
  });
});

// ============================================================
// Module 6: Config Snapshot Tests
// ============================================================
describe('ConfigSnapshotManager', () => {
  let store: ConfigStore;
  let snapshotManager: ConfigSnapshotManager;

  beforeEach(() => {
    store = new ConfigStore({ port: 3000 });
    snapshotManager = new ConfigSnapshotManager(store);
  });

  test('should create a snapshot', () => {
    const snap = snapshotManager.createSnapshot('initial');
    expect(snap.id).toBeTruthy();
    expect(snap.label).toBe('initial');
    expect(snap.data.port).toBe(3000);
  });

  test('should list snapshots', () => {
    snapshotManager.createSnapshot('snap1');
    snapshotManager.createSnapshot('snap2');
    const list = snapshotManager.listSnapshots();
    expect(list).toHaveLength(2);
  });

  test('should restore a snapshot', () => {
    snapshotManager.createSnapshot('v1');
    store.set('port', 8080);
    expect(store.get('port')).toBe(8080);
    const snaps = snapshotManager.listSnapshots();
    snapshotManager.restoreSnapshot(snaps[0].id);
    expect(store.get('port')).toBe(3000);
  });

  test('should return false for non-existent snapshot restore', () => {
    expect(snapshotManager.restoreSnapshot('nonexistent')).toBe(false);
  });

  test('should compare two snapshots', () => {
    snapshotManager.createSnapshot('v1');
    store.set('port', 8080);
    snapshotManager.createSnapshot('v2');
    const snaps = snapshotManager.listSnapshots();
    const diff = snapshotManager.compareSnapshots(snaps[1].id, snaps[0].id);
    expect(diff.changed.some((c) => c.path === 'port')).toBe(true);
  });

  test('should delete a snapshot', () => {
    const snap = snapshotManager.createSnapshot('temp');
    expect(snapshotManager.deleteSnapshot(snap.id)).toBe(true);
    expect(snapshotManager.listSnapshots()).toHaveLength(0);
  });

  test('should toggle auto snapshot', () => {
    expect(snapshotManager.isAutoSnapshotEnabled()).toBe(false);
    snapshotManager.setAutoSnapshot(true);
    expect(snapshotManager.isAutoSnapshotEnabled()).toBe(true);
  });

  test('should get snapshot count', () => {
    expect(snapshotManager.getSnapshotCount()).toBe(0);
    snapshotManager.createSnapshot('s1');
    expect(snapshotManager.getSnapshotCount()).toBe(1);
  });
});

// ============================================================
// Module 7: Config Hot Reload Tests
// ============================================================
describe('ConfigHotReloader', () => {
  let store: ConfigStore;
  let sourceManager: ConfigSourceManager;
  let reloader: ConfigHotReloader;

  beforeEach(() => {
    store = new ConfigStore();
    sourceManager = new ConfigSourceManager();
    reloader = new ConfigHotReloader(store, sourceManager);
  });

  test('should start and stop watching', () => {
    reloader.startWatching();
    expect(reloader.isWatching()).toBe(true);
    reloader.stopWatching();
    expect(reloader.isWatching()).toBe(false);
  });

  test('should register reload callback', () => {
    const events: unknown[] = [];
    reloader.onReload((e) => events.push(e));
    reloader.startWatching();
    // Manually trigger via the internal method
    reloader.triggerReload('test');
    // Stop to allow debounce timer to be checked
    reloader.stopWatching();
  });

  test('should have empty reload history initially', () => {
    expect(reloader.getReloadHistory()).toHaveLength(0);
  });

  test('should clear history', () => {
    reloader.clearHistory();
    expect(reloader.getReloadHistory()).toHaveLength(0);
  });

  test('should not trigger reload when not watching', () => {
    const events: unknown[] = [];
    reloader.onReload((e) => events.push(e));
    reloader.triggerReload('test');
    expect(events).toHaveLength(0);
  });

  test('should execute reload for registered source', async () => {
    const memSource = new MemoryConfigSource({ port: 3000 }, 'mem');
    sourceManager.addSource(memSource, 1);
    reloader.startWatching();

    const events: unknown[] = [];
    reloader.onReload((e) => events.push(e));

    memSource.update({ port: 8080 });
    reloader.triggerReload('mem');

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 400));
    reloader.stopWatching();

    expect(events.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Module 8: Feature Flag Tests
// ============================================================
describe('FeatureFlagManager', () => {
  let manager: FeatureFlagManager;

  beforeEach(() => {
    manager = new FeatureFlagManager();
  });

  test('should set and get a boolean flag', () => {
    manager.setFlag('dark-mode', { type: 'boolean', enabled: true });
    const flag = manager.getFlag('dark-mode');
    expect(flag).toBeDefined();
    expect(flag!.enabled).toBe(true);
  });

  test('should check isEnabled for boolean flag', () => {
    manager.setFlag('feature-a', { type: 'boolean', enabled: true });
    expect(manager.isEnabled('feature-a')).toBe(true);
  });

  test('should return false for non-existent flag', () => {
    expect(manager.isEnabled('nonexistent')).toBe(false);
  });

  test('should get variant for A/B test', () => {
    manager.setFlag('new-ui', {
      type: 'variant',
      variants: { control: 50, experiment: 50 },
      defaultVariant: 'control',
    });
    const variant = manager.getVariant('new-ui', { userId: 'user1' });
    expect(['control', 'experiment']).toContain(variant);
  });

  test('should return default variant for non-variant flag', () => {
    manager.setFlag('simple', { type: 'boolean', enabled: true, defaultVariant: 'control' });
    expect(manager.getVariant('simple')).toBe('control');
  });

  test('should enable and disable flags', () => {
    manager.setFlag('feature', { type: 'boolean', enabled: false });
    expect(manager.isEnabled('feature')).toBe(false);
    manager.enableFlag('feature');
    expect(manager.isEnabled('feature')).toBe(true);
    manager.disableFlag('feature');
    expect(manager.isEnabled('feature')).toBe(false);
  });

  test('should archive a flag', () => {
    manager.setFlag('old-feature', { type: 'boolean', enabled: true });
    manager.archiveFlag('old-feature');
    expect(manager.isEnabled('old-feature')).toBe(false);
  });

  test('should remove a flag', () => {
    manager.setFlag('temp', { type: 'boolean', enabled: true });
    expect(manager.removeFlag('temp')).toBe(true);
    expect(manager.getFlag('temp')).toBeUndefined();
  });

  test('should list all flags', () => {
    manager.setFlag('a', { type: 'boolean', enabled: true });
    manager.setFlag('b', { type: 'boolean', enabled: false });
    expect(manager.listFlags()).toHaveLength(2);
  });

  test('should track flag stats', () => {
    manager.setFlag('feature', { type: 'boolean', enabled: true });
    manager.isEnabled('feature');
    manager.isEnabled('feature');
    const stats = manager.getFlagStats('feature');
    expect(stats).toBeDefined();
    expect(stats!.totalEvaluations).toBe(2);
    expect(stats!.enabledCount).toBe(2);
  });

  test('should apply user segment rule', () => {
    manager.setFlag('beta', {
      type: 'boolean',
      enabled: false,
      rules: [{ type: 'segment', segment: 'beta-testers', enabled: true }],
    });
    expect(manager.isEnabled('beta', { segment: 'beta-testers' })).toBe(true);
    expect(manager.isEnabled('beta', { segment: 'regular' })).toBe(false);
  });

  test('should apply user ID rule', () => {
    manager.setFlag('internal', {
      type: 'boolean',
      enabled: false,
      rules: [{ type: 'user', userIds: ['user1', 'user2'], enabled: true }],
    });
    expect(manager.isEnabled('internal', { userId: 'user1' })).toBe(true);
    expect(manager.isEnabled('internal', { userId: 'user3' })).toBe(false);
  });

  test('should apply rollout percentage', () => {
    manager.setFlag('gradual', {
      type: 'rollout',
      rolloutPercentage: 100,
      enabled: false,
    });
    expect(manager.isEnabled('gradual', { userId: 'any' })).toBe(true);
  });

  test('should notify on flag change', () => {
    const changes: unknown[] = [];
    manager.onChange((name, oldConfig, newConfig) => {
      changes.push({ name, oldConfig, newConfig });
    });
    manager.setFlag('feature', { type: 'boolean', enabled: true });
    expect(changes).toHaveLength(1);
  });

  test('should reset stats', () => {
    manager.setFlag('f', { type: 'boolean', enabled: true });
    manager.isEnabled('f');
    manager.resetStats('f');
    const stats = manager.getFlagStats('f');
    expect(stats).toBeUndefined();
  });
});

// ============================================================
// Module 9: Environment Manager Tests
// ============================================================
describe('EnvironmentManager', () => {
  let envManager: EnvironmentManager;

  beforeEach(() => {
    envManager = new EnvironmentManager({ port: 3000, host: 'localhost' });
  });

  test('should have built-in environments', () => {
    const envs = envManager.listEnvironments();
    expect(envs).toContain('development');
    expect(envs).toContain('test');
    expect(envs).toContain('staging');
    expect(envs).toContain('production');
  });

  test('should get and set current environment', () => {
    expect(envManager.getEnvironment()).toBe('development');
    envManager.setEnvironment('production');
    expect(envManager.getEnvironment()).toBe('production');
  });

  test('should throw for unregistered environment', () => {
    expect(() => envManager.setEnvironment('nonexistent')).toThrow();
  });

  test('should get environment-specific config', () => {
    envManager.registerEnvironment('production', { port: 8080, debug: false });
    const config = envManager.getEnvConfig('production');
    expect(config.port).toBe(8080);
    expect(config.host).toBe('localhost');
    expect(config.debug).toBe(false);
  });

  test('should get current config', () => {
    envManager.registerEnvironment('staging', { port: 5000 });
    envManager.setEnvironment('staging');
    const config = envManager.getCurrentConfig();
    expect(config.port).toBe(5000);
  });

  test('should compare environments', () => {
    envManager.registerEnvironment('staging', { port: 5000, debug: true });
    envManager.registerEnvironment('production', { port: 8080, debug: false });
    const diff = envManager.compareEnvironments('staging', 'production');
    expect(diff.differentValues.some((d) => d.path === 'port')).toBe(true);
    expect(diff.differentValues.some((d) => d.path === 'debug')).toBe(true);
  });

  test('should validate environment required fields', () => {
    envManager.registerEnvironment('production', {}, ['db.url']);
    const result = envManager.validateEnvironment('production');
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('db.url');
  });

  test('should validate valid environment', () => {
    envManager.registerEnvironment('production', { db: { url: 'postgres://...' } }, ['db.url']);
    const result = envManager.validateEnvironment('production');
    expect(result.valid).toBe(true);
  });

  test('should interpolate environment variables', () => {
    process.env.TEST_INTERP_VAR = 'interpolated-value';
    const config = { greeting: '${ENV:TEST_INTERP_VAR}' };
    const result = envManager.interpolate(config);
    expect(result.greeting).toBe('interpolated-value');
    delete process.env.TEST_INTERP_VAR;
  });

  test('should interpolate nested values', () => {
    process.env.TEST_DB_HOST = 'db.example.com';
    const config = { database: { host: '${ENV:TEST_DB_HOST}' } };
    const result = envManager.interpolate(config);
    expect(result.database.host).toBe('db.example.com');
    delete process.env.TEST_DB_HOST;
  });

  test('should update base config', () => {
    envManager.updateBaseConfig({ version: '1.0' });
    const config = envManager.getCurrentConfig();
    expect(config.version).toBe('1.0');
  });

  test('should update environment overrides', () => {
    envManager.updateEnvironmentOverrides('production', { ssl: true });
    const config = envManager.getEnvConfig('production');
    expect(config.ssl).toBe(true);
  });

  test('should remove environment', () => {
    envManager.registerEnvironment('custom', {});
    expect(envManager.removeEnvironment('custom')).toBe(true);
    expect(envManager.listEnvironments()).not.toContain('custom');
  });

  test('should not remove current environment', () => {
    expect(envManager.removeEnvironment('development')).toBe(false);
  });

  test('should register custom environment', () => {
    envManager.registerEnvironment('preview', { port: 4000 });
    expect(envManager.listEnvironments()).toContain('preview');
    const config = envManager.getEnvConfig('preview');
    expect(config.port).toBe(4000);
  });
});

// ============================================================
// Module 10: Config Audit Log Tests
// ============================================================
describe('ConfigAuditLog', () => {
  let auditLog: ConfigAuditLog;

  beforeEach(() => {
    auditLog = new ConfigAuditLog();
  });

  test('should log a change', () => {
    auditLog.logChange({
      timestamp: Date.now(),
      actor: 'system',
      action: 'set',
      path: 'server.port',
      oldValue: 3000,
      newValue: 8080,
    });
    expect(auditLog.getEntryCount()).toBe(1);
  });

  test('should query history by path', () => {
    auditLog.logChange({ timestamp: 1, actor: 'user', action: 'set', path: 'a.b', newValue: 1 });
    auditLog.logChange({ timestamp: 2, actor: 'user', action: 'set', path: 'c.d', newValue: 2 });
    const history = auditLog.getHistory('a.b');
    expect(history).toHaveLength(1);
    expect(history[0].path).toBe('a.b');
  });

  test('should query history by actor', () => {
    auditLog.logChange({ timestamp: 1, actor: 'alice', action: 'set', path: 'x', newValue: 1 });
    auditLog.logChange({ timestamp: 2, actor: 'bob', action: 'set', path: 'y', newValue: 2 });
    const history = auditLog.getHistory(undefined, { actor: 'alice' });
    expect(history).toHaveLength(1);
    expect(history[0].actor).toBe('alice');
  });

  test('should query history by time range', () => {
    auditLog.logChange({ timestamp: 1000, actor: 'user', action: 'set', path: 'a', newValue: 1 });
    auditLog.logChange({ timestamp: 2000, actor: 'user', action: 'set', path: 'b', newValue: 2 });
    auditLog.logChange({ timestamp: 3000, actor: 'user', action: 'set', path: 'c', newValue: 3 });
    const history = auditLog.getHistory(undefined, { startTime: 1500, endTime: 2500 });
    expect(history).toHaveLength(1);
    expect(history[0].path).toBe('b');
  });

  test('should query history by action', () => {
    auditLog.logChange({ timestamp: 1, actor: 'user', action: 'set', path: 'a', newValue: 1 });
    auditLog.logChange({ timestamp: 2, actor: 'user', action: 'delete', path: 'b' });
    const history = auditLog.getHistory(undefined, { action: 'delete' });
    expect(history).toHaveLength(1);
  });

  test('should support pagination', () => {
    for (let i = 0; i < 10; i++) {
      auditLog.logChange({ timestamp: i, actor: 'user', action: 'set', path: `k${i}`, newValue: i });
    }
    const page1 = auditLog.getHistory(undefined, { limit: 3, offset: 0 });
    const page2 = auditLog.getHistory(undefined, { limit: 3, offset: 3 });
    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page1[0].path).not.toBe(page2[0].path);
  });

  test('should generate change summary', () => {
    const now = Date.now();
    auditLog.logChange({ timestamp: now - 100, actor: 'alice', action: 'set', path: 'a', newValue: 1 });
    auditLog.logChange({ timestamp: now - 50, actor: 'bob', action: 'delete', path: 'b' });
    const summary = auditLog.getChangeSummary('1h');
    expect(summary.totalChanges).toBe(2);
    expect(summary.changesByAction['set']).toBe(1);
    expect(summary.changesByAction['delete']).toBe(1);
    expect(summary.changesByActor['alice']).toBe(1);
    expect(summary.mostChangedPaths.length).toBeGreaterThan(0);
  });

  test('should export audit log as JSON', () => {
    auditLog.logChange({ timestamp: 1, actor: 'user', action: 'set', path: 'a', newValue: 1 });
    const json = auditLog.exportAuditLog('json');
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].path).toBe('a');
  });

  test('should export audit log as CSV', () => {
    auditLog.logChange({ timestamp: 1, actor: 'user', action: 'set', path: 'a', newValue: 1 });
    const csv = auditLog.exportAuditLog('csv');
    expect(csv).toContain('timestamp,actor,action,path');
    expect(csv).toContain('user,set,a');
  });

  test('should detect sensitive path changes', () => {
    const alerts: unknown[] = [];
    auditLog.setSensitivePaths(['db.password']);
    auditLog.onSensitiveChange((entry) => alerts.push(entry));
    auditLog.logChange({
      timestamp: 1,
      actor: 'admin',
      action: 'set',
      path: 'db.password',
      newValue: 'new-secret',
    });
    expect(alerts).toHaveLength(1);
  });

  test('should not alert for non-sensitive changes', () => {
    const alerts: unknown[] = [];
    auditLog.setSensitivePaths(['db.password']);
    auditLog.onSensitiveChange((entry) => alerts.push(entry));
    auditLog.logChange({
      timestamp: 1,
      actor: 'admin',
      action: 'set',
      path: 'server.port',
      newValue: 8080,
    });
    expect(alerts).toHaveLength(0);
  });

  test('should clear audit log', () => {
    auditLog.logChange({ timestamp: 1, actor: 'user', action: 'set', path: 'a', newValue: 1 });
    auditLog.clear();
    expect(auditLog.getEntryCount()).toBe(0);
  });

  test('should unsubscribe from sensitive change alerts', () => {
    const alerts: unknown[] = [];
    auditLog.setSensitivePaths(['secret']);
    const unsub = auditLog.onSensitiveChange((entry) => alerts.push(entry));
    auditLog.logChange({ timestamp: 1, actor: 'user', action: 'set', path: 'secret', newValue: 'x' });
    expect(alerts).toHaveLength(1);
    unsub();
    auditLog.logChange({ timestamp: 2, actor: 'user', action: 'set', path: 'secret', newValue: 'y' });
    expect(alerts).toHaveLength(1);
  });
});
