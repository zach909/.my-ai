/**
 * Tests for SkillMakerExtension's wiki-doc generation: every self-authored
 * skill gets a companion wiki entry recording what informed it (sources),
 * not just the generated neuron code.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { SkillMakerExtension } from '../../plugins/extensions/index.js';

describe('SkillMakerExtension wiki generation', () => {
  let skillMaker: SkillMakerExtension;
  // SkillMakerExtension writes under <repo>/generated/... (process.cwd()-
  // relative, no constructor injection point) -- every path a test's own
  // onMessage() call actually returns gets deleted in afterEach, so this
  // never touches anything this suite didn't itself just create.
  const createdPaths: string[] = [];

  beforeEach(() => {
    skillMaker = new SkillMakerExtension({
      id: 'skill-maker',
      name: 'Skill Maker',
      type: 'api-connection',
      capabilities: ['skill-maker'],
    });
  });

  afterEach(() => {
    while (createdPaths.length > 0) rmSync(createdPaths.pop()!, { force: true });
  });

  test('generates a skill file and a companion wiki doc', async () => {
    const result = await skillMaker.onMessage('zzz test fixture summarize meeting notes') as {
      skill: string; path: string; wikiPath: string; sources: string[];
    };
    createdPaths.push(result.path, result.wikiPath);

    expect(existsSync(result.path)).toBe(true);
    expect(existsSync(result.wikiPath)).toBe(true);
    expect(result.wikiPath).toContain('skills-wiki');
  });

  test('wiki doc records the description and generated neurons', async () => {
    const result = await skillMaker.onMessage('zzz test fixture translate documents') as { path: string; wikiPath: string };
    createdPaths.push(result.path, result.wikiPath);
    const wiki = readFileSync(result.wikiPath, 'utf-8');

    expect(wiki).toContain('zzz test fixture translate documents');
    expect(wiki).toContain('## Sources and info used');
    expect(wiki).toContain('## Neurons');
    expect(wiki).toMatch(/zzz-test-fixture-translate-documents_perceive/);
  });

  test('with no sources supplied, the wiki says so rather than fabricating provenance', async () => {
    const result = await skillMaker.onMessage('zzz test fixture write unit tests') as { path: string; wikiPath: string; sources: string[] };
    createdPaths.push(result.path, result.wikiPath);
    expect(result.sources).toEqual([]);

    const wiki = readFileSync(result.wikiPath, 'utf-8');
    expect(wiki).toContain('no additional sources were supplied');
  });

  test('parses "description :: source1; source2" and records both sources', async () => {
    const result = await skillMaker.onMessage(
      'zzz test fixture refactor legacy code :: NetSearch hit on refactoring patterns; prior memory of a similar task'
    ) as { path: string; wikiPath: string; sources: string[]; description: string };
    createdPaths.push(result.path, result.wikiPath);

    expect(result.description).toBe('zzz test fixture refactor legacy code');
    expect(result.sources).toEqual([
      'NetSearch hit on refactoring patterns',
      'prior memory of a similar task',
    ]);

    const wiki = readFileSync(result.wikiPath, 'utf-8');
    expect(wiki).toContain('NetSearch hit on refactoring patterns');
    expect(wiki).toContain('prior memory of a similar task');
  });
});
