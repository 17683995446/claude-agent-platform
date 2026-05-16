// src/index.ts - Export everything

export { CodeFormatter } from './code-formatter.ts';
export type { FormatOptions, FormatResult } from './code-formatter.ts';

export { LintEngine } from './lint-engine.ts';
export type { RuleConfig, RuleSeverity, LintMessage, LintResult, FixResult, RuleInfo } from './lint-engine.ts';

export { FileWatcher } from './file-watcher.ts';
export type { FileWatchEvent, WatchOptions, FileChangeEvent, EventHandler } from './file-watcher.ts';

export { TaskRunner } from './task-runner.ts';
export type { TaskHandler, TaskOptions, TaskResult, TaskInfo, TaskGraphData } from './task-runner.ts';

export { SnippetManager } from './snippet-manager.ts';
export type { SnippetDefinition, Snippet, SnippetFilter } from './snippet-manager.ts';

export { QuickDocsGenerator } from './quick-docs.ts';
export type { ProjectInfo, FileEntry, CommitEntry, TypeInfo, APIDocumentation, APIModule, APIExport } from './quick-docs.ts';

export { ProjectScaffolder } from './project-scaffolder.ts';
export type { TemplateDefinition, TemplateVariable, TemplateFile, ScaffoldOptions, ScaffoldResult, TemplateInfo, ValidationResult } from './project-scaffolder.ts';

export { DebugHelper } from './debug-helper.ts';
export type { DebugLevel, Timer, ProfileResult, DiffResult, LogEntry } from './debug-helper.ts';

export { DependencyGraphVisualizer } from './dependency-graph.ts';
export type { FileEntry as DepGraphFileEntry, DependencyNode, DependencyGraph } from './dependency-graph.ts';

export { CommitHelper } from './commit-helper.ts';
export type { ChangeAnalysis, CommitType, CommitSuggestion, CommitOptions, ParsedCommit, ValidationResult as CommitValidationResult } from './commit-helper.ts';
