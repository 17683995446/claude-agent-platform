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
  ) {
    super('TASK_TIMEOUT', message, { ...details, taskId, timeout }, undefined);
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

  constructor(configPath: string) {
    super(
      'CONFIG_NOT_FOUND',
      `Configuration file not found: ${configPath}`,
      { configPath },
      undefined,
    );
    this.name = 'ConfigNotFoundError';
    this.configPath = configPath;
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

  get suggestedFix(): string {
    return `Check the plugin "${this.pluginName}" implementation and ensure it follows the plugin interface.`;
  }
}

export class PluginNotFoundError extends AgentError {
  public readonly pluginName: string;

  constructor(pluginName: string) {
    super(
      'PLUGIN_NOT_FOUND',
      `Plugin not found: ${pluginName}`,
      { pluginName },
      undefined,
    );
    this.name = 'PluginNotFoundError';
    this.pluginName = pluginName;
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

  get suggestedFix(): string {
    return `Review the pipeline "${this.pipelineName}" configuration and step definitions.`;
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
    super('PIPELINE_STEP_FAILED', message, { ...details, pipelineName, stepName }, cause);
    this.name = 'PipelineStepError';
    this.pipelineName = pipelineName;
    this.stepName = stepName;
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
  ) {
    super('VALIDATION_ERROR', message, { ...details, field, value }, undefined);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }

  get suggestedFix(): string {
    if (this.field) {
      return `The field "${this.field}" is invalid. Expected a valid value but received: ${JSON.stringify(this.value)}.`;
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

const errorHandlers: ErrorCallback[] = [];

/** Register a global error handler */
export function onAgentError(callback: ErrorCallback): () => void {
  errorHandlers.push(callback);
  return () => {
    const index = errorHandlers.indexOf(callback);
    if (index !== -1) {
      errorHandlers.splice(index, 1);
    }
  };
}

/** Dispatch error to all registered handlers */
export function dispatchError(error: AgentError): void {
  for (const handler of errorHandlers) {
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
export function installGlobalErrorHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    const error = wrapError(reason);
    dispatchError(error);
  });

  process.on('uncaughtException', (error) => {
    const agentError = wrapError(error);
    dispatchError(agentError);
    // Give handlers a chance to log, then exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });
}
