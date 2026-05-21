// ============================================================
// Module 1: Connection Pool Manager
// ============================================================

export interface DatabaseConnection {
  id: string;
  readonly createdAt: number;
  readonly lastUsedAt: number;
  isHealthy(): boolean;
  close(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export interface PoolConfig {
  min: number;
  max: number;
  idleTimeoutMs: number;
  acquireTimeoutMs: number;
  healthCheckIntervalMs: number;
  maxLifetimeMs: number;
}

export interface PoolEvent {
  type: 'acquire' | 'release' | 'create' | 'destroy' | 'error' | 'healthCheck';
  connectionId?: string;
  timestamp: number;
  detail?: string;
}

export type PoolEventHandler = (event: PoolEvent) => void;

const DEFAULT_CONFIG: PoolConfig = {
  min: 2,
  max: 10,
  idleTimeoutMs: 30000,
  acquireTimeoutMs: 5000,
  healthCheckIntervalMs: 10000,
  maxLifetimeMs: 300000,
};

export class DatabaseConnectionPool {
  private config: PoolConfig;
  private available: DatabaseConnection[] = [];
  private inUse: Map<string, DatabaseConnection> = new Map();
  private eventHandlers: Set<PoolEventHandler> = new Set();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private connectionCounter = 0;
  private _draining = false;
  private createConnectionFn: (id: string) => Promise<DatabaseConnection>;

  constructor(
    createConnection: (id: string) => Promise<DatabaseConnection>,
    config?: Partial<PoolConfig>,
  ) {
    this.createConnectionFn = createConnection;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  onEvent(handler: PoolEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: PoolEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  async initialize(): Promise<void> {
    for (let i = 0; i < this.config.min; i++) {
      const conn = await this.createConnection();
      this.available.push(conn);
    }
    this.startHealthChecks();
    this.startIdleChecks();
  }

  private async createConnection(): Promise<DatabaseConnection> {
    this.connectionCounter++;
    const id = `conn-${this.connectionCounter}`;
    const conn = await this.createConnectionFn(id);
    this.emit({ type: 'create', connectionId: id, timestamp: Date.now() });
    return conn;
  }

  async acquire(): Promise<DatabaseConnection> {
    if (this._draining) {
      throw new Error('Pool is draining, cannot acquire connections');
    }

    // Try to find a healthy available connection
    while (this.available.length > 0) {
      const conn = this.available.pop()!;
      if (conn.isHealthy() && this.isWithinLifetime(conn)) {
        this.inUse.set(conn.id, conn);
        this.emit({ type: 'acquire', connectionId: conn.id, timestamp: Date.now() });
        return conn;
      } else {
        // Stale connection - destroy it
        await this.destroyConnection(conn);
      }
    }

    // Create new if under max
    if (this.inUse.size < this.config.max) {
      const conn = await this.createConnection();
      this.inUse.set(conn.id, conn);
      this.emit({ type: 'acquire', connectionId: conn.id, timestamp: Date.now() });
      return conn;
    }

    // Wait for a connection to be released
    return this.waitForAvailable();
  }

  private waitForAvailable(): Promise<DatabaseConnection> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Acquire timeout: no available connection within ${this.config.acquireTimeoutMs}ms`));
      }, this.config.acquireTimeoutMs);

      const checkInterval = setInterval(() => {
        // Check if draining - reject immediately
        if (this._draining) {
          cleanup();
          reject(new Error('Pool is draining, cannot acquire connections'));
          return;
        }
        if (this.available.length > 0 || this.inUse.size < this.config.max) {
          cleanup();
          this.acquire().then(resolve).catch(reject);
        }
      }, 10);

      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(checkInterval);
      };
    });
  }

  release(connection: DatabaseConnection): void {
    if (!this.inUse.has(connection.id)) {
      return;
    }
    this.inUse.delete(connection.id);

    if (this._draining) {
      connection.close();
      return;
    }

    if (connection.isHealthy() && this.isWithinLifetime(connection)) {
      this.available.push(connection);
      this.emit({ type: 'release', connectionId: connection.id, timestamp: Date.now() });
    } else {
      this.destroyConnection(connection);
    }
  }

  private isWithinLifetime(conn: DatabaseConnection): boolean {
    return Date.now() - conn.createdAt < this.config.maxLifetimeMs;
  }

  private async destroyConnection(conn: DatabaseConnection): Promise<void> {
    try {
      await conn.close();
      this.emit({ type: 'destroy', connectionId: conn.id, timestamp: Date.now() });
    } catch (err) {
      this.emit({
        type: 'error',
        connectionId: conn.id,
        timestamp: Date.now(),
        detail: String(err),
      });
    }
  }

  getPoolSize(): number {
    return this.available.length + this.inUse.size;
  }

  getActiveCount(): number {
    return this.inUse.size;
  }

  getIdleCount(): number {
    return this.available.length;
  }

  getConfig(): Readonly<PoolConfig> {
    return this.config;
  }

  async drain(): Promise<void> {
    this._draining = true;
    this.stopHealthChecks();
    this.stopIdleChecks();

    // Wait for in-use connections to be released
    const checkDrain = (): Promise<void> => {
      if (this.inUse.size === 0) return Promise.resolve();
      return new Promise(resolve => setTimeout(resolve, 100)).then(checkDrain);
    };
    await checkDrain();

    // Close all available connections
    const closePromises = this.available.map(conn => this.destroyConnection(conn));
    await Promise.all(closePromises);
    this.available = [];
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);
  }

  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private performHealthCheck(): void {
    const now = Date.now();
    this.available = this.available.filter(conn => {
      const isHealthy = conn.isHealthy() && this.isWithinLifetime(conn);
      if (!isHealthy) {
        this.destroyConnection(conn);
        this.emit({
          type: 'healthCheck',
          connectionId: conn.id,
          timestamp: now,
          detail: 'Connection failed health check',
        });
      }
      return isHealthy;
    });

    // Replenish to min - create one at a time to avoid overwhelming the database
    if (this.available.length + this.inUse.size < this.config.min) {
      this.createConnection().then(conn => this.available.push(conn)).catch(err => {
        this.emit({
          type: 'error',
          timestamp: Date.now(),
          detail: `Failed to replenish connection: ${String(err)}`,
        });
      });
    }
  }

  private startIdleChecks(): void {
    this.idleCheckTimer = setInterval(() => {
      const now = Date.now();
      this.available = this.available.filter(conn => {
        // Only remove idle connections if we have more than min connections
        if (now - conn.lastUsedAt > this.config.idleTimeoutMs && this.getPoolSize() > this.config.min) {
          this.destroyConnection(conn);
          return false;
        }
        return true;
      });
    }, Math.max(this.config.idleTimeoutMs / 2, 1000));
  }

  private stopIdleChecks(): void {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }
  }

  updateConfig(config: Partial<PoolConfig>): void {
    this.config = { ...this.config, ...config };
  }

  get isDraining(): boolean {
    return this._draining;
  }
}
