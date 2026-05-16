// src/anomaly-detector.ts - Anomaly Detector Module

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface MetricOptions {
  windowSize?: number;
  thresholdMin?: number;
  thresholdMax?: number;
  zScoreThreshold?: number;
  iqrMultiplier?: number;
  trendSensitivity?: number;
  patternWindowSize?: number;
}

export interface BaselineStats {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  sampleCount: number;
  lastUpdated: number;
}

export interface AnomalyReport {
  metric: string;
  severity: AnomalySeverity;
  type: 'threshold' | 'zscore' | 'iqr' | 'trend' | 'pattern';
  value: number;
  expected: number;
  message: string;
  timestamp: number;
}

interface MetricData {
  name: string;
  options: Required<MetricOptions>;
  values: number[];
  timestamps: number[];
  baseline: BaselineStats | null;
}

export class AnomalyDetector {
  private metrics = new Map<string, MetricData>();
  private anomalyHistory: AnomalyReport[] = [];

  private defaultOptions: Required<MetricOptions> = {
    windowSize: 100,
    thresholdMin: -Infinity,
    thresholdMax: Infinity,
    zScoreThreshold: 3,
    iqrMultiplier: 1.5,
    trendSensitivity: 0.5,
    patternWindowSize: 20,
  };

  registerMetric(name: string, options?: MetricOptions): void {
    const opts = { ...this.defaultOptions, ...options };
    this.metrics.set(name, {
      name,
      options: opts,
      values: [],
      timestamps: [],
      baseline: null,
    });
  }

  record(metric: string, value: number): void {
    const data = this.metrics.get(metric);
    if (!data) {
      this.registerMetric(metric);
    }
    const d = this.metrics.get(metric)!;
    const now = Date.now();
    d.values.push(value);
    d.timestamps.push(now);
    // Trim to window size
    if (d.values.length > d.options.windowSize) {
      d.values = d.values.slice(-d.options.windowSize);
      d.timestamps = d.timestamps.slice(-d.options.windowSize);
    }
  }

  detect(): AnomalyReport[] {
    const reports: AnomalyReport[] = [];
    for (const [, data] of this.metrics) {
      if (data.values.length < 3) continue;
      reports.push(...this.detectThreshold(data));
      reports.push(...this.detectZScore(data));
      reports.push(...this.detectIQR(data));
      reports.push(...this.detectTrend(data));
      reports.push(...this.detectPattern(data));
    }
    this.anomalyHistory.push(...reports);
    return reports;
  }

  isAnomalous(metric: string): boolean {
    const reports = this.detect();
    return reports.some((r) => r.metric === metric);
  }

  getBaseline(metric: string): BaselineStats {
    const data = this.metrics.get(metric);
    if (!data) {
      return {
        mean: 0, stdDev: 0, min: 0, max: 0,
        median: 0, q1: 0, q3: 0, iqr: 0,
        sampleCount: 0, lastUpdated: 0,
      };
    }
    if (!data.baseline) {
      this.updateBaseline(metric);
    }
    return data.baseline!;
  }

  updateBaseline(metric: string): void {
    const data = this.metrics.get(metric);
    if (!data || data.values.length < 2) return;

    const sorted = [...data.values].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((s, v) => s + v, 0) / n;
    const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2
      : sorted[Math.floor(n / 2)]!;
    const q1 = sorted[Math.floor(n * 0.25)]!;
    const q3 = sorted[Math.floor(n * 0.75)]!;

    data.baseline = {
      mean,
      stdDev,
      min: sorted[0]!,
      max: sorted[n - 1]!,
      median,
      q1,
      q3,
      iqr: q3 - q1,
      sampleCount: n,
      lastUpdated: Date.now(),
    };
  }

  getAnomalyHistory(): AnomalyReport[] {
    return [...this.anomalyHistory];
  }

  clearHistory(): void {
    this.anomalyHistory = [];
  }

  getMetrics(): string[] {
    return [...this.metrics.keys()];
  }

  getMetricValues(metric: string): number[] {
    return this.metrics.get(metric)?.values ?? [];
  }

  private detectThreshold(data: MetricData): AnomalyReport[] {
    const reports: AnomalyReport[] = [];
    const latest = data.values[data.values.length - 1]!;
    const { thresholdMin, thresholdMax } = data.options;
    if (latest < thresholdMin) {
      reports.push({
        metric: data.name,
        severity: 'high',
        type: 'threshold',
        value: latest,
        expected: thresholdMin,
        message: `${data.name} value ${latest} below minimum threshold ${thresholdMin}`,
        timestamp: Date.now(),
      });
    }
    if (latest > thresholdMax) {
      reports.push({
        metric: data.name,
        severity: 'high',
        type: 'threshold',
        value: latest,
        expected: thresholdMax,
        message: `${data.name} value ${latest} above maximum threshold ${thresholdMax}`,
        timestamp: Date.now(),
      });
    }
    return reports;
  }

  private detectZScore(data: MetricData): AnomalyReport[] {
    const reports: AnomalyReport[] = [];
    if (!data.baseline) this.updateBaseline(data.name);
    if (!data.baseline || data.baseline.stdDev === 0) return reports;

    const latest = data.values[data.values.length - 1]!;
    const zScore = Math.abs((latest - data.baseline.mean) / data.baseline.stdDev);
    if (zScore > data.options.zScoreThreshold) {
      const severity: AnomalySeverity = zScore > 5 ? 'critical' : zScore > 4 ? 'high' : 'medium';
      reports.push({
        metric: data.name,
        severity,
        type: 'zscore',
        value: latest,
        expected: data.baseline.mean,
        message: `${data.name} z-score ${zScore.toFixed(2)} exceeds threshold ${data.options.zScoreThreshold}`,
        timestamp: Date.now(),
      });
    }
    return reports;
  }

  private detectIQR(data: MetricData): AnomalyReport[] {
    const reports: AnomalyReport[] = [];
    if (!data.baseline) this.updateBaseline(data.name);
    if (!data.baseline || data.baseline.iqr === 0) return reports;

    const latest = data.values[data.values.length - 1]!;
    const lowerBound = data.baseline.q1 - data.options.iqrMultiplier * data.baseline.iqr;
    const upperBound = data.baseline.q3 + data.options.iqrMultiplier * data.baseline.iqr;

    if (latest < lowerBound || latest > upperBound) {
      const severity: AnomalySeverity = 'medium';
      reports.push({
        metric: data.name,
        severity,
        type: 'iqr',
        value: latest,
        expected: data.baseline.median,
        message: `${data.name} value ${latest} outside IQR bounds [${lowerBound.toFixed(2)}, ${upperBound.toFixed(2)}]`,
        timestamp: Date.now(),
      });
    }
    return reports;
  }

  private detectTrend(data: MetricData): AnomalyReport[] {
    const reports: AnomalyReport[] = [];
    if (data.values.length < 5) return reports;

    const recent = data.values.slice(-5);
    const older = data.values.slice(-10, -5);
    if (older.length < 2) return reports;

    const recentMean = recent.reduce((s, v) => s + v, 0) / recent.length;
    const olderMean = older.reduce((s, v) => s + v, 0) / older.length;

    if (olderMean === 0) return reports;
    const change = Math.abs(recentMean - olderMean) / Math.abs(olderMean);

    if (change > data.options.trendSensitivity) {
      const severity: AnomalySeverity = change > 1 ? 'critical' : change > 0.7 ? 'high' : 'medium';
      reports.push({
        metric: data.name,
        severity,
        type: 'trend',
        value: recentMean,
        expected: olderMean,
        message: `${data.name} sudden trend change: ${(change * 100).toFixed(1)}% shift detected`,
        timestamp: Date.now(),
      });
    }
    return reports;
  }

  private detectPattern(data: MetricData): AnomalyReport[] {
    const reports: AnomalyReport[] = [];
    const pws = data.options.patternWindowSize;
    if (data.values.length < pws * 2) return reports;

    const patternWindow = data.values.slice(-pws * 2, -pws);
    const currentWindow = data.values.slice(-pws);
    if (patternWindow.length === 0 || currentWindow.length === 0) return reports;

    const patternMean = patternWindow.reduce((s, v) => s + v, 0) / patternWindow.length;
    const currentMean = currentWindow.reduce((s, v) => s + v, 0) / currentWindow.length;

    if (patternMean === 0) return reports;
    const deviation = Math.abs(currentMean - patternMean) / Math.abs(patternMean);

    if (deviation > 0.5) {
      reports.push({
        metric: data.name,
        severity: 'low',
        type: 'pattern',
        value: currentMean,
        expected: patternMean,
        message: `${data.name} deviates ${(deviation * 100).toFixed(1)}% from established pattern`,
        timestamp: Date.now(),
      });
    }
    return reports;
  }
}
