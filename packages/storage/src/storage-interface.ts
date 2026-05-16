// src/storage-interface.ts - 统一存储接口

/**
 * Set 操作的配置选项
 */
export interface SetOptions {
  /** 过期时间（毫秒） */
  ttl?: number;
  /** 标签列表，用于分类和查询 */
  tags?: string[];
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 存储条目，包含值及其元信息
 */
export interface StorageEntry<T> {
  value: T;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  tags: string[];
  metadata: Record<string, unknown>;
  version: number;
}

/**
 * 存储统计信息
 */
export interface StorageStats {
  totalKeys: number;
  totalSize: number;
  hitRate: number;
  missRate: number;
  evictionCount: number;
}

/**
 * 存储变更事件
 */
export interface StorageChangeEvent<T> {
  type: 'set' | 'delete' | 'expire' | 'evict';
  key: string;
  entry?: StorageEntry<T>;
  timestamp: number;
}

/**
 * 统一存储接口 - 泛型接口定义所有存储后端的通用操作
 */
export interface IStorage<T> {
  /** 获取值 */
  get(key: string): Promise<T | undefined>;
  /** 设置值 */
  set(key: string, value: T, options?: SetOptions): Promise<void>;
  /** 删除值，返回是否成功删除 */
  delete(key: string): Promise<boolean>;
  /** 检查键是否存在 */
  has(key: string): Promise<boolean>;
  /** 获取所有匹配模式的键 */
  keys(pattern?: string): Promise<string[]>;
  /** 清空所有数据 */
  clear(): Promise<void>;
  /** 获取存储大小 */
  size(): Promise<number>;
  /** 创建命名空间隔离的存储实例 */
  namespace(name: string): IStorage<T>;
  /** 获取存储统计信息 */
  stats(): Promise<StorageStats>;
  /** 获取完整存储条目（包含元信息） */
  getEntry(key: string): Promise<StorageEntry<T> | undefined>;
}

/**
 * 命名空间存储 - 为现有存储添加命名空间前缀
 */
export class NamespacedStorage<T> implements IStorage<T> {
  private readonly prefix: string;

  constructor(
    private readonly storage: IStorage<T>,
    name: string,
  ) {
    this.prefix = `${name}:`;
  }

  private withPrefix(key: string): string {
    return `${this.prefix}${key}`;
  }

  private stripPrefix(key: string): string {
    return key.startsWith(this.prefix) ? key.slice(this.prefix.length) : key;
  }

  async get(key: string): Promise<T | undefined> {
    return this.storage.get(this.withPrefix(key));
  }

  async set(key: string, value: T, options?: SetOptions): Promise<void> {
    return this.storage.set(this.withPrefix(key), value, options);
  }

  async delete(key: string): Promise<boolean> {
    return this.storage.delete(this.withPrefix(key));
  }

  async has(key: string): Promise<boolean> {
    return this.storage.has(this.withPrefix(key));
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = await this.storage.keys(`${this.prefix}${pattern || '*'}`);
    return allKeys.map((k) => this.stripPrefix(k));
  }

  async clear(): Promise<void> {
    const allKeys = await this.keys();
    await Promise.all(allKeys.map((k) => this.delete(k)));
  }

  async size(): Promise<number> {
    return this.keys().then((k) => k.length);
  }

  namespace(name: string): IStorage<T> {
    return new NamespacedStorage(this.storage, `${this.prefix}${name}`);
  }

  async stats(): Promise<StorageStats> {
    return this.storage.stats();
  }

  async getEntry(key: string): Promise<StorageEntry<T> | undefined> {
    return this.storage.getEntry(this.withPrefix(key));
  }
}
