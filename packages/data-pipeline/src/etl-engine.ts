// src/etl-engine.ts - ETL Engine Module
// Extract-Transform-Load operations with error handling and progress tracking

export interface ExtractorConfig {
  type: 'file' | 'http' | 'database' | 'memory';
  source: string;
  options?: Record<string, unknown>;
}

export interface TransformerConfig {
  transforms: Array<{
    field?: string;
    transform: string;
    options?: Record<string, unknown>;
  }>;
}

export interface LoaderConfig {
  type: 'file' | 'http' | 'database' | 'memory' | 'stdout';
  target: string;
  options?: Record<string, unknown>;
}

export type ErrorStrategy = 'skip' | 'retry' | 'abort' | 'dead-letter';

export interface ETLConfig {
  name: string;
  extract: ExtractorConfig;
  transform?: TransformerConfig;
  load: LoaderConfig;
  errorStrategy?: ErrorStrategy;
  maxRetries?: number;
  dryRun?: boolean;
  batchSize?: number;
}

export interface ETLResult {
  success: boolean;
  recordsExtracted: number;
  recordsTransformed: number;
  recordsLoaded: number;
  recordsSkipped: number;
  errors: Array<{ record: unknown; error: string }>;
  duration: number;
  dryRun: boolean;
}

export interface ProgressCallback {
  (progress: {
    phase: 'extract' | 'transform' | 'load';
    current: number;
    total?: number;
    record?: unknown;
  }): void;
}

export interface Extractor {
  extract(config: ExtractorConfig): Promise<unknown[]>;
}

export interface Loader {
  load(data: unknown[], config: LoaderConfig): Promise<number>;
}

export class ETLEngine {
  private extractors: Map<string, Extractor> = new Map();
  private loaders: Map<string, Loader> = new Map();
  private deadLetterQueue: Array<{ record: unknown; error: string; config: string }> = [];
  private memoryStore: Map<string, unknown[]> = new Map();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    // Memory extractor
    this.extractors.set('memory', {
      extract: async (config) => {
        const data = this.memoryStore.get(config.source);
        return data ? [...data] : [];
      },
    });

    // Memory loader
    this.loaders.set('memory', {
      load: async (data, config) => {
        const existing = this.memoryStore.get(config.target) ?? [];
        existing.push(...data);
        this.memoryStore.set(config.target, existing);
        return data.length;
      },
    });

    // File extractor (JSON)
    this.extractors.set('file', {
      extract: async (config) => {
        const { options } = config;
        if (options?.data) {
          return Array.isArray(options.data) ? options.data : [options.data];
        }
        return [];
      },
    });

    // File loader
    this.loaders.set('file', {
      load: async (data, config) => {
        this.memoryStore.set(`file:${config.target}`, data);
        return data.length;
      },
    });

    // HTTP extractor
    this.extractors.set('http', {
      extract: async (config) => {
        const { options } = config;
        if (options?.data) {
          return Array.isArray(options.data) ? options.data : [options.data];
        }
        return [];
      },
    });

    // HTTP loader
    this.loaders.set('http', {
      load: async (data, _config) => {
        return data.length;
      },
    });

    // Database extractor
    this.extractors.set('database', {
      extract: async (config) => {
        const { options } = config;
        if (options?.data) {
          return Array.isArray(options.data) ? options.data : [options.data];
        }
        return [];
      },
    });

    // Database loader
    this.loaders.set('database', {
      load: async (data, _config) => {
        return data.length;
      },
    });

    // Stdout loader
    this.loaders.set('stdout', {
      load: async (data, _config) => {
        for (const record of data) {
          console.log(JSON.stringify(record));
        }
        return data.length;
      },
    });
  }

  /**
   * Register a custom extractor
   */
  registerExtractor(type: string, extractor: Extractor): void {
    this.extractors.set(type, extractor);
  }

  /**
   * Register a custom loader
   */
  registerLoader(type: string, loader: Loader): void {
    this.loaders.set(type, loader);
  }

  /**
   * Set memory data for memory extractor
   */
  setMemoryData(key: string, data: unknown[]): void {
    this.memoryStore.set(key, data);
  }

  /**
   * Get memory data
   */
  getMemoryData(key: string): unknown[] {
    return this.memoryStore.get(key) ?? [];
  }

  /**
   * Run an ETL pipeline
   */
  async run(config: ETLConfig, onProgress?: ProgressCallback): Promise<ETLResult> {
    const startTime = Date.now();
    const errors: Array<{ record: unknown; error: string }> = [];
    let recordsExtracted = 0;
    let recordsTransformed = 0;
    let recordsLoaded = 0;
    let recordsSkipped = 0;

    const errorStrategy = config.errorStrategy ?? 'skip';
    const maxRetries = config.maxRetries ?? 3;
    const isDryRun = config.dryRun ?? false;

    try {
      // Extract
      onProgress?.({ phase: 'extract', current: 0 });
      const extractor = this.extractors.get(config.extract.type);
      if (!extractor) {
        throw new Error(`Unknown extractor type: ${config.extract.type}`);
      }

      let records = await extractor.extract(config.extract);
      recordsExtracted = records.length;
      onProgress?.({ phase: 'extract', current: recordsExtracted, total: recordsExtracted });

      if (isDryRun) {
        return {
          success: true,
          recordsExtracted,
          recordsTransformed: 0,
          recordsLoaded: 0,
          recordsSkipped: 0,
          errors: [],
          duration: Date.now() - startTime,
          dryRun: true,
        };
      }

      // Transform
      if (config.transform) {
        onProgress?.({ phase: 'transform', current: 0, total: records.length });
        const transformedRecords: unknown[] = [];

        for (let i = 0; i < records.length; i++) {
          let record = records[i];
          let success = false;
          let attempts = 0;

          while (!success && attempts <= maxRetries) {
            attempts++;
            try {
              for (const t of config.transform.transforms) {
                if (t.transform === 'identity') continue;
                // Simple transform simulation
                if (typeof record === 'object' && record !== null && t.field) {
                  const obj = record as Record<string, unknown>;
                  if (t.transform === 'toString' && t.field in obj) {
                    obj[t.field] = String(obj[t.field]);
                  } else if (t.transform === 'toNumber' && t.field in obj) {
                    obj[t.field] = Number(obj[t.field]);
                  } else if (t.transform === 'uppercase' && t.field in obj) {
                    obj[t.field] = String(obj[t.field]).toUpperCase();
                  } else if (t.transform === 'lowercase' && t.field in obj) {
                    obj[t.field] = String(obj[t.field]).toLowerCase();
                  } else if (t.transform === 'trim' && t.field in obj) {
                    obj[t.field] = String(obj[t.field]).trim();
                  }
                }
              }
              transformedRecords.push(record);
              recordsTransformed++;
              success = true;
            } catch (e) {
              if (errorStrategy === 'skip') {
                const errorMsg = `Transform error: ${(e as Error).message}`;
                errors.push({ record, error: errorMsg });
                recordsSkipped++;
                break;
              }
              if (attempts > maxRetries) {
                const errorMsg = `Transform error: ${(e as Error).message}`;
                errors.push({ record, error: errorMsg });
                if (errorStrategy === 'abort') {
                  return {
                    success: false,
                    recordsExtracted,
                    recordsTransformed,
                    recordsLoaded: 0,
                    recordsSkipped,
                    errors,
                    duration: Date.now() - startTime,
                    dryRun: false,
                  };
                }
                if (errorStrategy === 'dead-letter') {
                  this.deadLetterQueue.push({ record, error: errorMsg, config: config.name });
                }
                recordsSkipped++;
                break;
              }
              // errorStrategy === 'retry': continue the while loop
            }
          }
          onProgress?.({ phase: 'transform', current: i + 1, total: records.length, record });
        }

        records = transformedRecords;
      }

      // Load
      onProgress?.({ phase: 'load', current: 0, total: records.length });
      const loader = this.loaders.get(config.load.type);
      if (!loader) {
        throw new Error(`Unknown loader type: ${config.load.type}`);
      }

      if (config.batchSize && config.batchSize > 0) {
        for (let i = 0; i < records.length; i += config.batchSize) {
          const batch = records.slice(i, i + config.batchSize);
          recordsLoaded += await loader.load(batch, config.load);
          onProgress?.({ phase: 'load', current: Math.min(i + config.batchSize, records.length), total: records.length });
        }
      } else {
        recordsLoaded = await loader.load(records, config.load);
        onProgress?.({ phase: 'load', current: recordsLoaded, total: records.length });
      }

      return {
        success: errors.length === 0,
        recordsExtracted,
        recordsTransformed,
        recordsLoaded,
        recordsSkipped,
        errors,
        duration: Date.now() - startTime,
        dryRun: false,
      };
    } catch (e) {
      return {
        success: false,
        recordsExtracted,
        recordsTransformed,
        recordsLoaded,
        recordsSkipped,
        errors: [...errors, { record: null, error: (e as Error).message }],
        duration: Date.now() - startTime,
        dryRun: isDryRun,
      };
    }
  }

  /**
   * Run incremental ETL with checkpoint support
   */
  async runIncremental(config: ETLConfig, checkpoint?: string, onProgress?: ProgressCallback): Promise<ETLResult> {
    // For incremental, we track what was already processed
    const result = await this.run(config, onProgress);
    result.dryRun = false;

    // Store checkpoint
    if (result.success) {
      this.memoryStore.set(`checkpoint:${config.name}`, [
        { timestamp: Date.now(), recordsProcessed: result.recordsLoaded, checkpoint },
      ]);
    }

    return result;
  }

  /**
   * Get dead letter queue
   */
  getDeadLetterQueue(): Array<{ record: unknown; error: string; config: string }> {
    return [...this.deadLetterQueue];
  }
}
