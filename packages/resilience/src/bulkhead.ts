// bulkhead.ts - 舱壁隔离

export interface BulkheadConfig {
  maxConcurrent: number;
  maxQueueSize: number;
  queueTimeout?: number;
}

export class BulkheadFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkheadFullError';
  }
}

export class BulkheadQueueTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkheadQueueTimeoutError';
  }
}

interface QueueEntry {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  fn: () => Promise<unknown>;
  timer?: ReturnType<typeof setTimeout>;
}

export class Bulkhead {
  private activeCount = 0;
  private queue: QueueEntry[] = [];
  private readonly config: Required<BulkheadConfig>;

  constructor(config: BulkheadConfig) {
    this.config = {
      queueTimeout: 30000,
      ...config,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // NOTE: Check-then-act race condition on queue size. In single-threaded
    // JavaScript (Node.js), this is safe because no async operations occur
    // between the check and the enqueue. If ever used in a multi-threaded
    // context, this would need atomic compare-and-swap semantics.
    if (this.activeCount < this.config.maxConcurrent) {
      return this.runDirectly(fn);
    }

    if (this.queue.length >= this.config.maxQueueSize) {
      throw new BulkheadFullError(`Bulkhead is full: ${this.config.maxConcurrent} active, ${this.config.maxQueueSize} queued`);
    }

    return this.enqueue(fn);
  }

  getAvailableSlots(): number {
    return Math.max(0, this.config.maxConcurrent - this.activeCount);
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  private async runDirectly<T>(fn: () => Promise<T>): Promise<T> {
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      this.processQueue();
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve: resolve as (value: unknown) => void,
        reject,
        fn,
      };

      if (this.config.queueTimeout > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            reject(new BulkheadQueueTimeoutError(`Queue timeout after ${this.config.queueTimeout}ms`));
          }
        }, this.config.queueTimeout);
      }

      this.queue.push(entry);
    });
  }

  private processQueue(): void {
    while (this.queue.length > 0 && this.activeCount < this.config.maxConcurrent) {
      const entry = this.queue.shift()!;
      if (entry.timer) clearTimeout(entry.timer);

      this.activeCount++;
      const fn = entry.fn as () => Promise<unknown>;
      fn()
        .then(entry.resolve)
        .catch(entry.reject)
        .finally(() => {
          this.activeCount--;
          this.processQueue();
        });
    }
  }
}
