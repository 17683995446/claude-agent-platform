// graceful-shutdown.ts - 优雅关闭

export type ShutdownPhase = 'stop_accepting' | 'drain_active' | 'cleanup' | 'exit';

export interface ShutdownHandler {
  name: string;
  handler: () => Promise<void>;
  phase: ShutdownPhase;
  timeout?: number;
}

export interface ShutdownConfig {
  drainTimeout: number;
  forceShutdownTimeout: number;
  signals: NodeJS.Signals[];
}

export interface ShutdownStatus {
  isShuttingDown: boolean;
  phase: ShutdownPhase | null;
  reason: string | null;
  startTime: number | null;
  completedHandlers: string[];
  failedHandlers: string[];
  pendingHandlers: string[];
}

type ShutdownEventCallback = (phase: ShutdownPhase, status: ShutdownStatus) => void;

export class GracefulShutdownManager {
  private handlers: ShutdownHandler[] = [];
  private isShuttingDownFlag = false;
  private currentPhase: ShutdownPhase | null = null;
  private shutdownReason: string | null = null;
  private shutdownStartTime: number | null = null;
  private completedHandlers: string[] = [];
  private failedHandlers: string[] = [];
  private inFlightCount = 0;
  private eventCallbacks: ShutdownEventCallback[] = [];
  private signalHandlers = new Map<NodeJS.Signals, () => void>();
  private readonly config: Required<ShutdownConfig>;

  constructor(config?: Partial<ShutdownConfig>) {
    this.config = {
      drainTimeout: 30000,
      forceShutdownTimeout: 10000,
      signals: ['SIGINT', 'SIGTERM', 'SIGHUP'],
      ...config,
    };

    this.setupSignalHandlers();
  }

  register(handler: () => Promise<void>, phase: ShutdownPhase = 'cleanup', name?: string, timeout?: number): void {
    this.handlers.push({
      name: name ?? `handler_${this.handlers.length}`,
      handler,
      phase,
      timeout,
    });
  }

  async shutdown(reason?: string): Promise<void> {
    if (this.isShuttingDownFlag) return;

    this.isShuttingDownFlag = true;
    this.shutdownReason = reason ?? 'manual';
    this.shutdownStartTime = Date.now();

    const phases: ShutdownPhase[] = ['stop_accepting', 'drain_active', 'cleanup', 'exit'];

    for (const phase of phases) {
      this.currentPhase = phase;
      const phaseHandlers = this.handlers.filter(h => h.phase === phase);

      this.emitEvent(phase, this.getStatus());

      const phaseTimeout = this.getPhaseTimeout(phase);

      await this.executeHandlers(phaseHandlers, phaseTimeout);
    }

    this.currentPhase = null;
  }

  isShuttingDown(): boolean {
    return this.isShuttingDownFlag;
  }

  getStatus(): ShutdownStatus {
    const allHandlerNames = this.handlers.map(h => h.name);
    const completedSet = new Set(this.completedHandlers);
    const failedSet = new Set(this.failedHandlers);

    return {
      isShuttingDown: this.isShuttingDownFlag,
      phase: this.currentPhase,
      reason: this.shutdownReason,
      startTime: this.shutdownStartTime,
      completedHandlers: this.completedHandlers,
      failedHandlers: this.failedHandlers,
      pendingHandlers: allHandlerNames.filter(n => !completedSet.has(n) && !failedSet.has(n)),
    };
  }

  incrementInFlight(): void {
    this.inFlightCount++;
  }

  decrementInFlight(): void {
    if (this.inFlightCount > 0) {
      this.inFlightCount--;
    }
  }

  getInFlightCount(): number {
    return this.inFlightCount;
  }

  onShutdownEvent(callback: ShutdownEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  removeHandler(name: string): void {
    this.handlers = this.handlers.filter(h => h.name !== name);
  }

  destroy(): void {
    for (const [signal, handler] of this.signalHandlers) {
      process.off(signal, handler);
    }
    this.signalHandlers.clear();
  }

  private setupSignalHandlers(): void {
    for (const signal of this.config.signals) {
      const handler = () => {
        this.shutdown(`Received ${signal}`).catch(() => {
          process.exit(1);
        });
      };
      process.on(signal, handler);
      this.signalHandlers.set(signal, handler);
    }
  }

  private getPhaseTimeout(phase: ShutdownPhase): number {
    const handler = this.handlers.find(h => h.phase === phase && h.timeout);
    if (handler?.timeout) return handler.timeout;

    switch (phase) {
      case 'stop_accepting':
        return 5000;
      case 'drain_active':
        return this.config.drainTimeout;
      case 'cleanup':
        return 15000;
      case 'exit':
        return 5000;
      default:
        return 10000;
    }
  }

  private async executeHandlers(handlers: ShutdownHandler[], timeout: number): Promise<void> {
    if (handlers.length === 0) return;

    const results = await Promise.race([
      Promise.all(
        handlers.map(async h => {
          try {
            const handlerTimeout = h.timeout ?? timeout;
            await Promise.race([
              h.handler(),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Handler ${h.name} timed out`)), handlerTimeout),
              ),
            ]);
            this.completedHandlers.push(h.name);
          } catch (error) {
            this.failedHandlers.push(h.name);
          }
        }),
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Phase timeout after ${timeout}ms`)), timeout),
      ),
    ]).catch(() => {
      // Phase timed out, continue to next phase
    });
  }

  private emitEvent(phase: ShutdownPhase, status: ShutdownStatus): void {
    this.eventCallbacks.forEach(cb => cb(phase, status));
  }
}
