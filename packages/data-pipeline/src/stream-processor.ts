// src/stream-processor.ts - Stream Processor Module
// Processing data streams with windowing, aggregation, and backpressure

export type AggregationFn<T, R> = (items: T[]) => R;

export interface WindowOptions {
  size: number;
  slide?: number;
  gap?: number; // for session windows
}

export interface ThrottleOptions {
  intervalMs: number;
}

export interface DebounceOptions {
  delayMs: number;
}

export class StreamProcessor<T> {
  private windowOptions?: WindowOptions;
  private aggregationFn?: AggregationFn<T, any>;
  private throttleOptions?: ThrottleOptions;
  private debounceOptions?: DebounceOptions;
  private maxConcurrency: number = 10;
  private activeCount: number = 0;
  private queue: Array<{
    item: T;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = [];

  /**
   * Process an async iterable source
   */
  async *process(source: AsyncIterable<T>): AsyncIterable<T> {
    if (this.windowOptions) {
      yield* this.processWithWindow(source);
      return;
    }

    if (this.aggregationFn) {
      yield* this.processWithAggregation(source);
      return;
    }

    if (this.throttleOptions) {
      yield* this.processWithThrottle(source);
      return;
    }

    if (this.debounceOptions) {
      yield* this.processWithDebounce(source);
      return;
    }

    yield* this.processWithBackpressure(source);
  }

  private async *processWithBackpressure(source: AsyncIterable<T>): AsyncIterable<T> {
    const pending: Promise<T>[] = [];

    for await (const item of source) {
      if (this.activeCount >= this.maxConcurrency) {
        const result = await Promise.race(pending);
        const idx = pending.indexOf(result as any);
        if (idx >= 0) pending.splice(idx, 1);
        this.activeCount--;
        yield result;
      }

      this.activeCount++;
      const promise = Promise.resolve(item);
      pending.push(promise);
    }

    // Drain remaining
    for (const promise of pending) {
      this.activeCount--;
      yield await promise;
    }
  }

  private async *processWithWindow(source: AsyncIterable<T>): AsyncIterable<T[]> {
    const opts = this.windowOptions!;
    const slide = opts.slide ?? opts.size;
    const buffer: T[] = [];

    for await (const item of source) {
      buffer.push(item);

      if (buffer.length >= opts.size) {
        const window = buffer.slice(0, opts.size);
        yield window;

        if (slide < opts.size) {
          buffer.splice(0, slide);
        } else {
          buffer.length = 0;
        }
      }
    }

    // Emit remaining items as partial window
    if (buffer.length > 0) {
      yield buffer;
    }
  }

  private async *processWithAggregation(source: AsyncIterable<T>): AsyncIterable<any> {
    const buffer: T[] = [];

    for await (const item of source) {
      buffer.push(item);

      if (this.windowOptions && buffer.length >= this.windowOptions.size) {
        yield this.aggregationFn!(buffer);
        buffer.length = 0;
      }
    }

    if (buffer.length > 0) {
      yield this.aggregationFn!(buffer);
    }
  }

  private async *processWithThrottle(source: AsyncIterable<T>): AsyncIterable<T> {
    const intervalMs = this.throttleOptions!.intervalMs;
    let lastEmit = 0;

    for await (const item of source) {
      const now = Date.now();
      const elapsed = now - lastEmit;

      if (elapsed < intervalMs) {
        await new Promise(resolve => setTimeout(resolve, intervalMs - elapsed));
      }

      lastEmit = Date.now();
      yield item;
    }
  }

  private async *processWithDebounce(source: AsyncIterable<T>): AsyncIterable<T> {
    const delayMs = this.debounceOptions!.delayMs;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingItem: T | null = null;
    let resolveItem: ((value: T) => void) | null = null;

    const processSource = async () => {
      for await (const item of source) {
        pendingItem = item;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (pendingItem !== null && resolveItem) {
            const itemToResolve = pendingItem;
            pendingItem = null;
            resolveItem(itemToResolve);
            resolveItem = null;
          }
        }, delayMs);
      }

      // Flush remaining
      if (pendingItem !== null) {
        if (timer) clearTimeout(timer);
        await new Promise<void>(resolve => {
          timer = setTimeout(() => {
            if (pendingItem !== null && resolveItem) {
              resolveItem(pendingItem);
              pendingItem = null;
              resolveItem = null;
            }
            resolve();
          }, delayMs);
        });
      }
    };

    processSource();

    while (true) {
      const item = await new Promise<T>((resolve) => {
        resolveItem = resolve;
      });
      yield item;
    }
  }

  /**
   * Configure windowing (tumbling or sliding)
   */
  window(size: number, slide?: number): StreamProcessor<T[]> {
    const processor = new StreamProcessor<T[]>();
    processor.windowOptions = { size, slide };
    return processor;
  }

  /**
   * Configure session windowing (gap-based)
   */
  sessionWindow(gap: number): StreamProcessor<T[]> {
    const processor = new StreamProcessor<T[]>();
    processor.windowOptions = { size: Infinity, gap };
    return processor;
  }

  /**
   * Configure aggregation
   */
  aggregate<R>(fn: AggregationFn<T, R>): StreamProcessor<R> {
    const processor = new StreamProcessor<R>();
    processor.aggregationFn = fn as AggregationFn<any, R>;
    return processor;
  }

  /**
   * Configure throttling
   */
  throttle(intervalMs: number): StreamProcessor<T> {
    const processor = new StreamProcessor<T>();
    processor.throttleOptions = { intervalMs };
    return processor;
  }

  /**
   * Configure debouncing
   */
  debounce(delayMs: number): StreamProcessor<T> {
    const processor = new StreamProcessor<T>();
    processor.debounceOptions = { delayMs };
    return processor;
  }

  /**
   * Set max concurrency for backpressure management
   */
  setMaxConcurrency(max: number): this {
    this.maxConcurrency = max;
    return this;
  }

  /**
   * Join two streams (zip operation)
   */
  static async *join<T, U>(
    left: AsyncIterable<T>,
    right: AsyncIterable<U>
  ): AsyncIterable<[T, U]> {
    const leftIter = left[Symbol.asyncIterator]();
    const rightIter = right[Symbol.asyncIterator]();

    try {
      while (true) {
        const leftResult = await leftIter.next();
        const rightResult = await rightIter.next();

        if (leftResult.done || rightResult.done) break;
        yield [leftResult.value, rightResult.value];
      }
    } finally {
      leftIter.return?.();
      rightIter.return?.();
    }
  }

  /**
   * Stream-table join: enrich stream items with table data
   */
  static async *streamTableJoin<T extends Record<string, unknown>, U>(
    stream: AsyncIterable<T>,
    table: Map<string, U>,
    keyFn: (item: T) => string
  ): AsyncIterable<T & { _joined: U }> {
    for await (const item of stream) {
      const key = keyFn(item);
      const tableValue = table.get(key);
      if (tableValue !== undefined) {
        yield { ...item, _joined: tableValue } as T & { _joined: U };
      }
    }
  }
}
