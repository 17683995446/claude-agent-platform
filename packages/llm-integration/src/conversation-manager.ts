// ============================================================================
// Conversation Manager - 对话管理器
// ============================================================================

import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMMessage,
} from './provider-interface.js';

/** 对话配置 */
export interface ConversationConfig {
  systemPrompt?: string;
  maxMessages?: number;
  metadata?: Record<string, unknown>;
}

/** 对话信息 */
export interface ConversationInfo {
  id: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

/** 对话 */
interface Conversation {
  id: string;
  messages: LLMMessage[];
  systemPrompt?: string;
  maxMessages: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
  parentId?: string;
  forkPoint?: number;
}

export class ConversationManager {
  private conversations = new Map<string, Conversation>();
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  /** 创建新对话 */
  createConversation(config?: ConversationConfig): Conversation {
    const id = this.generateId();
    const conversation: Conversation = {
      id,
      messages: [],
      maxMessages: config?.maxMessages ?? 100,
      systemPrompt: config?.systemPrompt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: config?.metadata,
    };
    this.conversations.set(id, conversation);
    return conversation;
  }

  /** 发送消息并获取响应 */
  async sendMessage(conversationId: string, message: string): Promise<LLMResponse> {
    const conversation = this.getConversationOrThrow(conversationId);

    // 添加用户消息
    conversation.messages.push({ role: 'user', content: message });

    // 构建请求消息
    const requestMessages: LLMMessage[] = [];
    if (conversation.systemPrompt) {
      requestMessages.push({ role: 'system', content: conversation.systemPrompt });
    }

    // 应用上下文窗口管理
    const contextMessages = this.manageContextWindow(conversation.messages, conversation.maxMessages);
    requestMessages.push(...contextMessages);

    const request: LLMRequest = {
      messages: requestMessages,
      model: 'default',
    };

    const response = await this.provider.complete(request);

    // 添加助手消息
    const assistantMessage: LLMMessage = {
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    };
    conversation.messages.push(assistantMessage);
    conversation.updatedAt = Date.now();

    return response;
  }

  /**
   * 管理上下文窗口 - 保留最近的消息，确保以 user 消息开头。
   * 如果切片后第一条消息是 assistant 消息，则从开头移除直到遇到 user 消息。
   */
  private manageContextWindow(messages: LLMMessage[], maxMessages: number): LLMMessage[] {
    if (messages.length <= maxMessages) {
      return [...messages];
    }

    let sliced = messages.slice(-maxMessages);

    // Ensure the result always starts with a user message
    while (sliced.length > 0 && sliced[0].role !== 'user') {
      sliced = sliced.slice(1);
    }

    return sliced;
  }

  /** 获取对话历史 */
  getHistory(conversationId: string): LLMMessage[] {
    const conversation = this.getConversationOrThrow(conversationId);
    return [...conversation.messages];
  }

  /** 分叉对话 */
  forkConversation(conversationId: string, messageId?: string): string {
    const conversation = this.getConversationOrThrow(conversationId);

    const newId = this.generateId();
    let forkMessages: LLMMessage[];

    if (messageId) {
      // 从指定消息 ID 分叉 - 使用消息索引
      const index = conversation.messages.findIndex(
        (_, idx) => this.generateMessageId(conversationId, idx) === messageId,
      );
      if (index === -1) {
        throw new Error(`Message "${messageId}" not found in conversation "${conversationId}"`);
      }
      forkMessages = conversation.messages.slice(0, index + 1);
    } else {
      // 从当前点分叉
      forkMessages = [...conversation.messages];
    }

    const forkedConversation: Conversation = {
      id: newId,
      messages: forkMessages,
      maxMessages: conversation.maxMessages,
      systemPrompt: conversation.systemPrompt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: { ...conversation.metadata, forkedFrom: conversationId },
      parentId: conversationId,
      forkPoint: forkMessages.length,
    };

    this.conversations.set(newId, forkedConversation);
    return newId;
  }

  /** 删除对话 */
  deleteConversation(conversationId: string): void {
    if (!this.conversations.has(conversationId)) {
      throw new Error(`Conversation "${conversationId}" not found`);
    }
    this.conversations.delete(conversationId);
  }

  /** 列出所有对话 */
  listConversations(): ConversationInfo[] {
    const infos: ConversationInfo[] = [];
    for (const conv of this.conversations.values()) {
      infos.push({
        id: conv.id,
        messageCount: conv.messages.length,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        metadata: conv.metadata,
      });
    }
    return infos.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 获取对话 */
  getConversation(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId);
  }

  /** 更新系统提示词 */
  updateSystemPrompt(conversationId: string, systemPrompt: string): void {
    const conversation = this.getConversationOrThrow(conversationId);
    conversation.systemPrompt = systemPrompt;
    conversation.updatedAt = Date.now();
  }

  /** 清除对话历史 */
  clearHistory(conversationId: string): void {
    const conversation = this.getConversationOrThrow(conversationId);
    conversation.messages = [];
    conversation.updatedAt = Date.now();
  }

  /** 添加消息到对话（手动添加） */
  addMessage(conversationId: string, message: LLMMessage): void {
    const conversation = this.getConversationOrThrow(conversationId);
    conversation.messages.push(message);
    conversation.updatedAt = Date.now();
  }

  private getConversationOrThrow(conversationId: string): Conversation {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation "${conversationId}" not found`);
    }
    return conversation;
  }

  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Generate a deterministic message ID based on conversation ID and index.
   *
   * @designLimitation This produces fragile IDs for forked conversations because
   * message indices shift when messages are added. If a conversation is forked and
   * then new messages are appended to the original, the generated IDs for the
   * forked copy may no longer match. Consider using UUIDs for production use.
   */
  private generateMessageId(conversationId: string, index: number): string {
    return `${conversationId}_msg_${index}`;
  }
}
