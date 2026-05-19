// ============================================================================
// SessionManager - Multi-session Management
// ============================================================================

import type { Session, SessionMessage, ContextEntry } from './types.js';

// ---- Session ID generator ----

let sessionCounter = 0;

function generateSessionId(): string {
  sessionCounter++;
  return `session-${Date.now().toString(36)}-${sessionCounter.toString(36)}`;
}

let messageCounter = 0;

function generateMessageId(): string {
  messageCounter++;
  return `msg-${Date.now().toString(36)}-${messageCounter.toString(36)}`;
}

// ---- SessionManager Class ----

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private activeSessionId: string | null = null;
  private sessionNameCounter = 0;

  /** Create a new session */
  create(name?: string): Session {
    this.sessionNameCounter++;
    const session: Session = {
      id: generateSessionId(),
      name: name ?? `会话 ${this.sessionNameCounter}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active',
      messages: [],
      context: [],
      executionIds: [],
      metadata: {},
    };

    this.sessions.set(session.id, session);
    this.activeSessionId = session.id;
    return session;
  }

  /** Get a session by ID */
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** Get the active session */
  getActive(): Session | undefined {
    if (!this.activeSessionId) return undefined;
    return this.sessions.get(this.activeSessionId);
  }

  /** Set the active session */
  setActive(id: string): boolean {
    if (!this.sessions.has(id)) return false;
    this.activeSessionId = id;
    return true;
  }

  /** Add a message to a session */
  addMessage(
    sessionId: string,
    role: SessionMessage['role'],
    content: string,
    metadata?: Record<string, unknown>,
  ): SessionMessage | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const message: SessionMessage = {
      id: generateMessageId(),
      role,
      content,
      timestamp: new Date(),
      metadata,
    };

    session.messages.push(message);
    session.updatedAt = new Date();
    return message;
  }

  /** Add a message to the active session */
  addMessageToActive(role: SessionMessage['role'], content: string, metadata?: Record<string, unknown>): SessionMessage | undefined {
    if (!this.activeSessionId) return undefined;
    return this.addMessage(this.activeSessionId, role, content, metadata);
  }

  /** Get messages from a session */
  getMessages(sessionId: string, limit?: number): SessionMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    if (limit) return session.messages.slice(-limit);
    return [...session.messages];
  }

  /** Search messages across all sessions */
  searchMessages(query: string): { sessionId: string; sessionName: string; messages: SessionMessage[] }[] {
    const lower = query.toLowerCase();
    const results: { sessionId: string; sessionName: string; messages: SessionMessage[] }[] = [];

    for (const session of this.sessions.values()) {
      const matchingMessages = session.messages.filter((m) =>
        m.content.toLowerCase().includes(lower),
      );
      if (matchingMessages.length > 0) {
        results.push({
          sessionId: session.id,
          sessionName: session.name,
          messages: matchingMessages,
        });
      }
    }

    return results;
  }

  /** Link an execution to a session */
  linkExecution(sessionId: string, executionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.executionIds.push(executionId);
    session.updatedAt = new Date();
    return true;
  }

  /** Update session context */
  updateContext(sessionId: string, context: ContextEntry[]): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.context = context;
    session.updatedAt = new Date();
    return true;
  }

  /** Update session metadata */
  updateMetadata(sessionId: string, metadata: Record<string, unknown>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.metadata = { ...session.metadata, ...metadata };
    session.updatedAt = new Date();
    return true;
  }

  /** Pause a session */
  pause(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'active') return false;
    session.status = 'paused';
    session.updatedAt = new Date();
    return true;
  }

  /** Resume a session */
  resume(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'paused') return false;
    session.status = 'active';
    session.updatedAt = new Date();
    if (!this.activeSessionId) {
      this.activeSessionId = sessionId;
    }
    return true;
  }

  /** Complete a session */
  complete(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.status = 'completed';
    session.updatedAt = new Date();
    return true;
  }

  /** Archive a session */
  archive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.status = 'archived';
    session.updatedAt = new Date();
    return true;
  }

  /** Delete a session */
  delete(sessionId: string): boolean {
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
    return this.sessions.delete(sessionId);
  }

  /** Get all sessions */
  getAll(): Session[] {
    return Array.from(this.sessions.values());
  }

  /** Get sessions by status */
  getByStatus(status: Session['status']): Session[] {
    return this.getAll().filter((s) => s.status === status);
  }

  /** Export a session */
  exportSession(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return JSON.stringify(session, null, 2);
  }

  /** Import a session */
  importSession(json: string): Session | undefined {
    try {
      const parsed = JSON.parse(json);
      // Validate required Session fields
      if (!parsed || typeof parsed !== 'object') return undefined;
      if (typeof parsed.name !== 'string') return undefined;
      if (!Array.isArray(parsed.messages)) return undefined;
      if (!Array.isArray(parsed.executionIds)) return undefined;
      if (typeof parsed.metadata !== 'object' || parsed.metadata === null) return undefined;

      const session: Session = {
        id: generateSessionId(),
        name: parsed.name,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(),
        status: parsed.status ?? 'active',
        messages: parsed.messages,
        context: Array.isArray(parsed.context) ? parsed.context : [],
        executionIds: parsed.executionIds,
        metadata: parsed.metadata,
      };
      this.sessions.set(session.id, session);
      return session;
    } catch {
      return undefined;
    }
  }

  /** Get session count */
  getCount(): number {
    return this.sessions.size;
  }

  /** Clear all sessions */
  clear(): void {
    this.sessions.clear();
    this.activeSessionId = null;
  }
}
