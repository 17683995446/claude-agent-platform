// src/code-formatter.ts - 代码格式化模块

export interface FormatOptions {
  indentStyle?: 'spaces' | 'tabs';
  indentWidth?: number;
  maxWidth?: number;
  semicolons?: boolean;
  quoteStyle?: 'single' | 'double';
  trailingWhitespace?: boolean;
  tabWidth?: number;
}

export interface FormatResult {
  filePath: string;
  original: string;
  formatted: string;
  changed: boolean;
}

export class CodeFormatter {
  private defaultOptions: FormatOptions = {
    indentStyle: 'spaces',
    indentWidth: 2,
    maxWidth: 80,
    semicolons: true,
    quoteStyle: 'single',
    trailingWhitespace: false,
    tabWidth: 2,
  };

  private languageKeywords: Record<string, string[]> = {
    typescript: ['import', 'export', 'from', 'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'this', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'default', 'extends', 'implements', 'readonly', 'public', 'private', 'protected', 'static', 'void', 'null', 'undefined', 'true', 'false'],
    javascript: ['import', 'export', 'from', 'const', 'let', 'var', 'function', 'class', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'this', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'default', 'extends', 'typeof', 'instanceof', 'void', 'null', 'undefined', 'true', 'false'],
    json: [],
    css: ['@import', '@media', '@keyframes', '@font-face', '@supports', '@layer'],
    html: ['DOCTYPE', 'html', 'head', 'body', 'div', 'span', 'p', 'a', 'img', 'script', 'style', 'link', 'meta', 'title'],
    markdown: [],
  };

  format(code: string, language: string, options?: FormatOptions): string {
    const opts = { ...this.defaultOptions, ...options };
    let result = code;

    // Handle empty code
    if (result.trim() === '') {
      return '';
    }

    // Normalize line endings
    result = result.replace(/\r\n/g, '\n');

    // Remove trailing whitespace
    if (!opts.trailingWhitespace) {
      result = result.replace(/[ \t]+$/gm, '');
    }

    // Normalize indentation
    result = this.normalizeIndentation(result, language, opts);

    // Handle semicolons for JS/TS
    if (language === 'typescript' || language === 'javascript') {
      result = this.handleSemicolons(result, opts.semicolons!);
      result = this.normalizeQuotes(result, opts.quoteStyle!);
    }

    // Enforce line length with smart wrapping
    if (opts.maxWidth) {
      result = this.enforceLineLength(result, opts.maxWidth, language);
    }

    // Ensure file ends with newline
    if (result.length > 0 && !result.endsWith('\n')) {
      result += '\n';
    }

    return result;
  }

  private normalizeIndentation(code: string, language: string, opts: FormatOptions): string {
    const lines = code.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      if (line.trim() === '') {
        result.push('');
        continue;
      }

      const indent = line.match(/^(\s*)/)?.[1] || '';
      const indentLevel = Math.round(this.getIndentLevel(indent, opts));
      const newIndent = this.createIndent(indentLevel, opts);
      const content = line.trim().replace(/  +/g, ' ');
      result.push(newIndent + content);
    }

    return result.join('\n');
  }

  private getIndentLevel(indent: string, opts: FormatOptions): number {
    if (indent.includes('\t')) {
      return indent.length;
    }
    const width = opts.indentWidth || 2;
    return indent.length / width;
  }

  private createIndent(level: number, opts: FormatOptions): string {
    if (opts.indentStyle === 'tabs') {
      return '\t'.repeat(level);
    }
    return ' '.repeat(level * (opts.indentWidth || 2));
  }

  private handleSemicolons(code: string, add: boolean): string {
    const lines = code.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        result.push(line);
        continue;
      }

      if (trimmed.startsWith('import ') || trimmed.startsWith('export ') || trimmed.startsWith('from ')) {
        if (add && !trimmed.endsWith(';')) {
          result.push(line + ';');
        } else if (!add && trimmed.endsWith(';')) {
          result.push(line.slice(0, -1));
        } else {
          result.push(line);
        }
        continue;
      }

      if (add && !trimmed.endsWith(';') && !trimmed.endsWith('{') && !trimmed.endsWith('}') && !trimmed.endsWith('(') && !trimmed.endsWith(',') && !trimmed.endsWith(':') && !trimmed.endsWith('=>') && !trimmed.endsWith('?') && !trimmed.endsWith('|') && !trimmed.endsWith('&')) {
        result.push(line + ';');
      } else if (!add && trimmed.endsWith(';') && !trimmed.includes('for') && !trimmed.includes('for')) {
        result.push(line.slice(0, -1));
      } else {
        result.push(line);
      }
    }

    return result.join('\n');
  }

  private normalizeQuotes(code: string, style: 'single' | 'double'): string {
    if (style === 'single') {
      // Replace double quotes with single quotes, but skip escaped quotes
      return code.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, "'$1'");
    } else {
      return code.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');
    }
  }

  private enforceLineLength(code: string, maxWidth: number, language: string): string {
    // For JSON and HTML, don't wrap lines
    if (language === 'json' || language === 'html') {
      return code;
    }

    const lines = code.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      if (line.length <= maxWidth) {
        result.push(line);
      } else {
        // Simple smart wrapping: break at last space before maxWidth
        const breakPoint = line.lastIndexOf(' ', maxWidth);
        if (breakPoint > 0) {
          const indent = line.match(/^(\s*)/)?.[1] || '';
          result.push(line.substring(0, breakPoint));
          result.push(indent + '  ' + line.substring(breakPoint + 1));
        } else {
          result.push(line);
        }
      }
    }

    return result.join('\n');
  }

  async formatFile(filePath: string): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    const { extname } = await import('node:path');
    const ext = extname(filePath).slice(1);
    const languageMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript',
      js: 'javascript', jsx: 'javascript',
      json: 'json', css: 'css', html: 'html', md: 'markdown',
    };
    const language = languageMap[ext] || 'typescript';
    const code = await readFile(filePath, 'utf-8');
    return this.format(code, language);
  }

  async formatDirectory(dirPath: string): Promise<FormatResult[]> {
    const { readdir, stat, readFile } = await import('node:fs/promises');
    const { join, extname } = await import('node:path');
    const entries = await readdir(dirPath, { withFileTypes: true });
    const results: FormatResult[] = [];

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
        results.push(...await this.formatDirectory(fullPath));
      } else if (entry.isFile()) {
        const ext = extname(entry.name).slice(1);
        const supportedExts = ['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'html', 'md'];
        if (supportedExts.includes(ext)) {
          const original = await readFile(fullPath, 'utf-8');
          const formatted = this.format(original, ext === 'ts' || ext === 'tsx' ? 'typescript' : ext === 'js' || ext === 'jsx' ? 'javascript' : ext);
          results.push({ filePath: fullPath, original, formatted, changed: original !== formatted });
        }
      }
    }

    return results;
  }

  formatDiff(original: string, formatted: string): string {
    const origLines = original.split('\n');
    const fmtLines = formatted.split('\n');
    const diff: string[] = [];

    const maxLen = Math.max(origLines.length, fmtLines.length);
    for (let i = 0; i < maxLen; i++) {
      const o = origLines[i] ?? '';
      const f = fmtLines[i] ?? '';
      if (o !== f) {
        if (o) diff.push(`- ${o}`);
        if (f) diff.push(`+ ${f}`);
      } else if (o) {
        diff.push(`  ${o}`);
      }
    }

    return diff.join('\n');
  }
}
