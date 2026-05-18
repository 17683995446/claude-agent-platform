/**
 * EmbeddingIndex - Vector similarity search over graph entities.
 *
 * Provides vector embeddings storage, similarity search, nearest neighbor
 * finding, index building, and clustering capabilities.
 */

/** Embedding entry */
export interface EmbeddingEntry {
  id: string;
  vector: number[];
}

/** Similarity search result */
export interface SimilarityResult {
  id: string;
  score: number;
  vector?: number[];
}

/** Cluster result */
export interface ClusterResult {
  clusters: Map<number, string[]>;
  centroids: number[][];
}

/** Embedding function type */
export type EmbedFn = (entity: string) => number[];

/** Clustering algorithm */
export type ClusteringAlgorithm = 'kmeans' | 'dbscan';

/**
 * EmbeddingIndex provides vector similarity search over graph entities.
 *
 * @example
 * ```typescript
 * const index = new EmbeddingIndex(128);
 * index.addEmbedding('node1', [0.1, 0.2, 0.3, ...]);
 * const results = index.searchSimilar([0.15, 0.25, 0.35, ...], 5);
 * ```
 */
export class EmbeddingIndex {
  private dimension: number;
  private embeddings: Map<string, number[]> = new Map();

  /**
   * Create a new EmbeddingIndex.
   * @param dimension - Vector dimension
   */
  constructor(dimension: number) {
    this.dimension = dimension;
  }

  /**
   * Add or update an embedding for an entity.
   * @param id - Entity ID
   * @param vector - Embedding vector
   * @throws {Error} If vector dimension does not match
   */
  addEmbedding(id: string, vector: number[]): void {
    if (vector.length !== this.dimension) {
      throw new Error(`Vector dimension ${vector.length} does not match expected ${this.dimension}`);
    }
    this.embeddings.set(id, vector);
  }

  /**
   * Search for similar vectors.
   * @param vector - Query vector
   * @param topK - Number of results to return
   * @returns Array of similarity results sorted by score descending
   */
  searchSimilar(vector: number[], topK: number): SimilarityResult[] {
    if (vector.length !== this.dimension) {
      throw new Error(`Query vector dimension ${vector.length} does not match expected ${this.dimension}`);
    }

    const results: SimilarityResult[] = [];

    for (const [id, embedding] of this.embeddings) {
      const score = this.cosineSimilarity(vector, embedding);
      results.push({ id, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Build an index from entities using an embedding function.
   * @param entities - Array of entity identifiers
   * @param embedFn - Function to generate embeddings
   */
  buildIndex(entities: string[], embedFn: EmbedFn): void {
    for (const entity of entities) {
      const vector = embedFn(entity);
      this.addEmbedding(entity, vector);
    }
  }

  /**
   * Update an existing embedding.
   * @param id - Entity ID
   * @param vector - New embedding vector
   * @throws {Error} If entity does not exist or dimension mismatch
   */
  updateEmbedding(id: string, vector: number[]): void {
    if (!this.embeddings.has(id)) {
      throw new Error(`Entity '${id}' does not exist in the index`);
    }
    this.addEmbedding(id, vector);
  }

  /**
   * Remove an embedding from the index.
   * @param id - Entity ID to remove
   * @returns true if the embedding was found and removed
   */
  removeEmbedding(id: string): boolean {
    return this.embeddings.delete(id);
  }

  /**
   * Find nearest neighbors of a specific entity.
   * @param id - Entity ID
   * @param topK - Number of neighbors to return
   * @returns Array of similarity results
   * @throws {Error} If entity does not exist
   */
  findNearestNeighbors(id: string, topK: number): SimilarityResult[] {
    const vector = this.embeddings.get(id);
    if (!vector) {
      throw new Error(`Entity '${id}' does not exist in the index`);
    }

    const results = this.searchSimilar(vector, topK + 1);
    // Exclude the entity itself
    return results.filter(r => r.id !== id).slice(0, topK);
  }

  /**
   * Cluster embeddings into k groups.
   * @param k - Number of clusters
   * @param algorithm - Clustering algorithm (default 'kmeans')
   * @returns Cluster result with assignments and centroids
   */
  cluster(k: number, algorithm: ClusteringAlgorithm = 'kmeans'): ClusterResult {
    switch (algorithm) {
      case 'kmeans':
        return this.kMeansClustering(k);
      case 'dbscan':
        return this.dbscanClustering();
      default:
        return this.kMeansClustering(k);
    }
  }

  /**
   * Get the number of embeddings in the index.
   */
  size(): number {
    return this.embeddings.size;
  }

  /**
   * Get an embedding by ID.
   */
  getEmbedding(id: string): number[] | undefined {
    return this.embeddings.get(id);
  }

  /**
   * Check if an entity has an embedding.
   */
  has(id: string): boolean {
    return this.embeddings.has(id);
  }

  /**
   * Clear all embeddings.
   */
  clear(): void {
    this.embeddings.clear();
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }

  /**
   * K-Means clustering algorithm.
   */
  private kMeansClustering(k: number): ClusterResult {
    const ids = Array.from(this.embeddings.keys());
    const n = ids.length;

    if (n === 0) return { clusters: new Map(), centroids: [] };
    if (k >= n) {
      const clusters = new Map<number, string[]>();
      const centroids: number[][] = [];
      ids.forEach((id, i) => {
        clusters.set(i, [id]);
        centroids.push(this.embeddings.get(id)!);
      });
      return { clusters, centroids };
    }

    // Initialize centroids using k-means++
    const centroids = this.initializeCentroids(k);

    const assignments = new Map<string, number>();
    const maxIterations = 100;

    for (let iter = 0; iter < maxIterations; iter++) {
      let changed = false;

      // Assign each point to nearest centroid
      for (const id of ids) {
        const vector = this.embeddings.get(id)!;
        let minDist = Infinity;
        let bestCluster = 0;

        for (let c = 0; c < k; c++) {
          const dist = this.euclideanDistance(vector, centroids[c]);
          if (dist < minDist) {
            minDist = dist;
            bestCluster = c;
          }
        }

        if (assignments.get(id) !== bestCluster) {
          assignments.set(id, bestCluster);
          changed = true;
        }
      }

      if (!changed) break;

      // Update centroids
      for (let c = 0; c < k; c++) {
        const members = ids.filter(id => assignments.get(id) === c);
        if (members.length === 0) continue;

        const newCentroid = new Array(this.dimension).fill(0);
        for (const id of members) {
          const vector = this.embeddings.get(id)!;
          for (let d = 0; d < this.dimension; d++) {
            newCentroid[d] += vector[d];
          }
        }
        for (let d = 0; d < this.dimension; d++) {
          newCentroid[d] /= members.length;
        }
        centroids[c] = newCentroid;
      }
    }

    // Build cluster map
    const clusters = new Map<number, string[]>();
    for (let c = 0; c < k; c++) {
      clusters.set(c, []);
    }
    for (const [id, cluster] of assignments) {
      clusters.get(cluster)!.push(id);
    }

    return { clusters, centroids };
  }

  /**
   * Initialize centroids using k-means++ algorithm.
   */
  private initializeCentroids(k: number): number[][] {
    const ids = Array.from(this.embeddings.keys());
    const centroids: number[][] = [];

    // First centroid: random
    const firstId = ids[Math.floor(Math.random() * ids.length)];
    centroids.push([...this.embeddings.get(firstId)!]);

    for (let c = 1; c < k; c++) {
      const distances = ids.map(id => {
        const vector = this.embeddings.get(id)!;
        let minDist = Infinity;
        for (const centroid of centroids) {
          const dist = this.euclideanDistance(vector, centroid);
          if (dist < minDist) minDist = dist;
        }
        return minDist * minDist;
      });

      const totalDist = distances.reduce((a, b) => a + b, 0);
      let random = Math.random() * totalDist;
      let selectedIdx = 0;

      for (let i = 0; i < distances.length; i++) {
        random -= distances[i];
        if (random <= 0) {
          selectedIdx = i;
          break;
        }
      }

      centroids.push([...this.embeddings.get(ids[selectedIdx])!]);
    }

    return centroids;
  }

  /**
   * Simple DBSCAN-like clustering.
   */
  private dbscanClustering(eps: number = 0.5, minPts: number = 2): ClusterResult {
    const ids = Array.from(this.embeddings.keys());
    const clusters = new Map<number, string[]>();
    let clusterId = 0;
    const visited = new Set<string>();

    for (const id of ids) {
      if (visited.has(id)) continue;
      visited.add(id);

      const neighbors = this.getNeighborsWithinRadius(id, eps);

      if (neighbors.length < minPts) continue;

      clusters.set(clusterId, [id]);

      const queue = [...neighbors];
      while (queue.length > 0) {
        const neighborId = queue.shift()!;

        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          const neighborNeighbors = this.getNeighborsWithinRadius(neighborId, eps);
          if (neighborNeighbors.length >= minPts) {
            queue.push(...neighborNeighbors.filter(n => !visited.has(n)));
          }
        }

        // Add to cluster if not already in one
        let inCluster = false;
        for (const [, members] of clusters) {
          if (members.includes(neighborId)) {
            inCluster = true;
            break;
          }
        }
        if (!inCluster) {
          clusters.get(clusterId)!.push(neighborId);
        }
      }

      clusterId++;
    }

    // Compute centroids
    const centroids: number[][] = [];
    for (const [, members] of clusters) {
      if (members.length === 0) {
        centroids.push(new Array(this.dimension).fill(0));
        continue;
      }
      const centroid = new Array(this.dimension).fill(0);
      for (const id of members) {
        const vector = this.embeddings.get(id)!;
        for (let d = 0; d < this.dimension; d++) {
          centroid[d] += vector[d];
        }
      }
      for (let d = 0; d < this.dimension; d++) {
        centroid[d] /= members.length;
      }
      centroids.push(centroid);
    }

    return { clusters, centroids };
  }

  /**
   * Get neighbors within a cosine distance radius.
   */
  private getNeighborsWithinRadius(id: string, eps: number): string[] {
    const vector = this.embeddings.get(id)!;
    const neighbors: string[] = [];

    for (const [otherId, otherVector] of this.embeddings) {
      if (otherId === id) continue;
      const similarity = this.cosineSimilarity(vector, otherVector);
      if (1 - similarity <= eps) {
        neighbors.push(otherId);
      }
    }

    return neighbors;
  }

  /**
   * Compute Euclidean distance between two vectors.
   */
  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }
}
