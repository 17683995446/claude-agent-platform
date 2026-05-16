// ============================================================
// Module 4: Knowledge Synthesis Engine
// Combines info from multiple sources, builds knowledge graph
// ============================================================

export type SourceType = 'code_analysis' | 'file_system' | 'documentation' | 'conversation_history' | 'web_search';

export interface KnowledgeSource {
  type: SourceType;
  content: string;
  metadata?: Record<string, string>;
  confidence: number;
  timestamp: number;
}

export interface KnowledgeFact {
  id: string;
  entity: string;
  attribute: string;
  value: string;
  source: SourceType;
  confidence: number;
  timestamp: number;
}

export interface KnowledgeNode {
  entity: string;
  attributes: Map<string, string>;
  relationships: { target: string; type: string; weight: number }[];
  facts: KnowledgeFact[];
}

export interface SynthesisResult {
  facts: KnowledgeFact[];
  contradictions: { fact1: KnowledgeFact; fact2: KnowledgeFact; resolution: string }[];
  summary: string;
  confidence: number;
  sourceCount: number;
}

interface KnowledgeEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

let factIdCounter = 0;
function newFactId(): string {
  return `fact_${++factIdCounter}_${Date.now()}`;
}

export class KnowledgeSynthesizer {
  private facts: KnowledgeFact[] = [];
  private nodes: Map<string, KnowledgeNode> = new Map();
  private edges: KnowledgeEdge[] = [];

  addKnowledge(fact: KnowledgeFact): void {
    // Check for duplicates
    const existing = this.facts.find(
      f => f.entity === fact.entity && f.attribute === fact.attribute && f.value === fact.value
    );
    if (existing) {
      // Update confidence if new fact is more confident
      if (fact.confidence > existing.confidence) {
        existing.confidence = fact.confidence;
        existing.timestamp = fact.timestamp;
      }
      return;
    }

    this.facts.push(fact);
    this.updateGraph(fact);
  }

  synthesize(sources: KnowledgeSource[]): SynthesisResult {
    const allFacts: KnowledgeFact[] = [];
    const contradictions: SynthesisResult['contradictions'] = [];

    for (const source of sources) {
      const extracted = this.extractFacts(source);
      allFacts.push(...extracted);
    }

    // Detect contradictions
    for (let i = 0; i < allFacts.length; i++) {
      for (let j = i + 1; j < allFacts.length; j++) {
        const f1 = allFacts[i];
        const f2 = allFacts[j];
        if (f1.entity === f2.entity && f1.attribute === f2.attribute && f1.value !== f2.value) {
          const resolution = f1.confidence >= f2.confidence
            ? `Resolved in favor of "${f1.value}" (confidence: ${f1.confidence})`
            : `Resolved in favor of "${f2.value}" (confidence: ${f2.confidence})`;
          contradictions.push({ fact1: f1, fact2: f2, resolution });
        }
      }
    }

    // Add non-contradicted facts
    const contradictedIds = new Set<string>();
    for (const c of contradictions) {
      if (c.fact1.confidence < c.fact2.confidence) contradictedIds.add(c.fact1.id);
      else contradictedIds.add(c.fact2.id);
    }

    for (const fact of allFacts) {
      if (!contradictedIds.has(fact.id)) {
        this.addKnowledge(fact);
      } else {
        this.addKnowledge({ ...fact, confidence: fact.confidence * 0.5 });
      }
    }

    const avgConfidence = allFacts.length > 0
      ? allFacts.reduce((s, f) => s + f.confidence, 0) / allFacts.length
      : 0;

    const entityCount = new Set(allFacts.map(f => f.entity)).size;

    return {
      facts: allFacts,
      contradictions,
      summary: `Synthesized ${allFacts.length} facts from ${sources.length} sources across ${entityCount} entities. Found ${contradictions.length} contradictions.`,
      confidence: avgConfidence,
      sourceCount: sources.length,
    };
  }

  queryGraph(query: string): KnowledgeNode[] {
    const normalizedQuery = query.toLowerCase();
    const results: KnowledgeNode[] = [];

    for (const [entity, node] of this.nodes) {
      if (
        entity.toLowerCase().includes(normalizedQuery) ||
        Array.from(node.attributes.values()).some(v => v.toLowerCase().includes(normalizedQuery))
      ) {
        results.push(node);
      }
    }

    return results;
  }

  getRelatedKnowledge(entity: string): KnowledgeFact[] {
    const node = this.nodes.get(entity);
    if (!node) return this.facts.filter(f => f.entity.toLowerCase().includes(entity.toLowerCase()));

    // Get facts for this entity and related entities
    const relatedEntities = new Set<string>([entity]);
    for (const edge of this.edges) {
      if (edge.source === entity) relatedEntities.add(edge.target);
      if (edge.target === entity) relatedEntities.add(edge.source);
    }

    return this.facts.filter(f => relatedEntities.has(f.entity));
  }

  getFactCount(): number {
    return this.facts.length;
  }

  clear(): void {
    this.facts = [];
    this.nodes.clear();
    this.edges = [];
  }

  private updateGraph(fact: KnowledgeFact): void {
    // Create or update node
    if (!this.nodes.has(fact.entity)) {
      this.nodes.set(fact.entity, {
        entity: fact.entity,
        attributes: new Map(),
        relationships: [],
        facts: [],
      });
    }

    const node = this.nodes.get(fact.entity)!;
    node.attributes.set(fact.attribute, fact.value);
    node.facts.push(fact);

    // Extract relationships from value if it references another entity
    for (const [otherEntity] of this.nodes) {
      if (otherEntity !== fact.entity && fact.value.includes(otherEntity)) {
        this.edges.push({
          source: fact.entity,
          target: otherEntity,
          type: fact.attribute,
          weight: fact.confidence,
        });
        node.relationships.push({ target: otherEntity, type: fact.attribute, weight: fact.confidence });
      }
    }
  }

  private extractFacts(source: KnowledgeSource): KnowledgeFact[] {
    const facts: KnowledgeFact[] = [];
    const lines = source.content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Try to extract entity-attribute-value patterns
      // Pattern: "X is Y", "X has Y", "X: Y", "X = Y"
      const patterns = [
        /^(\w+)\s+(?:is|are|was|were)\s+(.+)/i,
        /^(\w+)\s+(?:has|have|had)\s+(.+)/i,
        /^(\w+):\s*(.+)/,
        /^(\w+)\s*=\s*(.+)/,
      ];

      for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (match) {
          facts.push({
            id: newFactId(),
            entity: match[1],
            attribute: this.inferAttribute(match[2]),
            value: match[2].trim(),
            source: source.type,
            confidence: source.confidence,
            timestamp: source.timestamp,
          });
          break;
        }
      }
    }

    // If no structured facts found, create a general fact from the whole content
    if (facts.length === 0 && source.content.trim()) {
      facts.push({
        id: newFactId(),
        entity: this.extractMainEntity(source.content),
        attribute: 'description',
        value: source.content.trim().slice(0, 500),
        source: source.type,
        confidence: source.confidence * 0.7,
        timestamp: source.timestamp,
      });
    }

    return facts;
  }

  private inferAttribute(value: string): string {
    const lower = value.toLowerCase();
    if (lower.includes('type') || lower.includes('kind')) return 'type';
    if (lower.includes('version')) return 'version';
    if (lower.includes('location') || lower.includes('path')) return 'location';
    if (lower.includes('purpose') || lower.includes('role')) return 'purpose';
    if (lower.includes('depend')) return 'dependency';
    return 'property';
  }

  private extractMainEntity(content: string): string {
    // Extract the first significant word as entity
    const words = content.split(/[\s,;.]+/).filter(w => w.length > 2);
    return words[0] || 'unknown';
  }
}
