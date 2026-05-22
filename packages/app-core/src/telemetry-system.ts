// ============================================================================
// Module 10: Telemetry System
// ============================================================================

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricRecord {
  name: string;
  type: MetricType;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, HistogramData>;
  summaries: Record<string, SummaryData>;
  timestamp: number;
}

export interface HistogramData {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  buckets: Record<string, number>;
}

export interface SummaryData {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  quantiles: Record<string, number>;
}

export interface SpanContext {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}

export interface Span {
  name: string;
  context: SpanContext;
  startTime: number;
  endTime?: number;
  duration?: number;
  attributes: Record<string, unknown>;
  status: 'ok' | 'error';
  error?: string;
  end(): void;
}

export interface TelemetryDashboard {
  totalMetrics: number;
  activeSpans: number;
  completedSpans: number;
  metricCountByType: Record<MetricType, number>;
  topMetrics: Array<{ name: string; type: MetricType; value: number }>;
}

export class AppTelemetrySystem {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private summaries: Map<string, number[]> = new Map();
  private metricHistory: MetricRecord[] = [];
  private maxHistory: number = 10000;

  private activeSpans: Map<string, Span> = new Map();
  private completedSpans: Span[] = [];
  private maxCompletedSpans: number = 1000;
  private traceCounter: number = 0;
  private spanCounter: number = 0;

  recordMetric(name: string, value: number, type: MetricType = 'counter', labels?: Record<string, string>): void {
    const record: MetricRecord = {
      name,
      type,
      value,
      timestamp: Date.now(),
      labels,
    };
    this.metricHistory.push(record);
    if (this.metricHistory.length > this.maxHistory) {
      this.metricHistory.shift();
    }

    switch (type) {
      case 'counter': {
        const current = this.counters.get(name) ?? 0;
        this.counters.set(name, current + value);
        break;
      }
      case 'gauge': {
        this.gauges.set(name, value);
        break;
      }
      case 'histogram': {
        if (!this.histograms.has(name)) {
          this.histograms.set(name, []);
        }
        this.histograms.get(name)!.push(value);
        break;
      }
      case 'summary': {
        if (!this.summaries.has(name)) {
          this.summaries.set(name, []);
        }
        this.summaries.get(name)!.push(value);
        break;
      }
    }
  }

  startSpan(name: string, context?: SpanContext): Span {
    const traceId = context?.traceId ?? `trace-${++this.traceCounter}`;
    const spanId = `span-${++this.spanCounter}`;
    const parentSpanId = context?.parentSpanId;

    const span: Span = {
      name,
      context: { traceId, spanId, parentSpanId },
      startTime: Date.now(),
      attributes: {},
      status: 'ok',
      end: () => {
        span.endTime = Date.now();
        span.duration = span.endTime - span.startTime;
        this.activeSpans.delete(spanId);
        this.completedSpans.push(span);
        if (this.completedSpans.length > this.maxCompletedSpans) {
          this.completedSpans.shift();
        }
      },
    };

    this.activeSpans.set(spanId, span);
    return span;
  }

  getMetrics(): MetricsSnapshot {
    const histogramData: Record<string, HistogramData> = {};
    for (const [name, values] of this.histograms) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      histogramData[name] = {
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        min: sorted[0]!,
        max: sorted[sorted.length - 1]!,
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        buckets: {
          '0.1': sorted.filter((v) => v <= 0.1).length,
          '1': sorted.filter((v) => v <= 1).length,
          '5': sorted.filter((v) => v <= 5).length,
          '10': sorted.filter((v) => v <= 10).length,
        },
      };
    }

    const summaryData: Record<string, SummaryData> = {};
    for (const [name, values] of this.summaries) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      summaryData[name] = {
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        min: sorted[0]!,
        max: sorted[sorted.length - 1]!,
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        quantiles: {
          '0.5': sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0,
          '0.9': sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0,
          '0.99': sorted[Math.floor((sorted.length - 1) * 0.99)] ?? 0,
        },
      };
    }

    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: histogramData,
      summaries: summaryData,
      timestamp: Date.now(),
    };
  }

  getDashboard(): TelemetryDashboard {
    const metricCountByType: Record<MetricType, number> = {
      counter: this.counters.size,
      gauge: this.gauges.size,
      histogram: this.histograms.size,
      summary: this.summaries.size,
    };

    const topMetrics: Array<{ name: string; type: MetricType; value: number }> = [];
    for (const [name, value] of this.counters) {
      topMetrics.push({ name, type: 'counter', value });
    }
    for (const [name, value] of this.gauges) {
      topMetrics.push({ name, type: 'gauge', value });
    }
    topMetrics.sort((a, b) => b.value - a.value);
    return {
      totalMetrics: this.counters.size + this.gauges.size + this.histograms.size + this.summaries.size,
      activeSpans: this.activeSpans.size,
      completedSpans: this.completedSpans.length,
      metricCountByType,
      topMetrics: topMetrics.slice(0, 10),
    };
  }

  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  getGauge(name: string): number | undefined {
    return this.gauges.get(name);
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.summaries.clear();
    this.metricHistory = [];
    this.activeSpans.clear();
    this.completedSpans = [];
  }

  flush(): MetricRecord[] {
    const records = [...this.metricHistory];
    this.metricHistory = [];
    return records;
  }
}
