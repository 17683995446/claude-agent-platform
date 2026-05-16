// ============================================================================
// @claude-agent/middleware - Middleware System
// ============================================================================

import type { LoggerInterface } from '@claude-agent/types';
import { Logger } from '@claude-agent/logger';

// ---- Context ----
export interface MiddlewareContext {
  request: Request;
  response: Response;
  state: Map<string, unknown>;
  startTime: number;
  logger: LoggerInterface;
}

// ---- Middleware Definition ----
export type Middleware = (
  context: MiddlewareContext,
  next: () => Promise<void>,
) => Promise<void>;

// ---- Middleware Pipeline ----
export class MiddlewarePipeline {
  private middlewares: Middleware[] = [];

  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  remove(predicate: (mw: Middleware) => boolean): this {
    this.middlewares = this.middlewares.filter(mw => !predicate(mw));
    return this;
  }

  async execute(request: Request, response?: Response): Promise<MiddlewareContext> {
    const context: MiddlewareContext = {
      request,
      response: response ?? new Response(),
      state: new Map(),
      startTime: Date.now(),
      logger: new Logger({ level: 'info' }),
    };

    let index = 0;
    const next = async (): Promise<void> => {
      if (index < this.middlewares.length) {
        const mw = this.middlewares[index++]!;
        await mw(context, next);
      }
    };

    await next();
    return context;
  }

  get length(): number {
    return this.middlewares.length;
  }
}

// ---- Built-in Middlewares ----

/** Request logging middleware */
export function loggingMiddleware(logger?: LoggerInterface): Middleware {
  const log = logger ?? new Logger();
  return async (ctx, next) => {
    log.info(`-> ${ctx.request.method} ${ctx.request.url}`);
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    log.info(`<- ${ctx.request.method} ${ctx.request.url} [${duration}ms]`);
  };
}

/** Error handling middleware */
export function errorHandlingMiddleware(options?: {
  onError?: (error: Error, ctx: MiddlewareContext) => void;
}): Middleware {
  return async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      ctx.state.set('error', err);
      options?.onError?.(err, ctx);
      ctx.logger.error('Middleware error', { message: err.message, stack: err.stack });
    }
  };
}

/** Timing middleware */
export function timingMiddleware(): Middleware {
  return async (ctx, next) => {
    const start = Date.now();
    await next();
    ctx.state.set('duration', Date.now() - start);
  };
}

/** Authentication middleware */
export function authMiddleware(options: {
  validateToken: (token: string) => Promise<boolean>;
  headerName?: string;
}): Middleware {
  const headerName = options.headerName ?? 'Authorization';
  return async (ctx, next) => {
    const authHeader = ctx.request.headers.get(headerName);
    if (!authHeader) {
      ctx.state.set('authenticated', false);
      return;
    }
    const token = authHeader.replace('Bearer ', '');
    const isValid = await options.validateToken(token);
    ctx.state.set('authenticated', isValid);
    if (isValid) {
      await next();
    }
  };
}

/** CORS middleware */
export function corsMiddleware(origins: string[] = ['*']): Middleware {
  return async (ctx, next) => {
    const origin = ctx.request.headers.get('Origin') ?? '*';
    const allowed = origins.includes('*') || origins.includes(origin);
    if (allowed) {
      ctx.state.set('cors.origin', origin);
    }
    await next();
  };
}

/** Rate limiting middleware */
export function rateLimitMiddleware(options: {
  windowMs: number;
  maxRequests: number;
}): Middleware {
  const requests = new Map<string, { count: number; resetTime: number }>();
  return async (ctx, next) => {
    const key = ctx.request.headers.get('x-forwarded-for') ?? 'unknown';
    const now = Date.now();
    let entry = requests.get(key);
    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + options.windowMs };
      requests.set(key, entry);
    }
    entry.count++;
    ctx.state.set('rateLimit.remaining', Math.max(0, options.maxRequests - entry.count));
    ctx.state.set('rateLimit.limit', options.maxRequests);
    if (entry.count > options.maxRequests) {
      ctx.state.set('rateLimit.limited', true);
      return;
    }
    await next();
  };
}

/** Request ID middleware */
export function requestIdMiddleware(): Middleware {
  let counter = 0;
  return async (ctx, next) => {
    counter++;
    const id = `req-${Date.now().toString(36)}-${counter.toString(36).padStart(4, '0')}`;
    ctx.state.set('requestId', id);
    await next();
  };
}

/** State propagation middleware */
export function stateMiddleware(defaults: Record<string, unknown> = {}): Middleware {
  return async (ctx, next) => {
    for (const [key, value] of Object.entries(defaults)) {
      if (!ctx.state.has(key)) ctx.state.set(key, value);
    }
    await next();
  };
}
