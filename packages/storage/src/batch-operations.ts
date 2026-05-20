// src/batch-operations.ts - 批量操作优化

import type { IStorage, SetOptions } from './storage-interface.ts';

/**
 * 存储操作类型
 */
export type StorageOperationType = 'set' | 'delete' | 'get';

/**
 * 单个存储操作
 */
export interface StorageOperation {
  type: StorageOperationType;
  key: string;
  value?: unknown;
  options?: SetOptions;
}

/**
 * 批处理错误策略
 */
export type BatchErrorStrategy = 'skip-failed' | 'abort-on-error' | 'retry-failed';

/**
 * 批处理结果
 */
export interface BatchResult {
  total: number;
  succeeded: number | boolean;
  failed: number;
  errors: Array<{ operation: StorageOperation; error: Error }>;
  duration: number;
}

/**
 * 事务结果
 */
export interface TransactionResult {
  succeeded: boolean;
  operations: number;
  duration: number;
  error?: Error;
}

/**
 * 批处理进度
 */
export interface BatchProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
}

export interface BatchProcessorOptions {
  batchSize?: number;
  flushInterval?: number;
  errorStrategy?: BatchErrorStrategy;
  maxRetries?: number;
  maxBatchSize?: number;
  atomic?: boolean;
}

type ProgressCallback = (progress: BatchProgress) => void;

/**
 * 批处理器 - 高效批量存储操作
 * - 自动批量收集与执行
 * - 可配置批量大小和刷新间隔
 * - 操作去重（批量内 last-write-wins）
 * - 错误处理策略
 * - 进度跟踪
 * - 事务支持
 */
export class BatchProcessor {
  private pendingOps: StorageOperation[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private processingPromise: Promise<BatchResult> | null = null;
  private progressCallbacks: ProgressCallback[] = [];
  private totalSucceeded = 0;
  private totalFailed = 0;

  private readonly storage: IStorage<unknown>;
  private readonly batchSize: number;
  private readonly flushInterval: number;
  private readonly errorStrategy: BatchErrorStrategy;
  private readonly maxRetries: number;
  private readonly maxBatchSize: number;
  private readonly atomic: boolean;

  constructor(
    storage: IStorage<unknown>,
    options: BatchProcessorOptions = {},
  ) {
    this.storage = storage;
    this.batchSize = options.batchSize ?? 100;
    this.flushInterval = options.flushInterval ?? 1000;
    this.errorStrategy = options.errorStrategy ?? 'skip-failed';
    this.maxRetries = options.maxRetries ?? 3;
    this.maxBatchSize = options.maxBatchSize ?? 10000;
    this.atomic = options.atomic ?? false;
  }

  /**
   * 注册进度回调
   */
  onProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.push(callback);
    return () => {
      this.progressCallbacks = this.progressCallbacks.filter((cb) => cb !== callback);
    };
  }

  private notifyProgress(progress: BatchProgress): void {
    for (const cb of this.progressCallbacks) {
      try {
        cb(progress);
      } catch {
        // ignore
      }
    }
  }

  /**
   * 将操作加入队列
   */
  async queue(operation: StorageOperation): Promise<void> {
    this.pendingOps.push(operation);

    if (this.pendingOps.length >= this.batchSize) {
      // Trigger flush via immediate timer to allow current queue call to return
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush().catch(() => {});
      }, 0);
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush().catch(() => {});
      }, this.flushInterval);
    }
  }

  private deduplicateOps(): void {
    const seen = new Map<string, number>();
    // 从后往前遍历，保留最后一次写入
    for (let i = this.pendingOps.length - 1; i >= 0; i--) {
      const op = this.pendingOps[i];
      if (!seen.has(op.key)) {
        seen.set(op.key, i);
      }
    }
    const indices = new Set(seen.values());
    this.pendingOps = this.pendingOps.filter((_, i) => indices.has(i));
  }

  /**
   * 刷新队列，执行所有待处理操作
   */
  async flush(): Promise<BatchResult> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.processing) {
      // Wait for the current processing to finish, then return its result
      if (this.processingPromise) {
        return this.processingPromise;
      }
      return { total: 0, succeeded: 0, failed: 0, errors: [], duration: 0 };
    }

    if (this.pendingOps.length === 0) {
      return { total: 0, succeeded: 0, failed: 0, errors: [], duration: 0 };
    }

    this.processing = true;
    const flushPromise = this.doFlush();
    this.processingPromise = flushPromise;
    try {
      return await flushPromise;
    } finally {
      this.processingPromise = null;
    }
  }

  private async doFlush(): Promise<BatchResult> {
    const startTime = Date.now();

    // 去重：同一 key 的操作，保留最后一个
    this.deduplicateOps();

    const batch = [...this.pendingOps];
    this.pendingOps = [];

    try {
      // 原子模式：使用事务执行
      if (this.atomic) {
        const txResult = await this.transaction(batch);
        const result: BatchResult = {
          total: batch.length,
          succeeded: txResult.succeeded,
          failed: txResult.succeeded ? 0 : batch.length,
          errors: txResult.error ? [{ operation: batch[0], error: txResult.error }] : [],
          duration: txResult.duration,
        };
        return result;
      }

      const result: BatchResult = {
        total: batch.length,
        succeeded: 0,
        failed: 0,
        errors: [],
        duration: 0,
      };

      for (let i = 0; i < batch.length; i++) {
        const op = batch[i];
        try {
          await this.executeOperation(op);
          result.succeeded++;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));

          if (this.errorStrategy === 'abort-on-error') {
            result.failed = batch.length - i;
            result.errors.push({ operation: op, error });
            break;
          } else if (this.errorStrategy === 'retry-failed') {
            const success = await this.retryOperation(op);
            if (success) {
              result.succeeded++;
            } else {
              result.failed++;
              result.errors.push({ operation: op, error });
            }
          } else {
            // skip-failed
            result.failed++;
            result.errors.push({ operation: op, error });
          }
        }

        this.notifyProgress({
          total: batch.length,
          completed: i + 1,
          succeeded: result.succeeded as number,
          failed: result.failed,
        });
      }

      result.duration = Date.now() - startTime;
      return result;
    } finally {
      this.processing = false;
    }
  }

  private async executeOperation(op: StorageOperation): Promise<void> {
    switch (op.type) {
      case 'set':
        await this.storage.set(op.key, op.value!, op.options);
        break;
      case 'delete':
        await this.storage.delete(op.key);
        break;
      case 'get':
        await this.storage.get(op.key);
        break;
    }
  }

  private async retryOperation(op: StorageOperation): Promise<boolean> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        await this.executeOperation(op);
        return true;
      } catch {
        // 重试
      }
    }
    return false;
  }

  /**
   * 事务执行：所有操作要么全部成功，要么全部回滚
   */
  async transaction(operations: StorageOperation[]): Promise<TransactionResult> {
    const startTime = Date.now();
    const backup = new Map<string, unknown>();
    const createdKeys = new Set<string>();
    const deletedKeys = new Set<string>();

    // 预保存受影响的键
    for (const op of operations) {
      if (op.type === 'set' || op.type === 'delete') {
        const existing = await this.storage.get(op.key);
        if (existing !== undefined) {
          backup.set(op.key, existing);
        } else if (op.type === 'set') {
          // 记录新创建的键
          createdKeys.add(op.key);
        }
        if (op.type === 'delete' && existing !== undefined) {
          deletedKeys.add(op.key);
        }
      }
    }

    try {
      for (const op of operations) {
        await this.executeOperation(op);
      }

      return {
        succeeded: true,
        operations: operations.length,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      // 回滚：恢复被修改的键
      for (const [key, value] of backup) {
        try {
          await this.storage.set(key, value);
        } catch {
          // 回滚失败
        }
      }
      // 回滚：删除事务期间新创建的键
      for (const key of createdKeys) {
        try {
          await this.storage.delete(key);
        } catch {
          // 回滚失败
        }
      }

      return {
        succeeded: false,
        operations: operations.length,
        duration: Date.now() - startTime,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  /**
   * 获取当前队列大小
   */
  getQueueSize(): number {
    return this.pendingOps.length;
  }
}
