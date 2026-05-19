// ============================================================================
// SmartOrchestrator - Intelligent Task Orchestration Engine
// ============================================================================

import type {
  DecompositionResult,
  ExecutionPlan,
  ExecutionPhase,
  OrchestratorState,
  ReorderDecision,
  SubTask,
} from './types.js';
import type { LoggerInterface } from '@claude-agent/types';

// ---- Phase ID generator ----

let phaseCounter = 0;

function generatePhaseId(): string {
  phaseCounter++;
  return `phase-${Date.now().toString(36)}-${phaseCounter.toString(36)}`;
}

// ---- SmartOrchestrator Class ----

export class SmartOrchestrator {
  private state: OrchestratorState = 'idle';
  private currentPlan: ExecutionPlan | null = null;
  private reorderHistory: ReorderDecision[] = [];
  private taskResults: Map<string, { success: boolean; duration: number }> = new Map();
  private logger: LoggerInterface;
  private onPhaseComplete?: (phase: ExecutionPhase) => void;
  private onReorder?: (decision: ReorderDecision) => void;

  constructor(logger?: LoggerInterface) {
    this.logger = logger ?? {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      setLevel: () => {},
      getLevel: () => 'info' as const,
      child: () => ({
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        setLevel: () => {},
        getLevel: () => 'info' as const,
        child: () => ({} as LoggerInterface),
      }),
    };
  }

  /** Get current orchestrator state */
  getState(): OrchestratorState {
    return this.state;
  }

  /** Get current execution plan */
  getCurrentPlan(): ExecutionPlan | null {
    return this.currentPlan;
  }

  /** Get reorder history */
  getReorderHistory(): ReorderDecision[] {
    return [...this.reorderHistory];
  }

  /** Set callbacks */
  setCallbacks(callbacks: {
    onPhaseComplete?: (phase: ExecutionPhase) => void;
    onReorder?: (decision: ReorderDecision) => void;
  }): void {
    this.onPhaseComplete = callbacks.onPhaseComplete;
    this.onReorder = callbacks.onReorder;
  }

  /** Create an execution plan from a decomposition result */
  createPlan(decomposition: DecompositionResult): ExecutionPlan {
    this.state = 'planning';
    this.logger.info('Creating execution plan', {
      strategy: decomposition.decompositionStrategy,
      taskCount: decomposition.graph.nodes.length,
    });

    const { parallelGroups, nodes } = decomposition.graph;
    const phases: ExecutionPhase[] = [];

    for (let i = 0; i < parallelGroups.length; i++) {
      const group = parallelGroups[i]!;
      const groupTasks = group.map((id) => {
        const node = nodes.find((n) => n.id === id);
        return node?.name ?? id;
      });

      phases.push({
        id: generatePhaseId(),
        name: `阶段 ${i + 1}`,
        tasks: group,
        parallel: group.length > 1,
        status: 'pending',
      });
    }

    const plan: ExecutionPlan = {
      id: `plan-${Date.now().toString(36)}`,
      phases,
      totalSteps: nodes.length,
      estimatedDuration: decomposition.totalEstimatedDuration,
      createdAt: new Date(),
    };

    this.currentPlan = plan;
    this.state = 'idle';
    this.logger.info('Execution plan created', {
      phases: phases.length,
      totalSteps: plan.totalSteps,
    });

    return plan;
  }

  /** Execute the plan with simulated task handlers */
  async execute(
    taskHandler: (taskId: string) => Promise<{ success: boolean; duration: number }>,
  ): Promise<void> {
    if (!this.currentPlan) {
      throw new Error('No execution plan available. Call createPlan first.');
    }

    this.state = 'executing';
    this.logger.info('Starting plan execution');

    try {
      for (const phase of this.currentPlan.phases) {
        // Check for cancellation before each phase
        if (this.state === 'idle') {
          this.logger.info('Execution cancelled');
          return;
        }

        // Wait while paused
        while (this.state === 'paused') {
          await new Promise((r) => setTimeout(r, 50));
        }

        // Check again after potential pause
        if (this.state === 'idle') {
          this.logger.info('Execution cancelled');
          return;
        }

        phase.status = 'running';
        phase.startedAt = new Date();

        this.logger.info(`Executing phase: ${phase.name}`, {
          tasks: phase.tasks,
          parallel: phase.parallel,
        });

        if (phase.parallel) {
          const results = await Promise.all(
            phase.tasks.map(async (taskId) => {
              try {
                const result = await taskHandler(taskId);
                this.taskResults.set(taskId, result);
                return { taskId, ...result };
              } catch {
                const result = { success: false, duration: 0 };
                this.taskResults.set(taskId, result);
                return { taskId, ...result };
              }
            }),
          );

          const allSuccess = results.every((r) => r.success);
          if (!allSuccess) {
            this.logger.warn('Some parallel tasks failed', {
              failed: results.filter((r) => !r.success).map((r) => r.taskId),
            });
            await this.considerReorder(results);
          }
        } else {
          let phaseFailed = false;
          for (const taskId of phase.tasks) {
            // Check for cancellation/pause before each sequential task
            if (this.state === 'idle') {
              this.logger.info('Execution cancelled');
              return;
            }
            while (this.state === 'paused') {
              await new Promise((r) => setTimeout(r, 50));
            }

            try {
              const result = await taskHandler(taskId);
              this.taskResults.set(taskId, result);
              if (!result.success) phaseFailed = true;
            } catch {
              this.taskResults.set(taskId, { success: false, duration: 0 });
              phaseFailed = true;
            }
          }

          if (phaseFailed) {
            phase.status = 'failed';
            phase.completedAt = new Date();
            this.onPhaseComplete?.(phase);
            this.state = 'failed';
            this.logger.warn('Sequential phase failed');
            return;
          }
        }

        phase.status = 'completed';
        phase.completedAt = new Date();
        this.onPhaseComplete?.(phase);
      }

      this.state = 'completed';
      this.logger.info('Plan execution completed');
    } catch (error) {
      this.state = 'failed';
      this.logger.error('Plan execution failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Pause execution */
  pause(): void {
    if (this.state === 'executing') {
      this.state = 'paused';
      this.logger.info('Execution paused');
    }
  }

  /** Resume execution */
  resume(): void {
    if (this.state === 'paused') {
      this.state = 'executing';
      this.logger.info('Execution resumed');
    }
  }

  /** Cancel execution */
  cancel(): void {
    if (this.state === 'executing' || this.state === 'paused') {
      this.state = 'idle';
      this.logger.info('Execution cancelled');
    }
  }

  /** Consider dynamic reordering based on task results */
  private async considerReorder(
    results: { taskId: string; success: boolean; duration: number }[],
  ): Promise<void> {
    const failedTasks = results.filter((r) => !r.success);
    if (failedTasks.length === 0) return;

    const decision: ReorderDecision = {
      reason: `${failedTasks.length} 个任务失败，需要调整后续执行计划`,
      movedTasks: [],
      timestamp: new Date(),
    };

    this.reorderHistory.push(decision);
    this.onReorder?.(decision);
    this.logger.info('Dynamic reorder considered', { reason: decision.reason });
  }

  /** Get task results */
  getTaskResults(): Map<string, { success: boolean; duration: number }> {
    return new Map(this.taskResults);
  }

  /** Reset the orchestrator */
  reset(): void {
    this.state = 'idle';
    this.currentPlan = null;
    this.reorderHistory = [];
    this.taskResults.clear();
    this.onPhaseComplete = undefined;
    this.onReorder = undefined;
    this.logger.info('Orchestrator reset');
  }
}
