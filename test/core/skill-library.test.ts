/**
 * Tests for SkillLibrary: search/load skills SkillMakerExtension has
 * written to disk, so other instances (or the same one later) can find and
 * reuse a previously-built skill instead of recreating it.
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { SkillMakerExtension } from '../../plugins/extensions/index.js';
import { SkillLibrary } from '../../models && skills/core/skill-library.js';
import { NeuroLangInterpreter } from '../../models && skills/core/neuro-lang.js';

// SkillMakerExtension writes self-authored skills under generatedDir(),
// which resolves from NEUROCLAW_GENERATED_DIR (set for this whole vitest
// run by vitest.config.ts, to a real scratch directory) or, unset,
// process.cwd() -- either way, not something this test file chdir's to
// fake: process.cwd() is genuinely process-wide state, and chdir'ing it
// for a test's duration previously leaked into *other* test files running
// concurrently in the same worker (a real failure this caused:
// research-security.test.ts's default-cwd test started scanning whatever
// directory a concurrently-running chdir had switched to, and hung). A
// distinctively-named, per-suite-run prefix keeps this test's own skills
// unambiguous regardless of whatever else lands in the same directory.
const GENERATED_BASE = process.env.NEUROCLAW_GENERATED_DIR || join(process.cwd(), 'generated');
const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SUMMARIZE_DESC = `zzz test fixture ${RUN_ID} summarize meeting notes`;
const TRANSLATE_DESC = `zzz test fixture ${RUN_ID} translate documents`;
const SUMMARIZE_NAME = SUMMARIZE_DESC.replace(/\s+/g, '-').toLowerCase();
const TRANSLATE_NAME = TRANSLATE_DESC.replace(/\s+/g, '-').toLowerCase();

describe('SkillLibrary', () => {
  let skillMaker: SkillMakerExtension;
  let library: SkillLibrary;

  beforeEach(async () => {
    skillMaker = new SkillMakerExtension({
      id: 'skill-maker',
      name: 'Skill Maker',
      type: 'api-connection',
      capabilities: ['skill-maker'],
    });

    // Build the library against the SAME directories SkillMakerExtension
    // just wrote to.
    library = new SkillLibrary(
      join(GENERATED_BASE, 'skills'),
      join(GENERATED_BASE, 'skills-wiki'),
    );

    await skillMaker.onMessage(`${SUMMARIZE_DESC} :: NetSearch hit on summarization patterns; a prior memory of meeting summaries`);
    await skillMaker.onMessage(TRANSLATE_DESC);
  });

  afterEach(() => {
    for (const name of [SUMMARIZE_NAME, TRANSLATE_NAME]) {
      rmSync(join(GENERATED_BASE, 'skills', `${name}.neuri`), { force: true });
      rmSync(join(GENERATED_BASE, 'skills-wiki', `${name}.md`), { force: true });
    }
  });

  test('list() finds every skill with a wiki report', () => {
    // Inclusion, not exact equality: generated/skills-wiki/ is this repo's
    // real directory (no chdir isolation -- see the file-level comment
    // above), so nothing here assumes it's empty of anything else.
    const names = library.list().map(e => e.name);
    expect(names).toContain(SUMMARIZE_NAME);
    expect(names).toContain(TRANSLATE_NAME);
  });

  test('parses description, sources, and neuron names back out of the wiki report', () => {
    const entry = library.get(SUMMARIZE_NAME);
    expect(entry).toBeDefined();
    expect(entry!.description).toBe(SUMMARIZE_DESC);
    expect(entry!.sources).toEqual([
      'NetSearch hit on summarization patterns',
      'a prior memory of meeting summaries',
    ]);
    expect(entry!.neuronNames).toContain(`${SUMMARIZE_NAME}_perceive`);
  });

  test('a skill built with no sources parses back to an empty sources list, not a fabricated one', () => {
    const entry = library.get(TRANSLATE_NAME);
    expect(entry!.sources).toEqual([]);
  });

  test('search() ranks a skill matching the query terms above one that does not', () => {
    const hits = library.search('summarize notes');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.name).toBe(SUMMARIZE_NAME);
  });

  test('search() returns nothing for a query with no overlap at all', () => {
    expect(library.search('quantum teleportation nonsense')).toEqual([]);
  });

  test('loadSource() returns the raw .neuri text for a known skill', () => {
    const source = library.loadSource(TRANSLATE_NAME);
    expect(source).toContain(`${TRANSLATE_NAME}_perceive`);
  });

  test('loadSource() returns null for an unknown skill rather than throwing', () => {
    expect(library.loadSource('does-not-exist')).toBeNull();
  });

  test('install() actually parses and instantiates the skill through a real NeuroLangInterpreter', async () => {
    const interpreter = new NeuroLangInterpreter();
    const neurons = await library.install(TRANSLATE_NAME, interpreter);
    expect(neurons).not.toBeNull();
    expect(neurons!.has(`${TRANSLATE_NAME}_perceive`)).toBe(true);
  });

  test('install() returns null for a skill with no source on disk', async () => {
    const interpreter = new NeuroLangInterpreter();
    const result = await library.install('does-not-exist', interpreter);
    expect(result).toBeNull();
  });

  test('installWithIOLayers() splits a real self-authored skill into its perceive/respond input/output layer', async () => {
    const interpreter = new NeuroLangInterpreter();
    const result = await library.installWithIOLayers(TRANSLATE_NAME, interpreter);
    expect(result).not.toBeNull();
    expect(result!.io.inputs.map(n => n.name)).toEqual([`${TRANSLATE_NAME}_perceive`]);
    expect(result!.io.outputs.map(n => n.name)).toEqual([`${TRANSLATE_NAME}_respond`]);
    // Still an ordinary, all-to-all-connected neuron in the same map -- the
    // role tag is a label, not a wiring boundary.
    expect(result!.neurons.get(`${TRANSLATE_NAME}_perceive`)!.connections.size).toBeGreaterThan(0);
  });

  test('installWithIOLayers() returns null for a skill with no source on disk', async () => {
    const interpreter = new NeuroLangInterpreter();
    const result = await library.installWithIOLayers('does-not-exist', interpreter);
    expect(result).toBeNull();
  });
});

describe('NeuroLangInterpreter @role= / getIOLayers()', () => {
  test('"X"@role="input"/"output" tags neurons that still get ordinary default connections', async () => {
    const interpreter = new NeuroLangInterpreter();
    const source = [
      'name="in"',
      'name="mid"',
      'name="out"',
      '"in"@role="input"',
      '"out"@role="output"',
    ].join('\n');
    const parsed = await interpreter.parse(source);
    expect(parsed.errors).toEqual([]);
    const neurons = await interpreter.evaluate(parsed);

    expect(neurons.get('in')!.role).toBe('input');
    expect(neurons.get('out')!.role).toBe('output');
    expect(neurons.get('mid')!.role).toBeUndefined();
    // Role is a label, not a wiring boundary: the input neuron still has a
    // default connection into the untagged interior neuron.
    expect(neurons.get('in')!.connections.has('mid')).toBe(true);

    const io = interpreter.getIOLayers(neurons);
    expect(io.inputs.map(n => n.name)).toEqual(['in']);
    expect(io.outputs.map(n => n.name)).toEqual(['out']);
  });

  test('@role= round-trips through toJSON()/fromJSON()', async () => {
    const interpreter = new NeuroLangInterpreter();
    const parsed = await interpreter.parse('name="in"\n"in"@role="input"');
    const json = interpreter.toJSON(parsed.neurons);
    const restored = interpreter.fromJSON(json);
    expect(restored.neurons.get('in')!.role).toBe('input');
  });

  test('an invalid @role= value is rejected as unrecognised syntax rather than silently accepted', async () => {
    const interpreter = new NeuroLangInterpreter();
    const parsed = await interpreter.parse('name="in"\n"in"@role="sideways"');
    expect(parsed.errors.length).toBeGreaterThan(0);
  });
});
