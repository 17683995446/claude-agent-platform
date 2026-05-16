// src/task-queue.ts - Persistent Task Queue

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'deferred';

export interface TaskDefinition {
  id?: string;
  name: string;
  payload: unknown;
  priority?: number;
  dependencies?: string[];
  maxRetries?: number;
  delayMs?: number;
}

export interface TaskInstance {
  id: string;
  name: string;
  payload: unknown;
  priority: number;
  status: TaskStatus;
  dependencies: string[];
  maxRetries: number;
  retryCount: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  deferredUntil?: Date;
  result?: unknown;
  error?: string;
  nextRetryAt?: number;
}

export interface TaskQueueStats {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  deferred: number;
  deadLetterCount: number;
}

export class PersistentTaskQueue {
  private tasks: Map<string, TaskInstance> = new Map();
  private deadLetterQueue: TaskInstance[] = [];
  private defaultPriority: number;
  private defaultMaxRetries: number;
  private retryBaseDelayMs: number;
  private retryMaxDelayMs: number;

  constructor(options?: {
    defaultPriority?: number;
    maxRetries?: number;
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
  }) {
    this.defaultPriority = options?.defaultPriority ?? 5;
    this.defaultMaxRetries = options?.maxRetries ?? 3;
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? 1000;
    this.retryMaxDelayMs = options?.retryMaxDelayMs ?? 60000;
  }

  enqueue(task: TaskDefinition): string {
    const id = task.id ?? this.generateId();
    const instance: TaskInstance = {
      id,
      name: task.name,
      payload: task.payload,
      priority: task.priority ?? this.defaultPriority,
      status: 'queued',
      dependencies: task.dependencies ?? [],
      maxRetries: task.maxRetries ?? this.defaultMaxRetries,
      retryCount: 0,
      createdAt: Date.now(),
    };
    this.tasks.set(id, instance);
    return id;
  }

  dequeue(): TaskInstance | undefined {
    const now = Date.now();

    // Get all queued tasks that have their dependencies met
    const ready: TaskInstance[] = [];
    for (const task of this.tasks.values()) {
      if (task.status !== 'queued') continue;
      // Check deferred
      if (task.deferredUntil && task.deferredUntil.getTime() > now) continue;
      // Check dependencies
      if (!this.areDependenciesMet(task)) continue;
      ready.push(task);
    }

    if (ready.length === 0) return undefined;

    // Sort by priority (higher = more important)
    ready.sort((a, b) => b.priority - a.priority);

    const task = ready[0]!;
    task.status = 'running';
    task.startedAt = Date.now();
    return task;
  }

  complete(taskId: string, result?: unknown): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;
    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = result;
  }

  fail(taskId: string, error: Error): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;

    task.retryCount++;
    task.error = error.message;

    if (task.retryCount >= task.maxRetries) {
      task.status = 'failed';
      task.failedAt = Date.now();
      this.deadLetterQueue.push(task);
    } else {
      // Schedule retry with exponential backoff
      const delay = Math.min(
        this.retryBaseDelayMs * Math.pow(2, task.retryCount - 1),
        this.retryMaxDelayMs
      );
      task.nextRetryAt = Date.now() + delay;
      task.status = 'queued';
    }
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'completed' || task.status === 'cancelled') return false;
    task.status = 'cancelled';
    task.completedAt = Date.now();
    return true;
  }

  defer(taskId: string, until: Date): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status !== 'queued') return false;
    task.deferredUntil = until;
    return true;
  }

  getQueueDepth(): number {
    let depth = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'queued') depth++;
    }
    return depth;
  }

  getTaskStatus(taskId: string): TaskStatus | undefined {
    return this.tasks.get(taskId)?.status;
  }

  getTask(taskId: string): TaskInstance | undefined {
    return this.tasks.get(taskId);
  }

  requeueFailed(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'failed') return false;
    task.status = 'queued';
    task.retryCount = 0;
    task.error = undefined;
    task.failedAt = undefined;
    // Remove from dead letter queue
    this.deadLetterQueue = this.deadLetterQueue.filter((t) => t.id !== taskId);
    return true;
  }

  getStats(): TaskQueueStats {
    const stats: TaskQueueStats = {
      total: this.tasks.size,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      deferred: 0,
      deadLetterCount: this.deadLetterQueue.length,
    };
    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'queued': stats.queued++; break;
        case 'running': stats.running++; break;
        case 'completed': stats.completed++; break;
        case 'failed': stats.failed++; break;
        case 'cancelled': stats.cancelled++; break;
        case 'deferred': stats.deferred++; break;
      }
    }
    return stats;
  }

  getDeadLetterQueue(): TaskInstance[] {
    return [...this.deadLetterQueue];
  }

  clear(): void {
    this.tasks.clear();
    this.deadLetterQueue = [];
  }

  private areDependenciesMet(task: TaskInstance): boolean {
    for (const depId of task.dependencies) {
      const dep = this.tasks.get(depId);
      if (!dep || dep.status !== 'completed') return false;
    }
    return true;
  }

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
