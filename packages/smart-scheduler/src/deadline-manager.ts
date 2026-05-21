// src/deadline-manager.ts - 截止时间管理器

export interface DeadlineEntry {
  taskId: string;
  deadline: Date;
  createdAt: Date;
  warningThresholds: number[];
  extensions: number[];
  parentTaskId?: string;
  slaTarget?: number; // ms
  escalated: boolean;
}

export interface DeadlineCheckResult {
  taskId: string;
  status: 'ok' | 'warning' | 'critical' | 'overdue';
  timeRemaining: number;
  percentageUsed: number;
  threshold?: number;
}

export interface PredictedBreach {
  taskId: string;
  predictedBreachTime: Date;
  confidence: number;
  reason: string;
}

export class DeadlineManager {
  private deadlines: Map<string, DeadlineEntry> = new Map();
  private defaultWarningThresholds: number[];
  private defaultSlaTarget: number;

  constructor(options?: {
    warningThresholds?: number[];
    defaultSlaTarget?: number;
  }) {
    this.defaultWarningThresholds = options?.warningThresholds ?? [50, 75, 90];
    this.defaultSlaTarget = options?.defaultSlaTarget ?? 3600_000; // 1 hour
  }

  setDeadline(taskId: string, deadline: Date, options?: { parentTaskId?: string; slaTarget?: number; createdAt?: Date }): void {
    this.deadlines.set(taskId, {
      taskId,
      deadline,
      createdAt: options?.createdAt ?? new Date(),
      warningThresholds: [...this.defaultWarningThresholds],
      extensions: [],
      parentTaskId: options?.parentTaskId,
      slaTarget: options?.slaTarget ?? this.defaultSlaTarget,
      escalated: false,
    });
  }

  checkDeadlines(now?: Date): DeadlineCheckResult[] {
    const currentTime = now ?? new Date();
    const results: DeadlineCheckResult[] = [];

    for (const entry of this.deadlines.values()) {
      const totalDuration = entry.deadline.getTime() - entry.createdAt.getTime();
      const elapsed = currentTime.getTime() - entry.createdAt.getTime();
      const timeRemaining = entry.deadline.getTime() - currentTime.getTime();
      const percentageUsed = totalDuration > 0 ? (elapsed / totalDuration) * 100 : 100;

      let status: DeadlineCheckResult['status'] = 'ok';
      let threshold: number | undefined;

      if (timeRemaining <= 0) {
        status = 'overdue';
      } else {
        for (const t of entry.warningThresholds.sort((a, b) => b - a)) {
          if (percentageUsed >= t) {
            status = percentageUsed >= 90 ? 'critical' : 'warning';
            threshold = t;
            break;
          }
        }
      }

      results.push({
        taskId: entry.taskId,
        status,
        timeRemaining,
        percentageUsed,
        threshold,
      });
    }

    return results;
  }

  extendDeadline(taskId: string, extension: number, now?: Date): boolean {
    const entry = this.deadlines.get(taskId);
    if (!entry) return false;

    const currentTime = now ?? new Date();
    // Check if already overdue
    if (entry.deadline.getTime() <= currentTime.getTime()) {
      return false; // Cannot extend overdue deadlines
    }

    const newDeadline = new Date(entry.deadline.getTime() + extension);
    entry.deadline = newDeadline;
    entry.extensions.push(extension);
    return true;
  }

  getTimeRemaining(taskId: string, now?: Date): number {
    const entry = this.deadlines.get(taskId);
    if (!entry) return -1;
    const currentTime = now ?? new Date();
    return entry.deadline.getTime() - currentTime.getTime();
  }

  predictBreaches(now?: Date): PredictedBreach[] {
    const currentTime = now ?? new Date();
    const breaches: PredictedBreach[] = [];

    for (const entry of this.deadlines.values()) {
      const timeRemaining = entry.deadline.getTime() - currentTime.getTime();

      if (timeRemaining <= 0) {
        breaches.push({
          taskId: entry.taskId,
          predictedBreachTime: entry.deadline,
          confidence: 1.0,
          reason: 'Already overdue',
        });
      } else if (timeRemaining < 5 * 60_000) {
        // Within 5 minutes
        breaches.push({
          taskId: entry.taskId,
          predictedBreachTime: entry.deadline,
          confidence: 0.9,
          reason: 'Deadline approaching (less than 5 minutes)',
        });
      } else if (timeRemaining < 30 * 60_000) {
        // Within 30 minutes
        breaches.push({
          taskId: entry.taskId,
          predictedBreachTime: entry.deadline,
          confidence: 0.6,
          reason: 'Deadline within 30 minutes',
        });
      }
    }

    return breaches.sort((a, b) => a.predictedBreachTime.getTime() - b.predictedBreachTime.getTime());
  }

  propagateDeadline(parentTaskId: string, childTaskIds: string[], ratio?: number): void {
    const parent = this.deadlines.get(parentTaskId);
    if (!parent) return;

    const parentDuration = parent.deadline.getTime() - parent.createdAt.getTime();
    const childDuration = parentDuration * (ratio ?? 1);

    for (const childId of childTaskIds) {
      const childDeadline = new Date(parent.createdAt.getTime() + childDuration);
      this.setDeadline(childId, childDeadline, { parentTaskId: parentTaskId });
    }
  }

  removeDeadline(taskId: string): boolean {
    return this.deadlines.delete(taskId);
  }

  getDeadline(taskId: string): DeadlineEntry | undefined {
    return this.deadlines.get(taskId);
  }

  getDeadlineCount(): number {
    return this.deadlines.size;
  }
}
