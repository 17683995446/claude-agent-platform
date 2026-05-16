// src/data-cleansing.ts - Data Cleansing Module
// Data quality improvement: null handling, deduplication, outlier detection, normalization

export interface DataRecord {
  [key: string]: unknown;
}

export type NullHandlingStrategy = 'fill_default' | 'drop' | 'interpolate';

export type OutlierMethod = 'iqr' | 'zscore';

export type NormalizationMethod = 'min-max' | 'z-score' | 'decimal-scaling';

export interface CleansingRule {
  field: string;
  type: 'null_handling' | 'deduplication' | 'outlier_detection' | 'normalization' | 'standardization' | 'type_coercion';
  strategy?: NullHandlingStrategy;
  defaultValue?: unknown;
  method?: OutlierMethod | NormalizationMethod | string;
  threshold?: number;
  format?: string;
  similarityThreshold?: number;
}

export interface OutlierResult {
  values: number[];
  indices: number[];
  method: OutlierMethod;
}

export class DataCleanser {
  /**
   * Cleanse data based on rules
   */
  cleanse(data: DataRecord[], rules: CleansingRule[]): DataRecord[] {
    let result = [...data];

    for (const rule of rules) {
      switch (rule.type) {
        case 'null_handling':
          result = this.handleNulls(result, rule);
          break;
        case 'deduplication':
          result = this.deduplicate(result, rule.field, rule.similarityThreshold);
          break;
        case 'outlier_detection':
          result = this.removeOutliers(result, rule.field, rule.method as OutlierMethod, rule.threshold);
          break;
        case 'normalization':
          result = this.normalizeField(result, rule.field, rule.method as NormalizationMethod);
          break;
        case 'standardization':
          result = this.standardizeField(result, rule.field, rule.method as string);
          break;
        case 'type_coercion':
          result = this.coerceType(result, rule.field, rule.format);
          break;
      }
    }

    return result;
  }

  /**
   * Detect outliers in numeric data
   */
  detectOutliers(data: number[], method: OutlierMethod, threshold: number = 1.5): OutlierResult {
    if (data.length === 0) return { values: [], indices: [], method };

    if (method === 'iqr') {
      return this.iqrOutliers(data, threshold);
    } else {
      return this.zscoreOutliers(data, threshold);
    }
  }

  /**
   * Deduplicate records by key
   */
  deduplicate(data: DataRecord[], key: string, similarityThreshold?: number): DataRecord[] {
    if (similarityThreshold !== undefined && similarityThreshold < 1) {
      return this.fuzzyDeduplicate(data, key, similarityThreshold);
    }

    const seen = new Set<string>();
    return data.filter(record => {
      const value = String(record[key] ?? '');
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  /**
   * Normalize numeric data
   */
  normalize(values: number[], method: NormalizationMethod): number[] {
    if (values.length === 0) return [];

    switch (method) {
      case 'min-max': {
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min;
        if (range === 0) return values.map(() => 0.5);
        return values.map(v => (v - min) / range);
      }
      case 'z-score': {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const std = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length);
        if (std === 0) return values.map(() => 0);
        return values.map(v => (v - mean) / std);
      }
      case 'decimal-scaling': {
        const maxAbs = Math.max(...values.map(Math.abs));
        if (maxAbs === 0) return values;
        const digits = Math.ceil(Math.log10(maxAbs + 1));
        const factor = Math.pow(10, digits);
        return values.map(v => v / factor);
      }
      default:
        return values;
    }
  }

  // --- Private methods ---

  private handleNulls(data: DataRecord[], rule: CleansingRule): DataRecord[] {
    const strategy = rule.strategy ?? 'fill_default';
    const defaultValue = rule.defaultValue;

    if (strategy === 'drop') {
      return data.filter(record => record[rule.field] != null);
    }

    if (strategy === 'interpolate') {
      const numericValues = data
        .map((r, i) => ({ value: Number(r[rule.field]), index: i }))
        .filter(item => !isNaN(item.value));

      if (numericValues.length < 2) return data;

      return data.map((record, index) => {
        if (record[rule.field] != null) return record;

        // Find surrounding numeric values
        let prev = numericValues.filter(item => item.index < index).pop();
        let next = numericValues.find(item => item.index > index);

        if (prev && next) {
          const ratio = (index - prev.index) / (next.index - prev.index);
          const interpolated = prev.value + ratio * (next.value - prev.value);
          return { ...record, [rule.field]: interpolated };
        }

        return record;
      });
    }

    // fill_default
    return data.map(record => ({
      ...record,
      [rule.field]: record[rule.field] ?? defaultValue ?? null,
    }));
  }

  private removeOutliers(data: DataRecord[], field: string, method: OutlierMethod, threshold?: number): DataRecord[] {
    const values = data.map(r => Number(r[field])).filter(n => !isNaN(n));
    const outliers = this.detectOutliers(values, method, threshold);

    const outlierSet = new Set(outliers.indices);
    return data.filter((_, i) => !outlierSet.has(i));
  }

  private normalizeField(data: DataRecord[], field: string, method: NormalizationMethod): DataRecord[] {
    const values = data.map(r => Number(r[field])).filter(n => !isNaN(n));
    const normalized = this.normalize(values, method);

    let normIdx = 0;
    return data.map(record => {
      const numVal = Number(record[field]);
      if (!isNaN(numVal)) {
        return { ...record, [field]: normalized[normIdx++] };
      }
      return record;
    });
  }

  private standardizeField(data: DataRecord[], field: string, method: string): DataRecord[] {
    return data.map(record => {
      const value = record[field];
      if (value == null) return record;

      switch (method) {
        case 'trim':
          return { ...record, [field]: typeof value === 'string' ? value.trim() : value };
        case 'lowercase':
          return { ...record, [field]: typeof value === 'string' ? value.toLowerCase() : value };
        case 'uppercase':
          return { ...record, [field]: typeof value === 'string' ? value.toUpperCase() : value };
        default:
          return record;
      }
    });
  }

  private coerceType(data: DataRecord[], field: string, format?: string): DataRecord[] {
    return data.map(record => {
      const value = record[field];
      if (value == null) return record;

      let coerced: unknown;
      switch (format) {
        case 'number':
          coerced = Number(value);
          break;
        case 'string':
          coerced = String(value);
          break;
        case 'boolean':
          coerced = Boolean(value);
          break;
        case 'date':
          coerced = value instanceof Date ? value : new Date(value as string | number);
          break;
        default:
          // Auto-detect
          if (typeof value === 'string' && !isNaN(Number(value))) {
            coerced = Number(value);
          } else {
            coerced = value;
          }
      }

      return { ...record, [field]: coerced };
    });
  }

  private iqrOutliers(data: number[], threshold: number): OutlierResult {
    const sorted = [...data].sort((a, b) => a - b);
    const q1 = this.percentile(sorted, 25);
    const q3 = this.percentile(sorted, 75);
    const iqr = q3 - q1;
    const lower = q1 - threshold * iqr;
    const upper = q3 + threshold * iqr;

    const indices: number[] = [];
    const values: number[] = [];

    for (let i = 0; i < data.length; i++) {
      if (data[i] < lower || data[i] > upper) {
        indices.push(i);
        values.push(data[i]);
      }
    }

    return { values, indices, method: 'iqr' };
  }

  private zscoreOutliers(data: number[], threshold: number): OutlierResult {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const std = Math.sqrt(data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / data.length);

    if (std === 0) return { values: [], indices: [], method: 'zscore' };

    const indices: number[] = [];
    const values: number[] = [];

    for (let i = 0; i < data.length; i++) {
      const zscore = Math.abs((data[i] - mean) / std);
      if (zscore > threshold) {
        indices.push(i);
        values.push(data[i]);
      }
    }

    return { values, indices, method: 'zscore' };
  }

  private percentile(sorted: number[], p: number): number {
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  private fuzzyDeduplicate(data: DataRecord[], key: string, threshold: number): DataRecord[] {
    const result: DataRecord[] = [];

    for (const record of data) {
      const value = String(record[key] ?? '');
      const isDuplicate = result.some(existing => {
        const existingValue = String(existing[key] ?? '');
        return stringSimilarity(value, existingValue) >= threshold;
      });

      if (!isDuplicate) {
        result.push(record);
      }
    }

    return result;
  }
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) matrix[i] = [i];
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return 1 - matrix[a.length][b.length] / Math.max(a.length, b.length);
}
