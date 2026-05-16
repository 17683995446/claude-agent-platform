// src/auth-manager.ts - 认证与授权管理

export interface AuthResult {
  success: boolean;
  userId?: string;
  roles?: string[];
  permissions?: string[];
  token?: string;
  refreshToken?: string;
  expiresAt?: number;
  error?: string;
}

export interface AuthStrategy {
  authenticate(credentials: unknown): Promise<AuthResult>;
  name: string;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  roles: string[];
  permissions: string[];
  metadata?: Record<string, unknown>;
  token?: string;
  tokenExpiresAt?: number;
  refreshToken?: string;
}

export interface Role {
  name: string;
  permissions: string[];
  parentRoles?: string[];
  description?: string;
}

export interface AccessContext {
  resource?: string;
  action?: string;
  environment?: string;
  time?: Date;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export interface TokenPayload {
  userId: string;
  roles: string[];
  permissions: string[];
  issuedAt: number;
  expiresAt: number;
  type: 'access' | 'refresh';
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  userId: string;
  action: string;
  resource: string;
  result: 'success' | 'failure';
  details?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

// ============ Built-in Auth Strategies ============

export class TokenAuthStrategy implements AuthStrategy {
  name = 'token';
  private secretKey: string;
  private tokens: Map<string, TokenPayload> = new Map();

  constructor(secretKey: string = 'default-secret-key') {
    this.secretKey = secretKey;
  }

  async authenticate(credentials: unknown): Promise<AuthResult> {
    const { token } = credentials as { token: string };
    if (!token) {
      return { success: false, error: 'Token is required' };
    }

    const payload = this.tokens.get(token);
    if (!payload) {
      return { success: false, error: 'Invalid token' };
    }

    if (payload.expiresAt < Date.now()) {
      this.tokens.delete(token);
      return { success: false, error: 'Token expired' };
    }

    return {
      success: true,
      userId: payload.userId,
      roles: payload.roles,
      permissions: payload.permissions,
      token,
      expiresAt: payload.expiresAt,
    };
  }

  generateToken(userId: string, roles: string[], permissions: string[], expiresInMs: number = 3600000): string {
    const payload: TokenPayload = {
      userId,
      roles,
      permissions,
      issuedAt: Date.now(),
      expiresAt: Date.now() + expiresInMs,
      type: 'access',
    };

    // Simple token generation (in production, use proper JWT)
    const token = `tok_${Buffer.from(JSON.stringify(payload)).toString('base64url')}_${Date.now()}`;
    this.tokens.set(token, payload);
    return token;
  }

  generateRefreshToken(userId: string): string {
    const token = `ref_${Buffer.from(userId).toString('base64url')}_${Date.now()}`;
    return token;
  }

  validateToken(token: string): TokenPayload | null {
    return this.tokens.get(token) ?? null;
  }

  revokeToken(token: string): boolean {
    return this.tokens.delete(token);
  }
}

export class APIKeyAuthStrategy implements AuthStrategy {
  name = 'apikey';
  private apiKeys: Map<string, { userId: string; permissions: string[]; roles: string[] }> = new Map();

  constructor(initialKeys?: Record<string, { userId: string; permissions: string[]; roles: string[] }>) {
    if (initialKeys) {
      for (const [key, value] of Object.entries(initialKeys)) {
        this.apiKeys.set(key, value);
      }
    }
  }

  async authenticate(credentials: unknown): Promise<AuthResult> {
    const { apiKey } = credentials as { apiKey: string };
    if (!apiKey) {
      return { success: false, error: 'API key is required' };
    }

    const keyData = this.apiKeys.get(apiKey);
    if (!keyData) {
      return { success: false, error: 'Invalid API key' };
    }

    return {
      success: true,
      userId: keyData.userId,
      roles: keyData.roles,
      permissions: keyData.permissions,
    };
  }

  registerKey(apiKey: string, userId: string, permissions: string[], roles: string[]): void {
    this.apiKeys.set(apiKey, { userId, permissions, roles });
  }

  revokeKey(apiKey: string): boolean {
    return this.apiKeys.delete(apiKey);
  }
}

export class CertificateAuthStrategy implements AuthStrategy {
  name = 'certificate';
  private certificates: Map<string, { userId: string; permissions: string[]; roles: string[]; fingerprint: string }> = new Map();

  async authenticate(credentials: unknown): Promise<AuthResult> {
    const { cert, fingerprint } = credentials as { cert?: string; fingerprint?: string };
    const id = fingerprint || cert || '';

    const certData = this.certificates.get(id);
    if (!certData) {
      return { success: false, error: 'Certificate not recognized' };
    }

    return {
      success: true,
      userId: certData.userId,
      roles: certData.roles,
      permissions: certData.permissions,
    };
  }

  registerCertificate(fingerprint: string, userId: string, permissions: string[], roles: string[]): void {
    this.certificates.set(fingerprint, { userId, permissions, roles, fingerprint });
  }

  revokeCertificate(fingerprint: string): boolean {
    return this.certificates.delete(fingerprint);
  }
}

// ============ Audit Log ============

export class AuditLog {
  private entries: AuditLogEntry[] = [];
  private listeners: Array<(entry: AuditLogEntry) => void> = [];

  record(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      ...entry,
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
    };
    this.entries.push(fullEntry);
    for (const listener of this.listeners) {
      listener(fullEntry);
    }
    return fullEntry;
  }

  getEntries(filter?: {
    userId?: string;
    action?: string;
    result?: 'success' | 'failure';
    startTime?: number;
    endTime?: number;
  }): AuditLogEntry[] {
    let result = [...this.entries];
    if (filter?.userId) {
      result = result.filter((e) => e.userId === filter.userId);
    }
    if (filter?.action) {
      result = result.filter((e) => e.action === filter.action);
    }
    if (filter?.result) {
      result = result.filter((e) => e.result === filter.result);
    }
    if (filter?.startTime) {
      result = result.filter((e) => e.timestamp >= filter.startTime!);
    }
    if (filter?.endTime) {
      result = result.filter((e) => e.timestamp <= filter.endTime!);
    }
    return result;
  }

  addListener(listener: (entry: AuditLogEntry) => void): void {
    this.listeners.push(listener);
  }

  removeListener(listener: (entry: AuditLogEntry) => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}

// ============ Auth Manager ============

export class AuthManager {
  private strategies: Map<string, AuthStrategy> = new Map();
  private roles: Map<string, Role> = new Map();
  private users: Map<string, User> = new Map();
  private auditLog: AuditLog;
  private defaultStrategy: string | null = null;

  constructor() {
    this.auditLog = new AuditLog();
  }

  /**
   * Register an authentication strategy
   */
  registerStrategy(strategy: AuthStrategy): void {
    this.strategies.set(strategy.name, strategy);
    if (!this.defaultStrategy) {
      this.defaultStrategy = strategy.name;
    }
  }

  /**
   * Set the default authentication strategy
   */
  setDefaultStrategy(name: string): void {
    if (!this.strategies.has(name)) {
      throw new Error(`Strategy "${name}" not found`);
    }
    this.defaultStrategy = name;
  }

  /**
   * Authenticate using a specific strategy or the default
   */
  async authenticate(credentials: unknown, strategyName?: string): Promise<AuthResult> {
    const name = strategyName || this.defaultStrategy;
    if (!name) {
      const error = 'No authentication strategy available';
      this.auditLog.record({
        userId: 'anonymous',
        action: 'authenticate',
        resource: 'auth',
        result: 'failure',
        details: error,
      });
      return { success: false, error };
    }

    const strategy = this.strategies.get(name);
    if (!strategy) {
      const error = `Strategy "${name}" not found`;
      this.auditLog.record({
        userId: 'anonymous',
        action: 'authenticate',
        resource: 'auth',
        result: 'failure',
        details: error,
      });
      return { success: false, error };
    }

    const result = await strategy.authenticate(credentials);
    this.auditLog.record({
      userId: result.userId || 'anonymous',
      action: 'authenticate',
      resource: 'auth',
      result: result.success ? 'success' : 'failure',
      details: result.error,
    });

    return result;
  }

  /**
   * Register a role
   */
  registerRole(role: Role): void {
    this.roles.set(role.name, role);
  }

  /**
   * Get a role by name
   */
  getRole(name: string): Role | undefined {
    return this.roles.get(name);
  }

  /**
   * Register a user
   */
  registerUser(user: User): void {
    this.users.set(user.id, user);
  }

  /**
   * Get a user by ID
   */
  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  /**
   * Check if a user has a specific permission (RBAC)
   */
  checkPermission(user: User, permission: string): boolean {
    // Direct permission check
    if (user.permissions.includes(permission)) {
      return true;
    }

    // Check role permissions (including parent roles)
    for (const roleName of user.roles) {
      if (this.checkRolePermission(roleName, permission, new Set())) {
        return true;
      }
    }

    return false;
  }

  private checkRolePermission(roleName: string, permission: string, visited: Set<string>): boolean {
    if (visited.has(roleName)) return false;
    visited.add(roleName);

    const role = this.roles.get(roleName);
    if (!role) return false;

    if (role.permissions.includes(permission)) {
      return true;
    }

    // Check parent roles
    if (role.parentRoles) {
      for (const parentName of role.parentRoles) {
        if (this.checkRolePermission(parentName, permission, visited)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check access using ABAC (Attribute-Based Access Control)
   */
  checkAccess(user: User, resource: string, action: string, context: AccessContext): boolean {
    // First check RBAC permission
    const permission = `${resource}:${action}`;
    if (!this.checkPermission(user, permission)) {
      return false;
    }

    // Check context-based rules
    if (context.environment && context.environment === 'production') {
      // Production requires explicit production permission
      if (!user.permissions.includes(`${resource}:${action}:production`)) {
        return false;
      }
    }

    if (context.time) {
      const hour = context.time.getHours();
      // Outside business hours requires special permission
      if (hour < 8 || hour > 18) {
        if (!user.permissions.includes(`${resource}:${action}:after-hours`)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Generate an access token
   */
  generateToken(userId: string, expiresInMs: number = 3600000): string | null {
    const user = this.users.get(userId);
    if (!user) return null;

    const tokenStrategy = this.strategies.get('token') as TokenAuthStrategy | undefined;
    if (!tokenStrategy) return null;

    const token = tokenStrategy.generateToken(userId, user.roles, user.permissions, expiresInMs);
    user.token = token;
    user.tokenExpiresAt = Date.now() + expiresInMs;

    this.auditLog.record({
      userId,
      action: 'token_generated',
      resource: 'auth',
      result: 'success',
    });

    return token;
  }

  /**
   * Generate a refresh token
   */
  generateRefreshToken(userId: string): string | null {
    const user = this.users.get(userId);
    if (!user) return null;

    const tokenStrategy = this.strategies.get('token') as TokenAuthStrategy | undefined;
    if (!tokenStrategy) return null;

    const refreshToken = tokenStrategy.generateRefreshToken(userId);
    user.refreshToken = refreshToken;

    return refreshToken;
  }

  /**
   * Validate a token
   */
  validateToken(token: string): TokenPayload | null {
    const tokenStrategy = this.strategies.get('token') as TokenAuthStrategy | undefined;
    if (!tokenStrategy) return null;

    return tokenStrategy.validateToken(token);
  }

  /**
   * Revoke a token
   */
  revokeToken(token: string): boolean {
    const tokenStrategy = this.strategies.get('token') as TokenAuthStrategy | undefined;
    if (!tokenStrategy) return false;

    return tokenStrategy.revokeToken(token);
  }

  /**
   * Get the audit log
   */
  getAuditLog(): AuditLog {
    return this.auditLog;
  }

  /**
   * List all registered strategies
   */
  getStrategies(): string[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * List all registered roles
   */
  getRoles(): string[] {
    return Array.from(this.roles.keys());
  }
}
