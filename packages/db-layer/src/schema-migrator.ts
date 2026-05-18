// ============================================================
// Module 3: Schema Migrator
// ============================================================

export interface Migration {
  id: string;
  name: string;
  version: number;
  up: string;
  down: string;
  dependencies?: string[];
  createdAt: number;
}

export interface MigrationRecord {
  id: string;
  name: string;
  version: number;
  appliedAt: number;
  executionTimeMs: number;
  checksum: string;
}

export interface MigrationResult {
  success: boolean;
  applied: string[];
  skipped: string[];
  errors: { migration: string; error: string }[];
  durationMs: number;
}

export interface SchemaMigratorConfig {
  tableName: string;
  dryRun: boolean;
  transactionPerMigration: boolean;
}

export type MigrationHook = (migration: Migration, direction: 'up' | 'down') => void | Promise<void>;

function simpleChecksum(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export class SchemaMigrator {
  private migrations: Map<string, Migration> = new Map();
  private history: MigrationRecord[] = [];
  private config: SchemaMigratorConfig;
  private currentVersion = 0;
  private beforeHooks: MigrationHook[] = [];
  private afterHooks: MigrationHook[] = [];
  private executeSqlFn: (sql: string) => Promise<void>;
  private querySqlFn: (sql: string) => Promise<unknown[]>;

  constructor(
    executeSql: (sql: string) => Promise<void>,
    querySql: (sql: string) => Promise<unknown[]>,
    config?: Partial<SchemaMigratorConfig>,
  ) {
    this.executeSqlFn = executeSql;
    this.querySqlFn = querySql;
    this.config = {
      tableName: 'schema_migrations',
      dryRun: false,
      transactionPerMigration: true,
      ...config,
    };
  }

  createMigration(name: string, up: string, down: string, dependencies?: string[]): Migration {
    const version = this.getNextVersion();
    const migration: Migration = {
      id: `migration-${version}-${name}`,
      name,
      version,
      up,
      down,
      dependencies,
      createdAt: Date.now(),
    };
    this.migrations.set(migration.id, migration);
    return migration;
  }

  private getNextVersion(): number {
    let maxVersion = 0;
    for (const m of this.migrations.values()) {
      if (m.version > maxVersion) maxVersion = m.version;
    }
    for (const r of this.history) {
      if (r.version > maxVersion) maxVersion = r.version;
    }
    return maxVersion + 1;
  }

  registerMigration(migration: Migration): void {
    this.migrations.set(migration.id, migration);
  }

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const pending = this.getPendingMigrations();
    const result: MigrationResult = {
      success: true,
      applied: [],
      skipped: [],
      errors: [],
      durationMs: 0,
    };

    for (const migration of pending) {
      // Check dependencies
      if (migration.dependencies && migration.dependencies.length > 0) {
        const allDepsApplied = migration.dependencies.every(depId =>
          this.history.some(r => r.id === depId),
        );
        if (!allDepsApplied) {
          result.skipped.push(migration.id);
          continue;
        }
      }

      try {
        await this.runBeforeHooks(migration, 'up');

        if (!this.config.dryRun) {
          const migrationStart = Date.now();
          await this.executeSqlFn(migration.up);
          const executionTime = Date.now() - migrationStart;

          const record: MigrationRecord = {
            id: migration.id,
            name: migration.name,
            version: migration.version,
            appliedAt: Date.now(),
            executionTimeMs: executionTime,
            checksum: simpleChecksum(migration.up),
          };
          this.history.push(record);
          this.currentVersion = migration.version;
        }

        result.applied.push(migration.id);
        await this.runAfterHooks(migration, 'up');
      } catch (err) {
        result.success = false;
        result.errors.push({
          migration: migration.id,
          error: String(err),
        });
        break;
      }
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  async rollback(steps: number = 1): Promise<MigrationResult> {
    const startTime = Date.now();
    const result: MigrationResult = {
      success: true,
      applied: [],
      skipped: [],
      errors: [],
      durationMs: 0,
    };

    const toRollback = this.history.slice(-steps).reverse();

    for (const record of toRollback) {
      const migration = this.migrations.get(record.id);
      if (!migration) {
        result.skipped.push(record.id);
        continue;
      }

      try {
        await this.runBeforeHooks(migration, 'down');

        if (!this.config.dryRun) {
          await this.executeSqlFn(migration.down);
          this.history = this.history.filter(r => r.id !== record.id);
          this.currentVersion = this.history.length > 0
            ? this.history[this.history.length - 1]!.version
            : 0;
        }

        result.applied.push(record.id);
        await this.runAfterHooks(migration, 'down');
      } catch (err) {
        result.success = false;
        result.errors.push({
          migration: record.id,
          error: String(err),
        });
        break;
      }
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  getCurrentVersion(): number {
    return this.currentVersion;
  }

  getPendingMigrations(): Migration[] {
    const appliedIds = new Set(this.history.map(r => r.id));
    const pending: Migration[] = [];

    for (const migration of this.migrations.values()) {
      if (!appliedIds.has(migration.id)) {
        pending.push(migration);
      }
    }

    return pending.sort((a, b) => a.version - b.version);
  }

  getMigrationHistory(): MigrationRecord[] {
    return [...this.history];
  }

  getAllMigrations(): Migration[] {
    return Array.from(this.migrations.values()).sort((a, b) => a.version - b.version);
  }

  beforeRun(hook: MigrationHook): void {
    this.beforeHooks.push(hook);
  }

  afterRun(hook: MigrationHook): void {
    this.afterHooks.push(hook);
  }

  private async runBeforeHooks(migration: Migration, direction: 'up' | 'down'): Promise<void> {
    for (const hook of this.beforeHooks) {
      await hook(migration, direction);
    }
  }

  private async runAfterHooks(migration: Migration, direction: 'up' | 'down'): Promise<void> {
    for (const hook of this.afterHooks) {
      await hook(migration, direction);
    }
  }

  setDryRun(dryRun: boolean): void {
    this.config.dryRun = dryRun;
  }

  isDryRun(): boolean {
    return this.config.dryRun;
  }

  setHistory(records: MigrationRecord[]): void {
    this.history = records;
    this.currentVersion = records.length > 0
      ? records[records.length - 1]!.version
      : 0;
  }
}
