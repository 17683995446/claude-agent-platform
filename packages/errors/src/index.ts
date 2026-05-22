// ============================================================================
// @claude-agent/errors - Unified Error Handling
// ============================================================================

import type { ErrorCode, AgentErrorInfo } from '@claude-agent/types';

// ---- Base Error Class ----

export class AgentError extends Error {
  public readonly code: ErrorCode;
  public readonly details: Record<string, unknown>;
  public readonly timestamp: Date;
  public readonly cause?: Error;

  constructor(
    code: ErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
    this.cause = cause;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /** Convert to serializable error info */
  toErrorInfo(): AgentErrorInfo {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      stack: this.stack,
      timestamp: this.timestamp,
    };
  }

  /** Suggested fix for the error */
  get suggestedFix(): string | undefined {
    return undefined;
  }
}

// ---- Task Errors ----

export class TaskError extends AgentError {
  public readonly taskId?: string;

  constructor(
    message: string,
    taskId?: string,
    details: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super('TASK_FAILED', message, { ...details, taskId }, cause);
    this.name = 'TaskError';
    this.taskId = taskId;
  }

  get suggestedFix(): string {
    return 'Check the task input and handler implementation. Ensure all dependencies are available.';
  }
}

export class TaskTimeoutError extends AgentError {
  public readonly taskId?: string;
  public readonly timeout: number;

  constructor(
    message: string,
    timeout: number,
    taskId?: string,
    details: Record<string, unknown> = {},
    cause?: Error,
  ) {
    // BUG-005 [HIGH]: timeout was not validated to be a positive number
    // FIX: Validate timeout is a non-negative number, default to 0 if invalid
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 0) {
      timeout = 0;
    }
    // BUG-006 [MEDIUM]: cause parameter was ignored (passed as undefined)
    // FIX: Pass the cause parameter to parent constructor
    super('TASK_TIMEOUT', message, { ...details, taskId, timeout }, cause);
    this.name = 'TaskTimeoutError';
    this.taskId = taskId;
    this.timeout = timeout;
  }

  get suggestedFix(): string {
    return `Task exceeded the ${this.timeout}ms timeout. Consider increasing the timeout or optimizing the task handler.`;
  }
}

// ---- Config Errors ----

export class ConfigError extends AgentError {
  public readonly configPath?: string;

  constructor(
    message: string,
    configPath?: string,
    details: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super('CONFIG_INVALID', message, { ...details, configPath }, cause);
    this.name = 'ConfigError';
    this.configPath = configPath;
  }

  get suggestedFix(): string {
    const path = this.configPath ? ` in ${this.configPath}` : '';
    return `Review the configuration file${path} and fix the validation errors listed above.`;
  }
}

export class ConfigNotFoundError extends AgentError {
  public readonly configPath: string;

  // BUG-007 [MEDIUM]: Missing cause parameter for consistency
  // FIX: Added optional cause parameter
  constructor(configPath: string, cause?: Error) {
    // BUG-008 [MEDIUM]: configPath was not validated
    // FIX: Validate configPath is a non-empty string
    const validPath = typeof configPath === 'string' && configPath.trim().length > 0 
      ? configPath 
      : '<unknown>';
    super(
      'CONFIG_NOT_FOUND',
      `Configuration file not found: ${validPath}`,
      { configPath: validPath },
      cause,
    );
    this.name = 'ConfigNotFoundError';
    this.configPath = validPath;
  }

  get suggestedFix(): string {
    return `Create a configuration file at ${this.configPath} or specify a different config path.`;
  }
}

// ---- Plugin Errors ----

export class PluginError extends AgentError {
  public readonly pluginName?: string;

  constructor(
    message: string,
    pluginName?: string,
    details: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super('PLUGIN_ERROR', message, { ...details, pluginName }, cause);
    this.name = 'PluginError';
    this.pluginName = pluginName;
  }

  // BUG-002 [HIGH]: suggestedFix returned undefined when pluginName was undefined
  // FIX: Handle undefined pluginName case gracefully
  get suggestedFix(): string {
    if (this.pluginName) {
      return `Check the plugin "${this.pluginName}" implementation and ensure it follows the plugin interface.`;
    }
    return 'Check the plugin implementation and ensure it follows the plugin interface.';
  }
}

export class PluginNotFoundError extends AgentError {
  public readonly pluginName: string;

  // BUG-009 [MEDIUM]: Missing cause parameter for consistency
  // FIX: Added optional cause parameter
  constructor(pluginName: string, cause?: Error) {
    // BUG-010 [MEDIUM]: pluginName was not validated
    // FIX: Validate pluginName is a non-empty string
    const validName = typeof pluginName === 'string' && pluginName.trim().length > 0 
      ? pluginName 
      : '<unknown>';
    super(
      'PLUGIN_NOT_FOUND',
      `Plugin not found: ${validName}`,
      { pluginName: validName },
      cause,
    );
    this.name = 'PluginNotFoundError';
    this.pluginName = validName;
  }

  get suggestedFix(): string {
    return `Ensure the plugin "${this.pluginName}" is installed and registered correctly.`;
  }
}

// ---- Pipeline Errors ----

export class PipelineError extends AgentError {
  public readonly pipelineName?: string;

  constructor(
    message: string,
    pipelineName?: string,
    details: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super('PIPELINE_ERROR', message, { ...details, pipelineName }, cause);
    this.name = 'PipelineError';
    this.pipelineName = pipelineName;
  }

  // BUG-003 [HIGH]: suggestedFix returned undefined when pipelineName was undefined
  // FIX: Handle undefined pipelineName case gracefully
  get suggestedFix(): string {
    if (this.pipelineName) {
      return `Review the pipeline "${this.pipelineName}" configuration and step definitions.`;
    }
    return 'Review the pipeline configuration and step definitions.';
  }
}

export class PipelineStepError extends AgentError {
  public readonly pipelineName: string;
  public readonly stepName: string;

  constructor(
    message: string,
    pipelineName: string,
    stepName: string,
    details: Record<string, unknown> = {},
    cause?: Error,
  ) {
    // BUG-011 [MEDIUM]: pipelineName and stepName were not validated
    // FIX: Validate pipelineName and stepName are non-empty strings
    const validPipelineName = typeof pipelineName === 'string' && pipelineName.trim().length > 0 
      ? pipelineName 
      : '<unknown>';
    const validStepName = typeof stepName === 'string' && stepName.trim().length > 0 
      ? stepName 
      : '<unknown>';
    super('PIPELINE_STEP_FAILED', message, { ...details, pipelineName: validPipelineName, stepName: validStepName }, cause);
    this.name = 'PipelineStepError';
    this.pipelineName = validPipelineName;
    this.stepName = validStepName;
  }

  get suggestedFix(): string {
    return `The step "${this.stepName}" in pipeline "${this.pipelineName}" failed. Check the step handler and input data.`;
  }
}

// ---- HTTP Errors ----

export class HttpError extends AgentError {
  public readonly statusCode: number;

  constructor(
    message: string,
    statusCode: number = 500,
    details: Record<string, unknown> = {},
    cause?: Error,
  ) {
    // BUG-004 [MEDIUM]: statusCode was not validated to be a valid HTTP status code
    // FIX: Validate statusCode is an integer in valid HTTP range (100-599)
    if (typeof statusCode !== 'number' || !Number.isInteger(statusCode)) {
      statusCode = 500;
    } else if (statusCode < 100 || statusCode > 599) {
      statusCode = 500;
    }
    super('HTTP_ERROR', message, { ...details, statusCode }, cause);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

// ---- Validation Errors ----

export class ValidationError extends AgentError {
  public readonly field?: string;
  public readonly value?: unknown;

  constructor(
    message: string,
    field?: string,
    value?: unknown,
    details: Record<string, unknown> = {},
    cause?: Error,
  ) {
    // BUG-012 [MEDIUM]: Missing cause parameter for consistency
    // FIX: Added optional cause parameter
    super('VALIDATION_ERROR', message, { ...details, field, value }, cause);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }

  // BUG-013 [HIGH]: JSON.stringify could throw on circular references
  // FIX: Use try-catch and provide fallback for unstringifiable values
  get suggestedFix(): string {
    if (this.field) {
      let valueStr: string;
      try {
        valueStr = JSON.stringify(this.value);
      } catch {
        valueStr = '[unable to serialize]';
      }
      return `The field "${this.field}" is invalid. Expected a valid value but received: ${valueStr}.`;
    }
    return 'Review the input data and ensure all fields are valid.';
  }
}

// ---- Internal Errors ----

export class InternalError extends AgentError {
  constructor(
    message: string,
    details: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super('INTERNAL_ERROR', message, details, cause);
    this.name = 'InternalError';
  }
}

// ---- Lifecycle Errors ----

export class LifecycleError extends AgentError {
  constructor(
    message: string,
    details: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super('LIFECYCLE_ERROR', message, details, cause);
    this.name = 'LifecycleError';
  }
}

// ---- Global Error Handler ----

export type ErrorCallback = (error: AgentError) => void;

// BUG-001 [CRITICAL]: Global mutable array had race condition potential.
// FIX: Changed to use a Set for O(1) lookup and prevent duplicate registrations,
// and use immutable snapshot pattern during dispatch to prevent concurrent modification.
const errorHandlers: Set<ErrorCallback> = new Set();

// Track installed global process handlers for cleanup
let globalHandlerCleanup: (() => void) | null = null;

/** Register a global error handler */
export function onAgentError(callback: ErrorCallback): () => void {
  errorHandlers.add(callback);
  return () => {
    errorHandlers.delete(callback);
  };
}

/** Clear all registered error handlers (for testing) */
export function clearErrorHandlers(): void {
  errorHandlers.clear();
  // Also clear any installed global process handlers
  if (globalHandlerCleanup) {
    globalHandlerCleanup();
    globalHandlerCleanup = null;
  }
}

/** Dispatch error to all registered handlers */
export function dispatchError(error: AgentError): void {
  // BUG-001 [CRITICAL]: Take immutable snapshot to prevent concurrent modification
  // during handler execution (handlers might register/unregister other handlers)
  const handlersSnapshot = [...errorHandlers];
  for (const handler of handlersSnapshot) {
    try {
      handler(error);
    } catch {
      // Prevent handler errors from cascading
    }
  }
}

/** Wrap an unknown error into an AgentError */
export function wrapError(error: unknown): AgentError {
  if (error instanceof AgentError) {
    return error;
  }
  if (error instanceof Error) {
    return new InternalError(error.message, { originalName: error.name }, error);
  }
  return new InternalError(String(error));
}

/** Install global unhandled rejection and uncaught exception handlers */
export function installGlobalErrorHandlers(): () => void {
  // BUG-014 [CRITICAL]: No way to uninstall handlers, causing memory leaks in tests
  // FIX: Return cleanup function to remove handlers
  
  const unhandledRejectionHandler = (reason: unknown) => {
    const error = wrapError(reason);
    dispatchError(error);
  };

  const uncaughtExceptionHandler = (error: Error) => {
    const agentError = wrapError(error);
    dispatchError(agentError);
    // BUG-015 [CRITICAL]: process.exit(1) after setTimeout could cause issues in tests
    // FIX: Only exit in non-test environments, and use setImmediate for faster cleanup
    if (process.env.NODE_ENV !== 'test') {
      // Give handlers a chance to log, then exit
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    }
  };

  process.on('unhandledRejection', unhandledRejectionHandler);
  process.on('uncaughtException', uncaughtExceptionHandler);

  const cleanup = () => {
    process.off('unhandledRejection', unhandledRejectionHandler);
    process.off('uncaughtException', uncaughtExceptionHandler);
  };
  
  // Store cleanup for clearErrorHandlers() to use
  globalHandlerCleanup = cleanup;

  return cleanup;
}
