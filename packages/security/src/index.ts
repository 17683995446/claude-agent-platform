// src/index.ts - Export all modules

export { Sandbox, type SandboxOptions, type SandboxResult } from './sandbox.js';
export {
  InputValidator,
  type ValidationResult,
  type ValidationSchema,
  type SanitizationResult,
} from './input-validator.js';
export {
  AuthManager,
  TokenAuthStrategy,
  APIKeyAuthStrategy,
  CertificateAuthStrategy,
  AuditLog,
  type AuthResult,
  type AuthStrategy,
  type User,
  type Role,
  type AccessContext,
  type TokenPayload,
  type AuditLogEntry,
} from './auth-manager.js';
export {
  SecretManager,
  EnvSecretProvider,
  FileSecretProvider,
  MemorySecretProvider,
  type SecretProvider,
  type SecretVersion,
  type SecretReference,
  type SecretCacheEntry,
} from './secret-manager.js';
export {
  AdvancedRateLimiter,
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimitAlgorithm,
  type RateLimitStorage,
} from './rate-limiter.js';
export { CORSGuard, type CORSConfig, type CORSValidationResult } from './cors-guard.js';
export { CSRFProtection, type CSRFTokenOptions, type CSRFToken } from './csrf-protection.js';
export {
  SecurityHeaders,
  type SecurityHeaderConfig,
  type HeaderValidationResult,
} from './security-headers.js';
export {
  DependencyScanner,
  type Severity,
  type Vulnerability,
  type OutdatedPackage,
  type LicenseIssue,
  type DependencyInfo,
  type ScanResult,
  type ScannerOptions,
} from './dependency-scanner.js';
export {
  SecurityAuditLog,
  type AuditEventType,
  type AuditEntry,
  type AuditQuery,
  type AuditStorage,
  type RetentionPolicy,
} from './security-audit.js';
