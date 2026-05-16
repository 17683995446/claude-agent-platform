// src/session-manager.ts - CLI 会话管理模块

export interface Session {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
  isActive: boolean;
}

export interface CommandHistoryEntry {
  command: string;
  timestamp: Date;
  exitCode?: number;
  duration?: number;
  workingDir?: string;
  sessionId: string;
}

export interface FavoriteCommand {
  name: string;
  command: string;
  description?: string;
  tags?: string[];
  createdAt: Date;
}

export interface RecordingSession {
  id: string;
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  entries: CommandHistoryEntry[];
  isActive: boolean;
}

export interface SessionExport {
  session: Session;
  history: CommandHistoryEntry[];
  favorites: FavoriteCommand[];
  recordings: RecordingSession[];
}

export class CLISessionManager {
  private sessions: Map<string, Session> = new Map();
  private activeSessionId: string | null = null;
  private history: CommandHistoryEntry[] = [];
  private favorites: FavoriteCommand[] = [];
  private recordings: Map<string, RecordingSession> = new Map();
  private maxHistory: number = 10000;

  /**
   * 创建新会话
   */
  createSession(name: string): Session {
    const id = this.generateId();
    const session: Session = {
      id,
      name,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: false,
    };

    this.sessions.set(id, session);
    return session;
  }

  /**
   * 切换到指定会话
   */
  switchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    // Deactivate current session
    if (this.activeSessionId) {
      const current = this.sessions.get(this.activeSessionId);
      if (current) {
        current.isActive = false;
        current.updatedAt = new Date();
      }
    }

    // Activate new session
    session.isActive = true;
    session.updatedAt = new Date();
    this.activeSessionId = sessionId;
  }

  /**
   * 获取当前活跃会话
   */
  getActiveSession(): Session | undefined {
    if (!this.activeSessionId) return undefined;
    return this.sessions.get(this.activeSessionId);
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): Session[] {
    return [...this.sessions.values()];
  }

  /**
   * 删除会话
   */
  deleteSession(sessionId: string): boolean {
    if (sessionId === this.activeSessionId) {
      this.activeSessionId = null;
    }
    return this.sessions.delete(sessionId);
  }

  /**
   * 添加命令到历史
   */
  addToHistory(entry: Omit<CommandHistoryEntry, 'timestamp' | 'sessionId'>): void {
    const historyEntry: CommandHistoryEntry = {
      ...entry,
      timestamp: new Date(),
      sessionId: this.activeSessionId ?? '',
    };

    this.history.push(historyEntry);

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Update session timestamp
    if (this.activeSessionId) {
      const session = this.sessions.get(this.activeSessionId);
      if (session) {
        session.updatedAt = new Date();
      }
    }
  }

  /**
   * 获取命令历史
   */
  getHistory(sessionId?: string): CommandHistoryEntry[] {
    if (sessionId) {
      return this.history.filter(h => h.sessionId === sessionId);
    }
    return [...this.history];
  }

  /**
   * 搜索历史
   */
  searchHistory(query: string, sessionId?: string): CommandHistoryEntry[] {
    const lower = query.toLowerCase();
    let entries = this.history;

    if (sessionId) {
      entries = entries.filter(h => h.sessionId === sessionId);
    }

    return entries.filter(h => h.command.toLowerCase().includes(lower));
  }

  /**
   * 清除历史
   */
  clearHistory(sessionId?: string): void {
    if (sessionId) {
      this.history = this.history.filter(h => h.sessionId !== sessionId);
    } else {
      this.history = [];
    }
  }

  /**
   * 添加收藏命令
   */
  addFavorite(name: string, command: string, description?: string, tags?: string[]): FavoriteCommand {
    const favorite: FavoriteCommand = {
      name,
      command,
      description,
      tags,
      createdAt: new Date(),
    };
    this.favorites.push(favorite);
    return favorite;
  }

  /**
   * 获取收藏命令
   */
  getFavorites(tags?: string[]): FavoriteCommand[] {
    if (!tags || tags.length === 0) {
      return [...this.favorites];
    }

    return this.favorites.filter(f =>
      f.tags?.some(t => tags.includes(t))
    );
  }

  /**
   * 删除收藏命令
   */
  removeFavorite(name: string): boolean {
    const index = this.favorites.findIndex(f => f.name === name);
    if (index === -1) return false;
    this.favorites.splice(index, 1);
    return true;
  }

  /**
   * 开始录制会话
   */
  recordSession(): RecordingSession {
    const id = this.generateId();
    const recording: RecordingSession = {
      id,
      sessionId: this.activeSessionId ?? '',
      startTime: new Date(),
      entries: [],
      isActive: true,
    };

    this.recordings.set(id, recording);
    return recording;
  }

  /**
   * 停止录制
   */
  stopRecording(recordingId: string): RecordingSession | undefined {
    const recording = this.recordings.get(recordingId);
    if (!recording) return undefined;

    recording.isActive = false;
    recording.endTime = new Date();
    return recording;
  }

  /**
   * 回放录制
   */
  async replaySession(recordingId: string): Promise<void> {
    const recording = this.recordings.get(recordingId);
    if (!recording) {
      throw new Error(`Recording "${recordingId}" not found`);
    }

    // In a real implementation, this would replay each command
    for (const entry of recording.entries) {
      // Simulate replay
      await this.sleep(100);
    }
  }

  /**
   * 获取录制
   */
  getRecording(recordingId: string): RecordingSession | undefined {
    return this.recordings.get(recordingId);
  }

  /**
   * 获取所有录制
   */
  getRecordings(sessionId?: string): RecordingSession[] {
    const recordings = [...this.recordings.values()];
    if (sessionId) {
      return recordings.filter(r => r.sessionId === sessionId);
    }
    return recordings;
  }

  /**
   * 导出会话
   */
  exportSession(format: 'json' | 'markdown'): string {
    const activeSession = this.activeSessionId ?? '';
    const session = this.sessions.get(activeSession);

    if (format === 'json') {
      const exportData: SessionExport = {
        session: session ?? { id: '', name: '', createdAt: new Date(), updatedAt: new Date(), isActive: false },
        history: this.getHistory(activeSession),
        favorites: this.favorites,
        recordings: this.getRecordings(activeSession),
      };
      return JSON.stringify(exportData, null, 2);
    }

    // Markdown format
    const lines: string[] = [];
    lines.push(`# Session: ${session?.name ?? 'Unknown'}`);
    lines.push(`- Created: ${session?.createdAt.toISOString() ?? 'N/A'}`);
    lines.push(`- Updated: ${session?.updatedAt.toISOString() ?? 'N/A'}`);
    lines.push('');
    lines.push('## Command History');
    lines.push('');

    const history = this.getHistory(activeSession);
    for (const entry of history) {
      lines.push(`- \`${entry.command}\` (${entry.timestamp.toISOString()})`);
    }

    if (this.favorites.length > 0) {
      lines.push('');
      lines.push('## Favorite Commands');
      lines.push('');
      for (const fav of this.favorites) {
        lines.push(`- **${fav.name}**: \`${fav.command}\`${fav.description ? ` - ${fav.description}` : ''}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 获取历史统计
   */
  getHistoryStats(): { total: number; bySession: Record<string, number>; mostUsed: Array<{ command: string; count: number }> } {
    const bySession: Record<string, number> = {};
    const commandCounts: Record<string, number> = {};

    for (const entry of this.history) {
      bySession[entry.sessionId] = (bySession[entry.sessionId] ?? 0) + 1;
      commandCounts[entry.command] = (commandCounts[entry.command] ?? 0) + 1;
    }

    const mostUsed = Object.entries(commandCounts)
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      total: this.history.length,
      bySession,
      mostUsed,
    };
  }

  /**
   * 设置最大历史记录数
   */
  setMaxHistory(max: number): void {
    this.maxHistory = max;
    while (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  private generateId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
