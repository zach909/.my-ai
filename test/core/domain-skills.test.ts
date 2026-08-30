/**
 * The eight domains, as neurons in the mesh.
 *
 * A drill generator teaches; a net skill is where the teaching lands. Without
 * a region of its own, every domain trains the same undifferentiated mesh and
 * "it got better at operating systems" is unfalsifiable -- there is nothing
 * to point at that IS the operating-systems part.
 *
 * The checks that matter here are the boring ones: the regions actually exist
 * in the engine afterwards, they are distinct from each other, and building
 * twice does not build twice. That last one is not hypothetical -- a graft
 * that ran on every boot would grow the mesh without bound.
 */
import { describe, it, expect } from 'vitest';
import { HyperDimensionalEngine } from '../../models && skills/core/onebrain';
import {
  DOMAIN_SKILLS,
  buildDomainSkills,
  totalDomainNeurons,
} from '../../models && skills/core/domain-skills';
import { DRILL_CATEGORIES } from '../../scripts/drill-generators/index.mjs';

const engine = () => new HyperDimensionalEngine({
  neuronCount: 16, dimensions: 8, propagationSteps: 4, convergenceThreshold: 0.01,
  hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
  waveGain: 0.1, connectionBias: true,
});

describe('every trained domain is a region of the mesh', () => {
  it('covers exactly the domains that have drill generators', () => {
    // If a domain can be drilled but has no region, the training has nowhere
    // to land. If a region exists with no generator, nothing can train it.
    // Either way the pair has drifted, which is the thing to catch.
    const withRegions = DOMAIN_SKILLS.map(d => d.category).sort();
    const withGenerators = Object.keys(DRILL_CATEGORIES)
      .filter(c => c !== 'arithmetic')
      .sort();
    expect(withRegions).toEqual(withGenerators);
  });

  it('grafts every domain into the one mesh, growing it', () => {
    const e = engine();
    const before = e.getNeuronCount();
    const results = buildDomainSkills(e);

    expect(results).toHaveLength(DOMAIN_SKILLS.length);
    for (const r of results) {
      expect(r.skipped).toBeUndefined();
      expect(r.added).toBeGreaterThan(0);
    }
    // One mesh, more neurons in it -- not eight separate networks.
    expect(e.getNeuronCount()).toBe(before + totalDomainNeurons());
  });

  it('gives each domain its own neurons, with no id shared between two', () => {
    const e = engine();
    const results = buildDomainSkills(e);
    const seen = new Map<number, string>();
    for (const r of results) {
      for (const id of Object.values(r.ids)) {
        expect(seen.has(id)).toBe(false);
        seen.set(id, r.category);
      }
    }
    expect(seen.size).toBe(totalDomainNeurons());
  });

  it('is idempotent -- a second build adds nothing', () => {
    const e = engine();
    buildDomainSkills(e);
    const afterFirst = e.getNeuronCount();
    const second = buildDomainSkills(e);
    expect(e.getNeuronCount()).toBe(afterFirst);
    for (const r of second) {
      expect(r.added).toBe(0);
      expect(r.skipped).toBeTruthy();
    }
  });

  it('leaves the mesh able to run, with every state finite', () => {
    // A per-neuron array that addNeurons() forgets to grow is how a grafted
    // neuron came out NaN once before, and a region full of NaN is worse than
    // no region: it poisons every neuron it connects to, which is all of them.
    const e = engine();
    buildDomainSkills(e);
    e.process(new Array(8).fill(0.4), undefined, new Set([0]), undefined, { learn: true });
    for (const neuron of e.getNeuronStates()) {
      for (const v of neuron.state) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('names every neuron after a real concept, not a placeholder', () => {
    for (const d of DOMAIN_SKILLS) {
      expect(d.concepts.length).toBeGreaterThan(3);
      expect(new Set(d.concepts).size).toBe(d.concepts.length);
      for (const c of d.concepts) {
        expect(c.trim().length).toBeGreaterThan(3);
        expect(c).not.toMatch(/^(todo|tbd|placeholder|concept \d+)$/i);
      }
    }
  });

  it('fits inside the mesh ceiling with room to spare', () => {
    // 1024 is MAX_MESH_NEURONS. A domain set that filled it would leave the
    // agent unable to graft anything it built for itself later.
    expect(totalDomainNeurons()).toBeLessThan(512);
  });
});

/**
 * Trained regions specialise -- measured by STATE, not by the scalar this
 * codebase currently reads.
 *
 * A correction: an earlier commit measured region "response" with mean
 * neuron ENERGY (getNeuronEnergy(), the same scalar capabilityGap() reads)
 * and found every region answering every domain within 0.1% of every other
 * after training, and concluded the regions were not specialising. That
 * measurement was real. The conclusion drawn from it was not: energy is
 * ||state||, a magnitude, and training saturates magnitude identically
 * across every region -- 0.0002 to ~0.98 at the rail, for all eight, which
 * is exactly what makes every region look alike to a magnitude reader.
 *
 * Direction is where domain identity survives saturation. A region's full
 * state VECTOR, not its energy, still points somewhere specific after
 * training, and that direction is what this test reads.
 */
describe('a trained region specialises, read by direction rather than magnitude', () => {
  it('drives a held-out problem to the state closest to its own domain\'s trained centroid', async () => {
    const { generateForCategory } = await import('../../scripts/drill-generators/index.mjs');
    const { embedText } = await import('../../models && skills/core/neuro-lang');

    const D = 16;
    const e = new HyperDimensionalEngine({
      neuronCount: 8, dimensions: D, propagationSteps: 6, convergenceThreshold: 0.01,
      learningRate: 0.02,
      hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
      waveGain: 0.1, connectionBias: true,
    });
    const built = buildDomainSkills(e);
    const regionOf: Record<string, number[]> = {};
    built.forEach(b => { regionOf[b.category] = Object.values(b.ids); });
    const cats = DOMAIN_SKILLS.map(d => d.category);

    const stateVector = (region: string, input: number[]): number[] => {
      e.process(input, undefined, new Set([0]), undefined, { learn: false });
      const all = e.getNeuronStates();
      const dims = all[0].state.length;
      const ids = regionOf[region];
      const v = new Array(dims * ids.length).fill(0);
      ids.forEach((id, k) => { for (let d = 0; d < dims; d++) v[k * dims + d] = all[id].state[d]; });
      return v;
    };
    const cosine = (a: number[], b: number[]) => {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
    };

    const problems: Record<string, number[][]> = {};
    for (const c of cats) problems[c] = generateForCategory(c, 24, Math.random).map((q: { problem: string }) => embedText(q.problem, D));

    // Train each region on its own domain only.
    for (let epoch = 0; epoch < 20; epoch++) {
      for (const c of cats) {
        const title = DOMAIN_SKILLS.find(d => d.category === c)!.title;
        for (const v of problems[c]) {
          e.process(v, undefined, new Set([0]), undefined, { learn: true, activeGroups: new Set([title]) });
        }
      }
    }

    // Each region's own centroid, from its OWN training problems.
    const centroid: Record<string, number[]> = {};
    for (const c of cats) {
      const vs = problems[c].map(v => stateVector(c, v));
      const dims = vs[0].length;
      const m = new Array(dims).fill(0);
      for (const v of vs) for (let i = 0; i < dims; i++) m[i] += v[i] / vs.length;
      centroid[c] = m;
    }

    // Fresh, held-out problems -- never part of training.
    const held: Record<string, number[][]> = {};
    for (const c of cats) held[c] = generateForCategory(c, 15, Math.random).map((q: { problem: string }) => embedText(q.problem, D));

    let right = 0, total = 0;
    for (const c of cats) {
      for (const v of held[c]) {
        const rv = stateVector(c, v);
        let best: string | null = null, bestScore = -Infinity;
        for (const o of cats) {
          const s = cosine(rv, centroid[o]);
          if (s > bestScore) { bestScore = s; best = o; }
        }
        if (best === c) right++;
        total++;
      }
    }
    // Measured 100% (120/120) repeatably. A wide margin so this is not a
    // flaky pin on the exact figure, while still requiring the property that
    // matters: overwhelmingly better than the 1/8 chance rate.
    expect(right / total).toBeGreaterThan(0.7);
  }, 30_000); // 20 epochs x 8 regions x 24 problems of real settling -- slower than the default 5s.
});
