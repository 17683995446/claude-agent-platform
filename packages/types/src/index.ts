// ============================================================================
// @claude-agent/types - Unified Type Definitions
// ============================================================================

// ---- Agent Core Types ----

/** Unique identifier for agents, tasks, and requests */
export type AgentId = string & { readonly __brand: unique symbol };
export type TaskId = string & { readonly __brand: unique symbol };
export type RequestId = string & { readonly __brand: unique symbol };
export type PluginId = string & { readonly __brand: unique symbol };
export type PipelineId = string & { readonly __brand: unique symbol };

/** Log levels ordered by severity */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Agent status lifecycle */
export type AgentStatus = 'idle' | 'running' | 'paused' | 'stopping' | 'stopped' | 'error';

/** Task execution status */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';

/** Plugin lifecycle phases */
export type PluginPhase = 'registered' | 'initializing' | 'ready' | 'active' | 'stopping' | 'stopped';

/** Pipeline execution status */
export type PipelineStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// ---- Configuration Types ----

export interface ClaudeAgentConfig {
  /** Agent name */
  name: string;
  /** Agent version */
  version: string;
  /** Log level */
  logLevel: LogLevel;
  /** Working directory */
  cwd: string;
  /** HTTP server configuration */
  http?: HttpConfig;
  /** Plugin configuration */
  plugins?: PluginConfig[];
  /** Pipeline configuration */
  pipelines?: PipelineConfig[];
  /** Checkpoint configuration */
  checkpoint?: CheckpointConfig;
}

export interface HttpConfig {
  /** Enable HTTP server */
  enabled: boolean;
  /** Host to bind */
  host: string;
  /** Port to bind */
  port: number;
  /** Health check path prefix */
  healthPath: string;
}

export interface PluginConfig {
  /** Plugin name */
  name: string;
  /** Whether the plugin is enabled */
  enabled: boolean;
  /** Plugin-specific options */
  options?: Record<string, unknown>;
}

export interface PipelineConfig {
  /** Pipeline name */
  name: string;
  /** Ordered list of step names */
  steps: string[];
  /** Pipeline-specific options */
  options?: Record<string, unknown>;
}

export interface CheckpointConfig {
  /** Enable checkpointing */
  enabled: boolean;
  /** Directory for checkpoint storage */
  directory: string;
  /** Maximum checkpoints to retain */
  maxRetain: number;
}

// ---- Agent Types ----

export interface Agent {
  readonly id: AgentId;
  readonly name: string;
  readonly status: AgentStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AgentOptions {
  name: string;
  config?: Partial<ClaudeAgentConfig>;
}

// ---- Task Types ----

export interface Task<TInput = unknown, TOutput = unknown> {
  readonly id: TaskId;
  readonly name: string;
  readonly status: TaskStatus;
  readonly input: TInput;
  readonly output?: TOutput;
  readonly error?: AgentErrorInfo;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly metadata: TaskMetadata;
}

export interface TaskMetadata {
  readonly requestId?: RequestId;
  readonly pipelineId?: PipelineId;
  readonly retryCount: number;
  readonly timeout: number;
  readonly tags: readonly string[];
}

export interface TaskOptions<TInput = unknown> {
  name: string;
  input: TInput;
  timeout?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// ---- Error Types ----

export type ErrorCode =
  | 'AGENT_NOT_FOUND'
  | 'TASK_FAILED'
  | 'TASK_TIMEOUT'
  | 'CONFIG_INVALID'
  | 'CONFIG_NOT_FOUND'
  | 'PLUGIN_ERROR'
  | 'PLUGIN_NOT_FOUND'
  | 'PIPELINE_ERROR'
  | 'PIPELINE_STEP_FAILED'
  | 'HTTP_ERROR'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'LIFECYCLE_ERROR';

export interface AgentErrorInfo {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly stack?: string;
  readonly timestamp: Date;
}

// ---- Plugin Types ----

export interface Plugin {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;
  readonly phase: PluginPhase;
  readonly description?: string;
}

export interface PluginDefinition {
  name: string;
  version: string;
  description?: string;
  init?(context: PluginContext): Promise<void>;
  destroy?(): Promise<void>;
  handlers?: Record<string, EventHandler>;
}

export interface PluginContext {
  logger: LoggerInterface;
  eventBus: EventBusInterface;
  config: ClaudeAgentConfig;
}

export type EventHandler = (event: AgentEvent) => Promise<void> | void;

// ---- Pipeline Types ----

export interface Pipeline {
  readonly id: PipelineId;
  readonly name: string;
  readonly status: PipelineStatus;
  readonly steps: PipelineStep[];
  readonly createdAt: Date;
}

export interface PipelineStep {
  readonly name: string;
  readonly status: TaskStatus;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: AgentErrorInfo;
  readonly duration?: number;
}

export interface PipelineDefinition {
  name: string;
  steps: PipelineStepDefinition[];
  middleware?: PipelineMiddleware[];
}

export interface PipelineStepDefinition {
  name: string;
  handler: StepHandler;
  timeout?: number;
  retryCount?: number;
}

export type StepHandler = (input: unknown, context: PipelineContext) => Promise<unknown>;

export interface PipelineContext {
  readonly pipelineId: PipelineId;
  readonly requestId: RequestId;
  readonly logger: LoggerInterface;
  readonly eventBus: EventBusInterface;
  readonly config: ClaudeAgentConfig;
  metadata: Record<string, unknown>;
}

export type PipelineMiddleware = (
  context: PipelineContext,
  next: () => Promise<unknown>,
) => Promise<unknown>;

// ---- Event Types ----

export type AgentEventType =
  | 'agent.started'
  | 'agent.stopped'
  | 'agent.error'
  | 'task.created'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'pipeline.started'
  | 'pipeline.completed'
  | 'pipeline.failed'
  | 'plugin.registered'
  | 'plugin.ready'
  | 'plugin.error'
  | 'config.changed'
  | 'config.reloaded'
  | 'health.check';

export interface AgentEvent {
  readonly type: AgentEventType;
  readonly timestamp: Date;
  readonly requestId?: RequestId;
  readonly data: Record<string, unknown>;
}

// ---- Logger Types ----

export interface LoggerInterface {
  trace(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  fatal(message: string, meta?: Record<string, unknown>): void;
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
  child(context: Record<string, unknown>): LoggerInterface;
}

export interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly requestId?: string;
  readonly meta?: Record<string, unknown>;
  readonly context?: Record<string, unknown>;
}

// ---- EventBus Types ----

export interface EventBusInterface {
  emit(event: AgentEvent): void;
  on(eventType: AgentEventType, handler: EventHandler): () => void;
  off(eventType: AgentEventType, handler: EventHandler): void;
  once(eventType: AgentEventType, handler: EventHandler): () => void;
  removeAllListeners(eventType?: AgentEventType): void;
}

// ---- Health Check Types ----

export interface HealthCheckResult {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly timestamp: Date;
  readonly checks: HealthCheck[];
  readonly uptime: number;
  readonly version: string;
}

export interface HealthCheck {
  readonly name: string;
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly message?: string;
  readonly duration?: number;
  readonly details?: Record<string, unknown>;
}

export interface MetricsData {
  readonly timestamp: Date;
  readonly tasksTotal: number;
  readonly tasksCompleted: number;
  readonly tasksFailed: number;
  readonly pipelinesTotal: number;
  readonly pipelinesCompleted: number;
  readonly activePlugins: number;
  readonly uptime: number;
  readonly memoryUsage: MemoryUsage;
}

export interface MemoryUsage {
  readonly rss: number;
  readonly heapUsed: number;
  readonly heapTotal: number;
  readonly external: number;
}

// ---- Lifecycle Types ----

export interface LifecycleManager {
  start(): Promise<void>;
  stop(timeout?: number): Promise<void>;
  isRunning(): boolean;
  onShutdown(callback: ShutdownCallback): void;
}

export type ShutdownCallback = (signal?: string) => Promise<void> | void;

// ---- CLI Types ----

export type CLICommand =
  | 'run'
  | 'analyze'
  | 'test'
  | 'graph'
  | 'devops'
  | 'design'
  | 'monitor'
  | 'checkpoint'
  | 'ask';

export interface CLIContext {
  readonly command: CLICommand;
  readonly args: string[];
  readonly flags: Record<string, unknown>;
  readonly config: ClaudeAgentConfig;
  readonly logger: LoggerInterface;
}

// ============================================================================
// Runtime Type Guards and Validators
// ============================================================================

/** Valid log levels in severity order */
export const LOG_LEVELS: readonly LogLevel[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
] as const;

/** Valid agent statuses */
export const AGENT_STATUSES: readonly AgentStatus[] = [
  'idle',
  'running',
  'paused',
  'stopping',
  'stopped',
  'error',
] as const;

/** Valid task statuses */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'skipped',
] as const;

/** Valid plugin phases */
export const PLUGIN_PHASES: readonly PluginPhase[] = [
  'registered',
  'initializing',
  'ready',
  'active',
  'stopping',
  'stopped',
] as const;

/** Valid pipeline statuses */
export const PIPELINE_STATUSES: readonly PipelineStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

/** Valid health check statuses */
export const HEALTH_STATUSES: readonly ('healthy' | 'degraded' | 'unhealthy')[] = [
  'healthy',
  'degraded',
  'unhealthy',
] as const;

/** Valid error codes */
export const ERROR_CODES: readonly ErrorCode[] = [
  'AGENT_NOT_FOUND',
  'TASK_FAILED',
  'TASK_TIMEOUT',
  'CONFIG_INVALID',
  'CONFIG_NOT_FOUND',
  'PLUGIN_ERROR',
  'PLUGIN_NOT_FOUND',
  'PIPELINE_ERROR',
  'PIPELINE_STEP_FAILED',
  'HTTP_ERROR',
  'VALIDATION_ERROR',
  'INTERNAL_ERROR',
  'LIFECYCLE_ERROR',
] as const;

/** Valid agent event types */
export const AGENT_EVENT_TYPES: readonly AgentEventType[] = [
  'agent.started',
  'agent.stopped',
  'agent.error',
  'task.created',
  'task.started',
  'task.completed',
  'task.failed',
  'task.cancelled',
  'pipeline.started',
  'pipeline.completed',
  'pipeline.failed',
  'plugin.registered',
  'plugin.ready',
  'plugin.error',
  'config.changed',
  'config.reloaded',
  'health.check',
] as const;

/** Valid CLI commands */
export const CLI_COMMANDS: readonly CLICommand[] = [
  'run',
  'analyze',
  'test',
  'graph',
  'devops',
  'design',
  'monitor',
  'checkpoint',
  'ask',
] as const;

// ---- Type Guard Functions ----

/**
 * Checks if a value is a valid LogLevel.
 * BUG-FIX-001: Added runtime validation for LogLevel to prevent invalid string assignment.
 */
export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && LOG_LEVELS.includes(value as LogLevel);
}

/**
 * Checks if a value is a valid AgentStatus.
 * BUG-FIX-002: Added runtime validation for AgentStatus to prevent invalid state transitions.
 */
export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === 'string' && AGENT_STATUSES.includes(value as AgentStatus);
}

/**
 * Checks if a value is a valid TaskStatus.
 * BUG-FIX-003: Added runtime validation for TaskStatus to prevent invalid task states.
 */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && TASK_STATUSES.includes(value as TaskStatus);
}

/**
 * Checks if a value is a valid PluginPhase.
 * BUG-FIX-004: Added runtime validation for PluginPhase to prevent invalid plugin states.
 */
export function isPluginPhase(value: unknown): value is PluginPhase {
  return typeof value === 'string' && PLUGIN_PHASES.includes(value as PluginPhase);
}

/**
 * Checks if a value is a valid PipelineStatus.
 * BUG-FIX-005: Added runtime validation for PipelineStatus to prevent invalid pipeline states.
 */
export function isPipelineStatus(value: unknown): value is PipelineStatus {
  return typeof value === 'string' && PIPELINE_STATUSES.includes(value as PipelineStatus);
}

/**
 * Checks if a value is a valid ErrorCode.
 * BUG-FIX-006: Added runtime validation for ErrorCode to prevent invalid error codes.
 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODES.includes(value as ErrorCode);
}

/**
 * Checks if a value is a valid AgentEventType.
 * BUG-FIX-007: Added runtime validation for AgentEventType to prevent invalid event types.
 */
export function isAgentEventType(value: unknown): value is AgentEventType {
  return typeof value === 'string' && AGENT_EVENT_TYPES.includes(value as AgentEventType);
}

/**
 * Checks if a value is a valid CLICommand.
 * BUG-FIX-008: Added runtime validation for CLICommand to prevent invalid commands.
 */
export function isCLICommand(value: unknown): value is CLICommand {
  return typeof value === 'string' && CLI_COMMANDS.includes(value as CLICommand);
}

/**
 * Checks if a value is a valid health status.
 * BUG-FIX-009: Added runtime validation for health status.
 */
export function isHealthStatus(value: unknown): value is 'healthy' | 'degraded' | 'unhealthy' {
  return typeof value === 'string' && HEALTH_STATUSES.includes(value as 'healthy' | 'degraded' | 'unhealthy');
}

// ---- ID Validation Functions ----

/**
 * Validates and creates an AgentId.
 * BUG-FIX-010: Added ID validation to prevent empty or whitespace-only IDs.
 * @throws Error if ID is empty or only whitespace
 */
export function createAgentId(id: string): AgentId {
  if (typeof id !== 'string') {
    throw new TypeError('AgentId must be a string');
  }
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new Error('AgentId cannot be empty or whitespace');
  }
  return trimmed as AgentId;
}

/**
 * Validates and creates a TaskId.
 * BUG-FIX-011: Added ID validation to prevent empty or whitespace-only IDs.
 * @throws Error if ID is empty or only whitespace
 */
export function createTaskId(id: string): TaskId {
  if (typeof id !== 'string') {
    throw new TypeError('TaskId must be a string');
  }
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new Error('TaskId cannot be empty or whitespace');
  }
  return trimmed as TaskId;
}

/**
 * Validates and creates a RequestId.
 * BUG-FIX-012: Added ID validation to prevent empty or whitespace-only IDs.
 * @throws Error if ID is empty or only whitespace
 */
export function createRequestId(id: string): RequestId {
  if (typeof id !== 'string') {
    throw new TypeError('RequestId must be a string');
  }
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new Error('RequestId cannot be empty or whitespace');
  }
  return trimmed as RequestId;
}

/**
 * Validates and creates a PluginId.
 * BUG-FIX-013: Added ID validation to prevent empty or whitespace-only IDs.
 * @throws Error if ID is empty or only whitespace
 */
export function createPluginId(id: string): PluginId {
  if (typeof id !== 'string') {
    throw new TypeError('PluginId must be a string');
  }
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new Error('PluginId cannot be empty or whitespace');
  }
  return trimmed as PluginId;
}

/**
 * Validates and creates a PipelineId.
 * BUG-FIX-014: Added ID validation to prevent empty or whitespace-only IDs.
 * @throws Error if ID is empty or only whitespace
 */
export function createPipelineId(id: string): PipelineId {
  if (typeof id !== 'string') {
    throw new TypeError('PipelineId must be a string');
  }
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new Error('PipelineId cannot be empty or whitespace');
  }
  return trimmed as PipelineId;
}

// ---- Configuration Validation ----

/**
 * Validates HttpConfig.
 * BUG-FIX-015: Added validation for port range and required fields.
 * @throws Error if configuration is invalid
 */
export function validateHttpConfig(config: HttpConfig): void {
  if (typeof config.enabled !== 'boolean') {
    throw new TypeError('HttpConfig.enabled must be a boolean');
  }
  if (typeof config.host !== 'string' || config.host.trim().length === 0) {
    throw new Error('HttpConfig.host must be a non-empty string');
  }
  if (typeof config.port !== 'number') {
    throw new TypeError('HttpConfig.port must be a number');
  }
  if (!Number.isInteger(config.port)) {
    throw new Error('HttpConfig.port must be an integer');
  }
  if (config.port < 0 || config.port > 65535) {
    throw new RangeError('HttpConfig.port must be between 0 and 65535');
  }
  if (typeof config.healthPath !== 'string' || config.healthPath.trim().length === 0) {
    throw new Error('HttpConfig.healthPath must be a non-empty string');
  }
}

/**
 * Validates PluginConfig.
 * BUG-FIX-016: Added validation for plugin name and enabled field.
 * @throws Error if configuration is invalid
 */
export function validatePluginConfig(config: PluginConfig): void {
  if (typeof config.name !== 'string' || config.name.trim().length === 0) {
    throw new Error('PluginConfig.name must be a non-empty string');
  }
  if (typeof config.enabled !== 'boolean') {
    throw new TypeError('PluginConfig.enabled must be a boolean');
  }
  if (config.options !== undefined && typeof config.options !== 'object') {
    throw new TypeError('PluginConfig.options must be an object if provided');
  }
  if (config.options !== null && config.options !== undefined && Array.isArray(config.options)) {
    throw new TypeError('PluginConfig.options must be a plain object, not an array');
  }
}

/**
 * Validates PipelineConfig.
 * BUG-FIX-017: Added validation for pipeline name and steps.
 * @throws Error if configuration is invalid
 */
export function validatePipelineConfig(config: PipelineConfig): void {
  if (typeof config.name !== 'string' || config.name.trim().length === 0) {
    throw new Error('PipelineConfig.name must be a non-empty string');
  }
  if (!Array.isArray(config.steps)) {
    throw new TypeError('PipelineConfig.steps must be an array');
  }
  if (config.steps.length === 0) {
    throw new Error('PipelineConfig.steps cannot be empty');
  }
  for (let i = 0; i < config.steps.length; i++) {
    if (typeof config.steps[i] !== 'string' || config.steps[i].trim().length === 0) {
      throw new Error(`PipelineConfig.steps[${i}] must be a non-empty string`);
    }
  }
  if (config.options !== undefined && typeof config.options !== 'object') {
    throw new TypeError('PipelineConfig.options must be an object if provided');
  }
}

/**
 * Validates CheckpointConfig.
 * BUG-FIX-018: Added validation for checkpoint directory and maxRetain.
 * @throws Error if configuration is invalid
 */
export function validateCheckpointConfig(config: CheckpointConfig): void {
  if (typeof config.enabled !== 'boolean') {
    throw new TypeError('CheckpointConfig.enabled must be a boolean');
  }
  if (typeof config.directory !== 'string' || config.directory.trim().length === 0) {
    throw new Error('CheckpointConfig.directory must be a non-empty string');
  }
  if (typeof config.maxRetain !== 'number') {
    throw new TypeError('CheckpointConfig.maxRetain must be a number');
  }
  if (!Number.isInteger(config.maxRetain)) {
    throw new Error('CheckpointConfig.maxRetain must be an integer');
  }
  if (config.maxRetain < 0) {
    throw new RangeError('CheckpointConfig.maxRetain must be non-negative');
  }
}

/**
 * Validates ClaudeAgentConfig.
 * BUG-FIX-019: Added comprehensive validation for all config fields.
 * @throws Error if configuration is invalid
 */
export function validateClaudeAgentConfig(config: ClaudeAgentConfig): void {
  if (typeof config.name !== 'string' || config.name.trim().length === 0) {
    throw new Error('ClaudeAgentConfig.name must be a non-empty string');
  }
  if (typeof config.version !== 'string' || config.version.trim().length === 0) {
    throw new Error('ClaudeAgentConfig.version must be a non-empty string');
  }
  if (!isLogLevel(config.logLevel)) {
    throw new Error(`ClaudeAgentConfig.logLevel must be a valid LogLevel, got: ${config.logLevel}`);
  }
  if (typeof config.cwd !== 'string' || config.cwd.trim().length === 0) {
    throw new Error('ClaudeAgentConfig.cwd must be a non-empty string');
  }
  if (config.http !== undefined) {
    validateHttpConfig(config.http);
  }
  if (config.plugins !== undefined) {
    if (!Array.isArray(config.plugins)) {
      throw new TypeError('ClaudeAgentConfig.plugins must be an array if provided');
    }
    for (let i = 0; i < config.plugins.length; i++) {
      validatePluginConfig(config.plugins[i]);
    }
  }
  if (config.pipelines !== undefined) {
    if (!Array.isArray(config.pipelines)) {
      throw new TypeError('ClaudeAgentConfig.pipelines must be an array if provided');
    }
    for (let i = 0; i < config.pipelines.length; i++) {
      validatePipelineConfig(config.pipelines[i]);
    }
  }
  if (config.checkpoint !== undefined) {
    validateCheckpointConfig(config.checkpoint);
  }
}

// ---- Log Level Utilities ----

/**
 * Gets the numeric severity level for a LogLevel.
 * Higher number = more severe.
 * BUG-FIX-020: Added severity comparison utility for log level filtering.
 */
export function getLogLevelSeverity(level: LogLevel): number {
  const index = LOG_LEVELS.indexOf(level);
  if (index === -1) {
    throw new Error(`Invalid LogLevel: ${level}`);
  }
  return index;
}

/**
 * Compares two log levels.
 * Returns positive if a > b, negative if a < b, 0 if equal.
 * BUG-FIX-021: Added log level comparison for filtering logic.
 */
export function compareLogLevels(a: LogLevel, b: LogLevel): number {
  return getLogLevelSeverity(a) - getLogLevelSeverity(b);
}

/**
 * Checks if a message at the given level should be logged based on the minimum level.
 * BUG-FIX-022: Added log level filtering utility.
 */
export function shouldLog(messageLevel: LogLevel, minimumLevel: LogLevel): boolean {
  return getLogLevelSeverity(messageLevel) >= getLogLevelSeverity(minimumLevel);
}

// ---- AgentErrorInfo Factory ----

/**
 * Creates an AgentErrorInfo object with proper defaults.
 * BUG-FIX-023: Added factory function to ensure timestamp is always set.
 */
export function createAgentErrorInfo(
  code: ErrorCode,
  message: string,
  options?: {
    details?: Record<string, unknown>;
    stack?: string;
  },
): AgentErrorInfo {
  if (!isErrorCode(code)) {
    throw new Error(`Invalid ErrorCode: ${code}`);
  }
  if (typeof message !== 'string') {
    throw new TypeError('message must be a string');
  }
  if (message.trim().length === 0) {
    throw new Error('message cannot be empty');
  }
  return {
    code,
    message,
    details: options?.details,
    stack: options?.stack,
    timestamp: new Date(),
  };
}

// ---- AgentEvent Factory ----

/**
 * Creates an AgentEvent object with proper defaults.
 * BUG-FIX-024: Added factory function to ensure timestamp is always set and data is valid.
 */
export function createAgentEvent(
  type: AgentEventType,
  data: Record<string, unknown>,
  requestId?: RequestId,
): AgentEvent {
  if (!isAgentEventType(type)) {
    throw new Error(`Invalid AgentEventType: ${type}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new TypeError('data must be a plain object');
  }
  return {
    type,
    timestamp: new Date(),
    requestId,
    data,
  };
}

// ---- Task Status Transition Validation ----

/** Valid task status transitions */
const VALID_TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['running', 'cancelled', 'skipped'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [], // Terminal state
  failed: ['pending'], // Can retry
  cancelled: ['pending'], // Can retry
  skipped: [], // Terminal state
} as const;

/**
 * Validates if a task status transition is valid.
 * BUG-FIX-025: Added state transition validation to prevent invalid state changes.
 */
export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (!isTaskStatus(from) || !isTaskStatus(to)) {
    return false;
  }
  const validTargets = VALID_TASK_TRANSITIONS[from];
  return validTargets.includes(to);
}

/** Valid agent status transitions */
const VALID_AGENT_TRANSITIONS: Record<AgentStatus, readonly AgentStatus[]> = {
  idle: ['running', 'stopped'],
  running: ['paused', 'stopping', 'error'],
  paused: ['running', 'stopping'],
  stopping: ['stopped', 'error'],
  stopped: ['idle'],
  error: ['idle', 'stopped'],
} as const;

/**
 * Validates if an agent status transition is valid.
 * BUG-FIX-026: Added state transition validation to prevent invalid state changes.
 */
export function isValidAgentTransition(from: AgentStatus, to: AgentStatus): boolean {
  if (!isAgentStatus(from) || !isAgentStatus(to)) {
    return false;
  }
  const validTargets = VALID_AGENT_TRANSITIONS[from];
  return validTargets.includes(to);
}

/** Valid plugin phase transitions */
const VALID_PLUGIN_TRANSITIONS: Record<PluginPhase, readonly PluginPhase[]> = {
  registered: ['initializing'],
  initializing: ['ready', 'stopped'],
  ready: ['active', 'stopping'],
  active: ['stopping'],
  stopping: ['stopped'],
  stopped: [], // Terminal state
} as const;

/**
 * Validates if a plugin phase transition is valid.
 * BUG-FIX-027: Added state transition validation to prevent invalid state changes.
 */
export function isValidPluginTransition(from: PluginPhase, to: PluginPhase): boolean {
  if (!isPluginPhase(from) || !isPluginPhase(to)) {
    return false;
  }
  const validTargets = VALID_PLUGIN_TRANSITIONS[from];
  return validTargets.includes(to);
}

/** Valid pipeline status transitions */
const VALID_PIPELINE_TRANSITIONS: Record<PipelineStatus, readonly PipelineStatus[]> = {
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [], // Terminal state
  failed: ['pending'], // Can retry
  cancelled: ['pending'], // Can retry
} as const;

/**
 * Validates if a pipeline status transition is valid.
 * BUG-FIX-028: Added state transition validation to prevent invalid state changes.
 */
export function isValidPipelineTransition(from: PipelineStatus, to: PipelineStatus): boolean {
  if (!isPipelineStatus(from) || !isPipelineStatus(to)) {
    return false;
  }
  const validTargets = VALID_PIPELINE_TRANSITIONS[from];
  return validTargets.includes(to);
}

// ---- Health Check Utilities ----

/**
 * Creates a HealthCheck object.
 * BUG-FIX-029: Added factory function with validation.
 */
export function createHealthCheck(
  name: string,
  status: 'healthy' | 'degraded' | 'unhealthy',
  options?: {
    message?: string;
    duration?: number;
    details?: Record<string, unknown>;
  },
): HealthCheck {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('HealthCheck.name must be a non-empty string');
  }
  if (!isHealthStatus(status)) {
    throw new Error(`Invalid health status: ${status}`);
  }
  if (options?.duration !== undefined) {
    if (typeof options.duration !== 'number') {
      throw new TypeError('HealthCheck.duration must be a number');
    }
    if (options.duration < 0) {
      throw new RangeError('HealthCheck.duration must be non-negative');
    }
  }
  return {
    name,
    status,
    message: options?.message,
    duration: options?.duration,
    details: options?.details,
  };
}

/**
 * Creates a HealthCheckResult object.
 * BUG-FIX-030: Added factory function with validation and uptime calculation.
 */
export function createHealthCheckResult(
  checks: HealthCheck[],
  version: string,
  startTime: Date,
): HealthCheckResult {
  if (!Array.isArray(checks)) {
    throw new TypeError('checks must be an array');
  }
  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];
    if (typeof check.name !== 'string' || check.name.trim().length === 0) {
      throw new Error(`checks[${i}].name must be a non-empty string`);
    }
    if (!isHealthStatus(check.status)) {
      throw new Error(`checks[${i}].status must be a valid health status`);
    }
  }
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error('version must be a non-empty string');
  }
  if (!(startTime instanceof Date) || isNaN(startTime.getTime())) {
    throw new TypeError('startTime must be a valid Date');
  }

  // Determine overall status
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  for (const check of checks) {
    if (check.status === 'unhealthy') {
      overallStatus = 'unhealthy';
      break;
    }
    if (check.status === 'degraded') {
      overallStatus = 'degraded';
    }
  }

  return {
    status: overallStatus,
    timestamp: new Date(),
    checks,
    uptime: Date.now() - startTime.getTime(),
    version,
  };
}

// ---- Memory Usage Utilities ----

/**
 * Validates MemoryUsage object.
 * BUG-FIX-031: Added validation for memory usage values.
 */
export function validateMemoryUsage(memory: MemoryUsage): void {
  if (typeof memory.rss !== 'number' || memory.rss < 0) {
    throw new Error('MemoryUsage.rss must be a non-negative number');
  }
  if (typeof memory.heapUsed !== 'number' || memory.heapUsed < 0) {
    throw new Error('MemoryUsage.heapUsed must be a non-negative number');
  }
  if (typeof memory.heapTotal !== 'number' || memory.heapTotal < 0) {
    throw new Error('MemoryUsage.heapTotal must be a non-negative number');
  }
  if (typeof memory.external !== 'number' || memory.external < 0) {
    throw new Error('MemoryUsage.external must be a non-negative number');
  }
  if (memory.heapUsed > memory.heapTotal) {
    throw new Error('MemoryUsage.heapUsed cannot exceed heapTotal');
  }
}

/**
 * Creates a MetricsData object.
 * BUG-FIX-032: Added factory function with validation.
 */
export function createMetricsData(
  data: {
    tasksTotal: number;
    tasksCompleted: number;
    tasksFailed: number;
    pipelinesTotal: number;
    pipelinesCompleted: number;
    activePlugins: number;
    startTime: Date;
  },
  memory: MemoryUsage,
): MetricsData {
  // Validate counts
  const counts = [
    ['tasksTotal', data.tasksTotal],
    ['tasksCompleted', data.tasksCompleted],
    ['tasksFailed', data.tasksFailed],
    ['pipelinesTotal', data.pipelinesTotal],
    ['pipelinesCompleted', data.pipelinesCompleted],
    ['activePlugins', data.activePlugins],
  ] as const;

  for (const [name, value] of counts) {
    if (typeof value !== 'number') {
      throw new TypeError(`${name} must be a number`);
    }
    if (!Number.isInteger(value)) {
      throw new Error(`${name} must be an integer`);
    }
    if (value < 0) {
      throw new RangeError(`${name} must be non-negative`);
    }
  }

  // Validate logical constraints
  if (data.tasksCompleted > data.tasksTotal) {
    throw new Error('tasksCompleted cannot exceed tasksTotal');
  }
  if (data.tasksFailed > data.tasksTotal) {
    throw new Error('tasksFailed cannot exceed tasksTotal');
  }
  if (data.pipelinesCompleted > data.pipelinesTotal) {
    throw new Error('pipelinesCompleted cannot exceed pipelinesTotal');
  }

  // Validate memory
  validateMemoryUsage(memory);

  // Validate startTime
  if (!(data.startTime instanceof Date) || isNaN(data.startTime.getTime())) {
    throw new TypeError('startTime must be a valid Date');
  }

  return {
    timestamp: new Date(),
    tasksTotal: data.tasksTotal,
    tasksCompleted: data.tasksCompleted,
    tasksFailed: data.tasksFailed,
    pipelinesTotal: data.pipelinesTotal,
    pipelinesCompleted: data.pipelinesCompleted,
    activePlugins: data.activePlugins,
    uptime: Date.now() - data.startTime.getTime(),
    memoryUsage: memory,
  };
}
