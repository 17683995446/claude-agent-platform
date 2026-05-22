// ============================================================================
// Module 8: Configuration Manager
// ============================================================================

export type WatchCallback = (newValue: unknown, oldValue: unknown) => void;

export type UnwatchFn = () => void;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigLayer {
  name: string;
  priority: number;
  data: Record<string, unknown>;
}

export class AppConfigManager {
  private layers: ConfigLayer[] = [];
  private watchers: Map<string, Array<{ callback: WatchCallback; path: string }>> = new Map();
  private watcherCounter: number = 0;

  constructor(defaults: Record<string, unknown> = {}) {
    this.addLayer('defaults', 0, defaults);
  }

  addLayer(name: string, priority: number, data: Record<string, unknown>): void {
    // Remove existing layer with same name
    this.layers = this.layers.filter((l) => l.name !== name);
    this.layers.push({ name, priority, data });
    this.sortLayers();
  }

  removeLayer(name: string): boolean {
    const index = this.layers.findIndex((l) => l.name === name);
    if (index >= 0) {
      this.layers.splice(index, 1);
      return true;
    }
    return false;
  }

  get<T>(path: string, defaultValue?: T): T {
    const value = this.getNestedValue(path);
    if (value === undefined) {
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`Configuration path "${path}" not found`);
    }
    return value as T;
  }

  set(path: string, value: unknown): void {
    // Set in the topmost layer (highest priority)
    if (this.layers.length === 0) {
      this.addLayer('runtime', 100, {});
    }
    // If the topmost layer is 'defaults', create a runtime layer instead
    const topLayer = this.layers[this.layers.length - 1]!;
    if (topLayer.name === 'defaults') {
      this.addLayer('runtime', 100, {});
    }
    const targetLayer = this.layers[this.layers.length - 1]!;
    const oldValue = this.getNestedValue(path);
    this.setNestedValue(targetLayer.data, path, value);
    this.notifyWatchers(path, value, oldValue);
  }

  watch(path: string, callback: WatchCallback): UnwatchFn {
    const watcherId = `watcher-${++this.watcherCounter}`;
    if (!this.watchers.has(path)) {
      this.watchers.set(path, []);
    }
    this.watchers.get(path)!.push({ callback, path });

    return () => {
      const watchers = this.watchers.get(path);
      if (watchers) {
        const index = watchers.findIndex((w) => w.callback === callback);
        if (index >= 0) watchers.splice(index, 1);
      }
    };
  }

  validate(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation
    const allData = this.getMergedData();
    if (!allData['name'] && !allData['appName']) {
      warnings.push('Application name is not configured');
    }
    if (!allData['version'] && !allData['appVersion']) {
      warnings.push('Application version is not configured');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  export(format: 'json' | 'env' | 'yaml'): string {
    const data = this.getMergedData();

    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);

      case 'env': {
        const lines: string[] = [];
        this.flattenObject(data, '', lines);
        return lines.join('\n');
      }

      case 'yaml': {
        // Simple YAML export
        const lines: string[] = [];
        this.toYaml(data, '', lines);
        return lines.join('\n');
      }
    }
  }

  has(path: string): boolean {
    return this.getNestedValue(path) !== undefined;
  }

  getAll(): Record<string, unknown> {
    return this.getMergedData();
  }

  getLayerNames(): string[] {
    return this.layers.map((l) => l.name);
  }

  private getNestedValue(path: string): unknown {
    const keys = path.split('.');
    let current: unknown = this.getMergedData();

    for (const key of keys) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]!;
      if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    current[keys[keys.length - 1]!] = value;
  }

  private getMergedData(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const layer of this.layers) {
      this.deepMerge(result, layer.data);
    }
    return result;
  }

  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(source)) {
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        target[key] !== null &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        this.deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        target[key] = value;
      }
    }
  }

  private sortLayers(): void {
    this.layers.sort((a, b) => a.priority - b.priority);
  }

  private notifyWatchers(path: string, newValue: unknown, oldValue: unknown): void {
    const watchers = this.watchers.get(path);
    if (watchers) {
      for (const watcher of watchers) {
        try {
          watcher.callback(newValue, oldValue);
        } catch {
          // Swallow watcher errors
        }
      }
    }
  }

  private flattenObject(obj: Record<string, unknown>, prefix: string, lines: string[]): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}_${key.toUpperCase()}` : key.toUpperCase();
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.flattenObject(value as Record<string, unknown>, fullKey, lines);
      } else {
        lines.push(`${fullKey}=${String(value)}`);
      }
    }
  }

  private toYaml(obj: Record<string, unknown>, indent: string, lines: string[]): void {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        lines.push(`${indent}${key}:`);
        this.toYaml(value as Record<string, unknown>, indent + '  ', lines);
      } else if (Array.isArray(value)) {
        lines.push(`${indent}${key}:`);
        for (const item of value) {
          lines.push(`${indent}  - ${String(item)}`);
        }
      } else {
        lines.push(`${indent}${key}: ${String(value)}`);
      }
    }
  }
}
