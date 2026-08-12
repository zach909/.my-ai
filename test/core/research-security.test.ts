import { describe, it, expect } from 'vitest';
import { ResearchPlugin } from '../../plugins/research';

describe('ResearchPlugin Security Validation', () => {
  const plugin = new ResearchPlugin({
    id: 'research',
    name: 'Research',
    type: 'api-connection',
    capabilities: [],
  } as any);

  it('allows safe, valid root directories inside process.cwd()', async () => {
    // Should run successfully without throwing a Security Error (even if empty results)
    const result = await plugin.searchDrive('class ResearchPlugin', { root: './plugins' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('allows default process.cwd() when no root is specified', async () => {
    const result = await plugin.searchDrive('class ResearchPlugin');
    expect(Array.isArray(result)).toBe(true);
  });

  it('rejects relative path traversal escaping the sandbox boundary', async () => {
    await expect(plugin.searchDrive('vulnerability', { root: '../' }))
      .rejects.toThrowError('Security Error: Path traversal detected');

    await expect(plugin.searchDrive('vulnerability', { root: '../../etc' }))
      .rejects.toThrowError('Security Error: Path traversal detected');
  });

  it('rejects absolute paths outside of process.cwd()', async () => {
    await expect(plugin.searchDrive('vulnerability', { root: '/etc' }))
      .rejects.toThrowError('Security Error: Path traversal detected');

    await expect(plugin.searchDrive('vulnerability', { root: '/tmp' }))
      .rejects.toThrowError('Security Error: Path traversal detected');
  });
});
