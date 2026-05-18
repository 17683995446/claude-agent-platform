/**
 * IndexManager - Manage multiple named VectorIndex instances
 */

import { VectorIndex } from './vector-index.js';

export class IndexManager {
  private indices: Map<string, VectorIndex> = new Map();

  createIndex(name: string, dimension: number, options?: object): void {
    if (this.indices.has(name)) {
      throw new Error(`Index '${name}' already exists`);
    }
    this.indices.set(name, new VectorIndex(dimension, options as { metric?: 'cosine' | 'euclidean' | 'dot' }));
  }

  deleteIndex(name: string): boolean {
    return this.indices.delete(name);
  }

  getIndex(name: string): VectorIndex | undefined {
    return this.indices.get(name);
  }

  listIndices(): string[] {
    return Array.from(this.indices.keys());
  }

  addToIndex(name: string, id: string, vector: number[], metadata?: object): void {
    const index = this.indices.get(name);
    if (!index) throw new Error(`Index '${name}' not found`);
    index.add(id, vector, metadata as Record<string, unknown>);
  }

  searchIndex(name: string, query: number[], topK: number): Array<{ id: string; score: number }> {
    const index = this.indices.get(name);
    if (!index) throw new Error(`Index '${name}' not found`);
    const results = index.search(query, topK);
    return results.map(r => ({ id: r.id, score: r.score }));
  }

  searchAll(query: number[], topK: number): Array<{ indexName: string; results: Array<{ id: string; score: number }> }> {
    const output: Array<{ indexName: string; results: Array<{ id: string; score: number }> }> = [];
    for (const [name, index] of this.indices) {
      const results = index.search(query, topK);
      output.push({
        indexName: name,
        results: results.map(r => ({ id: r.id, score: r.score })),
      });
    }
    return output;
  }

  getStats(): { indexCount: number; totalVectors: number; indices: Record<string, number> } {
    let totalVectors = 0;
    const indexSizes: Record<string, number> = {};
    for (const [name, index] of this.indices) {
      const size = index.size();
      indexSizes[name] = size;
      totalVectors += size;
    }
    return {
      indexCount: this.indices.size,
      totalVectors,
      indices: indexSizes,
    };
  }
}
