// TestContext: Shared test context management

export type ContextSnapshot = Map<string, unknown>;

export class TestContext {
  private store: Map<string, unknown>;

  constructor(initialData?: Record<string, unknown>) {
    this.store = new Map(Object.entries(initialData ?? {}));
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  get<T = unknown>(key: string): T {
    const value = this.store.get(key);
    if (value === undefined && !this.store.has(key)) {
      throw new Error(`Context key "${key}" not found`);
    }
    return value as T;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  snapshot(): ContextSnapshot {
    return new Map(this.store);
  }

  restore(snapshot: ContextSnapshot): void {
    this.store = new Map(snapshot);
  }

  size(): number {
    return this.store.size;
  }

  keys(): string[] {
    return [...this.store.keys()];
  }

  entries(): Array<[string, unknown]> {
    return [...this.store.entries()];
  }
}

export function createIsolatedContext(initialData?: Record<string, unknown>): TestContext {
  return new TestContext(initialData);
}
