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
      for (let stageIdx = 0; stageIdx < this.stages.length; stageIdx++) {
        const stage = this.stages[stageIdx]!;
        const result = stage.transform(current);
        if (Array.isArray(result)) {
          // For arrays, publish each item through the output stream
          const items = result;
          if (stageIdx === this.stages.length - 1) {
            // Last stage: publish all items
            for (const item of items) {
              this.outputStream.publish(item as TOut);
              this.processed++;
            }
            current = undefined;
          } else {
            // Not the last stage: process each item through remaining stages
            const remainingStages = this.stages.slice(stageIdx + 1);
            for (const item of items) {
              let itemResult: unknown = item;
              for (const remainingStage of remainingStages) {
                const r = remainingStage.transform(itemResult);
                if (Array.isArray(r)) {
                  // Nested arrays not supported; take last element
                  const arr = r as unknown[];
                  itemResult = arr[arr.length - 1];
                } else if (r instanceof Promise) {
                  itemResult = await r;
                } else {
                  itemResult = r;
                }
              }
              this.outputStream.publish(itemResult as TOut);
              this.processed++;
            }
            current = undefined;
          }
        } else if (result instanceof Promise) {
          current = await result;
        } else {
          current = result;
        }
      }
      // If current was not set to undefined (no array expansion), publish it
      if (current !== undefined) {
        this.outputStream.publish(current as TOut);
        this.processed++;
      }
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
