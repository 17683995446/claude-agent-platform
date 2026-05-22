// src/config-editor.ts - 交互式配置编辑器模块

export interface ConfigNode {
  path: string;
  key: string;
  value: unknown;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'undefined';
  children?: ConfigNode[];
  description?: string;
  defaultValue?: unknown;
  isModified?: boolean;
}

export interface ConfigDiff {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  type: 'added' | 'removed' | 'changed';
}

export interface ConfigSchema {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  required?: boolean;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ConfigEditor {
  private config: Record<string, unknown>;
  private original: Record<string, unknown>;
  private defaults: Record<string, unknown> = {};
  private schema: Record<string, ConfigSchema> = {};
  private history: Array<{ action: string; path: string; oldValue: unknown; newValue: unknown }> = [];

  constructor(config: Record<string, unknown>) {
    this.config = this.deepClone(config);
    this.original = this.deepClone(config);
  }

  /**
   * 编辑配置（交互式入口）
   */
  async edit(config: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.config = this.deepClone(config);
    this.original = this.deepClone(config);
    return this.config;
  }

  /**
   * 导航配置树
   */
  navigate(path: string): ConfigNode {
    const keys = path.split('.').filter(Boolean);
    let current: unknown = this.config;

    for (const key of keys) {
      if (current === null || current === undefined || typeof current !== 'object') {
        throw new Error(`Cannot navigate to "${path}": "${key}" is not an object`);
      }
      current = (current as Record<string, unknown>)[key];
    }

    return this.createConfigNode(path, keys[keys.length - 1] ?? '', current);
  }

  /**
   * 设置配置值
   */
  setValue(path: string, value: unknown): void {
    const keys = path.split('.').filter(Boolean);
    const oldValue = this.getNestedValue(this.config, path);

    if (keys.length === 1) {
      this.config[keys[0]] = value;
    } else {
      let current = this.config;
      for (let i = 0; i < keys.length - 1; i++) {
        const existing = current[keys[i]];
        if (existing === null || existing === undefined || typeof existing !== 'object' || Array.isArray(existing)) {
          // Warn when overwriting non-object intermediate values
          if (existing !== undefined && existing !== null && typeof existing !== 'object') {
            console.warn(`Warning: Overwriting non-object value at "${keys.slice(0, i + 1).join('.')}" with object to set "${path}"`);
          }
          current[keys[i]] = {};
        }
        current = current[keys[i]] as Record<string, unknown>;
      }
      current[keys[keys.length - 1]] = value;
    }

    this.history.push({
      action: 'set',
      path,
      oldValue,
      newValue: value,
    });
  }

  /**
   * 获取配置值
   */
  getValue(path: string): unknown {
    return this.getNestedValue(this.config, path);
  }

  /**
   * 删除配置项
   */
  deleteValue(path: string): void {
    const keys = path.split('.').filter(Boolean);
    const oldValue = this.getNestedValue(this.config, path);

    if (keys.length === 1) {
      delete this.config[keys[0]];
    } else {
      let current = this.config;
      for (let i = 0; i < keys.length - 1; i++) {
        if (typeof current[keys[i]] !== 'object' || current[keys[i]] === null) {
          return;
        }
        current = current[keys[i]] as Record<string, unknown>;
      }
      delete current[keys[keys.length - 1]];
    }

    this.history.push({
      action: 'delete',
      path,
      oldValue,
      newValue: undefined,
    });
  }

  /**
   * 重置配置到默认值
   */
  reset(path?: string): void {
    if (path) {
      const defaultValue = this.getNestedValue(this.defaults, path);
      if (defaultValue !== undefined) {
        const oldValue = this.getNestedValue(this.config, path);
        this.setValue(path, defaultValue);
        this.history.push({
          action: 'reset',
          path,
          oldValue,
          newValue: defaultValue,
        });
      }
    } else {
      this.config = this.deepClone(this.defaults);
      this.history.push({
        action: 'reset',
        path: '*',
        oldValue: this.deepClone(this.original),
        newValue: this.deepClone(this.defaults),
      });
    }
  }

  /**
   * 预览配置差异
   */
  preview(): ConfigDiff[] {
    return this.computeDiff(this.original, this.config, '');
  }

  /**
   * 验证配置
   */
  validate(): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const [path, schema] of Object.entries(this.schema)) {
      const value = this.getNestedValue(this.config, path);

      if (schema.required && (value === undefined || value === null)) {
        errors.push(`"${path}" is required`);
        continue;
      }

      if (value === undefined) continue;

      // Type check
      if (schema.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== schema.type) {
          errors.push(`"${path}" should be ${schema.type}, got ${actualType}`);
        }
      }

      // Enum check
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`"${path}" must be one of: ${schema.enum.join(', ')}`);
      }

      // Number checks
      if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
          errors.push(`"${path}" must be >= ${schema.minimum}`);
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
          errors.push(`"${path}" must be <= ${schema.maximum}`);
        }
      }

      // String checks
      if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
          errors.push(`"${path}" must be at least ${schema.minLength} characters`);
        }
        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
          errors.push(`"${path}" must be at most ${schema.maxLength} characters`);
        }
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
          errors.push(`"${path}" does not match pattern "${schema.pattern}"`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 设置默认值
   */
  setDefaults(defaults: Record<string, unknown>): void {
    this.defaults = this.deepClone(defaults);
  }

  /**
   * 设置配置 schema
   */
  setSchema(schema: Record<string, ConfigSchema>): void {
    this.schema = schema;
  }

  /**
   * 获取当前配置
   */
  getConfig(): Record<string, unknown> {
    return this.deepClone(this.config);
  }

  /**
   * 获取修改历史
   */
  getHistory(): Array<{ action: string; path: string; oldValue: unknown; newValue: unknown }> {
    return [...this.history];
  }

  /**
   * 检查是否有未保存的更改
   */
  isDirty(): boolean {
    return JSON.stringify(this.config) !== JSON.stringify(this.original);
  }

  /**
   * 合并配置
   */
  merge(patch: Record<string, unknown>): void {
    this.config = this.deepMerge(this.config, patch);
  }

  /**
   * 获取所有键
   */
  getKeys(path?: string): string[] {
    const target = path ? this.getNestedValue(this.config, path) : this.config;
    if (typeof target !== 'object' || target === null) return [];
    return Object.keys(target);
  }

  private createConfigNode(path: string, key: string, value: unknown): ConfigNode {
    const type = value === null ? 'null'
      : Array.isArray(value) ? 'array'
      : value === undefined ? 'undefined'
      : typeof value as ConfigNode['type'];

    const node: ConfigNode = {
      path,
      key,
      value,
      type,
      defaultValue: this.getNestedValue(this.defaults, path),
      isModified: JSON.stringify(value) !== JSON.stringify(this.getNestedValue(this.original, path)),
    };

    if (type === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      node.children = Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        this.createConfigNode(`${path}.${k}`, k, v)
      );
    }

    return node;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split('.').filter(Boolean);
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  private computeDiff(original: Record<string, unknown>, current: Record<string, unknown>, prefix: string): ConfigDiff[] {
    const diffs: ConfigDiff[] = [];
    const allKeys = new Set([...Object.keys(original), ...Object.keys(current)]);

    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const oldVal = original[key];
      const newVal = current[key];

      if (!(key in original)) {
        diffs.push({ path, oldValue: undefined, newValue: newVal, type: 'added' });
      } else if (!(key in current)) {
        diffs.push({ path, oldValue: oldVal, newValue: undefined, type: 'removed' });
      } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        if (typeof oldVal === 'object' && oldVal !== null && typeof newVal === 'object' && newVal !== null && !Array.isArray(oldVal) && !Array.isArray(newVal)) {
          diffs.push(...this.computeDiff(oldVal as Record<string, unknown>, newVal as Record<string, unknown>, path));
        } else {
          diffs.push({ path, oldValue: oldVal, newValue: newVal, type: 'changed' });
        }
      }
    }

    return diffs;
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      const targetVal = result[key];
      const sourceVal = source[key];

      if (typeof targetVal === 'object' && targetVal !== null && !Array.isArray(targetVal) &&
          typeof sourceVal === 'object' && sourceVal !== null && !Array.isArray(sourceVal)) {
        result[key] = this.deepMerge(targetVal as Record<string, unknown>, sourceVal as Record<string, unknown>);
      } else {
        result[key] = sourceVal;
      }
    }

    return result;
  }
}
