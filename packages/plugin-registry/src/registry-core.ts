// ============================================================
// Module: registry-core.ts - 注册中心核心
// Central plugin management, lifecycle, dependency resolution
// ============================================================

import type { PluginDefinition } from './plugin-dependency.ts';
import { PluginDependencyResolver, type DependencyGraph, type Conflict } from './plugin-dependency.ts';
import type { PluginInstance, PluginSource } from './plugin-loader.ts';
import { PluginLoader } from './plugin-loader.ts';
import { PluginSandbox, type PluginPermission, type SandboxContext } from './plugin-sandbox.ts';
import { HookSystem } from './hook-system.ts';
import { PluginConfigManager } from './plugin-config.ts';
import { PluginCommunicationBus } from './plugin-communication.ts';
import { PluginTelemetry } from './plugin-telemetry.ts';

export type PluginLifecycleState = 'discovered' | 'loaded' | 'initialized' | 'active' | 'deactivated' | 'unloaded';

export interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  author?: string;
  state: PluginLifecycleState;
  permissions: string[];
  dependencies: string[];
  loadTime: number;
}

export interface PluginFilter {
  state?: PluginLifecycleState;
  author?: string;
  hasPermission?: string;
  tag?: string;
}

export interface RegistryOptions {
  sandboxPermissions?: PluginPermission[];
  enableHotReload?: boolean;
  enableTelemetry?: boolean;
}

export class PluginRegistry {
  private plugins = new Map<string, PluginInstance>();
  private states = new Map<string, PluginLifecycleState>();
  private loader: PluginLoader;
  private sandbox: PluginSandbox;
  private dependencyResolver: PluginDependencyResolver;
  private hooks: HookSystem;
  private config: PluginConfigManager;
  private communication: PluginCommunicationBus;
  private telemetry: PluginTelemetry;
  private options: RegistryOptions;

  constructor(options?: RegistryOptions) {
    this.options = options ?? {};
    this.loader = new PluginLoader();
    this.sandbox = new PluginSandbox();
    this.loader.setSandboxProvider(this.sandbox);
    this.dependencyResolver = new PluginDependencyResolver();
    this.hooks = new HookSystem();
    this.config = new PluginConfigManager();
    this.communication = new PluginCommunicationBus();
    this.telemetry = new PluginTelemetry();
  }

  getLoader(): PluginLoader {
    return this.loader;
  }

  getSandbox(): PluginSandbox {
    return this.sandbox;
  }

  getDependencyResolver(): PluginDependencyResolver {
    return this.dependencyResolver;
  }

  getHooks(): HookSystem {
    return this.hooks;
  }

  getConfig(): PluginConfigManager {
    return this.config;
  }

  getCommunication(): PluginCommunicationBus {
    return this.communication;
  }

  getTelemetry(): PluginTelemetry {
    return this.telemetry;
  }

  async register(plugin: PluginDefinition): Promise<void> {
    this.hooks.doAction('before_init', plugin);

    // Check for existing plugin
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    // Check dependencies
    const conflicts = this.dependencyResolver.checkConflicts([plugin, ...this.getPluginDefinitions()]);
    const relevantConflicts = conflicts.filter(c => c.plugin === plugin.name);
    if (relevantConflicts.length > 0) {
      throw new Error(`Dependency conflict: ${relevantConflicts.map(c => c.message).join('; ')}`);
    }

    // Create instance
    const instance: PluginInstance = {
      definition: plugin,
      loaded: true,
      initialized: false,
      active: false,
      loadTime: 0,
      source: { type: 'inline', name: plugin.name, code: '' },
    };

    this.plugins.set(plugin.name, instance);
    this.states.set(plugin.name, 'loaded');

    this.hooks.doAction('after_init', plugin);
  }

  async unregister(pluginName: string): Promise<void> {
    const instance = this.plugins.get(pluginName);
    if (!instance) {
      throw new Error(`Plugin "${pluginName}" is not registered`);
    }

    if (instance.active) {
      await this.deactivate(pluginName);
    }

    this.plugins.delete(pluginName);
    this.states.delete(pluginName);
    this.sandbox.destroySandbox(pluginName);
  }

  async initialize(pluginName: string): Promise<void> {
    const instance = this.plugins.get(pluginName);
    if (!instance) {
      throw new Error(`Plugin "${pluginName}" is not registered`);
    }

    // Initialize dependencies first
    const deps = instance.definition.dependencies ?? {};
    for (const depName of Object.keys(deps)) {
      const depState = this.states.get(depName);
      if (depState !== 'initialized' && depState !== 'active') {
        await this.initialize(depName);
      }
    }

    instance.initialized = true;
    this.states.set(pluginName, 'initialized');

    // Create sandbox if permissions are defined
    if (instance.definition.permissions && instance.definition.permissions.length > 0) {
      this.sandbox.createSandbox(
        pluginName,
        instance.definition.permissions as PluginPermission[],
      );
    }
  }

  async activate(pluginName: string): Promise<void> {
    const instance = this.plugins.get(pluginName);
    if (!instance) {
      throw new Error(`Plugin "${pluginName}" is not registered`);
    }

    if (!instance.initialized) {
      await this.initialize(pluginName);
    }

    instance.active = true;
    this.states.set(pluginName, 'active');
  }

  async deactivate(pluginName: string): Promise<void> {
    const instance = this.plugins.get(pluginName);
    if (!instance || !instance.active) return;

    instance.active = false;
    this.states.set(pluginName, 'deactivated');
  }

  getPlugin(name: string): PluginInstance | undefined {
    return this.plugins.get(name);
  }

  getPluginState(name: string): PluginLifecycleState | undefined {
    return this.states.get(name);
  }

  listPlugins(filter?: PluginFilter): PluginInfo[] {
    let entries = Array.from(this.plugins.entries());

    if (filter) {
      if (filter.state) {
        entries = entries.filter(([name]) => this.states.get(name) === filter.state);
      }
      if (filter.author) {
        entries = entries.filter(([, inst]) => inst.definition.author === filter.author);
      }
      if (filter.hasPermission) {
        entries = entries.filter(([, inst]) =>
          inst.definition.permissions?.includes(filter.hasPermission!),
        );
      }
    }

    return entries.map(([name, instance]) => ({
      name,
      version: instance.definition.version,
      description: instance.definition.description,
      author: instance.definition.author,
      state: this.states.get(name) ?? 'discovered',
      permissions: instance.definition.permissions ?? [],
      dependencies: Object.keys(instance.definition.dependencies ?? {}),
      loadTime: instance.loadTime,
    }));
  }

  resolveDependencies(): DependencyGraph {
    return this.dependencyResolver.resolve(this.getPluginDefinitions());
  }

  getLoadOrder(): string[] {
    return this.dependencyResolver.getLoadOrder(this.getPluginDefinitions());
  }

  checkConflicts(): Conflict[] {
    return this.dependencyResolver.checkConflicts(this.getPluginDefinitions());
  }

  private getPluginDefinitions(): PluginDefinition[] {
    return Array.from(this.plugins.values()).map(p => p.definition);
  }

  async shutdown(): Promise<void> {
    this.hooks.doAction('on_shutdown');

    // Deactivate all active plugins
    for (const [name, instance] of this.plugins) {
      if (instance.active) {
        await this.deactivate(name);
      }
    }

    this.plugins.clear();
    this.states.clear();
  }

  getPluginCount(): number {
    return this.plugins.size;
  }
}
