// workflow-engine.ts - 工作流引擎核心

export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type StepType = 'task' | 'condition' | 'parallel' | 'subworkflow' | 'delay' | 'transform' | 'approval';

export interface RetryPolicy {
  count: number;
  delay: number;
  backoff: 'fixed' | 'exponential' | 'none';
  jitter?: boolean;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  config: Record<string, unknown>;
  next: string[];
  onError?: string;
  timeout?: number;
  retryPolicy?: RetryPolicy;
}

export interface ErrorHandlingConfig {
  strategy: 'retry' | 'skip' | 'fail' | 'fallback' | 'compensate';
  maxRetries?: number;
  fallbackStep?: string;
  compensateSteps?: string[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  steps: WorkflowStep[];
  variables?: Record<string, unknown>;
  triggers?: string[];
  errorHandling?: ErrorHandlingConfig;
}

export interface WorkflowHistoryEntry {
  stepId: string;
  status: WorkflowStatus;
  timestamp: Date;
  output?: unknown;
  error?: string;
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  status: WorkflowStatus;
  currentStep: string | null;
  variables: Record<string, unknown>;
  history: WorkflowHistoryEntry[];
  startedAt: Date;
  completedAt: Date | null;
}

export interface WorkflowResult {
  success: boolean;
  instanceId: string;
  output?: Record<string, unknown>;
  error?: string;
  duration: number;
}

export class WorkflowEngine {
  private definitions = new Map<string, WorkflowDefinition>();
  private instances = new Map<string, WorkflowInstance>();
  private stepExecutors = new Map<StepType, (step: WorkflowStep, variables: Record<string, unknown>) => Promise<unknown>>();

  constructor() {
    // Register default step executors
    this.stepExecutors.set('task', async (step, vars) => {
      const fn = step.config.handler as ((vars: Record<string, unknown>) => Promise<unknown>) | undefined;
      if (fn) return fn(vars);
      return { executed: step.id, variables: vars };
    });

    this.stepExecutors.set('delay', async (step) => {
      const ms = (step.config.duration as number) ?? 1000;
      await new Promise(resolve => setTimeout(resolve, ms));
      return { delayed: ms };
    });

    this.stepExecutors.set('transform', async (step, vars) => {
      return { transformed: step.id, input: vars };
    });

    this.stepExecutors.set('approval', async (step) => {
      const autoApprove = step.config.autoApprove as boolean ?? false;
      return { approved: autoApprove, stepId: step.id };
    });

    this.stepExecutors.set('condition', async (step, vars) => {
      return { evaluated: step.id, variables: vars };
    });

    this.stepExecutors.set('parallel', async (step, vars) => {
      return { parallel: step.id, variables: vars };
    });

    this.stepExecutors.set('subworkflow', async (step, vars) => {
      return { subworkflow: step.id, variables: vars };
    });
  }

  registerStepExecutor(type: StepType, executor: (step: WorkflowStep, variables: Record<string, unknown>) => Promise<unknown>): void {
    this.stepExecutors.set(type, executor);
  }

  define(definition: WorkflowDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  getDefinition(id: string): WorkflowDefinition | undefined {
    return this.definitions.get(id);
  }

  getInstance(id: string): WorkflowInstance | undefined {
    return this.instances.get(id);
  }

  async execute(workflowId: string, input: Record<string, unknown>): Promise<WorkflowResult> {
    const definition = this.definitions.get(workflowId);
    if (!definition) {
      return { success: false, instanceId: '', error: `Workflow "${workflowId}" not found`, duration: 0 };
    }

    const instanceId = `${workflowId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const instance: WorkflowInstance = {
      id: instanceId,
      definitionId: workflowId,
      status: 'running',
      currentStep: null,
      variables: { ...definition.variables, ...input },
      history: [],
      startedAt: new Date(),
      completedAt: null,
    };
    this.instances.set(instanceId, instance);

    const startTime = Date.now();

    try {
      // Find starting step (first step or step with no incoming dependencies)
      const stepMap = new Map(definition.steps.map(s => [s.id, s]));
      const hasIncoming = new Set<string>();
      for (const step of definition.steps) {
        for (const nextId of step.next) {
          hasIncoming.add(nextId);
        }
      }

      let currentStepId: string | null = null;
      for (const step of definition.steps) {
        if (!hasIncoming.has(step.id)) {
          currentStepId = step.id;
          break;
        }
      }

      if (!currentStepId && definition.steps.length > 0) {
        currentStepId = definition.steps[0].id;
      }

      const visited = new Set<string>();

      while (currentStepId) {
        if (instance.status === 'paused') {
          // Wait for resume
          await new Promise<void>((resolve) => {
            const check = () => {
              if (instance.status !== 'paused') resolve();
              else setTimeout(check, 50);
            };
            check();
          });
        }

        if (instance.status === 'cancelled') {
          instance.completedAt = new Date();
          return { success: false, instanceId, error: 'Workflow cancelled', duration: Date.now() - startTime };
        }

        const step = stepMap.get(currentStepId);
        if (!step) break;

        instance.currentStep = currentStepId;
        instance.history.push({
          stepId: currentStepId,
          status: 'running',
          timestamp: new Date(),
        });

        try {
          const output = await this.executeStepWithRetry(step, instance.variables);
          instance.variables[`${step.id}_output`] = output;
          instance.history.push({
            stepId: currentStepId,
            status: 'completed',
            timestamp: new Date(),
            output,
          });
          visited.add(currentStepId);

          // Move to next step
          if (step.next.length === 0) {
            currentStepId = null;
          } else {
            currentStepId = step.next[0];
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          instance.history.push({
            stepId: currentStepId,
            status: 'failed',
            timestamp: new Date(),
            error: errorMsg,
          });

          if (step.onError) {
            currentStepId = step.onError;
          } else {
            instance.status = 'failed';
            instance.completedAt = new Date();
            return { success: false, instanceId, error: errorMsg, duration: Date.now() - startTime };
          }
        }
      }

      instance.status = 'completed';
      instance.completedAt = new Date();
      instance.currentStep = null;
      return { success: true, instanceId, output: instance.variables, duration: Date.now() - startTime };
    } catch (err) {
      instance.status = 'failed';
      instance.completedAt = new Date();
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, instanceId, error: errorMsg, duration: Date.now() - startTime };
    }
  }

  private async executeStepWithRetry(step: WorkflowStep, variables: Record<string, unknown>): Promise<unknown> {
    const executor = this.stepExecutors.get(step.type);
    if (!executor) throw new Error(`No executor for step type: ${step.type}`);

    const retryPolicy = step.retryPolicy ?? { count: 0, delay: 0, backoff: 'none' };
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryPolicy.count; attempt++) {
      try {
        if (step.timeout) {
          return await Promise.race([
            executor(step, variables),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Step "${step.id}" timed out after ${step.timeout}ms`)), step.timeout)),
          ]);
        }
        return await executor(step, variables);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < retryPolicy.count) {
          let delay = retryPolicy.delay;
          if (retryPolicy.backoff === 'exponential') {
            delay = retryPolicy.delay * Math.pow(2, attempt);
          }
          if (retryPolicy.jitter) {
            delay = delay * (0.5 + Math.random() * 0.5);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error(`Step "${step.id}" failed after ${retryPolicy.count} retries`);
  }

  pause(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance && instance.status === 'running') {
      instance.status = 'paused';
    }
  }

  resume(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance && instance.status === 'paused') {
      instance.status = 'running';
    }
  }

  cancel(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance && (instance.status === 'running' || instance.status === 'paused')) {
      instance.status = 'cancelled';
    }
  }

  listInstances(): WorkflowInstance[] {
    return Array.from(this.instances.values());
  }
}
