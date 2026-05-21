// ============================================================
// Module 4: Elastic Scaler
// ============================================================

export type ScaleStrategy = 'immediate' | 'gradual' | 'predictive';

export interface ScalingDecision {
  action: 'scale_up' | 'scale_down' | 'none';
  currentInstances: number;
  targetInstances: number;
  reason: string;
  confidence: number;
}

export interface ScaleResult {
  success: boolean;
  previousInstances: number;
  currentInstances: number;
  scaledBy: number;
  timestamp: number;
  reason: string;
}

export interface ScalingRecord {
  timestamp: number;
  action: 'scale_up' | 'scale_down';
  previousInstances: number;
  newInstances: number;
  reason: string;
  strategy: ScaleStrategy;
}

export interface CapacityInfo {
  currentInstances: number;
  minInstances: number;
  maxInstances: number;
  availableCapacity: number;
  targetUtilization: number;
  currentUtilization: number;
}

export interface ElasticScalerOptions {
  minInstances?: number;
  maxInstances?: number;
  initialInstances?: number;
  cpuThresholdUp?: number;     // Scale up when CPU > this (0-1)
  cpuThresholdDown?: number;   // Scale down when CPU < this (0-1)
  memoryThresholdUp?: number;
  memoryThresholdDown?: number;
  queueDepthThreshold?: number;
  responseTimeThreshold?: number; // ms
  cooldownPeriod?: number;     // ms between scale operations
  maxScaleRate?: number;       // Max instances to add/remove per operation
  strategy?: ScaleStrategy;
  targetUtilization?: number;  // Target utilization (0-1)
}

const DEFAULT_SCALER_OPTIONS: Required<ElasticScalerOptions> = {
  minInstances: 1,
  maxInstances: 50,
  initialInstances: 3,
  cpuThresholdUp: 0.7,
  cpuThresholdDown: 0.3,
  memoryThresholdUp: 0.8,
  memoryThresholdDown: 0.4,
  queueDepthThreshold: 100,
  responseTimeThreshold: 5000,
  cooldownPeriod: 60000,
  maxScaleRate: 5,
  strategy: 'gradual',
  targetUtilization: 0.6,
};

export class ElasticScaler {
  private currentInstances: number;
  private options: Required<ElasticScalerOptions>;
  private scalingHistory: ScalingRecord[] = [];
  private lastScaleTime: number = 0;
  private currentCpu: number = 0;
  private currentMemory: number = 0;
  private currentQueueDepth: number = 0;
  private currentResponseTime: number = 0;

  constructor(options?: ElasticScalerOptions) {
    this.options = { ...DEFAULT_SCALER_OPTIONS, ...options };
    this.currentInstances = this.options.initialInstances;
  }

  updateMetrics(metrics: { cpu?: number; memory?: number; queueDepth?: number; responseTime?: number }): void {
    if (metrics.cpu !== undefined) this.currentCpu = metrics.cpu;
    if (metrics.memory !== undefined) this.currentMemory = metrics.memory;
    if (metrics.queueDepth !== undefined) this.currentQueueDepth = metrics.queueDepth;
    if (metrics.responseTime !== undefined) this.currentResponseTime = metrics.responseTime;
  }

  evaluateScaling(): ScalingDecision {
    const now = Date.now();
    const inCooldown = now - this.lastScaleTime < this.options.cooldownPeriod;

    if (inCooldown) {
      return {
        action: 'none',
        currentInstances: this.currentInstances,
        targetInstances: this.currentInstances,
        reason: 'in_cooldown',
        confidence: 1,
      };
    }

    // Determine if we should scale up or down
    let shouldScaleUp = false;
    let shouldScaleDown = false;
    let reason = '';
    let confidence = 0;

    // CPU-based scaling
    if (this.currentCpu > this.options.cpuThresholdUp) {
      shouldScaleUp = true;
      reason = `cpu_high (${(this.currentCpu * 100).toFixed(1)}%)`;
      confidence = Math.min((this.currentCpu - this.options.cpuThresholdUp) / 0.3, 1);
    } else if (this.currentCpu < this.options.cpuThresholdDown) {
      shouldScaleDown = true;
      reason = `cpu_low (${(this.currentCpu * 100).toFixed(1)}%)`;
      confidence = Math.min((this.options.cpuThresholdDown - this.currentCpu) / 0.3, 1);
    }

    // Memory-based scaling (can override)
    if (this.currentMemory > this.options.memoryThresholdUp) {
      shouldScaleUp = true;
      reason = `memory_high (${(this.currentMemory * 100).toFixed(1)}%)`;
      confidence = Math.max(confidence, Math.min((this.currentMemory - this.options.memoryThresholdUp) / 0.2, 1));
    } else if (this.currentMemory < this.options.memoryThresholdDown && !shouldScaleUp) {
      shouldScaleDown = true;
      reason = `memory_low (${(this.currentMemory * 100).toFixed(1)}%)`;
    }

    // Queue depth-based scaling
    if (this.currentQueueDepth > this.options.queueDepthThreshold) {
      shouldScaleUp = true;
      reason = `queue_depth_high (${this.currentQueueDepth})`;
      confidence = Math.max(confidence, 0.8);
    }

    // Response time-based scaling
    if (this.currentResponseTime > this.options.responseTimeThreshold) {
      shouldScaleUp = true;
      reason = `response_time_high (${this.currentResponseTime}ms)`;
      confidence = Math.max(confidence, 0.7);
    }

    if (!shouldScaleUp && !shouldScaleDown) {
      return {
        action: 'none',
        currentInstances: this.currentInstances,
        targetInstances: this.currentInstances,
        reason: 'within_thresholds',
        confidence: 1,
      };
    }

    let targetInstances: number;
    if (shouldScaleUp) {
      const scaleBy = this.options.strategy === 'immediate'
        ? this.options.maxScaleRate
        : this.options.strategy === 'gradual'
          ? Math.min(this.options.maxScaleRate, Math.ceil(this.options.maxScaleRate / 2))
          : 1;
      targetInstances = Math.min(
        this.options.maxInstances,
        this.currentInstances + scaleBy
      );
    } else {
      const scaleBy = this.options.strategy === 'immediate'
        ? this.options.maxScaleRate
        : this.options.strategy === 'gradual'
          ? 1
          : 1;
      targetInstances = Math.max(
        this.options.minInstances,
        this.currentInstances - scaleBy
      );
    }

    if (targetInstances === this.currentInstances) {
      return {
        action: 'none',
        currentInstances: this.currentInstances,
        targetInstances: this.currentInstances,
        reason: 'at_limits',
        confidence: 1,
      };
    }

    return {
      action: shouldScaleUp ? 'scale_up' : 'scale_down',
      currentInstances: this.currentInstances,
      targetInstances,
      reason,
      confidence,
    };
  }

  scaleUp(count?: number): ScaleResult {
    const previous = this.currentInstances;
    const scaleBy = count ?? (this.options.strategy === 'immediate'
      ? this.options.maxScaleRate
      : Math.max(1, Math.ceil(this.options.maxScaleRate / 2)));

    // If count is 0, don't scale
    if (scaleBy === 0) {
      return {
        success: false,
        previousInstances: previous,
        currentInstances: this.currentInstances,
        scaledBy: 0,
        timestamp: Date.now(),
        reason: 'manual_scale_up',
      };
    }

    this.currentInstances = Math.min(
      this.options.maxInstances,
      this.currentInstances + scaleBy
    );

    const result: ScaleResult = {
      success: this.currentInstances > previous,
      previousInstances: previous,
      currentInstances: this.currentInstances,
      scaledBy: this.currentInstances - previous,
      timestamp: Date.now(),
      reason: 'manual_scale_up',
    };

    if (result.success) {
      this.lastScaleTime = Date.now();
      this.scalingHistory.push({
        timestamp: result.timestamp,
        action: 'scale_up',
        previousInstances: previous,
        newInstances: this.currentInstances,
        reason: result.reason,
        strategy: this.options.strategy,
      });
    }

    return result;
  }

  scaleDown(count?: number): ScaleResult {
    const previous = this.currentInstances;
    const scaleBy = count ?? (this.options.strategy === 'immediate'
      ? this.options.maxScaleRate
      : 1);

    // If count is 0, don't scale
    if (scaleBy === 0) {
      return {
        success: false,
        previousInstances: previous,
        currentInstances: this.currentInstances,
        scaledBy: 0,
        timestamp: Date.now(),
        reason: 'manual_scale_down',
      };
    }

    this.currentInstances = Math.max(
      this.options.minInstances,
      this.currentInstances - scaleBy
    );

    const result: ScaleResult = {
      success: this.currentInstances < previous,
      previousInstances: previous,
      currentInstances: this.currentInstances,
      scaledBy: previous - this.currentInstances,
      timestamp: Date.now(),
      reason: 'manual_scale_down',
    };

    if (result.success) {
      this.lastScaleTime = Date.now();
      this.scalingHistory.push({
        timestamp: result.timestamp,
        action: 'scale_down',
        previousInstances: previous,
        newInstances: this.currentInstances,
        reason: result.reason,
        strategy: this.options.strategy,
      });
    }

    return result;
  }

  getScalingHistory(): ScalingRecord[] {
    return [...this.scalingHistory];
  }

  getCapacity(): CapacityInfo {
    const utilization = Math.max(this.currentCpu, this.currentMemory);
    const totalCapacity = this.options.maxInstances;
    const availableCapacity = totalCapacity - this.currentInstances;

    return {
      currentInstances: this.currentInstances,
      minInstances: this.options.minInstances,
      maxInstances: this.options.maxInstances,
      availableCapacity,
      targetUtilization: this.options.targetUtilization,
      currentUtilization: utilization,
    };
  }

  setStrategy(strategy: ScaleStrategy): void {
    this.options.strategy = strategy;
  }

  getCurrentInstances(): number {
    return this.currentInstances;
  }
}
