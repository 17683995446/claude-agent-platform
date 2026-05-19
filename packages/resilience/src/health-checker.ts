// health-checker.ts - 健康检查系统

export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type HealthCheckType = 'liveness' | 'readiness' | 'startup';

export interface HealthCheckConfig {
  name: string;
  type: HealthCheckType;
  checkFn: HealthCheckFn;
  interval?: number;
  timeout?: number;
}

export type HealthCheckFn = () => Promise<HealthCheckResult>;

export interface HealthCheckResult {
  healthy: boolean;
  level?: HealthLevel;
  message?: string;
  details?: Record<string, unknown>;
  timestamp?: number;
}

export interface ComponentHealth {
  name: string;
  type: HealthCheckType;
  level: HealthLevel;
  lastCheck: number | null;
  lastResult: HealthCheckResult | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface HealthReport {
  status: HealthLevel;
  components: Record<string, ComponentHealth>;
  timestamp: number;
  summary: string;
}

export interface DependencyGroup {
  name: string;
  components: string[];
  logic: 'and' | 'or';
}

type HealthChangeCallback = (name: string, oldLevel: HealthLevel, newLevel: HealthLevel) => void;

export class HealthChecker {
  private checks = new Map<string, HealthCheckConfig>();
  private componentHealth = new Map<string, ComponentHealth>();
  private dependencyGroups: DependencyGroup[] = [];
  private changeCallbacks: HealthChangeCallback[] = [];
  private intervals = new Map<string, ReturnType<typeof setInterval>>();

  registerCheck(name: string, checkFn: HealthCheckFn, type: HealthCheckType = 'liveness', interval?: number, timeout?: number): void {
    this.checks.set(name, { name, type, checkFn, interval, timeout });
    this.componentHealth.set(name, {
      name,
      type,
      level: 'unknown',
      lastCheck: null,
      lastResult: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    });

    if (interval && interval > 0) {
      this.startPeriodicCheck(name, interval);
    }
  }

  async checkHealth(): Promise<HealthReport> {
    const results: Record<string, ComponentHealth> = {};
    const checkPromises: Promise<void>[] = [];

    for (const [name, config] of this.checks) {
      checkPromises.push(
        this.checkComponent(name, config).then(health => {
          results[name] = health;
        }),
      );
    }

    await Promise.all(checkPromises);

    const overallLevel = this.computeOverallHealth(results);
    const healthyCount = Object.values(results).filter(c => c.level === 'healthy').length;
    const totalCount = Object.keys(results).length;

    return {
      status: overallLevel,
      components: results,
      timestamp: Date.now(),
      summary: `${healthyCount}/${totalCount} components healthy`,
    };
  }

  // NOTE: This is the public overload. It accepts only a name string and looks up
  // the config internally. The private overload below accepts (name, config) and
  // is used internally for direct execution with a known config.
  async checkComponent(name: string): Promise<ComponentHealth> {
    const config = this.checks.get(name);
    if (!config) {
      return this.componentHealth.get(name) ?? {
        name,
        type: 'liveness',
        level: 'unknown',
        lastCheck: null,
        lastResult: null,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      };
    }
    return this.checkComponent(name, config);
  }

  getComponentHealth(name: string): ComponentHealth {
    return this.componentHealth.get(name) ?? {
      name,
      type: 'liveness',
      level: 'unknown',
      lastCheck: null,
      lastResult: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    };
  }

  addDependencyGroup(name: string, components: string[], logic: 'and' | 'or'): void {
    this.dependencyGroups.push({ name, components, logic });
  }

  onHealthChange(callback: HealthChangeCallback): void {
    this.changeCallbacks.push(callback);
  }

  removeCheck(name: string): void {
    this.checks.delete(name);
    this.componentHealth.delete(name);
    const interval = this.intervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(name);
    }
  }

  stopAll(): void {
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals.clear();
  }

  private async checkComponent(name: string, config: HealthCheckConfig): Promise<ComponentHealth> {
    const health = this.componentHealth.get(name)!;
    const oldLevel = health.level;

    try {
      const result = await this.executeWithTimeout(config.checkFn, config.timeout);
      health.lastResult = result;
      health.lastCheck = Date.now();
      health.consecutiveSuccesses++;
      health.consecutiveFailures = 0;
      health.level = result.level ?? (result.healthy ? 'healthy' : 'unhealthy');
    } catch (error) {
      health.lastCheck = Date.now();
      health.consecutiveFailures++;
      health.consecutiveSuccesses = 0;
      health.level = 'unhealthy';
      health.lastResult = {
        healthy: false,
        level: 'unhealthy',
        message: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
    }

    if (oldLevel !== health.level) {
      this.changeCallbacks.forEach(cb => cb(name, oldLevel, health.level));
    }

    return { ...health };
  }

  private async executeWithTimeout(fn: HealthCheckFn, timeout?: number): Promise<HealthCheckResult> {
    if (!timeout) return fn();
    let timerId: ReturnType<typeof setTimeout>;
    return Promise.race([
      fn(),
      new Promise<HealthCheckResult>((_, reject) => {
        timerId = setTimeout(() => reject(new Error(`Health check timed out after ${timeout}ms`)), timeout);
      }),
    ]).finally(() => {
      clearTimeout(timerId);
    });
  }

  private computeOverallHealth(components: Record<string, ComponentHealth>): HealthLevel {
    const levels = Object.values(components).map(c => c.level);
    if (levels.length === 0) return 'unknown';
    if (levels.some(l => l === 'unhealthy')) return 'unhealthy';
    if (levels.some(l => l === 'degraded')) return 'degraded';
    if (levels.some(l => l === 'unknown')) return 'unknown';
    return 'healthy';
  }

  private startPeriodicCheck(name: string, interval: number): void {
    const id = setInterval(() => {
      const config = this.checks.get(name);
      if (config) {
        this.checkComponent(name, config).catch(() => {});
      }
    }, interval);
    this.intervals.set(name, id);
  }
}
