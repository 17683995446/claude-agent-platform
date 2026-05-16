// ============================================================================
// @claude-agent/strategy - Strategy Pattern
// ============================================================================

import type { LoggerInterface } from '@claude-agent/types';
import { Logger } from '@claude-agent/logger';

// ---- Strategy Interface ----
export interface IStrategy<TContext, TResult = unknown> {
  readonly name: string;
  canHandle(context: TContext): boolean;
  execute(context: TContext): Promise<TResult>;
}

// ---- Strategy Registry ----
export class StrategyRegistry<TContext, TResult = unknown> {
  private strategies: Map<string, IStrategy<TContext, TResult>> = new Map();
  private defaultStrategy: string | null = null;
  private logger: LoggerInterface;

  constructor(logger?: LoggerInterface) {
    this.logger = logger ?? new Logger();
  }

  register(strategy: IStrategy<TContext, TResult>): void {
    this.strategies.set(strategy.name, strategy);
    this.logger.debug(`Registered strategy: ${strategy.name}`);
  }

  unregister(name: string): void {
    this.strategies.delete(name);
    if (this.defaultStrategy === name) this.defaultStrategy = null;
  }

  setDefault(name: string): void {
    if (!this.strategies.has(name)) throw new Error(`Strategy "${name}" not found`);
    this.defaultStrategy = name;
  }

  get(name: string): IStrategy<TContext, TResult> | undefined {
    return this.strategies.get(name);
  }

  list(): string[] {
    return Array.from(this.strategies.keys());
  }

  has(name: string): boolean {
    return this.strategies.has(name);
  }

  async resolve(context: TContext): Promise<IStrategy<TContext, TResult>> {
    for (const strategy of this.strategies.values()) {
      if (strategy.canHandle(context)) return strategy;
    }
    if (this.defaultStrategy) {
      const defaultStrat = this.strategies.get(this.defaultStrategy);
      if (defaultStrat) return defaultStrat;
    }
    throw new Error('No strategy can handle the given context');
  }

  async execute(context: TContext): Promise<TResult> {
    const strategy = await this.resolve(context);
    this.logger.info(`Executing strategy: ${strategy.name}`);
    return strategy.execute(context);
  }
}

// ---- Composite Strategy ----
export class CompositeStrategy<TContext, TResult = unknown> implements IStrategy<TContext, TResult> {
  readonly name: string;
  private strategies: IStrategy<TContext, TResult>[] = [];
  private mode: 'sequence' | 'parallel' | 'first';

  constructor(name: string, mode: 'sequence' | 'parallel' | 'first' = 'sequence') {
    this.name = name;
    this.mode = mode;
  }

  add(strategy: IStrategy<TContext, TResult>): void {
    this.strategies.push(strategy);
  }

  canHandle(context: TContext): boolean {
    return this.strategies.some(s => s.canHandle(context));
  }

  async execute(context: TContext): Promise<TResult> {
    const applicable = this.strategies.filter(s => s.canHandle(context));
    if (applicable.length === 0) throw new Error('No applicable strategy');

    switch (this.mode) {
      case 'sequence':
        let result: TResult | undefined;
        for (const s of applicable) result = await s.execute(context);
        return result!;
      case 'parallel':
        return Promise.all(applicable.map(s => s.execute(context))) as unknown as TResult;
      case 'first':
        return applicable[0]!.execute(context);
    }
  }
}

// ---- Fallback Strategy ----
export class FallbackStrategy<TContext, TResult = unknown> implements IStrategy<TContext, TResult> {
  readonly name: string;
  private primary: IStrategy<TContext, TResult>;
  private fallback: IStrategy<TContext, TResult>;

  constructor(name: string, primary: IStrategy<TContext, TResult>, fallback: IStrategy<TContext, TResult>) {
    this.name = name;
    this.primary = primary;
    this.fallback = fallback;
  }

  canHandle(context: TContext): boolean {
    return this.primary.canHandle(context) || this.fallback.canHandle(context);
  }

  async execute(context: TContext): Promise<TResult> {
    try {
      if (this.primary.canHandle(context)) {
        return await this.primary.execute(context);
      }
    } catch {
      // Fall through to fallback
    }
    return this.fallback.execute(context);
  }
}

// ---- Context-Aware Strategy ----
export class ContextAwareStrategy<TContext extends { type?: string }, TResult = unknown> implements IStrategy<TContext, TResult> {
  readonly name: string;
  private handler: (context: TContext) => Promise<TResult>;
  private contextType: string;

  constructor(name: string, contextType: string, handler: (context: TContext) => Promise<TResult>) {
    this.name = name;
    this.contextType = contextType;
    this.handler = handler;
  }

  canHandle(context: TContext): boolean {
    return context.type === this.contextType;
  }

  async execute(context: TContext): Promise<TResult> {
    return this.handler(context);
  }
}
