// ============================================================
// Module 4: Repository Base
// ============================================================

export interface FindOptions {
  filter?: FilterOptions;
  sort?: { field: string; direction: 'asc' | 'desc' }[];
  pagination?: { page: number; pageSize: number };
  includeDeleted?: boolean;
  fields?: string[];
}

export interface FilterOptions {
  [key: string]: unknown;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Timestamps {
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export abstract class BaseRepository<T extends Record<string, unknown>> {
  protected tableName: string;
  protected softDelete: boolean;
  protected timestampFields: boolean;
  protected data: Map<string, T> = new Map();

  constructor(tableName: string, options?: { softDelete?: boolean; timestampFields?: boolean }) {
    this.tableName = tableName;
    this.softDelete = options?.softDelete ?? false;
    this.timestampFields = options?.timestampFields ?? true;
  }

  abstract mapToEntity(row: Record<string, unknown>): T;
  abstract mapToRow(entity: Partial<T>): Record<string, unknown>;

  async findById(id: string): Promise<T | undefined> {
    const entity = this.data.get(id);
    if (!entity) return undefined;

    if (this.softDelete && (entity as unknown as Timestamps).deletedAt) {
      return undefined;
    }

    return { ...entity };
  }

  async findAll(options?: FindOptions): Promise<PaginatedResult<T>> {
    let results = Array.from(this.data.values());

    // Filter
    if (options?.filter) {
      results = this.applyFilter(results, options.filter);
    }

    // Exclude soft-deleted
    if (this.softDelete && !options?.includeDeleted) {
      results = results.filter(e => !(e as unknown as Timestamps).deletedAt);
    }

    // Total count before pagination
    const total = results.length;

    // Sort
    if (options?.sort && options.sort.length > 0) {
      results = this.applySort(results, options.sort);
    }

    // Pagination
    let page = 1;
    let pageSize = results.length;
    if (options?.pagination) {
      page = options.pagination.page;
      pageSize = options.pagination.pageSize;
      const start = (page - 1) * pageSize;
      results = results.slice(start, start + pageSize);
    }

    return {
      data: results.map(e => ({ ...e })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async create(entity: Partial<T>): Promise<T> {
    const id = this.generateId();
    const now = new Date().toISOString();
    const row = this.mapToRow(entity);

    const fullEntity: Record<string, unknown> = {
      ...row,
      id,
    };

    if (this.timestampFields) {
      fullEntity.createdAt = now;
      fullEntity.updatedAt = now;
    }

    if (this.softDelete) {
      fullEntity.deletedAt = null;
    }

    const typed = this.mapToEntity(fullEntity) as T;
    this.data.set(id, typed);
    return { ...typed };
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    const existing = this.data.get(id);
    if (!existing) {
      throw new Error(`Entity with id ${id} not found`);
    }

    if (this.softDelete && (existing as unknown as Timestamps).deletedAt) {
      throw new Error(`Entity with id ${id} is soft-deleted`);
    }

    const row = this.mapToRow(data);
    const updated: Record<string, unknown> = {
      ...(existing as Record<string, unknown>),
      ...row,
      id,
    };

    if (this.timestampFields) {
      updated.updatedAt = new Date().toISOString();
    }

    const typed = this.mapToEntity(updated) as T;
    this.data.set(id, typed);
    return { ...typed };
  }

  async delete(id: string): Promise<boolean> {
    const entity = this.data.get(id);
    if (!entity) return false;

    if (this.softDelete) {
      const updated = { ...(entity as Record<string, unknown>), deletedAt: new Date().toISOString() };
      const typed = this.mapToEntity(updated) as T;
      this.data.set(id, typed);
    } else {
      this.data.delete(id);
    }

    return true;
  }

  async count(filter?: FilterOptions): Promise<number> {
    let results = Array.from(this.data.values());

    if (this.softDelete) {
      results = results.filter(e => !(e as unknown as Timestamps).deletedAt);
    }

    if (filter) {
      results = this.applyFilter(results, filter);
    }

    return results.length;
  }

  async exists(id: string): Promise<boolean> {
    const entity = this.data.get(id);
    if (!entity) return false;

    if (this.softDelete && (entity as unknown as Timestamps).deletedAt) {
      return false;
    }

    return true;
  }

  protected generateId(): string {
    // Use crypto.randomUUID() if available for better uniqueness, fallback to timestamp + random
    const timestamp = Date.now();
    const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').substring(0, 12)
      : `${Math.random().toString(36).substring(2, 9)}${Math.random().toString(36).substring(2, 9)}`;
    return `${this.tableName}-${timestamp}-${random}`;
  }

  protected applyFilter(entities: T[], filter: FilterOptions): T[] {
    return entities.filter(entity => {
      const row = entity as Record<string, unknown>;
      for (const [key, value] of Object.entries(filter)) {
        if (row[key] !== value) return false;
      }
      return true;
    });
  }

  protected applySort(entities: T[], sort: { field: string; direction: 'asc' | 'desc' }[]): T[] {
    return [...entities].sort((a, b) => {
      for (const s of sort) {
        const aVal = (a as Record<string, unknown>)[s.field];
        const bVal = (b as Record<string, unknown>)[s.field];
        if (aVal == null && bVal == null) continue;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (aVal < bVal) return s.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return s.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }

  // For testing: directly set data
  _setData(data: Map<string, T>): void {
    this.data = data;
  }

  // For testing: get raw data
  _getData(): Map<string, T> {
    return this.data;
  }
}
