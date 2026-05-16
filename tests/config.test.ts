// ============================================================================
// Tests for @claude-agent/config
// ============================================================================

import { describe, test, expect } from 'bun:test';
import { ConfigManager } from '../packages/config/src/index.js';

describe('@claude-agent/config', () => {
  describe('ConfigManager.create', () => {
    test('creates with default config', () => {
      const manager = ConfigManager.create();
      const config = manager.getConfig();
      expect(config.name).toBe('claude-agent');
      expect(config.version).toBe('1.0.0');
      expect(config.logLevel).toBe('info');
    });

    test('creates with partial config', () => {
      const manager = ConfigManager.create({
        name: 'custom-agent',
        logLevel: 'debug',
      });
      const config = manager.getConfig();
      expect(config.name).toBe('custom-agent');
      expect(config.logLevel).toBe('debug');
      // Defaults preserved
      expect(config.version).toBe('1.0.0');
    });

    test('creates with HTTP config', () => {
      const manager = ConfigManager.create({
        http: {
          enabled: true,
          host: '0.0.0.0',
          port: 8080,
        },
      });
      const config = manager.getConfig();
      expect(config.http?.enabled).toBe(true);
      expect(config.http?.host).toBe('0.0.0.0');
      expect(config.http?.port).toBe(8080);
    });

    test('creates with plugin config', () => {
      const manager = ConfigManager.create({
        plugins: [
          { name: 'test-plugin', enabled: true },
          { name: 'disabled-plugin', enabled: false },
        ],
      });
      const config = manager.getConfig();
      expect(config.plugins).toHaveLength(2);
      expect(config.plugins?.[0]?.name).toBe('test-plugin');
      expect(config.plugins?.[1]?.enabled).toBe(false);
    });

    test('creates with pipeline config', () => {
      const manager = ConfigManager.create({
        pipelines: [
          { name: 'test-pipeline', steps: ['step1', 'step2'] },
        ],
      });
      const config = manager.getConfig();
      expect(config.pipelines).toHaveLength(1);
      expect(config.pipelines?.[0]?.steps).toEqual(['step1', 'step2']);
    });

    test('creates with checkpoint config', () => {
      const manager = ConfigManager.create({
        checkpoint: {
          enabled: true,
          directory: '/tmp/checkpoints',
          maxRetain: 20,
        },
      });
      const config = manager.getConfig();
      expect(config.checkpoint?.enabled).toBe(true);
      expect(config.checkpoint?.directory).toBe('/tmp/checkpoints');
      expect(config.checkpoint?.maxRetain).toBe(20);
    });
  });

  describe('ConfigManager.get', () => {
    test('gets top-level config value', () => {
      const manager = ConfigManager.create({ name: 'test' });
      expect(manager.get('name')).toBe('test');
    });

    test('gets nested config value', () => {
      const manager = ConfigManager.create({
        http: { enabled: true, port: 9090 },
      });
      expect(manager.get('http.port')).toBe(9090);
    });

    test('returns undefined for missing path', () => {
      const manager = ConfigManager.create();
      expect(manager.get('nonexistent')).toBeUndefined();
    });
  });

  describe('ConfigManager.update', () => {
    test('updates config values', () => {
      const manager = ConfigManager.create();
      manager.update({ name: 'updated-agent', logLevel: 'debug' });
      const config = manager.getConfig();
      expect(config.name).toBe('updated-agent');
      expect(config.logLevel).toBe('debug');
    });
  });

  describe('ConfigManager.merge', () => {
    test('merges config values', () => {
      const manager = ConfigManager.create({
        name: 'original',
        http: { enabled: true, port: 3000 },
      });
      const merged = manager.merge({
        http: { port: 4000 },
      });
      expect(merged.name).toBe('original');
      expect(merged.http?.enabled).toBe(true);
      expect(merged.http?.port).toBe(4000);
    });
  });

  describe('ConfigManager.validate', () => {
    test('validates valid config', () => {
      const result = ConfigManager.validate({ name: 'test' });
      expect(result.success).toBe(true);
    });

    test('rejects invalid log level', () => {
      const result = ConfigManager.validate({ logLevel: 'invalid' });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    test('rejects invalid port', () => {
      const result = ConfigManager.validate({
        http: { port: 99999 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ConfigManager.onChange', () => {
    test('notifies listeners on update', () => {
      const manager = ConfigManager.create();
      const updates: string[] = [];
      const unsubscribe = manager.onChange((config) => {
        updates.push(config.name);
      });

      manager.update({ name: 'changed' });
      expect(updates).toHaveLength(1);
      expect(updates[0]).toBe('changed');

      unsubscribe();
    });

    test('unsubscribes correctly', () => {
      const manager = ConfigManager.create();
      let count = 0;
      const unsubscribe = manager.onChange(() => {
        count++;
      });

      manager.update({ name: 'first' });
      unsubscribe();
      manager.update({ name: 'second' });
      expect(count).toBe(1);
    });
  });

  describe('ConfigManager.getConfigPath', () => {
    test('returns null when no config file', () => {
      const manager = ConfigManager.create();
      expect(manager.getConfigPath()).toBeNull();
    });
  });
});
