import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ASTParser } from "../src/ast-parser.js";
import type { ASTNode, AST } from "../src/ast-parser.js";
import { DependencyGraph } from "../src/dependency-graph.js";
import type { NodeMeta } from "../src/dependency-graph.js";
import { PatternDetector } from "../src/pattern-detector.js";
import { CodeSmellAnalyzer } from "../src/code-smell-analyzer.js";
import { TypeInference } from "../src/type-inference.js";
import { MutationTester } from "../src/mutation-tester.js";
import { ImpactAnalyzer } from "../src/impact-analyzer.js";
import { CloneDetector } from "../src/clone-detector.js";
import { SecurityScanner } from "../src/security-scanner.js";
import { MetricsCollector } from "../src/metrics-collector.js";

// ============================================================
// Helper: create mock AST nodes
// ============================================================

function makeRange(startLine: number, endLine: number, startCol = 0, endCol = 10) {
  return {
    start: { line: startLine, column: startCol },
    end: { line: endLine, column: endCol },
  };
}

function makeFunctionNode(name: string, overrides: Partial<ASTNode> = {}): ASTNode {
  return {
    type: "FunctionDeclaration",
    kind: "function",
    name,
    parameters: [{ name: "x", type: "number" }],
    returnType: "void",
    isAsync: false,
    isGenerator: false,
    isExported: false,
    isArrow: false,
    range: makeRange(1, 5),
    body: [],
    ...overrides,
  };
}

function makeClassNode(name: string, overrides: Partial<ASTNode> = {}): ASTNode {
  return {
    type: "ClassDeclaration",
    kind: "class",
    name,
    superClass: undefined,
    implementedInterfaces: [],
    isExported: false,
    isAbstract: false,
    methods: [],
    properties: [],
    decorators: [],
    range: makeRange(1, 20),
    ...overrides,
  };
}

function makeImportNode(source: string, specifiers: Array<{ name: string; alias?: string }> = [], overrides: Partial<ASTNode> = {}): ASTNode {
  return {
    type: "ImportDeclaration",
    source,
    specifiers,
    isTypeOnly: false,
    range: makeRange(1, 1),
    ...overrides,
  };
}

function makeProgram(body: ASTNode[] = []): ASTNode {
  return {
    type: "Program",
    body,
    range: makeRange(1, 100),
  };
}

// ============================================================
// 1. ASTParser Tests
// ============================================================

describe("ASTParser", () => {
  let parser: ASTParser;

  beforeEach(() => {
    parser = new ASTParser("typescript");
  });

  describe("parse", () => {
    it("should parse empty code and return empty AST", () => {
      const ast = parser.parse("");
      expect(ast.type).toBe("Program");
      expect(ast.body).toHaveLength(0);
      expect(ast.language).toBe("typescript");
    });

    it("should parse whitespace-only code as empty AST", () => {
      const ast = parser.parse("   \n\n   ");
      expect(ast.body).toHaveLength(0);
    });

    it("should parse a function declaration", () => {
      const code = "function hello(x: number): void { }";
      const ast = parser.parse(code);
      expect(ast.body.length).toBeGreaterThan(0);
      expect(ast.body[0].type).toBe("FunctionDeclaration");
    });

    it("should parse an arrow function", () => {
      const code = "const add = (a: number, b: number): number => a + b";
      const ast = parser.parse(code);
      expect(ast.body.length).toBeGreaterThan(0);
    });

    it("should parse a class declaration", () => {
      const code = "class MyClass { }";
      const ast = parser.parse(code);
      expect(ast.body.length).toBeGreaterThan(0);
      expect(ast.body[0].type).toBe("ClassDeclaration");
    });

    it("should parse an import statement", () => {
      const code = 'import { foo } from "bar"';
      const ast = parser.parse(code);
      expect(ast.body.length).toBeGreaterThan(0);
      expect(ast.body[0].type).toBe("ImportDeclaration");
    });

    it("should detect module source type for imports", () => {
      const code = 'import { foo } from "bar"';
      const ast = parser.parse(code);
      expect(ast.sourceType).toBe("module");
    });

    it("should detect script source type without imports", () => {
      const code = "const x = 1";
      const ast = parser.parse(code);
      expect(ast.sourceType).toBe("script");
    });

    it("should allow overriding language", () => {
      const ast = parser.parse("const x = 1", "javascript");
      expect(ast.language).toBe("javascript");
    });

    it("should parse an interface declaration", () => {
      const code = "interface MyInterface { }";
      const ast = parser.parse(code);
      expect(ast.body[0].type).toBe("InterfaceDeclaration");
    });

    it("should parse a type alias", () => {
      const code = "type MyType = string | number";
      const ast = parser.parse(code);
      expect(ast.body[0].type).toBe("TypeAliasDeclaration");
    });

    it("should parse async functions", () => {
      const code = "async function fetchData() { }";
      const ast = parser.parse(code);
      expect(ast.body[0].isAsync).toBe(true);
    });

    it("should parse exported functions", () => {
      const code = "export function doStuff() { }";
      const ast = parser.parse(code);
      expect(ast.body[0].isExported).toBe(true);
    });

    it("should parse class with extends and implements", () => {
      const code = "class Dog extends Animal implements Pet { }";
      const ast = parser.parse(code);
      expect(ast.body[0].superClass).toBe("Animal");
    });

    it("should parse abstract classes", () => {
      const code = "abstract class Shape { }";
      const ast = parser.parse(code);
      expect(ast.body[0].isAbstract).toBe(true);
    });

    it("should parse variable declarations", () => {
      const code = "const x = 5";
      const ast = parser.parse(code);
      expect(ast.body[0].type).toBe("VariableDeclaration");
    });

    it("should parse multiple statements", () => {
      const code = "const x = 1\nconst y = 2\nfunction foo() {}";
      const ast = parser.parse(code);
      expect(ast.body.length).toBeGreaterThanOrEqual(3);
    });

    it("should parse default imports", () => {
      const code = 'import React from "react"';
      const ast = parser.parse(code);
      const node = ast.body[0];
      expect(node.specifiers).toBeDefined();
    });

    it("should parse namespace imports", () => {
      const code = 'import * as path from "path"';
      const ast = parser.parse(code);
      expect(ast.body[0].type).toBe("ImportDeclaration");
    });
  });

  describe("extractFunctions", () => {
    it("should extract functions from AST", () => {
      const ast: AST = {
        type: "Program",
        body: [makeFunctionNode("hello")],
        sourceType: "module",
        range: makeRange(1, 10),
        language: "typescript",
      };
      const functions = parser.extractFunctions(ast);
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe("hello");
    });

    it("should extract multiple functions", () => {
      const ast: AST = {
        type: "Program",
        body: [makeFunctionNode("foo"), makeFunctionNode("bar")],
        sourceType: "module",
        range: makeRange(1, 20),
        language: "typescript",
      };
      const functions = parser.extractFunctions(ast);
      expect(functions).toHaveLength(2);
    });

    it("should return empty array for no functions", () => {
      const ast: AST = {
        type: "Program",
        body: [],
        sourceType: "module",
        range: makeRange(1, 1),
        language: "typescript",
      };
      const functions = parser.extractFunctions(ast);
      expect(functions).toHaveLength(0);
    });

    it("should extract functions from classes", () => {
      const classNode = makeClassNode("MyClass", {
        methods: [makeFunctionNode("method1")],
      });
      const ast: AST = {
        type: "Program",
        body: [classNode],
        sourceType: "module",
        range: makeRange(1, 30),
        language: "typescript",
      };
      const functions = parser.extractFunctions(ast);
      expect(functions.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect async and generator functions", () => {
      const ast: AST = {
        type: "Program",
        body: [
          makeFunctionNode("asyncFn", { isAsync: true }),
          makeFunctionNode("genFn", { isGenerator: true }),
        ],
        sourceType: "module",
        range: makeRange(1, 10),
        language: "typescript",
      };
      const functions = parser.extractFunctions(ast);
      expect(functions[0].isAsync).toBe(true);
      expect(functions[1].isGenerator).toBe(true);
    });
  });

  describe("extractClasses", () => {
    it("should extract classes from AST", () => {
      const ast: AST = {
        type: "Program",
        body: [makeClassNode("MyClass")],
        sourceType: "module",
        range: makeRange(1, 20),
        language: "typescript",
      };
      const classes = parser.extractClasses(ast);
      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe("MyClass");
    });

    it("should extract class with inheritance", () => {
      const ast: AST = {
        type: "Program",
        body: [makeClassNode("Dog", { superClass: "Animal" })],
        sourceType: "module",
        range: makeRange(1, 20),
        language: "typescript",
      };
      const classes = parser.extractClasses(ast);
      expect(classes[0].superClass).toBe("Animal");
    });

    it("should return empty array for no classes", () => {
      const ast: AST = {
        type: "Program",
        body: [],
        sourceType: "module",
        range: makeRange(1, 1),
        language: "typescript",
      };
      const classes = parser.extractClasses(ast);
      expect(classes).toHaveLength(0);
    });
  });

  describe("extractImports", () => {
    it("should extract imports from AST", () => {
      const ast: AST = {
        type: "Program",
        body: [makeImportNode("lodash", [{ name: "map" }])],
        sourceType: "module",
        range: makeRange(1, 1),
        language: "typescript",
      };
      const imports = parser.extractImports(ast);
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe("lodash");
    });

    it("should detect type-only imports", () => {
      const ast: AST = {
        type: "Program",
        body: [makeImportNode("foo", [], { isTypeOnly: true })],
        sourceType: "module",
        range: makeRange(1, 1),
        language: "typescript",
      };
      const imports = parser.extractImports(ast);
      expect(imports[0].isTypeOnly).toBe(true);
    });

    it("should return empty array for no imports", () => {
      const ast: AST = {
        type: "Program",
        body: [],
        sourceType: "module",
        range: makeRange(1, 1),
        language: "typescript",
      };
      const imports = parser.extractImports(ast);
      expect(imports).toHaveLength(0);
    });
  });

  describe("getComplexity", () => {
    it("should return base complexity of 1 for simple node", () => {
      const node = makeFunctionNode("simple");
      const complexity = parser.getComplexity(node);
      expect(complexity.cyclomatic).toBeGreaterThanOrEqual(1);
    });

    it("should increase complexity for branching nodes", () => {
      const node: ASTNode = {
        type: "FunctionDeclaration",
        kind: "function",
        name: "complex",
        range: makeRange(1, 10),
        body: [
          { type: "IfStatement", range: makeRange(2, 5) },
          { type: "ForStatement", range: makeRange(6, 9) },
        ],
      };
      const complexity = parser.getComplexity(node);
      expect(complexity.cyclomatic).toBeGreaterThan(1);
    });

    it("should calculate cognitive complexity", () => {
      const node: ASTNode = {
        type: "IfStatement",
        range: makeRange(1, 1),
        body: [
          { type: "IfStatement", range: makeRange(2, 2) },
        ],
      };
      const complexity = parser.getComplexity(node);
      expect(complexity.cognitive).toBeGreaterThan(0);
    });

    it("should track nesting depth", () => {
      const node: ASTNode = {
        type: "IfStatement",
        range: makeRange(1, 1),
        body: [
          {
            type: "IfStatement",
            range: makeRange(2, 2),
            body: [
              { type: "IfStatement", range: makeRange(3, 3) },
            ],
          },
        ],
      };
      const complexity = parser.getComplexity(node);
      expect(complexity.nestingDepth).toBeGreaterThanOrEqual(2);
    });

    it("should count lines of code", () => {
      const node = makeFunctionNode("fn", { range: makeRange(1, 20) });
      const complexity = parser.getComplexity(node);
      expect(complexity.linesOfCode).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// 2. DependencyGraph Tests
// ============================================================

describe("DependencyGraph", () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  afterEach(() => {
    graph.clear();
  });

  describe("addNode", () => {
    it("should add a node to the graph", () => {
      graph.addNode("a", { name: "ModuleA", type: "module" });
      expect(graph.hasNode("a")).toBe(true);
      expect(graph.size).toBe(1);
    });

    it("should throw when adding duplicate node", () => {
      graph.addNode("a", { name: "ModuleA", type: "module" });
      expect(() => graph.addNode("a", { name: "ModuleA", type: "module" })).toThrow();
    });

    it("should add multiple nodes", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addNode("c", { name: "C", type: "module" });
      expect(graph.size).toBe(3);
    });
  });

  describe("addEdge", () => {
    it("should add an edge between two nodes", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addEdge("a", "b", "imports");
      expect(graph.getDependencies("a")).toContain("b");
      expect(graph.getDependents("b")).toContain("a");
    });

    it("should throw when source node does not exist", () => {
      expect(() => graph.addEdge("nonexistent", "b", "imports")).toThrow();
    });

    it("should throw when target node does not exist", () => {
      graph.addNode("a", { name: "A", type: "module" });
      expect(() => graph.addEdge("a", "nonexistent", "imports")).toThrow();
    });

    it("should track edge count", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addEdge("a", "b", "imports");
      expect(graph.edgeCount).toBe(1);
    });
  });

  describe("getDependents", () => {
    it("should return empty array for node with no dependents", () => {
      graph.addNode("a", { name: "A", type: "module" });
      expect(graph.getDependents("a")).toEqual([]);
    });

    it("should return all dependents of a node", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addNode("c", { name: "C", type: "module" });
      graph.addEdge("b", "a", "imports");
      graph.addEdge("c", "a", "imports");
      expect(graph.getDependents("a")).toHaveLength(2);
    });

    it("should return empty array for nonexistent node", () => {
      expect(graph.getDependents("nonexistent")).toEqual([]);
    });
  });

  describe("getDependencies", () => {
    it("should return empty array for node with no dependencies", () => {
      graph.addNode("a", { name: "A", type: "module" });
      expect(graph.getDependencies("a")).toEqual([]);
    });

    it("should return all dependencies of a node", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addNode("c", { name: "C", type: "module" });
      graph.addEdge("a", "b", "imports");
      graph.addEdge("a", "c", "imports");
      expect(graph.getDependencies("a")).toHaveLength(2);
    });
  });

  describe("detectCircularDeps", () => {
    it("should detect no cycles in acyclic graph", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addNode("c", { name: "C", type: "module" });
      graph.addEdge("a", "b", "imports");
      graph.addEdge("b", "c", "imports");
      expect(graph.detectCircularDeps()).toHaveLength(0);
    });

    it("should detect simple circular dependency", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addEdge("a", "b", "imports");
      graph.addEdge("b", "a", "imports");
      const cycles = graph.detectCircularDeps();
      expect(cycles.length).toBeGreaterThan(0);
    });

    it("should detect three-node cycle", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addNode("c", { name: "C", type: "module" });
      graph.addEdge("a", "b", "imports");
      graph.addEdge("b", "c", "imports");
      graph.addEdge("c", "a", "imports");
      const cycles = graph.detectCircularDeps();
      expect(cycles.length).toBeGreaterThan(0);
    });

    it("should return empty array for empty graph", () => {
      expect(graph.detectCircularDeps()).toHaveLength(0);
    });
  });

  describe("topologicalSort", () => {
    it("should sort acyclic graph", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addNode("c", { name: "C", type: "module" });
      graph.addEdge("a", "b", "imports");
      graph.addEdge("b", "c", "imports");
      const order = graph.topologicalSort();
      expect(order.flat).toContain("a");
      expect(order.flat).toContain("b");
      expect(order.flat).toContain("c");
      // a should come before b, b before c
      expect(order.flat.indexOf("a")).toBeLessThan(order.flat.indexOf("b"));
      expect(order.flat.indexOf("b")).toBeLessThan(order.flat.indexOf("c"));
    });

    it("should throw for cyclic graph", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addEdge("a", "b", "imports");
      graph.addEdge("b", "a", "imports");
      expect(() => graph.topologicalSort()).toThrow();
    });

    it("should handle single node", () => {
      graph.addNode("a", { name: "A", type: "module" });
      const order = graph.topologicalSort();
      expect(order.flat).toEqual(["a"]);
    });

    it("should return layers", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addEdge("a", "b", "imports");
      const order = graph.topologicalSort();
      expect(order.layers.length).toBeGreaterThan(0);
    });
  });

  describe("getCriticalPath", () => {
    it("should find critical path in linear graph", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addEdge("a", "b", "imports", 5);
      const path = graph.getCriticalPath();
      expect(path.path.length).toBeGreaterThan(0);
    });

    it("should return empty for empty graph", () => {
      const path = graph.getCriticalPath();
      expect(path.path).toHaveLength(0);
    });

    it("should identify bottleneck nodes", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addNode("c", { name: "C", type: "module" });
      graph.addEdge("a", "b", "imports");
      graph.addEdge("a", "c", "imports");
      const path = graph.getCriticalPath();
      expect(path.bottleneckNodes.length).toBeGreaterThan(0);
    });
  });

  describe("removeNode", () => {
    it("should remove a node and its edges", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addEdge("a", "b", "imports");
      graph.removeNode("a");
      expect(graph.hasNode("a")).toBe(false);
      expect(graph.edgeCount).toBe(0);
    });

    it("should return false for nonexistent node", () => {
      expect(graph.removeNode("nonexistent")).toBe(false);
    });
  });

  describe("clear", () => {
    it("should clear all nodes and edges", () => {
      graph.addNode("a", { name: "A", type: "module" });
      graph.addNode("b", { name: "B", type: "module" });
      graph.addEdge("a", "b", "imports");
      graph.clear();
      expect(graph.size).toBe(0);
      expect(graph.edgeCount).toBe(0);
    });
  });
});

// ============================================================
// 3. PatternDetector Tests
// ============================================================

describe("PatternDetector", () => {
  let detector: PatternDetector;

  beforeEach(() => {
    detector = new PatternDetector();
  });

  describe("detectSingleton", () => {
    it("should detect singleton pattern", () => {
      const ast = makeProgram([
        makeClassNode("Database", {
          properties: [
            { type: "Property", name: "instance", isStatic: true, isPrivate: true, isProtected: false, isReadonly: false },
          ],
          methods: [
            { type: "FunctionDeclaration", kind: "function", name: "getInstance", isStatic: true, range: makeRange(5, 8) },
          ],
        }),
      ]);
      const result = detector.detectSingleton(ast);
      expect(result).not.toBeNull();
      expect(result!.className).toBe("Database");
      expect(result!.confidence).toBeGreaterThan(0.3);
    });

    it("should return null when no singleton is found", () => {
      const ast = makeProgram([makeClassNode("RegularClass")]);
      const result = detector.detectSingleton(ast);
      expect(result).toBeNull();
    });

    it("should return null for empty AST", () => {
      const ast = makeProgram([]);
      const result = detector.detectSingleton(ast);
      expect(result).toBeNull();
    });
  });

  describe("detectFactory", () => {
    it("should detect factory pattern with create methods", () => {
      const ast = makeProgram([
        makeClassNode("VehicleFactory", {
          methods: [
            { type: "FunctionDeclaration", kind: "function", name: "createCar", isStatic: true, returnType: "Car", range: makeRange(5, 8) },
            { type: "FunctionDeclaration", kind: "function", name: "createTruck", isStatic: true, returnType: "Truck", range: makeRange(9, 12) },
          ],
        }),
      ]);
      const result = detector.detectFactory(ast);
      expect(result).not.toBeNull();
      expect(result!.factoryClassName).toBe("VehicleFactory");
    });

    it("should return null when no factory is found", () => {
      const ast = makeProgram([makeClassNode("RegularClass")]);
      const result = detector.detectFactory(ast);
      expect(result).toBeNull();
    });
  });

  describe("detectObserver", () => {
    it("should detect observer pattern with subscribe/notify", () => {
      const ast = makeProgram([
        makeClassNode("EventEmitter", {
          properties: [
            { type: "Property", name: "listeners", isStatic: false, isPrivate: false, isProtected: false, isReadonly: false },
          ],
          methods: [
            { type: "FunctionDeclaration", kind: "function", name: "subscribe", isStatic: false, range: makeRange(5, 8) },
            { type: "FunctionDeclaration", kind: "function", name: "notify", isStatic: false, range: makeRange(9, 12) },
          ],
        }),
      ]);
      const result = detector.detectObserver(ast);
      expect(result).not.toBeNull();
      expect(result!.subjectName).toBe("EventEmitter");
    });

    it("should return null when no observer is found", () => {
      const ast = makeProgram([makeClassNode("SimpleClass")]);
      const result = detector.detectObserver(ast);
      expect(result).toBeNull();
    });
  });

  describe("detectStrategy", () => {
    it("should detect strategy pattern", () => {
      const ast = makeProgram([
        { type: "InterfaceDeclaration", kind: "interface", name: "SortStrategy", members: [
          { type: "Property", name: "execute", type: "void" },
        ], range: makeRange(1, 5) },
        makeClassNode("QuickSort", { implementedInterfaces: ["SortStrategy"] }),
        makeClassNode("MergeSort", { implementedInterfaces: ["SortStrategy"] }),
        makeClassNode("Sorter", {
          properties: [
            { type: "Property", name: "strategy", type: "SortStrategy", isStatic: false, isPrivate: false, isProtected: false, isReadonly: false },
          ],
        }),
      ]);
      const result = detector.detectStrategy(ast);
      expect(result).not.toBeNull();
      expect(result!.strategyInterface).toBe("SortStrategy");
      expect(result!.concreteStrategies.length).toBeGreaterThan(0);
    });

    it("should return null when no strategy is found", () => {
      const ast = makeProgram([makeClassNode("NoStrategy")]);
      const result = detector.detectStrategy(ast);
      expect(result).toBeNull();
    });
  });

  describe("detectDecorator", () => {
    it("should detect decorator pattern", () => {
      const ast = makeProgram([
        makeClassNode("Coffee", {}),
        makeClassNode("MilkDecorator", {
          superClass: "Coffee",
          properties: [
            { type: "Property", name: "component", type: "Coffee", isStatic: false, isPrivate: false, isProtected: false, isReadonly: false },
          ],
        }),
      ]);
      const result = detector.detectDecorator(ast);
      expect(result).not.toBeNull();
      expect(result!.componentType).toBe("Coffee");
    });

    it("should return null when no decorator is found", () => {
      const ast = makeProgram([makeClassNode("Standalone")]);
      const result = detector.detectDecorator(ast);
      expect(result).toBeNull();
    });
  });

  describe("detectPatterns", () => {
    it("should detect multiple patterns", () => {
      const ast = makeProgram([
        makeClassNode("Database", {
          properties: [
            { type: "Property", name: "instance", isStatic: true, isPrivate: true, isProtected: false, isReadonly: false },
          ],
          methods: [
            { type: "FunctionDeclaration", kind: "function", name: "getInstance", isStatic: true, range: makeRange(5, 8) },
          ],
        }),
        makeClassNode("VehicleFactory", {
          methods: [
            { type: "FunctionDeclaration", kind: "function", name: "createCar", isStatic: true, returnType: "Car", range: makeRange(15, 18) },
          ],
        }),
      ]);
      const patterns = detector.detectPatterns(ast);
      expect(patterns.length).toBeGreaterThanOrEqual(2);
    });

    it("should return empty array for empty AST", () => {
      const patterns = detector.detectPatterns(makeProgram([]));
      expect(patterns).toHaveLength(0);
    });

    it("should sort patterns by confidence descending", () => {
      const ast = makeProgram([
        makeClassNode("DB", {
          properties: [
            { type: "Property", name: "instance", isStatic: true, isPrivate: true, isProtected: false, isReadonly: false },
          ],
          methods: [
            { type: "FunctionDeclaration", kind: "function", name: "getInstance", isStatic: true, range: makeRange(5, 8) },
          ],
        }),
      ]);
      const patterns = detector.detectPatterns(ast);
      for (let i = 1; i < patterns.length; i++) {
        expect(patterns[i - 1].confidence).toBeGreaterThanOrEqual(patterns[i].confidence);
      }
    });
  });
});

// ============================================================
// 4. CodeSmellAnalyzer Tests
// ============================================================

describe("CodeSmellAnalyzer", () => {
  let analyzer: CodeSmellAnalyzer;

  beforeEach(() => {
    analyzer = new CodeSmellAnalyzer();
  });

  describe("detectLongMethods", () => {
    it("should detect methods exceeding threshold", () => {
      const ast = makeProgram([
        makeFunctionNode("longMethod", { range: makeRange(1, 50) }),
      ]);
      const smells = analyzer.detectLongMethods(ast, 30);
      expect(smells.length).toBeGreaterThan(0);
      expect(smells[0].type).toBe("long_method");
    });

    it("should not flag methods under threshold", () => {
      const ast = makeProgram([
        makeFunctionNode("shortMethod", { range: makeRange(1, 10) }),
      ]);
      const smells = analyzer.detectLongMethods(ast, 30);
      expect(smells).toHaveLength(0);
    });

    it("should use custom threshold", () => {
      const ast = makeProgram([
        makeFunctionNode("mediumMethod", { range: makeRange(1, 15) }),
      ]);
      const smells = analyzer.detectLongMethods(ast, 10);
      expect(smells.length).toBeGreaterThan(0);
    });

    it("should return empty for empty AST", () => {
      const smells = analyzer.detectLongMethods(makeProgram([]));
      expect(smells).toHaveLength(0);
    });

    it("should assign severity based on excess", () => {
      const ast = makeProgram([
        makeFunctionNode("veryLong", { range: makeRange(1, 100) }),
      ]);
      const smells = analyzer.detectLongMethods(ast, 10);
      expect(["high", "critical"]).toContain(smells[0].severity);
    });
  });

  describe("detectGodClasses", () => {
    it("should detect god class with many methods", () => {
      const methods = Array.from({ length: 15 }, (_, i) =>
        makeFunctionNode(`method${i}`, { range: makeRange(i + 2, i + 5) })
      );
      const ast = makeProgram([
        makeClassNode("GodClass", { methods }),
      ]);
      const smells = analyzer.detectGodClasses(ast);
      expect(smells.length).toBeGreaterThan(0);
      expect(smells[0].type).toBe("god_class");
    });

    it("should not flag normal classes", () => {
      const ast = makeProgram([
        makeClassNode("NormalClass", {
          methods: [makeFunctionNode("doStuff")],
          properties: [{ type: "Property", name: "x", isStatic: false, isPrivate: false, isProtected: false, isReadonly: false }],
        }),
      ]);
      const smells = analyzer.detectGodClasses(ast);
      expect(smells).toHaveLength(0);
    });

    it("should return empty for empty AST", () => {
      expect(analyzer.detectGodClasses(makeProgram([]))).toHaveLength(0);
    });
  });

  describe("detectFeatureEnvy", () => {
    it("should detect feature envy when foreign calls exceed self calls", () => {
      const ast = makeProgram([
        makeClassNode("MyClass", {
          methods: [
            makeFunctionNode("envyMethod", { foreignCalls: 8, selfCalls: 1 }),
          ],
        }),
      ]);
      const smells = analyzer.detectFeatureEnvy(ast);
      expect(smells.length).toBeGreaterThan(0);
      expect(smells[0].type).toBe("feature_envy");
    });

    it("should not flag methods that use mostly own class", () => {
      const ast = makeProgram([
        makeClassNode("MyClass", {
          methods: [
            makeFunctionNode("goodMethod", { foreignCalls: 1, selfCalls: 10 }),
          ],
        }),
      ]);
      const smells = analyzer.detectFeatureEnvy(ast);
      expect(smells).toHaveLength(0);
    });
  });

  describe("detectShotgunSurgery", () => {
    it("should detect shotgun surgery across files", () => {
      const commonAst = makeProgram([
        makeImportNode("shared-module"),
        makeClassNode("Handler"),
      ]);
      const files = [
        { filePath: "a.ts", ast: commonAst },
        { filePath: "b.ts", ast: commonAst },
        { filePath: "c.ts", ast: commonAst },
      ];
      const result = analyzer.detectShotgunSurgery(files);
      expect(result.affectedFiles.length).toBeGreaterThan(0);
    });

    it("should return low severity for no files", () => {
      const result = analyzer.detectShotgunSurgery([]);
      expect(result.severity).toBe("low");
    });
  });

  describe("detectDeadCode", () => {
    it("should detect unused functions", () => {
      const ast = makeProgram([
        makeFunctionNode("unusedFunction"),
      ]);
      const usageMap = new Map<string, number>([["unusedFunction", 0]]);
      const smells = analyzer.detectDeadCode(ast, usageMap);
      expect(smells.length).toBeGreaterThan(0);
      expect(smells[0].type).toBe("dead_code");
    });

    it("should not flag used functions", () => {
      const ast = makeProgram([
        makeFunctionNode("usedFunction"),
      ]);
      const usageMap = new Map<string, number>([["usedFunction", 5]]);
      const smells = analyzer.detectDeadCode(ast, usageMap);
      expect(smells).toHaveLength(0);
    });

    it("should detect unused classes", () => {
      const ast = makeProgram([
        makeClassNode("UnusedClass"),
      ]);
      const usageMap = new Map<string, number>([["UnusedClass", 0]]);
      const smells = analyzer.detectDeadCode(ast, usageMap);
      expect(smells.some((s) => s.description.includes("Class"))).toBe(true);
    });
  });

  describe("detectMagicNumbers", () => {
    it("should detect magic numbers", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 5),
        declarations: [
          { type: "NumericLiteral", kind: "number", value: 42, range: makeRange(1, 1) },
          { type: "NumericLiteral", kind: "number", value: 86400, range: makeRange(2, 2) },
        ],
      };
      const smells = analyzer.detectMagicNumbers(ast);
      expect(smells.length).toBeGreaterThan(0);
    });

    it("should not flag common numbers like 0, 1, 100", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 3),
        declarations: [
          { type: "NumericLiteral", kind: "number", value: 0, range: makeRange(1, 1) },
          { type: "NumericLiteral", kind: "number", value: 1, range: makeRange(2, 2) },
          { type: "NumericLiteral", kind: "number", value: 100, range: makeRange(3, 3) },
        ],
      };
      const smells = analyzer.detectMagicNumbers(ast);
      expect(smells).toHaveLength(0);
    });
  });

  describe("analyzeSmells", () => {
    it("should return ranked list of smells", () => {
      const code = "const x = 42\nfunction longFn() {\n  // many lines\n}";
      const smells = analyzer.analyzeSmells(code);
      expect(Array.isArray(smells)).toBe(true);
    });

    it("should handle empty code", () => {
      const smells = analyzer.analyzeSmells("");
      expect(Array.isArray(smells)).toBe(true);
    });
  });
});

// ============================================================
// 5. TypeInference Tests
// ============================================================

describe("TypeInference", () => {
  let inference: TypeInference;

  beforeEach(() => {
    inference = new TypeInference();
  });

  describe("inferReturnType", () => {
    it("should infer void for empty body", () => {
      const funcNode = makeFunctionNode("empty", { body: [] });
      const result = inference.inferReturnType(funcNode);
      expect(result.type).toBe("void");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should use explicit return type annotation", () => {
      const funcNode = makeFunctionNode("typed", { returnType: "number" });
      const result = inference.inferReturnType(funcNode);
      expect(result.type).toBe("number");
      expect(result.confidence).toBe(1.0);
    });

    it("should detect nullable from union return type", () => {
      const funcNode = makeFunctionNode("nullable", { returnType: "string | null" });
      const result = inference.inferReturnType(funcNode);
      expect(result.isNullable).toBe(true);
    });

    it("should detect generic return types", () => {
      const funcNode = makeFunctionNode("generic", { returnType: "Array<string>" });
      const result = inference.inferReturnType(funcNode);
      expect(result.isGeneric).toBe(true);
      expect(result.genericParams).toContain("string");
    });

    it("should infer from return statements in body", () => {
      const funcNode: ASTNode = {
        type: "FunctionDeclaration",
        kind: "function",
        name: "returnsNum",
        returnType: undefined,
        body: [
          { type: "ReturnStatement", kind: "return", argument: { type: "NumericLiteral" }, range: makeRange(2, 2) },
        ],
        range: makeRange(1, 3),
      };
      const result = inference.inferReturnType(funcNode);
      expect(result.type).toContain("number");
    });
  });

  describe("inferParameterTypes", () => {
    it("should use annotated parameter types", () => {
      const funcNode = makeFunctionNode("typed", {
        parameters: [{ name: "x", type: "number" }, { name: "y", type: "string" }],
      });
      const usageContext = new Map<string, string[]>();
      const results = inference.inferParameterTypes(funcNode, usageContext);
      expect(results).toHaveLength(2);
      expect(results[0].inferredType).toBe("number");
      expect(results[0].confidence).toBe(1.0);
    });

    it("should infer from usage context when untyped", () => {
      const funcNode = makeFunctionNode("untyped", {
        parameters: [{ name: "data" }],
      });
      const usageContext = new Map<string, string[]>([
        ["data", [".push(", ".length", ".map("]],
      ]);
      const results = inference.inferParameterTypes(funcNode, usageContext);
      expect(results).toHaveLength(1);
      expect(results[0].inferredType).not.toBe("unknown");
    });

    it("should return unknown for parameters with no context", () => {
      const funcNode = makeFunctionNode("noContext", {
        parameters: [{ name: "x" }],
      });
      const usageContext = new Map<string, string[]>();
      const results = inference.inferParameterTypes(funcNode, usageContext);
      expect(results[0].inferredType).toBe("unknown");
    });
  });

  describe("inferVariableType", () => {
    it("should infer type from value", () => {
      const varNode: ASTNode = { type: "VariableDeclaration", name: "x", range: makeRange(1, 1) };
      const assignments = [{ value: "'hello'", type: undefined, line: 1, context: "init" }];
      const result = inference.inferVariableType(varNode, assignments);
      expect(result.type).toBe("string");
    });

    it("should infer number from numeric value", () => {
      const varNode: ASTNode = { type: "VariableDeclaration", name: "x", range: makeRange(1, 1) };
      const assignments = [{ value: "42", type: undefined, line: 1, context: "init" }];
      const result = inference.inferVariableType(varNode, assignments);
      expect(result.type).toBe("number");
    });

    it("should return undefined for no assignments", () => {
      const varNode: ASTNode = { type: "VariableDeclaration", name: "x", range: makeRange(1, 1) };
      const result = inference.inferVariableType(varNode, []);
      expect(result.type).toBe("undefined");
    });

    it("should create union type for multiple assignment types", () => {
      const varNode: ASTNode = { type: "VariableDeclaration", name: "x", range: makeRange(1, 1) };
      const assignments = [
        { value: "'hello'", type: undefined, line: 1, context: "init" },
        { value: "42", type: undefined, line: 3, context: "reassign" },
      ];
      const result = inference.inferVariableType(varNode, assignments);
      expect(result.type).toContain("string");
      expect(result.type).toContain("number");
    });
  });

  describe("inferGenericType", () => {
    it("should detect annotated generic types", () => {
      const classNode = makeClassNode("Container", { typeParameters: ["T", "U"] });
      const result = inference.inferGenericType(classNode);
      expect(result.isGeneric).toBe(true);
      expect(result.genericParams).toEqual(["T", "U"]);
    });

    it("should infer generic from usage patterns", () => {
      const classNode = makeClassNode("Box", {
        methods: [
          makeFunctionNode("get", { returnType: "T" }),
          makeFunctionNode("set", {
            parameters: [{ name: "value", type: "T" }],
          }),
        ],
      });
      const result = inference.inferGenericType(classNode);
      expect(result.isGeneric).toBe(true);
    });

    it("should return non-generic for concrete class", () => {
      const classNode = makeClassNode("Concrete", {
        methods: [makeFunctionNode("doStuff", { returnType: "void" })],
      });
      const result = inference.inferGenericType(classNode);
      expect(result.isGeneric).toBe(false);
    });
  });

  describe("analyzeFile", () => {
    it("should analyze variable declarations", () => {
      const source = 'const name: string = "hello";';
      const result = inference.analyzeFile(source);
      expect(result.types.has("name")).toBe(true);
      expect(result.types.get("name")!.type).toBe("string");
    });

    it("should analyze function declarations", () => {
      const source = "function add(a: number, b: number): number { return a + b; }";
      const result = inference.analyzeFile(source);
      expect(result.functionReturnTypes.has("add")).toBe(true);
    });

    it("should infer types from values without annotations", () => {
      const source = 'const x = 42;';
      const result = inference.analyzeFile(source);
      expect(result.types.has("x")).toBe(true);
      expect(result.types.get("x")!.type).toBe("number");
    });

    it("should handle empty source", () => {
      const result = inference.analyzeFile("");
      expect(result.types.size).toBe(0);
    });

    it("should calculate overall confidence", () => {
      const source = 'const x: number = 5;\nfunction fn(a: string): boolean { return true; }';
      const result = inference.analyzeFile(source);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });
});

// ============================================================
// 6. MutationTester Tests
// ============================================================

describe("MutationTester", () => {
  let tester: MutationTester;

  beforeEach(() => {
    tester = new MutationTester();
  });

  describe("generateMutations", () => {
    it("should generate arithmetic operator mutations", () => {
      const ast: ASTNode = {
        type: "BinaryExpression",
        operator: "+",
        range: makeRange(1, 1),
        left: { type: "Identifier", name: "a", range: makeRange(1, 1) },
        right: { type: "Identifier", name: "b", range: makeRange(1, 1) },
      };
      const mutations = tester.generateMutations(ast);
      const arithmeticMutations = mutations.filter((m) => m.type === "arithmetic_operator");
      expect(arithmeticMutations.length).toBeGreaterThan(0);
    });

    it("should generate logical operator mutations", () => {
      const ast: ASTNode = {
        type: "BinaryExpression",
        operator: "&&",
        range: makeRange(1, 1),
        left: { type: "Identifier", name: "a", range: makeRange(1, 1) },
        right: { type: "Identifier", name: "b", range: makeRange(1, 1) },
      };
      const mutations = tester.generateMutations(ast);
      const logicalMutations = mutations.filter((m) => m.type === "logical_operator");
      expect(logicalMutations.length).toBeGreaterThan(0);
    });

    it("should generate conditional boundary mutations", () => {
      const ast: ASTNode = {
        type: "BinaryExpression",
        operator: ">",
        range: makeRange(1, 1),
        left: { type: "Identifier", name: "x", range: makeRange(1, 1) },
        right: { type: "NumericLiteral", value: 5, range: makeRange(1, 1) },
      };
      const mutations = tester.generateMutations(ast);
      const boundaryMutations = mutations.filter((m) => m.type === "conditional_boundary");
      expect(boundaryMutations.length).toBeGreaterThan(0);
    });

    it("should generate boolean literal mutations", () => {
      const ast: ASTNode = {
        type: "BooleanLiteral",
        value: true,
        range: makeRange(1, 1),
      };
      const mutations = tester.generateMutations(ast);
      const boolMutations = mutations.filter((m) => m.type === "boolean_literal");
      expect(boolMutations.length).toBe(1);
      expect(boolMutations[0].replacement).toBe("false");
    });

    it("should generate string literal mutations", () => {
      const ast: ASTNode = {
        type: "StringLiteral",
        value: "hello",
        range: makeRange(1, 1),
      };
      const mutations = tester.generateMutations(ast);
      const strMutations = mutations.filter((m) => m.type === "string_literal");
      expect(strMutations.length).toBeGreaterThan(0);
    });

    it("should generate negate conditional mutations for if statements", () => {
      const ast: ASTNode = {
        type: "IfStatement",
        range: makeRange(1, 5),
        test: { type: "Identifier", name: "x", range: makeRange(1, 1) },
        consequent: { type: "BlockStatement", body: [], range: makeRange(2, 4) },
      };
      const mutations = tester.generateMutations(ast);
      const negateMutations = mutations.filter((m) => m.type === "negate_conditionals");
      expect(negateMutations.length).toBeGreaterThan(0);
    });

    it("should return empty for simple nodes with no mutations", () => {
      const ast: ASTNode = { type: "Identifier", name: "x", range: makeRange(1, 1) };
      const mutations = tester.generateMutations(ast);
      expect(mutations).toHaveLength(0);
    });

    it("should generate mutations in nested structures", () => {
      const ast: ASTNode = {
        type: "IfStatement",
        range: makeRange(1, 10),
        test: {
          type: "BinaryExpression",
          operator: ">",
          range: makeRange(1, 1),
          left: { type: "Identifier", name: "x", range: makeRange(1, 1) },
          right: { type: "NumericLiteral", value: 5, range: makeRange(1, 1) },
        },
        consequent: {
          type: "BlockStatement",
          body: [
            {
              type: "ReturnStatement",
              range: makeRange(3, 3),
              argument: { type: "BooleanLiteral", value: true, range: makeRange(3, 3) },
            },
          ],
          range: makeRange(2, 4),
        },
      };
      const mutations = tester.generateMutations(ast);
      expect(mutations.length).toBeGreaterThan(1);
    });
  });

  describe("applyMutation", () => {
    it("should apply arithmetic mutation to AST", () => {
      const ast: ASTNode = {
        type: "BinaryExpression",
        operator: "+",
        range: makeRange(1, 1),
        left: { type: "Identifier", name: "a", range: makeRange(1, 1) },
        right: { type: "Identifier", name: "b", range: makeRange(1, 1) },
      };
      const mutation = {
        id: "mut_1",
        type: "arithmetic_operator" as const,
        description: "Replace '+' with '-'",
        original: "+",
        replacement: "-",
        lineNumber: 1,
      };
      const mutated = tester.applyMutation(ast, mutation);
      expect(mutated.operator).toBe("-");
    });

    it("should apply boolean mutation", () => {
      const ast: ASTNode = {
        type: "BooleanLiteral",
        value: true,
        range: makeRange(1, 1),
      };
      const mutation = {
        id: "mut_1",
        type: "boolean_literal" as const,
        description: "Replace 'true' with 'false'",
        original: "true",
        replacement: "false",
        lineNumber: 1,
      };
      const mutated = tester.applyMutation(ast, mutation);
      expect(mutated.value).toBe(false);
    });

    it("should not modify original AST", () => {
      const ast: ASTNode = {
        type: "BinaryExpression",
        operator: "+",
        range: makeRange(1, 1),
        left: { type: "Identifier", name: "a", range: makeRange(1, 1) },
        right: { type: "Identifier", name: "b", range: makeRange(1, 1) },
      };
      const mutation = {
        id: "mut_1",
        type: "arithmetic_operator" as const,
        description: "Replace '+' with '-'",
        original: "+",
        replacement: "-",
        lineNumber: 1,
      };
      tester.applyMutation(ast, mutation);
      expect(ast.operator).toBe("+");
    });
  });

  describe("testMutation", () => {
    it("should return killed when test fails", async () => {
      const testRunner = async () => ({ passed: false, duration: 10 });
      const result = await tester.testMutation("original", "mutated", testRunner);
      expect(result.status).toBe("killed");
    });

    it("should return survived when test passes", async () => {
      const testRunner = async () => ({ passed: true, duration: 10 });
      const result = await tester.testMutation("original", "mutated", testRunner);
      expect(result.status).toBe("survived");
    });

    it("should return error when test runner throws", async () => {
      const testRunner = async () => { throw new Error("test error"); };
      const result = await tester.testMutation("original", "mutated", testRunner);
      expect(result.status).toBe("error");
      expect(result.errorMessage).toBeDefined();
    });

    it("should record duration", async () => {
      const testRunner = async () => ({ passed: false, duration: 5 });
      const result = await tester.testMutation("original", "mutated", testRunner);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("calculateMutationScore", () => {
    it("should calculate 100% score when all killed", () => {
      const results = {
        mutations: [],
        totalMutations: 10,
        killed: 10,
        survived: 0,
        timeout: 0,
        errors: 0,
        score: 100,
        duration: 1000,
      };
      expect(tester.calculateMutationScore(results)).toBe(100);
    });

    it("should calculate 0% score when none killed", () => {
      const results = {
        mutations: [],
        totalMutations: 10,
        killed: 0,
        survived: 10,
        timeout: 0,
        errors: 0,
        score: 0,
        duration: 1000,
      };
      expect(tester.calculateMutationScore(results)).toBe(0);
    });

    it("should handle zero mutations", () => {
      const results = {
        mutations: [],
        totalMutations: 0,
        killed: 0,
        survived: 0,
        timeout: 0,
        errors: 0,
        score: 100,
        duration: 0,
      };
      expect(tester.calculateMutationScore(results)).toBe(100);
    });

    it("should calculate partial score", () => {
      const results = {
        mutations: [],
        totalMutations: 4,
        killed: 3,
        survived: 1,
        timeout: 0,
        errors: 0,
        score: 75,
        duration: 500,
      };
      expect(tester.calculateMutationScore(results)).toBe(75);
    });
  });

  describe("getSurvivingMutants", () => {
    it("should filter surviving mutants", () => {
      const results = {
        mutations: [
          { mutation: { id: "1", type: "arithmetic_operator" as const, description: "", original: "", replacement: "", lineNumber: 0 }, status: "survived" as const, duration: 10 },
          { mutation: { id: "2", type: "arithmetic_operator" as const, description: "", original: "", replacement: "", lineNumber: 0 }, status: "killed" as const, duration: 10 },
          { mutation: { id: "3", type: "arithmetic_operator" as const, description: "", original: "", replacement: "", lineNumber: 0 }, status: "survived" as const, duration: 10 },
        ],
        totalMutations: 3,
        killed: 1,
        survived: 2,
        timeout: 0,
        errors: 0,
        score: 33,
        duration: 30,
      };
      const surviving = tester.getSurvivingMutants(results);
      expect(surviving).toHaveLength(2);
    });

    it("should return empty for no survivors", () => {
      const results = {
        mutations: [],
        totalMutations: 5,
        killed: 5,
        survived: 0,
        timeout: 0,
        errors: 0,
        score: 100,
        duration: 50,
      };
      expect(tester.getSurvivingMutants(results)).toHaveLength(0);
    });
  });
});

// ============================================================
// 7. ImpactAnalyzer Tests
// ============================================================

describe("ImpactAnalyzer", () => {
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    analyzer = new ImpactAnalyzer();
  });

  describe("analyzeChange", () => {
    it("should detect additions", () => {
      const oldAst = makeProgram([]);
      const newAst = makeProgram([makeFunctionNode("newFunc")]);
      const changes = analyzer.analyzeChange(oldAst, newAst);
      expect(changes.some((c) => c.type === "add")).toBe(true);
    });

    it("should detect removals", () => {
      const oldAst = makeProgram([makeFunctionNode("removedFunc")]);
      const newAst = makeProgram([]);
      const changes = analyzer.analyzeChange(oldAst, newAst);
      expect(changes.some((c) => c.type === "remove")).toBe(true);
    });

    it("should detect modifications", () => {
      const oldAst = makeProgram([makeFunctionNode("modified")]);
      const newAst = makeProgram([makeFunctionNode("modified", { returnType: "number" })]);
      const changes = analyzer.analyzeChange(oldAst, newAst);
      expect(changes.some((c) => c.type === "modify")).toBe(true);
    });

    it("should return empty for identical ASTs", () => {
      const ast = makeProgram([makeFunctionNode("same")]);
      const changes = analyzer.analyzeChange(ast, ast);
      expect(changes).toHaveLength(0);
    });

    it("should detect multiple changes", () => {
      const oldAst = makeProgram([makeFunctionNode("a"), makeFunctionNode("b")]);
      const newAst = makeProgram([makeFunctionNode("a", { returnType: "void" }), makeFunctionNode("c")]);
      const changes = analyzer.analyzeChange(oldAst, newAst);
      expect(changes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("getAffectedFiles", () => {
    it("should find dependents of changed symbols", () => {
      const graph = new DependencyGraph();
      graph.addNode("moduleA", { name: "ModuleA", type: "module" });
      graph.addNode("moduleB", { name: "ModuleB", type: "module" });
      graph.addEdge("moduleB", "moduleA", "imports");

      const changeInfo = {
        type: "modify" as const,
        filePath: "moduleA.ts",
        description: "Modified ModuleA",
        changedSymbols: ["moduleA"],
      };

      const affected = analyzer.getAffectedFiles(changeInfo, graph);
      expect(affected).toContain("moduleB");
    });

    it("should include the changed file itself", () => {
      const graph = new DependencyGraph();
      graph.addNode("moduleA", { name: "ModuleA", type: "module" });

      const changeInfo = {
        type: "modify" as const,
        filePath: "moduleA.ts",
        description: "Modified ModuleA",
        changedSymbols: ["moduleA"],
      };

      const affected = analyzer.getAffectedFiles(changeInfo, graph);
      expect(affected).toContain("moduleA.ts");
    });

    it("should return only the file for isolated changes", () => {
      const graph = new DependencyGraph();
      graph.addNode("isolated", { name: "Isolated", type: "module" });

      const changeInfo = {
        type: "add" as const,
        filePath: "isolated.ts",
        description: "Added isolated module",
        changedSymbols: ["isolated"],
      };

      const affected = analyzer.getAffectedFiles(changeInfo, graph);
      expect(affected).toContain("isolated.ts");
    });
  });

  describe("estimateRisk", () => {
    it("should assign higher risk to removals", () => {
      const removeChange = {
        type: "remove" as const,
        filePath: "a.ts",
        description: "Removed something",
        changedSymbols: ["foo"],
      };
      const addChange = {
        type: "add" as const,
        filePath: "a.ts",
        description: "Added something",
        changedSymbols: ["foo"],
      };
      const removeRisk = analyzer.estimateRisk(removeChange);
      const addRisk = analyzer.estimateRisk(addChange);
      expect(removeRisk.score).toBeGreaterThan(addRisk.score);
    });

    it("should increase risk for many changed symbols", () => {
      const smallChange = {
        type: "modify" as const,
        filePath: "a.ts",
        description: "Small change",
        changedSymbols: ["a"],
      };
      const largeChange = {
        type: "modify" as const,
        filePath: "a.ts",
        description: "Large change",
        changedSymbols: ["a", "b", "c", "d", "e", "f"],
      };
      const smallRisk = analyzer.estimateRisk(smallChange);
      const largeRisk = analyzer.estimateRisk(largeChange);
      expect(largeRisk.score).toBeGreaterThan(smallRisk.score);
    });

    it("should return low risk for simple additions", () => {
      const change = {
        type: "add" as const,
        filePath: "new.ts",
        description: "Added new file",
        changedSymbols: ["NewClass"],
      };
      const risk = analyzer.estimateRisk(change);
      expect(risk.level).toBe("low");
    });

    it("should estimate blast radius", () => {
      const change = {
        type: "remove" as const,
        filePath: "a.ts",
        description: "Removed module",
        changedSymbols: ["ModuleA", "ModuleB"],
      };
      const risk = analyzer.estimateRisk(change);
      expect(risk.estimatedBlastRadius).toBeGreaterThan(0);
    });
  });

  describe("getRequiredTests", () => {
    it("should require unit tests for changed symbols", () => {
      const change = {
        type: "modify" as const,
        filePath: "a.ts",
        description: "Modified function",
        changedSymbols: ["myFunction"],
      };
      const tests = analyzer.getRequiredTests(change);
      expect(tests.some((t) => t.type === "unit" && t.priority === "must")).toBe(true);
    });

    it("should require e2e tests for removals", () => {
      const change = {
        type: "remove" as const,
        filePath: "a.ts",
        description: "Removed module",
        changedSymbols: ["OldModule"],
      };
      const tests = analyzer.getRequiredTests(change);
      expect(tests.some((t) => t.type === "e2e")).toBe(true);
    });

    it("should require integration tests for modifications", () => {
      const change = {
        type: "modify" as const,
        filePath: "a.ts",
        description: "Modified API",
        changedSymbols: ["apiMethod"],
      };
      const tests = analyzer.getRequiredTests(change);
      expect(tests.some((t) => t.type === "integration")).toBe(true);
    });
  });

  describe("generateImpactReport", () => {
    it("should generate a complete report", () => {
      const change = {
        type: "modify" as const,
        filePath: "service.ts",
        description: "Modified service method",
        changedSymbols: ["processData"],
        changedLines: { start: 10, end: 30 },
      };
      const report = analyzer.generateImpactReport(change);
      expect(report.summary).toBeDefined();
      expect(report.riskAssessment).toBeDefined();
      expect(report.requiredTests.length).toBeGreaterThan(0);
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.generatedAt).toBeDefined();
    });

    it("should provide recommendations for critical risk", () => {
      const change = {
        type: "remove" as const,
        filePath: "core.ts",
        description: "Removed core module",
        changedSymbols: ["CoreModule", "Helper", "Util"],
      };
      const report = analyzer.generateImpactReport(change);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it("should estimate effort", () => {
      const change = {
        type: "add" as const,
        filePath: "new.ts",
        description: "Added new utility",
        changedSymbols: ["util"],
      };
      const report = analyzer.generateImpactReport(change);
      expect(["minimal", "small", "moderate", "significant", "major"]).toContain(report.estimatedEffort);
    });
  });
});

// ============================================================
// 8. CloneDetector Tests
// ============================================================

describe("CloneDetector", () => {
  let detector: CloneDetector;

  beforeEach(() => {
    detector = new CloneDetector();
  });

  describe("detectType1Clones", () => {
    it("should detect exact duplicate code blocks", () => {
      const sharedCode = "const x = 1;\nconst y = 2;\nconst z = x + y;\nconsole.log(z);\nreturn z;\nconst a = 5;";
      const files = [
        { filePath: "a.ts", content: sharedCode, lines: sharedCode.split("\n") },
        { filePath: "b.ts", content: sharedCode, lines: sharedCode.split("\n") },
      ];
      const clones = detector.detectType1Clones(files);
      expect(clones.length).toBeGreaterThan(0);
      expect(clones[0].type).toBe("type1");
      expect(clones[0].similarity).toBe(1.0);
    });

    it("should not detect non-duplicate code", () => {
      const files = [
        { filePath: "a.ts", content: "const x = 1;\nconst y = 2;", lines: ["const x = 1;", "const y = 2;"] },
        { filePath: "b.ts", content: "const a = 3;\nconst b = 4;", lines: ["const a = 3;", "const b = 4;"] },
      ];
      const clones = detector.detectType1Clones(files);
      expect(clones).toHaveLength(0);
    });

    it("should return empty for single file with no duplicates", () => {
      const files = [
        { filePath: "a.ts", content: "line1\nline2\nline3", lines: ["line1", "line2", "line3"] },
      ];
      const clones = detector.detectType1Clones(files);
      expect(clones).toHaveLength(0);
    });

    it("should handle empty files", () => {
      const clones = detector.detectType1Clones([]);
      expect(clones).toHaveLength(0);
    });
  });

  describe("detectType2Clones", () => {
    it("should detect structurally similar code with renamed identifiers", () => {
      const codeA = "const x = 1;\nconst y = x + 2;\nconst z = y * 3;\nconsole.log(z);\nreturn z;\nconst a = 5;";
      const codeB = "const p = 1;\nconst q = p + 2;\nconst r = q * 3;\nconsole.log(r);\nreturn r;\nconst b = 5;";
      const files = [
        { filePath: "a.ts", content: codeA, lines: codeA.split("\n") },
        { filePath: "b.ts", content: codeB, lines: codeB.split("\n") },
      ];
      const clones = detector.detectType2Clones(files);
      expect(clones.length).toBeGreaterThan(0);
      expect(clones[0].type).toBe("type2");
    });

    it("should return empty for structurally different code", () => {
      const files = [
        { filePath: "a.ts", content: "if (x) { return 1; }", lines: ["if (x) { return 1; }"] },
        { filePath: "b.ts", content: "for (let i = 0; i < 10; i++) {}", lines: ["for (let i = 0; i < 10; i++) {}"] },
      ];
      const clones = detector.detectType2Clones(files);
      expect(clones).toHaveLength(0);
    });
  });

  describe("detectType3Clones", () => {
    it("should detect similar code with minor modifications", () => {
      const codeA = "const x = 1;\nconst y = x + 2;\nconst z = y * 3;\nconsole.log(z);\nreturn z;\nconst a = 5;";
      const codeB = "const x = 1;\nconst y = x + 3;\nconst z = y * 4;\nconsole.log(z);\nreturn z;\nconst a = 6;";
      const files = [
        { filePath: "a.ts", content: codeA, lines: codeA.split("\n") },
        { filePath: "b.ts", content: codeB, lines: codeB.split("\n") },
      ];
      const clones = detector.detectType3Clones(files);
      expect(clones.length).toBeGreaterThan(0);
      expect(clones[0].type).toBe("type3");
    });

    it("should return empty for completely different code", () => {
      const files = [
        { filePath: "a.ts", content: "aaa\nbbb\nccc\nddd\neee\nfff", lines: ["aaa", "bbb", "ccc", "ddd", "eee", "fff"] },
        { filePath: "b.ts", content: "xxx\nyyy\nzzz\n111\n222\n333", lines: ["xxx", "yyy", "zzz", "111", "222", "333"] },
      ];
      const clones = detector.detectType3Clones(files);
      expect(clones).toHaveLength(0);
    });
  });

  describe("getCloneMetrics", () => {
    it("should calculate comprehensive metrics", () => {
      const sharedCode = "const x = 1;\nconst y = 2;\nconst z = x + y;\nconsole.log(z);\nreturn z;\nconst a = 5;";
      const files = [
        { filePath: "a.ts", content: sharedCode, lines: sharedCode.split("\n") },
        { filePath: "b.ts", content: sharedCode, lines: sharedCode.split("\n") },
      ];
      const metrics = detector.getCloneMetrics(files);
      expect(metrics.totalClones).toBeGreaterThan(0);
      expect(metrics.type1Count).toBeGreaterThanOrEqual(0);
      expect(metrics.type2Count).toBeGreaterThanOrEqual(0);
      expect(metrics.type3Count).toBeGreaterThanOrEqual(0);
      expect(metrics.duplicationPercentage).toBeGreaterThanOrEqual(0);
    });

    it("should return zero metrics for empty input", () => {
      const metrics = detector.getCloneMetrics([]);
      expect(metrics.totalClones).toBe(0);
      expect(metrics.duplicationPercentage).toBe(0);
    });
  });

  describe("suggestRefactoring", () => {
    it("should suggest refactoring for detected clones", () => {
      const clones = [
        {
          type: "type1" as const,
          fragments: [
            { filePath: "a.ts", startLine: 1, endLine: 10, content: "duplicate code block" },
            { filePath: "b.ts", startLine: 5, endLine: 14, content: "duplicate code block" },
          ],
          similarity: 1.0,
          linesMatched: 10,
          totalLines: 10,
        },
      ];
      const suggestions = detector.suggestRefactoring(clones);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].type).toBeDefined();
      expect(suggestions[0].estimatedSavings).toBeGreaterThan(0);
    });

    it("should return empty for no clones", () => {
      const suggestions = detector.suggestRefactoring([]);
      expect(suggestions).toHaveLength(0);
    });

    it("should sort by priority", () => {
      const clones = [
        {
          type: "type1" as const,
          fragments: [
            { filePath: "a.ts", startLine: 1, endLine: 5, content: "small" },
            { filePath: "b.ts", startLine: 1, endLine: 5, content: "small" },
          ],
          similarity: 1.0,
          linesMatched: 5,
          totalLines: 5,
        },
        {
          type: "type1" as const,
          fragments: [
            { filePath: "a.ts", startLine: 10, endLine: 50, content: "large block of duplicated code" },
            { filePath: "b.ts", startLine: 10, endLine: 50, content: "large block of duplicated code" },
          ],
          similarity: 1.0,
          linesMatched: 40,
          totalLines: 40,
        },
      ];
      const suggestions = detector.suggestRefactoring(clones);
      expect(suggestions[0].priority).toBe("high");
    });
  });
});

// ============================================================
// 9. SecurityScanner Tests
// ============================================================

describe("SecurityScanner", () => {
  let scanner: SecurityScanner;

  beforeEach(() => {
    scanner = new SecurityScanner();
  });

  describe("scanForInjection", () => {
    it("should detect SQL injection patterns", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 5),
        declarations: [
          { type: "ExpressionStatement", range: makeRange(1, 1), expression: "query + userInput" },
        ],
      };
      const vulns = scanner.scanForInjection(ast);
      expect(vulns.length).toBeGreaterThan(0);
    });

    it("should detect command injection", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 5),
        declarations: [
          { type: "ExpressionStatement", range: makeRange(1, 1), expression: "exec(userInput)" },
        ],
      };
      const vulns = scanner.scanForInjection(ast);
      expect(vulns.some((v) => v.description.includes("Command injection"))).toBe(true);
    });

    it("should detect template literal injection", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 5),
        declarations: [
          { type: "TemplateLiteral", range: makeRange(1, 1), expression: "${userInput}" },
        ],
      };
      const vulns = scanner.scanForInjection(ast);
      expect(vulns.length).toBeGreaterThan(0);
    });

    it("should return empty for safe code", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 1),
      };
      const vulns = scanner.scanForInjection(ast);
      expect(vulns).toHaveLength(0);
    });
  });

  describe("scanForXSS", () => {
    it("should detect dangerouslySetInnerHTML", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 5),
        declarations: [
          { type: "JSXAttribute", range: makeRange(1, 1), name: "dangerouslySetInnerHTML" },
        ],
      };
      const vulns = scanner.scanForXSS(ast);
      expect(vulns.some((v) => v.description.includes("dangerouslySetInnerHTML"))).toBe(true);
    });

    it("should detect innerHTML assignment", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 5),
        declarations: [
          { type: "ExpressionStatement", range: makeRange(1, 1), expression: "innerHTML = userInput" },
        ],
      };
      const vulns = scanner.scanForXSS(ast);
      expect(vulns.length).toBeGreaterThan(0);
    });

    it("should return empty for safe code", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 1),
      };
      const vulns = scanner.scanForXSS(ast);
      expect(vulns).toHaveLength(0);
    });
  });

  describe("scanForCSRF", () => {
    it("should detect missing CSRF protection", () => {
      const ast = makeProgram([
        makeFunctionNode("postData", {
          body: [{ type: "ExpressionStatement", range: makeRange(2, 2) }],
        }),
      ]);
      const vulns = scanner.scanForCSRF(ast);
      expect(vulns.length).toBeGreaterThan(0);
    });

    it("should not flag functions with CSRF protection", () => {
      const ast = makeProgram([
        makeFunctionNode("postData", {
          body: [{ type: "ExpressionStatement", range: makeRange(2, 2), expression: "csrfToken" }],
        }),
      ]);
      const vulns = scanner.scanForCSRF(ast);
      expect(vulns).toHaveLength(0);
    });
  });

  describe("scanForInsecureDeps", () => {
    it("should detect known vulnerable packages", () => {
      const deps = [
        { name: "lodash", version: "4.17.15", isDev: false },
      ];
      const vulns = scanner.scanForInsecureDeps(deps);
      expect(vulns.length).toBeGreaterThan(0);
      expect(vulns[0].type).toBe("insecure_dependency");
    });

    it("should not flag secure package versions", () => {
      const deps = [
        { name: "lodash", version: "4.17.21", isDev: false },
      ];
      const vulns = scanner.scanForInsecureDeps(deps);
      expect(vulns).toHaveLength(0);
    });

    it("should handle empty dependency list", () => {
      expect(scanner.scanForInsecureDeps([])).toHaveLength(0);
    });

    it("should detect multiple vulnerable packages", () => {
      const deps = [
        { name: "lodash", version: "4.17.15", isDev: false },
        { name: "minimist", version: "1.2.0", isDev: true },
      ];
      const vulns = scanner.scanForInsecureDeps(deps);
      expect(vulns.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("scanForHardcodedSecrets", () => {
    it("should detect API keys", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 1),
        declarations: [
          { type: "VariableDeclaration", range: makeRange(1, 1), expression: "api_key = 'sk-1234567890abcdef'" },
        ],
      };
      const vulns = scanner.scanForHardcodedSecrets(ast);
      expect(vulns.some((v) => v.description.includes("API Key"))).toBe(true);
    });

    it("should detect passwords", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 1),
        declarations: [
          { type: "VariableDeclaration", range: makeRange(1, 1), expression: "password = 'supersecret123'" },
        ],
      };
      const vulns = scanner.scanForHardcodedSecrets(ast);
      expect(vulns.some((v) => v.description.includes("Password"))).toBe(true);
    });

    it("should detect AWS keys", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 1),
        declarations: [
          { type: "VariableDeclaration", range: makeRange(1, 1), expression: "AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE'" },
        ],
      };
      const vulns = scanner.scanForHardcodedSecrets(ast);
      expect(vulns.some((v) => v.description.includes("AWS"))).toBe(true);
    });

    it("should not flag short values", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 1),
        raw: 'const x = "ab";',
      };
      const vulns = scanner.scanForHardcodedSecrets(ast);
      expect(vulns).toHaveLength(0);
    });
  });

  describe("scanForUnsafeDeserialization", () => {
    it("should detect eval usage", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 1),
        raw: "eval(userInput)",
      };
      const vulns = scanner.scanForUnsafeDeserialization(ast);
      expect(vulns.some((v) => v.description.includes("eval"))).toBe(true);
    });

    it("should detect new Function constructor", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 1),
        raw: "new Function(userInput)",
      };
      const vulns = scanner.scanForUnsafeDeserialization(ast);
      expect(vulns.some((v) => v.description.includes("Function constructor"))).toBe(true);
    });

    it("should detect child_process usage", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 1),
        raw: "child_process.exec(userInput)",
      };
      const vulns = scanner.scanForUnsafeDeserialization(ast);
      expect(vulns.some((v) => v.description.includes("Command execution"))).toBe(true);
    });

    it("should return empty for safe code", () => {
      const ast: ASTNode = {
        type: "Program",
        body: [],
        range: makeRange(1, 1),
        raw: "const x = 1;",
      };
      const vulns = scanner.scanForUnsafeDeserialization(ast);
      expect(vulns).toHaveLength(0);
    });
  });

  describe("generateSecurityReport", () => {
    it("should generate a comprehensive report", () => {
      const code = 'const apiKey = "sk-1234567890abcdef";\neval(userInput);\ninnerHTML = data;';
      const report = scanner.generateSecurityReport(code);
      expect(report.vulnerabilities.length).toBeGreaterThan(0);
      expect(report.summary.total).toBeGreaterThan(0);
      expect(report.scannedAt).toBeDefined();
    });

    it("should return clean report for safe code", () => {
      const report = scanner.generateSecurityReport("const x = 1;\nconst y = 2;");
      expect(report.summary.score).toBe(100);
    });

    it("should calculate security score", () => {
      const code = 'eval("test");\nconst apiKey = "sk-1234567890abcdef";';
      const report = scanner.generateSecurityReport(code);
      expect(report.summary.score).toBeLessThan(100);
    });

    it("should provide recommendations", () => {
      const code = 'eval("test");';
      const report = scanner.generateSecurityReport(code);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it("should sort vulnerabilities by severity", () => {
      const code = 'eval("test");\nconst x = 1;';
      const report = scanner.generateSecurityReport(code);
      const severities = report.vulnerabilities.map((v) => v.severity);
      const order: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
      for (let i = 1; i < severities.length; i++) {
        expect(order[severities[i - 1]]).toBeGreaterThanOrEqual(order[severities[i]]);
      }
    });
  });
});

// ============================================================
// 10. MetricsCollector Tests
// ============================================================

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe("collectFileMetrics", () => {
    it("should count lines of code", () => {
      const metrics = collector.collectFileMetrics({
        filePath: "test.ts",
        content: "const a = 1;\nconst b = 2;\nconst c = 3;",
      });
      expect(metrics.linesOfCode).toBe(3);
      expect(metrics.totalLines).toBe(3);
    });

    it("should count blank lines", () => {
      const metrics = collector.collectFileMetrics({
        filePath: "test.ts",
        content: "const a = 1;\n\nconst b = 2;\n\n\nconst c = 3;",
      });
      expect(metrics.blankLines).toBe(3);
    });

    it("should count comment lines", () => {
      const metrics = collector.collectFileMetrics({
        filePath: "test.ts",
        content: "// This is a comment\nconst a = 1;\n/* block comment */\nconst b = 2;",
      });
      expect(metrics.linesOfComments).toBe(2);
    });

    it("should count imports", () => {
      const metrics = collector.collectFileMetrics({
        filePath: "test.ts",
        content: 'import { a } from "b";\nimport c from "d";\nconst x = 1;',
      });
      expect(metrics.imports).toBe(2);
    });

    it("should count exports", () => {
      const metrics = collector.collectFileMetrics({
        filePath: "test.ts",
        content: "export const a = 1;\nexport function b() {}\nconst c = 3;",
      });
      expect(metrics.exports).toBe(2);
    });

    it("should count classes", () => {
      const metrics = collector.collectFileMetrics({
        filePath: "test.ts",
        content: "class A {}\nclass B {}\nconst x = 1;",
      });
      expect(metrics.classes).toBe(2);
    });

    it("should calculate maintainability index", () => {
      const metrics = collector.collectFileMetrics({
        filePath: "test.ts",
        content: "function hello() {\n  return 'hello';\n}\n",
      });
      expect(metrics.maintainabilityIndex).toBeGreaterThan(0);
      expect(metrics.maintainabilityIndex).toBeLessThanOrEqual(100);
    });

    it("should handle empty file", () => {
      const metrics = collector.collectFileMetrics({
        filePath: "empty.ts",
        content: "",
      });
      // "".split("\n") returns [""], so totalLines is 1
      expect(metrics.totalLines).toBe(1);
      expect(metrics.linesOfCode).toBe(0);
    });

    it("should handle file with only comments and blanks", () => {
      const metrics = collector.collectFileMetrics({
        filePath: "comments.ts",
        content: "// comment\n\n// another comment\n",
      });
      expect(metrics.linesOfCode).toBe(0);
      expect(metrics.linesOfComments).toBe(2);
      // The trailing newline creates an extra blank line
      expect(metrics.blankLines).toBe(2);
    });
  });

  describe("collectProjectMetrics", () => {
    it("should aggregate metrics from multiple files", () => {
      const metrics = collector.collectProjectMetrics([
        { filePath: "a.ts", content: "const a = 1;\nconst b = 2;" },
        { filePath: "b.ts", content: "const c = 3;" },
      ]);
      expect(metrics.totalFiles).toBe(2);
      expect(metrics.totalLinesOfCode).toBe(3);
    });

    it("should calculate average file LOC", () => {
      const metrics = collector.collectProjectMetrics([
        { filePath: "a.ts", content: "const a = 1;\nconst b = 2;\nconst c = 3;" },
        { filePath: "b.ts", content: "const d = 4;" },
      ]);
      expect(metrics.averageFileLOC).toBe(2);
    });

    it("should calculate comment ratio", () => {
      const metrics = collector.collectProjectMetrics([
        { filePath: "a.ts", content: "// comment\nconst a = 1;" },
      ]);
      expect(metrics.commentRatio).toBeGreaterThan(0);
    });

    it("should handle empty project", () => {
      const metrics = collector.collectProjectMetrics([]);
      expect(metrics.totalFiles).toBe(0);
      expect(metrics.totalLinesOfCode).toBe(0);
    });

    it("should include per-file metrics", () => {
      const metrics = collector.collectProjectMetrics([
        { filePath: "a.ts", content: "const x = 1;" },
      ]);
      expect(metrics.fileMetrics).toHaveLength(1);
      expect(metrics.fileMetrics[0].filePath).toBe("a.ts");
    });
  });

  describe("getTrend", () => {
    it("should return empty for single entry", () => {
      const history = [
        {
          timestamp: "2024-01-01",
          metrics: {
            totalFiles: 1,
            totalLinesOfCode: 10,
            totalLinesOfComments: 2,
            totalBlankLines: 1,
            totalFunctions: 1,
            totalClasses: 0,
            averageFileLOC: 10,
            averageComplexity: 2,
            maxComplexity: 2,
            commentRatio: 0.2,
            maintainabilityIndex: 80,
            fileMetrics: [],
          },
        },
      ];
      expect(collector.getTrend(history)).toHaveLength(0);
    });

    it("should detect improved complexity", () => {
      const history = [
        {
          timestamp: "2024-01-01",
          metrics: {
            totalFiles: 1, totalLinesOfCode: 100, totalLinesOfComments: 10,
            totalBlankLines: 5, totalFunctions: 5, totalClasses: 1,
            averageFileLOC: 100, averageComplexity: 10, maxComplexity: 20,
            commentRatio: 0.1, maintainabilityIndex: 60, fileMetrics: [],
          },
        },
        {
          timestamp: "2024-02-01",
          metrics: {
            totalFiles: 1, totalLinesOfCode: 100, totalLinesOfComments: 20,
            totalBlankLines: 5, totalFunctions: 5, totalClasses: 1,
            averageFileLOC: 100, averageComplexity: 5, maxComplexity: 10,
            commentRatio: 0.2, maintainabilityIndex: 75, fileMetrics: [],
          },
        },
      ];
      const trends = collector.getTrend(history);
      const complexityTrend = trends.find((t) => t.metric === "Average Complexity");
      expect(complexityTrend?.trend).toBe("improved");
    });

    it("should detect worsened complexity", () => {
      const history = [
        {
          timestamp: "2024-01-01",
          metrics: {
            totalFiles: 1, totalLinesOfCode: 100, totalLinesOfComments: 10,
            totalBlankLines: 5, totalFunctions: 5, totalClasses: 1,
            averageFileLOC: 100, averageComplexity: 3, maxComplexity: 5,
            commentRatio: 0.1, maintainabilityIndex: 80, fileMetrics: [],
          },
        },
        {
          timestamp: "2024-02-01",
          metrics: {
            totalFiles: 1, totalLinesOfCode: 100, totalLinesOfComments: 10,
            totalBlankLines: 5, totalFunctions: 5, totalClasses: 1,
            averageFileLOC: 100, averageComplexity: 8, maxComplexity: 15,
            commentRatio: 0.1, maintainabilityIndex: 65, fileMetrics: [],
          },
        },
      ];
      const trends = collector.getTrend(history);
      const complexityTrend = trends.find((t) => t.metric === "Average Complexity");
      expect(complexityTrend?.trend).toBe("worsened");
    });
  });

  describe("compareMetrics", () => {
    it("should compare two metric snapshots", () => {
      const before = {
        totalFiles: 1, totalLinesOfCode: 100, totalLinesOfComments: 10,
        totalBlankLines: 5, totalFunctions: 5, totalClasses: 1,
        averageFileLOC: 100, averageComplexity: 5, maxComplexity: 10,
        commentRatio: 0.1, maintainabilityIndex: 75, fileMetrics: [],
      };
      const after = {
        totalFiles: 2, totalLinesOfCode: 200, totalLinesOfComments: 30,
        totalBlankLines: 10, totalFunctions: 10, totalClasses: 2,
        averageFileLOC: 100, averageComplexity: 3, maxComplexity: 8,
        commentRatio: 0.15, maintainabilityIndex: 82, fileMetrics: [],
      };
      const comparisons = collector.compareMetrics(before, after);
      expect(comparisons.length).toBeGreaterThan(0);
      expect(comparisons.every((c) => c.metric)).toBe(true);
    });

    it("should calculate change percentages", () => {
      const before = {
        totalFiles: 1, totalLinesOfCode: 100, totalLinesOfComments: 10,
        totalBlankLines: 5, totalFunctions: 5, totalClasses: 1,
        averageFileLOC: 100, averageComplexity: 5, maxComplexity: 10,
        commentRatio: 0.1, maintainabilityIndex: 75, fileMetrics: [],
      };
      const after = {
        totalFiles: 1, totalLinesOfCode: 150, totalLinesOfComments: 15,
        totalBlankLines: 5, totalFunctions: 5, totalClasses: 1,
        averageFileLOC: 150, averageComplexity: 5, maxComplexity: 10,
        commentRatio: 0.1, maintainabilityIndex: 75, fileMetrics: [],
      };
      const comparisons = collector.compareMetrics(before, after);
      const locComparison = comparisons.find((c) => c.metric === "Lines of Code");
      expect(locComparison?.changePercent).toBe(50);
    });
  });

  describe("generateReport", () => {
    it("should generate report with recommendations", () => {
      const metrics = {
        totalFiles: 1, totalLinesOfCode: 1000, totalLinesOfComments: 5,
        totalBlankLines: 10, totalFunctions: 20, totalClasses: 5,
        averageFileLOC: 1000, averageComplexity: 15, maxComplexity: 30,
        commentRatio: 0.005, maintainabilityIndex: 40, fileMetrics: [],
      };
      const report = collector.generateReport(metrics);
      expect(report.projectMetrics).toBe(metrics);
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.generatedAt).toBeDefined();
    });

    it("should recommend refactoring for low maintainability", () => {
      const metrics = {
        totalFiles: 1, totalLinesOfCode: 500, totalLinesOfComments: 5,
        totalBlankLines: 10, totalFunctions: 10, totalClasses: 2,
        averageFileLOC: 500, averageComplexity: 20, maxComplexity: 40,
        commentRatio: 0.01, maintainabilityIndex: 30, fileMetrics: [],
      };
      const report = collector.generateReport(metrics);
      expect(report.recommendations.some((r) => r.includes("refactoring") || r.includes("maintainability"))).toBe(true);
    });

    it("should recommend more comments for low ratio", () => {
      const metrics = {
        totalFiles: 1, totalLinesOfCode: 500, totalLinesOfComments: 1,
        totalBlankLines: 5, totalFunctions: 10, totalClasses: 2,
        averageFileLOC: 500, averageComplexity: 5, maxComplexity: 8,
        commentRatio: 0.002, maintainabilityIndex: 70, fileMetrics: [],
      };
      const report = collector.generateReport(metrics);
      expect(report.recommendations.some((r) => r.includes("comment"))).toBe(true);
    });

    it("should recommend splitting large files", () => {
      const metrics = {
        totalFiles: 1, totalLinesOfCode: 1000, totalLinesOfComments: 100,
        totalBlankLines: 10, totalFunctions: 20, totalClasses: 5,
        averageFileLOC: 1000, averageComplexity: 5, maxComplexity: 8,
        commentRatio: 0.1, maintainabilityIndex: 75, fileMetrics: [],
      };
      const report = collector.generateReport(metrics);
      expect(report.recommendations.some((r) => r.includes("splitting") || r.includes("file"))).toBe(true);
    });
  });
});
