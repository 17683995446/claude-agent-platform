// ============================================================
// Module 10: Database Health Monitor
// ============================================================

export interface DatabaseHealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  uptime: number;
  connectionPool: ConnectionPoolMetrics;
  queryPerformance: QueryPerformanceMetrics;
  tableMetrics: TableSizeInfo[];
  activeLocks: LockInfo[];
  slowQueries: SlowQuery[];
  recommendations: string[];
}

export interface ConnectionPoolMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  avgAcquireTimeMs: number;
  maxAcquireTimeMs: number;
  connectionErrors: number;
}

export interface QueryPerformanceMetrics {
  totalQueries: number;
  avgDurationMs: number;
  maxDurationMs: number;
  minDurationMs: number;
  errorRate: number;
  errorCount: number;
  queriesPerSecond: number;
  slowQueryCount: number;
  slowQueryThresholdMs: number;
}

export interface TableSizeInfo {
  tableName: string;
  rowCount: number;
  sizeBytes: number;
  indexSizeBytes: number;
  lastVacuumAt?: number;
  growthRate?: number;
}

export interface LockInfo {
  id: string;
  lockType: string;
  tableName: string;
  mode: string;
  granted: boolean;
  waitingPid?: number;
  acquiredAt: number;
  durationMs: number;
}

export interface SlowQuery {
  sql: string;
  params?: unknown[];
  durationMs: number;
  timestamp: number;
  executionPlan?: string;
}

export interface PerformanceMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskIoRead: number;
  diskIoWrite: number;
  networkBytesIn: number;
  networkBytesOut: number;
  cacheHitRatio: number;
  bufferPoolHitRatio: number;
}

export interface HealthCheckConfig {
  slowQueryThresholdMs: number;
  maxConnectionUsage: number;
  maxErrorRate: number;
  maxLockDurationMs: number;
  checkIntervalMs: number;
}

const DEFAULT_HEALTH_CONFIG: HealthCheckConfig = {
  slowQueryThresholdMs: 1000,
  maxConnectionUsage: 0.9,
  maxErrorRate: 0.05,
  maxLockDurationMs: 30000,
  checkIntervalMs: 30000,
};

export class DatabaseHealthMonitor {
  private config: HealthCheckConfig;
  private slowQueries: SlowQuery[] = [];
  private queryDurations: number[] = [];
  private queryErrors = 0;
  private totalQueries = 0;
  private startTime: number;
  private connectionPoolMetrics: ConnectionPoolMetrics;
  private activeLocks: LockInfo[] = [];
  private tableSizes: Map<string, TableSizeInfo> = new Map();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private healthCheckCallbacks: Set<(report: DatabaseHealthReport) => void> = new Set();

  constructor(config?: Partial<HealthCheckConfig>) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
    this.startTime = Date.now();
    this.connectionPoolMetrics = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
      avgAcquireTimeMs: 0,
      maxAcquireTimeMs: 0,
      connectionErrors: 0,
    };
  }

  startMonitoring(): void {
    this.checkTimer = setInterval(() => {
      const report = this.getHealthStatus();
      for (const cb of this.healthCheckCallbacks) {
        cb(report);
      }
    }, this.config.checkIntervalMs);
  }

  stopMonitoring(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  onHealthCheck(callback: (report: DatabaseHealthReport) => void): () => void {
    this.healthCheckCallbacks.add(callback);
    return () => this.healthCheckCallbacks.delete(callback);
  }

  recordQuery(durationMs: number, sql?: string, params?: unknown[]): void {
    this.totalQueries++;
    this.queryDurations.push(durationMs);

    // Keep only last 1000 durations
    if (this.queryDurations.length > 1000) {
      this.queryDurations = this.queryDurations.slice(-1000);
    }

    if (durationMs > this.config.slowQueryThresholdMs) {
      this.slowQueries.push({
        sql: sql ?? '',
        params,
        durationMs,
        timestamp: Date.now(),
      });
      // Keep only last 100 slow queries
      if (this.slowQueries.length > 100) {
        this.slowQueries = this.slowQueries.slice(-100);
      }
    }
  }

  recordError(): void {
    this.queryErrors++;
  }

  updateConnectionPoolMetrics(metrics: Partial<ConnectionPoolMetrics>): void {
    this.connectionPoolMetrics = { ...this.connectionPoolMetrics, ...metrics };
  }

  addLock(lock: LockInfo): void {
    this.activeLocks.push(lock);
  }

  removeLock(lockId: string): void {
    this.activeLocks = this.activeLocks.filter(l => l.id !== lockId);
  }

  updateTableSize(info: TableSizeInfo): void {
    this.tableSizes.set(info.tableName, info);
  }

  getHealthStatus(): DatabaseHealthReport {
    const recommendations: string[] = [];
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Check connection pool
    const connectionUsage = this.connectionPoolMetrics.totalConnections > 0
      ? this.connectionPoolMetrics.activeConnections / this.connectionPoolMetrics.totalConnections
      : 0;

    if (connectionUsage > this.config.maxConnectionUsage) {
      status = 'degraded';
      recommendations.push('Connection pool usage is high. Consider increasing max connections.');
    }

    // Check error rate
    const errorRate = this.totalQueries > 0 ? this.queryErrors / this.totalQueries : 0;
    if (errorRate > this.config.maxErrorRate) {
      status = 'unhealthy';
      recommendations.push('Query error rate exceeds threshold. Investigate failing queries.');
    } else if (errorRate > this.config.maxErrorRate / 2) {
      if (status === 'healthy') status = 'degraded';
      recommendations.push('Query error rate is elevated. Monitor closely.');
    }

    // Check slow queries
    const recentSlowQueries = this.slowQueries.filter(
      q => Date.now() - q.timestamp < 300000,
    );
    if (recentSlowQueries.length > 10) {
      if (status === 'healthy') status = 'degraded';
      recommendations.push('High number of slow queries detected. Review query performance.');
    }

    // Check locks
    const longLocks = this.activeLocks.filter(
      l => l.durationMs > this.config.maxLockDurationMs,
    );
    if (longLocks.length > 0) {
      status = 'unhealthy';
      recommendations.push('Long-running locks detected. Check for deadlocks or blocking queries.');
    }

    const queryPerf = this.calculateQueryPerformance();

    return {
      status,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      connectionPool: { ...this.connectionPoolMetrics },
      queryPerformance: queryPerf,
      tableMetrics: Array.from(this.tableSizes.values()),
      activeLocks: [...this.activeLocks],
      slowQueries: this.getSlowQueries(),
      recommendations,
    };
  }

  getSlowQueries(threshold?: number): SlowQuery[] {
    const ms = threshold ?? this.config.slowQueryThresholdMs;
    return this.slowQueries.filter(q => q.durationMs >= ms);
  }

  getActiveLocks(): LockInfo[] {
    return [...this.activeLocks];
  }

  getTableSizes(): TableSizeInfo[] {
    return Array.from(this.tableSizes.values());
  }

  getPerformanceMetrics(): PerformanceMetrics {
    return {
      cpuUsage: 0,
      memoryUsage: 0,
      diskIoRead: 0,
      diskIoWrite: 0,
      networkBytesIn: 0,
      networkBytesOut: 0,
      cacheHitRatio: this.calculateCacheHitRatio(),
      bufferPoolHitRatio: this.calculateCacheHitRatio(),
    };
  }

  private calculateQueryPerformance(): QueryPerformanceMetrics {
    const durations = this.queryDurations;
    const avg = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    const max = durations.length > 0 ? Math.max(...durations) : 0;
    const min = durations.length > 0 ? Math.min(...durations) : 0;
    const errorRate = this.totalQueries > 0 ? this.queryErrors / this.totalQueries : 0;
    const uptimeSeconds = (Date.now() - this.startTime) / 1000;
    const qps = uptimeSeconds > 0 ? this.totalQueries / uptimeSeconds : 0;

    return {
      totalQueries: this.totalQueries,
      avgDurationMs: Math.round(avg * 100) / 100,
      maxDurationMs: max,
      minDurationMs: min,
      errorRate: Math.round(errorRate * 10000) / 10000,
      errorCount: this.queryErrors,
      queriesPerSecond: Math.round(qps * 100) / 100,
      slowQueryCount: this.slowQueries.length,
      slowQueryThresholdMs: this.config.slowQueryThresholdMs,
    };
  }

  private calculateCacheHitRatio(): number {
    // Placeholder - in real implementation would query database stats
    return 0.95;
  }

  reset(): void {
    this.slowQueries = [];
    this.queryDurations = [];
    this.queryErrors = 0;
    this.totalQueries = 0;
    this.startTime = Date.now();
    this.activeLocks = [];
    this.connectionPoolMetrics = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
      avgAcquireTimeMs: 0,
      maxAcquireTimeMs: 0,
      connectionErrors: 0,
    };
  }

  updateConfig(config: Partial<HealthCheckConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): Readonly<HealthCheckConfig> {
    return this.config;
  }
}
