// ============================================================================
// @claude-agent/core - Core Engine
// ============================================================================

import type {
  AgentId,
  TaskId,
  RequestId,
  AgentEvent,
  AgentEventType,
  AgentStatus,
  EventBusInterface,
  EventHandler,
  ClaudeAgentConfig,
  LifecycleManager,
  ShutdownCallback,
  LoggerInterface,
} from '@claude-agent/types';
import { AgentError, LifecycleError } from '@claude-agent/errors';
import { Logger, generateRequestId } from '@claude-agent/logger';
import { ConfigManager } from '@claude-agent/config';

// ---- ID Generators ----

let agentCounter = 0;
let taskCounter = 0;

export function generateAgentId(): AgentId {
  agentCounter++;
  return `agent-${Date.now().toString(36)}-${agentCounter.toString(36).padStart(4, '0')}` as AgentId;
}

export function generateTaskId(): TaskId {
  taskCounter++;
  return `task-${Date.now().toString(36)}-${taskCounter.toString(36).padStart(4, '0')}` as TaskId;
}

// ---- Event Bus ----

export class EventBus implements EventBusInterface {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private logger: LoggerInterface;

  constructor(logger?: LoggerInterface) {
    this.logger = logger ?? new Logger();
  }

  emit(event: AgentEvent): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          const result = handler(event);
          if (result instanceof Promise) {
            result.catch((error) => {
              this.logger.error('Event handler error', {
                eventType: event.type,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }
        } catch (error) {
          this.logger.error('Event handler error', {
            eventType: event.type,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  on(eventType: AgentEventType, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  off(eventType: AgentEventType, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  once(eventType: AgentEventType, handler: EventHandler): () => void {
    const wrapper: EventHandler = (event) => {
      this.off(eventType, wrapper);
      return handler(event);
    };
    return this.on(eventType, wrapper);
  }

  removeAllListeners(eventType?: AgentEventType): void {
    if (eventType) {
      this.handlers.delete(eventType);
    } else {
      this.handlers.clear();
    }
  }

  /** Get the number of listeners for an event type */
  listenerCount(eventType: AgentEventType): number {
    return this.handlers.get(eventType)?.size ?? 0;
  }
}

// ---- Agent Core ----

export class AgentCore {
  readonly id: AgentId;
  readonly name: string;
  private status: AgentStatus = 'idle';
  private createdAt: Date;
  private updatedAt: Date;
  private eventBus: EventBus;
  private logger: LoggerInterface;
  private config: ClaudeAgentConfig;
  private shutdownCallbacks: ShutdownCallback[] = [];
  private running: boolean = false;
  private startTime: number = 0;

  constructor(options: {
    id?: AgentId;
    name: string;
    config?: ClaudeAgentConfig;
    eventBus?: EventBus;
    logger?: LoggerInterface;
  }) {
    this.id = options.id ?? generateAgentId();
    this.name = options.name;
    this.config = options.config ?? ConfigManager.create().getConfig();
    this.eventBus = options.eventBus ?? new EventBus();
    this.logger = options.logger ?? new Logger();
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private setStatus(status: AgentStatus): void {
    this.status = status;
    this.updatedAt = new Date();
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }

  getLogger(): LoggerInterface {
    return this.logger;
  }

  getConfig(): ClaudeAgentConfig {
    return this.config;
  }

  getUptime(): number {
    if (this.startTime === 0) return 0;
    return Date.now() - this.startTime;
  }

  /** Start the agent */
  async start(): Promise<void> {
    if (this.running) {
      throw new LifecycleError('Agent is already running');
    }

    this.logger.info(`Starting agent: ${this.name}`, { agentId: this.id });
    this.setStatus('running');
    this.running = true;
    this.startTime = Date.now();

    this.eventBus.emit({
      type: 'agent.started',
      timestamp: new Date(),
      data: { agentId: this.id, agentName: this.name },
    });
  }

  /** Stop the agent */
  async stop(timeout: number = 10000): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info(`Stopping agent: ${this.name}`, { agentId: this.id });
    this.setStatus('stopping');

    // Execute shutdown callbacks
    const shutdownPromises = this.shutdownCallbacks.map(async (callback) => {
      try {
        await callback('SIGTERM');
      } catch (error) {
        this.logger.error('Shutdown callback error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Wait for all shutdown callbacks with timeout
    await Promise.race([
      Promise.all(shutdownPromises),
      new Promise<void>((resolve) => setTimeout(resolve, timeout)),
    ]);

    this.running = false;
    this.setStatus('stopped');

    this.eventBus.emit({
      type: 'agent.stopped',
      timestamp: new Date(),
      data: { agentId: this.id, agentName: this.name },
    });
  }

  /** Check if the agent is running */
  isRunning(): boolean {
    return this.running;
  }

  /** Register a shutdown callback */
  onShutdown(callback: ShutdownCallback): void {
    this.shutdownCallbacks.push(callback);
  }

  /** Emit an event */
  emit(type: AgentEventType, data: Record<string, unknown>): void {
    this.eventBus.emit({
      type,
      timestamp: new Date(),
      data: { ...data, agentId: this.id },
    });
  }
}

// ---- Lifecycle Manager ----

export class LifecycleManagerImpl implements LifecycleManager {
  private agent: AgentCore;
  private signalHandlers: Map<string, () => void> = new Map();
  private logger: LoggerInterface;

  constructor(agent: AgentCore) {
    this.agent = agent;
    this.logger = agent.getLogger();
  }

  async start(): Promise<void> {
    await this.agent.start();
    this.setupSignalHandlers();
  }

  async stop(timeout?: number): Promise<void> {
    this.removeSignalHandlers();
    await this.agent.stop(timeout);
  }

  isRunning(): boolean {
    return this.agent.isRunning();
  }

  onShutdown(callback: ShutdownCallback): void {
    this.agent.onShutdown(callback);
  }

  private setupSignalHandlers(): void {
    const handleSignal = async (signal: string) => {
      this.logger.info(`Received signal: ${signal}`);
      await this.stop(10000);
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };

    const onSigint = () => handleSignal('SIGINT');
    const onSigterm = () => handleSignal('SIGTERM');

    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    this.signalHandlers.set('SIGINT', onSigint);
    this.signalHandlers.set('SIGTERM', onSigterm);
  }

  private removeSignalHandlers(): void {
    for (const [signal, handler] of this.signalHandlers) {
      process.removeListener(signal as NodeJS.Signals, handler);
    }
    this.signalHandlers.clear();
  }
}
