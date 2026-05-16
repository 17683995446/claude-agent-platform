// src/rate-limiter.ts - API 速率限制

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset: number;
  limit: number;
  retryAfter?: number;
}

interface ClientRecord {
  timestamps: number[];
  limit: number;
}

interface EndpointRecord {
  [endpoint: string]: ClientRecord;
}

export class APIRateLimiter {
  private clients: Map<string, EndpointRecord> = new Map();
  private defaultConfig: RateLimitConfig;
  private endpointConfigs: Map<string, RateLimitConfig> = new Map();
  private clientOverrides: Map<string, RateLimitConfig> = new Map();
  private hits = 0;
  private misses = 0;

  constructor(config?: Partial<RateLimitConfig>) {
    this.defaultConfig = {
      windowMs: config?.windowMs ?? 60000,
      maxRequests: config?.maxRequests ?? 100,
    };
  }

  setDefaultConfig(config: RateLimitConfig): void {
    this.defaultConfig = { ...config };
  }

  setEndpointConfig(endpoint: string, config: RateLimitConfig): void {
    this.endpointConfigs.set(endpoint, { ...config });
  }

  setClientOverride(clientId: string, config: RateLimitConfig): void {
    this.clientOverrides.set(clientId, { ...config });
  }

  checkLimit(clientId: string, endpoint?: string): RateLimitResult {
    const now = Date.now();
    const config = this.getConfig(clientId, endpoint);
    const windowStart = now - config.windowMs;

    if (!this.clients.has(clientId)) {
      this.clients.set(clientId, {});
      this.misses++;
    } else {
      this.hits++;
    }

    const clientData = this.clients.get(clientId)!;
    const key = endpoint || '__global__';

    if (!clientData[key]) {
      clientData[key] = {
        timestamps: [],
        limit: config.maxRequests,
      };
    }

    const record = clientData[key];
    // Clean old timestamps outside the window
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    const remaining = Math.max(0, config.maxRequests - record.timestamps.length);
    const resetTime = record.timestamps.length > 0
      ? Math.ceil((record.timestamps[0] + config.windowMs - now) / 1000)
      : Math.ceil(config.windowMs / 1000);

    if (record.timestamps.length >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        reset: resetTime,
        limit: config.maxRequests,
        retryAfter: resetTime,
      };
    }

    record.timestamps.push(now);

    return {
      allowed: true,
      remaining: remaining - 1,
      reset: resetTime,
      limit: config.maxRequests,
    };
  }

  isAllowed(clientId: string, endpoint?: string): boolean {
    return this.checkLimit(clientId, endpoint).allowed;
  }

  getRateLimitHeaders(clientId: string, endpoint?: string): Record<string, string> {
    const now = Date.now();
    const config = this.getConfig(clientId, endpoint);
    const windowStart = now - config.windowMs;

    const clientData = this.clients.get(clientId);
    const key = endpoint || '__global__';
    const record = clientData?.[key];

    let remaining = config.maxRequests;
    let reset = Math.ceil(config.windowMs / 1000);

    if (record) {
      const validTimestamps = record.timestamps.filter((ts) => ts > windowStart);
      remaining = Math.max(0, config.maxRequests - validTimestamps.length);
      reset = validTimestamps.length > 0
        ? Math.ceil((validTimestamps[0] + config.windowMs - now) / 1000)
        : reset;
    }

    return {
      'X-RateLimit-Limit': String(config.maxRequests),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(reset),
    };
  }

  reset(clientId: string, endpoint?: string): void {
    const clientData = this.clients.get(clientId);
    if (!clientData) return;

    const key = endpoint || '__global__';
    if (endpoint) {
      delete clientData[key];
    } else {
      // Reset all endpoints for this client
      this.clients.delete(clientId);
    }
  }

  resetAll(): void {
    this.clients.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): { totalClients: number; hits: number; misses: number; hitRate: number } {
    const totalClients = this.clients.size;
    const totalChecks = this.hits + this.misses;
    const hitRate = totalChecks > 0 ? this.hits / totalChecks : 0;
    return { totalClients, hits: this.hits, misses: this.misses, hitRate };
  }

  private getConfig(clientId: string, endpoint?: string): RateLimitConfig {
    if (clientId && this.clientOverrides.has(clientId)) {
      return this.clientOverrides.get(clientId)!;
    }
    if (endpoint && this.endpointConfigs.has(endpoint)) {
      return this.endpointConfigs.get(endpoint)!;
    }
    return this.defaultConfig;
  }
}
