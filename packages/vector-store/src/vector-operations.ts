/**
 * VectorOperations - Mathematical operations on vectors
 */

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} !== ${b.length}`);
  }
  const dot = dotProduct(a, b);
  const normA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

/**
 * Compute Euclidean distance between two vectors
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} !== ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Compute dot product of two vectors
 */
export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} !== ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

/**
 * L2 normalize a vector
 */
export function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector.slice();
  return vector.map(v => v / norm);
}

/**
 * Add two vectors element-wise
 */
export function add(a: number[], b: number[]): number[] {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} !== ${b.length}`);
  }
  return a.map((v, i) => v + b[i]!);
}

/**
 * Subtract vector b from vector a element-wise
 */
export function subtract(a: number[], b: number[]): number[] {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} !== ${b.length}`);
  }
  return a.map((v, i) => v - b[i]!);
}

/**
 * Scale a vector by a scalar
 */
export function scale(vector: number[], scalar: number): number[] {
  return vector.map(v => v * scalar);
}

/**
 * Compute the mean of a set of vectors
 */
export function mean(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0]!.length;
  for (let i = 1; i < vectors.length; i++) {
    if (vectors[i]!.length !== dim) {
      throw new Error(`All vectors must have the same dimension: expected ${dim}, got ${vectors[i]!.length}`);
    }
  }
  const result = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      result[i]! += vec[i]!;
    }
  }
  return result.map(v => v / vectors.length);
}

/**
 * Generate a random unit vector of given dimension
 */
export function randomVector(dimension: number): number[] {
  const vec = Array.from({ length: dimension }, () => Math.random() - 0.5);
  return normalize(vec);
}

/**
 * Compute distance between two vectors using the specified metric.
 * For 'cosine', returns 1 - cosineSimilarity.
 * For 'euclidean', returns euclideanDistance.
 * For 'dot', returns -dotProduct (negated so lower = more similar).
 */
export function distance(
  a: number[],
  b: number[],
  metric: 'cosine' | 'euclidean' | 'dot'
): number {
  switch (metric) {
    case 'cosine':
      return 1 - cosineSimilarity(a, b);
    case 'euclidean':
      return euclideanDistance(a, b);
    case 'dot':
      return -dotProduct(a, b);
    default:
      throw new Error(`Unknown distance metric: ${metric}`);
  }
}
