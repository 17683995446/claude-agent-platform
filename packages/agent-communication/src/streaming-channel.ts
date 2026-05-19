// src/streaming-channel.ts - 流式通信通道

export type StreamEvent = 'data' | 'end' | 'error' | 'pause' | 'resume';

export interface StreamOptions {
  bufferSize?: number;
  highWaterMark?: number;
  lowWaterMark?: number;
  chunkSize?: number;
}

export interface AgentStream {
  id: string;
  topic: string;
  write(data: unknown): boolean;
  read(): Promise<unknown>;
  close(): void;
  pipe(destination: AgentStream): void;
  unpipe(): void;
  on(event: StreamEvent, handler: (...args: unknown[]) => void): void;
  pause(): void;
  resume(): void;
  getBufferedCount(): number;
  isClosed: boolean;
  isPaused: boolean;
}

type StreamEventHandler = (...args: unknown[]) => void;

class AgentStreamImpl implements AgentStream {
  id: string;
  topic: string;
  isClosed = false;
  isPaused = false;

  private buffer: unknown[] = [];
  private bufferSize: number;
  private highWaterMark: number;
  private lowWaterMark: number;
  private waiters: Array<{ resolve: (data: unknown) => void; reject: (err: Error) => void }> = [];
  private eventHandlers: Map<StreamEvent, StreamEventHandler[]> = new Map();
  private pipedTo: AgentStreamImpl | null = null;
  private pipeDataHandler: ((data: unknown) => void) | null = null;
  private pipeEndHandler: (() => void) | null = null;

  constructor(id: string, topic: string, options: StreamOptions = {}) {
    this.id = id;
    this.topic = topic;
    this.bufferSize = options.bufferSize ?? 100;
    this.highWaterMark = options.highWaterMark ?? 80;
    this.lowWaterMark = options.lowWaterMark ?? 20;
  }

  write(data: unknown): boolean {
    if (this.isClosed) return false;

    if (this.buffer.length >= this.bufferSize) {
      this.emit('error', new Error('Buffer overflow'));
      return false;
    }

    this.buffer.push(data);

    // Backpressure: pause if high water mark reached
    if (this.buffer.length >= this.highWaterMark && !this.isPaused) {
      this.isPaused = true;
      this.emit('pause');
    }

    // COMM-17: Shift from buffer before resolving waiter to prevent duplicate delivery
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      const bufferedData = this.buffer.shift()!;
      waiter.resolve(bufferedData);
    }

    this.emit('data', data);
    return true;
  }

  async read(): Promise<unknown> {
    if (this.buffer.length > 0) {
      const data = this.buffer.shift()!;

      // Backpressure: resume if low water mark reached
      if (this.isPaused && this.buffer.length <= this.lowWaterMark) {
        this.isPaused = false;
        this.emit('resume');
      }

      return data;
    }

    // COMM-4: Push waiter first, then check isClosed to avoid TOCTOU race
    return new Promise<unknown>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      if (this.isClosed) {
        // Remove the waiter we just added and reject
        const idx = this.waiters.findIndex(w => w.reject === reject);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error('Stream is closed'));
      }
    });
  }

  close(): void {
    this.isClosed = true;
    // COMM-16: Clear buffer on close
    this.buffer = [];
    this.emit('end');
    // Reject remaining waiters
    for (const waiter of this.waiters) {
      waiter.reject(new Error('Stream closed'));
    }
    this.waiters = [];
  }

  pipe(destination: AgentStream): void {
    // COMM-3: Clean up any existing pipe first
    this.unpipe();

    if (destination instanceof AgentStreamImpl) {
      this.pipedTo = destination;
    }
    this.pipeDataHandler = (data: unknown) => {
      destination.write(data);
    };
    this.pipeEndHandler = () => {
      destination.close();
    };
    this.on('data', this.pipeDataHandler);
    this.on('end', this.pipeEndHandler);
  }

  unpipe(): void {
    if (this.pipeDataHandler) {
      const dataHandlers = this.eventHandlers.get('data');
      if (dataHandlers) {
        const idx = dataHandlers.indexOf(this.pipeDataHandler);
        if (idx !== -1) dataHandlers.splice(idx, 1);
      }
      this.pipeDataHandler = null;
    }
    if (this.pipeEndHandler) {
      const endHandlers = this.eventHandlers.get('end');
      if (endHandlers) {
        const idx = endHandlers.indexOf(this.pipeEndHandler);
        if (idx !== -1) endHandlers.splice(idx, 1);
      }
      this.pipeEndHandler = null;
    }
    this.pipedTo = null;
  }

  on(event: StreamEvent, handler: StreamEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  pause(): void {
    this.isPaused = true;
    this.emit('pause');
  }

  resume(): void {
    this.isPaused = false;
    this.emit('resume');
  }

  getBufferedCount(): number {
    return this.buffer.length;
  }

  private emit(event: StreamEvent, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args);
        } catch {
          // Handler error
        }
      }
    }
  }
}

export class StreamingChannel {
  private streams: Map<string, AgentStreamImpl> = new Map();
  private streamCounter = 0;

  createStream(topic: string, options?: StreamOptions): AgentStream {
    const id = `stream_${++this.streamCounter}`;
    const stream = new AgentStreamImpl(id, topic, options);
    this.streams.set(id, stream);
    return stream;
  }

  getStream(streamId: string): AgentStream | undefined {
    return this.streams.get(streamId);
  }

  closeStream(streamId: string): boolean {
    const stream = this.streams.get(streamId);
    if (!stream) return false;
    stream.close();
    // COMM-34: Delete from map after close completes, not before
    this.streams.delete(streamId);
    return true;
  }

  getActiveStreamCount(): number {
    return this.streams.size;
  }

  closeAll(): void {
    for (const stream of this.streams.values()) {
      stream.close();
    }
    this.streams.clear();
  }

  reset(): void {
    this.closeAll();
    this.streamCounter = 0;
  }
}
