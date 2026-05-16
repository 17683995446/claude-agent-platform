/**
 * 多源配置加载模块
 * 支持文件、环境变量、命令行参数、远程API、内存等多种配置源
 */

export interface ConfigSource {
  readonly name: string;
  load(): Promise<Record<string, unknown>>;
}

interface PrioritizedSource {
  source: ConfigSource;
  priority: number;
}

/**
 * 文件配置源 - 支持 JSON 格式
 */
export class FileConfigSource implements ConfigSource {
  readonly name: string;
  private filePath: string;
  private _lastModified: number = 0;

  constructor(filePath: string, name?: string) {
    this.filePath = filePath;
    this.name = name || `file:${filePath}`;
  }

  async load(): Promise<Record<string, unknown>> {
    try {
      const file = Bun.file(this.filePath);
      const exists = await file.exists();
      if (!exists) {
        return {};
      }
      const text = await file.text();
      this._lastModified = (await file.lastModified) ?? Date.now();
      const ext = this.filePath.split('.').pop()?.toLowerCase();
      if (ext === 'json') {
        return JSON.parse(text) as Record<string, unknown>;
      }
      // For non-JSON, try JSON parse first, then return empty
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {};
      }
    } catch {
      return {};
    }
  }

  get lastModified(): number {
    return this._lastModified;
  }
}

/**
 * 环境变量配置源
 * 支持前缀过滤和嵌套键转换 (DATABASE__HOST → database.host)
 */
export class EnvConfigSource implements ConfigSource {
  readonly name: string;
  private prefix: string;
  private separator: string;

  constructor(options?: { prefix?: string; separator?: string; name?: string }) {
    this.prefix = options?.prefix || '';
    this.separator = options?.separator || '__';
    this.name = options?.name || 'env';
  }

  async load(): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    const env = process.env as Record<string, string>;

    for (const [key, value] of Object.entries(env)) {
      let processedKey = key;
      if (this.prefix && !key.startsWith(this.prefix)) {
        continue;
      }
      if (this.prefix) {
        processedKey = key.slice(this.prefix.length);
      }
      // Convert separator to dot notation and lowercase
      const dotKey = processedKey
        .split(this.separator)
        .map((part) => part.toLowerCase())
        .join('.');
      // Parse value: try JSON, number, boolean
      const parsedValue = this.parseValue(value);
      setNestedValue(result, dotKey, parsedValue);
    }

    return result;
  }

  private parseValue(value: string): unknown {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (value === 'undefined') return undefined;
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}

/**
 * 命令行参数配置源
 * 支持 --port=3000, --verbose, --flag value 格式
 */
export class ArgConfigSource implements ConfigSource {
  readonly name: string;
  private args: string[];

  constructor(args?: string[], name?: string) {
    this.args = args || process.argv.slice(2);
    this.name = name || 'args';
  }

  async load(): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    const args = this.args;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith('--')) continue;

      const cleanArg = arg.slice(2);
      let key: string;
      let value: unknown = true;

      if (cleanArg.includes('=')) {
        const [k, v] = cleanArg.split('=', 2);
        key = k;
        value = parseArgValue(v);
      } else {
        key = cleanArg;
        // Check if next arg is a value (not a flag)
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          value = parseArgValue(args[i + 1]);
          i++; // skip next
        }
      }

      const dotKey = key.replace(/-/g, '.').toLowerCase();
      setNestedValue(result, dotKey, value);
    }

    return result;
  }
}

/**
 * 远程配置源 - 通过 HTTP API 加载
 */
export class RemoteConfigSource implements ConfigSource {
  readonly name: string;
  private url: string;
  private headers: Record<string, string>;
  private _lastETag: string | null = null;

  constructor(url: string, options?: { name?: string; headers?: Record<string, string> }) {
    this.url = url;
    this.name = options?.name || `remote:${url}`;
    this.headers = options?.headers || {};
  }

  async load(): Promise<Record<string, unknown>> {
    try {
      const headers: Record<string, string> = { ...this.headers, 'Accept': 'application/json' };
      if (this._lastETag) {
        headers['If-None-Match'] = this._lastETag;
      }
      const response = await fetch(this.url, { headers });
      if (response.status === 304) {
        return {}; // Not modified
      }
      const etag = response.headers.get('etag');
      if (etag) {
        this._lastETag = etag;
      }
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  get lastETag(): string | null {
    return this._lastETag;
  }
}

/**
 * 内存配置源
 */
export class MemoryConfigSource implements ConfigSource {
  readonly name: string;
  private _data: Record<string, unknown>;

  constructor(data: Record<string, unknown> = {}, name?: string) {
    this._data = { ...data };
    this.name = name || 'memory';
  }

  async load(): Promise<Record<string, unknown>> {
    return { ...this._data };
  }

  update(data: Record<string, unknown>): void {
    this._data = { ...this._data, ...data };
  }

  getData(): Record<string, unknown> {
    return { ...this._data };
  }
}

/**
 * ConfigSourceManager - 管理多个配置源
 */
export class ConfigSourceManager {
  private sources: PrioritizedSource[] = [];

  /**
   * 添加配置源，优先级数值越大优先级越高
   */
  addSource(source: ConfigSource, priority: number): void {
    this.sources.push({ source, priority });
    this.sources.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 移除配置源
   */
  removeSource(name: string): boolean {
    const idx = this.sources.findIndex((s) => s.source.name === name);
    if (idx === -1) return false;
    this.sources.splice(idx, 1);
    return true;
  }

  /**
   * 加载所有配置源并按优先级合并
   */
  async loadAll(): Promise<Record<string, unknown>> {
    let merged: Record<string, unknown> = {};
    // Iterate lowest priority first so higher priority overwrites
    for (let i = this.sources.length - 1; i >= 0; i--) {
      const data = await this.sources[i].source.load();
      merged = deepMergeSources(merged, data);
    }
    return merged;
  }

  /**
   * 重新加载指定配置源
   */
  async reload(sourceName: string): Promise<Record<string, unknown>> {
    const found = this.sources.find((s) => s.source.name === sourceName);
    if (!found) throw new Error(`Source "${sourceName}" not found`);
    return await found.source.load();
  }

  /**
   * 获取所有已注册的配置源名称
   */
  getSourceNames(): string[] {
    return this.sources.map((s) => s.source.name);
  }

  /**
   * 获取配置源
   */
  getSource(name: string): ConfigSource | undefined {
    return this.sources.find((s) => s.source.name === name)?.source;
  }
}

// Helper functions

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
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

function parseArgValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function deepMergeSources(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = result[key];
    if (
      sv !== null &&
      typeof sv === 'object' &&
      !Array.isArray(sv) &&
      tv !== null &&
      typeof tv === 'object' &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMergeSources(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      result[key] = sv;
    }
  }
  return result;
}
