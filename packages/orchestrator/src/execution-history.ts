// ============================================================================
// ExecutionHistory - Execution History and Statistics
// ============================================================================

import type { ExecutionRecord, ExecutionStats, TaskIntent } from './types.js';

// ---- Record ID generator ----

let recordCounter = 0;

function generateRecordId(): string {
  recordCounter++;
  return `exec-${Date.now().toString(36)}-${recordCounter.toString(36)}`;
}

// ---- ExecutionHistory Class ----

export class ExecutionHistory {
  private records: ExecutionRecord[] = [];
  private maxRecords: number;

  constructor(maxRecords: number = 1000) {
    this.maxRecords = maxRecords;
  }

  /** Record an execution */
  record(execution: Omit<ExecutionRecord, 'id'>): ExecutionRecord {
    const record: ExecutionRecord = {
      ...execution,
      id: generateRecordId(),
    };

    this.records.push(record);

    // Trim old records if exceeding max
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    return record;
  }

  /** Complete an execution record */
  complete(
    id: string,
    status: ExecutionRecord['status'],
    completedSubTasks?: number,
    error?: string,
  ): ExecutionRecord | undefined {
    const record = this.records.find((r) => r.id === id);
    if (!record) return undefined;

    record.status = status;
    record.endTime = new Date();
    record.duration = record.endTime.getTime() - record.startTime.getTime();
    if (completedSubTasks !== undefined) record.completedSubTasks = completedSubTasks;
    if (error) record.error = error;

    return record;
  }

  /** Get a record by ID */
  get(id: string): ExecutionRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  /** Get records by session ID */
  getBySession(sessionId: string): ExecutionRecord[] {
    return this.records.filter((r) => r.sessionId === sessionId);
  }

  /** Get records by intent */
  getByIntent(intent: TaskIntent): ExecutionRecord[] {
    return this.records.filter((r) => r.intent === intent);
  }

  /** Get records by status */
  getByStatus(status: ExecutionRecord['status']): ExecutionRecord[] {
    return this.records.filter((r) => r.status === status);
  }

  /** Get recent records */
  getRecent(limit: number = 10): ExecutionRecord[] {
    return this.records.slice(-limit).reverse();
  }

  /** Get all records */
  getAll(): ExecutionRecord[] {
    return [...this.records];
  }

  /** Query records with filters */
  query(filters: {
    sessionId?: string;
    intent?: TaskIntent;
    status?: ExecutionRecord['status'];
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): ExecutionRecord[] {
    let results = [...this.records];

    if (filters.sessionId) {
      results = results.filter((r) => r.sessionId === filters.sessionId);
    }
    if (filters.intent) {
      results = results.filter((r) => r.intent === filters.intent);
    }
    if (filters.status) {
      results = results.filter((r) => r.status === filters.status);
    }
    if (filters.startDate) {
      results = results.filter((r) => r.startTime >= filters.startDate!);
    }
    if (filters.endDate) {
      results = results.filter((r) => {
        const endTime = r.endTime ?? r.startTime;
        return endTime <= filters.endDate!;
      });
    }
    if (filters.limit) {
      results.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
      results = results.slice(0, filters.limit);
    } else {
      results.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
    }

    return results;
  }

  /** Calculate execution statistics */
  getStats(): ExecutionStats {
    const total = this.records.length;
    if (total === 0) {
      return {
        totalExecutions: 0,
        successRate: 0,
        averageDuration: 0,
        completedDuration: 0,
        intentBreakdown: {} as Record<TaskIntent, number>,
        dailyBreakdown: {},
        mostCommonTasks: [],
      };
    }

    const successes = this.records.filter((r) => r.status === 'success').length;
    const completedRecords = this.records.filter((r) => r.duration !== undefined);
    const completedDuration = completedRecords.reduce((sum, r) => sum + (r.duration ?? 0), 0);
    const averageDuration = completedRecords.length > 0 ? completedDuration / completedRecords.length : 0;

    // Intent breakdown
    const intentBreakdown = {} as Record<TaskIntent, number>;
    for (const record of this.records) {
      intentBreakdown[record.intent] = (intentBreakdown[record.intent] ?? 0) + 1;
    }

    // Daily breakdown
    const dailyBreakdown: Record<string, number> = {};
    for (const record of this.records) {
      const day = record.startTime.toISOString().split('T')[0]!;
      dailyBreakdown[day] = (dailyBreakdown[day] ?? 0) + 1;
    }

    // Most common tasks
    const taskCounts = new Map<string, number>();
    for (const record of this.records) {
      taskCounts.set(record.taskDescription, (taskCounts.get(record.taskDescription) ?? 0) + 1);
    }
    const mostCommonTasks = Array.from(taskCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([description, count]) => ({ description, count }));

    return {
      totalExecutions: total,
      successRate: successes / total,
      averageDuration,
      completedDuration,
      intentBreakdown,
      dailyBreakdown,
      mostCommonTasks,
    };
  }

  /** Get record count */
  getCount(): number {
    return this.records.length;
  }

  /** Clear all records */
  clear(): void {
    this.records = [];
  }
}
