// FuzzHelpers: Fuzz testing utilities

export interface FuzzResult {
  iterations: number;
  failures: number;
  errors: Array<{ input: unknown; error: string }>;
}

function createRNG(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return (state >>> 0) / 0xffffffff;
  };
}

export function fuzzString(
  fn: (input: string) => unknown,
  iterations: number = 100,
  maxLength: number = 100,
): FuzzResult {
  const result: FuzzResult = { iterations, failures: 0, errors: [] };
  const rng = createRNG(Date.now());
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$%^&*()_+-=[]{}|;:,.<>?/~`\n\t\r\\\'"';

  for (let i = 0; i < iterations; i++) {
    const len = Math.floor(rng() * (maxLength + 1));
    let str = '';
    for (let j = 0; j < len; j++) {
      str += chars[Math.floor(rng() * chars.length)]!;
    }
    try {
      fn(str);
    } catch (err) {
      result.failures++;
      result.errors.push({ input: str, error: String(err) });
    }
  }

  return result;
}

export function fuzzNumber(
  fn: (input: number) => unknown,
  iterations: number = 100,
  min: number = -1e6,
  max: number = 1e6,
): FuzzResult {
  const result: FuzzResult = { iterations, failures: 0, errors: [] };
  const rng = createRNG(Date.now());

  for (let i = 0; i < iterations; i++) {
    const num = min + rng() * (max - min);
    // Also include special values periodically
    let input: number;
    if (i % 10 === 0) input = Infinity;
    else if (i % 10 === 1) input = -Infinity;
    else if (i % 10 === 2) input = NaN;
    else if (i % 10 === 3) input = 0;
    else if (i % 10 === 4) input = Number.MAX_SAFE_INTEGER;
    else if (i % 10 === 5) input = Number.MIN_SAFE_INTEGER;
    else input = num;

    try {
      fn(input);
    } catch (err) {
      result.failures++;
      result.errors.push({ input, error: String(err) });
    }
  }

  return result;
}

export function fuzzObject(
  fn: (input: Record<string, unknown>) => unknown,
  iterations: number = 100,
  depth: number = 3,
): FuzzResult {
  const result: FuzzResult = { iterations, failures: 0, errors: [] };
  const rng = createRNG(Date.now());

  function generateValue(currentDepth: number): unknown {
    if (currentDepth <= 0) {
      const type = Math.floor(rng() * 3);
      if (type === 0) return Math.floor(rng() * 100);
      if (type === 1) return rng() < 0.5;
      return 'str-' + Math.floor(rng() * 100);
    }

    const type = Math.floor(rng() * 5);
    if (type === 0) return Math.floor(rng() * 100);
    if (type === 1) return rng() < 0.5;
    if (type === 2) return 'str-' + Math.floor(rng() * 100);
    if (type === 3) return null;
    return generateObject(currentDepth - 1);
  }

  function generateObject(currentDepth: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    const numKeys = Math.floor(rng() * 5) + 1;
    for (let i = 0; i < numKeys; i++) {
      obj[`key-${i}`] = generateValue(currentDepth);
    }
    return obj;
  }

  for (let i = 0; i < iterations; i++) {
    const obj = generateObject(depth);
    try {
      fn(obj);
    } catch (err) {
      result.failures++;
      result.errors.push({ input: obj, error: String(err) });
    }
  }

  return result;
}

export function fuzzJSON(
  fn: (input: unknown) => unknown,
  iterations: number = 100,
): FuzzResult {
  const result: FuzzResult = { iterations, failures: 0, errors: [] };
  const rng = createRNG(Date.now());

  function generateJSON(currentDepth: number): unknown {
    if (currentDepth <= 0) {
      const type = Math.floor(rng() * 4);
      if (type === 0) return Math.floor(rng() * 100);
      if (type === 1) return rng() < 0.5;
      if (type === 2) return 'str-' + Math.floor(rng() * 100);
      return null;
    }

    const type = Math.floor(rng() * 3);
    if (type === 0) {
      const arr: unknown[] = [];
      const len = Math.floor(rng() * 5);
      for (let i = 0; i < len; i++) {
        arr.push(generateJSON(currentDepth - 1));
      }
      return arr;
    }
    if (type === 1) {
      const obj: Record<string, unknown> = {};
      const numKeys = Math.floor(rng() * 5);
      for (let i = 0; i < numKeys; i++) {
        obj[`key-${i}`] = generateJSON(currentDepth - 1);
      }
      return obj;
    }
    return generateJSON(currentDepth - 1);
  }

  for (let i = 0; i < iterations; i++) {
    const json = generateJSON(3);
    try {
      fn(json);
    } catch (err) {
      result.failures++;
      result.errors.push({ input: json, error: String(err) });
    }
  }

  return result;
}

export function mutateString(input: string): string {
  if (input.length === 0) return 'x';

  const mutations: Array<(s: string) => string> = [
    (s) => s + 'x',
    (s) => s.slice(0, -1),
    (s) => s.toUpperCase(),
    (s) => s.toLowerCase(),
    (s) => s.split('').reverse().join(''),
    (s) => {
      const idx = Math.floor(Math.random() * s.length);
      return s.slice(0, idx) + String.fromCharCode(0) + s.slice(idx);
    },
    (s) => s.repeat(2),
    (s) => {
      const idx = Math.floor(Math.random() * s.length);
      const chars = '!@#$%^&*';
      return s.slice(0, idx) + chars[Math.floor(Math.random() * chars.length)]! + s.slice(idx);
    },
  ];

  const mutation = mutations[Math.floor(Math.random() * mutations.length)]!;
  return mutation(input);
}

export function mutateNumber(input: number): number {
  const mutations: Array<(n: number) => number> = [
    (n) => n + 1,
    (n) => n - 1,
    (n) => n * 2,
    (n) => n / 2,
    (n) => -n,
    (n) => 0,
    (n) => Number.MAX_SAFE_INTEGER,
    (n) => Number.MIN_SAFE_INTEGER,
    (n) => Infinity,
    (n) => -Infinity,
    (n) => NaN,
  ];

  const mutation = mutations[Math.floor(Math.random() * mutations.length)]!;
  return mutation(input);
}

export function mutateJSON(input: unknown): unknown {
  if (input === null) return 'mutated';
  if (typeof input === 'string') return mutateString(input);
  if (typeof input === 'number') return mutateNumber(input);
  if (typeof input === 'boolean') return !input;
  if (Array.isArray(input)) {
    if (input.length === 0) return ['mutated'];
    const idx = Math.floor(Math.random() * input.length);
    const copy = [...input];
    copy[idx] = mutateJSON(copy[idx]);
    return copy;
  }
  if (typeof input === 'object') {
    const obj = { ...input } as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return { mutated: true };
    const key = keys[Math.floor(Math.random() * keys.length)]!;
    obj[key] = mutateJSON(obj[key]);
    return obj;
  }
  return input;
}
