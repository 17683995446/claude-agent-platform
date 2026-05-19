/**
 * SemanticMemory - Knowledge graph-based semantic storage.
 */

export interface Concept {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  relations: Relation[];
}

export interface Relation {
  from: string;
  to: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface SemanticQueryOptions {
  limit?: number;
  includeProperties?: boolean;
  depth?: number;
}

export interface SemanticStats {
  conceptCount: number;
  relationCount: number;
  averageRelationsPerConcept: number;
  isolatedConcepts: number;
}

export class SemanticMemory {
  private concepts: Map<string, Concept> = new Map();
  private relations: Relation[] = [];

  addConcept(
    name: string,
    description: string,
    properties: Record<string, unknown> = {},
    relations: Relation[] = []
  ): Concept {
    const concept: Concept = {
      name,
      description,
      properties: { ...properties },
      relations: [...relations],
    };
    this.concepts.set(name, concept);
    for (const rel of relations) {
      this.relations.push({ ...rel });
    }
    return concept;
  }

  addRelation(
    from: string,
    to: string,
    type: string,
    properties: Record<string, unknown> = {}
  ): Relation {
    const relation: Relation = { from, to, type, properties: { ...properties } };
    this.relations.push(relation);
    // Update concept relations
    const fromConcept = this.concepts.get(from);
    if (fromConcept) {
      fromConcept.relations.push(relation);
    }
    const toConcept = this.concepts.get(to);
    if (toConcept) {
      toConcept.relations.push(relation);
    }
    return relation;
  }

  query(query: string, options: SemanticQueryOptions = {}): Concept[] {
    const lowerQuery = query.toLowerCase();
    const matched = Array.from(this.concepts.values()).filter(
      (c) =>
        c.name.toLowerCase().includes(lowerQuery) ||
        c.description.toLowerCase().includes(lowerQuery) ||
        Object.values(c.properties).some(
          (v) => typeof v === 'string' && v.toLowerCase().includes(lowerQuery)
        )
    );
    if (options.limit !== undefined && options.limit > 0) {
      return matched.slice(0, options.limit);
    }
    return matched;
  }

  getConcept(name: string): Concept | undefined {
    return this.concepts.get(name);
  }

  getRelated(name: string, depth: number = 1): Concept[] {
    const visited = new Set<string>();
    const queue: Array<{ name: string; currentDepth: number }> = [{ name, currentDepth: 0 }];
    const result: Concept[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.name) || current.currentDepth > depth) continue;
      visited.add(current.name);

      if (current.name !== name) {
        const concept = this.concepts.get(current.name);
        if (concept) result.push(concept);
      }

      // Find related concepts
      const relatedNames = new Set<string>();
      for (const rel of this.relations) {
        if (rel.from === current.name) relatedNames.add(rel.to);
        if (rel.to === current.name) relatedNames.add(rel.from);
      }
      for (const relatedName of relatedNames) {
        if (!visited.has(relatedName)) {
          queue.push({ name: relatedName, currentDepth: current.currentDepth + 1 });
        }
      }
    }
    return result;
  }

  infer(query: string): Array<{ inference: string; confidence: number }> {
    const lowerQuery = query.toLowerCase();
    const results: Array<{ inference: string; confidence: number }> = [];

    // Simple transitive inference: if A->B and B->C, infer A->C
    for (const rel1 of this.relations) {
      for (const rel2 of this.relations) {
        if (rel1.to === rel2.from && rel1.type === rel2.type) {
          const fromConcept = this.concepts.get(rel1.from);
          const toConcept = this.concepts.get(rel2.to);
          if (fromConcept && toConcept) {
            const inference = `${fromConcept.name} may be related to ${toConcept.name} via ${rel1.type} (transitive through ${rel1.to})`;
            if (inference.toLowerCase().includes(lowerQuery) || lowerQuery === '') {
              results.push({ inference, confidence: 0.6 });
            }
          }
        }
      }
    }

    // Property-based inference
    for (const concept of this.concepts.values()) {
      if (
        concept.description.toLowerCase().includes(lowerQuery) ||
        concept.name.toLowerCase().includes(lowerQuery)
      ) {
        const related = this.getRelated(concept.name, 1);
        if (related.length > 0) {
          const relTypes = new Set(
            this.relations
              .filter((r) => r.from === concept.name || r.to === concept.name)
              .map((r) => r.type)
          );
          results.push({
            inference: `${concept.name} is connected to ${related.map((r) => r.name).join(', ')} via ${Array.from(relTypes).join(', ')}`,
            confidence: 0.8,
          });
        }
      }
    }

    return results.slice(0, 10);
  }

  merge(other: SemanticMemory): void {
    for (const [name, concept] of other.concepts) {
      const existing = this.concepts.get(name);
      if (existing) {
        // Merge properties
        existing.properties = { ...existing.properties, ...concept.properties };
        existing.description = concept.description || existing.description;
      } else {
        this.concepts.set(name, { ...concept, relations: [...concept.relations] });
      }
    }
    for (const rel of other.relations) {
      const exists = this.relations.some(
        (r) => r.from === rel.from && r.to === rel.to && r.type === rel.type
      );
      if (!exists) {
        this.relations.push({ ...rel });
      }
    }
  }

  getStats(): SemanticStats {
    const conceptsWithRelations = new Set<string>();
    for (const rel of this.relations) {
      conceptsWithRelations.add(rel.from);
      conceptsWithRelations.add(rel.to);
    }
    return {
      conceptCount: this.concepts.size,
      relationCount: this.relations.length,
      averageRelationsPerConcept:
        this.concepts.size > 0 ? this.relations.length / this.concepts.size : 0,
      isolatedConcepts: this.concepts.size - conceptsWithRelations.size,
    };
  }

  export(): { concepts: Concept[]; relations: Relation[] } {
    return {
      concepts: Array.from(this.concepts.values()).map((c) => ({
        ...c,
        properties: { ...c.properties },
        relations: [...c.relations],
      })),
      relations: this.relations.map((r) => ({ ...r })),
    };
  }

  import(data: { concepts: Concept[]; relations: Relation[] }): void {
    this.concepts.clear();
    this.relations = [];
    for (const concept of data.concepts) {
      this.concepts.set(concept.name, {
        ...concept,
        properties: { ...concept.properties },
        relations: [...concept.relations],
      });
    }
    for (const relation of data.relations) {
      this.relations.push({ ...relation });
    }
  }

  clear(): void {
    this.concepts.clear();
    this.relations = [];
  }
}
