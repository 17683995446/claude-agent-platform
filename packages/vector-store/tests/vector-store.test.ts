import { describe, test, expect, beforeEach } from 'bun:test';
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
// vector-operations.ts
// ============================================================
describe('vector-operations', () => {
  // cosineSimilarity
  describe('cosineSimilarity', () => {
    test('identical vectors have similarity 1', () => {
      const v = [1, 2, 3];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1);
    });

    test('orthogonal vectors have similarity 0', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });

    test('opposite vectors have similarity -1', () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    });

    test('throws on dimension mismatch', () => {
      expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
    });

    test('zero vectors return 0', () => {
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });

    test('returns correct value for known vectors', () => {
      expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2);
    });
  });

  // euclideanDistance
  describe('euclideanDistance', () => {
    test('same vector has distance 0', () => {
      expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBeCloseTo(0);
    });

    test('distance between [0,0] and [3,4] is 5', () => {
      expect(euclideanDistance([0, 0], [3, 4])).toBeCloseTo(5);
    });

    test('throws on dimension mismatch', () => {
      expect(() => euclideanDistance([1], [1, 2])).toThrow();
    });

    test('distance is non-negative', () => {
      expect(euclideanDistance([1, 2], [3, 4])).toBeGreaterThanOrEqual(0);
    });

    test('symmetric property', () => {
      const d1 = euclideanDistance([1, 2, 3], [4, 5, 6]);
      const d2 = euclideanDistance([4, 5, 6], [1, 2, 3]);
      expect(d1).toBeCloseTo(d2);
    });
  });

  // dotProduct
  describe('dotProduct', () => {
    test('dot product of [1,2,3] and [4,5,6] is 32', () => {
      expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32);
    });

    test('dot product with zero vector is 0', () => {
      expect(dotProduct([1, 2, 3], [0, 0, 0])).toBe(0);
    });

    test('throws on dimension mismatch', () => {
      expect(() => dotProduct([1], [1, 2])).toThrow();
    });

    test('commutative property', () => {
      expect(dotProduct([1, 2], [3, 4])).toBe(dotProduct([3, 4], [1, 2]));
    });

    test('dot product of orthogonal vectors is 0', () => {
      expect(dotProduct([1, 0], [0, 1])).toBeCloseTo(0);
    });
  });

  // normalize
  describe('normalize', () => {
    test('normalized vector has unit length', () => {
      const n = normalize([3, 4]);
      const len = Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]!);
      expect(len).toBeCloseTo(1);
    });

    test('zero vector returns itself', () => {
      const n = normalize([0, 0, 0]);
      expect(n).toEqual([0, 0, 0]);
    });

    test('does not mutate input', () => {
      const v = [3, 4];
      normalize(v);
      expect(v).toEqual([3, 4]);
    });

    test('preserves direction', () => {
      const n = normalize([2, 0]);
      expect(n[0]).toBeCloseTo(1);
      expect(n[1]).toBeCloseTo(0);
    });
  });

  // add
  describe('add', () => {
    test('adds element-wise', () => {
      expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    });

    test('throws on dimension mismatch', () => {
      expect(() => add([1], [1, 2])).toThrow();
    });

    test('commutative', () => {
      expect(add([1, 2], [3, 4])).toEqual(add([3, 4], [1, 2]));
    });

    test('adding zero vector returns same', () => {
      expect(add([1, 2], [0, 0])).toEqual([1, 2]);
    });
  });

  // subtract
  describe('subtract', () => {
    test('subtracts element-wise', () => {
      expect(subtract([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3]);
    });

    test('throws on dimension mismatch', () => {
      expect(() => subtract([1, 2], [1])).toThrow();
    });

    test('subtracting self gives zero', () => {
      expect(subtract([1, 2], [1, 2])).toEqual([0, 0]);
    });
  });

  // scale
  describe('scale', () => {
    test('scales by positive scalar', () => {
      expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
    });

    test('scales by zero', () => {
      expect(scale([1, 2], 0)).toEqual([0, 0]);
    });

    test('scales by negative scalar', () => {
      expect(scale([1, 2], -1)).toEqual([-1, -2]);
    });

    test('scales by fraction', () => {
      expect(scale([4, 6], 0.5)).toEqual([2, 3]);
    });
  });

  // mean
  describe('mean', () => {
    test('mean of empty array is empty', () => {
      expect(mean([])).toEqual([]);
    });

    test('mean of single vector is itself', () => {
      expect(mean([[1, 2, 3]])).toEqual([1, 2, 3]);
    });

    test('mean of two vectors', () => {
      expect(mean([[1, 2], [3, 4]])).toEqual([2, 3]);
    });

    test('mean of three vectors', () => {
      expect(mean([[1, 1], [2, 2], [3, 3]])).toEqual([2, 2]);
    });
  });

  // randomVector
  describe('randomVector', () => {
    test('returns correct dimension', () => {
      const v = randomVector(5);
      expect(v).toHaveLength(5);
    });

    test('has unit length', () => {
      const v = randomVector(10);
      const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      expect(len).toBeCloseTo(1, 10);
    });

    test('dimension 1 returns single element', () => {
      const v = randomVector(1);
      expect(v).toHaveLength(1);
      expect(Math.abs(v[0]!)).toBeCloseTo(1);
    });
  });

  // distance
  describe('distance', () => {
    test('cosine distance for identical vectors is 0', () => {
      expect(distance([1, 2], [1, 2], 'cosine')).toBeCloseTo(0);
    });

    test('euclidean distance works', () => {
      expect(distance([0, 0], [3, 4], 'euclidean')).toBeCloseTo(5);
    });

    test('dot distance for identical vectors is negative of dot product', () => {
      const v = [1, 2, 3];
      expect(distance(v, v, 'dot')).toBeCloseTo(-dotProduct(v, v));
    });

    test('cosine distance is 1 - similarity', () => {
      const a = [1, 0], b = [0, 1];
      expect(distance(a, b, 'cosine')).toBeCloseTo(1);
    });

    test('euclidean distance is non-negative', () => {
      expect(distance([1, 2], [3, 4], 'euclidean')).toBeGreaterThanOrEqual(0);
    });
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

  test('constructor sets dimension', () => {
    expect(index.size()).toBe(0);
  });

  test('constructor throws on non-positive dimension', () => {
    expect(() => new VectorIndex(0)).toThrow();
    expect(() => new VectorIndex(-1)).toThrow();
  });

  test('add and size', () => {
    index.add('a', [1, 2, 3]);
    expect(index.size()).toBe(1);
  });

  test('add throws on wrong dimension', () => {
    expect(() => index.add('a', [1, 2])).toThrow();
  });

  test('add with metadata', () => {
    index.add('a', [1, 2, 3], { label: 'test' });
    const entry = index.get('a');
    expect(entry?.metadata?.label).toBe('test');
  });

  test('has returns true for existing id', () => {
    index.add('a', [1, 2, 3]);
    expect(index.has('a')).toBe(true);
  });

  test('has returns false for missing id', () => {
    expect(index.has('missing')).toBe(false);
  });

  test('get returns vector and metadata', () => {
    index.add('a', [1, 2, 3], { x: 1 });
    const result = index.get('a');
    expect(result?.vector).toEqual([1, 2, 3]);
    expect(result?.metadata?.x).toBe(1);
  });

  test('get returns undefined for missing id', () => {
    expect(index.get('missing')).toBeUndefined();
  });

  test('remove returns true for existing id', () => {
    index.add('a', [1, 2, 3]);
    expect(index.remove('a')).toBe(true);
    expect(index.size()).toBe(0);
  });

  test('remove returns false for missing id', () => {
    expect(index.remove('missing')).toBe(false);
  });

  test('clear removes all vectors', () => {
    index.add('a', [1, 2, 3]);
    index.add('b', [4, 5, 6]);
    index.clear();
    expect(index.size()).toBe(0);
  });

  test('search returns results sorted by score', () => {
    index.add('a', [1, 0, 0]);
    index.add('b', [0, 1, 0]);
    const results = index.search([1, 0, 0], 2);
    expect(results[0]?.id).toBe('a');
    expect(results[0]?.score).toBeGreaterThan(results[1]!.score);
  });

  test('search results include vector', () => {
    index.add('a', [1, 0, 0]);
    const results = index.search([1, 0, 0], 1);
    expect(results[0]?.vector).toEqual([1, 0, 0]);
  });

  test('search with topK limits results', () => {
    index.add('a', [1, 0, 0]);
    index.add('b', [0, 1, 0]);
    index.add('c', [0, 0, 1]);
    const results = index.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
  });

  test('search with topK 0 returns empty', () => {
    index.add('a', [1, 0, 0]);
    expect(index.search([1, 0, 0], 0)).toEqual([]);
  });

  test('search on empty index returns empty', () => {
    expect(index.search([1, 0, 0], 5)).toEqual([]);
  });

  test('cosine metric (default)', () => {
    const idx = new VectorIndex(2, { metric: 'cosine' });
    idx.add('a', [1, 0]);
    idx.add('b', [0, 1]);
    const results = idx.search([1, 0], 2);
    expect(results[0]?.id).toBe('a');
    expect(results[0]?.score).toBeCloseTo(1);
  });

  test('euclidean metric', () => {
    const idx = new VectorIndex(2, { metric: 'euclidean' });
    idx.add('a', [1, 0]);
    idx.add('b', [10, 0]);
    const results = idx.search([1, 0], 2);
    expect(results[0]?.id).toBe('a');
  });

  test('dot metric', () => {
    const idx = new VectorIndex(2, { metric: 'dot' });
    idx.add('a', [1, 0]);
    idx.add('b', [0, 1]);
    const results = idx.search([1, 0], 2);
    expect(results[0]?.id).toBe('a');
    expect(results[0]?.score).toBeCloseTo(1);
  });

  test('add overwrites existing id', () => {
    index.add('a', [1, 2, 3]);
    index.add('a', [4, 5, 6]);
    expect(index.size()).toBe(1);
    const entry = index.get('a');
    expect(entry?.vector).toEqual([4, 5, 6]);
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

  test('constructor sets dimension', () => {
    expect(hnsw.getStats().elementCount).toBe(0);
  });

  test('constructor throws on non-positive dimension', () => {
    expect(() => new HNSWIndex(0)).toThrow();
  });

  test('add and search single vector', () => {
    hnsw.add('a', [1, 0, 0]);
    const results = hnsw.search([1, 0, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('a');
  });

  test('add throws on wrong dimension', () => {
    expect(() => hnsw.add('a', [1, 2])).toThrow();
  });

  test('search returns closest vectors', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('b', [0, 1, 0]);
    hnsw.add('c', [0, 0, 1]);
    const results = hnsw.search([1, 0, 0], 2);
    expect(results[0]?.id).toBe('a');
  });

  test('search with topK limits results', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('b', [0, 1, 0]);
    hnsw.add('c', [0, 0, 1]);
    const results = hnsw.search([1, 0, 0], 1);
    expect(results).toHaveLength(1);
  });

  test('search on empty index returns empty', () => {
    expect(hnsw.search([1, 0, 0], 5)).toEqual([]);
  });

  test('search with topK 0 returns empty', () => {
    hnsw.add('a', [1, 0, 0]);
    expect(hnsw.search([1, 0, 0], 0)).toEqual([]);
  });

  test('remove existing vector', () => {
    hnsw.add('a', [1, 0, 0]);
    expect(hnsw.remove('a')).toBe(true);
    expect(hnsw.getStats().elementCount).toBe(0);
  });

  test('remove non-existing vector returns false', () => {
    expect(hnsw.remove('missing')).toBe(false);
  });

  test('remove and search', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('b', [0, 1, 0]);
    hnsw.remove('a');
    const results = hnsw.search([1, 0, 0], 5);
    expect(results.find(r => r.id === 'a')).toBeUndefined();
  });

  test('getStats returns correct structure', () => {
    hnsw.add('a', [1, 0, 0]);
    const stats = hnsw.getStats();
    expect(stats).toHaveProperty('levels');
    expect(stats).toHaveProperty('totalConnections');
    expect(stats).toHaveProperty('elementCount');
    expect(stats.elementCount).toBe(1);
  });

  test('custom M parameter', () => {
    const idx = new HNSWIndex(3, { M: 4 });
    idx.add('a', [1, 0, 0]);
    expect(idx.getStats().elementCount).toBe(1);
  });

  test('custom efConstruction parameter', () => {
    const idx = new HNSWIndex(3, { efConstruction: 100 });
    idx.add('a', [1, 0, 0]);
    expect(idx.getStats().elementCount).toBe(1);
  });

  test('custom efSearch parameter', () => {
    const idx = new HNSWIndex(3, { efSearch: 20 });
    idx.add('a', [1, 0, 0]);
    const results = idx.search([1, 0, 0], 1);
    expect(results).toHaveLength(1);
  });

  test('add multiple vectors and search', () => {
    for (let i = 0; i < 20; i++) {
      hnsw.add(`v${i}`, [Math.random(), Math.random(), Math.random()]);
    }
    expect(hnsw.getStats().elementCount).toBe(20);
    const results = hnsw.search([0.5, 0.5, 0.5], 5);
    expect(results).toHaveLength(5);
  });

  test('search scores are between -1 and 1 (cosine)', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('b', [0, 1, 0]);
    const results = hnsw.search([1, 0, 0], 2);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(-1);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  test('update existing vector', () => {
    hnsw.add('a', [1, 0, 0]);
    hnsw.add('a', [0, 1, 0]);
    expect(hnsw.getStats().elementCount).toBe(1);
    const results = hnsw.search([0, 1, 0], 1);
    expect(results[0]?.id).toBe('a');
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

  test('constructor throws on non-positive maxSize', () => {
    expect(() => new EmbeddingCache(0, 1000)).toThrow();
    expect(() => new EmbeddingCache(-1, 1000)).toThrow();
  });

  test('constructor throws on non-positive ttlMs', () => {
    expect(() => new EmbeddingCache(5, 0)).toThrow();
    expect(() => new EmbeddingCache(5, -1)).toThrow();
  });

  test('set and get', () => {
    cache.set('key1', [1, 2, 3]);
    expect(cache.get('key1')).toEqual([1, 2, 3]);
  });

  test('get returns undefined for missing key', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  test('set overwrites existing key', () => {
    cache.set('key1', [1, 2, 3]);
    cache.set('key1', [4, 5, 6]);
    expect(cache.get('key1')).toEqual([4, 5, 6]);
  });

  test('LRU eviction', () => {
    cache.set('a', [1]);
    cache.set('b', [2]);
    cache.set('c', [3]);
    cache.set('d', [4]);
    cache.set('e', [5]);
    cache.set('f', [6]); // should evict 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('f')).toEqual([6]);
  });

  test('get updates LRU order', () => {
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

  test('compute returns cached value on hit', () => {
    let calls = 0;
    cache.set('key1', [1, 2, 3]);
    const result = cache.compute('key1', () => { calls++; return [4, 5, 6]; });
    expect(result).toEqual([1, 2, 3]);
    expect(calls).toBe(0);
  });

  test('compute computes and caches on miss', () => {
    let calls = 0;
    const result = cache.compute('key1', () => { calls++; return [4, 5, 6]; });
    expect(result).toEqual([4, 5, 6]);
    expect(calls).toBe(1);
    expect(cache.get('key1')).toEqual([4, 5, 6]);
  });

  test('invalidate removes key', () => {
    cache.set('key1', [1, 2, 3]);
    cache.invalidate('key1');
    expect(cache.get('key1')).toBeUndefined();
  });

  test('invalidate non-existing key does not throw', () => {
    cache.invalidate('missing');
  });

  test('clear removes all entries and resets stats', () => {
    cache.set('a', [1]);
    cache.set('b', [2]);
    cache.get('a');
    cache.get('missing');
    cache.clear();
    expect(cache.getStats().size).toBe(0);
    expect(cache.getStats().hits).toBe(0);
    expect(cache.getStats().misses).toBe(0);
  });

  test('getStats tracks hits and misses', () => {
    cache.set('a', [1]);
    cache.get('a'); // hit
    cache.get('missing'); // miss
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
  });

  test('getStats hitRate is 0 with no accesses', () => {
    const stats = cache.getStats();
    expect(stats.hitRate).toBe(0);
  });

  test('getStats size reflects current cache size', () => {
    cache.set('a', [1]);
    cache.set('b', [2]);
    expect(cache.getStats().size).toBe(2);
  });

  test('TTL expiration', () => {
    const shortCache = new EmbeddingCache(5, 1); // 1ms TTL
    shortCache.set('key1', [1, 2, 3]);
    // Wait for expiration
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(shortCache.get('key1')).toBeUndefined();
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

  test('chunk empty text returns empty', () => {
    expect(chunker.chunk('')).toEqual([]);
  });

  test('chunk short text returns single chunk', () => {
    expect(chunker.chunk('hello world')).toEqual(['hello world']);
  });

  test('chunk respects maxSize', () => {
    const text = 'a'.repeat(1000);
    const chunks = chunker.chunk(text, { maxSize: 200 });
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200);
    }
  });

  test('chunk with overlap', () => {
    const text = 'word '.repeat(200);
    const chunks = chunker.chunk(text, { maxSize: 100, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  test('chunk breaks at word boundary', () => {
    const text = 'hello world this is a test';
    const chunks = chunker.chunk(text, { maxSize: 15, overlap: 0 });
    // Chunks should not cut words in half
    for (const c of chunks) {
      if (c.length < text.length) {
        // If not the last chunk, it should end with a word boundary
        expect(c.endsWith(' ')).toBe(false);
      }
    }
  });

  test('chunkBySentence empty text', () => {
    expect(chunker.chunkBySentence('')).toEqual([]);
  });

  test('chunkBySentence groups sentences', () => {
    const text = 'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence. Sixth sentence.';
    const chunks = chunker.chunkBySentence(text, 2);
    expect(chunks.length).toBe(3);
  });

  test('chunkBySentence default maxSentences', () => {
    const text = 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.';
    const chunks = chunker.chunkBySentence(text);
    expect(chunks.length).toBe(2);
  });

  test('chunkByParagraph empty text', () => {
    expect(chunker.chunkByParagraph('')).toEqual([]);
  });

  test('chunkByParagraph splits on double newline', () => {
    const text = 'Para 1\n\nPara 2\n\nPara 3';
    const chunks = chunker.chunkByParagraph(text);
    expect(chunks).toEqual(['Para 1', 'Para 2', 'Para 3']);
  });

  test('chunkByParagraph trims whitespace', () => {
    const text = '  Para 1  \n\n  Para 2  ';
    const chunks = chunker.chunkByParagraph(text);
    expect(chunks).toEqual(['Para 1', 'Para 2']);
  });

  test('mergeChunks empty array', () => {
    expect(chunker.mergeChunks([], 100)).toEqual([]);
  });

  test('mergeChunks merges small chunks', () => {
    const chunks = ['hello', 'world', 'foo'];
    const merged = chunker.mergeChunks(chunks, 20);
    expect(merged.length).toBeLessThan(chunks.length);
  });

  test('mergeChunks respects maxSize', () => {
    const chunks = ['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10)];
    const merged = chunker.mergeChunks(chunks, 15);
    for (const m of merged) {
      expect(m.length).toBeLessThanOrEqual(15);
    }
  });

  test('getStats empty chunks', () => {
    const stats = chunker.getStats([]);
    expect(stats.count).toBe(0);
    expect(stats.avgLength).toBe(0);
    expect(stats.minLength).toBe(0);
    expect(stats.maxLength).toBe(0);
  });

  test('getStats computes correctly', () => {
    const chunks = ['short', 'medium length', 'very very long chunk here'];
    const stats = chunker.getStats(chunks);
    expect(stats.count).toBe(3);
    expect(stats.minLength).toBe(5);
    expect(stats.maxLength).toBe(25);
    expect(stats.avgLength).toBeGreaterThan(0);
  });

  test('getStats avgLength is correct', () => {
    const chunks = ['aa', 'bbbb'];
    const stats = chunker.getStats(chunks);
    expect(stats.avgLength).toBe(3);
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

  test('addDocument and getDocument', () => {
    store.addDocument({ id: '1', content: 'hello' });
    const doc = store.getDocument('1');
    expect(doc?.id).toBe('1');
    expect(doc?.content).toBe('hello');
  });

  test('addDocument with metadata', () => {
    store.addDocument({ id: '1', content: 'hello', metadata: { source: 'test' } });
    const doc = store.getDocument('1');
    expect(doc?.metadata?.source).toBe('test');
  });

  test('addDocument with embedding', () => {
    store.addDocument({ id: '1', content: 'hello', embedding: [1, 0, 0] });
    const doc = store.getDocument('1');
    expect(doc?.embedding).toEqual([1, 0, 0]);
  });

  test('getDocument returns undefined for missing', () => {
    expect(store.getDocument('missing')).toBeUndefined();
  });

  test('search returns results sorted by score', () => {
    store.addDocument({ id: '1', content: 'similar', embedding: [1, 0, 0] });
    store.addDocument({ id: '2', content: 'different', embedding: [0, 1, 0] });
    const results = store.search([1, 0, 0], 2);
    expect(results[0]?.id).toBe('1');
    expect(results[0]?.score).toBeGreaterThan(results[1]!.score);
  });

  test('search skips documents without embedding', () => {
    store.addDocument({ id: '1', content: 'no embedding' });
    store.addDocument({ id: '2', content: 'has embedding', embedding: [1, 0, 0] });
    const results = store.search([1, 0, 0], 5);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('2');
  });

  test('search with topK limits results', () => {
    store.addDocument({ id: '1', content: 'a', embedding: [1, 0, 0] });
    store.addDocument({ id: '2', content: 'b', embedding: [0, 1, 0] });
    store.addDocument({ id: '3', content: 'c', embedding: [0, 0, 1] });
    const results = store.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
  });

  test('search with topK 0 returns empty', () => {
    store.addDocument({ id: '1', content: 'a', embedding: [1, 0, 0] });
    expect(store.search([1, 0, 0], 0)).toEqual([]);
  });

  test('search on empty store returns empty', () => {
    expect(store.search([1, 0, 0], 5)).toEqual([]);
  });

  test('search results include content and metadata', () => {
    store.addDocument({ id: '1', content: 'test content', metadata: { key: 'val' }, embedding: [1, 0, 0] });
    const results = store.search([1, 0, 0], 1);
    expect(results[0]?.content).toBe('test content');
    expect(results[0]?.metadata?.key).toBe('val');
  });

  test('updateDocument content', () => {
    store.addDocument({ id: '1', content: 'old' });
    const result = store.updateDocument('1', { content: 'new' });
    expect(result).toBe(true);
    expect(store.getDocument('1')?.content).toBe('new');
  });

  test('updateDocument metadata', () => {
    store.addDocument({ id: '1', content: 'hello' });
    store.updateDocument('1', { metadata: { updated: true } });
    expect(store.getDocument('1')?.metadata?.updated).toBe(true);
  });

  test('updateDocument embedding', () => {
    store.addDocument({ id: '1', content: 'hello' });
    store.updateDocument('1', { embedding: [1, 0, 0] });
    expect(store.getDocument('1')?.embedding).toEqual([1, 0, 0]);
  });

  test('updateDocument returns false for missing', () => {
    expect(store.updateDocument('missing', { content: 'x' })).toBe(false);
  });

  test('deleteDocument returns true for existing', () => {
    store.addDocument({ id: '1', content: 'hello' });
    expect(store.deleteDocument('1')).toBe(true);
    expect(store.getDocument('1')).toBeUndefined();
  });

  test('deleteDocument returns false for missing', () => {
    expect(store.deleteDocument('missing')).toBe(false);
  });

  test('listDocuments returns all', () => {
    store.addDocument({ id: '1', content: 'a' });
    store.addDocument({ id: '2', content: 'b' });
    expect(store.listDocuments()).toHaveLength(2);
  });

  test('listDocuments with metadata filter', () => {
    store.addDocument({ id: '1', content: 'a', metadata: { type: 'x' } });
    store.addDocument({ id: '2', content: 'b', metadata: { type: 'y' } });
    const filtered = store.listDocuments({ metadata: { type: 'x' } });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('1');
  });

  test('listDocuments without filter returns all', () => {
    store.addDocument({ id: '1', content: 'a' });
    store.addDocument({ id: '2', content: 'b' });
    expect(store.listDocuments({})).toHaveLength(2);
  });

  test('getStats returns correct values', () => {
    store.addDocument({ id: '1', content: 'hello', embedding: [1, 0, 0] });
    store.addDocument({ id: '2', content: 'world' });
    const stats = store.getStats();
    expect(stats.total).toBe(2);
    expect(stats.withEmbedding).toBe(1);
    expect(stats.avgContentLength).toBe(5);
  });

  test('getStats on empty store', () => {
    const stats = store.getStats();
    expect(stats.total).toBe(0);
    expect(stats.withEmbedding).toBe(0);
    expect(stats.avgContentLength).toBe(0);
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

  test('default alpha is 0.7', () => {
    // Alpha affects scoring, not directly exposed, but we can check via search
    hybrid.addDocument('1', 'cat dog', [1, 0, 0]);
    hybrid.addDocument('2', 'car truck', [0, 1, 0]);
    const results = hybrid.search('cat', [1, 0, 0], 2);
    expect(results[0]?.id).toBe('1');
  });

  test('custom alpha', () => {
    const h = new HybridSearch({ alpha: 0.5 });
    h.addDocument('1', 'test', [1, 0, 0]);
    const results = h.search('test', [1, 0, 0], 1);
    expect(results).toHaveLength(1);
  });

  test('addDocument and search', () => {
    hybrid.addDocument('1', 'machine learning', [1, 0, 0]);
    hybrid.addDocument('2', 'cooking recipes', [0, 1, 0]);
    const results = hybrid.search('machine learning', [1, 0, 0], 2);
    expect(results[0]?.id).toBe('1');
  });

  test('search returns vectorScore and keywordScore', () => {
    hybrid.addDocument('1', 'test content', [1, 0, 0]);
    const results = hybrid.search('test', [1, 0, 0], 1);
    expect(results[0]).toHaveProperty('vectorScore');
    expect(results[0]).toHaveProperty('keywordScore');
    expect(results[0]).toHaveProperty('score');
  });

  test('search with topK limits results', () => {
    hybrid.addDocument('1', 'a', [1, 0, 0]);
    hybrid.addDocument('2', 'b', [0, 1, 0]);
    hybrid.addDocument('3', 'c', [0, 0, 1]);
    const results = hybrid.search('a', [1, 0, 0], 1);
    expect(results).toHaveLength(1);
  });

  test('search with topK 0 returns empty', () => {
    hybrid.addDocument('1', 'a', [1, 0, 0]);
    expect(hybrid.search('a', [1, 0, 0], 0)).toEqual([]);
  });

  test('search on empty returns empty', () => {
    expect(hybrid.search('test', [1, 0, 0], 5)).toEqual([]);
  });

  test('removeDocument', () => {
    hybrid.addDocument('1', 'test', [1, 0, 0]);
    hybrid.removeDocument('1');
    expect(hybrid.search('test', [1, 0, 0], 5)).toEqual([]);
  });

  test('removeDocument non-existing does not throw', () => {
    hybrid.removeDocument('missing');
  });

  test('setAlpha', () => {
    hybrid.setAlpha(0.3);
    hybrid.addDocument('1', 'cat', [1, 0, 0]);
    hybrid.addDocument('2', 'dog', [0.9, 0.1, 0]);
    const results = hybrid.search('cat', [1, 0, 0], 2);
    expect(results).toHaveLength(2);
  });

  test('setAlpha throws for invalid values', () => {
    expect(() => hybrid.setAlpha(-0.1)).toThrow();
    expect(() => hybrid.setAlpha(1.1)).toThrow();
  });

  test('setAlpha accepts 0', () => {
    hybrid.setAlpha(0);
    expect(() => {}).not.toThrow();
  });

  test('setAlpha accepts 1', () => {
    hybrid.setAlpha(1);
    expect(() => {}).not.toThrow();
  });

  test('getStats returns correct structure', () => {
    hybrid.addDocument('1', 'test', [1, 0, 0]);
    hybrid.search('test', [1, 0, 0], 1);
    const stats = hybrid.getStats();
    expect(stats.totalDocuments).toBe(1);
    expect(stats.vectorSearches).toBe(1);
    expect(stats.keywordSearches).toBe(1);
    expect(stats.hybridSearches).toBe(1);
  });

  test('getStats initial values', () => {
    const stats = hybrid.getStats();
    expect(stats.totalDocuments).toBe(0);
    expect(stats.vectorSearches).toBe(0);
    expect(stats.keywordSearches).toBe(0);
    expect(stats.hybridSearches).toBe(0);
  });

  test('keyword matching works', () => {
    hybrid.addDocument('1', 'artificial intelligence', [0.5, 0.5, 0]);
    hybrid.addDocument('2', 'cooking recipes', [0.5, 0.5, 0]);
    const results = hybrid.search('artificial intelligence', [0.5, 0.5, 0], 2);
    expect(results[0]?.id).toBe('1');
  });

  test('addDocument with metadata', () => {
    hybrid.addDocument('1', 'test', [1, 0, 0], { source: 'docs' });
    const results = hybrid.search('test', [1, 0, 0], 1);
    expect(results[0]?.content).toBe('test');
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

  test('constructor throws on non-positive dimension', () => {
    expect(() => new IVFIndex(0)).toThrow();
  });

  test('build with vectors', () => {
    const vectors = [
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
      { id: '3', vector: [0, 0, 1] },
    ];
    ivf.build(vectors);
    const stats = ivf.getStats();
    expect(stats.totalVectors).toBe(3);
  });

  test('build throws on empty vectors', () => {
    expect(() => ivf.build([])).toThrow();
  });

  test('build throws on wrong dimension', () => {
    expect(() => ivf.build([{ id: '1', vector: [1, 2] }])).toThrow();
  });

  test('search after build returns results', () => {
    ivf.build([
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
    ]);
    const results = ivf.search([1, 0, 0], 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('1');
  });

  test('search before build returns empty', () => {
    expect(ivf.search([1, 0, 0], 5)).toEqual([]);
  });

  test('search with topK 0 returns empty', () => {
    ivf.build([{ id: '1', vector: [1, 0, 0] }]);
    expect(ivf.search([1, 0, 0], 0)).toEqual([]);
  });

  test('search with topK limits results', () => {
    ivf.build([
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
      { id: '3', vector: [0, 0, 1] },
    ]);
    const results = ivf.search([1, 0, 0], 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test('add after build', () => {
    ivf.build([{ id: '1', vector: [1, 0, 0] }]);
    ivf.add('2', [0, 1, 0]);
    expect(ivf.getStats().totalVectors).toBe(2);
  });

  test('add throws on wrong dimension', () => {
    ivf.build([{ id: '1', vector: [1, 0, 0] }]);
    expect(() => ivf.add('2', [1, 2])).toThrow();
  });

  test('getStats returns correct structure', () => {
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

  test('custom nlist', () => {
    const idx = new IVFIndex(3, { nlist: 2 });
    idx.build([
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
      { id: '3', vector: [0, 0, 1] },
    ]);
    const stats = idx.getStats();
    expect(stats.clusters).toBeLessThanOrEqual(2);
  });

  test('custom nprobe', () => {
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

  test('search scores are cosine similarities', () => {
    ivf.build([{ id: '1', vector: [1, 0, 0] }]);
    const results = ivf.search([1, 0, 0], 1);
    expect(results[0]?.score).toBeCloseTo(1);
  });

  test('build with more vectors than nlist', () => {
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

  test('nlist capped at vector count', () => {
    const idx = new IVFIndex(3, { nlist: 100 });
    idx.build([
      { id: '1', vector: [1, 0, 0] },
      { id: '2', vector: [0, 1, 0] },
    ]);
    const stats = idx.getStats();
    expect(stats.clusters).toBeLessThanOrEqual(2);
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

  test('createIndex', () => {
    manager.createIndex('test', 3);
    expect(manager.listIndices()).toContain('test');
  });

  test('createIndex throws on duplicate name', () => {
    manager.createIndex('test', 3);
    expect(() => manager.createIndex('test', 3)).toThrow();
  });

  test('deleteIndex', () => {
    manager.createIndex('test', 3);
    expect(manager.deleteIndex('test')).toBe(true);
    expect(manager.listIndices()).not.toContain('test');
  });

  test('deleteIndex returns false for missing', () => {
    expect(manager.deleteIndex('missing')).toBe(false);
  });

  test('getIndex returns index', () => {
    manager.createIndex('test', 3);
    const idx = manager.getIndex('test');
    expect(idx).toBeDefined();
    expect(idx).toBeInstanceOf(VectorIndex);
  });

  test('getIndex returns undefined for missing', () => {
    expect(manager.getIndex('missing')).toBeUndefined();
  });

  test('listIndices returns all names', () => {
    manager.createIndex('a', 3);
    manager.createIndex('b', 5);
    const names = manager.listIndices();
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).toHaveLength(2);
  });

  test('listIndices on empty manager', () => {
    expect(manager.listIndices()).toEqual([]);
  });

  test('addToIndex', () => {
    manager.createIndex('test', 3);
    manager.addToIndex('test', 'v1', [1, 2, 3]);
    const idx = manager.getIndex('test')!;
    expect(idx.has('v1')).toBe(true);
  });

  test('addToIndex throws for missing index', () => {
    expect(() => manager.addToIndex('missing', 'v1', [1, 2, 3])).toThrow();
  });

  test('addToIndex with metadata', () => {
    manager.createIndex('test', 3);
    manager.addToIndex('test', 'v1', [1, 2, 3], { key: 'val' });
    const idx = manager.getIndex('test')!;
    const entry = idx.get('v1');
    expect(entry?.metadata?.key).toBe('val');
  });

  test('searchIndex', () => {
    manager.createIndex('test', 3);
    manager.addToIndex('test', 'v1', [1, 0, 0]);
    manager.addToIndex('test', 'v2', [0, 1, 0]);
    const results = manager.searchIndex('test', [1, 0, 0], 1);
    expect(results[0]?.id).toBe('v1');
  });

  test('searchIndex throws for missing index', () => {
    expect(() => manager.searchIndex('missing', [1, 0, 0], 5)).toThrow();
  });

  test('searchAll searches all indices', () => {
    manager.createIndex('a', 3);
    manager.createIndex('b', 3);
    manager.addToIndex('a', 'v1', [1, 0, 0]);
    manager.addToIndex('b', 'v2', [0, 1, 0]);
    const results = manager.searchAll([1, 0, 0], 5);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.indexName)).toContain('a');
    expect(results.map(r => r.indexName)).toContain('b');
  });

  test('searchAll on empty manager', () => {
    expect(manager.searchAll([1, 0, 0], 5)).toEqual([]);
  });

  test('getStats returns correct structure', () => {
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

  test('getStats on empty manager', () => {
    const stats = manager.getStats();
    expect(stats.indexCount).toBe(0);
    expect(stats.totalVectors).toBe(0);
    expect(Object.keys(stats.indices)).toHaveLength(0);
  });

  test('createIndex with options', () => {
    manager.createIndex('test', 3, { metric: 'euclidean' });
    const idx = manager.getIndex('test')!;
    manager.addToIndex('test', 'v1', [1, 0, 0]);
    const results = manager.searchIndex('test', [1, 0, 0], 1);
    expect(results[0]?.id).toBe('v1');
  });

  test('deleteIndex and createIndex with same name', () => {
    manager.createIndex('test', 3);
    manager.deleteIndex('test');
    manager.createIndex('test', 5);
    expect(manager.listIndices()).toContain('test');
  });
});
