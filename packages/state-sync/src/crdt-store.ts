// src/crdt-store.ts - CRDT 数据存储

export interface CRDTCounter {
  id: string;
  type: 'gcounter' | 'pncounter';
  increment(amount?: number): void;
  decrement(amount?: number): void;
  value(): number;
  getState(): Record<string, number>;
  merge(state: Record<string, number>): void;
}

export interface CRDTSet {
  id: string;
  type: 'gset' | 'orset';
  add(value: unknown): void;
  remove(value: unknown): void;
  has(value: unknown): boolean;
  values(): unknown[];
  getState(): { type: string; elements: unknown[]; tombstones?: unknown[] };
  merge(state: { type: string; elements: unknown[]; tombstones?: unknown[] }): void;
}

export interface CRDTRegister {
  id: string;
  type: 'lww';
  set(value: unknown, timestamp?: number, node?: string): void;
  get(): unknown;
  getState(): { value: unknown; timestamp: number; node: string };
  merge(state: { value: unknown; timestamp: number; node: string }): void;
}

export interface CRDTMap {
  id: string;
  type: 'lwwmap';
  set(key: string, value: unknown, timestamp?: number, node?: string): void;
  remove(key: string): void;
  get(key: string): unknown;
  has(key: string): boolean;
  keys(): string[];
  entries(): [string, unknown][];
  getState(): Record<string, { value: unknown; timestamp: number; node: string }>;
  merge(state: Record<string, { value: unknown; timestamp: number; node: string }>): void;
}

export interface CRDTState {
  counters: Record<string, { type: string; state: Record<string, number> }>;
  sets: Record<string, { type: string; elements: unknown[]; tombstones?: unknown[] }>;
  registers: Record<string, { value: unknown; timestamp: number; node: string }>;
  maps: Record<string, Record<string, { value: unknown; timestamp: number; node: string }>>;
}

export interface MergeResult {
  countersMerged: number;
  setsMerged: number;
  registersMerged: number;
  mapsMerged: number;
  conflicts: number;
}

export class GCounter implements CRDTCounter {
  id: string;
  type: 'gcounter' = 'gcounter';
  private counts: Map<string, number> = new Map();
  private nodeId: string;

  constructor(id: string, nodeId: string) {
    this.id = id;
    this.nodeId = nodeId;
    this.counts.set(nodeId, 0);
  }

  increment(amount: number = 1): void {
    const current = this.counts.get(this.nodeId) ?? 0;
    this.counts.set(this.nodeId, current + amount);
  }

  decrement(_amount?: number): void {
    throw new Error('GCounter does not support decrement. Use PNCounter instead.');
  }

  value(): number {
    let sum = 0;
    for (const v of this.counts.values()) {
      sum += v;
    }
    return sum;
  }

  getState(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  merge(state: Record<string, number>): void {
    for (const [node, count] of Object.entries(state)) {
      const current = this.counts.get(node) ?? 0;
      this.counts.set(node, Math.max(current, count));
    }
  }
}

export class PNCounter implements CRDTCounter {
  id: string;
  type: 'pncounter' = 'pncounter';
  private increments: Map<string, number> = new Map();
  private decrements: Map<string, number> = new Map();
  private nodeId: string;

  constructor(id: string, nodeId: string) {
    this.id = id;
    this.nodeId = nodeId;
    this.increments.set(nodeId, 0);
    this.decrements.set(nodeId, 0);
  }

  increment(amount: number = 1): void {
    const current = this.increments.get(this.nodeId) ?? 0;
    this.increments.set(this.nodeId, current + amount);
  }

  decrement(amount: number = 1): void {
    const current = this.decrements.get(this.nodeId) ?? 0;
    this.decrements.set(this.nodeId, current + amount);
  }

  value(): number {
    let incSum = 0;
    let decSum = 0;
    for (const v of this.increments.values()) incSum += v;
    for (const v of this.decrements.values()) decSum += v;
    return incSum - decSum;
  }

  getState(): Record<string, number> {
    const state: Record<string, number> = {};
    for (const [node, count] of this.increments) {
      state[`inc_${node}`] = count;
    }
    for (const [node, count] of this.decrements) {
      state[`dec_${node}`] = count;
    }
    return state;
  }

  merge(state: Record<string, number>): void {
    for (const [key, count] of Object.entries(state)) {
      if (key.startsWith('inc_')) {
        const node = key.slice(4);
        const current = this.increments.get(node) ?? 0;
        this.increments.set(node, Math.max(current, count));
      } else if (key.startsWith('dec_')) {
        const node = key.slice(4);
        const current = this.decrements.get(node) ?? 0;
        this.decrements.set(node, Math.max(current, count));
      }
    }
  }
}

export class GSet implements CRDTSet {
  id: string;
  type: 'gset' = 'gset';
  private elements: Set<unknown> = new Set();

  constructor(id: string) {
    this.id = id;
  }

  add(value: unknown): void {
    this.elements.add(value);
  }

  remove(_value: unknown): void {
    throw new Error('GSet does not support remove. Use ORSet instead.');
  }

  has(value: unknown): boolean {
    return this.elements.has(value);
  }

  values(): unknown[] {
    return Array.from(this.elements);
  }

  getState(): { type: string; elements: unknown[] } {
    return { type: 'gset', elements: Array.from(this.elements) };
  }

  merge(state: { type: string; elements: unknown[] }): void {
    for (const elem of state.elements) {
      this.elements.add(elem);
    }
  }
}

export class ORSet implements CRDTSet {
  id: string;
  type: 'orset' = 'orset';
  private elements: Map<string, unknown> = new Map();
  private tombstones: Set<string> = new Set();
  private counter = 0;

  constructor(id: string) {
    this.id = id;
  }

  private uniqueKey(value: unknown): string {
    this.counter++;
    return `${this.counter}_${JSON.stringify(value)}`;
  }

  add(value: unknown): void {
    const key = this.uniqueKey(value);
    this.elements.set(key, value);
  }

  remove(value: unknown): void {
    // Only remove the first matching entry by unique key, not all entries with matching value
    for (const [key, val] of this.elements) {
      if (JSON.stringify(val) === JSON.stringify(value)) {
        this.tombstones.add(key);
        this.elements.delete(key);
        return; // Only remove one specific unique key
      }
    }
  }

  has(value: unknown): boolean {
    for (const val of this.elements.values()) {
      if (JSON.stringify(val) === JSON.stringify(value)) return true;
    }
    return false;
  }

  values(): unknown[] {
    return Array.from(this.elements.values());
  }

  getState(): { type: string; elements: unknown[]; tombstones: unknown[] } {
    return {
      type: 'orset',
      elements: Array.from(this.elements.entries()),
      tombstones: Array.from(this.tombstones),
    };
  }

  merge(state: { type: string; elements: unknown[]; tombstones?: unknown[] }): void {
    // Merge remote elements
    const remoteEntries = state.elements as [string, unknown][];
    for (const [key, value] of remoteEntries) {
      if (!this.tombstones.has(key)) {
        this.elements.set(key, value);
      }
    }
    // Merge remote tombstones
    if (state.tombstones) {
      for (const tombstone of state.tombstones) {
        this.tombstones.add(tombstone as string);
        this.elements.delete(tombstone as string);
      }
    }
  }
}

export class LWWRegister implements CRDTRegister {
  id: string;
  type: 'lww' = 'lww';
  private value: unknown;
  private timestamp: number = 0;
  private node: string;

  constructor(id: string, nodeId: string) {
    this.id = id;
    this.node = nodeId;
  }

  set(value: unknown, timestamp?: number, node?: string): void {
    const ts = timestamp ?? Date.now();
    const n = node ?? this.node;
    if (ts > this.timestamp || (ts === this.timestamp && n > this.node)) {
      this.value = structuredClone(value);
      this.timestamp = ts;
      this.node = n;
    }
  }

  get(): unknown {
    return structuredClone(this.value);
  }

  getState(): { value: unknown; timestamp: number; node: string } {
    return { value: structuredClone(this.value), timestamp: this.timestamp, node: this.node };
  }

  merge(state: { value: unknown; timestamp: number; node: string }): void {
    if (state.timestamp > this.timestamp || (state.timestamp === this.timestamp && state.node > this.node)) {
      this.value = structuredClone(state.value);
      this.timestamp = state.timestamp;
      this.node = state.node;
    }
  }
}

export class LWWMap implements CRDTMap {
  id: string;
  type: 'lwwmap' = 'lwwmap';
  private data: Map<string, { value: unknown; timestamp: number; node: string }> = new Map();
  private deletedKeys: Map<string, { timestamp: number; node: string }> = new Map();
  private nodeId: string;

  constructor(id: string, nodeId: string) {
    this.id = id;
    this.nodeId = nodeId;
  }

  set(key: string, value: unknown, timestamp?: number, node?: string): void {
    const ts = timestamp ?? Date.now();
    const n = node ?? this.nodeId;
    const existing = this.data.get(key);
    const deleted = this.deletedKeys.get(key);
    const existingTs = existing ? existing.timestamp : 0;
    const deletedTs = deleted ? deleted.timestamp : 0;
    if (ts >= existingTs && ts >= deletedTs) {
      this.data.set(key, { value: structuredClone(value), timestamp: ts, node: n });
      this.deletedKeys.delete(key);
    }
  }

  remove(key: string): void {
    const ts = Date.now();
    this.deletedKeys.set(key, { timestamp: ts, node: this.nodeId });
    this.data.delete(key);
  }

  get(key: string): unknown {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    return structuredClone(entry.value);
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  keys(): string[] {
    return Array.from(this.data.keys());
  }

  entries_list(): [string, unknown][] {
    return Array.from(this.data.entries()).map(([k, v]) => [k, structuredClone(v.value)]);
  }

  entries(): [string, unknown][] {
    return this.entries_list();
  }

  getState(): Record<string, { value: unknown; timestamp: number; node: string }> {
    const result: Record<string, { value: unknown; timestamp: number; node: string }> = {};
    for (const [key, entry] of this.data) {
      result[key] = { value: structuredClone(entry.value), timestamp: entry.timestamp, node: entry.node };
    }
    // Include deleted keys with a special marker
    for (const [key, entry] of this.deletedKeys) {
      result[key] = { value: undefined, timestamp: entry.timestamp, node: entry.node, _deleted: true } as any;
    }
    return result;
  }

  merge(state: Record<string, { value: unknown; timestamp: number; node: string }>): void {
    for (const [key, remoteEntry] of Object.entries(state)) {
      const isDeleted = (remoteEntry as any)._deleted === true;
      if (isDeleted) {
        // Process deleted key from remote
        const localEntry = this.data.get(key);
        const localDeleted = this.deletedKeys.get(key);
        const localTs = localEntry ? localEntry.timestamp : 0;
        const localDeletedTs = localDeleted ? localDeleted.timestamp : 0;
        if (remoteEntry.timestamp > localTs && remoteEntry.timestamp > localDeletedTs) {
          this.data.delete(key);
          this.deletedKeys.set(key, { timestamp: remoteEntry.timestamp, node: remoteEntry.node });
        }
      } else {
        const local = this.data.get(key);
        if (!local || remoteEntry.timestamp > local.timestamp || (remoteEntry.timestamp === local.timestamp && remoteEntry.node > local.node)) {
          this.data.set(key, { value: structuredClone(remoteEntry.value), timestamp: remoteEntry.timestamp, node: remoteEntry.node });
          this.deletedKeys.delete(key);
        }
      }
    }
  }
}

export class CRDTStore {
  private nodeId: string;
  private counters: Map<string, CRDTCounter> = new Map();
  private sets: Map<string, CRDTSet> = new Map();
  private registers: Map<string, CRDTRegister> = new Map();
  private maps: Map<string, CRDTMap> = new Map();
  private lastSyncState: CRDTState | null = null;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  createCounter(id: string, type: 'gcounter' | 'pncounter' = 'gcounter'): CRDTCounter {
    const counter = type === 'pncounter'
      ? new PNCounter(id, this.nodeId)
      : new GCounter(id, this.nodeId);
    this.counters.set(id, counter);
    return counter;
  }

  createSet(id: string, type: 'gset' | 'orset' = 'orset'): CRDTSet {
    const set = type === 'gset' ? new GSet(id) : new ORSet(id);
    this.sets.set(id, set);
    return set;
  }

  createRegister(id: string): CRDTRegister {
    const register = new LWWRegister(id, this.nodeId);
    this.registers.set(id, register);
    return register;
  }

  createMap(id: string): CRDTMap {
    const map = new LWWMap(id, this.nodeId);
    this.maps.set(id, map);
    return map;
  }

  merge(remoteState: CRDTState): MergeResult {
    let conflicts = 0;
    let countersMerged = 0;
    let setsMerged = 0;
    let registersMerged = 0;
    let mapsMerged = 0;

    for (const [id, counterState] of Object.entries(remoteState.counters)) {
      const local = this.counters.get(id);
      if (local) {
        local.merge(counterState.state);
        countersMerged++;
      }
    }

    for (const [id, setState] of Object.entries(remoteState.sets)) {
      const local = this.sets.get(id);
      if (local) {
        local.merge(setState as { type: string; elements: unknown[]; tombstones?: unknown[] });
        setsMerged++;
      }
    }

    for (const [id, regState] of Object.entries(remoteState.registers)) {
      const local = this.registers.get(id);
      if (local) {
        local.merge(regState);
        registersMerged++;
      }
    }

    for (const [id, mapState] of Object.entries(remoteState.maps)) {
      const local = this.maps.get(id);
      if (local) {
        local.merge(mapState);
        mapsMerged++;
      }
    }

    return { countersMerged, setsMerged, registersMerged, mapsMerged, conflicts };
  }

  getState(): CRDTState {
    const counters: Record<string, { type: string; state: Record<string, number> }> = {};
    for (const [id, counter] of this.counters) {
      counters[id] = { type: counter.type, state: counter.getState() };
    }

    const sets: Record<string, { type: string; elements: unknown[]; tombstones?: unknown[] }> = {};
    for (const [id, set] of this.sets) {
      sets[id] = set.getState();
    }

    const registers: Record<string, { value: unknown; timestamp: number; node: string }> = {};
    for (const [id, reg] of this.registers) {
      registers[id] = reg.getState();
    }

    const maps: Record<string, Record<string, { value: unknown; timestamp: number; node: string }>> = {};
    for (const [id, map] of this.maps) {
      maps[id] = map.getState();
    }

    return { counters, sets, registers, maps };
  }

  getDelta(): CRDTState {
    const currentState = this.getState();
    if (!this.lastSyncState) {
      this.lastSyncState = currentState;
      return currentState;
    }

    // For simplicity, return full state as delta (a real implementation would diff)
    const delta: CRDTState = {
      counters: currentState.counters,
      sets: currentState.sets,
      registers: currentState.registers,
      maps: currentState.maps,
    };

    this.lastSyncState = currentState;
    return delta;
  }

  getCounter(id: string): CRDTCounter | undefined {
    return this.counters.get(id);
  }

  getSet(id: string): CRDTSet | undefined {
    return this.sets.get(id);
  }

  getRegister(id: string): CRDTRegister | undefined {
    return this.registers.get(id);
  }

  getMap(id: string): CRDTMap | undefined {
    return this.maps.get(id);
  }
}
