// error-handler.ts - 工作流错误处理

export type ErrorStrategy = 'retry' | 'skip' | 'fail' | 'fallback' | 'compensate';

export interface RetryPolicy {
  count: number;
  delay: number;
  backoff: 'fixed' | 'exponential' | 'none';
  jitter?: boolean;
}

export interface ErrorContext {
  workflowId: string;
  instanceId: string;
  stepId: string;
  error: Error;
  variables: Record<string, unknown>;
  attempt: number;
}

export interface ErrorResolution {
  action: 'retry' | 'skip' | 'fail' | 'fallback' | 'compensate';
  result?: unknown;
  error?: string;
  retried: boolean;
}

export interface DeadLetterItem {
  id: string;
  context: ErrorContext;
  timestamp: Date;
  resolution: ErrorResolution;
}

export interface ErrorNotification {
  context: ErrorContext;
  resolution: ErrorResolution;
  timestamp: Date;
}

type NotificationHook = (notification: ErrorNotification) => void | Promise<void>;

export class WorkflowErrorHandler {
  private strategies = new Map<string, ErrorStrategy>();
  private retryPolicies = new Map<string, RetryPolicy>();
  private fallbackHandlers = new Map<string, () => Promise<unknown>>();
  private compensateHandlers = new Map<string, () => Promise<void>>();
  private deadLetterQueue: DeadLetterItem[] = [];
  private notificationHooks: NotificationHook[] = [];
  private retryableCheckers: Array<(error: Error) => boolean> = [];

  /**
   * Set error strategy for a step.
   */
  setStrategy(stepId: string, strategy: ErrorStrategy): void {
    this.strategies.set(stepId, strategy);
  }

  /**
   * Set retry policy for a step.
   */
  setRetryPolicy(stepId: string, policy: RetryPolicy): void {
    this.retryPolicies.set(stepId, policy);
  }

  /**
   * Register a fallback handler for a step.
   */
  setFallback(stepId: string, handler: () => Promise<unknown>): void {
    this.fallbackHandlers.set(stepId, handler);
  }

  /**
   * Register a compensation handler for a step (saga pattern).
   */
  setCompensate(stepId: string, handler: () => Promise<void>): void {
    this.compensateHandlers.set(stepId, handler);
  }

  /**
   * Add a notification hook.
   */
  addNotificationHook(hook: NotificationHook): void {
    this.notificationHooks.push(hook);
  }

  /**
   * Register a retryable error checker.
   */
  addRetryableChecker(checker: (error: Error) => boolean): void {
    this.retryableCheckers.push(checker);
  }

  /**
   * Check if an error is retryable.
   */
  isRetryable(error: Error): boolean {
    // Default: network and timeout errors are retryable
    const retryablePatterns = [/ECONNREFUSED/, /ETIMEDOUT/, /ECONNRESET/, /socket hang up/, /timeout/];
    if (retryablePatterns.some(p => p.test(error.message))) return true;
    if (this.retryableCheckers.some(checker => checker(error))) return true;
    return false;
  }

  /**
   * Handle an error according to the configured strategy.
   */
  async handle(error: Error, context: ErrorContext): Promise<ErrorResolution> {
    const strategy = this.strategies.get(context.stepId) ?? 'fail';
    const policy = this.retryPolicies.get(context.stepId);
    const resolution = await this.applyStrategy(strategy, error, context, policy);

    // Send notifications
    const notification: ErrorNotification = {
      context,
      resolution,
      timestamp: new Date(),
    };
    for (const hook of this.notificationHooks) {
      try {
        await hook(notification);
      } catch {
        // Isolate notification errors
      }
    }

    // Add to dead letter queue if failed
    if (resolution.action === 'fail') {
      this.deadLetterQueue.push({
        id: `${context.stepId}-${Date.now()}`,
        context,
        timestamp: new Date(),
        resolution,
      });
    }

    return resolution;
  }

  private async applyStrategy(
    strategy: ErrorStrategy,
    error: Error,
    context: ErrorContext,
    policy?: RetryPolicy,
  ): Promise<ErrorResolution> {
    switch (strategy) {
      case 'retry': {
        if (!policy || context.attempt >= policy.count) {
          return { action: 'fail', error: error.message, retried: context.attempt > 0 };
        }
        if (!this.isRetryable(error) && context.attempt > 0) {
          return { action: 'fail', error: `Non-retryable error: ${error.message}`, retried: true };
        }
        let delay = policy.delay;
        if (policy.backoff === 'exponential') {
          delay = policy.delay * Math.pow(2, context.attempt);
        }
        if (policy.jitter) {
          delay = delay * (0.5 + Math.random() * 0.5);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        return { action: 'retry', retried: true };
      }

      case 'skip':
        return { action: 'skip', result: null, retried: false };

      case 'fail':
        return { action: 'fail', error: error.message, retried: false };

      case 'fallback': {
        const handler = this.fallbackHandlers.get(context.stepId);
        if (handler) {
          try {
            const result = await handler();
            return { action: 'fallback', result, retried: false };
          } catch (fallbackError) {
            return { action: 'fail', error: `Fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`, retried: false };
          }
        }
        return { action: 'fail', error: `No fallback handler for step "${context.stepId}"`, retried: false };
      }

      case 'compensate': {
        const handler = this.compensateHandlers.get(context.stepId);
        if (handler) {
          try {
            await handler();
            return { action: 'compensate', retried: false };
          } catch (compensateError) {
            return { action: 'fail', error: `Compensation failed: ${compensateError instanceof Error ? compensateError.message : String(compensateError)}`, retried: false };
          }
        }
        return { action: 'fail', error: `No compensate handler for step "${context.stepId}"`, retried: false };
      }

      default:
        return { action: 'fail', error: `Unknown strategy: ${strategy}`, retried: false };
    }
  }

  /**
   * Get all items in the dead letter queue.
   */
  getDeadLetterQueue(): DeadLetterItem[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Clear the dead letter queue.
   */
  clearDeadLetterQueue(): void {
    this.deadLetterQueue = [];
  }

  /**
   * Get the size of the dead letter queue.
   */
  getDeadLetterQueueSize(): number {
    return this.deadLetterQueue.length;
  }
}
