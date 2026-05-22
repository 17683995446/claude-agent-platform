// ============================================================================
// Module 4: Routing System
// ============================================================================

export interface RouteDefinition {
  name: string;
  method: string;
  path: string;
  handler: RouteHandler;
  middleware?: Array<string | RouteMiddleware>;
  metadata?: Record<string, unknown>;
}

export type RouteHandler = (params: RouteParams, query: Record<string, string>, body?: unknown) => unknown | Promise<unknown>;

export type RouteMiddleware = (context: RouteContext, next: () => Promise<unknown>) => Promise<unknown>;

export interface RouteParams {
  [key: string]: string;
}

export interface RouteContext {
  params: RouteParams;
  query: Record<string, string>;
  body?: unknown;
  method: string;
  path: string;
}

export interface RouteMatch {
  route: RouteDefinition;
  params: RouteParams;
  query: Record<string, string>;
}

export interface RouteGroup {
  prefix: string;
  middleware?: Array<string | RouteMiddleware>;
  routes: RouteDefinition[];
}

export class RoutingSystem {
  private routes: RouteDefinition[] = [];
  private groups: RouteGroup[] = [];
  private namedRoutes: Map<string, RouteDefinition> = new Map();

  addRoute(route: RouteDefinition): void {
    // Check for duplicate names
    if (this.namedRoutes.has(route.name)) {
      throw new Error(`Route with name "${route.name}" already exists`);
    }
    this.routes.push(route);
    this.namedRoutes.set(route.name, route);
  }

  addGroup(group: RouteGroup): void {
    // Prefix all routes in the group
    for (const route of group.routes) {
      const prefixedRoute: RouteDefinition = {
        ...route,
        path: group.prefix + route.path,
        middleware: [...(group.middleware ?? []), ...(route.middleware ?? [])],
      };
      this.addRoute(prefixedRoute);
    }
    this.groups.push(group);
  }

  match(method: string, path: string): RouteMatch | null {
    const [pathPart, queryPart] = path.split('?');
    const query: Record<string, string> = {};
    if (queryPart) {
      for (const pair of queryPart.split('&')) {
        if (!pair) continue;
        const eqIndex = pair.indexOf('=');
        if (eqIndex === -1) {
          query[decodeURIComponent(pair)] = '';
        } else {
          const key = pair.slice(0, eqIndex);
          const value = pair.slice(eqIndex + 1);
          if (key) {
            query[decodeURIComponent(key)] = decodeURIComponent(value);
          }
        }
      }
    }

    for (const route of this.routes) {
      if (route.method.toUpperCase() !== method.toUpperCase()) continue;

      const params = this.matchPath(route.path, pathPart);
      if (params !== null) {
        return { route, params, query };
      }
    }

    return null;
  }

  private matchPath(pattern: string, path: string): RouteParams | null {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);

    if (patternParts.length !== pathParts.length) return null;

    const params: RouteParams = {};
    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i]!;
      const pathPart = pathParts[i]!;

      if (patternPart.startsWith(':')) {
        params[patternPart.slice(1)] = pathPart;
      } else if (patternPart !== pathPart) {
        return null;
      }
    }

    return params;
  }

  generateUrl(routeName: string, params: Record<string, string> = {}): string {
    const route = this.namedRoutes.get(routeName);
    if (!route) {
      throw new Error(`Route "${routeName}" not found`);
    }

    let url = route.path;
    for (const [key, value] of Object.entries(params)) {
      url = url.replace(`:${key}`, encodeURIComponent(value));
    }
    return url;
  }

  listRoutes(): RouteDefinition[] {
    return [...this.routes];
  }

  getRoute(name: string): RouteDefinition | undefined {
    return this.namedRoutes.get(name);
  }

  removeRoute(name: string): boolean {
    const route = this.namedRoutes.get(name);
    if (!route) return false;
    this.namedRoutes.delete(name);
    this.routes = this.routes.filter((r) => r.name !== name);
    return true;
  }

  getRouteCount(): number {
    return this.routes.length;
  }

  clear(): void {
    this.routes = [];
    this.groups = [];
    this.namedRoutes.clear();
  }
}
