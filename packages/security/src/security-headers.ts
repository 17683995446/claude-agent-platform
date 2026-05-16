// src/security-headers.ts - 安全响应头

export interface SecurityHeaderConfig {
  contentSecurityPolicy?: string;
  xContentTypeOptions?: 'nosniff';
  xFrameOptions?: 'DENY' | 'SAMEORIGIN' | 'ALLOW-FROM';
  xXSSProtection?: string;
  strictTransportSecurity?: string;
  referrerPolicy?: ReferrerPolicyValue;
  permissionsPolicy?: string;
  crossOriginOpenerPolicy?: CrossOriginOpenerPolicyValue;
  crossOriginResourcePolicy?: CrossOriginResourcePolicyValue;
  crossOriginEmbedderPolicy?: CrossOriginEmbedderPolicyValue;
  originAgentCluster?: '?' | '1';
  xDNSPrefetchControl?: 'on' | 'off';
  xDownloadOptions?: 'noopen';
  xPermittedCrossDomainPolicies?: 'none' | 'master-only' | 'by-content-type' | 'all';
  additionalHeaders?: Record<string, string>;
}

type ReferrerPolicyValue =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url';

type CrossOriginOpenerPolicyValue = 'unsafe-none' | 'same-origin' | 'same-origin-allow-popups';
type CrossOriginResourcePolicyValue = 'same-site' | 'same-origin' | 'cross-origin';
type CrossOriginEmbedderPolicyValue = 'unsafe-none' | 'require-corp' | 'credentialless';

export interface HeaderValidationResult {
  valid: boolean;
  warnings: string[];
  conflicts: string[];
}

export class SecurityHeaders {
  private config: SecurityHeaderConfig;

  constructor(config?: SecurityHeaderConfig) {
    this.config = config ?? {};
  }

  /**
   * Get all configured security headers
   */
  getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.config.contentSecurityPolicy !== undefined) {
      headers['Content-Security-Policy'] = this.config.contentSecurityPolicy;
    }

    if (this.config.xContentTypeOptions !== undefined) {
      headers['X-Content-Type-Options'] = this.config.xContentTypeOptions;
    }

    if (this.config.xFrameOptions !== undefined) {
      headers['X-Frame-Options'] = this.config.xFrameOptions;
    }

    if (this.config.xXSSProtection !== undefined) {
      headers['X-XSS-Protection'] = this.config.xXSSProtection;
    }

    if (this.config.strictTransportSecurity !== undefined) {
      headers['Strict-Transport-Security'] = this.config.strictTransportSecurity;
    }

    if (this.config.referrerPolicy !== undefined) {
      headers['Referrer-Policy'] = this.config.referrerPolicy;
    }

    if (this.config.permissionsPolicy !== undefined) {
      headers['Permissions-Policy'] = this.config.permissionsPolicy;
    }

    if (this.config.crossOriginOpenerPolicy !== undefined) {
      headers['Cross-Origin-Opener-Policy'] = this.config.crossOriginOpenerPolicy;
    }

    if (this.config.crossOriginResourcePolicy !== undefined) {
      headers['Cross-Origin-Resource-Policy'] = this.config.crossOriginResourcePolicy;
    }

    if (this.config.crossOriginEmbedderPolicy !== undefined) {
      headers['Cross-Origin-Embedder-Policy'] = this.config.crossOriginEmbedderPolicy;
    }

    if (this.config.originAgentCluster !== undefined) {
      headers['Origin-Agent-Cluster'] = this.config.originAgentCluster;
    }

    if (this.config.xDNSPrefetchControl !== undefined) {
      headers['X-DNS-Prefetch-Control'] = this.config.xDNSPrefetchControl;
    }

    if (this.config.xDownloadOptions !== undefined) {
      headers['X-Download-Options'] = this.config.xDownloadOptions;
    }

    if (this.config.xPermittedCrossDomainPolicies !== undefined) {
      headers['X-Permitted-Cross-Domain-Policies'] = this.config.xPermittedCrossDomainPolicies;
    }

    if (this.config.additionalHeaders) {
      for (const [key, value] of Object.entries(this.config.additionalHeaders)) {
        headers[key] = value;
      }
    }

    return headers;
  }

  /**
   * Validate the current header configuration for conflicts
   */
  validate(): HeaderValidationResult {
    const warnings: string[] = [];
    const conflicts: string[] = [];

    // Check for missing HSTS
    if (!this.config.strictTransportSecurity) {
      warnings.push('Strict-Transport-Security is not set; consider enabling it for HTTPS sites');
    }

    // Check for missing CSP
    if (!this.config.contentSecurityPolicy) {
      warnings.push('Content-Security-Policy is not set; this may expose the site to XSS attacks');
    }

    // Check X-Frame-Options vs CSP frame-ancestors
    if (this.config.xFrameOptions && this.config.contentSecurityPolicy?.includes('frame-ancestors')) {
      conflicts.push('Both X-Frame-Options and CSP frame-ancestors are set; browsers will use CSP frame-ancestors');
    }

    // Check X-XSS-Protection vs CSP
    if (this.config.xXSSProtection && this.config.contentSecurityPolicy) {
      warnings.push('X-XSS-Protection is largely unnecessary when Content-Security-Policy is set');
    }

    // Check COEP/COOP compatibility
    if (this.config.crossOriginEmbedderPolicy === 'require-corp' && !this.config.crossOriginOpenerPolicy) {
      warnings.push('Cross-Origin-Embedder-Policy is set but Cross-Origin-Opener-Policy is not; some features may not work correctly');
    }

    // Check for insecure referrer policy
    if (this.config.referrerPolicy === 'unsafe-url' || this.config.referrerPolicy === 'no-referrer-when-downgrade') {
      warnings.push(`Referrer-Policy "${this.config.referrerPolicy}" may leak sensitive information`);
    }

    return {
      valid: conflicts.length === 0,
      warnings,
      conflicts,
    };
  }

  /**
   * Get the current configuration
   */
  getConfig(): Readonly<SecurityHeaderConfig> {
    return { ...this.config };
  }

  /**
   * Update the configuration
   */
  updateConfig(config: Partial<SecurityHeaderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set Content Security Policy
   */
  setContentSecurityPolicy(policy: string): this {
    this.config.contentSecurityPolicy = policy;
    return this;
  }

  /**
   * Strict preset - maximum security
   */
  static strict(): SecurityHeaders {
    return new SecurityHeaders({
      contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      xContentTypeOptions: 'nosniff',
      xFrameOptions: 'DENY',
      xXSSProtection: '0',
      strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
      referrerPolicy: 'no-referrer',
      permissionsPolicy: 'camera=(), microphone=(), geolocation=(), payment=()',
      crossOriginOpenerPolicy: 'same-origin',
      crossOriginResourcePolicy: 'same-origin',
      crossOriginEmbedderPolicy: 'require-corp',
      originAgentCluster: '?1',
      xDNSPrefetchControl: 'off',
      xDownloadOptions: 'noopen',
      xPermittedCrossDomainPolicies: 'none',
    });
  }

  /**
   * Moderate preset - balanced security
   */
  static moderate(): SecurityHeaders {
    return new SecurityHeaders({
      contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' https:; frame-ancestors 'self'",
      xContentTypeOptions: 'nosniff',
      xFrameOptions: 'SAMEORIGIN',
      xXSSProtection: '0',
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      referrerPolicy: 'strict-origin-when-cross-origin',
      permissionsPolicy: 'camera=(self), microphone=(self), geolocation=(self)',
      crossOriginOpenerPolicy: 'same-origin-allow-popups',
      crossOriginResourcePolicy: 'same-site',
      originAgentCluster: '?1',
      xDNSPrefetchControl: 'on',
      xDownloadOptions: 'noopen',
      xPermittedCrossDomainPolicies: 'none',
    });
  }

  /**
   * Permissive preset - development-friendly
   */
  static permissive(): SecurityHeaders {
    return new SecurityHeaders({
      contentSecurityPolicy: "default-src *; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'",
      xContentTypeOptions: 'nosniff',
      xFrameOptions: 'SAMEORIGIN',
      strictTransportSecurity: 'max-age=3600',
      referrerPolicy: 'origin-when-cross-origin',
      permissionsPolicy: 'camera=(), microphone=(), geolocation=()',
    });
  }
}
