/**
 * 配置加密模块
 * 使用 AES-256-GCM 加密敏感配置值
 * 支持自动检测加密值和透明加解密
 */

const ENCRYPTED_PREFIX = 'enc:';

/**
 * ConfigEncryption - 配置加密器
 */
export class ConfigEncryption {
  private masterKeys: Map<string, CryptoKey> = new Map();

  /**
   * 检查值是否为加密值
   */
  isEncrypted(value: string): boolean {
    return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
  }

  /**
   * 从密码派生 AES-256-GCM 密钥
   */
  async deriveKey(password: string, salt?: Uint8Array): Promise<CryptoKey> {
    if (this.masterKeys.has(password)) {
      return this.masterKeys.get(password)!;
    }

    const actualSalt = salt || crypto.getRandomValues(new Uint8Array(16));
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: actualSalt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );

    this.masterKeys.set(password, key);
    return key;
  }

  /**
   * 加密字符串值
   */
  async encrypt(value: string, key: string): Promise<string> {
    const cryptoKey = await this.deriveKey(key);
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encoder.encode(value),
    );

    // Combine iv + ciphertext and encode as base64
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    return ENCRYPTED_PREFIX + btoa(String.fromCharCode(...combined));
  }

  /**
   * 解密字符串值
   */
  async decrypt(encrypted: string, key: string): Promise<string> {
    if (!this.isEncrypted(encrypted)) {
      throw new Error('Value is not encrypted');
    }

    const cryptoKey = await this.deriveKey(key);
    const raw = atob(encrypted.slice(ENCRYPTED_PREFIX.length));
    const combined = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      combined[i] = raw.charCodeAt(i);
    }

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  }

  /**
   * 设置加密密钥值（同步包装，返回 Promise）
   */
  async setSecret(
    path: string,
    value: string,
    masterKey: string,
    store: { set: (path: string, value: unknown) => void },
  ): Promise<void> {
    const encrypted = await this.encrypt(value, masterKey);
    store.set(path, encrypted);
  }

  /**
   * 获取并解密密钥值
   */
  async getSecret(
    path: string,
    masterKey: string,
    store: { get: (path: string) => unknown },
  ): Promise<string> {
    const value = store.get(path);
    if (value === undefined || value === null) {
      throw new Error(`No value found at path: ${path}`);
    }
    if (typeof value !== 'string') {
      throw new Error(`Value at path "${path}" is not a string`);
    }
    if (!this.isEncrypted(value)) {
      throw new Error(`Value at path "${path}" is not encrypted`);
    }
    return await this.decrypt(value, masterKey);
  }

  /**
   * 清除缓存的密钥
   */
  clearKeyCache(): void {
    this.masterKeys.clear();
  }
}
