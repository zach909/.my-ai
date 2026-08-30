/**
 * Tests for src/lib/skill-mesh-metrics.ts -- the real, ongoing measurement
 * behind the Self-Improvement dashboard's "Skill-mesh direct-answer rate"
 * graph: every real chat message's skill-match attempt (hit or miss),
 * logged so it can be graphed over time instead of relying on a one-off
 * test run.
 */

import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { recordSkillMeshAttempt, readRecentSkillMeshAttempts } from '../../src/lib/skill-mesh-metrics';

describe('recordSkillMeshAttempt() / readRecentSkillMeshAttempts()', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a real matched attempt to disk and back', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-mesh-metrics-test-'));
    const logPath = path.join(dir, 'log.jsonl');
    recordSkillMeshAttempt({ matched: true, similarity: 0.82, matchedSkill: 'geography-basics' }, logPath);
    const attempts = readRecentSkillMeshAttempts(10, logPath);
    expect(attempts.length).toBe(1);
    expect(attempts[0].matched).toBe(true);
    expect(attempts[0].similarity).toBe(0.82);
    expect(attempts[0].matchedSkill).toBe('geography-basics');
    expect(typeof attempts[0].at).toBe('number');
  });

  it('round-trips a real miss too, with no matchedSkill', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-mesh-metrics-test-'));
    const logPath = path.join(dir, 'log.jsonl');
    recordSkillMeshAttempt({ matched: false, similarity: 0.29 }, logPath);
    const attempts = readRecentSkillMeshAttempts(10, logPath);
    expect(attempts.length).toBe(1);
    expect(attempts[0].matched).toBe(false);
    expect(attempts[0].matchedSkill).toBeUndefined();
  });

  it('preserves order across multiple appends -- oldest first', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-mesh-metrics-test-'));
    const logPath = path.join(dir, 'log.jsonl');
    recordSkillMeshAttempt({ matched: true, similarity: 0.9 }, logPath);
    recordSkillMeshAttempt({ matched: false, similarity: 0.1 }, logPath);
    recordSkillMeshAttempt({ matched: true, similarity: 0.75 }, logPath);
    const attempts = readRecentSkillMeshAttempts(10, logPath);
    expect(attempts.map((a) => a.similarity)).toEqual([0.9, 0.1, 0.75]);
  });

  it('returns an empty array for a log that does not exist yet, never throws', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-mesh-metrics-test-'));
    expect(readRecentSkillMeshAttempts(10, path.join(dir, 'nope.jsonl'))).toEqual([]);
  });

  it('respects the limit, keeping the most recent entries', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-mesh-metrics-test-'));
    const logPath = path.join(dir, 'log.jsonl');
    for (let i = 0; i < 5; i++) recordSkillMeshAttempt({ matched: i % 2 === 0, similarity: i / 10 }, logPath);
    const attempts = readRecentSkillMeshAttempts(2, logPath);
    expect(attempts.map((a) => a.similarity)).toEqual([0.3, 0.4]);
  });

  it('skips a malformed line instead of throwing', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'skill-mesh-metrics-test-'));
    const logPath = path.join(dir, 'log.jsonl');
    recordSkillMeshAttempt({ matched: true, similarity: 0.7 }, logPath);
    appendFileSync(logPath, 'not valid json {{{\n');
    const attempts = readRecentSkillMeshAttempts(10, logPath);
    expect(attempts.length).toBe(1);
  });
});
