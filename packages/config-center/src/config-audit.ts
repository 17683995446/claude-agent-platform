/**
 * 配置审计模块
 * 跟踪配置变更历史，支持查询、统计和导出
 */

export interface AuditEntry {
  timestamp: number;
  actor: string;
  action: 'set' | 'delete' | 'reload' | 'rollback' | 'snapshot' | 'import';
  path: string;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
}

export interface QueryOptions {
  startTime?: number;
  endTime?: number;
  actor?: string;
  action?: AuditEntry['action'];
  limit?: number;
  offset?: number;
}

export interface ChangeSummary {
  period: string;
  totalChanges: number;
  changesByAction: Record<string, number>;
  changesByActor: Record<string, number>;
  mostChangedPaths: Array<{ path: string; count: number }>;
  sensitiveChanges: AuditEntry[];
}

/**
 * ConfigAuditLog - 配置审计日志
 */
export class ConfigAuditLog {
  private entries: AuditEntry[] = [];
  private sensitivePaths: string[] = [];
  private alertCallbacks: Array<(entry: AuditEntry) => void> = [];

  /**
   * 记录配置变更
   */
  logChange(entry: AuditEntry): void {
    this.entries.push(entry);

    // Check for sensitive changes
    if (this.isSensitivePath(entry.path)) {
      entry.metadata = { ...entry.metadata, sensitive: true };
      for (const cb of this.alertCallbacks) {
        try {
          cb(entry);
        } catch {
          // swallow
        }
      }
    }
  }

  /**
   * 查询审计历史
   */
  getHistory(path?: string, options?: QueryOptions): AuditEntry[] {
    let filtered = [...this.entries];

    // Filter by path
    if (path) {
      filtered = filtered.filter(
        (e) => e.path === path || e.path.startsWith(path + '.'),
      );
    }

    // Filter by time range
    if (options?.startTime) {
      filtered = filtered.filter((e) => e.timestamp >= options.startTime!);
    }
    if (options?.endTime) {
      filtered = filtered.filter((e) => e.timestamp <= options.endTime!);
    }

    // Filter by actor
    if (options?.actor) {
      filtered = filtered.filter((e) => e.actor === options.actor);
    }

    // Filter by action
    if (options?.action) {
      filtered = filtered.filter((e) => e.action === options.action);
    }

    // Sort by timestamp descending
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    // Pagination
    const offset = options?.offset || 0;
    const limit = options?.limit || filtered.length;
    return filtered.slice(offset, offset + limit);
  }

  /**
   * 获取变更摘要
   */
  getChangeSummary(period: string): ChangeSummary {
    const now = Date.now();
    let startTime: number;

    switch (period) {
      case '1h':
        startTime = now - 3600_000;
        break;
      case '24h':
        startTime = now - 86400_000;
        break;
      case '7d':
        startTime = now - 7 * 86400_000;
        break;
      case '30d':
        startTime = now - 30 * 86400_000;
        break;
      default:
        startTime = 0;
    }

    const entries = this.entries.filter((e) => e.timestamp >= startTime);

    const changesByAction: Record<string, number> = {};
    const changesByActor: Record<string, number> = {};
    const pathCounts: Record<string, number> = {};
    const sensitiveChanges: AuditEntry[] = [];

    for (const entry of entries) {
      changesByAction[entry.action] = (changesByAction[entry.action] || 0) + 1;
      changesByActor[entry.actor] = (changesByActor[entry.actor] || 0) + 1;
      pathCounts[entry.path] = (pathCounts[entry.path] || 0) + 1;
      if (this.isSensitivePath(entry.path)) {
        sensitiveChanges.push(entry);
      }
    }

    const mostChangedPaths = Object.entries(pathCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));

    return {
      period,
      totalChanges: entries.length,
      changesByAction,
      changesByActor,
      mostChangedPaths,
      sensitiveChanges,
    };
  }

  /**
   * 导出审计日志
   */
  exportAuditLog(format: 'json' | 'csv'): string {
    if (format === 'json') {
      return JSON.stringify(this.entries, null, 2);
    }

    // CSV format
    const headers = 'timestamp,actor,action,path,oldValue,newValue';
    const rows = this.entries.map((e) => {
      const ts = new Date(e.timestamp).toISOString();
      const oldVal = e.oldValue !== undefined ? JSON.stringify(e.oldValue) : '';
      const newVal = e.newValue !== undefined ? JSON.stringify(e.newValue) : '';
      return `${ts},${e.actor},${e.action},${e.path},"${oldVal}","${newVal}"`;
    });
    return [headers, ...rows].join('\n');
  }

  /**
   * 设置敏感路径（变更时触发告警）
   */
  setSensitivePaths(paths: string[]): void {
    this.sensitivePaths = paths;
  }

  /**
   * 注册敏感变更告警回调
   */
  onSensitiveChange(callback: (entry: AuditEntry) => void): () => void {
    this.alertCallbacks.push(callback);
    return () => {
      const idx = this.alertCallbacks.indexOf(callback);
      if (idx !== -1) this.alertCallbacks.splice(idx, 1);
    };
  }

  /**
   * 清空审计日志
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * 获取日志条目总数
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  private isSensitivePath(path: string): boolean {
    return this.sensitivePaths.some(
      (sp) => path === sp || path.startsWith(sp + '.'),
    );
  }
}
