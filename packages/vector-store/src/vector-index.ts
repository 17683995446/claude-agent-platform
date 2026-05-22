/**
 * VectorIndex - Core vector storage and similarity search
 */

import {
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalize,
} from './vector-operations.js';

export type SimilarityMetric = 'cosine' | 'euclidean' | 'dot';

export interface VectorIndexOptions {
  metric?: SimilarityMetric;
}

export interface VectorEntry {
  id: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  vector: number[];
  metadata?: Record<string, unknown>;
  score: number;
}

export class VectorIndex {
  private vectors: Map<string, VectorEntry> = new Map();
  private dimension: number;
  private metric: SimilarityMetric;

  constructor(dimension: number, options?: VectorIndexOptions) {
    if (dimension <= 0) throw new Error('Dimension must be positive');
    this.dimension = dimension;
    this.metric = options?.metric ?? 'cosine';
  }

  add(id: string, vector: number[], metadata?: Record<string, unknown>): void {
    if (vector.length !== this.dimension) {
      throw new Error(`Expected dimension ${this.dimension}, got ${vector.length}`);
    }
    this.vectors.set(id, { id, vector: vector.slice(), metadata });
  }

  remove(id: string): boolean {
    return this.vectors.delete(id);
  }

  search(query: number[], topK: number): SearchResult[] {
    if (topK <= 0) return [];
    if (query.length !== this.dimension) {
      throw new Error(`Query dimension ${query.length} does not match index dimension ${this.dimension}`);
    }

    const results: SearchResult[] = [];

    for (const entry of this.vectors.values()) {
      const score = this.computeScore(query, entry.vector);
      results.push({
        id: entry.id,
        vector: entry.vector,
        score,
        metadata: entry.metadata,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  get(id: string): { vector: number[]; metadata?: Record<string, unknown> } | undefined {
    const entry = this.vectors.get(id);
    if (!entry) return undefined;
    return { vector: entry.vector, metadata: entry.metadata };
  }

  has(id: string): boolean {
    return this.vectors.has(id);
  }

  size(): number {
    return this.vectors.size;
  }

  clear(): void {
    this.vectors.clear();
  }

  private computeScore(query: number[], vector: number[]): number {
    switch (this.metric) {
      case 'cosine':
        return cosineSimilarity(query, vector);
      case 'euclidean':
        return 1 / (1 + euclideanDistance(query, vector));
      case 'dot':
        return dotProduct(query, vector);
      default:
        throw new Error(`Unknown metric: ${this.metric}`);
    }
  }
}
