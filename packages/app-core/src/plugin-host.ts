// ============================================================================
// Module 7: Plugin Host
// ============================================================================

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  main?: string;
  dependencies?: string[];
  permissions?: string[];
}

export interface PluginAPI {
  name: string;
  version: string;
  getConfig: (key: string) => unknown;
  emit: (event: string, data?: unknown) => void;
  on: (event: string, handler: (data: unknown) => void) => void;
  getService: <T>(name: string) => T;
}

export interface LoadedPlugin {
  name: string;
  version: string;
  manifest: PluginManifest;
  active: boolean;
  loadedAt: number;
  api: PluginAPI;
}

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  active: boolean;
  loadedAt: number;
  dependencies: string[];
}

export interface PluginDefinition {
  name: string;
  version: string;
  description: string;
  dependencies?: string[];
  permissions?: string[];
  init?: (api: PluginAPI) => Promise<void>;
  activate?: () => Promise<void>;
  deactivate?: () => Promise<void>;
  destroy?: () => Promise<void>;
}

export class PluginHost {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private pluginDefinitions: Map<string, PluginDefinition> = new Map();
  private pluginAPIs: Map<string, PluginAPI> = new Map();
  private configStore: Record<string, Record<string, unknown>> = {};
  private serviceRegistry: Map<string, unknown> = new Map();
  private eventHandlers: Map<string, Array<(data: unknown) => void>> = new Map();

  loadPlugin(pluginDefinition: PluginDefinition): Promise<LoadedPlugin> {
    const name = pluginDefinition.name;

    if (this.plugins.has(name)) {
      return Promise.reject(new Error(`Plugin "${name}" is already loaded`));
    }

    // Check dependencies
    const deps = pluginDefinition.dependencies ?? [];
    for (const dep of deps) {
      if (!this.plugins.has(dep)) {
        return Promise.reject(new Error(`Plugin "${name}" requires "${dep}" which is not loaded`));
      }
    }

    const api = this.createPluginAPI(pluginDefinition);
    this.pluginDefinitions.set(name, pluginDefinition);
    this.pluginAPIs.set(name, api);

    const loadedPlugin: LoadedPlugin = {
      name,
      version: pluginDefinition.version,
      manifest: {
        name,
        version: pluginDefinition.version,
        description: pluginDefinition.description,
        dependencies: pluginDefinition.dependencies,
        permissions: pluginDefinition.permissions,
      },
      active: false,
      loadedAt: Date.now(),
      api,
    };

    this.plugins.set(name, loadedPlugin);

    // Init the plugin
    if (pluginDefinition.init) {
      return pluginDefinition.init(api).then(() => {
        loadedPlugin.active = true;
        return loadedPlugin;
      });
    }

    loadedPlugin.active = true;
    return Promise.resolve(loadedPlugin);
  }

  async unloadPlugin(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin "${pluginName}" is not loaded`);
    }

    const definition = this.pluginDefinitions.get(pluginName);

    if (definition?.deactivate) {
      await definition.deactivate();
    }

    if (definition?.destroy) {
      await definition.destroy();
    }

    // Clean up event handlers
    this.eventHandlers.delete(pluginName);

    this.plugins.delete(pluginName);
    this.pluginDefinitions.delete(pluginName);
    this.pluginAPIs.delete(pluginName);
  }

  getPluginAPI(pluginName: string): PluginAPI {
    const api = this.pluginAPIs.get(pluginName);
    if (!api) {
      throw new Error(`Plugin "${pluginName}" is not loaded`);
    }
    return api;
  }

  listPlugins(): PluginInfo[] {
    const infos: PluginInfo[] = [];
    for (const [, plugin] of this.plugins) {
      infos.push({
        name: plugin.name,
        version: plugin.version,
        description: plugin.manifest.description,
        active: plugin.active,
        loadedAt: plugin.loadedAt,
        dependencies: plugin.manifest.dependencies ?? [],
      });
    }
    return infos;
  }

  getPlugin(pluginName: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginName);
  }

  hasPlugin(pluginName: string): boolean {
    return this.plugins.has(pluginName);
  }

  setConfig(pluginName: string, key: string, value: unknown): void {
    if (!this.configStore[pluginName]) {
      this.configStore[pluginName] = {};
    }
    this.configStore[pluginName][key] = value;
  }

  registerService(name: string, service: unknown): void {
    this.serviceRegistry.set(name, service);
  }

  getPluginCount(): number {
    return this.plugins.size;
  }

  private createPluginAPI(definition: PluginDefinition): PluginAPI {
    const pluginName = definition.name;
    return {
      name: pluginName,
      version: definition.version,
      getConfig: (key: string) => {
        return this.configStore[pluginName]?.[key];
      },
      emit: (event: string, data?: unknown) => {
        const handlers = this.eventHandlers.get(pluginName) ?? [];
        for (const handler of handlers) {
          try {
            handler(data);
          } catch {
            // Swallow handler errors
          }
        }
      },
      on: (event: string, handler: (data: unknown) => void) => {
        if (!this.eventHandlers.has(pluginName)) {
          this.eventHandlers.set(pluginName, []);
        }
        this.eventHandlers.get(pluginName)!.push(handler);
      },
      getService: <T>(name: string): T => {
        const service = this.serviceRegistry.get(name);
        if (!service) {
          throw new Error(`Service "${name}" not found`);
        }
        return service as T;
      },
    };
  }
}
