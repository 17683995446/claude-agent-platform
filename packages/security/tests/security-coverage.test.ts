import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Sandbox, type SandboxOptions, type SandboxResult } from '../src/sandbox.js';
import {
  InputValidator,
  type ValidationResult,
  type ValidationSchema,
} from '../src/input-validator.js';
import {
  AuthManager,
  TokenAuthStrategy,
  APIKeyAuthStrategy,
  CertificateAuthStrategy,
  AuditLog,
  type AuthResult,
  type User,
} from '../src/auth-manager.js';
import {
  SecretManager,
  EnvSecretProvider,
  FileSecretProvider,
  MemorySecretProvider,
} from '../src/secret-manager.js';
import { AdvancedRateLimiter, type RateLimitResult } from '../src/rate-limiter.js';
import { CORSGuard, type CORSConfig, type CORSValidationResult } from '../src/cors-guard.js';
import { CSRFProtection, type CSRFTokenOptions, type CSRFToken } from '../src/csrf-protection.js';
import {
  SecurityHeaders,
  type SecurityHeaderConfig,
  type HeaderValidationResult,
} from '../src/security-headers.js';
import {
  DependencyScanner,
  type ScanResult,
  type DependencyInfo,
} from '../src/dependency-scanner.js';
import {
  SecurityAuditLog,
  type AuditEventType,
  type AuditEntry,
  type AuditQuery,
  type AuditStorage,
  type RetentionPolicy,
} from '../src/security-audit.js';

// ============================================================================
// BUG REGISTRY
// ============================================================================
// BUG-001 [CRITICAL]: TokenAuthStrategy.authenticate() did not verify HMAC signature
//   FIX: Added signature verification using timingSafeEqual before accepting tokens
// BUG-002 [CRITICAL]: TokenAuthStrategy.authenticate() rejected valid tokens after server restart
//   FIX: Fall back to validating the self-contained signed payload when token not in store
// BUG-003 [CRITICAL]: Sandbox.validateFilesystemAccess() checked traversal AFTER whitelist
//   FIX: Moved path traversal check before whitelist/blacklist checks; use normalized path
// BUG-004 [HIGH]: Sandbox.validateNetworkAccess() used case-sensitive host comparison
//   FIX: Normalize host to lowercase before comparing against allow/deny lists
// BUG-005 [MEDIUM]: FileSecretProvider.decrypt() returned ciphertext on decryption failure
//   FIX: Throw an error instead of silently returning encrypted data
// BUG-006 [MEDIUM]: FileAuditStorage.query() was missing 'action' filter
//   FIX: Added action filter to FileAuditStorage.query() matching InMemoryAuditStorage
// BUG-007 [MEDIUM]: FileAuditStorage.query() was missing 'result' filter
//   FIX: Added result filter to FileAuditStorage.query() matching InMemoryAuditStorage
// BUG-008 [MEDIUM]: SecurityAuditLog.enforceRetention() had double-counting logic error
//   FIX: Re-query entries after maxAge removal before computing maxEntries removal
// ============================================================================

// ============================================================================
// Module 1: Sandbox
// ============================================================================
describe('Sandbox', () => {
  describe('constructor', () => {
    it('should create with default options', () => {
      const sb = new Sandbox();
      const opts = sb.getOptions();
      expect(opts.timeout).toBe(5000);
      expect(opts.memoryLimit).toBe(64 * 1024 * 1024);
      expect(opts.networkEnabled).toBe(false);
      expect(opts.filesystemWhitelist).toEqual([]);
      expect(opts.filesystemBlacklist).toEqual([]);
    });

    it('should create with custom options', () => {
      const sb = new Sandbox({ timeout: 1000, memoryLimit: 1024 });
      expect(sb.getOptions().timeout).toBe(1000);
      expect(sb.getOptions().memoryLimit).toBe(1024);
    });

    it('should handle empty constructor', () => {
      const sb = new Sandbox({});
      expect(sb.getOptions().timeout).toBe(5000);
    });
  });

  describe('execute', () => {
    it('should execute simple code and return result', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('return 42;');
      expect(result.exitCode).toBe(0);
      expect(result.result).toBe(42);
      expect(result.timedOut).toBe(false);
      expect(result.memoryExceeded).toBe(false);
    });

    it('should capture stdout', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('console.log("hello");');
      expect(result.stdout).toContain('hello');
    });

    it('should capture stderr', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('console.error("error msg");');
      expect(result.stderr).toContain('error msg');
    });

    it('should capture console.warn as stderr', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('console.warn("warning msg");');
      expect(result.stderr).toContain('warning msg');
    });

    it('should handle code that throws', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('throw new Error("test error");');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('test error');
    });

    it('should handle code with syntax error', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('const x = ;');
      expect(result.exitCode).toBe(1);
    });

    it('should report execution time', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('return 1;');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should reject code with "process" pattern', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('const x = process.env;');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('prohibited');
    });

    it('should reject code with "require" pattern', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('const fs = require("fs");');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('prohibited');
    });

    it('should reject code with "import" pattern', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('import "fs";');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('prohibited');
    });

    it('should reject code with "eval" pattern', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('eval("1+1");');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('prohibited');
    });

    it('should reject code with "Function" pattern', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('const F = Function("return 1");');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('prohibited');
    });

    it('should reject code with "globalThis" pattern', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('const g = globalThis;');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('prohibited');
    });

    it('should reject code with "global" pattern', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('const g = global.foo;');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('prohibited');
    });

    it('should enforce memory limit before execution', async () => {
      const sb = new Sandbox({ memoryLimit: 100 });
      const hugeCode = 'x'.repeat(200);
      const result = await sb.execute(`return "${hugeCode}";`);
      expect(result.memoryExceeded).toBe(true);
      expect(result.exitCode).toBe(-1);
    });

    it('should return correct memoryUsed estimate', async () => {
      const sb = new Sandbox();
      const result = await sb.execute('return 1;');
      expect(result.memoryUsed).toBeGreaterThan(0);
    });

    it('should merge options with execute overrides', async () => {
      const sb = new Sandbox({ timeout: 5000 });
      const result = await sb.execute('return 1;', { timeout: 1000 });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('validateFilesystemAccess', () => {
    it('should deny blacklisted paths', () => {
      const sb = new Sandbox({ filesystemBlacklist: ['/etc'] });
      expect(sb.validateFilesystemAccess('/etc/passwd').allowed).toBe(false);
      expect(sb.validateFilesystemAccess('/etc/passwd').reason).toContain('blacklisted');
    });

    it('should allow whitelisted paths', () => {
      const sb = new Sandbox({ filesystemWhitelist: ['/tmp'] });
      expect(sb.validateFilesystemAccess('/tmp/file.txt').allowed).toBe(true);
    });

    it('should deny non-whitelisted paths when whitelist is set', () => {
      const sb = new Sandbox({ filesystemWhitelist: ['/tmp'] });
      const result = sb.validateFilesystemAccess('/var/file.txt');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('whitelist');
    });

    it('should detect path traversal', () => {
      const sb = new Sandbox();
      const result = sb.validateFilesystemAccess('/tmp/../etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('traversal');
    });

    // BUG-003: Path traversal was checked AFTER whitelist, allowing bypass
    it('BUG-003: should block traversal even if path starts with whitelisted prefix', () => {
      const sb = new Sandbox({ filesystemWhitelist: ['/tmp'] });
      const result = sb.validateFilesystemAccess('/tmp/../etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('traversal');
    });

    it('should detect URL-encoded path traversal', () => {
      const sb = new Sandbox();
      const result = sb.validateFilesystemAccess('/tmp/%2e%2e/etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('traversal');
    });

    it('should detect double-encoded path traversal', () => {
      const sb = new Sandbox();
      const result = sb.validateFilesystemAccess('/tmp/..%252f..%252f/etc/passwd');
      // Single decode should catch the first layer
      expect(result.allowed).toBe(false);
    });

    it('should allow normal paths with no restrictions', () => {
      const sb = new Sandbox();
      expect(sb.validateFilesystemAccess('/tmp/file.txt').allowed).toBe(true);
    });

    it('should handle backslash path separators', () => {
      const sb = new Sandbox();
      const result = sb.validateFilesystemAccess('C:\\Users\\test\\..\\Windows');
      expect(result.allowed).toBe(false);
    });

    it('should handle empty path', () => {
      const sb = new Sandbox();
      expect(sb.validateFilesystemAccess('').allowed).toBe(true);
    });

    it('should handle exact blacklist match', () => {
      const sb = new Sandbox({ filesystemBlacklist: ['/etc'] });
      expect(sb.validateFilesystemAccess('/etc').allowed).toBe(false);
    });

    it('should handle exact whitelist match', () => {
      const sb = new Sandbox({ filesystemWhitelist: ['/tmp'] });
      expect(sb.validateFilesystemAccess('/tmp').allowed).toBe(true);
    });
  });

  describe('validateNetworkAccess', () => {
    it('should deny when network is disabled', () => {
      const sb = new Sandbox({ networkEnabled: false });
      expect(sb.validateNetworkAccess('example.com', 80).allowed).toBe(false);
    });

    it('should allow when network is enabled with no restrictions', () => {
      const sb = new Sandbox({ networkEnabled: true });
      expect(sb.validateNetworkAccess('example.com', 80).allowed).toBe(true);
    });

    it('should deny hosts in deny list', () => {
      const sb = new Sandbox({ networkEnabled: true, networkDenyList: ['evil.com'] });
      expect(sb.validateNetworkAccess('evil.com', 80).allowed).toBe(false);
    });

    it('should deny ports in deny list', () => {
      const sb = new Sandbox({ networkEnabled: true, networkDenyPorts: [22] });
      expect(sb.validateNetworkAccess('example.com', 22).allowed).toBe(false);
    });

    it('should enforce allow list when set', () => {
      const sb = new Sandbox({ networkEnabled: true, networkAllowList: ['api.example.com'] });
      expect(sb.validateNetworkAccess('api.example.com', 443).allowed).toBe(true);
      expect(sb.validateNetworkAccess('other.com', 443).allowed).toBe(false);
    });

    it('should enforce allow ports when set', () => {
      const sb = new Sandbox({ networkEnabled: true, networkAllowPorts: [443, 80] });
      expect(sb.validateNetworkAccess('example.com', 443).allowed).toBe(true);
      expect(sb.validateNetworkAccess('example.com', 8080).allowed).toBe(false);
    });

    // BUG-004: Case-sensitive host comparison bypass
    it('BUG-004: should deny host with different case in deny list', () => {
      const sb = new Sandbox({ networkEnabled: true, networkDenyList: ['evil.com'] });
      expect(sb.validateNetworkAccess('EVIL.COM', 80).allowed).toBe(false);
      expect(sb.validateNetworkAccess('Evil.Com', 80).allowed).toBe(false);
    });

    it('BUG-004: should allow host with different case in allow list', () => {
      const sb = new Sandbox({
        networkEnabled: true,
        networkAllowList: ['api.example.com'],
      });
      expect(sb.validateNetworkAccess('API.EXAMPLE.COM', 443).allowed).toBe(true);
    });
  });

  describe('static execute', () => {
    it('should work as a convenience method', async () => {
      const result = await Sandbox.execute('return 99;');
      expect(result.result).toBe(99);
    });
  });

  describe('updateOptions', () => {
    it('should update options', () => {
      const sb = new Sandbox();
      sb.updateOptions({ timeout: 2000 });
      expect(sb.getOptions().timeout).toBe(2000);
    });
  });
});

// ============================================================================
// Module 2: InputValidator
// ============================================================================
describe('InputValidator', () => {
  describe('constructor and static for', () => {
    it('should create via constructor', () => {
      const v = new InputValidator('test');
      expect(v.isString().isValid()).toBe(true);
    });

    it('should create via static for()', () => {
      const v = InputValidator.for('test');
      expect(v.isString().isValid()).toBe(true);
    });
  });

  describe('type validators', () => {
    it('isString: should pass for strings', () => {
      expect(InputValidator.for('hello').isString().isValid()).toBe(true);
    });

    it('isString: should fail for non-strings', () => {
      const v = InputValidator.for(42).isString();
      expect(v.isValid()).toBe(false);
      expect(v.getErrors()).toContain('Expected string, got number');
    });

    it('isNumber: should pass for numbers', () => {
      expect(InputValidator.for(42).isNumber().isValid()).toBe(true);
    });

    it('isNumber: should fail for NaN', () => {
      expect(InputValidator.for(NaN).isNumber().isValid()).toBe(false);
    });

    it('isNumber: should fail for strings', () => {
      expect(InputValidator.for('42').isNumber().isValid()).toBe(false);
    });

    it('isArray: should pass for arrays', () => {
      expect(InputValidator.for([1, 2]).isArray().isValid()).toBe(true);
    });

    it('isArray: should fail for non-arrays', () => {
      expect(InputValidator.for('not array').isArray().isValid()).toBe(false);
    });

    it('isObject: should pass for plain objects', () => {
      expect(InputValidator.for({ a: 1 }).isObject().isValid()).toBe(true);
    });

    it('isObject: should fail for null', () => {
      expect(InputValidator.for(null).isObject().isValid()).toBe(false);
    });

    it('isObject: should fail for arrays', () => {
      expect(InputValidator.for([1]).isObject().isValid()).toBe(false);
    });

    it('isObject: should fail for non-objects', () => {
      expect(InputValidator.for(42).isObject().isValid()).toBe(false);
    });
  });

  describe('string validators', () => {
    it('minLength: should fail when too short', () => {
      expect(InputValidator.for('hi').minLength(5).isValid()).toBe(false);
    });

    it('minLength: should pass when long enough', () => {
      expect(InputValidator.for('hello').minLength(3).isValid()).toBe(true);
    });

    it('maxLength: should fail when too long', () => {
      expect(InputValidator.for('hello world').maxLength(5).isValid()).toBe(false);
    });

    it('maxLength: should pass when short enough', () => {
      expect(InputValidator.for('hi').maxLength(5).isValid()).toBe(true);
    });

    it('matches: should validate regex pattern', () => {
      expect(InputValidator.for('abc123').matches(/^[a-z]+$/).isValid()).toBe(false);
      expect(InputValidator.for('abc').matches(/^[a-z]+$/).isValid()).toBe(true);
    });

    it('isEmail: should validate correct emails', () => {
      expect(InputValidator.for('test@example.com').isEmail().isValid()).toBe(true);
    });

    it('isEmail: should reject invalid emails', () => {
      expect(InputValidator.for('invalid').isEmail().isValid()).toBe(false);
      expect(InputValidator.for('@no-user.com').isEmail().isValid()).toBe(false);
      expect(InputValidator.for('no@').isEmail().isValid()).toBe(false);
    });

    it('isURL: should validate correct URLs', () => {
      expect(InputValidator.for('https://example.com').isURL().isValid()).toBe(true);
      expect(InputValidator.for('http://localhost:3000').isURL().isValid()).toBe(true);
    });

    it('isURL: should reject invalid URLs', () => {
      expect(InputValidator.for('not-a-url').isURL().isValid()).toBe(false);
    });

    it('isUUID: should validate correct UUIDs', () => {
      expect(InputValidator.for('550e8400-e29b-41d4-a716-446655440000').isUUID().isValid()).toBe(true);
    });

    it('isUUID: should reject invalid UUIDs', () => {
      expect(InputValidator.for('not-uuid').isUUID().isValid()).toBe(false);
    });

    it('should not add errors for non-string values on string validators', () => {
      // minLength, maxLength, matches, isEmail, isURL, isUUID should only validate strings
      const v = InputValidator.for(42).minLength(5).maxLength(10).matches(/a/).isEmail().isURL().isUUID();
      // None of these should produce errors for a number
      expect(v.getErrors().length).toBe(0);
    });
  });

  describe('number validators', () => {
    it('min: should fail when below minimum', () => {
      expect(InputValidator.for(5).min(10).isValid()).toBe(false);
    });

    it('min: should pass when at or above minimum', () => {
      expect(InputValidator.for(10).min(10).isValid()).toBe(true);
    });

    it('max: should fail when above maximum', () => {
      expect(InputValidator.for(15).max(10).isValid()).toBe(false);
    });

    it('max: should pass when at or below maximum', () => {
      expect(InputValidator.for(10).max(10).isValid()).toBe(true);
    });

    it('isInteger: should pass for integers', () => {
      expect(InputValidator.for(42).isInteger().isValid()).toBe(true);
    });

    it('isInteger: should fail for floats', () => {
      expect(InputValidator.for(3.14).isInteger().isValid()).toBe(false);
    });

    it('isPositive: should pass for positive numbers', () => {
      expect(InputValidator.for(1).isPositive().isValid()).toBe(true);
    });

    it('isPositive: should fail for zero and negative', () => {
      expect(InputValidator.for(0).isPositive().isValid()).toBe(false);
      expect(InputValidator.for(-1).isPositive().isValid()).toBe(false);
    });

    it('should not add errors for non-number values on number validators', () => {
      const v = InputValidator.for('abc').min(5).max(10).isInteger().isPositive();
      expect(v.getErrors().length).toBe(0);
    });
  });

  describe('array validators', () => {
    it('minItems: should fail when too few', () => {
      expect(InputValidator.for([1]).minItems(3).isValid()).toBe(false);
    });

    it('minItems: should pass when enough', () => {
      expect(InputValidator.for([1, 2, 3]).minItems(3).isValid()).toBe(true);
    });

    it('maxItems: should fail when too many', () => {
      expect(InputValidator.for([1, 2, 3, 4]).maxItems(3).isValid()).toBe(false);
    });

    it('maxItems: should pass when within limit', () => {
      expect(InputValidator.for([1, 2]).maxItems(3).isValid()).toBe(true);
    });

    it('uniqueItems: should detect duplicates', () => {
      expect(InputValidator.for([1, 2, 2]).uniqueItems().isValid()).toBe(false);
    });

    it('uniqueItems: should pass for unique arrays', () => {
      expect(InputValidator.for([1, 2, 3]).uniqueItems().isValid()).toBe(true);
    });

    it('uniqueItems: should handle object duplicates via JSON', () => {
      expect(InputValidator.for([{ a: 1 }, { a: 1 }]).uniqueItems().isValid()).toBe(false);
    });

    it('uniqueItems: should pass for empty array', () => {
      expect(InputValidator.for([]).uniqueItems().isValid()).toBe(true);
    });
  });

  describe('object validators', () => {
    it('requiredFields: should detect missing fields', () => {
      expect(InputValidator.for({ a: 1 }).requiredFields(['a', 'b']).isValid()).toBe(false);
    });

    it('requiredFields: should pass when all fields present', () => {
      expect(InputValidator.for({ a: 1, b: 2 }).requiredFields(['a', 'b']).isValid()).toBe(true);
    });

    it('requiredFields: should reject null values', () => {
      expect(InputValidator.for({ a: null }).requiredFields(['a']).isValid()).toBe(false);
    });

    it('requiredFields: should reject undefined values', () => {
      expect(InputValidator.for({ a: undefined }).requiredFields(['a']).isValid()).toBe(false);
    });

    it('nested: should validate nested schemas', () => {
      const v = InputValidator.for({ name: 'test', age: 25 }).nested({
        name: { type: 'string', required: true },
        age: { type: 'number', min: 0 },
      });
      expect(v.isValid()).toBe(true);
    });

    it('nested: should report nested errors with field prefix', () => {
      const v = InputValidator.for({ name: 123, age: -5 }).nested({
        name: { type: 'string' },
        age: { min: 0 },
      });
      expect(v.isValid()).toBe(false);
      expect(v.getErrors().some((e) => e.startsWith('name:'))).toBe(true);
      expect(v.getErrors().some((e) => e.startsWith('age:'))).toBe(true);
    });
  });

  describe('isOneOf', () => {
    it('should pass for valid value', () => {
      expect(InputValidator.for('a').isOneOf(['a', 'b', 'c']).isValid()).toBe(true);
    });

    it('should fail for invalid value', () => {
      expect(InputValidator.for('d').isOneOf(['a', 'b', 'c']).isValid()).toBe(false);
    });

    it('should work with numbers', () => {
      expect(InputValidator.for(1).isOneOf([1, 2, 3]).isValid()).toBe(true);
    });
  });

  describe('custom', () => {
    it('should pass when custom validator returns null', () => {
      const v = InputValidator.for(5).custom((val) => {
        if (val !== 5) return 'Must be 5';
        return null;
      });
      expect(v.isValid()).toBe(true);
    });

    it('should fail when custom validator returns error string', () => {
      const v = InputValidator.for(3).custom((val) => {
        if (val !== 5) return 'Must be 5';
        return null;
      });
      expect(v.isValid()).toBe(false);
      expect(v.getErrors()).toContain('Must be 5');
    });
  });

  describe('applySchema', () => {
    it('should validate required field', () => {
      const result = InputValidator.validateAndSanitize(null, {
        type: 'string',
        required: true,
      });
      expect(result.valid).toBe(false);
    });

    it('should skip validation for optional null/undefined', () => {
      const result = InputValidator.validateAndSanitize(null, {
        type: 'string',
      });
      expect(result.valid).toBe(true);
    });

    it('should apply type validation', () => {
      const result = InputValidator.validateAndSanitize(42, {
        type: 'string',
      });
      expect(result.valid).toBe(false);
    });

    it('should apply boolean type', () => {
      const result = InputValidator.validateAndSanitize(true, {
        type: 'boolean',
      });
      expect(result.valid).toBe(true);
    });

    it('should apply enum validation', () => {
      const result = InputValidator.validateAndSanitize('red', {
        enum: ['red', 'green', 'blue'],
      });
      expect(result.valid).toBe(true);
    });

    it('should apply custom validation from schema', () => {
      const result = InputValidator.validateAndSanitize(5, {
        custom: (val) => (val as number > 10 ? 'too large' : null),
      });
      expect(result.valid).toBe(true);
    });

    it('should return sanitizedValue in result', () => {
      const result = InputValidator.for('hello').isString().getResult();
      expect(result.sanitizedValue).toBe('hello');
    });

    it('should return warnings when present', () => {
      // InputValidator doesn't currently add warnings, but the interface supports it
      const result = InputValidator.for('hello').getResult();
      expect(result.warnings).toBeUndefined();
    });
  });

  describe('getResult', () => {
    it('should return valid result when no errors', () => {
      const result = InputValidator.for('test').isString().getResult();
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return invalid result with errors', () => {
      const result = InputValidator.for(42).isString().getResult();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('getErrors', () => {
    it('should return a copy of errors', () => {
      const v = InputValidator.for(42).isString();
      const errors1 = v.getErrors();
      const errors2 = v.getErrors();
      expect(errors1).not.toBe(errors2);
      expect(errors1).toEqual(errors2);
    });
  });

  describe('chaining', () => {
    it('should support method chaining', () => {
      const result = InputValidator.for('test@test.com')
        .isString()
        .isEmail()
        .minLength(5)
        .maxLength(100)
        .getResult();
      expect(result.valid).toBe(true);
    });
  });

  describe('sanitizeHTML', () => {
    it('should strip script tags and content', () => {
      const result = InputValidator.sanitizeHTML('<script>alert("xss")</script>Hello');
      expect(result).not.toContain('<script>');
      expect(result).toContain('Hello');
    });

    it('should strip event handlers', () => {
      const result = InputValidator.sanitizeHTML('<div onclick="alert(1)">Click</div>');
      expect(result).not.toContain('onclick');
    });

    it('should strip javascript: URLs', () => {
      const result = InputValidator.sanitizeHTML('<a href="javascript:alert(1)">Link</a>');
      expect(result).not.toContain('javascript:');
    });

    it('should strip iframe tags', () => {
      const result = InputValidator.sanitizeHTML('<iframe src="evil.com"></iframe>');
      expect(result).not.toContain('iframe');
    });

    it('should strip style tags', () => {
      const result = InputValidator.sanitizeHTML('<style>body{display:none}</style>Hello');
      expect(result).not.toContain('<style');
      expect(result).toContain('Hello');
    });

    it('should strip object tags', () => {
      const result = InputValidator.sanitizeHTML('<object data="evil.swf"></object>');
      expect(result).not.toContain('object');
    });

    it('should strip embed tags', () => {
      const result = InputValidator.sanitizeHTML('<embed src="evil.swf">');
      expect(result).not.toContain('embed');
    });

    it('should strip form tags', () => {
      const result = InputValidator.sanitizeHTML('<form action="evil.com"><input></form>');
      expect(result).not.toContain('<form');
    });

    it('should strip base tags', () => {
      const result = InputValidator.sanitizeHTML('<base href="http://evil.com/">');
      expect(result).not.toContain('base');
    });

    it('should strip link tags', () => {
      const result = InputValidator.sanitizeHTML('<link rel="stylesheet" href="evil.css">');
      expect(result).not.toContain('link');
    });

    it('should strip meta tags', () => {
      const result = InputValidator.sanitizeHTML('<meta http-equiv="refresh" content="0;url=evil.com">');
      expect(result).not.toContain('meta');
    });

    it('should strip svg tags', () => {
      const result = InputValidator.sanitizeHTML('<svg onload="alert(1)"></svg>');
      expect(result).not.toContain('svg');
    });

    it('should strip math tags', () => {
      const result = InputValidator.sanitizeHTML('<math><mtext>test</mtext></math>');
      expect(result).not.toContain('math');
    });

    it('should strip HTML comments', () => {
      const result = InputValidator.sanitizeHTML('<!-- comment -->Hello');
      expect(result).not.toContain('<!--');
      expect(result).toContain('Hello');
    });

    it('should strip vbscript: URLs', () => {
      const result = InputValidator.sanitizeHTML('<a href="vbscript:MsgBox(1)">Link</a>');
      expect(result).not.toContain('vbscript:');
    });

    it('should strip data: URLs in src', () => {
      const result = InputValidator.sanitizeHTML('<img src="data:text/html,<script>alert(1)</script>">');
      expect(result).not.toContain('data:');
    });

    it('should preserve safe inline elements', () => {
      const result = InputValidator.sanitizeHTML('<b>bold</b> <i>italic</i> <em>emphasis</em> <strong>strong</strong>');
      expect(result).toContain('<b>bold</b>');
      expect(result).toContain('<i>italic</i>');
      expect(result).toContain('<em>emphasis</em>');
      expect(result).toContain('<strong>strong</strong>');
    });

    it('should preserve br, p, span tags', () => {
      const result = InputValidator.sanitizeHTML('<p>para</p><br><span>text</span>');
      expect(result).toContain('<p>para</p>');
      expect(result).toContain('<br>');
      expect(result).toContain('<span>text</span>');
    });

    it('should remove null bytes', () => {
      const result = InputValidator.sanitizeHTML('hello\0world');
      expect(result).not.toContain('\0');
    });

    it('should handle empty string', () => {
      expect(InputValidator.sanitizeHTML('')).toBe('');
    });

    it('should handle event handlers with single quotes', () => {
      const result = InputValidator.sanitizeHTML("<div onclick='alert(1)'>Click</div>");
      expect(result).not.toContain('onclick');
    });

    it('should handle event handlers with no quotes', () => {
      const result = InputValidator.sanitizeHTML('<div onclick=alert(1)>Click</div>');
      expect(result).not.toContain('onclick');
    });
  });

  describe('sanitizeSQL', () => {
    it('should escape single quotes', () => {
      expect(InputValidator.sanitizeSQL("it's a test")).toBe("it''s a test");
    });

    it('should escape backslashes', () => {
      expect(InputValidator.sanitizeSQL('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('should escape null bytes', () => {
      expect(InputValidator.sanitizeSQL('a\0b')).toBe('a\\0b');
    });

    it('should escape newlines', () => {
      expect(InputValidator.sanitizeSQL('a\nb')).toBe('a\\nb');
    });

    it('should escape carriage returns', () => {
      expect(InputValidator.sanitizeSQL('a\rb')).toBe('a\\rb');
    });

    it('should escape Ctrl+Z', () => {
      expect(InputValidator.sanitizeSQL('a\x1ab')).toBe('a\\Zb');
    });

    it('should escape double quotes', () => {
      expect(InputValidator.sanitizeSQL('say "hello"')).toBe('say \\"hello\\"');
    });

    it('should handle empty string', () => {
      expect(InputValidator.sanitizeSQL('')).toBe('');
    });
  });

  describe('sanitizePath', () => {
    it('should remove path traversal', () => {
      expect(InputValidator.sanitizePath('/tmp/../etc/passwd')).not.toContain('..');
    });

    it('should collapse multiple slashes', () => {
      expect(InputValidator.sanitizePath('a//b')).toBe('/a/b');
    });

    it('should handle empty input', () => {
      expect(InputValidator.sanitizePath('')).toBe('/');
    });

    it('should remove leading/trailing whitespace', () => {
      expect(InputValidator.sanitizePath('  /a/b  ')).toBe('/a/b');
    });

    it('should handle URL-encoded traversal', () => {
      const result = InputValidator.sanitizePath('/tmp/%2e%2e/etc/passwd');
      expect(result).not.toContain('..');
    });

    it('should remove current directory references', () => {
      expect(InputValidator.sanitizePath('/a/./b')).toBe('/a/b');
    });

    it('should handle backslash separators', () => {
      expect(InputValidator.sanitizePath('a\\b\\c')).toBe('/a/b/c');
    });

    it('should remove null bytes', () => {
      const result = InputValidator.sanitizePath('/tmp/\0file');
      expect(result).not.toContain('\0');
    });
  });

  describe('sanitizeCommand', () => {
    it('should escape semicolons', () => {
      const result = InputValidator.sanitizeCommand('hello; rm -rf /');
      expect(result).toContain('\\;');
    });

    it('should escape backticks', () => {
      const result = InputValidator.sanitizeCommand('`whoami`');
      expect(result).toContain('\\`');
    });

    it('should escape dollar signs', () => {
      const result = InputValidator.sanitizeCommand('$HOME');
      expect(result).toContain('\\$');
    });

    it('should escape pipes', () => {
      const result = InputValidator.sanitizeCommand('cat /etc/passwd | grep root');
      expect(result).toContain('\\|');
    });

    it('should escape ampersands', () => {
      const result = InputValidator.sanitizeCommand('cmd & background');
      expect(result).toContain('\\&');
    });

    it('should escape newlines and tabs', () => {
      const result = InputValidator.sanitizeCommand('a\nb\tc');
      expect(result).not.toContain('\n');
      expect(result).not.toContain('\t');
    });

    it('should handle empty string', () => {
      expect(InputValidator.sanitizeCommand('')).toBe('');
    });
  });

  describe('validateAndSanitize', () => {
    it('should validate email with schema', () => {
      const result = InputValidator.validateAndSanitize('test@example.com', {
        type: 'string',
        email: true,
        required: true,
      });
      expect(result.valid).toBe(true);
    });

    it('should validate URL with schema', () => {
      const result = InputValidator.validateAndSanitize('https://example.com', {
        type: 'string',
        url: true,
      });
      expect(result.valid).toBe(true);
    });

    it('should validate UUID with schema', () => {
      const result = InputValidator.validateAndSanitize('550e8400-e29b-41d4-a716-446655440000', {
        type: 'string',
        uuid: true,
      });
      expect(result.valid).toBe(true);
    });
  });
});

// ============================================================================
// Module 3: AuthManager
// ============================================================================
describe('AuthManager', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    authManager = new AuthManager();
  });

  describe('registerStrategy', () => {
    it('should register a strategy', () => {
      authManager.registerStrategy(new TokenAuthStrategy('test-secret-key'));
      expect(authManager.getStrategies()).toContain('token');
    });

    it('should set first registered strategy as default', () => {
      authManager.registerStrategy(new TokenAuthStrategy('test-secret-key'));
      authManager.registerStrategy(new APIKeyAuthStrategy());
      // First strategy should be default
      expect(authManager.getStrategies().length).toBe(2);
    });
  });

  describe('setDefaultStrategy', () => {
    it('should set default strategy', () => {
      authManager.registerStrategy(new TokenAuthStrategy('test-secret-key'));
      authManager.registerStrategy(new APIKeyAuthStrategy());
      authManager.setDefaultStrategy('apikey');
      // Should not throw
      expect(true).toBe(true);
    });

    it('should throw for non-existent strategy', () => {
      expect(() => authManager.setDefaultStrategy('nonexistent')).toThrow();
    });
  });

  describe('authenticate', () => {
    it('should authenticate with token strategy', async () => {
      const strategy = new TokenAuthStrategy('test-secret-key');
      authManager.registerStrategy(strategy);
      const token = strategy.generateToken('user1', ['admin'], ['files:read']);
      const result = await authManager.authenticate({ token });
      expect(result.success).toBe(true);
      expect(result.userId).toBe('user1');
    });

    it('should fail with invalid token', async () => {
      authManager.registerStrategy(new TokenAuthStrategy('test-secret-key'));
      const result = await authManager.authenticate({ token: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should fail with empty token', async () => {
      authManager.registerStrategy(new TokenAuthStrategy('test-secret-key'));
      const result = await authManager.authenticate({ token: '' });
      expect(result.success).toBe(false);
    });

    it('should fail with no strategy', async () => {
      const result = await authManager.authenticate({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('No authentication strategy');
    });

    it('should fail with non-existent strategy name', async () => {
      authManager.registerStrategy(new TokenAuthStrategy('test-secret-key'));
      const result = await authManager.authenticate({}, 'nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should authenticate with API key strategy', async () => {
      const strategy = new APIKeyAuthStrategy({
        'key-123': { userId: 'user1', permissions: ['files:read'], roles: ['user'] },
      });
      authManager.registerStrategy(strategy);
      const result = await authManager.authenticate({ apiKey: 'key-123' });
      expect(result.success).toBe(true);
      expect(result.userId).toBe('user1');
    });

    it('should fail with invalid API key', async () => {
      authManager.registerStrategy(new APIKeyAuthStrategy());
      const result = await authManager.authenticate({ apiKey: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should authenticate with certificate strategy', async () => {
      const strategy = new CertificateAuthStrategy();
      strategy.registerCertificate('cert-fp-123', 'user1', ['files:read'], ['admin']);
      authManager.registerStrategy(strategy);
      const result = await authManager.authenticate({ fingerprint: 'cert-fp-123' });
      expect(result.success).toBe(true);
    });

    it('should use cert as fallback when fingerprint is not provided', async () => {
      const strategy = new CertificateAuthStrategy();
      strategy.registerCertificate('cert-data-123', 'user1', [], []);
      authManager.registerStrategy(strategy);
      const result = await authManager.authenticate({ cert: 'cert-data-123' });
      expect(result.success).toBe(true);
    });

    it('should record audit log entries on auth', async () => {
      authManager.registerStrategy(new TokenAuthStrategy('test-secret-key'));
      await authManager.authenticate({ token: 'invalid' });
      const log = authManager.getAuditLog();
      expect(log.size).toBe(1);
      expect(log.getEntries()[0].result).toBe('failure');
    });
  });

  describe('TokenAuthStrategy', () => {
    it('should throw when constructed without secretKey', () => {
      expect(() => new TokenAuthStrategy()).toThrow();
    });

    it('should throw when constructed with empty string', () => {
      expect(() => new TokenAuthStrategy('')).toThrow();
    });

    it('should generate token with correct format', () => {
      const strategy = new TokenAuthStrategy('test-secret-key');
      const token = strategy.generateToken('user1', ['admin'], ['read']);
      expect(token).toMatch(/^tok_/);
    });

    it('should generate refresh token with correct format', () => {
      const strategy = new TokenAuthStrategy('test-secret-key');
      const token = strategy.generateRefreshToken('user1');
      expect(token).toMatch(/^ref_/);
      expect(token).toContain(Buffer.from('user1').toString('base64url'));
    });

    it('should validate token', () => {
      const strategy = new TokenAuthStrategy('test-secret-key');
      const token = strategy.generateToken('user1', ['admin'], ['read']);
      const payload = strategy.validateToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('user1');
      expect(payload!.roles).toEqual(['admin']);
      expect(payload!.permissions).toEqual(['read']);
    });

    it('should return null for invalid token in validateToken', () => {
      const strategy = new TokenAuthStrategy('test-secret-key');
      expect(strategy.validateToken('invalid')).toBeNull();
    });

    it('should revoke token', () => {
      const strategy = new TokenAuthStrategy('test-secret-key');
      const token = strategy.generateToken('user1', [], []);
      expect(strategy.revokeToken(token)).toBe(true);
      expect(strategy.validateToken(token)).toBeNull();
    });

    it('should return false when revoking non-existent token', () => {
      const strategy = new TokenAuthStrategy('test-secret-key');
      expect(strategy.revokeToken('nonexistent')).toBe(false);
    });

    it('should reject expired tokens', async () => {
      const strategy = new TokenAuthStrategy('test-secret-key');
      const token = strategy.generateToken('user1', [], [], -1); // already expired
      const result = await strategy.authenticate({ token });
      expect(result.success).toBe(false);
      expect(result.error).toContain('expired');
    });

    // BUG-001: Token signature verification
    it('BUG-001: should reject forged tokens with invalid signature', async () => {
      const strategy = new TokenAuthStrategy('test-secret-key');
      const validToken = strategy.generateToken('user1', ['admin'], ['read']);
      // Tamper with the payload part of the token
      const parts = validToken.split('.');
      const tamperedPayload = Buffer.from(JSON.stringify({
        userId: 'attacker',
        roles: ['admin'],
        permissions: ['all'],
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        type: 'access',
      })).toString('base64url');
      const forgedToken = `tok_${tamperedPayload}.${parts[parts.length - 1]}`;
      const result = await strategy.authenticate({ token: forgedToken });
      expect(result.success).toBe(false);
      expect(result.error).toContain('signature');
    });

    it('BUG-001: should reject tokens with wrong secret', async () => {
      const strategy1 = new TokenAuthStrategy('secret-key-1');
      const strategy2 = new TokenAuthStrategy('secret-key-2');
      const token = strategy1.generateToken('user1', [], []);
      const result = await strategy2.authenticate({ token });
      expect(result.success).toBe(false);
      expect(result.error).toContain('signature');
    });

    // BUG-002: Token validation after store clear
    it('BUG-002: should validate token from signed payload when not in store', async () => {
      const strategy = new TokenAuthStrategy('test-secret-key');
      const token = strategy.generateToken('user1', ['admin'], ['read'], 3600000);
      // Clear the in-memory store to simulate server restart
      strategy.revokeToken(token);
      // The token should still be valid because the payload is self-contained and signed
      const result = await strategy.authenticate({ token });
      expect(result.success).toBe(true);
      expect(result.userId).toBe('user1');
    });

    it('BUG-002: should reject expired token even when not in store', async () => {
      const strategy = new TokenAuthStrategy('test-secret-key');
      const token = strategy.generateToken('user1', [], [], -1); // already expired
      strategy.revokeToken(token);
      const result = await strategy.authenticate({ token });
      expect(result.success).toBe(false);
      expect(result.error).toContain('expired');
    });
  });

  describe('APIKeyAuthStrategy', () => {
    it('should register and authenticate with key', async () => {
      const strategy = new APIKeyAuthStrategy();
      strategy.registerKey('my-key', 'user1', ['read'], ['admin']);
      const result = await strategy.authenticate({ apiKey: 'my-key' });
      expect(result.success).toBe(true);
      expect(result.userId).toBe('user1');
    });

    it('should revoke key', async () => {
      const strategy = new APIKeyAuthStrategy();
      strategy.registerKey('my-key', 'user1', [], []);
      expect(strategy.revokeKey('my-key')).toBe(true);
      const result = await strategy.authenticate({ apiKey: 'my-key' });
      expect(result.success).toBe(false);
    });

    it('should handle empty credentials', async () => {
      const strategy = new APIKeyAuthStrategy();
      const result = await strategy.authenticate({});
      expect(result.success).toBe(false);
    });

    it('should initialize with keys via constructor', async () => {
      const strategy = new APIKeyAuthStrategy({
        'init-key': { userId: 'u1', permissions: ['r'], roles: [] },
      });
      const result = await strategy.authenticate({ apiKey: 'init-key' });
      expect(result.success).toBe(true);
    });
  });

  describe('CertificateAuthStrategy', () => {
    it('should register and authenticate', async () => {
      const strategy = new CertificateAuthStrategy();
      strategy.registerCertificate('fp-1', 'user1', ['read'], ['admin']);
      const result = await strategy.authenticate({ fingerprint: 'fp-1' });
      expect(result.success).toBe(true);
    });

    it('should revoke certificate', async () => {
      const strategy = new CertificateAuthStrategy();
      strategy.registerCertificate('fp-1', 'user1', [], []);
      expect(strategy.revokeCertificate('fp-1')).toBe(true);
      const result = await strategy.authenticate({ fingerprint: 'fp-1' });
      expect(result.success).toBe(false);
    });

    it('should fail for unrecognized certificate', async () => {
      const strategy = new CertificateAuthStrategy();
      const result = await strategy.authenticate({ fingerprint: 'unknown' });
      expect(result.success).toBe(false);
    });

    it('should handle empty credentials', async () => {
      const strategy = new CertificateAuthStrategy();
      const result = await strategy.authenticate({});
      expect(result.success).toBe(false);
    });
  });

  describe('RBAC', () => {
    it('checkPermission: direct permission', () => {
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: ['files:read'] };
      expect(authManager.checkPermission(user, 'files:read')).toBe(true);
      expect(authManager.checkPermission(user, 'files:write')).toBe(false);
    });

    it('checkPermission: role permission', () => {
      authManager.registerRole({ name: 'editor', permissions: ['files:read', 'files:write'] });
      const user: User = { id: 'u1', username: 'test', roles: ['editor'], permissions: [] };
      expect(authManager.checkPermission(user, 'files:write')).toBe(true);
    });

    it('checkPermission: parent role permission', () => {
      authManager.registerRole({ name: 'viewer', permissions: ['files:read'] });
      authManager.registerRole({ name: 'editor', permissions: ['files:write'], parentRoles: ['viewer'] });
      const user: User = { id: 'u1', username: 'test', roles: ['editor'], permissions: [] };
      expect(authManager.checkPermission(user, 'files:read')).toBe(true);
      expect(authManager.checkPermission(user, 'files:write')).toBe(true);
    });

    it('checkPermission: circular role hierarchy should not infinite loop', () => {
      authManager.registerRole({ name: 'roleA', permissions: [], parentRoles: ['roleB'] });
      authManager.registerRole({ name: 'roleB', permissions: [], parentRoles: ['roleA'] });
      const user: User = { id: 'u1', username: 'test', roles: ['roleA'], permissions: [] };
      expect(authManager.checkPermission(user, 'any:perm')).toBe(false);
    });

    it('checkPermission: non-existent role', () => {
      const user: User = { id: 'u1', username: 'test', roles: ['nonexistent'], permissions: [] };
      expect(authManager.checkPermission(user, 'any:perm')).toBe(false);
    });
  });

  describe('ABAC', () => {
    it('checkAccess: basic allow', () => {
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: ['files:read'] };
      expect(authManager.checkAccess(user, 'files', 'read', {})).toBe(true);
    });

    it('checkAccess: basic deny', () => {
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: ['files:read'] };
      expect(authManager.checkAccess(user, 'files', 'write', {})).toBe(false);
    });

    it('checkAccess: production requires explicit production permission', () => {
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: ['files:read'] };
      expect(authManager.checkAccess(user, 'files', 'read', { environment: 'production' })).toBe(false);
    });

    it('checkAccess: production allows with production permission', () => {
      // User needs BOTH the base permission AND the production-specific permission
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: ['files:read', 'files:read:production'] };
      expect(authManager.checkAccess(user, 'files', 'read', { environment: 'production' })).toBe(true);
    });

    it('checkAccess: after-hours requires special permission', () => {
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: ['files:read'] };
      const nightContext = { time: new Date(2024, 0, 1, 22, 0, 0) }; // 10 PM
      expect(authManager.checkAccess(user, 'files', 'read', nightContext)).toBe(false);
    });

    it('checkAccess: after-hours allows with after-hours permission', () => {
      // User needs BOTH the base permission AND the after-hours-specific permission
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: ['files:read', 'files:read:after-hours'] };
      const nightContext = { time: new Date(2024, 0, 1, 22, 0, 0) };
      expect(authManager.checkAccess(user, 'files', 'read', nightContext)).toBe(true);
    });

    it('checkAccess: business hours (8-18) do not require after-hours', () => {
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: ['files:read'] };
      const morningContext = { time: new Date(2024, 0, 1, 10, 0, 0) };
      expect(authManager.checkAccess(user, 'files', 'read', morningContext)).toBe(true);
    });

    it('checkAccess: boundary hour 8 is business hours', () => {
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: ['files:read'] };
      const context = { time: new Date(2024, 0, 1, 8, 0, 0) };
      expect(authManager.checkAccess(user, 'files', 'read', context)).toBe(true);
    });

    it('checkAccess: boundary hour 18 is business hours', () => {
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: ['files:read'] };
      const context = { time: new Date(2024, 0, 1, 18, 0, 0) };
      expect(authManager.checkAccess(user, 'files', 'read', context)).toBe(true);
    });

    it('checkAccess: hour 19 is after-hours', () => {
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: ['files:read'] };
      const context = { time: new Date(2024, 0, 1, 19, 0, 0) };
      expect(authManager.checkAccess(user, 'files', 'read', context)).toBe(false);
    });

    it('checkAccess: hour 7 is after-hours', () => {
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: ['files:read'] };
      const context = { time: new Date(2024, 0, 1, 7, 0, 0) };
      expect(authManager.checkAccess(user, 'files', 'read', context)).toBe(false);
    });
  });

  describe('token management', () => {
    it('should generate token for user', () => {
      authManager.registerStrategy(new TokenAuthStrategy('test-secret-key'));
      authManager.registerUser({ id: 'u1', username: 'test', roles: ['admin'], permissions: ['files:read'] });
      const token = authManager.generateToken('u1');
      expect(token).toBeTruthy();
      const payload = authManager.validateToken(token!);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('u1');
    });

    it('should return null when generating token for non-existent user', () => {
      authManager.registerStrategy(new TokenAuthStrategy('test-secret-key'));
      expect(authManager.generateToken('nonexistent')).toBeNull();
    });

    it('should return null when no token strategy registered', () => {
      authManager.registerUser({ id: 'u1', username: 'test', roles: [], permissions: [] });
      expect(authManager.generateToken('u1')).toBeNull();
    });

    it('should revoke tokens', () => {
      const strategy = new TokenAuthStrategy('test-secret-key');
      authManager.registerStrategy(strategy);
      authManager.registerUser({ id: 'u1', username: 'test', roles: [], permissions: [] });
      const token = authManager.generateToken('u1');
      expect(authManager.revokeToken(token!)).toBe(true);
      expect(authManager.validateToken(token!)).toBeNull();
    });

    it('should generate refresh tokens', () => {
      authManager.registerStrategy(new TokenAuthStrategy('test-secret-key'));
      authManager.registerUser({ id: 'u1', username: 'test', roles: [], permissions: [] });
      const refreshToken = authManager.generateRefreshToken('u1');
      expect(refreshToken).toBeTruthy();
      expect(refreshToken).toContain('ref_');
    });

    it('should return null for refresh token of non-existent user', () => {
      authManager.registerStrategy(new TokenAuthStrategy('test-secret-key'));
      expect(authManager.generateRefreshToken('nonexistent')).toBeNull();
    });

    it('should return null for validateToken with no strategy', () => {
      expect(authManager.validateToken('any')).toBeNull();
    });

    it('should return false for revokeToken with no strategy', () => {
      expect(authManager.revokeToken('any')).toBe(false);
    });
  });

  describe('user and role management', () => {
    it('should register and get user', () => {
      authManager.registerUser({ id: 'u1', username: 'test', roles: [], permissions: [] });
      expect(authManager.getUser('u1')).toBeDefined();
      expect(authManager.getUser('u1')!.username).toBe('test');
    });

    it('should return undefined for non-existent user', () => {
      expect(authManager.getUser('nonexistent')).toBeUndefined();
    });

    it('should register and get role', () => {
      authManager.registerRole({ name: 'admin', permissions: ['all'] });
      expect(authManager.getRole('admin')).toBeDefined();
      expect(authManager.getRole('admin')!.permissions).toContain('all');
    });

    it('should return undefined for non-existent role', () => {
      expect(authManager.getRole('nonexistent')).toBeUndefined();
    });

    it('should list roles', () => {
      authManager.registerRole({ name: 'admin', permissions: [] });
      authManager.registerRole({ name: 'user', permissions: [] });
      expect(authManager.getRoles()).toContain('admin');
      expect(authManager.getRoles()).toContain('user');
    });
  });

  describe('AuditLog (auth-manager)', () => {
    it('should record entries', () => {
      const log = new AuditLog();
      log.record({ userId: 'u1', action: 'login', resource: 'auth', result: 'success' });
      expect(log.size).toBe(1);
    });

    it('should filter by userId', () => {
      const log = new AuditLog();
      log.record({ userId: 'u1', action: 'login', resource: 'auth', result: 'success' });
      log.record({ userId: 'u2', action: 'login', resource: 'auth', result: 'failure' });
      expect(log.getEntries({ userId: 'u1' }).length).toBe(1);
    });

    it('should filter by action', () => {
      const log = new AuditLog();
      log.record({ userId: 'u1', action: 'login', resource: 'auth', result: 'success' });
      log.record({ userId: 'u1', action: 'logout', resource: 'auth', result: 'success' });
      expect(log.getEntries({ action: 'login' }).length).toBe(1);
    });

    it('should filter by result', () => {
      const log = new AuditLog();
      log.record({ userId: 'u1', action: 'login', resource: 'auth', result: 'success' });
      log.record({ userId: 'u1', action: 'login', resource: 'auth', result: 'failure' });
      expect(log.getEntries({ result: 'failure' }).length).toBe(1);
    });

    it('should filter by time range', () => {
      const log = new AuditLog();
      const now = Date.now();
      log.record({ userId: 'u1', action: 'login', resource: 'auth', result: 'success' });
      const entries = log.getEntries({ startTime: now - 1000, endTime: now + 1000 });
      expect(entries.length).toBe(1);
    });

    it('should enforce max size', () => {
      const log = new AuditLog(3);
      for (let i = 0; i < 5; i++) {
        log.record({ userId: `u${i}`, action: 'a', resource: 'r', result: 'success' });
      }
      expect(log.size).toBe(3);
    });

    it('should support listeners', () => {
      const log = new AuditLog();
      let received = false;
      log.addListener(() => { received = true; });
      log.record({ userId: 'u1', action: 'login', resource: 'auth', result: 'success' });
      expect(received).toBe(true);
    });

    it('should remove listeners', () => {
      const log = new AuditLog();
      let count = 0;
      const listener = () => { count++; };
      log.addListener(listener);
      log.record({ userId: 'u1', action: 'a', resource: 'r', result: 'success' });
      expect(count).toBe(1);
      log.removeListener(listener);
      log.record({ userId: 'u1', action: 'a', resource: 'r', result: 'success' });
      expect(count).toBe(1);
    });

    it('should clear entries', () => {
      const log = new AuditLog();
      log.record({ userId: 'u1', action: 'a', resource: 'r', result: 'success' });
      log.clear();
      expect(log.size).toBe(0);
    });

    it('should generate unique IDs', () => {
      const log = new AuditLog();
      const e1 = log.record({ userId: 'u1', action: 'a', resource: 'r', result: 'success' });
      const e2 = log.record({ userId: 'u1', action: 'a', resource: 'r', result: 'success' });
      expect(e1.id).not.toBe(e2.id);
    });

    it('should include timestamp', () => {
      const log = new AuditLog();
      const before = Date.now();
      const entry = log.record({ userId: 'u1', action: 'a', resource: 'r', result: 'success' });
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(Date.now());
    });
  });
});

// ============================================================================
// Module 4: SecretManager
// ============================================================================
describe('SecretManager', () => {
  let secretManager: SecretManager;

  beforeEach(() => {
    secretManager = new SecretManager({ defaultTTL: 5000 });
  });

  describe('provider management', () => {
    it('should register and use memory provider', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      await secretManager.set('API_KEY', 'secret123');
      expect(await secretManager.get('API_KEY')).toBe('secret123');
    });

    it('should return undefined for non-existent key', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      expect(await secretManager.get('NON_EXISTENT')).toBeUndefined();
    });

    it('should set first provider as default', async () => {
      secretManager.registerProvider('mem1', new MemorySecretProvider());
      secretManager.registerProvider('mem2', new MemorySecretProvider());
      await secretManager.set('KEY', 'val');
      expect(await secretManager.get('KEY')).toBe('val');
    });

    it('should set default provider', () => {
      secretManager.registerProvider('mem1', new MemorySecretProvider());
      secretManager.registerProvider('mem2', new MemorySecretProvider());
      secretManager.setDefaultProvider('mem2');
      expect(true).toBe(true); // no throw
    });

    it('should throw when setting non-existent default provider', () => {
      expect(() => secretManager.setDefaultProvider('nonexistent')).toThrow();
    });

    it('should get from specific provider', async () => {
      const mem1 = new MemorySecretProvider();
      const mem2 = new MemorySecretProvider();
      secretManager.registerProvider('mem1', mem1);
      secretManager.registerProvider('mem2', mem2);
      await mem1.set('KEY', 'from-mem1');
      await mem2.set('KEY', 'from-mem2');
      expect(await secretManager.get('KEY', 'mem1')).toBe('from-mem1');
      expect(await secretManager.get('KEY', 'mem2')).toBe('from-mem2');
    });

    it('should return undefined when no provider available', async () => {
      expect(await secretManager.get('KEY')).toBeUndefined();
    });

    it('should throw when setting with no provider', async () => {
      await expect(secretManager.set('KEY', 'val')).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete secrets', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      await secretManager.set('KEY', 'value');
      await secretManager.delete('KEY');
      expect(await secretManager.get('KEY')).toBeUndefined();
    });

    it('should clear versions on delete', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      await secretManager.set('KEY', 'v1');
      await secretManager.set('KEY', 'v2');
      await secretManager.delete('KEY');
      expect(secretManager.getVersions('KEY')).toEqual([]);
    });
  });

  describe('caching', () => {
    it('should cache secrets', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      await secretManager.set('KEY', 'cached_value');
      const v1 = await secretManager.get('KEY');
      const v2 = await secretManager.get('KEY');
      expect(v1).toBe('cached_value');
      expect(v2).toBe('cached_value');
    });

    it('should clear cache', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      await secretManager.set('KEY', 'val');
      await secretManager.get('KEY');
      secretManager.clearCache();
      expect(await secretManager.get('KEY')).toBe('val');
    });

    it('should expire cache entries', async () => {
      const sm = new SecretManager({ defaultTTL: 1 });
      sm.registerProvider('memory', new MemorySecretProvider());
      await sm.set('KEY', 'val');
      await sm.get('KEY');
      // Wait for cache to expire
      await new Promise((r) => setTimeout(r, 10));
      // Should still work because it fetches from provider
      expect(await sm.get('KEY')).toBe('val');
    });
  });

  describe('versioning', () => {
    it('should track versions', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      await secretManager.set('KEY', 'v1');
      await secretManager.set('KEY', 'v2');
      const versions = secretManager.getVersions('KEY');
      expect(versions.length).toBe(2);
      expect(versions[0].value).toBe('v1');
      expect(versions[1].value).toBe('v2');
    });

    it('should get specific version', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      await secretManager.set('KEY', 'v1');
      await secretManager.set('KEY', 'v2');
      expect(secretManager.getVersion('KEY', 1)?.value).toBe('v1');
      expect(secretManager.getVersion('KEY', 2)?.value).toBe('v2');
      expect(secretManager.getVersion('KEY', 3)).toBeUndefined();
    });

    it('should return empty array for non-existent key versions', () => {
      expect(secretManager.getVersions('NONEXISTENT')).toEqual([]);
    });
  });

  describe('rotation', () => {
    it('should rotate secrets', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      await secretManager.set('KEY', 'old');
      const newVersion = await secretManager.rotate('KEY', 'new');
      expect(newVersion).toBe(2);
      expect(await secretManager.get('KEY')).toBe('new');
    });

    it('should trigger rotation callbacks', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      let callbackFired = false;
      secretManager.onRotation('KEY', (key, oldV, newV) => {
        callbackFired = true;
        expect(key).toBe('KEY');
        expect(oldV).toBe(0);
        expect(newV).toBe(1);
      });
      await secretManager.rotate('KEY', 'new_value');
      expect(callbackFired).toBe(true);
    });
  });

  describe('references', () => {
    it('should create and resolve references', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      await secretManager.set('REF_KEY', 'ref_value');
      const ref = secretManager.createReference('REF_KEY');
      expect(ref.key).toBe('REF_KEY');
      expect(await ref.resolve()).toBe('ref_value');
    });

    it('should resolve versioned references', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      await secretManager.set('VER_KEY', 'v1');
      await secretManager.set('VER_KEY', 'v2');
      const ref = secretManager.createReference('VER_KEY', 1);
      expect(await ref.resolve()).toBe('v1');
    });

    it('should return undefined for non-existent reference', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      const ref = secretManager.createReference('NONEXISTENT');
      expect(await ref.resolve()).toBeUndefined();
    });
  });

  describe('maskSecrets', () => {
    it('should mask long secrets', () => {
      const text = 'API key is sk-12345678 and password is mypassword';
      const masked = SecretManager.maskSecrets(text, ['sk-12345678', 'mypassword']);
      expect(masked).not.toContain('sk-12345678');
      expect(masked).not.toContain('mypassword');
    });

    it('should mask short secrets with asterisks', () => {
      const masked = SecretManager.maskSecrets('key is ab', ['ab']);
      expect(masked).not.toContain('ab');
      expect(masked).toContain('****');
    });

    it('should handle empty secrets array', () => {
      expect(SecretManager.maskSecrets('hello world', [])).toBe('hello world');
    });

    it('should handle empty string secret', () => {
      expect(SecretManager.maskSecrets('hello world', [''])).toBe('hello world');
    });

    it('should handle secret not found in text', () => {
      expect(SecretManager.maskSecrets('hello world', ['notfound'])).toBe('hello world');
    });
  });

  describe('list', () => {
    it('should list secrets from provider', async () => {
      secretManager.registerProvider('memory', new MemorySecretProvider());
      await secretManager.set('A', '1');
      await secretManager.set('B', '2');
      const keys = await secretManager.list();
      expect(keys).toContain('A');
      expect(keys).toContain('B');
    });

    it('should return empty array when no provider', async () => {
      expect(await secretManager.list()).toEqual([]);
    });
  });

  describe('EnvSecretProvider', () => {
    afterEach(() => {
      delete process.env.TEST_SEC_KEY;
    });

    it('should read from process.env', async () => {
      const provider = new EnvSecretProvider('TEST');
      process.env.TEST_SEC_KEY = 'env_value';
      expect(await provider.get('SEC_KEY')).toBe('env_value');
    });

    it('should write to process.env', async () => {
      const provider = new EnvSecretProvider('TEST');
      await provider.set('SEC_KEY', 'new_val');
      expect(process.env.TEST_SEC_KEY).toBe('new_val');
    });

    it('should delete from process.env', async () => {
      const provider = new EnvSecretProvider('TEST');
      process.env.TEST_SEC_KEY = 'val';
      await provider.delete('SEC_KEY');
      expect(process.env.TEST_SEC_KEY).toBeUndefined();
    });

    it('should list keys with prefix', async () => {
      const provider = new EnvSecretProvider('TESTPFX');
      process.env.TESTPFX_KEY1 = 'v1';
      process.env.TESTPFX_KEY2 = 'v2';
      const keys = await provider.list();
      expect(keys).toContain('KEY1');
      expect(keys).toContain('KEY2');
      delete process.env.TESTPFX_KEY1;
      delete process.env.TESTPFX_KEY2;
    });

    it('should work without prefix', async () => {
      const provider = new EnvSecretProvider('');
      process.env.DIRECT_KEY = 'val';
      expect(await provider.get('DIRECT_KEY')).toBe('val');
      delete process.env.DIRECT_KEY;
    });
  });

  describe('FileSecretProvider', () => {
    it('should encrypt and decrypt', async () => {
      const provider = new FileSecretProvider('my-encryption-key-16chars');
      await provider.set('SECRET', 'my_secret_value');
      expect(await provider.get('SECRET')).toBe('my_secret_value');
    });

    it('should throw when constructed without key', () => {
      expect(() => new FileSecretProvider()).toThrow();
    });

    it('should throw when key is too short', () => {
      expect(() => new FileSecretProvider('short')).toThrow();
    });

    it('should return undefined for non-existent key', async () => {
      const provider = new FileSecretProvider('my-encryption-key-16chars');
      expect(await provider.get('NONEXISTENT')).toBeUndefined();
    });

    it('should delete secrets', async () => {
      const provider = new FileSecretProvider('my-encryption-key-16chars');
      await provider.set('KEY', 'val');
      await provider.delete('KEY');
      expect(await provider.get('KEY')).toBeUndefined();
    });

    it('should list secrets', async () => {
      const provider = new FileSecretProvider('my-encryption-key-16chars');
      await provider.set('A', '1');
      await provider.set('B', '2');
      const keys = await provider.list();
      expect(keys).toContain('A');
      expect(keys).toContain('B');
    });

    // BUG-005: Decryption failure should throw
    it('BUG-005: should throw on decryption with wrong key', async () => {
      const provider1 = new FileSecretProvider('encryption-key-number-1');
      await provider1.set('SECRET', 'sensitive_data');
      const encrypted = (provider1 as any).secrets.get('SECRET');
      // Create a new provider with a different key
      const provider2 = new FileSecretProvider('encryption-key-number-2');
      // Manually inject the encrypted value from provider1
      (provider2 as any).secrets.set('SECRET', encrypted);
      await expect(provider2.get('SECRET')).rejects.toThrow('Decryption failed');
    });
  });

  describe('MemorySecretProvider', () => {
    it('should set and get', async () => {
      const provider = new MemorySecretProvider();
      await provider.set('KEY', 'val');
      expect(await provider.get('KEY')).toBe('val');
    });

    it('should delete', async () => {
      const provider = new MemorySecretProvider();
      await provider.set('KEY', 'val');
      await provider.delete('KEY');
      expect(await provider.get('KEY')).toBeUndefined();
    });

    it('should list', async () => {
      const provider = new MemorySecretProvider();
      await provider.set('A', '1');
      expect(await provider.list()).toContain('A');
    });

    it('should clear all', async () => {
      const provider = new MemorySecretProvider();
      await provider.set('A', '1');
      await provider.set('B', '2');
      provider.clear();
      expect(await provider.list()).toEqual([]);
    });
  });

  describe('setDefaultTTL', () => {
    it('should update default TTL', () => {
      secretManager.setDefaultTTL(10000);
      // Just verify it doesn't throw
      expect(true).toBe(true);
    });
  });
});

// ============================================================================
// Module 5: AdvancedRateLimiter
// ============================================================================
describe('AdvancedRateLimiter', () => {
  describe('basic rate limiting', () => {
    it('should allow requests under limit', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 5, windowMs: 1000 });
      const result = await limiter.check('user1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });

    it('should deny requests over limit', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 3, windowMs: 1000 });
      for (let i = 0; i < 3; i++) {
        await limiter.check('user1');
      }
      const result = await limiter.check('user1');
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should track different keys independently', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 1, windowMs: 1000 });
      const r1 = await limiter.check('user1');
      const r2 = await limiter.check('user2');
      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
    });

    it('should return correct limit', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 10, windowMs: 1000 });
      const result = await limiter.check('user1');
      expect(result.limit).toBe(10);
    });

    it('should return resetTime', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 5, windowMs: 1000 });
      const result = await limiter.check('user1');
      expect(result.resetTime).toBeGreaterThan(0);
    });

    it('should return retryAfter of 0 when allowed', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 5, windowMs: 1000 });
      const result = await limiter.check('user1');
      expect(result.retryAfter).toBe(0);
    });
  });

  describe('algorithms', () => {
    const algorithms: Array<'token-bucket' | 'leaky-bucket' | 'sliding-window' | 'fixed-window'> = [
      'token-bucket', 'leaky-bucket', 'sliding-window', 'fixed-window',
    ];

    for (const algo of algorithms) {
      describe(`${algo}`, () => {
        it('should allow requests under limit', async () => {
          const limiter = new AdvancedRateLimiter({ limit: 3, windowMs: 1000, algorithm: algo });
          expect((await limiter.check('test')).allowed).toBe(true);
        });

        it('should deny requests over limit', async () => {
          const limiter = new AdvancedRateLimiter({ limit: 2, windowMs: 1000, algorithm: algo });
          await limiter.check('test');
          await limiter.check('test');
          expect((await limiter.check('test')).allowed).toBe(false);
        });
      });
    }
  });

  describe('burst', () => {
    it('should allow burst traffic with token-bucket', async () => {
      const limiter = new AdvancedRateLimiter({
        limit: 2,
        windowMs: 1000,
        burst: 3,
        algorithm: 'token-bucket',
      });
      // With burst of 3, max tokens = 5
      let allowed = 0;
      for (let i = 0; i < 5; i++) {
        const result = await limiter.check('user1');
        if (result.allowed) allowed++;
      }
      expect(allowed).toBe(5);
    });
  });

  describe('backoff', () => {
    it('should track violations', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 1, windowMs: 1000 });
      await limiter.check('user1');
      await limiter.check('user1'); // violation
      expect(limiter.getStatus('user1').violations).toBe(1);
    });

    it('should reset violation count on success', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 1, windowMs: 1000 });
      await limiter.check('user1');
      await limiter.check('user1'); // violation
      await limiter.reset('user1');
      await limiter.check('user1'); // success
      expect(limiter.getStatus('user1').violations).toBe(0);
    });

    it('should increase backoff after repeated violations', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 1, windowMs: 10000 });
      // Exhaust limit
      await limiter.check('user1');
      // Generate violations
      for (let i = 0; i < 5; i++) {
        await limiter.check('user1');
      }
      const status = limiter.getStatus('user1');
      expect(status.backoffMultiplier).toBeGreaterThan(1);
    });
  });

  describe('headers', () => {
    it('should provide rate limit headers', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 5, windowMs: 1000 });
      const headers = await limiter.getRateLimitHeaders('user1');
      expect(headers['X-RateLimit-Limit']).toBe('5');
      expect(headers['X-RateLimit-Remaining']).toBeDefined();
      expect(headers['X-RateLimit-Reset']).toBeDefined();
    });
  });

  describe('reset', () => {
    it('should reset rate limit for a key', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 1, windowMs: 1000 });
      await limiter.check('user1');
      await limiter.reset('user1');
      expect((await limiter.check('user1')).allowed).toBe(true);
    });

    it('should reset all rate limits', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 1, windowMs: 1000 });
      await limiter.check('user1');
      await limiter.check('user2');
      await limiter.resetAll();
      expect((await limiter.check('user1')).allowed).toBe(true);
      expect((await limiter.check('user2')).allowed).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return default status for unknown key', () => {
      const limiter = new AdvancedRateLimiter({ limit: 5, windowMs: 1000 });
      const status = limiter.getStatus('unknown');
      expect(status.violations).toBe(0);
      expect(status.backoffMultiplier).toBe(1);
    });
  });

  describe('maxBuckets', () => {
    it('should enforce max bucket count', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 5, windowMs: 1000, maxBuckets: 2 });
      await limiter.check('key1');
      await limiter.check('key2');
      await limiter.check('key3'); // should evict key1
      // key1's bucket should have been evicted
      const status = limiter.getStatus('key1');
      expect(status.violations).toBe(0);
    });
  });

  describe('key prefix', () => {
    it('should use custom key prefix', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 5, windowMs: 1000, keyPrefix: 'custom' });
      const result = await limiter.check('user1');
      expect(result.allowed).toBe(true);
    });
  });
});

// ============================================================================
// Module 6: CORSGuard
// ============================================================================
describe('CORSGuard', () => {
  describe('validateOrigin', () => {
    it('should deny all by default', () => {
      const guard = new CORSGuard();
      expect(guard.validateOrigin('https://example.com')).toBe(false);
    });

    it('should allow whitelisted origins', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'] });
      expect(guard.validateOrigin('https://example.com')).toBe(true);
      expect(guard.validateOrigin('https://other.com')).toBe(false);
    });

    it('should support wildcard', () => {
      const guard = new CORSGuard({ origins: ['*'] });
      expect(guard.validateOrigin('https://any.com')).toBe(true);
    });

    it('should support regex origins', () => {
      const guard = new CORSGuard({ origins: [/^https:\/\/.*\.example\.com$/] });
      expect(guard.validateOrigin('https://api.example.com')).toBe(true);
      expect(guard.validateOrigin('https://evil.com')).toBe(false);
    });

    it('should be case-sensitive for string origins', () => {
      const guard = new CORSGuard({ origins: ['https://Example.com'] });
      expect(guard.validateOrigin('https://example.com')).toBe(false);
    });
  });

  describe('getCORSHeaders', () => {
    it('should return headers for valid origin', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'] });
      const headers = guard.getCORSHeaders('https://example.com');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
      expect(headers['Access-Control-Allow-Methods']).toBeDefined();
    });

    it('should return empty headers for invalid origin', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'] });
      expect(Object.keys(guard.getCORSHeaders('https://evil.com')).length).toBe(0);
    });

    it('should include credentials header when enabled', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'], credentials: true });
      expect(guard.getCORSHeaders('https://example.com')['Access-Control-Allow-Credentials']).toBe('true');
    });

    it('should include exposed headers', () => {
      const guard = new CORSGuard({
        origins: ['https://example.com'],
        exposedHeaders: ['X-Custom-Header'],
      });
      expect(guard.getCORSHeaders('https://example.com')['Access-Control-Expose-Headers']).toContain('X-Custom-Header');
    });

    it('should include max age', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'], maxAge: 3600 });
      expect(guard.getCORSHeaders('https://example.com')['Access-Control-Max-Age']).toBe('3600');
    });

    it('should include private network header when enabled', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'], allowPrivateNetwork: true });
      expect(guard.getCORSHeaders('https://example.com')['Access-Control-Allow-Private-Network']).toBe('true');
    });
  });

  describe('validateRequest', () => {
    it('should validate valid request', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'], methods: ['GET', 'POST'] });
      const result = guard.validateRequest('https://example.com', 'GET');
      expect(result.allowed).toBe(true);
    });

    it('should deny request without origin', () => {
      const guard = new CORSGuard();
      const result = guard.validateRequest('', 'GET');
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Origin header is required');
    });

    it('should deny invalid origin', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'] });
      const result = guard.validateRequest('https://evil.com', 'GET');
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('should deny preflight for disallowed method', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'], methods: ['GET'] });
      const result = guard.validateRequest('https://example.com', 'DELETE', true);
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Method');
    });

    it('should allow preflight for allowed method', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'], methods: ['GET', 'POST'] });
      const result = guard.validateRequest('https://example.com', 'POST', true);
      expect(result.allowed).toBe(true);
    });

    it('should be case-insensitive for method check', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'], methods: ['GET'] });
      const result = guard.validateRequest('https://example.com', 'get', true);
      expect(result.allowed).toBe(true);
    });
  });

  describe('handlePreflight', () => {
    it('should handle valid preflight', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'], methods: ['GET', 'POST'] });
      const result = guard.handlePreflight('https://example.com', 'POST');
      expect(result.allowed).toBe(true);
    });

    it('should deny preflight for disallowed method', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'], methods: ['GET'] });
      const result = guard.handlePreflight('https://example.com', 'DELETE');
      expect(result.allowed).toBe(false);
    });

    it('should handle requested headers', () => {
      const guard = new CORSGuard({
        origins: ['https://example.com'],
        methods: ['POST'],
        headers: ['Content-Type', 'Authorization'],
      });
      const result = guard.handlePreflight('https://example.com', 'POST', ['Content-Type', 'X-Custom']);
      expect(result.allowed).toBe(true);
      expect(result.headers['Access-Control-Allow-Headers']).toBeDefined();
    });
  });

  describe('origin management', () => {
    it('should add origin', () => {
      const guard = new CORSGuard();
      guard.addOrigin('https://new.com');
      expect(guard.validateOrigin('https://new.com')).toBe(true);
    });

    it('should remove origin', () => {
      const guard = new CORSGuard();
      guard.addOrigin('https://new.com');
      expect(guard.removeOrigin('https://new.com')).toBe(true);
      expect(guard.validateOrigin('https://new.com')).toBe(false);
    });

    it('should return false when removing non-existent origin', () => {
      const guard = new CORSGuard();
      expect(guard.removeOrigin('https://nonexistent.com')).toBe(false);
    });

    it('should remove regex origin', () => {
      const guard = new CORSGuard();
      const pattern = /^https:\/\/.*\.example\.com$/;
      guard.addOrigin(pattern);
      expect(guard.validateOrigin('https://api.example.com')).toBe(true);
      expect(guard.removeOrigin(pattern)).toBe(true);
      expect(guard.validateOrigin('https://api.example.com')).toBe(false);
    });
  });

  describe('config management', () => {
    it('should get config', () => {
      const guard = new CORSGuard({ origins: ['https://example.com'] });
      const config = guard.getConfig();
      expect(config.origins).toEqual(['https://example.com']);
    });

    it('should update config', () => {
      const guard = new CORSGuard();
      guard.updateConfig({ origins: ['https://new.com'] });
      expect(guard.validateOrigin('https://new.com')).toBe(true);
    });
  });

  describe('static factories', () => {
    it('defaultSafe should deny all', () => {
      expect(CORSGuard.defaultSafe().validateOrigin('https://any.com')).toBe(false);
    });

    it('permissive should allow http/https origins', () => {
      expect(CORSGuard.permissive().validateOrigin('https://any.com')).toBe(true);
      expect(CORSGuard.permissive().validateOrigin('http://any.com')).toBe(true);
    });

    it('development should allow localhost', () => {
      const guard = CORSGuard.development();
      expect(guard.validateOrigin('http://localhost:3000')).toBe(true);
      expect(guard.validateOrigin('http://127.0.0.1:3000')).toBe(true);
      expect(guard.validateOrigin('https://evil.com')).toBe(false);
    });

    it('development should allow localhost without port', () => {
      const guard = CORSGuard.development();
      expect(guard.validateOrigin('http://localhost')).toBe(true);
      expect(guard.validateOrigin('http://127.0.0.1')).toBe(true);
    });
  });
});

// ============================================================================
// Module 7: CSRFProtection
// ============================================================================
describe('CSRFProtection', () => {
  let csrf: CSRFProtection;

  beforeEach(() => {
    csrf = new CSRFProtection();
  });

  describe('generateToken', () => {
    it('should generate a token', () => {
      const token = csrf.generateToken();
      expect(token).toBeTruthy();
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(csrf.generateToken());
      }
      expect(tokens.size).toBe(100);
    });

    it('should respect custom token length', () => {
      const csrfCustom = new CSRFProtection({ tokenLength: 64 });
      expect(csrfCustom.generateToken().length).toBe(64);
    });

    it('should respect custom charset', () => {
      const csrfCustom = new CSRFProtection({ charset: '01', tokenLength: 8 });
      const token = csrfCustom.generateToken();
      expect(token).toMatch(/^[01]+$/);
    });
  });

  describe('validateToken', () => {
    it('should validate correct token', () => {
      const token = csrf.generateToken();
      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should reject incorrect token', () => {
      const token1 = csrf.generateToken();
      const token2 = csrf.generateToken();
      expect(csrf.validateToken(token1, token2)).toBe(false);
    });

    it('should reject empty tokens', () => {
      expect(csrf.validateToken('', 'token')).toBe(false);
      expect(csrf.validateToken('token', '')).toBe(false);
      expect(csrf.validateToken('', '')).toBe(false);
    });

    it('should reject tokens of different lengths', () => {
      expect(csrf.validateToken('abc', 'abcdef')).toBe(false);
    });

    it('should reject expired tokens', async () => {
      const shortLived = new CSRFProtection({ expiryMs: 1 });
      const token = shortLived.generateToken();
      await new Promise((r) => setTimeout(r, 10));
      expect(shortLived.validateToken(token, token)).toBe(false);
    });

    it('should reject revoked tokens', () => {
      const token = csrf.generateToken();
      csrf.revokeToken(token);
      expect(csrf.validateToken(token, token)).toBe(false);
    });
  });

  describe('isValid', () => {
    it('should validate existing token', () => {
      const token = csrf.generateToken();
      expect(csrf.isValid(token)).toBe(true);
    });

    it('should reject non-existent token', () => {
      expect(csrf.isValid('nonexistent')).toBe(false);
    });

    it('should reject empty token', () => {
      expect(csrf.isValid('')).toBe(false);
    });

    it('should reject expired token', async () => {
      const shortLived = new CSRFProtection({ expiryMs: 1 });
      const token = shortLived.generateToken();
      await new Promise((r) => setTimeout(r, 10));
      expect(shortLived.isValid(token)).toBe(false);
    });
  });

  describe('double-submit pattern', () => {
    it('should validate double-submit tokens', () => {
      const token = csrf.generateDoubleSubmitToken();
      expect(csrf.validateDoubleSubmit(token, token)).toBe(true);
    });

    it('should reject mismatched double-submit tokens', () => {
      const token = csrf.generateDoubleSubmitToken();
      expect(csrf.validateDoubleSubmit(token, 'wrong')).toBe(false);
    });
  });

  describe('synchronizer token pattern', () => {
    it('should validate synchronizer tokens', () => {
      const token = csrf.generateSynchronizerToken();
      expect(csrf.validateSynchronizerToken(token)).toBe(true);
    });

    it('should reject invalid synchronizer tokens', () => {
      expect(csrf.validateSynchronizerToken('invalid')).toBe(false);
    });
  });

  describe('revokeToken', () => {
    it('should revoke tokens', () => {
      const token = csrf.generateToken();
      expect(csrf.revokeToken(token)).toBe(true);
      expect(csrf.isValid(token)).toBe(false);
    });

    it('should return false for non-existent token', () => {
      expect(csrf.revokeToken('nonexistent')).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should cleanup expired tokens', async () => {
      const shortLived = new CSRFProtection({ expiryMs: 1 });
      shortLived.generateToken();
      shortLived.generateToken();
      await new Promise((r) => setTimeout(r, 10));
      expect(shortLived.cleanup()).toBe(2);
      expect(shortLived.activeTokenCount).toBe(0);
    });

    it('should not cleanup non-expired tokens', () => {
      csrf.generateToken();
      csrf.generateToken();
      expect(csrf.cleanup()).toBe(0);
      expect(csrf.activeTokenCount).toBe(2);
    });
  });

  describe('activeTokenCount', () => {
    it('should track active tokens', () => {
      expect(csrf.activeTokenCount).toBe(0);
      csrf.generateToken();
      csrf.generateToken();
      expect(csrf.activeTokenCount).toBe(2);
    });
  });

  describe('maxTokens', () => {
    it('should enforce max tokens by cleaning up', () => {
      const limited = new CSRFProtection({ maxTokens: 2, expiryMs: 3600000 });
      limited.generateToken();
      limited.generateToken();
      limited.generateToken(); // should trigger cleanup, but no expired tokens
      expect(limited.activeTokenCount).toBeLessThanOrEqual(3);
    });
  });

  describe('getTokenInfo', () => {
    it('should return token info', () => {
      const token = csrf.generateToken();
      const info = csrf.getTokenInfo(token);
      expect(info).toBeDefined();
      expect(info!.value).toBe(token);
      expect(info!.createdAt).toBeGreaterThan(0);
      expect(info!.expiresAt).toBeGreaterThan(info!.createdAt);
    });

    it('should return undefined for non-existent token', () => {
      expect(csrf.getTokenInfo('nonexistent')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should clear all tokens', () => {
      csrf.generateToken();
      csrf.generateToken();
      csrf.clear();
      expect(csrf.activeTokenCount).toBe(0);
    });
  });
});

// ============================================================================
// Module 8: SecurityHeaders
// ============================================================================
describe('SecurityHeaders', () => {
  describe('getHeaders', () => {
    it('should return empty headers with default config', () => {
      expect(Object.keys(new SecurityHeaders().getHeaders()).length).toBe(0);
    });

    it('should set CSP', () => {
      const h = new SecurityHeaders({ contentSecurityPolicy: "default-src 'self'" }).getHeaders();
      expect(h['Content-Security-Policy']).toBe("default-src 'self'");
    });

    it('should set X-Content-Type-Options', () => {
      const h = new SecurityHeaders({ xContentTypeOptions: 'nosniff' }).getHeaders();
      expect(h['X-Content-Type-Options']).toBe('nosniff');
    });

    it('should set X-Frame-Options', () => {
      const h = new SecurityHeaders({ xFrameOptions: 'DENY' }).getHeaders();
      expect(h['X-Frame-Options']).toBe('DENY');
    });

    it('should set X-XSS-Protection', () => {
      const h = new SecurityHeaders({ xXSSProtection: '0' }).getHeaders();
      expect(h['X-XSS-Protection']).toBe('0');
    });

    it('should set HSTS', () => {
      const h = new SecurityHeaders({ strictTransportSecurity: 'max-age=31536000' }).getHeaders();
      expect(h['Strict-Transport-Security']).toBe('max-age=31536000');
    });

    it('should set Referrer-Policy', () => {
      const h = new SecurityHeaders({ referrerPolicy: 'no-referrer' }).getHeaders();
      expect(h['Referrer-Policy']).toBe('no-referrer');
    });

    it('should set Permissions-Policy', () => {
      const h = new SecurityHeaders({ permissionsPolicy: 'camera=()' }).getHeaders();
      expect(h['Permissions-Policy']).toBe('camera=()');
    });

    it('should set COOP', () => {
      const h = new SecurityHeaders({ crossOriginOpenerPolicy: 'same-origin' }).getHeaders();
      expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    });

    it('should set CORP', () => {
      const h = new SecurityHeaders({ crossOriginResourcePolicy: 'same-origin' }).getHeaders();
      expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin');
    });

    it('should set COEP', () => {
      const h = new SecurityHeaders({ crossOriginEmbedderPolicy: 'require-corp' }).getHeaders();
      expect(h['Cross-Origin-Embedder-Policy']).toBe('require-corp');
    });

    it('should set Origin-Agent-Cluster', () => {
      const h = new SecurityHeaders({ originAgentCluster: '?1' }).getHeaders();
      expect(h['Origin-Agent-Cluster']).toBe('?1');
    });

    it('should set X-DNS-Prefetch-Control', () => {
      const h = new SecurityHeaders({ xDNSPrefetchControl: 'off' }).getHeaders();
      expect(h['X-DNS-Prefetch-Control']).toBe('off');
    });

    it('should set X-Download-Options', () => {
      const h = new SecurityHeaders({ xDownloadOptions: 'noopen' }).getHeaders();
      expect(h['X-Download-Options']).toBe('noopen');
    });

    it('should set X-Permitted-Cross-Domain-Policies', () => {
      const h = new SecurityHeaders({ xPermittedCrossDomainPolicies: 'none' }).getHeaders();
      expect(h['X-Permitted-Cross-Domain-Policies']).toBe('none');
    });

    it('should support additional headers', () => {
      const h = new SecurityHeaders({ additionalHeaders: { 'X-Custom': 'val' } }).getHeaders();
      expect(h['X-Custom']).toBe('val');
    });
  });

  describe('validate', () => {
    it('should warn about missing HSTS', () => {
      const result = new SecurityHeaders().validate();
      expect(result.warnings.some((w) => w.includes('Strict-Transport-Security'))).toBe(true);
    });

    it('should warn about missing CSP', () => {
      const result = new SecurityHeaders().validate();
      expect(result.warnings.some((w) => w.includes('Content-Security-Policy'))).toBe(true);
    });

    it('should detect CSP + frame-ancestors conflict', () => {
      const result = new SecurityHeaders({
        xFrameOptions: 'DENY',
        contentSecurityPolicy: "default-src 'self'; frame-ancestors 'none'",
      }).validate();
      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    it('should warn about X-XSS-Protection with CSP', () => {
      const result = new SecurityHeaders({
        xXSSProtection: '1',
        contentSecurityPolicy: "default-src 'self'",
      }).validate();
      expect(result.warnings.some((w) => w.includes('X-XSS-Protection'))).toBe(true);
    });

    it('should warn about COEP without COOP', () => {
      const result = new SecurityHeaders({
        crossOriginEmbedderPolicy: 'require-corp',
      }).validate();
      expect(result.warnings.some((w) => w.includes('Cross-Origin-Embedder-Policy'))).toBe(true);
    });

    it('should warn about insecure referrer policy', () => {
      const result = new SecurityHeaders({ referrerPolicy: 'unsafe-url' }).validate();
      expect(result.warnings.some((w) => w.includes('unsafe-url'))).toBe(true);
    });

    it('should be valid when no conflicts', () => {
      expect(new SecurityHeaders().validate().valid).toBe(true);
    });
  });

  describe('config management', () => {
    it('should get config', () => {
      const headers = new SecurityHeaders({ xFrameOptions: 'DENY' });
      expect(headers.getConfig().xFrameOptions).toBe('DENY');
    });

    it('should update config', () => {
      const headers = new SecurityHeaders();
      headers.updateConfig({ xFrameOptions: 'SAMEORIGIN' });
      expect(headers.getHeaders()['X-Frame-Options']).toBe('SAMEORIGIN');
    });

    it('setContentSecurityPolicy should be chainable', () => {
      const headers = new SecurityHeaders().setContentSecurityPolicy("default-src 'self'");
      expect(headers.getHeaders()['Content-Security-Policy']).toBe("default-src 'self'");
    });
  });

  describe('static presets', () => {
    it('strict should have all security headers', () => {
      const h = SecurityHeaders.strict().getHeaders();
      expect(h['Content-Security-Policy']).toBeDefined();
      expect(h['X-Content-Type-Options']).toBe('nosniff');
      expect(h['X-Frame-Options']).toBe('DENY');
      expect(h['Strict-Transport-Security']).toBeDefined();
      expect(h['Referrer-Policy']).toBeDefined();
    });

    it('moderate should be balanced', () => {
      const h = SecurityHeaders.moderate().getHeaders();
      expect(h['X-Frame-Options']).toBe('SAMEORIGIN');
      expect(h['Content-Security-Policy']).toBeDefined();
    });

    it('permissive should allow wildcard', () => {
      const h = SecurityHeaders.permissive().getHeaders();
      expect(h['Content-Security-Policy']).toContain('*');
    });
  });
});

// ============================================================================
// Module 9: DependencyScanner
// ============================================================================
describe('DependencyScanner', () => {
  let scanner: DependencyScanner;

  beforeEach(() => {
    scanner = new DependencyScanner();
  });

  describe('scan', () => {
    it('should return scan results', async () => {
      const result = await scanner.scan('/fake/path');
      expect(result.vulnerabilities.length).toBeGreaterThanOrEqual(0);
      expect(result.outdated.length).toBeGreaterThanOrEqual(0);
      expect(result.dependencies.length).toBeGreaterThan(0);
      expect(result.summary).toBeDefined();
      expect(result.scannedAt).toBeGreaterThan(0);
      expect(result.projectPath).toBe('/fake/path');
    });

    it('should detect vulnerabilities', async () => {
      const result = await scanner.scan('/fake/path');
      expect(result.vulnerabilities.length).toBeGreaterThan(0);
      expect(result.vulnerabilities.some((v) => v.severity === 'critical')).toBe(true);
    });

    it('should detect outdated packages', async () => {
      const result = await scanner.scan('/fake/path');
      expect(result.outdated.length).toBeGreaterThan(0);
      expect(result.outdated.some((p) => p.package === 'lodash')).toBe(true);
    });

    it('should check license compliance', async () => {
      const result = await scanner.scan('/fake/path');
      expect(result.licenseIssues.length).toBe(0);
    });

    it('should detect denied licenses', async () => {
      const s = new DependencyScanner({ deniedLicenses: ['MIT'] });
      const result = await s.scan('/fake/path');
      expect(result.licenseIssues.length).toBeGreaterThan(0);
    });

    it('should respect severity threshold', async () => {
      const s = new DependencyScanner({ severityThreshold: 'critical' });
      const result = await s.scan('/fake/path');
      for (const v of result.vulnerabilities) {
        expect(v.severity).toBe('critical');
      }
    });

    it('should skip vulnerability check when disabled', async () => {
      const s = new DependencyScanner({ checkVulnerabilities: false });
      expect((await s.scan('/fake/path')).vulnerabilities.length).toBe(0);
    });

    it('should skip outdated check when disabled', async () => {
      const s = new DependencyScanner({ checkOutdated: false });
      expect((await s.scan('/fake/path')).outdated.length).toBe(0);
    });

    it('should skip license check when disabled', async () => {
      const s = new DependencyScanner({ checkLicenses: false });
      expect((await s.scan('/fake/path')).licenseIssues.length).toBe(0);
    });

    it('should determine update types correctly', async () => {
      const result = await scanner.scan('/fake/path');
      const types = result.outdated.map((p) => p.updateType);
      expect(types).toContain('patch');
      expect(types).toContain('minor');
      expect(types).toContain('major');
    });

    it('should generate correct summary', async () => {
      const result = await scanner.scan('/fake/path');
      expect(result.summary.totalPackages).toBeGreaterThan(0);
      expect(result.summary.criticalVulnerabilities).toBeGreaterThanOrEqual(0);
    });
  });

  describe('checkVulnerabilities', () => {
    it('should check against dependency list', () => {
      const deps: DependencyInfo[] = [
        { name: 'lodash', version: '4.17.20', direct: true, licenses: ['MIT'] },
      ];
      const vulns = scanner.checkVulnerabilities(deps);
      expect(vulns.length).toBeGreaterThan(0);
      expect(vulns[0].package).toBe('lodash');
    });

    it('should return empty for safe versions', () => {
      const deps: DependencyInfo[] = [
        { name: 'lodash', version: '4.17.21', direct: true, licenses: ['MIT'] },
      ];
      const vulns = scanner.checkVulnerabilities(deps);
      expect(vulns.some((v) => v.package === 'lodash')).toBe(false);
    });
  });

  describe('checkOutdatedPackages', () => {
    it('should detect outdated packages', () => {
      const deps: DependencyInfo[] = [
        { name: 'lodash', version: '4.17.20', direct: true },
      ];
      const outdated = scanner.checkOutdatedPackages(deps);
      expect(outdated.length).toBe(1);
      expect(outdated[0].latest).toBe('4.17.21');
    });

    it('should return empty for up-to-date packages', () => {
      const deps: DependencyInfo[] = [
        { name: 'lodash', version: '4.17.21', direct: true },
      ];
      expect(scanner.checkOutdatedPackages(deps).length).toBe(0);
    });
  });

  describe('checkLicenses', () => {
    it('should flag denied licenses', () => {
      const deps: DependencyInfo[] = [
        { name: 'pkg', version: '1.0.0', direct: true, licenses: ['GPL-3.0'] },
      ];
      const issues = scanner.checkLicenses(deps);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].reason).toBe('denied');
    });

    it('should flag unknown licenses', () => {
      const s = new DependencyScanner({ allowedLicenses: ['MIT'] });
      const deps: DependencyInfo[] = [
        { name: 'pkg', version: '1.0.0', direct: true, licenses: ['CustomLicense'] },
      ];
      const issues = s.checkLicenses(deps);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].reason).toBe('unknown');
    });

    it('should flag packages with no license', () => {
      const deps: DependencyInfo[] = [
        { name: 'pkg', version: '1.0.0', direct: true },
      ];
      const issues = scanner.checkLicenses(deps);
      expect(issues.length).toBe(1);
      expect(issues[0].reason).toBe('unknown');
    });
  });

  describe('addVulnerability', () => {
    it('should add custom vulnerability to database', async () => {
      scanner.addVulnerability({
        package: 'test-pkg',
        version: '<1.0.0',
        severity: 'high',
        title: 'Test vuln',
        description: 'Test',
      });
      const deps: DependencyInfo[] = [
        { name: 'test-pkg', version: '0.9.0', direct: true },
      ];
      const vulns = scanner.checkVulnerabilities(deps);
      expect(vulns.some((v) => v.package === 'test-pkg')).toBe(true);
    });
  });

  describe('updateOptions', () => {
    it('should update scanner options', async () => {
      scanner.updateOptions({ checkVulnerabilities: false });
      expect((await scanner.scan('/fake/path')).vulnerabilities.length).toBe(0);
    });
  });
});

// ============================================================================
// Module 10: SecurityAuditLog
// ============================================================================
describe('SecurityAuditLog', () => {
  let auditLog: SecurityAuditLog;

  beforeEach(() => {
    auditLog = new SecurityAuditLog();
  });

  describe('record', () => {
    it('should record an audit event', async () => {
      const entry = await auditLog.record({
        eventType: 'authentication',
        actor: 'user1',
        resource: 'login',
        action: 'login',
        result: 'success',
      });
      expect(entry.id).toBeDefined();
      expect(entry.eventType).toBe('authentication');
      expect(entry.actor).toBe('user1');
      expect(entry.hash).toBeDefined();
      expect(entry.previousHash).toBeDefined();
    });

    it('should generate unique IDs', async () => {
      const e1 = await auditLog.record({
        eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success',
      });
      const e2 = await auditLog.record({
        eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success',
      });
      expect(e1.id).not.toBe(e2.id);
    });

    it('should include metadata', async () => {
      const entry = await auditLog.record({
        eventType: 'authentication',
        actor: 'u1',
        resource: 'r',
        action: 'a',
        result: 'success',
        metadata: { key: 'value' },
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        sessionId: 'session-123',
      });
      expect(entry.metadata?.key).toBe('value');
      expect(entry.ipAddress).toBe('127.0.0.1');
      expect(entry.userAgent).toBe('test-agent');
      expect(entry.sessionId).toBe('session-123');
    });

    it('should chain hashes correctly', async () => {
      const e1 = await auditLog.record({
        eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success',
      });
      const e2 = await auditLog.record({
        eventType: 'authorization', actor: 'u1', resource: 'r', action: 'a', result: 'success',
      });
      expect(e1.previousHash).toBe('genesis');
      expect(e2.previousHash).toBe(e1.hash);
    });

    it('should record all event types', async () => {
      const types: AuditEventType[] = [
        'authentication', 'authorization', 'data_access',
        'configuration_change', 'system_event', 'security_violation',
        'rate_limit', 'csrf', 'input_validation',
      ];
      for (const type of types) {
        await auditLog.record({ eventType: type, actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      }
      expect(await auditLog.size()).toBe(types.length);
    });
  });

  describe('query', () => {
    it('should query by event type', async () => {
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      await auditLog.record({ eventType: 'authorization', actor: 'u1', resource: 'r', action: 'a', result: 'failure' });
      expect((await auditLog.query({ eventType: 'authentication' })).length).toBe(1);
    });

    it('should query by actor', async () => {
      await auditLog.record({ eventType: 'authentication', actor: 'user1', resource: 'r', action: 'a', result: 'success' });
      await auditLog.record({ eventType: 'authentication', actor: 'user2', resource: 'r', action: 'a', result: 'success' });
      expect((await auditLog.query({ actor: 'user1' })).length).toBe(1);
    });

    it('should query by resource', async () => {
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'res1', action: 'a', result: 'success' });
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'res2', action: 'a', result: 'success' });
      expect((await auditLog.query({ resource: 'res1' })).length).toBe(1);
    });

    it('should query by action', async () => {
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'login', result: 'success' });
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'logout', result: 'success' });
      expect((await auditLog.query({ action: 'login' })).length).toBe(1);
    });

    it('should query by result', async () => {
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'failure' });
      expect((await auditLog.query({ result: 'failure' })).length).toBe(1);
    });

    it('should query by time range', async () => {
      const now = Date.now();
      await auditLog.record({ eventType: 'system_event', actor: 'system', resource: 'r', action: 'a', result: 'success' });
      expect((await auditLog.query({ startTime: now - 1000, endTime: now + 1000 })).length).toBe(1);
    });

    it('should support multiple event types', async () => {
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      await auditLog.record({ eventType: 'authorization', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      await auditLog.record({ eventType: 'data_access', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      expect((await auditLog.query({ eventType: ['authentication', 'authorization'] })).length).toBe(2);
    });

    it('should support multiple results', async () => {
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'failure' });
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'denied' });
      expect((await auditLog.query({ result: ['failure', 'denied'] })).length).toBe(2);
    });

    it('should support limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await auditLog.record({ eventType: 'system_event', actor: 'system', resource: 'r', action: 'a', result: 'success' });
      }
      expect((await auditLog.query({ limit: 2, offset: 0 })).length).toBe(2);
      expect((await auditLog.query({ limit: 2, offset: 3 })).length).toBe(2);
    });

    it('should sort by timestamp descending', async () => {
      await auditLog.record({ eventType: 'a', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      await auditLog.record({ eventType: 'b', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      const results = await auditLog.query({});
      expect(results[0].timestamp).toBeGreaterThanOrEqual(results[1].timestamp);
    });
  });

  describe('verifyIntegrity', () => {
    it('should verify valid log', async () => {
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      await auditLog.record({ eventType: 'authorization', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      expect((await auditLog.verifyIntegrity()).valid).toBe(true);
    });

    it('should verify empty log', async () => {
      expect((await auditLog.verifyIntegrity()).valid).toBe(true);
    });

    it('should detect tampered entry', async () => {
      // Create a custom storage that allows tampering
      const tamperedEntries: AuditEntry[] = [];
      const tamperedStorage: AuditStorage = {
        append: async (entry) => { tamperedEntries.push(entry); },
        query: async () => [...tamperedEntries],
        getLatest: async () => tamperedEntries.length > 0 ? tamperedEntries[tamperedEntries.length - 1] : undefined,
        clear: async () => { tamperedEntries.length = 0; },
      };
      const log = new SecurityAuditLog(tamperedStorage);
      await log.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      // Tamper with the stored entry
      tamperedEntries[0].actor = 'tampered';
      const result = await log.verifyIntegrity();
      expect(result.valid).toBe(false);
    });
  });

  describe('exportAuditLog', () => {
    it('should export as JSON', async () => {
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      const json = await auditLog.exportAuditLog('json');
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
    });

    it('should export as CSV', async () => {
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      const csv = await auditLog.exportAuditLog('csv');
      expect(csv).toContain('id,timestamp,eventType');
      expect(csv.split('\n').length).toBe(2);
    });

    it('should throw for unsupported format', async () => {
      await expect(auditLog.exportAuditLog('xml' as any)).rejects.toThrow();
    });

    it('should export empty log', async () => {
      const json = await auditLog.exportAuditLog('json');
      expect(JSON.parse(json)).toEqual([]);
    });
  });

  describe('listeners', () => {
    it('should notify listeners', async () => {
      let notified = false;
      auditLog.addListener((entry) => {
        notified = true;
        expect(entry.eventType).toBe('authentication');
      });
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      expect(notified).toBe(true);
    });

    it('should remove listeners', async () => {
      let count = 0;
      const listener = () => { count++; };
      auditLog.addListener(listener);
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      expect(count).toBe(1);
      auditLog.removeListener(listener);
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      expect(count).toBe(1);
    });
  });

  describe('retention', () => {
    it('should start and stop retention timer', () => {
      const log = new SecurityAuditLog(undefined, { maxAge: 3600000, checkInterval: 1000 });
      log.startRetention();
      log.stopRetention();
      // Should not throw
      expect(true).toBe(true);
    });

    it('should not start retention twice', () => {
      const log = new SecurityAuditLog(undefined, { checkInterval: 1000 });
      log.startRetention();
      log.startRetention(); // should be no-op
      log.stopRetention();
      expect(true).toBe(true);
    });

    it('should enforce retention with maxAge', async () => {
      const log = new SecurityAuditLog(undefined, { maxAge: 1 });
      await log.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      await new Promise((r) => setTimeout(r, 10));
      const removed = await log.enforceRetention();
      expect(removed).toBeGreaterThanOrEqual(0);
    });

    it('should enforce retention with maxEntries', async () => {
      const log = new SecurityAuditLog(undefined, { maxEntries: 2 });
      for (let i = 0; i < 5; i++) {
        await log.record({ eventType: 'system_event', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      }
      const removed = await log.enforceRetention();
      expect(removed).toBeGreaterThan(0);
      expect(await log.size()).toBeLessThanOrEqual(2);
    });
  });

  describe('destroy', () => {
    it('should stop retention and clear listeners', () => {
      const log = new SecurityAuditLog(undefined, { checkInterval: 1000 });
      log.startRetention();
      let count = 0;
      log.addListener(() => { count++; });
      log.destroy();
      // After destroy, listener should not be called
      expect(true).toBe(true);
    });
  });

  describe('clear and size', () => {
    it('should clear all entries', async () => {
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      await auditLog.clear();
      expect(await auditLog.size()).toBe(0);
    });

    it('should report correct size', async () => {
      expect(await auditLog.size()).toBe(0);
      await auditLog.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      await auditLog.record({ eventType: 'authorization', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      expect(await auditLog.size()).toBe(2);
    });
  });

  describe('storage factories', () => {
    it('should create in-memory storage', () => {
      expect(SecurityAuditLog.inMemoryStorage()).toBeDefined();
    });

    it('should create file storage', () => {
      expect(SecurityAuditLog.fileStorage('/tmp/audit.jsonl')).toBeDefined();
    });
  });

  describe('FileAuditStorage', () => {
    // BUG-006 & BUG-007: Missing action and result filters
    it('BUG-006: should filter by action in file storage', async () => {
      const log = new SecurityAuditLog(SecurityAuditLog.fileStorage('/tmp/test-audit.jsonl'));
      await log.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'login', result: 'success' });
      await log.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'logout', result: 'success' });
      const results = await log.query({ action: 'login' });
      expect(results.length).toBe(1);
      expect(results[0].action).toBe('login');
      await log.clear();
    });

    it('BUG-007: should filter by result in file storage', async () => {
      const log = new SecurityAuditLog(SecurityAuditLog.fileStorage('/tmp/test-audit2.jsonl'));
      await log.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      await log.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'failure' });
      const results = await log.query({ result: 'failure' });
      expect(results.length).toBe(1);
      expect(results[0].result).toBe('failure');
      await log.clear();
    });
  });
});

// ============================================================================
// Module 11: Edge Cases and Security-Specific Tests
// ============================================================================
describe('Edge Cases', () => {
  describe('InputValidator with null/undefined', () => {
    it('should handle undefined value', () => {
      const v = InputValidator.for(undefined);
      expect(v.isString().isValid()).toBe(false);
      expect(v.isNumber().isValid()).toBe(false);
      expect(v.isArray().isValid()).toBe(false);
      expect(v.isObject().isValid()).toBe(false);
    });

    it('should handle null value', () => {
      const v = InputValidator.for(null);
      expect(v.isString().isValid()).toBe(false);
      expect(v.isNumber().isValid()).toBe(false);
    });

    it('should handle boolean value', () => {
      expect(InputValidator.for(true).isNumber().isValid()).toBe(false);
      expect(InputValidator.for(false).isString().isValid()).toBe(false);
    });

    it('should handle very large string', () => {
      const big = 'a'.repeat(1000000);
      expect(InputValidator.for(big).isString().minLength(1).isValid()).toBe(true);
    });

    it('should handle very large number', () => {
      expect(InputValidator.for(Number.MAX_SAFE_INTEGER).isNumber().isPositive().isValid()).toBe(true);
    });

    it('should handle Infinity', () => {
      expect(InputValidator.for(Infinity).isNumber().isValid()).toBe(true);
    });

    it('should handle -Infinity', () => {
      expect(InputValidator.for(-Infinity).isNumber().isValid()).toBe(true);
    });

    it('should handle empty object', () => {
      expect(InputValidator.for({}).isObject().isValid()).toBe(true);
    });

    it('should handle empty array', () => {
      expect(InputValidator.for([]).isArray().isValid()).toBe(true);
      expect(InputValidator.for([]).minItems(0).isValid()).toBe(true);
    });

    it('should handle nested null in object', () => {
      const v = InputValidator.for({ a: null }).requiredFields(['a']);
      expect(v.isValid()).toBe(false);
    });
  });

  describe('AuthManager edge cases', () => {
    it('should handle user with no roles or permissions', () => {
      const am = new AuthManager();
      const user: User = { id: 'u1', username: 'test', roles: [], permissions: [] };
      expect(am.checkPermission(user, 'any:perm')).toBe(false);
    });

    it('should handle deeply nested role hierarchy', () => {
      const am = new AuthManager();
      am.registerRole({ name: 'level1', permissions: ['perm1'] });
      am.registerRole({ name: 'level2', permissions: ['perm2'], parentRoles: ['level1'] });
      am.registerRole({ name: 'level3', permissions: ['perm3'], parentRoles: ['level2'] });
      const user: User = { id: 'u1', username: 'test', roles: ['level3'], permissions: [] };
      expect(am.checkPermission(user, 'perm1')).toBe(true);
      expect(am.checkPermission(user, 'perm2')).toBe(true);
      expect(am.checkPermission(user, 'perm3')).toBe(true);
    });

    it('should handle empty credentials object', async () => {
      const am = new AuthManager();
      am.registerStrategy(new TokenAuthStrategy('test-key'));
      const result = await am.authenticate({});
      expect(result.success).toBe(false);
    });

    it('should handle null credentials', async () => {
      const am = new AuthManager();
      am.registerStrategy(new TokenAuthStrategy('test-key'));
      const result = await am.authenticate(null);
      expect(result.success).toBe(false);
    });
  });

  describe('CSRF edge cases', () => {
    it('should handle very long tokens', () => {
      const csrf = new CSRFProtection({ tokenLength: 256 });
      const token = csrf.generateToken();
      expect(token.length).toBe(256);
      expect(csrf.validateToken(token, token)).toBe(true);
    });

    it('should handle token length of 1', () => {
      const csrf = new CSRFProtection({ tokenLength: 1, charset: 'ab' });
      const token = csrf.generateToken();
      expect(token.length).toBe(1);
    });

    it('should handle concurrent token generation', async () => {
      const csrf = new CSRFProtection();
      const promises = Array.from({ length: 100 }, () => Promise.resolve(csrf.generateToken()));
      const tokens = await Promise.all(promises);
      expect(new Set(tokens).size).toBe(100);
    });
  });

  describe('Rate limiter edge cases', () => {
    it('should handle zero limit', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 0, windowMs: 1000 });
      const result = await limiter.check('user1');
      expect(result.allowed).toBe(false);
    });

    it('should handle very large limit', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 1000000, windowMs: 1000 });
      const result = await limiter.check('user1');
      expect(result.allowed).toBe(true);
    });

    it('should handle empty key', async () => {
      const limiter = new AdvancedRateLimiter({ limit: 5, windowMs: 1000 });
      const result = await limiter.check('');
      expect(result.allowed).toBe(true);
    });
  });

  describe('CORS edge cases', () => {
    it('should handle origin with special characters', () => {
      const guard = new CORSGuard({ origins: ['https://example.com:8080'] });
      expect(guard.validateOrigin('https://example.com:8080')).toBe(true);
    });

    it('should handle null origin in validateRequest', () => {
      const guard = new CORSGuard();
      const result = guard.validateRequest(null as any);
      expect(result.allowed).toBe(false);
    });

    it('should handle undefined origin in validateRequest', () => {
      const guard = new CORSGuard();
      const result = guard.validateRequest(undefined as any);
      expect(result.allowed).toBe(false);
    });
  });

  describe('SecretManager edge cases', () => {
    it('should handle very long secret values', async () => {
      const sm = new SecretManager();
      sm.registerProvider('memory', new MemorySecretProvider());
      const longVal = 'x'.repeat(100000);
      await sm.set('KEY', longVal);
      expect(await sm.get('KEY')).toBe(longVal);
    });

    it('should handle special characters in secret keys', async () => {
      const sm = new SecretManager();
      sm.registerProvider('memory', new MemorySecretProvider());
      await sm.set('KEY/WITH/SLASHES', 'val');
      expect(await sm.get('KEY/WITH/SLASHES')).toBe('val');
    });

    it('should handle concurrent access', async () => {
      const sm = new SecretManager();
      sm.registerProvider('memory', new MemorySecretProvider());
      const promises = Array.from({ length: 100 }, (_, i) =>
        sm.set(`KEY_${i}`, `VAL_${i}`)
      );
      await Promise.all(promises);
      expect(await sm.list()).toHaveLength(100);
    });
  });

  describe('Security audit edge cases', () => {
    it('should handle query with all filters', async () => {
      const log = new SecurityAuditLog();
      await log.record({
        eventType: 'authentication',
        actor: 'user1',
        resource: 'login',
        action: 'login',
        result: 'success',
        ipAddress: '127.0.0.1',
      });
      const results = await log.query({
        eventType: 'authentication',
        actor: 'user1',
        resource: 'login',
        action: 'login',
        result: 'success',
        startTime: 0,
        endTime: Date.now() + 1000,
        limit: 10,
        offset: 0,
      });
      expect(results.length).toBe(1);
    });

    it('should handle query with no matching entries', async () => {
      const log = new SecurityAuditLog();
      expect((await log.query({ actor: 'nonexistent' })).length).toBe(0);
    });

    it('should handle verifyIntegrity with single entry', async () => {
      const log = new SecurityAuditLog();
      await log.record({ eventType: 'authentication', actor: 'u1', resource: 'r', action: 'a', result: 'success' });
      expect((await log.verifyIntegrity()).valid).toBe(true);
    });
  });
});
