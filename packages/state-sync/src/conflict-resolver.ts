// src/conflict-resolver.ts - 冲突解决器

export type ResolutionStrategy = 'last-writer-wins' | 'first-writer-wins' | 'merge' | 'custom-function' | 'manual';

export interface ConflictEntry {
  value: unknown;
  version: number;
  timestamp: number;
  nodeId: string;
}

export interface ResolvedEntry {
  key: string;
  value: unknown;
  version: number;
  strategy: ResolutionStrategy;
  resolvedAt: number;
  winner: 'local' | 'remote';
}

export interface Conflict {
  key: string;
  local: ConflictEntry;
  remote: ConflictEntry;
  detectedAt: number;
  resolved: boolean;
}

export interface ConflictRecord {
  key: string;
  local: ConflictEntry;
  remote: ConflictEntry;
  resolved: ResolvedEntry;
  detectedAt: number;
  resolvedAt: number;
}

export type CustomResolver = (key: string, local: ConflictEntry, remote: ConflictEntry) => unknown;

export class ConflictResolver {
  private strategies: Map<string, ResolutionStrategy> = new Map();
  private defaultStrategy: ResolutionStrategy = 'last-writer-wins';
  private customResolvers: Map<string, CustomResolver> = new Map();
  private conflicts: Conflict[] = [];
  private conflictHistory: ConflictRecord[] = [];

  resolve(key: string, local: ConflictEntry, remote: ConflictEntry): ResolvedEntry {
    const strategy = this.strategies.get(key) ?? this.defaultStrategy;
    const detectedAt = Date.now();
    let winner: 'local' | 'remote';
    let resolvedValue: unknown;
    let resolvedVersion: number;

    switch (strategy) {
      case 'last-writer-wins': {
        if (remote.timestamp >= local.timestamp) {
          winner = 'remote';
          resolvedValue = remote.value;
          resolvedVersion = Math.max(local.version, remote.version) + 1;
        } else {
          winner = 'local';
          resolvedValue = local.value;
          resolvedVersion = Math.max(local.version, remote.version) + 1;
        }
        break;
      }
      case 'first-writer-wins': {
        if (local.timestamp <= remote.timestamp) {
          winner = 'local';
          resolvedValue = local.value;
          resolvedVersion = local.version;
        } else {
          winner = 'remote';
          resolvedValue = remote.value;
          resolvedVersion = remote.version;
        }
        break;
      }
      case 'merge': {
        winner = 'local';
        if (typeof local.value === 'object' && local.value !== null &&
            typeof remote.value === 'object' && remote.value !== null) {
          resolvedValue = { ...(local.value as object), ...(remote.value as object) };
        } else {
          resolvedValue = local.value;
        }
        resolvedVersion = Math.max(local.version, remote.version) + 1;
        break;
      }
      case 'custom-function': {
        const resolver = this.customResolvers.get(key);
        if (resolver) {
          resolvedValue = resolver(key, local, remote);
          winner = 'local';
        } else {
          resolvedValue = local.value;
          winner = 'local';
        }
        resolvedVersion = Math.max(local.version, remote.version) + 1;
        break;
      }
      case 'manual': {
        // For manual resolution, default to local
        resolvedValue = local.value;
        resolvedVersion = local.version;
        winner = 'local';
        break;
      }
      default:
        resolvedValue = local.value;
        resolvedVersion = local.version;
        winner = 'local';
    }

    const resolvedAt = Date.now();

    const conflict: Conflict = {
      key,
      local,
      remote,
      detectedAt,
      resolved: true,
    };
    this.conflicts.push(conflict);

    const resolved: ResolvedEntry = {
      key,
      value: resolvedValue,
      version: resolvedVersion,
      strategy,
      resolvedAt,
      winner,
    };

    const record: ConflictRecord = {
      key,
      local,
      remote,
      resolved,
      detectedAt,
      resolvedAt,
    };
    this.conflictHistory.push(record);

    return resolved;
  }

  setStrategy(key: string, strategy: ResolutionStrategy): void {
    this.strategies.set(key, strategy);
  }

  setDefaultStrategy(strategy: ResolutionStrategy): void {
    this.defaultStrategy = strategy;
  }

  setCustomResolver(key: string, resolver: CustomResolver): void {
    this.customResolvers.set(key, resolver);
    this.strategies.set(key, 'custom-function');
  }

  getConflicts(): Conflict[] {
    return [...this.conflicts];
  }

  getConflictHistory(): ConflictRecord[] {
    return [...this.conflictHistory];
  }

  getStrategy(key: string): ResolutionStrategy {
    return this.strategies.get(key) ?? this.defaultStrategy;
  }

  clearConflicts(): void {
    this.conflicts = [];
  }

  clearHistory(): void {
    this.conflictHistory = [];
  }

  getConflictCount(): number {
    return this.conflicts.length;
  }

  getConflictHistoryCount(): number {
    return this.conflictHistory.length;
  }
}
