/**
 * ResearchPlugin.searchDrive(): the file budget is shared between directories.
 *
 * The search was described as breadth-first so that one huge directory could not
 * eat the whole maxFiles budget, but it read each directory completely before the
 * next one, so a first sibling with more files than the budget left every later
 * sibling unsearched. It now takes one entry from each directory in turn.
 *
 * Fixtures live inside the working directory, because searchDrive() refuses any
 * root outside it (path-traversal guard).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ResearchPlugin } from '../../plugins/research';

const plugin = new ResearchPlugin({ id: 'research', name: 'Research', type: 'api-connection', capabilities: [] } as any);
const made: string[] = [];
const fixture = () => { const dir = mkdtempSync(join(process.cwd(), 'research-budget-')); made.push(dir); return dir; };
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('searchDrive spends its file budget across directories', () => {
  it('finds a target in a later sibling although an earlier one has more files than the budget', async () => {
    const root = fixture();
    mkdirSync(join(root, 'aaa_big_sibling'));
    for (let i = 0; i < 200; i++) writeFileSync(join(root, 'aaa_big_sibling', `file_${i}.txt`), `filler ${i}`);
    mkdirSync(join(root, 'zzz_target'));
    writeFileSync(join(root, 'zzz_target', 'research.ts'), 'export class ResearchPlugin {}');
    const hits = await plugin.searchDrive('class ResearchPlugin', { root, maxResults: 5, maxFiles: 50 });
    expect(hits.some(h => h.location.includes('zzz_target'))).toBe(true);
  });

  it('shares the result cap among many directories at one level', async () => {
    const root = fixture();
    for (let d = 0; d < 10; d++) {
      mkdirSync(join(root, `dir_${d}`));
      for (let i = 0; i < 30; i++) writeFileSync(join(root, `dir_${d}`, `f_${i}.txt`), 'needle');
    }
    // Every file matches and only 20 results are wanted. One entry from each directory in turn
    // reaches all ten directories; reading one directory at a time would stop inside the first.
    const hits = await plugin.searchDrive('needle', { root, maxResults: 20, maxFiles: 1000 });
    const dirsReached = new Set(hits.map(h => h.location.split('/').slice(-2)[0]));
    expect(hits).toHaveLength(20);
    expect(dirsReached.size).toBe(10);
  });

  it('still respects the budget and the result cap', async () => {
    const root = fixture();
    mkdirSync(join(root, 'a'));
    for (let i = 0; i < 100; i++) writeFileSync(join(root, 'a', `f_${i}.txt`), 'needle');
    expect((await plugin.searchDrive('needle', { root, maxResults: 7, maxFiles: 1000 })).length).toBe(7);
    expect((await plugin.searchDrive('needle', { root, maxResults: 1000, maxFiles: 13 })).length).toBe(13);
  });

  it('goes down through nested directories, and copes with empty ones', async () => {
    const root = fixture();
    mkdirSync(join(root, 'empty'));
    mkdirSync(join(root, 'a', 'b', 'c'), { recursive: true });
    writeFileSync(join(root, 'a', 'b', 'c', 'deep.txt'), 'the deep needle');
    const hits = await plugin.searchDrive('deep needle', { root });
    expect(hits).toHaveLength(1);
    expect(hits[0].location.endsWith('deep.txt')).toBe(true);
  });
});
