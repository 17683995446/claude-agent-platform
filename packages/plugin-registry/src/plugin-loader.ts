// ============================================================
// Module: plugin-loader.ts - 插件加载器
// Load from directory, npm, URL, inline; lazy loading, hot-reload, sandboxing
// ============================================================

import type { PluginDefinition } from './plugin-dependency.ts';
import type { PluginPermission } from './plugin-sandbox.ts';
import type { PluginSandbox } from './plugin-sandbox.ts';

export type PluginSourceType = 'local' | 'npm' | 'url' | 'inline';

export interface PluginSource {
  type: PluginSourceType;
  path?: string;
  packageName?: string;
  url?: string;
  code?: string;
  name?: string;
  lazy?: boolean;
}

export interface PluginLoadResult {
  success: boolean;
  plugin?: PluginDefinition;
  error?: string;
  source: PluginSource;
  loadTime: number;
}

export interface PluginInstance {
  definition: PluginDefinition;
  loaded: boolean;
  initialized: boolean;
  active: boolean;
  loadTime: number;
  sandbox?: unknown;
  source: PluginSource;
}

export interface HotReloadOptions {
  watch: boolean;
  debounceMs: number;
  onLoad?: (plugin: PluginDefinition) => void;
  onUnload?: (pluginName: string) => void;
}

export class PluginLoader {
  private loadedPlugins = new Map<string, PluginInstance>();
  private sandboxProvider?: PluginSandbox;
  private watchers = new Map<string, ReturnType<typeof setInterval>>();
  private loadHandlers = new Map<string, Array<(plugin: PluginDefinition) => void>>();
  private unloadHandlers = new Map<string, Array<(pluginName: string) => void>>();
  private inlineCounter = 0;

  setSandboxProvider(sandbox: PluginSandbox): void {
    this.sandboxProvider = sandbox;
  }

  async load(source: PluginSource): Promise<PluginLoadResult> {
    const startTime = Date.now();

    try {
      let definition: PluginDefinition;

      switch (source.type) {
        case 'inline':
          definition = this.loadInline(source);
          break;
        case 'local':
          definition = await this.loadLocal(source);
          break;
        case 'npm':
          definition = await this.loadNpm(source);
          break;
        case 'url':
          definition = await this.loadFromUrl(source);
          break;
        default:
          throw new Error(`Unknown source type: ${source.type}`);
      }

      const instance: PluginInstance = {
        definition,
        loaded: true,
        initialized: false,
        active: false,
        loadTime: Date.now() - startTime,
        source,
      };

      this.loadedPlugins.set(definition.name, instance);

      // Notify load handlers
      const handlers = this.loadHandlers.get(definition.name) ?? [];
      for (const handler of handlers) {
        try { handler(definition); } catch { /* ignore */ }
      }

      return {
        success: true,
        plugin: definition,
        source,
        loadTime: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        source,
        loadTime: Date.now() - startTime,
      };
    }
  }

  private loadInline(source: PluginSource): PluginDefinition {
    if (!source.code) {
      throw new Error('Inline plugin requires code');
    }

    // Parse basic plugin definition from code string (simplified)
    // In a real implementation, this would use eval or a module compiler
    const name = source.name ?? `inline_${++this.inlineCounter}`;
    return {
      name,
      version: '0.0.0',
      description: 'Inline plugin',
      main: source.code,
    };
  }

  private async loadLocal(source: PluginSource): Promise<PluginDefinition> {
    if (!source.path) {
      throw new Error('Local plugin requires path');
    }

    // Simulate loading from local directory
    await new Promise(resolve => setTimeout(resolve, 1));

    const name = source.name ?? source.path.split('/').pop() ?? 'unknown';
    return {
      name,
      version: '1.0.0',
      description: `Plugin loaded from ${source.path}`,
      main: source.path,
    };
  }

  private async loadNpm(source: PluginSource): Promise<PluginDefinition> {
    if (!source.packageName) {
      throw new Error('NPM plugin requires packageName');
    }

    // Simulate npm package loading
    await new Promise(resolve => setTimeout(resolve, 5));

    return {
      name: source.name ?? source.packageName,
      version: '1.0.0',
      description: `NPM plugin: ${source.packageName}`,
    };
  }

  private async loadFromUrl(source: PluginSource): Promise<PluginDefinition> {
    if (!source.url) {
      throw new Error('URL plugin requires url');
    }

    let hostname: string;
    try {
      hostname = new URL(source.url).hostname;
    } catch {
      throw new Error(`Invalid URL: "${source.url}" is not a valid URL`);
    }

    // Simulate URL loading
    await new Promise(resolve => setTimeout(resolve, 10));

    const name = source.name ?? hostname;
    return {
      name,
      version: '1.0.0',
      description: `Plugin loaded from ${source.url}`,
    };
  }

  async loadAll(sources: PluginSource[]): Promise<PluginLoadResult[]> {
    const results: PluginLoadResult[] = [];
    for (const source of sources) {
      results.push(await this.load(source));
    }
    return results;
  }

  async unload(pluginName: string): Promise<void> {
    const instance = this.loadedPlugins.get(pluginName);
    if (!instance) return;

    instance.active = false;
    instance.initialized = false;
    instance.loaded = false;

    // Notify unload handlers
    const handlers = this.unloadHandlers.get(pluginName) ?? [];
    for (const handler of handlers) {
      try { handler(pluginName); } catch { /* ignore */ }
    }

    this.loadedPlugins.delete(pluginName);
  }

  async reload(pluginName: string): Promise<void> {
    const instance = this.loadedPlugins.get(pluginName);
    if (!instance) {
      throw new Error(`Plugin "${pluginName}" is not loaded`);
    }

    const source = instance.source;
    const originalName = instance.definition.name;
    await this.unload(pluginName);

    // Ensure the source uses the original name so reload doesn't register under a different name
    const effectiveSource = { ...source, name: source.name ?? originalName };
    const result = await this.load(effectiveSource);

    if (!result.success) {
      // If reload failed, attempt to restore the original plugin
      const restoreResult = await this.load(effectiveSource);
      if (!restoreResult.success) {
        // Original restoration also failed; plugin remains unloaded
      }
      throw new Error(`Failed to reload plugin "${pluginName}": ${result.error}`);
    }
  }

  enableHotReload(pluginName: string, options?: HotReloadOptions): void {
    const debounceMs = options?.debounceMs ?? 1000;

    // Stop existing watcher
    this.disableHotReload(pluginName);

    const watcher = setInterval(() => {
      const instance = this.loadedPlugins.get(pluginName);
      if (instance && instance.source.type === 'local') {
        this.reload(pluginName).then(() => {
          options?.onLoad?.(instance.definition);
        }).catch(() => {
          // Reload failed, notify via onUnload
          options?.onUnload?.(pluginName);
        });
      }
    }, debounceMs);

    this.watchers.set(pluginName, watcher);
  }

  disableHotReload(pluginName: string): void {
    const watcher = this.watchers.get(pluginName);
    if (watcher) {
      clearInterval(watcher);
      this.watchers.delete(pluginName);
    }
  }

  getPlugin(pluginName: string): PluginInstance | undefined {
    return this.loadedPlugins.get(pluginName);
  }

  listLoaded(): string[] {
    return Array.from(this.loadedPlugins.keys());
  }

  onLoad(pluginName: string, handler: (plugin: PluginDefinition) => void): () => void {
    if (!this.loadHandlers.has(pluginName)) {
      this.loadHandlers.set(pluginName, []);
    }
    this.loadHandlers.get(pluginName)!.push(handler);
    return () => {
      const handlers = this.loadHandlers.get(pluginName);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  onUnload(pluginName: string, handler: (pluginName: string) => void): () => void {
    if (!this.unloadHandlers.has(pluginName)) {
      this.unloadHandlers.set(pluginName, []);
    }
    this.unloadHandlers.get(pluginName)!.push(handler);
    return () => {
      const handlers = this.unloadHandlers.get(pluginName);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  reset(): void {
    for (const [name] of this.watchers) {
      this.disableHotReload(name);
    }
    this.loadedPlugins.clear();
    this.loadHandlers.clear();
    this.unloadHandlers.clear();
  }
}
