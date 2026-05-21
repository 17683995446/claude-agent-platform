// src/router.ts - 路由引擎

export interface RouteHandler {
  (params: Record<string, string>, query: Record<string, string>, context: RequestContext): Promise<ResponseContext> | ResponseContext;
}

export interface RouteOptions {
  middleware?: Middleware[];
  priority?: number;
  description?: string;
}

export interface RouteInfo {
  method: string;
  path: string;
  handler: RouteHandler;
  options: RouteOptions;
  paramNames: string[];
  priority: number;
}

export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
  query: Record<string, string>;
  route: RouteInfo;
}

export interface RequestContext {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
  params?: Record<string, string>;
}

export interface ResponseContext {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Middleware = (context: RequestContext, next: () => Promise<void>) => Promise<void>;

interface RouteEntry {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
  options: RouteOptions;
  priority: number;
  originalPath: string;
}

export class Router {
  private routes: RouteEntry[] = [];
  private globalMiddleware: Middleware[] = [];
  private routeCounter = 0;

  get(path: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('GET', path, handler, options);
  }

  post(path: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('POST', path, handler, options);
  }

  put(path: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('PUT', path, handler, options);
  }

  patch(path: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('PATCH', path, handler, options);
  }

  delete(path: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('DELETE', path, handler, options);
  }

  options(path: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('OPTIONS', path, handler, options);
  }

  head(path: string, handler: RouteHandler, options?: RouteOptions): void {
    this.addRoute('HEAD', path, handler, options);
  }

  all(path: string, handler: RouteHandler, options?: RouteOptions): void {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
    for (const method of methods) {
      this.addRoute(method, path, handler, options);
    }
  }

  addRoute(method: string, path: string, handler: RouteHandler, options?: RouteOptions): void {
    const { pattern, paramNames } = this.buildPattern(path);
    this.routeCounter++;
    const entry: RouteEntry = {
      method: method.toUpperCase(),
      pattern,
      paramNames,
      handler,
      options: options || {},
      priority: options?.priority ?? this.routeCounter,
      originalPath: path,
    };
    this.routes.push(entry);
    // Keep routes sorted by priority (lower = higher priority)
    this.routes.sort((a, b) => a.priority - b.priority);
  }

  match(method: string, path: string): RouteMatch | null {
    const [pathname, queryString] = path.split('?');
    const query = this.parseQueryString(queryString || '');

    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      const match = route.pattern.exec(pathname);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
        return {
          handler: route.handler,
          params,
          query,
          route: {
            method: route.method,
            path: route.originalPath,
            handler: route.handler,
            options: route.options,
            paramNames: route.paramNames,
            priority: route.priority,
          },
        };
      }
    }
    return null;
  }

  listRoutes(): RouteInfo[] {
    return this.routes.map((r) => ({
      method: r.method,
      path: r.originalPath,
      handler: r.handler,
      options: r.options,
      paramNames: r.paramNames,
      priority: r.priority,
    }));
  }

  group(prefix: string, middleware: Middleware[], fn: (router: Router) => void): void {
    const subRouter = new Router();
    subRouter.globalMiddleware = [...this.globalMiddleware, ...middleware];
    fn(subRouter);
    for (const route of subRouter.routes) {
      const newPath = prefix + route.originalPath;
      const mergedMiddleware = [...middleware, ...(route.options.middleware || [])];
      this.addRoute(route.method, newPath, route.handler, {
        ...route.options,
        middleware: mergedMiddleware,
      });
    }
  }

  useGlobal(middleware: Middleware): void {
    this.globalMiddleware.push(middleware);
  }

  getGlobalMiddleware(): Middleware[] {
    return [...this.globalMiddleware];
  }

  removeRoute(method: string, path: string): boolean {
    const idx = this.routes.findIndex(
      (r) => r.method === method.toUpperCase() && r.originalPath === path
    );
    if (idx >= 0) {
      this.routes.splice(idx, 1);
      return true;
    }
    return false;
  }

  clear(): void {
    this.routes = [];
    this.globalMiddleware = [];
    this.routeCounter = 0;
  }

  private buildPattern(path: string): { pattern: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    let regexStr = '^';

    // Handle root path specially
    if (path === '/') {
      regexStr += '\/$';
      return { pattern: new RegExp(regexStr), paramNames };
    }

    const segments = path.split('/').filter(Boolean);
    regexStr += '\\/';
    for (const segment of segments) {
      if (segment.startsWith(':')) {
        const paramName = segment.slice(1);
        paramNames.push(paramName);
        regexStr += '([^/]+)\\/';
      } else {
        regexStr += this.escapeRegex(segment) + '\\/';
      }
    }
    // Remove trailing slash unless path ends with /
    if (!path.endsWith('/')) {
      regexStr = regexStr.slice(0, -2);
    }
    regexStr += '$';
    return { pattern: new RegExp(regexStr), paramNames };
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private parseQueryString(qs: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!qs) return result;
    const pairs = qs.split('&');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key) {
        result[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
      }
    }
    return result;
  }
}
