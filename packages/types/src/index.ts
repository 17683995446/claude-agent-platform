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
