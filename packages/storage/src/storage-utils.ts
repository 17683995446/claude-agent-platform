// src/storage-utils.ts - 存储工具集

import type { IStorage, StorageEntry, StorageStats } from './storage-interface.ts';

/**
 * 健康检查结果
 */
export interface HealthCheckResult {
  healthy: boolean;
  latency: number;
  errors: string[];
  stats?: StorageStats;
}

/**
 * 比较结果
 */
export interface ComparisonResult {
  identical: boolean;
  onlyInFirst: string[];
  onlyInSecond: string[];
  differentValues: string[];
  totalCompared: number;
}

/**
 * 存储工具类
 * - 键生成（UUID）
 * - 键验证
 * - 命名空间提取
 * - 值序列化/反序列化
 * - 深度合并
 * - 大小估算
 * - 健康检查
 * - 存储比较
 * - 数据导出/导入
 */
export class StorageUtils {
  /**
   * 生成唯一键
   */
  static generateKey(prefix?: string): string {
    const uuid = crypto.randomUUID();
    return prefix ? `${prefix}:${uuid}` : uuid;
  }

  /**
   * 验证键是否合法
   */
  static isValidKey(key: string): boolean {
    if (typeof key !== 'string') return false;
    if (key.length === 0 || key.length > 512) return false;
    // 不允许控制字符
    if (/[\x00-\x1f\x7f]/.test(key)) return false;
    return true;
  }

  /**
   * 清理键中的不安全字符（仅移除控制字符和空字节）
   */
  static sanitizeKey(key: string): string {
    return key.replace(/[\x00-\x1f\x7f]/g, '');
  }

  /**
   * 从键中提取命名空间
   */
  static extractNamespace(key: string): string {
    const idx = key.indexOf(':');
    return idx >= 0 ? key.slice(0, idx) : '';
  }

  /**
   * 为键添加命名空间前缀
   */
  static withNamespace(key: string, namespace: string): string {
    return `${namespace}:${key}`;
  }

  /**
   * 从键中移除命名空间前缀
   */
  static withoutNamespace(key: string, namespace: string): string {
    const prefix = `${namespace}:`;
    return key.startsWith(prefix) ? key.slice(prefix.length) : key;
  }

  /**
   * 序列化值
   */
  static serialize(value: unknown): string {
    return JSON.stringify(value);
  }

  /**
   * 反序列化值
   */
  static deserialize<T>(data: string): T {
    return JSON.parse(data) as T;
  }

  /**
   * 带 schema 验证的反序列化
   */
  static deserializeWithSchema<T>(
    data: string,
    schema: Record<string, (value: unknown) => boolean>,
  ): T {
    const parsed = JSON.parse(data) as T;
    if (typeof parsed === 'object' && parsed !== null) {
      for (const [field, validator] of Object.entries(schema)) {
        if (!(field in (parsed as Record<string, unknown>))) {
          throw new Error(`Missing required field: ${field}`);
        }
        if (!validator((parsed as Record<string, unknown>)[field])) {
          throw new Error(`Validation failed for field: ${field}`);
        }
      }
    }
    return parsed;
  }

  /**
   * 深度合并对象
   */
  static deepMerge<T extends Record<string, unknown>>(
    target: T,
    ...sources: Partial<T>[]
  ): T {
    const result = { ...target };
    for (const source of sources) {
      for (const key of Object.keys(source) as Array<keyof T>) {
        const sourceVal = source[key];
        const targetVal = result[key];
        if (
          sourceVal &&
          typeof sourceVal === 'object' &&
          !Array.isArray(sourceVal) &&
          targetVal &&
          typeof targetVal === 'object' &&
          !Array.isArray(targetVal)
        ) {
          result[key] = StorageUtils.deepMerge(
            targetVal as Record<string, unknown>,
            sourceVal as Record<string, unknown>,
          ) as T[keyof T];
        } else if (sourceVal !== undefined) {
          result[key] = sourceVal as T[keyof T];
        }
      }
    }
    return result;
  }

  /**
   * 估算值的存储大小（字节）
   */
  static estimateSize(value: unknown): number {
    if (value === null || value === undefined) return 4;
    if (typeof value === 'boolean') return 4;
    if (typeof value === 'number') return 8;
    if (typeof value === 'string') return value.length * 2;
    if (Array.isArray(value)) {
      let size = 8; // array overhead
      for (const item of value) {
        size += StorageUtils.estimateSize(item) + 8; // 8 bytes per reference
      }
      return size;
    }
    if (typeof value === 'object') {
      let size = 8; // object overhead
      for (const [k, v] of Object.entries(value)) {
        size += k.length * 2 + StorageUtils.estimateSize(v) + 8;
      }
      return size;
    }
    return 0;
  }

  /**
   * 存储健康检查
   */
  static async checkHealth(storage: IStorage<unknown>): Promise<HealthCheckResult> {
    const errors: string[] = [];
    const startTime = Date.now();

    try {
      // 测试写入
      const testKey = `__health_check_${Date.now()}`;
      await storage.set(testKey, { test: true, timestamp: Date.now() });

      // 测试读取
      const value = await storage.get(testKey);
      if (!value) {
        errors.push('Write/read round-trip failed');
      }

      // 测试存在性检查
      const exists = await storage.has(testKey);
      if (!exists) {
        errors.push('Existence check failed');
      }

      // 测试删除
      const deleted = await storage.delete(testKey);
      if (!deleted) {
        errors.push('Delete failed');
      }

      // 获取统计
      try {
        const stats = await storage.stats();
        const latency = Date.now() - startTime;
        return {
          healthy: errors.length === 0,
          latency,
          errors,
          stats,
        };
      } catch {
        // stats 不支持
      }
    } catch (err) {
      errors.push(`Health check error: ${err}`);
    }

    return {
      healthy: false,
      latency: Date.now() - startTime,
      errors,
    };
  }

  /**
   * 比较两个存储
   */
  static async compare(
    storage1: IStorage<unknown>,
    storage2: IStorage<unknown>,
  ): Promise<ComparisonResult> {
    const keys1 = await storage1.keys();
    const keys2 = await storage2.keys();
    const set1 = new Set(keys1);
    const set2 = new Set(keys2);

    const onlyInFirst = keys1.filter((k) => !set2.has(k));
    const onlyInSecond = keys2.filter((k) => !set1.has(k));
    const commonKeys = keys1.filter((k) => set2.has(k));

    const differentValues: string[] = [];
    for (const key of commonKeys) {
      const val1 = await storage1.get(key);
      const val2 = await storage2.get(key);
      if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        differentValues.push(key);
      }
    }

    return {
      identical: onlyInFirst.length === 0 && onlyInSecond.length === 0 && differentValues.length === 0,
      onlyInFirst,
      onlyInSecond,
      differentValues,
      totalCompared: keys1.length + keys2.length,
    };
  }

  /**
   * 导出存储数据
   */
  static async exportData(
    storage: IStorage<unknown>,
    format: 'json' | 'csv' = 'json',
  ): Promise<string> {
    const keys = await storage.keys();
    const entries: Array<{ key: string; value: unknown }> = [];

    for (const key of keys) {
      const value = await storage.get(key);
      if (value !== undefined) {
        entries.push({ key, value });
      }
    }

    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }

    // CSV 格式
    const lines: string[] = ['key,value'];
    for (const entry of entries) {
      const valueStr = JSON.stringify(entry.value).replace(/"/g, '""');
      lines.push(`${entry.key},"${valueStr}"`);
    }
    return lines.join('\n');
  }

  /**
   * 导入数据到存储
   */
  static async importData(
    storage: IStorage<unknown>,
    data: string,
    format: 'json' | 'csv' = 'json',
  ): Promise<number> {
    let count = 0;

    if (format === 'json') {
      const entries = JSON.parse(data) as Array<{ key: string; value: unknown }>;
      for (const entry of entries) {
        await storage.set(entry.key, entry.value);
        count++;
      }
    } else {
      // CSV 格式
      const lines = data.split('\n');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const commaIdx = line.indexOf(',');
        if (commaIdx < 0) continue;
        const key = line.slice(0, commaIdx);
        const valueStr = line.slice(commaIdx + 1).replace(/^"|"$/g, '').replace(/""/g, '"');
        try {
          const value = JSON.parse(valueStr);
          await storage.set(key, value);
          count++;
        } catch {
          // If not valid JSON, store as plain string
          await storage.set(key, valueStr);
          count++;
        }
      }
    }

    return count;
  }
}
