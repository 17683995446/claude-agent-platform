/**
 * HNSWIndex - Simplified Hierarchical Navigable Small World graph index
 * A multi-layer proximity graph for approximate nearest neighbor search.
 */

import { cosineSimilarity, euclideanDistance, dotProduct, normalize } from './vector-operations.js';

interface HNSWNode {
  id: string;
  vector: number[];
  neighbors: Map<number, Set<string>>; // level -> set of neighbor ids
  maxLevel: number;
}

export interface HNSWOptions {
  M?: number;           // Max connections per node per layer (default: 16)
  efConstruction?: number; // Size of dynamic candidate list during construction (default: 200)
  efSearch?: number;    // Size of dynamic candidate list during search (default: 50)
}

export class HNSWIndex {
  private dimension: number;
  private M: number;
  private efConstruction: number;
  private efSearch: number;
  private nodes: Map<string, HNSWNode> = new Map();
  private entryPoint: string | null = null;
  private maxLevel = 0;
  private mL: number; // level multiplier

  constructor(dimension: number, options?: HNSWOptions) {
    if (dimension <= 0) throw new Error('Dimension must be positive');
    this.dimension = dimension;
    this.M = options?.M ?? 16;
    this.efConstruction = options?.efConstruction ?? 200;
    this.efSearch = options?.efSearch ?? 50;
    this.mL = 1 / Math.log(this.M);
  }

  add(id: string, vector: number[]): void {
    if (vector.length !== this.dimension) {
      throw new Error(`Expected dimension ${this.dimension}, got ${vector.length}`);
    }
    if (this.nodes.has(id)) {
      // Update existing node
      const node = this.nodes.get(id)!;
      node.vector = vector.slice();
      return;
    }

    const nodeLevel = this.randomLevel();
    const node: HNSWNode = {
      id,
      vector: vector.slice(),
      neighbors: new Map(),
      maxLevel: nodeLevel,
    };
    for (let l = 0; l <= nodeLevel; l++) {
      node.neighbors.set(l, new Set());
    }
    this.nodes.set(id, node);

    if (!this.entryPoint) {
      this.entryPoint = id;
      this.maxLevel = nodeLevel;
      return;
    }

    const ep = this.entryPoint;
    const epNode = this.nodes.get(ep)!;

    // Traverse from top level down to nodeLevel + 1
    let currentId = ep;
    for (let l = this.maxLevel; l > nodeLevel; l--) {
      currentId = this.greedyClosest(currentId, vector, l);
    }

    // Insert at levels nodeLevel down to 0
    for (let l = Math.min(nodeLevel, this.maxLevel); l >= 0; l--) {
      const candidates = this.searchLayer(vector, currentId, this.efConstruction, l);
      const topM = candidates.slice(0, this.M);
      for (const candidate of topM) {
        node.neighbors.get(l)!.add(candidate.id);
        const neighborNode = this.nodes.get(candidate.id)!;
        neighborNode.neighbors.get(l)!.add(id);
        // Prune if too many neighbors
        if (neighborNode.neighbors.get(l)!.size > this.M * 2) {
          const neighborCandidates = Array.from(neighborNode.neighbors.get(l)!)
            .map(nid => ({
              id: nid,
              score: this.similarity(vector, this.nodes.get(nid)!.vector),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, this.M);
          neighborNode.neighbors.set(l, new Set(neighborCandidates.map(c => c.id)));
        }
      }
      if (topM.length > 0) {
        currentId = topM[0]!.id;
      }
    }

    if (nodeLevel > this.maxLevel) {
      this.maxLevel = nodeLevel;
      this.entryPoint = id;
    }
  }

  search(query: number[], topK: number): Array<{ id: string; score: number }> {
    if (!this.entryPoint || this.nodes.size === 0) return [];
    if (topK <= 0) return [];

    let currentId = this.entryPoint!;

    // Traverse from top level down to level 1
    for (let l = this.maxLevel; l > 0; l--) {
      currentId = this.greedyClosest(currentId, query, l);
    }

    // Search at level 0
    const candidates = this.searchLayer(query, currentId, Math.max(this.efSearch, topK), 0);
    return candidates.slice(0, topK).map(c => ({ id: c.id, score: c.score }));
  }

  remove(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    // Remove from all neighbors
    for (let l = 0; l <= node.maxLevel; l++) {
      const neighbors = node.neighbors.get(l);
      if (neighbors) {
        for (const neighborId of neighbors) {
          const neighborNode = this.nodes.get(neighborId);
          if (neighborNode && neighborNode.neighbors.has(l)) {
            neighborNode.neighbors.get(l)!.delete(id);
          }
        }
      }
    }

    this.nodes.delete(id);

    if (this.entryPoint === id) {
      if (this.nodes.size === 0) {
        this.entryPoint = null;
        this.maxLevel = 0;
      } else {
        // Pick a new entry point (any node with the highest level)
        let bestId = '';
        let bestLevel = -1;
        for (const [nid, n] of this.nodes) {
          if (n.maxLevel > bestLevel) {
            bestLevel = n.maxLevel;
            bestId = nid;
          }
        }
        this.entryPoint = bestId;
        this.maxLevel = bestLevel;
      }
    }

    return true;
  }

  getStats(): { levels: number; totalConnections: number; elementCount: number } {
    let totalConnections = 0;
    for (const node of this.nodes.values()) {
      for (const neighbors of node.neighbors.values()) {
        totalConnections += neighbors.size;
      }
    }
    return {
      levels: this.maxLevel + 1,
      totalConnections,
      elementCount: this.nodes.size,
    };
  }

  private randomLevel(): number {
    const r = Math.max(Math.random(), 1e-10);
    const level = Math.floor(-Math.log(r) * this.mL);
    return Math.min(level, 32);
  }

  private similarity(a: number[], b: number[]): number {
    return cosineSimilarity(a, b);
  }

  private greedyClosest(currentId: string, query: number[], level: number): string {
    let bestId = currentId;
    let bestScore = this.similarity(query, this.nodes.get(currentId)!.vector);
    let changed = true;
    const visited = new Set<string>([currentId]);

    while (changed) {
      changed = false;
      const currentNode = this.nodes.get(bestId)!;
      const neighbors = currentNode.neighbors.get(level);
      if (!neighbors) break;
      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;
        const score = this.similarity(query, neighborNode.vector);
        if (score > bestScore) {
          bestScore = score;
          bestId = neighborId;
          changed = true;
        }
      }
    }
    return bestId;
  }

  private searchLayer(
    query: number[],
    entryId: string,
    ef: number,
    level: number
  ): Array<{ id: string; score: number }> {
    const visited = new Set<string>([entryId]);
    const candidates: Array<{ id: string; score: number }> = [];
    const results: Array<{ id: string; score: number }> = [];

    const entryScore = this.similarity(query, this.nodes.get(entryId)!.vector);
    candidates.push({ id: entryId, score: entryScore });
    results.push({ id: entryId, score: entryScore });

    while (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const closest = candidates.shift()!;
      const farthest = results[results.length - 1]!;

      if (closest.score < farthest!.score && results.length >= ef) break;

      const node = this.nodes.get(closest.id);
      if (!node) continue;
      const neighbors = node.neighbors.get(level);
      if (!neighbors) continue;

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;
        const score = this.similarity(query, neighborNode.vector);

        if (results.length < ef || score > results[results.length - 1]!.score) {
          candidates.push({ id: neighborId, score });
          results.push({ id: neighborId, score });
          results.sort((a, b) => b.score - a.score);
          if (results.length > ef) {
            results.pop();
          }
        }
      }
    }

    return results;
  }
}
