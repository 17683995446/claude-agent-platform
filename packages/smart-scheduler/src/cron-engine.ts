// src/cron-engine.ts - 高级定时引擎

export interface CronOptions {
  timezone?: string;
  missedPolicy?: 'fire-immediately' | 'skip' | 'fire-last-missed';
  maxMissed?: number;
  startDate?: Date;
  endDate?: Date;
  tag?: string;
}

export interface CronJobInfo {
  id: string;
  cron: string;
  description: string;
  nextRun: Date | undefined;
  lastRun: Date | undefined;
  timezone: string;
  missedCount: number;
  tag?: string;
}

type CronFieldValues = number[];

interface ParsedCron {
  minute: CronFieldValues;
  hour: CronFieldValues;
  day: CronFieldValues;
  month: CronFieldValues;
  weekday: CronFieldValues;
  hasSeconds?: boolean;
  second?: CronFieldValues;
  hasYear?: boolean;
  year?: CronFieldValues;
}

export class CronEngine {
  private jobs: Map<string, CronJob> = new Map();
  private idCounter: number = 0;

  private generateId(): string {
    return `cron-${++this.idCounter}`;
  }

  schedule(cron: string, handler: () => Promise<void>, options?: CronOptions): string {
    const id = this.generateId();
    const parsed = this.parseCron(cron);
    const description = this.describeCron(cron);

    const job: CronJob = {
      id,
      cron,
      parsed,
      handler,
      options: {
        timezone: options?.timezone ?? 'UTC',
        missedPolicy: options?.missedPolicy ?? 'fire-immediately',
        maxMissed: options?.maxMissed ?? 10,
        startDate: options?.startDate,
        endDate: options?.endDate,
        tag: options?.tag,
      },
      nextRun: this.calculateNextRun(parsed, new Date(), options?.timezone),
      lastRun: undefined,
      missedCount: 0,
      description,
    };

    this.jobs.set(id, job);
    return id;
  }

  unschedule(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  getNextRun(jobId: string): Date | undefined {
    return this.jobs.get(jobId)?.nextRun;
  }

  getJobs(): CronJobInfo[] {
    const result: CronJobInfo[] = [];
    for (const job of this.jobs.values()) {
      result.push({
        id: job.id,
        cron: job.cron,
        description: job.description,
        nextRun: job.nextRun,
        lastRun: job.lastRun,
        timezone: job.options.timezone,
        missedCount: job.missedCount,
        tag: job.options.tag,
      });
    }
    return result;
  }

  // Tick method to advance the engine (for testing)
  async tick(now?: Date): Promise<void> {
    const currentTime = now ?? new Date();
    for (const job of this.jobs.values()) {
      if (job.nextRun && job.nextRun <= currentTime) {
        // Check end date
        if (job.options.endDate && job.nextRun >= job.options.endDate) {
          continue;
        }

        job.lastRun = job.nextRun;
        await job.handler();
        job.nextRun = this.calculateNextRun(job.parsed, job.lastRun, job.options.timezone);
      }
    }
  }

  private parseCron(cron: string): ParsedCron {
    // Handle special expressions
    if (cron.startsWith('@')) {
      return this.parseSpecialCron(cron);
    }

    const parts = cron.trim().split(/\s+/);
    let hasSeconds = false;
    let hasYear = false;

    let minutePart: string;
    let hourPart: string;
    let dayPart: string;
    let monthPart: string;
    let weekdayPart: string;
    let secondPart: string | undefined;
    let yearPart: string | undefined;

    if (parts.length === 6) {
      // Could be second-based or year-based
      // Heuristic: if last part is 4 digits, it's year
      if (/^\d{4}$/.test(parts[5])) {
        hasYear = true;
        minutePart = parts[0];
        hourPart = parts[1];
        dayPart = parts[2];
        monthPart = parts[3];
        weekdayPart = parts[4];
        yearPart = parts[5];
      } else {
        hasSeconds = true;
        secondPart = parts[0];
        minutePart = parts[1];
        hourPart = parts[2];
        dayPart = parts[3];
        monthPart = parts[4];
        weekdayPart = parts[5];
      }
    } else if (parts.length === 7) {
      hasSeconds = true;
      hasYear = true;
      secondPart = parts[0];
      minutePart = parts[1];
      hourPart = parts[2];
      dayPart = parts[3];
      monthPart = parts[4];
      weekdayPart = parts[5];
      yearPart = parts[6];
    } else {
      minutePart = parts[0];
      hourPart = parts[1];
      dayPart = parts[2];
      monthPart = parts[3];
      weekdayPart = parts[4];
    }

    const result: ParsedCron = {
      minute: this.parseField(minutePart, 0, 59),
      hour: this.parseField(hourPart, 0, 23),
      day: this.parseField(dayPart, 1, 31),
      month: this.parseField(monthPart, 1, 12),
      weekday: this.parseField(weekdayPart, 0, 6),
    };

    if (hasSeconds && secondPart) {
      result.hasSeconds = true;
      result.second = this.parseField(secondPart, 0, 59);
    }
    if (hasYear && yearPart) {
      result.hasYear = true;
      result.year = this.parseField(yearPart, 1970, 2100);
    }

    return result;
  }

  private parseSpecialCron(cron: string): ParsedCron {
    const base: ParsedCron = {
      minute: [0],
      hour: [0],
      day: this.range(1, 31),
      month: this.range(1, 12),
      weekday: this.range(0, 6),
    };

    switch (cron) {
      case '@yearly':
      case '@annually':
        return { ...base, month: [1], day: [1] };
      case '@monthly':
        return { ...base, day: [1] };
      case '@weekly':
        return { ...base, weekday: [0] };
      case '@daily':
      case '@midnight':
        return base;
      case '@hourly':
        return { ...base, minute: [0] };
      case '@every 5m':
        return {
          ...base,
          minute: this.range(0, 59).filter((m) => m % 5 === 0),
          hour: this.range(0, 23),
        };
      default:
        // Try to parse @every Xs/Xm/Xh
        const match = cron.match(/^@every\s+(\d+)([smh])$/);
        if (match) {
          const amount = parseInt(match[1]);
          const unit = match[2];
          if (unit === 's') {
            return {
              ...base,
              second: this.range(0, 59).filter((s) => s % amount === 0),
              minute: this.range(0, 59),
              hour: this.range(0, 23),
            };
          } else if (unit === 'm') {
            return {
              ...base,
              minute: this.range(0, 59).filter((m) => m % amount === 0),
              hour: this.range(0, 23),
            };
          } else if (unit === 'h') {
            return {
              ...base,
              hour: this.range(0, 23).filter((h) => h % amount === 0),
            };
          }
        }
        return base;
    }
  }

  private parseField(field: string, min: number, max: number): number[] {
    if (field === '*') return this.range(min, max);

    const values = new Set<number>();

    for (const part of field.split(',')) {
      if (part.includes('/')) {
        const [rangePart, stepPart] = part.split('/');
        const step = parseInt(stepPart);
        let start = min;
        let end = max;
        if (rangePart !== '*') {
          if (rangePart.includes('-')) {
            [start, end] = rangePart.split('-').map(Number);
          } else {
            start = parseInt(rangePart);
          }
        }
        for (let i = start; i <= end; i += step) {
          values.add(i);
        }
      } else if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        for (let i = start; i <= end; i++) {
          values.add(i);
        }
      } else {
        values.add(parseInt(part));
      }
    }

    return Array.from(values).sort((a, b) => a - b);
  }

  private range(min: number, max: number): number[] {
    const result: number[] = [];
    for (let i = min; i <= max; i++) result.push(i);
    return result;
  }

  private calculateNextRun(parsed: ParsedCron, after: Date, _timezone?: string): Date {
    const date = new Date(after.getTime());
    date.setSeconds(0, 0);
    date.setMinutes(date.getMinutes() + 1);

    // Search up to 4 years
    const maxIterations = 4 * 366 * 24 * 60;
    for (let i = 0; i < maxIterations; i++) {
      if (parsed.year && !parsed.year.includes(date.getFullYear())) {
        date.setFullYear(date.getFullYear() + 1);
        date.setMonth(0, 1);
        date.setHours(0, 0, 0, 0);
        continue;
      }
      if (!parsed.month.includes(date.getMonth() + 1)) {
        date.setMonth(date.getMonth() + 1);
        date.setDate(1);
        date.setHours(0, 0, 0, 0);
        continue;
      }
      if (!parsed.day.includes(date.getDate())) {
        date.setDate(date.getDate() + 1);
        date.setHours(0, 0, 0, 0);
        continue;
      }
      if (!parsed.weekday.includes(date.getDay())) {
        date.setDate(date.getDate() + 1);
        date.setHours(0, 0, 0, 0);
        continue;
      }
      if (!parsed.hour.includes(date.getHours())) {
        date.setHours(date.getHours() + 1);
        date.setMinutes(0, 0, 0);
        continue;
      }
      if (!parsed.minute.includes(date.getMinutes())) {
        date.setMinutes(date.getMinutes() + 1);
        date.setSeconds(0, 0);
        continue;
      }
      if (parsed.hasSeconds && parsed.second) {
        if (!parsed.second.includes(date.getSeconds())) {
          date.setSeconds(date.getSeconds() + 1);
          continue;
        }
      }

      return date;
    }

    return date;
  }

  describeCron(cron: string): string {
    if (cron.startsWith('@')) {
      const map: Record<string, string> = {
        '@yearly': 'Every year',
        '@annually': 'Every year',
        '@monthly': 'Every month',
        '@weekly': 'Every week',
        '@daily': 'Every day',
        '@midnight': 'Every day at midnight',
        '@hourly': 'Every hour',
      };
      if (map[cron]) return map[cron];
      const match = cron.match(/^@every\s+(\d+)([smh])$/);
      if (match) {
        const unitMap: Record<string, string> = { s: 'second', m: 'minute', h: 'hour' };
        return `Every ${match[1]} ${unitMap[match[2]]}${parseInt(match[1]) > 1 ? 's' : ''}`;
      }
      return cron;
    }

    const parts = cron.trim().split(/\s+/);
    if (parts.length >= 5) {
      const minute = parts[0];
      const hour = parts[1];
      const day = parts[2];
      const month = parts[3];
      const weekday = parts[4];

      let desc = 'At ';
      if (minute !== '*' && hour !== '*') {
        desc += `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
      } else if (hour !== '*') {
        desc += `minute ${minute} of hour ${hour}`;
      } else {
        desc += 'every minute';
      }

      if (day !== '*') desc += ` on day ${day}`;
      if (month !== '*') desc += ` in month ${month}`;
      if (weekday !== '*') desc += ` on weekday ${weekday}`;

      return desc;
    }

    return cron;
  }
}

interface CronJob {
  id: string;
  cron: string;
  parsed: ParsedCron;
  handler: () => Promise<void>;
  options: Required<CronOptions>;
  nextRun: Date | undefined;
  lastRun: Date | undefined;
  missedCount: number;
  description: string;
}
