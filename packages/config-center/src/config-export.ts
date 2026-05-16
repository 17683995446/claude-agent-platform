/**
 * 配置导出模块
 * 支持多种导出格式、选择性导出、密钥掩码和配置导入
 */

export type ExportFormat = 'json' | 'yaml' | 'dotenv' | 'typescript';

export interface ExportOptions {
  include?: string[];
  exclude?: string[];
  maskSecrets?: boolean;
  secretPaths?: string[];
  template?: string;
  indent?: number;
}

export interface ConfigDiff {
  added: string[];
  removed: string[];
  changed: Array<{ path: string; oldValue: unknown; newValue: unknown }>;
}

/**
 * ConfigExporter - 配置导出器
 */
export class ConfigExporter {
  private store: { get(path: string): unknown; getAll(): Record<string, unknown> };

  constructor(store: { get(path: string): unknown; getAll(): Record<string, unknown> }) {
    this.store = store;
  }

  /**
   * 导出配置为指定格式
   */
  export(format: ExportFormat, options?: ExportOptions): string {
    let data = this.filterData(options);

    if (options?.maskSecrets && options.secretPaths) {
      data = this.maskSecrets(data, options.secretPaths);
    }

    switch (format) {
      case 'json':
        return this.exportJSON(data, options?.indent || 2);
      case 'yaml':
        return this.exportYAML(data);
      case 'dotenv':
        return this.exportDotenv(data);
      case 'typescript':
        return this.exportTypeScript(data);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * 导出配置到文件
   */
  exportToFile(filePath: string, format: ExportFormat, options?: ExportOptions): void {
    const content = this.export(format, options);
    Bun.write(filePath, content);
  }

  /**
   * 从字符串导入配置
   */
  importConfig(data: string, format: ExportFormat): Record<string, unknown> {
    switch (format) {
      case 'json':
        return JSON.parse(data) as Record<string, unknown>;
      case 'dotenv':
        return this.parseDotenv(data);
      case 'yaml':
        return this.parseSimpleYAML(data);
      case 'typescript':
        return this.parseTypeScript(data);
      default:
        throw new Error(`Unsupported import format: ${format}`);
    }
  }

  /**
   * 比较两个配置的差异
   */
  diff(config1: Record<string, unknown>, config2: Record<string, unknown>): ConfigDiff {
    const added: string[] = [];
    const removed: string[] = [];
    const changed: Array<{ path: string; oldValue: unknown; newValue: unknown }> = [];

    const allKeys = new Set([...this.flattenKeys(config1), ...this.flattenKeys(config2)]);

    for (const key of allKeys) {
      const v1 = this.getNestedValue(config1, key);
      const v2 = this.getNestedValue(config2, key);

      if (v1 === undefined && v2 !== undefined) {
        added.push(key);
      } else if (v1 !== undefined && v2 === undefined) {
        removed.push(key);
      } else if (JSON.stringify(v1) !== JSON.stringify(v2)) {
        changed.push({ path: key, oldValue: v1, newValue: v2 });
      }
    }

    return { added, removed, changed };
  }

  private filterData(options?: ExportOptions): Record<string, unknown> {
    const allData = this.store.getAll();

    if (!options?.include && !options?.exclude) {
      return allData;
    }

    const result: Record<string, unknown> = {};
    const flatEntries = this.flatten(allData);

    for (const [key, value] of flatEntries) {
      if (options.exclude?.some((pattern) => key.startsWith(pattern))) {
        continue;
      }
      if (options.include && !options.include.some((pattern) => key.startsWith(pattern))) {
        continue;
      }
      this.setNestedValue(result, key, value);
    }

    return result;
  }

  private maskSecrets(
    data: Record<string, unknown>,
    secretPaths: string[],
  ): Record<string, unknown> {
    const result = JSON.parse(JSON.stringify(data));
    for (const secretPath of secretPaths) {
      if (this.getNestedValue(result, secretPath) !== undefined) {
        this.setNestedValue(result, secretPath, '*****');
      }
    }
    return result;
  }

  private exportJSON(data: Record<string, unknown>, indent: number): string {
    return JSON.stringify(data, null, indent);
  }

  private exportYAML(data: Record<string, unknown>, prefix = ''): string {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) {
        lines.push(`${prefix}${key}: null`);
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        lines.push(`${prefix}${key}:`);
        lines.push(this.exportYAML(value as Record<string, unknown>, prefix + '  '));
      } else if (Array.isArray(value)) {
        lines.push(`${prefix}${key}:`);
        for (const item of value) {
          lines.push(`${prefix}  - ${JSON.stringify(item)}`);
        }
      } else if (typeof value === 'string') {
        lines.push(`${prefix}${key}: "${value}"`);
      } else {
        lines.push(`${prefix}${key}: ${String(value)}`);
      }
    }
    return lines.join('\n');
  }

  private exportDotenv(data: Record<string, unknown>, prefix = ''): string {
    const lines: string[] = [];
    const flat = this.flatten(data);
    for (const [key, value] of flat) {
      const envKey = key.toUpperCase().replace(/\./g, '_');
      const strValue = typeof value === 'string' ? value : JSON.stringify(value);
      lines.push(`${envKey}=${strValue}`);
    }
    return lines.join('\n');
  }

  private exportTypeScript(data: Record<string, unknown>): string {
    const json = JSON.stringify(data, null, 2);
    return `// Auto-generated configuration\nexport const config = ${json} as const;\n`;
  }

  private parseDotenv(data: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const line of data.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim().toLowerCase().replace(/_/g, '.');
      let value: unknown = trimmed.slice(eqIdx + 1).trim();
      if (typeof value === 'string') {
        if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
          value = (value as string).slice(1, -1);
        } else if ((value as string).startsWith("'") && (value as string).endsWith("'")) {
          value = (value as string).slice(1, -1);
        } else {
          // Try to parse as number or boolean
          if (value === 'true') { value = true; }
          else if (value === 'false') { value = false; }
          else {
            const num = Number(value);
            if (!isNaN(num) && (value as string).trim() !== '') value = num;
          }
        }
      }
      this.setNestedValue(result, key, value);
    }
    return result;
  }

  private parseSimpleYAML(data: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = data.split('\n');
    const stack: Array<{ indent: number; key: string; obj: Record<string, unknown> }> = [];

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = line.length - line.trimStart().length;
      const match = trimmed.match(/^(\w[\w.-]*):\s*(.*)$/);
      if (!match) continue;

      const key = match[1];
      let value: unknown = match[2].trim() || undefined;

      if (value === undefined) {
        // Nested object
        const newObj: Record<string, unknown> = {};
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }
        if (stack.length > 0) {
          stack[stack.length - 1].obj[key] = newObj;
        } else {
          result[key] = newObj;
        }
        stack.push({ indent, key, obj: newObj });
      } else {
        // Parse value
        if (value === 'null') value = null;
        else if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        else {
          const num = Number(value);
          if (!isNaN(num) && value.trim() !== '') value = num;
        }

        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }
        if (stack.length > 0) {
          stack[stack.length - 1].obj[key] = value;
        } else {
          result[key] = value;
        }
      }
    }
    return result;
  }

  private parseTypeScript(data: string): Record<string, unknown> {
    const match = data.match(/export\s+const\s+\w+\s*=\s*([\s\S]*?)\s*as\s+const\s*;/);
    if (!match) return {};
    try {
      return JSON.parse(match[1]) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private flatten(
    obj: Record<string, unknown>,
    prefix = '',
  ): Array<[string, unknown]> {
    const result: Array<[string, unknown]> = [];
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        result.push(...this.flatten(value as Record<string, unknown>, fullKey));
      } else {
        result.push([fullKey, value]);
      }
    }
    return result;
  }

  private flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    const result: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        result.push(...this.flattenKeys(value as Record<string, unknown>, fullKey));
      } else {
        result.push(fullKey);
      }
    }
    return result;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current) || typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }
}
