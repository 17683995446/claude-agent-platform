// ============================================================================
// OpenAI Provider - OpenAI 提供者实现
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
  TokenUsage,
} from './provider-interface.js';

/** OpenAI 提供者配置 */
export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  defaultModel?: string;
  timeout?: number;
  maxRetries?: number;
}

/** OpenAI API 消息格式 */
interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIResponse {
  id: string;
  choices: Array<{
    message: OpenAIMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

interface OpenAIStreamDelta {
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

/** OpenAI 已知模型列表 */
const OPENAI_MODELS: ModelInfo[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    maxTokens: 128000,
    capabilities: { streaming: true, functionCalling: true, vision: true, jsonMode: true },
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    maxTokens: 128000,
    capabilities: { streaming: true, functionCalling: true, vision: true, jsonMode: true },
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    maxTokens: 128000,
    capabilities: { streaming: true, functionCalling: true, vision: true, jsonMode: true },
  },
  {
    id: 'gpt-4',
    name: 'GPT-4',
    maxTokens: 8192,
    capabilities: { streaming: true, functionCalling: true, vision: false, jsonMode: false },
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    maxTokens: 16385,
    capabilities: { streaming: true, functionCalling: true, vision: false, jsonMode: true },
  },
];

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    functionCalling: true,
    vision: true,
    jsonMode: true,
  };

  private apiKey: string;
  private baseUrl: string;
  private organization?: string;
  private defaultModel: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.organization = config.organization;
    this.defaultModel = config.defaultModel ?? 'gpt-4o';
    this.timeout = config.timeout ?? 30000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  /** 转换消息格式为 OpenAI 格式 */
  private convertMessages(messages: LLMMessage[]): OpenAIMessage[] {
    return messages.map((msg) => {
      const openaiMsg: OpenAIMessage = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.toolCalls) {
        openaiMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      if (msg.toolCallId) {
        openaiMsg.tool_call_id = msg.toolCallId;
      }
      if (msg.name) {
        openaiMsg.name = msg.name;
      }
      return openaiMsg;
    });
  }

  /** 转换工具定义为 OpenAI 格式 */
  private convertTools(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
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
        const isRateLimit = lastError.message.includes('429') || lastError.message.includes('rate_limit');
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

  /** 发送聊天补全请求 */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: request.model || this.defaultModel,
      messages: this.convertMessages(request.messages),
    };

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.stopSequences) body.stop = request.stopSequences;
    if (request.tools) body.tools = this.convertTools(request.tools);
    if (request.responseFormat) body.response_format = request.responseFormat;

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...(this.organization ? { 'OpenAI-Organization': this.organization } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`OpenAI API error ${res.status}: ${errorText}`);
      }

      return res.json() as Promise<OpenAIResponse>;
    });

    const choice = response.choices[0];
    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      id: response.id,
      content: choice.message.content ?? '',
      toolCalls,
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
      finishReason: choice.finish_reason,
      model: response.model,
    };
  }

  /** 流式聊天补全 */
  async *stream(request: LLMRequest): AsyncGenerator<StreamChunk> {
    const body: Record<string, unknown> = {
      model: request.model || this.defaultModel,
      messages: this.convertMessages(request.messages),
      stream: true,
    };

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.stopSequences) body.stop = request.stopSequences;
    if (request.tools) body.tools = this.convertTools(request.tools);
    if (request.responseFormat) body.response_format = request.responseFormat;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...(this.organization ? { 'OpenAI-Organization': this.organization } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${errorText}`);
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
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data: OpenAIStreamDelta = JSON.parse(trimmed.slice(6));
            const choice = data.choices[0];
            if (!choice) continue;

            const chunk: StreamChunk = { model: data.model };

            if (choice.delta?.content) {
              chunk.delta = { content: choice.delta.content };
            }

            if (choice.delta?.tool_calls) {
              const toolCallDeltas = choice.delta.tool_calls.map((tc) => ({
                id: tc.id,
                name: tc.function?.name,
                arguments: tc.function?.arguments,
              }));
              chunk.delta = { ...chunk.delta, toolCalls: toolCallDeltas };
            }

            if (choice.finish_reason) {
              chunk.finishReason = choice.finish_reason;
            }

            if (data.usage) {
              chunk.usage = {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
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

  /** 估算 token 数量 (约 4 字符/token) */
  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** 列出可用模型 */
  async listModels(): Promise<ModelInfo[]> {
    return OPENAI_MODELS;
  }
}
