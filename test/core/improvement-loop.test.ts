/**
 * The improvement loop promotes only what a frozen evaluator shows to be better,
 * never touches its own measurement, and leaves protected areas to a person.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImprovementLoop, type Evaluator, type Config } from '../../models && skills/core/improvement-loop.js';

/** score rises with x; falseActions rises with y. Noise-free so decisions are exact. */
function evaluator(over: Partial<Evaluator> = {}, tamper?: { fp: string }): Evaluator {
  return {
    fingerprint: () => tamper?.fp ?? 'eval-v1',
    evaluate: (c: Config, seed: number) => ({ score: Number(c.x ?? 0) + seed * 0.001, falseActions: Number(c.y ?? 0) }),
    primary: 'score', seeds: [1, 2, 3],
    guards: [{ metric: 'falseActions', maxWorsening: 0.5, lowerIsBetter: true }],
    ...over,
  };
}
const loop = (extra: Record<string, unknown> = {}, ev = evaluator()) => new ImprovementLoop({ evaluator: ev, baseline: { x: 1, y: 0 }, minGain: 0.1, revision: 'abc123', ...extra });

describe('promotion', () => {
  it('promotes a real gain and only then changes the approved configuration', () => {
    const l = loop();
    const before = l.approvedConfig();
    const d = l.consider({ id: 'p1', description: 'raise x', changes: { x: 2 } });
    expect(d.verdict).toBe('accepted');
    expect(d.promoted).toBe(true);
    expect(l.approvedConfig()).toEqual({ x: 2, y: 0 });
    expect(before).toEqual({ x: 1, y: 0 });
  });
  it('rejects a gain below the threshold, and leaves the approved configuration alone', () => {
    const l = loop();
    const d = l.consider({ id: 'p', description: 'tiny', changes: { x: 1.01 } });
    expect(d.verdict).toBe('rejected');
    expect(d.reasons.join(' ')).toMatch(/below the required/);
    expect(l.approvedConfig()).toEqual({ x: 1, y: 0 });
  });
  it('rejects a change that is better on average but worse on one seed', () => {
    const ev = evaluator({ evaluate: (c, seed) => ({ score: Number(c.x ?? 0) * (seed === 2 ? -1 : 1) * (c.x === 5 ? 1 : 1) + (c.x === 1 ? 0 : seed === 2 ? -6 : 3), falseActions: 0 }) });
    const d = loop({}, ev).consider({ id: 'p', description: 'uneven', changes: { x: 5 } });
    expect(d.verdict).toBe('rejected');
    expect(d.reasons.join(' ')).toMatch(/seeds/);
  });
  it('rejects a gain bought with more false actions (the guard)', () => {
    const d = loop().consider({ id: 'p', description: 'reckless', changes: { x: 3, y: 2 } });
    expect(d.verdict).toBe('rejected');
    expect(d.reasons.join(' ')).toMatch(/guard falseActions/);
  });
  it('builds on what was already promoted', () => {
    const l = loop();
    l.consider({ id: 'a', description: '', changes: { x: 2 } });
    const d = l.consider({ id: 'b', description: '', changes: { x: 2.05 } });
    expect(d.verdict).toBe('rejected');                 // +0.05 over the NEW baseline, not +1.05 over the original
  });
  it('evaluates on copies: the evaluator mutating its input cannot change the approved configuration', () => {
    const ev = evaluator({ evaluate: (c, seed) => { const m = c as Record<string, unknown>; const out = { score: Number(m.x) + seed * 0.001, falseActions: 0 }; m.x = -99; return out; } });
    const l = loop({}, ev);
    l.consider({ id: 'a', description: '', changes: { x: 2 } });
    expect(l.approvedConfig().x).toBe(2);
  });
});

describe('the measurement cannot be changed from inside', () => {
  it('rejects a proposal that touches the evaluator, its data or the ledger, without running it', () => {
    let runs = 0;
    const ev = evaluator({ evaluate: (c, s) => { runs++; return { score: 100, falseActions: 0 }; } });
    const l = loop({}, ev);
    for (const touches of [['benchmarks/tool_selection.mjs'], ['held-out data'], ['evaluator'], ['ledger.jsonl']]) {
      const d = l.consider({ id: touches[0], description: 'make the numbers better', changes: { x: 9 }, touches });
      expect(d.verdict).toBe('rejected');
      expect(d.reasons.join(' ')).toMatch(/cannot change what counts as better/);
    }
    expect(runs).toBe(0);
    expect(l.approvedConfig().x).toBe(1);
  });
  it('rejects everything once the evaluator no longer matches its pinned fingerprint', () => {
    const tamper = { fp: 'eval-v1' };
    const l = loop({}, evaluator({}, tamper));
    expect(l.consider({ id: 'a', description: '', changes: { x: 2 } }).verdict).toBe('accepted');
    tamper.fp = 'eval-v2-easier';
    const d = l.consider({ id: 'b', description: '', changes: { x: 50 } });
    expect(d.verdict).toBe('rejected');
    expect(d.reasons.join(' ')).toMatch(/fingerprint/);
    expect(l.approvedConfig().x).toBe(2);
  });
});

describe('protected areas wait for a person', () => {
  const cases: Array<[string, { touches?: string[]; changes: Config }]> = [
    ['a permission level', { changes: { permissionLevel: 'root' } }],
    ['the access manager', { touches: ['models && skills/core/access-manager.ts'], changes: { x: 5 } }],
    ['the approval gate', { touches: ['tool-safety'], changes: { x: 5 } }],
    ['a credential', { touches: ['credential store'], changes: { x: 5 } }],
  ];
  for (const [label, partial] of cases) {
    it(`${label}: needs-human however well it scores, and nothing is run or promoted`, () => {
      let runs = 0;
      const ev = evaluator({ evaluate: (c, s) => { runs++; return { score: Number(c.x ?? 1) + s * 0.001, falseActions: 0 }; } });
      const l = loop({}, ev);
      const d = l.consider({ id: 'prot', description: '', ...partial });
      expect(d.verdict).toBe('needs-human');
      expect(d.promoted).toBe(false);
      expect(runs).toBe(0);
      expect(l.approvedConfig()).toEqual({ x: 1, y: 0 });
    });
  }
  it('a named approval releases it to be evaluated like any other, and it still has to pass', () => {
    const l = loop();
    const p = { id: 'prot', description: '', touches: ['access-manager'], changes: { x: 5 } };
    expect(l.consider(p).verdict).toBe('needs-human');
    expect(() => l.recordHumanApproval('prot', '  ')).toThrow();
    l.recordHumanApproval('prot', 'the owner');
    expect(l.consider(p).verdict).toBe('accepted');
    const bad = { id: 'prot2', description: '', touches: ['access-manager'], changes: { x: 1 } };
    l.recordHumanApproval('prot2', 'the owner');
    expect(l.consider(bad).verdict).toBe('rejected');   // approved to be tried, not approved to win
  });
  it('an approval for one proposal is not an approval for another', () => {
    const l = loop();
    l.recordHumanApproval('one', 'the owner');
    expect(l.consider({ id: 'two', description: '', touches: ['permission'], changes: { x: 5 } }).verdict).toBe('needs-human');
  });
});

describe('the ledger', () => {
  it('records revision, evaluator, seeds, configuration, both sides numbers and the reasons, for every decision', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    try {
      const file = join(dir, 'sub', 'ledger.jsonl');
      const l = loop({ ledgerPath: file });
      l.consider({ id: 'a', description: 'good', changes: { x: 2 }, source: 'grid' });
      l.consider({ id: 'b', description: 'bad', changes: { x: 2.01 } });
      l.consider({ id: 'c', description: 'protected', changes: { x: 9 }, touches: ['access'] });
      const lines = readFileSync(file, 'utf8').trim().split('\n').map((x) => JSON.parse(x));
      expect(lines.map((x) => x.verdict)).toEqual(['accepted', 'rejected', 'needs-human']);
      expect(lines[0]).toMatchObject({ revision: 'abc123', evaluator: 'eval-v1', seeds: [1, 2, 3], proposal: { id: 'a', source: 'grid' }, promoted: true });
      expect(lines[0].baseline).toHaveLength(3);
      expect(lines[0].candidate).toHaveLength(3);
      expect(lines[1].reasons.length).toBeGreaterThan(0);
      expect(l.history()).toHaveLength(3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
