// src/websocket-manager.ts - WebSocket 管理

export interface WSConnection {
  id: string;
  socket: any; // Simulated WebSocket
  channels: Set<string>;
  authenticated: boolean;
  userId?: string;
  metadata: Record<string, unknown>;
  connectedAt: number;
  lastPing: number;
  lastPong: number;
}

export interface WSMessage {
  type: string;
  data: unknown;
  from?: string;
  to?: string;
  channel?: string;
  timestamp: number;
}

export interface ConnectionStats {
  totalConnections: number;
  activeConnections: number;
  totalMessagesSent: number;
  totalMessagesReceived: number;
  channelsCount: number;
  connectionsPerChannel: Record<string, number>;
}

type MessageHandler = (connection: WSConnection, message: WSMessage) => void;
type ConnectionHandler = (connection: WSConnection) => void;

export class WebSocketManager {
  private connections: Map<string, WSConnection> = new Map();
  private channels: Map<string, Set<string>> = new Map();
  private messageHandlers: Map<string, MessageHandler[]> = new Map();
  private totalMessagesSent = 0;
  private totalMessagesReceived = 0;
  private onConnectHandlers: ConnectionHandler[] = [];
  private onDisconnectHandlers: ConnectionHandler[] = [];
  private heartbeatInterval: number;
  private heartbeatTimeout: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: { heartbeatInterval?: number; heartbeatTimeout?: number }) {
    this.heartbeatInterval = options?.heartbeatInterval ?? 30000;
    this.heartbeatTimeout = options?.heartbeatTimeout ?? 10000;
  }

  handleConnection(connection: WSConnection): void {
    connection.connectedAt = Date.now();
    connection.lastPing = Date.now();
    connection.lastPong = Date.now();
    connection.channels = new Set();
    connection.metadata = {};
    this.connections.set(connection.id, connection);

    for (const handler of this.onConnectHandlers) {
      handler(connection);
    }
  }

  disconnect(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    // Remove from all channels
    for (const channel of connection.channels) {
      this.leaveChannel(connectionId, channel);
    }

    this.connections.delete(connectionId);

    for (const handler of this.onDisconnectHandlers) {
      handler(connection);
    }

    return true;
  }

  handleMessage(connectionId: string, rawMessage: unknown): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    this.totalMessagesReceived++;

    const message: WSMessage = {
      type: typeof rawMessage === 'object' && rawMessage !== null && 'type' in rawMessage
        ? String((rawMessage as any).type)
        : 'message',
      data: rawMessage,
      from: connectionId,
      timestamp: Date.now(),
    };

    // Handle pong
    if (message.type === 'pong') {
      connection.lastPong = Date.now();
      return;
    }

    // Handle join channel
    if (message.type === 'join') {
      const channel = String((rawMessage as any)?.channel || '');
      if (channel) this.joinChannel(connectionId, channel);
      return;
    }

    // Handle leave channel
    if (message.type === 'leave') {
      const channel = String((rawMessage as any)?.channel || '');
      if (channel) this.leaveChannel(connectionId, channel);
      return;
    }

    // Dispatch to message handlers
    const handlers = this.messageHandlers.get(message.type) || [];
    for (const handler of handlers) {
      handler(connection, message);
    }

    // Dispatch to wildcard handlers
    const wildcardHandlers = this.messageHandlers.get('*') || [];
    for (const handler of wildcardHandlers) {
      handler(connection, message);
    }
  }

  onMessage(type: string, handler: MessageHandler): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);
  }

  onConnect(handler: ConnectionHandler): void {
    this.onConnectHandlers.push(handler);
  }

  onDisconnect(handler: ConnectionHandler): void {
    this.onDisconnectHandlers.push(handler);
  }

  send(connectionId: string, message: unknown): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    const wsMessage: WSMessage = {
      type: typeof message === 'object' && message !== null && 'type' in message
        ? String((message as any).type)
        : 'message',
      data: message,
      timestamp: Date.now(),
    };

    // Simulate sending
    if (connection.socket && typeof connection.socket.send === 'function') {
      connection.socket.send(JSON.stringify(wsMessage));
    }

    this.totalMessagesSent++;
    return true;
  }

  broadcast(channel: string, message: unknown): number {
    const members = this.channels.get(channel);
    if (!members) return 0;

    let count = 0;
    for (const connectionId of members) {
      if (this.send(connectionId, message)) {
        count++;
      }
    }
    return count;
  }

  broadcastAll(message: unknown): number {
    let count = 0;
    for (const connectionId of this.connections.keys()) {
      if (this.send(connectionId, message)) {
        count++;
      }
    }
    return count;
  }

  joinChannel(connectionId: string, channel: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)!.add(connectionId);
    connection.channels.add(channel);
    return true;
  }

  leaveChannel(connectionId: string, channel: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    const members = this.channels.get(channel);
    if (members) {
      members.delete(connectionId);
      if (members.size === 0) {
        this.channels.delete(channel);
      }
    }
    connection.channels.delete(channel);
    return true;
  }

  getChannelMembers(channel: string): string[] {
    const members = this.channels.get(channel);
    return members ? Array.from(members) : [];
  }

  getChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  getConnection(connectionId: string): WSConnection | undefined {
    return this.connections.get(connectionId);
  }

  getConnections(): WSConnection[] {
    return Array.from(this.connections.values());
  }

  authenticate(connectionId: string, userId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;
    connection.authenticated = true;
    connection.userId = userId;
    return true;
  }

  startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, connection] of this.connections) {
        // Check for timeout
        if (now - connection.lastPong > this.heartbeatTimeout + this.heartbeatInterval) {
          this.disconnect(id);
          continue;
        }
        // Send ping
        this.send(id, { type: 'ping', timestamp: now });
        connection.lastPing = now;
      }
    }, this.heartbeatInterval);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  getStats(): ConnectionStats {
    const connectionsPerChannel: Record<string, number> = {};
    for (const [channel, members] of this.channels) {
      connectionsPerChannel[channel] = members.size;
    }

    return {
      totalConnections: this.connections.size,
      activeConnections: this.connections.size,
      totalMessagesSent: this.totalMessagesSent,
      totalMessagesReceived: this.totalMessagesReceived,
      channelsCount: this.channels.size,
      connectionsPerChannel,
    };
  }

  clear(): void {
    this.stopHeartbeat();
    this.connections.clear();
    this.channels.clear();
    this.messageHandlers.clear();
    this.onConnectHandlers = [];
    this.onDisconnectHandlers = [];
    this.totalMessagesSent = 0;
    this.totalMessagesReceived = 0;
  }
}
