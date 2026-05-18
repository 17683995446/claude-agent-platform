/**
 * Time-based delayed task execution.
 */

let delayedIdCounter = 0;

function generateDelayedId(): string {
  return `delayed_${Date.now()}_${++delayedIdCounter}`;
}

export interface DelayedTask<T> {
  id: string;
  data: T;
  executeAt: number;
  options?: Record<string, unknown>;
}

export class DelayedQueue<T> {
  private tasks: Map<string, DelayedTask<T>> = new Map();
  private handler?: (data: T, id: string) => void;

  constructor(handler?: (data: T, id: string) => void) {
    this.handler = handler;
  }

  setHandler(handler: (data: T, id: string) => void): void {
    this.handler = handler;
  }

  schedule(data: T, delayMs: number, options?: Record<string, unknown>): string {
    const id = generateDelayedId();
    const executeAt = Date.now() + delayMs;
    this.tasks.set(id, { id, data, executeAt, options });
    return id;
  }

  scheduleAt(data: T, timestamp: number, options?: Record<string, unknown>): string {
    const id = generateDelayedId();
    this.tasks.set(id, { id, data, executeAt: timestamp, options });
    return id;
  }

  cancel(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }

  getScheduled(): Array<{ id: string; data: T; executeAt: number }> {
    return Array.from(this.tasks.values()).map((t) => ({
      id: t.id,
      data: t.data,
      executeAt: t.executeAt,
    }));
  }

  process(): number {
    const now = Date.now();
    let count = 0;
    const toProcess: string[] = [];

    for (const [id, task] of this.tasks) {
      if (task.executeAt <= now) {
        toProcess.push(id);
      }
    }

    for (const id of toProcess) {
      const task = this.tasks.get(id);
      if (task && this.handler) {
        this.handler(task.data, task.id);
      }
      this.tasks.delete(id);
      count++;
    }

    return count;
  }

  clear(): void {
    this.tasks.clear();
  }

  size(): number {
    return this.tasks.size;
  }
}
