/**
 * Knowledge Graph Package - Main entry point.
 *
 * Exports all modules for knowledge graph construction, querying, and reasoning.
 */

// Core graph storage
export { GraphStore } from './graph-store.js';
export type { GraphNode, GraphEdge, Direction, GraphChangeEvent, GraphChangeEventType, GraphChangeListener } from './graph-store.js';

// Query language
export { GraphQuery } from './graph-query.js';
export type { MatchPattern, WhereCondition, Projection, QueryResult, PathResult, SortDirection } from './graph-query.js';

// Graph algorithms
export { GraphAlgorithms } from './graph-algorithms.js';
export type { VisitFn, WeightFn, ShortestPathResult, CentralityResult, CommunityResult, CentralityType, CommunityAlgorithm } from './graph-algorithms.js';

// Ontology management
export { OntologyManager } from './ontology-manager.js';
export type { PropertyConstraints, ClassDefinition, PropertyDefinition, RelationDefinition, ValidationResult, HierarchyNode } from './ontology-manager.js';

// Triple store
export { TripleStore } from './triple-store.js';
export type { Triple, TriplePattern, SparqlResult } from './triple-store.js';

// Reasoning engine
export { ReasoningEngine } from './reasoning-engine.js';
export type { Fact, Rule, ForwardChainResult, BackwardChainResult, AbductiveResult, DefaultReasoningResult, TemporalEvent, TemporalReasoningResult, ExplanationResult } from './reasoning-engine.js';

// Embedding index
export { EmbeddingIndex } from './embedding-index.js';
export type { EmbeddingEntry, SimilarityResult, ClusterResult, EmbedFn, ClusteringAlgorithm } from './embedding-index.js';

// Graph visualizer
export { GraphVisualizer } from './graph-visualizer.js';
export type { LayoutAlgorithm, LayoutOptions, NodePosition, LayoutResult, SubgraphResult, ColorScheme } from './graph-visualizer.js';

// Temporal graph
export { TemporalGraph } from './temporal-graph.js';
export type { ChangeType, TemporalChange, TimelineEntry, GraphState } from './temporal-graph.js';

// Import/export
export { GraphImportExport } from './graph-import-export.js';
export type { JSONGraphFormat, MergeStrategy, GraphDiff } from './graph-import-export.js';
