/**
 * TripleStore - RDF-style triple storage.
 *
 * Provides an in-memory triple store with subject/predicate/object indexing,
 * pattern-based querying, and a simplified SPARQL-like query interface.
 */

/** Represents an RDF triple */
export interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

/** Triple pattern for querying (undefined = wildcard) */
export interface TriplePattern {
  subject?: string;
  predicate?: string;
  object?: string;
}

/** SPARQL-like query result */
export interface SparqlResult {
  variables: string[];
  bindings: Record<string, string>[];
}

/**
 * TripleStore provides RDF-style triple storage with pattern-based querying.
 *
 * @example
 * ```typescript
 * const store = new TripleStore();
 * store.addTriple('Alice', 'knows', 'Bob');
 * store.addTriple('Alice', 'age', '30');
 * const results = store.query({ subject: 'Alice' });
 * ```
 */
export class TripleStore {
  private triples: Set<string> = new Set();
  private bySubject: Map<string, Set<string>> = new Map();
  private byPredicate: Map<string, Set<string>> = new Map();
  private byObject: Map<string, Set<string>> = new Map();
  private maxTriples: number;

  /**
   * Create a new TripleStore.
   * @param maxTriples - Maximum number of triples (0 for unlimited, default 0)
   */
  constructor(maxTriples: number = 0) {
    this.maxTriples = maxTriples;
  }

  /**
   * Add a triple to the store.
   * @param subject - Subject URI or identifier
   * @param predicate - Predicate URI or identifier
   * @param object - Object URI or literal value
   * @returns true if the triple was added, false if it already existed
   */
  addTriple(subject: string, predicate: string, object: string): boolean {
    if (this.maxTriples > 0 && this.triples.size >= this.maxTriples) {
      return false;
    }

    const key = this.tripleKey(subject, predicate, object);
    if (this.triples.has(key)) return false;

    this.triples.add(key);

    // Index by subject
    if (!this.bySubject.has(subject)) this.bySubject.set(subject, new Set());
    this.bySubject.get(subject)!.add(key);

    // Index by predicate
    if (!this.byPredicate.has(predicate)) this.byPredicate.set(predicate, new Set());
    this.byPredicate.get(predicate)!.add(key);

    // Index by object
    if (!this.byObject.has(object)) this.byObject.set(object, new Set());
    this.byObject.get(object)!.add(key);

    return true;
  }

  /**
   * Remove triples matching a pattern.
   * @param pattern - Triple pattern (undefined fields act as wildcards)
   * @returns Number of triples removed
   */
  removeTriple(pattern: TriplePattern): number {
    const matching = this.findMatchingKeys(pattern);
    let count = 0;

    for (const key of matching) {
      const triple = this.parseKey(key);
      this.triples.delete(key);

      // Remove from subject index
      const subjSet = this.bySubject.get(triple.subject);
      if (subjSet) {
        subjSet.delete(key);
        if (subjSet.size === 0) this.bySubject.delete(triple.subject);
      }

      // Remove from predicate index
      const predSet = this.byPredicate.get(triple.predicate);
      if (predSet) {
        predSet.delete(key);
        if (predSet.size === 0) this.byPredicate.delete(triple.predicate);
      }

      // Remove from object index
      const objSet = this.byObject.get(triple.object);
      if (objSet) {
        objSet.delete(key);
        if (objSet.size === 0) this.byObject.delete(triple.object);
      }

      count++;
    }

    return count;
  }

  /**
   * Query triples matching a pattern.
   * @param pattern - Triple pattern (undefined fields act as wildcards)
   * @returns Array of matching triples
   */
  query(pattern: TriplePattern): Triple[] {
    const matching = this.findMatchingKeys(pattern);
    return Array.from(matching).map(key => this.parseKey(key));
  }

  /**
   * Execute a simplified SPARQL-like query.
   * Supports basic SELECT WHERE patterns with triple patterns.
   *
   * @param query - SPARQL-like query string
   * @returns Query result with variables and bindings
   *
   * @example
   * ```typescript
   * const result = store.sparql('SELECT ?friend WHERE { ?s knows ?friend }');
   * ```
   */
  sparql(query: string): SparqlResult {
    // Parse simplified SPARQL: SELECT ?vars WHERE { ?s ?p ?o }
    const selectMatch = query.match(/SELECT\s+([\?\w\s,]+)/i);
    const whereMatch = query.match(/WHERE\s*\{(.+)\}/i);

    if (!selectMatch || !whereMatch) {
      return { variables: [], bindings: [] };
    }

    const variables = selectMatch[1]
      .trim()
      .split(/[,\s]+/)
      .map(v => v.replace(/^\?/, '').replace(/^["']|["']$/g, ''))
      .filter(Boolean);

    // Normalize variable names: ensure consistent casing and no extra whitespace
    const normalizedVariables = variables.map(v => v.trim());

    const whereClause = whereMatch[1].trim();
    const triplePatterns = this.parseWhereClause(whereClause);

    // Execute each triple pattern and join results
    let bindings: Record<string, string>[] = [{}];

    for (const tp of triplePatterns) {
      const newBindings: Record<string, string>[] = [];

      for (const existingBinding of bindings) {
        // Substitute bound variables
        const pattern: TriplePattern = {};
        for (const [key, value] of Object.entries(tp)) {
          if (value.startsWith('?')) {
            const varName = value.slice(1);
            if (existingBinding[varName] !== undefined) {
              (pattern as Record<string, string>)[key] = existingBinding[varName];
            }
            // else: unbound variable, leave as wildcard
          } else {
            (pattern as Record<string, string>)[key] = value;
          }
        }

        const results = this.query(pattern);

        for (const triple of results) {
          const newBinding = { ...existingBinding };

          for (const [key, value] of Object.entries(tp)) {
            if (value.startsWith('?')) {
              const varName = value.slice(1);
              if (newBinding[varName] === undefined) {
                newBinding[varName] = (triple as Record<string, string>)[key];
              }
            }
          }

          newBindings.push(newBinding);
        }
      }

      bindings = newBindings;
    }

    // Project only requested variables
    const projected = bindings.map(binding => {
      const projected: Record<string, string> = {};
      for (const v of normalizedVariables) {
        if (binding[v] !== undefined) {
          projected[v] = binding[v];
        }
      }
      return projected;
    });

    return { variables: normalizedVariables, bindings: projected };
  }

  /**
   * Get all triples with a specific subject.
   * @param s - Subject URI or identifier
   * @returns Array of triples with the given subject
   */
  getTriplesBySubject(s: string): Triple[] {
    return this.query({ subject: s });
  }

  /**
   * Get all triples with a specific predicate.
   * @param p - Predicate URI or identifier
   * @returns Array of triples with the given predicate
   */
  getTriplesByPredicate(p: string): Triple[] {
    return this.query({ predicate: p });
  }

  /**
   * Get all triples with a specific object.
   * @param o - Object URI or literal value
   * @returns Array of triples with the given object
   */
  getTriplesByObject(o: string): Triple[] {
    return this.query({ object: o });
  }

  /**
   * Count the total number of triples in the store.
   */
  countTriples(): number {
    return this.triples.size;
  }

  /**
   * Clear all triples from the store.
   */
  clear(): void {
    this.triples.clear();
    this.bySubject.clear();
    this.byPredicate.clear();
    this.byObject.clear();
  }

  /**
   * Generate a unique key for a triple.
   */
  private tripleKey(subject: string, predicate: string, object: string): string {
    // Use JSON serialization to avoid delimiter collision with any character
    // Format: JSON([subject, predicate, object])
    return JSON.stringify([subject, predicate, object]);
  }

  /**
   * Parse a triple key back into its components.
   */
  private parseKey(key: string): Triple {
    const parts = JSON.parse(key) as [string, string, string];
    return {
      subject: parts[0],
      predicate: parts[1],
      object: parts[2],
    };
  }

  /**
   * Find all triple keys matching a pattern.
   */
  private findMatchingKeys(pattern: TriplePattern): Set<string> {
    // Use the most selective index
    let candidateKeys: Set<string> | null = null;

    if (pattern.subject !== undefined) {
      candidateKeys = this.bySubject.get(pattern.subject) || new Set();
    } else if (pattern.predicate !== undefined) {
      candidateKeys = this.byPredicate.get(pattern.predicate) || new Set();
    } else if (pattern.object !== undefined) {
      candidateKeys = this.byObject.get(pattern.object) || new Set();
    }

    if (candidateKeys === null) {
      candidateKeys = new Set(this.triples);
    }

    // Filter by remaining pattern components
    const result = new Set<string>();
    for (const key of candidateKeys) {
      const triple = this.parseKey(key);
      if (
        (pattern.subject === undefined || triple.subject === pattern.subject) &&
        (pattern.predicate === undefined || triple.predicate === pattern.predicate) &&
        (pattern.object === undefined || triple.object === pattern.object)
      ) {
        result.add(key);
      }
    }

    return result;
  }

  /**
   * Parse a WHERE clause into triple patterns.
   */
  private parseWhereClause(clause: string): TriplePattern[] {
    // Split by '.' to get individual triple patterns
    const statements = clause.split('.').map(s => s.trim()).filter(Boolean);
    const patterns: TriplePattern[] = [];

    for (const stmt of statements) {
      const parts = this.tokenizeSparqlParts(stmt);
      if (parts.length >= 3) {
        patterns.push({
          subject: parts[0],
          predicate: parts[1],
          object: parts[2],
        });
      }
    }

    return patterns;
  }

  /**
   * Tokenize a SPARQL triple pattern, handling quoted strings.
   */
  private tokenizeSparqlParts(stmt: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < stmt.length; i++) {
      const char = stmt[i];
      if (char === '"') {
        inQuotes = !inQuotes;
        current += char;
      } else if (char === ' ' && !inQuotes) {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }
}
