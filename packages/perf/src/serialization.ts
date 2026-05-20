// ============================================================================
// @claude-agent/perf - SerializationOptimization
// JSON 流式序列化、二进制序列化（MessagePack 风格）、零拷贝传输、压缩传输
// ============================================================================

import { deflateSync, inflateSync } from 'node:zlib';

// ---- Binary Encoder (MessagePack-inspired) ----

export type BinaryValue =
  | null
  | boolean
  | number
  | string
  | BinaryValue[]
  | { [key: string]: BinaryValue }
  | Uint8Array;

export interface BinaryEncodeResult {
  buffer: Uint8Array;
  size: number;
}

export interface BinaryDecoderState {
  offset: number;
  view: DataView;
  buffer: Uint8Array;
}

export class BinaryEncoder {
  private buffer: Uint8Array;
  private offset = 0;
  private view: DataView;

  constructor(initialSize: number = 1024) {
    this.buffer = new Uint8Array(initialSize);
    this.view = new DataView(this.buffer.buffer);
  }

  /** 编码值为二进制 */
  encode(value: BinaryValue): BinaryEncodeResult {
    this.writeValue(value);
    return {
      buffer: this.buffer.slice(0, this.offset),
      size: this.offset,
    };
  }

  private ensureCapacity(needed: number): void {
    if (this.offset + needed <= this.buffer.length) return;

    let newSize = this.buffer.length;
    while (newSize < this.offset + needed) {
      newSize *= 2;
    }

    const newBuffer = new Uint8Array(newSize);
    newBuffer.set(this.buffer);
    this.buffer = newBuffer;
    this.view = new DataView(this.buffer.buffer);
  }

  private writeByte(value: number): void {
    this.ensureCapacity(1);
    this.buffer[this.offset++] = value;
  }

  private writeUint16(value: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, value);
    this.offset += 2;
  }

  private writeUint32(value: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, value);
    this.offset += 4;
  }

  private writeFloat64(value: number): void {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, value);
    this.offset += 8;
  }

  private writeBytes(data: Uint8Array): void {
    this.ensureCapacity(data.length);
    this.buffer.set(data, this.offset);
    this.offset += data.length;
  }

  private writeString(str: string): void {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    this.writeLength(bytes.length);
    this.writeBytes(bytes);
  }

  private writeLength(len: number): void {
    if (len < 32) {
      this.writeByte(0xa0 | len); // fixstr
    } else if (len < 256) {
      this.writeByte(0xd9); // str 8
      this.writeByte(len);
    } else if (len < 65536) {
      this.writeByte(0xda); // str 16
      this.writeUint16(len);
    } else {
      this.writeByte(0xdb); // str 32
      this.writeUint32(len);
    }
  }

  private writeValue(value: BinaryValue): void {
    if (value === null) {
      this.writeByte(0xc0); // nil
    } else if (value === true) {
      this.writeByte(0xc3); // true
    } else if (value === false) {
      this.writeByte(0xc2); // false
    } else if (typeof value === 'number') {
      if (Number.isInteger(value) && value >= 0 && value < 128) {
        this.writeByte(value); // positive fixint
      } else if (Number.isInteger(value) && value < 0 && value >= -32) {
        this.writeByte(0xe0 | (value + 32)); // negative fixint
      } else if (Number.isInteger(value) && value >= 0 && value < 256) {
        this.writeByte(0xcc); // uint8
        this.writeByte(value);
      } else if (Number.isInteger(value) && value >= 0 && value < 65536) {
        this.writeByte(0xcd); // uint16
        this.writeUint16(value);
      } else if (Number.isInteger(value) && value >= 0 && value < 4294967296) {
        this.writeByte(0xce); // uint32
        this.writeUint32(value);
      } else {
        this.writeByte(0xcb); // float64
        this.writeFloat64(value);
      }
    } else if (typeof value === 'string') {
      this.writeString(value);
    } else if (value instanceof Uint8Array) {
      this.writeByte(0xc4); // bin 8
      this.writeByte(value.length);
      this.writeBytes(value);
    } else if (Array.isArray(value)) {
      if (value.length < 16) {
        this.writeByte(0x90 | value.length); // fixarray
      } else if (value.length < 65536) {
        this.writeByte(0xdc); // array 16
        this.writeUint16(value.length);
      } else {
        this.writeByte(0xdd); // array 32
        this.writeUint32(value.length);
      }
      for (const item of value) {
        this.writeValue(item);
      }
    } else if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length < 16) {
        this.writeByte(0x80 | keys.length); // fixmap
      } else if (keys.length < 65536) {
        this.writeByte(0xde); // map 16
        this.writeUint16(keys.length);
      } else {
        this.writeByte(0xdf); // map 32
        this.writeUint32(keys.length);
      }
      for (const key of keys) {
        this.writeString(key);
        this.writeValue(value[key]!);
      }
    }
  }
}

export class BinaryDecoder {
  decode(buffer: Uint8Array): BinaryValue {
    const state: BinaryDecoderState = {
      offset: 0,
      view: new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      buffer,
    };
    return this.readValue(state);
  }

  private readValue(state: BinaryDecoderState): BinaryValue {
    if (state.offset >= state.buffer.length) {
      throw new Error('Unexpected end of buffer');
    }

    const byte = state.buffer[state.offset++]!;

    // nil
    if (byte === 0xc0) return null;
    // false
    if (byte === 0xc2) return false;
    // true
    if (byte === 0xc3) return true;

    // positive fixint (0x00 - 0x7f)
    if (byte <= 0x7f) return byte;
    // negative fixint (0xe0 - 0xff)
    if (byte >= 0xe0) return byte - 256;

    // float64
    if (byte === 0xcb) {
      const value = state.view.getFloat64(state.offset);
      state.offset += 8;
      return value;
    }

    // uint8
    if (byte === 0xcc) {
      return state.buffer[state.offset++]!;
    }

    // uint16
    if (byte === 0xcd) {
      const value = state.view.getUint16(state.offset);
      state.offset += 2;
      return value;
    }

    // uint32
    if (byte === 0xce) {
      const value = state.view.getUint32(state.offset);
      state.offset += 4;
      return value;
    }

    // fixstr
    if (byte >= 0xa0 && byte <= 0xbf) {
      return this.readString(state, byte & 0x1f);
    }

    // str 8
    if (byte === 0xd9) {
      const len = state.buffer[state.offset++]!;
      return this.readString(state, len);
    }

    // str 16
    if (byte === 0xda) {
      const len = state.view.getUint16(state.offset);
      state.offset += 2;
      return this.readString(state, len);
    }

    // str 32
    if (byte === 0xdb) {
      const len = state.view.getUint32(state.offset);
      state.offset += 4;
      return this.readString(state, len);
    }

    // bin 8
    if (byte === 0xc4) {
      const len = state.buffer[state.offset++]!;
      const bytes = state.buffer.slice(state.offset, state.offset + len);
      state.offset += len;
      return bytes;
    }

    // fixarray
    if (byte >= 0x90 && byte <= 0x9f) {
      return this.readArray(state, byte & 0x0f);
    }

    // array 16
    if (byte === 0xdc) {
      const len = state.view.getUint16(state.offset);
      state.offset += 2;
      return this.readArray(state, len);
    }

    // array 32
    if (byte === 0xdd) {
      const len = state.view.getUint32(state.offset);
      state.offset += 4;
      return this.readArray(state, len);
    }

    // fixmap
    if (byte >= 0x80 && byte <= 0x8f) {
      return this.readMap(state, byte & 0x0f);
    }

    // map 16
    if (byte === 0xde) {
      const len = state.view.getUint16(state.offset);
      state.offset += 2;
      return this.readMap(state, len);
    }

    // map 32
    if (byte === 0xdf) {
      const len = state.view.getUint32(state.offset);
      state.offset += 4;
      return this.readMap(state, len);
    }

    throw new Error(`Unknown type byte: 0x${byte.toString(16)}`);
  }

  private readString(state: BinaryDecoderState, len: number): string {
    const bytes = state.buffer.slice(state.offset, state.offset + len);
    state.offset += len;
    return new TextDecoder().decode(bytes);
  }

  private readArray(state: BinaryDecoderState, len: number): BinaryValue[] {
    const result: BinaryValue[] = [];
    for (let i = 0; i < len; i++) {
      result.push(this.readValue(state));
    }
    return result;
  }

  private readMap(state: BinaryDecoderState, len: number): { [key: string]: BinaryValue } {
    const result: { [key: string]: BinaryValue } = {};
    for (let i = 0; i < len; i++) {
      const key = this.readValue(state) as string;
      result[key] = this.readValue(state);
    }
    return result;
  }
}

// ---- Streaming JSON Serializer ----

export interface StreamingSerializerOptions {
  /** 是否格式化输出 */
  pretty?: boolean;
  /** 是否包含类型信息 */
  includeTypeInfo?: boolean;
  /** 是否启用压缩（仅对大型负载） */
  compress?: boolean;
  /** 启用压缩的最小负载大小（字节） */
  compressThreshold?: number;
}

export class StreamingJSONSerializer {
  private options: Required<StreamingSerializerOptions>;

  constructor(options?: StreamingSerializerOptions) {
    this.options = {
      pretty: options?.pretty ?? false,
      includeTypeInfo: options?.includeTypeInfo ?? false,
      compress: options?.compress ?? false,
      compressThreshold: options?.compressThreshold ?? 1024,
    };
  }

  /** 流式序列化对象 */
  serialize(value: unknown): string {
    const seen = new WeakSet();
    const json = JSON.stringify(value, (_key, val) => {
      // Handle circular references
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) {
          return '[Circular]';
        }
        seen.add(val);
      }
      // Handle BigInt
      if (typeof val === 'bigint') {
        return { __type__: 'bigint', value: val.toString() };
      }
      // Handle Symbol
      if (typeof val === 'symbol') {
        return { __type__: 'symbol', value: val.description };
      }
      // Handle undefined
      if (typeof val === 'undefined') {
        return { __type__: 'undefined' };
      }
      // Handle Function
      if (typeof val === 'function') {
        return { __type__: 'function', name: val.name };
      }
      return val;
    }, this.options.pretty ? 2 : undefined);

    // Optional compression for large payloads
    if (this.options.compress && json.length > this.options.compressThreshold) {
      const compressed = CompressionHelper.compress(json);
      // Return base64-encoded compressed data with a marker
      return `__COMPRESSED__:${Buffer.from(compressed.data).toString('base64')}`;
    }

    return json;
  }

  /** 流式反序列化 */
  deserialize<T = unknown>(json: string): T {
    // Handle compressed data
    if (json.startsWith('__COMPRESSED__:')) {
      const base64 = json.slice('__COMPRESSED__:'.length);
      const compressed = Uint8Array.from(Buffer.from(base64, 'base64'));
      const decompressed = CompressionHelper.decompress(compressed);
      json = new TextDecoder().decode(decompressed);
    }

    return JSON.parse(json, (_key, val) => {
      if (val && typeof val === 'object' && val.__type__) {
        switch (val.__type__) {
          case 'bigint':
            return BigInt(val.value);
          case 'symbol':
            return Symbol(val.value);
          case 'undefined':
            return undefined;
          case 'function':
            return new Function(`return function ${val.name || 'anonymous'}() {}`)();
          default:
            return val;
        }
      }
      return val;
    }) as T;
  }

  /** 分块序列化（模拟流式处理） */
  *serializeChunks(value: unknown, chunkSize: number = 1024): Generator<string> {
    const json = this.serialize(value);
    for (let i = 0; i < json.length; i += chunkSize) {
      yield json.slice(i, i + chunkSize);
    }
  }
}

// ---- Compression Helper ----

export interface CompressionResult {
  data: Uint8Array;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}

export class CompressionHelper {
  /** 压缩数据 */
  static compress(data: Uint8Array | string, level: number = 6): CompressionResult {
    const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const compressed = deflateSync(input, { level });
    return {
      data: compressed,
      originalSize: input.length,
      compressedSize: compressed.length,
      compressionRatio: Math.round((compressed.length / input.length) * 10000) / 100,
    };
  }

  /** 解压数据 */
  static decompress(data: Uint8Array): Uint8Array {
    return inflateSync(data);
  }

  /** 压缩 JSON 字符串 */
  static compressJSON(obj: unknown, level: number = 6): CompressionResult {
    const json = JSON.stringify(obj);
    return CompressionHelper.compress(json, level);
  }
}

// ---- Serialization Benchmark Helper ----

export interface SerializationBenchmarkResult {
  operation: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  opsPerSecond: number;
  dataSize: number;
}

export class SerializationBenchmark {
  static async run(
    name: string,
    fn: () => void,
    iterations: number = 10000,
  ): Promise<SerializationBenchmarkResult> {
    // Warmup
    for (let i = 0; i < Math.min(iterations / 10, 100); i++) {
      fn();
    }

    const startTime = Date.now();
    for (let i = 0; i < iterations; i++) {
      fn();
    }
    const totalTime = Date.now() - startTime;

    return {
      operation: name,
      iterations,
      totalTime,
      avgTime: Math.round((totalTime / iterations) * 1000) / 1000,
      opsPerSecond: Math.round((iterations / totalTime) * 1000),
      dataSize: 0,
    };
  }
}
