// ============================================================================
// Anthropic Provider - Anthropic 提供者实现
// ============================================================================

import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMMessage,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  ModelInfo,
  ProviderCapabilities,
} from './provider-interface.js';

/** Anthropic 提供者配置 */
export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  timeout?: number;
  maxRetries?: number;
  anthropicVersion?: string;
}

/** Anthropic API 消息格式 */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
  };
  content_block?: AnthropicContentBlock;
  message?: {
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  model: string;
}

/** Anthropic 已知模型列表 */
const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    maxTokens: 200000,
    capabilities: { streaming: true, functionCalling: true, vision: true, jsonMode: true },
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    maxTokens: 200000,
    capabilities: { streaming: true, functionCalling: true, vision: true, jsonMode: true },
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    maxTokens: 200000,
    capabilities: { streaming: true, functionCalling: true, vision: true, jsonMode: true },
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    maxTokens: 200000,
    capabilities: { streaming: true, functionCalling: true, vision: true, jsonMode: false },
  },
  {
    id: 'claude-3-haiku-20240307',
    name: 'Claude 3 Haiku',
    maxTokens: 200000,
    capabilities: { streaming: true, functionCalling: true, vision: true, jsonMode: false },
  },
];

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    functionCalling: true,
    vision: true,
    jsonMode: true,
  };

  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private timeout: number;
  private maxRetries: number;
  private anthropicVersion: string;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
    this.defaultModel = config.defaultModel ?? 'claude-sonnet-4-20250514';
    this.timeout = config.timeout ?? 60000;
    this.maxRetries = config.maxRetries ?? 3;
    this.anthropicVersion = config.anthropicVersion ?? '2023-06-01';
  }

  /** 转换消息格式为 Anthropic 格式 */
  private convertMessages(messages: LLMMessage[]): { system?: string; messages: AnthropicMessage[] } {
    let systemPrompt: string | undefined;
    const anthropicMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
        continue;
      }

      if (msg.role === 'tool') {
        // Tool results go into the last user message or create a new user message
        const toolResultBlock: AnthropicContentBlock = {
          type: 'tool_result',
          tool_use_id: msg.toolCallId ?? '',
          content: msg.content,
        };
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
          lastMsg.content.push(toolResultBlock);
        } else {
          anthropicMessages.push({ role: 'user', content: [toolResultBlock] });
        }
        continue;
      }

      const content: AnthropicContentBlock[] = [{ type: 'text', text: msg.content }];

      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.arguments);
          } catch {
            input = { raw: tc.arguments };
          }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input,
          });
        }
      }

      anthropicMessages.push({ role: msg.role as 'user' | 'assistant', content });
    }

    return { system: systemPrompt, messages: anthropicMessages };
  }

  /** 转换工具定义为 Anthropic 格式 */
  private convertTools(tools: ToolDefinition[]): AnthropicTool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  /** 带指数退避的重试逻辑 */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        const isRateLimit =
          lastError.message.includes('429') || lastError.message.includes('rate_limit') || lastError.message.includes('overloaded');
        if (isRateLimit && attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw lastError;
      }
    }
    // TypeScript needs this for exhaustiveness; the loop always throws or returns
    throw lastError;
  }

  /** 发送消息请求 */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const { system, messages } = this.convertMessages(request.messages);

    const body: Record<string, unknown> = {
      model: request.model || this.defaultModel,
      messages,
      max_tokens: request.maxTokens ?? 4096,
    };

    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stopSequences) body.stop_sequences = request.stopSequences;
    if (request.tools) body.tools = this.convertTools(request.tools);

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.anthropicVersion,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${errorText}`);
      }

      return res.json() as Promise<AnthropicResponse>;
    });

    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    return {
      id: response.id,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason,
      model: response.model,
    };
  }

  /** 流式消息请求 */
  async *stream(request: LLMRequest): AsyncGenerator<StreamChunk> {
    const { system, messages } = this.convertMessages(request.messages);

    const body: Record<string, unknown> = {
      model: request.model || this.defaultModel,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      stream: true,
    };

    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stopSequences) body.stop_sequences = request.stopSequences;
    if (request.tools) body.tools = this.convertTools(request.tools);

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.anthropicVersion,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errorText}`);
    }

    if (!res.body) throw new Error('Response body is null');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          try {
            const event: AnthropicStreamEvent = JSON.parse(trimmed.slice(6));
            const chunk: StreamChunk = { model: event.model };

            if (event.type === 'content_block_delta' && event.delta) {
              if (event.delta.type === 'text_delta') {
                chunk.delta = { content: event.delta.text };
              } else if (event.delta.type === 'input_json_delta') {
                chunk.delta = { content: event.delta.partial_json };
              }
            }

            if (event.type === 'message_stop') {
              chunk.finishReason = 'stop';
            }

            if (event.type === 'message_delta' && event.usage) {
              chunk.usage = {
                completionTokens: event.usage.output_tokens,
              };
            }

            if (event.message?.usage) {
              chunk.usage = {
                promptTokens: event.message.usage.input_tokens,
                completionTokens: event.message.usage.output_tokens,
                totalTokens: event.message.usage.input_tokens + event.message.usage.output_tokens,
              };
            }

            yield chunk;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** 估算 token 数量 (Claude 使用约 3.5 字符/token) */
  countTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  /** 列出可用模型 */
  async listModels(): Promise<ModelInfo[]> {
    return ANTHROPIC_MODELS;
  }
}
