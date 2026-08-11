import { describe, it, expect } from 'vitest';
import { PasskeysPlugin } from '../../plugins/passkeys';

describe('PasskeysPlugin Security and Input Validation', () => {
  const pluginDef = {
    id: 'passkeys',
    name: 'Passkeys',
    type: 'api-connection',
    capabilities: ['passkeys'],
  } as any;

  it('allows valid passkey creation, listing, signing, and verification', async () => {
    const plugin = new PasskeysPlugin(pluginDef);

    // Create a passkey
    const pk = await plugin.create('user@example.com');
    expect(pk).toBeDefined();
    expect(pk.id).toBeDefined();
    expect(pk.name).toBe('user@example.com');
    expect(pk.publicKey).toBeDefined();
    expect(pk.algorithm).toBe('ES256');

    // List passkeys
    const list = await plugin.list();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(pk.id);

    // Sign challenge data
    const challenge = 'random_challenge_string';
    const signature = await plugin.sign(pk.id, challenge);
    expect(signature).toBeDefined();
    expect(typeof signature).toBe('string');

    // Verify signature
    const isValid = await plugin.verify(pk.id, challenge, signature!);
    expect(isValid).toBe(true);

    // Remove passkey
    const removed = await plugin.remove(pk.id);
    expect(removed).toBe(true);

    const afterList = await plugin.list();
    expect(afterList.length).toBe(0);
  });

  describe('create() input validation', () => {
    it('rejects non-string names', async () => {
      const plugin = new PasskeysPlugin(pluginDef);
      await expect(plugin.create(null as any)).rejects.toThrow(/Security Error: Passkey name must be a string/);
      await expect(plugin.create(123 as any)).rejects.toThrow(/Security Error: Passkey name must be a string/);
      await expect(plugin.create({} as any)).rejects.toThrow(/Security Error: Passkey name must be a string/);
    });

    it('rejects empty name', async () => {
      const plugin = new PasskeysPlugin(pluginDef);
      await expect(plugin.create('')).rejects.toThrow(/Security Error: Passkey name cannot be empty/);
      await expect(plugin.create('   ')).rejects.toThrow(/Security Error: Passkey name cannot be empty/);
    });

    it('rejects names longer than 100 characters', async () => {
      const plugin = new PasskeysPlugin(pluginDef);
      const longName = 'a'.repeat(101);
      await expect(plugin.create(longName)).rejects.toThrow(/Security Error: Passkey name exceeds maximum length limit/);
    });

    it('rejects names containing invalid/unsafe characters', async () => {
      const plugin = new PasskeysPlugin(pluginDef);
      const unsafeChars = ['<script>', 'user;drop', 'abc\ndef', 'key"value', 'key\'value', '\\unsafe'];
      for (const name of unsafeChars) {
        await expect(plugin.create(name)).rejects.toThrow(/Security Error: Passkey name contains invalid characters/);
      }
    });

    it('allows valid safe characters in names', async () => {
      const plugin = new PasskeysPlugin(pluginDef);
      const safeNames = ['user_123', 'john-doe', 'alice.bob', 'test+alias@domain.org', 'Admin User'];
      for (const name of safeNames) {
        const pk = await plugin.create(name);
        expect(pk.name).toBe(name);
      }
    });
  });

  describe('remove() input validation', () => {
    it('rejects non-string IDs', async () => {
      const plugin = new PasskeysPlugin(pluginDef);
      await expect(plugin.remove(null as any)).rejects.toThrow(/Security Error: Passkey ID must be a string/);
      await expect(plugin.remove(456 as any)).rejects.toThrow(/Security Error: Passkey ID must be a string/);
    });

    it('rejects IDs longer than 100 characters', async () => {
      const plugin = new PasskeysPlugin(pluginDef);
      const longId = 'b'.repeat(101);
      await expect(plugin.remove(longId)).rejects.toThrow(/Security Error: Passkey ID exceeds maximum length limit/);
    });
  });

  describe('sign() input validation', () => {
    it('rejects non-string inputs', async () => {
      const plugin = new PasskeysPlugin(pluginDef);
      await expect(plugin.sign(null as any, 'data')).rejects.toThrow(/Security Error: ID and data must be strings/);
      await expect(plugin.sign('id', undefined as any)).rejects.toThrow(/Security Error: ID and data must be strings/);
    });

    it('rejects overly long ID or data', async () => {
      const plugin = new PasskeysPlugin(pluginDef);
      const longId = 'c'.repeat(101);
      const longData = 'd'.repeat(65537);

      await expect(plugin.sign(longId, 'data')).rejects.toThrow(/Security Error: ID or data size limit exceeded/);
      await expect(plugin.sign('id', longData)).rejects.toThrow(/Security Error: ID or data size limit exceeded/);
    });
  });

  describe('verify() input validation', () => {
    it('rejects non-string inputs', async () => {
      const plugin = new PasskeysPlugin(pluginDef);
      await expect(plugin.verify(null as any, 'data', 'sig')).rejects.toThrow(/Security Error: ID, data, and signature must be strings/);
      await expect(plugin.verify('id', {} as any, 'sig')).rejects.toThrow(/Security Error: ID, data, and signature must be strings/);
      await expect(plugin.verify('id', 'data', [] as any)).rejects.toThrow(/Security Error: ID, data, and signature must be strings/);
    });

    it('rejects overly long inputs', async () => {
      const plugin = new PasskeysPlugin(pluginDef);
      const longId = 'e'.repeat(101);
      const longData = 'f'.repeat(65537);
      const longSig = 'g'.repeat(1025);

      await expect(plugin.verify(longId, 'data', 'sig')).rejects.toThrow(/Security Error: Input size limit exceeded/);
      await expect(plugin.verify('id', longData, 'sig')).rejects.toThrow(/Security Error: Input size limit exceeded/);
      await expect(plugin.verify('id', 'data', longSig)).rejects.toThrow(/Security Error: Input size limit exceeded/);
    });
  });
});
