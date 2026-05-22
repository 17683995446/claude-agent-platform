// src/thread-pool.ts - 线程池管理

export interface PoolTask {
  id: string;
  name?: string;
  priority?: number; // 0 = highest
  handler: () => Promise<unknown>;
}

export interface WorkerStats {
  id: number;
  status: 'idle' | 'busy' | 'crashed';
  tasksCompleted: number;
  tasksFailed: number;
  currentTask?: string;
  uptime: number;
}

export interface PoolStats {
  poolSize: number;
  activeWorkers: number;
  queueSize: number;
  totalCompleted: number;
  totalFailed: number;
}

export class ThreadPoolManager {
  private poolSize: number;
  private taskQueue: PoolTask[] = [];
  private workers: { id: number; status: 'idle' | 'busy' | 'crashed'; tasksCompleted: number; tasksFailed: number; currentTask?: string; startedAt: number }[] = [];
  private totalCompleted: number = 0;
  private totalFailed: number = 0;
  private autoRestart: boolean;
  private idCounter: number = 0;

  constructor(poolSize: number = 4, autoRestart: boolean = true) {
    this.poolSize = poolSize;
    this.autoRestart = autoRestart;
    this.initWorkers();
  }

  private initWorkers(): void {
    this.workers = [];
    for (let i = 0; i < this.poolSize; i++) {
      this.workers.push({
        id: i,
        status: 'idle',
        tasksCompleted: 0,
        tasksFailed: 0,
        startedAt: Date.now(),
      });
    }
  }

  async submit(task: PoolTask, timeoutMs: number = 30000): Promise<unknown> {
    const taskId = task.id || `task-${++this.idCounter}`;
    const fullTask: PoolTask = { ...task, id: taskId };

    // Sort by priority (lower = higher priority)
    this.taskQueue.push(fullTask);
    this.taskQueue.sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));

    // Find idle worker
    const worker = this.workers.find(w => w.status === 'idle');
    if (worker) {
      return this.executeTask(worker, fullTask);
    }

    // No idle worker - wait and retry
    return new Promise((resolve, reject) => {
      let claimed = false;
      const timeoutId = setTimeout(() => {
        clearInterval(checkInterval);
        if (!claimed) {
          // Remove task from queue since it timed out
          const queueIdx = this.taskQueue.indexOf(fullTask);
          if (queueIdx >= 0) this.taskQueue.splice(queueIdx, 1);
          claimed = true;
          reject(new Error(`Task ${taskId} timed out waiting for available worker`));
        }
      }, timeoutMs);

      const checkInterval = setInterval(async () => {
        if (claimed) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          return;
        }
        const idleWorker = this.workers.find(w => w.status === 'idle');
        if (idleWorker) {
          // Check if this specific task is still at the front of the queue
          // to avoid multiple waiting tasks grabbing the same worker
          const queueIdx = this.taskQueue.indexOf(fullTask);
          if (queueIdx === -1) {
            // Task was already executed or removed
            clearInterval(checkInterval);
            clearTimeout(timeoutId);
            claimed = true;
            return;
          }
          // Only claim if our task is at the front of the queue
          const frontTask = this.taskQueue[0];
          if (frontTask === fullTask) {
            clearInterval(checkInterval);
            clearTimeout(timeoutId);
            claimed = true;
            try {
              const result = await this.executeTask(idleWorker, fullTask);
              resolve(result);
            } catch (err) {
              reject(err);
            }
          }
        }
      }, 10);
    });
  }

  private async executeTask(worker: { id: number; status: 'idle' | 'busy' | 'crashed'; tasksCompleted: number; tasksFailed: number; currentTask?: string; startedAt: number }, task: PoolTask): Promise<unknown> {
    // Remove from queue
    const queueIdx = this.taskQueue.indexOf(task);
    if (queueIdx >= 0) this.taskQueue.splice(queueIdx, 1);

    worker.status = 'busy';
    worker.currentTask = task.id;

    try {
      const result = await task.handler();
      worker.tasksCompleted++;
      this.totalCompleted++;
      worker.status = 'idle';
      worker.currentTask = undefined;
      return result;
    } catch (err) {
      worker.tasksFailed++;
      this.totalFailed++;
      worker.status = this.autoRestart ? 'idle' : 'crashed';
      worker.currentTask = undefined;
      throw err;
    }
  }

  async submitBatch(tasks: PoolTask[]): Promise<unknown[]> {
    return Promise.all(tasks.map(t => this.submit(t)));
  }

  getPoolSize(): number {
    return this.poolSize;
  }

  getActiveWorkers(): number {
    return this.workers.filter(w => w.status === 'busy').length;
  }

  getQueueSize(): number {
    return this.taskQueue.length;
  }

  resize(newSize: number): void {
    if (newSize < 1) throw new Error('Pool size must be at least 1');
    this.poolSize = newSize;

    if (newSize > this.workers.length) {
      for (let i = this.workers.length; i < newSize; i++) {
        this.workers.push({
          id: i,
          status: 'idle',
          tasksCompleted: 0,
          tasksFailed: 0,
          startedAt: Date.now(),
        });
      }
    } else if (newSize < this.workers.length) {
      // Remove idle workers first
      let toRemove = this.workers.length - newSize;
      for (let i = this.workers.length - 1; i >= 0 && toRemove > 0; i--) {
        if (this.workers[i].status === 'idle') {
          this.workers.splice(i, 1);
          toRemove--;
        }
      }
      // If we still need to remove more but only busy workers remain,
      // update poolSize to reflect actual worker count to stay consistent
      if (toRemove > 0) {
        this.poolSize = this.workers.length;
      }
    }
  }

  getWorkerStats(): WorkerStats[] {
    return this.workers.map(w => ({
      id: w.id,
      status: w.status,
      tasksCompleted: w.tasksCompleted,
      tasksFailed: w.tasksFailed,
      currentTask: w.currentTask,
      uptime: Date.now() - w.startedAt,
    }));
  }

  getStats(): PoolStats {
    return {
      poolSize: this.poolSize,
      activeWorkers: this.getActiveWorkers(),
      queueSize: this.getQueueSize(),
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
    };
  }

  getWorkerCount(): number {
    return this.workers.length;
  }

  reset(): void {
    this.taskQueue = [];
    this.totalCompleted = 0;
    this.totalFailed = 0;
    this.initWorkers();
  }
}
