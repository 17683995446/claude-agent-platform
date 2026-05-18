/**
 * TypeScript Parser Module
 * Parses TypeScript source files and extracts API information.
 */

// --- Types ---

export interface ParsedFile {
  filePath: string;
  moduleName: string;
  exports: ParsedExport[];
  classes: ParsedClass[];
  interfaces: ParsedInterface[];
  functions: ParsedFunction[];
  types: ParsedTypeAlias[];
  enums: ParsedEnum[];
  imports: ParsedImport[];
}

export interface ParsedImport {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isTypeOnly: boolean;
}

export interface ParsedExport {
  name: string;
  kind: 'class' | 'interface' | 'function' | 'type' | 'enum' | 'const' | 'let' | 'var' | 'default';
  isDefault: boolean;
  isTypeOnly: boolean;
  isReExport: boolean;
  originalSource?: string;
}

export interface ParsedClass {
  name: string;
  jsdoc?: string;
  extends?: string;
  implements: string[];
  typeParameters: string[];
  properties: ParsedProperty[];
  methods: ParsedMethod[];
  decorators: string[];
  isAbstract: boolean;
  isExported: boolean;
  location: SourceLocation;
}

export interface ParsedMethod {
  name: string;
  jsdoc?: string;
  parameters: ParsedParameter[];
  returnType: string;
  modifiers: string[];
  isAbstract: boolean;
  isStatic: boolean;
  isAsync: boolean;
  isOptional: boolean;
  isPrivate: boolean;
  isProtected: boolean;
  isPublic: boolean;
  location: SourceLocation;
}

export interface ParsedProperty {
  name: string;
  jsdoc?: string;
  type: string;
  modifiers: string[];
  isOptional: boolean;
  isReadonly: boolean;
  isStatic: boolean;
  isPrivate: boolean;
  isProtected: boolean;
  isPublic: boolean;
  defaultValue?: string;
  location: SourceLocation;
}

export interface ParsedParameter {
  name: string;
  type: string;
  isOptional: boolean;
  isRest: boolean;
  defaultValue?: string;
  jsdoc?: string;
}

export interface ParsedInterface {
  name: string;
  jsdoc?: string;
  extends: string[];
  typeParameters: string[];
  properties: ParsedProperty[];
  methods: ParsedMethod[];
  isExported: boolean;
  location: SourceLocation;
}

export interface ParsedFunction {
  name: string;
  jsdoc?: string;
  parameters: ParsedParameter[];
  returnType: string;
  typeParameters: string[];
  isAsync: boolean;
  isExported: boolean;
  isDefaultExport: boolean;
  isGenerator: boolean;
  location: SourceLocation;
}

export interface ParsedTypeAlias {
  name: string;
  jsdoc?: string;
  type: string;
  typeParameters: string[];
  isExported: boolean;
  location: SourceLocation;
}

export interface ParsedEnum {
  name: string;
  jsdoc?: string;
  members: ParsedEnumMember[];
  isExported: boolean;
  isConst: boolean;
  location: SourceLocation;
}

export interface ParsedEnumMember {
  name: string;
  value?: string | number;
  jsdoc?: string;
}

export interface SourceLocation {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

// --- Parser ---

export class TypeScriptParser {
  /**
   * Parse a TypeScript file and extract API information.
   */
  parseFile(filePath: string, content: string): ParsedFile {
    const moduleName = this.extractModuleName(filePath);
    const ast = this.parseToAST(content);

    return {
      filePath,
      moduleName,
      exports: this.extractExports(ast),
      classes: this.extractClasses(ast),
      interfaces: this.extractInterfaces(ast),
      functions: this.extractFunctions(ast),
      types: this.extractTypes(ast),
      enums: this.extractEnums(ast),
      imports: this.extractImports(ast),
    };
  }

  /**
   * Parse all TypeScript files in a directory.
   */
  parseDirectory(dirPath: string): ParsedFile[] {
    // In a real implementation, this would read the filesystem.
    // For testing purposes, this returns an empty array.
    return [];
  }

  /**
   * Extract all exports from the AST.
   */
  extractExports(ast: ASTNode[]): ParsedExport[] {
    const exports: ParsedExport[] = [];
    for (const node of ast) {
      if (node.type === 'export') {
        exports.push({
          name: node.name ?? 'default',
          kind: node.kind ?? 'const',
          isDefault: node.isDefault ?? false,
          isTypeOnly: node.isTypeOnly ?? false,
          isReExport: node.isReExport ?? false,
          originalSource: node.originalSource,
        });
      }
    }
    return exports;
  }

  /**
   * Extract class definitions with methods and properties.
   */
  extractClasses(ast: ASTNode[]): ParsedClass[] {
    const classes: ParsedClass[] = [];
    for (const node of ast) {
      if (node.type === 'class') {
        classes.push({
          name: node.name ?? 'Anonymous',
          jsdoc: node.jsdoc,
          extends: node.extends,
          implements: node.implements ?? [],
          typeParameters: node.typeParameters ?? [],
          properties: (node.properties ?? []) as ParsedProperty[],
          methods: (node.methods ?? []) as ParsedMethod[],
          decorators: node.decorators ?? [],
          isAbstract: node.isAbstract ?? false,
          isExported: node.isExported ?? false,
          location: node.location ?? { line: 1, column: 0 },
        });
      }
    }
    return classes;
  }

  /**
   * Extract interface definitions.
   */
  extractInterfaces(ast: ASTNode[]): ParsedInterface[] {
    const interfaces: ParsedInterface[] = [];
    for (const node of ast) {
      if (node.type === 'interface') {
        interfaces.push({
          name: node.name ?? 'Anonymous',
          jsdoc: node.jsdoc,
          extends: node.extends ?? [],
          typeParameters: node.typeParameters ?? [],
          properties: (node.properties ?? []) as ParsedProperty[],
          methods: (node.methods ?? []) as ParsedMethod[],
          isExported: node.isExported ?? false,
          location: node.location ?? { line: 1, column: 0 },
        });
      }
    }
    return interfaces;
  }

  /**
   * Extract function definitions.
   */
  extractFunctions(ast: ASTNode[]): ParsedFunction[] {
    const functions: ParsedFunction[] = [];
    for (const node of ast) {
      if (node.type === 'function') {
        functions.push({
          name: node.name ?? 'anonymous',
          jsdoc: node.jsdoc,
          parameters: (node.parameters ?? []) as ParsedParameter[],
          returnType: node.returnType ?? 'void',
          typeParameters: node.typeParameters ?? [],
          isAsync: node.isAsync ?? false,
          isExported: node.isExported ?? false,
          isDefaultExport: node.isDefaultExport ?? false,
          isGenerator: node.isGenerator ?? false,
          location: node.location ?? { line: 1, column: 0 },
        });
      }
    }
    return functions;
  }

  /**
   * Extract type aliases.
   */
  extractTypes(ast: ASTNode[]): ParsedTypeAlias[] {
    const types: ParsedTypeAlias[] = [];
    for (const node of ast) {
      if (node.type === 'type') {
        types.push({
          name: node.name ?? 'Anonymous',
          jsdoc: node.jsdoc,
          type: node.aliasType ?? 'unknown',
          typeParameters: node.typeParameters ?? [],
          isExported: node.isExported ?? false,
          location: node.location ?? { line: 1, column: 0 },
        });
      }
    }
    return types;
  }

  /**
   * Extract enum definitions.
   */
  extractEnums(ast: ASTNode[]): ParsedEnum[] {
    const enums: ParsedEnum[] = [];
    for (const node of ast) {
      if (node.type === 'enum') {
        enums.push({
          name: node.name ?? 'Anonymous',
          jsdoc: node.jsdoc,
          members: (node.members ?? []) as ParsedEnumMember[],
          isExported: node.isExported ?? false,
          isConst: node.isConst ?? false,
          location: node.location ?? { line: 1, column: 0 },
        });
      }
    }
    return enums;
  }

  // --- Internal helpers ---

  private extractImports(ast: ASTNode[]): ParsedImport[] {
    const imports: ParsedImport[] = [];
    for (const node of ast) {
      if (node.type === 'import') {
        imports.push({
          source: node.source ?? '',
          specifiers: node.specifiers ?? [],
          isDefault: node.isDefault ?? false,
          isTypeOnly: node.isTypeOnly ?? false,
        });
      }
    }
    return imports;
  }

  private extractModuleName(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    const fileName = parts[parts.length - 1] ?? 'unknown';
    return fileName.replace(/\.(ts|tsx|mts|cts)$/, '');
  }

  private parseToAST(content: string): ASTNode[] {
    // Simplified parser that extracts top-level declarations from TS source.
    const nodes: ASTNode[] = [];
    const lines = content.split('\n');

    let currentJSDoc: string | undefined;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;

      // Collect JSDoc comments
      if (line.trimStart().startsWith('/**')) {
        const jsdocLines: string[] = [];
        while (i < lines.length) {
          jsdocLines.push(lines[i]!);
          if (lines[i]!.includes('*/')) break;
          i++;
        }
        currentJSDoc = jsdocLines.join('\n');
        i++;
        continue;
      }

      // Parse imports
      const importMatch = line.match(
        /^(export\s+)?(type\s+)?import\s+(?:type\s+)?(?:\{([^}]*)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/
      );
      if (importMatch) {
        const specifiers = importMatch[2]
          ? importMatch[2].split(',').map((s) => s.trim()).filter(Boolean)
          : importMatch[3]
            ? [importMatch[3]]
            : [];
        nodes.push({
          type: 'import',
          source: importMatch[5],
          specifiers,
          isDefault: !!importMatch[3],
          isTypeOnly: line.includes('import type') || (importMatch[1] !== undefined && line.includes('type')),
        });
        i++;
        continue;
      }

      // Parse exports
      const exportMatch = line.match(/^export\s+(?:type\s+)?(?:default\s+)?(?:const|let|var|function|class|interface|enum|type)\s+(\w+)/);
      if (exportMatch) {
        const name = exportMatch[1]!;
        const isDefault = line.includes('export default');
        const isTypeOnly = line.includes('export type');
        const kind = this.detectExportKind(line);
        nodes.push({
          type: 'export',
          name,
          kind,
          isDefault,
          isTypeOnly,
          isReExport: false,
        });
      }

      // Parse classes
      const classMatch = line.match(/^(export\s+)?(abstract\s+)?class\s+(\w+)(?:<([^>]+)>)?(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/);
      if (classMatch) {
        const node: ASTNode = {
          type: 'class',
          name: classMatch[3],
          jsdoc: currentJSDoc,
          isExported: !!classMatch[1],
          isAbstract: !!classMatch[2],
          typeParameters: classMatch[4] ? classMatch[4].split(',').map((s) => s.trim()) : [],
          extends: classMatch[5],
          implements: classMatch[6] ? classMatch[6].split(',').map((s) => s.trim()) : [],
          properties: [],
          methods: [],
          decorators: [],
          location: { line: i + 1, column: 0 },
        };
        i++;
        // Parse class body
        while (i < lines.length) {
          const classLine = lines[i]!;
          if (classLine.trim() === '}') break;

          // Collect method JSDoc
          let methodJSDoc: string | undefined;
          if (classLine.trimStart().startsWith('/**')) {
            const mJSDocLines: string[] = [];
            while (i < lines.length) {
              mJSDocLines.push(lines[i]!);
              if (lines[i]!.includes('*/')) break;
              i++;
            }
            methodJSDoc = mJSDocLines.join('\n');
            i++;
            continue;
          }

          // Parse method
          const methodMatch = classLine.match(
            /^\s*(public|private|protected|static|abstract|readonly|async)?\s*(public|private|protected|static|abstract|readonly|async)?\s*(?:get\s+|set\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^;{]+))?/
          );
          if (methodMatch && !classLine.includes('=')) {
            const params = this.parseParameters(methodMatch[4] ?? '');
            (node.methods as ParsedMethod[]).push({
              name: methodMatch[3],
              jsdoc: methodJSDoc,
              parameters: params,
              returnType: methodMatch[5]?.trim() ?? 'void',
              modifiers: [methodMatch[1], methodMatch[2]].filter(Boolean),
              isAbstract: classLine.includes('abstract'),
              isStatic: classLine.includes('static'),
              isAsync: classLine.includes('async'),
              isOptional: classLine.endsWith('?'),
              isPrivate: classLine.includes('private'),
              isProtected: classLine.includes('protected'),
              isPublic: classLine.includes('public'),
              location: { line: i + 1, column: classLine.search(/\S/) },
            });
          }

          // Parse property
          const propMatch = classLine.match(
            /^\s*(public|private|protected|static|readonly|abstract)?\s*(public|private|protected|static|readonly|abstract)?\s*(\w+)\s*(\?)?\s*:\s*([^;=]+)(?:\s*=\s*([^;]+))?/
          );
          if (propMatch && !classLine.includes('(') && !classLine.includes('=>')) {
            (node.properties as ParsedProperty[]).push({
              name: propMatch[3],
              jsdoc: methodJSDoc,
              type: propMatch[5]?.trim() ?? 'any',
              modifiers: [propMatch[1], propMatch[2]].filter(Boolean),
              isOptional: propMatch[4] === '?',
              isReadonly: classLine.includes('readonly'),
              isStatic: classLine.includes('static'),
              isPrivate: classLine.includes('private'),
              isProtected: classLine.includes('protected'),
              isPublic: classLine.includes('public'),
              defaultValue: propMatch[6]?.trim(),
              location: { line: i + 1, column: classLine.search(/\S/) },
            });
          }

          i++;
        }
        nodes.push(node);
        currentJSDoc = undefined;
        i++;
        continue;
      }

      // Parse interfaces
      const ifaceMatch = line.match(/^(export\s+)?interface\s+(\w+)(?:<([^>]+)>)?(?:\s+extends\s+([^{]+))?/);
      if (ifaceMatch) {
        const node: ASTNode = {
          type: 'interface',
          name: ifaceMatch[2],
          jsdoc: currentJSDoc,
          isExported: !!ifaceMatch[1],
          typeParameters: ifaceMatch[3] ? ifaceMatch[3].split(',').map((s) => s.trim()) : [],
          extends: ifaceMatch[4] ? ifaceMatch[4].split(',').map((s) => s.trim()) : [],
          properties: [],
          methods: [],
          location: { line: i + 1, column: 0 },
        };
        i++;
        while (i < lines.length) {
          const ifaceLine = lines[i]!;
          if (ifaceLine.trim() === '}') break;

          const methodSig = ifaceLine.match(/^\s*(\w+)\s*\(([^)]*)\)\s*(?::\s*([^;]+))?/);
          if (methodSig) {
            (node.methods as ParsedMethod[]).push({
              name: methodSig[1],
              parameters: this.parseParameters(methodSig[2] ?? ''),
              returnType: methodSig[3]?.trim() ?? 'void',
              modifiers: [],
              isAbstract: false,
              isStatic: false,
              isAsync: false,
              isOptional: false,
              isPrivate: false,
              isProtected: false,
              isPublic: false,
              location: { line: i + 1, column: ifaceLine.search(/\S/) },
            });
          } else {
            const propSig = ifaceLine.match(/^\s*(readonly\s+)?(\w+)\s*(\?)?\s*:\s*([^;]+)/);
            if (propSig) {
              (node.properties as ParsedProperty[]).push({
                name: propSig[2],
                type: propSig[4]?.trim() ?? 'any',
                modifiers: propSig[1] ? [propSig[1].trim()] : [],
                isOptional: propSig[3] === '?',
                isReadonly: ifaceLine.includes('readonly'),
                isStatic: false,
                isPrivate: false,
                isProtected: false,
                isPublic: false,
                location: { line: i + 1, column: ifaceLine.search(/\S/) },
              });
            }
          }
          i++;
        }
        nodes.push(node);
        currentJSDoc = undefined;
        i++;
        continue;
      }

      // Parse functions
      const fnMatch = line.match(/^(export\s+)?(export\s+default\s+)?(async\s+)?function\s*(\*)?\s*(\w+)\s*(?:<([^>]+)>)?\s*\(([^)]*)\)\s*(?::\s*([^;{]+))?/);
      if (fnMatch) {
        nodes.push({
          type: 'function',
          name: fnMatch[5],
          jsdoc: currentJSDoc,
          isExported: !!fnMatch[1],
          isDefaultExport: !!fnMatch[2],
          isAsync: !!fnMatch[3],
          isGenerator: !!fnMatch[4],
          typeParameters: fnMatch[6] ? fnMatch[6].split(',').map((s) => s.trim()) : [],
          parameters: this.parseParameters(fnMatch[7] ?? ''),
          returnType: fnMatch[8]?.trim() ?? 'void',
          location: { line: i + 1, column: 0 },
        });
        currentJSDoc = undefined;
      }

      // Parse type aliases
      const typeMatch = line.match(/^(export\s+)?type\s+(\w+)(?:<([^>]+)>)?\s*=\s*([^;]+)/);
      if (typeMatch) {
        nodes.push({
          type: 'type',
          name: typeMatch[2],
          jsdoc: currentJSDoc,
          isExported: !!typeMatch[1],
          typeParameters: typeMatch[3] ? typeMatch[3].split(',').map((s) => s.trim()) : [],
          aliasType: typeMatch[4]?.trim(),
          location: { line: i + 1, column: 0 },
        });
        currentJSDoc = undefined;
      }

      // Parse enums
      const enumMatch = line.match(/^(export\s+)?(const\s+)?enum\s+(\w+)/);
      if (enumMatch) {
        const node: ASTNode = {
          type: 'enum',
          name: enumMatch[3],
          jsdoc: currentJSDoc,
          isExported: !!enumMatch[1],
          isConst: !!enumMatch[2],
          members: [],
          location: { line: i + 1, column: 0 },
        };
        i++;
        while (i < lines.length) {
          const enumLine = lines[i]!;
          if (enumLine.trim() === '}') break;
          const memberMatch = enumLine.match(/^\s*(\w+)\s*=\s*(.+?)[,]?\s*$/);
          if (memberMatch) {
            (node.members as ParsedEnumMember[]).push({
              name: memberMatch[1],
              value: memberMatch[2]?.trim(),
            });
          } else {
            const nameOnly = enumLine.match(/^\s*(\w+)\s*[,]?\s*$/);
            if (nameOnly) {
              (node.members as ParsedEnumMember[]).push({
                name: nameOnly[1],
              });
            }
          }
          i++;
        }
        nodes.push(node);
        currentJSDoc = undefined;
        i++;
        continue;
      }

      if (!line.match(/^(export\s+)?(const|let|var)\s/) && !line.match(/^(\/\/|\/\*|\*|\s*$)/)) {
        currentJSDoc = undefined;
      }

      i++;
    }

    return nodes;
  }

  private parseParameters(paramString: string): ParsedParameter[] {
    if (!paramString.trim()) return [];
    const params: ParsedParameter[] = [];
    // Simple parameter parsing
    const parts = this.splitParameters(paramString);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const restMatch = trimmed.match(/^\.\.\.(\w+)(?:\s*:\s*(.+))?$/);
      if (restMatch) {
        params.push({
          name: restMatch[1],
          type: restMatch[2]?.trim() ?? 'any',
          isOptional: false,
          isRest: true,
        });
        continue;
      }

      const optMatch = trimmed.match(/^(\w+)\s*\?\s*:\s*(.+)$/);
      if (optMatch) {
        const defMatch = trimmed.match(/^(\w+)\s*\?\s*:\s*(.+?)\s*=\s*(.+)$/);
        params.push({
          name: optMatch[1],
          type: defMatch ? defMatch[2]?.trim() ?? 'any' : optMatch[2]?.trim() ?? 'any',
          isOptional: true,
          isRest: false,
          defaultValue: defMatch ? defMatch[3]?.trim() : undefined,
        });
        continue;
      }

      const defMatch = trimmed.match(/^(\w+)\s*:\s*(.+?)\s*=\s*(.+)$/);
      if (defMatch) {
        params.push({
          name: defMatch[1],
          type: defMatch[2]?.trim() ?? 'any',
          isOptional: true,
          isRest: false,
          defaultValue: defMatch[3]?.trim(),
        });
        continue;
      }

      const simpleMatch = trimmed.match(/^(\w+)\s*:\s*(.+)$/);
      if (simpleMatch) {
        params.push({
          name: simpleMatch[1],
          type: simpleMatch[2]?.trim() ?? 'any',
          isOptional: false,
          isRest: false,
        });
        continue;
      }

      // Just a name
      const nameOnly = trimmed.match(/^(\w+)$/);
      if (nameOnly) {
        params.push({
          name: nameOnly[1],
          type: 'any',
          isOptional: false,
          isRest: false,
        });
      }
    }
    return params;
  }

  private splitParameters(paramString: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of paramString) {
      if (char === '<' || char === '(' || char === '[' || char === '{') depth++;
      if (char === '>' || char === ')' || char === ']' || char === '}') depth--;
      if (char === ',' && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) parts.push(current);
    return parts;
  }

  private detectExportKind(line: string): ParsedExport['kind'] {
    if (line.includes('class ')) return 'class';
    if (line.includes('interface ')) return 'interface';
    if (line.includes('function ')) return 'function';
    if (line.includes('type ')) return 'type';
    if (line.includes('enum ')) return 'enum';
    if (line.includes('const ')) return 'const';
    if (line.includes('let ')) return 'let';
    if (line.includes('var ')) return 'var';
    return 'const';
  }
}

// Internal AST node type
interface ASTNode {
  type: string;
  name?: string;
  jsdoc?: string;
  [key: string]: unknown;
}
