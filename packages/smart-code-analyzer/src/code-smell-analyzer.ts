/**
 * Code Smell Analyzer Module
 *
 * Advanced code smell detection including long methods, god classes,
 * feature envy, shotgun surgery, dead code, and magic numbers.
 */

import type { ASTNode, AST } from "./ast-parser.js";

/** Severity level of a code smell */
export type SmellSeverity = "low" | "medium" | "high" | "critical";

/** A detected code smell */
export interface CodeSmell {
  type: string;
  name: string;
  severity: SmellSeverity;
  description: string;
  location: {
    file?: string;
    line?: number;
    column?: number;
    node?: string;
  };
  suggestions: string[];
  metrics: Record<string, number>;
}

/** Result of shotgun surgery analysis */
export interface ShotgunSurgeryResult {
  smellType: "shotgun_surgery";
  affectedFiles: string[];
  commonPatterns: string[];
  severity: SmellSeverity;
  description: string;
}

/** A file with its AST for multi-file analysis */
export interface FileAnalysis {
  filePath: string;
  ast: ASTNode;
  content?: string;
}

/**
 * CodeSmellAnalyzer - Detect and rank code smells in source code.
 */
export class CodeSmellAnalyzer {
  private defaultThresholds = {
    longMethodLines: 30,
    godClassMethods: 10,
    godClassProperties: 15,
    featureEnvyForeignCalls: 5,
    magicNumberThreshold: 3,
  };

  /**
   * Detect methods that are too long (exceed line threshold).
   * @param ast - The AST to analyze
   * @param threshold - Maximum allowed lines (default 30)
   * @returns Array of detected long method smells
   */
  detectLongMethods(ast: ASTNode, threshold: number = this.defaultThresholds.longMethodLines): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const functions = this.findAllFunctions(ast);

    for (const func of functions) {
      const range = func.range;
      if (range) {
        const lines = range.end.line - range.start.line + 1;
        if (lines > threshold) {
          const severity = this.getSeverity(lines, threshold, 2);
          smells.push({
            type: "long_method",
            name: "Long Method",
            severity,
            description: `Method "${func.name}" is ${lines} lines long (threshold: ${threshold})`,
            location: {
              line: range.start.line,
              node: func.name as string,
            },
            suggestions: [
              "Extract sub-methods with meaningful names",
              "Reduce nesting by using early returns",
              "Consider using guard clauses",
            ],
            metrics: { lines, threshold, excess: lines - threshold },
          });
        }
      }
    }

    return smells;
  }

  /**
   * Detect god classes (classes with too many responsibilities).
   * @param ast - The AST to analyze
   * @returns Array of detected god class smells
   */
  detectGodClasses(ast: ASTNode): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const classes = this.findAllClasses(ast);

    for (const cls of classes) {
      const methods = (cls.methods as ASTNode[]) ?? [];
      const properties = (cls.properties as ASTNode[]) ?? [];
      const methodCount = methods.length;
      const propertyCount = properties.length;

      const isGodClass =
        methodCount > this.defaultThresholds.godClassMethods ||
        propertyCount > this.defaultThresholds.godClassProperties;

      if (isGodClass) {
        const severity =
          methodCount > 20 || propertyCount > 25
            ? "critical"
            : methodCount > 15 || propertyCount > 20
            ? "high"
            : "medium";

        smells.push({
          type: "god_class",
          name: "God Class",
          severity,
          description: `Class "${cls.name}" has ${methodCount} methods and ${propertyCount} properties`,
          location: { node: cls.name as string },
          suggestions: [
            "Split the class into smaller, focused classes",
            "Extract related methods into separate service classes",
            "Apply Single Responsibility Principle",
          ],
          metrics: { methodCount, propertyCount },
        });
      }
    }

    return smells;
  }

  /**
   * Detect feature envy (methods that use more external data than their own class).
   * @param ast - The AST to analyze
   * @returns Array of detected feature envy smells
   */
  detectFeatureEnvy(ast: ASTNode): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const classes = this.findAllClasses(ast);

    for (const cls of classes) {
      const methods = (cls.methods as ASTNode[]) ?? [];
      const className = cls.name as string;

      for (const method of methods) {
        const foreignCalls = (method.foreignCalls as number) ?? 0;
        const selfCalls = (method.selfCalls as number) ?? 0;

        if (foreignCalls > this.defaultThresholds.featureEnvyForeignCalls && foreignCalls > selfCalls) {
          smells.push({
            type: "feature_envy",
            name: "Feature Envy",
            severity: "medium",
            description: `Method "${method.name}" in "${className}" makes ${foreignCalls} calls to other classes vs ${selfCalls} to its own`,
            location: { node: `${className}.${method.name}` as string },
            suggestions: [
              `Move method "${method.name}" to the class it interacts with most`,
              "Consider using the Visitor pattern if bidirectional access is needed",
            ],
            metrics: { foreignCalls, selfCalls, ratio: selfCalls > 0 ? foreignCalls / selfCalls : foreignCalls },
          });
        }
      }
    }

    return smells;
  }

  /**
   * Detect shotgun surgery (changes that require modifying many files).
   * @param files - Array of file analysis objects
   * @returns Shotgun surgery detection result
   */
  detectShotgunSurgery(files: FileAnalysis[]): ShotgunSurgeryResult {
    if (files.length === 0) {
      return {
        smellType: "shotgun_surgery",
        affectedFiles: [],
        commonPatterns: [],
        severity: "low",
        description: "No files provided for analysis",
      };
    }

    // Analyze common patterns across files
    const patternCounts = new Map<string, number>();
    const filePatterns = new Map<string, string[]>();

    for (const file of files) {
      const patterns = this.extractChangePatterns(file.ast);
      filePatterns.set(file.filePath, patterns);

      for (const pattern of patterns) {
        patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
      }
    }

    // Find patterns that appear in many files
    const commonPatterns: string[] = [];
    for (const [pattern, count] of patternCounts) {
      if (count > files.length * 0.5 && count > 1) {
        commonPatterns.push(pattern);
      }
    }

    // Find files affected by common patterns
    const affectedFiles: string[] = [];
    for (const [filePath, patterns] of filePatterns) {
      if (patterns.some((p) => commonPatterns.includes(p))) {
        affectedFiles.push(filePath);
      }
    }

    const severity: SmellSeverity =
      affectedFiles.length > files.length * 0.8
        ? "critical"
        : affectedFiles.length > files.length * 0.5
        ? "high"
        : affectedFiles.length > 2
        ? "medium"
        : "low";

    return {
      smellType: "shotgun_surgery",
      affectedFiles,
      commonPatterns,
      severity,
      description:
        commonPatterns.length > 0
          ? `Found ${commonPatterns.length} common patterns across ${affectedFiles.length} files`
          : "No shotgun surgery detected",
    };
  }

  /**
   * Detect dead code (unused functions, variables, classes).
   * @param ast - The AST to analyze
   * @param usageMap - Map of identifier names to their usage counts
   * @returns Array of detected dead code smells
   */
  detectDeadCode(ast: ASTNode, usageMap: Map<string, number>): CodeSmell[] {
    const smells: CodeSmell[] = [];

    // Check functions
    const functions = this.findAllFunctions(ast);
    for (const func of functions) {
      const name = func.name as string;
      if (name && name !== "anonymous" && (usageMap.get(name) ?? 0) === 0) {
        smells.push({
          type: "dead_code",
          name: "Dead Code - Unused Function",
          severity: "low",
          description: `Function "${name}" is defined but never used`,
          location: { node: name },
          suggestions: ["Remove the unused function", "Verify it is not used via reflection or dynamic access"],
          metrics: { usageCount: 0 },
        });
      }
    }

    // Check classes
    const classes = this.findAllClasses(ast);
    for (const cls of classes) {
      const name = cls.name as string;
      if (name && (usageMap.get(name) ?? 0) === 0) {
        smells.push({
          type: "dead_code",
          name: "Dead Code - Unused Class",
          severity: "medium",
          description: `Class "${name}" is defined but never used`,
          location: { node: name },
          suggestions: ["Remove the unused class", "Check if it is used as a type only"],
          metrics: { usageCount: 0 },
        });
      }
    }

    return smells;
  }

  /**
   * Detect magic numbers (unnamed numeric literals).
   * @param ast - The AST to analyze
   * @returns Array of detected magic number smells
   */
  detectMagicNumbers(ast: ASTNode): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const literals = this.findNumericLiterals(ast);

    // Exclude common non-magic numbers
    const allowedNumbers = new Set([0, 1, -1, 2, 10, 100, 1000, 0.5, 0.1]);

    for (const literal of literals) {
      const value = literal.value as number;
      if (!allowedNumbers.has(value) && !Number.isNaN(value) && Number.isFinite(value)) {
        smells.push({
          type: "magic_number",
          name: "Magic Number",
          severity: "low",
          description: `Magic number ${value} found`,
          location: {
            line: literal.line,
            column: literal.column,
          },
          suggestions: [
            `Extract ${value} into a named constant`,
            "Use an enum for related magic numbers",
          ],
          metrics: { value },
        });
      }
    }

    return smells;
  }

  /**
   * Analyze code for all smells and return a ranked list.
   * @param code - Source code string
   * @returns Ranked array of all detected code smells
   */
  analyzeSmells(code: string): CodeSmell[] {
    // Build a minimal AST from the code
    const lines = code.split("\n");
    const ast: ASTNode = {
      type: "Program",
      body: lines.map((line, i) => ({
        type: "Statement",
        range: { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: line.length } },
      })),
    };

    const allSmells: CodeSmell[] = [];

    allSmells.push(...this.detectLongMethods(ast));
    allSmells.push(...this.detectGodClasses(ast));
    allSmells.push(...this.detectFeatureEnvy(ast));
    allSmells.push(...this.detectMagicNumbers(ast));

    // Rank by severity
    const severityOrder: Record<SmellSeverity, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    allSmells.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);

    return allSmells;
  }

  // --- Private helpers ---

  private findAllFunctions(node: ASTNode): ASTNode[] {
    const results: ASTNode[] = [];

    const walk = (n: ASTNode): void => {
      if (n.type === "FunctionDeclaration" || n.type === "ArrowFunctionExpression" || n.kind === "function") {
        results.push(n);
      }
      if (n.methods && Array.isArray(n.methods)) {
        for (const m of n.methods as ASTNode[]) {
          results.push(m);
        }
      }
      const childKeys = ["body", "declarations"];
      for (const key of childKeys) {
        const child = (n as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object") walk(item as ASTNode);
          }
        }
      }
    };

    walk(node);
    return results;
  }

  private findAllClasses(node: ASTNode): ASTNode[] {
    const results: ASTNode[] = [];

    const walk = (n: ASTNode): void => {
      if (n.type === "ClassDeclaration" || n.kind === "class") {
        results.push(n);
      }
      const childKeys = ["body", "declarations"];
      for (const key of childKeys) {
        const child = (n as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object") walk(item as ASTNode);
          }
        }
      }
    };

    walk(node);
    return results;
  }

  private findNumericLiterals(node: ASTNode): Array<{ value: number; line: number; column: number }> {
    const results: Array<{ value: number; line: number; column: number }> = [];

    const walk = (n: ASTNode): void => {
      if (n.type === "NumericLiteral" || n.kind === "number") {
        results.push({
          value: n.value as number,
          line: n.range?.start.line ?? 0,
          column: n.range?.start.column ?? 0,
        });
      }

      const childKeys = ["body", "declarations", "arguments", "elements", "init", "right", "left", "expression"];
      for (const key of childKeys) {
        const child = (n as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object") walk(item as ASTNode);
          }
        } else if (child && typeof child === "object") {
          walk(child as ASTNode);
        }
      }
    };

    walk(node);
    return results;
  }

  private extractChangePatterns(ast: ASTNode): string[] {
    const patterns: string[] = [];

    const walk = (node: ASTNode): void => {
      if (node.type === "ImportDeclaration") {
        const source = node.source as string;
        if (source) patterns.push(`import:${source}`);
      }
      if (node.type === "ClassDeclaration" || node.kind === "class") {
        const name = node.name as string;
        if (name) patterns.push(`class:${name}`);
      }
      if (node.type === "FunctionDeclaration" || node.kind === "function") {
        const name = node.name as string;
        if (name) patterns.push(`function:${name}`);
      }

      const childKeys = ["body", "declarations"];
      for (const key of childKeys) {
        const child = (node as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object") walk(item as ASTNode);
          }
        }
      }
    };

    walk(ast);
    return patterns;
  }

  private getSeverity(value: number, threshold: number, multiplier: number): SmellSeverity {
    const excess = value - threshold;
    if (excess > threshold * multiplier * 2) return "critical";
    if (excess > threshold * multiplier) return "high";
    if (excess > threshold * 0.5) return "medium";
    return "low";
  }
}
