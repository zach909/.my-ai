import { generateKeyPairSync, createSign, createVerify } from 'node:crypto';
import type { PluginDefinition } from "../plugin_manager/types.js";
import { BasePlugin } from "../plugin_manager/sdk.js";

interface StoredKey {
  id: string;
  name: string;
  publicKey: string;
  privateKey: string;
  algorithm: string;
  createdAt: number;
  lastUsed?: number;
}

export interface Passkey {
  id: string;
  name: string;
  publicKey: string;
  algorithm: string;
  createdAt: number;
  lastUsed?: number;
}

export class PasskeysPlugin extends BasePlugin {
  private keys: StoredKey[] = [];

  constructor(definition: PluginDefinition) {
    super(definition);
  }

  async create(name: string): Promise<Passkey> {
    if (typeof name !== "string") {
      throw new Error("Security Error: Passkey name must be a string.");
    }
    if (!name || name.trim().length === 0) {
      throw new Error("Security Error: Passkey name cannot be empty.");
    }
    if (name.length > 100) {
      throw new Error("Security Error: Passkey name exceeds maximum length limit of 100 characters.");
    }
    const safeRegex = /^[a-zA-Z0-9_+\-. @]+$/;
    if (!safeRegex.test(name)) {
      throw new Error("Security Error: Passkey name contains invalid characters.");
    }

    const { publicKey, privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const stored: StoredKey = {
      id: `pk-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      publicKey,
      privateKey,
      algorithm: "ES256",
      createdAt: Date.now(),
    };
    this.keys.push(stored);
    return this.toPublic(stored);
  }

  async list(): Promise<Passkey[]> {
    return this.keys.map(k => this.toPublic(k));
  }

  async remove(id: string): Promise<boolean> {
    if (typeof id !== "string") {
      throw new Error("Security Error: Passkey ID must be a string.");
    }
    if (id.length > 100) {
      throw new Error("Security Error: Passkey ID exceeds maximum length limit.");
    }

    const idx = this.keys.findIndex(k => k.id === id);
    if (idx === -1) return false;
    this.keys.splice(idx, 1);
    return true;
  }

  async sign(id: string, data: string): Promise<string | null> {
    if (typeof id !== "string" || typeof data !== "string") {
      throw new Error("Security Error: ID and data must be strings.");
    }
    if (id.length > 100 || data.length > 65536) {
      throw new Error("Security Error: ID or data size limit exceeded.");
    }

    const key = this.keys.find(k => k.id === id);
    if (!key) return null;

    try {
      const signer = createSign('sha256');
      signer.update(data);
      signer.end();
      const signature = signer.sign(key.privateKey, 'base64');
      key.lastUsed = Date.now();
      return signature;
    } catch {
      return null;
    }
  }

  async verify(id: string, data: string, signature: string): Promise<boolean> {
    if (typeof id !== "string" || typeof data !== "string" || typeof signature !== "string") {
      throw new Error("Security Error: ID, data, and signature must be strings.");
    }
    if (id.length > 100 || data.length > 65536 || signature.length > 1024) {
      throw new Error("Security Error: Input size limit exceeded.");
    }

    const key = this.keys.find(k => k.id === id);
    if (!key) return false;

    try {
      const verifier = createVerify('sha256');
      verifier.update(data);
      verifier.end();
      return verifier.verify(key.publicKey, signature, 'base64');
    } catch {
      return false;
    }
  }

  private toPublic(k: StoredKey): Passkey {
    return { id: k.id, name: k.name, publicKey: k.publicKey, algorithm: k.algorithm, createdAt: k.createdAt, lastUsed: k.lastUsed };
  }
}
