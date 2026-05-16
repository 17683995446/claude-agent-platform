// src/message-bus.ts - 消息总线

export type MessageType = 'request' | 'response' | 'event' | 'command' | 'query';

export interface Message {
  id: string;
  type: MessageType;
  topic: string;
  payload: unknown;
  sender: string;
  receiver?: string;
  timestamp: number;
  priority: number; // 0 = highest, higher = lower priority
  correlationId?: string;
}

export type MessageHandler = (message: Message) => void;

export interface Subscription {
  id: string;
  topic: string;
  handler: MessageHandler;
  unsubscribe: () => void;
}

interface PendingRequest {
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class MessageBus {
  private subscriptions: Map<string, Map<string, Subscription>> = new Map();
  private deadLetterQueue: Message[] = [];
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private messageQueue: Map<string, Message[]> = new Map();
  private processing = false;
  private handlerCounter = 0;

  publish(topic: string, message: Partial<Message> & { payload: unknown }): void {
    const fullMessage: Message = {
      id: message.id ?? generateId(),
      type: message.type ?? 'event',
      topic,
      payload: message.payload,
      sender: message.sender ?? 'unknown',
      receiver: message.receiver,
      timestamp: message.timestamp ?? Date.now(),
      priority: message.priority ?? 5,
      correlationId: message.correlationId,
    };

    // Check if there's a pending request waiting for this message (only for responses)
    if (
      fullMessage.correlationId &&
      fullMessage.type === 'response' &&
      this.pendingRequests.has(fullMessage.correlationId)
    ) {
      const pending = this.pendingRequests.get(fullMessage.correlationId)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(fullMessage.correlationId);
      pending.resolve(fullMessage);
      return;
    }

    // Enqueue for FIFO ordering per topic
    if (!this.messageQueue.has(topic)) {
      this.messageQueue.set(topic, []);
    }
    this.messageQueue.get(topic)!.push(fullMessage);

    this.processQueue(topic);
  }

  subscribe(topic: string, handler: MessageHandler): Subscription {
    const id = `sub_${++this.handlerCounter}`;
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Map());
    }
    const sub: Subscription = {
      id,
      topic,
      handler,
      unsubscribe: () => {
        this.subscriptions.get(topic)?.delete(id);
      },
    };
    this.subscriptions.get(topic)!.set(id, sub);
    return sub;
  }

  async request(topic: string, payload: unknown, timeout: number = 5000): Promise<Message> {
    const correlationId = generateId();
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`Request timeout for topic "${topic}" after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(correlationId, { resolve, reject, timer });

      this.publish(topic, {
        type: 'request',
        payload,
        correlationId,
      });
    });
  }

  getDeadLetterQueue(): Message[] {
    return [...this.deadLetterQueue];
  }

  clearDeadLetterQueue(): void {
    this.deadLetterQueue = [];
  }

  private processQueue(topic: string): void {
    if (this.processing) return;
    this.processing = true;

    const queue = this.messageQueue.get(topic);
    if (!queue || queue.length === 0) {
      this.processing = false;
      return;
    }

    const message = queue.shift()!;
    this.processing = false;

    const delivered = this.deliverMessage(topic, message);
    if (!delivered) {
      // Try wildcard matches
      const wildcardDelivered = this.deliverToWildcards(topic, message);
      if (!wildcardDelivered) {
        this.deadLetterQueue.push(message);
      }
    }

    // Continue processing if more messages
    if (queue.length > 0) {
      // Use setImmediate-like behavior for async processing
      setTimeout(() => this.processQueue(topic), 0);
    }
  }

  private deliverMessage(topic: string, message: Message): boolean {
    const subs = this.subscriptions.get(topic);
    if (!subs || subs.size === 0) return false;

    for (const sub of subs.values()) {
      try {
        sub.handler(message);
      } catch {
        // Handler error - continue delivering to other subscribers
      }
    }
    return true;
  }

  private deliverToWildcards(topic: string, message: Message): boolean {
    let delivered = false;
    const parts = topic.split('.');

    for (const [pattern, subs] of this.subscriptions.entries()) {
      if (pattern === topic) continue; // Already tried exact match

      if (this.matchWildcard(pattern, parts)) {
        for (const sub of subs.values()) {
          try {
            sub.handler(message);
            delivered = true;
          } catch {
            // Handler error
          }
        }
      }
    }
    return delivered;
  }

  private matchWildcard(pattern: string, topicParts: string[]): boolean {
    const patternParts = pattern.split('.');

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '>') return true; // Matches everything remaining
      if (i >= topicParts.length) return false;
      if (patternParts[i] !== '*' && patternParts[i] !== topicParts[i]) return false;
    }

    return patternParts.length === topicParts.length;
  }

  reset(): void {
    this.subscriptions.clear();
    this.deadLetterQueue = [];
    this.pendingRequests.forEach((p) => clearTimeout(p.timer));
    this.pendingRequests.clear();
    this.messageQueue.clear();
    this.processing = false;
  }
}
