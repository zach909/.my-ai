import { describe, it, expect } from 'vitest';
import { ResearchPlugin } from '../../plugins/research';

describe('ResearchPlugin searchDrive security hardening', () => {
  it('allows searchDrive inside the current working directory sandbox', async () => {
    const plugin = new ResearchPlugin({
      id: 'research',
      name: 'Research',
      type: 'api-connection',
      capabilities: [],
    } as any);

    // Searching within '.' should not throw any security errors
    const hits = await plugin.searchDrive('class ResearchPlugin', { root: '.', maxResults: 1 });
    expect(Array.isArray(hits)).toBe(true);
  });

  it('blocks searchDrive traversal attempts using relative dot-dot segments with a Security Error', async () => {
    const plugin = new ResearchPlugin({
      id: 'research',
      name: 'Research',
      type: 'api-connection',
      capabilities: [],
    } as any);

    // Try traversing upwards out of the repository root
    await expect(plugin.searchDrive('anything', { root: '../', maxResults: 1 }))
      .rejects.toThrow(/Security Error: Path traversal detected/);

    await expect(plugin.searchDrive('anything', { root: '../../etc', maxResults: 1 }))
      .rejects.toThrow(/Security Error: Path traversal detected/);
  });

  it('blocks searchDrive traversal attempts using absolute paths outside of the repository with a Security Error', async () => {
    const plugin = new ResearchPlugin({
      id: 'research',
      name: 'Research',
      type: 'api-connection',
      capabilities: [],
    } as any);

    // Try searching an absolute path like /etc which escapes the project root sandbox
    await expect(plugin.searchDrive('anything', { root: '/etc', maxResults: 1 }))
      .rejects.toThrow(/Security Error: Path traversal detected/);
  });
});
