// ============================================================================
// Claude Agent Platform - Main Application Entry
// ============================================================================

import { ConfigManager } from '@claude-agent/config';
import { createLogger, Logger } from '@claude-agent/logger';
import { installGlobalErrorHandlers } from '@claude-agent/errors';
import { AgentCore, EventBus, LifecycleManagerImpl } from '@claude-agent/core';
import { PipelineEngine, createAnalyzePipeline, createTestPipeline, createDevOpsPipeline } from '@claude-agent/pipeline';
import { PluginSystem, createAnalyzerPlugin, createTesterPlugin, createDevOpsPlugin, createGraphPlugin, createDesignPlugin, createMonitorPlugin } from '@claude-agent/plugins';
import { HealthServer, HealthCheckRegistry } from '@claude-agent/http';
import { ClaudeAgentCLI } from '@claude-agent/cli';

export interface ClaudeAgentAppOptions {
  configPath?: string;
}

export class ClaudeAgentApp {
  private configManager: ConfigManager;
  private logger: Logger;
  private eventBus: EventBus;
  private agent: AgentCore;
  private lifecycle: LifecycleManagerImpl;
  private pipelineEngine: PipelineEngine;
  private pluginSystem: PluginSystem;
  private healthServer: HealthServer;
  private cli: ClaudeAgentCLI;

  constructor(options: ClaudeAgentAppOptions = {}) {
    // Install global error handlers
    installGlobalErrorHandlers();

    // Initialize configuration
    this.configManager = new ConfigManager(
      ConfigManager.create().getConfig(),
      null,
    );

    // Initialize logger
    this.logger = createLogger({
      level: this.configManager.getConfig().logLevel,
      context: { app: 'claude-agent-platform' },
    });

    // Initialize event bus
    this.eventBus = new EventBus(this.logger);

    // Initialize core agent
    this.agent = new AgentCore({
      name: 'claude-agent-platform',
      config: this.configManager.getConfig(),
      eventBus: this.eventBus,
      logger: this.logger,
    });

    // Initialize lifecycle manager
    this.lifecycle = new LifecycleManagerImpl(this.agent);

    // Initialize pipeline engine
    this.pipelineEngine = new PipelineEngine({
      logger: this.logger,
      eventBus: this.eventBus,
      config: this.configManager.getConfig(),
    });

    // Initialize plugin system
    this.pluginSystem = new PluginSystem({
      logger: this.logger,
      eventBus: this.eventBus,
      config: this.configManager.getConfig(),
    });

    // Initialize health server
    const healthRegistry = new HealthCheckRegistry();
    this.healthServer = new HealthServer({
      registry: healthRegistry,
      logger: this.logger,
      eventBus: this.eventBus,
      version: this.configManager.getConfig().version,
      host: this.configManager.getConfig().http?.host ?? '127.0.0.1',
      port: this.configManager.getConfig().http?.port ?? 3000,
    });

    // Initialize CLI
    this.cli = new ClaudeAgentCLI(this.configManager.getConfig());
  }

  /** Setup built-in pipelines */
  private setupPipelines(): void {
    createAnalyzePipeline(this.pipelineEngine);
    createTestPipeline(this.pipelineEngine);
    createDevOpsPipeline(this.pipelineEngine);
    this.logger.info('Built-in pipelines registered');
  }

  /** Setup built-in plugins */
  private setupPlugins(): void {
    this.pluginSystem.register(createAnalyzerPlugin());
    this.pluginSystem.register(createTesterPlugin());
    this.pluginSystem.register(createDevOpsPlugin());
    this.pluginSystem.register(createGraphPlugin());
    this.pluginSystem.register(createDesignPlugin());
    this.pluginSystem.register(createMonitorPlugin());
    this.logger.info('Built-in plugins registered');
  }

  /** Setup health checks */
  private setupHealthChecks(): void {
    const registry = this.healthServer.getRegistry();

    registry.register('agent', () => ({
      status: this.agent.isRunning() ? 'healthy' : 'unhealthy',
      message: this.agent.isRunning() ? 'Agent is running' : 'Agent is not running',
    }));

    registry.register('plugins', () => ({
      status: this.pluginSystem.activeCount() > 0 ? 'healthy' : 'degraded',
      message: `${this.pluginSystem.activeCount()} active plugins`,
    }));

    registry.register('memory', () => {
      const mem = process.memoryUsage();
      const threshold = 500 * 1024 * 1024; // 500MB
      return {
        status: mem.rss < threshold ? 'healthy' : 'degraded',
        message: `RSS: ${Math.round(mem.rss / 1024 / 1024)}MB`,
        details: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
        },
      };
    });

    this.logger.info('Health checks registered');
  }

  /** Start the application */
  async start(): Promise<void> {
    this.logger.info('Starting Claude Agent Platform...');

    // Setup components
    this.setupPipelines();
    this.setupPlugins();
    this.setupHealthChecks();

    // Initialize plugins
    await this.pluginSystem.initializeAll();

    // Start agent
    await this.lifecycle.start();

    // Start HTTP server if enabled
    const config = this.configManager.getConfig();
    if (config.http?.enabled) {
      this.healthServer.start();
    }

    // Watch for config changes
    this.configManager.watch();

    this.logger.info('Claude Agent Platform started successfully', {
      version: config.version,
      plugins: this.pluginSystem.list(),
      pipelines: this.pipelineEngine.list(),
    });
  }

  /** Stop the application */
  async stop(): Promise<void> {
    this.logger.info('Stopping Claude Agent Platform...');

    // Stop HTTP server
    await this.healthServer.stop();

    // Stop lifecycle (agent)
    await this.lifecycle.stop();

    // Destroy plugins
    await this.pluginSystem.destroyAll();

    // Unwatch config
    this.configManager.unwatch();

    // Flush logger
    await this.logger.close();

    this.logger.info('Claude Agent Platform stopped');
  }

  /** Run CLI mode */
  async runCLI(argv: string[]): Promise<number> {
    return this.cli.run(argv);
  }

  /** Get the agent instance */
  getAgent(): AgentCore {
    return this.agent;
  }

  /** Get the pipeline engine */
  getPipelineEngine(): PipelineEngine {
    return this.pipelineEngine;
  }

  /** Get the plugin system */
  getPluginSystem(): PluginSystem {
    return this.pluginSystem;
  }

  /** Get the health server */
  getHealthServer(): HealthServer {
    return this.healthServer;
  }
}

// ---- Default Export ----

export default ClaudeAgentApp;
