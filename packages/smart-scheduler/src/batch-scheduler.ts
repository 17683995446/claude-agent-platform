// src/batch-scheduler.ts - 批处理调度器

export interface BatchTask {
  id: string;
  name: string;
  priority: number;
  data?: unknown;
  estimatedDuration?: number;
}

export type BatchWindowType = 'time-based' | 'size-based' | 'hybrid';

export interface BatchOptions {
  windowType?: BatchWindowType;
  maxBatchSize?: number;
  maxWindowTime?: number; // ms
  priority?: number;
  tag?: string;
}

export interface BatchJob {
  id: string;
  tasks: BatchTask[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  progress: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  options: BatchOptions;
  tag?: string;
  subBatches?: SubBatch[];
}

export interface SubBatch {
  id: string;
  taskIds: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
}

export interface BatchStatus {
  id: string;
  status: BatchJob['status'];
  progress: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  subBatchCount: number;
}

export interface BatchFilter {
  status?: BatchJob['status'];
  tag?: string;
  from?: Date;
  to?: Date;
}

export class BatchScheduler {
  private batches: Map<string, BatchJob> = new Map();
  private idCounter: number = 0;
  private completedTaskIds: Map<string, Set<string>> = new Map();

  scheduleBatch(tasks: BatchTask[], options?: BatchOptions): BatchJob {
    const id = `batch-${++this.idCounter}`;
    const opts: BatchOptions = {
      windowType: options?.windowType ?? 'size-based',
      maxBatchSize: options?.maxBatchSize ?? 10,
      maxWindowTime: options?.maxWindowTime ?? 60_000,
      priority: options?.priority ?? 2,
      tag: options?.tag,
    };

    // Sort tasks by priority
    const sortedTasks = [...tasks].sort((a, b) => a.priority - b.priority);

    // Split into sub-batches
    const subBatches = this.splitIntoSubBatches(sortedTasks, opts);

    const batch: BatchJob = {
      id,
      tasks: sortedTasks,
      status: 'pending',
      createdAt: new Date(),
      progress: 0,
      totalTasks: sortedTasks.length,
      completedTasks: 0,
      failedTasks: 0,
      options: opts,
      tag: opts.tag,
      subBatches,
    };

    this.batches.set(id, batch);
    return batch;
  }

  private splitIntoSubBatches(tasks: BatchTask[], options: BatchOptions): SubBatch[] {
    if (options.windowType === 'size-based' || options.windowType === 'hybrid') {
      const maxSize = options.maxBatchSize ?? 10;
      const subBatches: SubBatch[] = [];
      for (let i = 0; i < tasks.length; i += maxSize) {
        const chunk = tasks.slice(i, i + maxSize);
        subBatches.push({
          id: `${i / maxSize}`,
          taskIds: chunk.map((t) => t.id),
          status: 'pending',
        });
      }
      return subBatches;
    }

    // time-based: single batch
    return [
      {
        id: '0',
        taskIds: tasks.map((t) => t.id),
        status: 'pending',
      },
    ];
  }

  getBatchStatus(batchId: string): BatchStatus | undefined {
    const batch = this.batches.get(batchId);
    if (!batch) return undefined;

    return {
      id: batch.id,
      status: batch.status,
      progress: batch.progress,
      totalTasks: batch.totalTasks,
      completedTasks: batch.completedTasks,
      failedTasks: batch.failedTasks,
      subBatchCount: batch.subBatches?.length ?? 0,
    };
  }

  cancelBatch(batchId: string): boolean {
    const batch = this.batches.get(batchId);
    if (!batch) return false;
    if (batch.status === 'completed' || batch.status === 'cancelled') return false;

    batch.status = 'cancelled';
    batch.completedAt = new Date();
    return true;
  }

  startBatch(batchId: string): boolean {
    const batch = this.batches.get(batchId);
    if (!batch) return false;
    if (batch.status !== 'pending') return false;

    batch.status = 'running';
    batch.startedAt = new Date();
    return true;
  }

  completeTask(batchId: string, taskId: string): boolean {
    const batch = this.batches.get(batchId);
    if (!batch || batch.status !== 'running') return false;

    const taskExists = batch.tasks.some((t) => t.id === taskId);
    if (!taskExists) return false;

    // Guard against duplicate completion
    let completedIds = this.completedTaskIds.get(batchId);
    if (!completedIds) {
      completedIds = new Set();
      this.completedTaskIds.set(batchId, completedIds);
    }
    if (completedIds.has(taskId)) return false;
    completedIds.add(taskId);

    batch.completedTasks++;
    batch.progress = batch.totalTasks > 0 ? (batch.completedTasks / batch.totalTasks) * 100 : 0;

    if (batch.completedTasks + batch.failedTasks >= batch.totalTasks) {
      batch.status = batch.failedTasks > 0 ? 'failed' : 'completed';
      batch.completedAt = new Date();
    }

    return true;
  }

  failTask(batchId: string, taskId: string): boolean {
    const batch = this.batches.get(batchId);
    if (!batch || batch.status !== 'running') return false;

    const taskExists = batch.tasks.some((t) => t.id === taskId);
    if (!taskExists) return false;

    // Guard against duplicate failure
    let completedIds = this.completedTaskIds.get(batchId);
    if (!completedIds) {
      completedIds = new Set();
      this.completedTaskIds.set(batchId, completedIds);
    }
    if (completedIds.has(taskId)) return false;
    completedIds.add(taskId);

    batch.failedTasks++;
    batch.progress = batch.totalTasks > 0
      ? ((batch.completedTasks + batch.failedTasks) / batch.totalTasks) * 100
      : 0;

    if (batch.completedTasks + batch.failedTasks >= batch.totalTasks) {
      batch.status = 'failed';
      batch.completedAt = new Date();
    }

    return true;
  }

  getBatchHistory(filter?: BatchFilter): BatchJob[] {
    let results = Array.from(this.batches.values());

    if (filter?.status) {
      results = results.filter((b) => b.status === filter.status);
    }
    if (filter?.tag) {
      results = results.filter((b) => b.tag === filter.tag);
    }
    if (filter?.from) {
      results = results.filter((b) => b.createdAt >= filter.from!);
    }
    if (filter?.to) {
      results = results.filter((b) => b.createdAt <= filter.to!);
    }

    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getBatchCount(): number {
    return this.batches.size;
  }
}
