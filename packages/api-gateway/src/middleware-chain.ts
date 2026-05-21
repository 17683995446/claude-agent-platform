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
    let response: ResponseContext = { status: 200 };
    let errorOccurred: Error | null = null;

    // Koa-style middleware dispatch - errors bubble up through the call stack
    const dispatch = async (idx: number): Promise<void> => {
      if (idx >= this.middleware.length) return;

      const mw = this.middleware[idx];
      let calledNext = false;

      const nextFn = async (): Promise<void> => {
        calledNext = true;
        await dispatch(idx + 1);
      };

      await mw(context, nextFn);

      // If next() was never called, short-circuit the chain
      if (!calledNext) {
        // Mark as short-circuited by setting a flag that can be checked by parent calls
        (context as any)._shortCircuited = true;
      }
    };

    try {
      await dispatch(0);
    } catch (error) {
      errorOccurred = error instanceof Error ? error : new Error(String(error));
      if (this.options.onError) {
        this.options.onError(errorOccurred, context);
      }
      response = {
        status: 500,
        body: { error: errorOccurred.message },
      };
    }

    // If middleware set a response on context, use it (for auth failures, etc.)
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
