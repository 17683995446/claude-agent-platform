// stream-metrics.ts - Collect stream processing metrics

export interface Alert {
  streamId: string;
  type: string;
  message: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high';
}

interface StreamMetricData {
  processingTimes: number[];
  latencies: number[];
  errorCount: number;
  totalProcessed: number;
  throughputCounts: number[];
  throughputWindows: number[];
  lastError: Error | undefined;
}

export class StreamMetrics {
  private streams: Map<string, StreamMetricData> = new Map();
  private alerts: Alert[] = [];

  recordProcessing(streamId: string, durationMs: number, success: boolean): void {
    let data = this.streams.get(streamId);
    if (!data) {
      data = {
        processingTimes: [],
        latencies: [],
        errorCount: 0,
        totalProcessed: 0,
        throughputCounts: [],
        throughputWindows: [],
        lastError: undefined,
      };
      this.streams.set(streamId, data);
    }

    data.processingTimes.push(durationMs);
    data.totalProcessed++;

    if (!success) {
      data.errorCount++;
    }

    // Keep only last 1000 processing times
    if (data.processingTimes.length > 1000) {
      data.processingTimes = data.processingTimes.slice(-1000);
    }
  }

  recordThroughput(streamId: string, count: number, windowMs: number): void {
    let data = this.streams.get(streamId);
    if (!data) {
      data = {
        processingTimes: [],
        latencies: [],
        errorCount: 0,
        totalProcessed: 0,
        throughputCounts: [],
        throughputWindows: [],
        lastError: undefined,
      };
      this.streams.set(streamId, data);
    }

    data.throughputCounts.push(count);
    data.throughputWindows.push(windowMs);

    if (data.throughputCounts.length > 100) {
      data.throughputCounts = data.throughputCounts.slice(-100);
      data.throughputWindows = data.throughputWindows.slice(-100);
    }
  }

  recordLatency(streamId: string, latencyMs: number): void {
    let data = this.streams.get(streamId);
    if (!data) {
      data = {
        processingTimes: [],
        latencies: [],
        errorCount: 0,
        totalProcessed: 0,
        throughputCounts: [],
        throughputWindows: [],
        lastError: undefined,
      };
      this.streams.set(streamId, data);
    }

    data.latencies.push(latencyMs);

    if (data.latencies.length > 1000) {
      data.latencies = data.latencies.slice(-1000);
    }
  }

  recordError(streamId: string, error: Error): void {
    let data = this.streams.get(streamId);
    if (!data) {
      data = {
        processingTimes: [],
        latencies: [],
        errorCount: 0,
        totalProcessed: 0,
        throughputCounts: [],
        throughputWindows: [],
        lastError: undefined,
      };
      this.streams.set(streamId, data);
    }

    data.errorCount++;
    data.lastError = error;

    this.alerts.push({
      streamId,
      type: 'error',
      message: error.message,
      timestamp: Date.now(),
      severity: 'high',
    });

    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }
  }

  getStreamMetrics(streamId: string): {
    throughput: number;
    avgLatency: number;
    p99Latency: number;
    errorRate: number;
    totalProcessed: number;
  } {
    const data = this.streams.get(streamId);
    if (!data) {
      return { throughput: 0, avgLatency: 0, p99Latency: 0, errorRate: 0, totalProcessed: 0 };
    }

    const avgLatency =
      data.latencies.length > 0
        ? data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length
        : 0;

    const sortedLatencies = [...data.latencies].sort((a, b) => a - b);
    const p99Index = Math.floor(sortedLatencies.length * 0.99);
    const p99Latency = sortedLatencies[p99Index] ?? 0;

    const throughput =
      data.throughputCounts.length > 0
        ? data.throughputCounts.reduce((a, b) => a + b, 0) /
          (data.throughputWindows.reduce((a, b) => a + b, 0) / 1000 || 1)
        : 0;

    const errorRate = data.totalProcessed > 0 ? data.errorCount / data.totalProcessed : 0;

    return {
      throughput,
      avgLatency,
      p99Latency,
      errorRate,
      totalProcessed: data.totalProcessed,
    };
  }

  getAllMetrics(): Record<string, object> {
    const result: Record<string, object> = {};
    for (const [streamId] of this.streams) {
      result[streamId] = this.getStreamMetrics(streamId);
    }
    return result;
  }

  getDashboard(): {
    streams: number;
    totalThroughput: number;
    avgErrorRate: number;
    topErrors: Array<{ streamId: string; errorCount: number; lastError: string | undefined }>;
  } {
    let totalThroughput = 0;
    let totalErrorRate = 0;
    let streamCount = 0;
    const topErrors: Array<{ streamId: string; errorCount: number; lastError: string | undefined }> = [];

    for (const [streamId, data] of this.streams) {
      const metrics = this.getStreamMetrics(streamId);
      totalThroughput += metrics.throughput;
      totalErrorRate += metrics.errorRate;
      streamCount++;

      if (data.errorCount > 0) {
        topErrors.push({
          streamId,
          errorCount: data.errorCount,
          lastError: data.lastError?.message,
        });
      }
    }

    topErrors.sort((a, b) => b.errorCount - a.errorCount);

    return {
      streams: streamCount,
      totalThroughput,
      avgErrorRate: streamCount > 0 ? totalErrorRate / streamCount : 0,
      topErrors: topErrors.slice(0, 10),
    };
  }

  getAlerts(): Alert[] {
    return [...this.alerts];
  }

  reset(): void {
    this.streams.clear();
    this.alerts = [];
  }
}
