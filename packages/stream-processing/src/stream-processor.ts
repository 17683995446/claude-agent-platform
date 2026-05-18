// stream-processor.ts - Process streams with stages

import { EventStream } from './event-stream.js';

export type TransformStage<T, U> = (event: T) => U | Promise<U> | U[];

export class StreamProcessor<TIn, TOut> {
  private stages: Array<{ transform: TransformStage<unknown, unknown> }> = [];
  private outputStream: EventStream<TOut>;
  private concurrency: number;
  private errorHandler: ((error: unknown, event: unknown) => void) | undefined;
  private inputSubscriptions: Array<{ stream: EventStream<unknown>; unsubscribe: () => void }> = [];
  private running = false;
  private processed = 0;
  private errors = 0;
  private totalLatency = 0;
  private startTime = 0;

  constructor(options?: { concurrency?: number; errorHandler?: (error: unknown, event: unknown) => void }) {
    this.concurrency = options?.concurrency ?? 1;
    this.errorHandler = options?.errorHandler;
    this.outputStream = new EventStream<TOut>();
  }

  pipe<U>(stage: TransformStage<TOut, U>): StreamProcessor<TIn, U> {
    this.stages.push({ transform: stage as TransformStage<unknown, unknown> });
    // Create a new processor that wraps this one
    const nextProcessor = new StreamProcessor<TIn, U>({
      concurrency: this.concurrency,
      errorHandler: this.errorHandler,
    });
    // Copy stages
    nextProcessor.stages = [...this.stages];
    return nextProcessor;
  }

  input(stream: EventStream<TIn>): void {
    const unsub = stream.subscribe((event) => {
      if (!this.running) return;
      void this.processEvent(event);
    });
    this.inputSubscriptions.push({
      stream: stream as EventStream<unknown>,
      unsubscribe: () => unsub.unsubscribe(),
    });
  }

  getOutputStream(): EventStream<TOut> {
    return this.outputStream;
  }

  start(): void {
    this.running = true;
    this.startTime = Date.now();
  }

  stop(): void {
    this.running = false;
    for (const sub of this.inputSubscriptions) {
      sub.unsubscribe();
    }
    this.inputSubscriptions = [];
  }

  getStats(): { processed: number; errors: number; avgLatency: number; throughput: number } {
    const elapsed = Date.now() - this.startTime;
    return {
      processed: this.processed,
      errors: this.errors,
      avgLatency: this.processed > 0 ? this.totalLatency / this.processed : 0,
      throughput: elapsed > 0 ? (this.processed / elapsed) * 1000 : 0,
    };
  }

  private async processEvent(event: TIn): Promise<void> {
    const start = Date.now();
    try {
      let current: unknown = event;
      for (const stage of this.stages) {
        const result = stage.transform(current);
        if (Array.isArray(result)) {
          // For arrays, process the last element through remaining stages
          // and publish all
          const items = result;
          for (const item of items) {
            current = item;
          }
        } else if (result instanceof Promise) {
          current = await result;
        } else {
          current = result;
        }
      }
      this.outputStream.publish(current as TOut);
      this.processed++;
    } catch (err) {
      this.errors++;
      if (this.errorHandler) {
        this.errorHandler(err, event);
      }
    } finally {
      this.totalLatency += Date.now() - start;
    }
  }
}
