// ============================================================================
// LLM Provider Interface - LLM 提供者接口定义
// ============================================================================

/** LLM 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** LLM 消息 */
export interface LLMMessage {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

/** 工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** 工具定义 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 响应格式 */
export interface ResponseFormat {
  type: 'json_object' | 'text';
  schema?: Record<string, unknown>;
}

/** LLM 请求 */
export interface LLMRequest {
  messages: LLMMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[];
  responseFormat?: ResponseFormat;
}

/** Token 使用量 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** LLM 响应 */
export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  finishReason: string;
  model: string;
  id?: string;
}

/** 流式传输块 */
export interface StreamChunk {
  delta?: {
    content?: string;
    toolCalls?: Partial<ToolCall>[];
  };
  usage?: Partial<TokenUsage>;
  finishReason?: string;
  model?: string;
}

/** 提供者能力 */
export interface ProviderCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  jsonMode: boolean;
}

/** 模型信息 */
export interface ModelInfo {
  id: string;
  name: string;
  maxTokens: number;
  capabilities: ProviderCapabilities;
}

/** LLM 提供者接口 */
export interface LLMProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncGenerator<StreamChunk>;
  countTokens(text: string): number;
  listModels?(): Promise<ModelInfo[]>;
}
