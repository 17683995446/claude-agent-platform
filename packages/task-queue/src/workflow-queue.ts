/**
 * Queue-aware workflow execution.
 */

export interface WorkflowStep {
  name: string;
  handler: (data: unknown) => Promise<unknown>;
  retryPolicy?: {
    maxAttempts?: number;
    backoffMs?: number;
  };
  timeout?: number;
}

export interface StepResult {
  stepName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
}

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  currentStep: number;
  status: WorkflowStatus;
  data: unknown;
  history: StepResult[];
  createdAt: number;
  updatedAt: number;
}

let workflowInstanceIdCounter = 0;

function generateWorkflowInstanceId(): string {
  return `wf_instance_${Date.now()}_${++workflowInstanceIdCounter}`;
}

export class WorkflowQueue {
  private workflows: Map<string, WorkflowStep[]> = new Map();
  private instances: Map<string, WorkflowInstance> = new Map();

  defineWorkflow(name: string, steps: WorkflowStep[]): string {
    const id = name;
    this.workflows.set(id, steps);
    return id;
  }

  enqueue(workflowId: string, data: unknown, options?: { instanceId?: string }): string {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const id = options?.instanceId ?? generateWorkflowInstanceId();
    const now = Date.now();
    const instance: WorkflowInstance = {
      id,
      workflowId,
      currentStep: 0,
      status: 'pending',
      data,
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    this.instances.set(id, instance);
    return id;
  }

  async processNext(instanceId: string): Promise<StepResult> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance ${instanceId} not found`);
    }

    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${instance.workflowId} not found`);
    }

    if (instance.status === 'completed' || instance.status === 'failed' || instance.status === 'cancelled') {
      throw new Error(`Workflow instance ${instanceId} is ${instance.status}`);
    }

    if (instance.currentStep >= workflow.length) {
      instance.status = 'completed';
      instance.updatedAt = Date.now();
      throw new Error('Workflow has no more steps');
    }

    instance.status = 'running';
    instance.updatedAt = Date.now();

    const step = workflow[instance.currentStep]!;
    const maxAttempts = step.retryPolicy?.maxAttempts ?? 1;
    const backoffMs = step.retryPolicy?.backoffMs ?? 1000;

    let lastError: string | undefined;
    let success = false;
    let result: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
        }

        const timeout = step.timeout;
        if (timeout && timeout > 0) {
          let timer: ReturnType<typeof setTimeout>;
          try {
            result = await Promise.race([
              step.handler(instance.data),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Step timed out after ${timeout}ms`)), timeout);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        } else {
          result = await step.handler(instance.data);
        }

        success = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    const stepResult: StepResult = {
      stepName: step.name,
      success,
      result: success ? result : undefined,
      error: success ? undefined : lastError,
      duration: 0,
    };

    instance.history.push(stepResult);
    instance.updatedAt = Date.now();

    if (success) {
      instance.currentStep++;
      if (instance.currentStep >= workflow.length) {
        instance.status = 'completed';
      } else {
        instance.status = 'pending';
      }
    } else {
      instance.status = 'failed';
    }

    return stepResult;
  }

  getWorkflowStatus(instanceId: string): WorkflowInstance | undefined {
    return this.instances.get(instanceId);
  }

  cancelWorkflow(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    if (instance.status === 'completed' || instance.status === 'failed' || instance.status === 'cancelled') {
      return false;
    }
    instance.status = 'cancelled';
    instance.updatedAt = Date.now();
    return true;
  }

  getPendingWorkflows(): WorkflowInstance[] {
    return Array.from(this.instances.values()).filter(
      (i) => i.status === 'pending' || i.status === 'running'
    );
  }

  getStats(): {
    totalWorkflows: number;
    activeWorkflows: number;
    completedWorkflows: number;
    failedWorkflows: number;
  } {
    const instances = Array.from(this.instances.values());
    return {
      totalWorkflows: instances.length,
      activeWorkflows: instances.filter((i) => i.status === 'pending' || i.status === 'running').length,
      completedWorkflows: instances.filter((i) => i.status === 'completed').length,
      failedWorkflows: instances.filter((i) => i.status === 'failed').length,
    };
  }
}
