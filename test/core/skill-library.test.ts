/**
 * Tests for SkillLibrary: search/load skills SkillMakerExtension has
 * written to disk, so other instances (or the same one later) can find and
 * reuse a previously-built skill instead of recreating it.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillMakerExtension } from '../../plugins/extensions/index.js';
import { SkillLibrary } from '../../models && skills/core/skill-library.js';
import { NeuroLangInterpreter } from '../../models && skills/core/neuro-lang.js';

describe('SkillLibrary', () => {
  let fakeHome: string;
  let originalHome: string | undefined;
  let skillMaker: SkillMakerExtension;
  let library: SkillLibrary;

  beforeEach(async () => {
    fakeHome = mkdtempSync(join(tmpdir(), 'neuroclaw-skill-library-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = fakeHome;

    skillMaker = new SkillMakerExtension({
      id: 'skill-maker',
      name: 'Skill Maker',
      type: 'api-connection',
      capabilities: ['skill-maker'],
    });

    // Build the library against the SAME directories SkillMakerExtension
    // just wrote to (both default to ~/.neuroclaw/... which now resolves
    // under fakeHome).
    library = new SkillLibrary(
      join(fakeHome, '.neuroclaw', 'skills'),
      join(fakeHome, '.neuroclaw', 'skills-wiki'),
    );

    await skillMaker.onMessage('summarize meeting notes :: NetSearch hit on summarization patterns; a prior memory of meeting summaries');
    await skillMaker.onMessage('translate documents');
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test('list() finds every skill with a wiki report', () => {
    const entries = library.list();
    expect(entries.map(e => e.name).sort()).toEqual(['summarize-meeting-notes', 'translate-documents']);
  });

  test('parses description, sources, and neuron names back out of the wiki report', () => {
    const entry = library.get('summarize-meeting-notes');
    expect(entry).toBeDefined();
    expect(entry!.description).toBe('summarize meeting notes');
    expect(entry!.sources).toEqual([
      'NetSearch hit on summarization patterns',
      'a prior memory of meeting summaries',
    ]);
    expect(entry!.neuronNames).toContain('summarize-meeting-notes_perceive');
  });

  test('a skill built with no sources parses back to an empty sources list, not a fabricated one', () => {
    const entry = library.get('translate-documents');
    expect(entry!.sources).toEqual([]);
  });

  test('search() ranks a skill matching the query terms above one that does not', () => {
    const hits = library.search('summarize notes');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.name).toBe('summarize-meeting-notes');
  });

  test('search() returns nothing for a query with no overlap at all', () => {
    expect(library.search('quantum teleportation nonsense')).toEqual([]);
  });

  test('loadSource() returns the raw .neuri text for a known skill', () => {
    const source = library.loadSource('translate-documents');
    expect(source).toContain('translate-documents_perceive');
  });

  test('loadSource() returns null for an unknown skill rather than throwing', () => {
    expect(library.loadSource('does-not-exist')).toBeNull();
  });

  test('install() actually parses and instantiates the skill through a real NeuroLangInterpreter', async () => {
    const interpreter = new NeuroLangInterpreter();
    const neurons = await library.install('translate-documents', interpreter);
    expect(neurons).not.toBeNull();
    expect(neurons!.has('translate-documents_perceive')).toBe(true);
  });

  test('install() returns null for a skill with no source on disk', async () => {
    const interpreter = new NeuroLangInterpreter();
    const result = await library.install('does-not-exist', interpreter);
    expect(result).toBeNull();
  });
});
