import { describe, it, expect } from 'vitest';
import { MessagingPlugin } from '../../plugins/messaging';

describe('MessagingPlugin Security and Validation', () => {
  const plugin = new MessagingPlugin({
    id: 'messaging',
    name: 'Messaging',
    type: 'api-connection',
    capabilities: [],
  } as any);

  describe('send method', () => {
    it('allows valid parameters', async () => {
      const msg = await plugin.send('alice', 'bob', 'hello there', 'direct');
      expect(msg).toBeDefined();
      expect(msg.from).toBe('alice');
      expect(msg.to).toBe('bob');
      expect(msg.text).toBe('hello there');
      expect(msg.channel).toBe('direct');
    });

    it('rejects invalid parameter types', async () => {
      await expect(plugin.send(123 as any, 'bob', 'text')).rejects.toThrow('Security Error');
      await expect(plugin.send('alice', {} as any, 'text')).rejects.toThrow('Security Error');
      await expect(plugin.send('alice', 'bob', [] as any)).rejects.toThrow('Security Error');
      await expect(plugin.send('alice', 'bob', 'text', true as any)).rejects.toThrow('Security Error');
    });

    it('rejects empty or whitespace-only inputs', async () => {
      await expect(plugin.send('', 'bob', 'text')).rejects.toThrow('Security Error');
      await expect(plugin.send('alice', '   ', 'text')).rejects.toThrow('Security Error');
      await expect(plugin.send('alice', 'bob', '\n\n')).rejects.toThrow('Security Error');
    });

    it('rejects excessively long sender/receiver names', async () => {
      const longName = 'a'.repeat(101);
      await expect(plugin.send(longName, 'bob', 'text')).rejects.toThrow('Security Error');
      await expect(plugin.send('alice', longName, 'text')).rejects.toThrow('Security Error');
    });

    it('rejects excessively long channel names', async () => {
      const longChannel = 'c'.repeat(101);
      await expect(plugin.send('alice', 'bob', 'text', longChannel)).rejects.toThrow('Security Error');
    });

    it('rejects excessively long message text', async () => {
      const longText = 'm'.repeat(4097);
      await expect(plugin.send('alice', 'bob', longText)).rejects.toThrow('Security Error');
    });
  });

  describe('getConversation method', () => {
    it('allows valid parameters', async () => {
      const conversations = await plugin.getConversation('alice', 10);
      expect(Array.isArray(conversations)).toBe(true);
    });

    it('rejects invalid contact parameter types', async () => {
      await expect(plugin.getConversation(123 as any)).rejects.toThrow('Security Error');
      await expect(plugin.getConversation(null as any)).rejects.toThrow('Security Error');
    });

    it('rejects empty contact parameter', async () => {
      await expect(plugin.getConversation('')).rejects.toThrow('Security Error');
      await expect(plugin.getConversation('   ')).rejects.toThrow('Security Error');
    });

    it('rejects contact names exceeding length limit', async () => {
      const longContact = 'x'.repeat(101);
      await expect(plugin.getConversation(longContact)).rejects.toThrow('Security Error');
    });

    it('rejects invalid or out-of-bounds limits', async () => {
      await expect(plugin.getConversation('alice', 0)).rejects.toThrow('Security Error');
      await expect(plugin.getConversation('alice', -5)).rejects.toThrow('Security Error');
      await expect(plugin.getConversation('alice', 1.5)).rejects.toThrow('Security Error');
      await expect(plugin.getConversation('alice', 1001)).rejects.toThrow('Security Error');
      await expect(plugin.getConversation('alice', '50' as any)).rejects.toThrow('Security Error');
    });
  });

  describe('markRead method', () => {
    it('allows marking messages as read with valid ID', async () => {
      const msg = await plugin.send('user1', 'user2', 'test message');
      const result = await plugin.markRead(msg.id);
      expect(result).toBe(true);
    });

    it('rejects invalid ID type', async () => {
      await expect(plugin.markRead(123 as any)).rejects.toThrow('Security Error');
    });

    it('rejects excessively long message ID', async () => {
      const longId = 'i'.repeat(101);
      await expect(plugin.markRead(longId)).rejects.toThrow('Security Error');
    });
  });
});
