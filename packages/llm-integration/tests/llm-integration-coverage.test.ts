import { describe, test, expect, beforeEach, vi, afterEach } from 'bun:test';

// ============================================================================
// Module imports
// ============================================================================
import {
  OpenAIProvider,
  AnthropicProvider,
  ProviderRegistry,
  PromptManager,
  ConversationManager,
  ToolExecutor,
  TokenManager,
  ResponseParser,
  CostTracker,
} from '../src/index.js';

import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMMessage,
  StreamChunk,
  ToolCall,
  TokenUsage,
  ProviderCapabilities,
} from '../src/index.js';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockProvider(name: string = 'mock', caps?: Partial<ProviderCapabilities>): LLMProvider {
  return {
    name,
    capabilities: {
      streaming: true,
      functionCalling: true,
      vision: false,
      jsonMode: false,
      ...caps,
    },
    complete: vi.fn().mockResolvedValue({
      content: 'Mock response',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      finishReason: 'stop',
      model: 'mock-model',
    }),
    stream: vi.fn().mockImplementation(async function* () {
      yield { delta: { content: 'Hello' } };
      yield { delta: { content: ' world' } };
      yield { finishReason: 'stop' };
    }),
    countTokens: vi.fn().mockReturnValue(5),
    listModels: vi.fn().mockResolvedValue([
      { id: 'mock-model', name: 'Mock Model', maxTokens: 4096, capabilities: { streaming: true, functionCalling: true, vision: false, jsonMode: false } },
    ]),
  };
}

function createMockResponse(overrides?: Partial<LLMResponse>): LLMResponse {
  return {
    content: 'Hello, world!',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    finishReason: 'stop',
    model: 'gpt-4o',
    ...overrides,
  };
}

// ============================================================================
// 1. Multi-Provider Support Tests
// ============================================================================
describe('Multi-Provider Support', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  test('should register multiple providers', () => {
    const openai = createMockProvider('openai', { streaming: true, functionCalling: true, vision: true, jsonMode: true });
    const anthropic = createMockProvider('anthropic', { streaming: true, functionCalling: true, vision: true, jsonMode: true });
    const local = createMockProvider('local', { streaming: false, functionCalling: false, vision: false, jsonMode: false });

    registry.register('openai', openai, { priority: 10 });
    registry.register('anthropic', anthropic, { priority: 8 });
    registry.register('local', local, { priority: 5 });

    expect(registry.size).toBe(3);
    expect(registry.has('openai')).toBe(true);
    expect(registry.has('anthropic')).toBe(true);
    expect(registry.has('local')).toBe(true);
  });

  test('should select provider by capability requirements', () => {
    const basic = createMockProvider('basic', { streaming: true, functionCalling: false, vision: false, jsonMode: false });
    const advanced = createMockProvider('advanced', { streaming: true, functionCalling: true, vision: true, jsonMode: true });

    registry.register('basic', basic, { priority: 10 });
    registry.register('advanced', advanced, { priority: 5 });

    // Should select advanced for vision requirement despite lower priority
    const selected = registry.select({ vision: true });
    expect(selected.name).toBe('advanced');

    // Should select basic for simple streaming (higher priority)
    const basicSelected = registry.select({ streaming: true });
    expect(basicSelected.name).toBe('basic');
  });

  test('should handle provider failover', async () => {
    const failing = createMockProvider('failing');
    (failing.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection failed'));

    const working = createMockProvider('working');

    registry.register('failing', failing);
    registry.register('working', working);

    const { result, providerName } = await registry.executeWithFallback(
      { messages: [], model: 'test' },
      (p) => p.complete({ messages: [{ role: 'user', content: 'Hi' }], model: 'test' }),
      ['failing', 'working'],
    );

    expect(providerName).toBe('working');
    expect(result).toBeDefined();
  });

  test('should throw when all providers fail', async () => {
    const fail1 = createMockProvider('fail1');
    const fail2 = createMockProvider('fail2');
    (fail1.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Error 1'));
    (fail2.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Error 2'));

    registry.register('fail1', fail1);
    registry.register('fail2', fail2);

    await expect(
      registry.executeWithFallback(
        { messages: [], model: 'test' },
        (p) => p.complete({ messages: [{ role: 'user', content: 'Hi' }], model: 'test' }),
        ['fail1', 'fail2'],
      ),
    ).rejects.toThrow();
  });

  test('should skip disabled providers in failover', async () => {
    const disabled = createMockProvider('disabled');
    const enabled = createMockProvider('enabled');

    registry.register('disabled', disabled, { enabled: false });
    registry.register('enabled', enabled);

    const { providerName } = await registry.executeWithFallback(
      { messages: [], model: 'test' },
      (p) => p.complete({ messages: [{ role: 'user', content: 'Hi' }], model: 'test' }),
    );

    expect(providerName).toBe('enabled');
  });

  test('should handle provider tags', () => {
    registry.register('prod', createMockProvider('prod'), { tags: ['production', 'fast'] });
    registry.register('dev', createMockProvider('dev'), { tags: ['development'] });

    const providers = registry.listProviders();
    const prod = providers.find(p => p.name === 'prod');
    expect(prod?.tags).toEqual(['production', 'fast']);
  });
});

// ============================================================================
// 2. Streaming Response Tests
// ============================================================================
describe('Streaming Responses', () => {
  let openaiProvider: OpenAIProvider;
  let anthropicProvider: AnthropicProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    openaiProvider = new OpenAIProvider({ apiKey: 'test-key' });
    anthropicProvider = new AnthropicProvider({ apiKey: 'test-key' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should handle OpenAI streaming with content chunks', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}], "model":"gpt-4o"}\n\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}], "model":"gpt-4o"}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}], "model":"gpt-4o"}\n\n',
      'data: [DONE]\n',
    ];

    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body });

    const stream = openaiProvider.stream({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });

    const results: StreamChunk[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results.length).toBeGreaterThan(0);
    const content = results.map(r => r.delta?.content).filter(Boolean).join('');
    expect(content).toBe('Hello world');
  });

  test('should handle OpenAI streaming with tool calls', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc_1","type":"function","function":{"name":"get_weather"}}]},"finish_reason":null}],"model":"gpt-4o"}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":\\"NYC\\"}"}}]},"finish_reason":null}],"model":"gpt-4o"}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"model":"gpt-4o"}\n\n',
    ];

    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body });

    const stream = openaiProvider.stream({
      messages: [{ role: 'user', content: 'Weather?' }],
      model: 'gpt-4o',
      tools: [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: {} } }],
    });

    const results: StreamChunk[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results.some(r => r.delta?.toolCalls)).toBe(true);
    expect(results.some(r => r.finishReason === 'tool_calls')).toBe(true);
  });

  test('should handle Anthropic streaming', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""},"model":"claude-sonnet-4-20250514"}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"},"model":"claude-sonnet-4-20250514"}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" from Claude"},"model":"claude-sonnet-4-20250514"}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10},"model":"claude-sonnet-4-20250514"}\n\n',
      'data: {"type":"message_stop","model":"claude-sonnet-4-20250514"}\n\n',
    ];

    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body });

    const stream = anthropicProvider.stream({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'claude-sonnet-4-20250514',
    });

    const results: StreamChunk[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results.length).toBeGreaterThan(0);
  });

  test('should handle streaming with usage information', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}],"usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11},"model":"gpt-4o"}\n\n',
      'data: {"choices":[{"delta":{"content":" there"},"finish_reason":null}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12},"model":"gpt-4o"}\n\n',
    ];

    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body });

    const stream = openaiProvider.stream({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });

    const results: StreamChunk[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    const chunksWithUsage = results.filter(r => r.usage);
    expect(chunksWithUsage.length).toBeGreaterThan(0);
  });

  test('should handle empty streaming response', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: [DONE]\n'));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body });

    const stream = openaiProvider.stream({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });

    const results: StreamChunk[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results.length).toBe(0);
  });

  test('should handle streaming errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limit exceeded'),
    });

    await expect(
      openaiProvider.stream({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-4o',
      }).next(),
    ).rejects.toThrow('OpenAI API error 429');
  });

  test('should handle malformed stream data gracefully', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: invalid json\n\n',
      'data: {"choices":[{"delta":{"content":"Valid"},"finish_reason":null}],"model":"gpt-4o"}\n\n',
      'not a data line\n',
      'data: [DONE]\n',
    ];

    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body });

    const stream = openaiProvider.stream({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });

    const results: StreamChunk[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    // Should skip malformed data but continue processing
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.delta?.content === 'Valid')).toBe(true);
  });
});

// ============================================================================
// 3. Tool Execution Tests
// ============================================================================
describe('Tool Execution', () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor();
  });

  test('should execute tool successfully', async () => {
    executor.registerTool({
      name: 'calculator',
      description: 'Performs calculations',
      schema: {
        type: 'object',
        properties: {
          a: { type: 'number' },
          b: { type: 'number' },
          operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
        },
        required: ['a', 'b', 'operation'],
      },
      handler: async (params) => {
        const { a, b, operation } = params;
        switch (operation) {
          case 'add': return (a as number) + (b as number);
          case 'subtract': return (a as number) - (b as number);
          case 'multiply': return (a as number) * (b as number);
          case 'divide': return (a as number) / (b as number);
          default: throw new Error('Unknown operation');
        }
      },
    });

    const result = await executor.execute({
      id: 'tc_1',
      name: 'calculator',
      arguments: JSON.stringify({ a: 10, b: 5, operation: 'add' }),
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe(15);
    expect(result.executionTime).toBeGreaterThanOrEqual(0);
  });

  test('should handle tool execution timeout', async () => {
    executor.registerTool({
      name: 'slowTool',
      description: 'A slow tool',
      schema: { type: 'object', properties: {} },
      handler: async () => {
        await new Promise(resolve => setTimeout(resolve, 10000));
        return 'completed';
      },
      timeout: 1, // 1ms timeout
    });

    const result = await executor.execute({
      id: 'tc_1',
      name: 'slowTool',
      arguments: '{}',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  test('should handle tool not found', async () => {
    const result = await executor.execute({
      id: 'tc_1',
      name: 'nonexistent',
      arguments: '{}',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('should handle invalid JSON arguments', async () => {
    executor.registerTool({
      name: 'testTool',
      description: 'Test tool',
      schema: { type: 'object', properties: {} },
      handler: async () => 'result',
    });

    const result = await executor.execute({
      id: 'tc_1',
      name: 'testTool',
      arguments: 'not valid json',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid JSON');
  });

  test('should handle missing required parameters', async () => {
    executor.registerTool({
      name: 'greet',
      description: 'Greets a person',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          greeting: { type: 'string' },
        },
        required: ['name'],
      },
      handler: async (params) => `Hello, ${params.name}!`,
    });

    const result = await executor.execute({
      id: 'tc_1',
      name: 'greet',
      arguments: JSON.stringify({ greeting: 'Hi' }), // missing 'name'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing required parameter');
  });

  test('should execute batch in parallel', async () => {
    executor.registerTool({
      name: 'echo',
      description: 'Echo tool',
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      handler: async (params) => params.text,
    });

    const results = await executor.executeBatch([
      { id: 'tc_1', name: 'echo', arguments: JSON.stringify({ text: 'a' }) },
      { id: 'tc_2', name: 'echo', arguments: JSON.stringify({ text: 'b' }) },
      { id: 'tc_3', name: 'echo', arguments: JSON.stringify({ text: 'c' }) },
    ]);

    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);
    expect(results.map(r => r.result)).toEqual(['a', 'b', 'c']);
  });

  test('should handle tool handler errors', async () => {
    executor.registerTool({
      name: 'errorTool',
      description: 'Tool that throws',
      schema: { type: 'object', properties: {} },
      handler: async () => {
        throw new Error('Intentional error');
      },
    });

    const result = await executor.execute({
      id: 'tc_1',
      name: 'errorTool',
      arguments: '{}',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Intentional error');
  });

  test('should validate schema on registration', () => {
    expect(() => {
      executor.registerTool({
        name: 'badSchema',
        description: 'Bad schema tool',
        schema: { type: 'array', properties: {} } as any,
        handler: async () => null,
      });
    }).toThrow('Invalid schema');
  });

  test('should prevent duplicate tool registration', () => {
    executor.registerTool({
      name: 'unique',
      description: 'Unique tool',
      schema: { type: 'object', properties: {} },
      handler: async () => null,
    });

    expect(() => {
      executor.registerTool({
        name: 'unique',
        description: 'Duplicate',
        schema: { type: 'object', properties: {} },
        handler: async () => null,
      });
    }).toThrow('already registered');
  });
});

// ============================================================================
// 4. Token Management Tests
// ============================================================================
describe('Token Management', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    tokenManager = new TokenManager();
  });

  test('should count tokens for OpenAI models', () => {
    const text = 'Hello, world! This is a test.';
    const tokens = tokenManager.countTokens('gpt-4o', text);
    expect(tokens).toBe(Math.ceil(text.length / 4));
  });

  test('should count tokens for Claude models', () => {
    const text = 'Hello, world! This is a test.';
    const tokens = tokenManager.countTokens('claude-sonnet-4-20250514', text);
    expect(tokens).toBe(Math.ceil(text.length / 3.5));
  });

  test('should set and enforce budget', () => {
    tokenManager.setBudget('gpt-4o', {
      total: 1000,
      system: 100,
      conversation: 800,
      response: 100,
    });

    expect(tokenManager.allocateTokens('gpt-4o', 500)).toBe(true);
    expect(tokenManager.allocateTokens('gpt-4o', 600)).toBe(false);
  });

  test('should track remaining budget after usage', () => {
    tokenManager.setBudget('gpt-4o', {
      total: 1000,
      system: 100,
      conversation: 800,
      response: 100,
    });

    const initialRemaining = tokenManager.getRemainingBudget('gpt-4o');
    expect(initialRemaining).toBe(1000);

    tokenManager.recordUsage({
      model: 'gpt-4o',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      timestamp: Date.now(),
    });

    const remaining = tokenManager.getRemainingBudget('gpt-4o');
    expect(remaining).toBe(850);
  });

  test('should auto-budget for known models', () => {
    const budget = tokenManager.autoBudget('gpt-4o');
    expect(budget.total).toBe(128000);
    expect(budget.response).toBe(16384);
  });

  test('should throw for auto-budget of unknown model', () => {
    expect(() => tokenManager.autoBudget('unknown-model')).toThrow('No token limits');
  });

  test('should generate usage report', () => {
    tokenManager.setBudget('gpt-4o', { total: 1000, system: 100, conversation: 800, response: 100 });
    tokenManager.recordUsage({
      model: 'gpt-4o',
      promptTokens: 50,
      completionTokens: 30,
      totalTokens: 80,
      timestamp: Date.now(),
    });

    const report = tokenManager.getUsageReport();
    expect(report.totalUsed).toBe(80);
    expect(report.totalBudget).toBe(1000);
    expect(report.byModel['gpt-4o'].used).toBe(80);
    expect(report.byModel['gpt-4o'].remaining).toBe(920);
  });

  test('should alert when usage exceeds threshold', () => {
    tokenManager.setBudget('gpt-4o', { total: 100, system: 10, conversation: 80, response: 10 });
    tokenManager.setAlertThreshold(0.5);

    tokenManager.recordUsage({
      model: 'gpt-4o',
      promptTokens: 30,
      completionTokens: 20,
      totalTokens: 50,
      timestamp: Date.now(),
    });

    const report = tokenManager.getUsageReport();
    expect(report.alerts.length).toBeGreaterThan(0);
    expect(report.alerts[0]).toContain('50%');
  });

  test('should handle multiple models', () => {
    tokenManager.setBudget('gpt-4o', { total: 1000, system: 100, conversation: 800, response: 100 });
    tokenManager.setBudget('claude-sonnet-4-20250514', { total: 2000, system: 200, conversation: 1600, response: 200 });

    tokenManager.recordUsage({
      model: 'gpt-4o',
      promptTokens: 50,
      completionTokens: 30,
      totalTokens: 80,
      timestamp: Date.now(),
    });

    tokenManager.recordUsage({
      model: 'claude-sonnet-4-20250514',
      promptTokens: 100,
      completionTokens: 60,
      totalTokens: 160,
      timestamp: Date.now(),
    });

    const report = tokenManager.getUsageReport();
    expect(Object.keys(report.byModel)).toHaveLength(2);
    expect(report.totalUsed).toBe(240);
  });

  test('should clear usage', () => {
    tokenManager.setBudget('gpt-4o', { total: 1000, system: 100, conversation: 800, response: 100 });
    tokenManager.recordUsage({
      model: 'gpt-4o',
      promptTokens: 50,
      completionTokens: 30,
      totalTokens: 80,
      timestamp: Date.now(),
    });

    tokenManager.clearUsage();
    const report = tokenManager.getUsageReport();
    expect(report.totalUsed).toBe(0);
    expect(report.alerts).toHaveLength(0);
  });

  test('should return Infinity for remaining budget when no budget set', () => {
    expect(tokenManager.getRemainingBudget('unknown-model')).toBe(Infinity);
  });

  test('should set custom model limits', () => {
    tokenManager.setModelLimits('custom-model', {
      contextWindow: 50000,
      maxOutputTokens: 2000,
      recommendedSystemTokens: 1000,
    });

    const limits = tokenManager.getModelLimits('custom-model');
    expect(limits?.contextWindow).toBe(50000);
    expect(limits?.maxOutputTokens).toBe(2000);
  });
});

// ============================================================================
// 5. Cost Tracking Tests
// ============================================================================
describe('Cost Tracking', () => {
  let costTracker: CostTracker;

  beforeEach(() => {
    costTracker = new CostTracker();
  });

  test('should calculate cost for GPT-4o', () => {
    costTracker.recordUsage('gpt-4o', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    const cost = costTracker.getCost();
    // gpt-4o: $0.0025/1k input, $0.01/1k output
    expect(cost.inputCost).toBeCloseTo(0.0025, 4);
    expect(cost.outputCost).toBeCloseTo(0.005, 4);
    expect(cost.totalCost).toBeCloseTo(0.0075, 4);
  });

  test('should calculate cost for Claude models', () => {
    costTracker.recordUsage('claude-sonnet-4-20250514', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    const cost = costTracker.getCost();
    // claude-sonnet-4: $0.003/1k input, $0.015/1k output
    expect(cost.inputCost).toBeCloseTo(0.003, 4);
    expect(cost.outputCost).toBeCloseTo(0.0075, 4);
    expect(cost.totalCost).toBeCloseTo(0.0105, 4);
  });

  test('should handle unknown model with zero cost', () => {
    costTracker.recordUsage('unknown-model', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    const cost = costTracker.getCost();
    expect(cost.totalCost).toBe(0);
    expect(cost.totalTokens).toBe(1500);
  });

  test('should track cost per conversation', () => {
    costTracker.recordUsage('gpt-4o', {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    }, 'conv1');

    costTracker.recordUsage('gpt-4o', {
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
    }, 'conv2');

    const conv1Cost = costTracker.getCost('conv1');
    const conv2Cost = costTracker.getCost('conv2');

    expect(conv1Cost.requestCount).toBe(1);
    expect(conv2Cost.requestCount).toBe(1);
    expect(conv2Cost.totalTokens).toBe(300);
  });

  test('should track daily cost', () => {
    costTracker.recordUsage('gpt-4o', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    const daily = costTracker.getDailyCost();
    expect(daily.totalTokens).toBe(1500);
    expect(daily.requestCount).toBe(1);
  });

  test('should track monthly cost with daily breakdown', () => {
    costTracker.recordUsage('gpt-4o', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    const monthly = costTracker.getMonthlyCost();
    expect(monthly.totalTokens).toBe(1500);
    expect(monthly.dailyBreakdown.length).toBeGreaterThanOrEqual(1);
  });

  test('should project costs', () => {
    // Add some usage data
    for (let i = 0; i < 10; i++) {
      costTracker.recordUsage('gpt-4o', {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });
    }

    const projection = costTracker.projectCost(30);
    expect(projection.projectedDailyCost).toBeGreaterThanOrEqual(0);
    expect(projection.projectedMonthlyCost).toBeGreaterThanOrEqual(0);
    expect(['increasing', 'decreasing', 'stable']).toContain(projection.trend);
    expect(projection.confidence).toBeGreaterThanOrEqual(0);
    expect(projection.confidence).toBeLessThanOrEqual(1);
  });

  test('should set and check budget limits', () => {
    costTracker.setBudgetLimit('daily', 1.0);
    costTracker.setBudgetLimit('monthly', 30.0);

    expect(costTracker.isOverBudget('daily')).toBe(false);
    expect(costTracker.isOverBudget('monthly')).toBe(false);

    // Add expensive usage
    costTracker.recordUsage('gpt-4o', {
      promptTokens: 1000000,
      completionTokens: 1000000,
      totalTokens: 2000000,
    });

    expect(costTracker.isOverBudget('daily')).toBe(true);
  });

  test('should get budget remaining', () => {
    costTracker.setBudgetLimit('daily', 10);
    costTracker.recordUsage('gpt-4o', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    const remaining = costTracker.getBudgetRemaining('daily');
    expect(remaining).toBeLessThanOrEqual(10);
    expect(remaining).toBeGreaterThan(0);
  });

  test('should return Infinity for budget remaining when no limit set', () => {
    expect(costTracker.getBudgetRemaining('daily')).toBe(Infinity);
    expect(costTracker.getBudgetRemaining('monthly')).toBe(Infinity);
  });

  test('should get cost by model', () => {
    costTracker.recordUsage('gpt-4o', {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });

    costTracker.recordUsage('claude-sonnet-4-20250514', {
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
    });

    const byModel = costTracker.getCostByModel();
    expect(Object.keys(byModel)).toHaveLength(2);
    expect(byModel['gpt-4o'].requestCount).toBe(1);
    expect(byModel['claude-sonnet-4-20250514'].requestCount).toBe(1);
  });

  test('should set custom pricing', () => {
    costTracker.setPricing('custom-model', {
      inputCostPer1k: 0.01,
      outputCostPer1k: 0.03,
    });

    costTracker.recordUsage('custom-model', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    const cost = costTracker.getCost();
    expect(cost.inputCost).toBeCloseTo(0.01, 4);
    expect(cost.outputCost).toBeCloseTo(0.015, 4);
  });

  test('should clear records', () => {
    costTracker.recordUsage('gpt-4o', {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });

    costTracker.clearRecords();
    const cost = costTracker.getCost();
    expect(cost.totalTokens).toBe(0);
    expect(cost.requestCount).toBe(0);
  });
});

// ============================================================================
// 6. Provider Failover Tests
// ============================================================================
describe('Provider Failover', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  test('should failover to next provider on error', async () => {
    const fail1 = createMockProvider('fail1');
    const fail2 = createMockProvider('fail2');
    const success = createMockProvider('success');

    (fail1.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Fail 1'));
    (fail2.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Fail 2'));

    registry.register('fail1', fail1);
    registry.register('fail2', fail2);
    registry.register('success', success);

    const { providerName } = await registry.executeWithFallback(
      { messages: [], model: 'test' },
      (p) => p.complete({ messages: [{ role: 'user', content: 'Hi' }], model: 'test' }),
      ['fail1', 'fail2', 'success'],
    );

    expect(providerName).toBe('success');
  });

  test('should use all providers when no specific list provided', async () => {
    const fail = createMockProvider('fail');
    const success = createMockProvider('success');

    (fail.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Fail'));

    registry.register('fail', fail);
    registry.register('success', success);

    const { providerName } = await registry.executeWithFallback(
      { messages: [], model: 'test' },
      (p) => p.complete({ messages: [{ role: 'user', content: 'Hi' }], model: 'test' }),
    );

    expect(providerName).toBe('success');
  });

  test('should skip disabled providers', async () => {
    const disabled = createMockProvider('disabled');
    const enabled = createMockProvider('enabled');

    registry.register('disabled', disabled, { enabled: false });
    registry.register('enabled', enabled);

    const { providerName } = await registry.executeWithFallback(
      { messages: [], model: 'test' },
      (p) => p.complete({ messages: [{ role: 'user', content: 'Hi' }], model: 'test' }),
    );

    expect(providerName).toBe('enabled');
  });

  test('should throw when no providers available', async () => {
    const registry = new ProviderRegistry();

    await expect(
      registry.executeWithFallback(
        { messages: [], model: 'test' },
        (p) => p.complete({ messages: [{ role: 'user', content: 'Hi' }], model: 'test' }),
      ),
    ).rejects.toThrow('No providers available');
  });
});

// ============================================================================
// 7. Rate Limiting Tests
// ============================================================================
describe('Rate Limiting', () => {
  let openaiProvider: OpenAIProvider;
  let anthropicProvider: AnthropicProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    openaiProvider = new OpenAIProvider({ apiKey: 'test-key', maxRetries: 2 });
    anthropicProvider = new AnthropicProvider({ apiKey: 'test-key', maxRetries: 2 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should retry on OpenAI rate limit (429)', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          text: () => Promise.resolve('Rate limited'),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'resp_123',
          choices: [{ message: { role: 'assistant', content: 'Success' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: 'gpt-4o',
        }),
      });
    });

    // Mock setTimeout to be instant
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      origSetTimeout(fn, 0);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const result = await openaiProvider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });

    expect(callCount).toBe(2);
    expect(result.content).toBe('Success');

    vi.restoreAllMocks();
  });

  test('should retry on Anthropic rate limit (429)', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          text: () => Promise.resolve('Rate limited'),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Success' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });
    });

    // Mock setTimeout to be instant
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      origSetTimeout(fn, 0);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const result = await anthropicProvider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'claude-sonnet-4-20250514',
    });

    expect(callCount).toBe(2);
    expect(result.content).toBe('Success');

    vi.restoreAllMocks();
  });

  test('should not retry on non-rate-limit errors', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });
    });

    await expect(
      openaiProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-4o',
      }),
    ).rejects.toThrow('OpenAI API error 401');

    expect(callCount).toBe(1);
  });

  test('should respect maxRetries limit', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key', maxRetries: 1 });
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limited'),
      });
    });

    // Mock setTimeout to be instant
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      origSetTimeout(fn, 0);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    await expect(
      provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-4o',
      }),
    ).rejects.toThrow('OpenAI API error 429');

    // Initial call + 1 retry = 2 calls
    expect(callCount).toBe(2);

    vi.restoreAllMocks();
  });
});

// ============================================================================
// 8. Boundary Value Tests
// ============================================================================
describe('Boundary Values', () => {
  let openaiProvider: OpenAIProvider;
  let anthropicProvider: AnthropicProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    openaiProvider = new OpenAIProvider({ apiKey: 'test-key' });
    anthropicProvider = new AnthropicProvider({ apiKey: 'test-key' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should handle empty messages array', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'resp_123',
        choices: [{ message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 5, total_tokens: 5 },
        model: 'gpt-4o',
      }),
    });

    const result = await openaiProvider.complete({
      messages: [],
      model: 'gpt-4o',
    });

    expect(result.content).toBe('Hello');
  });

  test('should handle empty content string', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'resp_123',
        choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        model: 'gpt-4o',
      }),
    });

    const result = await openaiProvider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });

    expect(result.content).toBe('');
  });

  test('should handle zero tokens', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'resp_123',
        choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        model: 'gpt-4o',
      }),
    });

    const result = await openaiProvider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });

    expect(result.usage.totalTokens).toBe(0);
  });

  test('should handle maxTokens = 0', async () => {
    let capturedBody: string = '';
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      capturedBody = opts?.body as string;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'resp_123',
          choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
          model: 'gpt-4o',
        }),
      });
    });

    await openaiProvider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
      maxTokens: 0,
    });

    const body = JSON.parse(capturedBody);
    expect(body.max_tokens).toBe(0);
  });

  test('should handle temperature = 0', async () => {
    let capturedBody: string = '';
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      capturedBody = opts?.body as string;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'resp_123',
          choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: 'gpt-4o',
        }),
      });
    });

    await openaiProvider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
      temperature: 0,
    });

    const body = JSON.parse(capturedBody);
    expect(body.temperature).toBe(0);
  });

  test('should handle temperature = 2 (max)', async () => {
    let capturedBody: string = '';
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      capturedBody = opts?.body as string;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'resp_123',
          choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: 'gpt-4o',
        }),
      });
    });

    await openaiProvider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
      temperature: 2,
    });

    const body = JSON.parse(capturedBody);
    expect(body.temperature).toBe(2);
  });

  test('should handle very long content', async () => {
    const longContent = 'a'.repeat(100000);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'resp_123',
        choices: [{ message: { role: 'assistant', content: 'Received' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 25000, completion_tokens: 1, total_tokens: 25001 },
        model: 'gpt-4o',
      }),
    });

    const result = await openaiProvider.complete({
      messages: [{ role: 'user', content: longContent }],
      model: 'gpt-4o',
    });

    expect(result.content).toBe('Received');
  });

  test('should handle special characters in content', async () => {
    const specialContent = 'Hello! @#$%^&*()_+-=[]{}|;\':",./<>?\\n\\t';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'resp_123',
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        model: 'gpt-4o',
      }),
    });

    const result = await openaiProvider.complete({
      messages: [{ role: 'user', content: specialContent }],
      model: 'gpt-4o',
    });

    expect(result.content).toBe('OK');
  });

  test('should handle unicode content', async () => {
    const unicodeContent = 'Hello 世界! Привет мир! مرحبا بالعالم! 🌍🎉';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'resp_123',
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        model: 'gpt-4o',
      }),
    });

    const result = await openaiProvider.complete({
      messages: [{ role: 'user', content: unicodeContent }],
      model: 'gpt-4o',
    });

    expect(result.content).toBe('OK');
  });

  test('should handle empty stop sequences', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'resp_123',
        choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4o',
      }),
    });

    const result = await openaiProvider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
      stopSequences: [],
    });

    expect(result.content).toBe('Hi');
  });

  test('should handle multiple stop sequences', async () => {
    let capturedBody: string = '';
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      capturedBody = opts?.body as string;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'resp_123',
          choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: 'gpt-4o',
        }),
      });
    });

    await openaiProvider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
      stopSequences: ['\n', '.', '?'],
    });

    const body = JSON.parse(capturedBody);
    expect(body.stop).toEqual(['\n', '.', '?']);
  });

  test('should handle null finish reason', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'resp_123',
        choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: null }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4o',
      }),
    });

    const result = await openaiProvider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });

    expect(result.finishReason).toBeNull();
  });

  test('should handle undefined optional fields', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'resp_123',
        choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4o',
      }),
    });

    const result = await openaiProvider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });

    expect(result.toolCalls).toBeUndefined();
  });

  test('should count tokens for empty string', () => {
    expect(openaiProvider.countTokens('')).toBe(0);
    expect(anthropicProvider.countTokens('')).toBe(0);
  });

  test('should count tokens for single character', () => {
    expect(openaiProvider.countTokens('a')).toBe(1);
    expect(anthropicProvider.countTokens('a')).toBe(1);
  });
});

// ============================================================================
// 9. Error Handling Tests
// ============================================================================
describe('Error Handling', () => {
  let openaiProvider: OpenAIProvider;
  let anthropicProvider: AnthropicProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    openaiProvider = new OpenAIProvider({ apiKey: 'test-key' });
    anthropicProvider = new AnthropicProvider({ apiKey: 'test-key' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should handle 401 Unauthorized', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Invalid API key'),
    });

    await expect(
      openaiProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-4o',
      }),
    ).rejects.toThrow('OpenAI API error 401');
  });

  test('should handle 404 Not Found', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Model not found'),
    });

    await expect(
      openaiProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'nonexistent-model',
      }),
    ).rejects.toThrow('OpenAI API error 404');
  });

  test('should handle 500 Server Error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal server error'),
    });

    await expect(
      openaiProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-4o',
      }),
    ).rejects.toThrow('OpenAI API error 500');
  });

  test('should handle network errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(
      openaiProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-4o',
      }),
    ).rejects.toThrow('Network error');
  });

  test('should handle timeout errors', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 10);
      });
    });

    await expect(
      openaiProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-4o',
      }),
    ).rejects.toThrow('Timeout');
  });

  test('should handle malformed JSON response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('Invalid JSON')),
    });

    await expect(
      openaiProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-4o',
      }),
    ).rejects.toThrow('Invalid JSON');
  });

  test('should handle missing response body in stream', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    });

    await expect(
      openaiProvider.stream({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-4o',
      }).next(),
    ).rejects.toThrow('Response body is null');
  });

  test('should handle Anthropic overloaded error', async () => {
    const overloadedProvider = new AnthropicProvider({ apiKey: 'test-key', maxRetries: 0 });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 529,
      text: () => Promise.resolve('overloaded_error'),
    });

    await expect(
      overloadedProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'claude-sonnet-4-20250514',
      }),
    ).rejects.toThrow('Anthropic API error 529');
  });
});

// ============================================================================
// 10. Conversation Manager Tests
// ============================================================================
describe('Conversation Manager', () => {
  let manager: ConversationManager;
  let mockProvider: LLMProvider;

  beforeEach(() => {
    mockProvider = createMockProvider();
    manager = new ConversationManager(mockProvider);
  });

  test('should create conversation with system prompt', () => {
    const conv = manager.createConversation({
      systemPrompt: 'You are a helpful assistant.',
      maxMessages: 50,
    });

    expect(conv.id).toBeDefined();
    expect(conv.systemPrompt).toBe('You are a helpful assistant.');
    expect(conv.maxMessages).toBe(50);
  });

  test('should send message and track history', async () => {
    const conv = manager.createConversation();
    const response = await manager.sendMessage(conv.id, 'Hello');

    expect(response.content).toBe('Mock response');

    const history = manager.getHistory(conv.id);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toBe('Hello');
    expect(history[1].role).toBe('assistant');
  });

  test('should manage context window', async () => {
    const conv = manager.createConversation({ maxMessages: 4 });

    // Send multiple messages to exceed maxMessages
    await manager.sendMessage(conv.id, 'Message 1');
    await manager.sendMessage(conv.id, 'Message 2');
    await manager.sendMessage(conv.id, 'Message 3');

    const history = manager.getHistory(conv.id);
    // Should have at most 6 messages (3 user + 3 assistant)
    expect(history.length).toBeLessThanOrEqual(6);
  });

  test('should fork conversation', async () => {
    const conv = manager.createConversation();
    await manager.sendMessage(conv.id, 'Hello');
    await manager.sendMessage(conv.id, 'How are you?');

    const forkId = manager.forkConversation(conv.id);
    const forkHistory = manager.getHistory(forkId);

    expect(forkHistory.length).toBe(4); // 2 user + 2 assistant
  });

  test('should clear history', async () => {
    const conv = manager.createConversation();
    await manager.sendMessage(conv.id, 'Hello');

    manager.clearHistory(conv.id);
    const history = manager.getHistory(conv.id);

    expect(history).toHaveLength(0);
  });

  test('should update system prompt', () => {
    const conv = manager.createConversation({ systemPrompt: 'Old prompt' });
    manager.updateSystemPrompt(conv.id, 'New prompt');

    const updated = manager.getConversation(conv.id);
    expect(updated?.systemPrompt).toBe('New prompt');
  });

  test('should throw for nonexistent conversation', async () => {
    await expect(manager.sendMessage('nonexistent', 'Hello')).rejects.toThrow('not found');
  });

  test('should list conversations sorted by update time', async () => {
    const conv1 = manager.createConversation();
    const conv2 = manager.createConversation();
    const conv3 = manager.createConversation();

    // Update conv1 to make it most recent
    await new Promise(resolve => setTimeout(resolve, 10));
    manager.addMessage(conv1.id, { role: 'user', content: 'Update' });

    const list = manager.listConversations();
    expect(list[0].id).toBe(conv1.id);
  });
});

// ============================================================================
// 11. Response Parser Tests
// ============================================================================
describe('Response Parser', () => {
  let parser: ResponseParser;

  beforeEach(() => {
    parser = new ResponseParser();
  });

  test('should extract JSON from response', () => {
    const response = createMockResponse({ content: '{"name": "Alice", "age": 30}' });
    const json = parser.extractJSON(response) as Record<string, unknown>;

    expect(json.name).toBe('Alice');
    expect(json.age).toBe(30);
  });

  test('should extract JSON from code block', () => {
    const response = createMockResponse({
      content: 'Here is the data:\n```json\n{"key": "value"}\n```',
    });
    const json = parser.extractJSON(response) as Record<string, unknown>;

    expect(json.key).toBe('value');
  });

  test('should throw when no JSON found', () => {
    const response = createMockResponse({ content: 'No JSON here' });
    expect(() => parser.extractJSON(response)).toThrow('No valid JSON');
  });

  test('should extract code blocks', () => {
    const response = createMockResponse({
      content: '```typescript\nconst x = 1;\n```\n\n```python\nprint("hello")\n```',
    });
    const blocks = parser.extractCodeBlocks(response);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].language).toBe('typescript');
    expect(blocks[1].language).toBe('python');
  });

  test('should extract plain text', () => {
    const response = createMockResponse({
      content: '# Title\n\n**Bold** text and `code`.',
    });
    const plain = parser.extractPlainText(response);

    expect(plain).not.toContain('#');
    expect(plain).not.toContain('**');
    expect(plain).not.toContain('`');
    expect(plain).toContain('Bold text');
    expect(plain).toContain('code');
  });

  test('should detect tool calls', () => {
    const withTools = createMockResponse({
      toolCalls: [{ id: 'tc_1', name: 'test', arguments: '{}' }],
    });
    const withoutTools = createMockResponse();

    expect(parser.hasToolCalls(withTools)).toBe(true);
    expect(parser.hasToolCalls(withoutTools)).toBe(false);
  });

  test('should check completion status', () => {
    const complete = createMockResponse({ finishReason: 'stop' });
    const truncated = createMockResponse({ finishReason: 'length' });

    expect(parser.isComplete(complete)).toBe(true);
    expect(parser.isTruncated(truncated)).toBe(true);
  });

  test('should extract list items', () => {
    const response = createMockResponse({
      content: '- Item 1\n- Item 2\n* Item 3\n1. First\n2. Second',
    });
    const items = parser.extractListItems(response);

    expect(items).toContain('Item 1');
    expect(items).toContain('Item 2');
    expect(items).toContain('Item 3');
    expect(items).toContain('First');
    expect(items).toContain('Second');
  });

  test('should extract headings', () => {
    const response = createMockResponse({
      content: '# H1\n## H2\n### H3',
    });
    const headings = parser.extractHeadings(response);

    expect(headings).toHaveLength(3);
    expect(headings[0]).toEqual({ level: 1, text: 'H1' });
    expect(headings[1]).toEqual({ level: 2, text: 'H2' });
    expect(headings[2]).toEqual({ level: 3, text: 'H3' });
  });
});

// ============================================================================
// 12. Prompt Manager Tests
// ============================================================================
describe('Prompt Manager', () => {
  let manager: PromptManager;

  beforeEach(() => {
    manager = new PromptManager();
  });

  test('should register and render template', () => {
    manager.registerTemplate('greeting', 'Hello, {{name}}!');
    const result = manager.render('greeting', { name: 'World' });

    expect(result).toBe('Hello, World!');
  });

  test('should detect variables automatically', () => {
    manager.registerTemplate('test', '{{a}} and {{b}}');
    const template = manager.getTemplate('test');

    expect(template?.variables).toContain('a');
    expect(template?.variables).toContain('b');
  });

  test('should throw for missing variables', () => {
    manager.registerTemplate('greeting', 'Hello, {{name}}!');
    expect(() => manager.render('greeting', {})).toThrow('Missing required variables');
  });

  test('should compose templates', () => {
    manager.registerTemplate('part1', 'First');
    manager.registerTemplate('part2', 'Second');
    const result = manager.compose(['part1', 'part2']);

    expect(result).toBe('First\n\nSecond');
  });

  test('should estimate tokens', () => {
    const tokens = manager.estimateTokens('Hello, world!');
    expect(tokens).toBe(Math.ceil('Hello, world!'.length / 4));
  });

  test('should compress text', () => {
    const longText = 'This is a very long sentence. '.repeat(50);
    const compressed = manager.compress(longText, 10);

    expect(compressed.length).toBeLessThan(longText.length);
  });

  test('should version templates', () => {
    manager.registerTemplate('test', 'Version 1');
    manager.registerTemplate('test', 'Version 2');
    const history = manager.getVersionHistory('test');

    expect(history).toHaveLength(2);
    expect(history[0].template).toBe('Version 1');
    expect(history[1].template).toBe('Version 2');
  });
});

// ============================================================================
// 13. Integration Tests
// ============================================================================
describe('Integration Tests', () => {
  test('full pipeline: provider -> conversation -> token tracking', async () => {
    const provider = createMockProvider('test');
    const registry = new ProviderRegistry();
    registry.register('test', provider);

    const selected = registry.select({ streaming: true });
    const convManager = new ConversationManager(selected);
    const tokenManager = new TokenManager();

    const conv = convManager.createConversation({ systemPrompt: 'Be helpful.' });
    tokenManager.autoBudget('gpt-4o');

    const response = await convManager.sendMessage(conv.id, 'Hello');

    tokenManager.recordUsage({
      model: 'gpt-4o',
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
      timestamp: Date.now(),
    });

    const report = tokenManager.getUsageReport();
    expect(report.totalUsed).toBeGreaterThan(0);
  });

  test('full pipeline: prompt -> provider -> response parsing', async () => {
    const promptManager = new PromptManager();
    promptManager.registerTemplate('code_review', 'Review this {{language}} code: {{code}}');

    const prompt = promptManager.render('code_review', {
      language: 'TypeScript',
      code: 'const x: number = 1;',
    });

    // Verify prompt was rendered correctly
    expect(prompt).toContain('TypeScript');
    expect(prompt).toContain('const x: number = 1;');

    const mockResponse = createMockResponse({
      content: 'The code looks good.\n```typescript\nconst x: number = 1;\n```',
    });

    const parser = new ResponseParser();
    const content = parser.extractContent(mockResponse);
    const codeBlocks = parser.extractCodeBlocks(mockResponse);

    expect(content).toContain('code looks good');
    expect(codeBlocks).toHaveLength(1);
    expect(codeBlocks[0].language).toBe('typescript');
  });

  test('full pipeline: tool execution with cost tracking', async () => {
    const executor = new ToolExecutor();
    const costTracker = new CostTracker();

    executor.registerTool({
      name: 'calculate',
      description: 'Calculate',
      schema: {
        type: 'object',
        properties: { expression: { type: 'string' } },
        required: ['expression'],
      },
      handler: async (params) => eval(params.expression as string),
    });

    const result = await executor.execute({
      id: 'tc_1',
      name: 'calculate',
      arguments: JSON.stringify({ expression: '2 + 3' }),
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe(5);

    costTracker.recordUsage('gpt-4o', {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });

    const cost = costTracker.getCost();
    expect(cost.totalCost).toBeGreaterThan(0);
  });

  test('full pipeline: multi-provider failover', async () => {
    const registry = new ProviderRegistry();

    const failProvider = createMockProvider('fail');
    (failProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Fail'));

    const successProvider = createMockProvider('success');

    registry.register('fail', failProvider);
    registry.register('success', successProvider);

    const { result, providerName } = await registry.executeWithFallback(
      { messages: [], model: 'test' },
      (p) => p.complete({ messages: [{ role: 'user', content: 'Hi' }], model: 'test' }),
    );

    expect(providerName).toBe('success');
  });
});
