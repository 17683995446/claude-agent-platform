/**
 * @claude-agent/config-center
 * 配置中心 - 统一配置管理平台
 */

// Module 1: 配置存储
export {
  ConfigStore,
  deepMerge,
  getByPath,
  setByPath,
  deleteByPath,
  hasByPath,
  type WatchCallback,
  type UnwatchFn,
} from './config-store.js';

// Module 2: 多源配置加载
export {
  ConfigSourceManager,
  FileConfigSource,
  EnvConfigSource,
  ArgConfigSource,
  RemoteConfigSource,
  MemoryConfigSource,
  type ConfigSource,
} from './config-sources.js';

// Module 3: 配置验证
export {
  ConfigValidator,
  type ConfigSchema,
  type ConfigType,
  type ValidationResult,
  type ValidationError,
  type ValidationReport,
} from './config-validation.js';

// Module 4: 配置加密
export { ConfigEncryption } from './config-encryption.js';

// Module 5: 配置导出
export {
  ConfigExporter,
  type ExportFormat,
  type ExportOptions,
  type ConfigDiff,
} from './config-export.js';

// Module 6: 配置快照
export {
  ConfigSnapshotManager,
  type Snapshot,
  type SnapshotInfo,
} from './config-snapshot.js';

// Module 7: 配置热重载
export {
  ConfigHotReloader,
  type ReloadEvent,
  type ReloadCallback,
} from './config-hot-reload.js';

// Module 8: 特性开关
export {
  FeatureFlagManager,
  type FeatureFlag,
  type FlagConfig,
  type FlagContext,
  type FlagRule,
  type FlagStats,
} from './config-feature-flags.js';

// Module 9: 环境管理
export {
  EnvironmentManager,
  type EnvironmentConfig,
  type EnvironmentDiff,
} from './config-environment.js';

// Module 10: 配置审计
export {
  ConfigAuditLog,
  type AuditEntry,
  type QueryOptions,
  type ChangeSummary,
} from './config-audit.js';
