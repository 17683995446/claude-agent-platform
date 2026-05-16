// src/memory-manager.ts - 内存管理器

export interface MemoryUsage {
  used: number;
  total: number;
  percentage: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

export interface MemoryTrend {
  direction: 'increasing' | 'decreasing' | 'stable';
  rate: number; // bytes per second
  samples: number;
  duration: number; // ms
}

export interface GCSuccess {
  triggered: boolean;
  freedBefore: number;
  freedAfter: number;
  freedAmount: number;
  timestamp: number;
}

export interface LeakReport {
  hasLeak: boolean;
  confidence: number; // 0-1
  growthRate: number; // bytes per second
  samples: number;
  recommendation: string;
}

export interface LargeObject {
  id: string;
  size: number;
  type: string;
  createdAt: number;
  lastAccessed: number;
}

export class MemoryManager {
  private warningThreshold: number = 70; // percent
  private criticalThreshold: number = 90; // percent
  private usageHistory: { used: number; timestamp: number }[] = [];
  private maxHistorySamples: number = 1000;
  private largeObjects: Map<string, LargeObject> = new Map();
  private idCounter: number = 0;

  getUsage(): MemoryUsage {
    // Use Bun's memory API or fallback to estimates
    const mem = (globalThis as any).performance?.memory;
    if (mem) {
      return {
        used: mem.usedJSHeapSize,
        total: mem.jsHeapSizeLimit,
        percentage: (mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100,
        heapUsed: mem.usedJSHeapSize,
        heapTotal: mem.totalJSHeapSize,
        external: 0,
        rss: process.memoryUsage?.().rss ?? 0,
      };
    }
    // Fallback
    const usage = process.memoryUsage();
    const total = 512 * 1024 * 1024; // Assume 512MB
    return {
      used: usage.heapUsed,
      total,
      percentage: (usage.heapUsed / total) * 100,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss,
    };
  }

  recordUsage(): void {
    const usage = this.getUsage();
    this.usageHistory.push({ used: usage.used, timestamp: Date.now() });
    if (this.usageHistory.length > this.maxHistorySamples) {
      this.usageHistory.shift();
    }
  }

  getTrend(): MemoryTrend {
    if (this.usageHistory.length < 2) {
      return { direction: 'stable', rate: 0, samples: this.usageHistory.length, duration: 0 };
    }

    const first = this.usageHistory[0];
    const last = this.usageHistory[this.usageHistory.length - 1];
    const duration = last.timestamp - first.timestamp;

    if (duration === 0) {
      return { direction: 'stable', rate: 0, samples: this.usageHistory.length, duration: 0 };
    }

    const rate = (last.used - first.used) / (duration / 1000);

    let direction: 'increasing' | 'decreasing' | 'stable';
    if (rate > 1000) {
      direction = 'increasing';
    } else if (rate < -1000) {
      direction = 'decreasing';
    } else {
      direction = 'stable';
    }

    return { direction, rate, samples: this.usageHistory.length, duration };
  }

  forceGC(): GCSuccess {
    const before = this.getUsage();
    // Trigger GC if available
    if (typeof (globalThis as any).gc === 'function') {
      (globalThis as any).gc();
    }
    const after = this.getUsage();

    return {
      triggered: true,
      freedBefore: before.heapUsed,
      freedAfter: after.heapUsed,
      freedAmount: Math.max(0, before.heapUsed - after.heapUsed),
      timestamp: Date.now(),
    };
  }

  detectLeaks(): LeakReport {
    const trend = this.getTrend();
    const hasLeak = trend.direction === 'increasing' && trend.rate > 10000;
    const confidence = hasLeak ? Math.min(1, trend.samples / 50) : 0;

    return {
      hasLeak,
      confidence,
      growthRate: trend.rate,
      samples: trend.samples,
      recommendation: hasLeak
        ? 'Memory leak detected. Consider restarting the process or investigating allocation patterns.'
        : 'No memory leak detected.',
    };
  }

  trackLargeObjects(minSize: number): LargeObject[] {
    return [...this.largeObjects.values()].filter(obj => obj.size >= minSize);
  }

  registerLargeObject(size: number, type: string): LargeObject {
    const id = `obj-${++this.idCounter}`;
    const now = Date.now();
    const obj: LargeObject = { id, size, type, createdAt: now, lastAccessed: now };
    this.largeObjects.set(id, obj);
    return obj;
  }

  unregisterLargeObject(id: string): boolean {
    return this.largeObjects.delete(id);
  }

  accessLargeObject(id: string): void {
    const obj = this.largeObjects.get(id);
    if (obj) {
      obj.lastAccessed = Date.now();
    }
  }

  setThreshold(warning: number, critical: number): void {
    this.warningThreshold = warning;
    this.criticalThreshold = critical;
  }

  getThresholds(): { warning: number; critical: number } {
    return { warning: this.warningThreshold, critical: this.criticalThreshold };
  }

  isWarning(): boolean {
    return this.getUsage().percentage >= this.warningThreshold;
  }

  isCritical(): boolean {
    return this.getUsage().percentage >= this.criticalThreshold;
  }

  getHistoryLength(): number {
    return this.usageHistory.length;
  }

  clearHistory(): void {
    this.usageHistory = [];
  }

  clearLargeObjects(): void {
    this.largeObjects.clear();
  }
}
