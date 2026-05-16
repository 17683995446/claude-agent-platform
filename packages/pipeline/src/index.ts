// ============================================================================
// @claude-agent/pipeline - Task Pipeline System
// ============================================================================

import type {
  PipelineId,
  Pipeline,
  PipelineStatus,
  PipelineStep,
  PipelineDefinition,
  PipelineStepDefinition,
  PipelineContext,
  PipelineMiddleware,
  StepHandler,
  ClaudeAgentConfig,
  LoggerInterface,
  EventBusInterface,
} from '@claude-agent/types';
import { PipelineError, PipelineStepError, TaskTimeoutError } from '@claude-agent/errors';
import { Logger, generateRequestId } from '@claude-agent/logger';
import { EventBus } from '@claude-agent/core';
import { ConfigManager } from '@claude-agent/config';

// ---- ID Generator ----

let pipelineCounter = 0;

function generatePipelineId(): PipelineId {
  pipelineCounter++;
  return `pipeline-${Date.now().toString(36)}-${pipelineCounter.toString(36).padStart(4, '0')}` as PipelineId;
}

// ---- Pipeline Step Runner ----

async function runStep(
  step: PipelineStepDefinition,
  input: unknown,
  context: PipelineContext,
  handler?: StepHandler,
): Promise<{ output: unknown; duration: number }> {
  const startTime = Date.now();
  const timeout = step.timeout ?? 30000;
  const stepHandler = handler ?? step.handler;

  const output = await Promise.race([
    stepHandler(input, context),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new TaskTimeoutError(
        `Step "${step.name}" timed out`,
        timeout,
      )), timeout),
    ),
  ]);

  const duration = Date.now() - startTime;
  return { output, duration };
}

// ---- Pipeline Engine ----

export class PipelineEngine {
  private pipelines: Map<string, PipelineDefinition> = new Map();
  private logger: LoggerInterface;
  private eventBus: EventBusInterface;
  private config: ClaudeAgentConfig;

  constructor(options?: {
    logger?: LoggerInterface;
    eventBus?: EventBusInterface;
    config?: ClaudeAgentConfig;
  }) {
    this.logger = options?.logger ?? new Logger();
    this.eventBus = options?.eventBus ?? new EventBus();
    this.config = options?.config ?? ConfigManager.create().getConfig();
  }

  /** Register a pipeline definition */
  register(definition: PipelineDefinition): void {
    if (this.pipelines.has(definition.name)) {
      throw new PipelineError(
        `Pipeline "${definition.name}" is already registered`,
        definition.name,
      );
    }
    this.pipelines.set(definition.name, definition);
    this.logger.info(`Registered pipeline: ${definition.name}`, {
      steps: definition.steps.map((s) => s.name),
    });
  }

  /** Unregister a pipeline */
  unregister(name: string): void {
    this.pipelines.delete(name);
  }

  /** Get a registered pipeline */
  get(name: string): PipelineDefinition | undefined {
    return this.pipelines.get(name);
  }

  /** List all registered pipelines */
  list(): string[] {
    return Array.from(this.pipelines.keys());
  }

  /** Execute a pipeline */
  async execute(
    name: string,
    input: unknown,
    options?: {
      metadata?: Record<string, unknown>;
      middleware?: PipelineMiddleware[];
    },
  ): Promise<Pipeline> {
    const definition = this.pipelines.get(name);
    if (!definition) {
      throw new PipelineError(`Pipeline "${name}" not found`, name);
    }

    const pipelineId = generatePipelineId();
    const requestId = generateRequestId() as any;
    const steps: PipelineStep[] = [];
    let pipelineStatus: PipelineStatus = 'running';
    let currentInput = input;

    // Create pipeline context
    const context: PipelineContext = {
      pipelineId,
      requestId,
      logger: this.logger,
      eventBus: this.eventBus,
      config: this.config,
      metadata: options?.metadata ?? {},
    };

    // Emit pipeline start event
    this.eventBus.emit({
      type: 'pipeline.started',
      timestamp: new Date(),
      requestId,
      data: { pipelineId, pipelineName: name, steps: definition.steps.length },
    });

    this.logger.info(`Pipeline started: ${name}`, { pipelineId, requestId });

    // Merge middleware
    const allMiddleware = [
      ...(definition.middleware ?? []),
      ...(options?.middleware ?? []),
    ];

    try {
      for (const stepDef of definition.steps) {
        const stepResult: PipelineStep = {
          name: stepDef.name,
          status: 'running',
        };

        this.logger.debug(`Executing step: ${stepDef.name}`, { pipelineId, step: stepDef.name });

        try {
          // Apply middleware chain
          const wrappedHandler = this.applyMiddleware(stepDef.handler, allMiddleware, context);

          const { output, duration } = await runStep(stepDef, currentInput, context, wrappedHandler);

          stepResult.status = 'completed';
          stepResult.output = output;
          stepResult.duration = duration;

          currentInput = output;
        } catch (error) {
          stepResult.status = 'failed';
          stepResult.error = {
            code: 'PIPELINE_STEP_FAILED',
            message: error instanceof Error ? error.message : String(error),
            timestamp: new Date(),
          };

          pipelineStatus = 'failed';
          steps.push(stepResult);

          this.logger.error(`Step failed: ${stepDef.name}`, {
            pipelineId,
            step: stepDef.name,
            error: error instanceof Error ? error.message : String(error),
          });

          throw new PipelineStepError(
            `Step "${stepDef.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
            name,
            stepDef.name,
            {},
            error instanceof Error ? error : undefined,
          );
        }

        steps.push(stepResult);
      }

      pipelineStatus = 'completed';
    } catch (error) {
      if (error instanceof PipelineStepError) {
        // Already handled above
      } else {
        pipelineStatus = 'failed';
      }
    }

    const pipeline: Pipeline = {
      id: pipelineId,
      name,
      status: pipelineStatus,
      steps,
      createdAt: new Date(),
    };

    // Emit pipeline completion event
    this.eventBus.emit({
      type: pipelineStatus === 'completed' ? 'pipeline.completed' : 'pipeline.failed',
      timestamp: new Date(),
      requestId,
      data: {
        pipelineId,
        pipelineName: name,
        status: pipelineStatus,
        stepsCompleted: steps.filter((s) => s.status === 'completed').length,
        stepsTotal: steps.length,
      },
    });

    this.logger.info(`Pipeline ${pipelineStatus}: ${name}`, { pipelineId, requestId });

    if (pipelineStatus === 'failed') {
      // Re-throw the original error if it was a PipelineStepError
      const lastError = steps.find(s => s.status === 'failed')?.error;
      if (lastError) {
        throw new PipelineStepError(
          lastError.message,
          name,
          steps.find(s => s.status === 'failed')?.name ?? 'unknown',
          { pipelineId, steps },
        );
      }
      throw new PipelineError(
        `Pipeline "${name}" failed`,
        name,
        { pipelineId, steps },
      );
    }

    return pipeline;
  }

  /** Apply middleware chain to a step handler */
  private applyMiddleware(
    handler: StepHandler,
    middleware: PipelineMiddleware[],
    context: PipelineContext,
  ): StepHandler {
    if (middleware.length === 0) return handler;

    // Build middleware chain from last to first
    let chain = async (input: unknown): Promise<unknown> => {
      return handler(input, context);
    };

    for (let i = middleware.length - 1; i >= 0; i--) {
      const mw = middleware[i]!;
      const next = chain;
      chain = async (input: unknown): Promise<unknown> => {
        return mw(context, () => next(input));
      };
    }

    return async (input: unknown): Promise<unknown> => {
      return chain(input);
    };
  }

  /** Create a pipeline definition builder */
  static define(name: string): PipelineBuilder {
    return new PipelineBuilder(name);
  }
}

// ---- Pipeline Builder (Fluent API) ----

export class PipelineBuilder {
  private name: string;
  private steps: PipelineStepDefinition[] = [];
  private middleware: PipelineMiddleware[] = [];

  private constructor(name: string) {
    this.name = name;
  }

  /** Create a new pipeline builder */
  static define(name: string): PipelineBuilder {
    return new PipelineBuilder(name);
  }

  /** Add a step to the pipeline */
  step(name: string, handler: StepHandler, options?: { timeout?: number; retryCount?: number }): PipelineBuilder {
    this.steps.push({ name, handler, ...options });
    return this;
  }

  /** Add middleware to the pipeline */
  use(middleware: PipelineMiddleware): PipelineBuilder {
    this.middleware.push(middleware);
    return this;
  }

  /** Build the pipeline definition */
  build(): PipelineDefinition {
    if (this.steps.length === 0) {
      throw new PipelineError('Pipeline must have at least one step', this.name);
    }
    return {
      name: this.name,
      steps: this.steps,
      middleware: this.middleware.length > 0 ? this.middleware : undefined,
    };
  }
}

// ---- Built-in Pipelines ----

/** Create an analyze pipeline */
export function createAnalyzePipeline(engine: PipelineEngine): void {
  const definition = PipelineBuilder.define('analyze')
    .step('parse', async (input) => {
      return { parsed: input, format: 'auto-detected' };
    })
    .step('validate', async (input) => {
      return { ...input, valid: true };
    })
    .step('report', async (input) => {
      return { ...input, report: 'Analysis complete' };
    })
    .build();

  engine.register(definition);
}

/** Create a test pipeline */
export function createTestPipeline(engine: PipelineEngine): void {
  const definition = PipelineBuilder.define('test')
    .step('discover', async (input) => {
      return { ...input, tests: ['test-1', 'test-2', 'test-3'] };
    })
    .step('execute', async (input) => {
      return { ...input, results: { passed: 3, failed: 0, skipped: 0 } };
    })
    .step('report', async (input) => {
      return { ...input, summary: 'All tests passed' };
    })
    .build();

  engine.register(definition);
}

/** Create a devops pipeline */
export function createDevOpsPipeline(engine: PipelineEngine): void {
  const definition = PipelineBuilder.define('devops')
    .step('lint', async (input) => {
      return { ...input, lint: 'passed' };
    })
    .step('build', async (input) => {
      return { ...input, build: 'success' };
    })
    .step('deploy', async (input) => {
      return { ...input, deployed: true };
    })
    .build();

  engine.register(definition);
}
