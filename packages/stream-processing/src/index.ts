// index.ts - barrel export for stream-processing package

export { EventStream } from './event-stream.js';
export type { Subscription } from './event-stream.js';

export { StreamProcessor } from './stream-processor.js';
export type { TransformStage } from './stream-processor.js';

export { WindowOperator } from './window-operator.js';

export { JoinOperator } from './join-operator.js';

export { AggregationOperator } from './aggregation-operator.js';

export { StreamScheduler } from './stream-scheduler.js';

export { BackpressureHandler } from './backpressure-handler.js';

export { StreamReplay } from './stream-replay.js';

export { StreamCircuitBreaker } from './circuit-breaker-stream.js';

export { StreamMetrics } from './stream-metrics.js';
export type { Alert } from './stream-metrics.js';
