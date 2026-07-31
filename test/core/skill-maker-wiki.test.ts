/**
 * Tests for SkillMakerExtension's wiki-doc generation: every self-authored
 * skill gets a companion wiki entry recording what informed it (sources),
 * not just the generated neuron code.
 */

import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillMakerExtension } from '../../plugins/extensions/index.js';

describe('SkillMakerExtension wiki generation', () => {
  let skillMaker: SkillMakerExtension;
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'neuroclaw-skillmaker-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
    skillMaker = new SkillMakerExtension({
      id: 'skill-maker',
      name: 'Skill Maker',
      type: 'api-connection',
      capabilities: ['skill-maker'],
    });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test('generates a skill file and a companion wiki doc', async () => {
    const result = await skillMaker.onMessage('summarize meeting notes') as {
      skill: string; path: string; wikiPath: string; sources: string[];
    };

    expect(existsSync(result.path)).toBe(true);
    expect(existsSync(result.wikiPath)).toBe(true);
    expect(result.wikiPath).toContain('skills-wiki');
  });

  test('wiki doc records the description and generated neurons', async () => {
    const result = await skillMaker.onMessage('translate documents') as { wikiPath: string };
    const wiki = readFileSync(result.wikiPath, 'utf-8');

    expect(wiki).toContain('translate documents');
    expect(wiki).toContain('## Sources and info used');
    expect(wiki).toContain('## Neurons');
    expect(wiki).toMatch(/translate-documents_perceive/);
  });

  test('with no sources supplied, the wiki says so rather than fabricating provenance', async () => {
    const result = await skillMaker.onMessage('write unit tests') as { wikiPath: string; sources: string[] };
    expect(result.sources).toEqual([]);

    const wiki = readFileSync(result.wikiPath, 'utf-8');
    expect(wiki).toContain('no additional sources were supplied');
  });

  test('parses "description :: source1; source2" and records both sources', async () => {
    const result = await skillMaker.onMessage(
      'refactor legacy code :: NetSearch hit on refactoring patterns; prior memory of a similar task'
    ) as { wikiPath: string; sources: string[]; description: string };

    expect(result.description).toBe('refactor legacy code');
    expect(result.sources).toEqual([
      'NetSearch hit on refactoring patterns',
      'prior memory of a similar task',
    ]);

    const wiki = readFileSync(result.wikiPath, 'utf-8');
    expect(wiki).toContain('NetSearch hit on refactoring patterns');
    expect(wiki).toContain('prior memory of a similar task');
  });
});
