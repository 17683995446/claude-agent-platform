// src/runtime-dashboard.ts - 运行时仪表板

export interface OverviewData {
  status: string;
  uptime: number;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  version: string;
}

export interface TaskSummary {
  running: number;
  queued: number;
  completed: number;
  failed: number;
  averageDuration: number;
  throughput: number;
}

export interface ResourceUsage {
  cpu: number; // 0-100%
  memory: number; // 0-100%
  memoryUsed: number;
  memoryTotal: number;
  disk: number; // 0-100%
  network: { in: number; out: number };
}

export interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    name: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
  }[];
  lastCheck: number;
}

export interface RuntimeEvent {
  id: string;
  type: string;
  message: string;
  timestamp: number;
  severity: 'info' | 'warn' | 'error';
  source?: string;
}

export interface DashboardData {
  overview: OverviewData;
  tasks: TaskSummary;
  resources: ResourceUsage;
  health: HealthStatus;
  recentEvents: RuntimeEvent[];
  generatedAt: number;
}

export interface MetricProvider {
  getOverview?(): OverviewData;
  getTaskSummary?(): TaskSummary;
  getResourceUsage?(): ResourceUsage;
  getHealthStatus?(): HealthStatus;
  getRecentEvents?(limit: number): RuntimeEvent[];
}

export class RuntimeDashboard {
  private providers: MetricProvider[] = [];
  private events: RuntimeEvent[] = [];
  private maxEvents: number;

  constructor(maxEvents: number = 1000) {
    this.maxEvents = maxEvents;
  }

  addProvider(provider: MetricProvider): void {
    this.providers.push(provider);
  }

  removeProvider(provider: MetricProvider): void {
    const idx = this.providers.indexOf(provider);
    if (idx >= 0) this.providers.splice(idx, 1);
  }

  addEvent(event: RuntimeEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  getOverview(): OverviewData {
    for (const provider of this.providers) {
      if (provider.getOverview) {
        return provider.getOverview();
      }
    }
    return {
      status: 'unknown',
      uptime: 0,
      totalTasks: 0,
      activeTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      version: '0.1.0',
    };
  }

  getTaskSummary(): TaskSummary {
    for (const provider of this.providers) {
      if (provider.getTaskSummary) {
        return provider.getTaskSummary();
      }
    }
    return {
      running: 0,
      queued: 0,
      completed: 0,
      failed: 0,
      averageDuration: 0,
      throughput: 0,
    };
  }

  getResourceUsage(): ResourceUsage {
    for (const provider of this.providers) {
      if (provider.getResourceUsage) {
        return provider.getResourceUsage();
      }
    }
    return {
      cpu: 0,
      memory: 0,
      memoryUsed: 0,
      memoryTotal: 0,
      disk: 0,
      network: { in: 0, out: 0 },
    };
  }

  getHealthStatus(): HealthStatus {
    for (const provider of this.providers) {
      if (provider.getHealthStatus) {
        return provider.getHealthStatus();
      }
    }
    return {
      overall: 'healthy',
      components: [],
      lastCheck: Date.now(),
    };
  }

  getRecentEvents(limit: number): RuntimeEvent[] {
    return this.events.slice(-limit);
  }

  getDashboard(): DashboardData {
    return {
      overview: this.getOverview(),
      tasks: this.getTaskSummary(),
      resources: this.getResourceUsage(),
      health: this.getHealthStatus(),
      recentEvents: this.getRecentEvents(10),
      generatedAt: Date.now(),
    };
  }

  clearEvents(): void {
    this.events = [];
  }

  getProviderCount(): number {
    return this.providers.length;
  }
}
