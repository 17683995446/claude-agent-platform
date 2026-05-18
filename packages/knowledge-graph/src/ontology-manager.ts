/**
 * OntologyManager - Manage ontologies and schemas for knowledge graphs.
 *
 * Provides class hierarchies, property definitions, relation schemas,
 * instance validation, type inference, and ontology merging.
 */

/** Property constraint types */
export interface PropertyConstraints {
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  enum?: unknown[];
  unique?: boolean;
}

/** Class definition in the ontology */
export interface ClassDefinition {
  name: string;
  superClass?: string;
  properties: Map<string, PropertyConstraints>;
  subClasses: Set<string>;
}

/** Property definition in the ontology */
export interface PropertyDefinition {
  name: string;
  domain: string;
  range: string;
  constraints: PropertyConstraints;
}

/** Relation definition in the ontology */
export interface RelationDefinition {
  name: string;
  domain: string;
  range: string;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Hierarchy node */
export interface HierarchyNode {
  name: string;
  children: HierarchyNode[];
}

/**
 * OntologyManager manages ontologies and schemas for knowledge graphs.
 *
 * @example
 * ```typescript
 * const om = new OntologyManager();
 * om.defineClass('Person', 'Entity', new Map([['name', { type: 'string', required: true }]]));
 * om.defineClass('Employee', 'Person', new Map([['salary', { type: 'number' }]]));
 * const result = om.validateInstance({ name: 'Alice', salary: 50000 }, 'Employee');
 * ```
 */
export class OntologyManager {
  private classes: Map<string, ClassDefinition> = new Map();
  private properties: Map<string, PropertyDefinition> = new Map();
  private relations: Map<string, RelationDefinition> = new Map();

  /**
   * Define a class in the ontology.
   * @param name - Class name
   * @param superClass - Optional parent class name
   * @param properties - Map of property names to their constraints
   */
  defineClass(name: string, superClass?: string, properties?: Map<string, PropertyConstraints>): void {
    if (superClass && !this.classes.has(superClass)) {
      throw new Error(`Super class '${superClass}' does not exist`);
    }

    const classDef: ClassDefinition = {
      name,
      superClass,
      properties: properties || new Map(),
      subClasses: new Set(),
    };

    this.classes.set(name, classDef);

    if (superClass) {
      this.classes.get(superClass)!.subClasses.add(name);
    }
  }

  /**
   * Define a property in the ontology.
   * @param name - Property name
   * @param domain - Domain class name
   * @param range - Range type
   * @param constraints - Property constraints
   */
  defineProperty(name: string, domain: string, range: string, constraints: PropertyConstraints = {}): void {
    if (!this.classes.has(domain)) {
      throw new Error(`Domain class '${domain}' does not exist`);
    }

    this.properties.set(name, { name, domain, range, constraints });
  }

  /**
   * Define a relation between classes.
   * @param name - Relation name
   * @param domain - Source class name
   * @param range - Target class name
   */
  defineRelation(name: string, domain: string, range: string): void {
    if (!this.classes.has(domain)) {
      throw new Error(`Domain class '${domain}' does not exist`);
    }
    if (!this.classes.has(range)) {
      throw new Error(`Range class '${range}' does not exist`);
    }

    this.relations.set(name, { name, domain, range });
  }

  /**
   * Validate an instance against a class definition.
   * @param instance - The instance data to validate
   * @param classDef - The class name to validate against
   * @returns Validation result with errors if any
   */
  validateInstance(instance: Record<string, unknown>, classDef: string): ValidationResult {
    const errors: string[] = [];

    if (!this.classes.has(classDef)) {
      return { valid: false, errors: [`Class '${classDef}' does not exist`] };
    }

    // Collect all applicable properties from class hierarchy
    const allProperties = this.getAllProperties(classDef);

    for (const [propName, constraints] of allProperties) {
      const value = instance[propName];

      // Check required
      if (constraints.required && (value === undefined || value === null)) {
        errors.push(`Property '${propName}' is required`);
        continue;
      }

      if (value === undefined || value === null) continue;

      // Check type
      if (constraints.type) {
        const actualType = typeof value;
        if (actualType !== constraints.type) {
          errors.push(`Property '${propName}' should be ${constraints.type}, got ${actualType}`);
        }
      }

      // Check min
      if (constraints.min !== undefined && typeof value === 'number' && value < constraints.min) {
        errors.push(`Property '${propName}' must be >= ${constraints.min}`);
      }

      // Check max
      if (constraints.max !== undefined && typeof value === 'number' && value > constraints.max) {
        errors.push(`Property '${propName}' must be <= ${constraints.max}`);
      }

      // Check pattern
      if (constraints.pattern && typeof value === 'string') {
        const regex = new RegExp(constraints.pattern);
        if (!regex.test(value)) {
          errors.push(`Property '${propName}' does not match pattern '${constraints.pattern}'`);
        }
      }

      // Check enum
      if (constraints.enum && !constraints.enum.includes(value)) {
        errors.push(`Property '${propName}' must be one of: ${constraints.enum.join(', ')}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Infer the most specific type(s) for an instance.
   * @param instance - The instance data
   * @returns Array of matching class names, from most specific to most general
   */
  inferTypes(instance: Record<string, unknown>): string[] {
    const matches: Array<{ name: string; score: number }> = [];

    for (const [className, classDef] of this.classes) {
      const allProps = this.getAllProperties(className);
      let matchCount = 0;
      let requiredMatch = true;

      for (const [propName, constraints] of allProps) {
        if (constraints.required && instance[propName] === undefined) {
          requiredMatch = false;
          break;
        }
        if (instance[propName] !== undefined) {
          matchCount++;
        }
      }

      if (requiredMatch) {
        matches.push({ name: className, score: matchCount });
      }
    }

    // Sort by score descending, then by hierarchy depth descending
    matches.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return this.getClassDepth(b.name) - this.getClassDepth(a.name);
    });

    return matches.map(m => m.name);
  }

  /**
   * Get the class hierarchy for a given class.
   * @param className - Class name to get hierarchy for
   * @returns Hierarchy tree structure
   */
  getHierarchy(className: string): HierarchyNode | null {
    if (!this.classes.has(className)) return null;

    const buildNode = (name: string): HierarchyNode => {
      const classDef = this.classes.get(name)!;
      const children: HierarchyNode[] = [];

      for (const subClassName of classDef.subClasses) {
        children.push(buildNode(subClassName));
      }

      return { name, children };
    };

    return buildNode(className);
  }

  /**
   * Merge another ontology into this one.
   * @param other - Another OntologyManager to merge
   * @returns Array of conflict descriptions (if any)
   */
  mergeOntology(other: OntologyManager): string[] {
    const conflicts: string[] = [];

    // Merge classes
    for (const [name, classDef] of other.classes) {
      if (this.classes.has(name)) {
        const existing = this.classes.get(name)!;
        if (existing.superClass !== classDef.superClass) {
          conflicts.push(`Class '${name}' has different super class: '${existing.superClass}' vs '${classDef.superClass}'`);
        }
        // Merge properties
        for (const [propName, constraints] of classDef.properties) {
          if (existing.properties.has(propName)) {
            conflicts.push(`Class '${name}' property '${propName}' already exists with different constraints`);
          } else {
            existing.properties.set(propName, constraints);
          }
        }
      } else {
        // Add class (may need to add super class first)
        if (classDef.superClass && !this.classes.has(classDef.superClass)) {
          // Copy super class chain
          this.copyClassHierarchy(other, classDef.superClass);
        }
        this.classes.set(name, {
          ...classDef,
          properties: new Map(classDef.properties),
          subClasses: new Set(classDef.subClasses),
        });
      }
    }

    // Merge properties
    for (const [name, propDef] of other.properties) {
      if (this.properties.has(name)) {
        const existing = this.properties.get(name)!;
        if (existing.domain !== propDef.domain || existing.range !== propDef.range) {
          conflicts.push(`Property '${name}' has different domain/range`);
        }
      } else {
        this.properties.set(name, { ...propDef });
      }
    }

    // Merge relations
    for (const [name, relDef] of other.relations) {
      if (this.relations.has(name)) {
        const existing = this.relations.get(name)!;
        if (existing.domain !== relDef.domain || existing.range !== relDef.range) {
          conflicts.push(`Relation '${name}' has different domain/range`);
        }
      } else {
        this.relations.set(name, { ...relDef });
      }
    }

    return conflicts;
  }

  /**
   * Get a class definition by name.
   */
  getClass(name: string): ClassDefinition | undefined {
    return this.classes.get(name);
  }

  /**
   * Get all class names.
   */
  getAllClassNames(): string[] {
    return Array.from(this.classes.keys());
  }

  /**
   * Get all properties for a class including inherited ones.
   */
  private getAllProperties(className: string): Map<string, PropertyConstraints> {
    const result = new Map<string, PropertyConstraints>();
    const chain = this.getClassChain(className);

    for (const name of chain) {
      const classDef = this.classes.get(name);
      if (classDef) {
        for (const [propName, constraints] of classDef.properties) {
          if (!result.has(propName)) {
            result.set(propName, constraints);
          }
        }
      }
    }

    return result;
  }

  /**
   * Get the inheritance chain from a class to the root.
   */
  private getClassChain(className: string): string[] {
    const chain: string[] = [];
    let current: string | undefined = className;

    while (current) {
      chain.push(current);
      const classDef = this.classes.get(current);
      current = classDef?.superClass;
    }

    return chain;
  }

  /**
   * Get the depth of a class in the hierarchy.
   */
  private getClassDepth(className: string): number {
    return this.getClassChain(className).length;
  }

  /**
   * Copy a class hierarchy from another ontology.
   */
  private copyClassHierarchy(other: OntologyManager, className: string): void {
    if (this.classes.has(className)) return;

    const classDef = other.getClass(className);
    if (!classDef) return;

    if (classDef.superClass) {
      this.copyClassHierarchy(other, classDef.superClass);
    }

    this.classes.set(className, {
      ...classDef,
      properties: new Map(classDef.properties),
      subClasses: new Set(classDef.subClasses),
    });
  }
}
