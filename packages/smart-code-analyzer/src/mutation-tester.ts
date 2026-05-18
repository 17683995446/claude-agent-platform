/**
 * Mutation Tester Module
 *
 * Generate and test code mutations for quality assurance.
 * Implements mutation testing operators and scoring.
 */

import type { ASTNode } from "./ast-parser.js";

/** Types of code mutations */
export type MutationType =
  | "arithmetic_operator"
  | "logical_operator"
  | "conditional_boundary"
  | "negate_conditionals"
  | "return_value"
  | "remove_calls"
  | "string_literal"
  | "boolean_literal";

/** A single mutation to apply */
export interface Mutation {
  id: string;
  type: MutationType;
  description: string;
  original: string;
  replacement: string;
  lineNumber: number;
  column?: number;
}

/** Result of testing a single mutation */
export interface MutationResult {
  mutation: Mutation;
  status: "killed" | "survived" | "timeout" | "error";
  duration: number;
  errorMessage?: string;
}

/** Overall mutation test results */
export interface MutationTestResults {
  mutations: MutationResult[];
  totalMutations: number;
  killed: number;
  survived: number;
  timeout: number;
  errors: number;
  score: number;
  duration: number;
}

/** Test runner function type */
export type TestRunner = (code: string) => Promise<{ passed: boolean; duration: number }>;

/**
 * MutationTester - Generate and test code mutations for quality assurance.
 */
export class MutationTester {
  private mutationIdCounter = 0;

  /**
   * Generate all possible mutations for the given AST.
   * @param ast - The AST to generate mutations for
   * @returns Array of possible mutations
   */
  generateMutations(ast: ASTNode): Mutation[] {
    const mutations: Mutation[] = [];
    this.collectMutations(ast, mutations);
    return mutations;
  }

  /**
   * Apply a mutation to an AST, returning a new mutated AST.
   * @param ast - The original AST
   * @param mutation - The mutation to apply
   * @returns New mutated AST node
   */
  applyMutation(ast: ASTNode, mutation: Mutation): ASTNode {
    // Deep clone the AST
    const cloned = this.deepClone(ast);

    // Apply the mutation at the specified location
    this.applyMutationToNode(cloned, mutation);

    return cloned;
  }

  /**
   * Test a mutation by running the test suite against the mutated code.
   * @param original - Original source code
   * @param mutated - Mutated source code
   * @param testRunner - Test runner function
   * @returns Mutation test result
   */
  async testMutation(
    original: string,
    mutated: string,
    testRunner: TestRunner
  ): Promise<MutationResult> {
    const startTime = Date.now();

    try {
      const result = await testRunner(mutated);
      const duration = Date.now() - startTime;

      return {
        mutation: {
          id: `mutation_${this.mutationIdCounter++}`,
          type: "arithmetic_operator",
          description: "Applied mutation",
          original,
          replacement: mutated,
          lineNumber: 0,
        },
        status: result.passed ? "survived" : "killed",
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      return {
        mutation: {
          id: `mutation_${this.mutationIdCounter++}`,
          type: "arithmetic_operator",
          description: "Applied mutation",
          original,
          replacement: mutated,
          lineNumber: 0,
        },
        status: "error",
        duration,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Calculate the mutation score (percentage of killed mutations).
   * @param results - Array of mutation test results
   * @returns Mutation score between 0 and 100
   */
  calculateMutationScore(results: MutationTestResults): number {
    if (results.totalMutations === 0) return 100;

    const killedCount = results.killed;
    return Math.round((killedCount / results.totalMutations) * 100);
  }

  /**
   * Get all surviving mutants from test results.
   * @param results - Mutation test results
   * @returns Array of surviving mutation results
   */
  getSurvivingMutants(results: MutationTestResults): MutationResult[] {
    return results.mutations.filter((r) => r.status === "survived");
  }

  /**
   * Run a complete mutation testing session.
   * @param ast - The AST to mutate
   * @param originalCode - Original source code
   * @param testRunner - Test runner function
   * @returns Complete mutation test results
   */
  async runMutationTesting(
    ast: ASTNode,
    originalCode: string,
    testRunner: TestRunner
  ): Promise<MutationTestResults> {
    const mutations = this.generateMutations(ast);
    const mutationResults: MutationResult[] = [];
    const startTime = Date.now();

    for (const mutation of mutations) {
      const mutatedCode = this.applyStringMutation(originalCode, mutation);
      const result = await this.testMutation(originalCode, mutatedCode, testRunner);
      result.mutation = mutation;
      mutationResults.push(result);
    }

    const duration = Date.now() - startTime;
    const killed = mutationResults.filter((r) => r.status === "killed").length;
    const survived = mutationResults.filter((r) => r.status === "survived").length;
    const timeout = mutationResults.filter((r) => r.status === "timeout").length;
    const errors = mutationResults.filter((r) => r.status === "error").length;

    const results: MutationTestResults = {
      mutations: mutationResults,
      totalMutations: mutationResults.length,
      killed,
      survived,
      timeout,
      errors,
      score: mutationResults.length > 0 ? Math.round((killed / mutationResults.length) * 100) : 100,
      duration,
    };

    return results;
  }

  // --- Private helpers ---

  private collectMutations(node: ASTNode, mutations: Mutation[]): void {
    if (!node) return;

    const line = node.range?.start.line ?? 0;
    const column = node.range?.start.column ?? 0;

    // Arithmetic operator mutations
    if (node.type === "BinaryExpression") {
      const op = node.operator as string;
      const arithmeticOps: Record<string, string[]> = {
        "+": ["-", "*"],
        "-": ["+", "*"],
        "*": ["/", "+"],
        "/": ["*", "-"],
        "%": ["/"],
        "**": ["*"],
      };

      if (arithmeticOps[op]) {
        for (const replacement of arithmeticOps[op]) {
          this.mutationIdCounter++;
          mutations.push({
            id: `mut_${this.mutationIdCounter}`,
            type: "arithmetic_operator",
            description: `Replace '${op}' with '${replacement}'`,
            original: op,
            replacement,
            lineNumber: line,
            column,
          });
        }
      }

      // Logical operator mutations
      const logicalOps: Record<string, string> = {
        "&&": "||",
        "||": "&&",
      };

      if (logicalOps[op]) {
        this.mutationIdCounter++;
        mutations.push({
          id: `mut_${this.mutationIdCounter}`,
          type: "logical_operator",
          description: `Replace '${op}' with '${logicalOps[op]}'`,
          original: op,
          replacement: logicalOps[op],
          lineNumber: line,
          column,
        });
      }
    }

    // Conditional boundary mutations
    if (node.type === "BinaryExpression" && node.operator === ">") {
      this.mutationIdCounter++;
      mutations.push({
        id: `mut_${this.mutationIdCounter}`,
        type: "conditional_boundary",
        description: "Replace '>' with '>='",
        original: ">",
        replacement: ">=",
        lineNumber: line,
        column,
      });
    }

    if (node.type === "BinaryExpression" && node.operator === "<") {
      this.mutationIdCounter++;
      mutations.push({
        id: `mut_${this.mutationIdCounter}`,
        type: "conditional_boundary",
        description: "Replace '<' with '<='",
        original: "<",
        replacement: "<=",
        lineNumber: line,
        column,
      });
    }

    if (node.type === "BinaryExpression" && node.operator === ">=") {
      this.mutationIdCounter++;
      mutations.push({
        id: `mut_${this.mutationIdCounter}`,
        type: "conditional_boundary",
        description: "Replace '>=' with '>'",
        original: ">=",
        replacement: ">",
        lineNumber: line,
        column,
      });
    }

    if (node.type === "BinaryExpression" && node.operator === "<=") {
      this.mutationIdCounter++;
      mutations.push({
        id: `mut_${this.mutationIdCounter}`,
        type: "conditional_boundary",
        description: "Replace '<=' with '<'",
        original: "<=",
        replacement: "<",
        lineNumber: line,
        column,
      });
    }

    // Boolean literal mutations
    if (node.type === "BooleanLiteral") {
      const value = node.value as boolean;
      this.mutationIdCounter++;
      mutations.push({
        id: `mut_${this.mutationIdCounter}`,
        type: "boolean_literal",
        description: `Replace '${value}' with '${!value}'`,
        original: String(value),
        replacement: String(!value),
        lineNumber: line,
        column,
      });
    }

    // Negate conditionals
    if (node.type === "IfStatement" || node.type === "ConditionalExpression") {
      this.mutationIdCounter++;
      mutations.push({
        id: `mut_${this.mutationIdCounter}`,
        type: "negate_conditionals",
        description: "Negate conditional",
        original: "condition",
        replacement: "!condition",
        lineNumber: line,
        column,
      });
    }

    // Return value mutations
    if (node.type === "ReturnStatement") {
      this.mutationIdCounter++;
      mutations.push({
        id: `mut_${this.mutationIdCounter}`,
        type: "return_value",
        description: "Remove return value",
        original: "return value",
        replacement: "return undefined",
        lineNumber: line,
        column,
      });
    }

    // String literal mutations
    if (node.type === "StringLiteral") {
      const value = node.value as string;
      this.mutationIdCounter++;
      mutations.push({
        id: `mut_${this.mutationIdCounter}`,
        type: "string_literal",
        description: `Modify string '${value}'`,
        original: value,
        replacement: value + "_mutated",
        lineNumber: line,
        column,
      });
    }

    // Recurse into children
    const childKeys = ["body", "consequent", "alternate", "declarations", "arguments", "elements", "left", "right", "test", "init"];
    for (const key of childKeys) {
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object") {
            this.collectMutations(item as ASTNode, mutations);
          }
        }
      } else if (child && typeof child === "object") {
        this.collectMutations(child as ASTNode, mutations);
      }
    }
  }

  private applyMutationToNode(node: ASTNode, mutation: Mutation): boolean {
    if (!node) return false;

    const line = node.range?.start.line ?? 0;

    if (line === mutation.lineNumber) {
      if (node.type === "BinaryExpression" && node.operator === mutation.original) {
        (node as Record<string, unknown>).operator = mutation.replacement;
        return true;
      }
      if (node.type === "BooleanLiteral") {
        (node as Record<string, unknown>).value = mutation.replacement === "true";
        return true;
      }
      if (node.type === "StringLiteral") {
        (node as Record<string, unknown>).value = mutation.replacement;
        return true;
      }
    }

    // Recurse
    const childKeys = ["body", "consequent", "alternate", "declarations", "arguments", "elements", "left", "right", "test", "init"];
    for (const key of childKeys) {
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object") {
            if (this.applyMutationToNode(item as ASTNode, mutation)) return true;
          }
        }
      } else if (child && typeof child === "object") {
        if (this.applyMutationToNode(child as ASTNode, mutation)) return true;
      }
    }

    return false;
  }

  private applyStringMutation(code: string, mutation: Mutation): string {
    const lines = code.split("\n");
    if (mutation.lineNumber > 0 && mutation.lineNumber <= lines.length) {
      const lineIndex = mutation.lineNumber - 1;
      lines[lineIndex] = lines[lineIndex].replace(mutation.original, mutation.replacement);
    }
    return lines.join("\n");
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }
}
