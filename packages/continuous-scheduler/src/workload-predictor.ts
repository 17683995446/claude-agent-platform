// ============================================================
// Module 3: Workload Predictor
// ============================================================

export interface WorkloadMetrics {
  taskCount: number;
  cpuUsage: number;       // 0-1
  memoryUsage: number;    // 0-1
  queueDepth: number;
  responseTime: number;   // ms
  errorRate: number;      // 0-1
}

export interface WorkloadPrediction {
  predictedMetrics: WorkloadMetrics;
  confidence: number;     // 0-1
  confidenceInterval: {
    taskCount: [number, number];
    cpuUsage: [number, number];
    memoryUsage: [number, number];
  };
  trend: 'increasing' | 'decreasing' | 'stable';
  timestamp: number;
}

export interface PeakPrediction {
  predictedPeakTime: number;
  predictedPeakLoad: number;
  confidence: number;
  duration: number; // estimated peak duration in minutes
}

export interface ResourcePrediction {
  cpuNeeded: number;
  memoryNeeded: number;
  instancesNeeded: number;
  confidence: number;
}

export interface WorkloadPattern {
  type: 'daily' | 'weekly' | 'monthly';
  period: number;        // minutes
  peakHour: number;
  troughHour: number;
  averageLoad: number;
  peakLoad: number;
  strength: number;      // 0-1 how strong the pattern is
}

export interface WorkloadRecord {
  timestamp: number;
  metrics: WorkloadMetrics;
}

export class WorkloadPredictor {
  private records: WorkloadRecord[] = [];
  private maxRecords: number = 10000;

  recordWorkload(timestamp: number, metrics: WorkloadMetrics): void {
    this.records.push({ timestamp, metrics });
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  predict(horizonMinutes: number): WorkloadPrediction {
    if (this.records.length < 2) {
      return {
        predictedMetrics: {
          taskCount: 0,
          cpuUsage: 0,
          memoryUsage: 0,
          queueDepth: 0,
          responseTime: 0,
          errorRate: 0,
        },
        confidence: 0,
        confidenceInterval: { taskCount: [0, 0], cpuUsage: [0, 0], memoryUsage: [0, 0] },
        trend: 'stable',
        timestamp: Date.now(),
      };
    }

    const now = Date.now();
    const targetTime = now + horizonMinutes * 60 * 1000;
    const recentRecords = this.getRecentRecords(100);
    const avgMetrics = this.averageMetrics(recentRecords);

    // Detect trend
    const trend = this.detectTrend(recentRecords);

    // Apply trend projection
    const trendMultiplier = trend === 'increasing' ? 1.1 : trend === 'decreasing' ? 0.9 : 1.0;
    const trendFactor = Math.pow(trendMultiplier, horizonMinutes / 60);

    // Check for cyclical patterns
    const cyclicalAdjustment = this.getCyclicalAdjustment(targetTime);

    const predictedMetrics: WorkloadMetrics = {
      taskCount: Math.round(avgMetrics.taskCount * trendFactor * cyclicalAdjustment),
      cpuUsage: Math.min(1, avgMetrics.cpuUsage * trendFactor * cyclicalAdjustment),
      memoryUsage: Math.min(1, avgMetrics.memoryUsage * trendFactor * cyclicalAdjustment),
      queueDepth: Math.round(avgMetrics.queueDepth * trendFactor * cyclicalAdjustment),
      responseTime: avgMetrics.responseTime * trendFactor * cyclicalAdjustment,
      errorRate: Math.min(1, avgMetrics.errorRate * trendFactor),
    };

    // Calculate confidence based on data availability and pattern strength
    const dataConfidence = Math.min(this.records.length / 100, 1);
    const horizonConfidence = Math.max(0, 1 - horizonMinutes / (24 * 60));
    const confidence = dataConfidence * horizonConfidence * 0.8;

    // Confidence intervals widen with horizon
    const uncertainty = 1 + horizonMinutes / 60 * 0.1;

    return {
      predictedMetrics,
      confidence,
      confidenceInterval: {
        taskCount: [
          Math.round(predictedMetrics.taskCount / uncertainty),
          Math.round(predictedMetrics.taskCount * uncertainty),
        ],
        cpuUsage: [
          Math.max(0, predictedMetrics.cpuUsage / uncertainty),
          Math.min(1, predictedMetrics.cpuUsage * uncertainty),
        ],
        memoryUsage: [
          Math.max(0, predictedMetrics.memoryUsage / uncertainty),
          Math.min(1, predictedMetrics.memoryUsage * uncertainty),
        ],
      },
      trend,
      timestamp: now,
    };
  }

  predictPeak(nextHours: number): PeakPrediction {
    const records = this.getRecentRecords(500);
    if (records.length < 10) {
      return {
        predictedPeakTime: Date.now(),
        predictedPeakLoad: 0,
        confidence: 0,
        duration: 0,
      };
    }

    // Find hourly patterns
    const hourlyLoads = new Map<number, number[]>();
    for (const record of records) {
      const hour = new Date(record.timestamp).getHours();
      if (!hourlyLoads.has(hour)) hourlyLoads.set(hour, []);
      hourlyLoads.get(hour)!.push(record.metrics.cpuUsage);
    }

    // Find peak hour
    let peakHour = 0;
    let peakLoad = 0;
    for (const [hour, loads] of hourlyLoads) {
      const avgLoad = loads.reduce((a, b) => a + b, 0) / loads.length;
      if (avgLoad > peakLoad) {
        peakLoad = avgLoad;
        peakHour = hour;
      }
    }

    // Predict next occurrence of peak hour
    const now = new Date();
    const currentHour = now.getHours();
    let hoursUntilPeak = peakHour - currentHour;
    if (hoursUntilPeak <= 0) hoursUntilPeak += 24;
    if (hoursUntilPeak > nextHours) {
      // Peak not in prediction window, find highest in window
      let bestHour = currentHour;
      let bestLoad = 0;
      for (let h = 0; h < nextHours; h++) {
        const targetHour = (currentHour + h) % 24;
        const loads = hourlyLoads.get(targetHour);
        if (loads) {
          const avg = loads.reduce((a, b) => a + b, 0) / loads.length;
          if (avg > bestLoad) {
            bestLoad = avg;
            bestHour = targetHour;
            hoursUntilPeak = h;
          }
        }
      }
      peakLoad = bestLoad;
    }

    const predictedPeakTime = Date.now() + hoursUntilPeak * 60 * 60 * 1000;
    const confidence = Math.min(records.length / 200, 0.9);

    return {
      predictedPeakTime,
      predictedPeakLoad: peakLoad,
      confidence,
      duration: 60, // default 1 hour duration
    };
  }

  predictResourceNeeds(nextMinutes: number): ResourcePrediction {
    const prediction = this.predict(nextMinutes);
    const metrics = prediction.predictedMetrics;

    const cpuNeeded = Math.ceil(metrics.cpuUsage * 4); // Assume 4 cores per instance
    const memoryNeeded = Math.ceil(metrics.memoryUsage * 8); // Assume 8GB per instance
    const instancesNeeded = Math.max(1, Math.ceil(metrics.taskCount / 10));

    return {
      cpuNeeded,
      memoryNeeded,
      instancesNeeded,
      confidence: prediction.confidence,
    };
  }

  getPatterns(): WorkloadPattern[] {
    const patterns: WorkloadPattern[] = [];
    if (this.records.length < 50) return patterns;

    // Detect daily pattern
    const dailyPattern = this.detectPattern(24 * 60, 24);
    if (dailyPattern) patterns.push(dailyPattern);

    // Detect weekly pattern
    const weeklyPattern = this.detectPattern(7 * 24 * 60, 168);
    if (weeklyPattern) patterns.push(weeklyPattern);

    return patterns;
  }

  getRecordCount(): number {
    return this.records.length;
  }

  private getRecentRecords(count: number): WorkloadRecord[] {
    return this.records.slice(-count);
  }

  private averageMetrics(records: WorkloadRecord[]): WorkloadMetrics {
    if (records.length === 0) {
      return { taskCount: 0, cpuUsage: 0, memoryUsage: 0, queueDepth: 0, responseTime: 0, errorRate: 0 };
    }
    const sum = records.reduce(
      (acc, r) => ({
        taskCount: acc.taskCount + r.metrics.taskCount,
        cpuUsage: acc.cpuUsage + r.metrics.cpuUsage,
        memoryUsage: acc.memoryUsage + r.metrics.memoryUsage,
        queueDepth: acc.queueDepth + r.metrics.queueDepth,
        responseTime: acc.responseTime + r.metrics.responseTime,
        errorRate: acc.errorRate + r.metrics.errorRate,
      }),
      { taskCount: 0, cpuUsage: 0, memoryUsage: 0, queueDepth: 0, responseTime: 0, errorRate: 0 }
    );
    const n = records.length;
    return {
      taskCount: sum.taskCount / n,
      cpuUsage: sum.cpuUsage / n,
      memoryUsage: sum.memoryUsage / n,
      queueDepth: sum.queueDepth / n,
      responseTime: sum.responseTime / n,
      errorRate: sum.errorRate / n,
    };
  }

  private detectTrend(records: WorkloadRecord[]): 'increasing' | 'decreasing' | 'stable' {
    if (records.length < 10) return 'stable';

    const half = Math.floor(records.length / 2);
    const firstHalf = records.slice(0, half);
    const secondHalf = records.slice(half);

    const firstAvg = this.averageMetrics(firstHalf).taskCount;
    const secondAvg = this.averageMetrics(secondHalf).taskCount;

    if (firstAvg === 0) return secondAvg > 0 ? 'increasing' : 'stable';
    const change = (secondAvg - firstAvg) / firstAvg;

    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  private getCyclicalAdjustment(timestamp: number): number {
    const hour = new Date(timestamp).getHours();
    const dayOfWeek = new Date(timestamp).getDay();

    // Simple daily pattern: higher during business hours
    let adjustment = 1.0;
    if (hour >= 9 && hour <= 17) adjustment = 1.3;
    else if (hour >= 6 && hour <= 20) adjustment = 1.1;
    else adjustment = 0.7;

    // Weekly pattern: lower on weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) adjustment *= 0.6;

    return adjustment;
  }

  private detectPattern(periodMinutes: number, bucketCount: number): WorkloadPattern | null {
    if (this.records.length < bucketCount * 2) return null;

    const buckets = new Array(bucketCount).fill(0).map(() => [] as number[]);
    const bucketSize = periodMinutes / bucketCount;

    for (const record of this.records) {
      const minutesSinceEpoch = Math.floor(record.timestamp / (60 * 1000));
      const bucketIndex = Math.floor((minutesSinceEpoch % periodMinutes) / bucketSize);
      if (bucketIndex >= 0 && bucketIndex < bucketCount) {
        buckets[bucketIndex]!.push(record.metrics.cpuUsage);
      }
    }

    const bucketAvgs = buckets.map((b) =>
      b.length > 0 ? b.reduce((a, v) => a + v, 0) / b.length : 0
    );

    const maxLoad = Math.max(...bucketAvgs);
    const minLoad = Math.min(...bucketAvgs);
    const avgLoad = bucketAvgs.reduce((a, b) => a + b, 0) / bucketAvgs.length;
    const peakIndex = bucketAvgs.indexOf(maxLoad);
    const troughIndex = bucketAvgs.indexOf(minLoad);

    const strength = avgLoad > 0 ? (maxLoad - minLoad) / avgLoad : 0;
    if (strength < 0.2) return null;

    const type = periodMinutes <= 24 * 60 ? 'daily' as const : 'weekly' as const;

    return {
      type,
      period: periodMinutes,
      peakHour: peakIndex,
      troughHour: troughIndex,
      averageLoad: avgLoad,
      peakLoad: maxLoad,
      strength: Math.min(strength, 1),
    };
  }
}
