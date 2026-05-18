// PropertyBasedTesting: Property-based test utilities

import type { Arbitrary } from './property-based.js';

export interface Arbitrary<T> {
  generate(rng: () => number): T;
  shrink(value: T): T[];
  name: string;
}

export interface PropertyTestOptions {
  numRuns?: number;
  seed?: number;
  maxShrinks?: number;
}

export interface PropertyTestResult {
  passed: boolean;
  numRuns: number;
  counterexample?: unknown;
  numShrinks?: number;
  error?: string;
}

function createRNG(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) & 0xffffffff;
    return (state >>> 0) / 0xffffffff;
  };
}

export function stringArbitrary(minLen: number = 0, maxLen: number = 20): Arbitrary<string> {
  return {
    name: 'string',
    generate(rng) {
      const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < len; i++) {
        result += chars[Math.floor(rng() * chars.length)]!;
      }
      return result;
    },
    shrink(value) {
      if (value.length === 0) return [];
      const results: string[] = [];
      if (value.length > minLen) {
        results.push(value.slice(0, Math.ceil(value.length / 2)));
        results.push('');
      }
      return results;
    },
  };
}

export function integerArbitrary(min: number = -1000, max: number = 1000): Arbitrary<number> {
  return {
    name: 'integer',
    generate(rng) {
      return min + Math.floor(rng() * (max - min + 1));
    },
    shrink(value) {
      if (value === 0) return [];
      const results: number[] = [0];
      if (value > 0) {
        results.push(Math.floor(value / 2));
      } else {
        results.push(Math.ceil(value / 2));
      }
      return results;
    },
  };
}

export function floatArbitrary(min: number = -1000, max: number = 1000): Arbitrary<number> {
  return {
    name: 'float',
    generate(rng) {
      return min + rng() * (max - min);
    },
    shrink(value) {
      if (value === 0) return [];
      return [0, value / 2];
    },
  };
}

export function booleanArbitrary(): Arbitrary<boolean> {
  return {
    name: 'boolean',
    generate(rng) {
      return rng() < 0.5;
    },
    shrink() {
      return [true, false];
    },
  };
}

export function arrayArbitrary<T>(elementArb: Arbitrary<T>, minLen: number = 0, maxLen: number = 20): Arbitrary<T[]> {
  return {
    name: `array<${elementArb.name}>`,
    generate(rng) {
      const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
      return Array.from({ length: len }, () => elementArb.generate(rng));
    },
    shrink(value) {
      if (value.length === 0) return [];
      const results: T[][] = [];
      if (value.length > minLen) {
        results.push(value.slice(0, Math.ceil(value.length / 2)));
        results.push([]);
      }
      return results;
    },
  };
}

export function objectArbitrary(
  keyArb: Arbitrary<string> = stringArbitrary(1, 10),
  valueArb: Arbitrary<unknown> = integerArbitrary(),
  minKeys: number = 0,
  maxKeys: number = 5,
): Arbitrary<Record<string, unknown>> {
  return {
    name: 'object',
    generate(rng) {
      const len = minKeys + Math.floor(rng() * (maxKeys - minKeys + 1));
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < len; i++) {
        obj[keyArb.generate(rng)] = valueArb.generate(rng);
      }
      return obj;
    },
    shrink(value) {
      const keys = Object.keys(value);
      if (keys.length === 0) return [];
      const results: Record<string, unknown>[] = [{}];
      const half = Math.ceil(keys.length / 2);
      const reduced: Record<string, unknown> = {};
      for (let i = 0; i < half; i++) {
        reduced[keys[i]!] = value[keys[i]!];
      }
      results.push(reduced);
      return results;
    },
  };
}

export function oneOfArbitrary<T>(arbitraries: Arbitrary<T>[]): Arbitrary<T> {
  return {
    name: `oneOf<${arbitraries.map((a) => a.name).join('|')}>`,
    generate(rng) {
      const idx = Math.floor(rng() * arbitraries.length);
      return arbitraries[idx]!.generate(rng);
    },
    shrink(value) {
      const results: T[] = [];
      for (const arb of arbitraries) {
        results.push(...arb.shrink(value));
      }
      return results;
    },
  };
}

export function tupleArbitrary<T extends unknown[]>(...arbitraries: { [K in keyof T]: Arbitrary<T[K]> }): Arbitrary<T> {
  return {
    name: `tuple<${arbitraries.map((a) => a.name).join(',')}>`,
    generate(rng) {
      return arbitraries.map((arb) => arb.generate(rng)) as T;
    },
    shrink(value) {
      const results: T[] = [];
      for (let i = 0; i < arbitraries.length; i++) {
        const shrunk = arbitraries[i]!.shrink(value[i]);
        for (const s of shrunk) {
          const newTuple = [...value] as unknown as T;
          newTuple[i] = s;
          results.push(newTuple);
        }
      }
      return results;
    },
  };
}

export function recordArbitrary(
  keyArb: Arbitrary<string> = stringArbitrary(1, 10),
  valueArb: Arbitrary<unknown> = integerArbitrary(),
): Arbitrary<Map<string, unknown>> {
  return {
    name: 'record',
    generate(rng) {
      const len = Math.floor(rng() * 5);
      const map = new Map<string, unknown>();
      for (let i = 0; i < len; i++) {
        map.set(keyArb.generate(rng), valueArb.generate(rng));
      }
      return map;
    },
    shrink(value) {
      if (value.size === 0) return [];
      const results: Map<string, unknown>[] = [new Map()];
      const entries = [...value.entries()];
      const half = Math.ceil(entries.length / 2);
      const reduced = new Map<string, unknown>();
      for (let i = 0; i < half; i++) {
        reduced.set(entries[i]![0], entries[i]![1]);
      }
      results.push(reduced);
      return results;
    },
  };
}

export const generators = {
  string: stringArbitrary,
  integer: integerArbitrary,
  float: floatArbitrary,
  boolean: booleanArbitrary,
  array: arrayArbitrary,
  object: objectArbitrary,
  oneOf: oneOfArbitrary,
  tuple: tupleArbitrary,
  record: recordArbitrary,
};

export function shrink<T>(arb: Arbitrary<T>, value: T): T[] {
  return arb.shrink(value);
}

export async function forAll<T>(
  arb: Arbitrary<T>,
  property: (value: T) => boolean | Promise<boolean>,
  options: PropertyTestOptions = {},
): Promise<PropertyTestResult> {
  const numRuns = options.numRuns ?? 100;
  const seed = options.seed ?? Date.now();
  const maxShrinks = options.maxShrinks ?? 100;
  const rng = createRNG(seed);

  for (let i = 0; i < numRuns; i++) {
    const value = arb.generate(rng);
    try {
      const result = await property(value);
      if (!result) {
        // Try to shrink
        let smallest: T = value;
        let shrunkCount = 0;
        let currentShrinks = arb.shrink(smallest);

        while (currentShrinks.length > 0 && shrunkCount < maxShrinks) {
          let foundSmaller = false;
          for (const candidate of currentShrinks) {
            try {
              const candidateResult = await property(candidate);
              if (!candidateResult) {
                smallest = candidate;
                foundSmaller = true;
                shrunkCount++;
                break;
              }
            } catch {
              // Candidate caused error, use it
              smallest = candidate;
              foundSmaller = true;
              shrunkCount++;
              break;
            }
          }
          if (!foundSmaller) break;
          currentShrinks = arb.shrink(smallest);
        }

        return {
          passed: false,
          numRuns: i + 1,
          counterexample: smallest,
          numShrinks: shrunkCount,
          error: `Property failed for value: ${JSON.stringify(smallest)}`,
        };
      }
    } catch (err) {
      return {
        passed: false,
        numRuns: i + 1,
        counterexample: value,
        error: `Property threw error: ${String(err)}`,
      };
    }
  }

  return { passed: true, numRuns };
}
