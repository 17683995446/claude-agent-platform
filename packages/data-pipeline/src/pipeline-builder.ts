// src/pipeline-builder.ts - Pipeline Builder Module
// Fluent API for constructing type-safe data pipelines

export interface BatchOptions {
  timeout?: number;
  partial?: boolean;
}

export interface PipelineStage<T, R = T> {
  name: string;
  transform: (data: T) => R | Promise<R>;
}

export interface Pipeline<T> {
  stages: PipelineStage<any, any>[];
  execute(input: T): Promise<T>;
  stream(input: AsyncIterable<T>): AsyncIterable<T>;
}

export class PipelineBuilder<T> {
  private stages: PipelineStage<any, any>[] = [];
  private forkedPipelines: PipelineBuilder<T>[] = [];

  constructor(private initialStages?: PipelineStage<any, any>[]) {
    if (initialStages) {
      this.stages = [...initialStages];
    }
  }

  /**
   * Add a transformation stage to the pipeline
   */
  pipe<R>(transform: (data: T) => R | Promise<R>): PipelineBuilder<R> {
    const newBuilder = new PipelineBuilder<R>(this.stages);
    newBuilder.stages.push({ name: 'pipe', transform });
    return newBuilder;
  }

  /**
   * Filter data based on a predicate
   */
  filter(predicate: (data: T) => boolean): PipelineBuilder<T> {
    const newBuilder = new PipelineBuilder<T>(this.stages);
    newBuilder.stages.push({
      name: 'filter',
      transform: (data: T) => {
        if (predicate(data)) return data;
        throw new FilterSkipError();
      },
    });
    return newBuilder;
  }

  /**
   * Batch data into arrays of specified size
   */
  batch(size: number, options?: BatchOptions): PipelineBuilder<T[]> {
    if (size <= 0) throw new Error('Batch size must be positive');
    const timeout = options?.timeout;
    const partial = options?.partial ?? true;

    const newBuilder = new PipelineBuilder<T[]>(this.stages);
    // Create a proper batch stage and add it directly to stages
    newBuilder.stages.push({
      name: 'batch',
      transform: (() => {
        const buffer: T[] = []; // Fresh buffer per build
        return (data: T): T[] | Promise<T[]> => {
          buffer.push(data);
          if (buffer.length >= size) {
            const batch = [...buffer];
            buffer.length = 0;
            return batch;
          }
          // Buffer not full yet - skip this item (will be included in next batch)
          throw new FilterSkipError();
        };
      })(),
    } as PipelineStage<any, any>);

    return newBuilder;
  }

  /**
   * Fork the pipeline into parallel branches
   */
  fork(...pipelines: PipelineBuilder<T>[]): PipelineBuilder<T> {
    const newBuilder = new PipelineBuilder<T>(this.stages);
    newBuilder.forkedPipelines = pipelines;
    newBuilder.stages.push({
      name: 'fork',
      transform: async (data: T) => {
        await Promise.all(pipelines.map(p => p.build().execute(data)));
        return data;
      },
    });
    return newBuilder;
  }

  /**
   * Merge another pipeline's output into this one
   */
  merge(pipeline: PipelineBuilder<T>): PipelineBuilder<T> {
    const newBuilder = new PipelineBuilder<T>(this.stages);
    newBuilder.stages.push({
      name: 'merge',
      transform: async (data: T) => {
        await pipeline.build().execute(data);
        return data;
      },
    });
    return newBuilder;
  }

  /**
   * Execute a side effect without transforming data
   */
  tap(fn: (data: T) => void): PipelineBuilder<T> {
    const newBuilder = new PipelineBuilder<T>(this.stages);
    newBuilder.stages.push({
      name: 'tap',
      transform: (data: T) => {
        fn(data);
        return data;
      },
    });
    return newBuilder;
  }

  /**
   * Build the pipeline into an executable Pipeline
   */
  build(): Pipeline<T> {
    const stages = [...this.stages];
    return {
      stages,
      async execute(input: T): Promise<T> {
        let result: any = input;
        for (const stage of stages) {
          try {
            result = await stage.transform(result);
          } catch (e) {
            if (e instanceof FilterSkipError) {
              // Data was filtered out - skip remaining stages
              return undefined as T;
            }
            throw e;
          }
        }
        return result as T;
      },
      async *stream(input: AsyncIterable<T>): AsyncIterable<T> {
        for await (const item of input) {
          let result: any = item;
          let skipped = false;
          for (const stage of stages) {
            try {
              result = await stage.transform(result);
            } catch (e) {
              if (e instanceof FilterSkipError) {
                skipped = true;
                break;
              }
              throw e;
            }
          }
          if (!skipped) {
            yield result as T;
          }
        }
      },
    };
  }
}

/**
 * Internal error for filter skip
 */
class FilterSkipError extends Error {
  constructor() {
    super('FilterSkip');
    this.name = 'FilterSkipError';
  }
}
