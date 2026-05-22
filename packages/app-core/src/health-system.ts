// ============================================================================
// Module 9: Health Check System
// ============================================================================

export type HealthCategory = 'liveness' | 'readiness' | 'startup';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthCheckFn {
  (): Promise<HealthCheckResult>;
}

export interface HealthCheckResult {
  status: HealthStatus;
  message?: string;
  details?: Record<string, unknown>;
  responseTime?: number;
}

export interface HealthReport {
  status: HealthStatus;
  score: number;
  timestamp: number;
  checks: Record<string, HealthCheckResult>;
  componentHealth: Record<string, ComponentHealth>;
  degraded: boolean;
}

export interface ComponentHealth {
  status: HealthStatus;
  lastCheck: number;
  consecutiveFailures: number;
  lastError?: string;
}

export interface HealthHistoryEntry {
  timestamp: number;
  score: number;
  status: HealthStatus;
}

export class AppHealthSystem {
  private checks: Map<string, { fn: HealthCheckFn; category: HealthCategory }> = new Map();
  private componentHealth: Map<string, ComponentHealth> = new Map();
  private history: HealthHistoryEntry[] = [];
  private maxHistory: number = 100;

  registerCheck(name: string, check: HealthCheckFn, category: HealthCategory = 'liveness'): void {
    this.checks.set(name, { fn: check, category });
    this.componentHealth.set(name, {
      status: 'unknown',
      lastCheck: 0,
      consecutiveFailures: 0,
    });
  }

  removeCheck(name: string): boolean {
    this.componentHealth.delete(name);
    return this.checks.delete(name);
  }

  async checkHealth(): Promise<HealthReport> {
    const checks: Record<string, HealthCheckResult> = {};
    let totalScore = 0;
    let checkCount = 0;

    for (const [name, { fn }] of this.checks) {
      const startTime = Date.now();
      try {
        const result = await fn();
        result.responseTime = Date.now() - startTime;
        checks[name] = result;

        const health = this.componentHealth.get(name)!;
        health.lastCheck = Date.now();
        health.status = result.status;
        if (result.status === 'healthy') {
          health.consecutiveFailures = 0;
          totalScore += 100;
        } else if (result.status === 'degraded') {
          health.consecutiveFailures = 0;
          totalScore += 50;
        } else {
          health.consecutiveFailures++;
          health.lastError = result.message;
          totalScore += 0;
        }
      } catch (error) {
        checks[name] = {
          status: 'unhealthy',
          message: (error as Error).message,
          responseTime: Date.now() - startTime,
        };

        const health = this.componentHealth.get(name)!;
        health.lastCheck = Date.now();
        health.status = 'unhealthy';
        health.consecutiveFailures++;
        health.lastError = (error as Error).message;
        totalScore += 0;
      }
      checkCount++;
    }

    const score = checkCount > 0 ? Math.round(totalScore / checkCount) : 100;
    const overallStatus = this.scoreToStatus(score);

    const report: HealthReport = {
      status: overallStatus,
      score,
      timestamp: Date.now(),
      checks,
      componentHealth: Object.fromEntries(this.componentHealth),
      degraded: overallStatus === 'degraded',
    };

    this.history.push({
      timestamp: report.timestamp,
      score: report.score,
      status: report.status,
    });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    return report;
  }

  isHealthy(): boolean {
    for (const [, health] of this.componentHealth) {
      if (health.status === 'unhealthy') return false;
    }
    return true;
  }

  isReady(): boolean {
    for (const [, health] of this.componentHealth) {
      if (health.status === 'unhealthy' || health.status === 'unknown') return false;
    }
    return true;
  }

  getComponentHealth(component: string): ComponentHealth {
    const health = this.componentHealth.get(component);
    if (!health) {
      return {
        status: 'unknown',
        lastCheck: 0,
        consecutiveFailures: 0,
      };
    }
    return { ...health };
  }

  getHistory(): HealthHistoryEntry[] {
    return [...this.history];
  }

  getCheckCount(): number {
    return this.checks.size;
  }

  clearHistory(): void {
    this.history = [];
  }

  private scoreToStatus(score: number): HealthStatus {
    if (score >= 80) return 'healthy';
    if (score >= 50) return 'degraded';
    return 'unhealthy';
  }
}
