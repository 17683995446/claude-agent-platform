// src/lifecycle-manager.ts - Lifecycle Manager

export type LifecyclePhase =
  | 'uninitialized'
  | 'bootstrap'
  | 'initialize'
  | 'start'
  | 'run'
  | 'pause'
  | 'resume'
  | 'shutdown'
  | 'cleanup';

export interface LifecycleComponent {
  id: string;
  name: string;
  phase: string;
  init?: () => Promise<void>;
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
  pause?: () => Promise<void>;
  resume?: () => Promise<void>;
  cleanup?: () => Promise<void>;
  getStatus?: () => ComponentStatus;
}

export interface ComponentStatus {
  id: string;
  name: string;
  status: 'uninitialized' | 'initialized' | 'running' | 'paused' | 'stopped' | 'error';
  error?: string;
}

export interface RuntimeConfig {
  [key: string]: unknown;
}

export interface PhaseTransition {
  from: LifecyclePhase;
  to: LifecyclePhase;
  timestamp: number;
}

const PHASE_ORDER: LifecyclePhase[] = [
  'uninitialized',
  'bootstrap',
  'initialize',
  'start',
  'run',
  'pause',
  'resume',
  'shutdown',
  'cleanup',
];

const VALID_PHASE_TRANSITIONS: Record<LifecyclePhase, LifecyclePhase[]> = {
  uninitialized: ['bootstrap'],
  bootstrap: ['initialize'],
  initialize: ['start', 'shutdown'],
  start: ['run', 'pause', 'shutdown'],
  run: ['pause', 'shutdown'],
  pause: ['resume', 'shutdown'],
  resume: ['run', 'pause', 'shutdown'],
  shutdown: ['cleanup'],
  cleanup: ['bootstrap'],
};

export class LifecycleManager {
  private currentPhase: LifecyclePhase = 'uninitialized';
  private components: Map<string, LifecycleComponent> = new Map();
  private phaseHistory: PhaseTransition[] = [];
  private config: RuntimeConfig = {};
  private onPhaseChange?: (from: LifecyclePhase, to: LifecyclePhase) => void;
  private onError?: (componentId: string, error: Error) => void;

  async bootstrap(config: RuntimeConfig): Promise<void> {
    this.config = config;
    this.transitionPhase('bootstrap');
  }

  async start(): Promise<void> {
    await this.transitionPhase('initialize');
    await this.transitionPhase('start');
    await this.transitionPhase('run');
  }

  async pause(): Promise<void> {
    // Pause all running components
    for (const component of this.components.values()) {
      try {
        await component.pause?.();
      } catch (error) {
        this.onError?.(component.id, error as Error);
      }
    }
    await this.transitionPhase('pause');
  }

  async resume(): Promise<void> {
    await this.transitionPhase('resume');
    // Resume all paused components
    for (const component of this.components.values()) {
      try {
        await component.resume?.();
      } catch (error) {
        this.onError?.(component.id, error as Error);
      }
    }
    await this.transitionPhase('run');
  }

  async shutdown(reason?: string): Promise<void> {
    // Stop all components in reverse order
    const componentList = [...this.components.values()].reverse();
    for (const component of componentList) {
      try {
        await component.stop?.();
      } catch (error) {
        this.onError?.(component.id, error as Error);
      }
    }
    await this.transitionPhase('shutdown');
    await this.transitionPhase('cleanup');
  }

  getPhase(): LifecyclePhase {
    return this.currentPhase;
  }

  registerComponent(component: LifecycleComponent, phase?: string): void {
    component.phase = phase ?? component.phase;
    this.components.set(component.id, component);
  }

  unregisterComponent(componentId: string): void {
    this.components.delete(componentId);
  }

  getComponentStatus(componentId: string): ComponentStatus | undefined {
    const component = this.components.get(componentId);
    if (!component) return undefined;

    const status = component.getStatus?.();
    if (status) return status;

    // Default status based on current phase
    let compStatus: ComponentStatus['status'] = 'uninitialized';
    switch (this.currentPhase) {
      case 'uninitialized':
      case 'bootstrap': compStatus = 'uninitialized'; break;
      case 'initialize': compStatus = 'initialized'; break;
      case 'start':
      case 'run': compStatus = 'running'; break;
      case 'pause': compStatus = 'paused'; break;
      case 'resume': compStatus = 'running'; break;
      case 'shutdown':
      case 'cleanup': compStatus = 'stopped'; break;
    }

    return { id: component.id, name: component.name, status: compStatus };
  }

  getAllComponentStatuses(): ComponentStatus[] {
    const statuses: ComponentStatus[] = [];
    for (const id of this.components.keys()) {
      const status = this.getComponentStatus(id);
      if (status) statuses.push(status);
    }
    return statuses;
  }

  getPhaseHistory(): PhaseTransition[] {
    return [...this.phaseHistory];
  }

  canTransitionTo(phase: LifecyclePhase): boolean {
    const allowed = VALID_PHASE_TRANSITIONS[this.currentPhase];
    return allowed?.includes(phase) ?? false;
  }

  onPhaseChangeHook(callback: (from: LifecyclePhase, to: LifecyclePhase) => void): void {
    this.onPhaseChange = callback;
  }

  onErrorHook(callback: (componentId: string, error: Error) => void): void {
    this.onError = callback;
  }

  getComponentCount(): number {
    return this.components.size;
  }

  getConfig(): RuntimeConfig {
    return { ...this.config };
  }

  private async transitionPhase(targetPhase: LifecyclePhase): Promise<void> {
    if (!this.canTransitionTo(targetPhase)) {
      throw new Error(`Invalid phase transition: ${this.currentPhase} -> ${targetPhase}`);
    }

    const from = this.currentPhase;

    // Execute phase-specific logic
    if (targetPhase === 'initialize') {
      for (const component of this.components.values()) {
        try {
          await component.init?.();
        } catch (error) {
          this.onError?.(component.id, error as Error);
        }
      }
    } else if (targetPhase === 'start') {
      for (const component of this.components.values()) {
        try {
          await component.start?.();
        } catch (error) {
          this.onError?.(component.id, error as Error);
        }
      }
    } else if (targetPhase === 'cleanup') {
      for (const component of this.components.values()) {
        try {
          await component.cleanup?.();
        } catch (error) {
          this.onError?.(component.id, error as Error);
        }
      }
    }

    this.currentPhase = targetPhase;
    this.phaseHistory.push({ from, to: targetPhase, timestamp: Date.now() });
    this.onPhaseChange?.(from, targetPhase);
  }
}
