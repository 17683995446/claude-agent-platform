// ============================================================================
// Module 1: Application Lifecycle Management
// ============================================================================

export type Environment = 'development' | 'staging' | 'production' | 'test';

export type ApplicationPhase = 'idle' | 'initializing' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface AppConfig {
  name?: string;
  version?: string;
  environment?: Environment;
  port?: number;
  configPath?: string;
  plugins?: string[];
  [key: string]: unknown;
}

export interface ApplicationStatus {
  phase: ApplicationPhase;
  environment: Environment;
  uptime: number;
  components: Record<string, ComponentStatus>;
  startTime: number | null;
  memoryUsage: NodeJS.MemoryUsage | null;
}

export interface ComponentStatus {
  status: 'initialized' | 'running' | 'stopped' | 'error';
  uptime: number;
  lastError?: string;
}

export interface ComponentDescriptor {
  name: string;
  instance: unknown;
  init?: () => Promise<void>;
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
  destroy?: () => Promise<void>;
}

export class Application {
  private config: AppConfig;
  private phase: ApplicationPhase = 'idle';
  private components: Map<string, ComponentDescriptor> = new Map();
  private startTime: number | null = null;
  private shutdownHooks: Array<() => Promise<void>> = [];

  constructor(config: AppConfig = {}) {
    this.config = {
      name: 'claude-agent-app',
      version: '0.1.0',
      environment: this.detectEnvironment(),
      port: 3000,
      ...config,
    };
  }

  static create(options: AppConfig): Application {
    return new Application(options);
  }

  private detectEnvironment(): Environment {
    const env = process.env['NODE_ENV'] as Environment | undefined;
    if (env === 'development' || env === 'staging' || env === 'production' || env === 'test') {
      return env;
    }
    return 'development';
  }

  getConfig(): AppConfig {
    return { ...this.config };
  }

  getPhase(): ApplicationPhase {
    return this.phase;
  }

  registerComponent(descriptor: ComponentDescriptor): void {
    if (this.components.has(descriptor.name)) {
      throw new Error(`Component "${descriptor.name}" is already registered`);
    }
    this.components.set(descriptor.name, descriptor);
  }

  getComponent<T>(name: string): T {
    const descriptor = this.components.get(name);
    if (!descriptor) {
      throw new Error(`Component "${name}" not found`);
    }
    return descriptor.instance as T;
  }

  hasComponent(name: string): boolean {
    return this.components.has(name);
  }

  listComponents(): string[] {
    return Array.from(this.components.keys());
  }

  async start(): Promise<void> {
    if (this.phase === 'running') return;
    this.phase = 'initializing';

    try {
      // Bootstrap sequence: init all components
      for (const [, descriptor] of this.components) {
        if (descriptor.init) {
          await descriptor.init();
        }
      }

      this.phase = 'starting';

      // Start all components
      for (const [, descriptor] of this.components) {
        if (descriptor.start) {
          await descriptor.start();
        }
      }

      this.startTime = Date.now();
      this.phase = 'running';
    } catch (error) {
      this.phase = 'error';
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.phase === 'stopped' || this.phase === 'idle') return;
    this.phase = 'stopping';

    try {
      // Run shutdown hooks
      for (const hook of this.shutdownHooks) {
        await hook();
      }

      // Stop all components in reverse order
      const entries = Array.from(this.components.entries()).reverse();
      for (const [, descriptor] of entries) {
        if (descriptor.stop) {
          await descriptor.stop();
        }
      }

      this.startTime = null;
      this.phase = 'stopped';
    } catch (error) {
      this.phase = 'error';
      throw error;
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  addShutdownHook(hook: () => Promise<void>): void {
    this.shutdownHooks.push(hook);
  }

  getStatus(): ApplicationStatus {
    const componentStatuses: Record<string, ComponentStatus> = {};
    for (const [name, descriptor] of this.components) {
      componentStatuses[name] = {
        status: this.phase === 'running' ? 'running' : 'stopped',
        uptime: this.startTime ? Date.now() - this.startTime : 0,
      };
    }

    return {
      phase: this.phase,
      environment: this.config.environment ?? 'development',
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      components: componentStatuses,
      startTime: this.startTime,
      memoryUsage: process.memoryUsage?.() ?? null,
    };
  }

  getEnvironment(): Environment {
    return this.config.environment ?? 'development';
  }

  isRunning(): boolean {
    return this.phase === 'running';
  }
}
