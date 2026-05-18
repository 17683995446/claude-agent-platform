// @claude-agent/db-layer - Database Abstraction Layer
// Comprehensive database optimization toolkit

export {
  DatabaseConnectionPool,
  type DatabaseConnection,
  type PoolConfig,
  type PoolEvent,
  type PoolEventHandler,
} from './connection-pool.ts';

export {
  QueryBuilder,
  type QueryResult as QBQueryResult,
  type JoinType,
  type SetOperation,
} from './query-builder.ts';

export {
  SchemaMigrator,
  type Migration,
  type MigrationRecord,
  type MigrationResult,
  type SchemaMigratorConfig,
  type MigrationHook,
} from './schema-migrator.ts';

export {
  BaseRepository,
  type FindOptions,
  type FilterOptions,
  type PaginatedResult,
  type Timestamps,
} from './repository-base.ts';

export {
  TransactionManager,
  type IsolationLevel,
  type Transaction,
  type TransactionEvent,
  type TransactionEventHandler,
} from './transaction-manager.ts';

export {
  DataMapper,
  type ColumnMapping,
  type RelationMapping,
  type EntityMapping,
  type RelationType,
} from './data-mapper.ts';

export {
  QueryExecutor,
  type QueryResult as QEQueryResult,
  type BatchResult,
  type Query as QEQuery,
  type StreamOptions,
  type QueryLog as QEQueryLog,
} from './query-executor.ts';

export {
  SeedManager,
  type Seed,
  type SeedRecord,
  type SeedResult,
} from './seed-manager.ts';

export {
  IndexManager,
  type IndexType,
  type IndexOptions,
  type IndexInfo,
  type IndexAnalysis,
  type QueryLog as IMQueryLog,
  type IndexSuggestion,
} from './index-manager.ts';

export {
  DatabaseHealthMonitor,
  type DatabaseHealthReport,
  type ConnectionPoolMetrics,
  type QueryPerformanceMetrics,
  type TableSizeInfo,
  type LockInfo,
  type SlowQuery,
  type PerformanceMetrics,
  type HealthCheckConfig,
} from './db-health-monitor.ts';
