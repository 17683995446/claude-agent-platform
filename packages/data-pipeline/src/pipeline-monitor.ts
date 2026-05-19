// src/pipeline-monitor.ts - Pipeline Monitor Module
// Monitoring data pipeline health, throughput, latency, errors, and quality metrics

export interface ProcessingEvent {
  pipelineId: string;
  timestamp: number;
  duration: number;
  success: boolean;
  error?: string;
  recordCount?: number;
  metadata?: Record<string, unknown>;
}

export interface PipelineHealth {
  pipelineId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  throughput: number; // records per second
  avgLatency: number; // ms
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  errorRate: number; // percentage
  totalProcessed: number;
  totalErrors: number;
  uptime: number; // seconds since first event
}

export interface AlertRule {
  name: string;
  condition: (health: PipelineHealth) => boolean;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface Alert {
  ruleName: string;
  pipelineId: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: number;
}

export interface PipelineDashboard {
  pipelines: Record<string, PipelineHealth>;
  alerts: Alert[];
  summary: {
    totalPipelines: number;
    healthyPipelines: number;
    degradedPipelines: number;
    unhealthyPipelines: number;
    totalAlerts: number;
  };
}

export interface DataQualityMetrics {
  completeness: number; // percentage of non-null values
  accuracy: number; // percentage of valid values
  consistency: number; // percentage of consistent values
}

export class PipelineMonitor {
  private events: Map<string, ProcessingEvent[]> = new Map();
  private alertRules: AlertRule[] = [];
  private alerts: Alert[] = [];
  private maxRetention: number = 10000;
  private qualityMetrics: Map<string, DataQualityMetrics> = new Map();

  /**
   * Record a processing event
   */
  recordProcessing(event: ProcessingEvent): void {
    if (!this.events.has(event.pipelineId)) {
      this.events.set(event.pipelineId, []);
    }

    const pipelineEvents = this.events.get(event.pipelineId)!;
    pipelineEvents.push(event);

    // Trim old events
    if (pipelineEvents.length > this.maxRetention) {
      pipelineEvents.splice(0, pipelineEvents.length - this.maxRetention);
    }

    // Check alerts
    const health = this.getPipelineHealth(event.pipelineId);
    for (const rule of this.alertRules) {
      if (rule.condition(health)) {
        const existingAlert = this.alerts.find(
          a => a.pipelineId === event.pipelineId && a.ruleName === rule.name
        );
        if (!existingAlert) {
          this.alerts.push({
            ruleName: rule.name,
            pipelineId: event.pipelineId,
            severity: rule.severity,
            message: rule.message,
            timestamp: Date.now(),
          });
        }
      } else {
        // Remove alert when condition resolves
        this.alerts = this.alerts.filter(
          a => !(a.pipelineId === event.pipelineId && a.ruleName === rule.name)
        );
      }
    }
  }

  /**
   * Get health status for a specific pipeline
   */
  getPipelineHealth(pipelineId: string): PipelineHealth {
    const pipelineEvents = this.events.get(pipelineId) ?? [];

    if (pipelineEvents.length === 0) {
      return {
        pipelineId,
        status: 'healthy',
        throughput: 0,
        avgLatency: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
        errorRate: 0,
        totalProcessed: 0,
        totalErrors: 0,
        uptime: 0,
      };
    }

    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentEvents = pipelineEvents.filter(e => e.timestamp >= oneMinuteAgo);

    // Throughput (records per second in last minute)
    const totalRecords = recentEvents.reduce((sum, e) => sum + (e.recordCount ?? 1), 0);
    const throughput = recentEvents.length > 0
      ? totalRecords / ((now - recentEvents[0].timestamp) / 1000 || 1)
      : 0;

    // Latency
    const latencies = pipelineEvents.map(e => e.duration).sort((a, b) => a - b);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p50Latency = this.percentile(latencies, 50);
    const p95Latency = this.percentile(latencies, 95);
    const p99Latency = this.percentile(latencies, 99);

    // Error rate
    const totalErrors = pipelineEvents.filter(e => !e.success).length;
    const errorRate = pipelineEvents.length > 0
      ? (totalErrors / pipelineEvents.length) * 100
      : 0;

    // Total processed
    const totalProcessed = pipelineEvents.reduce((sum, e) => sum + (e.recordCount ?? 1), 0);

    // Uptime
    const firstEvent = pipelineEvents[0];
    const uptime = (now - firstEvent.timestamp) / 1000;

    // Status
    let status: PipelineHealth['status'] = 'healthy';
    if (errorRate > 10 || throughput === 0) {
      status = 'unhealthy';
    } else if (errorRate > 5 || avgLatency > 1000) {
      status = 'degraded';
    }

    return {
      pipelineId,
      status,
      throughput: Math.round(throughput * 100) / 100,
      avgLatency: Math.round(avgLatency * 100) / 100,
      p50Latency: Math.round(p50Latency * 100) / 100,
      p95Latency: Math.round(p95Latency * 100) / 100,
      p99Latency: Math.round(p99Latency * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      totalProcessed,
      totalErrors,
      uptime: Math.round(uptime),
    };
  }

  /**
   * Get dashboard overview
   */
  getDashboard(): PipelineDashboard {
    const pipelines: Record<string, PipelineHealth> = {};

    for (const pipelineId of this.events.keys()) {
      pipelines[pipelineId] = this.getPipelineHealth(pipelineId);
    }

    const healthyPipelines = Object.values(pipelines).filter(p => p.status === 'healthy').length;
    const degradedPipelines = Object.values(pipelines).filter(p => p.status === 'degraded').length;
    const unhealthyPipelines = Object.values(pipelines).filter(p => p.status === 'unhealthy').length;

    return {
      pipelines,
      alerts: [...this.alerts],
      summary: {
        totalPipelines: Object.keys(pipelines).length,
        healthyPipelines,
        degradedPipelines,
        unhealthyPipelines,
        totalAlerts: this.alerts.length,
      },
    };
  }

  /**
   * Add an alert rule
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.push(rule);
  }

  /**
   * Get active alerts
   */
  getAlerts(pipelineId?: string): Alert[] {
    if (pipelineId) {
      return this.alerts.filter(a => a.pipelineId === pipelineId);
    }
    return [...this.alerts];
  }

  /**
   * Clear alerts
   */
  clearAlerts(pipelineId?: string): void {
    if (pipelineId) {
      this.alerts = this.alerts.filter(a => a.pipelineId !== pipelineId);
    } else {
      this.alerts = [];
    }
  }

  /**
   * Record data quality metrics
   */
  recordQuality(pipelineId: string, metrics: DataQualityMetrics): void {
    this.qualityMetrics.set(pipelineId, metrics);
  }

  /**
   * Get data quality metrics
   */
  getQualityMetrics(pipelineId: string): DataQualityMetrics | undefined {
    return this.qualityMetrics.get(pipelineId);
  }

  /**
   * Set max event retention
   */
  setMaxRetention(max: number): void {
    this.maxRetention = max;
  }

  /**
   * Get pipeline topology data
   */
  getTopology(pipelineId: string): {
    nodes: Array<{ id: string; type: string }>;
    edges: Array<{ from: string; to: string }>;
  } {
    const events = this.events.get(pipelineId) ?? [];
    const nodes: Array<{ id: string; type: string }> = [{ id: pipelineId, type: 'pipeline' }];

    // Extract unique error types as nodes
    const errorTypes = new Set(events.filter(e => e.error).map(e => e.error!));
    for (const errorType of errorTypes) {
      nodes.push({ id: `error:${errorType}`, type: 'error' });
    }

    const edges: Array<{ from: string; to: string }> = [];
    for (const node of nodes) {
      if (node.type === 'error') {
        edges.push({ from: pipelineId, to: node.id });
      }
    }

    return { nodes, edges };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }
}
