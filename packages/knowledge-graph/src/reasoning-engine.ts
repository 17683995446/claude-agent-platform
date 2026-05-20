/**
 * ReasoningEngine - Logical reasoning over knowledge graphs.
 *
 * Provides forward chaining, backward chaining, abductive reasoning,
 * default reasoning, temporal reasoning, and explanation capabilities.
 */

import { GraphStore, GraphNode } from './graph-store.js';

/** A logical fact */
export interface Fact {
  id: string;
  predicate: string;
  subject: string;
  object: string;
  confidence?: number;
  source?: string;
}

/** A logical rule */
export interface Rule {
  id: string;
  name: string;
  conditions: Array<{ predicate: string; subject: string; object: string; negated?: boolean }>;
  conclusion: { predicate: string; subject: string; object: string };
  confidence?: number;
}

/** Forward chaining result */
export interface ForwardChainResult {
  newFacts: Fact[];
  iterations: number;
}

/** Backward chaining result */
export interface BackwardChainResult {
  proven: boolean;
  proofChain: Fact[];
  depth: number;
}

/** Abductive reasoning result */
export interface AbductiveResult {
  hypotheses: Array<{
    hypothesis: string;
    confidence: number;
    supportingFacts: string[];
  }>;
}

/** Default reasoning result */
export interface DefaultReasoningResult {
  conclusions: Fact[];
  appliedDefaults: string[];
}

/** Temporal event */
export interface TemporalEvent {
  id: string;
  time: number;
  predicate: string;
  subject: string;
  object: string;
}

/** Temporal reasoning result */
export interface TemporalReasoningResult {
  results: Array<{
    fact: string;
    time: number;
    confidence: number;
  }>;
}

/** Explanation result */
export interface ExplanationResult {
  fact: string;
  explanation: string[];
  rules: string[];
  confidence: number;
}

/**
 * ReasoningEngine provides logical reasoning capabilities over knowledge graphs.
 *
 * @example
 * ```typescript
 * const engine = new ReasoningEngine(store);
 * const facts = [
 *   { id: '1', predicate: 'isParentOf', subject: 'Alice', object: 'Bob' },
 *   { id: '2', predicate: 'isParentOf', subject: 'Bob', object: 'Charlie' },
 * ];
 * const rules = [{
 *   id: 'r1', name: 'grandparent',
 *   conditions: [
 *     { predicate: 'isParentOf', subject: '?X', object: '?Y' },
 *     { predicate: 'isParentOf', subject: '?Y', object: '?Z' },
 *   ],
 *   conclusion: { predicate: 'isGrandparentOf', subject: '?X', object: '?Z' },
 * }];
 * const result = engine.forwardChain(facts, rules);
 * ```
 */
export class ReasoningEngine {
  private store: GraphStore;

  constructor(store?: GraphStore) {
    this.store = store || new GraphStore();
  }

  /**
   * Forward chaining: derive new facts from existing facts and rules.
   * @param facts - Initial set of facts
   * @param rules - Set of inference rules
   * @param maxIterations - Maximum number of iterations (default 100)
   * @returns Forward chaining result with new facts
   */
  forwardChain(facts: Fact[], rules: Rule[], maxIterations: number = 100): ForwardChainResult {
    const allFacts = new Map<string, Fact>();
    for (const fact of facts) {
      allFacts.set(this.factKey(fact), fact);
    }

    const newFacts: Fact[] = [];
    let iterations = 0;

    for (let iter = 0; iter < maxIterations; iter++) {
      if (rules.length === 0) break;
      let derived = false;

      for (const rule of rules) {
        // Try to match rule conditions against known facts
        const bindings = this.matchRuleConditions(rule.conditions, allFacts);

        for (const binding of bindings) {
          const conclusion = this.substitute(rule.conclusion, binding);
          if (!conclusion) continue; // Skip if unbound variables
          const key = this.factKey({
            id: `derived_${newFacts.length}`,
            predicate: conclusion.predicate,
            subject: conclusion.subject,
            object: conclusion.object,
          });

          if (!allFacts.has(key)) {
            const newFact: Fact = {
              id: `derived_${newFacts.length}`,
              predicate: conclusion.predicate,
              subject: conclusion.subject,
              object: conclusion.object,
              confidence: rule.confidence,
              source: rule.id,
            };
            allFacts.set(key, newFact);
            newFacts.push(newFact);
            derived = true;
          }
        }
      }

      iterations++;
      if (!derived) break;
    }

    return { newFacts, iterations };
  }

  /**
   * Forward-derive all possible facts from given facts and rules iteratively.
   * Also generates transitive closure rules to enable multi-step reasoning.
   */
  private forwardDerive(facts: Map<string, Fact>, rules: Rule[], maxIterations: number = 100): void {
    // Build extended rule set: for each rule, also create a transitive closure rule
    // e.g., if parent(X,Y) + parent(Y,Z) -> grandparent(X,Z), also add
    // grandparent(X,Y) + parent(Y,Z) -> grandparent(X,Z)
    const extendedRules = [...rules];
    for (const rule of rules) {
      if (rule.conditions.length >= 2) {
        const lastCond = rule.conditions[rule.conditions.length - 1];
        const transitiveRule: Rule = {
          id: `${rule.id}_transitive`,
          name: `${rule.name}-transitive`,
          conditions: [
            { predicate: rule.conclusion.predicate, subject: '?A', object: '?B' },
            { predicate: lastCond.predicate, subject: '?B', object: '?C' },
          ],
          conclusion: { predicate: rule.conclusion.predicate, subject: '?A', object: '?C' },
          confidence: rule.confidence,
        };
        extendedRules.push(transitiveRule);
      }
    }

    let derived = true;
    let iterations = 0;
    while (derived && iterations < maxIterations) {
      derived = false;
      iterations++;
      for (const rule of extendedRules) {
        const bindings = this.matchRuleConditions(rule.conditions, facts);
        for (const binding of bindings) {
          const conclusion = this.substitute(rule.conclusion, binding);
          if (!conclusion) continue;
          const key = this.factKey({
            id: 'derived',
            predicate: conclusion.predicate,
            subject: conclusion.subject,
            object: conclusion.object,
          });
          if (!facts.has(key)) {
            const newFact: Fact = {
              id: 'derived',
              predicate: conclusion.predicate,
              subject: conclusion.subject,
              object: conclusion.object,
              confidence: rule.confidence,
              source: rule.id,
            };
            facts.set(key, newFact);
            derived = true;
          }
        }
      }
    }
  }

  /**
   * Backward chaining: prove a goal by finding supporting facts and rules.
   * @param goal - The goal to prove (predicate, subject, object)
   * @param facts - Available facts
   * @param rules - Available rules
   * @param maxDepth - Maximum recursion depth (default 10)
   * @returns Backward chaining result
   */
  backwardChain(
    goal: { predicate: string; subject: string; object: string },
    facts: Fact[],
    rules: Rule[],
    maxDepth: number = 10
  ): BackwardChainResult {
    const factMap = new Map<string, Fact>();
    for (const fact of facts) {
      factMap.set(this.factKey(fact), fact);
    }

    // Pre-derive all possible facts via forward chaining so intermediate
    // facts are available during backward chaining.
    this.forwardDerive(factMap, rules, 50);

    const proofChain: Fact[] = [];
    const visited = new Set<string>();

    const result = this.prove(goal, factMap, rules, proofChain, visited, maxDepth, 0);

    return {
      proven: result,
      proofChain,
      depth: proofChain.length,
    };
  }

  /**
   * Abductive reasoning: find hypotheses that explain observations.
   * @param observations - Observed facts
   * @param hypotheses - Candidate hypotheses
   * @returns Ranked hypotheses with confidence scores
   */
  abductiveReason(observations: Fact[], hypotheses: string[]): AbductiveResult {
    const results: AbductiveResult['hypotheses'] = [];

    for (const hypothesis of hypotheses) {
      // Score each hypothesis based on how many observations it could explain
      let score = 0;
      const supporting: string[] = [];

      for (const obs of observations) {
        // Simple heuristic: hypothesis is related if it shares terms with observation
        const hypTerms = hypothesis.toLowerCase().split(/\s+/);
        const obsTerms = `${obs.subject} ${obs.predicate} ${obs.object}`.toLowerCase().split(/\s+/);
        const overlap = hypTerms.filter(t => obsTerms.includes(t)).length;

        if (overlap > 0) {
          score += overlap;
          supporting.push(`${obs.subject} ${obs.predicate} ${obs.object}`);
        }
      }

      const confidence = observations.length > 0 ? Math.min(score / observations.length, 1) : 0;

      results.push({
        hypothesis,
        confidence,
        supportingFacts: supporting,
      });
    }

    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);

    return { hypotheses: results };
  }

  /**
   * Default reasoning: apply default rules when no specific information is available.
   * @param facts - Known facts
   * @param defaults - Default rules (predicate -> default value)
   * @returns Conclusions with applied defaults
   */
  defaultReasoning(
    facts: Fact[],
    defaults: Array<{ predicate: string; subject: string; object: string }>
  ): DefaultReasoningResult {
    const factMap = new Map<string, Fact>();
    for (const fact of facts) {
      factMap.set(this.factKey(fact), fact);
    }

    const conclusions: Fact[] = [];
    const appliedDefaults: string[] = [];

    for (const defaultRule of defaults) {
      const key = this.factKey({
        id: '',
        predicate: defaultRule.predicate,
        subject: defaultRule.subject,
        object: defaultRule.object,
      });

      if (!factMap.has(key)) {
        const conclusion: Fact = {
          id: `default_${conclusions.length}`,
          predicate: defaultRule.predicate,
          subject: defaultRule.subject,
          object: defaultRule.object,
          confidence: 0.5, // Lower confidence for defaults
          source: 'default',
        };
        conclusions.push(conclusion);
        appliedDefaults.push(`${defaultRule.subject} ${defaultRule.predicate} ${defaultRule.object}`);
      }
    }

    return { conclusions, appliedDefaults };
  }

  /**
   * Temporal reasoning: reason about events in time.
   * @param events - Temporal events
   * @param query - Query predicate to reason about
   * @returns Temporal reasoning results
   */
  temporalReasoning(events: TemporalEvent[], query: string): TemporalReasoningResult {
    const results: TemporalReasoningResult['results'] = [];

    // Sort events by time
    const sorted = [...events].sort((a, b) => a.time - b.time);

    // Find events matching the query predicate
    const matching = sorted.filter(e => e.predicate === query);

    for (const event of matching) {
      // Calculate confidence based on recency and supporting events
      const maxTime = sorted.length > 0 ? sorted[sorted.length - 1].time : 0;
      const recency = maxTime > 0 ? 1 - (maxTime - event.time) / (maxTime - (sorted[0]?.time || 0) || 1) : 1;

      // Find supporting events (same subject/object within nearby time)
      const supporting = sorted.filter(e =>
        e.id !== event.id &&
        (e.subject === event.subject || e.object === event.object) &&
        Math.abs(e.time - event.time) <= 10
      );

      const confidence = Math.min(recency + supporting.length * 0.1, 1);

      results.push({
        fact: `${event.subject} ${event.predicate} ${event.object}`,
        time: event.time,
        confidence,
      });
    }

    return { results };
  }

  /**
   * Explain why a fact holds by tracing through rules.
   * @param fact - The fact to explain
   * @param rules - Available rules
   * @returns Explanation with rule chain and confidence
   */
  explain(fact: Fact, rules: Rule[]): ExplanationResult {
    const explanation: string[] = [];
    const usedRules: string[] = [];
    let confidence = fact.confidence || 1.0;

    // Find rules that could produce this fact
    for (const rule of rules) {
      const conclusion = rule.conclusion;
      if (
        conclusion.predicate === fact.predicate &&
        (conclusion.subject === fact.subject || conclusion.subject.startsWith('?')) &&
        (conclusion.object === fact.object || conclusion.object.startsWith('?'))
      ) {
        explanation.push(`Rule "${rule.name}" concludes: ${conclusion.subject} ${conclusion.predicate} ${conclusion.object}`);
        usedRules.push(rule.id);

        // Add condition descriptions
        for (const cond of rule.conditions) {
          explanation.push(`  Condition: ${cond.subject} ${cond.predicate} ${cond.object}`);
        }

        if (rule.confidence !== undefined) {
          confidence *= rule.confidence;
        }
      }
    }

    if (explanation.length === 0) {
      explanation.push(`Fact is directly asserted: ${fact.subject} ${fact.predicate} ${fact.object}`);
    }

    return {
      fact: `${fact.subject} ${fact.predicate} ${fact.object}`,
      explanation,
      rules: usedRules,
      confidence,
    };
  }

  /**
   * Generate a unique key for a fact.
   */
  private factKey(fact: Fact): string {
    return `${fact.subject}|${fact.predicate}|${fact.object}`;
  }

  /**
   * Match rule conditions against known facts, returning variable bindings.
   * Uses predicate indexing for efficient matching.
   */
  private matchRuleConditions(
    conditions: Rule['conditions'],
    facts: Map<string, Fact>
  ): Map<string, string>[] {
    if (conditions.length === 0) return [new Map()];

    // Build predicate index for faster matching
    const predicateIndex = new Map<string, Fact[]>();
    for (const fact of facts.values()) {
      let list = predicateIndex.get(fact.predicate);
      if (!list) {
        list = [];
        predicateIndex.set(fact.predicate, list);
      }
      list.push(fact);
    }

    const [first, ...rest] = conditions;
    const bindings = this.matchConditionIndexed(first, facts, predicateIndex);
    const results: Map<string, string>[] = [];

    for (const binding of bindings) {
      const remainingBindings = this.matchWithBindingIndexed(rest, facts, predicateIndex, binding);
      results.push(...remainingBindings);
    }

    return results;
  }

  /**
   * Match a single condition against facts using predicate index.
   */
  private matchConditionIndexed(
    condition: Rule['conditions'][0],
    _facts: Map<string, Fact>,
    predicateIndex: Map<string, Fact[]>
  ): Map<string, string>[] {
    const bindings: Map<string, string>[] = [];

    // If condition predicate is a variable, check all facts
    if (condition.predicate.startsWith('?')) {
      for (const fact of _facts.values()) {
        const binding = this.tryMatch(condition, fact);
        if (binding) {
          bindings.push(binding);
        }
      }
    } else {
      // Only check facts with matching predicate
      const matchingFacts = predicateIndex.get(condition.predicate);
      if (matchingFacts) {
        for (const fact of matchingFacts) {
          const binding = this.tryMatch(condition, fact);
          if (binding) {
            bindings.push(binding);
          }
        }
      }
    }

    return bindings;
  }

  /**
   * Match remaining conditions with an existing binding using predicate index.
   */
  private matchWithBindingIndexed(
    conditions: Rule['conditions'],
    _facts: Map<string, Fact>,
    predicateIndex: Map<string, Fact[]>,
    existingBinding: Map<string, string>
  ): Map<string, string>[] {
    if (conditions.length === 0) return [existingBinding];

    const [first, ...rest] = conditions;
    const results: Map<string, string>[] = [];

    // If condition predicate is a variable, check all facts
    if (first.predicate.startsWith('?')) {
      for (const fact of _facts.values()) {
        const binding = this.tryMatchWithBinding(first, fact, existingBinding);
        if (binding) {
          results.push(...this.matchWithBindingIndexed(rest, _facts, predicateIndex, binding));
        }
      }
    } else {
      // Only check facts with matching predicate
      const matchingFacts = predicateIndex.get(first.predicate);
      if (matchingFacts) {
        for (const fact of matchingFacts) {
          const binding = this.tryMatchWithBinding(first, fact, existingBinding);
          if (binding) {
            results.push(...this.matchWithBindingIndexed(rest, _facts, predicateIndex, binding));
          }
        }
      }
    }

    return results;
  }

  /**
   * Try to match a condition against a fact, returning variable bindings or null.
   */
  private tryMatch(
    condition: Rule['conditions'][0],
    fact: Fact
  ): Map<string, string> | null {
    const binding = new Map<string, string>();

    const pairs: Array<[string, string]> = [
      [condition.subject, fact.subject],
      [condition.predicate, fact.predicate],
      [condition.object, fact.object],
    ];

    for (const [pattern, value] of pairs) {
      if (pattern.startsWith('?')) {
        const varName = pattern.slice(1);
        if (binding.has(varName)) {
          if (binding.get(varName) !== value) return null;
        } else {
          binding.set(varName, value);
        }
      } else if (pattern !== value) {
        return null;
      }
    }

    return binding;
  }

  /**
   * Match remaining conditions with an existing binding.
   */
  private matchWithBinding(
    conditions: Rule['conditions'],
    facts: Map<string, Fact>,
    existingBinding: Map<string, string>
  ): Map<string, string>[] {
    if (conditions.length === 0) return [existingBinding];

    const [first, ...rest] = conditions;
    const results: Map<string, string>[] = [];

    for (const fact of facts.values()) {
      const binding = this.tryMatchWithBinding(first, fact, existingBinding);
      if (binding) {
        results.push(...this.matchWithBinding(rest, facts, binding));
      }
    }

    return results;
  }

  /**
   * Try to match a condition against a fact with existing bindings.
   */
  private tryMatchWithBinding(
    condition: Rule['conditions'][0],
    fact: Fact,
    existingBinding: Map<string, string>
  ): Map<string, string> | null {
    const binding = new Map(existingBinding);

    const pairs: Array<[string, string]> = [
      [condition.subject, fact.subject],
      [condition.predicate, fact.predicate],
      [condition.object, fact.object],
    ];

    for (const [pattern, value] of pairs) {
      if (pattern.startsWith('?')) {
        const varName = pattern.slice(1);
        if (binding.has(varName)) {
          if (binding.get(varName) !== value) return null;
        } else {
          binding.set(varName, value);
        }
      } else if (pattern !== value) {
        return null;
      }
    }

    return binding;
  }

  /**
   * Substitute variables in a pattern with bindings.
   */
  private substitute(
    pattern: { predicate: string; subject: string; object: string },
    binding: Map<string, string>
  ): { predicate: string; subject: string; object: string } | null {
    const subst = (val: string): string | null => {
      if (val.startsWith('?')) {
        const bound = binding.get(val.slice(1));
        if (bound === undefined) return null; // Unbound variable
        return bound;
      }
      return val;
    };

    const predicate = subst(pattern.predicate);
    const subject = subst(pattern.subject);
    const object = subst(pattern.object);

    // If any variable is unbound, skip this conclusion
    if (predicate === null || subject === null || object === null) return null;

    return { predicate, subject, object };
  }

  /**
   * Recursively prove a goal using backward chaining.
   */
  private prove(
    goal: { predicate: string; subject: string; object: string },
    facts: Map<string, Fact>,
    rules: Rule[],
    proofChain: Fact[],
    visited: Set<string>,
    maxDepth: number,
    currentDepth: number
  ): boolean {
    if (currentDepth >= maxDepth) return false;

    // Check if goal has unbound variables (starts with ?)
    const hasVars = goal.subject.startsWith('?') || goal.object.startsWith('?') || goal.predicate.startsWith('?');

    if (hasVars) {
      // For goals with unbound variables, try all possible matches from facts
      for (const fact of facts.values()) {
        const binding = new Map<string, string>();
        let matches = true;

        if (goal.predicate.startsWith('?')) {
          const varName = goal.predicate.slice(1);
          binding.set(varName, fact.predicate);
        } else if (goal.predicate !== fact.predicate) {
          continue;
        }

        if (goal.subject.startsWith('?')) {
          const varName = goal.subject.slice(1);
          if (binding.has(varName)) {
            if (binding.get(varName) !== fact.subject) { matches = false; }
          } else {
            binding.set(varName, fact.subject);
          }
        } else if (goal.subject !== fact.subject) {
          continue;
        }

        if (goal.object.startsWith('?')) {
          const varName = goal.object.slice(1);
          if (binding.has(varName)) {
            if (binding.get(varName) !== fact.object) { matches = false; }
          } else {
            binding.set(varName, fact.object);
          }
        } else if (goal.object !== fact.object) {
          continue;
        }

        if (!matches) continue;

        // Try to prove with this binding
        const boundGoal = {
          predicate: goal.predicate.startsWith('?') ? fact.predicate : goal.predicate,
          subject: goal.subject.startsWith('?') ? fact.subject : goal.subject,
          object: goal.object.startsWith('?') ? fact.object : goal.object,
        };

        if (this.prove(boundGoal, facts, rules, proofChain, visited, maxDepth, currentDepth + 1)) {
          return true;
        }
      }
      return false;
    }

    const goalKey = `${goal.subject}|${goal.predicate}|${goal.object}`;
    if (visited.has(goalKey)) return false;
    visited.add(goalKey);

    // Check if goal is directly in facts
    for (const fact of facts.values()) {
      if (
        fact.predicate === goal.predicate &&
        fact.subject === goal.subject &&
        fact.object === goal.object
      ) {
        proofChain.push(fact);
        visited.delete(goalKey); // Backtrack: allow other proof paths
        return true;
      }
    }

    // Try to prove via rules
    for (const rule of rules) {
      // Check if rule conclusion matches goal
      const conclusion = rule.conclusion;
      if (conclusion.predicate !== goal.predicate) continue;

      // Try to unify conclusion with goal
      const binding = new Map<string, string>();
      let unifiable = true;

      const conclusionPairs: Array<[string, string]> = [
        [conclusion.subject, goal.subject],
        [conclusion.object, goal.object],
      ];

      for (const [pattern, value] of conclusionPairs) {
        if (pattern.startsWith('?')) {
          const varName = pattern.slice(1);
          if (binding.has(varName)) {
            if (binding.get(varName) !== value) {
              unifiable = false;
              break;
            }
          } else {
            binding.set(varName, value);
          }
        } else if (pattern !== value) {
          unifiable = false;
          break;
        }
      }

      if (!unifiable) continue;

      // Save proof chain length to backtrack on failure
      const savedLength = proofChain.length;

      // Try to prove all conditions, handling unbound variables
      let allProven = this.proveConditions(rule.conditions, binding, facts, rules, proofChain, visited, maxDepth, currentDepth + 1);
      if (allProven) {
        visited.delete(goalKey); // Backtrack: allow other proof paths
        return true;
      }

      // Clear proof chain entries from this failed branch
      proofChain.length = savedLength;
    }

    return false;
  }

  /**
   * Try to prove all conditions of a rule with a given binding.
   */
  private proveConditions(
    conditions: Rule['conditions'],
    binding: Map<string, string>,
    facts: Map<string, Fact>,
    rules: Rule[],
    proofChain: Fact[],
    visited: Set<string>,
    maxDepth: number,
    currentDepth: number
  ): boolean {
    if (conditions.length === 0) return true;

    const [first, ...rest] = conditions;
    const substCondition = this.substitute(first, binding);

    // Handle negated conditions (negation-as-failure)
    if (first.negated) {
      // For negated conditions, we need to prove the condition is NOT true
      if (substCondition === null) {
        // Has unbound variables - try all possible bindings
        const partialSubst = (val: string): string => {
          if (val.startsWith('?')) {
            const bound = binding.get(val.slice(1));
            return bound !== undefined ? bound : val;
          }
          return val;
        };

        const partialCondition = {
          predicate: partialSubst(first.predicate),
          subject: partialSubst(first.subject),
          object: partialSubst(first.object),
        };

        // If there are still unbound variables, skip negation check (treat as satisfied)
        if (partialCondition.subject.startsWith('?') || partialCondition.object.startsWith('?') || partialCondition.predicate.startsWith('?')) {
          return this.proveConditions(rest, binding, facts, rules, proofChain, visited, maxDepth, currentDepth);
        }

        // Check if the negated condition can be proven
        const negatedGoal = {
          predicate: partialCondition.predicate,
          subject: partialCondition.subject,
          object: partialCondition.object,
        };

        const canProve = this.prove(negatedGoal, facts, rules, proofChain, visited, maxDepth, currentDepth);
        if (!canProve) {
          // Negation satisfied: the condition is not provable
          return this.proveConditions(rest, binding, facts, rules, proofChain, visited, maxDepth, currentDepth);
        }
        return false; // Negation failed: the condition IS provable
      } else {
        // Fully substituted negated condition
        const canProve = this.prove(substCondition, facts, rules, proofChain, visited, maxDepth, currentDepth);
        if (!canProve) {
          // Negation satisfied
          return this.proveConditions(rest, binding, facts, rules, proofChain, visited, maxDepth, currentDepth);
        }
        return false;
      }
    }

    // If substitute returned null (unbound variable in condition),
    // try all possible bindings from facts
    if (substCondition === null) {
      // Build a partially substituted condition (keep unbound vars as-is)
      const partialSubst = (val: string): string => {
        if (val.startsWith('?')) {
          const bound = binding.get(val.slice(1));
          return bound !== undefined ? bound : val;
        }
        return val;
      };

      const partialCondition = {
        predicate: partialSubst(first.predicate),
        subject: partialSubst(first.subject),
        object: partialSubst(first.object),
      };

      for (const fact of facts.values()) {
        const newBinding = new Map(binding);
        let matches = true;

        if (partialCondition.predicate !== fact.predicate) continue;

        if (partialCondition.subject.startsWith('?')) {
          const varName = partialCondition.subject.slice(1);
          if (newBinding.has(varName)) {
            if (newBinding.get(varName) !== fact.subject) { matches = false; }
          } else {
            newBinding.set(varName, fact.subject);
          }
        } else if (partialCondition.subject !== fact.subject) {
          continue;
        }

        if (partialCondition.object.startsWith('?')) {
          const varName = partialCondition.object.slice(1);
          if (newBinding.has(varName)) {
            if (newBinding.get(varName) !== fact.object) { matches = false; }
          } else {
            newBinding.set(varName, fact.object);
          }
        } else if (partialCondition.object !== fact.object) {
          continue;
        }

        if (!matches) continue;

        const boundCondition = {
          predicate: fact.predicate,
          subject: fact.subject,
          object: fact.object,
        };

        const goalKey = `${boundCondition.subject}|${boundCondition.predicate}|${boundCondition.object}`;
        if (visited.has(goalKey)) continue;

        if (this.prove(boundCondition, facts, rules, proofChain, visited, maxDepth, currentDepth)) {
          if (this.proveConditions(rest, newBinding, facts, rules, proofChain, visited, maxDepth, currentDepth)) {
            return true;
          }
        }
      }
      return false;
    }

    // If condition still has unbound variables, try all possible bindings from facts
    if (substCondition.subject.startsWith('?') || substCondition.object.startsWith('?')) {
      for (const fact of facts.values()) {
        const newBinding = new Map(binding);
        let matches = true;

        if (substCondition.predicate !== fact.predicate) continue;

        if (substCondition.subject.startsWith('?')) {
          const varName = substCondition.subject.slice(1);
          if (newBinding.has(varName)) {
            if (newBinding.get(varName) !== fact.subject) { matches = false; }
          } else {
            newBinding.set(varName, fact.subject);
          }
        } else if (substCondition.subject !== fact.subject) {
          continue;
        }

        if (substCondition.object.startsWith('?')) {
          const varName = substCondition.object.slice(1);
          if (newBinding.has(varName)) {
            if (newBinding.get(varName) !== fact.object) { matches = false; }
          } else {
            newBinding.set(varName, fact.object);
          }
        } else if (substCondition.object !== fact.object) {
          continue;
        }

        if (!matches) continue;

        const boundCondition = {
          predicate: fact.predicate,
          subject: fact.subject,
          object: fact.object,
        };

        // Check if this bound condition is provable
        const goalKey = `${boundCondition.subject}|${boundCondition.predicate}|${boundCondition.object}`;
        if (visited.has(goalKey)) continue;

        // Try to prove this specific condition
        if (this.prove(boundCondition, facts, rules, proofChain, visited, maxDepth, currentDepth)) {
          // Try remaining conditions with updated binding
          if (this.proveConditions(rest, newBinding, facts, rules, proofChain, visited, maxDepth, currentDepth)) {
            return true;
          }
        }
      }
      return false;
    }

    // No unbound variables - prove directly
    if (this.prove(substCondition, facts, rules, proofChain, visited, maxDepth, currentDepth)) {
      return this.proveConditions(rest, binding, facts, rules, proofChain, visited, maxDepth, currentDepth);
    }

    return false;
  }
}
