/**
 * Type Resolver Module
 * Resolves TypeScript types to human-readable format.
 */

export interface TypeContext {
  imports?: Array<{ source: string; specifiers: string[] }>;
  typeParameters?: string[];
  aliases?: Map<string, string>;
}

export interface FormatOptions {
  compact?: boolean;
  expandGenerics?: boolean;
  includeModulePath?: boolean;
  maxDepth?: number;
}

export class TypeResolver {
  private defaultOptions: FormatOptions = {
    compact: false,
    expandGenerics: false,
    includeModulePath: false,
    maxDepth: 5,
  };

  /**
   * Resolve a type string to a human-readable format.
   */
  resolveType(typeString: string, context?: TypeContext): string {
    if (!typeString || typeString === 'undefined') return 'any';

    let resolved = typeString.trim();

    // Resolve type aliases
    if (context?.aliases) {
      for (const [alias, target] of context.aliases) {
        if (resolved === alias) {
          resolved = target;
          break;
        }
      }
    }

    // Handle Promise<T>
    if (resolved.startsWith('Promise<') && resolved.endsWith('>')) {
      const inner = resolved.slice(8, -1);
      return `Promise<${this.resolveType(inner, context)}>`;
    }

    // Handle Array<T>
    if (resolved.startsWith('Array<') && resolved.endsWith('>')) {
      const inner = resolved.slice(6, -1);
      return `${this.resolveType(inner, context)}[]`;
    }

    // Handle Record<K, V>
    if (resolved.startsWith('Record<') && resolved.endsWith('>')) {
      const inner = resolved.slice(7, -1);
      const parts = this.splitGenericParams(inner);
      if (parts.length === 2) {
        return `Record<${this.resolveType(parts[0]!, context)}, ${this.resolveType(parts[1]!, context)}>`;
      }
    }

    return resolved;
  }

  /**
   * Resolve generic types with concrete type parameters.
   */
  resolveGenericType(typeString: string, typeParams: Map<string, string>): string {
    let resolved = typeString;

    for (const [param, concrete] of typeParams) {
      const escaped = param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'g');
      resolved = resolved.replace(regex, concrete);
    }

    return resolved;
  }

  /**
   * Resolve union types to readable format.
   */
  resolveUnionType(types: string[]): string {
    if (types.length === 0) return 'never';
    if (types.length === 1) return types[0]!;

    // Check for null/undefined
    const nonNullable = types.filter((t) => t !== 'null' && t !== 'undefined');
    const hasNull = types.includes('null');
    const hasUndefined = types.includes('undefined');

    if (hasNull && hasUndefined && nonNullable.length > 0) {
      return `${nonNullable.join(' | ')} | null | undefined`;
    }
    if (hasNull && nonNullable.length > 0) {
      return `${nonNullable.join(' | ')} | null`;
    }
    if (hasUndefined && nonNullable.length > 0) {
      return `${nonNullable.join(' | ')} | undefined`;
    }

    return types.join(' | ');
  }

  /**
   * Resolve intersection types to readable format.
   */
  resolveIntersectionType(types: string[]): string {
    if (types.length === 0) return 'never';
    if (types.length === 1) return types[0]!;
    return types.join(' & ');
  }

  /**
   * Format a type for display.
   */
  formatType(type: string, options?: FormatOptions): string {
    const opts = { ...this.defaultOptions, ...options };

    let formatted = type;

    if (opts.compact) {
      formatted = formatted
        .replace(/\s+/g, ' ')
        .replace(/\s*>\s*/g, '>')
        .replace(/\s*<\s*/g, '<')
        .replace(/\s*,\s*/g, ', ');
    }

    if (opts.expandGenerics) {
      formatted = this.expandGenerics(formatted, opts.maxDepth ?? 5);
    }

    return formatted;
  }

  /**
   * Simplify complex types.
   */
  simplifyType(type: string): string {
    let simplified = type;
    let prev = '';
    let maxIterations = 10;

    while (prev !== simplified && maxIterations > 0) {
      prev = simplified;

      // Simplify Pick/Omit patterns
      simplified = simplified.replace(/Pick<([^,>]+(?:<[^>]*>)?(?:\s*,\s*[^,>]+(?:<[^>]*>)?)*)\s*,\s*[^>]+>/g, '$1');
      simplified = simplified.replace(/Omit<([^,>]+(?:<[^>]*>)?(?:\s*,\s*[^,>]+(?:<[^>]*>)?)*)\s*,\s*[^>]+>/g, '$1');
      simplified = simplified.replace(/Partial<([^>]+)>/g, '$1');
      simplified = simplified.replace(/Required<([^>]+)>/g, '$1');
      simplified = simplified.replace(/Readonly<([^>]+)>/g, '$1');
      simplified = simplified.replace(/NonNullable<([^>]+)>/g, '$1');

      maxIterations--;
    }

    return simplified;
  }

  /**
   * Get default value for a type.
   */
  getDefaultValue(type: string): unknown {
    const t = type.trim();

    switch (t) {
      case 'string':
        return "''";
      case 'number':
        return '0';
      case 'boolean':
        return 'false';
      case 'object':
        return '{}';
      case 'any':
        return 'undefined';
      case 'unknown':
        return 'undefined';
      case 'void':
        return 'undefined';
      case 'null':
        return 'null';
      case 'undefined':
        return 'undefined';
      case 'never':
        return 'undefined';
      case 'Date':
        return 'new Date()';
      case 'Map':
      case 'Set':
        return t === 'Map' ? 'new Map()' : 'new Set()';
      case 'Array':
      case 'any[]':
        return '[]';
      case 'Error':
        return 'new Error()';
      case 'RegExp':
        return '/(?:)/';
      default:
        if (t.startsWith('Array<')) return '[]';
        if (t.startsWith('Record<')) return '{}';
        if (t.startsWith('Map<')) return 'new Map()';
        if (t.startsWith('Set<')) return 'new Set()';
        if (t.startsWith('Promise<')) return 'Promise.resolve(undefined)';
        if (t.endsWith('[]')) return '[]';
        return 'undefined';
    }
  }

  // --- Internal helpers ---

  private splitGenericParams(paramString: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';

    for (const char of paramString) {
      if (char === '<' || char === '[' || char === '(' || char === '{') depth++;
      if (char === '>' || char === ']' || char === ')' || char === '}') depth--;
      if (char === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  private expandGenerics(type: string, maxDepth: number, currentDepth: number = 0): string {
    if (currentDepth >= maxDepth) return type;

    // Expand common generic patterns
    let expanded = type;

    // ReadonlyArray<T> -> readonly T[] (must be before Array<T> to avoid partial match)
    expanded = expanded.replace(/ReadonlyArray<([^>]+)>/g, (_, inner) => {
      return `readonly ${this.expandGenerics(inner, maxDepth, currentDepth + 1)}[]`;
    });

    // Array<T> -> T[]
    expanded = expanded.replace(/Array<([^>]+)>/g, (_, inner) => {
      return `${this.expandGenerics(inner, maxDepth, currentDepth + 1)}[]`;
    });

    return expanded;
  }
}
