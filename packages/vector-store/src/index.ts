/**
 * @claude-agent/vector-store - Vector storage, indexing, and similarity search
 */

// Vector operations
export {
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
} from './vector-operations.js';

// Vector index
export { VectorIndex } from './vector-index.js';
export type { SimilarityMetric, VectorIndexOptions, VectorEntry, SearchResult } from './vector-index.js';

// HNSW index
export { HNSWIndex } from './hnsw-index.js';

// Embedding cache
export { EmbeddingCache } from './embedding-cache.js';

// Text chunker
export { TextChunker } from './text-chunker.js';
export type { ChunkOptions } from './text-chunker.js';

// Document store
export { DocumentStore } from './document-store.js';

// Hybrid search
export { HybridSearch } from './hybrid-search.js';

// IVF index
export { IVFIndex } from './ivf-index.js';
export type { IVFOptions } from './ivf-index.js';

// Index manager
export { IndexManager } from './index-manager.js';
