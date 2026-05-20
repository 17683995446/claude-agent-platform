/**
 * AST Parser Module
 *
 * Provides functionality to parse TypeScript/JavaScript code into an AST,
 * and extract structural information such as functions, classes, interfaces,
 * types, and imports.
 */

/** Supported programming languages */
export type SupportedLanguage = "typescript" | "javascript";

/** Position information in source code */
export interface SourcePosition {
  line: number;
  column: number;
}

/** Source range from start to end position */
export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

/** Represents a parsed import statement */
export interface ImportInfo {
  source: string;
  specifiers: Array<{
    name: string;
    alias?: string;
    isDefault?: boolean;
    isNamespace?: boolean;
  }>;
  isTypeOnly: boolean;
  range: SourceRange;
}

/** Represents a parsed function */
export interface FunctionInfo {
  name: string;
  parameters: Array<{
    name: string;
    type?: string;
    defaultValue?: string;
    optional?: boolean;
  }>;
  returnType?: string;
  isAsync: boolean;
  isGenerator: boolean;
  isExported: boolean;
  isArrow: boolean;
  complexity: number;
  range: SourceRange;
  body: string;
}

/** Represents a parsed class */
export interface ClassInfo {
  name: string;
  superClass?: string;
  implementedInterfaces: string[];
  typeParameters?: string[];
  methods: FunctionInfo[];
  properties: Array<{
    name: string;
    type?: string;
    isPrivate: boolean;
    isProtected: boolean;
    isStatic: boolean;
    isReadonly: boolean;
    defaultValue?: string;
  }>;
  decorators: string[];
  isExported: boolean;
  isAbstract: boolean;
  range: SourceRange;
}

/** Represents a parsed interface or type alias */
export interface TypeInfo {
  name: string;
  kind: "interface" | "type" | "enum";
  typeParameters?: string[];
  members: Array<{
    name: string;
    type: string;
    optional?: boolean;
    readonly?: boolean;
  }>;
  extends?: string[];
  range: SourceRange;
}

/** The root AST node */
export interface ASTNode {
  type: string;
  kind?: string;
  name?: string;
  body?: ASTNode[];
  declarations?: ASTNode[];
  range?: SourceRange;
  [key: string]: unknown;
}

/** The full AST representation */
export interface AST {
  type: "Program";
  body: ASTNode[];
  sourceType: "script" | "module";
  range: SourceRange;
  language: SupportedLanguage;
}

/** Complexity metrics for a node */
export interface ComplexityMetrics {
  cyclomatic: number;
  cognitive: number;
  linesOfCode: number;
  nestingDepth: number;
}

/**
 * ASTParser - Parse TypeScript/JavaScript code into AST structures
 * and extract structural information.
 */
export class ASTParser {
  private language: SupportedLanguage;

  constructor(language: SupportedLanguage = "typescript") {
    this.language = language;
  }

  /**
   * Parse source code into an AST representation.
   * @param code - The source code to parse
   * @param lang - Override language (defaults to constructor language)
   * @returns Parsed AST
   * @throws Error if code is empty or malformed
   */
  parse(code: string, lang?: SupportedLanguage): AST {
    if (!code || code.trim().length === 0) {
      return {
        type: "Program",
        body: [],
        sourceType: "module",
        range: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
        language: lang ?? this.language,
      };
    }

    const targetLang = lang ?? this.language;
    const lines = code.split("\n");
    const body: ASTNode[] = [];

    // Track multi-line state
    let inMultiLineComment = false;
    let inMultiLineString: "double" | "single" | "template" | null = null;
    let multiLineBuffer = "";
    let multiLineStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Handle multi-line comment tracking
      if (inMultiLineComment) {
        multiLineBuffer += "\n" + line;
        if (line.includes("*/")) {
          inMultiLineComment = false;
          // Don't parse comment blocks as code
          multiLineBuffer = "";
        }
        continue;
      }
      if (line.includes("/*") && !line.includes("*/")) {
        inMultiLineComment = true;
        multiLineBuffer = line;
        continue;
      }

      // Handle multi-line string tracking
      if (inMultiLineString) {
        multiLineBuffer += "\n" + line;
        const closeChar = inMultiLineString === "double" ? '"' : inMultiLineString === "single" ? "'" : "`";
        if (line.includes(closeChar)) {
          inMultiLineString = null;
          // The accumulated buffer may contain a complete statement
          const trimmed = multiLineBuffer.trim();
          if (trimmed) {
            const node = this.parseLine(trimmed, multiLineStartLine);
            if (node) body.push(node);
          }
          multiLineBuffer = "";
        }
        continue;
      }

      // Detect start of multi-line strings
      const doubleQuoteCount = (line.match(/"/g) ?? []).length;
      const singleQuoteCount = (line.match(/'/g) ?? []).length;
      const backtickCount = (line.match(/`/g) ?? []).length;

      if (doubleQuoteCount % 2 !== 0 && !inMultiLineString) {
        inMultiLineString = "double";
        multiLineBuffer = line;
        multiLineStartLine = i;
        continue;
      }
      if (singleQuoteCount % 2 !== 0 && !inMultiLineString) {
        inMultiLineString = "single";
        multiLineBuffer = line;
        multiLineStartLine = i;
        continue;
      }
      if (backtickCount % 2 !== 0 && !inMultiLineString) {
        inMultiLineString = "template";
        multiLineBuffer = line;
        multiLineStartLine = i;
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      const node = this.parseLine(trimmed, i);
      if (node) {
        body.push(node);
      }
    }

    return {
      type: "Program",
      body,
      sourceType: code.includes("import ") || code.includes("export ") ? "module" : "script",
      range: {
        start: { line: 1, column: 0 },
        end: { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) },
      },
      language: targetLang,
    };
  }

  /**
   * Extract all function declarations and expressions from an AST.
   * @param ast - The AST to extract functions from
   * @returns Array of function information
   */
  extractFunctions(ast: AST): FunctionInfo[] {
    const functions: FunctionInfo[] = [];

    for (const node of ast.body) {
      this.extractFunctionsFromNode(node, functions, false);
    }

    return functions;
  }

  /**
   * Extract all class declarations from an AST.
   * @param ast - The AST to extract classes from
   * @returns Array of class information
   */
  extractClasses(ast: AST): ClassInfo[] {
    const classes: ClassInfo[] = [];

    for (const node of ast.body) {
      if (node.type === "ClassDeclaration" || node.kind === "class") {
        classes.push(this.extractClassInfo(node));
      }
    }

    return classes;
  }

  /**
   * Extract all import declarations from an AST.
   * @param ast - The AST to extract imports from
   * @returns Array of import information
   */
  extractImports(ast: AST): ImportInfo[] {
    const imports: ImportInfo[] = [];

    for (const node of ast.body) {
      if (node.type === "ImportDeclaration") {
        imports.push(this.extractImportInfo(node));
      }
    }

    return imports;
  }

  /**
   * Calculate cyclomatic and cognitive complexity for a given AST node.
   * @param node - The AST node to analyze
   * @returns Complexity metrics
   */
  getComplexity(node: ASTNode): ComplexityMetrics {
    const metrics: ComplexityMetrics = {
      cyclomatic: 1,
      cognitive: 0,
      linesOfCode: 0,
      nestingDepth: 0,
    };

    this.calculateComplexity(node, metrics, 0);

    return metrics;
  }

  // --- Private helper methods ---

  private parseLine(line: string, lineIndex: number): ASTNode | null {
    const range: SourceRange = {
      start: { line: lineIndex + 1, column: 0 },
      end: { line: lineIndex + 1, column: line.length },
    };

    // Import detection
    if (line.startsWith("import ")) {
      const node = this.parseImport(line, range);
      (node as Record<string, unknown>).raw = line;
      return node;
    }

    // Export detection
    const isExported = line.startsWith("export ");

    // Function detection (also handle optional chaining ?. which contains no space before ?)
    if (line.includes("function ") || line.includes("=>") || /\?\.\s*\(/.test(line)) {
      const node = this.parseFunction(line, range, isExported);
      (node as Record<string, unknown>).raw = line;
      return node;
    }

    // Class detection
    if (line.includes("class ")) {
      const node = this.parseClass(line, range, isExported);
      (node as Record<string, unknown>).raw = line;
      return node;
    }

    // Interface detection
    if (line.includes("interface ")) {
      const node = this.parseInterface(line, range);
      (node as Record<string, unknown>).raw = line;
      return node;
    }

    // Type alias detection
    if (line.includes("type ") && line.includes("=")) {
      const node = this.parseTypeAlias(line, range);
      (node as Record<string, unknown>).raw = line;
      return node;
    }

    // Variable declaration
    if (line.startsWith("const ") || line.startsWith("let ") || line.startsWith("var ")) {
      const node: ASTNode = {
        type: "VariableDeclaration",
        kind: line.startsWith("const ") ? "const" : line.startsWith("let ") ? "let" : "var",
        range,
      };
      (node as Record<string, unknown>).raw = line;
      return node;
    }

    // Expression statement
    const node: ASTNode = {
      type: "ExpressionStatement",
      range,
    };
    (node as Record<string, unknown>).raw = line;
    return node;
  }

  private parseImport(line: string, range: SourceRange): ASTNode {
    const sourceMatch = line.match(/from\s+['"](.+?)['"]/);
    const source = sourceMatch ? sourceMatch[1] : "";

    const specifiers: ImportInfo["specifiers"] = [];
    const isTypeOnly = line.includes("import type ");

    // Default import
    const defaultMatch = line.match(/import\s+(\w+)/);
    if (defaultMatch && !line.includes("{")) {
      specifiers.push({ name: defaultMatch[1], isDefault: true });
    }

    // Named imports
    const namedMatch = line.match(/\{([^}]+)\}/);
    if (namedMatch) {
      const names = namedMatch[1].split(",").map((n) => n.trim());
      for (const name of names) {
        const parts = name.split(/\s+as\s+/);
        specifiers.push({
          name: parts[0].trim(),
          alias: parts[1]?.trim(),
          isDefault: false,
        });
      }
    }

    // Namespace import
    const nsMatch = line.match(/\*\s+as\s+(\w+)/);
    if (nsMatch) {
      specifiers.push({ name: nsMatch[1], isNamespace: true });
    }

    return {
      type: "ImportDeclaration",
      source,
      specifiers,
      isTypeOnly,
      range,
    };
  }

  private parseFunction(line: string, range: SourceRange, isExported: boolean): ASTNode {
    const isAsync = line.includes("async ");
    const isGenerator = line.includes("*");
    const isArrow = line.includes("=>");

    let name = "anonymous";
    const nameMatch = line.match(/(?:function\s+|(\w+)\s*=\s*(?:async\s+)?)?(\w+)\s*\(/);
    if (nameMatch) {
      name = nameMatch[2] || nameMatch[1] || "anonymous";
    }

    const paramsMatch = line.match(/\(([^)]*)\)/);
    const params = paramsMatch ? paramsMatch[1].split(",").map((p) => p.trim()).filter(Boolean) : [];

    const returnTypeMatch = line.match(/:\s*(\w+(?:<[^>]+>)?(?:\[\])?)\s*[\{=>]/);
    const returnType = returnTypeMatch ? returnTypeMatch[1] : undefined;

    return {
      type: isArrow ? "ArrowFunctionExpression" : "FunctionDeclaration",
      kind: "function",
      name,
      isAsync,
      isGenerator,
      isExported,
      isArrow,
      parameters: params.map((p) => {
        const optional = p.endsWith("?");
        const cleanName = optional ? p.slice(0, -1) : p;
        const parts = cleanName.split(":");
        const defaultParts = parts[0].split("=");
        return {
          name: defaultParts[0].trim(),
          type: parts[1]?.trim(),
          defaultValue: defaultParts[1]?.trim(),
          optional,
        };
      }),
      returnType,
      range,
    };
  }

  private parseClass(line: string, range: SourceRange, isExported: boolean): ASTNode {
    const nameMatch = line.match(/class\s+(\w+)/);
    const name = nameMatch ? nameMatch[1] : "Anonymous";

    const extendsMatch = line.match(/extends\s+(\w+)/);
    const superClass = extendsMatch ? extendsMatch[1] : undefined;

    const implementsMatch = line.match(/implements\s+([\w,\s]+)/);
    const implementedInterfaces = implementsMatch
      ? implementsMatch[1].split(",").map((i) => i.trim())
      : [];

    const isAbstract = line.includes("abstract ");

    return {
      type: "ClassDeclaration",
      kind: "class",
      name,
      superClass,
      implementedInterfaces,
      isExported,
      isAbstract,
      methods: [],
      properties: [],
      range,
    };
  }

  private parseInterface(line: string, range: SourceRange): ASTNode {
    const nameMatch = line.match(/interface\s+(\w+)/);
    const name = nameMatch ? nameMatch[1] : "Anonymous";

    const extendsMatch = line.match(/extends\s+([\w,\s]+)/);
    const extendsList = extendsMatch
      ? extendsMatch[1].split(",").map((e) => e.trim())
      : [];

    return {
      type: "InterfaceDeclaration",
      kind: "interface",
      name,
      extends: extendsList,
      range,
    };
  }

  private parseTypeAlias(line: string, range: SourceRange): ASTNode {
    const nameMatch = line.match(/type\s+(\w+)/);
    const name = nameMatch ? nameMatch[1] : "Anonymous";

    return {
      type: "TypeAliasDeclaration",
      kind: "type",
      name,
      range,
    };
  }

  private extractFunctionsFromNode(node: ASTNode, functions: FunctionInfo[], parentExported: boolean): void {
    if (node.type === "FunctionDeclaration" || node.type === "ArrowFunctionExpression" || node.kind === "function") {
      const params = (node.parameters as FunctionInfo["parameters"]) ?? [];
      functions.push({
        name: (node.name as string) ?? "anonymous",
        parameters: params,
        returnType: node.returnType as string | undefined,
        isAsync: (node.isAsync as boolean) ?? false,
        isGenerator: (node.isGenerator as boolean) ?? false,
        isExported: (node.isExported as boolean) ?? parentExported,
        isArrow: (node.isArrow as boolean) ?? false,
        complexity: this.getComplexity(node).cyclomatic,
        range: node.range ?? { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
        body: "",
      });
    }

    // Recurse into class methods
    if (node.methods && Array.isArray(node.methods)) {
      for (const method of node.methods as ASTNode[]) {
        this.extractFunctionsFromNode(method, functions, (node.isExported as boolean) ?? false);
      }
    }

    // Recurse into body
    if (node.body && Array.isArray(node.body)) {
      for (const child of node.body) {
        this.extractFunctionsFromNode(child, functions, (node.isExported as boolean) ?? parentExported);
      }
    }
  }

  private extractClassInfo(node: ASTNode): ClassInfo {
    const methods: FunctionInfo[] = [];
    if (node.methods && Array.isArray(node.methods)) {
      for (const method of node.methods as ASTNode[]) {
        methods.push({
          name: (method.name as string) ?? "anonymous",
          parameters: (method.parameters as FunctionInfo["parameters"]) ?? [],
          returnType: method.returnType as string | undefined,
          isAsync: (method.isAsync as boolean) ?? false,
          isGenerator: (method.isGenerator as boolean) ?? false,
          isExported: false,
          isArrow: false,
          complexity: this.getComplexity(method).cyclomatic,
          range: method.range ?? { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
          body: "",
        });
      }
    }

    return {
      name: (node.name as string) ?? "Anonymous",
      superClass: node.superClass as string | undefined,
      implementedInterfaces: (node.implementedInterfaces as string[]) ?? [],
      typeParameters: node.typeParameters as string[] | undefined,
      methods,
      properties: (node.properties as ClassInfo["properties"]) ?? [],
      decorators: (node.decorators as string[]) ?? [],
      isExported: (node.isExported as boolean) ?? false,
      isAbstract: (node.isAbstract as boolean) ?? false,
      range: node.range ?? { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
    };
  }

  private extractImportInfo(node: ASTNode): ImportInfo {
    return {
      source: (node.source as string) ?? "",
      specifiers: (node.specifiers as ImportInfo["specifiers"]) ?? [],
      isTypeOnly: (node.isTypeOnly as boolean) ?? false,
      range: node.range ?? { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
    };
  }

  private calculateComplexity(node: ASTNode, metrics: ComplexityMetrics, depth: number): void {
    if (!node) return;

    metrics.nestingDepth = Math.max(metrics.nestingDepth, depth);

    // Count lines of code
    if (node.range) {
      metrics.linesOfCode += node.range.end.line - node.range.start.line + 1;
    }

    // Cyclomatic complexity: +1 for each decision point
    const branchingTypes = [
      "IfStatement",
      "ConditionalExpression",
      "ForStatement",
      "ForInStatement",
      "ForOfStatement",
      "WhileStatement",
      "DoWhileStatement",
      "CaseStatement",
      "CatchClause",
      "LogicalExpression",
    ];

    if (branchingTypes.includes(node.type)) {
      metrics.cyclomatic += 1;
      metrics.cognitive += 1 + depth;
    }

    // Ternary adds to cognitive
    if (node.type === "ConditionalExpression") {
      metrics.cognitive += 1;
    }

    // Also scan for branching keywords in the node's raw text
    // to handle cases where the parser doesn't create sub-nodes for each branch
    const rawText = (node as Record<string, unknown>).raw as string | undefined;
    if (rawText) {
      const branchKeywords = [
        /\bif\s*\(/g,
        /\bfor\s*\(/g,
        /\bfor\s*\.\./g,
        /\bwhile\s*\(/g,
        /\bdo\s*\{/g,
        /\bcase\s+/g,
        /\bcatch\s*\(/g,
        /\?\?/g,
        /\?\.\w/g,
      ];
      const logicalOps = [/&&/g, /\|\|/g];
      for (const kw of branchKeywords) {
        const matches = rawText.match(kw);
        if (matches) {
          metrics.cyclomatic += matches.length;
          metrics.cognitive += matches.length * (1 + depth);
        }
      }
      for (const op of logicalOps) {
        const matches = rawText.match(op);
        if (matches) {
          metrics.cyclomatic += matches.length;
          metrics.cognitive += matches.length * (1 + depth);
        }
      }
    }

    // Recurse into children
    const childKeys = ["body", "consequent", "alternate", "declarations", "arguments", "elements"];
    for (const key of childKeys) {
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object") {
            this.calculateComplexity(item as ASTNode, metrics, depth + 1);
          }
        }
      } else if (child && typeof child === "object") {
        this.calculateComplexity(child as ASTNode, metrics, depth + 1);
      }
    }
  }
}
