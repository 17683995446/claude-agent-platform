// src/csrf-protection.ts - CSRF 防护

import { randomBytes } from 'crypto';

export interface CSRFTokenOptions {
  /** Token length in bytes (default: 32) */
  tokenLength?: number;
  /** Token expiry in milliseconds (default: 3600000 = 1 hour) */
  expiryMs?: number;
  /** Character set for token generation */
  charset?: string;
}

export interface CSRFToken {
  /** The token value */
  value: string;
  /** When the token was created */
  createdAt: number;
  /** When the token expires */
  expiresAt: number;
}

export class CSRFProtection {
  private tokens: Map<string, CSRFToken> = new Map();
  private tokenLength: number;
  private expiryMs: number;
  private charset: string;

  constructor(options?: CSRFTokenOptions) {
    this.tokenLength = options?.tokenLength ?? 32;
    this.expiryMs = options?.expiryMs ?? 3600000;
    this.charset = options?.charset ?? 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  }

  /**
   * Generate a new CSRF token
   */
  generateToken(): string {
    const bytes = randomBytes(this.tokenLength);
    let token = '';
    for (const byte of bytes) {
      token += this.charset[byte % this.charset.length];
    }

    const csrfToken: CSRFToken = {
      value: token,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.expiryMs,
    };

    this.tokens.set(token, csrfToken);
    return token;
  }

  /**
   * Validate a token against an expected token
   */
  validateToken(token: string, expectedToken: string): boolean {
    if (!token || !expectedToken) {
      return false;
    }

    // Constant-time comparison to prevent timing attacks
    if (token.length !== expectedToken.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < token.length; i++) {
      result |= token.charCodeAt(i) ^ expectedToken.charCodeAt(i);
    }

    if (result !== 0) {
      return false;
    }

    // Check if token exists and hasn't expired
    const storedToken = this.tokens.get(expectedToken);
    if (!storedToken) {
      return false;
    }

    if (storedToken.expiresAt < Date.now()) {
      this.tokens.delete(expectedToken);
      return false;
    }

    return true;
  }

  /**
   * Validate a token without checking against an expected token
   * (checks if the token exists and hasn't expired)
   */
  isValid(token: string): boolean {
    if (!token) return false;

    const storedToken = this.tokens.get(token);
    if (!storedToken) return false;

    if (storedToken.expiresAt < Date.now()) {
      this.tokens.delete(token);
      return false;
    }

    return true;
  }

  /**
   * Generate a token for double-submit cookie pattern
   * Returns the same token to be stored in both cookie and request header/body
   */
  generateDoubleSubmitToken(): string {
    return this.generateToken();
  }

  /**
   * Validate double-submit cookie pattern
   * Compares the token from the cookie with the token from the request
   */
  validateDoubleSubmit(cookieToken: string, requestToken: string): boolean {
    return this.validateToken(cookieToken, requestToken);
  }

  /**
   * Generate a synchronizer token (server-side stored)
   */
  generateSynchronizerToken(): string {
    return this.generateToken();
  }

  /**
   * Validate a synchronizer token
   */
  validateSynchronizerToken(token: string): boolean {
    return this.isValid(token);
  }

  /**
   * Revoke a token
   */
  revokeToken(token: string): boolean {
    return this.tokens.delete(token);
  }

  /**
   * Clean up expired tokens
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, token] of this.tokens) {
      if (token.expiresAt < now) {
        this.tokens.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Get the number of active tokens
   */
  get activeTokenCount(): number {
    return this.tokens.size;
  }

  /**
   * Get token info (for debugging)
   */
  getTokenInfo(token: string): CSRFToken | undefined {
    return this.tokens.get(token);
  }

  /**
   * Clear all tokens
   */
  clear(): void {
    this.tokens.clear();
  }
}
