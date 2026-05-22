// ============================================================================
// Module 3: Middleware Pipeline
// ============================================================================

export type MiddlewareType = 'pre-process' | 'post-process' | 'error-handler' | 'transform';

export interface AppContext {
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: unknown;
    query?: Record<string, string>;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body?: unknown;
  };
  state: Record<string, unknown>;
  requestId: string;
  startTime: number;
  error?: Error;
}

export interface AppResult {
  status: number;
  body?: unknown;
  headers: Record<string, string>;
  error?: Error;
}

export interface AppMiddleware {
  name: string;
  type: MiddlewareType;
  priority: number;
  condition?: (context: AppContext) => boolean;
  execute: (context: AppContext, next: () => Promise<AppResult>) => Promise<AppResult>;
}

export class AppMiddlewarePipeline {
  private middlewares: AppMiddleware[] = [];

  use(middleware: AppMiddleware): AppMiddlewarePipeline {
    this.middlewares.push(middleware);
    this.sortMiddlewares();
    return this;
  }

  remove(name: string): boolean {
    const index = this.middlewares.findIndex((m) => m.name === name);
    if (index >= 0) {
      this.middlewares.splice(index, 1);
      return true;
    }
    return false;
  }

  getMiddleware(name: string): AppMiddleware | undefined {
    return this.middlewares.find((m) => m.name === name);
  }

  listMiddlewares(): AppMiddleware[] {
    return [...this.middlewares];
  }

  async execute(context: AppContext): Promise<AppResult> {
    const applicableMiddlewares = this.middlewares.filter(
      (m) => !m.condition || m.condition(context),
    );

    let index = 0;

    const next = async (): Promise<AppResult> => {
      if (index >= applicableMiddlewares.length) {
        return {
          status: 200,
          headers: {},
          body: context.response?.body,
        };
      }

      const middleware = applicableMiddlewares[index++];
      try {
        return await middleware.execute(context, next);
      } catch (error) {
        context.error = error as Error;

        // Find error handler that is NOT the middleware that just failed
        const errorHandler = applicableMiddlewares.find(
          (m) => m.type === 'error-handler' && m.name !== middleware.name && (!m.condition || m.condition(context)),
        );

        if (errorHandler) {
          try {
            return await errorHandler.execute(context, next);
          } catch {
            return {
              status: 500,
              headers: {},
              error: error as Error,
            };
          }
        }

        return {
          status: 500,
          headers: {},
          error: error as Error,
        };
      }
    };

    return next();
  }

  private sortMiddlewares(): void {
    this.middlewares.sort((a, b) => a.priority - b.priority);
  }

  getMiddlewareCount(): number {
    return this.middlewares.length;
  }

  clear(): void {
    this.middlewares = [];
  }
}

export function createLoggingMiddleware(): AppMiddleware {
  return {
    name: 'logging',
    type: 'pre-process',
    priority: 0,
    execute: async (context, next) => {
      const result = await next();
      const duration = Date.now() - context.startTime;
      console.log(
        `[${context.requestId}] ${context.request.method} ${context.request.path} -> ${result.status} (${duration}ms)`,
      );
      return result;
    },
  };
}

export function createTimingMiddleware(): AppMiddleware {
  return {
    name: 'timing',
    type: 'pre-process',
    priority: 1,
    execute: async (context, next) => {
      context.state['_startTime'] = Date.now();
      const result = await next();
      context.state['_duration'] = Date.now() - (context.state['_startTime'] as number);
      return result;
    },
  };
}

export function createRequestIdMiddleware(): AppMiddleware {
  let counter = 0;
  return {
    name: 'request-id',
    type: 'pre-process',
    priority: -10,
    execute: async (context, next) => {
      context.requestId = `req-${++counter}-${Date.now()}`;
      return next();
    },
  };
}

export function createCORSMiddleware(): AppMiddleware {
  return {
    name: 'cors',
    type: 'pre-process',
    priority: -5,
    execute: async (context, next) => {
      context.response = {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      };
      return next();
    },
  };
}

export function createErrorHandlingMiddleware(): AppMiddleware {
  return {
    name: 'error-handler',
    type: 'error-handler',
    priority: 1000,
    execute: async (context, next) => {
      try {
        return await next();
      } catch (error) {
        return {
          status: 500,
          headers: {},
          error: error as Error,
          body: { message: (error as Error).message },
        };
      }
    },
  };
}
