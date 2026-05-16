// src/middleware-chain.ts - 中间件链

import type { RequestContext, ResponseContext, Middleware } from './router.ts';

export type { RequestContext, ResponseContext, Middleware };

export interface ChainOptions {
  onError?: (error: Error, context: RequestContext) => void;
}

export class MiddlewareChain {
  private middleware: Middleware[] = [];
  private options: ChainOptions;

  constructor(options?: ChainOptions) {
    this.options = options || {};
  }

  use(middleware: Middleware): MiddlewareChain {
    this.middleware.push(middleware);
    return this;
  }

  useConditional(
    condition: (context: RequestContext) => boolean,
    middleware: Middleware
  ): MiddlewareChain {
    const conditionalMiddleware: Middleware = async (context, next) => {
      if (condition(context)) {
        await middleware(context, next);
      } else {
        await next();
      }
    };
    this.middleware.push(conditionalMiddleware);
    return this;
  }

  async execute(context: RequestContext): Promise<ResponseContext> {
    let index = 0;
    let shortCircuited = false;
    let response: ResponseContext = { status: 200 };

    const next = async (): Promise<void> => {
      if (shortCircuited) return;
      if (index >= this.middleware.length) return;

      const currentMiddleware = this.middleware[index];
      index++;

      try {
        await currentMiddleware(context, next);
      } catch (error) {
        if (this.options.onError) {
          this.options.onError(error instanceof Error ? error : new Error(String(error)), context);
        }
        throw error;
      }
    };

    // Wrap next to support short-circuit
    const originalNext = next;
    const wrappedNext = async (): Promise<void> => {
      await originalNext();
    };

    // Create a chain that supports short-circuit via setting response on context
    const executeChain = async () => {
      try {
        await wrappedNext();
      } catch (error) {
        response = {
          status: 500,
          body: { error: error instanceof Error ? error.message : String(error) },
        };
      }
    };

    // We need a different approach for short-circuit
    // Let's use a flag-based approach
    index = 0;
    shortCircuited = false;

    const runMiddleware = async (idx: number): Promise<void> => {
      if (idx >= this.middleware.length || shortCircuited) return;

      const mw = this.middleware[idx];
      let calledNext = false;

      const nextFn = async (): Promise<void> => {
        calledNext = true;
        await runMiddleware(idx + 1);
      };

      try {
        await mw(context, nextFn);
      } catch (error) {
        if (this.options.onError) {
          this.options.onError(error instanceof Error ? error : new Error(String(error)), context);
        }
        throw error;
      }

      // If next() was never called, short-circuit the chain
      if (!calledNext) {
        shortCircuited = true;
      }
    };

    try {
      await runMiddleware(0);
    } catch (error) {
      response = {
        status: 500,
        body: { error: error instanceof Error ? error.message : String(error) },
      };
    }

    // If middleware set a response on context, use it
    if ((context as any)._response) {
      response = (context as any)._response;
    }

    return response;
  }

  shortCircuit(context: RequestContext, response: ResponseContext): void {
    (context as any)._response = response;
  }

  getMiddleware(): Middleware[] {
    return [...this.middleware];
  }

  remove(index: number): boolean {
    if (index >= 0 && index < this.middleware.length) {
      this.middleware.splice(index, 1);
      return true;
    }
    return false;
  }

  clear(): void {
    this.middleware = [];
  }

  get length(): number {
    return this.middleware.length;
  }
}

// Error handling middleware factory
export function errorHandler(
  handler: (error: Error, context: RequestContext) => ResponseContext
): Middleware {
  return async (context: RequestContext, next: () => Promise<void>): Promise<void> => {
    try {
      await next();
    } catch (error) {
      const response = handler(error instanceof Error ? error : new Error(String(error)), context);
      (context as any)._response = response;
    }
  };
}

// Logging middleware factory
export function loggingMiddleware(
  logger?: (message: string) => void
): Middleware {
  const log = logger || console.log;
  return async (context: RequestContext, next: () => Promise<void>): Promise<void> => {
    log(`[${context.method}] ${context.path} - start`);
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    log(`[${context.method}] ${context.path} - ${duration}ms`);
  };
}

// Timing middleware factory
export function timingMiddleware(): Middleware {
  return async (context: RequestContext, next: () => Promise<void>): Promise<void> => {
    const start = Date.now();
    await next();
    (context as any)._timing = Date.now() - start;
  };
}
