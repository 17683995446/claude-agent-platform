// ============================================================
// Module: plugin-config.ts - 插件配置
// Per-plugin config with schema validation, inheritance, change notification
// ============================================================

export type ConfigSchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface ConfigSchemaProperty {
  type: ConfigSchemaType;
  required?: boolean;
  default?: unknown;
  description?: string;
  enum?: unknown[];
  min?: number;
  max?: number;
  pattern?: string;
  properties?: Record<string, ConfigSchemaProperty>;
  items?: ConfigSchemaType;
}

export interface ConfigSchema {
  properties: Record<string, ConfigSchemaProperty>;
  strict?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigChangeCallback {
  (pluginName: string, key: string, oldValue: unknown, newValue: unknown): void;
}

export class PluginConfigManager {
  private globalConfig: Record<string, unknown> = {};
  private pluginDefaults = new Map<string, Record<string, unknown>>();
  private pluginConfigs = new Map<string, Record<string, unknown>>();
  private schemas = new Map<string, ConfigSchema>();
  private changeListeners: ConfigChangeCallback[] = [];

  setGlobalConfig(config: Record<string, unknown>): void {
    this.globalConfig = { ...this.globalConfig, ...config };
  }

  getGlobalConfig(): Record<string, unknown> {
    return { ...this.globalConfig };
  }

  registerPluginDefaults(pluginName: string, defaults: Record<string, unknown>): void {
    this.pluginDefaults.set(pluginName, { ...defaults });
  }

  getPluginDefaults(pluginName: string): Record<string, unknown> {
    return { ...(this.pluginDefaults.get(pluginName) ?? {}) };
  }

  registerSchema(pluginName: string, schema: ConfigSchema): void {
    this.schemas.set(pluginName, schema);
  }

  getSchema(pluginName: string): ConfigSchema | undefined {
    return this.schemas.get(pluginName);
  }

  getPluginConfig(pluginName: string): Record<string, unknown> {
    // Merge: global -> plugin defaults -> user config
    const merged: Record<string, unknown> = { ...this.globalConfig };
    const defaults = this.pluginDefaults.get(pluginName);
    if (defaults) {
      Object.assign(merged, defaults);
    }
    const userConfig = this.pluginConfigs.get(pluginName);
    if (userConfig) {
      Object.assign(merged, userConfig);
    }
    return merged;
  }

  setPluginConfig(pluginName: string, config: Record<string, unknown>): void {
    const oldConfig = this.pluginConfigs.get(pluginName) ?? {};

    if (!this.pluginConfigs.has(pluginName)) {
      this.pluginConfigs.set(pluginName, {});
    }

    const target = this.pluginConfigs.get(pluginName)!;

    for (const [key, value] of Object.entries(config)) {
      const oldValue = target[key];
      target[key] = value;

      // Notify change listeners
      for (const listener of this.changeListeners) {
        try {
          listener(pluginName, key, oldValue, value);
        } catch {
          // Ignore listener errors
        }
      }
    }
  }

  getPluginConfigValue(pluginName: string, key: string): unknown {
    const config = this.getPluginConfig(pluginName);
    return config[key];
  }

  setPluginConfigValue(pluginName: string, key: string, value: unknown): void {
    this.setPluginConfig(pluginName, { [key]: value });
  }

  validateConfig(pluginName: string, config: Record<string, unknown>): ValidationResult {
    const schema = this.schemas.get(pluginName);
    if (!schema) {
      return { valid: true, errors: [], warnings: ['No schema registered for plugin'] };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const [key, propDef] of Object.entries(schema.properties)) {
      const value = config[key];

      // Check required
      if (propDef.required && value === undefined) {
        errors.push(`Required property "${key}" is missing`);
        continue;
      }

      if (value === undefined) continue;

      // Type check
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== propDef.type) {
        errors.push(`Property "${key}" expected type "${propDef.type}" but got "${actualType}"`);
        continue;
      }

      // Deep validation for nested objects
      if (propDef.type === 'object' && propDef.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const [subKey, subPropDef] of Object.entries(propDef.properties)) {
          const subValue = (value as Record<string, unknown>)[subKey];
          if (subPropDef.required && subValue === undefined) {
            errors.push(`Required nested property "${key}.${subKey}" is missing`);
            continue;
          }
          if (subValue !== undefined) {
            const subType = Array.isArray(subValue) ? 'array' : typeof subValue;
            if (subType !== subPropDef.type) {
              errors.push(`Nested property "${key}.${subKey}" expected type "${subPropDef.type}" but got "${subType}"`);
            }
          }
        }
      }

      // Deep validation for array items
      if (propDef.type === 'array' && propDef.items && Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const itemType = Array.isArray(value[i]) ? 'array' : typeof value[i];
          if (itemType !== propDef.items) {
            errors.push(`Array "${key}" item at index ${i} expected type "${propDef.items}" but got "${itemType}"`);
          }
        }
      }

      // Enum check
      if (propDef.enum && !propDef.enum.includes(value)) {
        errors.push(`Property "${key}" value must be one of: ${propDef.enum.join(', ')}`);
      }

      // Number range check
      if (propDef.type === 'number') {
        if (propDef.min !== undefined && (value as number) < propDef.min) {
          errors.push(`Property "${key}" must be >= ${propDef.min}`);
        }
        if (propDef.max !== undefined && (value as number) > propDef.max) {
          errors.push(`Property "${key}" must be <= ${propDef.max}`);
        }
      }

      // String pattern check
      if (propDef.type === 'string' && propDef.pattern) {
        const regex = new RegExp(propDef.pattern);
        if (!regex.test(value as string)) {
          errors.push(`Property "${key}" does not match pattern "${propDef.pattern}"`);
        }
      }
    }

    // Strict mode: check for unknown properties
    if (schema.strict) {
      for (const key of Object.keys(config)) {
        if (!(key in schema.properties)) {
          errors.push(`Unknown property "${key}"`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  onChange(callback: ConfigChangeCallback): () => void {
    this.changeListeners.push(callback);
    return () => {
      const index = this.changeListeners.indexOf(callback);
      if (index >= 0) this.changeListeners.splice(index, 1);
    };
  }

  exportConfig(pluginName?: string): Record<string, unknown> {
    if (pluginName) {
      return { [pluginName]: this.getPluginConfig(pluginName) };
    }

    const result: Record<string, unknown> = {};
    for (const name of this.pluginConfigs.keys()) {
      result[name] = this.getPluginConfig(name);
    }
    return result;
  }

  importConfig(config: Record<string, unknown>): void {
    for (const [pluginName, pluginConfig] of Object.entries(config)) {
      if (typeof pluginConfig === 'object' && pluginConfig !== null) {
        this.setPluginConfig(pluginName, pluginConfig as Record<string, unknown>);
      }
    }
  }

  resetPluginConfig(pluginName: string): void {
    const oldConfig = this.pluginConfigs.get(pluginName);
    if (oldConfig) {
      for (const key of Object.keys(oldConfig)) {
        for (const listener of this.changeListeners) {
          try {
            listener(pluginName, key, oldConfig[key], undefined);
          } catch {
            // Ignore listener errors
          }
        }
      }
    }
    this.pluginConfigs.delete(pluginName);
  }

  listConfiguredPlugins(): string[] {
    return Array.from(this.pluginConfigs.keys());
  }
}
