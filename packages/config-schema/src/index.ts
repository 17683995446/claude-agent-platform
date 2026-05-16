// ============================================================================
// @claude-agent/config-schema - Unified Configuration Schema
// ============================================================================

import { z } from 'zod';

// ---- Environment Variable Schema ----
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  CONFIG_PATH: z.string().optional(),
  CACHE_DIR: z.string().default('./.claude-agent/cache'),
  DATA_DIR: z.string().default('./.claude-agent/data'),
  MAX_WORKERS: z.coerce.number().int().min(1).max(32).default(4),
  TIMEOUT: z.coerce.number().int().min(1000).max(300000).default(30000),
  ENABLE_METRICS: z.coerce.boolean().default(false),
  ENABLE_TRACING: z.coerce.boolean().default(false),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

// ---- Database Schema ----
export const DatabaseSchema = z.object({
  type: z.enum(['sqlite', 'postgres', 'mysql', 'memory']).default('memory'),
  host: z.string().optional(),
  port: z.coerce.number().int().optional(),
  database: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  pool: z.object({
    min: z.number().int().default(1),
    max: z.number().int().default(10),
    idleTimeout: z.number().default(30000),
  }).default({}),
  ssl: z.boolean().default(false),
});

export type DatabaseConfig = z.infer<typeof DatabaseSchema>;

// ---- Cache Schema ----
export const CacheSchema = z.object({
  type: z.enum(['memory', 'redis', 'file']).default('memory'),
  ttl: z.number().default(3600000),
  maxSize: z.number().default(1000),
  redisUrl: z.string().optional(),
});

export type CacheConfig = z.infer<typeof CacheSchema>;

// ---- Security Schema ----
export const SecuritySchema = z.object({
  apiKey: z.string().optional(),
  jwtSecret: z.string().optional(),
  corsOrigins: z.array(z.string()).default(['*']),
  rateLimit: z.object({
    enabled: z.boolean().default(true),
    windowMs: z.number().default(60000),
    maxRequests: z.number().default(100),
  }).default({}),
  encryption: z.object({
    algorithm: z.string().default('aes-256-gcm'),
    keyLength: z.number().default(32),
  }).default({}),
});

export type SecurityConfig = z.infer<typeof SecuritySchema>;

// ---- Full Platform Schema ----
export const PlatformSchema = z.object({
  name: z.string().default('claude-agent'),
  version: z.string().default('1.0.0'),
  env: EnvSchema.default({}),
  database: DatabaseSchema.default({}),
  cache: CacheSchema.default({}),
  security: SecuritySchema.default({}),
  features: z.object({
    eventSourcing: z.boolean().default(false),
    commandBus: z.boolean().default(true),
    snapshotOptimization: z.boolean().default(true),
    autoUpdate: z.boolean().default(false),
  }).default({}),
});

export type PlatformConfig = z.infer<typeof PlatformSchema>;

// ---- Schema Manager ----
export class SchemaManager {
  private schemas: Map<string, z.ZodTypeAny> = new Map();
  private envOverrides: Map<string, string> = new Map();

  register(name: string, schema: z.ZodTypeAny): void {
    this.schemas.set(name, schema);
  }

  get(name: string): z.ZodTypeAny | undefined {
    return this.schemas.get(name);
  }

  validate<T>(name: string, data: unknown): { success: boolean; data?: T; errors?: z.ZodError } {
    const schema = this.schemas.get(name);
    if (!schema) return { success: false, errors: new z.ZodError([{ code: 'custom', message: `Schema "${name}" not found`, path: [] }]) };
    const result = schema.safeParse(data);
    if (result.success) return { success: true, data: result.data as T };
    return { success: false, errors: result.error };
  }

  setEnvOverride(key: string, value: string): void {
    this.envOverrides.set(key, value);
  }

  applyEnvOverrides<T>(schema: z.ZodTypeAny, base: unknown): T {
    const partial: Record<string, unknown> = {};
    for (const [key, value] of this.envOverrides) {
      // Try the key as-is first (for uppercase keys like NODE_ENV, PORT)
      partial[key] = value;
      // Also try camelCase conversion for nested keys
      const keys = key.split('_').map((k, i) => i === 0 ? k.toLowerCase() : k.charAt(0).toLowerCase() + k.slice(1));
      if (keys.length === 1) partial[keys[0]!] = value;
    }
    return schema.parse({ ...base, ...partial }) as T;
  }

  generateDocumentation(): string {
    const lines: string[] = ['# Configuration Schema Documentation', ''];
    for (const [name, schema] of this.schemas) {
      lines.push(`## ${name}`);
      lines.push('');
      if (schema instanceof z.ZodObject) {
        const shape = schema.shape;
        for (const [key, def] of Object.entries(shape)) {
          const desc = def instanceof z.ZodString ? 'string' :
                       def instanceof z.ZodNumber ? 'number' :
                       def instanceof z.ZodBoolean ? 'boolean' :
                       def instanceof z.ZodArray ? 'array' :
                       def instanceof z.ZodEnum ? `enum: ${def.options.join('|')}` :
                       def instanceof z.ZodObject ? 'object' : 'unknown';
          lines.push(`- ${key}: ${desc}`);
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  static create(): SchemaManager {
    const mgr = new SchemaManager();
    mgr.register('env', EnvSchema);
    mgr.register('database', DatabaseSchema);
    mgr.register('cache', CacheSchema);
    mgr.register('security', SecuritySchema);
    mgr.register('platform', PlatformSchema);
    return mgr;
  }
}

// ---- Environment Loader ----
export function loadEnvConfig(): EnvConfig {
  const env: Record<string, unknown> = {};
  for (const key of Object.keys(process.env)) {
    env[key] = process.env[key];
  }
  return EnvSchema.parse(env);
}

export function createPlatformConfig(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return PlatformSchema.parse(overrides);
}
