// backpressure-handler.ts - Handle backpressure in streams

export class BackpressureHandler {
  private maxPending: number;
  private highWatermark: number;
  private lowWatermark: number;
  private strategy: 'drop' | 'buffer' | 'error';
  private queue: unknown[] = [];
  private dropped = 0;
  private totalPushed = 0;
  private totalPulled = 0;
  private underPressure = false;

  constructor(options: {
    maxPending?: number;
    highWatermark?: number;
    lowWatermark?: number;
    strategy?: 'drop' | 'buffer' | 'error';
  }) {
    this.maxPending = options.maxPending ?? 1000;
    this.highWatermark = options.highWatermark ?? Math.floor(this.maxPending * 0.8);
    this.lowWatermark = options.lowWatermark ?? Math.floor(this.maxPending * 0.3);
    this.strategy = options.strategy ?? 'drop';
  }

  push(event: unknown): boolean {
    this.totalPushed++;

    if (this.queue.length >= this.maxPending) {
      if (this.strategy === 'error') {
        throw new Error('Backpressure: max pending exceeded');
      }
      if (this.strategy === 'drop') {
        this.dropped++;
        return false;
      }
      // 'buffer' strategy: accept anyway
    }

    this.queue.push(event);

    if (this.queue.length >= this.highWatermark) {
      this.underPressure = true;
    }

    return true;
  }

  pull(): unknown | undefined {
    if (this.queue.length === 0) return undefined;
    const event = this.queue.shift();
    this.totalPulled++;

    if (this.underPressure && this.queue.length <= this.lowWatermark) {
      this.underPressure = false;
    }

    return event;
  }

  getPendingCount(): number {
    return this.queue.length;
  }

  isUnderPressure(): boolean {
    return this.underPressure;
  }

  getStats(): {
    pending: number;
    dropped: number;
    totalPushed: number;
    totalPulled: number;
    pressureRatio: number;
  } {
    return {
      pending: this.queue.length,
      dropped: this.dropped,
      totalPushed: this.totalPushed,
      totalPulled: this.totalPulled,
      pressureRatio: this.maxPending > 0 ? this.queue.length / this.maxPending : 0,
    };
  }
}
