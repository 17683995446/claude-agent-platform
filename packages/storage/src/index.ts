// src/index.ts - 导出所有模块

// 接口与类型
export type {
  IStorage,
  SetOptions,
  StorageEntry,
  StorageStats,
  StorageChangeEvent,
  Unsubscribe,
} from './storage-interface.ts';
export { NamespacedStorage } from './storage-interface.ts';

// 内存存储
export type { MemoryStorageOptions } from './memory-storage.ts';
export { MemoryStorage } from './memory-storage.ts';

// 文件存储
export type { FileStorageOptions } from './file-storage.ts';
export { FileStorage } from './file-storage.ts';

// 多级缓存
export type {
  WritePolicy,
  CacheLevelConfig,
  CacheConfig,
  CacheLevelStats,
} from './cache-storage.ts';
export { CacheStorage } from './cache-storage.ts';

// 批量操作
export type {
  StorageOperationType,
  StorageOperation,
  BatchErrorStrategy,
  BatchResult,
  TransactionResult,
  BatchProgress,
  BatchProcessorOptions,
} from './batch-operations.ts';
export { BatchProcessor } from './batch-operations.ts';

// 加密层
export type { EncryptionOptions } from './storage-encryption.ts';
export { EncryptedStorage } from './storage-encryption.ts';

// 性能指标
export type { LatencyStats, OperationMetrics, StorageMetricsReport } from './storage-metrics.ts';
export { StorageMetrics } from './storage-metrics.ts';

// 数据迁移
export type {
  ConflictStrategy,
  MigrationOptions,
  MigrationProgress,
  MigrationResult,
} from './storage-migration.ts';
export { StorageMigrator } from './storage-migration.ts';

// 查询构建器
export type {
  QueryFilter,
  FilterOperator,
  LogicalCondition,
  SortConfig,
  QuerySpecification,
  QueryResult,
} from './query-builder.ts';
export { StorageQueryBuilder } from './query-builder.ts';

// 工具集
export type { HealthCheckResult, ComparisonResult } from './storage-utils.ts';
export { StorageUtils } from './storage-utils.ts';
