/**
 * Managed pool of async workers.
 */

interface PendingTask<T, R> {
  task: T;
  handler: (task: T) => Promise<R>;
  resolve: (value: R) => void;
  reject: (reason: unknown) => void;
  enqueuedAt: number;
}

interface WorkerInfo {
  busy: boolean;
  currentTaskStartedAt?: number;
}

export class WorkerPool<T = unknown, R = unknown> {
  private minWorkers: number;
  private maxWorkers: number;
  private taskTimeout: number;
  private workers: WorkerInfo[] = [];
  private pendingTasks: PendingTask<T, R>[] = [];
  private completedTasks: number = 0;
  private failedTasks: number = 0;
  private totalWaitTime: number = 0;
  private terminated: boolean = false;

  constructor(options?: {
    minWorkers?: number;
    maxWorkers?: number;
    taskTimeout?: number;
  }) {
    this.minWorkers = options?.minWorkers ?? 1;
    this.maxWorkers = options?.maxWorkers ?? 10;
    this.taskTimeout = options?.taskTimeout ?? 30000;

    // Initialize minimum workers
    for (let i = 0; i < this.minWorkers; i++) {
      this.workers.push({ busy: false });
    }
  }

  async submit(task: T, handler: (task: T) => Promise<R>): Promise<R> {
    if (this.terminated) {
      throw new Error('Worker pool is terminated');
    }

    return new Promise<R>((resolve, reject) => {
      const enqueuedAt = Date.now();
      this.pendingTasks.push({ task, handler, resolve, reject, enqueuedAt });
      this.processQueue();
    });
  }

  async submitBatch(tasks: T[], handler: (task: T) => Promise<R>): Promise<R[]> {
    return Promise.all(tasks.map((task) => this.submit(task, handler)));
  }

  getStats(): {
    activeWorkers: number;
    idleWorkers: number;
    pendingTasks: number;
    completedTasks: number;
    failedTasks: number;
    avgWaitTime: number;
  } {
    const active = this.workers.filter((w) => w.busy).length;
    return {
      activeWorkers: active,
      idleWorkers: this.workers.length - active,
      pendingTasks: this.pendingTasks.length,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      avgWaitTime: this.completedTasks > 0 ? this.totalWaitTime / this.completedTasks : 0,
    };
  }

  resize(newSize: number): void {
    const currentSize = this.workers.length;
    if (newSize > currentSize) {
      const toAdd = Math.min(newSize - currentSize, this.maxWorkers - currentSize);
      for (let i = 0; i < toAdd; i++) {
        this.workers.push({ busy: false });
      }
    } else if (newSize < currentSize) {
      // Only remove idle workers beyond the minimum
      let toRemove = currentSize - Math.max(newSize, this.minWorkers);
      for (let i = this.workers.length - 1; i >= 0 && toRemove > 0; i--) {
        if (!this.workers[i]!.busy) {
          this.workers.splice(i, 1);
          toRemove--;
        }
      }
    }
    this.processQueue();
  }

  async drain(): Promise<void> {
    while (this.pendingTasks.length > 0 || this.workers.some((w) => w.busy)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  terminate(): void {
    this.terminated = true;
    // Reject all pending tasks
    for (const pending of this.pendingTasks) {
      pending.reject(new Error('Worker pool terminated'));
    }
    this.pendingTasks = [];
    this.workers = [];
  }

  private processQueue(): void {
    if (this.terminated) return;

    while (this.pendingTasks.length > 0) {
      const idleWorker = this.workers.find((w) => !w.busy);
      if (!idleWorker) {
        // Try to scale up
        if (this.workers.length < this.maxWorkers) {
          const newWorker: WorkerInfo = { busy: false };
          this.workers.push(newWorker);
          // Continue loop to pick up this new worker
          continue;
        }
        break;
      }

      const pending = this.pendingTasks.shift()!;
      idleWorker.busy = true;
      idleWorker.currentTaskStartedAt = Date.now();

      const waitTime = idleWorker.currentTaskStartedAt - pending.enqueuedAt;
      this.totalWaitTime += waitTime;

      this.executeWithTimeout(pending, idleWorker);
    }
  }

  private executeWithTimeout(pending: PendingTask<T, R>, worker: WorkerInfo): void {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      worker.busy = false;
      worker.currentTaskStartedAt = undefined;
      if (timeoutId) clearTimeout(timeoutId);
      this.processQueue();
    };

    if (this.taskTimeout > 0) {
      timeoutId = setTimeout(() => {
        pending.reject(new Error(`Task timed out after ${this.taskTimeout}ms`));
        this.failedTasks++;
        cleanup();
      }, this.taskTimeout);
    }

    pending
      .handler(pending.task)
      .then((result) => {
        if (timeoutId) clearTimeout(timeoutId);
        pending.resolve(result);
        this.completedTasks++;
        cleanup();
      })
      .catch((err) => {
        if (timeoutId) clearTimeout(timeoutId);
        pending.reject(err);
        this.failedTasks++;
        cleanup();
      });
  }
}
