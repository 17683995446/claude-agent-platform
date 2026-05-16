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
  write(data: unknown): void;
  read(): Promise<unknown>;
  close(): void;
  pipe(destination: AgentStream): void;
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

  constructor(id: string, topic: string, options: StreamOptions = {}) {
    this.id = id;
    this.topic = topic;
    this.bufferSize = options.bufferSize ?? 100;
    this.highWaterMark = options.highWaterMark ?? 80;
    this.lowWaterMark = options.lowWaterMark ?? 20;
  }

  write(data: unknown): void {
    if (this.isClosed) return;

    if (this.buffer.length >= this.bufferSize) {
      this.emit('error', new Error('Buffer overflow'));
      return;
    }

    this.buffer.push(data);

    // Backpressure: pause if high water mark reached
    if (this.buffer.length >= this.highWaterMark && !this.isPaused) {
      this.isPaused = true;
      this.emit('pause');
    }

    // Resolve waiters
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.resolve(data);
    }

    this.emit('data', data);
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

    if (this.isClosed) {
      throw new Error('Stream is closed');
    }

    return new Promise<unknown>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  close(): void {
    this.isClosed = true;
    this.emit('end');
    // Reject remaining waiters
    for (const waiter of this.waiters) {
      waiter.reject(new Error('Stream closed'));
    }
    this.waiters = [];
  }

  pipe(destination: AgentStream): void {
    if (destination instanceof AgentStreamImpl) {
      this.pipedTo = destination;
    }
    this.on('data', (data: unknown) => {
      destination.write(data);
    });
    this.on('end', () => {
      destination.close();
    });
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
