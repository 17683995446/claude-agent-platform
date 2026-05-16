// src/index.ts - Export everything

// Module 1: Notification Center
export { NotificationCenter } from './notification-center.ts';
export type {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationChannel,
  SendResult,
  NotificationHandler,
  Subscription,
  NotificationFilter,
  NotificationRecord,
} from './notification-center.ts';

// Module 2: Alert Manager
export { AlertManager } from './alert-manager.ts';
export type {
  AlertSeverity,
  AlertState,
  MetricData,
  AlertRule,
  Alert,
  AlertEvaluation,
  AlertStatistics,
} from './alert-manager.ts';

// Module 3: Enhanced Event Bus
export { EnhancedEventBus } from './event-bus-enhanced.ts';
export type {
  EventHandler,
  Subscription as EventSubscription,
  EventMiddleware,
  EventRecord,
  PersistenceBackend,
  EnhancedEventBusOptions,
} from './event-bus-enhanced.ts';

// Module 4: Webhook Manager
export { WebhookManager } from './webhook-manager.ts';
export type {
  WebhookConfig,
  DeliveryResult,
  DeliveryStatus,
} from './webhook-manager.ts';

// Module 5: Digest Builder
export { DigestBuilder } from './digest-builder.ts';
export type {
  DigestPeriod,
  DigestNotification,
  Digest,
  DigestSummary,
  DigestRule,
  DigestTemplate,
} from './digest-builder.ts';

// Module 6: Template Engine
export { NotificationTemplateEngine } from './template-engine.ts';
export type {
  CompiledTemplate,
  TemplateFunction,
} from './template-engine.ts';

// Module 7: Channel Router
export { ChannelRouter } from './channel-router.ts';
export type {
  RoutingRule,
  ChannelHealth,
  RoutingResult,
} from './channel-router.ts';

// Module 8: Notification Preferences
export { NotificationPreferences } from './notification-preferences.ts';
export type {
  UserPreferences,
  PreferenceDefaults,
} from './notification-preferences.ts';

// Module 9: Notification History
export { NotificationHistory } from './notification-history.ts';
export type {
  NotificationRecord as HistoryNotificationRecord,
  HistoryFilter,
  AggregateDimension,
  AggregateResult,
} from './notification-history.ts';

// Module 10: Notification Metrics
export { NotificationMetrics } from './notification-metrics.ts';
export type {
  DeliveryResult as MetricsDeliveryResult,
  NotificationMetricsReport,
  ChannelMetrics,
  UserNotificationStats,
  TrendData,
  EngagementRecord,
} from './notification-metrics.ts';
