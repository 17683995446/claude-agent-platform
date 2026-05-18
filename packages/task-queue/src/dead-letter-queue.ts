/**
 * Dead letter queue for storing failed tasks for inspection.
 */

export interface DeadLetterEntry {
  id: string;
  data: unknown;
  error: Error;
  attempts: number;
  failedAt: number;
}

let dlqIdCounter = 0;

function generateDlqId(): string {
  return `dlq_${Date.now()}_${++dlqIdCounter}`;
}

export class DeadLetterQueue {
  private entries: Map<string, DeadLetterEntry> = new Map();
  private requeuedCount: number = 0;
  private discardedCount: number = 0;

  add(task: {
    id?: string;
    data: unknown;
    error: Error;
    attempts: number;
    failedAt?: number;
  }): void {
    const id = task.id ?? generateDlqId();
    this.entries.set(id, {
      id,
      data: task.data,
      error: task.error,
      attempts: task.attempts,
      failedAt: task.failedAt ?? Date.now(),
    });
  }

  requeue(taskId: string): object | undefined {
    const entry = this.entries.get(taskId);
    if (!entry) return undefined;
    const result = { id: entry.id, data: entry.data };
    this.entries.delete(taskId);
    this.requeuedCount++;
    return result;
  }

  discard(taskId: string): boolean {
    const deleted = this.entries.delete(taskId);
    if (deleted) this.discardedCount++;
    return deleted;
  }

  get(taskId: string): object | undefined {
    return this.entries.get(taskId);
  }

  getAll(filter?: (entry: DeadLetterEntry) => boolean): object[] {
    const entries = Array.from(this.entries.values());
    if (filter) {
      return entries.filter(filter);
    }
    return entries;
  }

  purge(maxAge?: number): number {
    if (!maxAge) {
      const count = this.entries.size;
      this.entries.clear();
      return count;
    }
    const cutoff = Date.now() - maxAge;
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (entry.failedAt < cutoff) {
        this.entries.delete(id);
        count++;
      }
    }
    return count;
  }

  size(): number {
    return this.entries.size;
  }

  getStats(): {
    total: number;
    byErrorType: Record<string, number>;
    requeued: number;
    discarded: number;
  } {
    const byErrorType: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      const errorType = entry.error?.constructor?.name ?? 'UnknownError';
      byErrorType[errorType] = (byErrorType[errorType] ?? 0) + 1;
    }
    return {
      total: this.entries.size,
      byErrorType,
      requeued: this.requeuedCount,
      discarded: this.discardedCount,
    };
  }
}
