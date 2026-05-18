// ============================================================
// Module 8: Seed Manager
// ============================================================

export interface Seed {
  name: string;
  data: unknown[];
  order: number;
  environment?: string | string[];
  dependencies?: string[];
  runOnce?: boolean;
}

export interface SeedRecord {
  name: string;
  appliedAt: number;
  rowCount: number;
  durationMs: number;
  environment?: string;
}

export interface SeedResult {
  success: boolean;
  applied: string[];
  skipped: string[];
  errors: { seed: string; error: string }[];
  totalDurationMs: number;
}

export class SeedManager {
  private seeds: Map<string, Seed> = new Map();
  private history: SeedRecord[] = new Map<string, SeedRecord[]>();
  private currentEnvironment: string;
  private executeSqlFn: (sql: string) => Promise<void>;

  constructor(
    executeSql: (sql: string) => Promise<void>,
    environment: string = 'development',
  ) {
    this.executeSqlFn = executeSql;
    this.currentEnvironment = environment;
  }

  createSeed(name: string, data: unknown[], options?: Partial<Seed>): Seed {
    const seed: Seed = {
      name,
      data,
      order: this.getNextOrder(),
      environment: options?.environment,
      dependencies: options?.dependencies,
      runOnce: options?.runOnce ?? true,
    };
    this.seeds.set(name, seed);
    return seed;
  }

  private getNextOrder(): number {
    let maxOrder = 0;
    for (const seed of this.seeds.values()) {
      if (seed.order > maxOrder) maxOrder = seed.order;
    }
    return maxOrder + 1;
  }

  async runSeed(name: string): Promise<void> {
    const seed = this.seeds.get(name);
    if (!seed) {
      throw new Error(`Seed '${name}' not found`);
    }

    // Check environment
    if (seed.environment) {
      const envs = Array.isArray(seed.environment) ? seed.environment : [seed.environment];
      if (!envs.includes(this.currentEnvironment) && !envs.includes('*')) {
        return;
      }
    }

    // Check dependencies
    if (seed.dependencies && seed.dependencies.length > 0) {
      const envHistory = this.getEnvironmentHistory();
      const appliedNames = new Set(envHistory.map(r => r.name));
      for (const dep of seed.dependencies) {
        if (!appliedNames.has(dep)) {
          throw new Error(`Dependency seed '${dep}' has not been applied`);
        }
      }
    }

    // Check if already run (runOnce)
    if (seed.runOnce) {
      const envHistory = this.getEnvironmentHistory();
      if (envHistory.some(r => r.name === name)) {
        return;
      }
    }

    const start = Date.now();
    const sql = this.generateInsertSQL(seed);
    await this.executeSqlFn(sql);
    const durationMs = Date.now() - start;

    const record: SeedRecord = {
      name,
      appliedAt: Date.now(),
      rowCount: seed.data.length,
      durationMs,
      environment: this.currentEnvironment,
    };

    this.addHistoryRecord(record);
  }

  async runAllSeeds(): Promise<SeedResult> {
    const startTime = Date.now();
    const result: SeedResult = {
      success: true,
      applied: [],
      skipped: [],
      errors: [],
      totalDurationMs: 0,
    };

    const sortedSeeds = this.getSortedSeeds();

    for (const seed of sortedSeeds) {
      try {
        await this.runSeed(seed.name);
        result.applied.push(seed.name);
      } catch (err) {
        result.success = false;
        result.errors.push({ seed: seed.name, error: String(err) });
      }
    }

    result.totalDurationMs = Date.now() - startTime;
    return result;
  }

  async rollbackSeed(name: string): Promise<void> {
    const envHistory = this.getEnvironmentHistory();
    const recordIndex = envHistory.findIndex(r => r.name === name);
    if (recordIndex === -1) {
      throw new Error(`Seed '${name}' has not been applied`);
    }

    // Remove from history
    const env = this.currentEnvironment;
    if (!this.history.has(env)) {
      return;
    }
    const records = this.history.get(env)!;
    records.splice(recordIndex, 1);
  }

  getSeedHistory(): SeedRecord[] {
    return this.getEnvironmentHistory();
  }

  getPendingSeeds(): Seed[] {
    const envHistory = this.getEnvironmentHistory();
    const appliedNames = new Set(envHistory.map(r => r.name));

    return this.getSortedSeeds().filter(seed => {
      if (appliedNames.has(seed.name)) return false;
      if (seed.environment) {
        const envs = Array.isArray(seed.environment) ? seed.environment : [seed.environment];
        if (!envs.includes(this.currentEnvironment) && !envs.includes('*')) return false;
      }
      return true;
    });
  }

  getAllSeeds(): Seed[] {
    return this.getSortedSeeds();
  }

  setEnvironment(env: string): void {
    this.currentEnvironment = env;
  }

  getEnvironment(): string {
    return this.currentEnvironment;
  }

  private getSortedSeeds(): Seed[] {
    return Array.from(this.seeds.values()).sort((a, b) => a.order - b.order);
  }

  private getEnvironmentHistory(): SeedRecord[] {
    return this.history.get(this.currentEnvironment) ?? [];
  }

  private addHistoryRecord(record: SeedRecord): void {
    if (!this.history.has(this.currentEnvironment)) {
      this.history.set(this.currentEnvironment, []);
    }
    this.history.get(this.currentEnvironment)!.push(record);
  }

  private generateInsertSQL(seed: Seed): string {
    if (seed.data.length === 0) return '';
    // Simplified - in real implementation would generate proper SQL
    return `-- SEED: ${seed.name} (${seed.data.length} rows)`;
  }

  // For testing
  _setHistory(env: string, records: SeedRecord[]): void {
    this.history.set(env, records);
  }
}
