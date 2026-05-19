// workflow-events.ts - 工作流事件系统

export type WorkflowEventType =
  | 'workflow.started'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'workflow.paused'
  | 'workflow.resumed'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'step.retried'
  | 'variable.changed';

export interface WorkflowEvent {
  type: WorkflowEventType;
  timestamp: Date;
  workflowId: string;
  instanceId: string;
  stepId?: string;
  data?: Record<string, unknown>;
}

export type EventMiddleware = (event: WorkflowEvent) => WorkflowEvent | null;
export type EventHandler = (event: WorkflowEvent) => void | Promise<void>;

export class WorkflowEventEmitter {
  private handlers = new Map<WorkflowEventType, EventHandler[]>();
  private wildcardHandlers: EventHandler[] = [];
  private middlewares: EventMiddleware[] = [];
  private history: WorkflowEvent[] = [];
  private maxHistory: number;

  constructor(maxHistory = 1000) {
    this.maxHistory = maxHistory;
  }

  /**
   * Register an event handler for a specific event type.
   */
  on(type: WorkflowEventType | '*', handler: EventHandler): void {
    if (type === '*') {
      this.wildcardHandlers.push(handler);
    } else {
      const existing = this.handlers.get(type) ?? [];
      existing.push(handler);
      this.handlers.set(type, existing);
    }
  }

  /**
   * Remove an event handler.
   */
  off(type: WorkflowEventType | '*', handler: EventHandler): void {
    if (type === '*') {
      this.wildcardHandlers = this.wildcardHandlers.filter(h => h !== handler);
    } else {
      const existing = this.handlers.get(type) ?? [];
      this.handlers.set(type, existing.filter(h => h !== handler));
    }
  }

  /**
   * Add event middleware for transformation/filtering.
   * Return null from middleware to filter out the event.
   */
  use(middleware: EventMiddleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Emit an event.
   */
  async emit(event: WorkflowEvent): Promise<void> {
    // Apply middlewares
    let processedEvent: WorkflowEvent | null = { ...event };
    for (const middleware of this.middlewares) {
      processedEvent = middleware(processedEvent);
      if (!processedEvent) return; // Filtered out
    }

    // Record in history
    this.history.push(processedEvent);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Get handlers for this event type
    const typeHandlers = this.handlers.get(processedEvent.type) ?? [];
    const allHandlers = [...typeHandlers, ...this.wildcardHandlers];

    // Execute all handlers with error isolation
    await Promise.allSettled(
      allHandlers.map(async (handler) => {
        try {
          await handler(processedEvent);
        } catch {
          // Error isolation - don't let one handler break others
        }
      })
    );
  }

  /**
   * Emit a workflow event with convenience parameters.
   */
  async emitWorkflowEvent(
    type: WorkflowEventType,
    workflowId: string,
    instanceId: string,
    data?: Record<string, unknown>,
    stepId?: string,
  ): Promise<void> {
    await this.emit({
      type,
      timestamp: new Date(),
      workflowId,
      instanceId,
      stepId,
      data,
    });
  }

  /**
   * Replay events from history.
   */
  async replay(filter?: (event: WorkflowEvent) => boolean): Promise<void> {
    const events = filter ? this.history.filter(filter) : this.history;
    for (const event of events) {
      // Emit directly to handlers without re-recording to history
      let processedEvent: WorkflowEvent | null = { ...event };
      for (const middleware of this.middlewares) {
        processedEvent = middleware(processedEvent);
        if (!processedEvent) continue;
      }

      const typeHandlers = this.handlers.get(processedEvent.type) ?? [];
      const allHandlers = [...typeHandlers, ...this.wildcardHandlers];

      await Promise.allSettled(
        allHandlers.map(async (handler) => {
          try {
            await handler(processedEvent);
          } catch {
            // Error isolation
          }
        })
      );
    }
  }

  /**
   * Get event history.
   */
  getHistory(filter?: { type?: WorkflowEventType; workflowId?: string; instanceId?: string }): WorkflowEvent[] {
    let events = [...this.history];
    if (filter?.type) {
      events = events.filter(e => e.type === filter.type);
    }
    if (filter?.workflowId) {
      events = events.filter(e => e.workflowId === filter.workflowId);
    }
    if (filter?.instanceId) {
      events = events.filter(e => e.instanceId === filter.instanceId);
    }
    return events;
  }

  /**
   * Clear event history.
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Get the number of recorded events.
   */
  getEventCount(): number {
    return this.history.length;
  }

  /**
   * Remove all handlers and middlewares.
   */
  removeAllListeners(): void {
    this.handlers.clear();
    this.wildcardHandlers = [];
    this.middlewares = [];
  }
}
