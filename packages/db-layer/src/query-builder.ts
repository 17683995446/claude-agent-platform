// ============================================================
// Module 2: Query Builder
// ============================================================

export interface QueryResult {
  sql: string;
  params: unknown[];
}

export type JoinType = 'INNER JOIN' | 'LEFT JOIN' | 'RIGHT JOIN' | 'FULL OUTER JOIN' | 'CROSS JOIN';

export type SetOperation = 'UNION' | 'UNION ALL' | 'INTERSECT' | 'EXCEPT';

export class QueryBuilder {
  private _select: string[] = [];
  private _from: string = '';
  private _joins: { type: JoinType; table: string; on: string }[] = [];
  private _where: { condition: string; params: unknown[] }[] = [];
  private _groupBy: string[] = [];
  private _having: { condition: string; params: unknown[] }[] = [];
  private _orderBy: { column: string; direction: 'asc' | 'desc' }[] = [];
  private _limit: number | null = null;
  private _offset: number | null = null;
  private _params: unknown[] = [];
  private _setOperations: { operation: SetOperation; builder: QueryBuilder }[] = [];

  private readonly VALID_SAVEPOINT_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  select(columns: string[]): QueryBuilder {
    this._select = columns;
    return this;
  }

  from(table: string): QueryBuilder {
    this._from = table;
    return this;
  }

  where(condition: string, params?: unknown[]): QueryBuilder {
    this._where.push({ condition, params: params ?? [] });
    return this;
  }

  andWhere(condition: string, params?: unknown[]): QueryBuilder {
    if (this._where.length > 0) {
      const last = this._where[this._where.length - 1]!;
      this._where.push({ condition: `AND (${condition})`, params: params ?? [] });
    } else {
      this._where.push({ condition, params: params ?? [] });
    }
    return this;
  }

  orWhere(condition: string, params?: unknown[]): QueryBuilder {
    if (this._where.length > 0) {
      this._where.push({ condition: `OR (${condition})`, params: params ?? [] });
    } else {
      this._where.push({ condition, params: params ?? [] });
    }
    return this;
  }

  join(table: string, on: string): QueryBuilder {
    this._joins.push({ type: 'INNER JOIN', table, on });
    return this;
  }

  leftJoin(table: string, on: string): QueryBuilder {
    this._joins.push({ type: 'LEFT JOIN', table, on });
    return this;
  }

  rightJoin(table: string, on: string): QueryBuilder {
    this._joins.push({ type: 'RIGHT JOIN', table, on });
    return this;
  }

  fullJoin(table: string, on: string): QueryBuilder {
    this._joins.push({ type: 'FULL OUTER JOIN', table, on });
    return this;
  }

  crossJoin(table: string): QueryBuilder {
    this._joins.push({ type: 'CROSS JOIN', table, on: '' });
    return this;
  }

  groupBy(...columns: string[]): QueryBuilder {
    this._groupBy.push(...columns);
    return this;
  }

  having(condition: string, params?: unknown[]): QueryBuilder {
    this._having.push({ condition, params: params ?? [] });
    return this;
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): QueryBuilder {
    this._orderBy.push({ column, direction });
    return this;
  }

  limit(count: number): QueryBuilder {
    this._limit = count;
    return this;
  }

  offset(count: number): QueryBuilder {
    this._offset = count;
    return this;
  }

  union(builder: QueryBuilder): QueryBuilder {
    this._setOperations.push({ operation: 'UNION', builder });
    return this;
  }

  unionAll(builder: QueryBuilder): QueryBuilder {
    this._setOperations.push({ operation: 'UNION ALL', builder });
    return this;
  }

  intersect(builder: QueryBuilder): QueryBuilder {
    this._setOperations.push({ operation: 'INTERSECT', builder });
    return this;
  }

  except(builder: QueryBuilder): QueryBuilder {
    this._setOperations.push({ operation: 'EXCEPT', builder });
    return this;
  }

  build(): QueryResult {
    const parts: string[] = [];
    const allParams: unknown[] = [];

    // SELECT clause
    if (this._select.length > 0) {
      parts.push(`SELECT ${this._select.join(', ')}`);
    }

    // FROM clause
    if (this._from) {
      parts.push(`FROM ${this._from}`);
    }

    // JOIN clauses
    for (const j of this._joins) {
      if (j.on) {
        parts.push(`${j.type} ${j.table} ON ${j.on}`);
      } else {
        parts.push(`${j.type} ${j.table}`);
      }
    }

    // WHERE clause
    if (this._where.length > 0) {
      const conditions = this._where.map(w => {
        allParams.push(...w.params);
        return w.condition;
      });
      parts.push(`WHERE ${conditions.join(' ')}`);
    }

    // GROUP BY clause
    if (this._groupBy.length > 0) {
      parts.push(`GROUP BY ${this._groupBy.join(', ')}`);
    }

    // HAVING clause
    if (this._having.length > 0) {
      const conditions = this._having.map(h => {
        allParams.push(...h.params);
        return h.condition;
      });
      parts.push(`HAVING ${conditions.join(' AND ')}`);
    }

    // ORDER BY clause
    if (this._orderBy.length > 0) {
      const orderParts = this._orderBy.map(o => `${o.column} ${o.direction.toUpperCase()}`);
      parts.push(`ORDER BY ${orderParts.join(', ')}`);
    }

    // LIMIT clause
    if (this._limit !== null) {
      parts.push(`LIMIT ${this._limit}`);
    }

    // OFFSET clause
    if (this._offset !== null) {
      parts.push(`OFFSET ${this._offset}`);
    }

    let sql = parts.join(' ');

    // Set operations
    for (const op of this._setOperations) {
      const subResult = op.builder.build();
      sql += ` ${op.operation} (${subResult.sql})`;
      allParams.push(...subResult.params);
    }

    return { sql, params: allParams };
  }

  toSQL(): { sql: string; params: unknown[] } {
    return this.build();
  }

  clone(): QueryBuilder {
    const qb = new QueryBuilder();
    qb._select = [...this._select];
    qb._from = this._from;
    qb._joins = [...this._joins];
    qb._where = this._where.map(w => ({ ...w, params: [...w.params] }));
    qb._groupBy = [...this._groupBy];
    qb._having = this._having.map(h => ({ ...h, params: [...h.params] }));
    qb._orderBy = [...this._orderBy];
    qb._limit = this._limit;
    qb._offset = this._offset;
    qb._setOperations = this._setOperations.map(op => ({
      operation: op.operation,
      builder: op.builder.clone(),
    }));
    return qb;
  }

  static select(columns: string[]): QueryBuilder {
    return new QueryBuilder().select(columns);
  }

  static from(table: string): QueryBuilder {
    return new QueryBuilder().from(table);
  }

  static table(table: string): QueryBuilder {
    return new QueryBuilder().select(['*']).from(table);
  }

  // Subquery helper - returns SQL string and merges params
  static subquery(builder: QueryBuilder, alias: string): { sql: string; params: unknown[] } {
    const { sql, params } = builder.build();
    return { sql: `(${sql}) AS ${alias}`, params };
  }
}
