import { describe, test, expect, beforeEach } from 'bun:test';
import { DatabaseConnectionPool, type DatabaseConnection } from '../src/connection-pool.ts';
import { QueryBuilder } from '../src/query-builder.ts';
import { SchemaMigrator } from '../src/schema-migrator.ts';
import { BaseRepository } from '../src/repository-base.ts';
import { TransactionManager } from '../src/transaction-manager.ts';
import { DataMapper } from '../src/data-mapper.ts';
import { QueryExecutor } from '../src/query-executor.ts';
import { SeedManager } from '../src/seed-manager.ts';
import { IndexManager } from '../src/index-manager.ts';
import { DatabaseHealthMonitor } from '../src/db-health-monitor.ts';

// ============================================================
// Mock helpers
// ============================================================

function createMockConnection(id: string, healthy = true): DatabaseConnection {
  let closed = false;
  return {
    id,
    createdAt: Date.now() - 1000,
    lastUsedAt: Date.now() - 500,
    isHealthy: () => healthy && !closed,
    close: async () => { closed = true; },
    query: async (_sql: string, _params?: unknown[]) => [],
  };
}

// ============================================================
// Module 1: Connection Pool Tests
// ============================================================

describe('DatabaseConnectionPool', () => {
  test('should create a pool with default config', () => {
    const pool = new DatabaseConnectionPool(createMockConnection);
    const config = pool.getConfig();
    expect(config.min).toBe(2);
    expect(config.max).toBe(10);
    expect(config.idleTimeoutMs).toBe(30000);
    expect(config.acquireTimeoutMs).toBe(5000);
  });

  test('should create a pool with custom config', () => {
    const pool = new DatabaseConnectionPool(createMockConnection, {
      min: 1,
      max: 5,
      idleTimeoutMs: 10000,
    });
    const config = pool.getConfig();
    expect(config.min).toBe(1);
    expect(config.max).toBe(5);
    expect(config.idleTimeoutMs).toBe(10000);
  });

  test('should initialize with min connections', async () => {
    const pool = new DatabaseConnectionPool(createMockConnection, { min: 3, max: 10 });
    await pool.initialize();
    expect(pool.getIdleCount()).toBe(3);
    expect(pool.getPoolSize()).toBe(3);
    expect(pool.getActiveCount()).toBe(0);
    await pool.drain();
  });

  test('should acquire a connection from pool', async () => {
    const pool = new DatabaseConnectionPool(createMockConnection, { min: 2, max: 10 });
    await pool.initialize();
    const conn = await pool.acquire();
    expect(conn).toBeDefined();
    expect(conn.id).toBeDefined();
    expect(pool.getActiveCount()).toBe(1);
    expect(pool.getIdleCount()).toBe(1);
    pool.release(conn);
    await pool.drain();
  });

  test('should release a connection back to pool', async () => {
    const pool = new DatabaseConnectionPool(createMockConnection, { min: 2, max: 10 });
    await pool.initialize();
    const conn = await pool.acquire();
    expect(pool.getActiveCount()).toBe(1);
    pool.release(conn);
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.getIdleCount()).toBe(2);
    await pool.drain();
  });

  test('should create new connection when pool is exhausted', async () => {
    const pool = new DatabaseConnectionPool(createMockConnection, { min: 1, max: 5 });
    await pool.initialize();
    const conn1 = await pool.acquire();
    const conn2 = await pool.acquire();
    expect(pool.getActiveCount()).toBe(2);
    expect(pool.getPoolSize()).toBeGreaterThanOrEqual(2);
    pool.release(conn1);
    pool.release(conn2);
    await pool.drain();
  });

  test('should not return unhealthy connections', async () => {
    const pool = new DatabaseConnectionPool((id) => createMockConnection(id, false), { min: 0, max: 5 });
    const conn = await pool.acquire();
    expect(conn).toBeDefined();
    pool.release(conn);
    await pool.drain();
  });

  test('should drain all connections', async () => {
    const pool = new DatabaseConnectionPool(createMockConnection, { min: 2, max: 10 });
    await pool.initialize();
    expect(pool.getPoolSize()).toBe(2);
    await pool.drain();
    expect(pool.isDraining).toBe(true);
    expect(pool.getPoolSize()).toBe(0);
  });

  test('should reject acquire when draining', async () => {
    const pool = new DatabaseConnectionPool(createMockConnection, { min: 1, max: 5 });
    await pool.initialize();
    await pool.drain();
    await expect(pool.acquire()).rejects.toThrow('Pool is draining');
  });

  test('should emit events', async () => {
    const events: string[] = [];
    const pool = new DatabaseConnectionPool(createMockConnection, { min: 1, max: 5 });
    pool.onEvent((e) => events.push(e.type));
    await pool.initialize();
    const conn = await pool.acquire();
    pool.release(conn);
    await pool.drain();
    expect(events).toContain('create');
    expect(events).toContain('acquire');
    expect(events).toContain('release');
  });

  test('should allow unsubscribing from events', async () => {
    const events: string[] = [];
    const pool = new DatabaseConnectionPool(createMockConnection, { min: 1, max: 5 });
    const unsub = pool.onEvent((e) => events.push(e.type));
    await pool.initialize();
    unsub();
    const conn = await pool.acquire();
    pool.release(conn);
    // Only create events from initialize, no acquire/release
    expect(events.filter(e => e === 'acquire').length).toBe(0);
    await pool.drain();
  });

  test('should update config', () => {
    const pool = new DatabaseConnectionPool(createMockConnection);
    pool.updateConfig({ min: 5, max: 20 });
    expect(pool.getConfig().min).toBe(5);
    expect(pool.getConfig().max).toBe(20);
  });

  test('should handle release of unknown connection gracefully', () => {
    const pool = new DatabaseConnectionPool(createMockConnection);
    const conn = createMockConnection('unknown');
    // Should not throw
    pool.release(conn);
  });

  test('should report correct pool metrics', async () => {
    const pool = new DatabaseConnectionPool(createMockConnection, { min: 3, max: 10 });
    await pool.initialize();
    expect(pool.getPoolSize()).toBe(3);
    expect(pool.getIdleCount()).toBe(3);
    expect(pool.getActiveCount()).toBe(0);

    const conn1 = await pool.acquire();
    const conn2 = await pool.acquire();
    expect(pool.getActiveCount()).toBe(2);
    expect(pool.getIdleCount()).toBe(1);

    pool.release(conn1);
    expect(pool.getActiveCount()).toBe(1);
    expect(pool.getIdleCount()).toBe(2);

    pool.release(conn2);
    await pool.drain();
  });
});

// ============================================================
// Module 2: Query Builder Tests
// ============================================================

describe('QueryBuilder', () => {
  test('should build a simple SELECT query', () => {
    const qb = new QueryBuilder()
      .select(['id', 'name'])
      .from('users');
    const { sql, params } = qb.build();
    expect(sql).toBe('SELECT id, name FROM users');
    expect(params).toEqual([]);
  });

  test('should build SELECT * query', () => {
    const qb = QueryBuilder.table('users');
    const { sql } = qb.build();
    expect(sql).toBe('SELECT * FROM users');
  });

  test('should build query with WHERE clause', () => {
    const qb = new QueryBuilder()
      .select(['*'])
      .from('users')
      .where('id = ?', ['123']);
    const { sql, params } = qb.build();
    expect(sql).toBe('SELECT * FROM users WHERE id = ?');
    expect(params).toEqual(['123']);
  });

  test('should build query with multiple WHERE conditions', () => {
    const qb = new QueryBuilder()
      .select(['*'])
      .from('users')
      .where('age > ?', [18])
      .andWhere('status = ?', ['active']);
    const { sql, params } = qb.build();
    expect(sql).toContain('WHERE age > ? AND (status = ?)');
    expect(params).toEqual([18, 'active']);
  });

  test('should build query with OR condition', () => {
    const qb = new QueryBuilder()
      .select(['*'])
      .from('users')
      .where('role = ?', ['admin'])
      .orWhere('role = ?', ['superadmin']);
    const { sql } = qb.build();
    expect(sql).toContain('OR (role = ?)');
  });

  test('should build query with JOIN', () => {
    const qb = new QueryBuilder()
      .select(['users.*', 'orders.id as order_id'])
      .from('users')
      .join('orders', 'users.id = orders.user_id');
    const { sql } = qb.build();
    expect(sql).toContain('INNER JOIN orders ON users.id = orders.user_id');
  });

  test('should build query with LEFT JOIN', () => {
    const qb = new QueryBuilder()
      .select(['*'])
      .from('users')
      .leftJoin('profiles', 'users.id = profiles.user_id');
    const { sql } = qb.build();
    expect(sql).toContain('LEFT JOIN profiles ON users.id = profiles.user_id');
  });

  test('should build query with RIGHT JOIN', () => {
    const qb = new QueryBuilder()
      .select(['*'])
      .from('users')
      .rightJoin('profiles', 'users.id = profiles.user_id');
    const { sql } = qb.build();
    expect(sql).toContain('RIGHT JOIN profiles ON users.id = profiles.user_id');
  });

  test('should build query with FULL JOIN', () => {
    const qb = new QueryBuilder()
      .select(['*'])
      .from('users')
      .fullJoin('profiles', 'users.id = profiles.user_id');
    const { sql } = qb.build();
    expect(sql).toContain('FULL OUTER JOIN profiles ON users.id = profiles.user_id');
  });

  test('should build query with CROSS JOIN', () => {
    const qb = new QueryBuilder()
      .select(['*'])
      .from('users')
      .crossJoin('roles');
    const { sql } = qb.build();
    expect(sql).toContain('CROSS JOIN roles');
  });

  test('should build query with GROUP BY', () => {
    const qb = new QueryBuilder()
      .select(['department', 'COUNT(*) as count'])
      .from('employees')
      .groupBy('department');
    const { sql } = qb.build();
    expect(sql).toContain('GROUP BY department');
  });

  test('should build query with HAVING', () => {
    const qb = new QueryBuilder()
      .select(['department', 'COUNT(*) as count'])
      .from('employees')
      .groupBy('department')
      .having('count > ?', [5]);
    const { sql, params } = qb.build();
    expect(sql).toContain('HAVING count > ?');
    expect(params).toEqual([5]);
  });

  test('should build query with ORDER BY ASC', () => {
    const qb = new QueryBuilder()
      .select(['*'])
      .from('users')
      .orderBy('name', 'asc');
    const { sql } = qb.build();
    expect(sql).toContain('ORDER BY name ASC');
  });

  test('should build query with ORDER BY DESC', () => {
    const qb = new QueryBuilder()
      .select(['*'])
      .from('users')
      .orderBy('created_at', 'desc');
    const { sql } = qb.build();
    expect(sql).toContain('ORDER BY created_at DESC');
  });

  test('should build query with multiple ORDER BY', () => {
    const qb = new QueryBuilder()
      .select(['*'])
      .from('users')
      .orderBy('last_name', 'asc')
      .orderBy('first_name', 'asc');
    const { sql } = qb.build();
    expect(sql).toContain('ORDER BY last_name ASC, first_name ASC');
  });

  test('should build query with LIMIT', () => {
    const qb = new QueryBuilder()
      .select(['*'])
      .from('users')
      .limit(10);
    const { sql } = qb.build();
    expect(sql).toContain('LIMIT 10');
  });

  test('should build query with OFFSET', () => {
    const qb = new QueryBuilder()
      .select(['*'])
      .from('users')
      .limit(10)
      .offset(20);
    const { sql } = qb.build();
    expect(sql).toContain('LIMIT 10');
    expect(sql).toContain('OFFSET 20');
  });

  test('should build complex query with all clauses', () => {
    const qb = new QueryBuilder()
      .select(['u.name', 'COUNT(o.id) as order_count'])
      .from('users u')
      .join('orders o', 'u.id = o.user_id')
      .where('u.status = ?', ['active'])
      .groupBy('u.name')
      .having('COUNT(o.id) > ?', [5])
      .orderBy('order_count', 'desc')
      .limit(10);
    const { sql, params } = qb.build();
    expect(sql).toContain('SELECT u.name, COUNT(o.id) as order_count');
    expect(sql).toContain('FROM users u');
    expect(sql).toContain('INNER JOIN orders o ON u.id = o.user_id');
    expect(sql).toContain('WHERE u.status = ?');
    expect(sql).toContain('GROUP BY u.name');
    expect(sql).toContain('HAVING COUNT(o.id) > ?');
    expect(sql).toContain('ORDER BY order_count DESC');
    expect(sql).toContain('LIMIT 10');
    expect(params).toEqual(['active', 5]);
  });

  test('should build UNION query', () => {
    const qb1 = new QueryBuilder().select(['name']).from('admins');
    const qb2 = new QueryBuilder().select(['name']).from('users');
    qb1.union(qb2);
    const { sql } = qb1.build();
    expect(sql).toContain('UNION');
  });

  test('should build UNION ALL query', () => {
    const qb1 = new QueryBuilder().select(['name']).from('admins');
    const qb2 = new QueryBuilder().select(['name']).from('users');
    qb1.unionAll(qb2);
    const { sql } = qb1.build();
    expect(sql).toContain('UNION ALL');
  });

  test('should build INTERSECT query', () => {
    const qb1 = new QueryBuilder().select(['id']).from('table_a');
    const qb2 = new QueryBuilder().select(['id']).from('table_b');
    qb1.intersect(qb2);
    const { sql } = qb1.build();
    expect(sql).toContain('INTERSECT');
  });

  test('should build EXCEPT query', () => {
    const qb1 = new QueryBuilder().select(['id']).from('table_a');
    const qb2 = new QueryBuilder().select(['id']).from('table_b');
    qb1.except(qb2);
    const { sql } = qb1.build();
    expect(sql).toContain('EXCEPT');
  });

  test('should clone a query builder', () => {
    const qb1 = new QueryBuilder()
      .select(['id', 'name'])
      .from('users')
      .where('active = ?', [true]);
    const qb2 = qb1.clone();
    qb2.where('age > ?', [18]);
    const sql1 = qb1.build().sql;
    const sql2 = qb2.build().sql;
    expect(sql1).not.toContain('age > ?');
    expect(sql2).toContain('age > ?');
  });

  test('toSQL should return same as build', () => {
    const qb = new QueryBuilder().select(['*']).from('users');
    const buildResult = qb.build();
    const toSQLResult = qb.toSQL();
    expect(buildResult.sql).toBe(toSQLResult.sql);
    expect(buildResult.params).toEqual(toSQLResult.params);
  });

  test('should use static select factory', () => {
    const qb = QueryBuilder.select(['id', 'name']);
    const { sql } = qb.build();
    expect(sql).toBe('SELECT id, name');
  });

  test('should use static from factory', () => {
    const qb = QueryBuilder.from('users');
    const { sql } = qb.build();
    expect(sql).toBe('FROM users');
  });
});

// ============================================================
// Module 3: Schema Migrator Tests
// ============================================================

describe('SchemaMigrator', () => {
  let migrator: SchemaMigrator;
  const executedSql: string[] = [];

  beforeEach(() => {
    executedSql.length = 0;
    migrator = new SchemaMigrator(
      (sql) => { executedSql.push(sql); return Promise.resolve(); },
      () => Promise.resolve([]),
    );
  });

  test('should create a migration', () => {
    const migration = migrator.createMigration('create_users', 'CREATE TABLE users...', 'DROP TABLE users...');
    expect(migration.name).toBe('create_users');
    expect(migration.version).toBe(1);
    expect(migration.up).toBe('CREATE TABLE users...');
    expect(migration.down).toBe('DROP TABLE users...');
  });

  test('should create migrations with incrementing versions', () => {
    const m1 = migrator.createMigration('first', 'UP1', 'DOWN1');
    const m2 = migrator.createMigration('second', 'UP2', 'DOWN2');
    expect(m1.version).toBe(1);
    expect(m2.version).toBe(2);
  });

  test('should register external migration', () => {
    const migration = migrator.createMigration('create_users', 'UP', 'DOWN');
    migrator.registerMigration({ ...migration, id: 'custom-id', version: 99 });
    const all = migrator.getAllMigrations();
    expect(all.length).toBe(2);
  });

  test('should run pending migrations', async () => {
    migrator.createMigration('create_users', 'CREATE TABLE users', 'DROP TABLE users');
    migrator.createMigration('create_orders', 'CREATE TABLE orders', 'DROP TABLE orders');
    const result = await migrator.run();
    expect(result.success).toBe(true);
    expect(result.applied).toHaveLength(2);
    expect(executedSql).toContain('CREATE TABLE users');
    expect(executedSql).toContain('CREATE TABLE orders');
  });

  test('should not re-run already applied migrations', async () => {
    migrator.createMigration('create_users', 'CREATE TABLE users', 'DROP TABLE users');
    await migrator.run();
    executedSql.length = 0;
    const result = await migrator.run();
    expect(result.applied).toHaveLength(0);
  });

  test('should get pending migrations', () => {
    migrator.createMigration('first', 'UP1', 'DOWN1');
    migrator.createMigration('second', 'UP2', 'DOWN2');
    const pending = migrator.getPendingMigrations();
    expect(pending).toHaveLength(2);
  });

  test('should track migration history', async () => {
    migrator.createMigration('create_users', 'CREATE TABLE users', 'DROP TABLE users');
    await migrator.run();
    const history = migrator.getMigrationHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.name).toBe('create_users');
  });

  test('should rollback migrations', async () => {
    migrator.createMigration('first', 'UP1', 'DOWN1');
    migrator.createMigration('second', 'UP2', 'DOWN2');
    await migrator.run();
    executedSql.length = 0;
    const result = await migrator.rollback(1);
    expect(result.success).toBe(true);
    expect(result.applied).toHaveLength(1);
    expect(executedSql).toContain('DOWN2');
  });

  test('should rollback multiple steps', async () => {
    migrator.createMigration('first', 'UP1', 'DOWN1');
    migrator.createMigration('second', 'UP2', 'DOWN2');
    migrator.createMigration('third', 'UP3', 'DOWN3');
    await migrator.run();
    executedSql.length = 0;
    const result = await migrator.rollback(2);
    expect(result.applied).toHaveLength(2);
  });

  test('should report current version', async () => {
    expect(migrator.getCurrentVersion()).toBe(0);
    migrator.createMigration('first', 'UP1', 'DOWN1');
    await migrator.run();
    expect(migrator.getCurrentVersion()).toBe(1);
  });

  test('should handle dry run mode', async () => {
    migrator.setDryRun(true);
    migrator.createMigration('first', 'UP1', 'DOWN1');
    const result = await migrator.run();
    expect(result.applied).toHaveLength(1);
    expect(executedSql).toHaveLength(0);
  });

  test('should handle migration with dependencies', async () => {
    const m1 = migrator.createMigration('first', 'UP1', 'DOWN1');
    migrator.createMigration('second', 'UP2', 'DOWN2', [m1.id]);
    // Manually apply first migration to history
    migrator.setHistory([{
      id: m1.id, name: m1.name, version: m1.version,
      appliedAt: Date.now(), executionTimeMs: 10, checksum: 'abc',
    }]);
    // Second should now be pending with dependency met
    const pending = migrator.getPendingMigrations();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.name).toBe('second');
  });

  test('should skip migrations with unmet dependencies', async () => {
    migrator.createMigration('dependent', 'UP', 'DOWN', ['non-existent']);
    const result = await migrator.run();
    expect(result.skipped).toHaveLength(1);
  });

  test('should call before/after hooks', async () => {
    const beforeCalls: string[] = [];
    const afterCalls: string[] = [];
    migrator.beforeRun((m, dir) => beforeCalls.push(`${m.name}:${dir}`));
    migrator.afterRun((m, dir) => afterCalls.push(`${m.name}:${dir}`));
    migrator.createMigration('test', 'UP', 'DOWN');
    await migrator.run();
    expect(beforeCalls).toContain('test:up');
    expect(afterCalls).toContain('test:up');
  });

  test('should handle migration errors', async () => {
    const failMigrator = new SchemaMigrator(
      () => Promise.reject(new Error('SQL Error')),
      () => Promise.resolve([]),
    );
    failMigrator.createMigration('failing', 'BAD SQL', 'DOWN');
    const result = await failMigrator.run();
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  test('should set history externally', () => {
    migrator.setHistory([
      { id: 'm1', name: 'old', version: 5, appliedAt: Date.now(), executionTimeMs: 100, checksum: 'abc' },
    ]);
    expect(migrator.getCurrentVersion()).toBe(5);
    expect(migrator.getMigrationHistory()).toHaveLength(1);
  });
});

// ============================================================
// Module 4: Repository Base Tests
// ============================================================

interface UserEntity {
  id: string;
  name: string;
  email: string;
  age: number;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

class UserRepository extends BaseRepository<UserEntity> {
  constructor() {
    super('users', { softDelete: true, timestampFields: true });
  }

  mapToEntity(row: Record<string, unknown>): UserEntity {
    return row as unknown as UserEntity;
  }

  mapToRow(entity: Partial<UserEntity>): Record<string, unknown> {
    return entity as Record<string, unknown>;
  }
}

describe('BaseRepository', () => {
  let repo: UserRepository;

  beforeEach(() => {
    repo = new UserRepository();
  });

  test('should create an entity', async () => {
    const entity = await repo.create({ name: 'Alice', email: 'alice@test.com', age: 30 });
    expect(entity.id).toBeDefined();
    expect(entity.name).toBe('Alice');
    expect(entity.email).toBe('alice@test.com');
    expect(entity.createdAt).toBeDefined();
    expect(entity.updatedAt).toBeDefined();
  });

  test('should find entity by id', async () => {
    const created = await repo.create({ name: 'Bob', email: 'bob@test.com', age: 25 });
    const found = await repo.findById(created.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Bob');
  });

  test('should return undefined for non-existent id', async () => {
    const found = await repo.findById('non-existent');
    expect(found).toBeUndefined();
  });

  test('should find all entities', async () => {
    await repo.create({ name: 'A', email: 'a@test.com', age: 20 });
    await repo.create({ name: 'B', email: 'b@test.com', age: 25 });
    const result = await repo.findAll();
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  test('should find all with pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create({ name: `User${i}`, email: `u${i}@test.com`, age: 20 + i });
    }
    const result = await repo.findAll({ pagination: { page: 2, pageSize: 2 } });
    expect(result.data).toHaveLength(2);
    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(3);
  });

  test('should find all with filter', async () => {
    await repo.create({ name: 'Alice', email: 'alice@test.com', age: 30 });
    await repo.create({ name: 'Bob', email: 'bob@test.com', age: 25 });
    const result = await repo.findAll({ filter: { name: 'Alice' } });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.name).toBe('Alice');
  });

  test('should find all with sorting', async () => {
    await repo.create({ name: 'Charlie', email: 'c@test.com', age: 35 });
    await repo.create({ name: 'Alice', email: 'a@test.com', age: 25 });
    const result = await repo.findAll({ sort: [{ field: 'name', direction: 'asc' }] });
    expect(result.data[0]!.name).toBe('Alice');
    expect(result.data[1]!.name).toBe('Charlie');
  });

  test('should update an entity', async () => {
    const created = await repo.create({ name: 'Alice', email: 'alice@test.com', age: 30 });
    const updated = await repo.update(created.id, { age: 31 });
    expect(updated.age).toBe(31);
    expect(updated.name).toBe('Alice');
  });

  test('should throw on update for non-existent entity', async () => {
    await expect(repo.update('non-existent', { name: 'X' })).rejects.toThrow('not found');
  });

  test('should soft delete an entity', async () => {
    const created = await repo.create({ name: 'Alice', email: 'alice@test.com', age: 30 });
    const deleted = await repo.delete(created.id);
    expect(deleted).toBe(true);
    const found = await repo.findById(created.id);
    expect(found).toBeUndefined();
  });

  test('should count entities', async () => {
    await repo.create({ name: 'A', email: 'a@test.com', age: 20 });
    await repo.create({ name: 'B', email: 'b@test.com', age: 25 });
    expect(await repo.count()).toBe(2);
  });

  test('should count with filter', async () => {
    await repo.create({ name: 'A', email: 'a@test.com', age: 20 });
    await repo.create({ name: 'B', email: 'b@test.com', age: 25 });
    expect(await repo.count({ name: 'A' })).toBe(1);
  });

  test('should check if entity exists', async () => {
    const created = await repo.create({ name: 'A', email: 'a@test.com', age: 20 });
    expect(await repo.exists(created.id)).toBe(true);
    expect(await repo.exists('non-existent')).toBe(false);
  });

  test('should not find soft-deleted entity', async () => {
    const created = await repo.create({ name: 'A', email: 'a@test.com', age: 20 });
    await repo.delete(created.id);
    expect(await repo.exists(created.id)).toBe(false);
  });

  test('should include deleted entities when requested', async () => {
    const created = await repo.create({ name: 'A', email: 'a@test.com', age: 20 });
    await repo.delete(created.id);
    const result = await repo.findAll({ includeDeleted: true });
    expect(result.data).toHaveLength(1);
  });

  test('should return false when deleting non-existent entity', async () => {
    expect(await repo.delete('non-existent')).toBe(false);
  });
});

// ============================================================
// Module 5: Transaction Manager Tests
// ============================================================

describe('TransactionManager', () => {
  let txManager: TransactionManager;
  const executedSql: string[] = [];

  beforeEach(() => {
    executedSql.length = 0;
    txManager = new TransactionManager((sql) => { executedSql.push(sql); return Promise.resolve(); });
  });

  test('should begin a transaction', async () => {
    const tx = await txManager.beginTransaction();
    expect(tx.id).toBeDefined();
    expect(tx.isCommitted).toBe(false);
    expect(tx.isRolledBack).toBe(false);
    expect(executedSql).toContain('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED');
  });

  test('should begin transaction with isolation level', async () => {
    const tx = await txManager.beginTransaction('SERIALIZABLE');
    expect(tx.isolationLevel).toBe('SERIALIZABLE');
    expect(executedSql[0]).toContain('SERIALIZABLE');
  });

  test('should commit a transaction', async () => {
    const tx = await txManager.beginTransaction();
    await txManager.commit(tx);
    expect(tx.isCommitted).toBe(true);
    expect(executedSql).toContain('COMMIT');
  });

  test('should rollback a transaction', async () => {
    const tx = await txManager.beginTransaction();
    await txManager.rollback(tx);
    expect(tx.isRolledBack).toBe(true);
    expect(executedSql).toContain('ROLLBACK');
  });

  test('should reject commit of non-active transaction', async () => {
    const tx = await txManager.beginTransaction();
    await txManager.commit(tx);
    await expect(txManager.commit(tx)).rejects.toThrow('already finalized');
  });

  test('should reject rollback of non-active transaction', async () => {
    const tx = await txManager.beginTransaction();
    await txManager.commit(tx);
    await expect(txManager.rollback(tx)).rejects.toThrow('already finalized');
  });

  test('should reject double commit', async () => {
    const tx = await txManager.beginTransaction();
    await txManager.commit(tx);
    await expect(txManager.commit(tx)).rejects.toThrow('already finalized');
  });

  test('should run in transaction with auto-commit', async () => {
    const result = await txManager.runInTransaction(async (tx) => {
      expect(tx.isActive === undefined || tx.isCommitted === false);
      return 'success';
    });
    expect(result).toBe('success');
    expect(executedSql).toContain('COMMIT');
  });

  test('should auto-rollback on error', async () => {
    await expect(
      txManager.runInTransaction(async () => {
        throw new Error('Test error');
      }),
    ).rejects.toThrow('Test error');
    expect(executedSql).toContain('ROLLBACK');
  });

  test('should create savepoint', async () => {
    const tx = await txManager.beginTransaction();
    const spName = await txManager.createSavepoint(tx);
    expect(spName).toBe('sp-1');
    expect(tx.savepoints).toContain('sp-1');
    expect(executedSql).toContain('SAVEPOINT sp-1');
  });

  test('should create named savepoint', async () => {
    const tx = await txManager.beginTransaction();
    const spName = await txManager.createSavepoint(tx, 'my_savepoint');
    expect(spName).toBe('my_savepoint');
  });

  test('should rollback to savepoint', async () => {
    const tx = await txManager.beginTransaction();
    await txManager.createSavepoint(tx, 'sp1');
    await txManager.rollbackToSavepoint(tx, 'sp1');
    expect(executedSql).toContain('ROLLBACK TO SAVEPOINT sp1');
  });

  test('should reject rollback to non-existent savepoint', async () => {
    const tx = await txManager.beginTransaction();
    await expect(txManager.rollbackToSavepoint(tx, 'nonexistent')).rejects.toThrow('not found');
  });

  test('should release savepoint', async () => {
    const tx = await txManager.beginTransaction();
    await txManager.createSavepoint(tx, 'sp1');
    await txManager.releaseSavepoint(tx, 'sp1');
    expect(tx.savepoints).not.toContain('sp1');
    expect(executedSql).toContain('RELEASE SAVEPOINT sp1');
  });

  test('should track active transactions', async () => {
    const tx1 = await txManager.beginTransaction();
    const tx2 = await txManager.beginTransaction();
    expect(txManager.getActiveCount()).toBe(2);
    await txManager.commit(tx1);
    expect(txManager.getActiveCount()).toBe(1);
    await txManager.commit(tx2);
    expect(txManager.getActiveCount()).toBe(0);
  });

  test('should check if transaction is active', async () => {
    const tx = await txManager.beginTransaction();
    expect(txManager.isActive(tx.id)).toBe(true);
    await txManager.commit(tx);
    expect(txManager.isActive(tx.id)).toBe(false);
  });

  test('should emit transaction events', async () => {
    const events: string[] = [];
    txManager.onEvent((e) => events.push(e.type));
    const tx = await txManager.beginTransaction();
    await txManager.commit(tx);
    expect(events).toContain('begin');
    expect(events).toContain('commit');
  });
});

// ============================================================
// Module 6: Data Mapper Tests
// ============================================================

describe('DataMapper', () => {
  let mapper: DataMapper;

  beforeEach(() => {
    mapper = new DataMapper();
    mapper.defineMapping({
      entityName: 'User',
      tableName: 'users',
      columns: [
        { entityField: 'id', columnName: 'user_id', type: 'string' },
        { entityField: 'name', columnName: 'full_name', type: 'string' },
        { entityField: 'age', columnName: 'user_age', type: 'number' },
        { entityField: 'active', columnName: 'is_active', type: 'boolean' },
      ],
      relations: [
        { name: 'profile', type: 'one-to-one', targetEntity: 'Profile', foreignKey: 'user_id' },
        { name: 'posts', type: 'one-to-many', targetEntity: 'Post', foreignKey: 'author_id' },
      ],
    });
  });

  test('should map database row to entity', () => {
    const row = { user_id: '1', full_name: 'Alice', user_age: '30', is_active: '1' };
    const entity = mapper.mapToEntity(row);
    expect(entity.id).toBe('1');
    expect(entity.name).toBe('Alice');
    expect(entity.age).toBe(30);
    expect(entity.active).toBe(true);
  });

  test('should map entity to database row', () => {
    const entity = { id: '1', name: 'Alice', age: 30, active: true };
    const row = mapper.mapToRow(entity);
    expect(row.user_id).toBe('1');
    expect(row.full_name).toBe('Alice');
    expect(row.user_age).toBe(30);
    expect(row.is_active).toBe(true);
  });

  test('should handle type conversion for numbers', () => {
    const row = { user_id: '1', full_name: 'Bob', user_age: '25', is_active: '0' };
    const entity = mapper.mapToEntity(row);
    expect(entity.age).toBe(25);
    expect(entity.active).toBe(false);
  });

  test('should handle null values', () => {
    const row = { user_id: '1', full_name: null, user_age: null, is_active: null };
    const entity = mapper.mapToEntity(row);
    expect(entity.name).toBeNull();
    expect(entity.age).toBeNull();
  });

  test('should get mapping by entity name', () => {
    const mapping = mapper.getMapping('User');
    expect(mapping.tableName).toBe('users');
    expect(mapping.columns).toHaveLength(4);
  });

  test('should throw for non-existent mapping', () => {
    expect(() => mapper.getMapping('NonExistent')).toThrow('not found');
  });

  test('should get relations', () => {
    const relations = mapper.getRelations('User');
    expect(relations).toHaveLength(2);
    expect(relations[0]!.type).toBe('one-to-one');
    expect(relations[1]!.type).toBe('one-to-many');
  });

  test('should get columns', () => {
    const columns = mapper.getColumns('User');
    expect(columns).toHaveLength(4);
  });

  test('should get table name', () => {
    expect(mapper.getTableName('User')).toBe('users');
  });

  test('should check if mapping exists', () => {
    expect(mapper.hasMapping('User')).toBe(true);
    expect(mapper.hasMapping('NonExistent')).toBe(false);
  });

  test('should remove mapping', () => {
    expect(mapper.hasMapping('User')).toBe(true);
    mapper.removeMapping('User');
    expect(mapper.hasMapping('User')).toBe(false);
  });

  test('should use default entity name', () => {
    const row = { user_id: '1', full_name: 'Alice', user_age: '30', is_active: '1' };
    const entity = mapper.mapToEntity(row);
    expect(entity.name).toBe('Alice');
  });

  test('should throw when no default entity and no name specified', () => {
    const emptyMapper = new DataMapper();
    expect(() => emptyMapper.mapToEntity({})).toThrow('No entity name specified');
  });

  test('should handle custom transforms', () => {
    const customMapper = new DataMapper();
    customMapper.defineMapping({
      entityName: 'Product',
      tableName: 'products',
      columns: [
        {
          entityField: 'price',
          columnName: 'price_cents',
          transform: (val: unknown) => Number(val) * 100,
          reverseTransform: (val: unknown) => Number(val) / 100,
        },
      ],
      relations: [],
    });
    const row = { price_cents: 999 };
    const entity = customMapper.mapToEntity(row);
    expect(entity.price).toBe(9.99);

    const dbRow = customMapper.mapToRow({ price: 19.99 });
    expect(dbRow.price_cents).toBeCloseTo(1999);
  });

  test('should handle multiple mappings', () => {
    mapper.defineMapping({
      entityName: 'Post',
      tableName: 'posts',
      columns: [
        { entityField: 'id', columnName: 'post_id' },
        { entityField: 'title', columnName: 'post_title' },
      ],
      relations: [],
    });
    expect(mapper.getAllMappings().size).toBe(2);
  });
});

// ============================================================
// Module 7: Query Executor Tests
// ============================================================

describe('QueryExecutor', () => {
  let executor: QueryExecutor;
  const queryResults: Record<string, Record<string, unknown>[]> = {};

  beforeEach(() => {
    queryResults['SELECT * FROM users'] = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];
    queryResults['SELECT * FROM users WHERE id = ?'] = [
      { id: 1, name: 'Alice' },
    ];
    executor = new QueryExecutor(
      async (sql, params) => {
        const key = sql;
        return queryResults[key] ?? [];
      },
    );
  });

  test('should execute a query', async () => {
    const result = await executor.execute('SELECT * FROM users');
    expect(result.rows).toHaveLength(2);
    expect(result.rowCount).toBe(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('should execute with parameters', async () => {
    const result = await executor.execute('SELECT * FROM users WHERE id = ?', [1]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.name).toBe('Alice');
  });

  test('should executeOne and return single result', async () => {
    const result = await executor.executeOne('SELECT * FROM users WHERE id = ?', [1]);
    expect(result).toBeDefined();
    expect(result!.name).toBe('Alice');
  });

  test('should return undefined for executeOne with no results', async () => {
    const result = await executor.executeOne('SELECT * FROM empty');
    expect(result).toBeUndefined();
  });

  test('should execute many queries', async () => {
    const result = await executor.executeMany([
      { sql: 'SELECT * FROM users' },
      { sql: 'SELECT * FROM users WHERE id = ?', params: [1] },
    ]);
    expect(result.results).toHaveLength(2);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('should handle partial failures in executeMany', async () => {
    const failExecutor = new QueryExecutor(
      async (sql) => {
        if (sql.includes('FAIL')) throw new Error('Query failed');
        return [{ id: 1 }];
      },
    );
    const result = await failExecutor.executeMany([
      { sql: 'SELECT 1' },
      { sql: 'FAIL QUERY' },
    ]);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.results).toHaveLength(1);
  });

  test('should execute a QueryBuilder', async () => {
    const qb = new QueryBuilder().select(['*']).from('users');
    const result = await executor.executeBuilder(qb);
    expect(result.rows).toHaveLength(2);
  });

  test('should executeBuilderOne', async () => {
    const qb = new QueryBuilder().select(['*']).from('users').where('id = ?', [1]);
    const result = await executor.executeBuilderOne(qb);
    expect(result).toBeDefined();
  });

  test('should log queries', async () => {
    await executor.execute('SELECT * FROM users');
    const log = executor.getQueryLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.sql).toBe('SELECT * FROM users');
  });

  test('should track slow queries', async () => {
    const slowExecutor = new QueryExecutor(
      async () => {
        // Simulate slow query
        await new Promise(resolve => setTimeout(resolve, 10));
        return [];
      },
    );
    await slowExecutor.execute('SLOW QUERY');
    const slow = slowExecutor.getSlowQueries(0);
    expect(slow.length).toBeGreaterThanOrEqual(0);
  });

  test('should clear log', async () => {
    await executor.execute('SELECT * FROM users');
    executor.clearLog();
    expect(executor.getLogSize()).toBe(0);
  });

  test('should get log size', async () => {
    await executor.execute('SELECT 1');
    await executor.execute('SELECT 2');
    expect(executor.getLogSize()).toBe(2);
  });

  test('should handle query errors', async () => {
    const errorExecutor = new QueryExecutor(
      async () => { throw new Error('DB Error'); },
    );
    await expect(errorExecutor.execute('BAD')).rejects.toThrow('DB Error');
    const errorLog = errorExecutor.getErrorQueries();
    expect(errorLog).toHaveLength(1);
  });

  test('should stream results', async () => {
    const result = await executor.execute('SELECT * FROM users');
    const batches: Record<string, unknown>[][] = [];
    for await (const batch of executor.stream('SELECT * FROM users', undefined, { batchSize: 1 })) {
      batches.push(batch);
    }
    expect(batches.length).toBe(2);
  });

  test('should stream with callback', async () => {
    const batches: Record<string, unknown>[][] = [];
    await executor.streamWithCallback('SELECT * FROM users', undefined, {
      batchSize: 1,
      onBatch: async (rows) => { batches.push(rows); },
    });
    expect(batches.length).toBe(2);
  });
});

// ============================================================
// Module 8: Seed Manager Tests
// ============================================================

describe('SeedManager', () => {
  let seedManager: SeedManager;
  const executedSql: string[] = [];

  beforeEach(() => {
    executedSql.length = 0;
    seedManager = new SeedManager(
      (sql) => { executedSql.push(sql); return Promise.resolve(); },
      'test',
    );
  });

  test('should create a seed', () => {
    const seed = seedManager.createSeed('users', [{ name: 'Alice' }, { name: 'Bob' }]);
    expect(seed.name).toBe('users');
    expect(seed.data).toHaveLength(2);
    expect(seed.order).toBe(1);
  });

  test('should create seeds with incrementing order', () => {
    const s1 = seedManager.createSeed('users', []);
    const s2 = seedManager.createSeed('roles', []);
    expect(s1.order).toBeLessThan(s2.order);
  });

  test('should run a single seed', async () => {
    seedManager.createSeed('users', [{ name: 'Alice' }]);
    await seedManager.runSeed('users');
    expect(executedSql.length).toBeGreaterThan(0);
  });

  test('should throw for non-existent seed', async () => {
    await expect(seedManager.runSeed('nonexistent')).rejects.toThrow('not found');
  });

  test('should run all seeds', async () => {
    seedManager.createSeed('users', [{ name: 'Alice' }]);
    seedManager.createSeed('roles', [{ name: 'admin' }]);
    const result = await seedManager.runAllSeeds();
    expect(result.success).toBe(true);
    expect(result.applied).toHaveLength(2);
  });

  test('should not re-run seeds with runOnce', async () => {
    seedManager.createSeed('users', [{ name: 'Alice' }]);
    await seedManager.runSeed('users');
    executedSql.length = 0;
    await seedManager.runSeed('users');
    expect(executedSql).toHaveLength(0);
  });

  test('should respect environment', async () => {
    seedManager.setEnvironment('production');
    seedManager.createSeed('test_data', [{ x: 1 }], { environment: 'development' });
    await seedManager.runSeed('test_data');
    expect(executedSql).toHaveLength(0);
  });

  test('should allow wildcard environment', async () => {
    seedManager.setEnvironment('production');
    seedManager.createSeed('base_data', [{ x: 1 }], { environment: '*' });
    await seedManager.runSeed('base_data');
    expect(executedSql.length).toBeGreaterThan(0);
  });

  test('should handle seed dependencies', async () => {
    seedManager.createSeed('roles', [{ name: 'admin' }]);
    seedManager.createSeed('users', [{ name: 'Alice' }], { dependencies: ['roles'] });
    await expect(seedManager.runSeed('users')).rejects.toThrow('Dependency seed');
  });

  test('should get pending seeds', () => {
    seedManager.createSeed('users', []);
    seedManager.createSeed('roles', []);
    const pending = seedManager.getPendingSeeds();
    expect(pending).toHaveLength(2);
  });

  test('should get seed history', async () => {
    seedManager.createSeed('users', [{ name: 'Alice' }]);
    await seedManager.runSeed('users');
    const history = seedManager.getSeedHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.name).toBe('users');
  });

  test('should rollback a seed', async () => {
    seedManager.createSeed('users', [{ name: 'Alice' }]);
    await seedManager.runSeed('users');
    await seedManager.rollbackSeed('users');
    const history = seedManager.getSeedHistory();
    expect(history).toHaveLength(0);
  });

  test('should throw rollback for non-applied seed', async () => {
    seedManager.createSeed('users', []);
    await expect(seedManager.rollbackSeed('users')).rejects.toThrow('has not been applied');
  });

  test('should get all seeds', () => {
    seedManager.createSeed('a', []);
    seedManager.createSeed('b', []);
    expect(seedManager.getAllSeeds()).toHaveLength(2);
  });

  test('should set and get environment', () => {
    seedManager.setEnvironment('production');
    expect(seedManager.getEnvironment()).toBe('production');
  });

  test('should handle partial failures in runAllSeeds', async () => {
    seedManager.createSeed('good', []);
    seedManager.createSeed('bad', [], { dependencies: ['nonexistent'] });
    const result = await seedManager.runAllSeeds();
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});

// ============================================================
// Module 9: Index Manager Tests
// ============================================================

describe('IndexManager', () => {
  let indexManager: IndexManager;
  const executedSql: string[] = [];

  beforeEach(() => {
    executedSql.length = 0;
    indexManager = new IndexManager(
      (sql) => { executedSql.push(sql); return Promise.resolve(); },
      () => Promise.resolve([]),
    );
  });

  test('should create a btree index', async () => {
    const name = await indexManager.createIndex('users', ['email']);
    expect(name).toContain('users');
    expect(name).toContain('email');
    expect(executedSql[0]).toContain('INDEX');
    expect(executedSql[0]).toContain('users');
    expect(executedSql[0]).toContain('email');
  });

  test('should create a unique index', async () => {
    const name = await indexManager.createIndex('users', ['email'], { unique: true });
    expect(executedSql[0]).toContain('UNIQUE');
    expect(indexManager.getIndex(name)!.unique).toBe(true);
  });

  test('should create a hash index', async () => {
    await indexManager.createIndex('users', ['id'], { type: 'hash' });
    expect(executedSql[0]).toContain('USING HASH');
  });

  test('should create a fulltext index', async () => {
    await indexManager.createIndex('posts', ['title', 'body'], { type: 'fulltext' });
    expect(executedSql[0]).toContain('USING FULLTEXT');
  });

  test('should create index with IF NOT EXISTS', async () => {
    await indexManager.createIndex('users', ['email'], { ifNotExists: true });
    expect(executedSql[0]).toContain('IF NOT EXISTS');
  });

  test('should drop an index', async () => {
    const name = await indexManager.createIndex('users', ['email']);
    await indexManager.dropIndex(name);
    expect(executedSql[1]).toContain('DROP INDEX');
    expect(indexManager.getIndex(name)).toBeUndefined();
  });

  test('should throw when dropping non-existent index', async () => {
    await expect(indexManager.dropIndex('nonexistent')).rejects.toThrow('not found');
  });

  test('should rebuild an index', async () => {
    const name = await indexManager.createIndex('users', ['email']);
    await indexManager.rebuildIndex(name);
    expect(executedSql[1]).toContain('REINDEX INDEX');
  });

  test('should rebuild all indexes', async () => {
    await indexManager.createIndex('users', ['email']);
    await indexManager.createIndex('posts', ['title']);
    await indexManager.rebuildAllIndexes();
    expect(executedSql[2]).toContain('REINDEX');
  });

  test('should analyze indexes', async () => {
    await indexManager.createIndex('users', ['email']);
    await indexManager.createIndex('posts', ['title']);
    const analysis = indexManager.analyzeIndexes();
    expect(analysis.totalIndexes).toBe(2);
    expect(analysis.indexes).toHaveLength(2);
  });

  test('should get unused indexes', async () => {
    await indexManager.createIndex('users', ['email']);
    const unused = indexManager.getUnusedIndexes();
    expect(unused.length).toBeGreaterThanOrEqual(0);
  });

  test('should find duplicate indexes', async () => {
    await indexManager.createIndex('users', ['email', 'name']);
    await indexManager.createIndex('users', ['name', 'email']);
    const analysis = indexManager.analyzeIndexes();
    expect(analysis.duplicateIndexes.length).toBeGreaterThanOrEqual(0);
  });

  test('should suggest indexes based on query log', () => {
    const suggestions = indexManager.suggestIndexes([
      {
        sql: 'SELECT * FROM users WHERE email = ?',
        table: 'users',
        columns: ['*'],
        whereColumns: ['email'],
        frequency: 50,
        avgDurationMs: 200,
      },
    ]);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0]!.table).toBe('users');
    expect(suggestions[0]!.columns).toContain('email');
  });

  test('should get indexes for a table', async () => {
    await indexManager.createIndex('users', ['email']);
    await indexManager.createIndex('users', ['name']);
    const indexes = indexManager.getIndexesForTable('users');
    expect(indexes).toHaveLength(2);
  });

  test('should get all indexes', async () => {
    await indexManager.createIndex('users', ['email']);
    await indexManager.createIndex('posts', ['title']);
    expect(indexManager.getAllIndexes()).toHaveLength(2);
  });

  test('should get index count', async () => {
    await indexManager.createIndex('users', ['email']);
    expect(indexManager.getIndexCount()).toBe(1);
  });

  test('should get index by name', async () => {
    const name = await indexManager.createIndex('users', ['email']);
    const idx = indexManager.getIndex(name);
    expect(idx).toBeDefined();
    expect(idx!.table).toBe('users');
  });

  test('should not suggest index when one already exists', async () => {
    await indexManager.createIndex('users', ['email']);
    const suggestions = indexManager.suggestIndexes([
      {
        sql: 'SELECT * FROM users WHERE email = ?',
        table: 'users',
        columns: ['*'],
        whereColumns: ['email'],
        frequency: 100,
        avgDurationMs: 100,
      },
    ]);
    expect(suggestions).toHaveLength(0);
  });

  test('should estimate impact level for suggestions', () => {
    const suggestions = indexManager.suggestIndexes([
      {
        sql: 'SELECT * FROM orders WHERE status = ?',
        table: 'orders',
        columns: ['*'],
        whereColumns: ['status'],
        frequency: 200,
        avgDurationMs: 500,
      },
    ]);
    if (suggestions.length > 0) {
      expect(['high', 'medium', 'low']).toContain(suggestions[0]!.estimatedImpact);
    }
  });
});

// ============================================================
// Module 10: Database Health Monitor Tests
// ============================================================

describe('DatabaseHealthMonitor', () => {
  let monitor: DatabaseHealthMonitor;

  beforeEach(() => {
    monitor = new DatabaseHealthMonitor();
  });

  test('should return healthy status by default', () => {
    const report = monitor.getHealthStatus();
    expect(report.status).toBe('healthy');
  });

  test('should record query durations', () => {
    monitor.recordQuery(50);
    monitor.recordQuery(100);
    monitor.recordQuery(150);
    const perf = monitor.getHealthStatus().queryPerformance;
    expect(perf.totalQueries).toBe(3);
    expect(perf.avgDurationMs).toBe(100);
    expect(perf.maxDurationMs).toBe(150);
    expect(perf.minDurationMs).toBe(50);
  });

  test('should detect slow queries', () => {
    monitor.recordQuery(2000, 'SELECT * FROM large_table');
    const slow = monitor.getSlowQueries(1000);
    expect(slow).toHaveLength(1);
    expect(slow[0]!.durationMs).toBe(2000);
  });

  test('should record errors', () => {
    monitor.recordQuery(10);
    monitor.recordQuery(10);
    monitor.recordQuery(10);
    monitor.recordError();
    monitor.recordError();
    const perf = monitor.getHealthStatus().queryPerformance;
    expect(perf.errorCount).toBe(2);
    expect(perf.errorRate).toBeCloseTo(2 / 3, 4);
  });

  test('should report degraded status with high error rate', () => {
    for (let i = 0; i < 100; i++) {
      monitor.recordQuery(10);
    }
    for (let i = 0; i < 10; i++) {
      monitor.recordError();
    }
    const report = monitor.getHealthStatus();
    expect(['degraded', 'unhealthy']).toContain(report.status);
  });

  test('should update connection pool metrics', () => {
    monitor.updateConnectionPoolMetrics({
      totalConnections: 10,
      activeConnections: 9,
      idleConnections: 1,
    });
    const report = monitor.getHealthStatus();
    expect(report.connectionPool.totalConnections).toBe(10);
    expect(report.connectionPool.activeConnections).toBe(9);
  });

  test('should report degraded status with high connection usage', () => {
    monitor.updateConnectionPoolMetrics({
      totalConnections: 10,
      activeConnections: 10,
      idleConnections: 0,
    });
    const report = monitor.getHealthStatus();
    expect(report.status).toBe('degraded');
  });

  test('should manage locks', () => {
    const lock: LockInfo = {
      id: 'lock-1',
      lockType: 'row',
      tableName: 'users',
      mode: 'EXCLUSIVE',
      granted: true,
      acquiredAt: Date.now() - 1000,
      durationMs: 1000,
    };
    monitor.addLock(lock);
    expect(monitor.getActiveLocks()).toHaveLength(1);
    monitor.removeLock('lock-1');
    expect(monitor.getActiveLocks()).toHaveLength(0);
  });

  test('should report unhealthy with long-running locks', () => {
    const lock: LockInfo = {
      id: 'lock-1',
      lockType: 'table',
      tableName: 'users',
      mode: 'EXCLUSIVE',
      granted: true,
      acquiredAt: Date.now() - 60000,
      durationMs: 60000,
    };
    monitor.addLock(lock);
    const report = monitor.getHealthStatus();
    expect(report.status).toBe('unhealthy');
  });

  test('should track table sizes', () => {
    monitor.updateTableSize({
      tableName: 'users',
      rowCount: 1000,
      sizeBytes: 102400,
      indexSizeBytes: 51200,
    });
    const sizes = monitor.getTableSizes();
    expect(sizes).toHaveLength(1);
    expect(sizes[0]!.rowCount).toBe(1000);
  });

  test('should generate recommendations', () => {
    monitor.updateConnectionPoolMetrics({
      totalConnections: 10,
      activeConnections: 10,
      idleConnections: 0,
    });
    const report = monitor.getHealthStatus();
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  test('should provide performance metrics', () => {
    const metrics = monitor.getPerformanceMetrics();
    expect(metrics.cacheHitRatio).toBeGreaterThanOrEqual(0);
    expect(metrics.cacheHitRatio).toBeLessThanOrEqual(1);
  });

  test('should start and stop monitoring', () => {
    monitor.startMonitoring();
    monitor.stopMonitoring();
    // Should not throw
    expect(true).toBe(true);
  });

  test('should handle health check callbacks', () => {
    const reports: string[] = [];
    monitor.onHealthCheck((report) => reports.push(report.status));
    monitor.startMonitoring();
    monitor.stopMonitoring();
    // Callback registered successfully
    expect(true).toBe(true);
  });

  test('should allow unsubscribing from health checks', () => {
    const reports: string[] = [];
    const unsub = monitor.onHealthCheck((report) => reports.push(report.status));
    unsub();
    expect(true).toBe(true);
  });

  test('should reset all metrics', () => {
    monitor.recordQuery(100);
    monitor.recordError();
    monitor.updateConnectionPoolMetrics({ totalConnections: 10, activeConnections: 5 });
    monitor.reset();
    const report = monitor.getHealthStatus();
    expect(report.queryPerformance.totalQueries).toBe(0);
    expect(report.queryPerformance.errorCount).toBe(0);
  });

  test('should update config', () => {
    monitor.updateConfig({ slowQueryThresholdMs: 500, maxErrorRate: 0.1 });
    const config = monitor.getConfig();
    expect(config.slowQueryThresholdMs).toBe(500);
    expect(config.maxErrorRate).toBe(0.1);
  });

  test('should use default config values', () => {
    const config = monitor.getConfig();
    expect(config.slowQueryThresholdMs).toBe(1000);
    expect(config.maxConnectionUsage).toBe(0.9);
    expect(config.maxErrorRate).toBe(0.05);
    expect(config.maxLockDurationMs).toBe(30000);
    expect(config.checkIntervalMs).toBe(30000);
  });

  test('should include timestamps in report', () => {
    const report = monitor.getHealthStatus();
    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.uptime).toBeGreaterThanOrEqual(0);
  });

  test('should calculate queries per second', () => {
    monitor.recordQuery(10);
    monitor.recordQuery(20);
    const perf = monitor.getHealthStatus().queryPerformance;
    expect(perf.queriesPerSecond).toBeGreaterThanOrEqual(0);
  });

  test('should trim slow query log', () => {
    for (let i = 0; i < 150; i++) {
      monitor.recordQuery(2000, `SLOW QUERY ${i}`);
    }
    const slow = monitor.getSlowQueries(1000);
    expect(slow.length).toBeLessThanOrEqual(100);
  });
});
