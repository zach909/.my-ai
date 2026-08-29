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
import { NeuroLangInterpreter } from '../../models && skills/core/neuro-lang';
import { embedText } from '../../models && skills/core/neuro-lang';
import {
  graftNetSkill,
  graftedSkills,
  MAX_NEURONS_PER_SKILL,
  MAX_MESH_NEURONS,
  waveForMeaning,
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

describe('a net skill\'s wave', () => {
  const settings = {
    neuronCount: 8,
    dimensions: 6,
    propagationSteps: 2,
    waveGain: 0.2,
    waveFeedback: 0.5,
    connectionBias: true,
  };
  const input = new Array(6).fill(0.35);

  it('gives a neuron the wave its meaning asks for, the same everywhere', () => {
    // A published skill has to sound the same on every machine that installs
    // it. Placed at random it would be a different skill on each one -- the
    // neurons would sit at different frequencies, so they would interfere with
    // different things and hear different things back.
    const a = new HyperDimensionalEngine(settings);
    const b = new HyperDimensionalEngine(settings);
    const neurons = [{ name: 'height', definition: 'how high the water is right now' }];
    const ra = graftNetSkill(a, 'tides', neurons);
    const rb = graftNetSkill(b, 'tides', neurons);
    expect(a.waveSignature(ra.ids.height)).toEqual(b.waveSignature(rb.ids.height));

    // And it is the wave the meaning asks for, not whatever slot was next.
    const wanted = waveForMeaning('how high the water is right now');
    expect(a.waveSignature(ra.ids.height)!.frequency).toBeCloseTo(wanted.frequency, 5);
  });

  it('puts different meanings on different waves', () => {
    const one = waveForMeaning('how high the water is right now');
    const other = waveForMeaning('a completely unrelated idea about bicycles');
    expect(one.frequency).not.toBeCloseTo(other.frequency, 3);
    // Phase is not a function of frequency: two definitions that collided in
    // the band would otherwise also arrive exactly in step.
    expect(one.phase).not.toBeCloseTo(other.phase, 3);
  });

  it('is genuinely in the shared pool once grafted', () => {
    const engine = new HyperDimensionalEngine(settings);
    graftNetSkill(engine, 'tides', [
      { name: 'height', definition: 'how high the water is right now' },
      { name: 'trend', definition: 'whether the water is rising or falling' },
    ]);
    for (let t = 0; t < 4; t++) engine.process(input, undefined, new Set([0]));

    const wanted = waveForMeaning('how high the water is right now');
    const heard = engine.poolContent().some(bin => Math.abs(bin.frequency - wanted.frequency) < 0.01);
    expect(heard).toBe(true);
  });

  it('magnifies neurons that agree and leaves ones that differ alone', () => {
    // "All the contradicting answers cancel out and the only correct one gets
    // magnified." Same meaning means same frequency, and waves at one
    // frequency add -- so a chorus is loud and a crowd is not.
    //
    // Measured: eight neurons that agree put 6.2 into that frequency; eight
    // that differ put 0.04. It is sharply non-linear rather than proportional
    // -- flat up to about four neurons, then it climbs to the pool's ceiling
    // -- because each one hears the bin it is emitting into.
    const chorus = (agree: boolean) => {
      const engine = new HyperDimensionalEngine(settings);
      const meaning = 'the water is rising';
      graftNetSkill(engine, 'chorus', Array.from({ length: 8 }, (_, i) => ({
        name: `n${i}`,
        definition: agree ? meaning : `${meaning} number ${i} said a different way entirely`,
      })));
      for (let t = 0; t < 4; t++) engine.process(input, undefined, new Set([0]));
      const wanted = waveForMeaning(meaning);
      return engine.poolContent().find(b => Math.abs(b.frequency - wanted.frequency) < 0.01)?.magnitude ?? 0;
    };

    const agreeing = chorus(true);
    const differing = chorus(false);
    expect(agreeing).toBeGreaterThan(differing * 10);
  });
});

describe('reading one neuron out of the pool', () => {
  const settings = { neuronCount: 10, dimensions: 6, propagationSteps: 2, waveGain: 0.3, waveFeedback: 0.5 };

  const decodeStates = (engine: HyperDimensionalEngine) => {
    const snapshot = engine.captureNetworkState();
    const buf = Buffer.from(snapshot.states, 'base64');
    return { snapshot, states: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) };
  };
  const encode = (f: Float32Array) => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');

  it('says what one neuron is holding, by interference', () => {
    // "When every neuron has the same input except for the neuron you want to
    // find's input, then it should release a wave which is its wave." Hold the
    // network at one value, leave one neuron out of the chorus, and its own
    // frequency carries its own contribution -- nothing has to be traced
    // through the connections.
    const engine = new HyperDimensionalEngine(settings);
    const { snapshot, states } = decodeStates(engine);
    const N = 10;

    const held = (value: number) => {
      const next = Float32Array.from(states);
      for (let d = 1; d <= 6; d++) next[d * N + 4] = value;
      engine.restoreNetworkState({ ...snapshot, states: encode(next) });
      return engine.probeByInterference(4)!.amplitude;
    };

    const quiet = held(0.02);
    const loud = held(0.95);
    expect(loud).toBeGreaterThan(quiet * 5);
  });

  it('does not disturb the network it is asking about', () => {
    // Reading is not learning, and a probe is not a tick. This file has been
    // bitten before: fifty idle read ticks once moved 98% of the connections.
    const engine = new HyperDimensionalEngine(settings);
    const before = engine.captureNetworkState();
    for (let i = 0; i < 10; i++) engine.probeByInterference(i);
    expect(engine.captureNetworkState()).toEqual(before);
  });

  it('refuses rather than answering zero when there is nothing to read', () => {
    // A network with its wave layer off has nothing to interfere. Zero would
    // read as "this neuron contributes nothing", which is a different claim.
    const silent = new HyperDimensionalEngine({ ...settings, waveGain: 0 });
    expect(silent.probeByInterference(0)).toBeNull();
    const engine = new HyperDimensionalEngine(settings);
    expect(engine.probeByInterference(99)).toBeNull();
    expect(engine.probeByInterference(-1)).toBeNull();
  });
});

describe('a skill that names its own waves', () => {
  it('round-trips @wave through the language', async () => {
    // The builder writes it, the parser reads it back. Without the round trip
    // a skill could be given a wave in the editor and lose it the moment it
    // was saved.
    const parsed = await new NeuroLangInterpreter().parse([
      'name="bit-one"',
      '"bit-one"@definition="the one"',
      '"bit-one"@wave="0.25,0"',
      'name="bit-zero"',
      '"bit-zero"@definition="the zero"',
      '"bit-zero"@wave="0.25,3.14159"',
    ].join('\n'));

    expect(parsed.errors).toEqual([]);
    expect(parsed.neurons.get('bit-one')!.wave).toEqual({ frequency: 0.25, phase: 0 });
    expect(parsed.neurons.get('bit-zero')!.wave).toEqual({ frequency: 0.25, phase: 3.14159 });
  });

  it('honours the wave the skill asked for over the one its meaning implies', () => {
    // The case meaning cannot express: two neurons that must be perfect
    // enemies, the same frequency half a cycle apart. Two different
    // definitions would otherwise land on two different frequencies and never
    // meet, let alone cancel.
    const engine = new HyperDimensionalEngine({ neuronCount: 8, dimensions: 4, propagationSteps: 1, waveGain: 0.2 });
    const result = graftNetSkill(engine, 'bits', [
      { name: 'one', definition: 'the one', wave: { frequency: 0.25, phase: 0 } },
      { name: 'zero', definition: 'the zero', wave: { frequency: 0.25, phase: Math.PI } },
    ]);

    const one = engine.waveSignature(result.ids.one)!;
    const zero = engine.waveSignature(result.ids.zero)!;
    expect(one.frequency).toBeCloseTo(0.25, 6);
    expect(zero.frequency).toBeCloseTo(0.25, 6);
    expect(Math.abs(one.phase - zero.phase)).toBeCloseTo(Math.PI, 5);
    // And it is NOT what the definitions would have given them.
    expect(waveForMeaning('the one').frequency).not.toBeCloseTo(0.25, 3);
  });

  it('falls back to meaning when only half a wave is given', () => {
    const engine = new HyperDimensionalEngine({ neuronCount: 8, dimensions: 4, propagationSteps: 1, waveGain: 0.2 });
    const result = graftNetSkill(engine, 'half', [
      { name: 'a', definition: 'a thing', wave: { frequency: 0.3 } },
    ]);
    const signature = engine.waveSignature(result.ids.a)!;
    expect(signature.frequency).toBeCloseTo(0.3, 6);
    expect(signature.phase).toBeCloseTo(waveForMeaning('a thing').phase, 5);
  });
});

describe('experts are groups inside the one network', () => {
  const settings = { neuronCount: 12, dimensions: 4, propagationSteps: 2, hyperGain: 1, hyperAdd: 1, waveGain: 0.1 };
  const input = new Array(4).fill(0.3);

  const decode = (b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
  };
  const moved = (before: number[], after: number[], i: number, N = 12) => {
    for (let d = 1; d <= 4; d++) if (Math.abs(before[d * N + i] - after[d * N + i]) > 1e-9) return true;
    return false;
  };

  const grouped = () => {
    const engine = new HyperDimensionalEngine(settings);
    for (let i = 4; i < 8; i++) engine.setNeuronGroup(i, 'weather');
    for (let i = 8; i < 12; i++) engine.setNeuronGroup(i, 'tides');
    return engine;
  };

  it('computes the groups that were asked for and holds the ones that were not', () => {
    // The neuron-level MoE, and the reason the second network could go: gating
    // used to mean a separate ElasticCoreBlock stage running in front of this
    // one, whose neurons computed a plain weighted sum with none of the
    // equation. A group is a label on a neuron here, not a network of its own.
    const engine = grouped();
    const before = decode(engine.captureNetworkState().states);
    engine.process(input, undefined, new Set([0]), undefined, { activeGroups: new Set(['weather']) });
    const after = decode(engine.captureNetworkState().states);

    expect([1, 2, 3].every(i => moved(before, after, i))).toBe(true);   // ungrouped: always computes
    expect([4, 5, 6, 7].every(i => moved(before, after, i))).toBe(true); // asked for
    expect([8, 9, 10, 11].some(i => moved(before, after, i))).toBe(false); // held
  });

  it('computes everything when no groups are named', () => {
    const engine = grouped();
    const before = decode(engine.captureNetworkState().states);
    engine.process(input, undefined, new Set([0]));
    const after = decode(engine.captureNetworkState().states);
    expect([1, 5, 9, 11].every(i => moved(before, after, i))).toBe(true);
  });

  it('feeds a driven neuron whatever its group says', () => {
    // Driven wins. Something being fed from outside is being fed, whatever
    // else is true of it.
    const engine = grouped();
    const before = decode(engine.captureNetworkState().states);
    engine.process(input, undefined, new Set([9]), undefined, { activeGroups: new Set(['weather']) });
    const after = decode(engine.captureNetworkState().states);
    expect(moved(before, after, 9)).toBe(true);
    expect([8, 10, 11].some(i => moved(before, after, i))).toBe(false);
  });

  it('keeps a held neuron wired to everything, not disconnected', () => {
    // Held is not removed. The neuron is still all-to-all: it is simply not
    // asked to move this tick, and everything that IS moving still reads it.
    const engine = grouped();
    const N = 12, D = 5;
    const diag = decode(engine.captureNetworkState().connDiag);
    let intoHeld = 0, outOfHeld = 0;
    for (let d = 0; d < D; d++) {
      for (let j = 0; j < N; j++) {
        if (j !== 9 && diag[(9 * D + d) * N + j] !== 0) intoHeld++;
        if (j !== 9 && diag[(j * D + d) * N + 9] !== 0) outOfHeld++;
      }
    }
    expect(intoHeld).toBeGreaterThan(0);
    expect(outOfHeld).toBeGreaterThan(0);
  });
});

describe('a grafted skill arrives as a region', () => {
  it('labels every neuron it added with the skill it belongs to', () => {
    // Grafting used to add neurons and wire them and then leave them
    // anonymous: the engine's own gating could not select the skill, and
    // skillAffinity() could not see it. A Net Skill that the network cannot
    // name is not a region, it is a pile of neurons that arrived together.
    const engine = new HyperDimensionalEngine({ neuronCount: 8, dimensions: 8 });
    const result = graftNetSkill(engine, 'optics', [
      { name: 'lens', definition: 'bends light toward a focus' },
      { name: 'ray', definition: 'a straight path of light', connections: { lens: 0.6 } },
    ]);

    expect(result.added).toBe(2);
    const ids = Object.values(result.ids);
    for (const id of ids) expect(engine.neuronGroupsOf(id)).toContain('optics');
    expect(engine.neuronsInGroup('optics').sort((a, b) => a - b)).toEqual(ids.sort((a, b) => a - b));
  });

  it('lets a grafted skill be asked for by name on a tick', () => {
    const engine = new HyperDimensionalEngine({ neuronCount: 8, dimensions: 8 });
    graftNetSkill(engine, 'optics', [{ name: 'lens', definition: 'bends light' }]);
    const before = engine.captureNetworkState().states;
    engine.process(new Array(8).fill(0.4), undefined, new Set([0]), undefined,
      { learn: false, activeGroups: new Set(['optics']) });
    expect(engine.captureNetworkState().states).not.toBe(before);
  });
});

describe('the capability loop closes on itself', () => {
  /**
   * The whole cycle, in one test:
   *
   *   input -> mesh -> no region handles this -> build -> connect ->
   *   the wave reaches the new capability -> the same input no longer
   *   reads as a gap
   *
   * Creation and connection were demonstrable before this. What was not was
   * the loop CYCLING -- a region appeared in the mesh and nothing ever ran
   * through it, so nothing could tell whether building it had helped.
   *
   * It turned on one thing: a grafted neuron was placed by its STATE, which
   * a non-driven neuron recomputes from its inputs on every tick, so the
   * placement survived exactly one iteration. The skill was in the mesh,
   * connected to everything, and deaf to the one thing it was built for.
   * Tuning its incoming weights is what makes "the next time the AI
   * encounters that type of file, the wave can reach the newly created
   * capability" actually true.
   */
  const D = 8;
  it('reports a gap, and stops reporting it once the capability is built', () => {
    const engine = new HyperDimensionalEngine({
      neuronCount: 24, dimensions: D, propagationSteps: 8,
      hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
      waveGain: 0.1, connectionBias: true,
    });
    const covered: Record<string, string> = {
      alpha: 'reading and writing files on disk',
      beta: 'sending and receiving network messages',
      gamma: 'drawing shapes and colours on a screen',
    };
    let id = 1;
    for (const [name, meaning] of Object.entries(covered)) {
      engine.setNeuronGroup(id, name);
      engine.tuneNeuronTo(id, 0, embedText(meaning, D));
      id++;
    }
    // Magnitude matched, always: region response is how much a region is
    // doing, and a louder input makes everything do more.
    const ask = (text: string) => {
      const v = embedText(text, D);
      let n = 0;
      for (const x of v) n += x * x;
      n = n > 0 ? 1 / Math.sqrt(n) : 0;
      engine.process(Array.from(v, x => x * n * Math.sqrt(D) * 0.4),
        undefined, new Set([0]), undefined, { learn: false });
      return engine.capabilityGap();
    };
    for (let r = 0; r < 6; r++) for (const m of Object.values(covered)) ask(m);

    const novel = 'decoding qzx archive chunk tables with a range coder';
    let before = ask(novel);
    for (let k = 0; k < 4; k++) before = ask(novel);
    expect(before.needed).toBe(true);

    // The Extension Builder's half: a region for exactly that capability.
    const built = graftNetSkill(engine, 'qzx-reader', [{ name: 'qzx-reader', definition: novel }]);
    expect(built.added).toBe(1);

    let after = ask(novel);
    for (let k = 0; k < 4; k++) after = ask(novel);
    // The same input, through the same mesh, no longer missing anything.
    expect(after.needed).toBe(false);
    expect(after.bestResponse).toBeGreaterThan(before.bestResponse);
  });
});
