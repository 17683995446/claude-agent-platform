// aggregation-operator.ts - Stream aggregation functions

export class AggregationOperator<T> {
  private data: T[] = [];

  add(event: T): void {
    this.data.push(event);
  }

  reset(): void {
    this.data = [];
  }

  count(): number {
    return this.data.length;
  }

  sum(fn: (e: T) => number): number {
    return this.data.reduce((acc, e) => acc + fn(e), 0);
  }

  avg(fn: (e: T) => number): number {
    if (this.data.length === 0) return 0;
    return this.sum(fn) / this.data.length;
  }

  min(fn: (e: T) => number): number {
    if (this.data.length === 0) return 0;
    return Math.min(...this.data.map(fn));
  }

  max(fn: (e: T) => number): number {
    if (this.data.length === 0) return 0;
    return Math.max(...this.data.map(fn));
  }

  groupBy<K>(fn: (e: T) => K): Map<K, T[]> {
    const result = new Map<K, T[]>();
    for (const item of this.data) {
      const key = fn(item);
      const group = result.get(key);
      if (group) {
        group.push(item);
      } else {
        result.set(key, [item]);
      }
    }
    return result;
  }

  distinct(fn?: (e: T) => string): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const item of this.data) {
      const key = fn ? fn(item) : JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
    return result;
  }

  topN(n: number, fn: (e: T) => number): T[] {
    return [...this.data].sort((a, b) => fn(b) - fn(a)).slice(0, n);
  }

  percentile(p: number, fn: (e: T) => number): number {
    if (this.data.length === 0) return 0;
    const sorted = [...this.data].map(fn).sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower]!;
    return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
  }

  histogram(fn: (e: T) => number, bins: number): Array<{ min: number; max: number; count: number }> {
    if (this.data.length === 0) return [];
    const values = this.data.map(fn);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    if (minVal === maxVal) {
      return [{ min: minVal, max: maxVal, count: values.length }];
    }
    const binWidth = (maxVal - minVal) / bins;
    const result: Array<{ min: number; max: number; count: number }> = [];

    for (let i = 0; i < bins; i++) {
      result.push({
        min: minVal + i * binWidth,
        max: minVal + (i + 1) * binWidth,
        count: 0,
      });
    }

    for (const val of values) {
      let binIndex = Math.floor((val - minVal) / binWidth);
      if (binIndex >= bins) binIndex = bins - 1;
      result[binIndex]!.count++;
    }

    return result;
  }
}
