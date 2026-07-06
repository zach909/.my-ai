export declare class EncryptionManager {
    private algorithm;
    private ivLength;
    private tagLength;
    private keyLength;
    constructor();
    encrypt(data: string, key: Buffer): {
        encrypted: Buffer;
        iv: Buffer;
        tag: Buffer;
    };
    decrypt(encrypted: Buffer, key: Buffer, iv: Buffer, tag: Buffer): string;
    generateKey(): Buffer;
    hashPassword(password: string, salt: Buffer): Promise<Buffer>;
}
