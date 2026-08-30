import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WikiPlugin } from '../../plugins/wiki';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('WikiPlugin Security Validation', () => {
  let plugin: WikiPlugin;
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'neuroclaw-wiki-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);

    plugin = new WikiPlugin({
      id: 'wiki',
      name: 'Wiki',
      type: 'api-connection',
      capabilities: [],
    } as any);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('read() validation', () => {
    it('allows valid page name', async () => {
      const res = await plugin.read('ValidPage');
      expect(res).toBeNull();
    });

    it('rejects non-string name', async () => {
      await expect(plugin.read(123 as any)).rejects.toThrowError('Security Error: Page name must be a string.');
      await expect(plugin.read(null as any)).rejects.toThrowError('Security Error: Page name must be a string.');
      await expect(plugin.read({} as any)).rejects.toThrowError('Security Error: Page name must be a string.');
    });

    it('rejects empty name', async () => {
      await expect(plugin.read('')).rejects.toThrowError('Security Error: Page name cannot be empty.');
      await expect(plugin.read('   ')).rejects.toThrowError('Security Error: Page name cannot be empty.');
    });

    it('rejects oversized page name', async () => {
      const longName = 'a'.repeat(101);
      await expect(plugin.read(longName)).rejects.toThrowError('Security Error: Page name exceeds maximum length limit of 100 characters.');
    });
  });

  describe('publish() validation', () => {
    it('allows valid publishing parameters', async () => {
      const page = await plugin.publish('test_page', 'Test Title', 'This is valid page content.');
      expect(page.name).toBe('test_page');
      expect(page.title).toBe('Test Title');
      expect(page.content).toContain('This is valid page content.');
    });

    it('rejects non-string name, title, or content', async () => {
      await expect(plugin.publish(123 as any, 'Title', 'Content')).rejects.toThrowError('Security Error: Page name must be a string.');
      await expect(plugin.publish('Name', null as any, 'Content')).rejects.toThrowError('Security Error: Page title must be a string.');
      await expect(plugin.publish('Name', 'Title', undefined as any)).rejects.toThrowError('Security Error: Page content must be a string.');
    });

    it('rejects empty name, title, or content', async () => {
      await expect(plugin.publish('', 'Title', 'Content')).rejects.toThrowError('Security Error: Page name cannot be empty.');
      await expect(plugin.publish('Name', '   ', 'Content')).rejects.toThrowError('Security Error: Page title cannot be empty.');
      await expect(plugin.publish('Name', 'Title', '')).rejects.toThrowError('Security Error: Page content cannot be empty.');
    });

    it('rejects oversized name, title, or content', async () => {
      const longName = 'a'.repeat(101);
      const longTitle = 'b'.repeat(201);
      const longContent = 'c'.repeat(100001);

      await expect(plugin.publish(longName, 'Title', 'Content')).rejects.toThrowError('Security Error: Page name exceeds maximum length limit of 100 characters.');
      await expect(plugin.publish('Name', longTitle, 'Content')).rejects.toThrowError('Security Error: Page title exceeds maximum length limit of 200 characters.');
      await expect(plugin.publish('Name', 'Title', longContent)).rejects.toThrowError('Security Error: Page content exceeds maximum length limit of 100,000 characters.');
    });
  });
});
