/**
 * Tests for the pure/testable pieces of the autonomous self-improvement
 * loop (scripts/self-improve.mjs), its peer-to-peer propagation layer
 * (scripts/peer-sync.mjs), and its process tuning (scripts/process-tuning.mjs).
 * Deliberately does NOT spin up real git worktrees, subprocesses, or
 * sockets here -- those are exercised manually (same precedent as every
 * other build-*.mjs driver script in this repo, none of which has
 * dedicated automated coverage for its subprocess/git plumbing). What's
 * covered here is the actual decision logic: mutation, the reward/punish
 * judge, scoreboard persistence, and peer message validation/merging.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  mutateHyperparams,
  decideReward,
  loadScoreboard,
  saveScoreboard,
  DEFAULT_HYPERPARAMS,
  TARGETS,
} from '../../scripts/self-improve.mjs';
import { validateImprovementMessage, mergeImprovement, loadPeers } from '../../scripts/peer-sync.mjs';
import { computeTunedEnv, tunedEnv } from '../../scripts/process-tuning.mjs';

describe('mutateHyperparams() -- evolution-strategy style perturbation', () => {
  it('stays within a bounded jitter of the base, never wildly off', () => {
    const base = { epochs: 1000, learningRate: 0.05, tolerance: 1e-3 };
    for (let i = 0; i < 20; i++) {
      const mutated = mutateHyperparams(base, Math.random);
      expect(mutated.epochs).toBeGreaterThanOrEqual(50);
      expect(mutated.epochs).toBeLessThan(base.epochs * 1.5);
      expect(mutated.learningRate).toBeGreaterThan(0);
      expect(mutated.tolerance).toBeGreaterThan(0);
    }
  });

  it('is deterministic given a fixed rand() source -- testable, not flaky', () => {
    const base = { epochs: 1000, learningRate: 0.05, tolerance: 1e-3 };
    const fixed = () => 0.5; // no jitter direction, dead center
    const a = mutateHyperparams(base, fixed);
    const b = mutateHyperparams(base, fixed);
    expect(a).toEqual(b);
  });

  it('actually varies output across different rand() draws -- real mutation, not a no-op', () => {
    const base = { epochs: 1000, learningRate: 0.05, tolerance: 1e-3 };
    const low = mutateHyperparams(base, () => 0.0);
    const high = mutateHyperparams(base, () => 1.0);
    expect(low.epochs).not.toBe(high.epochs);
  });
});

describe('decideReward() -- the judge, strict-improvement only', () => {
  it('rewards a strictly higher score', () => {
    expect(decideReward(0.9, 0.8)).toBe(true);
  });
  it('never rewards a tie -- "better than the original" means strictly better', () => {
    expect(decideReward(0.8, 0.8)).toBe(false);
  });
  it('never rewards a worse score', () => {
    expect(decideReward(0.5, 0.8)).toBe(false);
  });
});

describe('scoreboard load/save -- real file round trip, injectable path', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('loads an empty baseline when the file does not exist yet', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'self-improve-test-'));
    const board = loadScoreboard(path.join(dir, 'does-not-exist.json'));
    expect(board).toEqual({ targets: {} });
  });

  it('round-trips a saved scoreboard exactly', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'self-improve-test-'));
    const scoreboardPath = path.join(dir, 'scoreboard.json');
    const board = { targets: { 'some-script.mjs': { bestHyperparams: DEFAULT_HYPERPARAMS, bestScore: 0.5, history: [] } } };
    saveScoreboard(board, scoreboardPath);
    expect(loadScoreboard(scoreboardPath)).toEqual(board);
  });

  it('degrades to an empty baseline on a corrupt file instead of throwing', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'self-improve-test-'));
    const scoreboardPath = path.join(dir, 'corrupt.json');
    writeFileSync(scoreboardPath, 'not valid json {{{', 'utf8');
    expect(loadScoreboard(scoreboardPath)).toEqual({ targets: {} });
  });
});

describe('TARGETS -- covers the skills, not just one script', () => {
  it('includes every skill-training script this session built, not just the newest ones', () => {
    const scripts = TARGETS.map((t) => t.script);
    expect(scripts).toContain('extension-builder/build-physics-chemistry-network.mjs');
    expect(scripts).toContain('extension-builder/train-coding-skills.mjs');
    expect(scripts).toContain('extension-builder/build-main-network.mjs');
    expect(scripts).toContain('extension-builder/build-self-knowledge-network.mjs');
  });

  it('every target has a metric function that returns a number in [0,1] for a well-formed summary', () => {
    for (const target of TARGETS) {
      const score = target.metric({ trainedCount: 5, curriculumCount: 10, cmudictCount: 10, wikiCount: 10, finalAccuracy: 0.5 });
      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('every target metric degrades to 0 instead of throwing/NaN on a zero-denominator summary', () => {
    for (const target of TARGETS) {
      const score = target.metric({ trainedCount: 0, curriculumCount: 0, cmudictCount: 0, wikiCount: 0, finalAccuracy: 0 });
      expect(Number.isFinite(score)).toBe(true);
    }
  });
});

describe('peer-sync: validateImprovementMessage() -- the trust boundary', () => {
  const good = {
    type: 'scoreboard-improvement',
    target: TARGETS[0].script,
    hyperparams: { epochs: 1000, learningRate: 0.05, tolerance: 1e-3 },
    score: 0.9,
    from: 'peer-1',
  };

  it('accepts a well-formed message', () => {
    expect(validateImprovementMessage(good)).not.toBeNull();
  });

  it('rejects an unknown target script -- never trusts an arbitrary peer-supplied script name', () => {
    expect(validateImprovementMessage({ ...good, target: '../../etc/passwd' })).toBeNull();
  });

  it('rejects a non-finite or out-of-range score', () => {
    expect(validateImprovementMessage({ ...good, score: Infinity })).toBeNull();
    expect(validateImprovementMessage({ ...good, score: 2 })).toBeNull();
    expect(validateImprovementMessage({ ...good, score: -1 })).toBeNull();
  });

  it('rejects hyperparameters with insane/out-of-bounds values', () => {
    expect(validateImprovementMessage({ ...good, hyperparams: { ...good.hyperparams, epochs: -5 } })).toBeNull();
    expect(validateImprovementMessage({ ...good, hyperparams: { ...good.hyperparams, learningRate: 0 } })).toBeNull();
  });

  it('rejects a message with the wrong type tag, or that is not an object at all', () => {
    expect(validateImprovementMessage({ ...good, type: 'execute-code' })).toBeNull();
    expect(validateImprovementMessage('just a string')).toBeNull();
    expect(validateImprovementMessage(null)).toBeNull();
  });

  it('never accepts anything resembling executable content -- only the fixed scoreboard shape', () => {
    const malicious = { ...good, hyperparams: { ...good.hyperparams, code: 'require("child_process").exec("rm -rf /")' } };
    const validated = validateImprovementMessage(malicious);
    // Even though it validates (extra fields are simply not part of the
    // shape), the malicious field must not survive into the sanitized result.
    expect(validated).not.toBeNull();
    expect(validated).not.toHaveProperty('code');
    expect(JSON.stringify(validated)).not.toMatch(/child_process|exec/);
  });
});

describe('peer-sync: mergeImprovement() -- a peer can never downgrade a local best', () => {
  const target = TARGETS[0].script;
  const validated = {
    type: 'scoreboard-improvement' as const,
    target,
    hyperparams: { epochs: 900, learningRate: 0.06, tolerance: 1e-3 },
    score: 0.7,
    from: 'peer-1',
  };

  it('accepts and adopts a genuinely better peer score', () => {
    const board = { targets: { [target]: { bestHyperparams: DEFAULT_HYPERPARAMS, bestScore: 0.5, history: [] } } };
    const { board: merged, accepted } = mergeImprovement(board, validated);
    expect(accepted).toBe(true);
    expect(merged.targets[target].bestScore).toBe(0.7);
    expect(merged.targets[target].bestHyperparams).toEqual(validated.hyperparams);
  });

  it('rejects a peer score that is not better than the local best', () => {
    const board = { targets: { [target]: { bestHyperparams: DEFAULT_HYPERPARAMS, bestScore: 0.9, history: [] } } };
    const { board: unchanged, accepted } = mergeImprovement(board, validated);
    expect(accepted).toBe(false);
    expect(unchanged.targets[target].bestScore).toBe(0.9); // local best untouched
  });

  it('accepts a first-ever improvement for a target with no prior entry', () => {
    const board = { targets: {} };
    const { board: merged, accepted } = mergeImprovement(board, validated);
    expect(accepted).toBe(true);
    expect(merged.targets[target].bestScore).toBe(0.7);
  });
});

describe('peer-sync: loadPeers() -- opt-in only, empty by default', () => {
  it('returns an empty list with no env var and no peers.txt configured', () => {
    const original = process.env.NEUROCLAW_PEERS;
    delete process.env.NEUROCLAW_PEERS;
    try {
      expect(loadPeers()).toEqual([]);
    } finally {
      if (original !== undefined) process.env.NEUROCLAW_PEERS = original;
    }
  });

  it('parses a comma-separated NEUROCLAW_PEERS env var into host/port pairs', () => {
    const original = process.env.NEUROCLAW_PEERS;
    process.env.NEUROCLAW_PEERS = '10.0.0.1:7000,10.0.0.2:7001';
    try {
      const peers = loadPeers();
      expect(peers).toEqual([
        { host: '10.0.0.1', port: 7000 },
        { host: '10.0.0.2', port: 7001 },
      ]);
    } finally {
      if (original === undefined) delete process.env.NEUROCLAW_PEERS;
      else process.env.NEUROCLAW_PEERS = original;
    }
  });
});

describe('process-tuning: computeTunedEnv() -- scoped to this process only', () => {
  it('scales threadpool size with CPU count, within sane bounds', () => {
    const small = computeTunedEnv(8 * 1024 ** 3, 2);
    const large = computeTunedEnv(8 * 1024 ** 3, 64);
    expect(Number(small.UV_THREADPOOL_SIZE)).toBeGreaterThanOrEqual(4);
    expect(Number(large.UV_THREADPOOL_SIZE)).toBeLessThanOrEqual(32);
    expect(Number(large.UV_THREADPOOL_SIZE)).toBeGreaterThan(Number(small.UV_THREADPOOL_SIZE));
  });

  it('never claims more than a quarter of total system memory for the heap ceiling', () => {
    const totalMem = 16 * 1024 ** 3;
    const env = computeTunedEnv(totalMem, 8);
    const maxOldSpaceMB = Number(env.NODE_OPTIONS.match(/--max-old-space-size=(\d+)/)![1]);
    expect(maxOldSpaceMB).toBeLessThanOrEqual(totalMem / 1024 ** 2 / 4);
  });

  it('tunedEnv() lets an explicit caller-set UV_THREADPOOL_SIZE win over the computed guess', () => {
    const env = tunedEnv({ UV_THREADPOOL_SIZE: '99' });
    expect(env.UV_THREADPOOL_SIZE).toBe('99');
  });

  it('tunedEnv() appends to, rather than discards, an existing NODE_OPTIONS value', () => {
    const env = tunedEnv({ NODE_OPTIONS: '--some-existing-flag' });
    expect(env.NODE_OPTIONS).toContain('--some-existing-flag');
    expect(env.NODE_OPTIONS).toContain('--max-old-space-size=');
  });
});
