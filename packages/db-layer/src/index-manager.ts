// ============================================================
// Module 9: Index Manager
// ============================================================

export type IndexType = 'btree' | 'hash' | 'fulltext' | 'unique';

export interface IndexOptions {
  type?: IndexType;
  unique?: boolean;
  ifNotExists?: boolean;
  comment?: string;
  storageParams?: Record<string, unknown>;
}

export interface IndexInfo {
  name: string;
  table: string;
  columns: string[];
  type: IndexType;
  unique: boolean;
  sizeBytes?: number;
  isPrimary?: boolean;
}

export interface IndexAnalysis {
  totalIndexes: number;
  totalSizeBytes: number;
  indexes: IndexInfo[];
  unusedIndexes: IndexInfo[];
  duplicateIndexes: { indexes: string[]; columns: string[] }[];
}

export interface QueryLog {
  sql: string;
  table: string;
  columns: string[];
  whereColumns: string[];
  frequency: number;
  avgDurationMs: number;
}

export interface IndexSuggestion {
  table: string;
  columns: string[];
  reason: string;
  estimatedImpact: 'high' | 'medium' | 'low';
  suggestedType: IndexType;
}

export class IndexManager {
  private indexes: Map<string, IndexInfo> = new Map();
  private executeSqlFn: (sql: string) => Promise<void>;
  private querySqlFn: (sql: string) => Promise<Record<string, unknown>[]>;

  constructor(
    executeSql: (sql: string) => Promise<void>,
    querySql: (sql: string) => Promise<Record<string, unknown>[]>,
  ) {
    this.executeSqlFn = executeSql;
    this.querySqlFn = querySql;
  }

  async createIndex(table: string, columns: string[], options?: IndexOptions): Promise<string> {
    const indexType = options?.type ?? 'btree';
    const unique = options?.unique ?? false;
    // Validate table and column names to prevent SQL injection
    const validNameRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!validNameRegex.test(table)) {
      throw new Error(`Invalid table name: ${table}`);
    }
    for (const col of columns) {
      if (!validNameRegex.test(col)) {
        throw new Error(`Invalid column name: ${col}`);
      }
    }
    const name = `idx_${table}_${columns.join('_')}`;

    const typeClause = indexType === 'btree' ? '' : `USING ${indexType.toUpperCase()}`;
    const uniqueClause = unique ? 'UNIQUE' : '';
    const ifNotExistsClause = options?.ifNotExists ? 'IF NOT EXISTS' : '';

    const sql = `CREATE ${uniqueClause} INDEX ${ifNotExistsClause} ${name} ${typeClause} ON ${table} (${columns.join(', ')})`.replace(/\s+/g, ' ').trim();
    await this.executeSqlFn(sql);

    const indexInfo: IndexInfo = {
      name,
      table,
      columns,
      type: indexType,
      unique,
    };

    this.indexes.set(name, indexInfo);
    return name;
  }

  async dropIndex(name: string): Promise<void> {
    const index = this.indexes.get(name);
    if (!index) {
      throw new Error(`Index '${name}' not found`);
    }

    await this.executeSqlFn(`DROP INDEX ${name}`);
    this.indexes.delete(name);
  }

  async rebuildIndex(name: string): Promise<void> {
    const index = this.indexes.get(name);
    if (!index) {
      throw new Error(`Index '${name}' not found`);
    }

    await this.executeSqlFn(`REINDEX INDEX ${name}`);
  }

  async rebuildAllIndexes(): Promise<void> {
    await this.executeSqlFn('REINDEX');
  }

  analyzeIndexes(): IndexAnalysis {
    const allIndexes = Array.from(this.indexes.values());
    const unusedIndexes = this.getUnusedIndexes();
    const duplicateIndexes = this.findDuplicateIndexes();

    return {
      totalIndexes: allIndexes.length,
      totalSizeBytes: allIndexes.reduce((sum, idx) => sum + (idx.sizeBytes ?? 0), 0),
      indexes: allIndexes,
      unusedIndexes,
      duplicateIndexes,
    };
  }

  getUnusedIndexes(): IndexInfo[] {
    // In a real implementation, this would query the database statistics
    // For now, return indexes that have no usage data
    return Array.from(this.indexes.values()).filter(idx => !idx.isPrimary);
  }

  private findDuplicateIndexes(): { indexes: string[]; columns: string[] }[] {
    const columnSets = new Map<string, string[]>();

    for (const [name, idx] of this.indexes) {
      const key = `${idx.table}:${idx.columns.sort().join(',')}`;
      if (columnSets.has(key)) {
        columnSets.get(key)!.push(name);
      } else {
        columnSets.set(key, [name]);
      }
    }

    return Array.from(columnSets.entries())
      .filter(([, names]) => names.length > 1)
      .map(([key, names]) => ({
        indexes: names,
        columns: key.split(':')[1]!.split(','),
      }));
  }

  suggestIndexes(queryLog: QueryLog[]): IndexSuggestion[] {
    const suggestions: IndexSuggestion[] = [];
    const tableColumnFrequency = new Map<string, Map<string, number>>();

    // Analyze query patterns
    for (const log of queryLog) {
      const tableKey = log.table;
      if (!tableColumnFrequency.has(tableKey)) {
        tableColumnFrequency.set(tableKey, new Map());
      }
      const colMap = tableColumnFrequency.get(tableKey)!;

      for (const col of log.whereColumns) {
        colMap.set(col, (colMap.get(col) ?? 0) + log.frequency);
      }
    }

    // Generate suggestions
    for (const [table, colMap] of tableColumnFrequency) {
      const sortedCols = Array.from(colMap.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([col]) => col);

      if (sortedCols.length > 0) {
        // Check if similar index already exists
        const existingIndex = this.findExistingIndex(table, sortedCols);
        if (!existingIndex) {
          const totalFreq = sortedCols.reduce((sum, col) => sum + (colMap.get(col) ?? 0), 0);
          suggestions.push({
            table,
            columns: sortedCols,
            reason: `Columns frequently used in WHERE clauses (${totalFreq} queries)`,
            estimatedImpact: totalFreq > 100 ? 'high' : totalFreq > 50 ? 'medium' : 'low',
            suggestedType: 'btree',
          });
        }
      }
    }

    return suggestions.sort((a, b) => {
      const impactOrder = { high: 0, medium: 1, low: 2 };
      return impactOrder[a.estimatedImpact] - impactOrder[b.estimatedImpact];
    });
  }

  private findExistingIndex(table: string, columns: string[]): IndexInfo | undefined {
    for (const idx of this.indexes.values()) {
      if (idx.table === table && columns.every(col => idx.columns.includes(col))) {
        return idx;
      }
    }
    return undefined;
  }

  getIndex(name: string): IndexInfo | undefined {
    return this.indexes.get(name);
  }

  getIndexesForTable(table: string): IndexInfo[] {
    return Array.from(this.indexes.values()).filter(idx => idx.table === table);
  }

  getAllIndexes(): IndexInfo[] {
    return Array.from(this.indexes.values());
  }

  getIndexCount(): number {
    return this.indexes.size;
  }

  // For testing
  _addIndex(indexInfo: IndexInfo): void {
    this.indexes.set(indexInfo.name, indexInfo);
  }

  _clearIndexes(): void {
    this.indexes.clear();
  }
}
