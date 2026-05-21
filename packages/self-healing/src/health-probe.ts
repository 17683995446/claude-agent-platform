// src/health-probe.ts - Health Probe Module

export type ProbeType = 'liveness' | 'readiness' | 'startup' | 'custom';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthProbeFn {
  (): Promise<HealthProbeResult>;
}

export interface HealthProbeResult {
  healthy: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

export interface HealthReport {
  status: HealthStatus;
  score: number;
  components: Record<string, ComponentHealth>;
  timestamp: number;
  probes: ProbeResult[];
}

export interface ComponentHealth {
  componentId: string;
  status: HealthStatus;
  probes: ProbeResult[];
  lastChecked: number;
}

export interface ProbeResult {
  name: string;
  type: ProbeType;
  healthy: boolean;
  message?: string;
  duration: number;
  timestamp: number;
}

interface ProbeEntry {
  name: string;
  probe: HealthProbeFn;
  type: ProbeType;
  componentId?: string;
}

interface HealthHistoryEntry {
  score: number;
  status: HealthStatus;
  timestamp: number;
}

export class HealthProbe {
  private probes: ProbeEntry[] = [];
  private healthHistory: HealthHistoryEntry[] = [];
  private lastComponentHealth: Record<string, ComponentHealth> = {};
  private maxHistorySize = 1000;

  addProbe(name: string, probe: HealthProbeFn, type: ProbeType = 'custom'): void {
    this.probes.push({ name, probe, type });
  }

  addComponentProbe(componentId: string, name: string, probe: HealthProbeFn, type: ProbeType = 'custom'): void {
    this.probes.push({ name, probe, type, componentId });
  }

  async checkHealth(): Promise<HealthReport> {
    const probeResults: ProbeResult[] = [];
    const components: Record<string, ComponentHealth> = {};

    for (const entry of this.probes) {
      const startTime = Date.now();
      try {
        const result = await entry.probe();
        const probeResult: ProbeResult = {
          name: entry.name,
          type: entry.type,
          healthy: result.healthy,
          message: result.message,
          duration: Date.now() - startTime,
          timestamp: Date.now(),
        };
        probeResults.push(probeResult);

        if (entry.componentId) {
          if (!components[entry.componentId]) {
            components[entry.componentId] = {
              componentId: entry.componentId,
              status: 'healthy',
              probes: [],
              lastChecked: Date.now(),
            };
          }
          components[entry.componentId]!.probes.push(probeResult);
        }
      } catch (error) {
        const probeResult: ProbeResult = {
          name: entry.name,
          type: entry.type,
          healthy: false,
          message: error instanceof Error ? error.message : 'Probe failed',
          duration: Date.now() - startTime,
          timestamp: Date.now(),
        };
        probeResults.push(probeResult);

        if (entry.componentId) {
          if (!components[entry.componentId]) {
            components[entry.componentId] = {
              componentId: entry.componentId,
              status: 'unhealthy',
              probes: [],
              lastChecked: Date.now(),
            };
          }
          components[entry.componentId]!.probes.push(probeResult);
        }
      }
    }

    // Calculate component statuses
    for (const comp of Object.values(components)) {
      const healthyProbes = comp.probes.filter((p) => p.healthy).length;
      const totalProbes = comp.probes.length;
      if (healthyProbes === totalProbes) {
        comp.status = 'healthy';
      } else if (healthyProbes > 0) {
        comp.status = 'degraded';
      } else {
        comp.status = 'unhealthy';
      }
      comp.lastChecked = Date.now();
    }

    // Calculate overall score
    const totalProbes = probeResults.length;
    const healthyProbes = probeResults.filter((p) => p.healthy).length;
    const score = totalProbes > 0 ? Math.round((healthyProbes / totalProbes) * 100) : 100;

    // Determine overall status
    let status: HealthStatus;
    if (totalProbes === 0) status = 'healthy'; // No probes = assume healthy
    else if (score >= 80) status = 'healthy';
    else if (score >= 50) status = 'degraded';
    else status = 'unhealthy';

    const report: HealthReport = {
      status,
      score,
      components,
      timestamp: Date.now(),
      probes: probeResults,
    };

    // Store component health for later retrieval
    this.lastComponentHealth = { ...components };

    this.healthHistory.push({
      score,
      status,
      timestamp: Date.now(),
    });

    if (this.healthHistory.length > this.maxHistorySize) {
      this.healthHistory = this.healthHistory.slice(-this.maxHistorySize);
    }

    return report;
  }

  async checkLiveness(): Promise<boolean> {
    const livenessProbes = this.probes.filter((p) => p.type === 'liveness');
    if (livenessProbes.length === 0) return true;

    for (const entry of livenessProbes) {
      try {
        const result = await entry.probe();
        if (!result.healthy) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  async checkReadiness(): Promise<boolean> {
    const readinessProbes = this.probes.filter((p) => p.type === 'readiness');
    if (readinessProbes.length === 0) return true;

    for (const entry of readinessProbes) {
      try {
        const result = await entry.probe();
        if (!result.healthy) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  getHealthScore(): number {
    if (this.healthHistory.length === 0) return 100;
    return this.healthHistory[this.healthHistory.length - 1]!.score;
  }

  getComponentHealth(componentId: string): ComponentHealth | null {
    return this.lastComponentHealth[componentId] ?? null;
  }

  getHealthHistory(): HealthHistoryEntry[] {
    return [...this.healthHistory];
  }

  getProbes(): { name: string; type: ProbeType; componentId?: string }[] {
    return this.probes.map((p) => ({ name: p.name, type: p.type, componentId: p.componentId }));
  }

  removeProbe(name: string): void {
    this.probes = this.probes.filter((p) => p.name !== name);
  }

  clearHistory(): void {
    this.healthHistory = [];
  }
}
