// ============================================================
// Module: plugin-communication.ts - 插件间通信
// Direct messaging, event broadcasting, request-response, filtering
// ============================================================

export interface PluginMessage {
  type: string;
  data: unknown;
  timestamp?: number;
  id?: string;
  replyTo?: string;
}

export type MessageHandler = (message: PluginMessage, from: string) => unknown | Promise<unknown>;

export interface MessageFilter {
  from?: string;
  to?: string;
  type?: string;
  minPriority?: number;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface MessageSizeLimits {
  maxMessageSizeKB: number;
  maxBroadcastRecipients: number;
}

export class PluginCommunicationBus {
  private handlers = new Map<string, MessageHandler[]>();
  private pendingRequests = new Map<string, PendingRequest>();
  private messageLog: Array<{ from: string; to: string; message: PluginMessage; timestamp: number }> = [];
  private messageCounter = 0;
  private limits: MessageSizeLimits = {
    maxMessageSizeKB: 64,
    maxBroadcastRecipients: 100,
  };
  private blockedPlugins = new Set<string>();
  private messageFilters: Array<(from: string, to: string, msg: PluginMessage) => boolean> = [];
  private maxLogSize = 10000;

  setLimits(limits: Partial<MessageSizeLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }

  blockPlugin(pluginName: string): void {
    this.blockedPlugins.add(pluginName);
  }

  unblockPlugin(pluginName: string): void {
    this.blockedPlugins.delete(pluginName);
  }

  addMessageFilter(filter: (from: string, to: string, msg: PluginMessage) => boolean): void {
    this.messageFilters.push(filter);
  }

  onMessage(pluginName: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(pluginName)) {
      this.handlers.set(pluginName, []);
    }
    this.handlers.get(pluginName)!.push(handler);

    return () => {
      const handlers = this.handlers.get(pluginName);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      }
    };
  }

  private validateMessage(message: PluginMessage): void {
    const size = JSON.stringify(message).length / 1024;
    if (size > this.limits.maxMessageSizeKB) {
      throw new Error(`Message size ${size.toFixed(1)}KB exceeds limit ${this.limits.maxMessageSizeKB}KB`);
    }
  }

  private checkFilters(from: string, to: string, message: PluginMessage): boolean {
    for (const filter of this.messageFilters) {
      if (!filter(from, to, message)) return false;
    }
    return true;
  }

  private addToMessageLog(entry: { from: string; to: string; message: PluginMessage; timestamp: number }): void {
    this.messageLog.push(entry);
    if (this.messageLog.length > this.maxLogSize) {
      this.messageLog = this.messageLog.slice(-this.maxLogSize);
    }
  }

  send(from: string, to: string, message: PluginMessage): boolean {
    if (this.blockedPlugins.has(from)) {
      throw new Error(`Plugin "${from}" is blocked from sending messages`);
    }

    this.validateMessage(message);

    const enrichedMessage: PluginMessage = {
      ...message,
      timestamp: message.timestamp ?? Date.now(),
      id: message.id ?? `msg_${++this.messageCounter}`,
    };

    if (!this.checkFilters(from, to, enrichedMessage)) return false;

    const targetHandlers = this.handlers.get(to);
    if (!targetHandlers || targetHandlers.length === 0) return false;

    this.addToMessageLog({ from, to, message: enrichedMessage, timestamp: Date.now() });

    for (const handler of targetHandlers) {
      handler(enrichedMessage, from);
    }

    return true;
  }

  broadcast(from: string, message: PluginMessage): number {
    if (this.blockedPlugins.has(from)) {
      throw new Error(`Plugin "${from}" is blocked from broadcasting`);
    }

    this.validateMessage(message);

    const enrichedMessage: PluginMessage = {
      ...message,
      timestamp: message.timestamp ?? Date.now(),
      id: message.id ?? `msg_${++this.messageCounter}`,
    };

    let delivered = 0;

    for (const [pluginName, pluginHandlers] of this.handlers) {
      if (pluginName === from) continue;
      if (this.blockedPlugins.has(pluginName)) continue;
      if (delivered >= this.limits.maxBroadcastRecipients) break;

      if (!this.checkFilters(from, pluginName, enrichedMessage)) continue;

      this.addToMessageLog({ from, to: pluginName, message: enrichedMessage, timestamp: Date.now() });

      for (const handler of pluginHandlers) {
        handler(enrichedMessage, from);
        delivered++;
      }
    }

    return delivered;
  }

  async request<T>(from: string, to: string, message: PluginMessage, timeoutMs: number = 5000): Promise<T> {
    if (this.blockedPlugins.has(from)) {
      throw new Error(`Plugin "${from}" is blocked from sending requests`);
    }

    this.validateMessage(message);

    const requestId = `req_${++this.messageCounter}`;
    const enrichedMessage: PluginMessage = {
      ...message,
      timestamp: Date.now(),
      id: requestId,
    };

    if (!this.checkFilters(from, to, enrichedMessage)) {
      throw new Error(`Request blocked by message filter`);
    }

    const targetHandlers = this.handlers.get(to);
    if (!targetHandlers || targetHandlers.length === 0) {
      throw new Error(`No handlers registered for plugin "${to}"`);
    }

    this.addToMessageLog({ from, to, message: enrichedMessage, timestamp: Date.now() });

    // Try to get a response from handlers first.
    // If a handler returns a non-undefined non-Promise value, use it directly.
    // If a handler returns a Promise, race it against the timeout.
    // If all handlers return undefined, fall through to reply()-based pattern.
    for (const handler of targetHandlers) {
      try {
        const result = handler(enrichedMessage, from);
        if (result !== undefined) {
          if (result instanceof Promise) {
            // Race the async handler result against a timeout
            return new Promise<T>((resolve, reject) => {
              const timer = setTimeout(() => {
                reject(new Error(`Request to "${to}" timed out after ${timeoutMs}ms`));
              }, timeoutMs);
              (result as Promise<T>).then(
                value => { clearTimeout(timer); resolve(value); },
                err => { clearTimeout(timer); reject(err); },
              );
            });
          }
          return result as T;
        }
        // Handler returned undefined - continue to next handler
      } catch (err) {
        // Handler threw - continue to next handler
      }
    }

    // No handler returned a value; use reply-based pattern
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request to "${to}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout: timer });
    });
  }

  reply(from: string, requestId: string, data: unknown): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    pending.resolve(data);
  }

  getMessageLog(limit?: number): Array<{ from: string; to: string; message: PluginMessage; timestamp: number }> {
    if (limit != null && limit >= 0) {
      if (limit === 0) return [];
      return this.messageLog.slice(-limit);
    }
    return [...this.messageLog];
  }

  clearMessageLog(): void {
    this.messageLog = [];
  }

  getRegisteredPlugins(): string[] {
    return Array.from(this.handlers.keys());
  }

  reset(): void {
    this.handlers.clear();
    this.pendingRequests.forEach(p => clearTimeout(p.timeout));
    this.pendingRequests.clear();
    this.messageLog = [];
    this.blockedPlugins.clear();
    this.messageFilters = [];
  }
}
