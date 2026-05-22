// src/output-formatter.ts - 输出格式化器模块

export type OutputFormat = 'text' | 'json' | 'yaml' | 'table' | 'tree';
export type VerbosityLevel = 'silent' | 'normal' | 'verbose' | 'debug';
export type ColorTheme = 'light' | 'dark' | 'none';

export interface FormatOptions {
  theme?: ColorTheme;
  verbosity?: VerbosityLevel;
  indent?: number;
  colorize?: boolean;
  timestamp?: boolean;
  pretty?: boolean;
}

export interface FormattedOutput {
  format: OutputFormat;
  content: string;
  metadata?: {
    timestamp?: string;
    verbosity?: VerbosityLevel;
    theme?: ColorTheme;
  };
}

const THEME_COLORS: Record<ColorTheme, Record<string, string>> = {
  dark: {
    success: '\x1b[32m',
    error: '\x1b[31m',
    warning: '\x1b[33m',
    info: '\x1b[36m',
    muted: '\x1b[90m',
    highlight: '\x1b[1m',
    reset: '\x1b[0m',
  },
  light: {
    success: '\x1b[32m',
    error: '\x1b[31m',
    warning: '\x1b[33m',
    info: '\x1b[34m',
    muted: '\x1b[90m',
    highlight: '\x1b[1m',
    reset: '\x1b[0m',
  },
  none: {
    success: '',
    error: '',
    warning: '',
    info: '',
    muted: '',
    highlight: '',
    reset: '',
  },
};

export class OutputFormatter {
  private theme: ColorTheme = 'dark';
  private verbosity: VerbosityLevel = 'normal';
  private indentSize: number = 2;
  private colorize: boolean = true;

  /**
   * 格式化数据为指定格式
   */
  format(data: unknown, format: OutputFormat, options?: FormatOptions): string {
    const opts = { ...this.getDefaultOptions(), ...options };

    switch (format) {
      case 'json':
        return this.formatJSON(data, opts);
      case 'yaml':
        return this.formatYAML(data, opts);
      case 'table':
        return this.formatTable(data, opts);
      case 'tree':
        return this.formatTree(data, opts);
      case 'text':
      default:
        return this.formatText(data, opts);
    }
  }

  /**
   * 格式化错误
   */
  formatError(error: Error, format: OutputFormat = 'text'): string {
    const errorData = {
      error: true,
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    switch (format) {
      case 'json':
        return JSON.stringify(errorData, null, 2);
      case 'yaml':
        return this.formatYAML(errorData);
      default: {
        const colors = THEME_COLORS[this.theme];
        const reset = colors.reset;
        const errorColor = colors.error;
        return `${errorColor}Error: ${reset}${error.name}: ${error.message}`;
      }
    }
  }

  /**
   * 格式化成功消息
   */
  formatSuccess(message: string, data?: unknown): string {
    const colors = THEME_COLORS[this.theme];
    const reset = colors.reset;
    const successColor = colors.success;

    let output = `${successColor}${this.getSuccessSymbol()} ${message}${reset}`;

    if (data !== undefined && this.verbosity !== 'silent') {
      output += '\n' + this.format(data, 'json', { indent: this.indentSize });
    }

    return output;
  }

  /**
   * 格式化警告消息
   */
  formatWarning(message: string): string {
    const colors = THEME_COLORS[this.theme];
    const reset = colors.reset;
    const warningColor = colors.warning;
    return `${warningColor}${this.getWarningSymbol()} ${message}${reset}`;
  }

  /**
   * 格式化列表
   */
  formatList(items: string[], format: OutputFormat = 'text'): string {
    switch (format) {
      case 'json':
        return JSON.stringify(items, null, 2);
      case 'yaml':
        return this.formatYAML(items);
      case 'table': {
        const rows = items.map((item, i) => ({ '#': i + 1, item }));
        return this.formatTable(rows);
      }
      default:
        return items.map(item => `  - ${item}`).join('\n');
    }
  }

  /**
   * 设置颜色主题
   */
  setTheme(theme: ColorTheme): this {
    this.theme = theme;
    return this;
  }

  /**
   * 设置详细程度
   */
  setVerbosity(level: VerbosityLevel): this {
    this.verbosity = level;
    return this;
  }

  /**
   * 设置缩进大小
   */
  setIndent(size: number): this {
    this.indentSize = size;
    return this;
  }

  /**
   * 设置是否启用颜色
   */
  setColorize(enabled: boolean): this {
    this.colorize = enabled;
    return this;
  }

  /**
   * 获取当前主题
   */
  getTheme(): ColorTheme {
    return this.theme;
  }

  /**
   * 获取当前详细程度
   */
  getVerbosity(): VerbosityLevel {
    return this.verbosity;
  }

  /**
   * 创建格式化输出对象
   */
  createFormattedOutput(format: OutputFormat, content: string): FormattedOutput {
    return {
      format,
      content,
      metadata: {
        timestamp: new Date().toISOString(),
        verbosity: this.verbosity,
        theme: this.theme,
      },
    };
  }

  /**
   * 格式化为 JSON
   */
  formatJSON(data: unknown, options?: FormatOptions): string {
    const indent = options?.indent ?? this.indentSize;
    const pretty = options?.pretty ?? true;
    return JSON.stringify(data, null, pretty ? indent : undefined);
  }

  /**
   * 格式化为 YAML-like
   */
  formatYAML(data: unknown, options?: FormatOptions): string {
    const indent = options?.indent ?? this.indentSize;
    return this.toYAMLString(data, 0, indent);
  }

  /**
   * 格式化为表格
   */
  formatTable(data: unknown, options?: FormatOptions): string {
    if (!Array.isArray(data)) {
      if (typeof data === 'object' && data !== null) {
        return this.formatObjectAsTable(data as Record<string, unknown>);
      }
      return String(data);
    }

    if (data.length === 0) return '(no data)';

    const keys = new Set<string>();
    for (const item of data) {
      if (typeof item === 'object' && item !== null) {
        for (const key of Object.keys(item)) {
          keys.add(key);
        }
      }
    }

    const columns = [...keys];
    const rows = data.map(item => {
      const row: Record<string, string> = {};
      for (const col of columns) {
        row[col] = String((item as Record<string, unknown>)[col] ?? '');
      }
      return row;
    });

    // Calculate column widths
    const widths: Record<string, number> = {};
    for (const col of columns) {
      widths[col] = Math.max(col.length, ...rows.map(r => r[col].length));
    }

    const lines: string[] = [];
    const header = columns.map(c => c.padEnd(widths[c])).join(' | ');
    lines.push(header);
    lines.push(columns.map(c => '-'.repeat(widths[c])).join('-+-'));

    for (const row of rows) {
      lines.push(columns.map(c => row[c].padEnd(widths[c])).join(' | '));
    }

    return lines.join('\n');
  }

  /**
   * 格式化为树
   */
  formatTree(data: unknown, options?: FormatOptions): string {
    const indent = options?.indent ?? this.indentSize;
    return this.buildTree(data, '', '', indent);
  }

  private formatText(data: unknown, options: FormatOptions): string {
    if (typeof data === 'string') return data;
    if (typeof data === 'number' || typeof data === 'boolean') return String(data);
    if (data === null) return 'null';
    if (data === undefined) return 'undefined';
    if (Array.isArray(data)) return this.formatList(data);
    return this.formatObjectAsTable(data as Record<string, unknown>);
  }

  private formatObjectAsTable(obj: Record<string, unknown>): string {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
    return lines.join('\n');
  }

  private toYAMLString(data: unknown, depth: number, indent: number): string {
    const prefix = ' '.repeat(depth * indent);

    if (data === null) return `${prefix}null`;
    if (data === undefined) return `${prefix}~`;
    if (typeof data === 'string') return `${prefix}"${data}"`;
    if (typeof data === 'number' || typeof data === 'boolean') return `${prefix}${String(data)}`;

    if (Array.isArray(data)) {
      if (data.length === 0) return `${prefix}[]`;
      return data.map(item => {
        const val = this.toYAMLString(item, depth + 1, indent);
        return `${prefix}- ${val.trimStart()}`;
      }).join('\n');
    }

    if (typeof data === 'object') {
      const entries = Object.entries(data as Record<string, unknown>);
      if (entries.length === 0) return `${prefix}{}`;
      return entries.map(([key, value]) => {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return `${prefix}${key}:\n${this.toYAMLString(value, depth + 1, indent)}`;
        }
        return `${prefix}${key}: ${this.toYAMLString(value, 0, indent).trimStart()}`;
      }).join('\n');
    }

    return `${prefix}${String(data)}`;
  }

  private buildTree(data: unknown, prefix: string, currentPrefix: string, indent: number): string {
    if (typeof data !== 'object' || data === null) {
      return `${currentPrefix}${String(data)}`;
    }

    if (Array.isArray(data)) {
      return data.map((item, i) => {
        const isLast = i === data.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';
        const value = typeof item === 'object' && item !== null
          ? '\n' + this.buildTree(item, prefix + childPrefix, prefix + childPrefix, indent)
          : String(item);
        return `${currentPrefix}${connector}${value}`;
      }).join('\n');
    }

    const entries = Object.entries(data as Record<string, unknown>);
    return entries.map(([key, value], i) => {
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';
      const displayValue = typeof value === 'object' && value !== null
        ? ''
        : `: ${JSON.stringify(value)}`;
      const childTree = typeof value === 'object' && value !== null
        ? '\n' + this.buildTree(value, prefix + childPrefix, prefix + childPrefix, indent)
        : '';
      return `${currentPrefix}${connector}${key}${displayValue}${childTree}`;
    }).join('\n');
  }

  private getDefaultOptions(): FormatOptions {
    return {
      theme: this.theme,
      verbosity: this.verbosity,
      indent: this.indentSize,
      colorize: this.colorize,
    };
  }

  private getSuccessSymbol(): string {
    return this.colorize ? '\u2713' : '[OK]';
  }

  private getWarningSymbol(): string {
    return this.colorize ? '\u26A0' : '[WARN]';
  }
}
