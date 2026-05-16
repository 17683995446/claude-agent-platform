// ============================================================================
// @claude-agent/repository - Repository Pattern
// ============================================================================

import type { LoggerInterface } from '@claude-agent/types';
import { Logger } from '@claude-agent/logger';

// ---- Query Options ----
export interface QueryOptions {
  filter?: (entity: any) => boolean;
  sort?: (a: any, b: any) => number;
  skip?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  readonly data: T[];
  readonly total: number;
  readonly skip: number;
  readonly limit: number;
}

// ---- Repository Interface ----
export interface IRepository<T, TId = string> {
  findById(id: TId): Promise<T | null>;
  findAll(options?: QueryOptions): Promise<PaginatedResult<T>>;
  find(options: QueryOptions): Promise<T[]>;
  findOne(predicate: (entity: T) => boolean): Promise<T | null>;
  exists(id: TId): Promise<boolean>;
  count(predicate?: (entity: T) => boolean): Promise<number>;
  save(entity: T): Promise<T>;
  update(id: TId, updates: Partial<T>): Promise<T | null>;
  delete(id: TId): Promise<boolean>;
}

// ---- In-Memory Repository ----
export class InMemoryRepository<T extends { id: string }, TId = string> implements IRepository<T, TId> {
  private store: Map<string, T> = new Map();
  private logger: LoggerInterface;

  constructor(logger?: LoggerInterface) {
    this.logger = logger ?? new Logger();
  }

  async findById(id: TId): Promise<T | null> {
    return this.store.get(id as string) ?? null;
  }

  async findAll(options?: QueryOptions): Promise<PaginatedResult<T>> {
    let entities = Array.from(this.store.values());
    const total = entities.length;

    if (options?.filter) entities = entities.filter(options.filter);
    if (options?.sort) entities.sort(options.sort);
    if (options?.skip) entities = entities.slice(options.skip);
    if (options?.limit) entities = entities.slice(0, options.limit);

    return {
      data: entities,
      total,
      skip: options?.skip ?? 0,
      limit: options?.limit ?? total,
    };
  }

  async find(options: QueryOptions): Promise<T[]> {
    let entities = Array.from(this.store.values());
    if (options.filter) entities = entities.filter(options.filter);
    if (options.sort) entities.sort(options.sort);
    if (options.skip) entities = entities.slice(options.skip);
    if (options.limit) entities = entities.slice(0, options.limit);
    return entities;
  }

  async findOne(predicate: (entity: T) => boolean): Promise<T | null> {
    for (const entity of this.store.values()) {
      if (predicate(entity)) return entity;
    }
    return null;
  }

  async exists(id: TId): Promise<boolean> {
    return this.store.has(id as string);
  }

  async count(predicate?: (entity: T) => boolean): Promise<number> {
    if (!predicate) return this.store.size;
    let count = 0;
    for (const entity of this.store.values()) {
      if (predicate(entity)) count++;
    }
    return count;
  }

  async save(entity: T): Promise<T> {
    this.store.set(entity.id, entity);
    this.logger.debug(`Saved entity: ${entity.id}`);
    return entity;
  }

  async update(id: TId, updates: Partial<T>): Promise<T | null> {
    const existing = this.store.get(id as string);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id } as T;
    this.store.set(id as string, updated);
    this.logger.debug(`Updated entity: ${id}`);
    return updated;
  }

  async delete(id: TId): Promise<boolean> {
    const deleted = this.store.delete(id as string);
    if (deleted) this.logger.debug(`Deleted entity: ${id}`);
    return deleted;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// ---- Cached Repository Decorator ----
export class CachedRepository<T extends { id: string }, TId = string> implements IRepository<T, TId> {
  private inner: IRepository<T, TId>;
  private cache: Map<string, { data: T; expiry: number }> = new Map();
  private ttl: number;

  constructor(inner: IRepository<T, TId>, ttl: number = 60000) {
    this.inner = inner;
    this.ttl = ttl;
  }

  private getCached(id: string): T | null {
    const entry = this.cache.get(id);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(id);
      return null;
    }
    return entry.data;
  }

  private setCache(id: string, data: T): void {
    this.cache.set(id, { data, expiry: Date.now() + this.ttl });
  }

  invalidate(id: TId): void {
    this.cache.delete(id as string);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  async findById(id: TId): Promise<T | null> {
    const cached = this.getCached(id as string);
    if (cached) return cached;
    const result = await this.inner.findById(id);
    if (result) this.setCache(id as string, result);
    return result;
  }

  async findAll(options?: QueryOptions): Promise<PaginatedResult<T>> {
    return this.inner.findAll(options);
  }

  async find(options: QueryOptions): Promise<T[]> {
    return this.inner.find(options);
  }

  async findOne(predicate: (entity: T) => boolean): Promise<T | null> {
    return this.inner.findOne(predicate);
  }

  async exists(id: TId): Promise<boolean> {
    return this.inner.exists(id);
  }

  async count(predicate?: (entity: T) => boolean): Promise<number> {
    return this.inner.count(predicate);
  }

  async save(entity: T): Promise<T> {
    const result = await this.inner.save(entity);
    this.setCache(entity.id, result);
    return result;
  }

  async update(id: TId, updates: Partial<T>): Promise<T | null> {
    this.invalidate(id);
    return this.inner.update(id, updates);
  }

  async delete(id: TId): Promise<boolean> {
    this.invalidate(id);
    return this.inner.delete(id);
  }
}

// ---- Logging Repository Decorator ----
export class LoggingRepository<T extends { id: string }, TId = string> implements IRepository<T, TId> {
  private inner: IRepository<T, TId>;
  private logger: LoggerInterface;

  constructor(inner: IRepository<T, TId>, logger?: LoggerInterface) {
    this.inner = inner;
    this.logger = logger ?? new Logger();
  }

  async findById(id: TId): Promise<T | null> {
    this.logger.debug(`Repository.findById(${id})`);
    return this.inner.findById(id);
  }

  async findAll(options?: QueryOptions): Promise<PaginatedResult<T>> {
    this.logger.debug('Repository.findAll()');
    return this.inner.findAll(options);
  }

  async find(options: QueryOptions): Promise<T[]> {
    this.logger.debug('Repository.find()');
    return this.inner.find(options);
  }

  async findOne(predicate: (entity: T) => boolean): Promise<T | null> {
    this.logger.debug('Repository.findOne()');
    return this.inner.findOne(predicate);
  }

  async exists(id: TId): Promise<boolean> {
    this.logger.debug(`Repository.exists(${id})`);
    return this.inner.exists(id);
  }

  async count(predicate?: (entity: T) => boolean): Promise<number> {
    this.logger.debug('Repository.count()');
    return this.inner.count(predicate);
  }

  async save(entity: T): Promise<T> {
    this.logger.info(`Repository.save(${entity.id})`);
    return this.inner.save(entity);
  }

  async update(id: TId, updates: Partial<T>): Promise<T | null> {
    this.logger.info(`Repository.update(${id})`);
    return this.inner.update(id, updates);
  }

  async delete(id: TId): Promise<boolean> {
    this.logger.info(`Repository.delete(${id})`);
    return this.inner.delete(id);
  }
}
