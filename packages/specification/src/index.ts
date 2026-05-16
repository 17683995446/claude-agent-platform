// ============================================================================
// @claude-agent/specification - Specification Pattern
// ============================================================================

// ---- Specification Interface ----
export interface ISpecification<T> {
  isSatisfiedBy(candidate: T): boolean;
  and(other: ISpecification<T>): ISpecification<T>;
  or(other: ISpecification<T>): ISpecification<T>;
  not(): ISpecification<T>;
}

// ---- Base Specification ----
export abstract class BaseSpecification<T> implements ISpecification<T> {
  abstract isSatisfiedBy(candidate: T): boolean;

  and(other: ISpecification<T>): ISpecification<T> {
    return new AndSpecification(this, other);
  }

  or(other: ISpecification<T>): ISpecification<T> {
    return new OrSpecification(this, other);
  }

  not(): ISpecification<T> {
    return new NotSpecification(this);
  }
}

// ---- Composite Specifications ----
class AndSpecification<T> extends BaseSpecification<T> {
  constructor(private left: ISpecification<T>, private right: ISpecification<T>) {
    super();
  }
  isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) && this.right.isSatisfiedBy(candidate);
  }
}

class OrSpecification<T> extends BaseSpecification<T> {
  constructor(private left: ISpecification<T>, private right: ISpecification<T>) {
    super();
  }
  isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) || this.right.isSatisfiedBy(candidate);
  }
}

class NotSpecification<T> extends BaseSpecification<T> {
  constructor(private inner: ISpecification<T>) {
    super();
  }
  isSatisfiedBy(candidate: T): boolean {
    return !this.inner.isSatisfiedBy(candidate);
  }
}

// ---- Property Specification ----
export class PropertySpecification<T, TValue> extends BaseSpecification<T> {
  constructor(
    private getProperty: (item: T) => TValue,
    private predicate: (value: TValue) => boolean,
  ) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return this.predicate(this.getProperty(candidate));
  }
}

// ---- Built-in Specifications ----
export function eq<T, K extends keyof T>(key: K, value: T[K]): ISpecification<T> {
  return new PropertySpecification<T, T[K]>(item => item[key], v => v === value);
}

export function ne<T, K extends keyof T>(key: K, value: T[K]): ISpecification<T> {
  return new PropertySpecification<T, T[K]>(item => item[key], v => v !== value);
}

export function gt<T, K extends keyof T>(key: K, value: T[K] & number): ISpecification<T> {
  return new PropertySpecification<T, T[K] & number>(item => item[key] as T[K] & number, v => v > value);
}

export function gte<T, K extends keyof T>(key: K, value: T[K] & number): ISpecification<T> {
  return new PropertySpecification<T, T[K] & number>(item => item[key] as T[K] & number, v => v >= value);
}

export function lt<T, K extends keyof T>(key: K, value: T[K] & number): ISpecification<T> {
  return new PropertySpecification<T, T[K] & number>(item => item[key] as T[K] & number, v => v < value);
}

export function lte<T, K extends keyof T>(key: K, value: T[K] & number): ISpecification<T> {
  return new PropertySpecification<T, T[K] & number>(item => item[key] as T[K] & number, v => v <= value);
}

export function contains<T, K extends keyof T>(key: K, value: string): ISpecification<T> {
  return new PropertySpecification<T, any>(item => item[key], v => typeof v === 'string' && v.includes(value));
}

export function inArray<T, K extends keyof T>(key: K, values: T[K][]): ISpecification<T> {
  return new PropertySpecification<T, T[K]>(item => item[key], v => values.includes(v));
}

export function between<T, K extends keyof T>(key: K, min: number, max: number): ISpecification<T> {
  return new PropertySpecification<T, any>(item => item[key], v => typeof v === 'number' && v >= min && v <= max);
}

export function regex<T, K extends keyof T>(key: K, pattern: RegExp): ISpecification<T> {
  return new PropertySpecification<T, any>(item => item[key], v => typeof v === 'string' && pattern.test(v));
}

export function always<T>(): ISpecification<T> {
  return new (class AlwaysSpec extends BaseSpecification<T> {
    isSatisfiedBy() { return true; }
  })();
}

export function never<T>(): ISpecification<T> {
  return new (class NeverSpec extends BaseSpecification<T> {
    isSatisfiedBy() { return false; }
  })();
}

// ---- Query Builder ----
export class QueryBuilder<T> {
  private specification: ISpecification<T> = always<T>();
  private sortKey?: keyof T;
  private sortDir: 'asc' | 'desc' = 'asc';
  private skipCount: number = 0;
  private limitCount?: number;

  where(spec: ISpecification<T>): QueryBuilder<T> {
    this.specification = this.specification.and(spec);
    return this;
  }

  orderBy(key: keyof T, direction: 'asc' | 'desc' = 'asc'): QueryBuilder<T> {
    this.sortKey = key;
    this.sortDir = direction;
    return this;
  }

  skip(count: number): QueryBuilder<T> {
    this.skipCount = count;
    return this;
  }

  limit(count: number): QueryBuilder<T> {
    this.limitCount = count;
    return this;
  }

  build(): { filter: (item: T) => boolean; sort?: (a: T, b: T) => number; skip: number; limit?: number } {
    const filter = (item: T) => this.specification.isSatisfiedBy(item);
    let sort: ((a: T, b: T) => number) | undefined;
    if (this.sortKey !== undefined) {
      const key = this.sortKey;
      const dir = this.sortDir;
      sort = (a, b) => {
        const av = a[key], bv = b[key];
        if (av === bv) return 0;
        if (av < bv) return dir === 'asc' ? -1 : 1;
        return dir === 'asc' ? 1 : -1;
      };
    }
    return { filter, sort, skip: this.skipCount, limit: this.limitCount };
  }

  execute(items: T[]): T[] {
    const { filter, sort, skip, limit } = this.build();
    let result = items.filter(filter);
    if (sort) result.sort(sort);
    if (skip > 0) result = result.slice(skip);
    if (limit !== undefined) result = result.slice(0, limit);
    return result;
  }
}
