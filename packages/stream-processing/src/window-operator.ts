// window-operator.ts - Time and count-based windowing

export class WindowOperator<T> {
  private windowSize: number;
  private slideSize: number;
  private currentWindow: T[] = [];
  private windowsEmitted = 0;
  private eventsProcessed = 0;
  private timeMode = false;
  private durationMs = 0;
  private slideMs = 0;
  private windowStartTime = 0;
  private slideStartTime = 0;

  constructor(windowSize: number, slideSize?: number) {
    // BUG-4 fix: ensure windowSize >= 1 to prevent infinite loop
    this.windowSize = Math.max(1, windowSize);
    this.slideSize = Math.max(1, slideSize ?? windowSize);
    this.windowStartTime = Date.now();
    this.slideStartTime = Date.now();
  }

  static timeWindow<T>(durationMs: number, slideMs?: number): WindowOperator<T> {
    const op = new WindowOperator<T>(durationMs, slideMs ?? durationMs);
    op.timeMode = true;
    op.durationMs = durationMs;
    op.slideMs = slideMs ?? durationMs;
    op.windowStartTime = Date.now();
    op.slideStartTime = Date.now();
    return op;
  }

  add(event: T): T[][] {
    this.eventsProcessed++;
    const completed: T[][] = [];

    if (this.timeMode) {
      const now = Date.now();
      this.currentWindow.push(event);

      // Check if slide has elapsed
      if (now - this.slideStartTime >= this.slideMs) {
        // Emit window if enough time has passed since window start
        if (now - this.windowStartTime >= this.durationMs) {
          completed.push([...this.currentWindow]);
          this.windowsEmitted++;
          this.currentWindow = [];
          this.windowStartTime = now;
        }
        this.slideStartTime = now;
      }
    } else {
      // Count-based windowing
      this.currentWindow.push(event);

      // BUG-3 fix: ensure slideSize does not exceed windowSize to prevent event loss
      const effectiveSlide = Math.min(this.slideSize, this.windowSize);
      while (this.currentWindow.length >= this.windowSize) {
        completed.push(this.currentWindow.slice(0, this.windowSize));
        this.windowsEmitted++;
        this.currentWindow = this.currentWindow.slice(effectiveSlide);
      }
    }

    return completed;
  }

  flush(): T[] {
    const remaining = [...this.currentWindow];
    this.currentWindow = [];
    return remaining;
  }

  reset(): void {
    this.currentWindow = [];
    this.windowsEmitted = 0;
    this.eventsProcessed = 0;
    this.windowStartTime = Date.now();
    this.slideStartTime = Date.now();
  }

  getStats(): { windowsEmitted: number; eventsProcessed: number; currentWindowSize: number } {
    return {
      windowsEmitted: this.windowsEmitted,
      eventsProcessed: this.eventsProcessed,
      currentWindowSize: this.currentWindow.length,
    };
  }
}
