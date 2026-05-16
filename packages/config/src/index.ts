// ============================================================================
// @claude-agent/config - Unified Configuration System
// ============================================================================

import { z } from 'zod';
import type { ClaudeAgentConfig, LogLevel } from '@claude-agent/types';
import { ConfigError, ConfigNotFoundError } from '@claude-agent/errors';
import { createLogger } from '@claude-agent/logger';
import { existsSync, readFileSync, watchFile, unwatchFile } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---- Zod Schemas ----

const LogLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

const HttpConfigSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(3000),
  healthPath: z.string().default('/'),
}).optional();

const PluginConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  options: z.record(z.unknown()).optional(),
});

const PipelineConfigSchema = z.object({
  name: z.string(),
  steps: z.array(z.string()),
  options: z.record(z.unknown()).optional(),
});

const CheckpointConfigSchema = z.object({
  enabled: z.boolean().default(false),
  directory: z.string().default('./.claude-agent/checkpoints'),
  maxRetain: z.number().int().min(1).default(10),
}).optional();

const ClaudeAgentConfigSchema = z.object({
  name: z.string().default('claude-agent'),
  version: z.string().default('1.0.0'),
  logLevel: LogLevelSchema.default('info'),
  cwd: z.string().default(process.cwd()),
  http: HttpConfigSchema,
  plugins: z.array(PluginConfigSchema).optional(),
  pipelines: z.array(PipelineConfigSchema).optional(),
  checkpoint: CheckpointConfigSchema,
});

// ---- Configuration Manager ----

export type ConfigChangeListener = (config: ClaudeAgentConfig) => void;

export class ConfigManager {
  private config: ClaudeAgentConfig;
  private configPath: string | null;
  private listeners: Set<ConfigChangeListener> = new Set();
  private watching: boolean = false;

  private constructor(config: ClaudeAgentConfig, configPath: string | null) {
    this.config = config;
    this.configPath = configPath;
  }

  /** Load configuration from file */
  static async load(configPath?: string): Promise<ConfigManager> {
    const logger = createLogger({ level: 'debug' });
    const resolvedPath = configPath
      ? resolve(configPath)
      : ConfigManager.findConfigFile();

    if (resolvedPath && existsSync(resolvedPath)) {
      logger.info(`Loading configuration from ${resolvedPath}`);
      const raw = ConfigManager.readConfigFile(resolvedPath);
      const parsed = ClaudeAgentConfigSchema.parse(raw);
      return new ConfigManager(parsed, resolvedPath);
    }

    logger.info('No configuration file found, using defaults');
    const defaults = ClaudeAgentConfigSchema.parse({});
    return new ConfigManager(defaults, null);
  }

  /** Create with explicit config object */
  static create(config: Partial<ClaudeAgentConfig> = {}): ConfigManager {
    const parsed = ClaudeAgentConfigSchema.parse(config);
    return new ConfigManager(parsed, null);
  }

  /** Find config file in standard locations */
  private static findConfigFile(): string | null {
    const searchPaths = [
      'claude-agent.config.ts',
      'claude-agent.config.js',
      'claude-agent.config.json',
      '.claude-agent/config.json',
    ];

    for (const filename of searchPaths) {
      const fullPath = resolve(process.cwd(), filename);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }

    return null;
  }

  /** Read and parse config file */
  private static readConfigFile(filePath: string): Record<string, unknown> {
    try {
      const content = readFileSync(filePath, 'utf-8');

      if (filePath.endsWith('.json')) {
        return JSON.parse(content) as Record<string, unknown>;
      }

      // For .ts and .js files, we would use dynamic import in a real implementation
      // For now, try JSON parse as fallback
      try {
        return JSON.parse(content) as Record<string, unknown>;
      } catch {
        throw new ConfigError(
          `Failed to parse configuration file: ${filePath}`,
          filePath,
        );
      }
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      throw new ConfigError(
        `Failed to read configuration file: ${filePath}`,
        filePath,
        {},
        error instanceof Error ? error : undefined,
      );
    }
  }

  /** Get current configuration */
  getConfig(): ClaudeAgentConfig {
    return { ...this.config };
  }

  /** Get a specific config value by path */
  get<T = unknown>(path: string): T {
    const keys = path.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let value: any = this.config;

    for (const key of keys) {
      if (value === null || value === undefined || typeof value !== 'object') {
        return undefined as T;
      }
      value = (value as Record<string, unknown>)[key];
    }

    return value as T;
  }

  /** Update configuration (deep merge) */
  update(partial: Partial<ClaudeAgentConfig>): void {
    this.config = ClaudeAgentConfigSchema.parse({
      ...this.config,
      ...partial,
    });
    this.notifyListeners();
  }

  /** Merge configuration with another config object */
  merge(partial: Partial<ClaudeAgentConfig>): ClaudeAgentConfig {
    const merged = ClaudeAgentConfigSchema.parse({
      ...this.config,
      ...partial,
      http: { ...this.config.http, ...partial.http },
      checkpoint: { ...this.config.checkpoint, ...partial.checkpoint },
    });
    return merged;
  }

  /** Watch for configuration file changes */
  watch(): void {
    if (this.watching || !this.configPath) return;

    this.watching = true;
    const logger = createLogger({ level: 'debug' });

    watchFile(this.configPath, { interval: 1000 }, () => {
      logger.info(`Configuration file changed: ${this.configPath}`);
      try {
        const raw = ConfigManager.readConfigFile(this.configPath!);
        this.config = ClaudeAgentConfigSchema.parse(raw);
        this.notifyListeners();
      } catch (error) {
        logger.error('Failed to reload configuration', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /** Stop watching for configuration changes */
  unwatch(): void {
    if (!this.watching || !this.configPath) return;

    this.watching = false;
    unwatchFile(this.configPath);
  }

  /** Register a configuration change listener */
  onChange(listener: ConfigChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Notify all listeners of config change */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.getConfig());
      } catch {
        // Listener errors should not affect other listeners
      }
    }
  }

  /** Get the config file path */
  getConfigPath(): string | null {
    return this.configPath;
  }

  /** Validate a config object without applying it */
  static validate(config: unknown): { success: boolean; errors?: z.ZodError } {
    const result = ClaudeAgentConfigSchema.safeParse(config);
    if (result.success) {
      return { success: true };
    }
    return { success: false, errors: result.error };
  }

  /** Get the Zod schema for external use */
  static get schema() {
    return ClaudeAgentConfigSchema;
  }
}

// ---- Default Config Factory ----

export function createDefaultConfig(): ClaudeAgentConfig {
  return ClaudeAgentConfigSchema.parse({});
}
