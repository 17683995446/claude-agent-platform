/**
 * 环境管理模块
 * 支持多环境配置、环境切换、变量插值和环境比较
 */

export interface EnvironmentConfig {
  name: string;
  overrides: Record<string, unknown>;
  requiredFields?: string[];
}

export interface EnvironmentDiff {
  env1: string;
  env2: string;
  onlyInEnv1: string[];
  onlyInEnv2: string[];
  differentValues: Array<{ path: string; env1Value: unknown; env2Value: unknown }>;
}

/**
 * EnvironmentManager - 环境管理器
 */
export class EnvironmentManager {
  private baseConfig: Record<string, unknown>;
  private environments: Map<string, EnvironmentConfig> = new Map();
  private currentEnvironment: string;

  constructor(baseConfig: Record<string, unknown> = {}, defaultEnv = 'development') {
    this.baseConfig = { ...baseConfig };
    this.currentEnvironment = defaultEnv;

    // Register built-in environments
    this.registerEnvironment('development', {});
    this.registerEnvironment('test', {});
    this.registerEnvironment('staging', {});
    this.registerEnvironment('production', {});
  }

  /**
   * 设置当前环境
   */
  setEnvironment(env: string): void {
    if (!this.environments.has(env)) {
      throw new Error(`Environment "${env}" is not registered`);
    }
    this.currentEnvironment = env;
  }

  /**
   * 获取当前环境名称
   */
  getEnvironment(): string {
    return this.currentEnvironment;
  }

  /**
   * 注册环境配置
   */
  registerEnvironment(name: string, overrides: Record<string, unknown>, requiredFields?: string[]): void {
    this.environments.set(name, { name, overrides: { ...overrides }, requiredFields });
  }

  /**
   * 获取指定环境的完整配置
   */
  getEnvConfig(env: string): Record<string, unknown> {
    const envConfig = this.environments.get(env);
    if (!envConfig) {
      throw new Error(`Environment "${env}" is not registered`);
    }
    return this.deepMerge(this.baseConfig, envConfig.overrides);
  }

  /**
   * 获取当前环境的完整配置
   */
  getCurrentConfig(): Record<string, unknown> {
    return this.getEnvConfig(this.currentEnvironment);
  }

  /**
   * 比较两个环境的配置差异
   */
  compareEnvironments(env1: string, env2: string): EnvironmentDiff {
    const config1 = this.getEnvConfig(env1);
    const config2 = this.getEnvConfig(env2);

    const keys1 = this.flattenKeys(config1);
    const keys2 = this.flattenKeys(config2);
    const allKeys = new Set([...keys1, ...keys2]);

    const onlyInEnv1: string[] = [];
    const onlyInEnv2: string[] = [];
    const differentValues: Array<{ path: string; env1Value: unknown; env2Value: unknown }> = [];

    for (const key of allKeys) {
      const v1 = this.getNestedValue(config1, key);
      const v2 = this.getNestedValue(config2, key);

      if (v1 === undefined && v2 !== undefined) {
        onlyInEnv2.push(key);
      } else if (v1 !== undefined && v2 === undefined) {
        onlyInEnv1.push(key);
      } else if (JSON.stringify(v1) !== JSON.stringify(v2)) {
        differentValues.push({ path: key, env1Value: v1, env2Value: v2 });
      }
    }

    return { env1, env2, onlyInEnv1, onlyInEnv2, differentValues };
  }

  /**
   * 验证环境配置（检查必填字段）
   */
  validateEnvironment(env: string): { valid: boolean; missing: string[] } {
    const envConfig = this.environments.get(env);
    if (!envConfig) {
      return { valid: false, missing: [`Environment "${env}" not registered`] };
    }

    const config = this.getEnvConfig(env);
    const missing: string[] = [];

    if (envConfig.requiredFields) {
      for (const field of envConfig.requiredFields) {
        if (this.getNestedValue(config, field) === undefined) {
          missing.push(field);
        }
      }
    }

    return { valid: missing.length === 0, missing };
  }

  /**
   * 插值环境变量：${ENV:VARIABLE_NAME}
   */
  interpolate(config: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      result[key] = this.interpolateValue(value);
    }
    return result;
  }

  /**
   * 列出所有已注册的环境
   */
  listEnvironments(): string[] {
    return Array.from(this.environments.keys());
  }

  /**
   * 更新基础配置
   */
  updateBaseConfig(config: Record<string, unknown>): void {
    this.baseConfig = this.deepMerge(this.baseConfig, config);
  }

  /**
   * 更新环境覆盖配置
   */
  updateEnvironmentOverrides(env: string, overrides: Record<string, unknown>): void {
    const envConfig = this.environments.get(env);
    if (!envConfig) {
      throw new Error(`Environment "${env}" is not registered`);
    }
    envConfig.overrides = this.deepMerge(envConfig.overrides, overrides);
  }

  /**
   * 移除环境
   */
  removeEnvironment(env: string): boolean {
    if (env === this.currentEnvironment) return false;
    return this.environments.delete(env);
  }

  private interpolateValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.replace(/\$\{ENV:([^}]+)\}/g, (_, varName) => {
        return process.env[varName] || '';
      });
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = this.interpolateValue(v);
      }
      return result;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.interpolateValue(item));
    }
    return value;
  }

  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      const sv = source[key];
      const tv = result[key];
      if (
        sv !== null && typeof sv === 'object' && !Array.isArray(sv) &&
        tv !== null && typeof tv === 'object' && !Array.isArray(tv)
      ) {
        result[key] = this.deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
      } else {
        result[key] = sv;
      }
    }
    return result;
  }

  private flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    const result: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result.push(...this.flattenKeys(value as Record<string, unknown>, fullKey));
      } else {
        result.push(fullKey);
      }
    }
    return result;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
