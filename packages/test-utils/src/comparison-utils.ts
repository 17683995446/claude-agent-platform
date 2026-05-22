// ComparisonUtils: Deep comparison and diffing

export interface DiffResult {
  type: 'equal' | 'added' | 'removed' | 'changed';
  path: string;
  actual?: unknown;
  expected?: unknown;
  children?: DiffResult[];
}

export function deepDiff(actual: unknown, expected: unknown, path: string = ''): DiffResult[] {
  const results: DiffResult[] = [];

  if (actual === expected) {
    results.push({ type: 'equal', path: path || 'root' });
    return results;
  }

  if (actual === null || expected === null) {
    if (actual !== expected) {
      results.push({ type: 'changed', path: path || 'root', actual, expected });
    }
    return results;
  }

  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) {
      results.push({
        type: 'changed',
        path: path || 'root',
        actual: `array[${actual.length}]`,
        expected: `array[${expected.length}]`,
      });
    }
    const maxLen = Math.max(actual.length, expected.length);
    for (let i = 0; i < maxLen; i++) {
      const currentPath = `${path || 'root'}[${i}]`;
      if (i >= actual.length) {
        results.push({ type: 'added', path: currentPath, expected: expected[i] });
      } else if (i >= expected.length) {
        results.push({ type: 'removed', path: currentPath, actual: actual[i] });
      } else {
        results.push(...deepDiff(actual[i], expected[i], currentPath));
      }
    }
    return results;
  }

  // BUG-003 [MEDIUM] Array vs plain object comparison was not handled.
  // If one is an array and the other is a plain object, both pass typeof === 'object'
  // but should be reported as a type change.
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    results.push({ type: 'changed', path: path || 'root', actual, expected });
    return results;
  }

  if (typeof actual === 'object' && typeof expected === 'object') {
    const actualObj = actual as Record<string, unknown>;
    const expectedObj = expected as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(actualObj), ...Object.keys(expectedObj)]);

    for (const key of allKeys) {
      const currentPath = path ? `${path}.${key}` : key;
      if (!(key in actualObj)) {
        results.push({ type: 'added', path: currentPath, expected: expectedObj[key] });
      } else if (!(key in expectedObj)) {
        results.push({ type: 'removed', path: currentPath, actual: actualObj[key] });
      } else {
        results.push(...deepDiff(actualObj[key], expectedObj[key], currentPath));
      }
    }
    return results;
  }

  results.push({ type: 'changed', path: path || 'root', actual, expected });
  return results;
}

export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
  if (obj instanceof RegExp) return new RegExp(obj.source, obj.flags) as unknown as T;
  if (obj instanceof Map) {
    const clone = new Map();
    for (const [k, v] of obj) {
      clone.set(deepClone(k), deepClone(v));
    }
    return clone as unknown as T;
  }
  if (obj instanceof Set) {
    const clone = new Set();
    for (const v of obj) {
      clone.add(deepClone(v));
    }
    return clone as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as unknown as T;
  }

  const cloned = {} as Record<string, unknown>;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    cloned[key] = deepClone((obj as Record<string, unknown>)[key]);
  }
  return cloned as T;
}

export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      ) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }

  return result;
}

export function isEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === null || expected === null) return actual === expected;
  if (typeof actual !== typeof expected) return false;

  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return false;
    return actual.every((val, idx) => isEqual(val, expected[idx]));
  }

  // BUG-004 [MEDIUM] Array vs plain object comparison was not handled.
  // If one is an array and the other is a plain object, both pass typeof === 'object'
  // but they should not be considered equal.
  if (Array.isArray(actual) !== Array.isArray(expected)) return false;

  if (typeof actual === 'object' && typeof expected === 'object') {
    const actualObj = actual as Record<string, unknown>;
    const expectedObj = expected as Record<string, unknown>;
    const actualKeys = Object.keys(actualObj);
    const expectedKeys = Object.keys(expectedObj);

    if (actualKeys.length !== expectedKeys.length) return false;
    return actualKeys.every(
      (key) => key in expectedObj && isEqual(actualObj[key], expectedObj[key]),
    );
  }

  if (typeof actual === 'number' && typeof expected === 'number') {
    return Number.isNaN(actual) && Number.isNaN(expected) ? true : actual === expected;
  }

  return false;
}

export function sortBy<T>(arr: T[], key: keyof T): T[] {
  return [...arr].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    if (aVal === bVal) return 0;
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;
    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
    return 0;
  });
}

export function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const groupKey = String(item[key] ?? 'undefined');
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey]!.push(item);
  }
  return result;
}

export function countBy<T>(arr: T[], key: keyof T): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of arr) {
    const countKey = String(item[key] ?? 'undefined');
    result[countKey] = (result[countKey] ?? 0) + 1;
  }
  return result;
}

export function uniqBy<T>(arr: T[], key: keyof T): T[] {
  const seen = new Set<unknown>();
  const result: T[] = [];
  for (const item of arr) {
    const val = item[key];
    if (!seen.has(val)) {
      seen.add(val);
      result.push(item);
    }
  }
  return result;
}
