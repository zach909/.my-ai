/**
 * Tests for scripts/skill-agent.mjs's pure/testable pieces: topic
 * slugging, registry persistence, topic rotation, and wiki-page
 * rendering from a ResearchReport. The heavy end-to-end mechanics
 * (real sandbox worktree, real research, real training, real publish)
 * are exercised manually via `node scripts/skill-agent.mjs --once
 * <topic>` before shipping, same precedent as every other build-*.mjs/
 * self-improve.mjs driver in this repo.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { slugifyTopic, loadRegistry, saveRegistry, pickTopic, renderWikiPage, TOPIC_POOL } from '../../scripts/skill-agent.mjs';
import { validateNewSkillMessage } from '../../scripts/peer-sync.mjs';

describe('slugifyTopic()', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyTopic('Quantum Computing Error Correction')).toBe('quantum-computing-error-correction');
  });
  it('strips non-alphanumeric characters and collapses runs of them', () => {
    expect(slugifyTopic("what's-up?! doc")).toBe('what-s-up-doc');
  });
  it('never leaves leading/trailing hyphens', () => {
    expect(slugifyTopic('  spaced out  ')).toBe('spaced-out');
  });
});

describe('registry load/save -- real file round trip', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('loads an empty baseline when the file does not exist yet', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-agent-test-'));
    expect(loadRegistry(path.join(dir, 'nope.json'))).toEqual({ topics: {} });
  });

  it('round-trips a saved registry exactly', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-agent-test-'));
    const registryPath = path.join(dir, 'registry.json');
    const registry = { topics: { 'a-topic': { publishedAt: '2026-01-01T00:00:00Z', verifiedCount: 2, history: [] } } };
    saveRegistry(registry, registryPath);
    expect(loadRegistry(registryPath)).toEqual(registry);
  });

  it('degrades to an empty baseline on a corrupt file instead of throwing', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-agent-test-'));
    const registryPath = path.join(dir, 'corrupt.json');
    writeFileSync(registryPath, 'not valid json {{{', 'utf8');
    expect(loadRegistry(registryPath)).toEqual({ topics: {} });
  });
});

describe('pickTopic() -- real rotation, not always the first entry', () => {
  it('prefers an entirely uncovered topic over any already-covered one', () => {
    const registry = { topics: { [slugifyTopic(TOPIC_POOL[0])]: { publishedAt: '2026-01-01T00:00:00Z' } } };
    const picked = pickTopic(registry, TOPIC_POOL, () => 0); // deterministic: first uncovered
    expect(picked).not.toBe(TOPIC_POOL[0]);
  });

  it('once every topic is covered, picks the one covered longest ago', () => {
    const registry = { topics: {} as Record<string, { publishedAt: string }> };
    TOPIC_POOL.forEach((t, i) => {
      registry.topics[slugifyTopic(t)] = { publishedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z` };
    });
    const picked = pickTopic(registry, TOPIC_POOL);
    expect(picked).toBe(TOPIC_POOL[0]); // earliest publishedAt
  });

  it('spreads picks across the pool for different registries instead of collapsing to one topic', () => {
    const picks = new Set<string>();
    for (let i = 0; i < TOPIC_POOL.length; i++) {
      picks.add(pickTopic({ topics: {} }, TOPIC_POOL, () => i / TOPIC_POOL.length));
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe('renderWikiPage()', () => {
  const topic = 'test topic';

  it('returns null when there is nothing corroborated -- no page for pure speculation', () => {
    const report = { topic, claims: [{ claim: 'unverified thing', sources: [{ source: 'web' }], verified: false }], verifiedCount: 0, unverifiedCount: 1 };
    expect(renderWikiPage(topic, report as any)).toBeNull();
  });

  it('renders verified claims prominently with their corroborating sources listed', () => {
    const report = {
      topic,
      claims: [
        { claim: 'a real corroborated fact', sources: [{ source: 'web' }, { source: 'memory' }], verified: true },
      ],
      verifiedCount: 1,
      unverifiedCount: 0,
    };
    const page = renderWikiPage(topic, report as any)!;
    expect(page).toContain('a real corroborated fact');
    expect(page).toContain('Verified findings');
    expect(page).toMatch(/corroborated by:.*web/);
  });

  it('keeps unverified findings in a clearly separate, explicitly-labeled section', () => {
    const report = {
      topic,
      claims: [
        { claim: 'a real corroborated fact', sources: [{ source: 'web' }, { source: 'memory' }], verified: true },
        { claim: 'a single-sourced rumor', sources: [{ source: 'web' }], verified: false },
      ],
      verifiedCount: 1,
      unverifiedCount: 1,
    };
    const page = renderWikiPage(topic, report as any)!;
    expect(page).toContain('Unverified (single-source) findings');
    expect(page).toContain('a single-sourced rumor');
    // The unverified section must come after (be visually subordinate
    // to) the verified section.
    expect(page.indexOf('Verified findings')).toBeLessThan(page.indexOf('Unverified'));
  });

  it('always discloses that the page was AI-generated and what "verified" actually means', () => {
    const report = { topic, claims: [{ claim: 'x', sources: [{ source: 'web' }, { source: 'memory' }], verified: true }], verifiedCount: 1, unverifiedCount: 0 };
    const page = renderWikiPage(topic, report as any)!;
    expect(page).toMatch(/generated autonomously/i);
    expect(page).toMatch(/not independent human fact-checking|not.*human fact-checking/i);
  });
});

describe('peer-sync: validateNewSkillMessage() -- the trust boundary for skill notifications', () => {
  const good = { type: 'new-skill-published', topic: 'quantum computing', slug: 'quantum-computing', from: 'peer-1' };

  it('accepts a well-formed notification', () => {
    expect(validateNewSkillMessage(good)).not.toBeNull();
  });

  it('rejects the wrong type tag', () => {
    expect(validateNewSkillMessage({ ...good, type: 'scoreboard-improvement' })).toBeNull();
  });

  it('rejects missing or oversized topic/slug fields', () => {
    expect(validateNewSkillMessage({ ...good, topic: '' })).toBeNull();
    expect(validateNewSkillMessage({ ...good, topic: 'x'.repeat(400) })).toBeNull();
    expect(validateNewSkillMessage({ ...good, slug: undefined })).toBeNull();
  });

  it('never carries page content -- only topic/slug/from survive validation', () => {
    const malicious = { ...good, content: 'x'.repeat(100000), code: 'require("fs").rmSync("/", {recursive:true})' };
    const validated = validateNewSkillMessage(malicious);
    expect(validated).not.toBeNull();
    expect(validated).not.toHaveProperty('content');
    expect(validated).not.toHaveProperty('code');
  });
});
