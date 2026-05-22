import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalize,
  add,
  subtract,
  scale,
  mean,
  randomVector,
  distance,
} from '../src/vector-operations.js';
import { VectorIndex } from '../src/vector-index.js';
import { HNSWIndex } from '../src/hnsw-index.js';
import { EmbeddingCache } from '../src/embedding-cache.js';
import { TextChunker } from '../src/text-chunker.js';
import { DocumentStore } from '../src/document-store.js';
import { HybridSearch } from '../src/hybrid-search.js';
import { IVFIndex } from '../src/ivf-index.js';
import { IndexManager } from '../src/index-manager.js';

// ============================================================
// BUG REGISTRY
// ============================================================
// BUG-001: [MEDIUM] vector-operations.ts mean() - No dimension validation
//   FIX: Added loop to check all vectors have the same dimension as the first vector
// BUG-002: [MEDIUM] vector-index.ts search() - No query dimension validation
//   FIX: Added check that query.length matches this.dimension, throws descriptive error
// BUG-003: [MEDIUM] hnsw-index.ts search() - No query dimension validation
//   FIX: Added check that query.length matches this.dimension, throws descriptive error
// BUG-004: [HIGH] hnsw-index.ts add() - Updating existing node only changed vector, not connections
//   FIX: Remove old node connections from neighbors, delete old node, then re-insert as new
// BUG-005: [MEDIUM] text-chunker.ts chunkBySentence() - Regex fails for text without ending punctuation
//   FIX: Check if regex returns null/empty, fall back to treating entire text as one sentence
// BUG-006: [LOW] hybrid-search.ts tfidfScore() - queryText parameter unused, dead code queryToks
//   FIX: Removed unused queryText parameter and dead queryToks variable
// BUG-007: [MEDIUM] ivf-index.ts add() - Duplicate id creates duplicate in cluster
//   FIX: Check if id already exists, remove old entry from cluster before re-adding
// BUG-008: [MEDIUM] ivf-index.ts search() - No query dimension validation
//   FIX: Added check that query.length matches this.dimension, throws descriptive error
// BUG-009: [MEDIUM] document-store.ts search() - No dimension check between query and embedding
//   FIX: Skip documents whose embedding dimension doesn't match query dimension
// BUG-010: [MEDIUM] hybrid-search.ts search() - No dimension check between queryVector and doc vector
//   FIX: Skip documents whose vector dimension doesn't match queryVector dimension
// BUG-011: [MEDIUM] embedding-cache.ts set()/get() - Stores and returns direct references, allowing external mutation
//   FIX: Store value.slice() in set(), return entry.value.slice() in get()

// ============================================================
// vector-operations.ts - cosineSimilarity
// ============================================================
describe('cosineSimilarity', () => {
  it('identical vectors have similarity 1', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it('orthogonal vectors have similarity 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('opposite vectors have similarity -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });

  it('zero vector a returns 0', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('zero vector b returns 0', () => {
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });

  it('both zero vectors returns 0', () => {
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it('returns correct value for known vectors', () => {
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2);
  });

  it('works with large dimension vectors', () => {
    const a = Array.from({ length: 1000 }, (_, i) => i + 1);
    const b = Array.from({ length: 1000 }, (_, i) => i + 1);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
  });

  it('negative values work correctly', () => {
    expect(cosineSimilarity([-1, -1], [-1, -1])).toBeCloseTo(1);
  });

  it('single dimension vectors', () => {
    expect(cosineSimilarity([5], [3])).toBeCloseTo(1);
  });

  it('empty vectors return 0 (dimensions match at 0)', () => {
    // Empty vectors have matching dimensions (0 === 0), norm is 0, so returns 0
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

// ============================================================
// vector-operations.ts - euclideanDistance
// ============================================================
describe('euclideanDistance', () => {
  it('same vector has distance 0', () => {
    expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBeCloseTo(0);
  });

  it('distance between [0,0] and [3,4] is 5', () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBeCloseTo(5);
  });

  it('throws on dimension mismatch', () => {
    expect(() => euclideanDistance([1], [1, 2])).toThrow();
  });

  it('distance is non-negative', () => {
    expect(euclideanDistance([1, 2], [3, 4])).toBeGreaterThanOrEqual(0);
  });

  it('symmetric property', () => {
    const d1 = euclideanDistance([1, 2, 3], [4, 5, 6]);
    const d2 = euclideanDistance([4, 5, 6], [1, 2, 3]);
    expect(d1).toBeCloseTo(d2);
  });

  it('zero vectors distance is 0', () => {
    expect(euclideanDistance([0, 0], [0, 0])).toBeCloseTo(0);
  });

  it('works with large values', () => {
    const d = euclideanDistance([1e10, 0], [0, 1e10]);
    expect(d).toBeCloseTo(Math.sqrt(2) * 1e10, 0);
  });

  it('single dimension', () => {
    expect(euclideanDistance([3], [7])).toBeCloseTo(4);
  });
});

// ============================================================
// vector-operations.ts - dotProduct
// ============================================================
describe('dotProduct', () => {
  it('dot product of [1,2,3] and [4,5,6] is 32', () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it('dot product with zero vector is 0', () => {
    expect(dotProduct([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('throws on dimension mismatch', () => {
    expect(() => dotProduct([1], [1, 2])).toThrow();
  });

  it('commutative property', () => {
    expect(dotProduct([1, 2], [3, 4])).toBe(dotProduct([3, 4], [1, 2]));
  });

  it('dot product of orthogonal vectors is 0', () => {
    expect(dotProduct([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('negative values', () => {
    expect(dotProduct([1, -2], [3, 4])).toBe(1 * 3 + (-2) * 4);
  });

  it('single dimension', () => {
    expect(dotProduct([5], [3])).toBe(15);
  });
});

// ============================================================
// vector-operations.ts - normalize
// ============================================================
describe('normalize', () => {
  it('normalized vector has unit length', () => {
    const n = normalize([3, 4]);
    const len = Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]!);
    expect(len).toBeCloseTo(1);
  });

  it('zero vector returns itself (not modified)', () => {
    const n = normalize([0, 0, 0]);
    expect(n).toEqual([0, 0, 0]);
  });

  it('does not mutate input', () => {
    const v = [3, 4];
    normalize(v);
    expect(v).toEqual([3, 4]);
  });

  it('preserves direction', () => {
    const n = normalize([2, 0]);
    expect(n[0]).toBeCloseTo(1);
    expect(n[1]).toBeCloseTo(0);
  });

  it('already normalized vector stays same', () => {
    const v = [1, 0, 0];
    expect(normalize(v)).toEqual([1, 0, 0]);
  });

  it('negative values normalize correctly', () => {
    const n = normalize([-3, -4]);
    const len = Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]!);
    expect(len).toBeCloseTo(1);
    expect(n[0]).toBeCloseTo(-0.6);
    expect(n[1]).toBeCloseTo(-0.8);
  });

  it('single dimension', () => {
    expect(normalize([5])).toEqual([1]);
  });
});

// ============================================================
// vector-operations.ts - add
// ============================================================
describe('add', () => {
  it('adds element-wise', () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
  });

  it('throws on dimension mismatch', () => {
    expect(() => add([1], [1, 2])).toThrow();
  });

  it('commutative', () => {
    expect(add([1, 2], [3, 4])).toEqual(add([3, 4], [1, 2]));
  });

  it('adding zero vector returns same', () => {
    expect(add([1, 2], [0, 0])).toEqual([1, 2]);
  });

  it('negative values', () => {
    expect(add([1, 2], [-1, -2])).toEqual([0, 0]);
  });

  it('empty vectors', () => {
    expect(add([], [])).toEqual([]);
  });
});

// ============================================================
// vector-operations.ts - subtract
// ============================================================
describe('subtract', () => {
  it('subtracts element-wise', () => {
    expect(subtract([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3]);
  });

  it('throws on dimension mismatch', () => {
    expect(() => subtract([1, 2], [1])).toThrow();
  });

  it('subtracting self gives zero', () => {
    expect(subtract([1, 2], [1, 2])).toEqual([0, 0]);
  });

  it('negative result', () => {
    expect(subtract([1, 2], [3, 4])).toEqual([-2, -2]);
  });

  it('empty vectors', () => {
    expect(subtract([], [])).toEqual([]);
  });
});

// ============================================================
// vector-operations.ts - scale
// ============================================================
describe('scale', () => {
  it('scales by positive scalar', () => {
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
  });

  it('scales by zero', () => {
    expect(scale([1, 2], 0)).toEqual([0, 0]);
  });

  it('scales by negative scalar', () => {
    expect(scale([1, 2], -1)).toEqual([-1, -2]);
  });

  it('scales by fraction', () => {
    expect(scale([4, 6], 0.5)).toEqual([2, 3]);
  });

  it('does not mutate input', () => {
    const v = [1, 2, 3];
    scale(v, 2);
    expect(v).toEqual([1, 2, 3]);
  });

  it('empty vector', () => {
    expect(scale([], 5)).toEqual([]);
  });

  it('scale by very large number', () => {
    const result = scale([1], 1e15);
    expect(result[0]).toBe(1e15);
  });
});

// ============================================================
// vector-operations.ts - mean
// ============================================================
describe('mean', () => {
  it('mean of empty array is empty', () => {
    expect(mean([])).toEqual([]);
  });

  it('mean of single vector is itself', () => {
    expect(mean([[1, 2, 3]])).toEqual([1, 2, 3]);
  });

  it('mean of two vectors', () => {
    expect(mean([[1, 2], [3, 4]])).toEqual([2, 3]);
  });

  it('mean of three vectors', () => {
    expect(mean([[1, 1], [2, 2], [3, 3]])).toEqual([2, 2]);
  });

  // BUG-001: [MEDIUM] mean() - No dimension validation for mismatched vectors
  it('throws on dimension mismatch', () => {
    expect(() => mean([[1, 2], [1, 2, 3]])).toThrow('All vectors must have the same dimension');
  });

  it('mean of many identical vectors returns same', () => {
    const v = [5, 10, 15];
    expect(mean([v, v, v, v, v])).toEqual([5, 10, 15]);
  });

  it('mean with negative values', () => {
    expect(mean([[1, -1], [-1, 1]])).toEqual([0, 0]);
  });
});

// ============================================================
// vector-operations.ts - randomVector
// ============================================================
describe('randomVector', () => {
  it('returns correct dimension', () => {
    const v = randomVector(5);
    expect(v).toHaveLength(5);
  });

  it('has unit length', () => {
    const v = randomVector(10);
    const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(len).toBeCloseTo(1, 10);
  });

  it('dimension 1 returns single element', () => {
    const v = randomVector(1);
    expect(v).toHaveLength(1);
    expect(Math.abs(v[0]!)).toBeCloseTo(1);
  });

  it('different calls produce different vectors (usually)', () => {
    const v1 = randomVector(100);
    const v2 = randomVector(100);
    // With 100 dimensions, probability of identical is essentially 0
    let same = true;
    for (let i = 0; i < 100; i++) {
      if (Math.abs(v1[i]! - v2[i]!) > 1e-10) {
        same = false;
        break;
      }
    }
    expect(same).toBe(false);
  });
});

// ============================================================
// vector-operations.ts - distance
// ============================================================
describe('distance', () => {
  it('cosine distance for identical vectors is 0', () => {
    expect(distance([1, 2], [1, 2], 'cosine')).toBeCloseTo(0);
  });

  it('euclidean distance works', () => {
    expect(distance([0, 0], [3, 4], 'euclidean')).toBeCloseTo(5);
  });

  it('dot distance for identical vectors is negative of dot product', () => {
    const v = [1, 2, 3];
    expect(distance(v, v, 'dot')).toBeCloseTo(-dotProduct(v, v));
  });

  it('cosine distance is 1 - similarity', () => {
    const a = [1, 0], b = [0, 1];
    expect(distance(a, b, 'cosine')).toBeCloseTo(1);
  });

  it('euclidean distance is non-negative', () => {
    expect(distance([1, 2], [3, 4], 'euclidean')).toBeGreaterThanOrEqual(0);
  });

  it('cosine distance for opposite vectors is 2', () => {
    expect(distance([1, 0], [-1, 0], 'cosine')).toBeCloseTo(2);
  });

  it('dot distance for orthogonal vectors is 0', () => {
    expect(distance([1, 0], [0, 1], 'dot')).toBeCloseTo(0);
  });
});

// ============================================================
// VectorIndex
// ============================================================
describe('VectorIndex', () => {
  let index: VectorIndex;

  beforeEach(() => {
    index = new VectorIndex(3);
  });

  it('constructor sets dimension and empty state', () => {
    expect(index.size()).toBe(0);
  });

  it('constructor throws on non-positive dimension', () => {
    expect(() => new VectorIndex(0)).toThrow();
    expect(() => new VectorIndex(-1)).toThrow();
  });

  it('add and size', () => {
    index.add('a', [1, 2, 3]);
    expect(index.size()).toBe(1);
  });

  it('add throws on wrong dimension', () => {
    expect(() => index.add('a', [1, 2])).toThrow();
  });

  it('add with metadata', () => {
    index.add('a', [1, 2, 3], { label: 'test' });
    const entry = index.get('a');
    expect(entry?.metadata?.label).toBe('test');
  });

  it('has returns true for existing id', () => {
    index.add('a', [1, 2, 3]);
    expect(index.has('a')).toBe(true);
  });

  it('has returns false for missing id', () => {
    expect(index.has('missing')).toBe(false);
  });

  it('get returns vector and metadata', () => {
    index.add('a', [1, 2, 3], { x: 1 });
    const result = index.get('a');
    expect(result?.vector).toEqual([1, 2, 3]);
    expect(result?.metadata?.x).toBe(1);
  });

  it('get returns undefined for missing id', () => {
    expect(index.get('missing')).toBeUndefined();
  });

  it('remove returns true for existing id', () => {
    index.add('a', [1, 2, 3]);
    expect(index.remove('a')).toBe(true);
    expect(index.size()).toBe(0);
  });

  it('remove returns false for missing id', () => {
    expect(index.remove('missing')).toBe(false);
  });

  it('clear removes all vectors', () => {
    index.add('a', [1, 2, 3]);
    index.add('b', [4, 5, 6]);
    index.clear();
    expect(index.size()).toBe(0);
  });

  it('search returns results sorted by score', () => {
    index.add('a', [1, 0, 0]);
    index.add('b', [0, 1, 0]);
    const results = index.search([1, 0, 0], 2);
    expect(results[0]?.id).toBe('a');
    expect(results[0]?.score).toBeGreaterThan(results[1]!.score);
  });

  it('search results include vector', () => {
    index.add('a', [1, 0, 0]);
    const results = index.search([1, 0, 0], 1);
    expect(results[0]?.vector).toEqual([1, 0, 0]);
  });

  it('search with topK limits results', () => {
    index.add('a', [1, 0, 0]);
    index.add('b', [0, 1, 0]);
    index.add('c', [0, 0, 1]);
    const results = index.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
  });

  it('search with topK 0 returns empty', () => {
    index.add('a', [1, 0, 0]);
    expect(index.search([1, 0, 0], 0)).toEqual([]);
  });

  it('search on empty index returns empty', () => {
    expect(index.search([1, 0, 0], 5)).toEqual([]);
  });

  // BUG-002: [MEDIUM] search() - No query dimension validation
  it('search throws on wrong query dimension', () => {
    index.add('a', [1, 2, 3]);
    expect(() => index.search([1, 2], 5)).toThrow('Query dimension');
  });

  it('cosine metric (default)', () => {
    const idx = new VectorIndex(2, { metric: 'cosine' });
    idx.add('a', [1, 0]);
    idx.add('b', [0, 1]);
    const results = idx.search([1, 0], 2);
    expect(results[0]?.id).toBe('a');
    expect(results[0]?.score).toBeCloseTo(1);
  });

  it('euclidean metric', () => {
    const idx = new VectorIndex(2, { metric: 'euclidean' });
    idx.add('a', [1, 0]);
    idx.add('b', [10, 0]);
    const results = idx.search([1, 0], 2);
    expect(results[0]?.id).toBe('a');
  });

  it('dot metric', () => {
    const idx = new VectorIndex(2, { metric: 'dot' });
    idx.add('a', [1, 0]);
    idx.add('b', [0, 1]);
    const results = idx.search([1, 0], 2);
    expect(results[0]?.id).toBe('a');
    expect(results[0]?.score).toBeCloseTo(1);
  });

  it('add overwrites existing id', () => {
    index.add('a', [1, 2, 3]);
    index.add('a', [4, 5, 6]);
    expect(index.size()).toBe(1);
    const entry = index.get('a');
    expect(entry?.vector).toEqual([4, 5, 6]);
  });

  it('search returns all results when topK > size', () => {
    index.add('a', [1, 0, 0]);
    index.add('b', [0, 1, 0]);
    const results = index.search([1, 0, 0], 100);
    expect(results).toHaveLength(2);
  });

  it('search with negative topK returns empty', () => {
    index.add('a', [1, 0, 0]);
    expect(index.search([1, 0, 0], -1)).toEqual([]);
  });

  it('add does not mutate input vector', () => {
    const v = [1, 2, 3];
    index.add('a', v);
    v[0] = 999;
    expect(index.get('a')?.vector).toEqual([1, 2, 3]);
  });

  it('search scores are in valid range for cosine', () => {
    index.add('a', [1, 0, 0]);
    index.add('b', [0, 1, 0]);
    const results = index.search([1, 0, 0], 2);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(-1);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('remove non-existent does not affect size', () => {
    index.add('a', [1, 2, 3]);
    index.remove('nonexistent');
    expect(index.size()).toBe(1);
  });

  it('get returns metadata as undefined when not provided', () => {
    index.add('a', [1, 2, 3]);
    expect(index.get('a')?.metadata).toBeUndefined();
  });
});

// ============================================================
// HNSWIndex
// ============================================================
describe('HNSWIndex', () => {
  let hnsw: HNSWIndex;

  beforeEach(() => {
    hnsw = new HNSWIndex(3);
  });

  it('constructor sets dimension', () => {
    expect(hnsw.getStats().elementCount).toBe(0);
  });

  it('constructor throws on non-positive dimension', () => {
    expect(() => new HNSWIndex(0)).toThrow();
    expect(() => new HNSWIndex(-5)).toThrow();
  });

  it('add and search single vector', () => {
    hnsw.add('a', [1, 0, 0]);
    const results = hnsw.search([1, 0, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('a');
  });

  it('add throws on wrong dimension', () => {
    expect(() => hnsw.add('a', [1, 2])).toThrow();
  });

  it('search returns closest vectors', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('b', [0, 1, 0]);
    hnsw.add('c', [0, 0, 1]);
    const results = hnsw.search([1, 0, 0], 2);
    expect(results[0]?.id).toBe('a');
  });

  it('search with topK limits results', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('b', [0, 1, 0]);
    hnsw.add('c', [0, 0, 1]);
    const results = hnsw.search([1, 0, 0], 1);
    expect(results).toHaveLength(1);
  });

  it('search on empty index returns empty', () => {
    expect(hnsw.search([1, 0, 0], 5)).toEqual([]);
  });

  it('search with topK 0 returns empty', () => {
    hnsw.add('a', [1, 0, 0]);
    expect(hnsw.search([1, 0, 0], 0)).toEqual([]);
  });

  // BUG-003: [MEDIUM] search() - No query dimension validation
  it('search throws on wrong query dimension', () => {
    hnsw.add('a', [1, 0, 0]);
    expect(() => hnsw.search([1, 2], 5)).toThrow('Query dimension');
  });

  it('remove existing vector', () => {
    hnsw.add('a', [1, 0, 0]);
    expect(hnsw.remove('a')).toBe(true);
    expect(hnsw.getStats().elementCount).toBe(0);
  });

  it('remove non-existing vector returns false', () => {
    expect(hnsw.remove('missing')).toBe(false);
  });

  it('remove and search', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('b', [0, 1, 0]);
    hnsw.remove('a');
    const results = hnsw.search([1, 0, 0], 5);
    expect(results.find(r => r.id === 'a')).toBeUndefined();
  });

  it('getStats returns correct structure', () => {
    hnsw.add('a', [1, 0, 0]);
    const stats = hnsw.getStats();
    expect(stats).toHaveProperty('levels');
    expect(stats).toHaveProperty('totalConnections');
    expect(stats).toHaveProperty('elementCount');
    expect(stats.elementCount).toBe(1);
  });

  it('custom M parameter', () => {
    const idx = new HNSWIndex(3, { M: 4 });
    idx.add('a', [1, 0, 0]);
    expect(idx.getStats().elementCount).toBe(1);
  });

  it('custom efConstruction parameter', () => {
    const idx = new HNSWIndex(3, { efConstruction: 100 });
    idx.add('a', [1, 0, 0]);
    expect(idx.getStats().elementCount).toBe(1);
  });

  it('custom efSearch parameter', () => {
    const idx = new HNSWIndex(3, { efSearch: 20 });
    idx.add('a', [1, 0, 0]);
    const results = idx.search([1, 0, 0], 1);
    expect(results).toHaveLength(1);
  });

  it('add multiple vectors and search', () => {
    for (let i = 0; i < 20; i++) {
      hnsw.add(`v${i}`, [Math.random(), Math.random(), Math.random()]);
    }
    expect(hnsw.getStats().elementCount).toBe(20);
    const results = hnsw.search([0.5, 0.5, 0.5], 5);
    expect(results).toHaveLength(5);
  });

  it('search scores are between -1 and 1 (cosine)', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('b', [0, 1, 0]);
    const results = hnsw.search([1, 0, 0], 2);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(-1);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  // BUG-004: [HIGH] add() - Updating existing node must rebuild connections
  it('update existing vector changes search results', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('b', [0, 1, 0]);
    // Update 'a' to be closer to 'b'
    hnsw.add('a', [0, 1, 0]);
    const results = hnsw.search([0, 1, 0], 2);
    // Both should be found, and 'a' should have high score
    const aResult = results.find(r => r.id === 'a');
    expect(aResult).toBeDefined();
    expect(aResult!.score).toBeCloseTo(1);
  });

  it('remove entry point and search still works', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('b', [0, 1, 0]);
    hnsw.add('c', [0, 0, 1]);
    hnsw.remove('a');
    const results = hnsw.search([0, 1, 0], 2);
    expect(results.length).toBeGreaterThan(0);
  });

  it('remove all vectors then search returns empty', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('b', [0, 1, 0]);
    hnsw.remove('a');
    hnsw.remove('b');
    expect(hnsw.search([1, 0, 0], 5)).toEqual([]);
  });

  it('getStats on empty index', () => {
    const stats = hnsw.getStats();
    expect(stats.levels).toBe(1); // maxLevel is 0, so levels = 0 + 1 = 1
    expect(stats.totalConnections).toBe(0);
    expect(stats.elementCount).toBe(0);
  });

  it('add same id multiple times keeps count as 1', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('a', [0, 1, 0]);
    hnsw.add('a', [0, 0, 1]);
    expect(hnsw.getStats().elementCount).toBe(1);
  });

  it('search with topK larger than element count', () => {
    hnsw.add('a', [1, 0, 0]);
    const results = hnsw.search([1, 0, 0], 100);
    expect(results).toHaveLength(1);
  });
});

// ============================================================
// EmbeddingCache
// ============================================================
describe('EmbeddingCache', () => {
  let cache: EmbeddingCache;

  beforeEach(() => {
    cache = new EmbeddingCache(5, 60000);
  });

  it('constructor throws on non-positive maxSize', () => {
    expect(() => new EmbeddingCache(0, 1000)).toThrow();
    expect(() => new EmbeddingCache(-1, 1000)).toThrow();
  });

  it('constructor throws on non-positive ttlMs', () => {
    expect(() => new EmbeddingCache(5, 0)).toThrow();
    expect(() => new EmbeddingCache(5, -1)).toThrow();
  });

  it('set and get', () => {
    cache.set('key1', [1, 2, 3]);
    expect(cache.get('key1')).toEqual([1, 2, 3]);
  });

  it('get returns undefined for missing key', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('set overwrites existing key', () => {
    cache.set('key1', [1, 2, 3]);
    cache.set('key1', [4, 5, 6]);
    expect(cache.get('key1')).toEqual([4, 5, 6]);
  });

  it('LRU eviction', () => {
    cache.set('a', [1]);
    cache.set('b', [2]);
    cache.set('c', [3]);
    cache.set('d', [4]);
    cache.set('e', [5]);
    cache.set('f', [6]); // should evict 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('f')).toEqual([6]);
  });

  it('get updates LRU order', () => {
    cache.set('a', [1]);
    cache.set('b', [2]);
    cache.set('c', [3]);
    cache.set('d', [4]);
    cache.set('e', [5]);
    cache.get('a'); // touch 'a'
    cache.set('f', [6]); // should evict 'b' (least recently used)
    expect(cache.get('a')).toEqual([1]);
    expect(cache.get('b')).toBeUndefined();
  });

  it('compute returns cached value on hit', () => {
    let calls = 0;
    cache.set('key1', [1, 2, 3]);
    const result = cache.compute('key1', () => { calls++; return [4, 5, 6]; });
    expect(result).toEqual([1, 2, 3]);
    expect(calls).toBe(0);
  });

  it('compute computes and caches on miss', () => {
    let calls = 0;
    const result = cache.compute('key1', () => { calls++; return [4, 5, 6]; });
    expect(result).toEqual([4, 5, 6]);
    expect(calls).toBe(1);
    expect(cache.get('key1')).toEqual([4, 5, 6]);
  });

  it('invalidate removes key', () => {
    cache.set('key1', [1, 2, 3]);
    cache.invalidate('key1');
    expect(cache.get('key1')).toBeUndefined();
  });

  it('invalidate non-existing key does not throw', () => {
    cache.invalidate('missing');
  });

  it('clear removes all entries and resets stats', () => {
    cache.set('a', [1]);
    cache.set('b', [2]);
    cache.get('a');
    cache.get('missing');
    cache.clear();
    expect(cache.getStats().size).toBe(0);
    expect(cache.getStats().hits).toBe(0);
    expect(cache.getStats().misses).toBe(0);
  });

  it('getStats tracks hits and misses', () => {
    cache.set('a', [1]);
    cache.get('a'); // hit
    cache.get('missing'); // miss
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
  });

  it('getStats hitRate is 0 with no accesses', () => {
    const stats = cache.getStats();
    expect(stats.hitRate).toBe(0);
  });

  it('getStats size reflects current cache size', () => {
    cache.set('a', [1]);
    cache.set('b', [2]);
    expect(cache.getStats().size).toBe(2);
  });

  it('TTL expiration', () => {
    const shortCache = new EmbeddingCache(5, 1); // 1ms TTL
    shortCache.set('key1', [1, 2, 3]);
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(shortCache.get('key1')).toBeUndefined();
        resolve();
      }, 10);
    });
  });

  it('expired entry counts as miss in stats', () => {
    const shortCache = new EmbeddingCache(5, 1);
    shortCache.set('key1', [1, 2, 3]);
    return new Promise<void>(resolve => {
      setTimeout(() => {
        shortCache.get('key1'); // expired miss
        expect(shortCache.getStats().misses).toBe(1);
        resolve();
      }, 10);
    });
  });

  it('cache with maxSize 1', () => {
    const c = new EmbeddingCache(1, 60000);
    c.set('a', [1]);
    c.set('b', [2]);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toEqual([2]);
  });

  it('set does not mutate input array', () => {
    const v = [1, 2, 3];
    cache.set('key', v);
    v[0] = 999;
    expect(cache.get('key')).toEqual([1, 2, 3]);
  });

  it('multiple get calls on same key count as multiple hits', () => {
    cache.set('a', [1]);
    cache.get('a');
    cache.get('a');
    cache.get('a');
    expect(cache.getStats().hits).toBe(3);
  });

  it('compute with expired entry recomputes', () => {
    const shortCache = new EmbeddingCache(5, 1);
    let calls = 0;
    shortCache.set('key1', [1, 2, 3]);
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const result = shortCache.compute('key1', () => { calls++; return [4, 5, 6]; });
        expect(result).toEqual([4, 5, 6]);
        expect(calls).toBe(1);
        resolve();
      }, 10);
    });
  });
});

// ============================================================
// TextChunker
// ============================================================
describe('TextChunker', () => {
  let chunker: TextChunker;

  beforeEach(() => {
    chunker = new TextChunker();
  });

  it('chunk empty text returns empty', () => {
    expect(chunker.chunk('')).toEqual([]);
  });

  it('chunk short text returns single chunk', () => {
    expect(chunker.chunk('hello world')).toEqual(['hello world']);
  });

  it('chunk respects maxSize', () => {
    const text = 'a'.repeat(1000);
    const chunks = chunker.chunk(text, { maxSize: 200 });
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200);
    }
  });

  it('chunk with overlap', () => {
    const text = 'word '.repeat(200);
    const chunks = chunker.chunk(text, { maxSize: 100, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('chunk breaks at word boundary', () => {
    const text = 'hello world this is a test';
    const chunks = chunker.chunk(text, { maxSize: 15, overlap: 0 });
    for (const c of chunks) {
      if (c.length < text.length) {
        expect(c.endsWith(' ')).toBe(false);
      }
    }
  });

  it('chunk with zero overlap', () => {
    const text = 'a b c d e f g h i j k l m n o p';
    const chunks = chunker.chunk(text, { maxSize: 10, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('chunk with overlap larger than maxSize does not infinite loop', () => {
    const text = 'word '.repeat(100);
    const chunks = chunker.chunk(text, { maxSize: 10, overlap: 20 });
    // Should not hang and should return some chunks
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('chunk with single very long word (no spaces)', () => {
    const text = 'a'.repeat(1000);
    const chunks = chunker.chunk(text, { maxSize: 200 });
    // No word boundaries, so chunks are split at maxSize
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200);
    }
  });

  it('chunk with maxSize 1', () => {
    const text = 'abc';
    const chunks = chunker.chunk(text, { maxSize: 1 });
    // Each character becomes a chunk (no word boundary found)
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('chunkBySentence empty text', () => {
    expect(chunker.chunkBySentence('')).toEqual([]);
  });

  it('chunkBySentence groups sentences', () => {
    const text = 'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence. Sixth sentence.';
    const chunks = chunker.chunkBySentence(text, 2);
    expect(chunks.length).toBe(3);
  });

  it('chunkBySentence default maxSentences', () => {
    const text = 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.';
    const chunks = chunker.chunkBySentence(text);
    expect(chunks.length).toBe(2);
  });

  // BUG-005: [MEDIUM] chunkBySentence() - Handle text without ending punctuation
  it('chunkBySentence handles text without ending punctuation', () => {
    const text = 'hello world this has no periods';
    const chunks = chunker.chunkBySentence(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('hello world');
  });

  it('chunkBySentence handles mixed punctuation', () => {
    const text = 'First sentence! Second sentence? Third sentence.';
    const chunks = chunker.chunkBySentence(text, 2);
    expect(chunks.length).toBe(2);
  });

  it('chunkBySentence with maxSentences 1', () => {
    const text = 'One. Two. Three.';
    const chunks = chunker.chunkBySentence(text, 1);
    expect(chunks.length).toBe(3);
  });

  it('chunkBySentence with whitespace-only text', () => {
    const chunks = chunker.chunkBySentence('   ');
    expect(chunks).toEqual([]);
  });

  it('chunkByParagraph empty text', () => {
    expect(chunker.chunkByParagraph('')).toEqual([]);
  });

  it('chunkByParagraph splits on double newline', () => {
    const text = 'Para 1\n\nPara 2\n\nPara 3';
    const chunks = chunker.chunkByParagraph(text);
    expect(chunks).toEqual(['Para 1', 'Para 2', 'Para 3']);
  });

  it('chunkByParagraph trims whitespace', () => {
    const text = '  Para 1  \n\n  Para 2  ';
    const chunks = chunker.chunkByParagraph(text);
    expect(chunks).toEqual(['Para 1', 'Para 2']);
  });

  it('chunkByParagraph with single paragraph', () => {
    const text = 'Only one paragraph';
    const chunks = chunker.chunkByParagraph(text);
    expect(chunks).toEqual(['Only one paragraph']);
  });

  it('chunkByParagraph with multiple blank lines', () => {
    const text = 'A\n\n\n\nB';
    const chunks = chunker.chunkByParagraph(text);
    expect(chunks).toEqual(['A', 'B']);
  });

  it('mergeChunks empty array', () => {
    expect(chunker.mergeChunks([], 100)).toEqual([]);
  });

  it('mergeChunks merges small chunks', () => {
    const chunks = ['hello', 'world', 'foo'];
    const merged = chunker.mergeChunks(chunks, 20);
    expect(merged.length).toBeLessThan(chunks.length);
  });

  it('mergeChunks respects maxSize', () => {
    const chunks = ['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10)];
    const merged = chunker.mergeChunks(chunks, 15);
    for (const m of merged) {
      expect(m.length).toBeLessThanOrEqual(15);
    }
  });

  it('mergeChunks single chunk larger than maxSize', () => {
    const chunks = ['a'.repeat(100)];
    const merged = chunker.mergeChunks(chunks, 10);
    // Single chunk larger than maxSize is still included as-is
    expect(merged).toHaveLength(1);
    expect(merged[0]!.length).toBe(100);
  });

  it('mergeChunks with empty strings', () => {
    const chunks = ['', 'hello', '', 'world'];
    const merged = chunker.mergeChunks(chunks, 20);
    expect(merged.length).toBeGreaterThan(0);
  });

  it('getStats empty chunks', () => {
    const stats = chunker.getStats([]);
    expect(stats.count).toBe(0);
    expect(stats.avgLength).toBe(0);
    expect(stats.minLength).toBe(0);
    expect(stats.maxLength).toBe(0);
  });

  it('getStats computes correctly', () => {
    const chunks = ['short', 'medium length', 'very very long chunk here'];
    const stats = chunker.getStats(chunks);
    expect(stats.count).toBe(3);
    expect(stats.minLength).toBe(5);
    expect(stats.maxLength).toBe(25);
    expect(stats.avgLength).toBeGreaterThan(0);
  });

  it('getStats avgLength is correct', () => {
    const chunks = ['aa', 'bbbb'];
    const stats = chunker.getStats(chunks);
    expect(stats.avgLength).toBe(3);
  });

  it('getStats single chunk', () => {
    const stats = chunker.getStats(['hello']);
    expect(stats.count).toBe(1);
    expect(stats.avgLength).toBe(5);
    expect(stats.minLength).toBe(5);
    expect(stats.maxLength).toBe(5);
  });
});

// ============================================================
// DocumentStore
// ============================================================
describe('DocumentStore', () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
  });

  it('addDocument and getDocument', () => {
    store.addDocument({ id: '1', content: 'hello' });
    const doc = store.getDocument('1');
    expect(doc?.id).toBe('1');
    expect(doc?.content).toBe('hello');
  });

  it('addDocument with metadata', () => {
    store.addDocument({ id: '1', content: 'hello', metadata: { source: 'test' } });
    const doc = store.getDocument('1');
    expect(doc?.metadata?.source).toBe('test');
  });

  it('addDocument with embedding', () => {
    store.addDocument({ id: '1', content: 'hello', embedding: [1, 0, 0] });
    const doc = store.getDocument('1');
    expect(doc?.embedding).toEqual([1, 0, 0]);
  });

  it('getDocument returns undefined for missing', () => {
    expect(store.getDocument('missing')).toBeUndefined();
  });

  it('search returns results sorted by score', () => {
    store.addDocument({ id: '1', content: 'similar', embedding: [1, 0, 0] });
    store.addDocument({ id: '2', content: 'different', embedding: [0, 1, 0] });
    const results = store.search([1, 0, 0], 2);
    expect(results[0]?.id).toBe('1');
    expect(results[0]?.score).toBeGreaterThan(results[1]!.score);
  });

  it('search skips documents without embedding', () => {
    store.addDocument({ id: '1', content: 'no embedding' });
    store.addDocument({ id: '2', content: 'has embedding', embedding: [1, 0, 0] });
    const results = store.search([1, 0, 0], 5);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('2');
  });

  it('search with topK limits results', () => {
    store.addDocument({ id: '1', content: 'a', embedding: [1, 0, 0] });
    store.addDocument({ id: '2', content: 'b', embedding: [0, 1, 0] });
    store.addDocument({ id: '3', content: 'c', embedding: [0, 0, 1] });
    const results = store.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
  });

  it('search with topK 0 returns empty', () => {
    store.addDocument({ id: '1', content: 'a', embedding: [1, 0, 0] });
    expect(store.search([1, 0, 0], 0)).toEqual([]);
  });

  it('search on empty store returns empty', () => {
    expect(store.search([1, 0, 0], 5)).toEqual([]);
  });

  it('search results include content and metadata', () => {
    store.addDocument({ id: '1', content: 'test content', metadata: { key: 'val' }, embedding: [1, 0, 0] });
    const results = store.search([1, 0, 0], 1);
    expect(results[0]?.content).toBe('test content');
    expect(results[0]?.metadata?.key).toBe('val');
  });

  // BUG-009: [MEDIUM] search() - Skip documents with mismatched embedding dimension
  it('search skips documents with different embedding dimension', () => {
    store.addDocument({ id: '1', content: '3d', embedding: [1, 0, 0] });
    store.addDocument({ id: '2', content: '2d', embedding: [1, 0] });
    const results = store.search([1, 0, 0], 5);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('1');
  });

  it('updateDocument content', () => {
    store.addDocument({ id: '1', content: 'old' });
    const result = store.updateDocument('1', { content: 'new' });
    expect(result).toBe(true);
    expect(store.getDocument('1')?.content).toBe('new');
  });

  it('updateDocument metadata', () => {
    store.addDocument({ id: '1', content: 'hello' });
    store.updateDocument('1', { metadata: { updated: true } });
    expect(store.getDocument('1')?.metadata?.updated).toBe(true);
  });

  it('updateDocument embedding', () => {
    store.addDocument({ id: '1', content: 'hello' });
    store.updateDocument('1', { embedding: [1, 0, 0] });
    expect(store.getDocument('1')?.embedding).toEqual([1, 0, 0]);
  });

  it('updateDocument returns false for missing', () => {
    expect(store.updateDocument('missing', { content: 'x' })).toBe(false);
  });

  it('updateDocument with empty updates object does nothing', () => {
    store.addDocument({ id: '1', content: 'hello' });
    store.updateDocument('1', {});
    expect(store.getDocument('1')?.content).toBe('hello');
  });

  it('deleteDocument returns true for existing', () => {
    store.addDocument({ id: '1', content: 'hello' });
    expect(store.deleteDocument('1')).toBe(true);
    expect(store.getDocument('1')).toBeUndefined();
  });

  it('deleteDocument returns false for missing', () => {
    expect(store.deleteDocument('missing')).toBe(false);
  });

  it('listDocuments returns all', () => {
    store.addDocument({ id: '1', content: 'a' });
    store.addDocument({ id: '2', content: 'b' });
    expect(store.listDocuments()).toHaveLength(2);
  });

  it('listDocuments with metadata filter', () => {
    store.addDocument({ id: '1', content: 'a', metadata: { type: 'x' } });
    store.addDocument({ id: '2', content: 'b', metadata: { type: 'y' } });
    const filtered = store.listDocuments({ metadata: { type: 'x' } });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('1');
  });

  it('listDocuments without filter returns all', () => {
    store.addDocument({ id: '1', content: 'a' });
    store.addDocument({ id: '2', content: 'b' });
    expect(store.listDocuments({})).toHaveLength(2);
  });

  it('listDocuments filter excludes docs without metadata', () => {
    store.addDocument({ id: '1', content: 'a', metadata: { type: 'x' } });
    store.addDocument({ id: '2', content: 'b' });
    const filtered = store.listDocuments({ metadata: { type: 'x' } });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('1');
  });

  it('listDocuments filter with multiple keys', () => {
    store.addDocument({ id: '1', content: 'a', metadata: { type: 'x', tag: 'foo' } });
    store.addDocument({ id: '2', content: 'b', metadata: { type: 'x', tag: 'bar' } });
    const filtered = store.listDocuments({ metadata: { type: 'x', tag: 'foo' } });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('1');
  });

  it('getStats returns correct values', () => {
    store.addDocument({ id: '1', content: 'hello', embedding: [1, 0, 0] });
    store.addDocument({ id: '2', content: 'world' });
    const stats = store.getStats();
    expect(stats.total).toBe(2);
    expect(stats.withEmbedding).toBe(1);
    expect(stats.avgContentLength).toBe(5);
  });

  it('getStats on empty store', () => {
    const stats = store.getStats();
    expect(stats.total).toBe(0);
    expect(stats.withEmbedding).toBe(0);
    expect(stats.avgContentLength).toBe(0);
  });

  it('addDocument overwrites existing', () => {
    store.addDocument({ id: '1', content: 'old' });
    store.addDocument({ id: '1', content: 'new' });
    expect(store.getDocument('1')?.content).toBe('new');
    expect(store.listDocuments()).toHaveLength(1);
  });

  it('search with empty query vector', () => {
    store.addDocument({ id: '1', content: 'a', embedding: [0, 0, 0] });
    const results = store.search([0, 0, 0], 5);
    expect(results).toHaveLength(1);
    expect(results[0]?.score).toBe(0);
  });
});

// ============================================================
// HybridSearch
// ============================================================
describe('HybridSearch', () => {
  let hybrid: HybridSearch;

  beforeEach(() => {
    hybrid = new HybridSearch();
  });

  it('default alpha is 0.7', () => {
    hybrid.addDocument('1', 'cat dog', [1, 0, 0]);
    hybrid.addDocument('2', 'car truck', [0, 1, 0]);
    const results = hybrid.search('cat', [1, 0, 0], 2);
    expect(results[0]?.id).toBe('1');
  });

  it('custom alpha', () => {
    const h = new HybridSearch({ alpha: 0.5 });
    h.addDocument('1', 'test', [1, 0, 0]);
    const results = h.search('test', [1, 0, 0], 1);
    expect(results).toHaveLength(1);
  });

  it('addDocument and search', () => {
    hybrid.addDocument('1', 'machine learning', [1, 0, 0]);
    hybrid.addDocument('2', 'cooking recipes', [0, 1, 0]);
    const results = hybrid.search('machine learning', [1, 0, 0], 2);
    expect(results[0]?.id).toBe('1');
  });

  it('search returns vectorScore and keywordScore', () => {
    hybrid.addDocument('1', 'test content', [1, 0, 0]);
    const results = hybrid.search('test', [1, 0, 0], 1);
    expect(results[0]).toHaveProperty('vectorScore');
    expect(results[0]).toHaveProperty('keywordScore');
    expect(results[0]).toHaveProperty('score');
  });

  it('search with topK limits results', () => {
    hybrid.addDocument('1', 'a', [1, 0, 0]);
    hybrid.addDocument('2', 'b', [0, 1, 0]);
    hybrid.addDocument('3', 'c', [0, 0, 1]);
    const results = hybrid.search('a', [1, 0, 0], 1);
    expect(results).toHaveLength(1);
  });

  it('search with topK 0 returns empty', () => {
    hybrid.addDocument('1', 'a', [1, 0, 0]);
    expect(hybrid.search('a', [1, 0, 0], 0)).toEqual([]);
  });

  it('search on empty returns empty', () => {
    expect(hybrid.search('test', [1, 0, 0], 5)).toEqual([]);
  });

  it('removeDocument', () => {
    hybrid.addDocument('1', 'test', [1, 0, 0]);
    hybrid.removeDocument('1');
    expect(hybrid.search('test', [1, 0, 0], 5)).toEqual([]);
  });

  it('removeDocument non-existing does not throw', () => {
    hybrid.removeDocument('missing');
  });

  it('setAlpha', () => {
    hybrid.setAlpha(0.3);
    hybrid.addDocument('1', 'cat', [1, 0, 0]);
    hybrid.addDocument('2', 'dog', [0.9, 0.1, 0]);
    const results = hybrid.search('cat', [1, 0, 0], 2);
    expect(results).toHaveLength(2);
  });

  it('setAlpha throws for invalid values', () => {
    expect(() => hybrid.setAlpha(-0.1)).toThrow();
    expect(() => hybrid.setAlpha(1.1)).toThrow();
  });

  it('setAlpha accepts 0', () => {
    hybrid.setAlpha(0);
    hybrid.addDocument('1', 'cat', [1, 0, 0]);
    hybrid.addDocument('2', 'cat dog', [0, 1, 0]);
    const results = hybrid.search('cat', [1, 0, 0], 2);
    // With alpha=0, only keyword score matters
    expect(results).toHaveLength(2);
  });

  it('setAlpha accepts 1', () => {
    hybrid.setAlpha(1);
    hybrid.addDocument('1', 'cat', [1, 0, 0]);
    hybrid.addDocument('2', 'cat dog', [0, 1, 0]);
    const results = hybrid.search('cat', [1, 0, 0], 2);
    // With alpha=1, only vector score matters
    expect(results[0]?.id).toBe('1');
  });

  it('getStats returns correct structure', () => {
    hybrid.addDocument('1', 'test', [1, 0, 0]);
    hybrid.search('test', [1, 0, 0], 1);
    const stats = hybrid.getStats();
    expect(stats.totalDocuments).toBe(1);
    expect(stats.vectorSearches).toBe(1);
    expect(stats.keywordSearches).toBe(1);
    expect(stats.hybridSearches).toBe(1);
  });

  it('getStats initial values', () => {
    const stats = hybrid.getStats();
    expect(stats.totalDocuments).toBe(0);
    expect(stats.vectorSearches).toBe(0);
    expect(stats.keywordSearches).toBe(0);
    expect(stats.hybridSearches).toBe(0);
  });

  it('keyword matching works', () => {
    hybrid.addDocument('1', 'artificial intelligence', [0.5, 0.5, 0]);
    hybrid.addDocument('2', 'cooking recipes', [0.5, 0.5, 0]);
    const results = hybrid.search('artificial intelligence', [0.5, 0.5, 0], 2);
    expect(results[0]?.id).toBe('1');
  });

  it('addDocument with metadata', () => {
    hybrid.addDocument('1', 'test', [1, 0, 0], { source: 'docs' });
    const results = hybrid.search('test', [1, 0, 0], 1);
    expect(results[0]?.content).toBe('test');
  });

  // BUG-010: [MEDIUM] search() - Skip documents with mismatched vector dimension
  it('search skips documents with different vector dimension', () => {
    hybrid.addDocument('1', '3d doc', [1, 0, 0]);
    hybrid.addDocument('2', '2d doc', [1, 0]);
    const results = hybrid.search('doc', [1, 0, 0], 5);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('1');
  });

  it('search increments counters', () => {
    hybrid.addDocument('1', 'test', [1, 0, 0]);
    hybrid.search('test', [1, 0, 0], 1);
    hybrid.search('test', [1, 0, 0], 1);
    const stats = hybrid.getStats();
    expect(stats.hybridSearches).toBe(2);
    expect(stats.vectorSearches).toBe(2);
    expect(stats.keywordSearches).toBe(2);
  });

  it('addDocument overwrites existing', () => {
    hybrid.addDocument('1', 'old content', [1, 0, 0]);
    hybrid.addDocument('1', 'new content', [0, 1, 0]);
    const results = hybrid.search('new content', [0, 1, 0], 1);
    expect(results[0]?.content).toBe('new content');
    expect(hybrid.getStats().totalDocuments).toBe(1);
  });

  it('search with empty query text', () => {
    hybrid.addDocument('1', 'test', [1, 0, 0]);
    const results = hybrid.search('', [1, 0, 0], 1);
    expect(results).toHaveLength(1);
  });

  it('search is case insensitive for keywords', () => {
    hybrid.addDocument('1', 'Machine Learning', [0.5, 0.5, 0]);
    hybrid.addDocument('2', 'cooking recipes', [0.5, 0.5, 0]);
    const results = hybrid.search('machine learning', [0.5, 0.5, 0], 2);
    expect(results[0]?.id).toBe('1');
  });
});

// ============================================================
// IVFIndex
// ============================================================
describe('IVFIndex', () => {
  let ivf: IVFIndex;

  beforeEach(() => {
    ivf = new IVFIndex(3);
  });

  it('constructor throws on non-positive dimension', () => {
    expect(() => new IVFIndex(0)).toThrow();
    expect(() => new IVFIndex(-1)).toThrow();
  });

  it('build with vectors', () => {
    const vectors = [
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
      { id: '3', vector: [0, 0, 1] },
    ];
    ivf.build(vectors);
    const stats = ivf.getStats();
    expect(stats.totalVectors).toBe(3);
  });

  it('build throws on empty vectors', () => {
    expect(() => ivf.build([])).toThrow();
  });

  it('build throws on wrong dimension', () => {
    expect(() => ivf.build([{ id: '1', vector: [1, 2] }])).toThrow();
  });

  it('search after build returns results', () => {
    ivf.build([
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
    ]);
    const results = ivf.search([1, 0, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('1');
  });

  it('search before build returns empty', () => {
    expect(ivf.search([1, 0, 0], 5)).toEqual([]);
  });

  it('search with topK 0 returns empty', () => {
    ivf.build([{ id: '1', vector: [1, 0, 0] }]);
    expect(ivf.search([1, 0, 0], 0)).toEqual([]);
  });

  it('search with topK limits results', () => {
    ivf.build([
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
      { id: '3', vector: [0, 0, 1] },
    ]);
    const results = ivf.search([1, 0, 0], 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  // BUG-008: [MEDIUM] search() - No query dimension validation
  it('search throws on wrong query dimension', () => {
    ivf.build([{ id: '1', vector: [1, 0, 0] }]);
    expect(() => ivf.search([1, 2], 5)).toThrow('Query dimension');
  });

  it('add after build', () => {
    ivf.build([{ id: '1', vector: [1, 0, 0] }]);
    ivf.add('2', [0, 1, 0]);
    expect(ivf.getStats().totalVectors).toBe(2);
  });

  it('add throws on wrong dimension', () => {
    ivf.build([{ id: '1', vector: [1, 0, 0] }]);
    expect(() => ivf.add('2', [1, 2])).toThrow();
  });

  it('getStats returns correct structure', () => {
    ivf.build([
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
    ]);
    const stats = ivf.getStats();
    expect(stats).toHaveProperty('clusters');
    expect(stats).toHaveProperty('totalVectors');
    expect(stats).toHaveProperty('avgClusterSize');
    expect(stats.totalVectors).toBe(2);
  });

  it('custom nlist', () => {
    const idx = new IVFIndex(3, { nlist: 2 });
    idx.build([
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
      { id: '3', vector: [0, 0, 1] },
    ]);
    const stats = idx.getStats();
    expect(stats.clusters).toBeLessThanOrEqual(2);
  });

  it('custom nprobe', () => {
    const idx = new IVFIndex(3, { nprobe: 2 });
    idx.build([
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
      { id: '3', vector: [0, 0, 1] },
      { id: '4', vector: [0.5, 0.5, 0] },
    ]);
    const results = idx.search([1, 0, 0], 4);
    expect(results.length).toBeGreaterThan(0);
  });

  it('search scores are cosine similarities', () => {
    ivf.build([{ id: '1', vector: [1, 0, 0] }]);
    const results = ivf.search([1, 0, 0], 1);
    expect(results[0]?.score).toBeCloseTo(1);
  });

  it('build with more vectors than nlist', () => {
    const vectors = Array.from({ length: 50 }, (_, i) => ({
      id: `v${i}`,
      vector: [Math.random(), Math.random(), Math.random()],
    }));
    ivf.build(vectors);
    expect(ivf.getStats().totalVectors).toBe(50);
    const results = ivf.search([0.5, 0.5, 0.5], 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('nlist capped at vector count', () => {
    const idx = new IVFIndex(3, { nlist: 100 });
    idx.build([
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
    ]);
    const stats = idx.getStats();
    expect(stats.clusters).toBeLessThanOrEqual(2);
  });

  // BUG-007: [MEDIUM] add() - Duplicate id should not create duplicate in cluster
  it('add same id after build does not duplicate in cluster', () => {
    ivf.build([{ id: '1', vector: [1, 0, 0] }]);
    ivf.add('1', [0, 1, 0]); // update existing
    const stats = ivf.getStats();
    expect(stats.totalVectors).toBe(1);
    // Search should still work and return exactly 1 result
    const results = ivf.search([0, 1, 0], 5);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('add before build stores vector', () => {
    ivf.add('1', [1, 0, 0]);
    ivf.add('2', [0, 1, 0]);
    ivf.build([
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
    ]);
    expect(ivf.getStats().totalVectors).toBe(2);
  });

  it('search with negative topK returns empty', () => {
    ivf.build([{ id: '1', vector: [1, 0, 0] }]);
    expect(ivf.search([1, 0, 0], -1)).toEqual([]);
  });

  it('getStats on empty index', () => {
    const stats = ivf.getStats();
    expect(stats.clusters).toBe(0);
    expect(stats.totalVectors).toBe(0);
    expect(stats.avgClusterSize).toBe(0);
  });

  it('build replaces previous state', () => {
    ivf.build([{ id: '1', vector: [1, 0, 0] }]);
    ivf.build([{ id: '2', vector: [0, 1, 0] }, { id: '3', vector: [0, 0, 1] }]);
    expect(ivf.getStats().totalVectors).toBe(2);
    const results = ivf.search([1, 0, 0], 5);
    expect(results.find(r => r.id === '1')).toBeUndefined();
  });
});

// ============================================================
// IndexManager
// ============================================================
describe('IndexManager', () => {
  let manager: IndexManager;

  beforeEach(() => {
    manager = new IndexManager();
  });

  it('createIndex', () => {
    manager.createIndex('test', 3);
    expect(manager.listIndices()).toContain('test');
  });

  it('createIndex throws on duplicate name', () => {
    manager.createIndex('test', 3);
    expect(() => manager.createIndex('test', 3)).toThrow();
  });

  it('deleteIndex', () => {
    manager.createIndex('test', 3);
    expect(manager.deleteIndex('test')).toBe(true);
    expect(manager.listIndices()).not.toContain('test');
  });

  it('deleteIndex returns false for missing', () => {
    expect(manager.deleteIndex('missing')).toBe(false);
  });

  it('getIndex returns index', () => {
    manager.createIndex('test', 3);
    const idx = manager.getIndex('test');
    expect(idx).toBeDefined();
    expect(idx).toBeInstanceOf(VectorIndex);
  });

  it('getIndex returns undefined for missing', () => {
    expect(manager.getIndex('missing')).toBeUndefined();
  });

  it('listIndices returns all names', () => {
    manager.createIndex('a', 3);
    manager.createIndex('b', 5);
    const names = manager.listIndices();
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).toHaveLength(2);
  });

  it('listIndices on empty manager', () => {
    expect(manager.listIndices()).toEqual([]);
  });

  it('addToIndex', () => {
    manager.createIndex('test', 3);
    manager.addToIndex('test', 'v1', [1, 2, 3]);
    const idx = manager.getIndex('test')!;
    expect(idx.has('v1')).toBe(true);
  });

  it('addToIndex throws for missing index', () => {
    expect(() => manager.addToIndex('missing', 'v1', [1, 2, 3])).toThrow();
  });

  it('addToIndex with metadata', () => {
    manager.createIndex('test', 3);
    manager.addToIndex('test', 'v1', [1, 2, 3], { key: 'val' });
    const idx = manager.getIndex('test')!;
    const entry = idx.get('v1');
    expect(entry?.metadata?.key).toBe('val');
  });

  it('searchIndex', () => {
    manager.createIndex('test', 3);
    manager.addToIndex('test', 'v1', [1, 0, 0]);
    manager.addToIndex('test', 'v2', [0, 1, 0]);
    const results = manager.searchIndex('test', [1, 0, 0], 1);
    expect(results[0]?.id).toBe('v1');
  });

  it('searchIndex throws for missing index', () => {
    expect(() => manager.searchIndex('missing', [1, 0, 0], 5)).toThrow();
  });

  it('searchAll searches all indices', () => {
    manager.createIndex('a', 3);
    manager.createIndex('b', 3);
    manager.addToIndex('a', 'v1', [1, 0, 0]);
    manager.addToIndex('b', 'v2', [0, 1, 0]);
    const results = manager.searchAll([1, 0, 0], 5);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.indexName)).toContain('a');
    expect(results.map(r => r.indexName)).toContain('b');
  });

  it('searchAll on empty manager', () => {
    expect(manager.searchAll([1, 0, 0], 5)).toEqual([]);
  });

  it('getStats returns correct structure', () => {
    manager.createIndex('a', 3);
    manager.createIndex('b', 3);
    manager.addToIndex('a', 'v1', [1, 0, 0]);
    manager.addToIndex('a', 'v2', [0, 1, 0]);
    manager.addToIndex('b', 'v3', [0, 0, 1]);
    const stats = manager.getStats();
    expect(stats.indexCount).toBe(2);
    expect(stats.totalVectors).toBe(3);
    expect(stats.indices.a).toBe(2);
    expect(stats.indices.b).toBe(1);
  });

  it('getStats on empty manager', () => {
    const stats = manager.getStats();
    expect(stats.indexCount).toBe(0);
    expect(stats.totalVectors).toBe(0);
    expect(Object.keys(stats.indices)).toHaveLength(0);
  });

  it('createIndex with options', () => {
    manager.createIndex('test', 3, { metric: 'euclidean' });
    const idx = manager.getIndex('test')!;
    manager.addToIndex('test', 'v1', [1, 0, 0]);
    const results = manager.searchIndex('test', [1, 0, 0], 1);
    expect(results[0]?.id).toBe('v1');
  });

  it('deleteIndex and createIndex with same name', () => {
    manager.createIndex('test', 3);
    manager.deleteIndex('test');
    manager.createIndex('test', 5);
    expect(manager.listIndices()).toContain('test');
  });

  it('addToIndex with wrong dimension throws', () => {
    manager.createIndex('test', 3);
    expect(() => manager.addToIndex('test', 'v1', [1, 2])).toThrow();
  });

  it('searchAll with empty indices returns empty results', () => {
    manager.createIndex('a', 3);
    const results = manager.searchAll([1, 0, 0], 5);
    expect(results).toHaveLength(1);
    expect(results[0]?.results).toHaveLength(0);
  });

  it('multiple operations on same index', () => {
    manager.createIndex('test', 3);
    manager.addToIndex('test', 'v1', [1, 0, 0]);
    manager.addToIndex('test', 'v2', [0, 1, 0]);
    manager.addToIndex('test', 'v3', [0, 0, 1]);
    expect(manager.getStats().totalVectors).toBe(3);
    manager.addToIndex('test', 'v1', [1, 1, 0]); // overwrite
    expect(manager.getStats().totalVectors).toBe(3);
    const results = manager.searchIndex('test', [1, 1, 0], 1);
    expect(results[0]?.id).toBe('v1');
  });
});
