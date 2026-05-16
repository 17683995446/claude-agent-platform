// src/storage-encryption.ts - 存储加密层

import type {
  IStorage,
  SetOptions,
  StorageEntry,
  StorageStats,
} from './storage-interface.ts';
import { NamespacedStorage } from './storage-interface.ts';
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

/**
 * 加密配置选项
 */
export interface EncryptionOptions {
  /** 加密密码 */
  passphrase: string;
  /** 加密算法 */
  algorithm?: string;
  /** 密钥长度 */
  keyLength?: number;
  /** PBKDF2 迭代次数 */
  iterations?: number;
  /** 盐值（可选，不提供则自动生成） */
  salt?: string;
}

const DEFAULT_ALGORITHM = 'aes-256-gcm';
const DEFAULT_KEY_LENGTH = 32;
const DEFAULT_ITERATIONS = 100000;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

/**
 * 加密后的存储条目格式
 */
interface EncryptedPayload {
  __encrypted: true;
  algorithm: string;
  iv: string;
  salt: string;
  authTag: string;
  data: string;
  keyId?: string;
}

/**
 * 存储加密装饰器
 * - AES-256-GCM 加密
 * - PBKDF2 密钥派生
 * - 每条目唯一 IV
 * - 透明加密/解密
 * - 密钥轮换与重新加密
 */
export class EncryptedStorage<T> implements IStorage<T> {
  private readonly inner: IStorage<T>;
  private readonly algorithm: string;
  private readonly keyLength: number;
  private readonly iterations: number;
  private readonly salt: string;
  private derivedKey: Buffer;
  private keyId?: string;

  private constructor(inner: IStorage<T>, options: EncryptionOptions) {
    this.inner = inner;
    this.algorithm = options.algorithm ?? DEFAULT_ALGORITHM;
    this.keyLength = options.keyLength ?? DEFAULT_KEY_LENGTH;
    this.iterations = options.iterations ?? DEFAULT_ITERATIONS;
    this.salt = options.salt ?? randomBytes(SALT_LENGTH).toString('hex');
    this.derivedKey = this.deriveKey(options.passphrase, this.salt);
  }

  /**
   * 包装存储实例为加密存储
   */
  static wrap<T>(storage: IStorage<T>, options: EncryptionOptions): EncryptedStorage<T> {
    return new EncryptedStorage<T>(storage, options);
  }

  private deriveKey(passphrase: string, salt: string): Buffer {
    return pbkdf2Sync(passphrase, salt, this.iterations, this.keyLength, 'sha512');
  }

  private encrypt(value: T): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(this.algorithm, this.derivedKey, iv);

    const plaintext = JSON.stringify(value);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);

    return {
      __encrypted: true,
      algorithm: this.algorithm,
      iv: iv.toString('hex'),
      salt: this.salt,
      authTag: cipher.getAuthTag().toString('hex'),
      data: encrypted.toString('hex'),
      keyId: this.keyId,
    };
  }

  private decrypt(payload: EncryptedPayload): T {
    const iv = Buffer.from(payload.iv, 'hex');
    const authTag = Buffer.from(payload.authTag, 'hex');
    const encrypted = Buffer.from(payload.data, 'hex');

    const key = payload.salt === this.salt
      ? this.derivedKey
      : this.deriveKey('', payload.salt); // 需要原始密码才能解密旧数据

    const decipher = createDecipheriv(payload.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf-8'));
  }

  private isEncryptedPayload(value: unknown): value is EncryptedPayload {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as EncryptedPayload).__encrypted === true
    );
  }

  // ---- IStorage 接口实现 ----

  async get(key: string): Promise<T | undefined> {
    const raw = await this.inner.get(key);
    if (raw === undefined) return undefined;

    if (this.isEncryptedPayload(raw)) {
      try {
        return this.decrypt(raw);
      } catch {
        return undefined;
      }
    }

    // 未加密的数据直接返回
    return raw as T;
  }

  async set(key: string, value: T, options?: SetOptions): Promise<void> {
    const encrypted = this.encrypt(value);
    await this.inner.set(key, encrypted as unknown as T, options);
  }

  async delete(key: string): Promise<boolean> {
    return this.inner.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.inner.has(key);
  }

  async keys(pattern?: string): Promise<string[]> {
    return this.inner.keys(pattern);
  }

  async clear(): Promise<void> {
    return this.inner.clear();
  }

  async size(): Promise<number> {
    return this.inner.size();
  }

  namespace(name: string): IStorage<T> {
    return new NamespacedStorage(this, name);
  }

  async stats(): Promise<StorageStats> {
    return this.inner.stats();
  }

  async getEntry(key: string): Promise<StorageEntry<T> | undefined> {
    const entry = await this.inner.getEntry(key);
    if (!entry) return undefined;

    if (this.isEncryptedPayload(entry.value)) {
      try {
        return {
          ...entry,
          value: this.decrypt(entry.value),
        };
      } catch {
        return undefined;
      }
    }

    return entry;
  }

  // ---- 密钥轮换 ----

  /**
   * 使用新密码重新加密所有数据
   */
  async rotateKey(newPassphrase: string, newSalt?: string): Promise<number> {
    const allKeys = await this.inner.keys();
    let rotated = 0;

    for (const key of allKeys) {
      const raw = await this.inner.get(key);
      if (raw === undefined) continue;

      if (this.isEncryptedPayload(raw)) {
        try {
          // 先用当前密钥解密
          const value = this.decrypt(raw);
          // 更新密钥
          this.salt = newSalt ?? randomBytes(SALT_LENGTH).toString('hex');
          this.derivedKey = this.deriveKey(newPassphrase, this.salt);
          // 用新密钥重新加密
          const reEncrypted = this.encrypt(value);
          await this.inner.set(key, reEncrypted as unknown as T);
          rotated++;
        } catch {
          // 跳过无法解密的条目
        }
      }
    }

    return rotated;
  }
}
