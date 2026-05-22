// ============================================================================
// ProgressTracker - Real-time Progress Tracking
// ============================================================================

import type { ProgressState, ProgressNotification, Milestone } from './types.js';

// ---- ProgressTracker Class ----

export class ProgressTracker {
  private progressMap: Map<string, ProgressState> = new Map();
  private listeners: Map<string, Set<(notification: ProgressNotification) => void>> = new Map();
  private activeTimeMap: Map<string, number> = new Map();

  /** Create a new progress tracker for a task */
  create(taskId: string, totalSteps: number, milestones?: { name: string; description: string; targetStep: number }[]): ProgressState {
    const ms: Milestone[] = (milestones ?? []).map((m, i) => ({
      id: `milestone-${taskId}-${i}`,
      name: m.name,
      description: m.description,
      targetStep: m.targetStep,
      achieved: false,
    }));

    const state: ProgressState = {
      taskId,
      totalSteps,
      completedSteps: 0,
      percentage: 0,
      currentStep: '',
      eta: 0,
      milestones: ms,
      status: 'in_progress',
      startedAt: new Date(),
      updatedAt: new Date(),
    };

    this.progressMap.set(taskId, state);
    this.activeTimeMap.set(taskId, 0);
    return state;
  }

  /** Update progress for a task */
  update(taskId: string, completedSteps: number, currentStep?: string): ProgressState | undefined {
    const state = this.progressMap.get(taskId);
    if (!state || state.status !== 'in_progress') return undefined;

    const previousSteps = state.completedSteps;
    state.completedSteps = Math.min(completedSteps, state.totalSteps);
    state.percentage = state.totalSteps > 0
      ? Math.round((state.completedSteps / state.totalSteps) * 100)
      : 0;

    if (currentStep) state.currentStep = currentStep;

    // Calculate ETA based on active time only
    const now = Date.now();
    const elapsed = now - state.updatedAt.getTime();
    const activeTime = (this.activeTimeMap.get(taskId) ?? 0) + elapsed;
    this.activeTimeMap.set(taskId, activeTime);
    if (state.completedSteps > 0 && activeTime > 0) {
      const avgTimePerStep = activeTime / state.completedSteps;
      state.eta = Math.round(avgTimePerStep * (state.totalSteps - state.completedSteps));
    }

    state.updatedAt = new Date();

    // Check milestones
    for (const milestone of state.milestones) {
      if (!milestone.achieved && state.completedSteps >= milestone.targetStep) {
        milestone.achieved = true;
        milestone.achievedAt = new Date();
        this.notify(taskId, {
          taskId,
          type: 'milestone',
          message: `里程碑达成: ${milestone.name}`,
          progress: state.percentage,
          eta: state.eta,
          milestone: milestone.name,
        });
      }
    }

    // Notify progress update
    if (completedSteps !== previousSteps) {
      this.notify(taskId, {
        taskId,
        type: 'update',
        message: `进度更新: ${state.percentage}%`,
        progress: state.percentage,
        eta: state.eta,
      });
    }

    // Check completion (only when totalSteps > 0 to avoid false completion)
    if (state.totalSteps > 0 && state.completedSteps >= state.totalSteps) {
      state.status = 'completed';
      state.percentage = 100;
      state.eta = 0;
      this.notify(taskId, {
        taskId,
        type: 'complete',
        message: '任务完成',
        progress: 100,
      });
    }

    return state;
  }

  /** Increment progress by 1 step */
  increment(taskId: string, stepName?: string): ProgressState | undefined {
    const state = this.progressMap.get(taskId);
    if (!state) return undefined;
    return this.update(taskId, state.completedSteps + 1, stepName);
  }

  /** Mark a task as failed */
  fail(taskId: string, reason?: string): ProgressState | undefined {
    const state = this.progressMap.get(taskId);
    if (!state) return undefined;

    state.status = 'failed';
    state.updatedAt = new Date();

    this.notify(taskId, {
      taskId,
      type: 'error',
      message: reason ?? '任务执行失败',
      progress: state.percentage,
    });

    return state;
  }

  /** Pause progress tracking */
  pause(taskId: string): ProgressState | undefined {
    const state = this.progressMap.get(taskId);
    if (!state || state.status !== 'in_progress') return undefined;
    // Snapshot active time up to now
    const activeTime = (this.activeTimeMap.get(taskId) ?? 0) + (Date.now() - state.updatedAt.getTime());
    this.activeTimeMap.set(taskId, activeTime);
    state.status = 'paused';
    state.updatedAt = new Date();
    return state;
  }

  /** Resume progress tracking */
  resume(taskId: string): ProgressState | undefined {
    const state = this.progressMap.get(taskId);
    if (!state || state.status !== 'paused') return undefined;
    state.status = 'in_progress';
    state.updatedAt = new Date();
    return state;
  }

  /** Get progress state for a task */
  getProgress(taskId: string): ProgressState | undefined {
    return this.progressMap.get(taskId);
  }

  /** Get all progress states */
  getAllProgress(): ProgressState[] {
    return Array.from(this.progressMap.values());
  }

  /** Subscribe to progress notifications */
  onProgress(taskId: string, listener: (notification: ProgressNotification) => void): () => void {
    if (!this.listeners.has(taskId)) {
      this.listeners.set(taskId, new Set());
    }
    this.listeners.get(taskId)!.add(listener);

    return () => {
      const taskListeners = this.listeners.get(taskId);
      if (taskListeners) {
        taskListeners.delete(listener);
        if (taskListeners.size === 0) {
          this.listeners.delete(taskId);
        }
      }
    };
  }

  /** Notify listeners */
  private notify(taskId: string, notification: ProgressNotification): void {
    const taskListeners = this.listeners.get(taskId);
    if (taskListeners) {
      for (const listener of taskListeners) {
        try {
          listener(notification);
        } catch {
          // Listener errors should not affect tracking
        }
      }
    }
  }

  /** Remove a progress tracker */
  remove(taskId: string): boolean {
    this.listeners.delete(taskId);
    this.activeTimeMap.delete(taskId);
    return this.progressMap.delete(taskId);
  }

  /** Clear all progress trackers */
  clear(): void {
    this.progressMap.clear();
    this.listeners.clear();
    this.activeTimeMap.clear();
  }
}
