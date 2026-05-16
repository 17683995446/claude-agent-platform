// ============================================================================
// @claude-agent/perf - IncrementalProcessor
// 增量文件扫描、变更检测（mtime/内容哈希）、增量编译、变更事件流
// ============================================================================

import { createHash } from 'node:crypto';

export type ChangeType = 'added' | 'modified' | 'deleted';

export interface FileChange {
  path: string;
  type: ChangeType;
  previousHash?: string;
  currentHash?: string;
  previousMtime?: number;
  currentMtime?: number;
  timestamp: number;
}

export interface IncrementalState {
  /** 文件路径 -> 内容哈希 */
  fileHashes: Record<string, string>;
  /** 文件路径 -> 修改时间 */
  fileMtimes: Record<string, number>;
  /** 最后扫描时间 */
  lastScanTime: number;
  /** 总扫描次数 */
  scanCount: number;
  /** 总变更次数 */
  changeCount: number;
}

export interface IncrementalProcessorOptions {
  /** 是否使用内容哈希（更精确但更慢） */
  useContentHash?: boolean;
  /** 是否使用 mtime（更快但不够精确） */
  useMtime?: boolean;
  /** 是否同时使用两者 */
  useBoth?: boolean;
  /** 变更事件回调 */
  onChange?: (changes: FileChange[]) => void | Promise<void>;
  /** 忽略的文件模式 */
  ignorePatterns?: RegExp[];
  /** 是否递归扫描子目录 */
  recursive?: boolean;
}

export interface IncrementalProcessorStats {
  totalFiles: number;
  lastScanTime: number;
  scanCount: number;
  totalChanges: number;
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
}

export class IncrementalProcessor {
  private state: IncrementalState = {
    fileHashes: {},
    fileMtimes: {},
    lastScanTime: 0,
    scanCount: 0,
    changeCount: 0,
  };
  private options: Required<IncrementalProcessorOptions>;
  private stats = {
    addedCount: 0,
    modifiedCount: 0,
    deletedCount: 0,
  };

  constructor(options?: IncrementalProcessorOptions) {
    this.options = {
      useContentHash: options?.useContentHash ?? true,
      useMtime: options?.useMtime ?? true,
      useBoth: options?.useBoth ?? false,
      onChange: options?.onChange ?? (() => {}),
      ignorePatterns: options?.ignorePatterns ?? [],
      recursive: options?.recursive ?? true,
    };
  }

  /** 计算内容哈希 */
  static computeHash(content: string | Buffer): string {
    return createHash('md5').update(content).digest('hex');
  }

  /** 扫描文件变更 */
  async scan(
    currentFiles: Map<string, { content?: string | Buffer; mtime: number }>,
  ): Promise<FileChange[]> {
    const changes: FileChange[] = [];
    const currentPaths = new Set(currentFiles.keys());
    const previousPaths = new Set(Object.keys(this.state.fileHashes));

    // Detect added and modified files
    for (const [path, fileInfo] of currentFiles) {
      // Check ignore patterns
      if (this.shouldIgnore(path)) continue;

      const previousHash = this.state.fileHashes[path];
      const previousMtime = this.state.fileMtimes[path];

      if (previousHash === undefined) {
        // New file
        const currentHash = fileInfo.content
          ? IncrementalProcessor.computeHash(fileInfo.content)
          : '';
        changes.push({
          path,
          type: 'added',
          currentHash,
          currentMtime: fileInfo.mtime,
          timestamp: Date.now(),
        });
        this.stats.addedCount++;
      } else {
        // Check for modifications
        let isModified = false;

        if (this.options.useBoth) {
          // Both mtime and hash must match
          const mtimeChanged = previousMtime !== fileInfo.mtime;
          const hashChanged =
            fileInfo.content && IncrementalProcessor.computeHash(fileInfo.content) !== previousHash;
          isModified = mtimeChanged || hashChanged;
        } else if (this.options.useContentHash && fileInfo.content) {
          const currentHash = IncrementalProcessor.computeHash(fileInfo.content);
          isModified = currentHash !== previousHash;
        } else if (this.options.useMtime) {
          isModified = previousMtime !== fileInfo.mtime;
        }

        if (isModified) {
          const currentHash = fileInfo.content
            ? IncrementalProcessor.computeHash(fileInfo.content)
            : '';
          changes.push({
            path,
            type: 'modified',
            previousHash,
            currentHash,
            previousMtime,
            currentMtime: fileInfo.mtime,
            timestamp: Date.now(),
          });
          this.stats.modifiedCount++;
        }
      }
    }

    // Detect deleted files
    for (const path of previousPaths) {
      if (!currentPaths.has(path) && !this.shouldIgnore(path)) {
        changes.push({
          path,
          type: 'deleted',
          previousHash: this.state.fileHashes[path],
          previousMtime: this.state.fileMtimes[path],
          timestamp: Date.now(),
        });
        this.stats.deletedCount++;
      }
    }

    // Update state
    for (const [path, fileInfo] of currentFiles) {
      if (this.shouldIgnore(path)) continue;
      this.state.fileHashes[path] = fileInfo.content
        ? IncrementalProcessor.computeHash(fileInfo.content)
        : '';
      this.state.fileMtimes[path] = fileInfo.mtime;
    }

    for (const path of previousPaths) {
      if (!currentPaths.has(path)) {
        delete this.state.fileHashes[path];
        delete this.state.fileMtimes[path];
      }
    }

    this.state.lastScanTime = Date.now();
    this.state.scanCount++;
    this.state.changeCount += changes.length;

    // Fire change callback
    if (changes.length > 0) {
      await this.options.onChange(changes);
    }

    return changes;
  }

  /** 获取需要重新处理的文件列表 */
  getAffectedFiles(changes: FileChange[]): string[] {
    return changes.map((c) => c.path);
  }

  /** 获取自上次扫描以来的所有变更 */
  getChangesSince(sinceTime: number): FileChange[] {
    // This is a simplified version - in production you'd store change history
    const changes: FileChange[] = [];
    const now = Date.now();

    for (const [path, hash] of Object.entries(this.state.fileHashes)) {
      const mtime = this.state.fileMtimes[path];
      if (mtime && mtime > sinceTime) {
        changes.push({
          path,
          type: 'modified',
          currentHash: hash,
          currentMtime: mtime,
          timestamp: now,
        });
      }
    }

    return changes;
  }

  /** 获取统计信息 */
  getStats(): IncrementalProcessorStats {
    return {
      totalFiles: Object.keys(this.state.fileHashes).length,
      lastScanTime: this.state.lastScanTime,
      scanCount: this.state.scanCount,
      totalChanges: this.state.changeCount,
      addedCount: this.stats.addedCount,
      modifiedCount: this.stats.modifiedCount,
      deletedCount: this.stats.deletedCount,
    };
  }

  /** 获取当前状态快照 */
  getState(): IncrementalState {
    return { ...this.state };
  }

  /** 重置状态 */
  reset(): void {
    this.state = {
      fileHashes: {},
      fileMtimes: {},
      lastScanTime: 0,
      scanCount: 0,
      changeCount: 0,
    };
    this.stats = { addedCount: 0, modifiedCount: 0, deletedCount: 0 };
  }

  /** 检查文件是否应被忽略 */
  private shouldIgnore(path: string): boolean {
    return this.options.ignorePatterns.some((pattern) => pattern.test(path));
  }
}
