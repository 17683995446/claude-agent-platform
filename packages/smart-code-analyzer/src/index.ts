/**
 * Smart Code Analyzer - Intelligent Code Analysis Toolkit
 *
 * A comprehensive toolkit for analyzing TypeScript/JavaScript code,
 * including AST parsing, dependency analysis, pattern detection,
 * code smell detection, type inference, mutation testing, impact analysis,
 * clone detection, security scanning, and metrics collection.
 */

export { ASTParser } from "./ast-parser.js";
export type {
  SupportedLanguage,
  SourcePosition,
  SourceRange,
  ImportInfo,
  FunctionInfo,
  ClassInfo,
  TypeInfo,
  ASTNode,
  AST,
  ComplexityMetrics,
} from "./ast-parser.js";

export { DependencyGraph } from "./dependency-graph.js";
export type {
  NodeMeta,
  EdgeType,
  DependencyEdge,
  DependencyNode,
  DependencyCycle,
  TopologicalOrder,
  CriticalPathInfo,
} from "./dependency-graph.js";

export { PatternDetector } from "./pattern-detector.js";
export type {
  DetectedPattern,
  SingletonInfo,
  FactoryInfo,
  ObserverInfo,
  StrategyInfo,
  DecoratorInfo,
} from "./pattern-detector.js";

export { CodeSmellAnalyzer } from "./code-smell-analyzer.js";
export type {
  SmellSeverity,
  CodeSmell,
  ShotgunSurgeryResult,
  FileAnalysis,
} from "./code-smell-analyzer.js";

export { TypeInference } from "./type-inference.js";
export type {
  InferredType,
  ParameterTypeInference,
  VariableAssignment,
  FileTypeMap,
} from "./type-inference.js";

export { MutationTester } from "./mutation-tester.js";
export type {
  MutationType,
  Mutation,
  MutationResult,
  MutationTestResults,
  TestRunner,
} from "./mutation-tester.js";

export { ImpactAnalyzer } from "./impact-analyzer.js";
export type {
  ChangeType,
  ChangeInfo,
  RiskAssessment,
  RequiredTest,
  ImpactReport,
} from "./impact-analyzer.js";

export { CloneDetector } from "./clone-detector.js";
export type {
  CodeClone,
  CloneFragment,
  CloneMetrics,
  RefactoringSuggestion,
  CloneFile,
} from "./clone-detector.js";

export { SecurityScanner } from "./security-scanner.js";
export type {
  VulnerabilitySeverity,
  Vulnerability,
  DependencyInfo,
  SecurityReport,
} from "./security-scanner.js";

export { MetricsCollector } from "./metrics-collector.js";
export type {
  FileMetrics,
  ProjectMetrics,
  MetricsHistoryEntry,
  MetricsComparison,
  MetricsReport,
  MetricsFile,
} from "./metrics-collector.js";
