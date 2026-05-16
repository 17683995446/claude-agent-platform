// ============================================================================
// @claude-agent/perf - BatchProcessor
// 请求批处理，支持时间/数量触发自动刷新、批处理窗口、错误隔离
// ============================================================================

export interface BatchProcessorOptions<TItem, TResult> {
  /** 批处理执行函数 */
  processor: (batch: TItem[]) => Promise<TResult[]>;
  /** 最大批处理大小 */
  maxBatchSize?: number;
  /** 最大等待时间（ms） */
  maxWaitTime?: number;
  /** 并发批处理数 */
  concurrency?: number;
  /** 单个条目失败时是否隔离错误 */
  isolateErrors?: boolean;
  /** 批处理超时时间（ms） */
  batchTimeout?: number;
}

interface BatchEntry<TItem, TResult> {
  item: TItem;
  resolve: (result: TResult) => void;
  reject: (error: Error) => void;
}

export interface BatchProcessorStats {
  /** 已处理批次数 */
  totalBatches: number;
  /** 已处理条目数 */
  totalItems: number;
  /** 平均批处理大小 */
  avgBatchSize: number;
  /** 最大批处理大小 */
  maxBatchSize: number;
  /** 错误次数 */
  errorCount: number;
  /** 当前等待队列大小 */
  pendingItems: number;
  /** 平均处理时间（ms） */
  avgProcessTime: number;
}

export class BatchProcessor<TItem, TResult> {
  private queue: BatchEntry<TItem, TResult>[] = [];
  private options: Required<BatchProcessorOptions<TItem, TResult>>;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private activeBatches = 0;
  private stats = {
    totalBatches: 0,
    totalItems: 0,
    maxBatchSize: 0,
    errorCount: 0,
    totalProcessTime: 0,
  };
  private disposed = false;

  constructor(options: BatchProcessorOptions<TItem, TResult>) {
    this.options = {
      processor: options.processor,
      maxBatchSize: options.maxBatchSize ?? 100,
      maxWaitTime: options.maxWaitTime ?? 50,
      concurrency: options.concurrency ?? 5,
      isolateErrors: options.isolateErrors ?? true,
      batchTimeout: options.batchTimeout ?? 30_000,
    };
  }

  /** 添加条目到批处理队列 */
  add(item: TItem): Promise<TResult> {
    if (this.disposed) {
      return Promise.reject(new Error('BatchProcessor is disposed'));
    }

    return new Promise<TResult>((resolve, reject) => {
      this.queue.push({ item, resolve, reject });

      // Flush immediately if batch is full
      if (this.queue.length >= this.options.maxBatchSize) {
        this.scheduleFlush(0);
        return;
      }

      // Schedule flush with max wait time
      if (!this.flushTimer) {
        this.scheduleFlush(this.options.maxWaitTime);
      }
    });
  }

  /** 手动刷新当前队列 */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    // Check concurrency limit
    if (this.activeBatches >= this.options.concurrency) {
      return;
    }

    // Take items from queue
    const batch = this.queue.splice(0, this.options.maxBatchSize);
    this.activeBatches++;

    // Clear flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Process batch
    this.processBatch(batch).finally(() => {
      this.activeBatches--;

      // If more items in queue, schedule next flush
      if (this.queue.length > 0 && !this.disposed) {
        this.scheduleFlush(0);
      }
    });
  }

  /** 获取统计信息 */
  getStats(): BatchProcessorStats {
    return {
      totalBatches: this.stats.totalBatches,
      totalItems: this.stats.totalItems,
      avgBatchSize:
        this.stats.totalBatches > 0
          ? Math.round(this.stats.totalItems / this.stats.totalBatches)
          : 0,
      maxBatchSize: this.stats.maxBatchSize,
      errorCount: this.stats.errorCount,
      pendingItems: this.queue.length,
      avgProcessTime:
        this.stats.totalBatches > 0
          ? Math.round(this.stats.totalProcessTime / this.stats.totalBatches)
          : 0,
    };
  }

  /** 销毁批处理器 */
  async dispose(): Promise<void> {
    this.disposed = true;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Reject remaining items
    for (const entry of this.queue) {
      entry.reject(new Error('BatchProcessor disposed'));
    }
    this.queue.length = 0;

    // Wait for active batches to complete
    while (this.activeBatches > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private scheduleFlush(delay: number): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, delay);
  }

  private async processBatch(batch: BatchEntry<TItem, TResult>[]): Promise<void> {
    const startTime = Date.now();
    const items = batch.map((entry) => entry.item);

    try {
      const results = await this.withTimeout(
        this.options.processor(items),
        this.options.batchTimeout,
      );

      this.stats.totalBatches++;
      this.stats.totalItems += items.length;
      this.stats.maxBatchSize = Math.max(this.stats.maxBatchSize, items.length);
      this.stats.totalProcessTime += Date.now() - startTime;

      // Resolve each entry
      for (let i = 0; i < batch.length; i++) {
        if (i < results.length) {
          batch[i]!.resolve(results[i]!);
        } else {
          batch[i]!.reject(new Error('Batch processor returned fewer results than expected'));
        }
      }
    } catch (error) {
      this.stats.errorCount++;

      if (this.options.isolateErrors) {
        // Isolate errors: reject all entries in this batch
        const err = error instanceof Error ? error : new Error(String(error));
        for (const entry of batch) {
          entry.reject(err);
        }
      } else {
        // Non-isolated: reject all entries
        const err = error instanceof Error ? error : new Error(String(error));
        for (const entry of batch) {
          entry.reject(err);
        }
      }
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Batch timeout after ${timeout}ms`)), timeout),
      ),
    ]);
  }
}
