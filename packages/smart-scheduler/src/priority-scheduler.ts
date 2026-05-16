// src/priority-scheduler.ts - 优先级调度器

export enum Priority {
  Critical = 0,
  High = 1,
  Normal = 2,
  Low = 3,
  Background = 4,
}

export interface ScheduledTask {
  id: string;
  name: string;
  priority: number;
  parentId?: string;
  deadline?: Date;
  createdAt: number;
  data?: unknown;
  scheduledAt?: number;
}

interface QueueEntry {
  task: ScheduledTask;
  insertedAt: number;
}

export class PriorityScheduler {
  private queues: Map<number, QueueEntry[]> = new Map();
  private taskMap: Map<string, QueueEntry> = new Map();
  private taskQueueMap: Map<string, number> = new Map();
  private agingInterval: number;
  private agingThreshold: number;
  private agingBoost: number;
  private lastAgingCheck: number;
  private idCounter: number = 0;

  constructor(options?: { agingInterval?: number; agingThreshold?: number; agingBoost?: number }) {
    this.agingInterval = options?.agingInterval ?? 60_000; // 1 minute
    this.agingThreshold = options?.agingThreshold ?? 120_000; // 2 minutes
    this.agingBoost = options?.agingBoost ?? 1;
    this.lastAgingCheck = Date.now();
    for (let p = Priority.Critical; p <= Priority.Background; p++) {
      this.queues.set(p, []);
    }
  }

  private generateId(): string {
    return `task-${++this.idCounter}-${Date.now()}`;
  }

  schedule(task: Partial<ScheduledTask> & { name: string }): string {
    const id = task.id ?? this.generateId();
    const now = Date.now();

    let priority = task.priority ?? Priority.Normal;

    // Validate priority is a finite number
    if (!Number.isFinite(priority)) {
      priority = Priority.Normal;
    }

    // Priority inheritance: child tasks inherit parent priority
    if (task.parentId) {
      const parentEntry = this.taskMap.get(task.parentId);
      if (parentEntry) {
        priority = Math.max(priority, parentEntry.task.priority);
      }
    }

    // Dynamic priority adjustment based on deadline proximity
    if (task.deadline) {
      const timeToDeadline = task.deadline.getTime() - now;
      if (timeToDeadline > 0 && timeToDeadline < 5 * 60_000) {
        // Within 5 minutes: boost to high
        priority = Math.min(priority, Priority.High);
      }
      if (timeToDeadline > 0 && timeToDeadline < 60_000) {
        // Within 1 minute: boost to critical
        priority = Math.min(priority, Priority.Critical);
      }
    }

    const fullTask: ScheduledTask = {
      id,
      name: task.name,
      priority,
      parentId: task.parentId,
      deadline: task.deadline,
      createdAt: task.createdAt ?? now,
      data: task.data,
      scheduledAt: now,
    };

    const entry: QueueEntry = { task: fullTask, insertedAt: now };
    const queue = this.queues.get(priority);
    if (queue) {
      queue.push(entry);
    }
    this.taskMap.set(id, entry);
    this.taskQueueMap.set(id, priority);

    return id;
  }

  cancel(taskId: string): boolean {
    const entry = this.taskMap.get(taskId);
    if (!entry) return false;

    const queuePriority = this.taskQueueMap.get(taskId);
    if (queuePriority === undefined) return false;

    const queue = this.queues.get(queuePriority);
    if (queue) {
      const idx = queue.findIndex((e) => e.task.id === taskId);
      if (idx !== -1) {
        queue.splice(idx, 1);
      }
    }

    this.taskMap.delete(taskId);
    this.taskQueueMap.delete(taskId);
    return true;
  }

  getNext(): ScheduledTask | undefined {
    this.applyAging();
    for (let p = Priority.Critical; p <= Priority.Background; p++) {
      const queue = this.queues.get(p);
      if (queue && queue.length > 0) {
        const entry = queue.shift()!;
        this.taskMap.delete(entry.task.id);
        this.taskQueueMap.delete(entry.task.id);
        return entry.task;
      }
    }
    return undefined;
  }

  peek(): ScheduledTask | undefined {
    this.applyAging();
    for (let p = Priority.Critical; p <= Priority.Background; p++) {
      const queue = this.queues.get(p);
      if (queue && queue.length > 0) {
        return queue[0].task;
      }
    }
    return undefined;
  }

  reprioritize(taskId: string, newPriority: number): boolean {
    const entry = this.taskMap.get(taskId);
    if (!entry) return false;

    const oldPriority = this.taskQueueMap.get(taskId);
    if (oldPriority === undefined) return false;

    if (oldPriority === newPriority) return true;

    // Remove from old queue
    const oldQueue = this.queues.get(oldPriority);
    if (oldQueue) {
      const idx = oldQueue.findIndex((e) => e.task.id === taskId);
      if (idx !== -1) {
        oldQueue.splice(idx, 1);
      }
    }

    // Add to new queue
    entry.task.priority = newPriority;
    const newQueue = this.queues.get(newPriority);
    if (newQueue) {
      newQueue.push(entry);
    }

    this.taskQueueMap.set(taskId, newPriority);
    return true;
  }

  getQueueSize(priority?: number): number {
    if (priority !== undefined) {
      return this.queues.get(priority)?.length ?? 0;
    }
    let total = 0;
    for (const [, queue] of this.queues) {
      total += queue.length;
    }
    return total;
  }

  private applyAging(): void {
    const now = Date.now();
    if (now - this.lastAgingCheck < this.agingInterval) return;
    this.lastAgingCheck = now;

    for (let p = Priority.High; p <= Priority.Background; p++) {
      const queue = this.queues.get(p);
      if (!queue) continue;

      const toBoost: QueueEntry[] = [];
      const remaining: QueueEntry[] = [];

      for (const entry of queue) {
        const waitTime = now - entry.insertedAt;
        if (waitTime >= this.agingThreshold) {
          toBoost.push(entry);
        } else {
          remaining.push(entry);
        }
      }

      if (toBoost.length > 0) {
        this.queues.set(p, remaining);
        const targetQueue = this.queues.get(p - this.agingBoost);
        if (targetQueue) {
          for (const entry of toBoost) {
            entry.task.priority = p - this.agingBoost;
            this.taskQueueMap.set(entry.task.id, p - this.agingBoost);
            targetQueue.push(entry);
          }
        }
      }
    }
  }

  getTask(taskId: string): ScheduledTask | undefined {
    return this.taskMap.get(taskId)?.task;
  }
}
