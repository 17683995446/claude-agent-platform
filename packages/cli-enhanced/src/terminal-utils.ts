// src/terminal-utils.ts - 终端工具集模块

export interface TerminalSize {
  columns: number;
  rows: number;
}

export type ColorLevel = 'truecolor' | '256' | '16' | 'none';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export class TerminalUtils {
  private static instance: TerminalUtils;

  private constructor() {}

  static getInstance(): TerminalUtils {
    if (!TerminalUtils.instance) {
      TerminalUtils.instance = new TerminalUtils();
    }
    return TerminalUtils.instance;
  }

  /**
   * 文本着色（支持 16M 真彩色）
   */
  color(text: string, color: string): string {
    const rgb = this.parseColor(color);
    if (!rgb) return text;
    return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[39m`;
  }

  /**
   * 背景着色
   */
  bgColor(text: string, color: string): string {
    const rgb = this.parseColor(color);
    if (!rgb) return text;
    return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[49m`;
  }

  /**
   * 粗体
   */
  bold(text: string): string {
    return `\x1b[1m${text}\x1b[22m`;
  }

  /**
   * 斜体
   */
  italic(text: string): string {
    return `\x1b[3m${text}\x1b[23m`;
  }

  /**
   * 下划线
   */
  underline(text: string): string {
    return `\x1b[4m${text}\x1b[24m`;
  }

  /**
   * 删除线
   */
  strikethrough(text: string): string {
    return `\x1b[9m${text}\x1b[29m`;
  }

  /**
   * 暗淡
   */
  dim(text: string): string {
    return `\x1b[2m${text}\x1b[22m`;
  }

  /**
   * 反转前景/背景
   */
  reverse(text: string): string {
    return `\x1b[7m${text}\x1b[27m`;
  }

  /**
   * 清除屏幕
   */
  clear(): void {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  /**
   * 清除当前行
   */
  clearLine(): void {
    process.stdout.write('\x1b[2K\r');
  }

  /**
   * 获取终端大小
   */
  getSize(): TerminalSize {
    return {
      columns: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    };
  }

  /**
   * 检测颜色支持级别
   */
  supportsColor(): ColorLevel {
    const env = process.env;

    // Force flags
    if (env.FORCE_COLOR === '0' || env.NO_COLOR !== undefined) {
      return 'none';
    }

    if (env.FORCE_COLOR) {
      return 'truecolor';
    }

    // Check COLORTERM
    if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') {
      return 'truecolor';
    }

    // Check TERM
    const term = env.TERM ?? '';
    if (term.includes('256color') || term.includes('xterm-256color')) {
      return '256';
    }

    if (env.TERM && env.TERM !== 'dumb') {
      return '16';
    }

    return 'none';
  }

  /**
   * 隐藏光标
   */
  hideCursor(): void {
    process.stdout.write('\x1b[?25l');
  }

  /**
   * 显示光标
   */
  showCursor(): void {
    process.stdout.write('\x1b[?25h');
  }

  /**
   * 保存光标位置
   */
  saveCursor(): void {
    process.stdout.write('\x1b[s');
  }

  /**
   * 恢复光标位置
   */
  restoreCursor(): void {
    process.stdout.write('\x1b[u');
  }

  /**
   * 移动光标到指定位置
   */
  moveCursor(x: number, y: number): void {
    process.stdout.write(`\x1b[${y + 1};${x + 1}H`);
  }

  /**
   * 向上移动光标
   */
  moveUp(lines: number = 1): void {
    process.stdout.write(`\x1b[${lines}A`);
  }

  /**
   * 向下移动光标
   */
  moveDown(lines: number = 1): void {
    process.stdout.write(`\x1b[${lines}B`);
  }

  /**
   * 向左移动光标
   */
  moveLeft(cols: number = 1): void {
    process.stdout.write(`\x1b[${cols}D`);
  }

  /**
   * 向右移动光标
   */
  moveRight(cols: number = 1): void {
    process.stdout.write(`\x1b[${cols}C`);
  }

  /**
   * 向上滚动
   */
  scrollUp(lines: number = 1): void {
    process.stdout.write(`\x1b[${lines}S`);
  }

  /**
   * 向下滚动
   */
  scrollDown(lines: number = 1): void {
    process.stdout.write(`\x1b[${lines}T`);
  }

  /**
   * 使用 256 色调色板设置颜色
   */
  color256(text: string, code: number): string {
    return `\x1b[38;5;${code}m${text}\x1b[39m`;
  }

  /**
   * 使用 256 色调色板设置背景色
   */
  bgColor256(text: string, code: number): string {
    return `\x1b[48;5;${code}m${text}\x1b[49m`;
  }

  /**
   * 使用 RGB 值设置颜色
   */
  colorRGB(text: string, r: number, g: number, b: number): string {
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
  }

  /**
   * 使用 RGB 值设置背景色
   */
  bgColorRGB(text: string, r: number, g: number, b: number): string {
    return `\x1b[48;2;${r};${g};${b}m${text}\x1b[49m`;
  }

  /**
   * 组合多种样式
   */
  combineStyles(text: string, styles: Array<(t: string) => string>): string {
    return styles.reduce((acc, style) => style(acc), text);
  }

  /**
   * 移除所有 ANSI 转义码
   */
  stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * 解析颜色字符串为 RGB
   */
  parseColor(color: string): RGB | null {
    // Hex format: #RRGGBB
    const hexMatch = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hexMatch) {
      const hex = hexMatch[1];
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }

    // Hex format: #RGB
    const shortHexMatch = color.match(/^#([0-9a-fA-F]{3})$/);
    if (shortHexMatch) {
      const hex = shortHexMatch[1];
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }

    // Named colors
    const namedColors: Record<string, RGB> = {
      red: { r: 255, g: 0, b: 0 },
      green: { r: 0, g: 128, b: 0 },
      blue: { r: 0, g: 0, b: 255 },
      yellow: { r: 255, g: 255, b: 0 },
      cyan: { r: 0, g: 255, b: 255 },
      magenta: { r: 255, g: 0, b: 255 },
      white: { r: 255, g: 255, b: 255 },
      black: { r: 0, g: 0, b: 0 },
      orange: { r: 255, g: 165, b: 0 },
      purple: { r: 128, g: 0, b: 128 },
      pink: { r: 255, g: 192, b: 203 },
      gray: { r: 128, g: 128, b: 128 },
      grey: { r: 128, g: 128, b: 128 },
    };

    const lower = color.toLowerCase();
    if (namedColors[lower]) {
      return namedColors[lower];
    }

    // rgb(r, g, b) format
    const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1], 10),
        g: parseInt(rgbMatch[2], 10),
        b: parseInt(rgbMatch[3], 10),
      };
    }

    return null;
  }
}
