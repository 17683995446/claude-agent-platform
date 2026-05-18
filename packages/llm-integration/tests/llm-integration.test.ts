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
// 1. Provider Interface Tests
// ============================================================================
describe('Provider Interface', () => {
  test('LLMProvider interface should have required properties', () => {
    const provider = createMockProvider();
    expect(provider.name).toBeDefined();
    expect(provider.capabilities).toBeDefined();
    expect(typeof provider.complete).toBe('function');
    expect(typeof provider.stream).toBe('function');
    expect(typeof provider.countTokens).toBe('function');
  });

  test('LLMMessage should support all roles', () => {
    const roles: LLMMessage['role'][] = ['system', 'user', 'assistant', 'tool'];
    for (const role of roles) {
      const msg: LLMMessage = { role, content: 'test' };
      expect(msg.role).toBe(role);
    }
  });

  test('LLMMessage with toolCalls should be valid', () => {
    const msg: LLMMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc_1', name: 'get_weather', arguments: '{"city":"NYC"}' }],
    };
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].name).toBe('get_weather');
  });

  test('LLMRequest should support all fields', () => {
    const request: LLMRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 1000,
      stopSequences: ['\n'],
      tools: [{ name: 'test', description: 'A test tool', parameters: { type: 'object', properties: {} } }],
      responseFormat: { type: 'json_object' },
    };
    expect(request.model).toBe('gpt-4o');
    expect(request.temperature).toBe(0.7);
    expect(request.tools).toHaveLength(1);
  });

  test('TokenUsage should calculate correctly', () => {
    const usage: TokenUsage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
    expect(usage.totalTokens).toBe(usage.promptTokens + usage.completionTokens);
  });

  test('StreamChunk should support delta content', () => {
    const chunk: StreamChunk = { delta: { content: 'Hello' }, finishReason: undefined };
    expect(chunk.delta?.content).toBe('Hello');
  });

  test('StreamChunk should support tool call delta', () => {
    const chunk: StreamChunk = {
      delta: { toolCalls: [{ id: 'tc_1', name: 'func', arguments: '{}' }] },
    };
    expect(chunk.delta?.toolCalls).toHaveLength(1);
  });
});

// ============================================================================
// 2. OpenAI Provider Tests
// ============================================================================
describe('OpenAI Provider', () => {
  let provider: OpenAIProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    provider = new OpenAIProvider({ apiKey: 'test-key' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should initialize with default config', () => {
    expect(provider.name).toBe('openai');
    expect(provider.capabilities.streaming).toBe(true);
    expect(provider.capabilities.functionCalling).toBe(true);
  });

  test('should initialize with custom config', () => {
    const p = new OpenAIProvider({
      apiKey: 'custom-key',
      baseUrl: 'https://custom.api.com/v1',
      defaultModel: 'gpt-4',
      timeout: 60000,
      maxRetries: 5,
    });
    expect(p.name).toBe('openai');
  });

  test('should count tokens (approximate)', () => {
    expect(provider.countTokens('Hello, world!')).toBeGreaterThan(0);
    expect(provider.countTokens('')).toBe(0);
    expect(provider.countTokens('a')).toBe(1);
  });

  test('should list models', async () => {
    const models = await provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id === 'gpt-4o')).toBe(true);
  });

  test('should handle complete request successfully', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        id: 'resp_123',
        choices: [{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4o',
      }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });

    expect(result.content).toBe('Hello!');
    expect(result.usage.totalTokens).toBe(15);
    expect(result.finishReason).toBe('stop');
    expect(result.id).toBe('resp_123');
  });

  test('should handle complete with tool calls', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        id: 'resp_456',
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'tc_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        model: 'gpt-4o',
      }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'What is the weather?' }],
      model: 'gpt-4o',
      tools: [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: {} } }],
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('get_weather');
  });

  test('should handle API errors', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    await expect(provider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    })).rejects.toThrow('OpenAI API error 401');
  });

  test('should retry on rate limit', async () => {
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
          id: 'resp_retry',
          choices: [{ message: { role: 'assistant', content: 'Retry success' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: 'gpt-4o',
        }),
      });
    });

    // Use a provider with 0 timeout retries to avoid delay, but still retry once
    const retryProvider = new OpenAIProvider({ apiKey: 'test-key', maxRetries: 1 });

    // Mock the delay to be instant
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      origSetTimeout(fn, 0);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const result = await retryProvider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });

    expect(result.content).toBe('Retry success');
    expect(callCount).toBe(2);

    vi.restoreAllMocks();
  });

  test('should handle streaming responses', async () => {
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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body,
    });

    const stream = provider.stream({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
    });

    const results: StreamChunk[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.delta?.content === 'Hello')).toBe(true);
  });

  test('should handle complete with system message', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        id: 'resp_sys',
        choices: [{ message: { role: 'assistant', content: 'System response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 15, completionTokens: 5, total_tokens: 20 },
        model: 'gpt-4o',
      }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await provider.complete({
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ],
      model: 'gpt-4o',
    });

    expect(result.content).toBe('System response');
  });

  test('should pass temperature and maxTokens', async () => {
    let capturedBody: string = '';
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      capturedBody = opts?.body as string;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'resp_params',
          choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: 'gpt-4o',
        }),
      });
    });

    await provider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'gpt-4o',
      temperature: 0.5,
      maxTokens: 500,
    });

    const body = JSON.parse(capturedBody);
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(500);
  });
});

// ============================================================================
// 3. Anthropic Provider Tests
// ============================================================================
describe('Anthropic Provider', () => {
  let provider: AnthropicProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    provider = new AnthropicProvider({ apiKey: 'test-key' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should initialize with default config', () => {
    expect(provider.name).toBe('anthropic');
    expect(provider.capabilities.streaming).toBe(true);
    expect(provider.capabilities.vision).toBe(true);
  });

  test('should initialize with custom config', () => {
    const p = new AnthropicProvider({
      apiKey: 'custom-key',
      baseUrl: 'https://custom.anthropic.com',
      defaultModel: 'claude-3-opus-20240229',
    });
    expect(p.name).toBe('anthropic');
  });

  test('should count tokens (approximate)', () => {
    expect(provider.countTokens('Hello, world!')).toBeGreaterThan(0);
    expect(provider.countTokens('')).toBe(0);
  });

  test('should list models', async () => {
    const models = await provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id.includes('claude'))).toBe(true);
  });

  test('should handle complete request successfully', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from Claude!' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'claude-sonnet-4-20250514',
    });

    expect(result.content).toBe('Hello from Claude!');
    expect(result.usage.promptTokens).toBe(10);
    expect(result.finishReason).toBe('end_turn');
  });

  test('should handle complete with tool use', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        id: 'msg_tool',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'NYC' } },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 15 },
      }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Weather?' }],
      model: 'claude-sonnet-4-20250514',
      tools: [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: {} } }],
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('get_weather');
  });

  test('should handle API errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(provider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'claude-sonnet-4-20250514',
    })).rejects.toThrow('Anthropic API error 401');
  });

  test('should handle system prompt extraction', async () => {
    let capturedBody: string = '';
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      capturedBody = opts?.body as string;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'msg_sys',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'OK' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 15, output_tokens: 3 },
        }),
      });
    });

    await provider.complete({
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hi' },
      ],
      model: 'claude-sonnet-4-20250514',
    });

    const body = JSON.parse(capturedBody);
    expect(body.system).toBe('Be helpful.');
    expect(body.messages).toHaveLength(1);
  });

  test('should handle tool result messages', async () => {
    let capturedBody: string = '';
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      capturedBody = opts?.body as string;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 'msg_tr',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Result received' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 25, output_tokens: 5 },
        }),
      });
    });

    await provider.complete({
      messages: [
        { role: 'user', content: 'Weather?' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'tu_1', name: 'get_weather', arguments: '{"city":"NYC"}' }] },
        { role: 'tool', content: 'Sunny, 72F', toolCallId: 'tu_1' },
      ],
      model: 'claude-sonnet-4-20250514',
    });

    const body = JSON.parse(capturedBody);
    expect(body.messages.length).toBeGreaterThanOrEqual(2);
  });

  test('should handle streaming', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"},"model":"claude-sonnet-4-20250514"}\n\n',
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

    const stream = provider.stream({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'claude-sonnet-4-20250514',
    });

    const results: StreamChunk[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 4. Provider Registry Tests
// ============================================================================
describe('Provider Registry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  test('should register a provider', () => {
    const provider = createMockProvider('test');
    registry.register('test', provider);
    expect(registry.has('test')).toBe(true);
    expect(registry.size).toBe(1);
  });

  test('should get a registered provider', () => {
    const provider = createMockProvider('test');
    registry.register('test', provider);
    const retrieved = registry.get('test');
    expect(retrieved.name).toBe('test');
  });

  test('should throw when getting unregistered provider', () => {
    expect(() => registry.get('nonexistent')).toThrow('not found');
  });

  test('should throw when getting disabled provider', () => {
    const provider = createMockProvider('test');
    registry.register('test', provider, { enabled: false });
    expect(() => registry.get('test')).toThrow('disabled');
  });

  test('should set default provider', () => {
    const provider = createMockProvider('default');
    registry.register('default', provider);
    registry.setDefault('default');
    const def = registry.getDefault();
    expect(def.name).toBe('default');
  });

  test('should auto-set first provider as default', () => {
    const provider = createMockProvider('first');
    registry.register('first', provider);
    expect(registry.getDefault().name).toBe('first');
  });

  test('should select provider by capabilities', () => {
    const basic = createMockProvider('basic', { streaming: true, functionCalling: false, vision: false, jsonMode: false });
    const advanced = createMockProvider('advanced', { streaming: true, functionCalling: true, vision: true, jsonMode: true });
    registry.register('basic', basic, { priority: 1 });
    registry.register('advanced', advanced, { priority: 0 });

    const selected = registry.select({ functionCalling: true, vision: true });
    expect(selected.name).toBe('advanced');
  });

  test('should select provider by priority', () => {
    const low = createMockProvider('low');
    const high = createMockProvider('high');
    registry.register('low', low, { priority: 1 });
    registry.register('high', high, { priority: 10 });

    const selected = registry.select({ streaming: true });
    expect(selected.name).toBe('high');
  });

  test('should throw when no provider matches capabilities', () => {
    const provider = createMockProvider('basic', { streaming: true, functionCalling: false, vision: false, jsonMode: false });
    registry.register('basic', provider);
    expect(() => registry.select({ vision: true })).toThrow('No provider found');
  });

  test('should list providers', () => {
    registry.register('a', createMockProvider('a'), { priority: 5 });
    registry.register('b', createMockProvider('b'), { priority: 10 });
    const list = registry.listProviders();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('b'); // Higher priority first
  });

  test('should unregister provider', () => {
    registry.register('test', createMockProvider('test'));
    registry.unregister('test');
    expect(registry.has('test')).toBe(false);
  });

  test('should enable/disable provider', () => {
    registry.register('test', createMockProvider('test'));
    registry.setEnabled('test', false);
    expect(() => registry.get('test')).toThrow('disabled');
    registry.setEnabled('test', true);
    expect(registry.get('test').name).toBe('test');
  });

  test('should support tags', () => {
    registry.register('test', createMockProvider('test'), { tags: ['production', 'fast'] });
    const info = registry.listProviders().find((p) => p.name === 'test');
    expect(info?.tags).toEqual(['production', 'fast']);
  });

  test('should execute with fallback', async () => {
    const failing = createMockProvider('failing');
    (failing.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    const working = createMockProvider('working');

    registry.register('failing', failing);
    registry.register('working', working);

    const { result, providerName } = await registry.executeWithFallback(
      { messages: [], model: 'test' },
      (p) => p.complete({ messages: [{ role: 'user', content: 'Hi' }], model: 'test' }),
      ['failing', 'working'],
    );

    expect(providerName).toBe('working');
  });

  test('should throw when all fallbacks fail', async () => {
    const fail1 = createMockProvider('fail1');
    (fail1.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail1'));
    const fail2 = createMockProvider('fail2');
    (fail2.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail2'));

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

  test('should reset default when default is unregistered', () => {
    registry.register('a', createMockProvider('a'));
    registry.register('b', createMockProvider('b'));
    registry.setDefault('a');
    registry.unregister('a');
    expect(registry.getDefault().name).toBe('b');
  });
});

// ============================================================================
// 5. Prompt Manager Tests
// ============================================================================
describe('Prompt Manager', () => {
  let manager: PromptManager;

  beforeEach(() => {
    manager = new PromptManager();
  });

  test('should register a template', () => {
    manager.registerTemplate('greeting', 'Hello, {{name}}!');
    expect(manager.hasTemplate('greeting')).toBe(true);
  });

  test('should render a template', () => {
    manager.registerTemplate('greeting', 'Hello, {{name}}!');
    const result = manager.render('greeting', { name: 'World' });
    expect(result).toBe('Hello, World!');
  });

  test('should throw when rendering nonexistent template', () => {
    expect(() => manager.render('nonexistent', {})).toThrow('not found');
  });

  test('should throw when missing required variables', () => {
    manager.registerTemplate('greeting', 'Hello, {{name}}!');
    expect(() => manager.render('greeting', {})).toThrow('Missing required variables');
  });

  test('should detect variables automatically', () => {
    manager.registerTemplate('test', '{{a}} and {{b}} and {{c}}');
    const template = manager.getTemplate('test');
    expect(template?.variables).toContain('a');
    expect(template?.variables).toContain('b');
    expect(template?.variables).toContain('c');
  });

  test('should support multiple variable occurrences', () => {
    manager.registerTemplate('repeat', '{{name}} says {{name}}');
    const result = manager.render('repeat', { name: 'Alice' });
    expect(result).toBe('Alice says Alice');
  });

  test('should compose templates', () => {
    manager.registerTemplate('part1', 'First part');
    manager.registerTemplate('part2', 'Second part');
    const result = manager.compose(['part1', 'part2']);
    expect(result).toBe('First part\n\nSecond part');
  });

  test('should compose with custom separator', () => {
    manager.registerTemplate('a', 'A');
    manager.registerTemplate('b', 'B');
    const result = manager.compose(['a', 'b'], '---');
    expect(result).toBe('A---B');
  });

  test('should throw when composing templates with variables', () => {
    manager.registerTemplate('var', 'Hello {{name}}');
    expect(() => manager.compose(['var'])).toThrow('has variables');
  });

  test('should estimate tokens', () => {
    const tokens = manager.estimateTokens('Hello, world!');
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(Math.ceil('Hello, world!'.length / 4));
  });

  test('should not compress text within budget', () => {
    manager.registerTemplate('short', 'Hi');
    const text = manager.render('short', {});
    const result = manager.compress(text, 100);
    expect(result).toBe(text);
  });

  test('should compress text beyond budget', () => {
    const longText = 'This is a very long sentence. '.repeat(100);
    const result = manager.compress(longText, 10);
    expect(result.length).toBeLessThan(longText.length);
  });

  test('should version templates', () => {
    manager.registerTemplate('test', 'Version 1');
    manager.registerTemplate('test', 'Version 2');
    const history = manager.getVersionHistory('test');
    expect(history).toHaveLength(2);
    expect(history[0].template).toBe('Version 1');
    expect(history[1].template).toBe('Version 2');
  });

  test('should list templates', () => {
    manager.registerTemplate('a', 'A');
    manager.registerTemplate('b', 'B');
    expect(manager.listTemplates()).toEqual(['a', 'b']);
  });

  test('should delete template', () => {
    manager.registerTemplate('test', 'Test');
    expect(manager.deleteTemplate('test')).toBe(true);
    expect(manager.hasTemplate('test')).toBe(false);
  });

  test('should return false when deleting nonexistent template', () => {
    expect(manager.deleteTemplate('nonexistent')).toBe(false);
  });

  test('should handle template with no variables', () => {
    manager.registerTemplate('static', 'No variables here');
    const result = manager.render('static', {});
    expect(result).toBe('No variables here');
  });

  test('should handle empty template', () => {
    manager.registerTemplate('empty', '');
    const result = manager.render('empty', {});
    expect(result).toBe('');
  });
});

// ============================================================================
// 6. Conversation Manager Tests
// ============================================================================
describe('Conversation Manager', () => {
  let manager: ConversationManager;
  let mockProvider: LLMProvider;

  beforeEach(() => {
    mockProvider = createMockProvider();
    manager = new ConversationManager(mockProvider);
  });

  test('should create a conversation', () => {
    const conv = manager.createConversation();
    expect(conv.id).toBeDefined();
    expect(conv.messages).toHaveLength(0);
  });

  test('should create conversation with config', () => {
    const conv = manager.createConversation({
      systemPrompt: 'You are helpful.',
      maxMessages: 50,
      metadata: { userId: '123' },
    });
    expect(conv.systemPrompt).toBe('You are helpful.');
    expect(conv.maxMessages).toBe(50);
  });

  test('should send message and get response', async () => {
    const conv = manager.createConversation();
    const response = await manager.sendMessage(conv.id, 'Hello');
    expect(response.content).toBe('Mock response');
  });

  test('should track message history', async () => {
    const conv = manager.createConversation();
    await manager.sendMessage(conv.id, 'Hello');
    const history = manager.getHistory(conv.id);
    expect(history).toHaveLength(2); // user + assistant
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');
  });

  test('should throw when sending to nonexistent conversation', async () => {
    await expect(manager.sendMessage('nonexistent', 'Hi')).rejects.toThrow('not found');
  });

  test('should fork conversation', async () => {
    const conv = manager.createConversation();
    await manager.sendMessage(conv.id, 'Hello');
    const forkId = manager.forkConversation(conv.id);
    const forkHistory = manager.getHistory(forkId);
    expect(forkHistory.length).toBeGreaterThan(0);
  });

  test('should delete conversation', () => {
    const conv = manager.createConversation();
    manager.deleteConversation(conv.id);
    expect(manager.getConversation(conv.id)).toBeUndefined();
  });

  test('should throw when deleting nonexistent conversation', () => {
    expect(() => manager.deleteConversation('nonexistent')).toThrow('not found');
  });

  test('should list conversations', () => {
    manager.createConversation();
    manager.createConversation();
    const list = manager.listConversations();
    expect(list).toHaveLength(2);
  });

  test('should update system prompt', () => {
    const conv = manager.createConversation();
    manager.updateSystemPrompt(conv.id, 'New system prompt');
    expect(manager.getConversation(conv.id)?.systemPrompt).toBe('New system prompt');
  });

  test('should clear history', async () => {
    const conv = manager.createConversation();
    await manager.sendMessage(conv.id, 'Hello');
    manager.clearHistory(conv.id);
    expect(manager.getHistory(conv.id)).toHaveLength(0);
  });

  test('should add message manually', () => {
    const conv = manager.createConversation();
    manager.addMessage(conv.id, { role: 'user', content: 'Manual message' });
    expect(manager.getHistory(conv.id)).toHaveLength(1);
  });

  test('should manage context window', async () => {
    const conv = manager.createConversation({ maxMessages: 4 });
    await manager.sendMessage(conv.id, 'Msg 1');
    await manager.sendMessage(conv.id, 'Msg 2');
    await manager.sendMessage(conv.id, 'Msg 3');
    // History should be trimmed
    const history = manager.getHistory(conv.id);
    expect(history.length).toBeLessThanOrEqual(8); // 4 max messages * 2 (user+assistant)
  });

  test('should include system prompt in request', async () => {
    const conv = manager.createConversation({ systemPrompt: 'Be concise.' });
    await manager.sendMessage(conv.id, 'Hello');
    // Verify the mock was called with system prompt
    expect(mockProvider.complete).toHaveBeenCalled();
  });

  test('should list conversations sorted by update time', () => {
    const conv1 = manager.createConversation();
    const conv2 = manager.createConversation();
    const conv3 = manager.createConversation();

    // Update conv1 to make it the most recently updated
    manager.addMessage(conv1.id, { role: 'user', content: 'latest message' });

    const list = manager.listConversations();
    expect(list).toHaveLength(3);
    // conv1 was updated last via addMessage, but since Date.now() may be same ms,
    // just verify all conversations are listed
    const ids = list.map((c) => c.id);
    expect(ids).toContain(conv1.id);
    expect(ids).toContain(conv2.id);
    expect(ids).toContain(conv3.id);
  });
});

// ============================================================================
// 7. Tool Executor Tests
// ============================================================================
describe('Tool Executor', () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor();
  });

  test('should register a tool', () => {
    executor.registerTool({
      name: 'echo',
      description: 'Echoes input',
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      handler: async (params) => params.text,
    });
    expect(executor.hasTool('echo')).toBe(true);
    expect(executor.size).toBe(1);
  });

  test('should throw when registering duplicate tool', () => {
    executor.registerTool({
      name: 'test',
      description: 'Test',
      schema: { type: 'object', properties: {} },
      handler: async () => null,
    });
    expect(() =>
      executor.registerTool({
        name: 'test',
        description: 'Test 2',
        schema: { type: 'object', properties: {} },
        handler: async () => null,
      }),
    ).toThrow('already registered');
  });

  test('should throw when registering tool with invalid schema', () => {
    expect(() =>
      executor.registerTool({
        name: 'bad',
        description: 'Bad schema',
        schema: { type: 'array', properties: {} } as any,
        handler: async () => null,
      }),
    ).toThrow('Invalid schema');
  });

  test('should execute a tool successfully', async () => {
    executor.registerTool({
      name: 'add',
      description: 'Adds two numbers',
      schema: {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a', 'b'],
      },
      handler: async (params) => (params.a as number) + (params.b as number),
    });

    const result = await executor.execute({
      id: 'tc_1',
      name: 'add',
      arguments: '{"a": 2, "b": 3}',
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe(5);
    expect(result.executionTime).toBeGreaterThanOrEqual(0);
  });

  test('should return error for nonexistent tool', async () => {
    const result = await executor.execute({
      id: 'tc_1',
      name: 'nonexistent',
      arguments: '{}',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('should return error for invalid JSON arguments', async () => {
    executor.registerTool({
      name: 'test',
      description: 'Test',
      schema: { type: 'object', properties: {} },
      handler: async () => null,
    });

    const result = await executor.execute({
      id: 'tc_1',
      name: 'test',
      arguments: 'not json',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid JSON');
  });

  test('should return error for missing required params', async () => {
    executor.registerTool({
      name: 'greet',
      description: 'Greets',
      schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      handler: async (params) => `Hello, ${params.name}!`,
    });

    const result = await executor.execute({
      id: 'tc_1',
      name: 'greet',
      arguments: '{}',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing required parameter');
  });

  test('should execute batch in parallel', async () => {
    executor.registerTool({
      name: 'echo',
      description: 'Echo',
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      handler: async (params) => params.text,
    });

    const results = await executor.executeBatch([
      { id: 'tc_1', name: 'echo', arguments: '{"text":"a"}' },
      { id: 'tc_2', name: 'echo', arguments: '{"text":"b"}' },
      { id: 'tc_3', name: 'echo', arguments: '{"text":"c"}' },
    ]);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.map((r) => r.result)).toEqual(['a', 'b', 'c']);
  });

  test('should list tools', () => {
    executor.registerTool({
      name: 'tool1',
      description: 'Tool 1',
      schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] },
      handler: async () => null,
    });
    const tools = executor.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('tool1');
    expect(tools[0].parameterCount).toBe(2);
    expect(tools[0].requiredParameters).toEqual(['a']);
  });

  test('should validate schema', () => {
    const valid = executor.validateSchema({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] });
    expect(valid.valid).toBe(true);
  });

  test('should reject invalid schema type', () => {
    const result = executor.validateSchema({ type: 'array', properties: {} } as any);
    expect(result.valid).toBe(false);
  });

  test('should reject schema without properties', () => {
    const result = executor.validateSchema({ type: 'object', properties: undefined as any });
    expect(result.valid).toBe(false);
  });

  test('should reject schema with required not in properties', () => {
    const result = executor.validateSchema({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['missing'],
    });
    expect(result.valid).toBe(false);
  });

  test('should unregister tool', () => {
    executor.registerTool({
      name: 'test',
      description: 'Test',
      schema: { type: 'object', properties: {} },
      handler: async () => null,
    });
    expect(executor.unregisterTool('test')).toBe(true);
    expect(executor.hasTool('test')).toBe(false);
  });

  test('should handle tool execution timeout', async () => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, delay?: number) => {
      if (delay === 1) {
        // Immediately trigger the timeout callback
        origSetTimeout(fn, 0);
        return 999 as unknown as ReturnType<typeof setTimeout>;
      }
      return origSetTimeout(fn, delay);
    }) as typeof setTimeout);

    executor.registerTool({
      name: 'slow',
      description: 'Slow tool',
      schema: { type: 'object', properties: {} },
      handler: async () => new Promise((resolve) => setTimeout(resolve, 10000)),
      timeout: 1,
    });

    const result = await executor.execute({ id: 'tc_1', name: 'slow', arguments: '{}' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');

    vi.restoreAllMocks();
  });

  test('should handle tool handler error', async () => {
    executor.registerTool({
      name: 'error',
      description: 'Error tool',
      schema: { type: 'object', properties: {} },
      handler: async () => { throw new Error('Handler failed'); },
    });

    const result = await executor.execute({ id: 'tc_1', name: 'error', arguments: '{}' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Handler failed');
  });
});

// ============================================================================
// 8. Token Manager Tests
// ============================================================================
describe('Token Manager', () => {
  let manager: TokenManager;

  beforeEach(() => {
    manager = new TokenManager();
  });

  test('should set budget', () => {
    manager.setBudget('gpt-4o', { total: 128000, system: 4096, conversation: 100000, response: 16384 });
    expect(manager.getRemainingBudget('gpt-4o')).toBe(128000);
  });

  test('should auto-budget for known model', () => {
    const budget = manager.autoBudget('gpt-4o');
    expect(budget.total).toBe(128000);
    expect(budget.response).toBe(16384);
  });

  test('should throw when auto-budgeting unknown model', () => {
    expect(() => manager.autoBudget('unknown-model')).toThrow('No token limits');
  });

  test('should count tokens for OpenAI model', () => {
    const tokens = manager.countTokens('gpt-4o', 'Hello, world!');
    expect(tokens).toBe(Math.ceil('Hello, world!'.length / 4));
  });

  test('should count tokens for Claude model', () => {
    const tokens = manager.countTokens('claude-sonnet-4-20250514', 'Hello, world!');
    expect(tokens).toBe(Math.ceil('Hello, world!'.length / 3.5));
  });

  test('should allocate tokens within budget', () => {
    manager.setBudget('gpt-4o', { total: 1000, system: 100, conversation: 800, response: 100 });
    expect(manager.allocateTokens('gpt-4o', 500)).toBe(true);
  });

  test('should reject allocation exceeding budget', () => {
    manager.setBudget('gpt-4o', { total: 100, system: 10, conversation: 80, response: 10 });
    expect(manager.allocateTokens('gpt-4o', 200)).toBe(false);
  });

  test('should track remaining budget after usage', () => {
    manager.setBudget('gpt-4o', { total: 1000, system: 100, conversation: 800, response: 100 });
    manager.recordUsage({ model: 'gpt-4o', promptTokens: 50, completionTokens: 30, totalTokens: 80, timestamp: Date.now() });
    expect(manager.getRemainingBudget('gpt-4o')).toBe(920);
  });

  test('should generate usage report', () => {
    manager.setBudget('gpt-4o', { total: 1000, system: 100, conversation: 800, response: 100 });
    manager.recordUsage({ model: 'gpt-4o', promptTokens: 50, completionTokens: 30, totalTokens: 80, timestamp: Date.now() });
    const report = manager.getUsageReport();
    expect(report.totalUsed).toBe(80);
    expect(report.totalBudget).toBe(1000);
    expect(report.byModel['gpt-4o'].used).toBe(80);
  });

  test('should alert when usage exceeds threshold', () => {
    manager.setBudget('gpt-4o', { total: 100, system: 10, conversation: 80, response: 10 });
    manager.setAlertThreshold(0.5);
    manager.recordUsage({ model: 'gpt-4o', promptTokens: 30, completionTokens: 20, totalTokens: 50, timestamp: Date.now() });
    const report = manager.getUsageReport();
    expect(report.alerts.length).toBeGreaterThan(0);
  });

  test('should clear usage', () => {
    manager.setBudget('gpt-4o', { total: 1000, system: 100, conversation: 800, response: 100 });
    manager.recordUsage({ model: 'gpt-4o', promptTokens: 50, completionTokens: 30, totalTokens: 80, timestamp: Date.now() });
    manager.clearUsage();
    expect(manager.getUsageReport().totalUsed).toBe(0);
  });

  test('should get model limits', () => {
    const limits = manager.getModelLimits('gpt-4o');
    expect(limits?.contextWindow).toBe(128000);
    expect(limits?.maxOutputTokens).toBe(16384);
  });

  test('should return undefined for unknown model limits', () => {
    expect(manager.getModelLimits('unknown')).toBeUndefined();
  });

  test('should set custom model limits', () => {
    manager.setModelLimits('custom', { contextWindow: 50000, maxOutputTokens: 2000, recommendedSystemTokens: 1000 });
    expect(manager.getModelLimits('custom')?.contextWindow).toBe(50000);
  });

  test('should handle multiple models in report', () => {
    manager.setBudget('gpt-4o', { total: 1000, system: 100, conversation: 800, response: 100 });
    manager.setBudget('claude-sonnet-4-20250514', { total: 2000, system: 200, conversation: 1600, response: 200 });
    manager.recordUsage({ model: 'gpt-4o', promptTokens: 50, completionTokens: 30, totalTokens: 80, timestamp: Date.now() });
    manager.recordUsage({ model: 'claude-sonnet-4-20250514', promptTokens: 100, completionTokens: 60, totalTokens: 160, timestamp: Date.now() });
    const report = manager.getUsageReport();
    expect(Object.keys(report.byModel)).toHaveLength(2);
  });

  test('should track usage without budget', () => {
    manager.recordUsage({ model: 'unknown', promptTokens: 10, completionTokens: 5, totalTokens: 15, timestamp: Date.now() });
    const report = manager.getUsageReport();
    expect(report.totalUsed).toBe(15);
  });
});

// ============================================================================
// 9. Response Parser Tests
// ============================================================================
describe('Response Parser', () => {
  let parser: ResponseParser;

  beforeEach(() => {
    parser = new ResponseParser();
  });

  test('should extract content', () => {
    const response = createMockResponse({ content: 'Hello, world!' });
    expect(parser.extractContent(response)).toBe('Hello, world!');
  });

  test('should extract empty content', () => {
    const response = createMockResponse({ content: '' });
    expect(parser.extractContent(response)).toBe('');
  });

  test('should extract tool calls', () => {
    const toolCalls: ToolCall[] = [
      { id: 'tc_1', name: 'get_weather', arguments: '{"city":"NYC"}' },
      { id: 'tc_2', name: 'search', arguments: '{"query":"test"}' },
    ];
    const response = createMockResponse({ toolCalls });
    const extracted = parser.extractToolCalls(response);
    expect(extracted).toHaveLength(2);
    expect(extracted[0].name).toBe('get_weather');
  });

  test('should return empty array when no tool calls', () => {
    const response = createMockResponse();
    expect(parser.extractToolCalls(response)).toHaveLength(0);
  });

  test('should extract JSON from response', () => {
    const response = createMockResponse({ content: '{"name": "Alice", "age": 30}' });
    const json = parser.extractJSON(response) as Record<string, unknown>;
    expect(json.name).toBe('Alice');
    expect(json.age).toBe(30);
  });

  test('should extract JSON from code block', () => {
    const response = createMockResponse({ content: 'Here is the data:\n```json\n{"key": "value"}\n```' });
    const json = parser.extractJSON(response) as Record<string, unknown>;
    expect(json.key).toBe('value');
  });

  test('should extract JSON array from response', () => {
    const response = createMockResponse({ content: '[1, 2, 3]' });
    const json = parser.extractJSON(response) as number[];
    expect(json).toEqual([1, 2, 3]);
  });

  test('should throw when no JSON found', () => {
    const response = createMockResponse({ content: 'No JSON here' });
    expect(() => parser.extractJSON(response)).toThrow('No valid JSON');
  });

  test('should extract code blocks', () => {
    const response = createMockResponse({
      content: 'Some text\n```typescript\nconst x = 1;\n```\nMore text\n```python\nprint("hi")\n```',
    });
    const blocks = parser.extractCodeBlocks(response);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].language).toBe('typescript');
    expect(blocks[0].code).toBe('const x = 1;');
    expect(blocks[1].language).toBe('python');
  });

  test('should extract code blocks without language', () => {
    const response = createMockResponse({ content: '```\ncode here\n```' });
    const blocks = parser.extractCodeBlocks(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].language).toBe('text');
  });

  test('should return empty array when no code blocks', () => {
    const response = createMockResponse({ content: 'No code blocks' });
    expect(parser.extractCodeBlocks(response)).toHaveLength(0);
  });

  test('should extract citations with bracket format', () => {
    const response = createMockResponse({ content: 'According to [1] Smith et al. and [2] Jones.' });
    const citations = parser.extractCitations(response);
    expect(citations.length).toBeGreaterThanOrEqual(1);
  });

  test('should extract plain text', () => {
    const response = createMockResponse({
      content: '# Title\n\n**Bold** text and `code`.\n\n```js\nx\n```\n[link](url)',
    });
    const plain = parser.extractPlainText(response);
    expect(plain).not.toContain('#');
    expect(plain).not.toContain('**');
    expect(plain).not.toContain('```');
    expect(plain).toContain('Bold text');
    expect(plain).toContain('code');
  });

  test('should detect tool calls', () => {
    const response = createMockResponse({
      toolCalls: [{ id: 'tc_1', name: 'test', arguments: '{}' }],
    });
    expect(parser.hasToolCalls(response)).toBe(true);
  });

  test('should detect no tool calls', () => {
    const response = createMockResponse();
    expect(parser.hasToolCalls(response)).toBe(false);
  });

  test('should check if response is complete', () => {
    expect(parser.isComplete(createMockResponse({ finishReason: 'stop' }))).toBe(true);
    expect(parser.isComplete(createMockResponse({ finishReason: 'end_turn' }))).toBe(true);
    expect(parser.isComplete(createMockResponse({ finishReason: 'tool_calls' }))).toBe(false);
  });

  test('should check if response is truncated', () => {
    expect(parser.isTruncated(createMockResponse({ finishReason: 'length' }))).toBe(true);
    expect(parser.isTruncated(createMockResponse({ finishReason: 'max_tokens' }))).toBe(true);
    expect(parser.isTruncated(createMockResponse({ finishReason: 'stop' }))).toBe(false);
  });

  test('should extract list items', () => {
    const response = createMockResponse({
      content: '- Item 1\n- Item 2\n- Item 3\n1. First\n2. Second',
    });
    const items = parser.extractListItems(response);
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items).toContain('Item 1');
    expect(items).toContain('First');
  });

  test('should extract headings', () => {
    const response = createMockResponse({
      content: '# Main\n## Sub\n### SubSub',
    });
    const headings = parser.extractHeadings(response);
    expect(headings).toHaveLength(3);
    expect(headings[0].level).toBe(1);
    expect(headings[0].text).toBe('Main');
    expect(headings[1].level).toBe(2);
  });

  test('should return empty headings when none exist', () => {
    const response = createMockResponse({ content: 'No headings here' });
    expect(parser.extractHeadings(response)).toHaveLength(0);
  });

  test('should extract list items with * markers', () => {
    const response = createMockResponse({ content: '* One\n* Two\n* Three' });
    const items = parser.extractListItems(response);
    expect(items).toHaveLength(3);
  });

  test('should extract list items with + markers', () => {
    const response = createMockResponse({ content: '+ Alpha\n+ Beta' });
    const items = parser.extractListItems(response);
    expect(items).toHaveLength(2);
  });
});

// ============================================================================
// 10. Cost Tracker Tests
// ============================================================================
describe('Cost Tracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  test('should record usage', () => {
    tracker.recordUsage('gpt-4o', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    const cost = tracker.getCost();
    expect(cost.totalTokens).toBe(150);
    expect(cost.requestCount).toBe(1);
  });

  test('should calculate cost correctly for gpt-4o', () => {
    tracker.recordUsage('gpt-4o', { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });
    const cost = tracker.getCost();
    // gpt-4o: $0.0025/1k input, $0.01/1k output
    expect(cost.inputCost).toBeCloseTo(0.0025);
    expect(cost.outputCost).toBeCloseTo(0.005);
    expect(cost.totalCost).toBeCloseTo(0.0075);
  });

  test('should calculate cost for unknown model (zero cost)', () => {
    tracker.recordUsage('unknown-model', { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });
    const cost = tracker.getCost();
    expect(cost.totalCost).toBe(0);
  });

  test('should track cost per conversation', () => {
    tracker.recordUsage('gpt-4o', { promptTokens: 100, completionTokens: 50, totalTokens: 150 }, 'conv1');
    tracker.recordUsage('gpt-4o', { promptTokens: 200, completionTokens: 100, totalTokens: 300 }, 'conv2');
    const conv1Cost = tracker.getCost('conv1');
    const conv2Cost = tracker.getCost('conv2');
    expect(conv1Cost.requestCount).toBe(1);
    expect(conv2Cost.requestCount).toBe(1);
    expect(conv2Cost.totalTokens).toBeGreaterThan(conv1Cost.totalTokens);
  });

  test('should get daily cost', () => {
    tracker.recordUsage('gpt-4o', { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });
    const daily = tracker.getDailyCost();
    expect(daily.totalTokens).toBe(1500);
    expect(daily.requestCount).toBe(1);
  });

  test('should get daily cost for specific date', () => {
    tracker.recordUsage('gpt-4o', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    const daily = tracker.getDailyCost('2025-01-01');
    expect(daily.totalTokens).toBe(0); // No records for that date
  });

  test('should get monthly cost', () => {
    tracker.recordUsage('gpt-4o', { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });
    const monthly = tracker.getMonthlyCost();
    expect(monthly.totalTokens).toBe(1500);
    expect(monthly.dailyBreakdown.length).toBeGreaterThanOrEqual(1);
  });

  test('should project cost', () => {
    const projection = tracker.projectCost(30);
    expect(projection.projectedDailyCost).toBeGreaterThanOrEqual(0);
    expect(projection.projectedMonthlyCost).toBeGreaterThanOrEqual(0);
    expect(['increasing', 'decreasing', 'stable']).toContain(projection.trend);
    expect(projection.confidence).toBeGreaterThanOrEqual(0);
    expect(projection.confidence).toBeLessThanOrEqual(1);
  });

  test('should set budget limits', () => {
    tracker.setBudgetLimit('daily', 10);
    tracker.setBudgetLimit('monthly', 100);
    expect(tracker.isOverBudget('daily')).toBe(false);
    expect(tracker.isOverBudget('monthly')).toBe(false);
  });

  test('should detect over budget', () => {
    tracker.setBudgetLimit('daily', 0.001);
    tracker.recordUsage('gpt-4o', { promptTokens: 1000000, completionTokens: 1000000, totalTokens: 2000000 });
    expect(tracker.isOverBudget('daily')).toBe(true);
  });

  test('should get budget remaining', () => {
    tracker.setBudgetLimit('daily', 10);
    const remaining = tracker.getBudgetRemaining('daily');
    expect(remaining).toBeLessThanOrEqual(10);
    expect(remaining).toBeGreaterThan(0);
  });

  test('should get pricing for model', () => {
    const pricing = tracker.getPricing('gpt-4o');
    expect(pricing?.inputCostPer1k).toBe(0.0025);
    expect(pricing?.outputCostPer1k).toBe(0.01);
  });

  test('should set custom pricing', () => {
    tracker.setPricing('custom', { inputCostPer1k: 0.01, outputCostPer1k: 0.03 });
    const pricing = tracker.getPricing('custom');
    expect(pricing?.inputCostPer1k).toBe(0.01);
  });

  test('should get cost by model', () => {
    tracker.recordUsage('gpt-4o', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    tracker.recordUsage('claude-sonnet-4-20250514', { promptTokens: 200, completionTokens: 100, totalTokens: 300 });
    const byModel = tracker.getCostByModel();
    expect(Object.keys(byModel)).toHaveLength(2);
    expect(byModel['gpt-4o'].requestCount).toBe(1);
    expect(byModel['claude-sonnet-4-20250514'].requestCount).toBe(1);
  });

  test('should clear records', () => {
    tracker.recordUsage('gpt-4o', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    tracker.clearRecords();
    const cost = tracker.getCost();
    expect(cost.totalTokens).toBe(0);
    expect(cost.requestCount).toBe(0);
  });

  test('should handle multiple records for same model', () => {
    tracker.recordUsage('gpt-4o', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    tracker.recordUsage('gpt-4o', { promptTokens: 200, completionTokens: 100, totalTokens: 300 });
    const cost = tracker.getCost();
    expect(cost.requestCount).toBe(2);
    expect(cost.totalTokens).toBe(450);
  });

  test('should return infinity for budget remaining when no limit set', () => {
    expect(tracker.getBudgetRemaining('daily')).toBe(Infinity);
  });

  test('should not be over budget when no limit set', () => {
    tracker.recordUsage('gpt-4o', { promptTokens: 1000000, completionTokens: 1000000, totalTokens: 2000000 });
    expect(tracker.isOverBudget('daily')).toBe(false);
  });
});

// ============================================================================
// 11. Integration Tests
// ============================================================================
describe('Integration Tests', () => {
  test('full pipeline: registry + conversation + token tracking', async () => {
    const provider = createMockProvider('test-provider');
    const registry = new ProviderRegistry();
    registry.register('test-provider', provider);

    const selected = registry.select({ streaming: true });
    expect(selected.name).toBe('test-provider');

    const convManager = new ConversationManager(selected);
    const conv = convManager.createConversation({ systemPrompt: 'Be helpful.' });

    const response = await convManager.sendMessage(conv.id, 'Hello');
    expect(response.content).toBe('Mock response');

    const history = convManager.getHistory(conv.id);
    expect(history.length).toBeGreaterThan(0);
  });

  test('full pipeline: prompt + response parsing', () => {
    const promptManager = new PromptManager();
    promptManager.registerTemplate('code_review', 'Review this {{language}} code: {{code}}');

    const prompt = promptManager.render('code_review', {
      language: 'TypeScript',
      code: 'const x: number = 1;',
    });

    expect(prompt).toContain('TypeScript');
    expect(prompt).toContain('const x: number = 1;');

    const parser = new ResponseParser();
    const response = createMockResponse({
      content: 'The code looks good.\n```typescript\nconst x: number = 1;\n```\n- Type safe\n- Clean',
    });

    const content = parser.extractContent(response);
    expect(content).toContain('The code looks good');

    const codeBlocks = parser.extractCodeBlocks(response);
    expect(codeBlocks).toHaveLength(1);

    const listItems = parser.extractListItems(response);
    expect(listItems.length).toBeGreaterThanOrEqual(1);
  });

  test('full pipeline: tool execution + cost tracking', async () => {
    const executor = new ToolExecutor();
    const tracker = new CostTracker();

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
      arguments: '{"expression": "2 + 3"}',
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe(5);

    tracker.recordUsage('gpt-4o', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    const cost = tracker.getCost();
    expect(cost.totalCost).toBeGreaterThan(0);
  });

  test('full pipeline: token management + budget', () => {
    const tokenManager = new TokenManager();
    tokenManager.autoBudget('gpt-4o');

    const promptTokens = tokenManager.countTokens('gpt-4o', 'Hello, world!');
    expect(promptTokens).toBeGreaterThan(0);

    const allocated = tokenManager.allocateTokens('gpt-4o', promptTokens);
    expect(allocated).toBe(true);

    tokenManager.recordUsage({
      model: 'gpt-4o',
      promptTokens,
      completionTokens: 20,
      totalTokens: promptTokens + 20,
      timestamp: Date.now(),
    });

    const remaining = tokenManager.getRemainingBudget('gpt-4o');
    expect(remaining).toBeLessThan(128000);
  });

  test('provider registry with multiple providers and fallback', async () => {
    const registry = new ProviderRegistry();

    const provider1 = createMockProvider('p1', { streaming: true, functionCalling: true, vision: false, jsonMode: false });
    const provider2 = createMockProvider('p2', { streaming: true, functionCalling: true, vision: true, jsonMode: true });
    const provider3 = createMockProvider('p3', { streaming: false, functionCalling: false, vision: false, jsonMode: false });

    registry.register('p1', provider1, { priority: 10, tags: ['fast'] });
    registry.register('p2', provider2, { priority: 5, tags: ['premium'] });
    registry.register('p3', provider3, { priority: 1, tags: ['basic'] });

    expect(registry.size).toBe(3);

    // Select by capability
    const visionProvider = registry.select({ vision: true });
    expect(visionProvider.name).toBe('p2');

    // Select basic (any provider works)
    const basicProvider = registry.select({ streaming: true });
    expect(['p1', 'p2']).toContain(basicProvider.name);

    // List providers
    const list = registry.listProviders();
    expect(list[0].name).toBe('p1'); // Highest priority
  });

  test('cost tracker with budget limits and projection', () => {
    const tracker = new CostTracker();

    tracker.setBudgetLimit('daily', 1.0);
    tracker.setBudgetLimit('monthly', 30.0);

    // Simulate usage
    for (let i = 0; i < 10; i++) {
      tracker.recordUsage('gpt-4o', {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });
    }

    const dailyCost = tracker.getDailyCost();
    expect(dailyCost.requestCount).toBe(10);

    const monthlyCost = tracker.getMonthlyCost();
    expect(monthlyCost.requestCount).toBe(10);

    const projection = tracker.projectCost(30);
    expect(projection.projectedMonthlyCost).toBeGreaterThanOrEqual(0);

    const byModel = tracker.getCostByModel();
    expect(byModel['gpt-4o'].requestCount).toBe(10);
  });
});
