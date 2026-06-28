import crypto from 'node:crypto';
import type { CipherGCM, DecipherGCM } from 'node:crypto';

export class EncryptionManager {
  private algorithm: string;
  private ivLength: number;
  private tagLength: number;
  private keyLength: number;

  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.ivLength = 16;
    this.tagLength = 16;
    this.keyLength = 32;
  }

  encrypt(data: string, key: Buffer): { encrypted: Buffer; iv: Buffer; tag: Buffer } {
    if (!key || key.length !== this.keyLength) {
      throw new Error(`Key must be ${this.keyLength} bytes`);
    }
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv) as CipherGCM;
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    if (tag.length !== this.tagLength) {
      throw new Error('Authentication tag length mismatch');
    }
    return { encrypted, iv, tag };
  }

  decrypt(encrypted: Buffer, key: Buffer, iv: Buffer, tag: Buffer): string {
    if (!key || key.length !== this.keyLength) {
      throw new Error(`Key must be ${this.keyLength} bytes`);
    }
    if (!iv || iv.length !== this.ivLength) {
      throw new Error(`IV must be ${this.ivLength} bytes`);
    }
    if (!tag || tag.length !== this.tagLength) {
      throw new Error(`Tag must be ${this.tagLength} bytes`);
    }
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv) as DecipherGCM;
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  generateKey(): Buffer {
    return crypto.randomBytes(this.keyLength);
  }

  async hashPassword(password: string, salt: Buffer): Promise<Buffer> {
    if (!password || password.length === 0) {
      throw new Error('Password cannot be empty');
    }
    if (!salt || salt.length === 0) {
      throw new Error('Salt cannot be empty');
    }
    return new Promise<Buffer>((resolve, reject) => {
      crypto.pbkdf2(password, salt, 100000, this.keyLength, 'sha512', (err, derivedKey) => {
        if (err) reject(new Error(`PBKDF2 failed: ${err.message}`));
        else resolve(derivedKey);
      });
    });
  }
}
