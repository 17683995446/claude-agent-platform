/**
 * Type Inference Module
 *
 * Infer types from untyped JavaScript code by analyzing usage patterns,
 * assignments, function calls, and return values.
 */

import type { ASTNode } from "./ast-parser.js";

/** Inferred type information */
export interface InferredType {
  name: string;
  type: string;
  confidence: number;
  sources: string[];
  isNullable: boolean;
  isGeneric: boolean;
  genericParams?: string[];
}

/** Parameter type inference result */
export interface ParameterTypeInference {
  name: string;
  inferredType: string;
  confidence: number;
  possibleTypes: string[];
}

/** Variable assignment for tracking */
export interface VariableAssignment {
  value: string;
  type?: string;
  line: number;
  context: string;
}

/** File-level type analysis result */
export interface FileTypeMap {
  filePath: string;
  types: Map<string, InferredType>;
  functionReturnTypes: Map<string, InferredType>;
  functionParameterTypes: Map<string, ParameterTypeInference[]>;
  confidence: number;
}

/**
 * TypeInference - Infer types from untyped JavaScript code.
 */
export class TypeInference {
  private typeHeuristics: Map<string, string[]> = new Map();
  private commonTypePatterns: Map<RegExp, string> = new Map();

  constructor() {
    this.initializeHeuristics();
    this.initializePatterns();
  }

  /**
   * Infer the return type of a function node.
   * @param funcNode - The function AST node
   * @returns Inferred type information
   */
  inferReturnType(funcNode: ASTNode): InferredType {
    const name = (funcNode.name as string) ?? "anonymous";

    // Check for explicit return type annotation first (takes priority)
    if (funcNode.returnType) {
      return {
        name: `${name}_return`,
        type: funcNode.returnType as string,
        confidence: 1.0,
        sources: ["annotation"],
        isNullable: (funcNode.returnType as string).includes("| null"),
        isGeneric: (funcNode.returnType as string).includes("<"),
        genericParams: this.extractGenericParams(funcNode.returnType as string),
      };
    }

    const body = funcNode.body;

    if (!body || (Array.isArray(body) && body.length === 0)) {
      return {
        name: `${name}_return`,
        type: "void",
        confidence: 0.9,
        sources: ["empty_body"],
        isNullable: false,
        isGeneric: false,
      };
    }

    // Analyze return statements
    const returnTypes = this.analyzeReturnStatements(body);

    if (returnTypes.length === 0) {
      return {
        name: `${name}_return`,
        type: "void",
        confidence: 0.8,
        sources: ["no_return_statement"],
        isNullable: false,
        isGeneric: false,
      };
    }

    // Find the most common type
    const typeCounts = new Map<string, number>();
    for (const rt of returnTypes) {
      typeCounts.set(rt, (typeCounts.get(rt) ?? 0) + 1);
    }

    let bestType = "unknown";
    let bestCount = 0;
    for (const [type, count] of typeCounts) {
      if (count > bestCount) {
        bestType = type;
        bestCount = count;
      }
    }

    const confidence = Math.min(bestCount / returnTypes.length + 0.2, 1.0);

    // Check if multiple types are returned
    const uniqueTypes = new Set(returnTypes);
    const finalType = uniqueTypes.size === 1 ? bestType : `(${[...uniqueTypes].join(" | ")})`;

    return {
      name: `${name}_return`,
      type: finalType,
      confidence,
      sources: returnTypes.map((t) => `return:${t}`),
      isNullable: returnTypes.some((t) => t === "null" || t === "undefined"),
      isGeneric: bestType.includes("<"),
      genericParams: this.extractGenericParams(bestType),
    };
  }

  /**
   * Infer parameter types based on usage context.
   * @param funcNode - The function AST node
   * @param usageContext - Map of parameter names to observed usage patterns
   * @returns Array of parameter type inferences
   */
  inferParameterTypes(
    funcNode: ASTNode,
    usageContext: Map<string, string[]>
  ): ParameterTypeInference[] {
    const parameters = (funcNode.parameters as Array<{ name: string; type?: string }>) ?? [];
    const results: ParameterTypeInference[] = [];

    for (const param of parameters) {
      // If type is already annotated
      if (param.type) {
        results.push({
          name: param.name,
          inferredType: param.type,
          confidence: 1.0,
          possibleTypes: [param.type],
        });
        continue;
      }

      // Infer from usage context
      const usages = usageContext.get(param.name) ?? [];
      const inferredTypes = this.inferTypesFromUsage(usages);

      if (inferredTypes.length > 0) {
        const typeCounts = new Map<string, number>();
        for (const t of inferredTypes) {
          typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
        }

        let bestType = "unknown";
        let bestCount = 0;
        for (const [type, count] of typeCounts) {
          if (count > bestCount) {
            bestType = type;
            bestCount = count;
          }
        }

        results.push({
          name: param.name,
          inferredType: bestType,
          confidence: Math.min(bestCount / inferredTypes.length + 0.1, 0.9),
          possibleTypes: [...new Set(inferredTypes)],
        });
      } else {
        results.push({
          name: param.name,
          inferredType: "unknown",
          confidence: 0.1,
          possibleTypes: ["unknown"],
        });
      }
    }

    return results;
  }

  /**
   * Infer the type of a variable from its assignments.
   * @param varNode - The variable AST node
   * @param assignments - Array of variable assignments
   * @returns Inferred type information
   */
  inferVariableType(varNode: ASTNode, assignments: VariableAssignment[]): InferredType {
    const name = (varNode.name as string) ?? "unknown";

    if (assignments.length === 0) {
      return {
        name,
        type: "undefined",
        confidence: 0.5,
        sources: ["no_assignment"],
        isNullable: true,
        isGeneric: false,
      };
    }

    const types: string[] = [];

    for (const assignment of assignments) {
      if (assignment.type) {
        types.push(assignment.type);
      } else {
        const inferred = this.inferTypeFromValue(assignment.value);
        types.push(inferred);
      }
    }

    const uniqueTypes = [...new Set(types)];

    if (uniqueTypes.length === 1) {
      return {
        name,
        type: uniqueTypes[0],
        confidence: 0.8,
        sources: assignments.map((a) => `assignment:${a.line}`),
        isNullable: uniqueTypes[0] === "null" || uniqueTypes[0] === "undefined",
        isGeneric: uniqueTypes[0].includes("<"),
      };
    }

    // Multiple types -> union type
    return {
      name,
      type: uniqueTypes.join(" | "),
      confidence: 0.6,
      sources: assignments.map((a) => `assignment:${a.line}`),
      isNullable: uniqueTypes.some((t) => t === "null" || t === "undefined"),
      isGeneric: uniqueTypes.some((t) => t.includes("<")),
    };
  }

  /**
   * Infer generic type parameters of a class.
   * @param classNode - The class AST node
   * @returns Inferred type information with generic parameters
   */
  inferGenericType(classNode: ASTNode): InferredType {
    const name = (classNode.name as string) ?? "Anonymous";
    const typeParameters = (classNode.typeParameters as string[]) ?? [];

    if (typeParameters.length > 0) {
      return {
        name,
        type: `${name}<${typeParameters.join(", ")}>`,
        confidence: 1.0,
        sources: ["type_annotation"],
        isNullable: false,
        isGeneric: true,
        genericParams: typeParameters,
      };
    }

    // Try to infer generics from usage patterns
    const methods = (classNode.methods as ASTNode[]) ?? [];
    const properties = (classNode.properties as ASTNode[]) ?? [];

    const usedTypes = new Set<string>();
    for (const method of methods) {
      const returnType = method.returnType as string | undefined;
      if (returnType) usedTypes.add(returnType);

      const params = (method.parameters as Array<{ type?: string }>) ?? [];
      for (const p of params) {
        if (p.type) usedTypes.add(p.type);
      }
    }

    for (const prop of properties) {
      const propType = prop.type as string | undefined;
      if (propType) usedTypes.add(propType);
    }

    // Check if the class uses T or other generic-like patterns
    const genericCandidates = [...usedTypes].filter((t) => /^[A-Z]$/.test(t));

    if (genericCandidates.length > 0) {
      return {
        name,
        type: `${name}<${genericCandidates.join(", ")}>`,
        confidence: 0.7,
        sources: ["usage_inference"],
        isNullable: false,
        isGeneric: true,
        genericParams: genericCandidates,
      };
    }

    return {
      name,
      type: name,
      confidence: 0.9,
      sources: ["concrete_class"],
      isNullable: false,
      isGeneric: false,
    };
  }

  /**
   * Analyze an entire file and return a complete type map.
   * @param source - Source code string
   * @returns File type map with all inferred types
   */
  analyzeFile(source: string): FileTypeMap {
    const types = new Map<string, InferredType>();
    const functionReturnTypes = new Map<string, InferredType>();
    const functionParameterTypes = new Map<string, ParameterTypeInference[]>();

    // Build a simple AST-like structure from the source
    const lines = source.split("\n");
    let totalConfidence = 0;
    let typeCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Variable declarations
      const varMatch = trimmed.match(/(?:const|let|var)\s+(\w+)\s*(?::\s*(\w+))?\s*=\s*(.+);/);
      if (varMatch) {
        const [, varName, annotatedType, value] = varMatch;
        const inferredType = annotatedType ?? this.inferTypeFromValue(value.trim());

        const typeInfo: InferredType = {
          name: varName,
          type: inferredType,
          confidence: annotatedType ? 1.0 : 0.7,
          sources: annotatedType ? ["annotation"] : ["value_inference"],
          isNullable: false,
          isGeneric: inferredType.includes("<"),
          genericParams: this.extractGenericParams(inferredType),
        };

        types.set(varName, typeInfo);
        totalConfidence += typeInfo.confidence;
        typeCount++;
      }

      // Function declarations
      const funcMatch = trimmed.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\w+))?/);
      if (funcMatch) {
        const [, funcName, params, returnType] = funcMatch;

        const returnTypeInfo: InferredType = {
          name: `${funcName}_return`,
          type: returnType ?? "void",
          confidence: returnType ? 1.0 : 0.6,
          sources: returnType ? ["annotation"] : ["default_void"],
          isNullable: false,
          isGeneric: false,
        };

        functionReturnTypes.set(funcName, returnTypeInfo);
        totalConfidence += returnTypeInfo.confidence;
        typeCount++;

        // Parse parameters
        if (params.trim()) {
          const paramList = params.split(",").map((p) => p.trim()).filter(Boolean);
          const paramTypes: ParameterTypeInference[] = [];

          for (const param of paramList) {
            const paramParts = param.split(":");
            const paramName = paramParts[0].replace("?", "").trim();
            const paramType = paramParts[1]?.trim() ?? "unknown";

            paramTypes.push({
              name: paramName,
              inferredType: paramType,
              confidence: paramParts.length > 1 ? 1.0 : 0.3,
              possibleTypes: [paramType],
            });
          }

          functionParameterTypes.set(funcName, paramTypes);
        }
      }
    }

    return {
      filePath: "",
      types,
      functionReturnTypes,
      functionParameterTypes,
      confidence: typeCount > 0 ? totalConfidence / typeCount : 0,
    };
  }

  // --- Private helpers ---

  private initializeHeuristics(): void {
    this.typeHeuristics.set("string", ["''", '""', "``", "String(", "toString()", "toLowerCase", "toUpperCase", "substring", "split", "trim"]);
    this.typeHeuristics.set("number", ["Number(", "parseInt", "parseFloat", "Math.", "length", "indexOf", "+ ", "- ", "* ", "/ "]);
    this.typeHeuristics.set("boolean", ["true", "false", "!", "&&", "||", "=== ", "!== ", "includes(", "startsWith(", "endsWith("]);
    this.typeHeuristics.set("Array", ["[", ".push(", ".pop(", ".map(", ".filter(", ".reduce(", ".forEach(", ".find(", "Array("]);
    this.typeHeuristics.set("Object", ["{", "Object.", "Object.assign", ".hasOwnProperty"]);
    this.typeHeuristics.set("Promise", ["Promise", ".then(", ".catch(", "async", "await"]);
    this.typeHeuristics.set("Map", ["Map(", ".set(", ".get(", ".has(", ".delete("]);
    this.typeHeuristics.set("Set", ["Set(", ".add(", ".has("]);
    this.typeHeuristics.set("RegExp", ["RegExp(", "/^", "/$/", "new RegExp"]);
  }

  private initializePatterns(): void {
    this.commonTypePatterns.set(/^'.*'$/, "string");
    this.commonTypePatterns.set(/^".*"$/, "string");
    this.commonTypePatterns.set(/^`.*`$/, "string");
    this.commonTypePatterns.set(/^\d+$/, "number");
    this.commonTypePatterns.set(/^\d+\.\d+$/, "number");
    this.commonTypePatterns.set(/^true$|^false$/, "boolean");
    this.commonTypePatterns.set(/^\[.*\]$/, "Array");
    this.commonTypePatterns.set(/^\{.*\}$/, "Object");
    this.commonTypePatterns.set(/^null$/, "null");
    this.commonTypePatterns.set(/^undefined$/, "undefined");
    this.commonTypePatterns.set(/^new \w+/, "Object");
    this.commonTypePatterns.set(/^\d+n$/, "bigint");
  }

  private inferTypeFromValue(value: string): string {
    if (!value) return "undefined";

    // Check patterns
    for (const [pattern, type] of this.commonTypePatterns) {
      if (pattern.test(value.trim())) {
        return type;
      }
    }

    // Check heuristics
    for (const [type, indicators] of this.typeHeuristics) {
      for (const indicator of indicators) {
        if (value.includes(indicator)) {
          return type;
        }
      }
    }

    return "unknown";
  }

  private inferTypesFromUsage(usages: string[]): string[] {
    const types: string[] = [];

    for (const usage of usages) {
      for (const [type, indicators] of this.typeHeuristics) {
        for (const indicator of indicators) {
          if (usage.includes(indicator)) {
            types.push(type);
            break;
          }
        }
      }
    }

    return types;
  }

  private analyzeReturnStatements(body: ASTNode[] | ASTNode): string[] {
    const returnTypes: string[] = [];

    const walk = (node: ASTNode): void => {
      if (!node || typeof node !== "object") return;

      if (node.type === "ReturnStatement" || (node as Record<string, unknown>).kind === "return") {
        const argument = (node as Record<string, unknown>).argument;
        if (argument) {
          if (typeof argument === "string") {
            returnTypes.push(this.inferTypeFromValue(argument));
          } else if (typeof argument === "object" && argument !== null) {
            const argType = (argument as ASTNode).type;
            if (argType === "NumericLiteral") returnTypes.push("number");
            else if (argType === "StringLiteral") returnTypes.push("string");
            else if (argType === "BooleanLiteral") returnTypes.push("boolean");
            else if (argType === "ArrayExpression") returnTypes.push("Array");
            else if (argType === "ObjectExpression") returnTypes.push("Object");
            else if (argType === "NullLiteral") returnTypes.push("null");
            else if (argType === "Identifier") returnTypes.push("unknown");
            else if (argType === "CallExpression") returnTypes.push("unknown");
            else returnTypes.push("unknown");
          }
        } else {
          returnTypes.push("void");
        }
      }

      const childKeys = ["body", "consequent", "alternate", "declarations", "arguments", "elements"];
      for (const key of childKeys) {
        const child = (node as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object") walk(item as ASTNode);
          }
        } else if (child && typeof child === "object") {
          walk(child as ASTNode);
        }
      }
    };

    if (Array.isArray(body)) {
      for (const item of body) {
        walk(item);
      }
    } else {
      walk(body);
    }

    return returnTypes;
  }

  private extractGenericParams(typeStr: string): string[] | undefined {
    const match = typeStr.match(/<([^>]+)>/);
    if (match) {
      return match[1].split(",").map((p) => p.trim());
    }
    return undefined;
  }
}
