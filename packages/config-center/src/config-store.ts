/**
 * 配置存储模块 - ConfigStore
 * 中央配置仓库，支持层级配置、深度合并、版本管理和路径监听
 */

export type WatchCallback = (path: string, newValue: unknown, oldValue: unknown) => void;
export type UnwatchFn = () => void;

interface Watcher {
  path: string;
  callback: WatchCallback;
}

interface ConfigVersion {
  id: string;
  timestamp: number;
  data: Record<string, unknown>;
  label?: string;
}

/**
 * 危险的属性键，可能导致原型污染
 */
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * 检查键是否为危险的属性键
 */
function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.includes(key);
}

/**
 * 深度合并两个对象
 * SECURITY FIX: 添加原型污染防护，拒绝处理危险的键
 */
export function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    // SECURITY FIX: 跳过危险的键，防止原型污染
    if (isDangerousKey(key)) {
      continue;
    }
    const sv = source[key];
    const tv = result[key];
    if (
      sv !== null &&
      typeof sv === 'object' &&
      !Array.isArray(sv) &&
      tv !== null &&
      typeof tv === 'object' &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      result[key] = sv;
    }
  }
  return result;
}

/**
 * 通过点号路径获取嵌套值
 * SECURITY FIX: 添加原型污染防护，拒绝访问危险的键
 */
export function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    // SECURITY FIX: 拒绝访问危险的键，防止原型污染
    if (isDangerousKey(part)) {
      return undefined;
    }
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * 通过点号路径设置嵌套值
 * SECURITY FIX: 添加原型污染防护，拒绝设置危险的键
 */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    // SECURITY FIX: 拒绝访问或创建危险的键路径
    if (isDangerousKey(part)) {
      return;
    }
    if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1];
  // SECURITY FIX: 拒绝设置危险的键
  if (isDangerousKey(lastPart)) {
    return;
  }
  current[lastPart] = value;
}

/**
 * 通过点号路径删除嵌套值
 * SECURITY FIX: 添加原型污染防护，拒绝删除危险的键
 */
export function deleteByPath(obj: Record<string, unknown>, path: string): boolean {
  const parts = path.split('.');
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    // SECURITY FIX: 拒绝访问危险的键路径
    if (isDangerousKey(part)) {
      return false;
    }
    if (current === null || current === undefined || typeof current !== 'object') {
      return false;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current === null || current === undefined || typeof current !== 'object') {
    return false;
  }
  const lastPart = parts[parts.length - 1];
  // SECURITY FIX: 拒绝删除危险的键
  if (isDangerousKey(lastPart)) {
    return false;
  }
  if (lastPart in (current as Record<string, unknown>)) {
    delete (current as Record<string, unknown>)[lastPart];
    return true;
  }
  return false;
}

/**
 * 通过点号路径检查是否存在
 * SECURITY FIX: 添加原型污染防护，拒绝检查危险的键
 */
export function hasByPath(obj: Record<string, unknown>, path: string): boolean {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    // SECURITY FIX: 拒绝检查危险的键
    if (isDangerousKey(part)) {
      return false;
    }
    if (current === null || current === undefined || typeof current !== 'object') {
      return false;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current !== undefined;
}

/**
 * ConfigStore - 中央配置仓库
 *
 * 支持层级配置：global → environment → service → instance
 * 配置合并采用深度合并策略
 * 支持配置版本管理与历史记录
 * 支持点号路径访问和监听
 */
export class ConfigStore {
  private data: Record<string, unknown> = {};
  private watchers: Watcher[] = [];
  private versions: ConfigVersion[] = [];
  private versionCounter = 0;

  constructor(initialData?: Record<string, unknown>) {
    if (initialData) {
      this.data = deepMerge({}, initialData);
    }
  }

  /**
   * 获取配置值，支持点号路径
   */
  get(path: string): unknown {
    if (path === '') {
      return { ...this.data };
    }
    return getByPath(this.data, path);
  }

  /**
   * 设置配置值，支持点号路径
   */
  set(path: string, value: unknown): void {
    const oldValue = this.get(path);
    setByPath(this.data, path, value);
    this.notifyWatchers(path, value, oldValue);
  }

  /**
   * 删除配置值，返回是否成功
   */
  delete(path: string): boolean {
    const oldValue = this.get(path);
    const result = deleteByPath(this.data, path);
    if (result) {
      this.notifyWatchers(path, undefined, oldValue);
    }
    return result;
  }

  /**
   * 检查配置路径是否存在
   */
  has(path: string): boolean {
    return hasByPath(this.data, path);
  }

  /**
   * 监听配置变化
   */
  watch(path: string, callback: WatchCallback): UnwatchFn {
    const watcher: Watcher = { path, callback };
    this.watchers.push(watcher);
    return () => {
      const idx = this.watchers.indexOf(watcher);
      if (idx !== -1) {
        this.watchers.splice(idx, 1);
      }
    };
  }

  /**
   * 合并配置对象（深度合并）
   */
  merge(config: Record<string, unknown>): void {
    this.data = deepMerge(this.data, config);
  }

  /**
   * 获取所有配置的浅拷贝
   */
  getAll(): Record<string, unknown> {
    return { ...this.data };
  }

  /**
   * 清空所有配置
   */
  clear(): void {
    this.data = {};
  }

  /**
   * 创建配置版本快照
   */
  createVersion(label?: string): string {
    this.versionCounter++;
    const id = `v${this.versionCounter}`;
    this.versions.push({
      id,
      timestamp: Date.now(),
      data: JSON.parse(JSON.stringify(this.data)),
      label,
    });
    return id;
  }

  /**
   * 获取版本历史
   */
  getVersions(): ConfigVersion[] {
    return [...this.versions];
  }

  /**
   * 恢复到指定版本
   */
  restoreVersion(versionId: string): boolean {
    const version = this.versions.find((v) => v.id === versionId);
    if (!version) return false;
    this.data = JSON.parse(JSON.stringify(version.data));
    return true;
  }

  private notifyWatchers(path: string, newValue: unknown, oldValue: unknown): void {
    for (const watcher of this.watchers) {
      if (watcher.path === path || path.startsWith(watcher.path + '.')) {
        try {
          watcher.callback(path, newValue, oldValue);
        } catch {
          // swallow watcher errors
        }
      }
    }
  }
}
