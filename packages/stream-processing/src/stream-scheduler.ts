// stream-scheduler.ts - Schedule stream processing

import { EventStream } from './event-stream.js';
import { StreamProcessor } from './stream-processor.js';

interface ScheduledStream {
  id: string;
  name: string;
  source: EventStream<unknown>;
  processor: StreamProcessor<unknown, unknown>;
  intervalMs: number;
  paused: boolean;
  timer: ReturnType<typeof setInterval> | undefined;
  processed: number;
  errors: number;
}

let schedulerCounter = 0;

export class StreamScheduler {
  private scheduled: Map<string, ScheduledStream> = new Map();
  private running = false;

  scheduleStream(
    name: string,
    source: EventStream<unknown>,
    processor: StreamProcessor<unknown, unknown>,
    intervalMs?: number
  ): string {
    const id = `sched-${++schedulerCounter}`;
    const entry: ScheduledStream = {
      id,
      name,
      source,
      processor,
      intervalMs: intervalMs ?? 1000,
      paused: false,
      timer: undefined,
      processed: 0,
      errors: 0,
    };
    this.scheduled.set(id, entry);

    if (this.running) {
      this.startScheduledStream(entry);
    }

    return id;
  }

  unschedule(id: string): boolean {
    const entry = this.scheduled.get(id);
    if (!entry) return false;
    if (entry.timer !== undefined) {
      clearInterval(entry.timer);
    }
    entry.processor.stop();
    this.scheduled.delete(id);
    return true;
  }

  pause(id: string): void {
    const entry = this.scheduled.get(id);
    if (!entry) return;
    entry.paused = true;
    if (entry.timer !== undefined) {
      clearInterval(entry.timer);
      entry.timer = undefined;
    }
  }

  resume(id: string): void {
    const entry = this.scheduled.get(id);
    if (!entry) return;
    entry.paused = false;
    if (this.running) {
      this.startScheduledStream(entry);
    }
  }

  getScheduledStreams(): object[] {
    return Array.from(this.scheduled.values()).map((s) => ({
      id: s.id,
      name: s.name,
      intervalMs: s.intervalMs,
      paused: s.paused,
      processed: s.processed,
      errors: s.errors,
    }));
  }

  start(): void {
    this.running = true;
    for (const entry of this.scheduled.values()) {
      if (!entry.paused) {
        this.startScheduledStream(entry);
      }
    }
  }

  stop(): void {
    this.running = false;
    for (const entry of this.scheduled.values()) {
      if (entry.timer !== undefined) {
        clearInterval(entry.timer);
        entry.timer = undefined;
      }
      entry.processor.stop();
    }
  }

  getStats(): { activeStreams: number; totalProcessed: number; errors: number } {
    let totalProcessed = 0;
    let totalErrors = 0;
    for (const entry of this.scheduled.values()) {
      totalProcessed += entry.processed;
      totalErrors += entry.errors;
    }
    return {
      activeStreams: this.scheduled.size,
      totalProcessed,
      errors: totalErrors,
    };
  }

  private startScheduledStream(entry: ScheduledStream): void {
    entry.processor.start();
    entry.processor.input(entry.source);
    entry.timer = setInterval(() => {
      if (entry.paused) return;
      const stats = entry.processor.getStats();
      entry.processed = stats.processed;
      entry.errors = stats.errors;
    }, entry.intervalMs);
  }
}
