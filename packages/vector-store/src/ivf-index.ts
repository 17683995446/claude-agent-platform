/**
 * IVFIndex - Inverted File Index with k-means clustering for approximate nearest neighbor search
 */

import { cosineSimilarity, euclideanDistance, dotProduct, mean, normalize } from './vector-operations.js';

interface IVFVector {
  id: string;
  vector: number[];
}

export interface IVFOptions {
  nlist?: number;  // Number of clusters (default: 10)
  nprobe?: number; // Number of clusters to search (default: 1)
}

export class IVFIndex {
  private dimension: number;
  private nlist: number;
  private nprobe: number;
  private centroids: number[][] = [];
  private clusters: Map<number, IVFVector[]> = new Map();
  private allVectors: Map<string, number[]> = new Map();
  private built = false;

  constructor(dimension: number, options?: IVFOptions) {
    if (dimension <= 0) throw new Error('Dimension must be positive');
    this.dimension = dimension;
    this.nlist = options?.nlist ?? 10;
    this.nprobe = options?.nprobe ?? 1;
  }

  build(vectors: Array<{ id: string; vector: number[] }>): void {
    if (vectors.length === 0) throw new Error('Cannot build index with no vectors');

    this.allVectors.clear();
    for (const v of vectors) {
      if (v.vector.length !== this.dimension) {
        throw new Error(`Expected dimension ${this.dimension}, got ${v.vector.length}`);
      }
      this.allVectors.set(v.id, v.vector.slice());
    }

    const actualNlist = Math.min(this.nlist, vectors.length);
    this.centroids = this.kmeans(vectors.map(v => v.vector), actualNlist);
    this.assignClusters();
    this.built = true;
  }

  add(id: string, vector: number[]): void {
    if (vector.length !== this.dimension) {
      throw new Error(`Expected dimension ${this.dimension}, got ${vector.length}`);
    }
    this.allVectors.set(id, vector.slice());

    if (this.built && this.centroids.length > 0) {
      const clusterIdx = this.findNearestCluster(vector);
      const cluster = this.clusters.get(clusterIdx) ?? [];
      cluster.push({ id, vector: vector.slice() });
      this.clusters.set(clusterIdx, cluster);
    }
  }

  search(query: number[], topK: number): Array<{ id: string; score: number }> {
    if (!this.built || this.centroids.length === 0) return [];
    if (topK <= 0) return [];

    // Find nearest clusters
    const clusterDistances = this.centroids.map((centroid, idx) => ({
      idx,
      dist: cosineSimilarity(query, centroid),
    }));
    clusterDistances.sort((a, b) => b.dist - a.dist);
    const probeClusters = clusterDistances.slice(0, this.nprobe);

    // Collect candidates from probed clusters
    const candidates: Array<{ id: string; score: number }> = [];
    for (const cluster of probeClusters) {
      const vectors = this.clusters.get(cluster.idx) ?? [];
      for (const v of vectors) {
        const score = cosineSimilarity(query, v.vector);
        candidates.push({ id: v.id, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, topK);
  }

  getStats(): { clusters: number; totalVectors: number; avgClusterSize: number } {
    let totalInClusters = 0;
    for (const vectors of this.clusters.values()) {
      totalInClusters += vectors.length;
    }
    const activeClusters = this.clusters.size;
    return {
      clusters: activeClusters,
      totalVectors: this.allVectors.size,
      avgClusterSize: activeClusters > 0 ? totalInClusters / activeClusters : 0,
    };
  }

  private kmeans(vectors: number[][], k: number): number[][] {
    // Initialize centroids using random selection
    const shuffled = vectors.slice().sort(() => Math.random() - 0.5);
    let centroids: number[][] = shuffled.slice(0, k).map(v => v.slice());

    for (let iter = 0; iter < 50; iter++) {
      // Assign vectors to nearest centroid
      const assignments: number[][] = Array.from({ length: k }, () => []);
      for (const vec of vectors) {
        let bestIdx = 0;
        let bestSim = -Infinity;
        for (let c = 0; c < centroids.length; c++) {
          const sim = cosineSimilarity(vec, centroids[c]!);
          if (sim > bestSim) {
            bestSim = sim;
            bestIdx = c;
          }
        }
        assignments[bestIdx]!.push(vec);
      }

      // Update centroids
      const newCentroids: number[][] = [];
      for (let c = 0; c < k; c++) {
        if (assignments[c]!.length > 0) {
          newCentroids.push(normalize(mean(assignments[c]!)));
        } else {
          newCentroids.push(centroids[c]!.slice());
        }
      }

      // Check convergence
      let converged = true;
      for (let c = 0; c < k; c++) {
        const dist = euclideanDistance(newCentroids[c]!, centroids[c]!);
        if (dist > 0.001) {
          converged = false;
          break;
        }
      }
      centroids = newCentroids;
      if (converged) break;
    }

    return centroids;
  }

  private assignClusters(): void {
    this.clusters.clear();
    for (let c = 0; c < this.centroids.length; c++) {
      this.clusters.set(c, []);
    }
    for (const [id, vector] of this.allVectors) {
      const clusterIdx = this.findNearestCluster(vector);
      this.clusters.get(clusterIdx)!.push({ id, vector });
    }
  }

  private findNearestCluster(vector: number[]): number {
    let bestIdx = 0;
    let bestSim = -Infinity;
    for (let c = 0; c < this.centroids.length; c++) {
      const sim = cosineSimilarity(vector, this.centroids[c]!);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = c;
      }
    }
    return bestIdx;
  }
}
