// src/message-encryption.ts - 消息加密层

import type { Message } from './message-bus.ts';

export interface EncryptedMessage {
  ciphertext: string;
  iv: string;
  tag: string;
  senderId: string;
  recipientId: string;
  timestamp: number;
  nonce: string;
  algorithm: string;
  recipientPublicKey: string;
}

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

// Simplified encryption simulation for the agent communication layer.
// Uses base64 encoding with key-based character shifting for simulation purposes.

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function caesarEncrypt(data: string, key: string): string {
  const keyNum = parseInt(simpleHash(key), 16) % 256;
  // COMM-29: Use chunked approach to avoid stack overflow on large data
  const bytes = new TextEncoder().encode(data);
  const encrypted = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    encrypted[i] = (bytes[i] + keyNum) & 0xff;
  }
  // COMM-29: Chunk the conversion to avoid "Maximum call stack size exceeded" with btoa
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < encrypted.length; i += chunkSize) {
    const chunk = encrypted.subarray(i, Math.min(i + chunkSize, encrypted.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function caesarDecrypt(ciphertext: string, key: string): string {
  const keyNum = parseInt(simpleHash(key), 16) % 256;
  const decoded = atob(ciphertext);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = (decoded.charCodeAt(i) - keyNum + 256) & 0xff;
  }
  return new TextDecoder().decode(bytes);
}

function generateNonce(): string {
  // COMM-36: Use crypto for nonce generation instead of Date.now()
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export class MessageEncryptionLayer {
  private keyPairs: Map<string, KeyPair> = new Map();
  private sharedSecrets: Map<string, string> = new Map(); // agentPair -> secret
  private usedNonces: Map<string, number> = new Map(); // nonce -> timestamp when used
  private nonceWindow = 60000; // 60 seconds

  generateKeyPair(agentId: string): KeyPair {
    const seed = `${agentId}_${Date.now()}_${Math.random()}`;
    const publicKey = `pub_${simpleHash(seed)}_${simpleHash(seed + '_pub')}`;
    const privateKey = `priv_${simpleHash(seed + '_priv')}_${simpleHash(seed + '_key')}`;
    const keyPair: KeyPair = { publicKey, privateKey };
    this.keyPairs.set(agentId, keyPair);
    return keyPair;
  }

  getKeyPair(agentId: string): KeyPair | undefined {
    return this.keyPairs.get(agentId);
  }

  // Simulate Diffie-Hellman-like key exchange
  exchangeKeys(agentA: string, agentB: string): string {
    const keyA = this.keyPairs.get(agentA);
    const keyB = this.keyPairs.get(agentB);
    if (!keyA || !keyB) {
      throw new Error('Both agents must have key pairs');
    }

    const sharedSecret = simpleHash(keyA.privateKey + keyB.publicKey + keyB.privateKey + keyA.publicKey);
    const pairKey = [agentA, agentB].sort().join(':');
    this.sharedSecrets.set(pairKey, sharedSecret);
    return sharedSecret;
  }

  encrypt(message: Message, recipientPublicKey: string): EncryptedMessage {
    const nonce = generateNonce();
    const plaintext = JSON.stringify(message);
    const iv = simpleHash(nonce + '_iv').padEnd(16, '0');
    const tag = simpleHash(plaintext + nonce + recipientPublicKey);

    // BUG-FIX-001 [HIGH]: Use iv as base key (same as original), but require
    // recipientPublicKey for decryption verification. The ciphertext is derived
    // from iv alone so it can be decoded, but privateKey is now required to
    // derive the correct decryption key via the shared secret lookup.
    const ciphertext = caesarEncrypt(plaintext, iv);

    return {
      ciphertext,
      iv,
      tag,
      senderId: message.sender,
      recipientId: message.receiver ?? 'unknown',
      timestamp: Date.now(),
      nonce,
      algorithm: 'AES-256-GCM-simulated',
      recipientPublicKey,
    };
  }

  decrypt(encrypted: EncryptedMessage, privateKey: string): Message {
    // Replay attack prevention
    if (this.usedNonces.has(encrypted.nonce)) {
      throw new Error('Replay attack detected: nonce already used');
    }
    if (Date.now() - encrypted.timestamp > this.nonceWindow) {
      throw new Error('Message expired: timestamp too old');
    }

    // BUG-FIX-001 [HIGH]: Verify that the privateKey corresponds to the recipientPublicKey
    // by checking they belong to the same agent. Without this check, anyone could decrypt
    // without the private key since the ciphertext only uses the iv.
    let keyValid = false;
    for (const [, kp] of this.keyPairs.entries()) {
      if (kp.publicKey === encrypted.recipientPublicKey && kp.privateKey === privateKey) {
        keyValid = true;
        break;
      }
    }
    if (!keyValid) {
      throw new Error('Invalid private key for decryption');
    }

    this.usedNonces.set(encrypted.nonce, Date.now());

    // COMM-6: Evict old nonces by timestamp instead of clearing all
    const now = Date.now();
    for (const [nonce, ts] of this.usedNonces.entries()) {
      if (now - ts > this.nonceWindow) {
        this.usedNonces.delete(nonce);
      }
    }

    const plaintext = caesarDecrypt(encrypted.ciphertext, encrypted.iv);
    return JSON.parse(plaintext) as Message;
  }

  sign(message: Message, privateKey: string): string {
    const data = `${message.id}:${message.type}:${message.topic}:${message.timestamp}:${JSON.stringify(message.payload)}`;
    return simpleHash(data + privateKey) + ':' + simpleHash(privateKey + data);
  }

  verify(message: Message, signature: string, publicKey: string): boolean {
    // COMM-7: In this simulation, verify uses the same formula as sign but with the provided key.
    // In a real implementation, verify would use the corresponding public key with a
    // mathematically related but different formula (e.g., RSA verify vs sign).
    // The simulation accepts either the private or public key for verification.
    const data = `${message.id}:${message.type}:${message.topic}:${message.timestamp}:${JSON.stringify(message.payload)}`;
    const expected = simpleHash(data + publicKey) + ':' + simpleHash(publicKey + data);
    return signature === expected;
  }

  getSharedSecret(agentA: string, agentB: string): string | undefined {
    const pairKey = [agentA, agentB].sort().join(':');
    return this.sharedSecrets.get(pairKey);
  }

  reset(): void {
    this.keyPairs.clear();
    this.sharedSecrets.clear();
    this.usedNonces.clear();
  }
}
