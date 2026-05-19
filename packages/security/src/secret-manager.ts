// src/secret-manager.ts - 密钥与敏感数据管理

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface SecretProvider {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete?(key: string): Promise<void>;
  list?(): Promise<string[]>;
}

export interface SecretVersion {
  value: string;
  version: number;
  createdAt: number;
  expiresAt?: number;
}

export interface SecretReference {
  key: string;
  version?: number;
  resolve(): Promise<string | undefined>;
}

export interface SecretCacheEntry {
  value: string;
  fetchedAt: number;
  expiresAt: number;
  ttl: number;
}

export class EnvSecretProvider implements SecretProvider {
  private prefix: string;

  constructor(prefix: string = '') {
    this.prefix = prefix;
  }

  async get(key: string): Promise<string | undefined> {
    const envKey = this.prefix ? `${this.prefix}_${key}` : key;
    return process.env[envKey];
  }

  async set(key: string, value: string): Promise<void> {
    const envKey = this.prefix ? `${this.prefix}_${key}` : key;
    process.env[envKey] = value;
  }

  async delete(key: string): Promise<void> {
    const envKey = this.prefix ? `${this.prefix}_${key}` : key;
    delete process.env[envKey];
  }

  async list(): Promise<string[]> {
    const prefix = this.prefix ? `${this.prefix}_` : '';
    return Object.keys(process.env)
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }
}

export class FileSecretProvider implements SecretProvider {
  private secrets: Map<string, string> = new Map();
  private encryptionKey: string;
  private filePath: string;
  private algorithm = 'aes-256-cbc';

  constructor(encryptionKey?: string, filePath: string = '/tmp/secrets.enc') {
    if (!encryptionKey) {
      throw new Error('FileSecretProvider requires an encryptionKey parameter. Using a hardcoded default is a security risk.');
    }
    // Ensure the key is exactly 32 bytes for AES-256
    this.encryptionKey = Buffer.from(encryptionKey).slice(0, 32).length >= 16
      ? Buffer.from(encryptionKey.padEnd(32, '0').slice(0, 32)).toString('utf-8')
      : (() => { throw new Error('encryptionKey must be at least 16 characters long for AES encryption.'); })();
    this.filePath = filePath;
  }

  private async encrypt(value: string): Promise<string> {
    const iv = randomBytes(16);
    const keyBuffer = Buffer.from(this.encryptionKey.slice(0, 32), 'utf-8');
    const cipher = createCipheriv(this.algorithm, keyBuffer, iv);
    let encrypted = cipher.update(value, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const ivHex = iv.toString('hex');
    return `enc:${ivHex}:${encrypted}`;
  }

  private async decrypt(encrypted: string): Promise<string> {
    if (!encrypted.startsWith('enc:')) return encrypted;
    const parts = encrypted.split(':');
    if (parts.length < 3) return encrypted;
    const iv = Buffer.from(parts[1], 'hex');
    const encryptedData = parts.slice(2).join(':');
    const keyBuffer = Buffer.from(this.encryptionKey.slice(0, 32), 'utf-8');
    try {
      const decipher = createDecipheriv(this.algorithm, keyBuffer, iv);
      let decrypted = decipher.update(encryptedData, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');
      return decrypted;
    } catch {
      // If decryption fails, return original (for backward compatibility with old format)
      return encrypted;
    }
  }

  async get(key: string): Promise<string | undefined> {
    const encrypted = this.secrets.get(key);
    if (!encrypted) return undefined;
    return this.decrypt(encrypted);
  }

  async set(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(value);
    this.secrets.set(key, encrypted);
  }

  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  async list(): Promise<string[]> {
    return Array.from(this.secrets.keys());
  }
}

export class MemorySecretProvider implements SecretProvider {
  private secrets: Map<string, string> = new Map();

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  async list(): Promise<string[]> {
    return Array.from(this.secrets.keys());
  }

  clear(): void {
    this.secrets.clear();
  }
}

export class SecretManager {
  private providers: Map<string, SecretProvider> = new Map();
  private defaultProvider: string | null = null;
  private versions: Map<string, SecretVersion[]> = new Map();
  private cache: Map<string, SecretCacheEntry> = new Map();
  private defaultTTL: number;
  private rotationCallbacks: Map<string, Array<(key: string, oldVersion: number, newVersion: number) => void>> = new Map();

  constructor(options?: { defaultTTL?: number }) {
    this.defaultTTL = options?.defaultTTL ?? 300000; // 5 minutes default
  }

  /**
   * Register a secret provider
   */
  registerProvider(name: string, provider: SecretProvider): void {
    this.providers.set(name, provider);
    if (!this.defaultProvider) {
      this.defaultProvider = name;
    }
  }

  /**
   * Set the default provider
   */
  setDefaultProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider "${name}" not found`);
    }
    this.defaultProvider = name;
  }

  /**
   * Get a secret value
   */
  async get(key: string, providerName?: string): Promise<string | undefined> {
    // Check cache first
    const cacheKey = providerName ? `${providerName}:${key}` : key;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const provider = this.getProvider(providerName);
    if (!provider) return undefined;

    const value = await provider.get(key);
    if (value !== undefined) {
      // Cache the value
      this.cache.set(cacheKey, {
        value,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + this.defaultTTL,
        ttl: this.defaultTTL,
      });
    }

    return value;
  }

  /**
   * Set a secret value with versioning
   */
  async set(key: string, value: string, providerName?: string): Promise<void> {
    const provider = this.getProvider(providerName);
    if (!provider) throw new Error('No secret provider available');

    await provider.set(key, value);

    // Track version
    const versions = this.versions.get(key) || [];
    const newVersion: SecretVersion = {
      value,
      version: versions.length + 1,
      createdAt: Date.now(),
    };
    versions.push(newVersion);
    this.versions.set(key, versions);

    // Invalidate cache
    this.cache.delete(providerName ? `${providerName}:${key}` : key);
    this.cache.delete(key);
  }

  /**
   * Delete a secret
   */
  async delete(key: string, providerName?: string): Promise<void> {
    const provider = this.getProvider(providerName);
    if (!provider) return;

    if (provider.delete) {
      await provider.delete(key);
    }

    // Clear cache
    this.cache.delete(providerName ? `${providerName}:${key}` : key);
    this.cache.delete(key);

    // Clear versions
    this.versions.delete(key);
  }

  /**
   * Rotate a secret to a new version
   */
  async rotate(key: string, newValue: string, providerName?: string): Promise<number> {
    const versions = this.versions.get(key) || [];
    const oldVersion = versions.length;

    await this.set(key, newValue, providerName);

    const newVersions = this.versions.get(key)!;
    const newVersionNum = newVersions.length;

    // Trigger rotation callbacks
    const callbacks = this.rotationCallbacks.get(key) || [];
    for (const cb of callbacks) {
      cb(key, oldVersion, newVersionNum);
    }

    return newVersionNum;
  }

  /**
   * Get a specific version of a secret
   */
  getVersion(key: string, version: number): SecretVersion | undefined {
    const versions = this.versions.get(key);
    if (!versions) return undefined;
    return versions.find((v) => v.version === version);
  }

  /**
   * Get all versions of a secret
   */
  getVersions(key: string): SecretVersion[] {
    return this.versions.get(key) || [];
  }

  /**
   * Register a rotation callback
   */
  onRotation(key: string, callback: (key: string, oldVersion: number, newVersion: number) => void): void {
    const callbacks = this.rotationCallbacks.get(key) || [];
    callbacks.push(callback);
    this.rotationCallbacks.set(key, callbacks);
  }

  /**
   * Create a deferred secret reference
   */
  createReference(key: string, version?: number): SecretReference {
    const manager = this;
    return {
      key,
      version,
      async resolve(): Promise<string | undefined> {
        if (version !== undefined) {
          const v = manager.getVersion(key, version);
          return v?.value;
        }
        return manager.get(key);
      },
    };
  }

  /**
   * Mask secrets in text
   */
  static maskSecrets(text: string, secrets: string[]): string {
    let masked = text;
    for (const secret of secrets) {
      if (secret.length === 0) continue;
      if (secret.length <= 4) {
        masked = masked.split(secret).join('****');
      } else {
        const visible = secret.slice(0, 2) + '...' + secret.slice(-2);
        masked = masked.split(secret).join(visible);
      }
    }
    return masked;
  }

  /**
   * Clear all cached secrets
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Set default TTL for cached secrets
   */
  setDefaultTTL(ttl: number): void {
    this.defaultTTL = ttl;
  }

  /**
   * List all secrets from a provider
   */
  async list(providerName?: string): Promise<string[]> {
    const provider = this.getProvider(providerName);
    if (!provider || !provider.list) return [];
    return provider.list();
  }

  private getProvider(name?: string): SecretProvider | undefined {
    const providerName = name || this.defaultProvider;
    if (!providerName) return undefined;
    return this.providers.get(providerName);
  }
}
