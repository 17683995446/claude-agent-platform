// src/data-aggregator.ts - Data Aggregator Module
// Multi-source data aggregation with group-by, time-series, and statistical functions

export interface DataPoint {
  [key: string]: unknown;
}

export interface TimeSeriesPoint {
  timestamp: Date | number | string;
  [key: string]: unknown;
}

export type TimeInterval = 'minute' | 'hour' | 'day' | 'week' | 'month';

export interface AggregationConfig {
  groupBy?: string[];
  metrics: Array<{
    field: string;
    fn: AggregationFunctionName;
    as?: string;
  }>;
  having?: Record<string, { min?: number; max?: number }>;
}

export type AggregationFunctionName =
  | 'count' | 'sum' | 'average' | 'min' | 'max'
  | 'median' | 'mode' | 'stddev' | 'percentile';

export interface AggregationResult {
  groups: Array<{ key: Record<string, unknown>; values: DataPoint[]; metrics: Record<string, number> }>;
  total: number;
}

export interface TimeSeriesResult {
  interval: TimeInterval;
  buckets: Array<{
    start: Date;
    end: Date;
    count: number;
    metrics: Record<string, number>;
    data: TimeSeriesPoint[];
  }>;
}

export class DataAggregator {
  /**
   * Aggregate data with group-by and metric functions
   */
  aggregate(data: DataPoint[], config: AggregationConfig): AggregationResult {
    // Group data
    let grouped: Map<string, DataPoint[]>;

    if (config.groupBy && config.groupBy.length > 0) {
      grouped = this.groupByToMap(data, config.groupBy);
    } else {
      grouped = new Map([['__all__', data]]);
    }

    const groups: AggregationResult['groups'] = [];

    for (const [keyStr, values] of grouped) {
      const key = keyStr === '__all__' ? {} : this.parseKey(keyStr, config.groupBy ?? []);
      const metrics: Record<string, number> = {};

      for (const metric of config.metrics) {
        const fieldName = metric.field;
        const numericValues = values
          .map(v => Number(v[fieldName]))
          .filter(n => !isNaN(n));

        const result = this.computeMetric(numericValues, metric.fn, metric.as);
        metrics[metric.as ?? `${metric.fn}_${metric.field}`] = result;
      }

      // Apply having filter
      if (config.having) {
        let pass = true;
        for (const [metricName, condition] of Object.entries(config.having)) {
          const value = metrics[metricName];
          if (condition.min !== undefined && value < condition.min) pass = false;
          if (condition.max !== undefined && value > condition.max) pass = false;
        }
        if (!pass) continue;
      }

      groups.push({ key, values, metrics });
    }

    return { groups, total: data.length };
  }

  /**
   * Group data by keys
   */
  groupBy(data: DataPoint[], keys: string[]): Map<string, DataPoint[]> {
    return this.groupByToMap(data, keys);
  }

  /**
   * Time-series aggregation
   */
  timeSeriesAggregate(data: TimeSeriesPoint[], interval: TimeInterval): TimeSeriesResult {
    const buckets = new Map<string, { start: Date; end: Date; data: TimeSeriesPoint[] }>();

    for (const point of data) {
      const ts = point.timestamp instanceof Date ? point.timestamp : new Date(point.timestamp);
      const bucketKey = this.getBucketKey(ts, interval);
      const { start, end } = this.getBucketRange(ts, interval);

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, { start, end, data: [] });
      }
      buckets.get(bucketKey)!.data.push(point);
    }

    const sortedBuckets = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, bucket]) => ({
        start: bucket.start,
        end: bucket.end,
        count: bucket.data.length,
        metrics: {} as Record<string, number>,
        data: bucket.data,
      }));

    return { interval, buckets: sortedBuckets };
  }

  /**
   * Rollup: aggregate at multiple levels
   */
  rollup(data: DataPoint[], keys: string[], metric: { field: string; fn: AggregationFunctionName }): Array<{ level: string; result: AggregationResult }> {
    const results: Array<{ level: string; result: AggregationResult }> = [];

    for (let i = 1; i <= keys.length; i++) {
      const levelKeys = keys.slice(0, i);
      const result = this.aggregate(data, {
        groupBy: levelKeys,
        metrics: [metric],
      });
      results.push({ level: levelKeys.join(' > '), result });
    }

    return results;
  }

  /**
   * Drill-down: get detailed data for a specific group
   */
  drillDown(data: DataPoint[], groupBy: string[], filter: Record<string, unknown>): DataPoint[] {
    return data.filter(point => {
      return Object.entries(filter).every(([key, value]) => point[key] === value);
    });
  }

  // --- Statistical functions ---

  private computeMetric(values: number[], fn: AggregationFunctionName, alias?: string): number {
    switch (fn) {
      case 'count': return values.length;
      case 'sum': return values.reduce((a, b) => a + b, 0);
      case 'average': return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
      case 'min': return values.length === 0 ? 0 : Math.min(...values);
      case 'max': return values.length === 0 ? 0 : Math.max(...values);
      case 'median': return this.median(values);
      case 'mode': return this.mode(values);
      case 'stddev': return this.stddev(values);
      case 'percentile': return this.percentile(values, 50); // default p50
      default: return 0;
    }
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private mode(values: number[]): number {
    if (values.length === 0) return 0;
    const freq = new Map<number, number>();
    for (const v of values) {
      freq.set(v, (freq.get(v) ?? 0) + 1);
    }
    let maxFreq = 0;
    let modeValue = values[0];
    for (const [value, count] of freq) {
      if (count > maxFreq) {
        maxFreq = count;
        modeValue = value;
      }
    }
    return modeValue;
  }

  private stddev(values: number[]): number {
    if (values.length === 0) return 0;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(v => Math.pow(v - avg, 2));
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  private groupByToMap(data: DataPoint[], keys: string[]): Map<string, DataPoint[]> {
    const groups = new Map<string, DataPoint[]>();
    for (const point of data) {
      const key = keys.map(k => String(point[k] ?? 'null')).join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(point);
    }
    return groups;
  }

  private parseKey(keyStr: string, keys: string[]): Record<string, unknown> {
    const parts = keyStr.split('|');
    const result: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      result[k] = parts[i] === 'null' ? null : parts[i];
    });
    return result;
  }

  private getBucketKey(date: Date, interval: TimeInterval): string {
    switch (interval) {
      case 'minute':
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
      case 'hour':
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
      case 'day':
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      case 'week': {
        const oneJan = new Date(date.getFullYear(), 0, 1);
        const week = Math.ceil(((date.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
        return `${date.getFullYear()}-W${week}`;
      }
      case 'month':
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
  }

  private getBucketRange(date: Date, interval: TimeInterval): { start: Date; end: Date } {
    const start = new Date(date);
    const end = new Date(date);

    switch (interval) {
      case 'minute':
        start.setSeconds(0, 0);
        end.setSeconds(59, 999);
        break;
      case 'hour':
        start.setMinutes(0, 0, 0);
        end.setMinutes(59, 59, 999);
        break;
      case 'day':
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'week':
        start.setDate(date.getDate() - date.getDay());
        start.setHours(0, 0, 0, 0);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;
      case 'month':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(start.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        break;
    }

    return { start, end };
  }
}
