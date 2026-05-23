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
  senderId: string;
}

let idCounter = 0;
function generateId(): string {
  return `msg_${Date.now()}_${++idCounter}_${Math.random().toString(36).slice(2, 9)}`;
}

export class MessageBus {
  private subscriptions: Map<string, Map<string, Subscription>> = new Map();
  private deadLetterQueue: Message[] = [];
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private messageQueue: Map<string, Message[]> = new Map();
  private processingTopics: Set<string> = new Set();
  private handlerCounter = 0;
  private static readonly MAX_DEAD_LETTER_QUEUE_SIZE = 1000;
  private static readonly MAX_QUEUE_SIZE = 10000;

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
      // COMM-5: Reject responses from the same sender to prevent self-resolution
      if (fullMessage.sender !== pending.senderId) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(fullMessage.correlationId);
        pending.resolve(fullMessage);
      }
      // COMM-2: Do NOT return early - still enqueue for subscribers
    }

    // Enqueue for FIFO ordering per topic
    if (!this.messageQueue.has(topic)) {
      this.messageQueue.set(topic, []);
    }
    const queue = this.messageQueue.get(topic)!;
    if (queue.length >= MessageBus.MAX_QUEUE_SIZE) {
      // Drop oldest message to prevent unbounded growth
      queue.shift();
    }
    queue.push(fullMessage);

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
        const topicMap = this.subscriptions.get(topic);
        if (topicMap) {
          topicMap.delete(id);
          if (topicMap.size === 0) {
            this.subscriptions.delete(topic);
          }
        }
      },
    };
    this.subscriptions.get(topic)!.set(id, sub);
    return sub;
  }

  async request(topic: string, payload: unknown, timeout: number = 5000): Promise<Message> {
    const correlationId = generateId();
    const senderId = `self_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`Request timeout for topic "${topic}" after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(correlationId, { resolve, reject, timer, senderId });

      this.publish(topic, {
        type: 'request',
        payload,
        correlationId,
        sender: senderId,
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
    if (this.processingTopics.has(topic)) return;
    this.processingTopics.add(topic);

    const queue = this.messageQueue.get(topic);
    if (!queue || queue.length === 0) {
      this.processingTopics.delete(topic);
      return;
    }

    const message = queue.shift()!;
    this.processingTopics.delete(topic);

    const delivered = this.deliverMessage(topic, message);
    if (!delivered) {
      // Try wildcard matches
      const wildcardDelivered = this.deliverToWildcards(topic, message);
      if (!wildcardDelivered) {
        if (this.deadLetterQueue.length >= MessageBus.MAX_DEAD_LETTER_QUEUE_SIZE) {
          this.deadLetterQueue.shift();
        }
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
      } catch (err) {
        // COMM-31: Log handler errors instead of silently swallowing
        console.error(`[MessageBus] Handler error for topic "${topic}":`, err);
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
          } catch (err) {
            // COMM-31: Log handler errors
            console.error(`[MessageBus] Wildcard handler error for pattern "${pattern}":`, err);
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
    this.processingTopics.clear();
  }
}
