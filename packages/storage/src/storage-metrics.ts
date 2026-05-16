// src/storage-metrics.ts - 存储性能指标

/**
 * 延迟统计
 */
export interface LatencyStats {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  count: number;
}

/**
 * 操作指标
 */
export interface OperationMetrics {
  count: number;
  successCount: number;
  errorCount: number;
  errorRate: number;
  throughput: number; // ops/sec
  latency: LatencyStats;
}

/**
 * 存储指标报告
 */
export interface StorageMetricsReport {
  operations: Record<string, OperationMetrics>;
  cacheHitRate: number;
  cacheMissRate: number;
  totalSize: number;
  totalKeys: number;
  uptime: number;
  timestamp: number;
}

/**
 * 存储性能指标监控
 * - 操作延迟跟踪（p50, p95, p99）
 * - 吞吐量测量
 * - 缓存命中率
 * - 存储大小跟踪
 * - 错误率监控
 * - Prometheus 格式导出
 */
export class StorageMetrics {
  private operationTimings = new Map<string, number[]>();
  private operationCounts = new Map<string, { success: number; error: number }>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private sizeHistory: Array<{ timestamp: number; size: number }> = [];
  private startTime = Date.now();
  private windowStart = Date.now();
  private windowOps = 0;

  /**
   * 记录一次操作
   */
  recordOperation(operation: string, duration: number, success: boolean): void {
    // 延迟记录
    if (!this.operationTimings.has(operation)) {
      this.operationTimings.set(operation, []);
    }
    const timings = this.operationTimings.get(operation)!;
    timings.push(duration);
    // 保留最近 10000 条记录
    if (timings.length > 10000) {
      timings.splice(0, timings.length - 10000);
    }

    // 计数记录
    if (!this.operationCounts.has(operation)) {
      this.operationCounts.set(operation, { success: 0, error: 0 });
    }
    const counts = this.operationCounts.get(operation)!;
    if (success) {
      counts.success++;
    } else {
      counts.error++;
    }

    // 吞吐量窗口
    this.windowOps++;
  }

  /**
   * 记录缓存命中
   */
  recordCacheHit(): void {
    this.cacheHits++;
  }

  /**
   * 记录缓存未命中
   */
  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /**
   * 记录存储大小
   */
  recordSize(size: number): void {
    this.sizeHistory.push({ timestamp: Date.now(), size });
    if (this.sizeHistory.length > 1000) {
      this.sizeHistory.splice(0, this.sizeHistory.length - 1000);
    }
  }

  /**
   * 获取操作延迟统计
   */
  getLatencyStats(operation: string): LatencyStats {
    const timings = this.operationTimings.get(operation);
    if (!timings || timings.length === 0) {
      return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0, count: 0 };
    }

    const sorted = [...timings].sort((a, b) => a - b);
    const count = sorted.length;

    return {
      p50: sorted[Math.floor(count * 0.5)] ?? 0,
      p95: sorted[Math.floor(count * 0.95)] ?? 0,
      p99: sorted[Math.floor(count * 0.99)] ?? 0,
      avg: sorted.reduce((a, b) => a + b, 0) / count,
      min: sorted[0],
      max: sorted[count - 1],
      count,
    };
  }

  /**
   * 获取完整指标报告
   */
  getMetrics(): StorageMetricsReport {
    const now = Date.now();
    const windowDuration = (now - this.windowStart) / 1000;
    const throughput = windowDuration > 0 ? this.windowOps / windowDuration : 0;

    // 重置吞吐量窗口
    this.windowStart = now;
    this.windowOps = 0;

    const operations: Record<string, OperationMetrics> = {};
    for (const [op, counts] of this.operationCounts) {
      const total = counts.success + counts.error;
      operations[op] = {
        count: total,
        successCount: counts.success,
        errorCount: counts.error,
        errorRate: total > 0 ? counts.error / total : 0,
        throughput,
        latency: this.getLatencyStats(op),
      };
    }

    const totalCache = this.cacheHits + this.cacheMisses;
    const currentSize = this.sizeHistory.length > 0
      ? this.sizeHistory[this.sizeHistory.length - 1].size
      : 0;

    return {
      operations,
      cacheHitRate: totalCache > 0 ? this.cacheHits / totalCache : 0,
      cacheMissRate: totalCache > 0 ? this.cacheMisses / totalCache : 0,
      totalSize: currentSize,
      totalKeys: 0,
      uptime: (now - this.startTime) / 1000,
      timestamp: now,
    };
  }

  /**
   * 导出 Prometheus 格式指标
   */
  exportPrometheus(): string {
    const metrics = this.getMetrics();
    const lines: string[] = [];

    lines.push('# HELP storage_cache_hit_rate Cache hit rate');
    lines.push('# TYPE storage_cache_hit_rate gauge');
    lines.push(`storage_cache_hit_rate ${metrics.cacheHitRate}`);

    lines.push('# HELP storage_cache_miss_rate Cache miss rate');
    lines.push('# TYPE storage_cache_miss_rate gauge');
    lines.push(`storage_cache_miss_rate ${metrics.cacheMissRate}`);

    lines.push('# HELP storage_total_size Total storage size in bytes');
    lines.push('# TYPE storage_total_size gauge');
    lines.push(`storage_total_size ${metrics.totalSize}`);

    lines.push('# HELP storage_uptime_seconds Storage uptime in seconds');
    lines.push('# TYPE storage_uptime_seconds gauge');
    lines.push(`storage_uptime_seconds ${metrics.uptime}`);

    for (const [op, opMetrics] of Object.entries(metrics.operations)) {
      const safeOp = op.replace(/[^a-zA-Z0-9_]/g, '_');

      lines.push(`# HELP storage_operation_count_total Total count for ${op}`);
      lines.push('# TYPE storage_operation_count_total counter');
      lines.push(`storage_operation_count_total{operation="${safeOp}"} ${opMetrics.count}`);

      lines.push(`# HELP storage_operation_error_total Error count for ${op}`);
      lines.push('# TYPE storage_operation_error_total counter');
      lines.push(`storage_operation_error_total{operation="${safeOp}"} ${opMetrics.errorCount}`);

      lines.push(`# HELP storage_operation_duration_seconds Duration stats for ${op}`);
      lines.push('# TYPE storage_operation_duration_seconds summary');
      lines.push(`storage_operation_duration_seconds{operation="${safeOp}",quantile="0.5"} ${opMetrics.latency.p50 / 1000}`);
      lines.push(`storage_operation_duration_seconds{operation="${safeOp}",quantile="0.95"} ${opMetrics.latency.p95 / 1000}`);
      lines.push(`storage_operation_duration_seconds{operation="${safeOp}",quantile="0.99"} ${opMetrics.latency.p99 / 1000}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * 重置所有指标
   */
  reset(): void {
    this.operationTimings.clear();
    this.operationCounts.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.sizeHistory = [];
    this.startTime = Date.now();
    this.windowStart = Date.now();
    this.windowOps = 0;
  }
}
