import crypto from 'node:crypto';
export class EncryptionManager {
    algorithm;
    ivLength;
    tagLength;
    keyLength;
    constructor() {
        this.algorithm = 'aes-256-gcm';
        this.ivLength = 16;
        this.tagLength = 16;
        this.keyLength = 32;
    }
    encrypt(data, key) {
        if (!key || key.length !== this.keyLength) {
            throw new Error(`Key must be ${this.keyLength} bytes`);
        }
        const iv = crypto.randomBytes(this.ivLength);
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);
        const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        if (tag.length !== this.tagLength) {
            throw new Error('Authentication tag length mismatch');
        }
        return { encrypted, iv, tag };
    }
    decrypt(encrypted, key, iv, tag) {
        if (!key || key.length !== this.keyLength) {
            throw new Error(`Key must be ${this.keyLength} bytes`);
        }
        if (!iv || iv.length !== this.ivLength) {
            throw new Error(`IV must be ${this.ivLength} bytes`);
        }
        if (!tag || tag.length !== this.tagLength) {
            throw new Error(`Tag must be ${this.tagLength} bytes`);
        }
        const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    }
    generateKey() {
        return crypto.randomBytes(this.keyLength);
    }
    async hashPassword(password, salt) {
        if (!password || password.length === 0) {
            throw new Error('Password cannot be empty');
        }
        if (!salt || salt.length === 0) {
            throw new Error('Salt cannot be empty');
        }
        return new Promise((resolve, reject) => {
            crypto.pbkdf2(password, salt, 100000, this.keyLength, 'sha512', (err, derivedKey) => {
                if (err)
                    reject(new Error(`PBKDF2 failed: ${err.message}`));
                else
                    resolve(derivedKey);
            });
        });
    }
}
