// src/data-join.ts - Data Join Module
// Join multiple datasets with various join types and fuzzy matching

export interface DataRecord {
  [key: string]: unknown;
}

export type JoinType = 'inner' | 'left' | 'right' | 'full' | 'cross';

export interface JoinCondition {
  leftKey: string;
  rightKey: string;
}

export interface JoinConfig {
  type: JoinType;
  on?: JoinCondition | JoinCondition[];
  predicate?: (left: DataRecord, right: DataRecord) => boolean;
  leftPrefix?: string;
  rightPrefix?: string;
}

export interface FuzzyJoinConfig {
  leftKey: string;
  rightKey: string;
  threshold: number;
  similarityFn?: (a: string, b: string) => number;
}

export class DataJoiner {
  /**
   * Join two datasets based on configuration
   */
  join(left: DataRecord[], right: DataRecord[], config: JoinConfig): DataRecord[] {
    const { type, leftPrefix = 'left_', rightPrefix = 'right_' } = config;

    if (type === 'cross') {
      return this.crossJoin(left, right, leftPrefix, rightPrefix);
    }

    if (config.predicate) {
      return this.predicateJoin(left, right, type, config.predicate, leftPrefix, rightPrefix);
    }

    if (config.on) {
      const conditions = Array.isArray(config.on) ? config.on : [config.on];
      return this.keyJoin(left, right, type, conditions, leftPrefix, rightPrefix);
    }

    return [];
  }

  /**
   * Left join shorthand
   */
  leftJoin(left: DataRecord[], right: DataRecord[], on: JoinCondition | JoinCondition[]): DataRecord[] {
    return this.join(left, right, { type: 'left', on });
  }

  /**
   * Inner join shorthand
   */
  innerJoin(left: DataRecord[], right: DataRecord[], on: JoinCondition | JoinCondition[]): DataRecord[] {
    return this.join(left, right, { type: 'inner', on });
  }

  /**
   * Fuzzy join with approximate matching
   */
  fuzzyJoin(
    left: DataRecord[],
    right: DataRecord[],
    config: FuzzyJoinConfig
  ): DataRecord[] {
    const { leftKey, rightKey, threshold, similarityFn = defaultSimilarity } = config;
    const results: DataRecord[] = [];

    for (const leftRecord of left) {
      const leftValue = String(leftRecord[leftKey] ?? '');

      for (const rightRecord of right) {
        const rightValue = String(rightRecord[rightKey] ?? '');
        const similarity = similarityFn(leftValue, rightValue);

        if (similarity >= threshold) {
          results.push({
            ...this.prefixKeys(leftRecord, 'left_'),
            ...this.prefixKeys(rightRecord, 'right_'),
            _similarity: similarity,
          });
        }
      }
    }

    return results;
  }

  /**
   * Hash join optimization for large datasets
   */
  hashJoin(
    left: DataRecord[],
    right: DataRecord[],
    leftKey: string,
    rightKey: string,
    type: JoinType = 'inner'
  ): DataRecord[] {
    // Build hash map on the right side
    const hash = new Map<string, DataRecord[]>();
    for (const record of right) {
      const key = String(record[rightKey] ?? '');
      if (!hash.has(key)) hash.set(key, []);
      hash.get(key)!.push(record);
    }

    const results: DataRecord[] = [];
    const matchedRightKeys = new Set<string>();

    for (const leftRecord of left) {
      const key = String(leftRecord[leftKey] ?? '');
      const rightMatches = hash.get(key);

      if (rightMatches && rightMatches.length > 0) {
        matchedRightKeys.add(key);
        for (const rightRecord of rightMatches) {
          results.push({
            ...this.prefixKeys(leftRecord, 'left_'),
            ...this.prefixKeys(rightRecord, 'right_'),
          });
        }
      } else if (type === 'left' || type === 'full') {
        results.push({
          ...this.prefixKeys(leftRecord, 'left_'),
        });
      }
    }

    if (type === 'right' || type === 'full') {
      for (const [key, records] of hash) {
        if (!matchedRightKeys.has(key)) {
          for (const record of records) {
            results.push({
              ...this.prefixKeys(record, 'right_'),
            });
          }
        }
      }
    }

    return results;
  }

  // --- Private methods ---

  private keyJoin(
    left: DataRecord[],
    right: DataRecord[],
    type: JoinType,
    conditions: JoinCondition[],
    leftPrefix: string,
    rightPrefix: string
  ): DataRecord[] {
    // Build hash map on right for first condition
    const primaryCondition = conditions[0];
    const hash = new Map<string, DataRecord[]>();

    for (const record of right) {
      const key = String(record[primaryCondition.rightKey] ?? '');
      if (!hash.has(key)) hash.set(key, []);
      hash.get(key)!.push(record);
    }

    const results: DataRecord[] = [];
    const matchedRightIndices = new Set<number>();

    for (const leftRecord of left) {
      const key = String(leftRecord[primaryCondition.leftKey] ?? '');
      const rightMatches = hash.get(key) ?? [];

      let matched = false;
      for (let i = 0; i < right.length; i++) {
        const rightRecord = right[i];
        if (matchedRightIndices.has(i) && type !== 'inner') continue;

        const allConditionsMet = conditions.every(c =>
          leftRecord[c.leftKey] === rightRecord[c.rightKey]
        );

        if (allConditionsMet && rightMatches.includes(rightRecord)) {
          matchedRightIndices.add(i);
          results.push({
            ...this.prefixKeys(leftRecord, leftPrefix),
            ...this.prefixKeys(rightRecord, rightPrefix),
          });
          matched = true;
        }
      }

      if (!matched && (type === 'left' || type === 'full')) {
        results.push({ ...this.prefixKeys(leftRecord, leftPrefix) });
      }
    }

    if (type === 'right' || type === 'full') {
      for (let i = 0; i < right.length; i++) {
        if (!matchedRightIndices.has(i)) {
          results.push({ ...this.prefixKeys(right[i], rightPrefix) });
        }
      }
    }

    return results;
  }

  private predicateJoin(
    left: DataRecord[],
    right: DataRecord[],
    type: JoinType,
    predicate: (left: DataRecord, right: DataRecord) => boolean,
    leftPrefix: string,
    rightPrefix: string
  ): DataRecord[] {
    const results: DataRecord[] = [];
    const matchedRightIndices = new Set<number>();

    for (const leftRecord of left) {
      let matched = false;
      for (let i = 0; i < right.length; i++) {
        if (matchedRightIndices.has(i) && type !== 'inner') continue;
        if (predicate(leftRecord, right[i])) {
          matchedRightIndices.add(i);
          results.push({
            ...this.prefixKeys(leftRecord, leftPrefix),
            ...this.prefixKeys(right[i], rightPrefix),
          });
          matched = true;
        }
      }
      if (!matched && (type === 'left' || type === 'full')) {
        results.push({ ...this.prefixKeys(leftRecord, leftPrefix) });
      }
    }

    if (type === 'right' || type === 'full') {
      for (let i = 0; i < right.length; i++) {
        if (!matchedRightIndices.has(i)) {
          results.push({ ...this.prefixKeys(right[i], rightPrefix) });
        }
      }
    }

    return results;
  }

  private crossJoin(left: DataRecord[], right: DataRecord[], leftPrefix: string, rightPrefix: string): DataRecord[] {
    const results: DataRecord[] = [];
    for (const leftRecord of left) {
      for (const rightRecord of right) {
        results.push({
          ...this.prefixKeys(leftRecord, leftPrefix),
          ...this.prefixKeys(rightRecord, rightPrefix),
        });
      }
    }
    return results;
  }

  private prefixKeys(record: DataRecord, prefix: string): DataRecord {
    const result: DataRecord = {};
    for (const [key, value] of Object.entries(record)) {
      result[`${prefix}${key}`] = value;
    }
    return result;
  }
}

/**
 * Default string similarity (Levenshtein-based)
 */
function defaultSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

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

  const maxLen = Math.max(a.length, b.length);
  return 1 - matrix[a.length][b.length] / maxLen;
}
