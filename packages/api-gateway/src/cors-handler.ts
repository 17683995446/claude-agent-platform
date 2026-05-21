// src/cors-handler.ts - CORS 处理器

export interface CORSConfig {
  origin: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export interface CORSHeaders {
  'Access-Control-Allow-Origin': string;
  'Access-Control-Allow-Methods'?: string;
  'Access-Control-Allow-Headers'?: string;
  'Access-Control-Expose-Headers'?: string;
  'Access-Control-Allow-Credentials'?: string;
  'Access-Control-Max-Age'?: string;
  'Vary'?: string;
}

export interface IncomingRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  origin?: string;
}

export class CORSHandler {
  private config: CORSConfig;
  private routeConfigs: Map<string, CORSConfig> = new Map();

  constructor(config?: Partial<CORSConfig>) {
    this.config = {
      origin: config?.origin || '*',
      methods: config?.methods || ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
      allowedHeaders: config?.allowedHeaders || ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
      exposedHeaders: config?.exposedHeaders || ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
      credentials: config?.credentials || false,
      maxAge: config?.maxAge || 86400,
    };
  }

  setRouteConfig(route: string, config: CORSConfig): void {
    this.routeConfigs.set(route, config);
  }

  getRouteConfig(route: string): CORSConfig | undefined {
    return this.routeConfigs.get(route);
  }

  removeRouteConfig(route: string): boolean {
    return this.routeConfigs.delete(route);
  }

  handle(request: IncomingRequest, route?: string): CORSHeaders {
    const config = route ? (this.routeConfigs.get(route) || this.config) : this.config;
    const requestOrigin = request.headers['origin'] || request.origin || '';

    const headers: CORSHeaders = {
      'Access-Control-Allow-Origin': this.resolveOrigin(config.origin, requestOrigin),
    };

    if (config.methods && config.methods.length > 0) {
      headers['Access-Control-Allow-Methods'] = config.methods.join(', ');
    }

    if (config.allowedHeaders && config.allowedHeaders.length > 0) {
      headers['Access-Control-Allow-Headers'] = config.allowedHeaders.join(', ');
    }

    if (config.exposedHeaders && config.exposedHeaders.length > 0) {
      headers['Access-Control-Expose-Headers'] = config.exposedHeaders.join(', ');
    }

    if (config.credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }

    if (config.maxAge !== undefined) {
      headers['Access-Control-Max-Age'] = String(config.maxAge);
    }

    // Vary header for dynamic origins
    if (typeof config.origin === 'function' || Array.isArray(config.origin)) {
      headers['Vary'] = 'Origin';
    }

    return headers;
  }

  isPreflight(request: IncomingRequest): boolean {
    return request.method === 'OPTIONS' && !!request.headers['origin'] && !!request.headers['access-control-request-method'];
  }

  isCORSRequest(request: IncomingRequest): boolean {
    const origin = request.headers['origin'];
    if (!origin) return false;

    // Extract host from origin for comparison
    try {
      const originUrl = new URL(origin);
      const originHost = originUrl.host; // e.g., "example.com" or "example.com:8080"
      const requestHost = request.headers['host'];

      // Handle case where host header might include protocol (non-standard but handle gracefully)
      let normalizedRequestHost = requestHost;
      if (requestHost && (requestHost.startsWith('http://') || requestHost.startsWith('https://'))) {
        try {
          normalizedRequestHost = new URL(requestHost).host;
        } catch {
          normalizedRequestHost = requestHost;
        }
      }

      return originHost !== normalizedRequestHost;
    } catch {
      // If URL parsing fails, fall back to direct comparison
      return origin !== request.headers['host'];
    }
  }

  getDefaultConfig(): CORSConfig {
    return { ...this.config };
  }

  updateDefaultConfig(config: Partial<CORSConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private resolveOrigin(origin: string | string[] | ((origin: string) => boolean), requestOrigin: string): string {
    if (origin === '*') return '*';

    if (typeof origin === 'function') {
      return origin(requestOrigin) ? requestOrigin : '';
    }

    if (Array.isArray(origin)) {
      if (origin.includes(requestOrigin)) {
        return requestOrigin;
      }
      // If credentials are not needed, return first origin
      if (!this.config.credentials) {
        return origin[0] || '';
      }
      return requestOrigin;
    }

    return origin;
  }

  static createDefault(): CORSHandler {
    return new CORSHandler();
  }

  static createStrict(allowedOrigins: string[]): CORSHandler {
    return new CORSHandler({
      origin: allowedOrigins,
      credentials: true,
      maxAge: 7200,
    });
  }

  static createPermissive(): CORSHandler {
    return new CORSHandler({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
      allowedHeaders: ['*'],
      exposedHeaders: ['*'],
      credentials: true,
      maxAge: 86400,
    });
  }
}
