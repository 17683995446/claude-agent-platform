// src/auth-middleware.ts - 认证中间件

import type { RequestContext, ResponseContext, Middleware } from './router.ts';

export type { RequestContext, ResponseContext, Middleware };

export type AuthScheme = 'bearer' | 'apikey' | 'basic' | 'jwt';

export interface AuthConfig {
  scheme: AuthScheme;
  tokenLookup?: ('header' | 'query' | 'cookie')[];
  headerName?: string;
  queryParam?: string;
  cookieName?: string;
  realm?: string;
}

export interface AuthUser {
  id: string;
  roles: string[];
  scopes: string[];
  [key: string]: unknown;
}

export interface TokenPayload {
  sub: string;
  roles?: string[];
  scopes?: string[];
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

export interface AuthContext {
  user: AuthUser;
  token: string;
  scheme: AuthScheme;
}

type TokenValidator = (token: string) => TokenPayload | null;
type TokenExtractor = (request: RequestContext, config: AuthConfig) => string | null;

export class AuthMiddleware {
  private tokenValidators: Map<AuthScheme, TokenValidator> = new Map();
  private tokenExtractor: TokenExtractor;

  constructor() {
    this.tokenExtractor = this.defaultTokenExtractor.bind(this);
    // Register default validators
    this.tokenValidators.set('bearer', (token) => this.defaultBearerValidator(token));
    this.tokenValidators.set('apikey', (token) => this.defaultApiKeyValidator(token));
    this.tokenValidators.set('basic', (token) => this.defaultBasicValidator(token));
    this.tokenValidators.set('jwt', (token) => this.defaultJwtValidator(token));
  }

  setTokenValidator(scheme: AuthScheme, validator: TokenValidator): void {
    this.tokenValidators.set(scheme, validator);
  }

  setTokenExtractor(extractor: TokenExtractor): void {
    this.tokenExtractor = extractor;
  }

  authenticate(scheme: AuthScheme, config?: Partial<AuthConfig>): Middleware {
    const fullConfig: AuthConfig = {
      scheme,
      tokenLookup: ['header', 'query', 'cookie'],
      headerName: scheme === 'bearer' || scheme === 'jwt' ? 'Authorization' : scheme === 'apikey' ? 'X-API-Key' : 'Authorization',
      queryParam: scheme === 'apikey' ? 'api_key' : 'token',
      cookieName: scheme === 'bearer' || scheme === 'jwt' ? 'token' : 'auth',
      realm: 'API',
      ...config,
    };

    return async (context: RequestContext, next: () => Promise<void>): Promise<void> => {
      const token = this.tokenExtractor(context, fullConfig);

      if (!token) {
        this.setAuthFailure(context, 401, 'UNAUTHORIZED', 'Authentication token is required', fullConfig.realm);
        return;
      }

      const validator = this.tokenValidators.get(scheme);
      if (!validator) {
        this.setAuthFailure(context, 500, 'INTERNAL_ERROR', `No validator for scheme: ${scheme}`);
        return;
      }

      const payload = validator(token);
      if (!payload) {
        this.setAuthFailure(context, 401, 'UNAUTHORIZED', 'Invalid or expired token', fullConfig.realm);
        return;
      }

      // Check expiration
      if (payload.exp && payload.exp < Date.now() / 1000) {
        this.setAuthFailure(context, 401, 'TOKEN_EXPIRED', 'Token has expired', fullConfig.realm);
        return;
      }

      const user: AuthUser = {
        id: payload.sub,
        roles: payload.roles || [],
        scopes: payload.scopes || [],
        ...payload,
      };

      (context as any)._auth = { user, token, scheme } as AuthContext;
      await next();
    };
  }

  authorize(roles: string[], scope?: string): Middleware {
    return async (context: RequestContext, next: () => Promise<void>): Promise<void> => {
      const auth = (context as any)._auth as AuthContext | undefined;

      if (!auth) {
        this.setAuthFailure(context, 401, 'UNAUTHORIZED', 'Authentication required');
        return;
      }

      // Check roles
      if (roles.length > 0 && !roles.some((role) => auth.user.roles.includes(role))) {
        this.setAuthFailure(context, 403, 'FORBIDDEN', `Required roles: ${roles.join(', ')}`);
        return;
      }

      // Check scope
      if (scope && !auth.user.scopes.includes(scope)) {
        this.setAuthFailure(context, 403, 'FORBIDDEN', `Required scope: ${scope}`);
        return;
      }

      await next();
    };
  }

  createAuthFailureResponse(status: number, code: string, message: string, realm?: string): ResponseContext {
    const headers: Record<string, string> = {};
    if (status === 401 && realm) {
      headers['WWW-Authenticate'] = `Bearer realm="${realm}"`;
    }
    return {
      status,
      body: {
        success: false,
        error: { code, message },
      },
      headers,
    };
  }

  private setAuthFailure(context: RequestContext, status: number, code: string, message: string, realm?: string): void {
    (context as any)._response = this.createAuthFailureResponse(status, code, message, realm);
  }

  private defaultTokenExtractor(request: RequestContext, config: AuthConfig): string | null {
    const lookups = config.tokenLookup || ['header', 'query', 'cookie'];

    for (const lookup of lookups) {
      if (lookup === 'header') {
        const headerName = config.headerName || 'Authorization';
        const headerValue = request.headers[headerName.toLowerCase()];
        if (headerValue) {
          if (config.scheme === 'bearer' || config.scheme === 'jwt') {
            const parts = headerValue.split(' ');
            if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
              return parts[1];
            }
          } else if (config.scheme === 'basic') {
            return headerValue;
          } else {
            return headerValue;
          }
        }
      }

      if (lookup === 'query') {
        const paramName = config.queryParam || 'token';
        const queryValue = request.query?.[paramName];
        if (queryValue) return queryValue;
      }

      if (lookup === 'cookie') {
        const cookieName = config.cookieName || 'token';
        const cookieHeader = request.headers['cookie'] || '';
        const cookies = this.parseCookies(cookieHeader);
        if (cookies[cookieName]) return cookies[cookieName];
      }
    }

    return null;
  }

  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) return cookies;
    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
      const [key, ...rest] = pair.trim().split('=');
      if (key) {
        cookies[key.trim()] = rest.join('=').trim();
      }
    }
    return cookies;
  }

  // Default validators - in production, replace with real validation logic
  private defaultBearerValidator(token: string): TokenPayload | null {
    if (!token || token.length < 10) return null;
    return { sub: 'user_' + token.slice(0, 8), roles: ['user'], scopes: ['read'] };
  }

  private defaultApiKeyValidator(token: string): TokenPayload | null {
    if (!token || !token.startsWith('key_')) return null;
    return { sub: 'client_' + token.slice(4, 12), roles: ['api'], scopes: ['read', 'write'] };
  }

  private defaultBasicValidator(token: string): TokenPayload | null {
    if (!token) return null;
    try {
      const decoded = atob(token);
      const [username] = decoded.split(':');
      return { sub: username, roles: ['user'], scopes: ['read'] };
    } catch {
      return null;
    }
  }

  private defaultJwtValidator(token: string): TokenPayload | null {
    if (!token || token.split('.').length !== 3) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return {
        sub: payload.sub || 'unknown',
        roles: payload.roles || [],
        scopes: payload.scopes || [],
        exp: payload.exp,
        iat: payload.iat,
      };
    } catch {
      return null;
    }
  }
}
