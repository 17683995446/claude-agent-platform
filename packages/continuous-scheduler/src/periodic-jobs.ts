// ============================================================
// Module 9: Periodic Job Manager
// ============================================================

export type JobHandler = () => Promise<unknown>;
export type MissedExecutionPolicy = 'catch-up' | 'skip' | 'run-once';

export interface JobOptions {
  maxRetries?: number;
  retryDelay?: number;
  missedPolicy?: MissedExecutionPolicy;
  overlapPrevention?: boolean;
  maxHistory?: number;
  timeout?: number;
  enabled?: boolean;
}

export interface JobInfo {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  averageDuration: number;
  runCount: number;
  successCount: number;
  failureCount: number;
  options: JobOptions;
}

export interface JobResult {
  jobId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
  timestamp: number;
}

export interface JobStatus {
  id: string;
  name: string;
  state: 'idle' | 'running' | 'scheduled' | 'disabled';
  lastRun?: number;
  nextRun?: number;
  lastResult?: JobResult;
}

export interface JobExecution {
  id: string;
  jobId: string;
  timestamp: number;
  duration: number;
  success: boolean;
  error?: string;
  result?: unknown;
}

export interface PeriodicJobManagerOptions {
  defaultMaxRetries?: number;
  defaultRetryDelay?: number;
  defaultTimeout?: number;
  defaultMaxHistory?: number;
}

const DEFAULT_JOB_OPTIONS: Required<PeriodicJobManagerOptions> = {
  defaultMaxRetries: 3,
  defaultRetryDelay: 1000,
  defaultTimeout: 30000,
  defaultMaxHistory: 100,
};

export class PeriodicJobManager {
  private jobs: Map<string, InternalJob> = new Map();
  private executionHistory: Map<string, JobExecution[]> = new Map();
  private runningJobs: Set<string> = new Set();
  private options: Required<PeriodicJobManagerOptions>;
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(options?: PeriodicJobManagerOptions) {
    this.options = { ...DEFAULT_JOB_OPTIONS, ...options };
  }

  schedule(
    name: string,
    cron: string,
    handler: JobHandler,
    options?: JobOptions
  ): string {
    const jobId = `job_${name}_${Date.now()}`;
    const jobOptions = {
      maxRetries: options?.maxRetries ?? this.options.defaultMaxRetries,
      retryDelay: options?.retryDelay ?? this.options.defaultRetryDelay,
      missedPolicy: options?.missedPolicy ?? 'skip',
      overlapPrevention: options?.overlapPrevention ?? true,
      maxHistory: options?.maxHistory ?? this.options.defaultMaxHistory,
      timeout: options?.timeout ?? this.options.defaultTimeout,
      enabled: options?.enabled ?? true,
    };

    const job: InternalJob = {
      id: jobId,
      name,
      cron,
      handler,
      enabled: jobOptions.enabled,
      options: jobOptions,
      lastRun: undefined,
      nextRun: undefined,
      averageDuration: 0,
      runCount: 0,
      successCount: 0,
      failureCount: 0,
    };

    this.jobs.set(jobId, job);
    this.executionHistory.set(jobId, []);

    // Parse cron to get next run time (simplified)
    job.nextRun = this.parseCronToNextRun(cron);

    return jobId;
  }

  unschedule(jobId: string): boolean {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }
    this.executionHistory.delete(jobId);
    return this.jobs.delete(jobId);
  }

  async runNow(jobId: string): Promise<JobResult> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return {
        jobId,
        success: false,
        error: 'Job not found',
        duration: 0,
        timestamp: Date.now(),
      };
    }

    if (!job.enabled) {
      return {
        jobId,
        success: false,
        error: 'Job is disabled',
        duration: 0,
        timestamp: Date.now(),
      };
    }

    // Overlap prevention
    if (job.options.overlapPrevention && this.runningJobs.has(jobId)) {
      return {
        jobId,
        success: false,
        error: 'Job is already running',
        duration: 0,
        timestamp: Date.now(),
      };
    }

    this.runningJobs.add(jobId);
    const startTime = Date.now();

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(job.handler, job.options.timeout);

      const duration = Date.now() - startTime;
      job.lastRun = startTime;
      job.runCount++;
      job.successCount++;

      // Update average duration
      job.averageDuration = job.averageDuration === 0
        ? duration
        : (job.averageDuration * (job.runCount - 1) + duration) / job.runCount;

      const execution: JobExecution = {
        id: `exec_${Date.now()}`,
        jobId,
        timestamp: startTime,
        duration,
        success: true,
        result,
      };
      this.recordExecution(jobId, execution);

      return {
        jobId,
        success: true,
        result,
        duration,
        timestamp: startTime,
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      job.lastRun = startTime;
      job.runCount++;
      job.failureCount++;

      const errorMsg = err instanceof Error ? err.message : String(err);

      const execution: JobExecution = {
        id: `exec_${Date.now()}`,
        jobId,
        timestamp: startTime,
        duration,
        success: false,
        error: errorMsg,
      };
      this.recordExecution(jobId, execution);

      return {
        jobId,
        success: false,
        error: errorMsg,
        duration,
        timestamp: startTime,
      };
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  getJobStatus(jobId: string): JobStatus | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;

    const history = this.executionHistory.get(jobId) ?? [];
    const lastExecution = history.length > 0 ? history[history.length - 1] : undefined;

    let state: JobStatus['state'] = 'idle';
    if (!job.enabled) state = 'disabled';
    else if (this.runningJobs.has(jobId)) state = 'running';
    else if (job.nextRun && job.nextRun > Date.now()) state = 'scheduled';

    return {
      id: job.id,
      name: job.name,
      state,
      lastRun: job.lastRun,
      nextRun: job.nextRun,
      lastResult: lastExecution
        ? {
            jobId: lastExecution.jobId,
            success: lastExecution.success,
            result: lastExecution.result,
            error: lastExecution.error,
            duration: lastExecution.duration,
            timestamp: lastExecution.timestamp,
          }
        : undefined,
    };
  }

  getJobs(): JobInfo[] {
    const jobs: JobInfo[] = [];
    for (const job of this.jobs.values()) {
      jobs.push({
        id: job.id,
        name: job.name,
        cron: job.cron,
        enabled: job.enabled,
        lastRun: job.lastRun,
        nextRun: job.nextRun,
        averageDuration: job.averageDuration,
        runCount: job.runCount,
        successCount: job.successCount,
        failureCount: job.failureCount,
        options: { ...job.options },
      });
    }
    return jobs;
  }

  getExecutionHistory(jobId: string, limit?: number): JobExecution[] {
    const history = this.executionHistory.get(jobId) ?? [];
    if (limit) {
      return history.slice(-limit);
    }
    return [...history];
  }

  enableJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.enabled = true;
    return true;
  }

  disableJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.enabled = false;
    return true;
  }

  getJobCount(): number {
    return this.jobs.size;
  }

  private async executeWithTimeout(
    handler: JobHandler,
    timeoutMs: number
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Job timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      handler()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private recordExecution(jobId: string, execution: JobExecution): void {
    const history = this.executionHistory.get(jobId) ?? [];
    history.push(execution);

    const job = this.jobs.get(jobId);
    const maxHistory = job?.options.maxHistory ?? this.options.defaultMaxHistory;

    while (history.length > maxHistory) {
      history.shift();
    }

    this.executionHistory.set(jobId, history);
  }

  private parseCronToNextRun(cron: string): number {
    // Simplified cron parsing - supports basic patterns
    // In a real implementation, this would use a full cron parser
    const parts = cron.split(' ');
    if (parts.length < 5) return Date.now() + 60000;

    const minute = parts[0];
    const hour = parts[1];

    const now = new Date();
    let nextMinute = now.getMinutes() + 1;
    let nextHour = now.getHours();

    if (minute !== '*') {
      const targetMinute = parseInt(minute, 10);
      if (!isNaN(targetMinute)) {
        nextMinute = targetMinute;
        if (now.getMinutes() >= targetMinute) {
          nextHour++;
        }
      }
    }

    if (hour !== '*') {
      const targetHour = parseInt(hour, 10);
      if (!isNaN(targetHour)) {
        nextHour = targetHour;
      }
    }

    const next = new Date(now);
    next.setHours(nextHour, nextMinute, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }

    return next.getTime();
  }
}

interface InternalJob {
  id: string;
  name: string;
  cron: string;
  handler: JobHandler;
  enabled: boolean;
  options: Required<JobOptions>;
  lastRun?: number;
  nextRun?: number;
  averageDuration: number;
  runCount: number;
  successCount: number;
  failureCount: number;
}
