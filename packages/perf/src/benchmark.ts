// ============================================================================
// @claude-agent/perf - Performance Benchmark Report Generator
// ============================================================================

import {
  ObjectPool,
  LRUCache,
  Semaphore,
  RateLimiter,
  SlidingWindowRateLimiter,
  IncrementalProcessor,
  Precomputer,
  BinaryEncoder,
  BinaryDecoder,
  CompressionHelper,
} from './index.ts';

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTimeMs: number;
  opsPerSecond: number;
  avgTimeMicros: number;
  minTimeMicros?: number;
  maxTimeMicros?: number;
  medianTimeMicros?: number;
  p95TimeMicros?: number;
  stdDevMicros?: number;
  runCount?: number;
}

const results: BenchmarkResult[] = [];

function benchmarkSync(name: string, fn: () => void, iterations: number = 100000, runs: number = 5): void {
  // Warmup
  for (let i = 0; i < Math.min(iterations / 10, 1000); i++) {
    fn();
  }

  const runTimes: number[] = [];

  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      fn();
    }
    runTimes.push(performance.now() - start);
  }

  // Compute statistics
  const totalTimeMs = runTimes.reduce((a, b) => a + b, 0);
  const avgTimeMs = totalTimeMs / runs;
  const perIterMicros = runTimes.map(t => (t / iterations) * 1000);
  const minMicros = Math.min(...perIterMicros);
  const maxMicros = Math.max(...perIterMicros);
  const sorted = [...perIterMicros].sort((a, b) => a - b);
  const medianMicros = sorted[Math.floor(sorted.length / 2)]!;
  const p95Micros = sorted[Math.floor(sorted.length * 0.95)]!;
  const mean = perIterMicros.reduce((a, b) => a + b, 0) / perIterMicros.length;
  const variance = perIterMicros.reduce((a, b) => a + (b - mean) ** 2, 0) / perIterMicros.length;
  const stdDevMicros = Math.sqrt(variance);

  results.push({
    name,
    iterations,
    totalTimeMs: Math.round(avgTimeMs * 100) / 100,
    opsPerSecond: Math.round((iterations / avgTimeMs) * 1000),
    avgTimeMicros: Math.round(mean * 1000) / 1000,
    minTimeMicros: Math.round(minMicros * 1000) / 1000,
    maxTimeMicros: Math.round(maxMicros * 1000) / 1000,
    medianTimeMicros: Math.round(medianMicros * 1000) / 1000,
    p95TimeMicros: Math.round(p95Micros * 1000) / 1000,
    stdDevMicros: Math.round(stdDevMicros * 1000) / 1000,
    runCount: runs,
  });
}

async function benchmarkAsync(name: string, fn: () => Promise<void>, iterations: number = 1000, runs: number = 3): Promise<void> {
  // Warmup
  for (let i = 0; i < Math.min(iterations / 10, 100); i++) {
    await fn();
  }

  const runTimes: number[] = [];

  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await fn();
    }
    runTimes.push(performance.now() - start);
  }

  const totalTimeMs = runTimes.reduce((a, b) => a + b, 0);
  const avgTimeMs = totalTimeMs / runs;
  const perIterMicros = runTimes.map(t => (t / iterations) * 1000);
  const mean = perIterMicros.reduce((a, b) => a + b, 0) / perIterMicros.length;

  results.push({
    name,
    iterations,
    totalTimeMs: Math.round(avgTimeMs * 100) / 100,
    opsPerSecond: Math.round((iterations / avgTimeMs) * 1000),
    avgTimeMicros: Math.round(mean * 1000) / 1000,
    runCount: runs,
  });
}

async function runBenchmarks(): Promise<void> {
  console.log('='.repeat(80));
  console.log('  @claude-agent/perf - Performance Benchmark Report');
  console.log('  Generated:', new Date().toISOString());
  console.log('='.repeat(80));
  console.log();

  // ---- ObjectPool ----
  console.log('--- ObjectPool ---');
  {
    const pool = new ObjectPool<Uint8Array>({
      factory: () => new Uint8Array(1024),
      reset: (buf) => buf.fill(0),
      initialSize: 100,
      maxSize: 1000,
      autoScale: false,
    });

    benchmarkSync('ObjectPool: acquire + release (pool hit)', () => {
      const obj = pool.acquire();
      pool.release(obj);
    }, 100000);

    pool.dispose();
  }
  console.log();

  // ---- LRUCache ----
  console.log('--- LRUCache ---');
  {
    const cache = new LRUCache<string>({ maxSize: 10000, cleanupInterval: 0 });

    benchmarkSync('LRUCache: set + get (hit)', () => {
      cache.set('key', 'value');
      cache.get('key');
    }, 100000);

    cache.dispose();
  }
  {
    const cache = new LRUCache<number>({ maxSize: 100000, cleanupInterval: 0 });
    let i = 0;
    benchmarkSync('LRUCache: set sequential keys', () => {
      cache.set(`key${i++}`, i);
    }, 100000);
    cache.dispose();
  }
  console.log();

  // ---- Semaphore ----
  console.log('--- Semaphore ---');
  {
    const sem = new Semaphore({ maxConcurrency: 10 });
    benchmarkSync('Semaphore: acquire + release (no contention)', () => {
      sem.acquire();
      sem.release();
    }, 100000);
  }
  console.log();

  // ---- RateLimiter ----
  console.log('--- RateLimiter ---');
  {
    const limiter = new RateLimiter({ maxTokens: 100000, refillRate: 1000000 });
    benchmarkSync('RateLimiter: tryAcquire', () => {
      limiter.tryAcquire();
    }, 100000);
  }
  console.log();

  // ---- SlidingWindowRateLimiter ----
  console.log('--- SlidingWindowRateLimiter ---');
  {
    const limiter = new SlidingWindowRateLimiter({ maxRequests: 100000, windowSize: 60000 });
    benchmarkSync('SlidingWindowRateLimiter: tryAcquire', () => {
      limiter.tryAcquire();
    }, 100000);
  }
  console.log();

  // ---- IncrementalProcessor ----
  console.log('--- IncrementalProcessor ---');
  {
    const processor = new IncrementalProcessor({ useContentHash: true });
    const files = new Map<string, { content: string; mtime: number }>();
    for (let i = 0; i < 100; i++) {
      files.set(`file${i}.ts`, { content: `export const x${i} = ${i};`, mtime: 1000 + i });
    }

    await benchmarkAsync('IncrementalProcessor: scan 100 files (no changes)', () => {
      return processor.scan(files);
    }, 1000);
  }
  console.log();

  // ---- BinaryEncoder/Decoder ----
  console.log('--- BinaryEncoder/Decoder ---');
  {
    const decoder = new BinaryDecoder();
    const obj = { name: 'benchmark', value: 42, items: [1, 2, 3, 4, 5], active: true };

    benchmarkSync('Binary: encode + decode object', () => {
      const enc = new BinaryEncoder();
      const { buffer } = enc.encode(obj);
      decoder.decode(buffer);
    }, 100000);
  }
  {
    const decoder = new BinaryDecoder();
    const largeObj = { data: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}`, values: [i, i + 1, i + 2] })) };

    benchmarkSync('Binary: encode + decode large object (100 items)', () => {
      const enc = new BinaryEncoder();
      const { buffer } = enc.encode(largeObj);
      decoder.decode(buffer);
    }, 10000);
  }
  console.log();

  // ---- JSON vs Binary Comparison ----
  console.log('--- JSON vs Binary Serialization Comparison ---');
  {
    const obj = { name: 'test', value: 42, items: [1, 2, 3, 4, 5], active: true, nested: { a: 1, b: 'hello' } };

    benchmarkSync('JSON.stringify', () => {
      JSON.stringify(obj);
    }, 100000);

    benchmarkSync('JSON.parse', () => {
      JSON.parse('{"name":"test","value":42,"items":[1,2,3,4,5],"active":true,"nested":{"a":1,"b":"hello"}}');
    }, 100000);

    benchmarkSync('Binary: encode (vs JSON.stringify)', () => {
      const enc = new BinaryEncoder();
      enc.encode(obj);
    }, 100000);

    const enc = new BinaryEncoder();
    const { buffer } = enc.encode(obj);
    const decoder = new BinaryDecoder();

    benchmarkSync('Binary: decode (vs JSON.parse)', () => {
      decoder.decode(buffer);
    }, 100000);
  }
  console.log();

  // ---- Compression ----
  console.log('--- Compression ---');
  {
    const data = 'abcdefghij'.repeat(1000);
    benchmarkSync('CompressionHelper: compress 10KB repetitive data', () => {
      CompressionHelper.compress(data);
    }, 1000);
  }
  console.log();

  // ---- Precomputer ----
  console.log('--- Precomputer ---');
  {
    const precomputer = new Precomputer();
    precomputer.register({
      name: 'fast-compute',
      compute: () => ({ result: Math.random() }),
    });

    // Pre-warm
    await precomputer.get('fast-compute');

    benchmarkSync('Precomputer: getSync (cached)', () => {
      precomputer.getSync('fast-compute');
    }, 100000);

    precomputer.dispose();
  }
  console.log();

  // ---- Print Report ----
  console.log('='.repeat(80));
  console.log('  BENCHMARK RESULTS SUMMARY');
  console.log('='.repeat(80));
  console.log();
  console.log(
    'Operation'.padEnd(55) +
    'Iterations'.padStart(12) +
    'Total(ms)'.padStart(12) +
    'ops/sec'.padStart(12) +
    'avg(us)'.padStart(10),
  );
  console.log('-'.repeat(101));

  for (const r of results) {
    console.log(
      r.name.padEnd(55) +
      String(r.iterations).padStart(12) +
      r.totalTimeMs.toFixed(1).padStart(12) +
      r.opsPerSecond.toLocaleString().padStart(12) +
      r.avgTimeMicros.toFixed(1).padStart(10),
    );
  }

  console.log('-'.repeat(101));
  console.log();
  console.log(`Total benchmarks: ${results.length}`);
  console.log();

  // Size comparison
  console.log('='.repeat(80));
  console.log('  SIZE COMPARISON: JSON vs Binary');
  console.log('='.repeat(80));
  console.log();

  const testObj = {
    name: 'claude-agent',
    version: '1.0.0',
    features: ['pipeline', 'plugins', 'http', 'cli'],
    config: { debug: false, port: 3000, host: 'localhost' },
    metadata: { created: '2024-01-01', updated: '2024-12-31' },
  };

  const jsonSize = JSON.stringify(testObj).length;
  const binaryEncoder = new BinaryEncoder();
  const binarySize = binaryEncoder.encode(testObj).size;
  const compressed = CompressionHelper.compress(JSON.stringify(testObj));

  console.log(`  JSON size:        ${jsonSize} bytes`);
  console.log(`  Binary size:      ${binarySize} bytes (${Math.round((binarySize / jsonSize) * 100)}% of JSON)`);
  console.log(`  Compressed size:  ${compressed.compressedSize} bytes (${compressed.compressionRatio}% of JSON)`);
  console.log();

  console.log('='.repeat(80));
  console.log('  Report complete.');
  console.log('='.repeat(80));
}

runBenchmarks().catch(console.error);
