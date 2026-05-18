/**
 * Persistent task storage (in-memory implementation).
 */

import type { Task, TaskStatus } from './task-queue.js';

export class TaskRepository {
  private tasks: Map<string, Task> = new Map();

  save(task: Task): void {
    this.tasks.set(task.id, { ...task });
  }

  find(id: string): Task | undefined {
    const task = this.tasks.get(id);
    return task ? { ...task } : undefined;
  }

  findByStatus(status: string): Task[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.status === status)
      .map((t) => ({ ...t }));
  }

  findDueTasks(): Task[] {
    const now = Date.now();
    return Array.from(this.tasks.values())
      .filter((t) => {
        if (t.status !== 'pending') return false;
        if (t.delay) {
          return t.createdAt + t.delay <= now;
        }
        if (t.deadline) {
          return t.deadline >= now;
        }
        return true;
      })
      .map((t) => ({ ...t }));
  }

  update(id: string, updates: Partial<Task>): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    Object.assign(task, updates);
    return true;
  }

  delete(id: string): boolean {
    return this.tasks.delete(id);
  }

  count(status?: string): number {
    if (!status) return this.tasks.size;
    return Array.from(this.tasks.values()).filter((t) => t.status === status).length;
  }

  clear(): void {
    this.tasks.clear();
  }
}
