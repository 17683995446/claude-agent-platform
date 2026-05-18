// stream-replay.ts - Replay events from streams

import { EventStream } from './event-stream.js';

export class StreamReplay<T> {
  private recorded: Array<{ event: T; timestamp: number }> = [];
  private recording = false;
  private recordingStart = 0;
  private replayCount = 0;
  private subscription: { unsubscribe: () => void } | undefined;

  record(stream: EventStream<T>): void {
    this.recorded = [];
    this.recording = true;
    this.recordingStart = Date.now();
    this.subscription = stream.subscribe((event) => {
      if (this.recording) {
        this.recorded.push({ event, timestamp: Date.now() });
      }
    });
  }

  stopRecording(): T[] {
    this.recording = false;
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
    }
    return this.recorded.map((r) => r.event);
  }

  replay(events: T[], speed?: number): EventStream<T> {
    const stream = new EventStream<T>();

    if (events.length === 0) return stream;

    // Publish all events synchronously
    for (const event of events) {
      stream.publish(event);
      this.replayCount++;
    }

    return stream;
  }

  replayRange(start: number, end: number): T[] {
    return this.recorded.slice(start, end).map((r) => r.event);
  }

  seek(timestamp: number): T[] {
    return this.recorded.filter((r) => r.timestamp >= timestamp).map((r) => r.event);
  }

  getRecordedEvents(): T[] {
    return this.recorded.map((r) => r.event);
  }

  getStats(): { totalRecorded: number; replayCount: number; recordingDuration: number } {
    return {
      totalRecorded: this.recorded.length,
      replayCount: this.replayCount,
      recordingDuration: this.recordingStart > 0 ? Date.now() - this.recordingStart : 0,
    };
  }
}
