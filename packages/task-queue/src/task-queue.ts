/**
 * In-memory priority task queue with event support.
 */

export type TaskStatus = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';

export interface Task<T = unknown> {
  id: string;
  data: T;
  priority: number;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  attempts: number;
  maxAttempts: number;
  result?: unknown;
  error?: Error;
  delay?: number;
  deadline?: number;
}

export type TaskEvent = 'enqueue' | 'complete' | 'fail' | 'retry';

type EventHandler = (task: Task) => void;

let idCounter = 0;

function generateId(): string {
  return `task_${Date.now()}_${++idCounter}`;
}

export class TaskQueue<T = unknown> {
  private tasks: Map<string, Task<T>> = new Map();
  private maxSize: number;
  private concurrency: number;
  private listeners: Map<TaskEvent, Set<EventHandler>> = new Map();

  constructor(options?: { maxSize?: number; concurrency?: number }) {
    this.maxSize = options?.maxSize ?? Infinity;
    this.concurrency = options?.concurrency ?? Infinity;
  }

  enqueue(task: {
    id?: string;
    data: T;
    priority?: number;
    delay?: number;
    deadline?: number;
  }): string {
    if (this.tasks.size >= this.maxSize) {
      throw new Error('Queue is full');
    }
    const id = task.id ?? generateId();
    if (this.tasks.has(id)) {
      throw new Error(`Task with id "${id}" already exists`);
    }
    const now = Date.now();
    const taskEntry: Task<T> = {
      id,
      data: task.data,
      priority: task.priority ?? 0,
      status: 'pending',
      createdAt: now,
      attempts: 0,
      maxAttempts: 3,
      delay: task.delay,
      deadline: task.deadline,
    };
    this.tasks.set(id, taskEntry);
    this.emit('enqueue', taskEntry);
    return id;
  }

  async dequeue(): Promise<Task<T> | undefined> {
    const now = Date.now();
    const activeCount = this.getActive().length;
    if (activeCount >= this.concurrency) {
      return undefined;
    }

    const pending = this.getPending()
      .filter((t) => {
        if (t.deadline && t.deadline < now) return false;
        if (t.delay) {
          const eligibleAt = t.createdAt + t.delay;
          if (eligibleAt > now) return false;
        }
        return true;
      })
      .sort((a, b) => b.priority - a.priority);

    const task = pending[0];
    if (!task) return undefined;

    task.status = 'active';
    task.startedAt = now;
    task.attempts++;
    return task;
  }

  complete(taskId: string, result?: unknown): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = result;
    this.emit('complete', task);
  }

  fail(taskId: string, error: Error): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'failed';
    task.completedAt = Date.now();
    task.error = error;
    this.emit('fail', task);
  }

  retry(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'pending';
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.error = undefined;
    this.emit('retry', task);
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'cancelled') {
      return false;
    }
    task.status = 'cancelled';
    task.completedAt = Date.now();
    return true;
  }

  getTask(taskId: string): Task<T> | undefined {
    return this.tasks.get(taskId);
  }

  getPending(): Task<T>[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'pending');
  }

  getActive(): Task<T>[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'active');
  }

  getCompleted(): Task<T>[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'completed');
  }

  getFailed(): Task<T>[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'failed');
  }

  size(): number {
    return this.tasks.size;
  }

  clear(): void {
    this.tasks.clear();
  }

  on(event: TaskEvent, handler: EventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  private emit(event: TaskEvent, task: Task<T>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(task);
      }
    }
  }
}
