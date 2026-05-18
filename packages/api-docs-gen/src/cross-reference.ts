/**
 * Cross Reference Builder Module
 * Builds cross-reference maps between documentation symbols.
 */

import type { DocModel } from './doc-model.js';
import type { ClassDoc, InterfaceDoc, FunctionDoc, ModuleDoc } from './doc-model.js';

export interface ReferenceMap {
  implementations: Map<string, string[]>;
  usages: Map<string, UsageInfo[]>;
  dependencies: Map<string, string[]>;
  dependents: Map<string, string[]>;
  inheritance: Map<string, InheritanceNode>;
  callGraph: Map<string, CallGraphNode>;
}

export interface UsageInfo {
  symbol: string;
  module: string;
  location: string;
  type: 'import' | 'extends' | 'implements' | 'parameter' | 'return-type' | 'property-type' | 'call';
}

export interface InheritanceNode {
  name: string;
  fqn: string;
  parent?: string;
  children: string[];
  interfaces: string[];
  depth: number;
}

export interface CallGraphNode {
  name: string;
  fqn: string;
  calls: string[];
  calledBy: string[];
}

export class CrossReferenceBuilder {
  private refMap: ReferenceMap;

  constructor() {
    this.refMap = {
      implementations: new Map(),
      usages: new Map(),
      dependencies: new Map(),
      dependents: new Map(),
      inheritance: new Map(),
      callGraph: new Map(),
    };
  }

  /**
   * Build all cross-references from the documentation model.
   */
  buildReferences(docModel: DocModel): ReferenceMap {
    const modules = docModel.getAllModules();

    for (const mod of modules) {
      // Build dependencies
      this.refMap.dependencies.set(mod.name, []);
      this.refMap.dependents.set(mod.name, []);

      for (const cls of mod.classes) {
        // Track inheritance
        if (cls.extends) {
          this.addInheritance(cls.fqn, cls.extends);
          this.addUsage(cls.extends, cls.fqn, mod.name, 'extends');
        }
        for (const impl of cls.implements) {
          this.addImplementation(impl, cls.fqn);
          this.addUsage(impl, cls.fqn, mod.name, 'implements');
        }

        // Track method calls
        for (const method of cls.methods) {
          this.refMap.callGraph.set(`${cls.fqn}.${method.name}`, {
            name: method.name,
            fqn: `${cls.fqn}.${method.name}`,
            calls: [],
            calledBy: [],
          });
        }
      }

      for (const iface of mod.interfaces) {
        for (const ext of iface.extends) {
          this.addUsage(ext, iface.fqn, mod.name, 'extends');
        }
      }

      for (const fn of mod.functions) {
        this.refMap.callGraph.set(fn.fqn, {
          name: fn.name,
          fqn: fn.fqn,
          calls: [],
          calledBy: [],
        });

        // Track parameter type usages
        for (const param of fn.parameters) {
          if (this.isCustomType(param.type)) {
            this.addUsage(param.type, fn.fqn, mod.name, 'parameter');
          }
        }
      }
    }

    // Build reverse dependencies
    for (const [mod, deps] of this.refMap.dependencies) {
      for (const dep of deps) {
        const existing = this.refMap.dependents.get(dep) ?? [];
        if (!existing.includes(mod)) {
          existing.push(mod);
          this.refMap.dependents.set(dep, existing);
        }
      }
    }

    return this.refMap;
  }

  /**
   * Get classes implementing an interface.
   */
  getImplementations(interfaceName: string): string[] {
    return this.refMap.implementations.get(interfaceName) ?? [];
  }

  /**
   * Get all usages of a symbol.
   */
  getUsages(symbolName: string): UsageInfo[] {
    return this.refMap.usages.get(symbolName) ?? [];
  }

  /**
   * Get dependencies of a module.
   */
  getDependencies(moduleName: string): string[] {
    return this.refMap.dependencies.get(moduleName) ?? [];
  }

  /**
   * Get modules that depend on this module.
   */
  getDependents(moduleName: string): string[] {
    return this.refMap.dependents.get(moduleName) ?? [];
  }

  /**
   * Get full inheritance tree for a class.
   */
  getInheritanceTree(className: string): InheritanceNode | null {
    return this.refMap.inheritance.get(className) ?? null;
  }

  /**
   * Get function call graph.
   */
  getCallGraph(functionName: string): CallGraphNode | null {
    return this.refMap.callGraph.get(functionName) ?? null;
  }

  /**
   * Generate a Mermaid diagram.
   */
  generateMermaidDiagram(type: 'class' | 'inheritance' | 'module-dependencies' | 'call-graph', name: string): string {
    switch (type) {
      case 'class':
        return this.generateClassDiagram(name);
      case 'inheritance':
        return this.generateInheritanceDiagram(name);
      case 'module-dependencies':
        return this.generateModuleDependencyDiagram();
      case 'call-graph':
        return this.generateCallGraphDiagram(name);
      default:
        return '';
    }
  }

  // --- Internal helpers ---

  private addImplementation(interfaceName: string, className: string): void {
    const existing = this.refMap.implementations.get(interfaceName) ?? [];
    if (!existing.includes(className)) {
      existing.push(className);
      this.refMap.implementations.set(interfaceName, existing);
    }
  }

  private addUsage(symbol: string, usedBy: string, module: string, type: UsageInfo['type']): void {
    const existing = this.refMap.usages.get(symbol) ?? [];
    existing.push({ symbol, module, location: usedBy, type });
    this.refMap.usages.set(symbol, existing);
  }

  private addInheritance(childFqn: string, parentName: string): void {
    this.refMap.inheritance.set(childFqn, {
      name: childFqn.split('.').pop() ?? childFqn,
      fqn: childFqn,
      parent: parentName,
      children: [],
      interfaces: [],
      depth: 0,
    });

    // Add child to parent's children
    const parent = this.refMap.inheritance.get(parentName);
    if (parent) {
      parent.children.push(childFqn);
    }
  }

  private isCustomType(type: string): boolean {
    if (!type) return false;
    const primitives = ['string', 'number', 'boolean', 'any', 'unknown', 'void', 'null', 'undefined', 'never', 'object', 'symbol', 'bigint'];
    return !primitives.includes(type) && /^[A-Z]/.test(type);
  }

  private generateClassDiagram(name: string): string {
    const lines: string[] = ['classDiagram'];
    const node = this.refMap.inheritance.get(name);

    if (node) {
      if (node.parent) {
        lines.push(`  ${node.parent} <|-- ${node.name}`);
      }
      for (const child of node.children) {
        lines.push(`  ${node.name} <|-- ${child.split('.').pop()}`);
      }
      for (const iface of node.interfaces) {
        lines.push(`  ${iface} <|.. ${node.name}`);
      }
    }

    return lines.join('\n');
  }

  private generateInheritanceDiagram(name: string): string {
    const lines: string[] = ['graph TD'];
    const visited = new Set<string>();

    const traverse = (current: string, depth: number): void => {
      if (visited.has(current) || depth > 5) return;
      visited.add(current);

      const node = this.refMap.inheritance.get(current);
      if (node?.parent) {
        lines.push(`  ${node.parent} --> ${node.name}`);
        traverse(node.parent, depth + 1);
      }
      for (const child of node?.children ?? []) {
        lines.push(`  ${node?.name ?? current} --> ${child.split('.').pop()}`);
        traverse(child, depth + 1);
      }
    };

    traverse(name, 0);
    return lines.join('\n');
  }

  private generateModuleDependencyDiagram(): string {
    const lines: string[] = ['graph LR'];
    for (const [mod, deps] of this.refMap.dependencies) {
      for (const dep of deps) {
        lines.push(`  ${mod} --> ${dep}`);
      }
    }
    return lines.join('\n');
  }

  private generateCallGraphDiagram(name: string): string {
    const lines: string[] = ['graph TD'];
    const node = this.refMap.callGraph.get(name);

    if (node) {
      for (const call of node.calls) {
        lines.push(`  ${node.name} --> ${call}`);
      }
      for (const caller of node.calledBy) {
        lines.push(`  ${caller} --> ${node.name}`);
      }
    }

    return lines.join('\n');
  }
}
