// src/query-builder.ts - 存储查询构建器

import type { IStorage, StorageEntry } from './storage-interface.ts';

/**
 * 查询过滤条件
 */
export interface QueryFilter {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

/**
 * 过滤操作符
 */
export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'between'
  | 'exists'
  | 'regex';

/**
 * 逻辑条件
 */
export interface LogicalCondition {
  type: 'and' | 'or' | 'not';
  filters: Array<QueryFilter | LogicalCondition>;
}

/**
 * 排序配置
 */
export interface SortConfig {
  field: string;
  order: 'asc' | 'desc';
}

/**
 * 查询规范
 */
export interface QuerySpecification {
  filters: Array<QueryFilter | LogicalCondition>;
  sort?: SortConfig;
  skip?: number;
  limit?: number;
  projection?: string[];
  tagFilter?: string[];
}

/**
 * 查询结果
 */
export interface QueryResult<T> {
  items: T[];
  total: number;
  skipped: number;
  limited: boolean;
}

/**
 * 存储查询构建器
 * - 流式查询构造
 * - 丰富的过滤操作符
 * - 逻辑运算符 (and, or, not)
 * - 排序
 * - 分页 (skip/limit)
 * - 投影
 * - 标签/元数据过滤
 */
export class StorageQueryBuilder<T> {
  private filters: Array<QueryFilter | LogicalCondition> = [];
  private sortConfig?: SortConfig;
  private skipCount?: number;
  private limitCount?: number;
  private projectionFields?: string[];
  private tagFilters: string[] = [];

  // ---- 过滤操作符 ----

  eq(field: string, value: unknown): this {
    this.filters.push({ field, operator: 'eq', value });
    return this;
  }

  ne(field: string, value: unknown): this {
    this.filters.push({ field, operator: 'ne', value });
    return this;
  }

  gt(field: string, value: number): this {
    this.filters.push({ field, operator: 'gt', value });
    return this;
  }

  lt(field: string, value: number): this {
    this.filters.push({ field, operator: 'lt', value });
    return this;
  }

  gte(field: string, value: number): this {
    this.filters.push({ field, operator: 'gte', value });
    return this;
  }

  lte(field: string, value: number): this {
    this.filters.push({ field, operator: 'lte', value });
    return this;
  }

  in(field: string, values: unknown[]): this {
    this.filters.push({ field, operator: 'in', value: values });
    return this;
  }

  nin(field: string, values: unknown[]): this {
    this.filters.push({ field, operator: 'nin', value: values });
    return this;
  }

  contains(field: string, value: string): this {
    this.filters.push({ field, operator: 'contains', value });
    return this;
  }

  startsWith(field: string, value: string): this {
    this.filters.push({ field, operator: 'startsWith', value });
    return this;
  }

  endsWith(field: string, value: string): this {
    this.filters.push({ field, operator: 'endsWith', value });
    return this;
  }

  between(field: string, min: number, max: number): this {
    this.filters.push({ field, operator: 'between', value: [min, max] });
    return this;
  }

  exists(field: string): this {
    this.filters.push({ field, operator: 'exists', value: true });
    return this;
  }

  regex(field: string, pattern: string): this {
    this.filters.push({ field, operator: 'regex', value: pattern });
    return this;
  }

  // ---- 逻辑运算符 ----

  and(...filters: Array<QueryFilter | LogicalCondition>): this {
    this.filters.push({ type: 'and', filters });
    return this;
  }

  or(...filters: Array<QueryFilter | LogicalCondition>): this {
    this.filters.push({ type: 'or', filters });
    return this;
  }

  not(...filters: Array<QueryFilter | LogicalCondition>): this {
    this.filters.push({ type: 'not', filters });
    return this;
  }

  // ---- 排序 ----

  orderBy(field: string, order: string = 'asc'): this {
    // 验证排序方向，防止注入
    const normalizedOrder = order.toLowerCase() === 'desc' ? 'desc' : 'asc';
    this.sortConfig = { field, order: normalizedOrder };
    return this;
  }

  // ---- 分页 ----

  skip(count: number): this {
    this.skipCount = count;
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  // ---- 投影 ----

  select(...fields: string[]): this {
    this.projectionFields = fields;
    return this;
  }

  // ---- 标签过滤 ----

  withTag(...tags: string[]): this {
    this.tagFilters.push(...tags);
    return this;
  }

  // ---- 构建与执行 ----

  /**
   * 构建查询规范
   */
  build(): QuerySpecification {
    return {
      filters: [...this.filters],
      sort: this.sortConfig,
      skip: this.skipCount,
      limit: this.limitCount,
      projection: this.projectionFields,
      tagFilter: this.tagFilters.length > 0 ? [...this.tagFilters] : undefined,
    };
  }

  /**
   * 在存储上执行查询
   */
  async execute(storage: IStorage<T>): Promise<QueryResult<T>> {
    const spec = this.build();
    const allKeys = await storage.keys();
    const allEntries: Array<{ key: string; entry: StorageEntry<T> }> = [];

    for (const key of allKeys) {
      const entry = await storage.getEntry(key);
      if (entry) {
        allEntries.push({ key, entry });
      }
    }

    // 标签过滤
    let filtered = allEntries;
    if (spec.tagFilter) {
      filtered = filtered.filter((item) =>
        spec.tagFilter!.some((tag) => item.entry.tags.includes(tag)),
      );
    }

    // 条件过滤
    filtered = filtered.filter((item) => this.matchesFilters(item.entry, spec.filters));

    // 排序
    if (spec.sort) {
      filtered.sort((a, b) => {
        const aVal = this.getFieldValue(a.entry, spec.sort!.field);
        const bVal = this.getFieldValue(b.entry, spec.sort!.field);
        const cmp = compareValues(aVal, bVal);
        return spec.sort!.order === 'desc' ? -cmp : cmp;
      });
    }

    const total = filtered.length;

    // 分页
    const skipped = spec.skip ?? 0;
    let result = filtered.slice(skipped);
    const limited = spec.limit !== undefined;
    if (spec.limit !== undefined) {
      result = result.slice(0, spec.limit);
    }

    // 投影
    let items = result.map((item) => item.entry.value);
    if (spec.projection) {
      items = items.map((item) => {
        if (typeof item === 'object' && item !== null) {
          const projected: Record<string, unknown> = {};
          for (const field of spec.projection!) {
            projected[field] = (item as Record<string, unknown>)[field];
          }
          return projected as T;
        }
        return item;
      });
    }

    return {
      items,
      total,
      skipped,
      limited,
    };
  }

  private matchesFilters(entry: StorageEntry<T>, filters: Array<QueryFilter | LogicalCondition>): boolean {
    return filters.every((filter) => this.matchesFilter(entry, filter));
  }

  private matchesFilter(entry: StorageEntry<T>, filter: QueryFilter | LogicalCondition): boolean {
    if ('type' in filter) {
      // 逻辑条件
      switch (filter.type) {
        case 'and':
          return filter.filters.every((f) => this.matchesFilter(entry, f));
        case 'or':
          return filter.filters.some((f) => this.matchesFilter(entry, f));
        case 'not':
          return !filter.filters.some((f) => this.matchesFilter(entry, f));
        default:
          return true;
      }
    }

    // 查询过滤
    const fieldValue = this.getFieldValue(entry, filter.field);
    return this.evaluateFilter(fieldValue, filter);
  }

  private getFieldValue(entry: StorageEntry<T>, field: string): unknown {
    // 支持嵌套字段路径，如 "metadata.name"
    const parts = field.split('.');
    let current: unknown = entry;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private evaluateFilter(fieldValue: unknown, filter: QueryFilter): boolean {
    const { operator, value } = filter;

    switch (operator) {
      case 'eq':
        return fieldValue === value;
      case 'ne':
        return fieldValue !== value;
      case 'gt':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue > value;
      case 'lt':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue < value;
      case 'gte':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue >= value;
      case 'lte':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue <= value;
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue);
      case 'nin':
        return Array.isArray(value) && !value.includes(fieldValue);
      case 'contains':
        return typeof fieldValue === 'string' && typeof value === 'string' && fieldValue.includes(value);
      case 'startsWith':
        return typeof fieldValue === 'string' && typeof value === 'string' && fieldValue.startsWith(value);
      case 'endsWith':
        return typeof fieldValue === 'string' && typeof value === 'string' && fieldValue.endsWith(value);
      case 'between': {
        const [min, max] = value as [number, number];
        return typeof fieldValue === 'number' && fieldValue >= min && fieldValue <= max;
      }
      case 'exists':
        return value ? fieldValue !== undefined && fieldValue !== null : fieldValue === undefined || fieldValue === null;
      case 'regex': {
        const regex = new RegExp(value as string);
        return typeof fieldValue === 'string' && regex.test(fieldValue);
      }
      default:
        return true;
    }
  }
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return String(a).localeCompare(String(b));
}
