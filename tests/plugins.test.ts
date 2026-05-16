// ============================================================================
// Tests for @claude-agent/plugins
// ============================================================================

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  PluginSystem,
  createAnalyzerPlugin,
  createTesterPlugin,
  createDevOpsPlugin,
  createGraphPlugin,
  createDesignPlugin,
  createMonitorPlugin,
} from '../packages/plugins/src/index.js';
import { PluginError, PluginNotFoundError } from '../packages/errors/src/index.js';
import { Logger } from '../packages/logger/src/index.js';
import { EventBus } from '../packages/core/src/index.js';

describe('@claude-agent/plugins', () => {
  let system: PluginSystem;

  beforeEach(() => {
    system = new PluginSystem({
      logger: new Logger({ level: 'silent' }),
      eventBus: new EventBus(),
    });
  });

  describe('PluginSystem', () => {
    test('registers a plugin', () => {
      system.register(createAnalyzerPlugin());
      expect(system.list()).toContain('analyzer');
    });

    test('throws when registering duplicate', () => {
      system.register(createAnalyzerPlugin());
      expect(() => system.register(createAnalyzerPlugin())).toThrow(PluginError);
    });

    test('unregisters a plugin', async () => {
      system.register(createAnalyzerPlugin());
      await system.unregister('analyzer');
      expect(system.list()).not.toContain('analyzer');
    });

    test('throws when unregistering unknown plugin', async () => {
      await expect(system.unregister('unknown')).rejects.toThrow(PluginNotFoundError);
    });

    test('gets a plugin by name', () => {
      system.register(createAnalyzerPlugin());
      const plugin = system.get('analyzer');
      expect(plugin).toBeDefined();
      expect(plugin?.name).toBe('analyzer');
    });

    test('returns undefined for unknown plugin', () => {
      expect(system.get('unknown')).toBeUndefined();
    });

    test('has checks plugin existence', () => {
      expect(system.has('analyzer')).toBe(false);
      system.register(createAnalyzerPlugin());
      expect(system.has('analyzer')).toBe(true);
    });

    test('initializes all plugins', async () => {
      system.register(createAnalyzerPlugin());
      system.register(createTesterPlugin());
      await system.initializeAll();
      expect(system.activeCount()).toBe(2);
    });

    test('destroyAll removes all plugins', async () => {
      system.register(createAnalyzerPlugin());
      system.register(createTesterPlugin());
      await system.initializeAll();
      await system.destroyAll();
      expect(system.list()).toHaveLength(0);
    });

    test('handles plugin init error', async () => {
      system.register({
        name: 'failing-plugin',
        version: '1.0.0',
        init: async () => {
          throw new Error('init failed');
        },
      });

      await expect(system.initializeAll()).rejects.toThrow(PluginError);
    });

    test('handles plugin destroy error', async () => {
      system.register({
        name: 'bad-destroy',
        version: '1.0.0',
        destroy: async () => {
          throw new Error('destroy failed');
        },
      });

      await system.initializeAll();
      // Should not throw even if destroy fails
      await system.destroyAll();
    });
  });

  describe('Built-in Plugins', () => {
    test('createAnalyzerPlugin returns valid definition', () => {
      const plugin = createAnalyzerPlugin();
      expect(plugin.name).toBe('analyzer');
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.init).toBeDefined();
      expect(plugin.destroy).toBeDefined();
    });

    test('createTesterPlugin returns valid definition', () => {
      const plugin = createTesterPlugin();
      expect(plugin.name).toBe('tester');
      expect(plugin.version).toBe('1.0.0');
    });

    test('createDevOpsPlugin returns valid definition', () => {
      const plugin = createDevOpsPlugin();
      expect(plugin.name).toBe('devops');
      expect(plugin.version).toBe('1.0.0');
    });

    test('createGraphPlugin returns valid definition', () => {
      const plugin = createGraphPlugin();
      expect(plugin.name).toBe('graph');
      expect(plugin.version).toBe('1.0.0');
    });

    test('createDesignPlugin returns valid definition', () => {
      const plugin = createDesignPlugin();
      expect(plugin.name).toBe('design');
      expect(plugin.version).toBe('1.0.0');
    });

    test('createMonitorPlugin returns valid definition', () => {
      const plugin = createMonitorPlugin();
      expect(plugin.name).toBe('monitor');
      expect(plugin.version).toBe('1.0.0');
    });

    test('all 6 toolkit plugins can be registered', () => {
      system.register(createAnalyzerPlugin());
      system.register(createTesterPlugin());
      system.register(createDevOpsPlugin());
      system.register(createGraphPlugin());
      system.register(createDesignPlugin());
      system.register(createMonitorPlugin());
      expect(system.list()).toHaveLength(6);
    });
  });
});
