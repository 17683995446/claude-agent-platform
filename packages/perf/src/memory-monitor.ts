// ============================================================================
// @claude-agent/perf - MemoryMonitor
// 实时内存使用追踪、泄漏检测、GC 触发建议、内存快照对比
// ============================================================================

export interface MemorySnapshot {
  timestamp: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
}

export interface MemoryLeakWarning {
  /** 检测时间 */
  timestamp: number;
  /** 增长率（字节/秒） */
  growthRate: number;
  /** 增长率（MB/分钟） */
  growthRateMBPerMin: number;
  /** 检测期间的内存增长量（字节） */
  growthBytes: number;
  /** 检测期间时长（ms） */
  durationMs: number;
  /** 严重程度 */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** 建议 */
  suggestion: string;
}

export interface MemoryMonitorOptions {
  /** 采样间隔（ms） */
  sampleInterval?: number;
  /** 泄漏检测窗口大小（采样数） */
  leakDetectionWindow?: number;
  /** 低泄漏增长率阈值（字节/秒） */
  leakThresholdLow?: number;
  /** 中泄漏增长率阈值（字节/秒） */
  leakThresholdMedium?: number;
  /** 高泄漏增长率阈值（字节/秒） */
  leakThresholdHigh?: number;
  /** 最大快照保留数 */
  maxSnapshots?: number;
  /** GC 触发阈值（堆使用率） */
  gcTriggerThreshold?: number;
  /** 是否自动触发 GC（如果可用） */
  autoGC?: boolean;
}

export interface MemoryMonitorStats {
  current: MemorySnapshot;
  peak: MemorySnapshot;
  snapshots: MemorySnapshot[];
  leakWarnings: MemoryLeakWarning[];
  gcTriggeredCount: number;
  sampleCount: number;
  uptime: number;
}

export class MemoryMonitor {
  private snapshots: MemorySnapshot[] = [];
  private leakWarnings: MemoryLeakWarning[] = [];
  private peakSnapshot: MemorySnapshot | null = null;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private gcTriggeredCount = 0;
  private sampleCount = 0;
  private startTime: number;
  private options: Required<MemoryMonitorOptions>;
  private onLeakWarning: ((warning: MemoryLeakWarning) => void) | null = null;

  constructor(options?: MemoryMonitorOptions) {
    this.startTime = Date.now();
    this.options = {
      sampleInterval: options?.sampleInterval ?? 5_000,
      leakDetectionWindow: options?.leakDetectionWindow ?? 12,
      leakThresholdLow: options?.leakThresholdLow ?? 10_240, // 10 KB/s
      leakThresholdMedium: options?.leakThresholdMedium ?? 102_400, // 100 KB/s
      leakThresholdHigh: options?.leakThresholdHigh ?? 1_048_576, // 1 MB/s
      maxSnapshots: options?.maxSnapshots ?? 1000,
      gcTriggerThreshold: options?.gcTriggerThreshold ?? 0.85,
      autoGC: options?.autoGC ?? false,
    };

    // Take initial snapshot
    this.takeSnapshot();
  }

  /** 启动监控 */
  start(): void {
    if (this.sampleTimer) return;
    this.sampleTimer = setInterval(() => {
      this.takeSnapshot();
      this.detectLeaks();
      this.checkGCTrigger();
    }, this.options.sampleInterval);
  }

  /** 停止监控 */
  stop(): void {
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
  }

  /** 设置泄漏警告回调 */
  setLeakWarningCallback(callback: (warning: MemoryLeakWarning) => void): void {
    this.onLeakWarning = callback;
  }

  /** 手动采集快照 */
  takeSnapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    };

    this.snapshots.push(snapshot);
    this.sampleCount++;

    // Update peak
    if (!this.peakSnapshot || snapshot.heapUsed > this.peakSnapshot.heapUsed) {
      this.peakSnapshot = snapshot;
    }

    // Trim old snapshots
    while (this.snapshots.length > this.options.maxSnapshots) {
      this.snapshots.shift();
    }

    return snapshot;
  }

  /** 获取当前内存快照 */
  getCurrentSnapshot(): MemorySnapshot {
    return this.takeSnapshot();
  }

  /** 对比两个快照 */
  compareSnapshots(before: MemorySnapshot, after: MemorySnapshot): {
    heapUsedDelta: number;
    heapTotalDelta: number;
    rssDelta: number;
    externalDelta: number;
    heapUsedDeltaMB: number;
  } {
    return {
      heapUsedDelta: after.heapUsed - before.heapUsed,
      heapTotalDelta: after.heapTotal - before.heapTotal,
      rssDelta: after.rss - before.rss,
      externalDelta: after.external - before.external,
      heapUsedDeltaMB: Math.round(((after.heapUsed - before.heapUsed) / 1024 / 1024) * 100) / 100,
    };
  }

  /** 检测内存泄漏 */
  detectLeaks(): MemoryLeakWarning[] {
    const window = this.options.leakDetectionWindow;
    if (this.snapshots.length < window) return [];

    const recentSnapshots = this.snapshots.slice(-window);
    const oldest = recentSnapshots[0]!;
    const newest = recentSnapshots[recentSnapshots.length - 1]!;

    const durationMs = newest.timestamp - oldest.timestamp;
    if (durationMs <= 0) return [];

    const growthBytes = newest.heapUsed - oldest.heapUsed;
    const growthRate = (growthBytes / durationMs) * 1000; // bytes per second
    const growthRateMBPerMin = Math.round((growthRate * 60) / 1024 / 1024 * 100) / 100;

    // Only report if growth is positive
    if (growthRate <= this.options.leakThresholdLow) return [];

    let severity: MemoryLeakWarning['severity'];
    let suggestion: string;

    if (growthRate > this.options.leakThresholdHigh) {
      severity = 'critical';
      suggestion = 'Critical memory leak detected! Immediate investigation required. Consider taking a heap snapshot.';
    } else if (growthRate > this.options.leakThresholdMedium) {
      severity = 'high';
      suggestion = 'Significant memory growth detected. Review recent code changes for potential leaks.';
    } else {
      severity = 'medium';
      suggestion = 'Moderate memory growth detected. Monitor for sustained growth patterns.';
    }

    const warning: MemoryLeakWarning = {
      timestamp: Date.now(),
      growthRate,
      growthRateMBPerMin,
      growthBytes,
      durationMs,
      severity,
      suggestion,
    };

    this.leakWarnings.push(warning);
    this.onLeakWarning?.(warning);

    return [warning];
  }

  /** 检查是否需要触发 GC */
  checkGCTrigger(): boolean {
    const current = this.takeSnapshot();
    const usageRatio = current.heapUsed / current.heapTotal;

    if (usageRatio > this.options.gcTriggerThreshold) {
      if (this.options.autoGC && global.gc) {
        global.gc();
        this.gcTriggeredCount++;
        return true;
      }
      return true; // Should trigger GC but autoGC is off
    }

    return false;
  }

  /** 获取统计信息 */
  getStats(): MemoryMonitorStats {
    const current = this.snapshots[this.snapshots.length - 1] ?? this.takeSnapshot();
    return {
      current,
      peak: this.peakSnapshot ?? current,
      snapshots: [...this.snapshots],
      leakWarnings: [...this.leakWarnings],
      gcTriggeredCount: this.gcTriggeredCount,
      sampleCount: this.sampleCount,
      uptime: Date.now() - this.startTime,
    };
  }

  /** 获取内存使用摘要 */
  getSummary(): {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    heapUsagePercent: number;
    leakWarnings: number;
    gcTriggered: number;
  } {
    const current = this.snapshots[this.snapshots.length - 1] ?? this.takeSnapshot();
    return {
      heapUsedMB: current.heapUsedMB,
      heapTotalMB: current.heapTotalMB,
      rssMB: current.rssMB,
      heapUsagePercent: Math.round((current.heapUsed / current.heapTotal) * 10000) / 100,
      leakWarnings: this.leakWarnings.length,
      gcTriggered: this.gcTriggeredCount,
    };
  }

  /** 清除历史数据 */
  clear(): void {
    this.snapshots.length = 0;
    this.leakWarnings.length = 0;
    this.peakSnapshot = null;
    this.sampleCount = 0;
  }

  /** 销毁监控器 */
  dispose(): void {
    this.stop();
    this.clear();
  }
}
