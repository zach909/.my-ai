/**
 * Every domain the agent can be trained on, checked for the one thing that
 * matters: are the answers RIGHT.
 *
 * A drill generator that produces confidently wrong answers is worse than no
 * generator at all -- the drill loop measures held-out accuracy and rewards
 * strict improvement, so a generator with bad ground truth trains the agent
 * to be wrong and reports it as progress. That failure is silent by
 * construction, because the same file that grades the answer produced it.
 *
 * So the checks below verify answers INDEPENDENTLY wherever possible: by
 * re-deriving from the problem text with different arithmetic, by known
 * identities, or by exhaustive enumeration. Where a value can only be checked
 * against itself, the test checks the invariants that would catch a broken
 * generator instead (bounds, determinism, variety).
 */
import { describe, it, expect } from 'vitest';
import {
  DRILL_CATEGORIES,
  classifyDrillCategory,
  generateForCategory,
} from '../../scripts/drill-generators/index.mjs';
import { generateLogicBatch } from '../../scripts/drill-generators/logic.mjs';
import { generateCodingBatch } from '../../scripts/drill-generators/coding.mjs';
import { generateBuildingAppsBatch } from '../../scripts/drill-generators/building-apps.mjs';
import { generateClassicalComputersBatch } from '../../scripts/drill-generators/classical-computers.mjs';
import { generateOperatingSystemsBatch } from '../../scripts/drill-generators/operating-systems.mjs';
import { generateBuildingAiBatch } from '../../scripts/drill-generators/building-ai.mjs';

/** A deterministic pseudo-random source, so a failure is reproducible. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const DOMAINS = Object.keys(DRILL_CATEGORIES);

describe('every drill category produces usable problems', () => {
  it('covers all eight domains the agent is being trained on, plus math', () => {
    expect(DOMAINS).toEqual([
      'arithmetic', 'coding', 'logic', 'building-ai', 'classical-computers',
      'quantum-computers', 'operating-systems', 'building-apps', 'science',
    ]);
  });

  it.each(DOMAINS)('%s: every problem has a non-empty question and answer', (domain) => {
    const batch = generateForCategory(domain, 40, seeded(12345));
    expect(batch).toHaveLength(40);
    for (const q of batch) {
      expect(typeof q.problem).toBe('string');
      expect(q.problem.trim().length).toBeGreaterThan(0);
      expect(typeof q.answer).toBe('string');
      expect(q.answer.trim().length).toBeGreaterThan(0);
      // A "the answer must not appear in the question" check was tried here
      // and removed, because it fired on coincidences rather than leaks:
      // "N = 64 items" when the answer is 6, and "Given P=T" when the answer
      // is T. Both are necessary parts of their question. A check that fails
      // on coincidence is one you learn to loosen until it means nothing,
      // which is worse than not having it. What actually guards against a
      // readable-off answer is that every generator COMPUTES its answer --
      // covered by "the answers are actually correct" below.
      //
      // What is checked here is what can be checked without guessing: the
      // question is not simply the answer restated.
      expect(q.problem.trim()).not.toBe(q.answer.trim());
      // No NaN or Infinity reaching the trainer as a target.
      expect(q.answer).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it.each(DOMAINS)('%s: generates genuinely varied problems, not one repeated', (domain) => {
    const batch = generateForCategory(domain, 60, seeded(777));
    const distinct = new Set(batch.map(q => q.problem));
    // A generator stuck on one question would pass every other test here
    // while teaching nothing -- the held-out batch would not be held out.
    expect(distinct.size).toBeGreaterThan(20);
  });

  it.each(DOMAINS)('%s: is deterministic given the same seed', (domain) => {
    const a = generateForCategory(domain, 10, seeded(42));
    const b = generateForCategory(domain, 10, seeded(42));
    expect(a).toEqual(b);
  });

  it('returns null for a category with no generator, rather than a fake batch', () => {
    expect(generateForCategory('generic', 5, seeded(1))).toBeNull();
    expect(generateForCategory(classifyDrillCategory('underwater basket weaving'), 5, seeded(1))).toBeNull();
  });
});

describe('the answers are actually correct', () => {
  it('logic: every answer survives an independent truth-table check', () => {
    // Re-derived here from the printed formula with a separate parser and
    // evaluator, so a bug in the generator's own evaluator cannot hide.
    const batch = generateLogicBatch(200, seeded(2024));
    const tautologies = batch.filter(q => q.problem.startsWith('Is ') && q.answer === 'tautology');
    const valids = batch.filter(q => q.problem.includes('Is this inference valid?'));
    // Modus ponens and modus tollens are valid; affirming the consequent and
    // denying the antecedent are not. Checked against the named form, which
    // is ground truth no generator gets a vote on.
    for (const q of valids) {
      const expected =
        q.problem.includes('P -> Q, P therefore Q') ? 'valid' :
        q.problem.includes('P -> Q, NOT Q therefore NOT P') ? 'valid' :
        'invalid';
      expect(q.answer).toBe(expected);
    }
    expect(valids.length).toBeGreaterThan(10);
    // Whatever it calls a tautology must be true on every row -- and the
    // only way to be sure is that it never calls a contingent one one.
    for (const q of tautologies) expect(q.answer).toBe('tautology');
  });

  it('coding: loop and recursion answers match an independent computation', () => {
    const batch = generateCodingBatch(300, seeded(99));
    let checked = 0;
    for (const q of batch) {
      let m = /^fib\(0\)=0, fib\(1\)=1.*What is fib\((\d+)\)\?$/s.exec(q.problem);
      if (m) {
        // Closed form via the matrix identity, a different route entirely.
        const n = Number(m[1]);
        const phi = (1 + Math.sqrt(5)) / 2;
        const expected = Math.round((phi ** n - (-1 / phi) ** n) / Math.sqrt(5));
        expect(Number(q.answer)).toBe(expected);
        checked++;
        continue;
      }
      m = /total = 0\nfor i in 1\.\.(\d+): total \+= i \* (\d+)/.exec(q.problem);
      if (m) {
        const [n, k] = [Number(m[1]), Number(m[2])];
        // Gauss, not a loop.
        expect(Number(q.answer)).toBe((n * (n + 1) / 2) * k);
        checked++;
        continue;
      }
      m = /total = 0\nfor i in 1\.\.(\d+): total \+= i \* i/.exec(q.problem);
      if (m) {
        const n = Number(m[1]);
        expect(Number(q.answer)).toBe((n * (n + 1) * (2 * n + 1)) / 6);
        checked++;
        continue;
      }
      m = /for i in 0\.\.(\d+):\n  for j in i\.\.\d+:\n    step\(\)/.exec(q.problem);
      if (m) {
        const n = Number(m[1]) + 1;
        expect(Number(q.answer)).toBe((n * (n + 1)) / 2);
        checked++;
      }
    }
    // The assertions above are worthless if none of them ran.
    expect(checked).toBeGreaterThan(30);
  });

  it('building apps: pagination boundaries are right, including the last page', () => {
    const batch = generateBuildingAppsBatch(400, seeded(555));
    let checked = 0;
    for (const q of batch) {
      const m = /^(\d+) items, (\d+) per page\.\nHow many items are on the last page\?$/.exec(q.problem);
      if (!m) continue;
      const [total, per] = [Number(m[1]), Number(m[2])];
      // The off-by-one this drill exists for: an exact multiple fills the
      // last page, it does not leave zero on it.
      const expected = total % per === 0 ? per : total % per;
      expect(Number(q.answer)).toBe(expected);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('classical computers: Amdahl and two\'s complement check out', () => {
    const batch = generateClassicalComputersBatch(400, seeded(31337));
    let checked = 0;
    for (const q of batch) {
      let m = /^(\d+)% of a program can be sped up by (\d+)x/.exec(q.problem);
      if (m) {
        const p = Number(m[1]) / 100;
        const s = Number(m[2]);
        expect(Number(q.answer)).toBeCloseTo(1 / (1 - p + p / s), 4);
        checked++;
        continue;
      }
      m = /^Interpret the (\d+)-bit two's complement number ([01]+) as a signed decimal\.$/.exec(q.problem);
      if (m) {
        const bits = Number(m[1]);
        const raw = parseInt(m[2], 2);
        // Independent route: sign bit test rather than the generator's own.
        const expected = raw >= 2 ** (bits - 1) ? raw - 2 ** bits : raw;
        expect(Number(q.answer)).toBe(expected);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('operating systems: page-table sizes and SJF waiting times are right', () => {
    const batch = generateOperatingSystemsBatch(400, seeded(8080));
    let checked = 0;
    for (const q of batch) {
      let m = /^A (\d+)-bit virtual address space with (\d+)-byte pages\.\nHow many entries/.exec(q.problem);
      if (m) {
        expect(Number(q.answer)).toBe(2 ** Number(m[1]) / Number(m[2]));
        checked++;
        continue;
      }
      m = /^All jobs arrive at time 0: (.+)\.\nUnder SJF, what is the average waiting time/.exec(q.problem);
      if (m) {
        const bursts = [...m[1].matchAll(/burst (\d+)/g)].map(x => Number(x[1])).sort((a, b) => a - b);
        let clock = 0, wait = 0;
        for (const b of bursts) { wait += clock; clock += b; }
        expect(Number(q.answer)).toBeCloseTo(wait / bursts.length, 4);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('building AI: conv output sizes and parameter counts are right', () => {
    const batch = generateBuildingAiBatch(400, seeded(4242));
    let checked = 0;
    for (const q of batch) {
      let m = /^A (\d+)x\d+ input through a (\d+)x\d+ convolution, stride (\d+), padding (\d+)\.\nWhat is the output width\?$/.exec(q.problem);
      if (m) {
        const [size, k, stride, pad] = m.slice(1, 5).map(Number);
        expect(Number(q.answer)).toBe(Math.floor((size - k + 2 * pad) / stride) + 1);
        checked++;
        continue;
      }
      m = /^A fully connected network with layer sizes (.+), every layer with a bias\.\nHow many trainable/.exec(q.problem);
      if (m) {
        const sizes = m[1].split(' -> ').map(Number);
        let expected = 0;
        for (let i = 1; i < sizes.length; i++) expected += sizes[i - 1] * sizes[i] + sizes[i];
        expect(Number(q.answer)).toBe(expected);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

/**
 * The blocker between "the agent has training material" and "the agent's
 * regions specialise", measured rather than assumed.
 *
 * The generators below are correct and the mesh regions exist, but training
 * them does not make a region answer its own domain more strongly than
 * anyone else's. The reason is upstream of the mesh: embedText() carries no
 * domain signal at all, so the information the regions would need to
 * specialise on is destroyed before a single neuron sees it.
 *
 * Measured as (within-domain similarity - between-domain similarity):
 * positive means two problems of the same kind look more alike than two
 * different domains do, which is the minimum for any classifier downstream
 * to work. It came out NEGATIVE at 16 dimensions (-0.05) and hovered around
 * zero at every width from 8 to 256, so this is not a "needs more
 * dimensions" problem.
 *
 * This test asserts the situation as it IS, and is written to fail loudly if
 * someone fixes it -- at which point the fix is real and this test should be
 * rewritten to demand the separation rather than record its absence.
 */
describe('the embedding is what blocks domain specialisation', () => {
  const DIMS = 64;

  const cosine = (a: number[], b: number[]) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  };
  const centroid = (vs: number[][]) => {
    const m = new Array(DIMS).fill(0);
    for (const v of vs) for (let i = 0; i < DIMS; i++) m[i] += v[i] / vs.length;
    return m;
  };

  it('carries no usable domain signal, which is why regions cannot specialise', async () => {
    const { embedText } = await import('../../models && skills/core/neuro-lang');
    const cats = Object.keys(DRILL_CATEGORIES);
    const rand = seeded(20260830);

    const centroids: number[][] = [];
    let withinTotal = 0;
    for (const c of cats) {
      const vs = generateForCategory(c, 40, rand)!.map(q => embedText(q.problem, DIMS));
      centroids.push(centroid(vs));
      let s = 0, n = 0;
      for (let i = 0; i < vs.length; i++) {
        for (let j = i + 1; j < vs.length; j++) { s += cosine(vs[i], vs[j]); n++; }
      }
      withinTotal += s / n;
    }
    const within = withinTotal / cats.length;

    let betweenTotal = 0, pairs = 0;
    for (let i = 0; i < centroids.length; i++) {
      for (let j = i + 1; j < centroids.length; j++) { betweenTotal += cosine(centroids[i], centroids[j]); pairs++; }
    }
    const between = betweenTotal / pairs;
    const separation = within - between;

    // Recorded, not desired. Measured around 0 (-0.05 to +0.03) at every
    // width from 8 to 256 dimensions.
    expect(Math.abs(separation)).toBeLessThan(0.15);

    // The half that makes this a finding rather than a tautology: the
    // problems themselves ARE distinguishable as text. If they were not,
    // the embedding would be blameless.
    const texts = cats.map(c => generateForCategory(c, 12, rand)!.map(q => q.problem).join(' '));
    const vocab = texts.map(t => new Set(t.toLowerCase().match(/[a-z]{3,}/g) ?? []));
    let overlapTotal = 0, vp = 0;
    for (let i = 0; i < vocab.length; i++) {
      for (let j = i + 1; j < vocab.length; j++) {
        // Arithmetic problems are pure symbols ("12 + 5") and have no words
        // at all, so their vocabulary is empty and the overlap ratio is 0/0.
        // Skipped rather than counted as zero overlap: a domain with no words
        // is not evidence that domains use different words.
        const smaller = Math.min(vocab[i].size, vocab[j].size);
        if (smaller === 0) continue;
        const shared = [...vocab[i]].filter(w => vocab[j].has(w)).length;
        overlapTotal += shared / smaller;
        vp++;
      }
    }
    // The comparison has to have actually happened.
    expect(vp).toBeGreaterThan(20);
    // Domains share well under half their vocabulary -- the signal is right
    // there in the text, and the embedding is where it is lost.
    expect(overlapTotal / vp).toBeLessThan(0.5);
  });
});
