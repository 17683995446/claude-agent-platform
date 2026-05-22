// src/security-audit.ts - 安全审计日志

import { createHash } from 'crypto';

export type AuditEventType =
  | 'authentication'
  | 'authorization'
  | 'data_access'
  | 'configuration_change'
  | 'system_event'
  | 'security_violation'
  | 'rate_limit'
  | 'csrf'
  | 'input_validation';

export interface AuditEntry {
  id: string;
  timestamp: number;
  eventType: AuditEventType;
  actor: string;
  resource: string;
  action: string;
  result: 'success' | 'failure' | 'denied' | 'error';
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  previousHash: string;
  hash: string;
}

export interface AuditQuery {
  eventType?: AuditEventType | AuditEventType[];
  actor?: string;
  resource?: string;
  action?: string;
  result?: AuditEntry['result'] | AuditEntry['result'][];
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

export interface AuditStorage {
  append(entry: AuditEntry): Promise<void>;
  query(query: AuditQuery): Promise<AuditEntry[]>;
  getLatest(): Promise<AuditEntry | undefined>;
  clear(): Promise<void>;
  removeBefore?(timestamp: number): Promise<number>;
}

export interface RetentionPolicy {
  /** Maximum age of entries in milliseconds */
  maxAge?: number;
  /** Maximum number of entries to keep */
  maxEntries?: number;
  /** Check interval in milliseconds */
  checkInterval?: number;
}

// ============ In-Memory Storage ============
class InMemoryAuditStorage implements AuditStorage {
  private entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  async query(query: AuditQuery): Promise<AuditEntry[]> {
    let result = [...this.entries];

    if (query.eventType) {
      const types = Array.isArray(query.eventType) ? query.eventType : [query.eventType];
      result = result.filter((e) => types.includes(e.eventType));
    }

    if (query.actor) {
      result = result.filter((e) => e.actor === query.actor);
    }

    if (query.resource) {
      result = result.filter((e) => e.resource === query.resource);
    }

    if (query.action) {
      result = result.filter((e) => e.action === query.action);
    }

    if (query.result) {
      const results = Array.isArray(query.result) ? query.result : [query.result];
      result = result.filter((e) => results.includes(e.result));
    }

    if (query.startTime) {
      result = result.filter((e) => e.timestamp >= query.startTime!);
    }

    if (query.endTime) {
      result = result.filter((e) => e.timestamp <= query.endTime!);
    }

    // Sort by timestamp descending
    result.sort((a, b) => b.timestamp - a.timestamp);

    if (query.offset) {
      result = result.slice(query.offset);
    }

    if (query.limit) {
      result = result.slice(0, query.limit);
    }

    return result;
  }

  async getLatest(): Promise<AuditEntry | undefined> {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1] : undefined;
  }

  async clear(): Promise<void> {
    this.entries = [];
  }

  async removeBefore(timestamp: number): Promise<number> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.timestamp >= timestamp);
    return before - this.entries.length;
  }

  get size(): number {
    return this.entries.length;
  }
}

// ============ File Storage (JSONL) ============
// NOTE: This is an in-memory simulation. File I/O is not implemented.
// In production, this should write entries to disk using appendFile/fs.promises
// to ensure audit entries survive process restarts.
class FileAuditStorage implements AuditStorage {
  private filePath: string;
  private entries: AuditEntry[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    // In a real implementation, this would write to a file
    // const line = JSON.stringify(entry) + '\n';
    // await appendFile(this.filePath, line, 'utf-8');
  }

  async query(query: AuditQuery): Promise<AuditEntry[]> {
    let result = [...this.entries];

    if (query.eventType) {
      const types = Array.isArray(query.eventType) ? query.eventType : [query.eventType];
      result = result.filter((e) => types.includes(e.eventType));
    }

    if (query.actor) {
      result = result.filter((e) => e.actor === query.actor);
    }

    if (query.resource) {
      result = result.filter((e) => e.resource === query.resource);
    }

    // BUG-006 FIX: Added missing 'action' filter to FileAuditStorage.query().
    // InMemoryAuditStorage had this filter but FileAuditStorage did not,
    // causing inconsistent behavior between storage backends.
    if (query.action) {
      result = result.filter((e) => e.action === query.action);
    }

    // BUG-007 FIX: Added missing 'result' filter to FileAuditStorage.query().
    if (query.result) {
      const results = Array.isArray(query.result) ? query.result : [query.result];
      result = result.filter((e) => results.includes(e.result));
    }

    if (query.startTime) {
      result = result.filter((e) => e.timestamp >= query.startTime!);
    }

    if (query.endTime) {
      result = result.filter((e) => e.timestamp <= query.endTime!);
    }

    result.sort((a, b) => b.timestamp - a.timestamp);

    if (query.offset) {
      result = result.slice(query.offset);
    }

    if (query.limit) {
      result = result.slice(0, query.limit);
    }

    return result;
  }

  async getLatest(): Promise<AuditEntry | undefined> {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1] : undefined;
  }

  async clear(): Promise<void> {
    this.entries = [];
  }

  async removeBefore(timestamp: number): Promise<number> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.timestamp >= timestamp);
    return before - this.entries.length;
  }
}

// ============ Hash Chain for Integrity ============
function computeHash(data: string, previousHash: string): string {
  const combined = `${previousHash}:${data}`;
  return createHash('sha256').update(combined).digest('hex');
}

// ============ Main Audit Log ============

export class SecurityAuditLog {
  private storage: AuditStorage;
  private retentionPolicy: RetentionPolicy;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(entry: AuditEntry) => void> = [];

  constructor(storage?: AuditStorage, retentionPolicy?: RetentionPolicy) {
    this.storage = storage || new InMemoryAuditStorage();
    this.retentionPolicy = retentionPolicy ?? {};
  }

  /**
   * Record a security audit event
   */
  async record(event: {
    eventType: AuditEventType;
    actor: string;
    resource: string;
    action: string;
    result: AuditEntry['result'];
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
  }): Promise<AuditEntry> {
    const latest = await this.storage.getLatest();
    const previousHash = latest?.hash ?? 'genesis';

    const entryData = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      eventType: event.eventType,
      actor: event.actor,
      resource: event.resource,
      action: event.action,
      result: event.result,
      metadata: event.metadata,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      sessionId: event.sessionId,
    };

    const hash = computeHash(JSON.stringify(entryData), previousHash);
    const entry: AuditEntry = {
      ...entryData,
      previousHash,
      hash,
    };

    await this.storage.append(entry);

    // Notify listeners
    for (const listener of this.listeners) {
      listener(entry);
    }

    return entry;
  }

  /**
   * Query audit log entries
   */
  async query(query: AuditQuery): Promise<AuditEntry[]> {
    return this.storage.query(query);
  }

  /**
   * Verify the integrity of the audit log (hash chain validation)
   */
  async verifyIntegrity(): Promise<{ valid: boolean; brokenAt?: AuditEntry; reason?: string }> {
    const entries = await this.storage.query({});
    // Sort by timestamp ascending for verification
    entries.sort((a, b) => a.timestamp - b.timestamp);

    if (entries.length === 0) {
      return { valid: true };
    }

    // Check first entry
    if (entries[0].previousHash !== 'genesis') {
      return { valid: false, brokenAt: entries[0], reason: 'First entry does not have genesis hash' };
    }

    // BUG-010 FIX: Verify the hash of the first entry too.
    // Previously, only entries at index 1+ had their hashes recomputed,
    // meaning tampering with the first entry's content would go undetected.
    {
      const { hash: _hash, previousHash: _ph, ...entryData } = entries[0];
      const expectedHash = computeHash(JSON.stringify(entryData), 'genesis');
      if (entries[0].hash !== expectedHash) {
        return {
          valid: false,
          brokenAt: entries[0],
          reason: `Hash mismatch at first entry ${entries[0].id}: expected ${expectedHash}, got ${entries[0].hash}`,
        };
      }
    }

    for (let i = 1; i < entries.length; i++) {
      const current = entries[i];
      const previous = entries[i - 1];

      if (current.previousHash !== previous.hash) {
        return {
          valid: false,
          brokenAt: current,
          reason: `Hash chain broken at entry ${current.id}: expected previous hash ${previous.hash}, got ${current.previousHash}`,
        };
      }

      // Recompute hash
      const { hash: _hash, previousHash: _ph, ...entryData } = current;
      const expectedHash = computeHash(JSON.stringify(entryData), previous.hash);
      if (current.hash !== expectedHash) {
        return {
          valid: false,
          brokenAt: current,
          reason: `Hash mismatch at entry ${current.id}: expected ${expectedHash}, got ${current.hash}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Export audit log in the specified format
   */
  async exportAuditLog(format: 'json' | 'csv'): Promise<string> {
    const entries = await this.storage.query({});
    entries.sort((a, b) => a.timestamp - b.timestamp);

    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }

    if (format === 'csv') {
      const headers = ['id', 'timestamp', 'eventType', 'actor', 'resource', 'action', 'result', 'ipAddress', 'sessionId'];
      const rows = entries.map((e) =>
        headers.map((h) => {
          const val = e[h as keyof AuditEntry];
          if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
          return String(val ?? '');
        }).join(',')
      );
      return [headers.join(','), ...rows].join('\n');
    }

    throw new Error(`Unsupported export format: ${format}`);
  }

  /**
   * Add a listener for new audit entries
   */
  addListener(listener: (entry: AuditEntry) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Remove a listener
   */
  removeListener(listener: (entry: AuditEntry) => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /**
   * Start automatic retention enforcement
   */
  startRetention(): void {
    if (this.retentionTimer) return;

    const interval = this.retentionPolicy.checkInterval ?? 3600000; // default 1 hour
    this.retentionTimer = setInterval(() => {
      this.enforceRetention();
    }, interval);
  }

  /**
   * Stop automatic retention enforcement
   */
  stopRetention(): void {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
  }

  /**
   * Destroy the audit log - stop retention timer and clean up resources
   */
  destroy(): void {
    this.stopRetention();
    this.listeners = [];
  }

  /**
   * Enforce retention policy
   */
  async enforceRetention(): Promise<number> {
    // BUG-008 FIX: Rewrote enforceRetention to avoid double-counting removed entries.
    // Previously, the method subtracted `removed` (from maxAge cleanup) from
    // `additionalRemoved` (from maxEntries cleanup), which could undercount
    // when the two removal sets overlapped. Now we apply maxAge first, then
    // separately count and apply maxEntries removal.
    let removed = 0;

    // Remove entries older than maxAge
    if (this.retentionPolicy.maxAge) {
      const cutoff = Date.now() - this.retentionPolicy.maxAge;
      if (this.storage.removeBefore) {
        removed += await this.storage.removeBefore(cutoff);
      }
    }

    // Remove excess entries (keep newest) - query fresh state after maxAge removal
    if (this.retentionPolicy.maxEntries) {
      const currentEntries = await this.storage.query({});
      if (currentEntries.length > this.retentionPolicy.maxEntries) {
        // Sort ascending by timestamp to find the cutoff point
        const sortedEntries = [...currentEntries].sort((a, b) => a.timestamp - b.timestamp);
        const excessCount = currentEntries.length - this.retentionPolicy.maxEntries;
        // The timestamp of the oldest entry we want to KEEP (index = excessCount)
        const cutoffTimestamp = sortedEntries[excessCount - 1].timestamp;
        if (this.storage.removeBefore) {
          // Use cutoffTimestamp + 1 to include the excess entry itself
          removed += await this.storage.removeBefore(cutoffTimestamp + 1);
        }
      }
    }

    return removed;
  }

  /**
   * Clear all audit entries
   */
  async clear(): Promise<void> {
    await this.storage.clear();
  }

  /**
   * Get the total number of entries
   */
  async size(): Promise<number> {
    const entries = await this.storage.query({});
    return entries.length;
  }

  /**
   * Create an in-memory audit storage
   */
  static inMemoryStorage(): AuditStorage {
    return new InMemoryAuditStorage();
  }

  /**
   * Create a file-based audit storage
   */
  static fileStorage(filePath: string): AuditStorage {
    return new FileAuditStorage(filePath);
  }
}
