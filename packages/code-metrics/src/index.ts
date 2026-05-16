// src/index.ts - Code Metrics Package

// Module 1: Complexity Analyzer
export { ComplexityAnalyzer } from './complexity-analyzer.js';
export type { ComplexityResult, ComplexityWarning, DirectoryComplexityResult, ComplexityThreshold } from './complexity-analyzer.js';

// Module 2: Dependency Analyzer
export { DependencyAnalyzer } from './dependency-analyzer.js';
export type { FileEntry, DependencyNode, DependencyGraph, DependencyEdge, DependencyType, DependencyMetrics } from './dependency-analyzer.js';

// Module 3: Duplication Detector
export { DuplicationDetector } from './duplication-detector.js';
export type { DetectionOptions, DuplicationResult, ClonePair, CloneType, DuplicationSummary } from './duplication-detector.js';

// Module 4: Maintainability Index
export { MaintainabilityIndex } from './maintainability-index.js';
export type { MaintainabilityScore, ProjectMaintainability, TrendData as MaintainabilityTrendData } from './maintainability-index.js';

// Module 5: Test Coverage Analyzer
export { TestCoverageAnalyzer } from './test-coverage-analyzer.js';
export type { CoverageResult, FileCoverage, CoverageReport, CoverageDiff, ThresholdBreach, CoverageThreshold } from './test-coverage-analyzer.js';

// Module 6: Code Smell Detector
export { CodeSmellDetector } from './code-smell-detector.js';
export type { SmellResult, SmellCategory, Severity, SmellSummary } from './code-smell-detector.js';

// Module 7: Naming Analyzer
export { NamingAnalyzer } from './naming-analyzer.js';
export type { NamingConvention, EntityType, NamingConfig, NamingIssue, NamingResult } from './naming-analyzer.js';

// Module 8: Architecture Analyzer
export { ArchitectureAnalyzer } from './architecture-analyzer.js';
export type { ArchitecturePattern, ProjectStructure, ArchitectureResult, ComponentInfo, LayerRule, LayerViolation, ComponentGraph } from './architecture-analyzer.js';

// Module 9: Technical Debt Tracker
export { TechnicalDebtTracker } from './technical-debt.js';
export type { DebtItem, DebtType, DebtPriority, DebtReport, DebtTrend, DebtSchedule } from './technical-debt.js';

// Module 10: Metrics Dashboard
export { MetricsDashboard } from './metrics-dashboard.js';
export type { AnalysisResult, DashboardData, MetricAlert, TrendData, MetricThreshold } from './metrics-dashboard.js';
