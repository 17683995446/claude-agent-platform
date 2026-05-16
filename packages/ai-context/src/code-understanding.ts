// ============================================================
// Module 2: Code Understanding Engine
// AST-like parsing, symbol extraction, complexity metrics
// ============================================================

export interface FileEntry {
  path: string;
  content: string;
  language: string;
}

export interface FunctionInfo {
  name: string;
  parameters: string[];
  returnType: string;
  dependencies: string[];
  startLine: number;
  endLine: number;
  complexity: number;
}

export interface ClassInfo {
  name: string;
  methods: FunctionInfo[];
  properties: string[];
  inheritance: string[];
  startLine: number;
  endLine: number;
}

export interface ImportInfo {
  source: string;
  specifiers: string[];
  isTypeOnly: boolean;
  line: number;
}

export interface CodeAnalysis {
  language: string;
  functions: FunctionInfo[];
  classes: ClassInfo[];
  imports: ImportInfo[];
  exports: string[];
  complexity: CodeComplexity;
  summary: string;
}

export interface CodeComplexity {
  cyclomaticComplexity: number;
  linesOfCode: number;
  nestingDepth: number;
  functionCount: number;
  classCount: number;
  importCount: number;
}

export interface ProjectAnalysis {
  files: Map<string, CodeAnalysis>;
  dependencyGraph: Map<string, string[]>;
  totalComplexity: CodeComplexity;
  summary: string;
}

export interface SymbolRelation {
  symbol: string;
  relations: { type: 'calls' | 'imports' | 'extends' | 'implements' | 'uses'; target: string }[];
}

export class CodeUnderstandingEngine {
  analyzeFile(content: string, language: string): CodeAnalysis {
    const lines = content.split('\n');
    const functions = this.extractFunctions(content, language, lines);
    const classes = this.extractClasses(content, language, lines);
    const imports = this.extractImports(content, language, lines);
    const exports = this.extractExports(content, language, lines);
    const complexity = this.computeComplexity(content, functions, classes, lines);

    const summary = this.summarizeCode(functions, classes, exports, language);

    return {
      language,
      functions,
      classes,
      imports,
      exports,
      complexity,
      summary,
    };
  }

  analyzeProject(files: FileEntry[]): ProjectAnalysis {
    const analyses = new Map<string, CodeAnalysis>();
    const dependencyGraph = new Map<string, string[]>();
    let totalComplexity: CodeComplexity = {
      cyclomaticComplexity: 0,
      linesOfCode: 0,
      nestingDepth: 0,
      functionCount: 0,
      classCount: 0,
      importCount: 0,
    };

    for (const file of files) {
      const analysis = this.analyzeFile(file.content, file.language);
      analyses.set(file.path, analysis);

      // Build dependency graph
      const deps: string[] = [];
      for (const imp of analysis.imports) {
        deps.push(imp.source);
      }
      dependencyGraph.set(file.path, deps);

      // Aggregate complexity
      totalComplexity.cyclomaticComplexity += analysis.complexity.cyclomaticComplexity;
      totalComplexity.linesOfCode += analysis.complexity.linesOfCode;
      totalComplexity.nestingDepth = Math.max(totalComplexity.nestingDepth, analysis.complexity.nestingDepth);
      totalComplexity.functionCount += analysis.complexity.functionCount;
      totalComplexity.classCount += analysis.complexity.classCount;
      totalComplexity.importCount += analysis.complexity.importCount;
    }

    const summaries: string[] = [];
    for (const [path, analysis] of analyses) {
      summaries.push(`${path}: ${analysis.summary}`);
    }

    return {
      files: analyses,
      dependencyGraph,
      totalComplexity,
      summary: summaries.join('\n'),
    };
  }

  findRelatedSymbols(symbol: string, analysis: ProjectAnalysis): SymbolRelation[] {
    const results: SymbolRelation[] = [];

    for (const [, fileAnalysis] of analysis.files) {
      // Check functions
      for (const fn of fileAnalysis.functions) {
        if (fn.name === symbol || fn.dependencies.includes(symbol)) {
          const relations: SymbolRelation['relations'] = [];
          for (const dep of fn.dependencies) {
            relations.push({ type: 'uses', target: dep });
          }
          results.push({ symbol: fn.name, relations });
        }
      }

      // Check classes
      for (const cls of fileAnalysis.classes) {
        if (cls.name === symbol) {
          const relations: SymbolRelation['relations'] = [];
          for (const base of cls.inheritance) {
            relations.push({ type: 'extends', target: base });
          }
          for (const method of cls.methods) {
            for (const dep of method.dependencies) {
              relations.push({ type: 'uses', target: dep });
            }
          }
          results.push({ symbol: cls.name, relations });
        }
      }
    }

    return results;
  }

  // --- Private parsing methods ---

  private extractFunctions(content: string, language: string, lines: string[]): FunctionInfo[] {
    const functions: FunctionInfo[] = [];
    const funcRegex = language === 'python'
      ? /def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\w+))?/g
      : /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\w+))?/g;

    let match: RegExpExecArray | null;
    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[1];
      const paramsStr = match[2] || '';
      const returnType = match[3] || 'unknown';
      const parameters = paramsStr.split(',').map(p => p.trim().split(':')[0].split('=')[0].trim()).filter(Boolean);
      const startLine = content.slice(0, match.index).split('\n').length;
      const body = content.slice(match.index);
      const braceCount = this.countBraces(body, language);
      const endLine = startLine + braceCount;
      const complexity = this.measureFunctionComplexity(body, language);

      functions.push({
        name,
        parameters,
        returnType,
        dependencies: this.extractDependencies(body),
        startLine,
        endLine,
        complexity,
      });
    }

    // Also match arrow functions and method shorthand
    const arrowRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*(\w+))?\s*=>/g;
    while ((match = arrowRegex.exec(content)) !== null) {
      const name = match[1];
      const paramsStr = match[2] || '';
      const returnType = match[3] || 'unknown';
      const parameters = paramsStr.split(',').map(p => p.trim().split(':')[0].split('=')[0].trim()).filter(Boolean);
      const startLine = content.slice(0, match.index).split('\n').length;
      const body = content.slice(match.index);
      const complexity = this.measureFunctionComplexity(body, language);

      functions.push({
        name,
        parameters,
        returnType,
        dependencies: this.extractDependencies(body),
        startLine,
        endLine: startLine + 5,
        complexity,
      });
    }

    // Match class method shorthand: methodName(params): returnType {
    const methodRegex = /(?:(?:public|private|protected|static|async|readonly)\s+)*(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\w[\w<>|&]*))?\s*\{/g;
    // Avoid re-matching already matched functions
    const alreadyMatched = new Set(functions.map(f => `${f.name}_${f.startLine}`));
    while ((match = methodRegex.exec(content)) !== null) {
      const name = match[1];
      if (['if', 'for', 'while', 'switch', 'catch', 'constructor', 'function', 'class', 'return', 'new', 'throw'].includes(name)) continue;
      const paramsStr = match[2] || '';
      const returnType = match[3] || 'unknown';
      const parameters = paramsStr.split(',').map(p => p.trim().split(':')[0].split('=')[0].trim()).filter(Boolean);
      const startLine = content.slice(0, match.index).split('\n').length;
      const body = content.slice(match.index);
      const complexity = this.measureFunctionComplexity(body, language);
      const key = `${name}_${startLine}`;
      if (!alreadyMatched.has(key)) {
        functions.push({
          name,
          parameters,
          returnType,
          dependencies: this.extractDependencies(body),
          startLine,
          endLine: startLine + 3,
          complexity,
        });
      }
    }

    return functions;
  }

  private extractClasses(content: string, language: string, lines: string[]): ClassInfo[] {
    const classes: ClassInfo[] = [];
    const classRegex = language === 'python'
      ? /class\s+(\w+)(?:\(([^)]*)\))?:/g
      : /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g;

    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(content)) !== null) {
      const name = match[1];
      const inheritance: string[] = [];
      if (match[2]) inheritance.push(match[2].trim());
      if (match[3]) match[3].split(',').forEach(i => inheritance.push(i.trim()));

      const startLine = content.slice(0, match.index).split('\n').length;
      const classBody = this.extractClassBody(content, match.index, language);
      const methods = this.extractFunctions(classBody, language, lines);
      const properties = this.extractProperties(classBody, language);
      const endLine = startLine + classBody.split('\n').length;

      classes.push({
        name,
        methods,
        properties,
        inheritance,
        startLine,
        endLine,
      });
    }

    return classes;
  }

  private extractImports(content: string, language: string, lines: string[]): ImportInfo[] {
    const imports: ImportInfo[] = [];

    if (language === 'typescript' || language === 'javascript') {
      const importRegex = /import\s+(?:type\s+)?(?:\{([^}]*)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const isTypeOnly = content.slice(match.index).startsWith('import type');
        const specifiers = match[1]
          ? match[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()!.trim())
          : match[2] ? [match[2]] : [];
        const line = content.slice(0, match.index).split('\n').length;
        imports.push({ source: match[3], specifiers, isTypeOnly, line });
      }
    } else if (language === 'python') {
      const importRegex = /(?:from\s+([\w.]+)\s+import\s+(.+)|import\s+([\w.]+)(?:\s+as\s+(\w+))?)/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const source = match[1] || match[3];
        const specifiers = match[2]
          ? match[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim())
          : match[4] ? [match[4]] : [source!];
        const line = content.slice(0, match.index).split('\n').length;
        imports.push({ source: source!, specifiers, isTypeOnly: false, line });
      }
    }

    return imports;
  }

  private extractExports(content: string, language: string, lines: string[]): string[] {
    const exports: string[] = [];
    const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = exportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }
    return exports;
  }

  private computeComplexity(content: string, functions: FunctionInfo[], classes: ClassInfo[], lines: string[]): CodeComplexity {
    const cyclomaticComplexity = functions.reduce((sum, fn) => sum + fn.complexity, 0);
    const codeLines = lines.filter(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('*')).length;
    const nestingDepth = this.maxNestingDepth(content);

    return {
      cyclomaticComplexity,
      linesOfCode: codeLines,
      nestingDepth,
      functionCount: functions.length,
      classCount: classes.length,
      importCount: (content.match(/import\s/g) || []).length,
    };
  }

  private measureFunctionComplexity(body: string, language: string): number {
    let complexity = 1;
    const branches = body.match(/\b(if|else\s+if|for|while|case|catch|\?\?|&&|\|\|)\b/g);
    if (branches) complexity += branches.length;
    return complexity;
  }

  private extractDependencies(body: string): string[] {
    const deps = new Set<string>();
    const callRegex = /(?:(?:\w+)\.)?(\w+)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(body)) !== null) {
      if (!['if', 'for', 'while', 'switch', 'catch', 'return', 'console', 'Math'].includes(match[1])) {
        deps.add(match[1]);
      }
    }
    return Array.from(deps);
  }

  private countBraces(body: string, language: string): number {
    if (language === 'python') {
      const lines = body.split('\n');
      let depth = 0;
      let maxLines = 0;
      for (const line of lines.slice(1)) {
        if (line.trim().startsWith('def ') || line.trim().startsWith('class ')) break;
        maxLines++;
      }
      return maxLines;
    }
    let count = 0;
    let depth = 0;
    for (const char of body) {
      if (char === '{') depth++;
      if (char === '}') depth--;
      if (depth === 0 && count > 0) break;
      count++;
    }
    return Math.ceil(count / 40);
  }

  private extractClassBody(content: string, startIndex: number, language: string): string {
    if (language === 'python') {
      const lines = content.slice(startIndex).split('\n');
      const bodyLines: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() && !lines[i].startsWith(' ') && !lines[i].startsWith('\t')) break;
        bodyLines.push(lines[i]);
      }
      return bodyLines.join('\n');
    }
    let depth = 0;
    let started = false;
    let end = startIndex;
    for (let i = startIndex; i < content.length; i++) {
      if (content[i] === '{') { depth++; started = true; }
      if (content[i] === '}') depth--;
      if (started && depth === 0) { end = i; break; }
    }
    return content.slice(startIndex, end);
  }

  private extractProperties(body: string, language: string): string[] {
    const props: string[] = [];
    if (language === 'typescript' || language === 'javascript') {
      const propRegex = /(?:(?:private|public|protected|readonly)\s+)*(?:static\s+)?(\w+)\s*(?::\s*\w+)?\s*(?:=|;)/g;
      let match: RegExpExecArray | null;
      while ((match = propRegex.exec(body)) !== null) {
        if (!['constructor', 'function', 'if', 'for', 'while', 'return'].includes(match[1])) {
          props.push(match[1]);
        }
      }
    }
    return props;
  }

  private maxNestingDepth(content: string): number {
    let maxDepth = 0;
    let currentDepth = 0;
    for (const char of content) {
      if (char === '{') { currentDepth++; maxDepth = Math.max(maxDepth, currentDepth); }
      if (char === '}') currentDepth--;
    }
    return maxDepth;
  }

  private summarizeCode(functions: FunctionInfo[], classes: ClassInfo[], exports: string[], language: string): string {
    const parts: string[] = [];
    if (classes.length > 0) {
      parts.push(`${classes.length} class(es): ${classes.map(c => c.name).join(', ')}`);
    }
    if (functions.length > 0) {
      parts.push(`${functions.length} function(s): ${functions.map(f => f.name).join(', ')}`);
    }
    if (exports.length > 0) {
      parts.push(`Exports: ${exports.join(', ')}`);
    }
    return parts.join('; ') || `A ${language} source file.`;
  }
}
