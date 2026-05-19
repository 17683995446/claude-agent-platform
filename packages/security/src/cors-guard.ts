// src/cors-guard.ts - CORS 安全防护

export interface CORSConfig {
  /** Allowed origins. Use '*' for all, or array of origins/patterns */
  origins: (string | RegExp)[];
  /** Allowed HTTP methods */
  methods: string[];
  /** Allowed request headers */
  headers: string[];
  /** Headers exposed to the client */
  exposedHeaders?: string[];
  /** Whether credentials are allowed */
  credentials?: boolean;
  /** Max age of preflight cache in seconds */
  maxAge?: number;
  /** Whether to allow private network access */
  allowPrivateNetwork?: boolean;
}

export interface CORSValidationResult {
  allowed: boolean;
  origin: string;
  headers: Record<string, string>;
  error?: string;
}

export class CORSGuard {
  private config: CORSConfig;

  constructor(config?: Partial<CORSConfig>) {
    this.config = {
      origins: config?.origins ?? [],
      methods: config?.methods ?? ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      headers: config?.headers ?? ['Content-Type', 'Authorization', 'X-Requested-With'],
      exposedHeaders: config?.exposedHeaders ?? [],
      credentials: config?.credentials ?? false,
      maxAge: config?.maxAge ?? 86400,
      allowPrivateNetwork: config?.allowPrivateNetwork ?? false,
    };
  }

  /**
   * Validate an origin against the configured whitelist
   */
  validateOrigin(origin: string): boolean {
    if (this.config.origins.length === 0) {
      return false; // Deny all by default
    }

    for (const allowed of this.config.origins) {
      if (allowed === '*') return true;
      if (typeof allowed === 'string' && allowed === origin) return true;
      if (allowed instanceof RegExp && allowed.test(origin)) return true;
    }

    return false;
  }

  /**
   * Get CORS headers for a validated origin
   */
  getCORSHeaders(origin: string): Record<string, string> {
    if (!this.validateOrigin(origin)) {
      return {};
    }

    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': this.config.methods.join(', '),
      'Access-Control-Allow-Headers': this.config.headers.join(', '),
    };

    if (this.config.credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }

    if (this.config.exposedHeaders && this.config.exposedHeaders.length > 0) {
      headers['Access-Control-Expose-Headers'] = this.config.exposedHeaders.join(', ');
    }

    if (this.config.maxAge !== undefined) {
      headers['Access-Control-Max-Age'] = String(this.config.maxAge);
    }

    if (this.config.allowPrivateNetwork) {
      headers['Access-Control-Allow-Private-Network'] = 'true';
    }

    return headers;
  }

  /**
   * Validate a CORS request and return the result
   */
  validateRequest(
    origin: string,
    method: string = 'GET',
    isPreflight: boolean = false
  ): CORSValidationResult {
    if (!origin) {
      return {
        allowed: false,
        origin: '',
        headers: {},
        error: 'Origin header is required',
      };
    }

    if (!this.validateOrigin(origin)) {
      return {
        allowed: false,
        origin,
        headers: {},
        error: `Origin "${origin}" is not allowed`,
      };
    }

    const headers = this.getCORSHeaders(origin);

    // For preflight requests, validate method
    if (isPreflight) {
      if (!this.config.methods.includes(method.toUpperCase())) {
        return {
          allowed: false,
          origin,
          headers,
          error: `Method "${method}" is not allowed`,
        };
      }
    }

    return {
      allowed: true,
      origin,
      headers,
    };
  }

  /**
   * Handle a preflight (OPTIONS) request
   */
  handlePreflight(origin: string, requestMethod: string = 'GET', requestHeaders: string[] = []): CORSValidationResult {
    const result = this.validateRequest(origin, requestMethod, true);

    if (result.allowed) {
      // Add requested headers to allowed headers if they're in the config
      const allowedRequestedHeaders = requestHeaders.filter((h) =>
        this.config.headers.some((ch) => ch.toLowerCase() === h.toLowerCase())
      );
      if (allowedRequestedHeaders.length > 0) {
        result.headers['Access-Control-Allow-Headers'] = this.config.headers.join(', ');
      }
    }

    return result;
  }

  /**
   * Get the current configuration
   */
  getConfig(): Readonly<CORSConfig> {
    return { ...this.config };
  }

  /**
   * Update the configuration
   */
  updateConfig(config: Partial<CORSConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Add an allowed origin
   */
  addOrigin(origin: string | RegExp): void {
    this.config.origins.push(origin);
  }

  /**
   * Remove an allowed origin
   */
  removeOrigin(origin: string | RegExp): boolean {
    const index = this.config.origins.findIndex(
      (o) => o === origin || (o instanceof RegExp && origin instanceof RegExp && o.source === origin.source && o.flags === origin.flags)
    );
    if (index >= 0) {
      this.config.origins.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Create a default-safe configuration (deny all)
   */
  static defaultSafe(): CORSGuard {
    return new CORSGuard({
      origins: [],
      methods: [],
      headers: [],
      credentials: false,
      maxAge: 0,
    });
  }

  /**
   * Create a permissive configuration (allow all)
   * Note: credentials cannot be true when origin is '*', so this uses
   * a permissive RegExp pattern instead.
   */
  static permissive(): CORSGuard {
    return new CORSGuard({
      origins: [/^https?:\/\/.+/],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      headers: ['*'],
      credentials: true,
      maxAge: 86400,
    });
  }

  /**
   * Create a development configuration
   */
  static development(): CORSGuard {
    return new CORSGuard({
      origins: [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Debug'],
      credentials: true,
      maxAge: 3600,
    });
  }
}
