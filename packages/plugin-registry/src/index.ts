// ============================================================
// src/index.ts - Export everything
// ============================================================

// Registry Core
export { PluginRegistry } from './registry-core.ts';
export type {
  PluginLifecycleState,
  PluginInfo,
  PluginFilter,
  RegistryOptions,
} from './registry-core.ts';

// Plugin Loader
export { PluginLoader } from './plugin-loader.ts';
export type {
  PluginSourceType,
  PluginSource,
  PluginLoadResult,
  PluginInstance,
  HotReloadOptions,
} from './plugin-loader.ts';

// Plugin Sandbox
export { PluginSandbox } from './plugin-sandbox.ts';
export type {
  PluginPermission,
  SandboxContext,
  ResourceLimits,
  ResourceUsage,
  AuditEntry,
  WhitelistedApi,
} from './plugin-sandbox.ts';

// Hook System
export { HookSystem } from './hook-system.ts';
export type {
  HookType,
  HookOptions,
  HookHandler,
  RegisteredHook,
} from './hook-system.ts';

// Plugin Config
export { PluginConfigManager } from './plugin-config.ts';
export type {
  ConfigSchemaType,
  ConfigSchemaProperty,
  ConfigSchema,
  ValidationResult,
  ConfigChangeCallback,
} from './plugin-config.ts';

// Plugin Dependency
export { PluginDependencyResolver } from './plugin-dependency.ts';
export type {
  PluginDefinition,
  DependencyNode,
  DependencyGraph,
  Conflict,
} from './plugin-dependency.ts';

// Plugin Marketplace
export { PluginMarketplace } from './plugin-marketplace.ts';
export type {
  PluginCategory,
  PluginListing,
  PluginDetails,
  PluginReview,
  MarketplaceFilter,
  InstallResult,
  SearchResult,
} from './plugin-marketplace.ts';

// Plugin Versioning
export { PluginVersionManager } from './plugin-versioning.ts';
export type {
  SemVer,
  RangeOperator,
  VersionRange,
} from './plugin-versioning.ts';

// Plugin Communication
export { PluginCommunicationBus } from './plugin-communication.ts';
export type {
  PluginMessage,
  MessageHandler,
  MessageFilter,
  PendingRequest,
  MessageSizeLimits,
} from './plugin-communication.ts';

// Plugin Telemetry
export { PluginTelemetry } from './plugin-telemetry.ts';
export type {
  ExecutionRecord,
  PluginStats,
  PluginRanking,
  PluginHealthEntry,
  PluginHealthReport,
  TelemetryAlert,
} from './plugin-telemetry.ts';
