// ============================================================================
// @claude-agent/perf - ConnectionPool
// HTTP 连接复用和通用连接池，支持健康检查和自动重连
// ============================================================================

export interface ConnectionFactory<T> {
  create: () => Promise<T>;
  destroy: (conn: T) => Promise<void>;
  validate?: (conn: T) => Promise<boolean>;
  reset?: (conn: T) => Promise<void>;
}

export interface ConnectionPoolOptions<T> {
  /** 连接工厂 */
  factory: ConnectionFactory<T>;
  /** 最小连接数 */
  min?: number;
  /** 最大连接数 */
  max?: number;
  /** 连接最大空闲时间（ms） */
  maxIdleTime?: number;
  /** 连接最大生命周期（ms） */
  maxLifeTime?: number;
  /** 获取连接超时（ms） */
  acquireTimeout?: number;
  /** 健康检查间隔（ms） */
  healthCheckInterval?: number;
  /** 连接名称（用于日志） */
  name?: string;
}

interface PooledConnection<T> {
  conn: T;
  createdAt: number;
  lastUsedAt: number;
  lastValidatedAt: number;
  inUse: boolean;
}

export interface ConnectionPoolStats {
  /** 总连接数 */
  total: number;
  /** 空闲连接数 */
  idle: number;
  /** 使用中连接数 */
  inUse: number;
  /** 等待获取连接的请求数 */
  waiting: number;
  /** 总获取次数 */
  totalAcquired: number;
  /** 总创建次数 */
  totalCreated: number;
  /** 总销毁次数 */
  totalDestroyed: number;
  /** 总健康检查失败次数 */
  healthCheckFailures: number;
}

export class ConnectionPool<T> {
  private pool: PooledConnection<T>[] = [];
  private waitQueue: Array<{
    resolve: (conn: T) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private options: Required<Omit<ConnectionPoolOptions<T>, 'name'>> & { name: string };
  private stats = {
    totalAcquired: 0,
    totalCreated: 0,
    totalDestroyed: 0,
    healthCheckFailures: 0,
  };
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private ready: Promise<void>;
  private disposed = false;

  constructor(options: ConnectionPoolOptions<T>) {
    this.options = {
      factory: options.factory,
      min: options.min ?? 2,
      max: options.max ?? 20,
      maxIdleTime: options.maxIdleTime ?? 30_000,
      maxLifeTime: options.maxLifeTime ?? 300_000,
      acquireTimeout: options.acquireTimeout ?? 10_000,
      healthCheckInterval: options.healthCheckInterval ?? 15_000,
      name: options.name ?? 'ConnectionPool',
    };

    // Pre-create minimum connections
    this.ready = this.initializePool();

    // Start health check timer
    this.healthCheckTimer = setInterval(() => this.healthCheck(), this.options.healthCheckInterval);
  }

  /** 获取一个连接 */
  async acquire(): Promise<T> {
    if (this.disposed) {
      throw new Error(`${this.options.name} is disposed`);
    }

    // Wait for initial pool to be ready
    await this.ready;

    this.stats.totalAcquired++;

    // Try to find an idle connection
    const idleConn = this.pool.find((c) => !c.inUse);
    if (idleConn) {
      return this.activateConnection(idleConn);
    }

    // Try to create a new connection if under max (use pending count to avoid race)
    const inUseOrPending = this.pool.filter((c) => c.inUse).length + this.waitQueue.length;
    if (inUseOrPending < this.options.max) {
      return this.createAndActivate();
    }

    // Wait for a connection to be released
    return this.waitForConnection();
  }

  /** 释放连接回池中 */
  async release(conn: T): Promise<void> {
    const pooled = this.pool.find((c) => c.conn === conn && c.inUse);
    if (!pooled) {
      // Not from this pool, destroy it
      try {
        await this.options.factory.destroy(conn);
      } catch {
        // Ignore destroy errors for foreign connections
      }
      return;
    }

    // Check if connection has exceeded max life time
    if (Date.now() - pooled.createdAt > this.options.maxLifeTime) {
      this.removeConnection(pooled);
      // Notify waiters since a slot opened up
      this._notifyWaiters();
      return;
    }

    // Reset connection if possible
    if (this.options.factory.reset) {
      try {
        await this.options.factory.reset(pooled.conn);
      } catch {
        this.removeConnection(pooled);
        // Notify waiters since a slot opened up
        this._notifyWaiters();
        return;
      }
    }

    pooled.inUse = false;
    pooled.lastUsedAt = Date.now();

    // Wake up a waiting request
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timer);
      this.activateConnection(pooled).then(waiter.resolve).catch(waiter.reject);
    }
  }

  /** 获取统计信息 */
  getStats(): ConnectionPoolStats {
    return {
      total: this.pool.length,
      idle: this.pool.filter((c) => !c.inUse).length,
      inUse: this.pool.filter((c) => c.inUse).length,
      waiting: this.waitQueue.length,
      totalAcquired: this.stats.totalAcquired,
      totalCreated: this.stats.totalCreated,
      totalDestroyed: this.stats.totalDestroyed,
      healthCheckFailures: this.stats.healthCheckFailures,
    };
  }

  /** 销毁连接池 */
  async dispose(): Promise<void> {
    this.disposed = true;

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Reject waiting requests
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`${this.options.name} disposed`));
    }
    this.waitQueue.length = 0;

    // Destroy all connections
    for (const pooled of this.pool) {
      try {
        await this.options.factory.destroy(pooled.conn);
        this.stats.totalDestroyed++;
      } catch {
        // Ignore destroy errors during disposal
      }
    }
    this.pool.length = 0;
  }

  private async initializePool(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.options.min; i++) {
      promises.push(
        this.options.factory.create().then((conn) => {
          this.pool.push({
            conn,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            lastValidatedAt: Date.now(),
            inUse: false,
          });
          this.stats.totalCreated++;
        }).catch(() => {
          // Ignore initialization errors
        }),
      );
    }
    await Promise.allSettled(promises);
  }

  private async activateConnection(pooled: PooledConnection<T>): Promise<T> {
    // Validate before use
    if (this.options.factory.validate) {
      try {
        const valid = await this.options.factory.validate(pooled.conn);
        if (!valid) {
          this.removeConnection(pooled);
          return this.createAndActivate();
        }
      } catch {
        this.removeConnection(pooled);
        return this.createAndActivate();
      }
    }

    pooled.inUse = true;
    pooled.lastUsedAt = Date.now();
    return pooled.conn;
  }

  private async createAndActivate(): Promise<T> {
    const conn = await this.options.factory.create();
    const pooled: PooledConnection<T> = {
      conn,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      lastValidatedAt: Date.now(),
      inUse: true,
    };
    this.pool.push(pooled);
    this.stats.totalCreated++;
    return conn;
  }

  private waitForConnection(): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        reject(new Error(`Acquire timeout after ${this.options.acquireTimeout}ms`));
      }, this.options.acquireTimeout);

      this.waitQueue.push({ resolve, reject, timer });
    });
  }

  private _notifyWaiters(): void {
    while (this.waitQueue.length > 0 && this.pool.length < this.options.max) {
      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timer);
      // Create a new connection for the waiter
      this.createAndActivate().then(waiter.resolve).catch(waiter.reject);
    }
  }

  private async removeConnection(pooled: PooledConnection<T>): Promise<void> {
    const index = this.pool.indexOf(pooled);
    if (index !== -1) {
      this.pool.splice(index, 1);
    }
    try {
      await this.options.factory.destroy(pooled.conn);
      this.stats.totalDestroyed++;
    } catch {
      // Ignore destroy errors
    }
  }

  private async healthCheck(): Promise<void> {
    const now = Date.now();

    for (let i = this.pool.length - 1; i >= 0; i--) {
      const pooled = this.pool[i]!;

      // Skip in-use connections
      if (pooled.inUse) continue;

      // Check max idle time
      if (now - pooled.lastUsedAt > this.options.maxIdleTime && this.pool.length > this.options.min) {
        await this.removeConnection(pooled);
        continue;
      }

      // Check max life time
      if (now - pooled.createdAt > this.options.maxLifeTime) {
        await this.removeConnection(pooled);
        continue;
      }

      // Validate connection
      if (this.options.factory.validate) {
        try {
          const valid = await this.options.factory.validate(pooled.conn);
          if (!valid) {
            this.stats.healthCheckFailures++;
            await this.removeConnection(pooled);
          }
        } catch {
          this.stats.healthCheckFailures++;
          await this.removeConnection(pooled);
        }
      }
    }

    // Ensure minimum connections
    while (this.pool.length < this.options.min && !this.disposed) {
      try {
        const conn = await this.options.factory.create();
        this.pool.push({
          conn,
          createdAt: now,
          lastUsedAt: now,
          lastValidatedAt: now,
          inUse: false,
        });
        this.stats.totalCreated++;
      } catch {
        break;
      }
    }

    // Notify any waiters that connections may now be available
    this._notifyWaiters();
  }
}
