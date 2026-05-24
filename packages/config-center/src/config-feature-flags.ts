/**
 * 特性开关模块
 * 支持布尔开关、变体（A/B测试）、渐进式发布和目标规则
 */

export interface FlagContext {
  userId?: string;
  email?: string;
  segment?: string;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FlagConfig {
  type: 'boolean' | 'variant' | 'rollout';
  enabled?: boolean;
  variants?: Record<string, number>; // variant name -> weight (percentage)
  defaultVariant?: string;
  rolloutPercentage?: number;
  rules?: FlagRule[];
  description?: string;
}

export interface FlagRule {
  type: 'segment' | 'user' | 'percentage' | 'date' | 'attribute';
  segment?: string;
  userIds?: string[];
  percentage?: number;
  startDate?: string;
  endDate?: string;
  attributeName?: string;
  attributeValue?: unknown;
  enabled?: boolean;
  variant?: string;
}

export interface FeatureFlag {
  name: string;
  config: FlagConfig;
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
  status: 'active' | 'disabled' | 'archived';
}

export interface FlagStats {
  name: string;
  totalEvaluations: number;
  enabledCount: number;
  disabledCount: number;
  variantDistribution: Record<string, number>;
}

export type FlagChangeCallback = (name: string, oldConfig: FlagConfig | undefined, newConfig: FlagConfig) => void;

/**
 * FeatureFlagManager - 特性开关管理器
 */
export class FeatureFlagManager {
  private flags: Map<string, FeatureFlag> = new Map();
  private stats: Map<string, FlagStats> = new Map();
  private changeCallbacks: FlagChangeCallback[] = [];

  /**
   * 获取特性开关
   */
  getFlag(name: string): FeatureFlag | undefined {
    return this.flags.get(name);
  }

  /**
   * 检查特性是否启用
   */
  isEnabled(name: string, context?: FlagContext): boolean {
    const flag = this.flags.get(name);
    if (!flag || flag.status === 'archived') return false;

    let result: boolean;

    // Check rules first (some rules like 'date' don't require context)
    if (flag.config.rules && flag.config.rules.length > 0) {
      for (const rule of flag.config.rules) {
        // Skip rules that require context if no context provided
        if (!context && (rule.type === 'user' || rule.type === 'segment' || rule.type === 'percentage' || rule.type === 'attribute')) {
          continue;
        }
        const ruleResult = this.evaluateRule(rule, context);
        if (ruleResult.matched) {
          result = ruleResult.enabled ?? flag.enabled ?? false;
          this.recordStat(name, result ? 'enabled' : 'disabled');
          return result;
        }
      }
    }

    if (flag.config.type === 'boolean') {
      result = flag.enabled ?? false;
    } else if (flag.config.type === 'rollout' && context) {
      const hash = this.hashContext(context);
      result = (hash % 100) < (flag.config.rolloutPercentage ?? 0);
    } else {
      result = flag.enabled ?? false;
    }

    this.recordStat(name, result ? 'enabled' : 'disabled');
    return result;
  }

  /**
   * 获取变体（A/B测试）
   */
  getVariant(name: string, context?: FlagContext): string {
    const flag = this.flags.get(name);
    if (!flag || flag.status !== 'active') {
      return flag?.config.defaultVariant || 'control';
    }

    if (flag.config.type !== 'variant') {
      return flag.config.defaultVariant || 'control';
    }

    // Check rules for variant override
    if (flag.config.rules && context) {
      for (const rule of flag.config.rules) {
        const result = this.evaluateRule(rule, context);
        if (result.matched && result.variant) {
          this.recordVariant(name, result.variant);
          return result.variant;
        }
      }
    }

    const variants = flag.config.variants || {};
    const totalWeight = Object.values(variants).reduce((sum, w) => sum + w, 0);

    if (totalWeight === 0) {
      return flag.config.defaultVariant || 'control';
    }

    const hash = context ? this.hashContext(context) : Math.floor(Math.random() * 100);
    let cumulative = 0;

    for (const [variantName, weight] of Object.entries(variants)) {
      cumulative += weight;
      if (hash % 100 < cumulative) {
        this.recordVariant(name, variantName);
        return variantName;
      }
    }

    this.recordVariant(name, flag.config.defaultVariant || 'control');
    return flag.config.defaultVariant || 'control';
  }

  /**
   * 设置特性开关
   */
  setFlag(name: string, config: FlagConfig): void {
    const oldFlag = this.flags.get(name);
    const oldConfig = oldFlag?.config;

    const flag: FeatureFlag = {
      name,
      config,
      createdAt: oldFlag?.createdAt || Date.now(),
      updatedAt: Date.now(),
      enabled: config.enabled ?? true,
      status: 'active',
    };

    this.flags.set(name, flag);

    if (!this.stats.has(name)) {
      this.stats.set(name, {
        name,
        totalEvaluations: 0,
        enabledCount: 0,
        disabledCount: 0,
        variantDistribution: {},
      });
    }

    // Notify change callbacks
    for (const cb of this.changeCallbacks) {
      try {
        cb(name, oldConfig, config);
      } catch {
        // swallow
      }
    }
  }

  /**
   * 获取开关统计
   */
  getFlagStats(name: string): FlagStats | undefined {
    return this.stats.get(name);
  }

  /**
   * 删除特性开关
   */
  removeFlag(name: string): boolean {
    return this.flags.delete(name);
  }

  /**
   * 列出所有特性开关
   */
  listFlags(): FeatureFlag[] {
    return Array.from(this.flags.values());
  }

  /**
   * 启用特性开关
   */
  enableFlag(name: string): void {
    const flag = this.flags.get(name);
    if (flag) {
      flag.enabled = true;
      flag.config.enabled = true;
      flag.updatedAt = Date.now();
    }
  }

  /**
   * 禁用特性开关
   */
  disableFlag(name: string): void {
    const flag = this.flags.get(name);
    if (flag) {
      flag.enabled = false;
      flag.config.enabled = false;
      flag.updatedAt = Date.now();
    }
  }

  /**
   * 归档特性开关
   */
  archiveFlag(name: string): void {
    const flag = this.flags.get(name);
    if (flag) {
      flag.status = 'archived';
      flag.updatedAt = Date.now();
    }
  }

  /**
   * 监听开关变化
   */
  onChange(callback: FlagChangeCallback): () => void {
    this.changeCallbacks.push(callback);
    return () => {
      const idx = this.changeCallbacks.indexOf(callback);
      if (idx !== -1) this.changeCallbacks.splice(idx, 1);
    };
  }

  /**
   * 重置统计
   */
  resetStats(name?: string): void {
    if (name) {
      this.stats.delete(name);
    } else {
      this.stats.clear();
    }
  }

  private evaluateRule(rule: FlagRule, context?: FlagContext): { matched: boolean; enabled?: boolean; variant?: string } {
    switch (rule.type) {
      case 'user':
        if (rule.userIds && context?.userId) {
          return { matched: rule.userIds.includes(context.userId), enabled: rule.enabled, variant: rule.variant };
        }
        return { matched: false };

      case 'segment':
        if (rule.segment && context?.segment) {
          return { matched: context.segment === rule.segment, enabled: rule.enabled, variant: rule.variant };
        }
        return { matched: false };

      case 'percentage': {
        if (!context) return { matched: false };
        const hash = this.hashContext(context);
        const matched = (hash % 100) < (rule.percentage ?? 0);
        return { matched, enabled: rule.enabled, variant: rule.variant };
      }

      case 'date': {
        const now = new Date();
        const start = rule.startDate ? new Date(rule.startDate) : null;
        const end = rule.endDate ? new Date(rule.endDate) : null;
        const matched = (!start || now >= start) && (!end || now <= end);
        return { matched, enabled: rule.enabled, variant: rule.variant };
      }

      case 'attribute': {
        if (rule.attributeName && context?.attributes) {
          const attrValue = context.attributes[rule.attributeName];
          const matched = attrValue === rule.attributeValue;
          return { matched, enabled: rule.enabled, variant: rule.variant };
        }
        return { matched: false };
      }

      default:
        return { matched: false };
    }
  }

  private hashContext(context: FlagContext): number {
    const str = `${context.userId || ''}-${context.segment || ''}-${context.email || ''}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  private recordStat(name: string, result: 'enabled' | 'disabled'): void {
    const stat = this.stats.get(name);
    if (!stat) return;
    stat.totalEvaluations++;
    if (result === 'enabled') stat.enabledCount++;
    else stat.disabledCount++;
  }

  private recordVariant(name: string, variant: string): void {
    const stat = this.stats.get(name);
    if (!stat) return;
    stat.variantDistribution[variant] = (stat.variantDistribution[variant] || 0) + 1;
  }
}
