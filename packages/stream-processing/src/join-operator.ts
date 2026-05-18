// join-operator.ts - Join multiple streams

export class JoinOperator<TLeft, TRight> {
  private leftKey: (e: TLeft) => string;
  private rightKey: (e: TRight) => string;
  private windowMs: number;
  private leftBuffer: Array<{ event: TLeft; timestamp: number }> = [];
  private rightBuffer: Array<{ event: TRight; timestamp: number }> = [];
  private joins: Array<{ left: TLeft; right: TRight }> = [];
  private leftCount = 0;
  private rightCount = 0;

  constructor(options: {
    leftKey: (e: TLeft) => string;
    rightKey: (e: TRight) => string;
    windowMs?: number;
  }) {
    this.leftKey = options.leftKey;
    this.rightKey = options.rightKey;
    this.windowMs = options.windowMs ?? Infinity;
  }

  addLeft(event: TLeft): void {
    this.leftCount++;
    const key = this.leftKey(event);
    const now = Date.now();

    // Try to match with right buffer
    const rightIdx = this.rightBuffer.findIndex(
      (r) => this.rightKey(r.event) === key && (now - r.timestamp <= this.windowMs || this.windowMs === Infinity)
    );

    if (rightIdx >= 0) {
      const rightEvent = this.rightBuffer[rightIdx]!;
      this.joins.push({ left: event, right: rightEvent.event });
      this.rightBuffer.splice(rightIdx, 1);
    } else {
      this.leftBuffer.push({ event, timestamp: now });
    }

    this.evictLeft();
  }

  addRight(event: TRight): void {
    this.rightCount++;
    const key = this.rightKey(event);
    const now = Date.now();

    // Try to match with left buffer
    const leftIdx = this.leftBuffer.findIndex(
      (l) => this.leftKey(l.event) === key && (now - l.timestamp <= this.windowMs || this.windowMs === Infinity)
    );

    if (leftIdx >= 0) {
      const leftEvent = this.leftBuffer[leftIdx]!;
      this.joins.push({ left: leftEvent.event, right: event });
      this.leftBuffer.splice(leftIdx, 1);
    } else {
      this.rightBuffer.push({ event, timestamp: now });
    }

    this.evictRight();
  }

  getJoins(): Array<{ left: TLeft; right: TRight }> {
    return [...this.joins];
  }

  getLeftUnmatched(): TLeft[] {
    this.evictLeft();
    return this.leftBuffer.map((l) => l.event);
  }

  getRightUnmatched(): TRight[] {
    this.evictRight();
    return this.rightBuffer.map((r) => r.event);
  }

  flush(): void {
    this.leftBuffer = [];
    this.rightBuffer = [];
    this.joins = [];
  }

  getStats(): {
    leftCount: number;
    rightCount: number;
    joinCount: number;
    leftUnmatched: number;
    rightUnmatched: number;
  } {
    this.evictLeft();
    this.evictRight();
    return {
      leftCount: this.leftCount,
      rightCount: this.rightCount,
      joinCount: this.joins.length,
      leftUnmatched: this.leftBuffer.length,
      rightUnmatched: this.rightBuffer.length,
    };
  }

  private evictLeft(): void {
    if (this.windowMs === Infinity) return;
    const now = Date.now();
    this.leftBuffer = this.leftBuffer.filter((l) => now - l.timestamp <= this.windowMs);
  }

  private evictRight(): void {
    if (this.windowMs === Infinity) return;
    const now = Date.now();
    this.rightBuffer = this.rightBuffer.filter((r) => now - r.timestamp <= this.windowMs);
  }
}
