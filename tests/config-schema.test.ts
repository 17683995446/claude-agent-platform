// ============================================================================
// Tests for @claude-agent/config-schema
// ============================================================================
import { describe, test, expect } from 'bun:test';
import { SchemaManager, EnvSchema, DatabaseSchema, CacheSchema, SecuritySchema, PlatformSchema, loadEnvConfig, createPlatformConfig } from '../packages/config-schema/src/index.js';

describe('@claude-agent/config-schema', () => {
  describe('SchemaManager', () => {
    test('creates with default schemas', () => {
      const mgr = SchemaManager.create();
      expect(mgr.get('env')).toBeDefined();
      expect(mgr.get('database')).toBeDefined();
      expect(mgr.get('cache')).toBeDefined();
      expect(mgr.get('security')).toBeDefined();
      expect(mgr.get('platform')).toBeDefined();
    });

    test('registers custom schema', () => {
      const mgr = SchemaManager.create();
      mgr.register('test', EnvSchema);
      expect(mgr.get('test')).toBeDefined();
    });

    test('validates valid data', () => {
      const mgr = SchemaManager.create();
      const result = mgr.validate('env', { NODE_ENV: 'production', LOG_LEVEL: 'debug' });
      expect(result.success).toBe(true);
    });

    test('validates invalid data', () => {
      const mgr = SchemaManager.create();
      const result = mgr.validate('env', { NODE_ENV: 'invalid' });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    test('validates unknown schema', () => {
      const mgr = SchemaManager.create();
      const result = mgr.validate('unknown', {});
      expect(result.success).toBe(false);
    });

    test('applies env overrides', () => {
      const mgr = SchemaManager.create();
      mgr.setEnvOverride('NODE_ENV', 'production');
      const result = mgr.applyEnvOverrides(EnvSchema, {});
      expect(result.NODE_ENV).toBe('production');
    });

    test('generates documentation', () => {
      const mgr = SchemaManager.create();
      const docs = mgr.generateDocumentation();
      expect(docs).toContain('Configuration Schema Documentation');
      expect(docs).toContain('## env');
    });
  });

  describe('EnvSchema', () => {
    test('parses with defaults', () => {
      const result = EnvSchema.parse({});
      expect(result.NODE_ENV).toBe('development');
      expect(result.LOG_LEVEL).toBe('info');
      expect(result.PORT).toBe(3000);
    });

    test('parses with overrides', () => {
      const result = EnvSchema.parse({ NODE_ENV: 'production', PORT: 8080 });
      expect(result.NODE_ENV).toBe('production');
      expect(result.PORT).toBe(8080);
    });
  });

  describe('DatabaseSchema', () => {
    test('parses with defaults', () => {
      const result = DatabaseSchema.parse({});
      expect(result.type).toBe('memory');
      expect(result.ssl).toBe(false);
    });
  });

  describe('CacheSchema', () => {
    test('parses with defaults', () => {
      const result = CacheSchema.parse({});
      expect(result.type).toBe('memory');
      expect(result.ttl).toBe(3600000);
    });
  });

  describe('SecuritySchema', () => {
    test('parses with defaults', () => {
      const result = SecuritySchema.parse({});
      expect(result.corsOrigins).toEqual(['*']);
      expect(result.rateLimit.enabled).toBe(true);
    });
  });

  describe('PlatformSchema', () => {
    test('parses with defaults', () => {
      const result = PlatformSchema.parse({});
      expect(result.name).toBe('claude-agent');
      expect(result.features.commandBus).toBe(true);
    });
  });

  describe('loadEnvConfig', () => {
    test('loads environment config', () => {
      const config = loadEnvConfig();
      expect(config).toBeDefined();
      expect(config.LOG_LEVEL).toBeDefined();
    });
  });

  describe('createPlatformConfig', () => {
    test('creates with defaults', () => {
      const config = createPlatformConfig();
      expect(config.name).toBe('claude-agent');
      expect(config.version).toBe('1.0.0');
    });

    test('creates with overrides', () => {
      const config = createPlatformConfig({ name: 'custom' });
      expect(config.name).toBe('custom');
    });
  });
});
