// src/index.ts - Data Pipeline Package
// Export all modules

export { PipelineBuilder, type BatchOptions, type Pipeline, type PipelineStage } from './pipeline-builder.ts';
export { DataTransformEngine, type TransformFn, type TransformSpec } from './data-transform.ts';
export { DataValidator, type ValidationError, type ValidationResult, type ValidationRule, type ValidationSchema, type CrossFieldRule } from './data-validator.ts';
export { StreamProcessor, type AggregationFn, type WindowOptions, type ThrottleOptions, type DebounceOptions } from './stream-processor.ts';
export { ETLEngine, type ETLConfig, type ETLResult, type ExtractorConfig, type LoaderConfig, type TransformerConfig, type ErrorStrategy, type ProgressCallback, type Extractor, type Loader } from './etl-engine.ts';
export { DataAggregator, type DataPoint, type TimeSeriesPoint, type TimeInterval, type AggregationConfig, type AggregationResult, type TimeSeriesResult } from './data-aggregator.ts';
export { DataJoiner, type DataRecord as JoinDataRecord, type JoinType, type JoinCondition, type JoinConfig, type FuzzyJoinConfig } from './data-join.ts';
export { DataCleanser, type DataRecord as CleansingDataRecord, type NullHandlingStrategy, type OutlierMethod, type NormalizationMethod, type CleansingRule, type OutlierResult } from './data-cleansing.ts';
export { DataSchemaManager, type SchemaField, type SchemaDefinition, type SchemaDiff, type MigrationStep, type ValidationResult as SchemaValidationResult } from './data-schema.ts';
export { PipelineMonitor, type ProcessingEvent, type PipelineHealth, type AlertRule, type Alert, type PipelineDashboard, type DataQualityMetrics } from './pipeline-monitor.ts';
