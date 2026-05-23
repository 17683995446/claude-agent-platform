// src/csrf-protection.ts - CSRF 防护

import { randomBytes } from 'crypto';

export interface CSRFTokenOptions {
  /** Token length in bytes (default: 32) */
  tokenLength?: number;
  /** Token expiry in milliseconds (default: 3600000 = 1 hour) */
  expiryMs?: number;
  /** Character set for token generation */
  charset?: string;
  /** Maximum number of tokens to store (default: 10000) */
  maxTokens?: number;
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
  private maxTokens: number;

  constructor(options?: CSRFTokenOptions) {
    this.tokenLength = options?.tokenLength ?? 32;
    this.expiryMs = options?.expiryMs ?? 3600000;
    this.charset = options?.charset ?? 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    this.maxTokens = options?.maxTokens ?? 10000;
  }

  /**
   * Generate a new CSRF token
   */
  generateToken(): string {
    // Use rejection sampling to avoid modular bias
    const charsetLen = this.charset.length;
    // Calculate the maximum byte value that produces unbiased results
    const maxUnbiased = Math.floor(256 / charsetLen) * charsetLen;
    let token = '';
    while (token.length < this.tokenLength) {
      const bytes = randomBytes(this.tokenLength - token.length + 1); // extra byte for rejection
      for (const byte of bytes) {
        if (byte >= maxUnbiased) continue; // reject biased bytes
        token += this.charset[byte % charsetLen];
        if (token.length >= this.tokenLength) break;
      }
    }

    const csrfToken: CSRFToken = {
      value: token,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.expiryMs,
    };

    // SEC-14: Enforce max token storage to prevent unbounded memory growth
    // FIX: Evict oldest tokens when limit is reached, not just cleanup expired ones
    if (this.tokens.size >= this.maxTokens) {
      // First try to clean up expired tokens
      const cleaned = this.cleanup();
      // If still at limit, evict oldest tokens (FIFO)
      if (this.tokens.size >= this.maxTokens) {
        const tokensToRemove = this.tokens.size - this.maxTokens + 1;
        const keysToRemove = Array.from(this.tokens.keys()).slice(0, tokensToRemove);
        for (const key of keysToRemove) {
          this.tokens.delete(key);
        }
      }
    }
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
    // Do NOT check lengths separately as that leaks length information
    let result = 0;
    // Always compare up to the max length to avoid timing leaks
    const maxLen = Math.max(token.length, expectedToken.length);
    for (let i = 0; i < maxLen; i++) {
      const a = i < token.length ? token.charCodeAt(i) : 0;
      const b = i < expectedToken.length ? expectedToken.charCodeAt(i) : 0;
      result |= a ^ b;
    }

    // Lengths must also match (encoded in the XOR result via padding zeros)
    if (result !== 0 || token.length !== expectedToken.length) {
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
