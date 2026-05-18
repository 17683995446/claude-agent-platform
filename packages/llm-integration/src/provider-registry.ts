// ============================================================================
// Provider Registry - 提供者注册中心
// ============================================================================

import type {
  LLMProvider,
  ProviderCapabilities,
  ModelInfo,
} from './provider-interface.js';

/** 提供者注册选项 */
export interface ProviderOptions {
  priority?: number;
  tags?: string[];
  enabled?: boolean;
}

/** 提供者信息 */
export interface ProviderInfo {
  name: string;
  capabilities: ProviderCapabilities;
  priority: number;
  tags: string[];
  enabled: boolean;
  modelCount?: number;
}

/** 提供者注册条目 */
interface ProviderEntry {
  provider: LLMProvider;
  options: Required<ProviderOptions>;
}

export class ProviderRegistry {
  private providers = new Map<string, ProviderEntry>();
  private defaultName: string | null = null;

  /** 注册一个提供者 */
  register(name: string, provider: LLMProvider, options?: ProviderOptions): void {
    this.providers.set(name, {
      provider,
      options: {
        priority: options?.priority ?? 0,
        tags: options?.tags ?? [],
        enabled: options?.enabled ?? true,
      },
    });

    // 如果是第一个注册的提供者，自动设为默认
    if (this.defaultName === null) {
      this.defaultName = name;
    }
  }

  /** 获取指定名称的提供者 */
  get(name: string): LLMProvider {
    const entry = this.providers.get(name);
    if (!entry) {
      throw new Error(`Provider "${name}" not found`);
    }
    if (!entry.options.enabled) {
      throw new Error(`Provider "${name}" is disabled`);
    }
    return entry.provider;
  }

  /** 根据能力需求选择最佳提供者 */
  select(requirements: Partial<ProviderCapabilities>): LLMProvider {
    const candidates: Array<{ name: string; entry: ProviderEntry; score: number }> = [];

    for (const [name, entry] of this.providers) {
      if (!entry.options.enabled) continue;

      const caps = entry.provider.capabilities;
      let score = entry.options.priority;

      let meetsRequirements = true;
      for (const [key, required] of Object.entries(requirements)) {
        if (required && !caps[key as keyof ProviderCapabilities]) {
          meetsRequirements = false;
          break;
        }
        if (required) score += 1;
      }

      if (meetsRequirements) {
        candidates.push({ name, entry, score });
      }
    }

    if (candidates.length === 0) {
      throw new Error('No provider found matching the required capabilities');
    }

    // 按分数排序，选择最高分
    candidates.sort((a, b) => b.score - a.score);

    // 如果有多个相同分数的候选者，随机选择一个（负载均衡）
    const topScore = candidates[0].score;
    const topCandidates = candidates.filter((c) => c.score === topScore);
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];

    return selected.entry.provider;
  }

  /** 设置默认提供者 */
  setDefault(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider "${name}" not found`);
    }
    this.defaultName = name;
  }

  /** 获取默认提供者 */
  getDefault(): LLMProvider {
    if (!this.defaultName) {
      throw new Error('No default provider set');
    }
    return this.get(this.defaultName);
  }

  /** 列出所有提供者信息 */
  listProviders(): ProviderInfo[] {
    const infos: ProviderInfo[] = [];
    for (const [name, entry] of this.providers) {
      infos.push({
        name,
        capabilities: entry.provider.capabilities,
        priority: entry.options.priority,
        tags: entry.options.tags,
        enabled: entry.options.enabled,
      });
    }
    return infos.sort((a, b) => b.priority - a.priority);
  }

  /** 启用或禁用提供者 */
  setEnabled(name: string, enabled: boolean): void {
    const entry = this.providers.get(name);
    if (!entry) {
      throw new Error(`Provider "${name}" not found`);
    }
    entry.options.enabled = enabled;
  }

  /** 移除提供者 */
  unregister(name: string): void {
    this.providers.delete(name);
    if (this.defaultName === name) {
      const remaining = Array.from(this.providers.keys());
      this.defaultName = remaining.length > 0 ? remaining[0] : null;
    }
  }

  /** 检查提供者是否存在 */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /** 获取提供者数量 */
  get size(): number {
    return this.providers.size;
  }

  /** 创建带回退链的请求执行器 */
  async executeWithFallback(
    request: { messages: unknown[]; model: string },
    executeFn: (provider: LLMProvider) => Promise<unknown>,
    providerNames?: string[],
  ): Promise<{ result: unknown; providerName: string }> {
    const names = providerNames ?? Array.from(this.providers.keys());
    let lastError: Error | undefined;

    for (const name of names) {
      const entry = this.providers.get(name);
      if (!entry || !entry.options.enabled) continue;

      try {
        const result = await executeFn(entry.provider);
        return { result, providerName: name };
      } catch (error) {
        lastError = error as Error;
      }
    }

    throw lastError ?? new Error('No providers available for fallback');
  }
}
