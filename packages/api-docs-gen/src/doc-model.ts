/**
 * Documentation Model Module
 * Builds a documentation data model from parsed TypeScript files.
 */

import type { ParsedFile, ParsedClass, ParsedInterface, ParsedFunction, ParsedTypeAlias, ParsedEnum } from './ts-parser.js';
import type { JSDocData } from './jsdoc-extractor.js';

// --- Types ---

export interface ModuleDoc {
  name: string;
  filePath: string;
  description: string;
  exports: string[];
  classes: ClassDoc[];
  interfaces: InterfaceDoc[];
  functions: FunctionDoc[];
  typeAliases: TypeAliasDoc[];
  enums: EnumDoc[];
}

export interface ClassDoc {
  name: string;
  fqn: string;
  moduleName: string;
  description: string;
  jsdoc?: JSDocData;
  extends?: string;
  implements: string[];
  typeParameters: string[];
  properties: PropertyDoc[];
  methods: MethodDoc[];
  decorators: string[];
  isAbstract: boolean;
  isExported: boolean;
}

export interface MethodDoc {
  name: string;
  fqn: string;
  className: string;
  description: string;
  jsdoc?: JSDocData;
  parameters: Array<{
    name: string;
    type: string;
    isOptional: boolean;
    isRest: boolean;
    defaultValue?: string;
  }>;
  returnType: string;
  modifiers: string[];
  isAbstract: boolean;
  isStatic: boolean;
  isAsync: boolean;
  isPrivate: boolean;
  isProtected: boolean;
  isPublic: boolean;
}

export interface PropertyDoc {
  name: string;
  type: string;
  description: string;
  jsdoc?: JSDocData;
  isOptional: boolean;
  isReadonly: boolean;
  isStatic: boolean;
  isPrivate: boolean;
  isProtected: boolean;
  isPublic: boolean;
  defaultValue?: string;
}

export interface InterfaceDoc {
  name: string;
  fqn: string;
  moduleName: string;
  description: string;
  jsdoc?: JSDocData;
  extends: string[];
  typeParameters: string[];
  properties: PropertyDoc[];
  methods: MethodDoc[];
  isExported: boolean;
}

export interface FunctionDoc {
  name: string;
  fqn: string;
  moduleName: string;
  description: string;
  jsdoc?: JSDocData;
  parameters: Array<{
    name: string;
    type: string;
    isOptional: boolean;
    isRest: boolean;
    defaultValue?: string;
  }>;
  returnType: string;
  typeParameters: string[];
  isAsync: boolean;
  isExported: boolean;
  isDefaultExport: boolean;
  isGenerator: boolean;
}

export interface TypeAliasDoc {
  name: string;
  fqn: string;
  moduleName: string;
  description: string;
  jsdoc?: JSDocData;
  type: string;
  typeParameters: string[];
  isExported: boolean;
}

export interface EnumDoc {
  name: string;
  fqn: string;
  moduleName: string;
  description: string;
  jsdoc?: JSDocData;
  members: Array<{ name: string; value?: string | number }>;
  isExported: boolean;
  isConst: boolean;
}

export interface DocStats {
  totalModules: number;
  totalClasses: number;
  totalInterfaces: number;
  totalFunctions: number;
  totalTypeAliases: number;
  totalEnums: number;
  totalMethods: number;
  totalProperties: number;
  documentedSymbols: number;
  undocumentedSymbols: number;
  coveragePercent: number;
}

// --- Model ---

export class DocModel {
  private files: ParsedFile[] = [];
  private modules: Map<string, ModuleDoc> = new Map();
  private classes: Map<string, ClassDoc> = new Map();
  private interfaces: Map<string, InterfaceDoc> = new Map();
  private functions: Map<string, FunctionDoc> = new Map();
  private built = false;

  /**
   * Add a parsed file to the model.
   */
  addFile(parsedFile: ParsedFile): void {
    this.files.push(parsedFile);
    this.built = false;
  }

  /**
   * Build complete documentation from all added files.
   */
  build(): void {
    this.modules.clear();
    this.classes.clear();
    this.interfaces.clear();
    this.functions.clear();

    for (const file of this.files) {
      const modDoc = this.buildModuleDoc(file);
      this.modules.set(file.moduleName, modDoc);

      for (const cls of modDoc.classes) {
        this.classes.set(cls.fqn, cls);
      }
      for (const iface of modDoc.interfaces) {
        this.interfaces.set(iface.fqn, iface);
      }
      for (const fn of modDoc.functions) {
        this.functions.set(fn.fqn, fn);
      }
    }

    this.built = true;
  }

  /**
   * Get module documentation by name.
   */
  getModule(name: string): ModuleDoc | undefined {
    return this.modules.get(name);
  }

  /**
   * Get class documentation by fully qualified name.
   */
  getClass(fqn: string): ClassDoc | undefined {
    return this.classes.get(fqn);
  }

  /**
   * Get interface documentation by fully qualified name.
   */
  getInterface(fqn: string): InterfaceDoc | undefined {
    return this.interfaces.get(fqn);
  }

  /**
   * Get function documentation by fully qualified name.
   */
  getFunction(fqn: string): FunctionDoc | undefined {
    return this.functions.get(fqn);
  }

  /**
   * Search documentation by query string.
   */
  search(query: string): Array<{
    type: 'class' | 'interface' | 'function' | 'type' | 'enum' | 'module';
    name: string;
    moduleName: string;
    description: string;
  }> {
    const results: Array<{
      type: 'class' | 'interface' | 'function' | 'type' | 'enum' | 'module';
      name: string;
      moduleName: string;
      description: string;
    }> = [];
    const lowerQuery = query.toLowerCase();

    for (const [, mod] of this.modules) {
      if (mod.name.toLowerCase().includes(lowerQuery) || mod.description.toLowerCase().includes(lowerQuery)) {
        results.push({ type: 'module', name: mod.name, moduleName: mod.name, description: mod.description });
      }
      for (const cls of mod.classes) {
        if (cls.name.toLowerCase().includes(lowerQuery) || cls.description.toLowerCase().includes(lowerQuery)) {
          results.push({ type: 'class', name: cls.name, moduleName: cls.moduleName, description: cls.description });
        }
      }
      for (const iface of mod.interfaces) {
        if (iface.name.toLowerCase().includes(lowerQuery) || iface.description.toLowerCase().includes(lowerQuery)) {
          results.push({ type: 'interface', name: iface.name, moduleName: iface.moduleName, description: iface.description });
        }
      }
      for (const fn of mod.functions) {
        if (fn.name.toLowerCase().includes(lowerQuery) || fn.description.toLowerCase().includes(lowerQuery)) {
          results.push({ type: 'function', name: fn.name, moduleName: fn.moduleName, description: fn.description });
        }
      }
      for (const ta of mod.typeAliases) {
        if (ta.name.toLowerCase().includes(lowerQuery) || ta.description.toLowerCase().includes(lowerQuery)) {
          results.push({ type: 'type', name: ta.name, moduleName: ta.moduleName, description: ta.description });
        }
      }
      for (const en of mod.enums) {
        if (en.name.toLowerCase().includes(lowerQuery) || en.description.toLowerCase().includes(lowerQuery)) {
          results.push({ type: 'enum', name: en.name, moduleName: en.moduleName, description: en.description });
        }
      }
    }

    return results;
  }

  /**
   * Get documentation statistics.
   */
  getStats(): DocStats {
    let totalClasses = 0;
    let totalInterfaces = 0;
    let totalFunctions = 0;
    let totalTypeAliases = 0;
    let totalEnums = 0;
    let totalMethods = 0;
    let totalProperties = 0;
    let documentedSymbols = 0;
    let totalSymbols = 0;

    for (const [, mod] of this.modules) {
      totalClasses += mod.classes.length;
      totalInterfaces += mod.interfaces.length;
      totalFunctions += mod.functions.length;
      totalTypeAliases += mod.typeAliases.length;
      totalEnums += mod.enums.length;

      for (const cls of mod.classes) {
        totalSymbols++;
        if (cls.description) documentedSymbols++;
        totalMethods += cls.methods.length;
        totalProperties += cls.properties.length;
        for (const m of cls.methods) {
          totalSymbols++;
          if (m.description) documentedSymbols++;
        }
        for (const p of cls.properties) {
          totalSymbols++;
          if (p.description) documentedSymbols++;
        }
      }
      for (const iface of mod.interfaces) {
        totalSymbols++;
        if (iface.description) documentedSymbols++;
        totalMethods += iface.methods.length;
        totalProperties += iface.properties.length;
      }
      for (const fn of mod.functions) {
        totalSymbols++;
        if (fn.description) documentedSymbols++;
      }
      for (const ta of mod.typeAliases) {
        totalSymbols++;
        if (ta.description) documentedSymbols++;
      }
      for (const en of mod.enums) {
        totalSymbols++;
        if (en.description) documentedSymbols++;
      }
    }

    const coveragePercent = totalSymbols > 0 ? Math.round((documentedSymbols / totalSymbols) * 100) : 100;

    return {
      totalModules: this.modules.size,
      totalClasses,
      totalInterfaces,
      totalFunctions,
      totalTypeAliases,
      totalEnums,
      totalMethods,
      totalProperties,
      documentedSymbols,
      undocumentedSymbols: totalSymbols - documentedSymbols,
      coveragePercent,
    };
  }

  /**
   * Get all modules.
   */
  getAllModules(): ModuleDoc[] {
    return Array.from(this.modules.values());
  }

  // --- Internal helpers ---

  private buildModuleDoc(file: ParsedFile): ModuleDoc {
    const modDoc: ModuleDoc = {
      name: file.moduleName,
      filePath: file.filePath,
      description: '',
      exports: file.exports.map((e) => e.name),
      classes: [],
      interfaces: [],
      functions: [],
      typeAliases: [],
      enums: [],
    };

    for (const cls of file.classes) {
      modDoc.classes.push(this.buildClassDoc(cls, file.moduleName));
    }
    for (const iface of file.interfaces) {
      modDoc.interfaces.push(this.buildInterfaceDoc(iface, file.moduleName));
    }
    for (const fn of file.functions) {
      modDoc.functions.push(this.buildFunctionDoc(fn, file.moduleName));
    }
    for (const ta of file.types) {
      modDoc.typeAliases.push(this.buildTypeAliasDoc(ta, file.moduleName));
    }
    for (const en of file.enums) {
      modDoc.enums.push(this.buildEnumDoc(en, file.moduleName));
    }

    return modDoc;
  }

  private buildClassDoc(cls: ParsedClass, moduleName: string): ClassDoc {
    return {
      name: cls.name,
      fqn: `${moduleName}.${cls.name}`,
      moduleName,
      description: cls.jsdoc ? cls.jsdoc.split('\n').find((l) => l.trim() && !l.trim().startsWith('*') && !l.trim().startsWith('@'))?.trim() ?? '' : '',
      jsdoc: cls.jsdoc ? this.parseSimpleJSDoc(cls.jsdoc) : undefined,
      extends: cls.extends,
      implements: cls.implements,
      typeParameters: cls.typeParameters,
      properties: cls.properties.map((p) => ({
        name: p.name,
        type: p.type,
        description: p.jsdoc ? this.extractDescription(p.jsdoc) : '',
        jsdoc: p.jsdoc ? this.parseSimpleJSDoc(p.jsdoc) : undefined,
        isOptional: p.isOptional,
        isReadonly: p.isReadonly,
        isStatic: p.isStatic,
        isPrivate: p.isPrivate,
        isProtected: p.isProtected,
        isPublic: p.isPublic,
        defaultValue: p.defaultValue,
      })),
      methods: cls.methods.map((m) => ({
        name: m.name,
        fqn: `${moduleName}.${cls.name}.${m.name}`,
        className: cls.name,
        description: m.jsdoc ? this.extractDescription(m.jsdoc) : '',
        jsdoc: m.jsdoc ? this.parseSimpleJSDoc(m.jsdoc) : undefined,
        parameters: m.parameters.map((p) => ({
          name: p.name,
          type: p.type,
          isOptional: p.isOptional,
          isRest: p.isRest,
          defaultValue: p.defaultValue,
        })),
        returnType: m.returnType,
        modifiers: m.modifiers,
        isAbstract: m.isAbstract,
        isStatic: m.isStatic,
        isAsync: m.isAsync,
        isPrivate: m.isPrivate,
        isProtected: m.isProtected,
        isPublic: m.isPublic,
      })),
      decorators: cls.decorators,
      isAbstract: cls.isAbstract,
      isExported: cls.isExported,
    };
  }

  private buildInterfaceDoc(iface: ParsedInterface, moduleName: string): InterfaceDoc {
    return {
      name: iface.name,
      fqn: `${moduleName}.${iface.name}`,
      moduleName,
      description: iface.jsdoc ? this.extractDescription(iface.jsdoc) : '',
      jsdoc: iface.jsdoc ? this.parseSimpleJSDoc(iface.jsdoc) : undefined,
      extends: iface.extends,
      typeParameters: iface.typeParameters,
      properties: iface.properties.map((p) => ({
        name: p.name,
        type: p.type,
        description: p.jsdoc ? this.extractDescription(p.jsdoc) : '',
        jsdoc: p.jsdoc ? this.parseSimpleJSDoc(p.jsdoc) : undefined,
        isOptional: p.isOptional,
        isReadonly: p.isReadonly,
        isStatic: p.isStatic,
        isPrivate: p.isPrivate,
        isProtected: p.isProtected,
        isPublic: p.isPublic,
        defaultValue: p.defaultValue,
      })),
      methods: iface.methods.map((m) => ({
        name: m.name,
        fqn: `${moduleName}.${iface.name}.${m.name}`,
        className: iface.name,
        description: m.jsdoc ? this.extractDescription(m.jsdoc) : '',
        jsdoc: m.jsdoc ? this.parseSimpleJSDoc(m.jsdoc) : undefined,
        parameters: m.parameters.map((p) => ({
          name: p.name,
          type: p.type,
          isOptional: p.isOptional,
          isRest: p.isRest,
          defaultValue: p.defaultValue,
        })),
        returnType: m.returnType,
        modifiers: m.modifiers,
        isAbstract: false,
        isStatic: false,
        isAsync: false,
        isPrivate: false,
        isProtected: false,
        isPublic: false,
      })),
      isExported: iface.isExported,
    };
  }

  private buildFunctionDoc(fn: ParsedFunction, moduleName: string): FunctionDoc {
    return {
      name: fn.name,
      fqn: `${moduleName}.${fn.name}`,
      moduleName,
      description: fn.jsdoc ? this.extractDescription(fn.jsdoc) : '',
      jsdoc: fn.jsdoc ? this.parseSimpleJSDoc(fn.jsdoc) : undefined,
      parameters: fn.parameters.map((p) => ({
        name: p.name,
        type: p.type,
        isOptional: p.isOptional,
        isRest: p.isRest,
        defaultValue: p.defaultValue,
      })),
      returnType: fn.returnType,
      typeParameters: fn.typeParameters,
      isAsync: fn.isAsync,
      isExported: fn.isExported,
      isDefaultExport: fn.isDefaultExport,
      isGenerator: fn.isGenerator,
    };
  }

  private buildTypeAliasDoc(ta: ParsedTypeAlias, moduleName: string): TypeAliasDoc {
    return {
      name: ta.name,
      fqn: `${moduleName}.${ta.name}`,
      moduleName,
      description: ta.jsdoc ? this.extractDescription(ta.jsdoc) : '',
      jsdoc: ta.jsdoc ? this.parseSimpleJSDoc(ta.jsdoc) : undefined,
      type: ta.type,
      typeParameters: ta.typeParameters,
      isExported: ta.isExported,
    };
  }

  private buildEnumDoc(en: ParsedEnum, moduleName: string): EnumDoc {
    return {
      name: en.name,
      fqn: `${moduleName}.${en.name}`,
      moduleName,
      description: en.jsdoc ? this.extractDescription(en.jsdoc) : '',
      jsdoc: en.jsdoc ? this.parseSimpleJSDoc(en.jsdoc) : undefined,
      members: en.members,
      isExported: en.isExported,
      isConst: en.isConst,
    };
  }

  private extractDescription(jsdoc: string): string {
    const lines = jsdoc.split('\n');
    const descLines: string[] = [];
    for (const line of lines) {
      const cleaned = line.replace(/^\s*\*\s?/, '').replace(/^\/\*\*/, '').replace(/\*\/$/, '').trim();
      if (cleaned && !cleaned.startsWith('@')) {
        descLines.push(cleaned);
      } else if (cleaned.startsWith('@')) {
        break;
      }
    }
    return descLines.join(' ').trim();
  }

  private parseSimpleJSDoc(jsdoc: string): JSDocData {
    const description = this.extractDescription(jsdoc);
    return {
      description,
      summary: description.split('.')[0] ?? '',
      tags: [],
      examples: [],
      params: [],
      returns: [],
      throws: [],
      deprecated: false,
      since: '',
      see: [],
      category: '',
      internal: false,
    };
  }
}
