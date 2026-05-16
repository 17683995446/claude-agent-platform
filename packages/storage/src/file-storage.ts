// src/file-storage.ts - 文件系统存储

import type {
  IStorage,
  SetOptions,
  StorageEntry,
  StorageStats,
} from './storage-interface.ts';
import { NamespacedStorage } from './storage-interface.ts';
import { readdir, readFile, writeFile, mkdir, unlink, rename, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';

/**
 * FileStorage 配置选项
 */
export interface FileStorageOptions {
  /** 存储目录路径 */
  directory?: string;
  /** 文件编码 */
  encoding?: BufferEncoding;
  /** 启用 gzip 压缩的阈值（字节），低于此值不压缩 */
  compressionThreshold?: number;
  /** 是否启用 hash 分片 */
  sharding?: boolean;
  /** 分片数量（当 sharding 为 true 时生效） */
  shardCount?: number;
}

const DEFAULT_OPTIONS: Required<FileStorageOptions> = {
  directory: './storage-data',
  encoding: 'utf-8',
  compressionThreshold: 1024,
  sharding: false,
  shardCount: 16,
};

/**
 * 文件系统存储实现
 * - JSON 文件持久化，原子写入（写临时文件 + 重命名）
 * - 目录结构组织键
 * - gzip 压缩大值
 * - 自动清理过期条目
 * - 备份与恢复
 */
export class FileStorage<T> implements IStorage<T> {
  private readonly directory: string;
  private readonly encoding: BufferEncoding;
  private readonly compressionThreshold: number;
  private readonly sharding: boolean;
  private readonly shardCount: number;
  private _evictionCount = 0;

  constructor(options: FileStorageOptions = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    this.directory = opts.directory;
    this.encoding = opts.encoding;
    this.compressionThreshold = opts.compressionThreshold;
    this.sharding = opts.sharding;
    this.shardCount = opts.shardCount;
  }

  private getFilePath(key: string): string {
    const safeKey = key.replace(/[\/\\:*?"<>|]/g, '_');
    if (this.sharding) {
      const hash = simpleHash(key) % this.shardCount;
      return join(this.directory, `shard-${hash}`, `${safeKey}.json`);
    }
    return join(this.directory, `${safeKey}.json`);
  }

  private async ensureDir(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  private serializeEntry(entry: StorageEntry<T>): string {
    const json = JSON.stringify(entry);
    const buffer = Buffer.from(json, this.encoding);
    if (buffer.length > this.compressionThreshold) {
      const compressed = gzipSync(buffer);
      const wrapper = { __compressed: true, data: compressed.toString('base64') };
      return JSON.stringify(wrapper);
    }
    return json;
  }

  private deserializeEntry(raw: string): StorageEntry<T> {
    const parsed = JSON.parse(raw);
    if (parsed.__compressed) {
      const buffer = Buffer.from(parsed.data, 'base64');
      const decompressed = gunzipSync(buffer);
      return JSON.parse(decompressed.toString(this.encoding));
    }
    return parsed as StorageEntry<T>;
  }

  private isExpired(entry: StorageEntry<T>): boolean {
    return entry.expiresAt !== undefined && Date.now() > entry.expiresAt;
  }

  // ---- IStorage 接口实现 ----

  async get(key: string): Promise<T | undefined> {
    const filePath = this.getFilePath(key);
    try {
      const raw = await readFile(filePath, this.encoding);
      const entry = this.deserializeEntry(raw);
      if (this.isExpired(entry)) {
        await this.delete(key);
        return undefined;
      }
      return entry.value;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: T, options?: SetOptions): Promise<void> {
    const filePath = this.getFilePath(key);
    await this.ensureDir(filePath);

    const now = Date.now();
    let existing: StorageEntry<T> | undefined;
    try {
      const raw = await readFile(filePath, this.encoding);
      existing = this.deserializeEntry(raw);
    } catch {
      // 文件不存在，创建新条目
    }

    const entry: StorageEntry<T> = {
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: options?.ttl ? now + options.ttl : undefined,
      tags: options?.tags ?? existing?.tags ?? [],
      metadata: options?.metadata ?? existing?.metadata ?? {},
      version: existing ? existing.version + 1 : 1,
    };

    const serialized = this.serializeEntry(entry);
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, serialized, this.encoding);
    await rename(tmpPath, filePath);
  }

  async delete(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async has(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== undefined;
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys: string[] = [];
    await this.collectKeys(this.directory, allKeys, pattern);
    return allKeys;
  }

  private async collectKeys(dir: string, result: string[], pattern?: string): Promise<void> {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.collectKeys(fullPath, result, pattern);
      } else if (entry.name.endsWith('.json')) {
        const key = entry.name.slice(0, -5);
        if (!pattern || matchPattern(key, pattern)) {
          result.push(key);
        }
      }
    }
  }

  async clear(): Promise<void> {
    const allKeys = await this.keys();
    await Promise.all(allKeys.map((k) => this.delete(k)));
  }

  async size(): Promise<number> {
    return this.keys().then((k) => k.length);
  }

  namespace(name: string): IStorage<T> {
    return new NamespacedStorage(this, name);
  }

  async stats(): Promise<StorageStats> {
    const allKeys = await this.keys();
    let totalSize = 0;
    for (const key of allKeys) {
      const filePath = this.getFilePath(key);
      try {
        const s = await stat(filePath);
        totalSize += s.size;
      } catch {
        // ignore
      }
    }
    return {
      totalKeys: allKeys.length,
      totalSize,
      hitRate: 0,
      missRate: 0,
      evictionCount: this._evictionCount,
    };
  }

  async getEntry(key: string): Promise<StorageEntry<T> | undefined> {
    const filePath = this.getFilePath(key);
    try {
      const raw = await readFile(filePath, this.encoding);
      const entry = this.deserializeEntry(raw);
      if (this.isExpired(entry)) {
        await this.delete(key);
        return undefined;
      }
      return entry;
    } catch {
      return undefined;
    }
  }

  // ---- 扩展功能 ----

  /**
   * 清理过期条目
   */
  async cleanupExpired(): Promise<number> {
    const allKeys = await this.keys();
    let cleaned = 0;
    for (const key of allKeys) {
      const entry = await this.getEntry(key);
      if (!entry) {
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * 备份到指定目录
   */
  async backup(backupDir: string): Promise<void> {
    await mkdir(backupDir, { recursive: true });
    const allKeys = await this.keys();
    for (const key of allKeys) {
      const srcPath = this.getFilePath(key);
      const destPath = join(backupDir, `${key.replace(/[\/\\:*?"<>|]/g, '_')}.json`);
      await this.ensureDir(destPath);
      try {
        const { copyFile } = await import('node:fs/promises');
        await copyFile(srcPath, destPath);
      } catch {
        // ignore
      }
    }
  }

  /**
   * 从备份恢复
   */
  async restore(backupDir: string): Promise<number> {
    if (!existsSync(backupDir)) return 0;
    const entries = await readdir(backupDir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        const srcPath = join(backupDir, entry.name);
        const key = entry.name.slice(0, -5);
        const destPath = this.getFilePath(key);
        await this.ensureDir(destPath);
        try {
          const { copyFile } = await import('node:fs/promises');
          await copyFile(srcPath, destPath);
          count++;
        } catch {
          // ignore
        }
      }
    }
    return count;
  }
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}

function matchPattern(key: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
  );
  return regex.test(key);
}
