// transform-engine.ts - 数据转换引擎

export interface TransformStep {
  type: string;
  path?: string;        // JSONPath or field name
  value?: unknown;      // value for set/default
  expression?: string;  // expression for filter/map
  as?: string;          // rename target
  fields?: string[];    // for pick/omit
  separator?: string;   // for join
  size?: number;        // for chunk
  order?: 'asc' | 'desc'; // for sort
  by?: string;          // sort/groupBy key
  template?: string;    // for template interpolation
  targetType?: string;  // for type coercion
  format?: string;      // for date formatting
}

export class TransformEngine {
  /**
   * Transform data through a pipeline of transform steps.
   */
  async transform(data: unknown, transforms: TransformStep[], dryRun = false): Promise<unknown> {
    let current = JSON.parse(JSON.stringify(data)); // deep clone

    for (const step of transforms) {
      if (dryRun) continue;
      current = await this.applyTransform(current, step);
    }

    return current;
  }

  /**
   * Apply a single transform step.
   */
  async applyTransform(data: unknown, step: TransformStep): Promise<unknown> {
    switch (step.type) {
      case 'map':
        return this.transformMap(data, step);
      case 'filter':
        return this.transformFilter(data, step);
      case 'reduce':
        return this.transformReduce(data, step);
      case 'sort':
        return this.transformSort(data, step);
      case 'groupBy':
        return this.transformGroupBy(data, step);
      case 'flatten':
        return this.transformFlatten(data);
      case 'pick':
        return this.transformPick(data, step);
      case 'omit':
        return this.transformOmit(data, step);
      case 'merge':
        return this.transformMerge(data, step);
      case 'rename':
        return this.transformRename(data, step);
      case 'default':
        return this.transformDefault(data, step);
      case 'set':
        return this.transformSet(data, step);
      case 'get':
        return this.transformGet(data, step);
      case 'chunk':
        return this.transformChunk(data, step);
      case 'zip':
        return this.transformZip(data, step);
      case 'uniq':
        return this.transformUniq(data);
      case 'intersection':
        return this.transformIntersection(data, step);
      case 'difference':
        return this.transformDifference(data, step);
      case 'join':
        return this.transformJoin(data, step);
      case 'coerce':
        return this.transformCoerce(data, step);
      case 'template':
        return this.transformTemplate(data, step);
      default:
        throw new Error(`Unknown transform type: ${step.type}`);
    }
  }

  private transformMap(data: unknown, step: TransformStep): unknown {
    if (!Array.isArray(data)) throw new Error('map transform requires array input');
    if (!step.expression) return data;
    return data.map(item => this.evaluateSimpleExpression(item, step.expression!));
  }

  private transformFilter(data: unknown, step: TransformStep): unknown {
    if (!Array.isArray(data)) throw new Error('filter transform requires array input');
    if (!step.expression) return data;
    return data.filter(item => !!this.evaluateSimpleExpression(item, step.expression!));
  }

  private transformReduce(data: unknown, step: TransformStep): unknown {
    if (!Array.isArray(data)) throw new Error('reduce transform requires array input');
    const initial = step.value ?? {};
    return data.reduce((acc, item) => {
      if (step.expression) {
        return this.evaluateReduceExpression(acc, item, step.expression!);
      }
      return acc;
    }, JSON.parse(JSON.stringify(initial)));
  }

  private transformSort(data: unknown, step: TransformStep): unknown {
    if (!Array.isArray(data)) throw new Error('sort transform requires array input');
    const key = step.by;
    const order = step.order ?? 'asc';
    return [...data].sort((a, b) => {
      let va: unknown, vb: unknown;
      if (key) {
        va = (a as Record<string, unknown>)?.[key];
        vb = (b as Record<string, unknown>)?.[key];
      } else {
        va = a; vb = b;
      }
      if (va == null && vb == null) return 0;
      if (va == null) return order === 'asc' ? -1 : 1;
      if (vb == null) return order === 'asc' ? 1 : -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return order === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va), sb = String(vb);
      return order === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }

  private transformGroupBy(data: unknown, step: TransformStep): unknown {
    if (!Array.isArray(data)) throw new Error('groupBy transform requires array input');
    const key = step.by;
    if (!key) throw new Error('groupBy requires "by" field');
    const result: Record<string, unknown[]> = {};
    for (const item of data) {
      const groupKey = String((item as Record<string, unknown>)?.[key] ?? 'undefined');
      if (!result[groupKey]) result[groupKey] = [];
      result[groupKey].push(item);
    }
    return result;
  }

  private transformFlatten(data: unknown): unknown {
    if (!Array.isArray(data)) return data;
    return data.flat(Infinity);
  }

  private transformPick(data: unknown, step: TransformStep): unknown {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('pick transform requires object input');
    }
    const fields = step.fields ?? [];
    const result: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in (data as Record<string, unknown>)) {
        result[field] = (data as Record<string, unknown>)[field];
      }
    }
    return result;
  }

  private transformOmit(data: unknown, step: TransformStep): unknown {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('omit transform requires object input');
    }
    const fields = new Set(step.fields ?? []);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (!fields.has(key)) {
        result[key] = value;
      }
    }
    return result;
  }

  private transformMerge(data: unknown, step: TransformStep): unknown {
    const base = typeof data === 'object' && data !== null ? { ...data as Record<string, unknown> } : {};
    const mergeWith = step.value;
    if (typeof mergeWith === 'object' && mergeWith !== null) {
      return { ...base, ...mergeWith as Record<string, unknown> };
    }
    return base;
  }

  private transformRename(data: unknown, step: TransformStep): unknown {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('rename transform requires object input');
    }
    const result = { ...data as Record<string, unknown> };
    if (step.path && step.as) {
      if (step.path in result) {
        result[step.as] = result[step.path];
        delete result[step.path];
      }
    }
    return result;
  }

  private transformDefault(data: unknown, step: TransformStep): unknown {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return data;
    }
    const result = { ...data as Record<string, unknown> };
    if (step.path && (result[step.path] === undefined || result[step.path] === null)) {
      result[step.path] = step.value;
    }
    return result;
  }

  private transformSet(data: unknown, step: TransformStep): unknown {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('set transform requires object input');
    }
    const result = { ...data as Record<string, unknown> };
    if (step.path !== undefined) {
      result[step.path] = step.value;
    }
    return result;
  }

  private transformGet(data: unknown, step: TransformStep): unknown {
    if (typeof data !== 'object' || data === null) return undefined;
    if (!step.path) return data;
    const parts = step.path.split('.');
    let current: unknown = data;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private transformChunk(data: unknown, step: TransformStep): unknown {
    if (!Array.isArray(data)) throw new Error('chunk transform requires array input');
    const size = step.size ?? 1;
    const result: unknown[][] = [];
    for (let i = 0; i < data.length; i += size) {
      result.push(data.slice(i, i + size));
    }
    return result;
  }

  private transformZip(data: unknown, step: TransformStep): unknown {
    if (!Array.isArray(data)) throw new Error('zip transform requires array input');
    const other = step.value;
    if (!Array.isArray(other)) throw new Error('zip requires array value');
    const result: [unknown, unknown][] = [];
    const len = Math.min(data.length, other.length);
    for (let i = 0; i < len; i++) {
      result.push([data[i], other[i]]);
    }
    return result;
  }

  private transformUniq(data: unknown): unknown {
    if (!Array.isArray(data)) return data;
    return [...new Set(data.map(item => JSON.stringify(item)))].map(item => JSON.parse(item));
  }

  private transformIntersection(data: unknown, step: TransformStep): unknown {
    if (!Array.isArray(data)) return data;
    const other = new Set((step.value as unknown[] ?? []).map(i => JSON.stringify(i)));
    return data.filter(item => other.has(JSON.stringify(item)));
  }

  private transformDifference(data: unknown, step: TransformStep): unknown {
    if (!Array.isArray(data)) return data;
    const other = new Set((step.value as unknown[] ?? []).map(i => JSON.stringify(i)));
    return data.filter(item => !other.has(JSON.stringify(item)));
  }

  private transformJoin(data: unknown, step: TransformStep): unknown {
    if (!Array.isArray(data)) return String(data);
    return data.map(String).join(step.separator ?? ',');
  }

  private transformCoerce(data: unknown, step: TransformStep): unknown {
    const targetType = step.targetType ?? 'string';
    switch (targetType) {
      case 'string': return String(data ?? '');
      case 'number': {
        const n = Number(data);
        return isNaN(n) ? 0 : n;
      }
      case 'boolean': return Boolean(data);
      case 'date': return new Date(data as string | number);
      default: return data;
    }
  }

  private transformTemplate(data: unknown, step: TransformStep): unknown {
    if (!step.template) return data;
    let result = step.template;
    // Replace {{variable}} patterns
    const context = typeof data === 'object' && data !== null ? data as Record<string, unknown> : { value: data };
    result = result.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
      const parts = path.trim().split('.');
      let current: unknown = context;
      for (const part of parts) {
        if (current == null || typeof current !== 'object') return '';
        current = (current as Record<string, unknown>)[part];
      }
      return current != null ? String(current) : '';
    });
    return result;
  }

  private evaluateSimpleExpression(item: unknown, expression: string): unknown {
    // Simple expression evaluation: supports field access and basic comparisons
    const context = typeof item === 'object' && item !== null ? item as Record<string, unknown> : { value: item };
    const parts = expression.split(' ');

    // Simple field access
    if (parts.length === 1) {
      const field = parts[0].trim();
      if (field.includes('.')) {
        const pathParts = field.split('.');
        let current: unknown = context;
        for (const p of pathParts) {
          if (current == null || typeof current !== 'object') return undefined;
          current = (current as Record<string, unknown>)[p];
        }
        return current;
      }
      return context[field];
    }

    // Simple comparison: field op value
    if (parts.length === 3) {
      const [field, op, value] = parts;
      const left = context[field];
      let right: unknown = value;
      if (value === 'true') right = true;
      else if (value === 'false') right = false;
      else if (!isNaN(Number(value)) && value !== '') right = Number(value);
      else right = value.replace(/^['"]|['"]$/g, '');

      switch (op) {
        case '==': return left == right;
        case '!=': return left != right;
        case '>': return left > right;
        case '<': return left < right;
        case '>=': return left >= right;
        case '<=': return left <= right;
        default: return context[field];
      }
    }

    return context;
  }

  private evaluateReduceExpression(acc: unknown, item: unknown, expression: string): unknown {
    const context = typeof item === 'object' && item !== null ? item as Record<string, unknown> : { value: item };
    const field = expression.trim();
    if (field in context) {
      if (typeof acc === 'object' && acc !== null && !Array.isArray(acc)) {
        return { ...(acc as Record<string, unknown>), [field]: context[field] };
      }
    }
    return acc;
  }
}
