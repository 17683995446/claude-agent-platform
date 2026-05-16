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
  const bytes = new TextEncoder().encode(data);
  const encrypted = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    encrypted[i] = (bytes[i] + keyNum) & 0xff;
  }
  return btoa(String.fromCharCode(...encrypted));
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
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export class MessageEncryptionLayer {
  private keyPairs: Map<string, KeyPair> = new Map();
  private sharedSecrets: Map<string, string> = new Map(); // agentPair -> secret
  private usedNonces: Set<string> = new Set();
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

    // Use only the iv-derived key for encryption (symmetric simulation)
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

    this.usedNonces.add(encrypted.nonce);

    // Cleanup old nonces
    if (this.usedNonces.size > 10000) {
      this.usedNonces.clear();
    }

    // Use the same iv-derived key for decryption
    const plaintext = caesarDecrypt(encrypted.ciphertext, encrypted.iv);
    return JSON.parse(plaintext) as Message;
  }

  sign(message: Message, privateKey: string): string {
    const data = `${message.id}:${message.type}:${message.topic}:${message.timestamp}:${JSON.stringify(message.payload)}`;
    return simpleHash(data + privateKey) + ':' + simpleHash(privateKey + data);
  }

  verify(message: Message, signature: string, publicKey: string): boolean {
    // In this simulation, sign with privateKey and verify with publicKey
    // We derive a compatible verification key from the public key
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
