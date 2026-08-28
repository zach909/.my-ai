/**
 * A net skill joins the mesh.
 *
 * "You have a neural network that is specialized in something and you connect
 * it directly neuron-to-neuron into the agent or core AI of the program. This
 * is not prompting skills."
 *
 * The thing that makes it a net skill rather than a note about a skill is that
 * its neurons end up in THIS network, all-to-all with everything already
 * there, every new connection carrying the same equation every old one does.
 * These tests are about that graft: what it adds, and what it must not
 * disturb.
 */
import { describe, it, expect } from 'vitest';
import { HyperDimensionalEngine } from '../../models && skills/core/onebrain';
import {
  graftNetSkill,
  graftedSkills,
  MAX_NEURONS_PER_SKILL,
  MAX_MESH_NEURONS,
} from '../../models && skills/core/net-skill-graft';

describe('grafting a net skill into the mesh', () => {
  const decode = (b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
  };

  const settings = {
    neuronCount: 8,
    dimensions: 4,
    propagationSteps: 2,
    hyperGain: 1,
    hyperAdd: 1,
    waveGain: 0.2,
    hyperWaveGain: 1,
    hyperWaveAdd: 1,
    connectionBias: true,
  };
  const input = new Array(4).fill(0.3);

  it('adds the neurons it was asked for and hands back their ids', () => {
    const engine = new HyperDimensionalEngine(settings);
    expect(engine.getNeuronCount()).toBe(8);
    const added = engine.addNeurons(3);
    expect(added).toEqual([8, 9, 10]);
    expect(engine.getNeuronCount()).toBe(11);
    expect(engine.addNeurons(0)).toEqual([]);
    expect(engine.addNeurons(-1)).toEqual([]);
  });

  it('leaves every weight that was already there exactly as it was', () => {
    // A skill that shifted the weights of the network it joined would damage
    // what it was added to, and nobody would install a second one.
    const engine = new HyperDimensionalEngine(settings);
    const before = engine.captureNetworkState();
    const oldDiag = decode(before.connDiag);
    const oldBias = decode(before.bias);
    const oldMod = decode(before.modWeight);

    engine.addNeurons(4);

    const after = engine.captureNetworkState();
    const newDiag = decode(after.connDiag);
    const newBias = decode(after.bias);
    const newMod = decode(after.modWeight);
    const oldN = 8, newN = 12, D = 5;

    // Every old connection, at its new offset, unchanged.
    for (let i = 0; i < oldN; i++) {
      for (let d = 0; d < D; d++) {
        for (let j = 0; j < oldN; j++) {
          expect(newDiag[(i * D + d) * newN + j]).toBe(oldDiag[(i * D + d) * oldN + j]);
        }
      }
    }
    for (let i = 0; i < oldN * D; i++) expect(newBias[i]).toBe(oldBias[i]);
    for (let i = 0; i < oldN; i++) expect(newMod[i]).toBe(oldMod[i]);
  });

  it('connects a new neuron to everything, both ways', () => {
    // All-to-all is the architecture. A neuron that arrived with connections
    // in one direction only would be half-attached.
    const engine = new HyperDimensionalEngine(settings);
    const [joined] = engine.addNeurons(1);
    const N = engine.getNeuronCount();
    const D = 5;
    const diag = decode(engine.captureNetworkState().connDiag);

    let intoIt = 0;
    let outOfIt = 0;
    for (let d = 0; d < D; d++) {
      for (let j = 0; j < N; j++) {
        if (j !== joined && diag[(joined * D + d) * N + j] !== 0) intoIt++;
        if (j !== joined && diag[(j * D + d) * N + joined] !== 0) outOfIt++;
      }
    }
    expect(intoIt).toBeGreaterThan(0);
    expect(outOfIt).toBeGreaterThan(0);
  });

  it('lets the skill keep its own structure, not just its neurons', () => {
    // The builder knows which of its neurons feed which. Without that the
    // skill arrives as a pile of neurons rather than a skill.
    const engine = new HyperDimensionalEngine(settings);
    const [a, b] = engine.addNeurons(2);
    expect(engine.setConnection(b, a, 0.75)).toBe(true);

    const N = engine.getNeuronCount();
    const D = 5;
    const diag = decode(engine.captureNetworkState().connDiag);
    for (let d = 0; d < D; d++) {
      expect(diag[(b * D + d) * N + a]).toBeCloseTo(0.75, 6);
    }
    // Refuses what it cannot honour rather than writing somewhere wrong.
    expect(engine.setConnection(b, b, 1)).toBe(false);
    expect(engine.setConnection(999, a, 1)).toBe(false);
    expect(engine.setConnection(b, a, Number.NaN)).toBe(false);
  });

  it('runs the same equation on the new neurons as on the old', () => {
    // The point of grafting rather than consulting: a skill's neurons are
    // computed by the hyperdimensional term and the wave layer like any
    // other, from the first tick.
    const engine = new HyperDimensionalEngine(settings);
    engine.addNeurons(4);
    const out = engine.process(input, undefined, new Set([0]));

    expect(out.outputVector.every(Number.isFinite)).toBe(true);
    const states = decode(engine.captureNetworkState().states);
    const N = engine.getNeuronCount();
    // The grafted neurons moved -- they are being computed, not carried.
    let moved = 0;
    for (let i = 8; i < N; i++) {
      for (let d = 1; d <= 4; d++) moved += Math.abs(states[d * N + i]);
    }
    expect(moved).toBeGreaterThan(0);
    // And they are in the wave pool: a wave of their own, in the shared pool.
    expect(engine.poolContent().length).toBeGreaterThan(0);
  });

  it('keeps running, and keeps learning, after the graft', () => {
    const engine = new HyperDimensionalEngine(settings);
    for (let i = 0; i < 5; i++) engine.process(input, undefined, new Set([0]));
    engine.addNeurons(6);
    let out;
    for (let i = 0; i < 20; i++) out = engine.process(input, undefined, new Set([0]));
    expect(out!.outputVector.every(Number.isFinite)).toBe(true);
    const snapshot = engine.captureNetworkState();
    expect(decode(snapshot.connDiag).every(Number.isFinite)).toBe(true);
    expect(decode(snapshot.connWaveGain).every(Number.isFinite)).toBe(true);
  });

  it('saves and restores at its new size', () => {
    // A grafted network has to be able to stop and start again like any
    // other, or installing a skill would mean losing it on the next restart.
    const engine = new HyperDimensionalEngine(settings);
    engine.addNeurons(3);
    engine.process(input, undefined, new Set([0]));
    const saved = engine.captureNetworkState();
    expect(saved.shape.neurons).toBe(11);

    const revived = new HyperDimensionalEngine(settings);
    // A network that has not grown cannot hold a grown one.
    expect(revived.restoreNetworkState(saved)).toBe(false);
    revived.addNeurons(3);
    expect(revived.restoreNetworkState(saved)).toBe(true);

    revived.process(input, undefined, new Set([0]), undefined, { learn: false });
    engine.process(input, undefined, new Set([0]), undefined, { learn: false });

    // To Float32 precision rather than byte-for-byte, and the difference is
    // worth naming: with a bias on every connection, the running engine keeps
    // its row sums by accumulating them as it learns, while a restore adds
    // them up again from the biases themselves. Same numbers, different order
    // of addition, about 3e-8 apart. The restored value is if anything the
    // more correct one -- it has not been accumulating rounding.
    const a = decode(engine.captureNetworkState().states);
    const b = decode(revived.captureNetworkState().states);
    expect(b).toHaveLength(a.length);
    const worst = a.reduce((max, v, i) => Math.max(max, Math.abs(v - b[i])), 0);
    expect(worst).toBeLessThan(1e-6);
  });
});

describe('installing a net skill', () => {
  const settings = { neuronCount: 8, dimensions: 4, propagationSteps: 1 };

  it('brings the skill\'s own structure with it, not just its neurons', () => {
    const engine = new HyperDimensionalEngine(settings);
    const result = graftNetSkill(engine, 'tide-reading', [
      { name: 'tide-height', definition: 'how high the water is', connections: { 'tide-trend': 0.8 } },
      { name: 'tide-trend', definition: 'rising or falling', connections: [{ to: 'tide-call', weight: 0.6 }] },
      { name: 'tide-call', definition: 'is it safe to cross' },
    ]);
    expect(result.added).toBe(3);
    expect(result.connections).toBe(2);
    expect(Object.keys(result.ids)).toEqual(['tide-height', 'tide-trend', 'tide-call']);
    expect(result.neuronCount).toBe(11);
  });

  it('puts each neuron where its definition points', () => {
    // Not at random. A skill neuron that began nowhere in particular would be
    // a neuron the skill contributed nothing to.
    const engine = new HyperDimensionalEngine(settings);
    graftNetSkill(engine, 'tides', [{ name: 'a', definition: 'how high the water is right now' }]);
    const other = new HyperDimensionalEngine(settings);
    graftNetSkill(other, 'tides', [{ name: 'a', definition: 'how high the water is right now' }]);

    const stateOf = (e: HyperDimensionalEngine) => {
      const snapshot = e.captureNetworkState();
      const buf = Buffer.from(snapshot.states, 'base64');
      const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      const N = snapshot.shape.neurons;
      return [1, 2, 3, 4].map(d => all[d * N + 8]);
    };
    // The same meaning lands in the same place in two separate networks,
    // which random initialisation could not do.
    expect(stateOf(engine)).toEqual(stateOf(other));
    expect(stateOf(engine).some(v => v !== 0)).toBe(true);
  });

  it('refuses to grow the network twice for the same skill', () => {
    const engine = new HyperDimensionalEngine(settings);
    const neurons = [{ name: 'one' }, { name: 'two' }];
    const first = graftNetSkill(engine, 'twice', neurons);
    const second = graftNetSkill(engine, 'twice', neurons);
    expect(first.added).toBe(2);
    expect(second.added).toBe(0);
    expect(second.ids).toEqual(first.ids);
    expect(second.skipped).toContain('already part of this network');
    expect(engine.getNeuronCount()).toBe(10);
  });

  it('caps how much one skill can enlarge the mesh, and says so', () => {
    // The mesh is all-to-all, so a settle is O(neurons squared): 64 neurons is
    // 24ms a tick and 376 is 339ms, against a loop that fires every 200ms. The
    // conversation-learning extension writes itself neurons as people talk and
    // is re-grafted every boot -- unbounded, it would make the agent slower
    // every day it was used, with nobody having asked for that.
    const engine = new HyperDimensionalEngine(settings);
    const huge = Array.from({ length: MAX_NEURONS_PER_SKILL + 40 }, (_, i) => ({ name: `n${i}` }));
    const result = graftNetSkill(engine, 'runaway', huge);
    expect(result.added).toBe(MAX_NEURONS_PER_SKILL);
    expect(result.skipped).toContain('only 256 of 296');
    expect(engine.getNeuronCount()).toBe(8 + MAX_NEURONS_PER_SKILL);
  });

  it('stops growing at all once the mesh is full', () => {
    const engine = new HyperDimensionalEngine(settings);
    engine.addNeurons(MAX_MESH_NEURONS - engine.getNeuronCount());
    expect(engine.getNeuronCount()).toBe(MAX_MESH_NEURONS);
    const result = graftNetSkill(engine, 'one-too-many', [{ name: 'nope' }]);
    expect(result.added).toBe(0);
    expect(result.skipped).toContain('full');
    expect(engine.getNeuronCount()).toBe(MAX_MESH_NEURONS);
  });

  it('lists what the network is carrying', () => {
    const engine = new HyperDimensionalEngine(settings);
    expect(graftedSkills(engine)).toEqual([]);
    graftNetSkill(engine, 'tides', [{ name: 'a' }]);
    graftNetSkill(engine, 'weather', [{ name: 'b' }, { name: 'c' }]);
    const carried = graftedSkills(engine);
    expect(carried.map(s => s.skill)).toEqual(['tides', 'weather']);
    expect(carried[1].ids).toEqual({ b: 9, c: 10 });
  });

  it('says what it did rather than nothing when there is nothing to graft', () => {
    const engine = new HyperDimensionalEngine(settings);
    const result = graftNetSkill(engine, 'empty', [{ definition: 'no name' }, {}]);
    expect(result.added).toBe(0);
    expect(result.skipped).toContain('no named neurons');
    expect(engine.getNeuronCount()).toBe(8);
  });
});
