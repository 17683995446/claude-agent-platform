// ============================================================================
// @claude-agent/perf - Performance Optimization & Memory Management
// ============================================================================

// Object Pool
export { ObjectPool } from './object-pool.ts';
export type { ObjectPoolOptions, ObjectPoolStats } from './object-pool.ts';

// LRU Cache
export { LRUCache } from './lru-cache.ts';
export type { LRUCacheOptions, LRUCacheStats } from './lru-cache.ts';

// Lazy Loader
export { LazyLoader, LazyLoaderRegistry } from './lazy-loader.ts';
export type { LazyLoaderOptions, LazyState, LazyLoaderStats } from './lazy-loader.ts';

// Batch Processor
export { BatchProcessor } from './batch-processor.ts';
export type { BatchProcessorOptions, BatchProcessorStats } from './batch-processor.ts';

// Connection Pool
export { ConnectionPool } from './connection-pool.ts';
export type { ConnectionFactory, ConnectionPoolOptions, ConnectionPoolStats } from './connection-pool.ts';

// Memory Monitor
export { MemoryMonitor } from './memory-monitor.ts';
export type {
  MemorySnapshot,
  MemoryLeakWarning,
  MemoryMonitorOptions,
  MemoryMonitorStats,
} from './memory-monitor.ts';

// Concurrency Control
export { Semaphore, RateLimiter, SlidingWindowRateLimiter, ConcurrencyController } from './concurrency-control.ts';
export type {
  SemaphoreOptions,
  RateLimiterOptions,
  SlidingWindowOptions,
  ConcurrencyControllerOptions,
} from './concurrency-control.ts';

// Incremental Processor
export { IncrementalProcessor } from './incremental-processor.ts';
export type {
  ChangeType,
  FileChange,
  IncrementalState,
  IncrementalProcessorOptions,
  IncrementalProcessorStats,
} from './incremental-processor.ts';

// Precomputer
export { Precomputer } from './precomputer.ts';
export type {
  PrecomputeTask,
  PrecomputeResult,
  PrecomputerOptions,
  PrecomputerStats,
} from './precomputer.ts';

// Serialization
export {
  BinaryEncoder,
  BinaryDecoder,
  StreamingJSONSerializer,
  CompressionHelper,
  SerializationBenchmark,
} from './serialization.ts';
export type {
  BinaryValue,
  BinaryEncodeResult,
  BinaryDecoderState,
  StreamingSerializerOptions,
  CompressionResult,
  SerializationBenchmarkResult,
} from './serialization.ts';

// Startup Optimizer
export { StartupOptimizer } from './startup-optimizer.ts';
export type {
  StartupTask,
  StartupTaskResult,
  StartupOptimizerOptions,
  StartupReport,
  DependencyGraphNode,
} from './startup-optimizer.ts';
