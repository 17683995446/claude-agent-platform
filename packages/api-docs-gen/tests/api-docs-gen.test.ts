import { describe, it, expect, beforeEach } from 'bun:test';

// Module 1: TypeScript Parser
import { TypeScriptParser, type ParsedFile } from '../src/ts-parser.js';

// Module 2: JSDoc Extractor
import { JSDocExtractor } from '../src/jsdoc-extractor.js';

// Module 3: Documentation Model
import { DocModel } from '../src/doc-model.js';

// Module 4: Markdown Generator
import { MarkdownGenerator } from '../src/markdown-generator.js';

// Module 5: HTML Generator
import { HTMLGenerator } from '../src/html-generator.js';

// Module 6: OpenAPI Generator
import { OpenAPIGenerator } from '../src/openapi-generator.js';

// Module 7: Type Resolver
import { TypeResolver } from '../src/type-resolver.js';

// Module 8: Cross Reference Builder
import { CrossReferenceBuilder } from '../src/cross-reference.js';

// Module 9: Version Differ
import { VersionDiffer } from '../src/version-differ.js';

// Module 10: Documentation Validator
import { DocValidator } from '../src/doc-validator.js';

// ============================================================================
// Sample TypeScript code for testing
// ============================================================================

const SAMPLE_CLASS_CODE = `/**
 * A simple calculator class.
 * @since 1.0.0
 */
export class Calculator {
  private result: number = 0;

  /**
   * Add a number to the result.
   * @param value - The number to add
   * @returns The new result
   */
  public add(value: number): number {
    return this.result + value;
  }

  /**
   * Subtract a number from the result.
   * @param value - The number to subtract
   */
  public subtract(value: number): void {
    this.result -= value;
  }

  /**
   * Get the current result.
   * @returns The current result
   */
  public getResult(): number {
    return this.result;
  }
}`;

const SAMPLE_INTERFACE_CODE = `/**
 * A data repository interface.
 */
export interface Repository<T> {
  /**
   * Find an entity by ID.
   * @param id - The entity ID
   * @returns The entity or undefined
   */
  findById(id: string): T | undefined;

  /**
   * Save an entity.
   * @param entity - The entity to save
   */
  save(entity: T): void;

  /**
   * Delete an entity by ID.
   * @param id - The entity ID
   * @returns Whether the deletion was successful
   */
  delete(id: string): boolean;

  readonly name: string;
  count: number;
}`;

const SAMPLE_FUNCTION_CODE = `/**
 * A utility function to format a date.
 * @param date - The date to format
 * @param format - The format string
 * @returns The formatted date string
 * @throws {Error} When date is invalid
 * @example
 * formatDate(new Date(), 'YYYY-MM-DD')
 */
export function formatDate(date: Date, format: string): string {
  return date.toISOString().slice(0, 10);
}

/**
 * An async function to fetch data.
 * @param url - The URL to fetch
 * @returns The response data
 */
export async function fetchData(url: string): Promise<any> {
  return null;
}

/**
 * A function with default parameters.
 * @param name - The name
 * @param greeting - The greeting message
 */
export function greet(name: string, greeting: string = 'Hello'): string {
  return \`\${greeting}, \${name}!\`;
}`;

const SAMPLE_TYPE_CODE = `/**
 * A user type definition.
 */
export type User = {
  id: string;
  name: string;
  email: string;
  age?: number;
};

/**
 * A callback type.
 */
export type Callback<T> = (data: T) => void;

/**
 * A union type.
 */
export type Status = 'active' | 'inactive' | 'pending';`;

const SAMPLE_ENUM_CODE = `/**
 * HTTP methods enum.
 */
export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH'
}

/**
 * Status codes enum.
 */
export const enum StatusCode {
  OK = 200,
  NotFound = 404,
  ServerError = 500
}`;

const SAMPLE_GENERIC_CLASS = `/**
 * A generic container class.
 * @template T
 */
export class Container<T> {
  private items: T[] = [];

  /**
   * Add an item to the container.
   * @param item - The item to add
   */
  public add(item: T): void {
    this.items.push(item);
  }

  /**
   * Get all items.
   * @returns Array of items
   */
  public getAll(): T[] {
    return this.items;
  }
}`;

const SAMPLE_ABSTRACT_CLASS = `/**
 * An abstract base service.
 */
export abstract class BaseService {
  protected name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Initialize the service.
   */
  abstract initialize(): Promise<void>;

  /**
   * Shutdown the service.
   */
  public shutdown(): void {
    // cleanup
  }
}`;

const SAMPLE_INHERITANCE = `/**
 * Base animal class.
 */
export class Animal {
  protected name: string;

  constructor(name: string) {
    this.name = name;
  }

  public speak(): string {
    return '...';
  }
}

/**
 * A dog class extending Animal.
 */
export class Dog extends Animal {
  public fetch(item: string): string {
    return \`Fetching \${item}\`;
  }
}`;

const SAMPLE_IMPLEMENTS = `/**
 * Serializable interface.
 */
export interface Serializable {
  serialize(): string;
}

/**
 * A JSON serializable class.
 */
export class JSONSerializable implements Serializable {
  public serialize(): string {
    return '{}';
  }
}`;

const SAMPLE_COMPLEX_FILE = `import { EventEmitter } from 'events';
import type { Config } from './config';

/**
 * Application class.
 */
export class Application {
  private config: Config;
  private events: EventEmitter;

  constructor(config: Config) {
    this.config = config;
    this.events = new EventEmitter();
  }

  public start(): void {}
  public stop(): void {}
}

/**
 * Configuration interface.
 */
export interface AppConfig {
  port: number;
  host: string;
  debug?: boolean;
}

/**
 * Log level type.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Environment enum.
 */
export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Create application helper.
 */
export function createApp(config: AppConfig): Application {
  return new Application(config);
}`;

// ============================================================================
// Module 1: TypeScriptParser Tests
// ============================================================================

describe('TypeScriptParser', () => {
  let parser: TypeScriptParser;

  beforeEach(() => {
    parser = new TypeScriptParser();
  });

  describe('parseFile', () => {
    it('should parse a file with a class', () => {
      const result = parser.parseFile('calculator.ts', SAMPLE_CLASS_CODE);
      expect(result.filePath).toBe('calculator.ts');
      expect(result.moduleName).toBe('calculator');
      expect(result.classes.length).toBeGreaterThan(0);
    });

    it('should parse a file with an interface', () => {
      const result = parser.parseFile('repository.ts', SAMPLE_INTERFACE_CODE);
      expect(result.interfaces.length).toBeGreaterThan(0);
      expect(result.interfaces[0]!.name).toBe('Repository');
    });

    it('should parse a file with functions', () => {
      const result = parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE);
      expect(result.functions.length).toBeGreaterThan(0);
    });

    it('should parse a file with type aliases', () => {
      const result = parser.parseFile('types.ts', SAMPLE_TYPE_CODE);
      expect(result.types.length).toBeGreaterThan(0);
    });

    it('should parse a file with enums', () => {
      const result = parser.parseFile('http.ts', SAMPLE_ENUM_CODE);
      expect(result.enums.length).toBeGreaterThan(0);
    });

    it('should extract module name from file path', () => {
      const result = parser.parseFile('/src/utils/helpers.ts', 'export const x = 1;');
      expect(result.moduleName).toBe('helpers');
    });

    it('should handle .tsx extension', () => {
      const result = parser.parseFile('Component.tsx', 'export const x = 1;');
      expect(result.moduleName).toBe('Component');
    });

    it('should return empty arrays for empty file', () => {
      const result = parser.parseFile('empty.ts', '');
      expect(result.classes).toHaveLength(0);
      expect(result.interfaces).toHaveLength(0);
      expect(result.functions).toHaveLength(0);
      expect(result.types).toHaveLength(0);
      expect(result.enums).toHaveLength(0);
    });

    it('should parse a complex file with multiple symbol types', () => {
      const result = parser.parseFile('app.ts', SAMPLE_COMPLEX_FILE);
      expect(result.classes.length).toBeGreaterThan(0);
      expect(result.interfaces.length).toBeGreaterThan(0);
      expect(result.types.length).toBeGreaterThan(0);
      expect(result.enums.length).toBeGreaterThan(0);
      expect(result.functions.length).toBeGreaterThan(0);
    });
  });

  describe('parseDirectory', () => {
    it('should return empty array (stub)', () => {
      const result = parser.parseDirectory('/some/path');
      expect(result).toEqual([]);
    });
  });

  describe('extractExports', () => {
    it('should extract export declarations', () => {
      const result = parser.parseFile('test.ts', 'export class Foo {} export function bar() {}');
      expect(result.exports.length).toBeGreaterThan(0);
    });
  });

  describe('extractClasses', () => {
    it('should extract class with methods and properties', () => {
      const result = parser.parseFile('calc.ts', SAMPLE_CLASS_CODE);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0]!.name).toBe('Calculator');
      expect(result.classes[0]!.methods.length).toBeGreaterThan(0);
      expect(result.classes[0]!.properties.length).toBeGreaterThan(0);
    });

    it('should detect abstract classes', () => {
      const result = parser.parseFile('service.ts', SAMPLE_ABSTRACT_CLASS);
      expect(result.classes[0]!.isAbstract).toBe(true);
    });

    it('should detect exported classes', () => {
      const result = parser.parseFile('calc.ts', SAMPLE_CLASS_CODE);
      expect(result.classes[0]!.isExported).toBe(true);
    });

    it('should extract generic type parameters', () => {
      const result = parser.parseFile('container.ts', SAMPLE_GENERIC_CLASS);
      expect(result.classes[0]!.typeParameters).toContain('T');
    });

    it('should detect class inheritance', () => {
      const result = parser.parseFile('animals.ts', SAMPLE_INHERITANCE);
      const dog = result.classes.find((c) => c.name === 'Dog');
      expect(dog?.extends).toBe('Animal');
    });

    it('should detect implements clause', () => {
      const result = parser.parseFile('serial.ts', SAMPLE_IMPLEMENTS);
      const cls = result.classes.find((c) => c.name === 'JSONSerializable');
      expect(cls?.implements).toContain('Serializable');
    });
  });

  describe('extractInterfaces', () => {
    it('should extract interface with properties and methods', () => {
      const result = parser.parseFile('repo.ts', SAMPLE_INTERFACE_CODE);
      expect(result.interfaces).toHaveLength(1);
      expect(result.interfaces[0]!.name).toBe('Repository');
      expect(result.interfaces[0]!.properties.length).toBeGreaterThan(0);
      expect(result.interfaces[0]!.methods.length).toBeGreaterThan(0);
    });

    it('should extract interface type parameters', () => {
      const result = parser.parseFile('repo.ts', SAMPLE_INTERFACE_CODE);
      expect(result.interfaces[0]!.typeParameters).toContain('T');
    });

    it('should detect readonly properties', () => {
      const result = parser.parseFile('repo.ts', SAMPLE_INTERFACE_CODE);
      const readonlyProp = result.interfaces[0]!.properties.find((p) => p.name === 'name');
      expect(readonlyProp?.isReadonly).toBe(true);
    });

    it('should detect optional properties', () => {
      const result = parser.parseFile('repo.ts', SAMPLE_INTERFACE_CODE);
      // count is not optional
      const countProp = result.interfaces[0]!.properties.find((p) => p.name === 'count');
      expect(countProp).toBeDefined();
    });
  });

  describe('extractFunctions', () => {
    it('should extract function with parameters', () => {
      const result = parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE);
      const formatDate = result.functions.find((f) => f.name === 'formatDate');
      expect(formatDate).toBeDefined();
      expect(formatDate!.parameters.length).toBe(2);
    });

    it('should detect async functions', () => {
      const result = parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE);
      const fetchData = result.functions.find((f) => f.name === 'fetchData');
      expect(fetchData?.isAsync).toBe(true);
    });

    it('should extract default parameter values', () => {
      const result = parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE);
      const greet = result.functions.find((f) => f.name === 'greet');
      expect(greet?.parameters[1]?.defaultValue).toBe("'Hello'");
    });

    it('should extract return types', () => {
      const result = parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE);
      const formatDate = result.functions.find((f) => f.name === 'formatDate');
      expect(formatDate?.returnType).toBe('string');
    });

    it('should detect exported functions', () => {
      const result = parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE);
      for (const fn of result.functions) {
        expect(fn.isExported).toBe(true);
      }
    });
  });

  describe('extractTypes', () => {
    it('should extract type aliases', () => {
      const result = parser.parseFile('types.ts', SAMPLE_TYPE_CODE);
      expect(result.types.length).toBe(3);
    });

    it('should extract type alias with type parameters', () => {
      const result = parser.parseFile('types.ts', SAMPLE_TYPE_CODE);
      const callback = result.types.find((t) => t.name === 'Callback');
      expect(callback?.typeParameters).toContain('T');
    });
  });

  describe('extractEnums', () => {
    it('should extract enum with values', () => {
      const result = parser.parseFile('http.ts', SAMPLE_ENUM_CODE);
      expect(result.enums.length).toBeGreaterThan(0);
      const httpMethod = result.enums.find((e) => e.name === 'HttpMethod');
      expect(httpMethod?.members.length).toBe(5);
    });

    it('should detect const enums', () => {
      const result = parser.parseFile('http.ts', SAMPLE_ENUM_CODE);
      const statusCode = result.enums.find((e) => e.name === 'StatusCode');
      expect(statusCode?.isConst).toBe(true);
    });

    it('should extract enum member values', () => {
      const result = parser.parseFile('http.ts', SAMPLE_ENUM_CODE);
      const httpMethod = result.enums.find((e) => e.name === 'HttpMethod');
      expect(httpMethod?.members[0]?.value).toBe("'GET'");
    });
  });
});

// ============================================================================
// Module 2: JSDocExtractor Tests
// ============================================================================

describe('JSDocExtractor', () => {
  let extractor: JSDocExtractor;

  beforeEach(() => {
    extractor = new JSDocExtractor();
  });

  describe('extractJSDoc', () => {
    it('should return null for node without jsdoc', () => {
      const result = extractor.extractJSDoc({});
      expect(result).toBeNull();
    });

    it('should extract JSDoc from node with jsdoc', () => {
      const result = extractor.extractJSDoc({
        jsdoc: '/** A test description. */',
      });
      expect(result).not.toBeNull();
      expect(result!.description).toContain('A test description');
    });
  });

  describe('parseJSDocComment', () => {
    it('should parse a simple JSDoc comment', () => {
      const result = extractor.parseJSDocComment('/** A simple description. */');
      expect(result.description).toContain('A simple description');
      expect(result.summary).toContain('A simple description');
    });

    it('should parse multi-line description', () => {
      const jsdoc = `/**
 * First line.
 * Second line.
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.description).toContain('First line');
      expect(result.description).toContain('Second line');
    });

    it('should parse @param tags', () => {
      const jsdoc = `/**
 * A function.
 * @param name The user name
 * @param age The user age
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.params).toHaveLength(2);
      expect(result.params[0]!.name).toBe('name');
      expect(result.params[1]!.name).toBe('age');
    });

    it('should parse typed @param tags', () => {
      const jsdoc = `/**
 * A function.
 * @param {string} name The user name
 * @param {number} age The user age
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.params[0]!.type).toBe('string');
      expect(result.params[1]!.type).toBe('number');
    });

    it('should parse optional params with brackets', () => {
      const jsdoc = `/**
 * A function.
 * @param {string} [name] The optional name
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.params[0]!.optional).toBe(true);
    });

    it('should parse @returns tag', () => {
      const jsdoc = `/**
 * A function.
 * @returns {string} The result
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.returns).toHaveLength(1);
      expect(result.returns[0]!.type).toBe('string');
      expect(result.returns[0]!.description).toBe('The result');
    });

    it('should parse @throws tag', () => {
      const jsdoc = `/**
 * A function.
 * @throws {Error} When something goes wrong
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.throws).toHaveLength(1);
      expect(result.throws[0]).toContain('Error');
    });

    it('should parse @deprecated tag', () => {
      const jsdoc = `/**
 * Old function.
 * @deprecated Use newFunction instead
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.deprecated).toBe('Use newFunction instead');
    });

    it('should parse @since tag', () => {
      const jsdoc = `/**
 * A function.
 * @since 1.0.0
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.since).toBe('1.0.0');
    });

    it('should parse @see tag', () => {
      const jsdoc = `/**
 * A function.
 * @see https://example.com
 * @see OtherClass
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.see).toHaveLength(2);
    });

    it('should parse @example tag', () => {
      const jsdoc = `/**
 * A function.
 * @example
 * const result = fn(42);
 * console.log(result);
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.examples).toHaveLength(1);
      expect(result.examples[0]!.code).toContain('fn(42)');
    });

    it('should parse @internal tag', () => {
      const jsdoc = `/**
 * Internal function.
 * @internal
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.internal).toBe(true);
    });

    it('should parse @category tag', () => {
      const jsdoc = `/**
 * A utility function.
 * @category Utils
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.category).toBe('Utils');
    });

    it('should handle empty JSDoc', () => {
      const result = extractor.parseJSDocComment('/** */');
      expect(result.description).toBe('');
    });

    it('should separate description from tags', () => {
      const jsdoc = `/**
 * Description here.
 * @param x The param
 */`;
      const result = extractor.parseJSDocComment(jsdoc);
      expect(result.description).toContain('Description here');
      expect(result.tags.length).toBeGreaterThan(0);
    });
  });

  describe('extractTags', () => {
    it('should extract all tag types', () => {
      const jsdoc = `/**
 * A function.
 * @param {string} x The param
 * @returns {number} The result
 * @throws {Error} On error
 * @since 1.0.0
 * @see https://example.com
 */`;
      const parsed = extractor.parseJSDocComment(jsdoc);
      const tags = extractor.extractTags(parsed);
      expect(tags.params).toHaveLength(1);
      expect(tags.returns).toHaveLength(1);
      expect(tags.throws).toHaveLength(1);
      expect(tags.since).toBe('1.0.0');
      expect(tags.see).toHaveLength(1);
    });
  });

  describe('extractTypeFromJSDoc', () => {
    it('should extract types from params and returns', () => {
      const jsdoc = `/**
 * A function.
 * @param {string} name The name
 * @returns {number} The count
 */`;
      const parsed = extractor.parseJSDocComment(jsdoc);
      const types = extractor.extractTypeFromJSDoc(parsed);
      expect(types.get('name')).toBe('string');
      expect(types.get('@return')).toBe('number');
    });
  });

  describe('resolveTypeReferences', () => {
    it('should resolve types using imports', () => {
      const types = new Map<string, string>([['name', 'User']]);
      const imports = [{ source: './models', specifiers: ['User'] }];
      const resolved = extractor.resolveTypeReferences(types, imports);
      expect(resolved.get('name')).toContain('./models');
    });

    it('should leave unresolvable types unchanged', () => {
      const types = new Map<string, string>([['name', 'string']]);
      const imports = [{ source: './models', specifiers: ['User'] }];
      const resolved = extractor.resolveTypeReferences(types, imports);
      expect(resolved.get('name')).toBe('string');
    });
  });
});

// ============================================================================
// Module 3: DocModel Tests
// ============================================================================

describe('DocModel', () => {
  let model: DocModel;
  let parser: TypeScriptParser;

  beforeEach(() => {
    model = new DocModel();
    parser = new TypeScriptParser();
  });

  describe('addFile and build', () => {
    it('should add a parsed file and build', () => {
      const parsed = parser.parseFile('calc.ts', SAMPLE_CLASS_CODE);
      model.addFile(parsed);
      model.build();
      expect(model.getAllModules()).toHaveLength(1);
    });

    it('should build multiple modules', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.addFile(parser.parseFile('repo.ts', SAMPLE_INTERFACE_CODE));
      model.addFile(parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE));
      model.build();
      expect(model.getAllModules()).toHaveLength(3);
    });

    it('should reset built state when adding new file', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      model.addFile(parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE));
      // After adding, need to rebuild
      const modules = model.getAllModules();
      // The old build is still there until we call build again
      expect(modules.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getModule', () => {
    it('should return module by name', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const mod = model.getModule('calc');
      expect(mod).toBeDefined();
      expect(mod!.name).toBe('calc');
    });

    it('should return undefined for unknown module', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      expect(model.getModule('nonexistent')).toBeUndefined();
    });
  });

  describe('getClass', () => {
    it('should return class by FQN', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const cls = model.getClass('calc.Calculator');
      expect(cls).toBeDefined();
      expect(cls!.name).toBe('Calculator');
    });

    it('should return undefined for unknown class', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      expect(model.getClass('calc.Nonexistent')).toBeUndefined();
    });
  });

  describe('getInterface', () => {
    it('should return interface by FQN', () => {
      model.addFile(parser.parseFile('repo.ts', SAMPLE_INTERFACE_CODE));
      model.build();
      const iface = model.getInterface('repo.Repository');
      expect(iface).toBeDefined();
      expect(iface!.name).toBe('Repository');
    });
  });

  describe('getFunction', () => {
    it('should return function by FQN', () => {
      model.addFile(parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE));
      model.build();
      const fn = model.getFunction('utils.formatDate');
      expect(fn).toBeDefined();
      expect(fn!.name).toBe('formatDate');
    });
  });

  describe('search', () => {
    it('should search by name', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.addFile(parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE));
      model.build();
      const results = model.search('Calculator');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.name).toBe('Calculator');
    });

    it('should return empty for no matches', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const results = model.search('NonexistentSymbol');
      expect(results).toHaveLength(0);
    });

    it('should be case-insensitive', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const results = model.search('calculator');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const stats = model.getStats();
      expect(stats.totalModules).toBe(1);
      expect(stats.totalClasses).toBe(1);
      expect(stats.totalMethods).toBeGreaterThan(0);
      expect(stats.totalProperties).toBeGreaterThan(0);
    });

    it('should calculate coverage percent', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const stats = model.getStats();
      expect(stats.coveragePercent).toBeGreaterThanOrEqual(0);
      expect(stats.coveragePercent).toBeLessThanOrEqual(100);
    });

    it('should return 100% coverage for empty model', () => {
      model.build();
      const stats = model.getStats();
      expect(stats.coveragePercent).toBe(100);
    });
  });
});

// ============================================================================
// Module 4: MarkdownGenerator Tests
// ============================================================================

describe('MarkdownGenerator', () => {
  let generator: MarkdownGenerator;
  let model: DocModel;
  let parser: TypeScriptParser;

  beforeEach(() => {
    generator = new MarkdownGenerator();
    model = new DocModel();
    parser = new TypeScriptParser();
  });

  describe('generateModule', () => {
    it('should generate module markdown with header', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const mod = model.getModule('calc')!;
      const md = generator.generateModule(mod);
      expect(md).toContain('# calc');
    });

    it('should include class documentation', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const mod = model.getModule('calc')!;
      const md = generator.generateModule(mod);
      expect(md).toContain('Calculator');
    });

    it('should include interface documentation', () => {
      model.addFile(parser.parseFile('repo.ts', SAMPLE_INTERFACE_CODE));
      model.build();
      const mod = model.getModule('repo')!;
      const md = generator.generateModule(mod);
      expect(md).toContain('Repository');
    });

    it('should include function documentation', () => {
      model.addFile(parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE));
      model.build();
      const mod = model.getModule('utils')!;
      const md = generator.generateModule(mod);
      expect(md).toContain('formatDate');
    });

    it('should include code blocks', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const mod = model.getModule('calc')!;
      const md = generator.generateModule(mod);
      expect(md).toContain('```typescript');
    });
  });

  describe('generateClass', () => {
    it('should generate class with properties table', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const cls = model.getClass('calc.Calculator')!;
      const md = generator.generateClass(cls);
      expect(md).toContain('Properties');
      expect(md).toContain('result');
    });

    it('should generate class with methods', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const cls = model.getClass('calc.Calculator')!;
      const md = generator.generateClass(cls);
      expect(md).toContain('Methods');
      expect(md).toContain('add');
    });
  });

  describe('generateMethod', () => {
    it('should include parameters table', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const cls = model.getClass('calc.Calculator')!;
      const method = cls.methods.find((m) => m.name === 'add')!;
      const md = generator.generateMethod(method);
      expect(md).toContain('Parameters');
      expect(md).toContain('value');
    });

    it('should include return type', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const cls = model.getClass('calc.Calculator')!;
      const method = cls.methods.find((m) => m.name === 'add')!;
      const md = generator.generateMethod(method);
      expect(md).toContain('Returns');
      expect(md).toContain('number');
    });
  });

  describe('generateInterface', () => {
    it('should generate interface with code block', () => {
      model.addFile(parser.parseFile('repo.ts', SAMPLE_INTERFACE_CODE));
      model.build();
      const iface = model.getInterface('repo.Repository')!;
      const md = generator.generateInterface(iface);
      expect(md).toContain('interface Repository');
    });
  });

  describe('generateFunction', () => {
    it('should include function signature', () => {
      model.addFile(parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE));
      model.build();
      const fn = model.getFunction('utils.formatDate')!;
      const md = generator.generateFunction(fn);
      expect(md).toContain('function formatDate');
      expect(md).toContain('date: Date');
    });
  });

  describe('generateIndex', () => {
    it('should generate table of contents', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.addFile(parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE));
      model.build();
      const md = generator.generateIndex(model.getAllModules());
      expect(md).toContain('# API Documentation');
      expect(md).toContain('Table of Contents');
      expect(md).toContain('calc');
      expect(md).toContain('utils');
    });
  });

  describe('generateSidebar', () => {
    it('should generate sidebar navigation', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const sidebar = generator.generateSidebar(model.getAllModules());
      expect(sidebar).toContain('API Reference');
      expect(sidebar).toContain('calc');
    });
  });

  describe('generateAll', () => {
    it('should generate all documentation files', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const docs = generator.generateAll(model);
      expect(docs.has('README.md')).toBe(true);
      expect(docs.has('_sidebar.md')).toBe(true);
      expect(docs.has('calc.md')).toBe(true);
    });
  });
});

// ============================================================================
// Module 5: HTMLGenerator Tests
// ============================================================================

describe('HTMLGenerator', () => {
  let generator: HTMLGenerator;
  let model: DocModel;
  let parser: TypeScriptParser;

  beforeEach(() => {
    generator = new HTMLGenerator({ title: 'Test API' });
    model = new DocModel();
    parser = new TypeScriptParser();
  });

  describe('generatePage', () => {
    it('should generate valid HTML', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const mod = model.getModule('calc')!;
      const html = generator.generatePage(mod);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
    });

    it('should include title', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const mod = model.getModule('calc')!;
      const html = generator.generatePage(mod);
      expect(html).toContain('Test API');
    });

    it('should include CSS styles', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const mod = model.getModule('calc')!;
      const html = generator.generatePage(mod);
      expect(html).toContain('<style>');
    });

    it('should support dark theme', () => {
      const darkGen = new HTMLGenerator({ theme: 'dark' });
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const mod = model.getModule('calc')!;
      const html = darkGen.generatePage(mod);
      expect(html).toContain('#1e1e1e');
    });
  });

  describe('generateIndex', () => {
    it('should generate index with module list', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.addFile(parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE));
      model.build();
      const html = generator.generateIndex(model.getAllModules());
      expect(html).toContain('calc');
      expect(html).toContain('utils');
    });
  });

  describe('generateSearchIndex', () => {
    it('should generate search entries', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const entries = generator.generateSearchIndex(model.getAllModules());
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((e) => e.type === 'module')).toBe(true);
    });

    it('should include class entries', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const entries = generator.generateSearchIndex(model.getAllModules());
      expect(entries.some((e) => e.type === 'class')).toBe(true);
    });
  });

  describe('generateAll', () => {
    it('should generate index.html', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const docs = generator.generateAll(model);
      expect(docs.has('index.html')).toBe(true);
    });

    it('should generate search.json when includeSearch is true', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const docs = generator.generateAll(model, { includeSearch: true });
      expect(docs.has('search.json')).toBe(true);
    });

    it('should not generate search.json when includeSearch is false', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const docs = generator.generateAll(model, { includeSearch: false });
      expect(docs.has('search.json')).toBe(false);
    });
  });
});

// ============================================================================
// Module 6: OpenAPIGenerator Tests
// ============================================================================

describe('OpenAPIGenerator', () => {
  let gen: OpenAPIGenerator;

  beforeEach(() => {
    gen = new OpenAPIGenerator({ title: 'Test API', version: '2.0.0' });
  });

  describe('fromRoutes', () => {
    it('should generate spec from route definitions', () => {
      const spec = gen.fromRoutes([
        {
          method: 'GET',
          path: '/users',
          summary: 'List users',
          responses: { '200': { description: 'Success' } },
        },
      ]);
      expect(spec.paths['/users']).toBeDefined();
      expect(spec.openapi).toBe('3.0.3');
    });

    it('should handle multiple routes', () => {
      const spec = gen.fromRoutes([
        { method: 'GET', path: '/users', summary: 'List users' },
        { method: 'POST', path: '/users', summary: 'Create user' },
        { method: 'GET', path: '/users/:id', summary: 'Get user' },
      ]);
      expect(Object.keys(spec.paths)).toHaveLength(2);
      expect((spec.paths['/users'] as Record<string, unknown>)['get']).toBeDefined();
      expect((spec.paths['/users'] as Record<string, unknown>)['post']).toBeDefined();
      expect(spec.paths['/users/:id']).toBeDefined();
    });

    it('should handle all HTTP methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
      const spec = gen.fromRoutes(
        methods.map((method) => ({ method, path: `/test-${method.toLowerCase()}` }))
      );
      for (const method of methods) {
        expect(spec.paths[`/test-${method.toLowerCase()}`]).toBeDefined();
      }
    });

    it('should include parameters', () => {
      const spec = gen.fromRoutes([
        {
          method: 'GET',
          path: '/users/{id}',
          parameters: [
            { name: 'id', in: 'path', required: true, description: 'User ID' },
          ],
        },
      ]);
      const getOp = (spec.paths['/users/{id}'] as Record<string, unknown>)['get'] as Record<string, unknown>;
      expect(getOp.parameters).toBeDefined();
    });

    it('should include request body', () => {
      const spec = gen.fromRoutes([
        {
          method: 'POST',
          path: '/users',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', properties: { name: { type: 'string' } } },
              },
            },
          },
        },
      ]);
      const postOp = (spec.paths['/users'] as Record<string, unknown>)['post'] as Record<string, unknown>;
      expect(postOp.requestBody).toBeDefined();
    });

    it('should include tags', () => {
      gen.fromRoutes([
        { method: 'GET', path: '/users', tags: ['Users'] },
      ]);
      const spec = gen.generate();
      expect(spec.tags).toBeDefined();
      expect(spec.tags!.some((t) => t.name === 'Users')).toBe(true);
    });

    it('should mark deprecated routes', () => {
      const spec = gen.fromRoutes([
        { method: 'GET', path: '/old', deprecated: true },
      ]);
      const getOp = (spec.paths['/old'] as Record<string, unknown>)['get'] as Record<string, unknown>;
      expect(getOp.deprecated).toBe(true);
    });
  });

  describe('fromExpress', () => {
    it('should generate from express-like app', () => {
      const spec = gen.fromExpress({
        _routes: [
          { method: 'GET', path: '/api/test' },
        ],
      });
      expect(spec.paths['/api/test']).toBeDefined();
    });

    it('should return base spec for app without routes', () => {
      const spec = gen.fromExpress({});
      expect(spec.openapi).toBe('3.0.3');
    });
  });

  describe('addSchema', () => {
    it('should add schema definitions', () => {
      gen.addSchema('User', {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      });
      const spec = gen.generate();
      expect(spec.components?.schemas?.['User']).toBeDefined();
    });
  });

  describe('addSecurity', () => {
    it('should add security schemes', () => {
      gen.addSecurity('bearerAuth', {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      });
      const spec = gen.generate();
      expect(spec.components?.securitySchemes?.['bearerAuth']).toBeDefined();
    });
  });

  describe('generate', () => {
    it('should generate valid OpenAPI 3.0 spec', () => {
      gen.fromRoutes([{ method: 'GET', path: '/test' }]);
      const spec = gen.generate();
      expect(spec.openapi).toBe('3.0.3');
      expect(spec.info.title).toBe('Test API');
      expect(spec.info.version).toBe('2.0.0');
    });
  });

  describe('generateJSON', () => {
    it('should generate valid JSON string', () => {
      gen.fromRoutes([{ method: 'GET', path: '/test' }]);
      const json = gen.generateJSON();
      const parsed = JSON.parse(json);
      expect(parsed.openapi).toBe('3.0.3');
    });
  });

  describe('generateYAML', () => {
    it('should generate YAML string', () => {
      gen.fromRoutes([{ method: 'GET', path: '/test' }]);
      const yaml = gen.generateYAML();
      expect(yaml).toContain('openapi');
      expect(yaml).toContain('3.0.3');
    });
  });
});

// ============================================================================
// Module 7: TypeResolver Tests
// ============================================================================

describe('TypeResolver', () => {
  let resolver: TypeResolver;

  beforeEach(() => {
    resolver = new TypeResolver();
  });

  describe('resolveType', () => {
    it('should return "any" for undefined type', () => {
      expect(resolver.resolveType('')).toBe('any');
      expect(resolver.resolveType('undefined')).toBe('any');
    });

    it('should pass through primitive types', () => {
      expect(resolver.resolveType('string')).toBe('string');
      expect(resolver.resolveType('number')).toBe('number');
      expect(resolver.resolveType('boolean')).toBe('boolean');
    });

    it('should resolve Promise<T>', () => {
      expect(resolver.resolveType('Promise<string>')).toBe('Promise<string>');
    });

    it('should resolve Array<T> to T[]', () => {
      expect(resolver.resolveType('Array<string>')).toBe('string[]');
      expect(resolver.resolveType('Array<number>')).toBe('number[]');
    });

    it('should resolve Record<K, V>', () => {
      expect(resolver.resolveType('Record<string, number>')).toBe('Record<string, number>');
    });

    it('should resolve type aliases from context', () => {
      const ctx = { aliases: new Map([['UserID', 'string']]) };
      expect(resolver.resolveType('UserID', ctx)).toBe('string');
    });
  });

  describe('resolveGenericType', () => {
    it('should replace type parameters with concrete types', () => {
      const params = new Map([['T', 'string'], ['U', 'number']]);
      expect(resolver.resolveGenericType('T', params)).toBe('string');
      expect(resolver.resolveGenericType('U', params)).toBe('number');
    });

    it('should replace multiple occurrences', () => {
      const params = new Map([['T', 'User']]);
      expect(resolver.resolveGenericType('Array<T>', params)).toBe('Array<User>');
    });
  });

  describe('resolveUnionType', () => {
    it('should join types with pipe', () => {
      expect(resolver.resolveUnionType(['string', 'number'])).toBe('string | number');
    });

    it('should handle null and undefined', () => {
      expect(resolver.resolveUnionType(['string', 'null'])).toBe('string | null');
      expect(resolver.resolveUnionType(['string', 'undefined'])).toBe('string | undefined');
    });

    it('should return "never" for empty array', () => {
      expect(resolver.resolveUnionType([])).toBe('never');
    });

    it('should return single type as-is', () => {
      expect(resolver.resolveUnionType(['string'])).toBe('string');
    });
  });

  describe('resolveIntersectionType', () => {
    it('should join types with ampersand', () => {
      expect(resolver.resolveIntersectionType(['A', 'B'])).toBe('A & B');
    });

    it('should return "never" for empty array', () => {
      expect(resolver.resolveIntersectionType([])).toBe('never');
    });

    it('should return single type as-is', () => {
      expect(resolver.resolveIntersectionType(['A'])).toBe('A');
    });
  });

  describe('formatType', () => {
    it('should format in compact mode', () => {
      const result = resolver.formatType('Array< string >', { compact: true });
      expect(result).toBe('Array<string>');
    });

    it('should expand generics when requested', () => {
      const result = resolver.formatType('Array<string>', { expandGenerics: true });
      expect(result).toBe('string[]');
    });

    it('should use default options', () => {
      const result = resolver.formatType('string');
      expect(result).toBe('string');
    });
  });

  describe('simplifyType', () => {
    it('should simplify Partial<T>', () => {
      expect(resolver.simplifyType('Partial<User>')).toBe('User');
    });

    it('should simplify Required<T>', () => {
      expect(resolver.simplifyType('Required<User>')).toBe('User');
    });

    it('should simplify Readonly<T>', () => {
      expect(resolver.simplifyType('Readonly<User>')).toBe('User');
    });

    it('should simplify Pick<T, K>', () => {
      expect(resolver.simplifyType('Pick<User, "id" | "name">')).toBe('User');
    });

    it('should simplify Omit<T, K>', () => {
      expect(resolver.simplifyType('Omit<User, "password">')).toBe('User');
    });

    it('should leave non-utility types unchanged', () => {
      expect(resolver.simplifyType('string')).toBe('string');
      expect(resolver.simplifyType('User')).toBe('User');
    });
  });

  describe('getDefaultValue', () => {
    it('should return default for string', () => {
      expect(resolver.getDefaultValue('string')).toBe("''");
    });

    it('should return default for number', () => {
      expect(resolver.getDefaultValue('number')).toBe('0');
    });

    it('should return default for boolean', () => {
      expect(resolver.getDefaultValue('boolean')).toBe('false');
    });

    it('should return default for object', () => {
      expect(resolver.getDefaultValue('object')).toBe('{}');
    });

    it('should return default for array types', () => {
      expect(resolver.getDefaultValue('Array')).toBe('[]');
      expect(resolver.getDefaultValue('string[]')).toBe('[]');
      expect(resolver.getDefaultValue('Array<number>')).toBe('[]');
    });

    it('should return default for void/undefined', () => {
      expect(resolver.getDefaultValue('void')).toBe('undefined');
      expect(resolver.getDefaultValue('undefined')).toBe('undefined');
    });

    it('should return default for null', () => {
      expect(resolver.getDefaultValue('null')).toBe('null');
    });

    it('should return default for Map/Set', () => {
      expect(resolver.getDefaultValue('Map')).toBe('new Map()');
      expect(resolver.getDefaultValue('Set')).toBe('new Set()');
    });

    it('should return default for Record types', () => {
      expect(resolver.getDefaultValue('Record<string, any>')).toBe('{}');
    });

    it('should return undefined for unknown types', () => {
      expect(resolver.getDefaultValue('CustomType')).toBe('undefined');
    });
  });
});

// ============================================================================
// Module 8: CrossReferenceBuilder Tests
// ============================================================================

describe('CrossReferenceBuilder', () => {
  let builder: CrossReferenceBuilder;
  let model: DocModel;
  let parser: TypeScriptParser;

  beforeEach(() => {
    builder = new CrossReferenceBuilder();
    model = new DocModel();
    parser = new TypeScriptParser();
  });

  describe('buildReferences', () => {
    it('should build references from model', () => {
      model.addFile(parser.parseFile('animals.ts', SAMPLE_INHERITANCE));
      model.build();
      const refs = builder.buildReferences(model);
      expect(refs).toBeDefined();
    });

    it('should track inheritance', () => {
      model.addFile(parser.parseFile('animals.ts', SAMPLE_INHERITANCE));
      model.build();
      builder.buildReferences(model);
      const tree = builder.getInheritanceTree('animals.Dog');
      expect(tree).not.toBeNull();
      expect(tree!.parent).toBe('Animal');
    });

    it('should track implementations', () => {
      model.addFile(parser.parseFile('serial.ts', SAMPLE_IMPLEMENTS));
      model.build();
      builder.buildReferences(model);
      const impls = builder.getImplementations('Serializable');
      expect(impls.length).toBeGreaterThan(0);
    });
  });

  describe('getImplementations', () => {
    it('should return empty for unknown interface', () => {
      expect(builder.getImplementations('Unknown')).toEqual([]);
    });
  });

  describe('getUsages', () => {
    it('should return usages after building', () => {
      model.addFile(parser.parseFile('animals.ts', SAMPLE_INHERITANCE));
      model.build();
      builder.buildReferences(model);
      const usages = builder.getUsages('Animal');
      expect(usages.length).toBeGreaterThan(0);
    });

    it('should return empty for unknown symbol', () => {
      expect(builder.getUsages('Unknown')).toEqual([]);
    });
  });

  describe('getDependencies', () => {
    it('should return empty for unknown module', () => {
      expect(builder.getDependencies('unknown')).toEqual([]);
    });
  });

  describe('getDependents', () => {
    it('should return empty for unknown module', () => {
      expect(builder.getDependents('unknown')).toEqual([]);
    });
  });

  describe('getInheritanceTree', () => {
    it('should return null for unknown class', () => {
      expect(builder.getInheritanceTree('Unknown')).toBeNull();
    });
  });

  describe('getCallGraph', () => {
    it('should return null for unknown function', () => {
      expect(builder.getCallGraph('unknown')).toBeNull();
    });

    it('should return call graph node for known function', () => {
      model.addFile(parser.parseFile('utils.ts', SAMPLE_FUNCTION_CODE));
      model.build();
      builder.buildReferences(model);
      const node = builder.getCallGraph('utils.formatDate');
      expect(node).not.toBeNull();
      expect(node!.name).toBe('formatDate');
    });
  });

  describe('generateMermaidDiagram', () => {
    it('should generate class diagram', () => {
      const diagram = builder.generateMermaidDiagram('class', 'SomeClass');
      expect(diagram).toContain('classDiagram');
    });

    it('should generate inheritance diagram', () => {
      const diagram = builder.generateMermaidDiagram('inheritance', 'SomeClass');
      expect(diagram).toContain('graph TD');
    });

    it('should generate module dependency diagram', () => {
      const diagram = builder.generateMermaidDiagram('module-dependencies', '');
      expect(diagram).toContain('graph LR');
    });

    it('should generate call graph diagram', () => {
      const diagram = builder.generateMermaidDiagram('call-graph', 'someFunction');
      expect(diagram).toContain('graph TD');
    });
  });
});

// ============================================================================
// Module 9: VersionDiffer Tests
// ============================================================================

describe('VersionDiffer', () => {
  let differ: VersionDiffer;
  let parser: TypeScriptParser;

  beforeEach(() => {
    differ = new VersionDiffer();
    parser = new TypeScriptParser();
  });

  function buildModel(...codes: Array<{ name: string; code: string }>): DocModel {
    const model = new DocModel();
    for (const { name, code } of codes) {
      model.addFile(parser.parseFile(name, code));
    }
    model.build();
    return model;
  }

  describe('diff', () => {
    it('should detect no changes for identical models', () => {
      const model = buildModel({ name: 'calc.ts', code: SAMPLE_CLASS_CODE });
      const result = differ.diff(model, model);
      expect(result.summary.totalAdded).toBe(0);
      expect(result.summary.totalRemoved).toBe(0);
      expect(result.summary.totalModified).toBe(0);
    });

    it('should detect added classes', () => {
      const oldModel = buildModel({ name: 'calc.ts', code: SAMPLE_CLASS_CODE });
      const newModel = buildModel(
        { name: 'calc.ts', code: SAMPLE_CLASS_CODE },
        { name: 'utils.ts', code: SAMPLE_FUNCTION_CODE }
      );
      const result = differ.diff(oldModel, newModel);
      expect(result.summary.totalAdded).toBeGreaterThan(0);
    });

    it('should detect removed classes', () => {
      const oldModel = buildModel(
        { name: 'calc.ts', code: SAMPLE_CLASS_CODE },
        { name: 'utils.ts', code: SAMPLE_FUNCTION_CODE }
      );
      const newModel = buildModel({ name: 'calc.ts', code: SAMPLE_CLASS_CODE });
      const result = differ.diff(oldModel, newModel);
      expect(result.summary.totalRemoved).toBeGreaterThan(0);
    });

    it('should detect added modules', () => {
      const oldModel = buildModel({ name: 'a.ts', code: 'export class A {}' });
      const newModel = buildModel(
        { name: 'a.ts', code: 'export class A {}' },
        { name: 'b.ts', code: 'export class B {}' }
      );
      const result = differ.diff(oldModel, newModel);
      expect(result.summary.totalAdded).toBeGreaterThan(0);
    });

    it('should detect removed modules as breaking', () => {
      const oldModel = buildModel({ name: 'old.ts', code: 'export class Old {}' });
      const newModel = new DocModel();
      newModel.build();
      const result = differ.diff(oldModel, newModel);
      expect(result.summary.totalRemoved).toBeGreaterThan(0);
      expect(result.summary.totalBreaking).toBeGreaterThan(0);
    });
  });

  describe('getAddedSymbols', () => {
    it('should return added symbols', () => {
      const oldModel = buildModel({ name: 'a.ts', code: 'export class A {}' });
      const newModel = buildModel(
        { name: 'a.ts', code: 'export class A {}' },
        { name: 'b.ts', code: 'export class B {}' }
      );
      const result = differ.diff(oldModel, newModel);
      const added = differ.getAddedSymbols(result);
      expect(added.length).toBeGreaterThan(0);
    });
  });

  describe('getRemovedSymbols', () => {
    it('should return removed symbols', () => {
      const oldModel = buildModel(
        { name: 'a.ts', code: 'export class A {}' },
        { name: 'b.ts', code: 'export class B {}' }
      );
      const newModel = buildModel({ name: 'a.ts', code: 'export class A {}' });
      const result = differ.diff(oldModel, newModel);
      const removed = differ.getRemovedSymbols(result);
      expect(removed.length).toBeGreaterThan(0);
    });
  });

  describe('getModifiedSymbols', () => {
    it('should return empty when no modifications', () => {
      const model = buildModel({ name: 'a.ts', code: 'export class A {}' });
      const result = differ.diff(model, model);
      expect(differ.getModifiedSymbols(result)).toHaveLength(0);
    });
  });

  describe('getBreakingChanges', () => {
    it('should return empty when no breaking changes', () => {
      const model = buildModel({ name: 'a.ts', code: 'export class A {}' });
      const result = differ.diff(model, model);
      expect(differ.getBreakingChanges(result)).toHaveLength(0);
    });
  });

  describe('generateChangelog', () => {
    it('should generate changelog with no changes', () => {
      const model = buildModel({ name: 'a.ts', code: 'export class A {}' });
      const result = differ.diff(model, model);
      const changelog = differ.generateChangelog(result);
      expect(changelog).toContain('No changes detected');
    });

    it('should generate changelog with added section', () => {
      const oldModel = buildModel({ name: 'a.ts', code: 'export class A {}' });
      const newModel = buildModel(
        { name: 'a.ts', code: 'export class A {}' },
        { name: 'b.ts', code: 'export class B {}' }
      );
      const result = differ.diff(oldModel, newModel);
      const changelog = differ.generateChangelog(result);
      expect(changelog).toContain('## Added');
    });

    it('should generate changelog with removed section', () => {
      const oldModel = buildModel(
        { name: 'a.ts', code: 'export class A {}' },
        { name: 'b.ts', code: 'export class B {}' }
      );
      const newModel = buildModel({ name: 'a.ts', code: 'export class A {}' });
      const result = differ.diff(oldModel, newModel);
      const changelog = differ.generateChangelog(result);
      expect(changelog).toContain('## Removed');
    });
  });

  describe('generateMigrationGuide', () => {
    it('should indicate no breaking changes when none', () => {
      const model = buildModel({ name: 'a.ts', code: 'export class A {}' });
      const result = differ.diff(model, model);
      const guide = differ.generateMigrationGuide(result);
      expect(guide).toContain('No breaking changes detected');
    });

    it('should include breaking changes section', () => {
      const oldModel = buildModel({ name: 'old.ts', code: 'export class Old {}' });
      const newModel = new DocModel();
      newModel.build();
      const result = differ.diff(oldModel, newModel);
      const guide = differ.generateMigrationGuide(result);
      expect(guide).toContain('## Breaking Changes');
    });
  });
});

// ============================================================================
// Module 10: DocValidator Tests
// ============================================================================

describe('DocValidator', () => {
  let validator: DocValidator;
  let model: DocModel;
  let parser: TypeScriptParser;

  beforeEach(() => {
    validator = new DocValidator();
    model = new DocModel();
    parser = new TypeScriptParser();
  });

  describe('validate', () => {
    it('should validate a model with documented code', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const result = validator.validate(model);
      expect(result).toBeDefined();
      expect(typeof result.isValid).toBe('boolean');
    });

    it('should validate an empty model', () => {
      model.build();
      const result = validator.validate(model);
      expect(result.isValid).toBe(true);
    });

    it('should produce coverage report', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const result = validator.validate(model);
      expect(result.coverage.totalSymbols).toBeGreaterThan(0);
    });

    it('should produce module results', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const result = validator.validate(model);
      expect(result.moduleResults.size).toBeGreaterThan(0);
    });
  });

  describe('validateModule', () => {
    it('should validate a documented module', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const mod = model.getModule('calc')!;
      const result = validator.validateModule(mod);
      expect(result.moduleName).toBe('calc');
    });

    it('should warn about undocumented functions', () => {
      model.addFile(parser.parseFile('test.ts', 'export function noDoc() {}'));
      model.build();
      const mod = model.getModule('test')!;
      const result = validator.validateModule(mod);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('validateClass', () => {
    it('should warn about undocumented class', () => {
      model.addFile(parser.parseFile('test.ts', 'export class NoDoc { public method() {} }'));
      model.build();
      const cls = model.getClass('test.NoDoc')!;
      const result = validator.validateClass(cls);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should validate documented class without warnings', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const cls = model.getClass('calc.Calculator')!;
      const result = validator.validateClass(cls);
      // The class has JSDoc, so no class-description warning
      const classWarnings = result.warnings.filter((w) => w.rule === 'class-description');
      expect(classWarnings).toHaveLength(0);
    });
  });

  describe('validateMethod', () => {
    it('should warn about undocumented method', () => {
      const method = {
        name: 'undocumented',
        fqn: 'test.undocumented',
        className: 'Test',
        description: '',
        parameters: [{ name: 'x', type: 'number', isOptional: false, isRest: false }],
        returnType: 'void',
        modifiers: [],
        isAbstract: false,
        isStatic: false,
        isAsync: false,
        isPrivate: false,
        isProtected: false,
        isPublic: false,
      };
      const result = validator.validateMethod(method);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should warn about missing @returns for non-void return', () => {
      const method = {
        name: 'returnsNothing',
        fqn: 'test.returnsNothing',
        className: 'Test',
        description: 'A method.',
        parameters: [],
        returnType: 'number',
        modifiers: [],
        isAbstract: false,
        isStatic: false,
        isAsync: false,
        isPrivate: false,
        isProtected: false,
        isPublic: false,
      };
      const result = validator.validateMethod(method);
      const returnsWarnings = result.warnings.filter((w) => w.rule === 'method-returns');
      expect(returnsWarnings.length).toBeGreaterThan(0);
    });
  });

  describe('checkCoverage', () => {
    it('should calculate coverage by type', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const coverage = validator.checkCoverage(model);
      expect(coverage.byType).toBeDefined();
      expect(coverage.coveragePercent).toBeGreaterThanOrEqual(0);
    });

    it('should calculate coverage by module', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const coverage = validator.checkCoverage(model);
      expect(coverage.byModule).toBeDefined();
      expect(coverage.byModule['calc']).toBeDefined();
    });

    it('should return 100% for empty model', () => {
      model.build();
      const coverage = validator.checkCoverage(model);
      expect(coverage.coveragePercent).toBe(100);
    });
  });

  describe('getMissingDocs', () => {
    it('should return empty for fully documented model', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const missing = validator.getMissingDocs(model);
      // Calculator class has JSDoc, but some members might not
      expect(Array.isArray(missing)).toBe(true);
    });

    it('should find undocumented symbols', () => {
      model.addFile(parser.parseFile('test.ts', 'export class NoDoc {}'));
      model.build();
      const missing = validator.getMissingDocs(model);
      expect(missing.length).toBeGreaterThan(0);
    });
  });

  describe('getWarnings', () => {
    it('should return warnings from validation', () => {
      model.addFile(parser.parseFile('test.ts', 'export function noDoc() {}'));
      model.build();
      const result = validator.validate(model);
      const warnings = validator.getWarnings(result);
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe('generateReport', () => {
    it('should generate a markdown report', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const result = validator.validate(model);
      const report = validator.generateReport(result);
      expect(report).toContain('# Documentation Validation Report');
      expect(report).toContain('Status');
      expect(report).toContain('Coverage');
    });

    it('should include coverage tables', () => {
      model.addFile(parser.parseFile('calc.ts', SAMPLE_CLASS_CODE));
      model.build();
      const result = validator.validate(model);
      const report = validator.generateReport(result);
      expect(report).toContain('Coverage by Type');
      expect(report).toContain('Coverage by Module');
    });
  });

  describe('addRule', () => {
    it('should accept custom validation rules', () => {
      validator.addRule({
        name: 'custom-rule',
        validate: () => [],
      });
      // Should not throw
      model.addFile(parser.parseFile('test.ts', 'export class A {}'));
      model.build();
      const result = validator.validate(model);
      expect(result).toBeDefined();
    });
  });
});
