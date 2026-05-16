// ============================================================================
// @claude-agent/plugins - Plugin System
// ============================================================================

import type {
  PluginId,
  Plugin,
  PluginDefinition,
  PluginPhase,
  PluginContext,
  EventHandler,
  ClaudeAgentConfig,
  LoggerInterface,
  EventBusInterface,
  AgentEvent,
} from '@claude-agent/types';
import { PluginError, PluginNotFoundError } from '@claude-agent/errors';
import { Logger } from '@claude-agent/logger';
import { EventBus } from '@claude-agent/core';
import { ConfigManager } from '@claude-agent/config';

// ---- ID Generator ----

let pluginCounter = 0;

function generatePluginId(): PluginId {
  pluginCounter++;
  return `plugin-${Date.now().toString(36)}-${pluginCounter.toString(36).padStart(4, '0')}` as PluginId;
}

// ---- Plugin Instance ----

class PluginInstance implements Plugin {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  private phase: PluginPhase = 'registered';
  private definition: PluginDefinition;
  private context?: PluginContext;

  constructor(id: PluginId, definition: PluginDefinition) {
    this.id = id;
    this.name = definition.name;
    this.version = definition.version;
    this.description = definition.description;
    this.definition = definition;
  }

  getPhase(): PluginPhase {
    return this.phase;
  }

  private setPhase(phase: PluginPhase): void {
    this.phase = phase;
  }

  async initialize(context: PluginContext): Promise<void> {
    this.setPhase('initializing');
    this.context = context;

    if (this.definition.init) {
      await this.definition.init(context);
    }

    this.setPhase('ready');

    // Register event handlers
    if (this.definition.handlers) {
      for (const [eventType, handler] of Object.entries(this.definition.handlers)) {
        context.eventBus.on(eventType as any, handler);
      }
    }

    this.setPhase('active');
  }

  async destroy(): Promise<void> {
    this.setPhase('stopping');

    // Unregister event handlers
    if (this.context && this.definition.handlers) {
      for (const [eventType, handler] of Object.entries(this.definition.handlers)) {
        this.context.eventBus.off(eventType as any, handler);
      }
    }

    if (this.definition.destroy) {
      await this.definition.destroy();
    }

    this.setPhase('stopped');
  }
}

// ---- Plugin System ----

export class PluginSystem {
  private plugins: Map<string, PluginInstance> = new Map();
  private logger: LoggerInterface;
  private eventBus: EventBusInterface;
  private config: ClaudeAgentConfig;

  constructor(options?: {
    logger?: LoggerInterface;
    eventBus?: EventBusInterface;
    config?: ClaudeAgentConfig;
  }) {
    this.logger = options?.logger ?? new Logger();
    this.eventBus = options?.eventBus ?? new EventBus();
    this.config = options?.config ?? ConfigManager.create().getConfig();
  }

  /** Register a plugin */
  register(definition: PluginDefinition): void {
    if (this.plugins.has(definition.name)) {
      throw new PluginError(
        `Plugin "${definition.name}" is already registered`,
        definition.name,
      );
    }

    const id = generatePluginId();
    const instance = new PluginInstance(id, definition);
    this.plugins.set(definition.name, instance);

    this.logger.info(`Registered plugin: ${definition.name}`, {
      pluginId: id,
      version: definition.version,
    });

    this.eventBus.emit({
      type: 'plugin.registered',
      timestamp: new Date(),
      data: { pluginId: id, pluginName: definition.name, version: definition.version },
    });
  }

  /** Unregister a plugin */
  async unregister(name: string): Promise<void> {
    const instance = this.plugins.get(name);
    if (!instance) {
      throw new PluginNotFoundError(name);
    }

    await instance.destroy();
    this.plugins.delete(name);

    this.logger.info(`Unregistered plugin: ${name}`);
  }

  /** Initialize all registered plugins */
  async initializeAll(): Promise<void> {
    this.logger.info(`Initializing ${this.plugins.size} plugins...`);

    for (const [name, instance] of this.plugins) {
      try {
        const context: PluginContext = {
          logger: this.logger,
          eventBus: this.eventBus,
          config: this.config,
        };

        await instance.initialize(context);

        this.logger.info(`Plugin ready: ${name}`, {
          version: instance.version,
          phase: instance.getPhase(),
        });

        this.eventBus.emit({
          type: 'plugin.ready',
          timestamp: new Date(),
          data: { pluginName: name, version: instance.version },
        });
      } catch (error) {
        this.logger.error(`Plugin initialization failed: ${name}`, {
          error: error instanceof Error ? error.message : String(error),
        });

        this.eventBus.emit({
          type: 'plugin.error',
          timestamp: new Date(),
          data: {
            pluginName: name,
            error: error instanceof Error ? error.message : String(error),
          },
        });

        throw new PluginError(
          `Failed to initialize plugin "${name}": ${error instanceof Error ? error.message : String(error)}`,
          name,
          {},
          error instanceof Error ? error : undefined,
        );
      }
    }
  }

  /** Destroy all plugins */
  async destroyAll(): Promise<void> {
    this.logger.info('Destroying all plugins...');

    const destroyPromises = Array.from(this.plugins.entries()).map(
      async ([name, instance]) => {
        try {
          await instance.destroy();
          this.logger.info(`Plugin destroyed: ${name}`);
        } catch (error) {
          this.logger.error(`Plugin destroy failed: ${name}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );

    await Promise.all(destroyPromises);
    this.plugins.clear();
  }

  /** Get a plugin by name */
  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /** List all plugin names */
  list(): string[] {
    return Array.from(this.plugins.keys());
  }

  /** Get the number of active plugins */
  activeCount(): number {
    return Array.from(this.plugins.values()).filter(
      (p) => p.getPhase() === 'active' || p.getPhase() === 'ready',
    ).length;
  }

  /** Check if a plugin is registered */
  has(name: string): boolean {
    return this.plugins.has(name);
  }
}

// ---- Built-in Toolkit Plugins ----

/** Analyzer Plugin - Code analysis capabilities */
export function createAnalyzerPlugin(): PluginDefinition {
  return {
    name: 'analyzer',
    version: '1.0.0',
    description: 'Code analysis and static checking plugin',
    handlers: {
      'task.created': async (event: AgentEvent) => {
        // Auto-analyze tasks on creation
      },
    },
    init: async (context: PluginContext) => {
      context.logger.info('Analyzer plugin initialized');
    },
    destroy: async () => {
      // Cleanup
    },
  };
}

/** Tester Plugin - Test execution capabilities */
export function createTesterPlugin(): PluginDefinition {
  return {
    name: 'tester',
    version: '1.0.0',
    description: 'Test discovery and execution plugin',
    handlers: {
      'pipeline.started': async (event: AgentEvent) => {
        // Prepare test environment
      },
    },
    init: async (context: PluginContext) => {
      context.logger.info('Tester plugin initialized');
    },
    destroy: async () => {
      // Cleanup
    },
  };
}

/** DevOps Plugin - CI/CD capabilities */
export function createDevOpsPlugin(): PluginDefinition {
  return {
    name: 'devops',
    version: '1.0.0',
    description: 'DevOps and CI/CD automation plugin',
    handlers: {},
    init: async (context: PluginContext) => {
      context.logger.info('DevOps plugin initialized');
    },
    destroy: async () => {
      // Cleanup
    },
  };
}

/** Graph Plugin - Dependency graph capabilities */
export function createGraphPlugin(): PluginDefinition {
  return {
    name: 'graph',
    version: '1.0.0',
    description: 'Dependency graph analysis plugin',
    handlers: {},
    init: async (context: PluginContext) => {
      context.logger.info('Graph plugin initialized');
    },
    destroy: async () => {
      // Cleanup
    },
  };
}

/** Design Plugin - Design system capabilities */
export function createDesignPlugin(): PluginDefinition {
  return {
    name: 'design',
    version: '1.0.0',
    description: 'Design system and UI generation plugin',
    handlers: {},
    init: async (context: PluginContext) => {
      context.logger.info('Design plugin initialized');
    },
    destroy: async () => {
      // Cleanup
    },
  };
}

/** Monitor Plugin - Monitoring capabilities */
export function createMonitorPlugin(): PluginDefinition {
  return {
    name: 'monitor',
    version: '1.0.0',
    description: 'System monitoring and metrics plugin',
    handlers: {
      'health.check': async (event: AgentEvent) => {
        // Collect health metrics
      },
    },
    init: async (context: PluginContext) => {
      context.logger.info('Monitor plugin initialized');
    },
    destroy: async () => {
      // Cleanup
    },
  };
}
