// ============================================================
// Module 7: Long Running Task Manager
// ============================================================

export interface LongTask {
  id: string;
  name: string;
  handler: () => Promise<unknown>;
  timeoutMs: number;
  maxExtensions: number;
  checkpointInterval?: number;
  metadata?: Record<string, unknown>;
}

export interface Milestone {
  name: string;
  targetProgress: number; // 0-1
  reached: boolean;
  reachedAt?: number;
}

export type LongTaskState = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'timed_out' | 'failed';

export interface LongTaskStatus {
  id: string;
  name: string;
  state: LongTaskState;
  progress: number;       // 0-1
  milestones: Milestone[];
  registeredAt: number;
  startedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  timeoutAt: number;
  extensionsUsed: number;
  lastCheckpoint?: unknown;
  error?: string;
}

export interface LongRunningTaskOptions {
  defaultTimeout?: number;
  maxExtensions?: number;
  checkpointInterval?: number;
  progressUpdateInterval?: number;
}

const DEFAULT_LONG_TASK_OPTIONS: Required<LongRunningTaskOptions> = {
  defaultTimeout: 3600000, // 1 hour
  maxExtensions: 5,
  checkpointInterval: 60000, // 1 minute
  progressUpdateInterval: 5000,
};

export class LongRunningTaskManager {
  private tasks: Map<string, InternalLongTask> = new Map();
  private options: Required<LongRunningTaskOptions>;
  private checkpoints: Map<string, unknown> = new Map();

  constructor(options?: LongRunningTaskOptions) {
    this.options = { ...DEFAULT_LONG_TASK_OPTIONS, ...options };
  }

  register(task: LongTask): string {
    const now = Date.now();
    const internalTask: InternalLongTask = {
      ...task,
      state: 'pending',
      progress: 0,
      milestones: [],
      registeredAt: now,
      timeoutAt: now + (task.timeoutMs || this.options.defaultTimeout),
      extensionsUsed: 0,
    };

    this.tasks.set(task.id, internalTask);
    return task.id;
  }

  startTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.state !== 'pending') return false;

    task.state = 'running';
    task.startedAt = Date.now();

    // Execute the handler
    this.executeHandler(task).catch(() => {
      // Error handling is done inside executeHandler
    });

    return true;
  }

  updateProgress(taskId: string, progress: number): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.progress = Math.max(0, Math.min(1, progress));

    // Check milestones
    for (const milestone of task.milestones) {
      if (!milestone.reached && task.progress >= milestone.targetProgress) {
        milestone.reached = true;
        milestone.reachedAt = Date.now();
      }
    }

    // Auto-checkpoint
    if (task.checkpointInterval && task.progress > 0) {
      const lastCheckpoint = this.checkpoints.get(taskId);
      const now = Date.now();
      if (!lastCheckpoint || now - (task.lastCheckpointTime ?? 0) > task.checkpointInterval) {
        this.checkpoints.set(taskId, {
          progress: task.progress,
          timestamp: now,
          milestones: task.milestones.filter((m) => m.reached).map((m) => m.name),
        });
        task.lastCheckpointTime = now;
      }
    }
  }

  addMilestone(taskId: string, milestone: Milestone): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    // Check if already reached
    if (task.progress >= milestone.targetProgress) {
      milestone.reached = true;
      milestone.reachedAt = Date.now();
    }

    task.milestones.push(milestone);
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.state === 'completed' || task.state === 'cancelled' || task.state === 'timed_out' || task.state === 'failed') return false;

    task.state = 'cancelled';
    task.cancelledAt = Date.now();
    return true;
  }

  extendTimeout(taskId: string, additionalMs: number): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.state !== 'running' && task.state !== 'pending') return false;
    if (task.extensionsUsed >= task.maxExtensions) return false;

    task.timeoutAt += additionalMs;
    task.extensionsUsed++;
    return true;
  }

  getTaskStatus(taskId: string): LongTaskStatus | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    const { handler, lastCheckpointTime, ...status } = task;
    return {
      ...status,
      lastCheckpoint: this.checkpoints.get(taskId),
    };
  }

  getActiveLongTasks(): LongTaskStatus[] {
    const active: LongTaskStatus[] = [];
    for (const task of this.tasks.values()) {
      if (task.state === 'running' || task.state === 'pending') {
        const { handler, lastCheckpointTime, ...status } = task;
        active.push({
          ...status,
          lastCheckpoint: this.checkpoints.get(task.id),
        });
      }
    }
    return active;
  }

  getAllTasks(): LongTaskStatus[] {
    const all: LongTaskStatus[] = [];
    for (const task of this.tasks.values()) {
      const { handler, lastCheckpointTime, ...status } = task;
      all.push({
        ...status,
        lastCheckpoint: this.checkpoints.get(task.id),
      });
    }
    return all;
  }

  getCheckpoint(taskId: string): unknown | undefined {
    return this.checkpoints.get(taskId);
  }

  removeTask(taskId: string): boolean {
    this.checkpoints.delete(taskId);
    return this.tasks.delete(taskId);
  }

  getTaskCount(): number {
    return this.tasks.size;
  }

  private async executeHandler(task: InternalLongTask): Promise<void> {
    const timeoutMs = task.timeoutAt - Date.now();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Task timed out')), Math.max(0, timeoutMs));
    });

    try {
      const result = await Promise.race([task.handler(), timeoutPromise]);
      if (task.state === 'running') {
        task.state = 'completed';
        task.completedAt = Date.now();
        task.progress = 1;
        this.checkpoints.set(task.id, { result, completedAt: Date.now() });
      }
    } catch (err) {
      if (task.state === 'running') {
        const errorMsg = err instanceof Error ? err.message : String(err);
        // Distinguish between timeout and other errors
        if (errorMsg === 'Task timed out') {
          task.state = 'timed_out';
        } else {
          task.state = 'failed';
        }
        task.completedAt = Date.now();
        task.error = errorMsg;
      }
    }
  }
}

interface InternalLongTask extends LongTask {
  state: LongTaskState;
  progress: number;
  milestones: Milestone[];
  registeredAt: number;
  startedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  timeoutAt: number;
  extensionsUsed: number;
  lastCheckpointTime?: number;
}
