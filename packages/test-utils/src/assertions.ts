// ExtendedAssertions: Custom test assertions

import type { MockGraphStore, GraphNode, GraphEdge } from './mock-factory.js';
import type { MockEventSourcedStore, StoredEvent } from './mock-factory.js';

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

export async function assertGraphIntegrity(store: MockGraphStore): Promise<void> {
  const edges = await store.getAllEdges();
  const nodes = await store.getAllNodes();
  const nodeIds = new Set(nodes.map((n) => n.id));

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      throw new AssertionError(
        `Dangling edge "${edge.id}": source node "${edge.source}" does not exist`,
      );
    }
    if (!nodeIds.has(edge.target)) {
      throw new AssertionError(
        `Dangling edge "${edge.id}": target node "${edge.target}" does not exist`,
      );
    }
  }
}

export interface CRDTStoreLike {
  getState(): Promise<Record<string, unknown>>;
}

export async function assertCRDTConvergence(stores: CRDTStoreLike[]): Promise<void> {
  if (stores.length < 2) return;

  const states = await Promise.all(stores.map((s) => s.getState()));
  const reference = JSON.stringify(states[0], Object.keys(states[0] ?? {}).sort());

  for (let i = 1; i < states.length; i++) {
    const current = JSON.stringify(states[i], Object.keys(states[i] ?? {}).sort());
    if (current !== reference) {
      throw new AssertionError(
        `CRDT stores have diverged: store 0 and store ${i} have different states`,
      );
    }
  }
}

export async function assertEventOrdering(
  store: MockEventSourcedStore,
  aggregateId: string,
): Promise<void> {
  const events = await store.getEvents(aggregateId);
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!;
    const curr = events[i]!;
    if (curr.timestamp < prev.timestamp) {
      throw new AssertionError(
        `Event ordering violated: event "${curr.id}" (ts=${curr.timestamp}) comes before "${prev.id}" (ts=${prev.timestamp})`,
      );
    }
    if (curr.version <= prev.version) {
      throw new AssertionError(
        `Event version ordering violated: event "${curr.id}" (v=${curr.version}) has version <= "${prev.id}" (v=${prev.version})`,
      );
    }
  }
}

export function assertQuorumMet(
  result: { success: boolean; count: number },
  expected: number,
): void {
  if (!result.success) {
    throw new AssertionError(`Quorum not met: operation was not successful`);
  }
  if (result.count < expected) {
    throw new AssertionError(
      `Quorum not met: got ${result.count} acknowledgments, expected at least ${expected}`,
    );
  }
}

export function assertPipelineResult(
  result: { success: boolean; output: unknown },
  expected: { success: boolean; output: unknown },
): void {
  if (result.success !== expected.success) {
    throw new AssertionError(
      `Pipeline success mismatch: expected ${expected.success}, got ${result.success}`,
    );
  }
  const actualStr = JSON.stringify(result.output);
  const expectedStr = JSON.stringify(expected.output);
  if (actualStr !== expectedStr) {
    throw new AssertionError(
      `Pipeline output mismatch: expected ${expectedStr}, got ${actualStr}`,
    );
  }
}

export interface WorkflowInstanceLike {
  id: string;
  status: string;
}

export function assertWorkflowCompleted(instance: WorkflowInstanceLike): void {
  if (instance.status !== 'completed') {
    throw new AssertionError(
      `Workflow "${instance.id}" is not completed (status: ${instance.status})`,
    );
  }
}

export type InvariantFn = (state: Record<string, unknown>) => boolean;

export function assertConsistency(
  invariants: Array<{ name: string; check: InvariantFn }>,
  state: Record<string, unknown>,
): void {
  for (const invariant of invariants) {
    if (!invariant.check(state)) {
      throw new AssertionError(`Invariant "${invariant.name}" violated`);
    }
  }
}

export async function assertPerformance(
  fn: () => Promise<unknown>,
  maxMs: number,
): Promise<number> {
  const start = performance.now();
  await fn();
  const elapsed = performance.now() - start;

  if (elapsed > maxMs) {
    throw new AssertionError(
      `Performance assertion failed: function took ${elapsed.toFixed(2)}ms, max allowed ${maxMs}ms`,
    );
  }
  return elapsed;
}

export function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  path: string = '',
): void {
  if (actual === expected) return;

  if (typeof actual !== typeof expected) {
    throw new AssertionError(
      `Type mismatch at ${path || 'root'}: expected ${typeof expected}, got ${typeof actual}`,
    );
  }

  if (actual === null || expected === null) {
    if (actual !== expected) {
      throw new AssertionError(
        `Null mismatch at ${path || 'root'}: expected ${String(expected)}, got ${String(actual)}`,
      );
    }
    return;
  }

  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) {
      throw new AssertionError(
        `Array length mismatch at ${path || 'root'}: expected ${expected.length}, got ${actual.length}`,
      );
    }
    for (let i = 0; i < actual.length; i++) {
      assertDeepEqual(actual[i], expected[i], `${path || 'root'}[${i}]`);
    }
    return;
  }

  // BUG-001 [CRITICAL] Array vs plain object comparison was not handled.
  // If one is an array and the other is a plain object, both pass typeof === 'object'
  // but should be treated as a type mismatch.
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    const actualType = Array.isArray(actual) ? 'array' : 'object';
    const expectedType = Array.isArray(expected) ? 'array' : 'object';
    throw new AssertionError(
      `Type mismatch at ${path || 'root'}: expected ${expectedType}, got ${actualType}`,
    );
  }

  if (typeof actual === 'object' && typeof expected === 'object') {
    const actualObj = actual as Record<string, unknown>;
    const expectedObj = expected as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(actualObj), ...Object.keys(expectedObj)]);

    for (const key of allKeys) {
      const currentPath = path ? `${path}.${key}` : key;
      if (!(key in expectedObj)) {
        throw new AssertionError(`Unexpected key "${key}" at ${currentPath}`);
      }
      if (!(key in actualObj)) {
        throw new AssertionError(`Missing key "${key}" at ${currentPath}`);
      }
      assertDeepEqual(actualObj[key], expectedObj[key], currentPath);
    }
    return;
  }

  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Number.isNaN(actual) && Number.isNaN(expected)) return;
  }

  if (actual !== expected) {
    throw new AssertionError(
      `Value mismatch at ${path || 'root'}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

export async function assertNoLeaks(fn: () => Promise<void>): Promise<void> {
  const listenerCountBefore = getEventListenerCount();
  await fn();
  const listenerCountAfter = getEventListenerCount();

  if (listenerCountAfter > listenerCountBefore) {
    throw new AssertionError(
      `Potential event listener leak: ${listenerCountBefore} -> ${listenerCountAfter} listeners`,
    );
  }
}

function getEventListenerCount(): number {
  // Best-effort heuristic: count common event emitter patterns
  let count = 0;
  const globalObj = globalThis as Record<string, unknown>;
  if (typeof process !== 'undefined' && process !== null) {
    const proc = process as Record<string, unknown>;
    count += typeof proc.listenerCount === 'function'
      ? (proc.listenerCount as (emitter: string) => number)('message') ?? 0
      : 0;
  }
  return count;
}
