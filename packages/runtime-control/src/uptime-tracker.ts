// src/uptime-tracker.ts - 运行时间追踪器

export interface DowntimeRecord {
  startTime: number;
  endTime: number;
  reason: string;
  duration: number;
}

export interface SLAReport {
  target: number; // target availability %
  actual: number; // actual availability %
  compliant: boolean;
  totalUptime: number;
  totalDowntime: number;
  period: string;
}

export interface UptimeMilestone {
  name: string;
  target: number; // ms
  achieved: boolean;
  achievedAt?: number;
}

export class UptimeTracker {
  private startTime: number | null = null;
  private stopTime: number | null = null;
  private totalUptime: number = 0;
  private downtimeHistory: DowntimeRecord[] = [];
  private sessionStartTime: number | null = null;
  private milestones: UptimeMilestone[] = [];

  constructor() {
    this.initMilestones();
  }

  private initMilestones(): void {
    const targets = [
      { name: '1 minute', ms: 60 * 1000 },
      { name: '5 minutes', ms: 5 * 60 * 1000 },
      { name: '1 hour', ms: 60 * 60 * 1000 },
      { name: '24 hours', ms: 24 * 60 * 60 * 1000 },
      { name: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
      { name: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
    ];
    for (const t of targets) {
      this.milestones.push({ name: t.name, target: t.ms, achieved: false });
    }
  }

  recordStart(): void {
    const now = Date.now();
    if (this.stopTime !== null && this.stopTime > 0) {
      // Was stopped, record downtime
      const lastStop = this.stopTime;
      const lastDowntime = this.downtimeHistory[this.downtimeHistory.length - 1];
      if (lastDowntime && !lastDowntime.endTime) {
        lastDowntime.endTime = now;
        lastDowntime.duration = now - lastDowntime.startTime;
      }
    }
    this.startTime = this.startTime ?? now;
    this.sessionStartTime = now;
    this.stopTime = null;
  }

  recordStop(reason: string): void {
    if (this.sessionStartTime === null) return;

    const now = Date.now();
    const sessionDuration = now - this.sessionStartTime;
    this.totalUptime += sessionDuration;
    this.stopTime = now;
    this.sessionStartTime = null;

    this.downtimeHistory.push({
      startTime: now,
      endTime: 0,
      reason,
      duration: 0,
    });

    this.checkMilestones();
  }

  getUptime(): number {
    let uptime = this.totalUptime;
    if (this.sessionStartTime !== null) {
      uptime += Date.now() - this.sessionStartTime;
    }
    return uptime;
  }

  getSessionUptime(): number {
    if (this.sessionStartTime === null) return 0;
    return Date.now() - this.sessionStartTime;
  }

  getTotalDowntime(): number {
    let total = 0;
    for (const d of this.downtimeHistory) {
      if (d.endTime > 0) {
        total += d.duration;
      } else if (this.stopTime) {
        total += Date.now() - d.startTime;
      }
    }
    return total;
  }

  getAvailability(period: string = 'all'): number {
    const uptime = this.getUptime();
    const downtime = this.getTotalDowntime();
    const total = uptime + downtime;

    if (total === 0) return 100;

    return (uptime / total) * 100;
  }

  getDowntimeHistory(): DowntimeRecord[] {
    return [...this.downtimeHistory];
  }

  getSLACompliance(target: number): SLAReport {
    const actual = this.getAvailability();
    return {
      target,
      actual,
      compliant: actual >= target,
      totalUptime: this.getUptime(),
      totalDowntime: this.getTotalDowntime(),
      period: 'all',
    };
  }

  private checkMilestones(): void {
    const uptime = this.getUptime();
    for (const milestone of this.milestones) {
      if (!milestone.achieved && uptime >= milestone.target) {
        milestone.achieved = true;
        milestone.achievedAt = Date.now();
      }
    }
  }

  getMilestones(): UptimeMilestone[] {
    this.checkMilestones();
    return [...this.milestones];
  }

  isRunning(): boolean {
    return this.sessionStartTime !== null;
  }

  getStartTime(): number | null {
    return this.startTime;
  }

  getStopTime(): number | null {
    return this.stopTime;
  }

  reset(): void {
    this.startTime = null;
    this.stopTime = null;
    this.totalUptime = 0;
    this.downtimeHistory = [];
    this.sessionStartTime = null;
    this.milestones = [];
    this.initMilestones();
  }
}
