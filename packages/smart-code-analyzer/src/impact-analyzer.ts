/**
 * Impact Analyzer Module
 *
 * Analyze the impact of code changes on a codebase.
 * Estimates risk, identifies affected files, and recommends required tests.
 */

import type { ASTNode, AST } from "./ast-parser.js";
import type { DependencyGraph } from "./dependency-graph.js";

/** Type of code change */
export type ChangeType =
  | "add"
  | "remove"
  | "modify"
  | "rename"
  | "move";

/** A single code change */
export interface ChangeInfo {
  type: ChangeType;
  filePath: string;
  description: string;
  oldAst?: ASTNode;
  newAst?: ASTNode;
  changedSymbols: string[];
  changedLines?: { start: number; end: number };
  riskLevel?: "low" | "medium" | "high" | "critical";
}

/** Risk assessment for a change */
export interface RiskAssessment {
  level: "low" | "medium" | "high" | "critical";
  score: number;
  factors: string[];
  affectedComponents: string[];
  estimatedBlastRadius: number;
}

/** Required test information */
export interface RequiredTest {
  name: string;
  type: "unit" | "integration" | "e2e";
  target: string;
  priority: "must" | "should" | "could";
  reason: string;
}

/** Impact report */
export interface ImpactReport {
  summary: string;
  changeInfo: ChangeInfo;
  riskAssessment: RiskAssessment;
  affectedFiles: string[];
  requiredTests: RequiredTest[];
  recommendations: string[];
  estimatedEffort: "minimal" | "small" | "moderate" | "significant" | "major";
  generatedAt: string;
}

/**
 * ImpactAnalyzer - Analyze the impact of code changes on a codebase.
 */
export class ImpactAnalyzer {
  /**
   * Analyze the differences between old and new ASTs.
   * @param oldAst - The original AST
   * @param newAst - The new AST
   * @returns Array of detected changes
   */
  analyzeChange(oldAst: ASTNode, newAst: ASTNode): ChangeInfo[] {
    const changes: ChangeInfo[] = [];

    // Compare top-level nodes
    const oldNodes = this.flattenNodes(oldAst);
    const newNodes = this.flattenNodes(newAst);

    const oldMap = new Map(oldNodes.map((n) => [n.name ?? n.type, n]));
    const newMap = new Map(newNodes.map((n) => [n.name ?? n.type, n]));

    // Detect additions
    for (const [key, node] of newMap) {
      if (!oldMap.has(key)) {
        changes.push({
          type: "add",
          filePath: "",
          description: `Added ${node.type} "${key}"`,
          newAst: node,
          changedSymbols: [key],
        });
      }
    }

    // Detect removals
    for (const [key, node] of oldMap) {
      if (!newMap.has(key)) {
        changes.push({
          type: "remove",
          filePath: "",
          description: `Removed ${node.type} "${key}"`,
          oldAst: node,
          changedSymbols: [key],
        });
      }
    }

    // Detect modifications
    for (const [key, oldNode] of oldMap) {
      const newNode = newMap.get(key);
      if (newNode && !this.nodesEqual(oldNode, newNode)) {
        changes.push({
          type: "modify",
          filePath: "",
          description: `Modified ${oldNode.type} "${key}"`,
          oldAst: oldNode,
          newAst: newNode,
          changedSymbols: [key],
        });
      }
    }

    return changes;
  }

  /**
   * Get all files affected by a change, using the dependency graph.
   * @param changeInfo - The change to analyze
   * @param depGraph - The dependency graph
   * @returns Array of affected file paths
   */
  getAffectedFiles(changeInfo: ChangeInfo, depGraph: DependencyGraph): string[] {
    const affected = new Set<string>();

    for (const symbol of changeInfo.changedSymbols) {
      // Direct dependents
      const dependents = depGraph.getDependents(symbol);
      for (const dep of dependents) {
        affected.add(dep);
      }

      // Also check if any node contains this symbol
      for (const nodeId of depGraph.getNodeIds()) {
        const node = depGraph.getNode(nodeId);
        if (node && node.meta.name.includes(symbol)) {
          affected.add(nodeId);
        }
      }
    }

    // Add the file itself
    if (changeInfo.filePath) {
      affected.add(changeInfo.filePath);
    }

    return [...affected];
  }

  /**
   * Estimate the risk level of a code change.
   * @param changeInfo - The change to assess
   * @returns Risk assessment
   */
  estimateRisk(changeInfo: ChangeInfo): RiskAssessment {
    const factors: string[] = [];
    let score = 0;
    const affectedComponents: string[] = [...changeInfo.changedSymbols];

    // Change type risk
    switch (changeInfo.type) {
      case "remove":
        score += 30;
        factors.push("Removing code can break existing references");
        break;
      case "rename":
        score += 25;
        factors.push("Renaming requires updating all references");
        break;
      case "move":
        score += 20;
        factors.push("Moving code may break import paths");
        break;
      case "modify":
        score += 15;
        factors.push("Modifications may change behavior");
        break;
      case "add":
        score += 5;
        factors.push("Additions have low risk but may affect integration");
        break;
    }

    // Number of changed symbols
    if (changeInfo.changedSymbols.length > 5) {
      score += 20;
      factors.push("Many symbols changed simultaneously");
    } else if (changeInfo.changedSymbols.length > 2) {
      score += 10;
      factors.push("Multiple symbols changed");
    }

    // Changed lines
    if (changeInfo.changedLines) {
      const lineCount = changeInfo.changedLines.end - changeInfo.changedLines.start;
      if (lineCount > 100) {
        score += 25;
        factors.push("Large number of lines changed");
      } else if (lineCount > 50) {
        score += 15;
        factors.push("Significant number of lines changed");
      } else if (lineCount > 20) {
        score += 5;
      }
    }

    // Determine level
    let level: RiskAssessment["level"];
    if (score >= 50) level = "critical";
    else if (score >= 35) level = "high";
    else if (score >= 20) level = "medium";
    else level = "low";

    return {
      level,
      score: Math.min(score, 100),
      factors,
      affectedComponents,
      estimatedBlastRadius: changeInfo.changedSymbols.length * 2 + (changeInfo.type === "remove" ? 3 : 0),
    };
  }

  /**
   * Get the tests required to validate a change.
   * @param changeInfo - The change to analyze
   * @returns Array of required tests
   */
  getRequiredTests(changeInfo: ChangeInfo): RequiredTest[] {
    const tests: RequiredTest[] = [];

    for (const symbol of changeInfo.changedSymbols) {
      // Unit test for the changed symbol
      tests.push({
        name: `Test ${symbol} behavior`,
        type: "unit",
        target: symbol,
        priority: "must",
        reason: `Direct change to ${symbol} requires unit test validation`,
      });

      // Integration test if it's a modification or removal
      if (changeInfo.type === "modify" || changeInfo.type === "remove") {
        tests.push({
          name: `Test ${symbol} integration`,
          type: "integration",
          target: symbol,
          priority: "should",
          reason: `${changeInfo.type === "remove" ? "Removal" : "Modification"} of ${symbol} may affect integrations`,
        });
      }
    }

    // E2E test for high-risk changes
    if (changeInfo.type === "remove" || changeInfo.type === "rename") {
      tests.push({
        name: `End-to-end regression test`,
        type: "e2e",
        target: changeInfo.filePath || "project",
        priority: "must",
        reason: `${changeInfo.type} changes require full regression testing`,
      });
    }

    return tests;
  }

  /**
   * Generate a comprehensive impact report for a change.
   * @param changeInfo - The change to analyze
   * @returns Impact report
   */
  generateImpactReport(changeInfo: ChangeInfo): ImpactReport {
    const riskAssessment = this.estimateRisk(changeInfo);
    const requiredTests = this.getRequiredTests(changeInfo);

    const recommendations: string[] = [];

    switch (riskAssessment.level) {
      case "critical":
        recommendations.push("Require code review from at least 2 team members");
        recommendations.push("Run full test suite including integration tests");
        recommendations.push("Consider staged rollout with feature flags");
        recommendations.push("Update documentation and API references");
        break;
      case "high":
        recommendations.push("Require code review from at least 1 team member");
        recommendations.push("Run full test suite");
        recommendations.push("Consider backward compatibility");
        break;
      case "medium":
        recommendations.push("Standard code review process");
        recommendations.push("Run affected tests");
        break;
      case "low":
        recommendations.push("Standard development workflow");
        break;
    }

    if (changeInfo.type === "remove") {
      recommendations.push("Verify no runtime references to removed symbols exist");
    }

    if (changeInfo.type === "rename") {
      recommendations.push("Update all import statements and references");
    }

    const estimatedEffort = this.estimateEffort(changeInfo, riskAssessment);

    return {
      summary: `Change "${changeInfo.description}" has ${riskAssessment.level} risk with ${requiredTests.length} required tests`,
      changeInfo,
      riskAssessment,
      affectedFiles: [changeInfo.filePath].filter(Boolean),
      requiredTests,
      recommendations,
      estimatedEffort,
      generatedAt: new Date().toISOString(),
    };
  }

  // --- Private helpers ---

  private flattenNodes(node: ASTNode): ASTNode[] {
    const results: ASTNode[] = [];

    const walk = (n: ASTNode): void => {
      if (n.name || n.type === "ClassDeclaration" || n.type === "FunctionDeclaration" || n.type === "InterfaceDeclaration" || n.type === "TypeAliasDeclaration") {
        results.push(n);
      }

      const childKeys = ["body", "declarations", "methods", "properties", "members"];
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

  private nodesEqual(a: ASTNode, b: ASTNode): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private estimateEffort(changeInfo: ChangeInfo, risk: RiskAssessment): ImpactReport["estimatedEffort"] {
    if (risk.level === "critical" || changeInfo.changedSymbols.length > 10) return "major";
    if (risk.level === "high" || changeInfo.changedSymbols.length > 5) return "significant";
    if (risk.level === "medium" || changeInfo.changedSymbols.length > 2) return "moderate";
    if (changeInfo.type === "add" && changeInfo.changedSymbols.length <= 1) return "minimal";
    return "small";
  }
}
