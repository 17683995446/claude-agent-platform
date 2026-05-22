// src/progress-display.ts - 进度显示模块

export type ProgressStyle = 'standard' | 'blocks' | 'emoji' | 'minimal';

export interface ProgressOptions {
  label?: string;
  style?: ProgressStyle;
  width?: number;
  showPercent?: boolean;
  showCount?: boolean;
  showETA?: boolean;
  showThroughput?: boolean;
}

export interface ProgressState {
  current: number;
  total: number;
  startTime: number;
  label?: string;
  style: ProgressStyle;
  width: number;
  showPercent: boolean;
  showCount: boolean;
  showETA: boolean;
  showThroughput: boolean;
  running: boolean;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class ProgressBar {
  private state: ProgressState | null = null;
  private spinnerFrame: number = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private renderedLines: number = 0;

  /**
   * 启动确定进度条（已知总数）
   */
  start(total: number, label?: string): void {
    this.stop(); // Clean up any existing

    this.state = {
      current: 0,
      total,
      startTime: Date.now(),
      label,
      style: 'standard',
      width: 40,
      showPercent: true,
      showCount: true,
      showETA: false,
      showThroughput: false,
      running: true,
    };

    this.render();
  }

  /**
   * 使用自定义选项启动
   */
  startWithOptions(total: number, options: ProgressOptions): void {
    this.stop();

    this.state = {
      current: 0,
      total,
      startTime: Date.now(),
      label: options.label,
      style: options.style ?? 'standard',
      width: options.width ?? 40,
      showPercent: options.showPercent ?? true,
      showCount: options.showCount ?? true,
      showETA: options.showETA ?? false,
      showThroughput: options.showThroughput ?? false,
      running: true,
    };

    this.render();
  }

  /**
   * 更新当前进度
   */
  update(current: number): void {
    if (!this.state || !this.state.running) return;
    this.state.current = Math.min(Math.max(0, current), this.state.total);
    this.render();
  }

  /**
   * 递增进度
   */
  increment(step: number = 1): void {
    if (!this.state || !this.state.running) return;
    this.state.current = Math.min(Math.max(0, this.state.current + step), this.state.total);
    this.render();
  }

  /**
   * 停止进度条
   */
  stop(message?: string): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }

    if (this.state && this.state.running) {
      this.state.running = false;
      if (message) {
        this.clearLines();
        console.log(message);
      } else {
        this.render(); // Final render at 100%
        console.log(''); // New line
      }
    }

    this.state = null;
    this.renderedLines = 0;
  }

  /**
   * 启动不确定进度（旋转器）
   */
  startSpinner(label?: string): void {
    this.stop();

    this.state = {
      current: 0,
      total: 0,
      startTime: Date.now(),
      label,
      style: 'standard',
      width: 40,
      showPercent: false,
      showCount: false,
      showETA: false,
      showThroughput: false,
      running: true,
    };

    this.spinnerFrame = 0;
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.renderSpinner();
    }, 80);
  }

  /**
   * 更新旋转器标签
   */
  updateSpinnerLabel(label: string): void {
    if (this.state) {
      this.state.label = label;
    }
  }

  /**
   * 获取当前进度百分比
   */
  getPercentage(): number {
    if (!this.state || this.state.total === 0) return 0;
    return Math.round((this.state.current / this.state.total) * 100);
  }

  /**
   * 获取预计剩余时间（毫秒）
   */
  getETA(): number {
    if (!this.state || this.state.current === 0) return 0;
    const elapsed = Date.now() - this.state.startTime;
    const rate = this.state.current / elapsed;
    const remaining = this.state.total - this.state.current;
    return Math.round(remaining / rate);
  }

  /**
   * 获取吞吐量（项/秒）
   */
  getThroughput(): number {
    if (!this.state) return 0;
    const elapsed = (Date.now() - this.state.startTime) / 1000;
    if (elapsed === 0) return 0;
    return this.state.current / elapsed;
  }

  /**
   * 获取进度状态
   */
  getState(): ProgressState | null {
    return this.state ? { ...this.state } : null;
  }

  /**
   * 格式化进度条字符串
   */
  formatBar(style: ProgressStyle, percent: number, width: number): string {
    const filled = Math.round((percent / 100) * width);

    switch (style) {
      case 'standard':
        return `[${'='.repeat(filled)}${' '.repeat(width - filled)}]`;
      case 'blocks':
        return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
      case 'emoji':
        return `[${'🟩'.repeat(filled)}${'⬜'.repeat(width - filled)}]`;
      case 'minimal':
        return `${'>'.repeat(filled)}${'.'.repeat(width - filled)}`;
      default:
        return `[${'='.repeat(filled)}${' '.repeat(width - filled)}]`;
    }
  }

  /**
   * 格式化时间
   */
  formatTime(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  private render(): void {
    if (!this.state) return;

    const percent = this.state.total > 0
      ? Math.round((this.state.current / this.state.total) * 100)
      : 0;

    const bar = this.formatBar(this.state.style, percent, this.state.width);
    let output = '';

    if (this.state.label) {
      output += `${this.state.label} `;
    }
    output += bar;

    if (this.state.showPercent) {
      output += ` ${percent}%`;
    }

    if (this.state.showCount) {
      output += ` (${this.state.current}/${this.state.total})`;
    }

    if (this.state.showETA && this.state.current > 0) {
      const eta = this.getETA();
      output += ` ETA: ${this.formatTime(eta)}`;
    }

    if (this.state.showThroughput && this.state.current > 0) {
      const throughput = this.getThroughput();
      output += ` ${throughput.toFixed(1)} items/s`;
    }

    this.clearLines();
    process.stdout.write(output);
    this.renderedLines = 1;
  }

  private renderSpinner(): void {
    if (!this.state) return;

    const frame = SPINNER_FRAMES[this.spinnerFrame];
    let output = '';

    if (this.state.label) {
      output += `${this.state.label} `;
    }
    output += frame;

    const elapsed = this.formatTime(Date.now() - this.state.startTime);
    output += ` ${elapsed}`;

    this.clearLines();
    process.stdout.write(output);
    this.renderedLines = 1;
  }

  private clearLines(): void {
    for (let i = 0; i < this.renderedLines; i++) {
      process.stdout.write('\r\x1b[K');
    }
  }
}

/**
 * 多进度条管理器
 */
export class MultiProgress {
  private bars: Map<string, ProgressBar> = new Map();
  private order: string[] = [];

  add(id: string, total: number, label?: string): ProgressBar {
    const bar = new ProgressBar();
    this.bars.set(id, bar);
    this.order.push(id);
    return bar;
  }

  get(id: string): ProgressBar | undefined {
    return this.bars.get(id);
  }

  remove(id: string): void {
    const bar = this.bars.get(id);
    if (bar) bar.stop();
    this.bars.delete(id);
    this.order = this.order.filter(i => i !== id);
  }

  stopAll(): void {
    for (const bar of this.bars.values()) {
      bar.stop();
    }
    this.bars.clear();
    this.order = [];
  }

  getAll(): Map<string, ProgressBar> {
    return new Map(this.bars);
  }

  getIds(): string[] {
    return [...this.order];
  }
}
