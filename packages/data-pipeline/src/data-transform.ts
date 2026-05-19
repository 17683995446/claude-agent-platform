// src/data-transform.ts - Data Transform Engine
// 30+ built-in transforms for data manipulation

export type TransformFn = (data: unknown) => unknown;

export interface TransformSpec {
  [field: string]: string | TransformSpec | TransformFn;
}

export class DataTransformEngine {
  private transforms: Map<string, TransformFn> = new Map();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    // Basic transforms
    this.transforms.set('identity', (d: unknown) => d);
    this.transforms.set('constant', (d: unknown) => {
      const val = (d as any)?.value ?? d;
      return val;
    });
    this.transforms.set('default', (d: unknown) => {
      const { value, fallback } = d as any;
      return value ?? fallback;
    });
    this.transforms.set('coalesce', (d: unknown) => {
      const values = (d as any).values as unknown[];
      return values.find(v => v != null) ?? null;
    });

    // Type transforms
    this.transforms.set('toString', (d: unknown) => String(d));
    this.transforms.set('toNumber', (d: unknown) => {
      const n = Number(d);
      return isNaN(n) ? 0 : n;
    });
    this.transforms.set('toBoolean', (d: unknown) => Boolean(d));
    this.transforms.set('toDate', (d: unknown) => {
      if (d instanceof Date) return d;
      return new Date(d as string | number);
    });
    this.transforms.set('toJSON', (d: unknown) => JSON.stringify(d));
    this.transforms.set('parse', (d: unknown) => {
      if (typeof d === 'string') {
        try { return JSON.parse(d); } catch { return d; }
      }
      return d;
    });

    // String transforms
    this.transforms.set('trim', (d: unknown) => typeof d === 'string' ? d.trim() : d);
    this.transforms.set('uppercase', (d: unknown) => typeof d === 'string' ? d.toUpperCase() : d);
    this.transforms.set('lowercase', (d: unknown) => typeof d === 'string' ? d.toLowerCase() : d);
    this.transforms.set('capitalize', (d: unknown) => {
      if (typeof d !== 'string') return d;
      return d.charAt(0).toUpperCase() + d.slice(1);
    });
    this.transforms.set('snakeCase', (d: unknown) => {
      if (typeof d !== 'string') return d;
      return d.replace(/([A-Z])/g, '_$1').replace(/[\s-]+/g, '_').replace(/^_/, '').toLowerCase();
    });
    this.transforms.set('camelCase', (d: unknown) => {
      if (typeof d !== 'string') return d;
      return d.replace(/[-_\s]+(.)?/g, (_, c: string) => c ? c.toUpperCase() : '');
    });
    this.transforms.set('kebabCase', (d: unknown) => {
      if (typeof d !== 'string') return d;
      return d.replace(/([A-Z])/g, '-$1').replace(/[\s_]+/g, '-').replace(/^-/, '').toLowerCase();
    });
    this.transforms.set('replace', (d: unknown) => {
      const { pattern, replacement } = d as any;
      return typeof d === 'object' ? String((d as any).input).replace(new RegExp(pattern, 'g'), replacement) : d;
    });
    this.transforms.set('split', (d: unknown) => {
      const { input, delimiter } = d as any;
      return typeof input === 'string' ? input.split(delimiter) : input;
    });
    this.transforms.set('join', (d: unknown) => {
      const { items, separator } = d as any;
      return Array.isArray(items) ? items.join(separator ?? ',') : items;
    });
    this.transforms.set('template', (d: unknown) => {
      const { template: tpl, data } = d as any;
      if (typeof tpl !== 'string') return tpl;
      return tpl.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => data?.[key] ?? '');
    });

    // Array transforms
    this.transforms.set('map', (d: unknown) => {
      const { items, fn } = d as any;
      return Array.isArray(items) ? items.map(fn) : items;
    });
    this.transforms.set('filter', (d: unknown) => {
      const { items, predicate } = d as any;
      return Array.isArray(items) ? items.filter(predicate) : items;
    });
    this.transforms.set('reduce', (d: unknown) => {
      const { items, fn, initial } = d as any;
      return Array.isArray(items) ? items.reduce(fn, initial) : items;
    });
    this.transforms.set('sort', (d: unknown) => {
      const { items, compareFn } = d as any;
      return Array.isArray(items) ? [...items].sort(compareFn) : items;
    });
    this.transforms.set('reverse', (d: unknown) => {
      return Array.isArray(d) ? [...d].reverse() : d;
    });
    this.transforms.set('flat', (d: unknown) => {
      return Array.isArray(d) ? d.flat() : d;
    });
    this.transforms.set('unique', (d: unknown) => {
      return Array.isArray(d) ? [...new Set(d)] : d;
    });
    this.transforms.set('chunk', (d: unknown) => {
      const { items, size } = d as any;
      if (!Array.isArray(items)) return items;
      const chunks: unknown[][] = [];
      for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
      }
      return chunks;
    });
    this.transforms.set('sample', (d: unknown) => {
      const { items, size } = d as any;
      if (!Array.isArray(items)) return items;
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, size ?? 1);
    });
    this.transforms.set('shuffle', (d: unknown) => {
      return Array.isArray(d) ? [...d].sort(() => Math.random() - 0.5) : d;
    });

    // Object transforms
    this.transforms.set('pick', (d: unknown) => {
      const { obj, keys } = d as any;
      if (typeof obj !== 'object' || obj === null) return obj;
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        if (key in obj) result[key] = obj[key];
      }
      return result;
    });
    this.transforms.set('omit', (d: unknown) => {
      const { obj, keys } = d as any;
      if (typeof obj !== 'object' || obj === null) return obj;
      const result = { ...obj };
      for (const key of keys) {
        delete result[key];
      }
      return result;
    });
    this.transforms.set('merge', (d: unknown) => {
      const { target, source } = d as any;
      return { ...target, ...source };
    });
    this.transforms.set('rename', (d: unknown) => {
      const { obj, mapping } = d as any;
      if (typeof obj !== 'object' || obj === null) return obj;
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        const newKey = mapping[key] ?? key;
        result[newKey] = value;
      }
      return result;
    });
    this.transforms.set('flatten', (d: unknown) => {
      const flattenObj = (obj: any, prefix = ''): Record<string, unknown> => {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
          const newKey = prefix ? `${prefix}.${key}` : key;
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            Object.assign(result, flattenObj(value, newKey));
          } else {
            result[newKey] = value;
          }
        }
        return result;
      };
      return typeof d === 'object' && d !== null ? flattenObj(d) : d;
    });
    this.transforms.set('deepGet', (d: unknown) => {
      const { obj, path } = d as any;
      return path.split('.').reduce((acc: any, key: string) => acc?.[key], obj);
    });
    this.transforms.set('deepSet', (d: unknown) => {
      const { obj, path, value } = d as any;
      const keys = path.split('.');
      const result = { ...obj };
      let current: any = result;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!(keys[i] in current)) current[keys[i]] = {};
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return result;
    });
    this.transforms.set('groupBy', (d: unknown) => {
      const { items, key } = d as any;
      if (!Array.isArray(items)) return items;
      const result: Record<string, unknown[]> = {};
      for (const item of items) {
        const groupKey = typeof key === 'function' ? key(item) : item[key];
        if (!result[groupKey]) result[groupKey] = [];
        result[groupKey].push(item);
      }
      return result;
    });

    // Math transforms
    this.transforms.set('add', (d: unknown) => {
      const { a, b } = d as any;
      return (Number(a) || 0) + (Number(b) || 0);
    });
    this.transforms.set('subtract', (d: unknown) => {
      const { a, b } = d as any;
      return (Number(a) || 0) - (Number(b) || 0);
    });
    this.transforms.set('multiply', (d: unknown) => {
      const { a, b } = d as any;
      return (Number(a) || 0) * (Number(b) || 0);
    });
    this.transforms.set('divide', (d: unknown) => {
      const { a, b } = d as any;
      const divisor = Number(b) || 0;
      return divisor === 0 ? 0 : (Number(a) || 0) / divisor;
    });
    this.transforms.set('round', (d: unknown) => Math.round(Number(d) || 0));
    this.transforms.set('floor', (d: unknown) => Math.floor(Number(d) || 0));
    this.transforms.set('ceil', (d: unknown) => Math.ceil(Number(d) || 0));
    this.transforms.set('abs', (d: unknown) => Math.abs(Number(d) || 0));
    this.transforms.set('min', (d: unknown) => {
      const values = Array.isArray(d) ? d.map(Number) : [Number(d)];
      return Math.min(...values.filter(n => !isNaN(n)));
    });
    this.transforms.set('max', (d: unknown) => {
      const values = Array.isArray(d) ? d.map(Number) : [Number(d)];
      return Math.max(...values.filter(n => !isNaN(n)));
    });
    this.transforms.set('sum', (d: unknown) => {
      const values = Array.isArray(d) ? d.map(Number) : [Number(d)];
      return values.reduce((a, b) => a + (isNaN(b) ? 0 : b), 0);
    });
    this.transforms.set('average', (d: unknown) => {
      const values = (Array.isArray(d) ? d : [d]).map(Number).filter(n => !isNaN(n));
      return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
    });
  }

  /**
   * Execute a named transform
   */
  getTransform(name: string): TransformFn | undefined {
    return this.transforms.get(name);
  }

  /**
   * Register a custom transform
   */
  registerTransform(name: string, fn: TransformFn): void {
    this.transforms.set(name, fn);
  }

  /**
   * Transform data using a transform specification
   */
  transform(data: unknown, transformSpec: TransformSpec): unknown {
    if (typeof data !== 'object' || data === null) return data;

    const result = { ...(data as Record<string, unknown>) };

    for (const [field, spec] of Object.entries(transformSpec)) {
      if (typeof spec === 'string') {
        const fn = this.transforms.get(spec);
        if (fn) {
          result[field] = fn(result[field]);
        }
      } else if (typeof spec === 'function') {
        result[field] = spec(result[field]);
      } else if (typeof spec === 'object' && spec !== null) {
        result[field] = this.transform(result[field], spec as TransformSpec);
      }
    }

    return result;
  }

  /**
   * Compose multiple transforms into a single function
   */
  compose(...transforms: TransformFn[]): TransformFn {
    return (data: unknown): unknown => {
      return transforms.reduce((acc, fn) => fn(acc), data);
    };
  }
}
