// ============================================================================
// @claude-agent/perf - ObjectPool
// 通用对象池实现，支持自动扩缩容和池化率统计
// ============================================================================

export interface ObjectPoolOptions<T> {
  /** 工厂函数，创建新对象 */
  factory: () => T;
  /** 重置函数，将对象恢复到初始状态 */
  reset: (obj: T) => void;
  /** 销毁函数，彻底释放对象资源 */
  destroy?: (obj: T) => void;
  /** 初始池大小 */
  initialSize?: number;
  /** 最小池大小（缩容下限） */
  minSize?: number;
  /** 最大池大小（扩容上限） */
  maxSize?: number;
  /** 对象最大空闲时间（ms），超时将被销毁 */
  maxIdleTime?: number;
  /** 空闲检查间隔（ms） */
  idleCheckInterval?: number;
  /** 是否启用自动扩缩容 */
  autoScale?: boolean;
}

interface PooledObject<T> {
  value: T;
  createdAt: number;
  lastUsedAt: number;
  inUse: boolean;
}

export interface ObjectPoolStats {
  /** 池中总对象数 */
  total: number;
  /** 空闲对象数 */
  idle: number;
  /** 使用中对象数 */
  inUse: number;
  /** 池化率 = 被复用次数 / 总获取次数 */
  poolHitRate: number;
  /** 总获取次数 */
  totalAcquire: number;
  /** 池命中次数（从池中获取而非新建） */
  poolHits: number;
  /** 总创建次数 */
  totalCreated: number;
  /** 总销毁次数 */
  totalDestroyed: number;
}

export class ObjectPool<T> {
  private pool: PooledObject<T>[] = [];
  private options: Required<
    Omit<ObjectPoolOptions<T>, 'destroy'> & { destroy: ((obj: T) => void) | undefined }
  >;
  private stats = {
    totalAcquire: 0,
    poolHits: 0,
    totalCreated: 0,
    totalDestroyed: 0,
  };
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ObjectPoolOptions<T>) {
    this.options = {
      factory: options.factory,
      reset: options.reset,
      destroy: options.destroy,
      initialSize: options.initialSize ?? 10,
      minSize: options.minSize ?? 2,
      maxSize: options.maxSize ?? 1000,
      maxIdleTime: options.maxIdleTime ?? 60_000,
      idleCheckInterval: options.idleCheckInterval ?? 10_000,
      autoScale: options.autoScale ?? true,
    };

    // Pre-fill pool
    for (let i = 0; i < this.options.initialSize; i++) {
      this.pool.push({
        value: this.options.factory(),
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: false,
      });
      this.stats.totalCreated++;
    }

    // Start idle check timer
    if (this.options.autoScale && this.options.maxIdleTime > 0) {
      this.idleCheckTimer = setInterval(() => this.evictIdleObjects(), this.options.idleCheckInterval);
    }
  }

  /** 从池中获取一个对象 */
  acquire(): T {
    this.stats.totalAcquire++;

    // Find an idle object
    const idleObj = this.pool.find((obj) => !obj.inUse);
    if (idleObj) {
      idleObj.inUse = true;
      idleObj.lastUsedAt = Date.now();
      this.stats.poolHits++;
      return idleObj.value;
    }

    // No idle object, create new one if under max
    if (this.pool.length < this.options.maxSize) {
      const newObj: PooledObject<T> = {
        value: this.options.factory(),
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: true,
      };
      this.pool.push(newObj);
      this.stats.totalCreated++;
      return newObj.value;
    }

    // Pool is exhausted, throw error
    throw new Error(`ObjectPool exhausted: maxSize=${this.options.maxSize}`);
  }

  /** 归还对象到池中 */
  release(obj: T): void {
    const pooled = this.pool.find((p) => p.value === obj && p.inUse);
    if (!pooled) {
      // Object not from this pool, destroy it
      this.options.destroy?.(obj);
      return;
    }

    this.options.reset(pooled.value);
    pooled.inUse = false;
    pooled.lastUsedAt = Date.now();
  }

  /** 获取池统计信息 */
  getStats(): ObjectPoolStats {
    const idle = this.pool.filter((obj) => !obj.inUse).length;
    const inUse = this.pool.filter((obj) => obj.inUse).length;
    return {
      total: this.pool.length,
      idle,
      inUse,
      poolHitRate: this.stats.totalAcquire > 0 ? this.stats.poolHits / this.stats.totalAcquire : 0,
      totalAcquire: this.stats.totalAcquire,
      poolHits: this.stats.poolHits,
      totalCreated: this.stats.totalCreated,
      totalDestroyed: this.stats.totalDestroyed,
    };
  }

  /** 预热池，确保至少有 count 个空闲对象 */
  warmup(count: number): void {
    const currentIdle = this.pool.filter((obj) => !obj.inUse).length;
    const toCreate = Math.min(count - currentIdle, this.options.maxSize - this.pool.length);
    for (let i = 0; i < toCreate; i++) {
      this.pool.push({
        value: this.options.factory(),
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: false,
      });
      this.stats.totalCreated++;
    }
  }

  /** 清理空闲超时的对象 */
  private evictIdleObjects(): void {
    const now = Date.now();
    const minIdle = this.options.minSize;
    const currentIdle = this.pool.filter((obj) => !obj.inUse).length;

    if (currentIdle <= minIdle) return;

    const toEvict = currentIdle - minIdle;
    let evicted = 0;

    for (let i = this.pool.length - 1; i >= 0 && evicted < toEvict; i--) {
      const obj = this.pool[i]!;
      if (!obj.inUse && now - obj.lastUsedAt > this.options.maxIdleTime) {
        this.options.destroy?.(obj.value);
        this.pool.splice(i, 1);
        this.stats.totalDestroyed++;
        evicted++;
      }
    }
  }

  /** 销毁整个池 */
  dispose(): void {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }

    for (const obj of this.pool) {
      this.options.destroy?.(obj.value);
    }
    this.pool.length = 0;
  }
}
