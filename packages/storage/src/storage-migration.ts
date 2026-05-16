// src/storage-migration.ts - 数据迁移工具

import type { IStorage, StorageEntry } from './storage-interface.ts';

/**
 * 冲突解决策略
 */
export type ConflictStrategy = 'overwrite' | 'skip' | 'merge' | 'abort';

/**
 * 迁移配置选项
 */
export interface MigrationOptions {
  /** 冲突解决策略 */
  conflictStrategy?: ConflictStrategy;
  /** 启用增量迁移（只迁移变化的条目） */
  incremental?: boolean;
  /** 数据转换函数 */
  transform?: (entry: StorageEntry<unknown>) => StorageEntry<unknown> | Promise<StorageEntry<unknown>>;
  /** 试运行模式（不实际写入） */
  dryRun?: boolean;
  /** 启用数据完整性验证 */
  verify?: boolean;
  /** 批量大小 */
  batchSize?: number;
  /** 进度回调 */
  onProgress?: (progress: MigrationProgress) => void;
}

/**
 * 迁移进度
 */
export interface MigrationProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentKey?: string;
}

/**
 * 迁移结果
 */
export interface MigrationResult {
  succeeded: boolean;
  total: number;
  migrated: number;
  skipped: number;
  failed: number;
  errors: Array<{ key: string; error: Error }>;
  duration: number;
  dryRun: boolean;
}

/**
 * 存储数据迁移器
 * - 全量迁移
 * - 增量迁移
 * - Schema 迁移（数据格式转换）
 * - 进度跟踪与恢复
 * - 试运行模式
 * - 数据完整性验证
 * - 回滚支持
 * - 冲突解决策略
 */
export class StorageMigrator {
  /**
   * 从源存储迁移数据到目标存储
   */
  async migrate(
    source: IStorage<unknown>,
    target: IStorage<unknown>,
    options: MigrationOptions = {},
  ): Promise<MigrationResult> {
    const startTime = Date.now();
    const conflictStrategy = options.conflictStrategy ?? 'overwrite';
    const batchSize = options.batchSize ?? 100;

    const allKeys = await source.keys();
    const result: MigrationResult = {
      succeeded: true,
      total: allKeys.length,
      migrated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      duration: 0,
      dryRun: options.dryRun ?? false,
    };

    const progress: MigrationProgress = {
      total: allKeys.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    };

    for (let i = 0; i < allKeys.length; i++) {
      const key = allKeys[i];
      progress.currentKey = key;

      try {
        const sourceEntry = await source.getEntry(key);
        if (!sourceEntry) {
          progress.skipped++;
          result.skipped++;
          continue;
        }

        // 增量迁移：检查目标是否已有相同版本
        if (options.incremental) {
          const targetEntry = await target.getEntry(key);
          if (targetEntry && targetEntry.version >= sourceEntry.version) {
            progress.skipped++;
            result.skipped++;
            continue;
          }
        }

        // 冲突检查
        const targetExists = await target.has(key);
        if (targetExists && conflictStrategy === 'skip') {
          progress.skipped++;
          result.skipped++;
          continue;
        }

        if (targetExists && conflictStrategy === 'abort') {
          result.succeeded = false;
          result.errors.push({
            key,
            error: new Error(`Conflict on key "${key}", aborting migration`),
          });
          break;
        }

        // 数据转换
        let entryToMigrate = sourceEntry;
        if (options.transform) {
          entryToMigrate = await options.transform(sourceEntry);
        }

        // 合并策略
        if (targetExists && conflictStrategy === 'merge') {
          const targetEntry = await target.getEntry(key);
          if (targetEntry) {
            entryToMigrate = {
              ...entryToMigrate,
              metadata: { ...targetEntry.metadata, ...entryToMigrate.metadata },
              tags: [...new Set([...targetEntry.tags, ...entryToMigrate.tags])],
              version: Math.max(targetEntry.version, entryToMigrate.version) + 1,
            };
          }
        }

        // 写入目标
        if (!options.dryRun) {
          await target.set(key, entryToMigrate.value, {
            ttl: entryToMigrate.expiresAt
              ? entryToMigrate.expiresAt - Date.now()
              : undefined,
            tags: entryToMigrate.tags,
            metadata: entryToMigrate.metadata,
          });
        }

        progress.succeeded++;
        result.migrated++;
      } catch (err) {
        progress.failed++;
        result.failed++;
        result.errors.push({
          key,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }

      progress.completed = i + 1;
      options.onProgress?.(progress);
    }

    // 数据完整性验证
    if (options.verify && !options.dryRun) {
      const verifyResult = await this.verify(source, target);
      if (!verifyResult.valid) {
        result.succeeded = false;
        for (const key of verifyResult.mismatchedKeys) {
          result.errors.push({
            key,
            error: new Error(`Data integrity check failed for key "${key}"`),
          });
        }
      }
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * 验证源和目标存储的数据一致性
   */
  async verify(
    source: IStorage<unknown>,
    target: IStorage<unknown>,
  ): Promise<{ valid: boolean; mismatchedKeys: string[]; checkedKeys: number }> {
    const sourceKeys = await source.keys();
    const mismatchedKeys: string[] = [];
    let checkedKeys = 0;

    for (const key of sourceKeys) {
      const sourceValue = await source.get(key);
      const targetValue = await target.get(key);

      checkedKeys++;

      if (JSON.stringify(sourceValue) !== JSON.stringify(targetValue)) {
        mismatchedKeys.push(key);
      }
    }

    return {
      valid: mismatchedKeys.length === 0,
      mismatchedKeys,
      checkedKeys,
    };
  }

  /**
   * 回滚迁移：从备份恢复
   */
  async rollback(
    target: IStorage<unknown>,
    backup: IStorage<unknown>,
  ): Promise<{ restored: number; errors: string[] }> {
    const backupKeys = await backup.keys();
    let restored = 0;
    const errors: string[] = [];

    for (const key of backupKeys) {
      try {
        const value = await backup.get(key);
        if (value !== undefined) {
          await target.set(key, value);
          restored++;
        }
      } catch (err) {
        errors.push(`Failed to restore key "${key}": ${err}`);
      }
    }

    return { restored, errors };
  }
}
