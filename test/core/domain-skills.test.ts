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
