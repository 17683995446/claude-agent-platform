// ============================================================================
// Tool Executor - 工具执行器
// ============================================================================

import type { ToolCall } from './provider-interface.js';

/** 工具 Schema */
export interface ToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/** 验证结果 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** 工具定义 */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: ToolSchema;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
  timeout?: number;
}

/** 工具结果 */
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  success: boolean;
  error?: string;
  executionTime: number;
}

/** 工具信息 */
export interface ToolInfo {
  name: string;
  description: string;
  parameterCount: number;
  requiredParameters: string[];
}

export class ToolExecutor {
  private tools = new Map<string, ToolDefinition>();
  private defaultTimeout = 30000;

  /** 注册工具 */
  registerTool(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    // 验证 schema
    const validation = this.validateSchema(tool.schema);
    if (!validation.valid) {
      throw new Error(`Invalid schema for tool "${tool.name}": ${validation.errors.join(', ')}`);
    }

    this.tools.set(tool.name, tool);
  }

  /** 执行单个工具调用 */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        success: false,
        error: `Tool "${toolCall.name}" not found`,
        executionTime: 0,
      };
    }

    let params: Record<string, unknown>;
    try {
      params = JSON.parse(toolCall.arguments);
    } catch {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        success: false,
        error: 'Invalid JSON arguments',
        executionTime: 0,
      };
    }

    // 验证参数
    const paramValidation = this.validateParams(params, tool.schema);
    if (!paramValidation.valid) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        success: false,
        error: `Parameter validation failed: ${paramValidation.errors.join(', ')}`,
        executionTime: 0,
      };
    }

    const startTime = Date.now();
    const timeout = tool.timeout ?? this.defaultTimeout;

    let timerId: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        tool.handler(params),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(() => reject(new Error('Tool execution timeout')), timeout);
        }),
      ]);
      if (timerId) clearTimeout(timerId);

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        success: true,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        success: false,
        error: (error as Error).message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /** 批量执行工具调用（并行） */
  async executeBatch(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map((tc) => this.execute(tc)));
  }

  /** 验证 Schema */
  validateSchema(schema: ToolSchema): ValidationResult {
    const errors: string[] = [];

    if (schema.type !== 'object') {
      errors.push('Schema type must be "object"');
    }

    if (!schema.properties || typeof schema.properties !== 'object') {
      errors.push('Schema must have "properties" object');
    }

    if (schema.required && !Array.isArray(schema.required)) {
      errors.push('"required" must be an array');
    }

    if (schema.required && schema.properties) {
      for (const req of schema.required) {
        if (!(req in schema.properties)) {
          errors.push(`Required property "${req}" not defined in properties`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** 验证参数 */
  private validateParams(
    params: Record<string, unknown>,
    schema: ToolSchema,
  ): ValidationResult {
    const errors: string[] = [];

    // 检查必需参数
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in params)) {
          errors.push(`Missing required parameter: ${req}`);
        }
      }
    }

    // 检查未知参数（可选警告）
    for (const key of Object.keys(params)) {
      if (!(key in (schema.properties ?? {}))) {
        // 不报错，但可以记录
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** 列出所有工具 */
  listTools(): ToolInfo[] {
    const infos: ToolInfo[] = [];
    for (const tool of this.tools.values()) {
      infos.push({
        name: tool.name,
        description: tool.description,
        parameterCount: Object.keys(tool.schema.properties).length,
        requiredParameters: tool.schema.required ?? [],
      });
    }
    return infos;
  }

  /** 获取工具定义 */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** 检查工具是否存在 */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /** 移除工具 */
  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /** 获取工具数量 */
  get size(): number {
    return this.tools.size;
  }
}
