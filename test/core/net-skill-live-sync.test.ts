/**
 * The Extension Builder building directly into the network.
 *
 * updateNetSkill() is what /api/extension/live-sync runs after every builder
 * edit: the skill's region of the one live mesh is brought in line with the
 * project as it stands, instead of the project joining the mesh only when
 * someone presses Install.
 */
import { describe, it, expect } from 'vitest';
import { HyperDimensionalEngine } from '../../models && skills/core/onebrain';
import { graftNetSkill, updateNetSkill } from '../../models && skills/core/net-skill-graft';
import { NeuroPipeline } from '../../models && skills/core/pipeline';

const engine = () => new HyperDimensionalEngine({
  neuronCount: 8, dimensions: 6, propagationSteps: 4, convergenceThreshold: 0.01,
  hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
  waveGain: 0.1, connectionBias: true,
});

/** The scalar weight setConnection() wrote from `from` into `to`. */
function weight(e: HyperDimensionalEngine, to: number, from: number): number {
  const internals = e as unknown as { connDiag: Float32Array; totalDims: number };
  const N = e.getNeuronCount();
  return internals.connDiag[(to * internals.totalDims) * N + from];
}

describe('building a net skill live into the mesh', () => {
  it('a skill that was never grafted is grafted on the first sync', () => {
    const e = engine();
    const r = updateNetSkill(e, 'optics', [{ name: 'lens', definition: 'focuses light' }]);
    expect(r.added).toBe(1);
    expect(e.neuronsInGroup('optics')).toEqual([r.ids.lens]);
  });

  it('adding a neuron in the builder adds it to the same region, without re-adding the others', () => {
    const e = engine();
    const first = graftNetSkill(e, 'optics', [{ name: 'lens', definition: 'focuses light' }]);
    const before = e.getNeuronCount();
    const r = updateNetSkill(e, 'optics', [
      { name: 'lens', definition: 'focuses light' },
      { name: 'prism', definition: 'splits light into colours' },
    ]);
    expect(r.added).toBe(1);
    expect(r.updated).toBe(1);
    expect(e.getNeuronCount()).toBe(before + 1);
    expect(r.ids.lens).toBe(first.ids.lens);
    expect(e.neuronsInGroup('optics').sort()).toEqual([r.ids.lens, r.ids.prism].sort());
  });

  it('connections are rewritten to exactly what the builder has now', () => {
    const e = engine();
    updateNetSkill(e, 'optics', [
      { name: 'lens', definition: 'focuses light', connections: { prism: 0.7 } },
      { name: 'prism', definition: 'splits light' },
    ]);
    const r = updateNetSkill(e, 'optics', [
      { name: 'lens', definition: 'focuses light' },
      { name: 'prism', definition: 'splits light', connections: { lens: -0.4 } },
    ]);
    expect(weight(e, r.ids.prism, r.ids.lens)).toBe(0);
    expect(weight(e, r.ids.lens, r.ids.prism)).toBeCloseTo(-0.4, 5);
    expect(r.connections).toBe(1);
  });

  it('deleting a neuron in the builder detaches it from the region and its structure', () => {
    const e = engine();
    const first = updateNetSkill(e, 'optics', [
      { name: 'lens', definition: 'focuses light', connections: { prism: 0.7 } },
      { name: 'prism', definition: 'splits light', connections: { lens: 0.3 } },
    ]);
    const r = updateNetSkill(e, 'optics', [{ name: 'lens', definition: 'focuses light' }]);
    expect(r.removed).toBe(1);
    expect(e.neuronsInGroup('optics')).toEqual([first.ids.lens]);
    expect(weight(e, first.ids.lens, first.ids.prism)).toBe(0);
    expect(weight(e, first.ids.prism, first.ids.lens)).toBe(0);
  });

  it('a grafted skill becomes routable, so routing can switch its region on', async () => {
    const p = new NeuroPipeline({ embeddingDim: 32, hiddenDim: 32, meshNodes: 16, hyperDimensions: 16 });
    p.registerSkillRegion('optics', 'optics', 'optics lens focuses light prism splits light into colours');
    const result = await p.run(new Float32Array(32).fill(0.1), 'how does a prism split light into colours');
    expect(result.selectedPlugins).toContain('optics');
  });
});
