/**
 * Cron-like job scheduling.
 */

export interface Job {
  id: string;
  name: string;
  cron: string | null;
  intervalMs: number | null;
  handler: () => Promise<void>;
  running: boolean;
  lastRun?: number;
  nextRun?: number;
  timer?: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>;
}

export interface JobExecution {
  jobId: string;
  startedAt: number;
  completedAt?: number;
  success: boolean;
  error?: string;
  duration?: number;
}

let jobIdCounter = 0;

function generateJobId(): string {
  return `job_${Date.now()}_${++jobIdCounter}`;
}

/**
 * Simple cron expression parser.
 * Supports: wildcard, specific values, ranges (1-5), steps.
 * Fields: minute hour day-of-month month day-of-week
 */
function parseCron(cron: string): ((date: Date) => boolean) | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minutePart, hourPart, domPart, monthPart, dowPart] = parts;

  function parseField(field: string, min: number, max: number): (val: number) => boolean {
    if (field === '*') return () => true;

    const values = new Set<number>();

    for (const segment of field.split(',')) {
      if (segment.includes('/')) {
        const [rangeStr, stepStr] = segment.split('/');
        const step = parseInt(stepStr ?? '1', 10);
        let start = min;
        let end = max;
        if (rangeStr && rangeStr !== '*') {
          if (rangeStr.includes('-')) {
            const [s, e] = rangeStr.split('-').map(Number);
            start = s;
            end = e;
          } else {
            start = parseInt(rangeStr, 10);
          }
        }
        for (let i = start; i <= end; i += step) {
          values.add(i);
        }
      } else if (segment.includes('-')) {
        const [start, end] = segment.split('-').map(Number);
        for (let i = start; i <= end; i++) {
          values.add(i);
        }
      } else {
        values.add(parseInt(segment, 10));
      }
    }

    return (val: number) => values.has(val);
  }

  const matchMinute = parseField(minutePart, 0, 59);
  const matchHour = parseField(hourPart, 0, 23);
  const matchDom = parseField(domPart, 1, 31);
  const matchMonth = parseField(monthPart, 1, 12);
  const matchDow = parseField(dowPart, 0, 6);

  return (date: Date) =>
    matchMinute(date.getMinutes()) &&
    matchHour(date.getHours()) &&
    matchDom(date.getDate()) &&
    matchMonth(date.getMonth() + 1) &&
    matchDow(date.getDay());
}

function getNextCronTime(cronExpr: string): number {
  const matcher = parseCron(cronExpr);
  if (!matcher) return Date.now() + 60000;

  const now = new Date();
  const check = new Date(now.getTime() + 1000);

  // Check every second for up to 1 year
  for (let i = 0; i < 31536000; i++) {
    check.setTime(now.getTime() + (i + 1) * 1000);
    if (matcher(check)) {
      return check.getTime();
    }
  }

  return Date.now() + 60000;
}

export class JobScheduler {
  private jobs: Map<string, Job> = new Map();
  private history: Map<string, JobExecution[]> = new Map();
  private started: boolean = false;
  private checkInterval?: ReturnType<typeof setInterval>;
  private totalExecutions: number = 0;
  private failedExecutions: number = 0;

  schedule(name: string, cron: string, handler: () => Promise<void>): string {
    const id = generateJobId();
    const nextRun = getNextCronTime(cron);
    const job: Job = {
      id,
      name,
      cron,
      intervalMs: null,
      handler,
      running: false,
      nextRun,
    };
    this.jobs.set(id, job);
    this.history.set(id, []);

    if (this.started) {
      this.scheduleJobCheck(job);
    }

    return id;
  }

  scheduleInterval(name: string, intervalMs: number, handler: () => Promise<void>): string {
    const id = generateJobId();
    const job: Job = {
      id,
      name,
      cron: null,
      intervalMs,
      handler,
      running: false,
      nextRun: Date.now() + intervalMs,
    };
    this.jobs.set(id, job);
    this.history.set(id, []);

    if (this.started) {
      this.scheduleJobCheck(job);
    }

    return id;
  }

  unschedule(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.timer) {
      clearTimeout(job.timer);
      clearInterval(job.timer);
    }
    this.jobs.delete(jobId);
    return true;
  }

  async runNow(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    await this.executeJob(job);
  }

  getJobs(): Job[] {
    return Array.from(this.jobs.values());
  }

  getJobHistory(jobId: string): JobExecution[] {
    return this.history.get(jobId) ?? [];
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    // Start a check interval that runs every second
    this.checkInterval = setInterval(() => {
      const now = Date.now();
      for (const job of this.jobs.values()) {
        if (!job.running && job.nextRun && job.nextRun <= now) {
          this.executeJob(job);
        }
      }
    }, 1000);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    for (const job of this.jobs.values()) {
      if (job.timer) {
        clearTimeout(job.timer);
        clearInterval(job.timer);
        job.timer = undefined;
      }
    }
  }

  getStats(): {
    totalJobs: number;
    activeJobs: number;
    totalExecutions: number;
    failedExecutions: number;
  } {
    return {
      totalJobs: this.jobs.size,
      activeJobs: Array.from(this.jobs.values()).filter((j) => j.running).length,
      totalExecutions: this.totalExecutions,
      failedExecutions: this.failedExecutions,
    };
  }

  private scheduleJobCheck(job: Job): void {
    if (job.intervalMs) {
      job.timer = setInterval(() => {
        if (!job.running) {
          this.executeJob(job);
        }
      }, job.intervalMs);
    } else if (job.cron) {
      const checkNext = () => {
        if (!this.jobs.has(job.id)) return;
        const nextTime = getNextCronTime(job.cron!);
        job.nextRun = nextTime;
        job.timer = setTimeout(() => {
          if (!job.running) {
            this.executeJob(job);
          }
          checkNext();
        }, nextTime - Date.now());
      };
      checkNext();
    }
  }

  private async executeJob(job: Job): Promise<void> {
    if (job.running) return;
    job.running = true;
    const startedAt = Date.now();

    const execution: JobExecution = {
      jobId: job.id,
      startedAt,
      success: false,
    };

    try {
      await job.handler();
      execution.success = true;
    } catch (err) {
      execution.success = false;
      execution.error = err instanceof Error ? err.message : String(err);
      this.failedExecutions++;
    }

    execution.completedAt = Date.now();
    execution.duration = execution.completedAt - startedAt;
    job.running = false;
    job.lastRun = startedAt;

    if (job.intervalMs) {
      job.nextRun = Date.now() + job.intervalMs;
    } else if (job.cron) {
      job.nextRun = getNextCronTime(job.cron);
    }

    this.totalExecutions++;
    const jobHistory = this.history.get(job.id);
    if (jobHistory) {
      jobHistory.push(execution);
    }
  }
}
