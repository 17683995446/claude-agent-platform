// src/table-renderer.ts - 表格渲染模块

export type Alignment = 'left' | 'right' | 'center';

export interface ColumnDef {
  key: string;
  header: string;
  align?: Alignment;
  width?: number;
  format?: (value: unknown) => string;
  color?: string;
  bold?: boolean;
  wrap?: boolean;
  maxWidth?: number;
}

export interface TableRow {
  [key: string]: unknown;
}

export interface SortOptions {
  column: string;
  direction: 'asc' | 'desc';
}

export interface FilterOptions {
  column: string;
  value: unknown;
  operator?: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte';
}

export interface PaginationOptions {
  page: number;
  pageSize: number;
}

export class TableRenderer {
  private defaultAlignment: Alignment = 'left';
  private defaultPadding: number = 2;
  private borderStyle: 'solid' | 'dashed' | 'none' = 'solid';
  private headerSeparator: boolean = true;

  /**
   * 渲染表格为终端字符串
   */
  render(data: TableRow[], columns: ColumnDef[]): string {
    if (data.length === 0) {
      return this.renderEmpty(columns);
    }

    const widths = this.calculateWidths(data, columns);
    const lines: string[] = [];

    // Header
    const header = this.renderRow(
      columns.map(c => c.header),
      columns,
      widths,
      true
    );
    lines.push(header);

    // Separator
    if (this.headerSeparator) {
      lines.push(this.renderSeparator(widths));
    }

    // Data rows
    for (const row of data) {
      const values = columns.map(col => {
        const raw = row[col.key];
        return col.format ? col.format(raw) : String(raw ?? '');
      });
      lines.push(this.renderRow(values, columns, widths, false));
    }

    return lines.join('\n');
  }

  /**
   * 渲染为 CSV 格式
   */
  renderCSV(data: TableRow[], columns: ColumnDef[]): string {
    const lines: string[] = [];

    // Header
    lines.push(columns.map(c => this.escapeCSV(c.header)).join(','));

    // Data rows
    for (const row of data) {
      const values = columns.map(col => {
        const raw = row[col.key];
        const formatted = col.format ? col.format(raw) : String(raw ?? '');
        return this.escapeCSV(formatted);
      });
      lines.push(values.join(','));
    }

    return lines.join('\n');
  }

  /**
   * 渲染为 Markdown 格式
   */
  renderMarkdown(data: TableRow[], columns: ColumnDef[]): string {
    const lines: string[] = [];

    // Header
    lines.push('| ' + columns.map(c => c.header).join(' | ') + ' |');

    // Separator
    lines.push('| ' + columns.map(() => '---').join(' | ') + ' |');

    // Data rows
    for (const row of data) {
      const values = columns.map(col => {
        const raw = row[col.key];
        return col.format ? col.format(raw) : String(raw ?? '');
      });
      lines.push('| ' + values.join(' | ') + ' |');
    }

    return lines.join('\n');
  }

  /**
   * 排序数据
   */
  sort(data: TableRow[], options: SortOptions): TableRow[] {
    const { column, direction } = options;
    return [...data].sort((a, b) => {
      const aVal = a[column];
      const bVal = b[column];

      let cmp = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''));
      }

      return direction === 'desc' ? -cmp : cmp;
    });
  }

  /**
   * 过滤数据
   */
  filter(data: TableRow[], options: FilterOptions): TableRow[] {
    const { column, value, operator = 'eq' } = options;

    return data.filter(row => {
      const rowValue = row[column];

      switch (operator) {
        case 'eq':
          return rowValue === value;
        case 'neq':
          return rowValue !== value;
        case 'contains':
          return String(rowValue ?? '').toLowerCase().includes(String(value).toLowerCase());
        case 'gt':
          return Number(rowValue) > Number(value);
        case 'lt':
          return Number(rowValue) < Number(value);
        case 'gte':
          return Number(rowValue) >= Number(value);
        case 'lte':
          return Number(rowValue) <= Number(value);
        default:
          return rowValue === value;
      }
    });
  }

  /**
   * 分页数据
   */
  paginate(data: TableRow[], options: PaginationOptions): { data: TableRow[]; total: number; pages: number } {
    const { page, pageSize } = options;
    const total = data.length;
    const pages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
      data: data.slice(start, end),
      total,
      pages,
    };
  }

  /**
   * 设置边框样式
   */
  setBorderStyle(style: 'solid' | 'dashed' | 'none'): this {
    this.borderStyle = style;
    return this;
  }

  /**
   * 设置默认对齐方式
   */
  setDefaultAlignment(align: Alignment): this {
    this.defaultAlignment = align;
    return this;
  }

  /**
   * 设置内边距
   */
  setPadding(padding: number): this {
    this.defaultPadding = padding;
    return this;
  }

  /**
   * 自动计算列宽
   */
  calculateWidths(data: TableRow[], columns: ColumnDef[]): number[] {
    return columns.map(col => {
      if (col.width !== undefined) return col.width;

      let maxWidth = col.header.length;

      for (const row of data) {
        const raw = row[col.key];
        const formatted = col.format ? col.format(raw) : String(raw ?? '');
        maxWidth = Math.max(maxWidth, formatted.length);
      }

      if (col.maxWidth !== undefined) {
        maxWidth = Math.min(maxWidth, col.maxWidth);
      }

      return maxWidth;
    });
  }

  private renderRow(values: string[], columns: ColumnDef[], widths: number[], isHeader: boolean): string {
    const cells = values.map((value, i) => {
      const col = columns[i];
      const align = col?.align ?? this.defaultAlignment;
      const width = widths[i];
      const padding = ' '.repeat(this.defaultPadding);
      const formatted = this.truncate(value, width);
      const aligned = this.alignText(formatted, width, align);

      let cell = padding + aligned + padding;

      if (isHeader && this.borderStyle !== 'none') {
        cell = this.applyStyle(cell, col?.bold ?? true);
      }

      return cell;
    });

    if (this.borderStyle === 'solid') {
      return '|' + cells.join('|') + '|';
    } else if (this.borderStyle === 'dashed') {
      return '|' + cells.join('|') + '|';
    }

    return cells.join(' ');
  }

  private renderSeparator(widths: number[]): string {
    if (this.borderStyle === 'none') return '';

    const parts = widths.map(w => '-'.repeat(w + this.defaultPadding * 2));
    return '+' + parts.join('+') + '+';
  }

  private renderEmpty(columns: ColumnDef[]): string {
    const header = columns.map(c => c.header).join(' | ');
    return `| ${header} |\n| ${columns.map(() => '---').join(' | ')} |\n| ${columns.map(() => '(no data)').join(' | ')} |`;
  }

  private alignText(text: string, width: number, align: Alignment): string {
    const diff = width - text.length;
    if (diff <= 0) return text;

    switch (align) {
      case 'right':
        return ' '.repeat(diff) + text;
      case 'center':
        const left = Math.floor(diff / 2);
        const right = diff - left;
        return ' '.repeat(left) + text + ' '.repeat(right);
      case 'left':
      default:
        return text + ' '.repeat(diff);
    }
  }

  private truncate(text: string, maxWidth: number): string {
    if (text.length <= maxWidth) return text;
    return text.slice(0, maxWidth - 3) + '...';
  }

  private applyStyle(text: string, bold: boolean): string {
    if (!bold) return text;
    return `\x1b[1m${text}\x1b[22m`;
  }

  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
