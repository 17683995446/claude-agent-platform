// ============================================================
// Module 7: Query Executor
// ============================================================

import type { QueryBuilder } from './query-builder.ts';

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
}

export interface BatchResult {
  results: QueryResult[];
  totalDurationMs: number;
  success: boolean;
  errors: { index: number; error: string }[];
}

export interface Query {
  sql: string;
  params?: unknown[];
}

export interface StreamOptions {
  batchSize: number;
  onBatch: (rows: Record<string, unknown>[]) => Promise<void>;
}

export interface QueryLog {
  sql: string;
  params?: unknown[];
  durationMs: number;
  timestamp: number;
  error?: string;
}

export class QueryExecutor {
  private executeSqlFn: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  private queryLog: QueryLog[] = [];
  private maxLogSize: number;

  constructor(
    executeSql: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>,
    options?: { maxLogSize?: number },
  ) {
    this.executeSqlFn = executeSql;
    this.maxLogSize = options?.maxLogSize ?? 1000;
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    const start = Date.now();
    try {
      const rows = await this.executeSqlFn(sql, params);
      const durationMs = Date.now() - start;
      this.logQuery(sql, params, durationMs);
      return { rows, rowCount: rows.length, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      this.logQuery(sql, params, durationMs, String(err));
      throw err;
    }
  }

  async executeOne(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
    const result = await this.execute(sql, params);
    return result.rows[0];
  }

  async executeMany(queries: Query[]): Promise<BatchResult> {
    const startTime = Date.now();
    const results: QueryResult[] = [];
    const errors: { index: number; error: string }[] = [];

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i]!;
      try {
        const result = await this.execute(query.sql, query.params);
        results.push(result);
      } catch (err) {
        errors.push({ index: i, error: String(err) });
      }
    }

    return {
      results,
      totalDurationMs: Date.now() - startTime,
      success: errors.length === 0,
      errors,
    };
  }

  async executeBuilder(builder: QueryBuilder): Promise<QueryResult> {
    const { sql, params } = builder.build();
    return this.execute(sql, params);
  }

  async executeBuilderOne(builder: QueryBuilder): Promise<Record<string, unknown> | undefined> {
    const result = await this.executeBuilder(builder);
    return result.rows[0];
  }

  async *stream(sql: string, params?: unknown[], options?: Partial<StreamOptions>): AsyncGenerator<Record<string, unknown>[]> {
    const batchSize = options?.batchSize ?? 100;
    const result = await this.execute(sql, params);

    for (let i = 0; i < result.rows.length; i += batchSize) {
      const batch = result.rows.slice(i, i + batchSize);
      yield batch;
    }
  }

  async streamWithCallback(sql: string, params: unknown[] | undefined, options: StreamOptions): Promise<void> {
    const result = await this.execute(sql, params);
    const batchSize = options.batchSize;

    for (let i = 0; i < result.rows.length; i += batchSize) {
      const batch = result.rows.slice(i, i + batchSize);
      await options.onBatch(batch);
    }
  }

  getQueryLog(): QueryLog[] {
    return [...this.queryLog];
  }

  getSlowQueries(thresholdMs: number): QueryLog[] {
    return this.queryLog.filter(q => q.durationMs > thresholdMs);
  }

  getErrorQueries(): QueryLog[] {
    return this.queryLog.filter(q => q.error);
  }

  clearLog(): void {
    this.queryLog = [];
  }

  getLogSize(): number {
    return this.queryLog.length;
  }

  private logQuery(sql: string, params: unknown[] | undefined, durationMs: number, error?: string): void {
    this.queryLog.push({
      sql,
      params,
      durationMs,
      timestamp: Date.now(),
      error,
    });

    // Trim log if exceeds max size
    if (this.queryLog.length > this.maxLogSize) {
      this.queryLog = this.queryLog.slice(-this.maxLogSize);
    }
  }
}
