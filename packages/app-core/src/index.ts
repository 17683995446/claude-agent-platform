// ============================================================================
// @claude-agent/app-core - Application Core Package
// ============================================================================

// Module 1: Application Lifecycle Management
export {
  Application,
  type AppConfig,
  type ApplicationPhase,
  type ApplicationStatus,
  type ComponentDescriptor,
  type ComponentStatus,
  type Environment,
} from './application.ts';

// Module 2: Service Container (IoC/DI)
export {
  ServiceContainer,
  type DisposableService,
  type ServiceFactory,
  type ServiceInfo,
  type ServiceLifecycle,
  type ServiceRegistration,
} from './service-container.ts';

// Module 3: Middleware Pipeline
export {
  AppMiddlewarePipeline,
  createCORSMiddleware,
  createErrorHandlingMiddleware,
  createLoggingMiddleware,
  createRequestIdMiddleware,
  createTimingMiddleware,
  type AppContext,
  type AppMiddleware,
  type AppResult,
  type MiddlewareType,
} from './middleware-pipeline.ts';

// Module 4: Routing System
export {
  RoutingSystem,
  type RouteContext,
  type RouteDefinition,
  type RouteGroup,
  type RouteHandler,
  type RouteMatch,
  type RouteMiddleware,
  type RouteParams,
} from './routing-system.ts';

// Module 5: Event System
export {
  AppEventSystem,
  type EventDomain,
  type EventHandler,
  type EventPriority,
  type EventRecord,
  type Subscription,
} from './event-system.ts';

// Module 6: Command System
export {
  CommandSystem,
  type CommandArgument,
  type CommandDefinition,
  type CommandHistoryEntry,
  type CommandInfo,
  type CommandOption,
  type CommandResult,
  type HelpText,
} from './command-system.ts';

// Module 7: Plugin Host
export {
  PluginHost,
  type LoadedPlugin,
  type PluginAPI,
  type PluginDefinition,
  type PluginInfo,
  type PluginManifest,
} from './plugin-host.ts';

// Module 8: Configuration Manager
export {
  AppConfigManager,
  type ConfigLayer,
  type UnwatchFn,
  type ValidationResult,
  type WatchCallback,
} from './config-manager.ts';

// Module 9: Health System
export {
  AppHealthSystem,
  type ComponentHealth,
  type HealthCategory,
  type HealthCheckFn,
  type HealthCheckResult,
  type HealthHistoryEntry,
  type HealthReport,
  type HealthStatus,
} from './health-system.ts';

// Module 10: Telemetry System
export {
  AppTelemetrySystem,
  type HistogramData,
  type MetricRecord,
  type MetricType,
  type MetricsSnapshot,
  type Span,
  type SpanContext,
  type SummaryData,
  type TelemetryDashboard,
} from './telemetry-system.ts';
