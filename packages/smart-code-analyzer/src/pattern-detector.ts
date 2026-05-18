/**
 * Pattern Detector Module
 *
 * Detect common design patterns in code AST structures.
 * Supports Singleton, Factory, Observer, Strategy, and Decorator patterns.
 */

import type { ASTNode } from "./ast-parser.js";

/** A detected design pattern */
export interface DetectedPattern {
  name: string;
  type: "singleton" | "factory" | "observer" | "strategy" | "decorator" | "adapter" | "facade";
  confidence: number;
  location: string;
  description: string;
  participants: string[];
}

/** Singleton pattern detection result */
export interface SingletonInfo {
  className: string;
  hasPrivateConstructor: boolean;
  hasStaticInstance: boolean;
  hasGetInstanceMethod: boolean;
  confidence: number;
}

/** Factory pattern detection result */
export interface FactoryInfo {
  factoryClassName: string;
  productTypes: string[];
  createMethodName: string;
  confidence: number;
}

/** Observer pattern detection result */
export interface ObserverInfo {
  subjectName: string;
  observers: string[];
  hasSubscribe: boolean;
  hasUnsubscribe: boolean;
  hasNotify: boolean;
  confidence: number;
}

/** Strategy pattern detection result */
export interface StrategyInfo {
  contextName: string;
  strategyInterface: string;
  concreteStrategies: string[];
  confidence: number;
}

/** Decorator pattern detection result */
export interface DecoratorInfo {
  componentType: string;
  decorators: string[];
  hasBaseReference: boolean;
  confidence: number;
}

/**
 * PatternDetector - Identify design patterns in code AST structures.
 */
export class PatternDetector {
  /**
   * Detect Singleton pattern in the AST.
   * @param ast - The AST to analyze
   * @returns Singleton pattern info if detected
   */
  detectSingleton(ast: ASTNode): SingletonInfo | null {
    const classes = this.findNodesByType(ast, "ClassDeclaration");

    for (const cls of classes) {
      const className = (cls.name as string) ?? "";
      const methods = (cls.methods as ASTNode[]) ?? [];
      const properties = (cls.properties as ASTNode[]) ?? [];

      const hasStaticInstance = properties.some(
        (p) => (p.name as string)?.toLowerCase().includes("instance") && (p.isStatic as boolean)
      );

      const hasGetInstanceMethod = methods.some(
        (m) =>
          ((m.name as string) === "getInstance" || (m.name as string) === "instance") &&
          (m.isStatic as boolean)
      );

      const hasPrivateConstructor =
        (cls.isAbstract as boolean) === false &&
        methods.every((m) => (m.name as string) !== "constructor") &&
        properties.some((p) => (p.isPrivate as boolean));

      const confidence = this.calculateSingletonConfidence(
        hasStaticInstance,
        hasGetInstanceMethod,
        hasPrivateConstructor
      );

      if (confidence > 0.3) {
        return {
          className,
          hasPrivateConstructor,
          hasStaticInstance,
          hasGetInstanceMethod,
          confidence,
        };
      }
    }

    return null;
  }

  /**
   * Detect Factory Method pattern in the AST.
   * @param ast - The AST to analyze
   * @returns Factory pattern info if detected
   */
  detectFactory(ast: ASTNode): FactoryInfo | null {
    const classes = this.findNodesByType(ast, "ClassDeclaration");

    for (const cls of classes) {
      const className = (cls.name as string) ?? "";
      const methods = (cls.methods as ASTNode[]) ?? [];

      // Look for create/factory methods that return different types
      const createMethods = methods.filter(
        (m) =>
          ((m.name as string)?.startsWith("create") ||
            (m.name as string)?.startsWith("build") ||
            (m.name as string) === "factory" ||
            (m.name as string) === "make") &&
          (m.isStatic as boolean)
      );

      if (createMethods.length > 0) {
        const productTypes = createMethods.map((m) => (m.returnType as string) ?? "unknown");
        const createMethodName = createMethods[0].name as string;

        const confidence = Math.min(
          0.5 + createMethods.length * 0.15,
          0.95
        );

        return {
          factoryClassName: className,
          productTypes,
          createMethodName,
          confidence,
        };
      }
    }

    return null;
  }

  /**
   * Detect Observer pattern in the AST.
   * @param ast - The AST to analyze
   * @returns Observer pattern info if detected
   */
  detectObserver(ast: ASTNode): ObserverInfo | null {
    const classes = this.findNodesByType(ast, "ClassDeclaration");

    for (const cls of classes) {
      const subjectName = (cls.name as string) ?? "";
      const methods = (cls.methods as ASTNode[]) ?? [];
      const properties = (cls.properties as ASTNode[]) ?? [];

      const hasSubscribe =
        methods.some((m) => (m.name as string) === "subscribe" || (m.name as string) === "attach" || (m.name as string) === "addListener") ||
        properties.some((p) => (p.name as string) === "listeners" || (p.name as string) === "observers");

      const hasUnsubscribe =
        methods.some((m) => (m.name as string) === "unsubscribe" || (m.name as string) === "detach" || (m.name as string) === "removeListener");

      const hasNotify =
        methods.some((m) => (m.name as string) === "notify" || (m.name as string) === "notifyAll" || (m.name as string) === "emit");

      if (hasSubscribe || hasNotify) {
        const observerNames = classes
          .filter((c) => {
            const impl = (c.implementedInterfaces as string[]) ?? [];
            return impl.some((i) => i.toLowerCase().includes("observer") || i.toLowerCase().includes("listener"));
          })
          .map((c) => (c.name as string) ?? "");

        const confidence = this.calculateObserverConfidence(hasSubscribe, hasUnsubscribe, hasNotify);

        return {
          subjectName,
          observers: observerNames,
          hasSubscribe,
          hasUnsubscribe,
          hasNotify,
          confidence,
        };
      }
    }

    return null;
  }

  /**
   * Detect Strategy pattern in the AST.
   * @param ast - The AST to analyze
   * @returns Strategy pattern info if detected
   */
  detectStrategy(ast: ASTNode): StrategyInfo | null {
    const classes = this.findNodesByType(ast, "ClassDeclaration");
    const interfaces = this.findNodesByType(ast, "InterfaceDeclaration");

    // Look for a strategy interface
    for (const iface of interfaces) {
      const ifaceName = (iface.name as string) ?? "";
      const members = (iface.members as ASTNode[]) ?? [];

      const hasExecuteMethod = members.some(
        (m) =>
          (m.name as string) === "execute" ||
          (m.name as string) === "executeStrategy" ||
          (m.name as string) === "run" ||
          (m.name as string) === "apply"
      );

      if (hasExecuteMethod) {
        // Find concrete strategy classes
        const concreteStrategies = classes.filter((c) => {
          const impl = (c.implementedInterfaces as string[]) ?? [];
          return impl.includes(ifaceName);
        });

        if (concreteStrategies.length > 0) {
          // Find context class
          const context = classes.find((c) => {
            const props = (c.properties as ASTNode[]) ?? [];
            return props.some((p) => (p.type as string)?.toLowerCase().includes("strategy"));
          });

          const confidence = Math.min(0.4 + concreteStrategies.length * 0.2, 0.95);

          return {
            contextName: (context?.name as string) ?? "Unknown",
            strategyInterface: ifaceName,
            concreteStrategies: concreteStrategies.map((c) => (c.name as string) ?? ""),
            confidence,
          };
        }
      }
    }

    return null;
  }

  /**
   * Detect Decorator pattern in the AST.
   * @param ast - The AST to analyze
   * @returns Decorator pattern info if detected
   */
  detectDecorator(ast: ASTNode): DecoratorInfo | null {
    const classes = this.findNodesByType(ast, "ClassDeclaration");

    // Look for classes that extend another class and have the same interface
    for (const cls of classes) {
      const superClass = cls.superClass as string | undefined;
      const implInterfaces = (cls.implementedInterfaces as string[]) ?? [];
      const className = (cls.name as string) ?? "";

      if (superClass) {
        // Check if this class wraps the parent (decorator pattern)
        const properties = (cls.properties as ASTNode[]) ?? [];
        const hasBaseReference = properties.some(
          (p) =>
            (p.name as string) === "wrapped" ||
            (p.name as string) === "component" ||
            (p.name as string) === "delegate" ||
            (p.type as string) === superClass
        );

        if (hasBaseReference) {
          // Find other decorators (siblings that also wrap the same parent)
          const decorators = classes
            .filter((c) => c !== cls && (c.superClass as string) === superClass)
            .map((c) => (c.name as string) ?? "");

          decorators.push(className);

          const confidence = 0.6 + (decorators.length > 1 ? 0.2 : 0);

          return {
            componentType: superClass,
            decorators,
            hasBaseReference,
            confidence,
          };
        }
      }
    }

    return null;
  }

  /**
   * Detect all design patterns in the AST.
   * @param ast - The AST to analyze
   * @returns Array of detected patterns with confidence scores
   */
  detectPatterns(ast: ASTNode): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Singleton
    const singleton = this.detectSingleton(ast);
    if (singleton) {
      patterns.push({
        name: "Singleton",
        type: "singleton",
        confidence: singleton.confidence,
        location: singleton.className,
        description: `Singleton pattern detected in class "${singleton.className}"`,
        participants: [singleton.className],
      });
    }

    // Factory
    const factory = this.detectFactory(ast);
    if (factory) {
      patterns.push({
        name: "Factory Method",
        type: "factory",
        confidence: factory.confidence,
        location: factory.factoryClassName,
        description: `Factory pattern detected in class "${factory.factoryClassName}"`,
        participants: [factory.factoryClassName, ...factory.productTypes],
      });
    }

    // Observer
    const observer = this.detectObserver(ast);
    if (observer) {
      patterns.push({
        name: "Observer",
        type: "observer",
        confidence: observer.confidence,
        location: observer.subjectName,
        description: `Observer pattern detected with subject "${observer.subjectName}"`,
        participants: [observer.subjectName, ...observer.observers],
      });
    }

    // Strategy
    const strategy = this.detectStrategy(ast);
    if (strategy) {
      patterns.push({
        name: "Strategy",
        type: "strategy",
        confidence: strategy.confidence,
        location: strategy.strategyInterface,
        description: `Strategy pattern detected with interface "${strategy.strategyInterface}"`,
        participants: [strategy.contextName, strategy.strategyInterface, ...strategy.concreteStrategies],
      });
    }

    // Decorator
    const decorator = this.detectDecorator(ast);
    if (decorator) {
      patterns.push({
        name: "Decorator",
        type: "decorator",
        confidence: decorator.confidence,
        location: decorator.componentType,
        description: `Decorator pattern detected for component "${decorator.componentType}"`,
        participants: [decorator.componentType, ...decorator.decorators],
      });
    }

    // Sort by confidence descending
    patterns.sort((a, b) => b.confidence - a.confidence);

    return patterns;
  }

  // --- Private helpers ---

  private findNodesByType(root: ASTNode, type: string): ASTNode[] {
    const results: ASTNode[] = [];

    const walk = (node: ASTNode): void => {
      if (node.type === type || node.kind === type) {
        results.push(node);
      }

      const childKeys = ["body", "declarations", "methods", "properties", "members"];
      for (const key of childKeys) {
        const child = (node as Record<string, unknown>)[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object") {
              walk(item as ASTNode);
            }
          }
        }
      }
    };

    walk(root);
    return results;
  }

  private calculateSingletonConfidence(
    hasStaticInstance: boolean,
    hasGetInstance: boolean,
    hasPrivateConstructor: boolean
  ): number {
    let confidence = 0;
    if (hasStaticInstance) confidence += 0.35;
    if (hasGetInstance) confidence += 0.35;
    if (hasPrivateConstructor) confidence += 0.3;
    return Math.min(confidence, 1.0);
  }

  private calculateObserverConfidence(
    hasSubscribe: boolean,
    hasUnsubscribe: boolean,
    hasNotify: boolean
  ): number {
    let confidence = 0;
    if (hasSubscribe) confidence += 0.35;
    if (hasUnsubscribe) confidence += 0.15;
    if (hasNotify) confidence += 0.35;
    return Math.min(confidence, 1.0);
  }
}
