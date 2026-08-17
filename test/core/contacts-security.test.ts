import { describe, it, expect, beforeEach } from 'vitest';
import { ContactsPlugin } from '../../plugins/contacts.js';

describe('ContactsPlugin Security Validation', () => {
  let plugin: ContactsPlugin;

  beforeEach(() => {
    plugin = new ContactsPlugin({
      id: 'contacts',
      name: 'Contacts',
      type: 'api-connection',
      capabilities: [],
    } as any);
  });

  describe('add() security checks', () => {
    it('allows valid contact creation', async () => {
      const contact = await plugin.add({
        name: 'Alice Smith',
        phone: '123-456-7890',
        email: 'alice@example.com',
      });
      expect(contact.id).toBeDefined();
      expect(contact.name).toBe('Alice Smith');
    });

    it('rejects invalid or non-object contact parameter', async () => {
      await expect(plugin.add(null as any)).rejects.toThrowError('Security Error: Contact data must be an object.');
      await expect(plugin.add('invalid' as any)).rejects.toThrowError('Security Error: Contact data must be an object.');
    });

    it('rejects missing, invalid, or empty name', async () => {
      await expect(plugin.add({ name: 123 } as any)).rejects.toThrowError('Security Error: Contact name must be a string.');
      await expect(plugin.add({ name: '' } as any)).rejects.toThrowError('Security Error: Contact name cannot be empty.');
      await expect(plugin.add({ name: '   ' } as any)).rejects.toThrowError('Security Error: Contact name cannot be empty.');
    });

    it('rejects excessively long contact fields', async () => {
      const longName = 'a'.repeat(101);
      const longField = 'b'.repeat(101);
      const longText = 'c'.repeat(501);

      await expect(plugin.add({ name: longName })).rejects.toThrowError('Security Error: Contact name exceeds maximum length limit.');
      await expect(plugin.add({ name: 'Valid', phone: longField })).rejects.toThrowError('Security Error: Phone exceeds maximum length limit.');
      await expect(plugin.add({ name: 'Valid', email: longField })).rejects.toThrowError('Security Error: Email exceeds maximum length limit.');
      await expect(plugin.add({ name: 'Valid', group: longField })).rejects.toThrowError('Security Error: Group exceeds maximum length limit.');
      await expect(plugin.add({ name: 'Valid', address: longText })).rejects.toThrowError('Security Error: Address exceeds maximum length limit.');
      await expect(plugin.add({ name: 'Valid', notes: longText })).rejects.toThrowError('Security Error: Notes exceeds maximum length limit.');
    });
  });

  describe('update() security checks', () => {
    it('rejects invalid contact ID or non-object updates', async () => {
      await expect(plugin.update(123 as any, {})).rejects.toThrowError('Security Error: Contact ID must be a string.');
      await expect(plugin.update('a'.repeat(101), {})).rejects.toThrowError('Security Error: Contact ID exceeds maximum length limit.');
      await expect(plugin.update('contact-1', null as any)).rejects.toThrowError('Security Error: Updates must be an object.');
    });

    it('rejects empty or invalid updated name', async () => {
      await expect(plugin.update('contact-1', { name: '' })).rejects.toThrowError('Security Error: Contact name cannot be empty.');
      await expect(plugin.update('contact-1', { name: 123 as any })).rejects.toThrowError('Security Error: Contact name must be a string.');
    });
  });

  describe('get() and remove() security checks', () => {
    it('validates contact ID for get() and remove()', async () => {
      await expect(plugin.get(123 as any)).rejects.toThrowError('Security Error: Contact ID must be a string.');
      await expect(plugin.get('a'.repeat(101))).rejects.toThrowError('Security Error: Contact ID exceeds maximum length limit.');

      await expect(plugin.remove(123 as any)).rejects.toThrowError('Security Error: Contact ID must be a string.');
      await expect(plugin.remove('a'.repeat(101))).rejects.toThrowError('Security Error: Contact ID exceeds maximum length limit.');
    });
  });

  describe('search() security checks', () => {
    it('validates search query string and length', async () => {
      await expect(plugin.search(123 as any)).rejects.toThrowError('Security Error: Search query must be a string.');
      await expect(plugin.search('a'.repeat(101))).rejects.toThrowError('Security Error: Search query exceeds maximum length limit.');
    });

    it('executes valid search successfully', async () => {
      await plugin.add({ name: 'Bob Marley', email: 'bob@jamaica.org' });
      const results = await plugin.search('marley');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Bob Marley');
    });
  });
});
