/**
 * @claude-agent/api-docs-gen
 * Automatic API documentation generation from TypeScript source code.
 */

// Module 1: TypeScript Parser
export {
  TypeScriptParser,
  type ParsedFile,
  type ParsedImport,
  type ParsedExport,
  type ParsedClass,
  type ParsedMethod,
  type ParsedProperty,
  type ParsedParameter,
  type ParsedInterface,
  type ParsedFunction,
  type ParsedTypeAlias,
  type ParsedEnum,
  type ParsedEnumMember,
  type SourceLocation,
} from './ts-parser.js';

// Module 2: JSDoc Extractor
export {
  JSDocExtractor,
  type JSDocData,
  type JSDocTag,
  type ParamInfo,
  type ReturnInfo,
  type ExampleInfo,
} from './jsdoc-extractor.js';

// Module 3: Documentation Model
export {
  DocModel,
  type ModuleDoc,
  type ClassDoc,
  type MethodDoc,
  type PropertyDoc,
  type InterfaceDoc,
  type FunctionDoc,
  type TypeAliasDoc,
  type EnumDoc,
  type DocStats,
} from './doc-model.js';

// Module 4: Markdown Generator
export { MarkdownGenerator } from './markdown-generator.js';

// Module 5: HTML Generator
export {
  HTMLGenerator,
  type HTMLOptions,
  type SearchEntry,
} from './html-generator.js';

// Module 6: OpenAPI Generator
export {
  OpenAPIGenerator,
  type RouteDefinition,
  type SchemaDefinition,
  type SecurityScheme,
  type OpenAPISpec,
} from './openapi-generator.js';

// Module 7: Type Resolver
export {
  TypeResolver,
  type TypeContext,
  type FormatOptions,
} from './type-resolver.js';

// Module 8: Cross Reference Builder
export {
  CrossReferenceBuilder,
  type ReferenceMap,
  type UsageInfo,
  type InheritanceNode,
  type CallGraphNode,
} from './cross-reference.js';

// Module 9: Version Differ
export {
  VersionDiffer,
  type DiffResult,
  type DiffEntry,
  type ModifiedEntry,
  type ChangeDetail,
  type BreakingChange,
  type DiffSummary,
} from './version-differ.js';

// Module 10: Documentation Validator
export {
  DocValidator,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
  type CoverageReport,
  type ModuleValidation,
  type MissingDoc,
  type ValidationRule,
} from './doc-validator.js';
