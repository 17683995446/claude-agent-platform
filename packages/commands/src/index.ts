// ============================================================================
// @claude-agent/commands - Command Pattern (CQRS)
// ============================================================================

import type { LoggerInterface } from '@claude-agent/types';
import { Logger } from '@claude-agent/logger';

// ---- Command Interface ----
export interface Command<T = unknown> {
  readonly commandId: string;
  readonly commandType: string;
  readonly timestamp: Date;
  readonly payload: T;
  readonly metadata?: Record<string, unknown>;
}

// ---- Command Result ----
export interface CommandResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly duration: number;
}

// ---- Command Handler ----
export type CommandHandler<TCommand = unknown, TResult = unknown> = (
  command: Command<TCommand>,
) => Promise<CommandResult<TResult>>;

// ---- Command Validator ----
export type CommandValidator<TCommand = unknown> = (
  payload: TCommand,
) => { valid: boolean; errors?: string[] };

// ---- Command Bus ----
export class CommandBus {
  private handlers: Map<string, CommandHandler> = new Map();
  private validators: Map<string, CommandValidator> = new Map();
  private middleware: CommandMiddleware[] = [];
  private history: CommandRecord[] = [];
  private maxHistory: number;
  private logger: LoggerInterface;

  constructor(options?: { maxHistory?: number; logger?: LoggerInterface }) {
    this.maxHistory = options?.maxHistory ?? 1000;
    this.logger = options?.logger ?? new Logger();
  }

  register<TCommand, TResult>(
    commandType: string,
    handler: CommandHandler<TCommand, TResult>,
    validator?: CommandValidator<TCommand>,
  ): void {
    this.handlers.set(commandType, handler as CommandHandler);
    if (validator) {
      this.validators.set(commandType, validator as CommandValidator);
    }
    this.logger.info(`Registered command handler: ${commandType}`);
  }

  unregister(commandType: string): void {
    this.handlers.delete(commandType);
    this.validators.delete(commandType);
  }

  use(middleware: CommandMiddleware): void {
    this.middleware.push(middleware);
  }

  async dispatch<TCommand, TResult>(commandType: string, payload: TCommand): Promise<CommandResult<TResult>> {
    const command: Command<TCommand> = {
      commandId: `cmd-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
      commandType,
      timestamp: new Date(),
      payload,
    };

    // Validate
    const validator = this.validators.get(commandType);
    if (validator) {
      const result = validator(payload);
      if (!result.valid) {
        const cmdResult: CommandResult<TResult> = {
          success: false,
          error: `Validation failed: ${result.errors?.join(', ') ?? 'unknown error'}`,
          duration: 0,
        };
        this.recordCommand(command, cmdResult);
        return cmdResult;
      }
    }

    // Execute middleware chain
    const handler = this.handlers.get(commandType);
    if (!handler) {
      const cmdResult: CommandResult<TResult> = {
        success: false,
        error: `No handler registered for command: ${commandType}`,
        duration: 0,
      };
      this.recordCommand(command, cmdResult);
      return cmdResult;
    }

    const start = Date.now();
    try {
      let result = await handler(command);
      // Apply post-middleware
      for (const mw of this.middleware) {
        if (mw.after) result = await mw.after(command, result);
      }
      result = { ...result, duration: Date.now() - start };
      this.recordCommand(command, result);
      return result as CommandResult<TResult>;
    } catch (error) {
      const cmdResult: CommandResult<TResult> = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
      this.recordCommand(command, cmdResult);
      return cmdResult;
    }
  }

  hasHandler(commandType: string): boolean {
    return this.handlers.has(commandType);
  }

  listHandlers(): string[] {
    return Array.from(this.handlers.keys());
  }

  getHistory(commandType?: string): CommandRecord[] {
    if (commandType) return this.history.filter(r => r.commandType === commandType);
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  private recordCommand(command: Command, result: CommandResult): void {
    this.history.push({
      commandId: command.commandId,
      commandType: command.commandType,
      timestamp: command.timestamp,
      success: result.success,
      duration: result.duration,
      error: result.error,
    });
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }
}

// ---- Command Middleware ----
export interface CommandMiddleware {
  before?: (command: Command) => Promise<Command | null>;
  after?: (command: Command, result: CommandResult) => Promise<CommandResult>;
}

// ---- Logging Middleware ----
export function loggingCommandMiddleware(logger?: LoggerInterface): CommandMiddleware {
  const log = logger ?? new Logger();
  return {
    before: async (command) => {
      log.debug(`Dispatching command: ${command.commandType}`, { commandId: command.commandId });
      return command;
    },
    after: async (command, result) => {
      log.debug(`Command completed: ${command.commandType}`, {
        success: result.success,
        duration: result.duration,
      });
      return result;
    },
  };
}

// ---- Command Record ----
export interface CommandRecord {
  readonly commandId: string;
  readonly commandType: string;
  readonly timestamp: Date;
  readonly success: boolean;
  readonly duration: number;
  readonly error?: string;
}

// ---- Command Helper ----
export function createCommand<T>(commandType: string, payload: T, metadata?: Record<string, unknown>): Command<T> {
  return {
    commandId: `cmd-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
    commandType,
    timestamp: new Date(),
    payload,
    metadata,
  };
}
