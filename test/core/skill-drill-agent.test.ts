/**
 * Tests for scripts/skill-drill-agent.mjs's and
 * scripts/drill-generators/arithmetic.mjs's pure logic -- the parts
 * that don't require a real python3/pytorch subprocess. The real
 * end-to-end drill cycle (drillOneSkill() -> runPytorch() "eval" then
 * "train" then "eval" again) was verified manually via
 * `node scripts/skill-drill-agent.mjs --once` before shipping, same
 * precedent as this session's other autonomous-agent scripts.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  classifyDrillCategory,
  pickSkillToDrill,
  loadRegistry,
  loadHistory,
  saveHistory,
} from '../../scripts/skill-drill-agent.mjs';
import { generateArithmeticProblem, generateArithmeticBatch } from '../../scripts/drill-generators/arithmetic.mjs';

describe('classifyDrillCategory()', () => {
  it('recognizes arithmetic/math topics', () => {
    expect(classifyDrillCategory('arithmetic')).toBe('arithmetic');
    expect(classifyDrillCategory('basic algebra')).toBe('arithmetic');
    expect(classifyDrillCategory('number theory and primes')).toBe('arithmetic');
  });

  it('routes every domain that now has a real generator', () => {
    // These two used to be asserted as 'generic', which encoded the
    // limitation rather than a requirement: there was exactly one generator,
    // so everything else fell through to a regression check that replays a
    // skill's own page back at it and cannot teach. Both have real
    // generators now, so routing them to 'generic' would be the bug.
    expect(classifyDrillCategory('quantum computing error correction')).toBe('quantum-computers');
    expect(classifyDrillCategory('organic chemistry reaction mechanisms')).toBe('science');

    expect(classifyDrillCategory('coding')).toBe('coding');
    expect(classifyDrillCategory('logic')).toBe('logic');
    expect(classifyDrillCategory('building ai')).toBe('building-ai');
    expect(classifyDrillCategory('building classical computers')).toBe('classical-computers');
    expect(classifyDrillCategory('building quantum computers')).toBe('quantum-computers');
    expect(classifyDrillCategory('building operating systems')).toBe('operating-systems');
    expect(classifyDrillCategory('building apps')).toBe('building-apps');
    expect(classifyDrillCategory('science')).toBe('science');
  });

  it('routes real-world phrasings, not just the exact domain names', () => {
    expect(classifyDrillCategory('how to write a scheduler')).toBe('operating-systems');
    expect(classifyDrillCategory('CPU cache hierarchy and pipelining')).toBe('classical-computers');
    expect(classifyDrillCategory('neural network training')).toBe('building-ai');
    expect(classifyDrillCategory('React app pagination')).toBe('building-apps');
    expect(classifyDrillCategory('propositional truth tables')).toBe('logic');
    expect(classifyDrillCategory('recursion and data structures')).toBe('coding');
  });

  it('keeps a quantum computer out of the classical-computer bucket', () => {
    // The rules are ordered, not alphabetical, and this is why: 'quantum
    // computer design' contains 'computer', so a naive ordering hands it to
    // classical-computers and the agent drills the wrong domain while
    // reporting success.
    expect(classifyDrillCategory('quantum computer design')).toBe('quantum-computers');
    expect(classifyDrillCategory('qubit coherence times')).toBe('quantum-computers');
  });

  it('still falls back to generic rather than guessing', () => {
    expect(classifyDrillCategory('underwater basket weaving')).toBe('generic');
    expect(classifyDrillCategory('')).toBe('generic');
    expect(classifyDrillCategory(undefined)).toBe('generic');
  });
});

describe('generateArithmeticProblem() / generateArithmeticBatch()', () => {
  it('produces a real, self-consistent arithmetic fact -- never fabricated', () => {
    const rand = () => 0.5; // deterministic
    const { problem, answer } = generateArithmeticProblem(rand);
    // eslint-disable-next-line no-eval
    expect(String(eval(problem))).toBe(answer);
  });

  it('generates the requested batch size', () => {
    const batch = generateArithmeticBatch(5, Math.random);
    expect(batch.length).toBe(5);
    for (const { problem, answer } of batch) {
      // eslint-disable-next-line no-eval
      expect(String(eval(problem))).toBe(answer);
    }
  });
});

describe('pickSkillToDrill()', () => {
  it('returns null when nothing has been published yet', () => {
    expect(pickSkillToDrill({ topics: {} }, { skills: {} })).toBeNull();
  });

  it('ignores topics that were researched but never published', () => {
    const registry = { topics: { 'draft-topic': { topic: 'draft topic' } } };
    expect(pickSkillToDrill(registry, { skills: {} })).toBeNull();
  });

  it('picks a never-drilled published skill before one with drill history', () => {
    const registry = {
      topics: {
        'topic-a': { topic: 'Topic A', publishedAt: '2026-01-01T00:00:00Z' },
        'topic-b': { topic: 'Topic B', publishedAt: '2026-01-02T00:00:00Z' },
      },
    };
    const history = { skills: { 'topic-a': { history: [{ at: '2026-01-05T00:00:00Z' }] } } };
    const pick = pickSkillToDrill(registry, history);
    expect(pick?.slug).toBe('topic-b');
  });

  it('picks the least-recently-drilled skill when both have history', () => {
    const registry = {
      topics: {
        'topic-a': { topic: 'Topic A', publishedAt: '2026-01-01T00:00:00Z' },
        'topic-b': { topic: 'Topic B', publishedAt: '2026-01-01T00:00:00Z' },
      },
    };
    const history = {
      skills: {
        'topic-a': { history: [{ at: '2026-01-10T00:00:00Z' }] },
        'topic-b': { history: [{ at: '2026-01-03T00:00:00Z' }] },
      },
    };
    expect(pickSkillToDrill(registry, history)?.slug).toBe('topic-b');
  });
});

describe('loadRegistry() / loadHistory() / saveHistory()', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('loadHistory() returns an empty shape for a file that does not exist', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-drill-test-'));
    expect(loadHistory(path.join(dir, 'nope.json'))).toEqual({ skills: {} });
  });

  it('saveHistory() / loadHistory() round-trip real data', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-drill-test-'));
    const historyPath = path.join(dir, 'history.json');
    const history = { skills: { 'my-slug': { history: [{ at: '2026-01-01T00:00:00Z', improved: true }] } } };
    saveHistory(history, historyPath);
    expect(loadHistory(historyPath)).toEqual(history);
  });

  it('loadHistory() degrades to empty on corrupt JSON rather than throwing', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-drill-test-'));
    const historyPath = path.join(dir, 'corrupt.json');
    writeFileSync(historyPath, 'not valid json {{{', 'utf8');
    expect(loadHistory(historyPath)).toEqual({ skills: {} });
  });

  it('loadRegistry() returns an empty shape for a file that does not exist', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-drill-test-'));
    expect(loadRegistry(path.join(dir, 'nope.json'))).toEqual({ topics: {} });
  });
});
