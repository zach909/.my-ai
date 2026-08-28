/**
 * The hyperdimensional engine's per-tick behaviour.
 *
 * process() runs on every generate() call and on every BIT through the Zip
 * Loop, so what a single tick does -- and what it costs -- matters more here
 * than anywhere else in the system. These tests pin the two things that were
 * wrong: a tick recorded state nobody read, and a tick spent reading rewrote
 * the network it was reading.
 */

import { describe, it, expect } from 'vitest';
import { HyperDimensionalEngine, ZipLoopInterface } from '../../models && skills/core/onebrain.js';

const smallEngine = () => new HyperDimensionalEngine({ neuronCount: 24, dimensions: 12 });
const idleFor = (dims: number) => new Array(dims).fill(0);

describe('reading is not learning', () => {
  it('leaves every connection untouched on a read-only tick', () => {
    const engine = smallEngine();
    const before = engine.captureNetworkState();
    for (let i = 0; i < 25; i++) {
      engine.process(idleFor(12), undefined, new Set(), undefined, { learn: false });
    }
    const after = engine.captureNetworkState();
    expect(after.connDiag).toBe(before.connDiag);
    expect(after.connShift).toBe(before.connShift);
  });

  it('still changes the network on a tick that is meant to learn', () => {
    // The other half of the claim: if learning were quietly off everywhere,
    // the test above would pass and the engine would never learn anything.
    const engine = smallEngine();
    const before = engine.captureNetworkState();
    engine.process(new Array(12).fill(0.5));
    expect(engine.captureNetworkState().connDiag).not.toBe(before.connDiag);
  });

  it('still moves the neurons on a read-only tick', () => {
    // Not learning is not the same as not thinking. The mesh has to keep
    // evolving under its own recurrent dynamics while it is being read --
    // that evolution is what produces the next bit.
    const engine = smallEngine();
    engine.process(new Array(12).fill(0.8));
    const before = engine.captureNetworkState().states;
    engine.process(idleFor(12), undefined, new Set(), undefined, { learn: false });
    expect(engine.captureNetworkState().states).not.toBe(before);
  });

  it('reading a byte out of the Zip Loop does not rewire the mesh', () => {
    // The case that made this matter: 50 idle read ticks moved 98% of all
    // connections, so pulling an answer out of the network changed the network
    // it came from, and reading the same thing twice gave two different
    // networks.
    const engine = smallEngine();
    const zip = new ZipLoopInterface(engine, { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 });
    const before = engine.captureNetworkState();
    for (let i = 0; i < 4; i++) zip.nextOutputByte();
    expect(engine.captureNetworkState().connDiag).toBe(before.connDiag);
  });

  it('sending a byte IN still teaches it something', () => {
    // Input arriving is exactly when Hebbian learning belongs. Turning it off
    // on the way in would make the Zip Loop a doorway into a network that
    // never learns anything through it.
    const engine = smallEngine();
    const zip = new ZipLoopInterface(engine, { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 });
    const before = engine.captureNetworkState();
    zip.sendBytes(new Uint8Array([0b10110011]));
    expect(engine.captureNetworkState().connDiag).not.toBe(before.connDiag);
  });
});

describe('what a tick keeps', () => {
  it('keeps each neuron at most one transition, not a history of them', () => {
    const engine = smallEngine();
    for (let i = 0; i < 200; i++) engine.process(new Array(12).fill(0).map(() => Math.random() * 2 - 1));
    for (const neuron of engine.getNeuronStates()) {
      expect(neuron.lastTransition === null || typeof neuron.lastTransition.timestamp === 'number').toBe(true);
    }
  });

  it('chains a transition from exactly where the neuron previously was', () => {
    // The one field the old 100-deep ring existed to serve.
    const engine = new HyperDimensionalEngine({ neuronCount: 12, dimensions: 8, energyThreshold: 0.001 });
    engine.process(new Array(8).fill(0.9));
    const before = new Map(
      engine.getNeuronStates()
        .filter(n => n.lastTransition)
        .map(n => [n.id, Float32Array.from(n.lastTransition!.toState)]),
    );
    expect(before.size).toBeGreaterThan(0);

    engine.process(new Array(8).fill(0.4));
    let chained = 0;
    for (const neuron of engine.getNeuronStates()) {
      const previousTo = before.get(neuron.id);
      if (!previousTo || !neuron.lastTransition) continue;
      const from = neuron.lastTransition.fromState;
      if (from.length === previousTo.length && from.every((v, i) => v === previousTo[i])) chained++;
    }
    expect(chained).toBeGreaterThan(0);
  });

  it('reports a transition count without handing back the transitions', () => {
    const engine = smallEngine();
    const out = engine.process(new Array(12).fill(0.7));
    expect(typeof out.transitionCount).toBe('number');
    expect(out.transitionCount).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Hyperdimensional thinking: every other neuron is part of every connection.
 *
 * A connection's own result -- its weight, and its own bias -- is multiplied by
 * what the whole network is doing, and then the whole network is added again
 * through a second variable. Each neuron carries both variables itself, so the
 * same connection with the same weight and the same input lands differently
 * depending on what everything else is up to.
 *
 * The tests isolate each half by removing every other route between neurons,
 * which is the only way to show the term is doing the work rather than the
 * ordinary all-to-all connections it sits on top of.
 */
describe('every neuron in every connection', () => {
  const decode = (b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  };
  const encode = (f: Float32Array) =>
    Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');

  /** One settle iteration, so a per-iteration term is observed rather than its washed-out fixed point. */
  const base = { neuronCount: 12, dimensions: 4, propagationSteps: 1 };
  const driven = new Set([0]);
  const input = new Array(4).fill(0.3);

  /** How far apart two networks' states are, ignoring the neuron that was nudged. */
  const spread = (a: Float32Array, b: Float32Array, skip: number) => {
    let max = 0;
    for (let i = 0; i < a.length; i++) {
      if (i === skip) continue;
      max = Math.max(max, Math.abs(a[i] - b[i]));
    }
    return max;
  };

  const nudge = (engine: HyperDimensionalEngine, index: number) => {
    const snapshot = engine.captureNetworkState();
    const states = Float32Array.from(decode(snapshot.states));
    states[index] += 0.9;
    engine.restoreNetworkState({ ...snapshot, states: encode(states) });
  };

  it('leaves the arithmetic exactly as it was when the term is off', () => {
    // Gain 1 and offset 0 are exact in IEEE754, so "off" has to mean the old
    // expression rather than something indistinguishably close to it.
    const seed = new HyperDimensionalEngine(base).captureNetworkState();
    const plain = new HyperDimensionalEngine(base);
    const explicit = new HyperDimensionalEngine({ ...base, hyperGain: 0, hyperAdd: 0 });
    expect(plain.restoreNetworkState(seed)).toBe(true);
    expect(explicit.restoreNetworkState(seed)).toBe(true);

    plain.process(input, undefined, driven, undefined, { learn: false });
    explicit.process(input, undefined, driven, undefined, { learn: false });
    expect(explicit.captureNetworkState().states).toBe(plain.captureNetworkState().states);
  });

  it('lets a distant neuron reach another through the added term alone', () => {
    // Every connection weight zeroed: the ONLY remaining route from one neuron
    // to another is the network term itself.
    const zeroWeights = (engine: HyperDimensionalEngine) => {
      const snapshot = engine.captureNetworkState();
      engine.restoreNetworkState({
        ...snapshot,
        connDiag: encode(new Float32Array(decode(snapshot.connDiag).length)),
        connShift: encode(new Float32Array(decode(snapshot.connShift).length)),
      });
    };

    // One seed shared across every configuration, so the comparison is of the
    // term and not of two different random networks. The per-neuron variables
    // travel in the snapshot, which is what makes that possible.
    const seed = new HyperDimensionalEngine(base).captureNetworkState();

    const measure = (config: Record<string, number>) => {
      const quiet = new HyperDimensionalEngine({ ...base, ...config });
      const nudged = new HyperDimensionalEngine({ ...base, ...config });
      quiet.restoreNetworkState(seed);
      nudged.restoreNetworkState(seed);
      zeroWeights(quiet);
      zeroWeights(nudged);
      nudge(nudged, 2 * base.neuronCount + 9);

      quiet.process(input, undefined, driven, undefined, { learn: false });
      nudged.process(input, undefined, driven, undefined, { learn: false });
      return spread(
        decode(quiet.captureNetworkState().states),
        decode(nudged.captureNetworkState().states),
        2 * base.neuronCount + 9,
      );
    };

    expect(measure({})).toBe(0);
    const once = measure({ hyperAdd: 1 });
    const thrice = measure({ hyperAdd: 3 });
    expect(once).toBeGreaterThan(0);
    // Three times the variable, appreciably more effect -- the term scales
    // with what it is set to rather than being a fixed nudge. Same seed on
    // both sides, so this compares the setting and nothing else.
    expect(thrice).toBeGreaterThan(once);
  });

  it('lets a distant neuron change what a connection contributes, through the gain', () => {
    // Weights zeroed and every connection bias set to the same constant: the
    // connection's own result is now a fixed number that no neuron's state can
    // touch. Anything a distant neuron does must therefore have arrived
    // through the gain that multiplies it.
    const withBias = { ...base, connectionBias: true };
    const rig = (engine: HyperDimensionalEngine) => {
      const snapshot = engine.captureNetworkState();
      engine.restoreNetworkState({
        ...snapshot,
        connDiag: encode(new Float32Array(decode(snapshot.connDiag).length)),
        connShift: encode(new Float32Array(decode(snapshot.connShift).length)),
        connBias: encode(new Float32Array(decode(snapshot.connBias).length).fill(0.05)),
      });
    };

    const seed = new HyperDimensionalEngine(withBias).captureNetworkState();

    const measure = (config: Record<string, number>) => {
      const quiet = new HyperDimensionalEngine({ ...withBias, ...config });
      const nudged = new HyperDimensionalEngine({ ...withBias, ...config });
      quiet.restoreNetworkState(seed);
      nudged.restoreNetworkState(seed);
      rig(quiet);
      rig(nudged);
      nudge(nudged, 2 * base.neuronCount + 9);

      quiet.process(input, undefined, driven, undefined, { learn: false });
      nudged.process(input, undefined, driven, undefined, { learn: false });
      return spread(
        decode(quiet.captureNetworkState().states),
        decode(nudged.captureNetworkState().states),
        2 * base.neuronCount + 9,
      );
    };

    expect(measure({})).toBe(0);
    expect(measure({ hyperGain: 1 })).toBeGreaterThan(0);
    expect(measure({ hyperGain: 3 })).toBeGreaterThan(measure({ hyperGain: 1 }));
  });

  it('gives every connection its own bias, and moves it', () => {
    // The per-neuron weight-and-bias architecture asks for c = x*w + b per
    // CONNECTION. Only the weight existed; the bias lived on the receiving
    // neuron and was shared across every connection into it.
    const engine = new HyperDimensionalEngine({ ...base, connectionBias: true });
    const before = engine.captureNetworkState().connBias;
    expect(decode(before).length).toBe(12 * 5 * 12);
    expect(decode(before).every(v => v === 0)).toBe(true);

    engine.process(input);
    expect(engine.captureNetworkState().connBias).not.toBe(before);
  });

  it('carries each neuron\'s own network variables in the snapshot', () => {
    // They are part of the network. Restore the connections without them and
    // every connection is scaled and offset by a different network than the
    // one that stopped.
    const engine = new HyperDimensionalEngine({ ...base, hyperGain: 1, hyperAdd: 1 });
    const saved = engine.captureNetworkState();
    expect(decode(saved.modWeight).length).toBe(base.neuronCount);
    expect(decode(saved.addWeight).length).toBe(base.neuronCount);

    for (let i = 0; i < 5; i++) engine.process(input);
    expect(engine.captureNetworkState().modWeight).not.toBe(saved.modWeight);
    expect(engine.restoreNetworkState(saved)).toBe(true);
    expect(engine.captureNetworkState().modWeight).toBe(saved.modWeight);
  });

  it('refuses a snapshot from a network built with different parts', () => {
    // Same neuron count, genuinely different network: one has a bias on every
    // connection and the other does not.
    const withBias = new HyperDimensionalEngine({ ...base, connectionBias: true });
    const without = new HyperDimensionalEngine(base);
    expect(without.restoreNetworkState(withBias.captureNetworkState())).toBe(false);
    expect(withBias.restoreNetworkState(without.captureNetworkState())).toBe(false);
  });

  it('stays finite and unsaturated with the whole thing turned on', () => {
    // A global gain on every connection in a recurrent all-to-all network is
    // exactly the shape that runs away. The mean-not-sum form is what keeps it
    // from doing so at any neuron count.
    const engine = new HyperDimensionalEngine({
      neuronCount: 24,
      dimensions: 8,
      hyperGain: 3,
      hyperAdd: 3,
      connectionBias: true,
    });
    let out;
    for (let i = 0; i < 60; i++) {
      out = engine.process(new Array(8).fill(0.4), undefined, driven, undefined, { learn: false });
    }
    expect(out!.outputVector.every(Number.isFinite)).toBe(true);
    const states = decode(engine.captureNetworkState().states);
    const saturated = Array.from(states).filter(v => Math.abs(v) > 0.999).length;
    expect(saturated / states.length).toBeLessThan(0.5);
  }, 20_000);
});

/**
 * The wave pool, both ways.
 *
 * A neuron's input makes a ripple in a shared pool at that neuron's own
 * frequency and phase, with a height set by how much input it got. And the
 * pool drives neurons back: a wave formed at a neuron's frequency gives that
 * neuron an input it was never handed directly.
 *
 * The second direction is what was missing. Every neuron read the same single
 * number out of the pool, so the pool could only ever push the whole network
 * the same way at once -- which is not a pool, it is a global bias term.
 *
 * And it does not have to be the exact wave: the read-back is a correlation,
 * so a wave that partly matches drives partly, and one at the same frequency
 * but opposite phase subtracts instead of adding.
 */
describe('the wave pool', () => {
  const decode = (b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  };
  const encode = (f: Float32Array) =>
    Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');

  const N = 6;
  const D = 3;
  /** Neuron 1 and 2 share a wave exactly. 3 is far off. 4 matches in frequency but is half a cycle out. */
  const config = {
    neuronCount: N,
    dimensions: D,
    propagationSteps: 1,
    waveGain: 1,
    waveFrequencies: [0.11, 0.30, 0.30, 0.05, 0.30, 0.19],
    wavePhases: [0, 0, 0, 0, Math.PI, 0],
  };
  const driven = new Set([0]);

  /** Every connection weight zeroed, so the pool is the only route between neurons. */
  const zeroWeights = (engine: HyperDimensionalEngine) => {
    const snapshot = engine.captureNetworkState();
    engine.restoreNetworkState({
      ...snapshot,
      connDiag: encode(new Float32Array(decode(snapshot.connDiag).length)),
      connShift: encode(new Float32Array(decode(snapshot.connShift).length)),
    });
  };

  /** How far each neuron moved when neuron 1 was given a ripple and nothing else changed. */
  const movementFromRipple = (overrides: Record<string, unknown> = {}) => {
    const settings = { ...config, ...overrides };
    const seed = new HyperDimensionalEngine(settings).captureNetworkState();
    const quiet = new HyperDimensionalEngine(settings);
    const loud = new HyperDimensionalEngine(settings);
    quiet.restoreNetworkState(seed);
    loud.restoreNetworkState(seed);
    zeroWeights(quiet);
    zeroWeights(loud);

    const snapshot = loud.captureNetworkState();
    const states = Float32Array.from(decode(snapshot.states));
    for (let d = 1; d <= D; d++) states[d * N + 1] = 0.9;
    loud.restoreNetworkState({ ...snapshot, states: encode(states) });

    const input = new Array(D).fill(0.2);
    quiet.process(input, undefined, driven, undefined, { learn: false });
    loud.process(input, undefined, driven, undefined, { learn: false });

    const before = decode(quiet.captureNetworkState().states);
    const after = decode(loud.captureNetworkState().states);
    return (neuron: number) => {
      let most = 0;
      for (let d = 1; d <= D; d++) most = Math.max(most, Math.abs(before[d * N + neuron] - after[d * N + neuron]));
      return most;
    };
  };

  it('gives a neuron an input it was never handed, through a matching wave', () => {
    const moved = movementFromRipple();
    // Neuron 2 shares neuron 1's frequency and phase exactly and has no
    // connection to it at all, so everything it felt arrived through the pool.
    expect(moved(2)).toBeGreaterThan(0.1);
  });

  it('drives a partly-matching wave partly, not all or nothing', () => {
    const moved = movementFromRipple();
    // It does not have to be the exact wave. A different frequency still
    // correlates somewhat -- less than an exact match, more than nothing.
    expect(moved(5)).toBeGreaterThan(0);
    expect(moved(5)).toBeLessThan(moved(2));
    expect(moved(3)).toBeLessThan(moved(2));
  });

  it('subtracts when a wave arrives at the same frequency but opposite phase', () => {
    const moved = movementFromRipple();
    // Neuron 4 matches in frequency and is half a cycle out, so the ripple
    // cancels against its own wave rather than magnifying it.
    expect(moved(4)).toBeLessThan(moved(2));
  });

  it('does nothing at all when the pool is off', () => {
    const moved = movementFromRipple({ waveGain: 0 });
    // With no connections and no pool there is no route between neurons, and
    // "no route" has to mean exactly zero rather than nearly zero.
    for (let neuron = 1; neuron < N; neuron++) expect(moved(neuron)).toBe(0);
  });

  it('lets each neuron read something different out of the same pool', () => {
    // The failure this replaced: one scalar, read identically by everyone.
    const moved = movementFromRipple();
    const readings = [2, 3, 4, 5].map(moved);
    expect(new Set(readings.map(v => v.toFixed(6))).size).toBeGreaterThan(1);
  });
});

describe('the wave is learned, continuously', () => {
  const decode = (b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  };
  const encode = (f: Float32Array) =>
    Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');

  const config = { neuronCount: 8, dimensions: 4, waveGain: 1 };
  const driven = new Set([0]);

  it('moves a neuron\'s frequency and phase as it runs', () => {
    // Not a label stamped on at construction. With frequencies fixed forever,
    // which pair of neurons can hear each other is decided before the network
    // has learned anything.
    const engine = new HyperDimensionalEngine(config);
    const before = engine.captureNetworkState();
    for (let i = 0; i < 30; i++) engine.process(new Array(4).fill(0.5), undefined, driven);
    const after = engine.captureNetworkState();
    expect(after.waveFreq).not.toBe(before.waveFreq);
    expect(after.wavePhase).not.toBe(before.wavePhase);
  });

  it('learns on every tick rather than in a separate phase', () => {
    // Continuous learning: there is no train-then-run split, so ten ordinary
    // ticks have to have moved it ten times.
    const engine = new HyperDimensionalEngine(config);
    let previous = engine.captureNetworkState().waveFreq;
    let changes = 0;
    for (let i = 0; i < 10; i++) {
      engine.process(new Array(4).fill(0.5), undefined, driven);
      const now = engine.captureNetworkState().waveFreq;
      if (now !== previous) changes++;
      previous = now;
    }
    expect(changes).toBe(10);
  });

  it('does not LEARN the wave on a tick that is only reading', () => {
    // Same rule as the connections: reading an answer out of the network must
    // not change the network it came from. The frequency is learned, so it
    // must not move.
    //
    // The phase is a different thing and does move: it is where the
    // oscillator currently is, and an oscillator that froze while you looked
    // at it would not be one. So this pins the distinction rather than
    // pretending nothing happens.
    const seed = new HyperDimensionalEngine(config).captureNetworkState();
    const engine = new HyperDimensionalEngine(config);
    engine.restoreNetworkState(seed);
    for (let i = 0; i < 10; i++) {
      engine.process(new Array(4).fill(0.5), undefined, driven, undefined, { learn: false });
    }
    const after = engine.captureNetworkState();
    expect(after.waveFreq).toBe(seed.waveFreq);
    expect(after.wavePhase).not.toBe(seed.wavePhase);
  });

  it('carries the learned wave in the snapshot', () => {
    const engine = new HyperDimensionalEngine(config);
    for (let i = 0; i < 20; i++) engine.process(new Array(4).fill(0.5), undefined, driven);
    const learned = engine.captureNetworkState();

    const fresh = new HyperDimensionalEngine(config);
    expect(fresh.captureNetworkState().waveFreq).not.toBe(learned.waveFreq);
    expect(fresh.restoreNetworkState(learned)).toBe(true);
    expect(fresh.captureNetworkState().waveFreq).toBe(learned.waveFreq);
  });

  it('cancels contradicting waves and magnifies agreeing ones', () => {
    // The point of doing any of this with waves. Neurons that agree add up in
    // the pool; neurons that contradict each other cancel before anyone reads.
    const N = 9;
    const D = 3;
    const listener = 0;
    const shared = 0.3;

    /** Everyone except the listener carries the same frequency; `opposed` of them are half a cycle out. */
    const build = (opposed: number) => {
      const waveFrequencies = new Array(N).fill(shared);
      const wavePhases = new Array(N).fill(0);
      for (let i = N - opposed; i < N; i++) wavePhases[i] = Math.PI;
      // A small gain on purpose. At waveGain 1 eight neurons shouting in
      // unison drive the listener straight into tanh's flat region, where it
      // reads +/-1 whatever they said -- and the measured difference collapses
      // to zero, making perfect agreement look like perfect silence. The
      // effect is real; saturation just hides it.
      const settings = { neuronCount: N, dimensions: D, propagationSteps: 1, waveGain: 0.02, waveFrequencies, wavePhases };

      const seed = new HyperDimensionalEngine(settings).captureNetworkState();
      const quiet = new HyperDimensionalEngine(settings);
      const loud = new HyperDimensionalEngine(settings);
      quiet.restoreNetworkState(seed);
      loud.restoreNetworkState(seed);

      // No connections at all: the pool is the only way anything reaches the listener.
      for (const engine of [quiet, loud]) {
        const snapshot = engine.captureNetworkState();
        engine.restoreNetworkState({
          ...snapshot,
          connDiag: encode(new Float32Array(decode(snapshot.connDiag).length)),
          connShift: encode(new Float32Array(decode(snapshot.connShift).length)),
        });
      }

      // Every neuron but the listener speaks up, in `loud` only.
      const snapshot = loud.captureNetworkState();
      const states = Float32Array.from(decode(snapshot.states));
      for (let i = 1; i < N; i++) for (let d = 1; d <= D; d++) states[d * N + i] = 0.9;
      loud.restoreNetworkState({ ...snapshot, states: encode(states) });

      const input = new Array(D).fill(0.2);
      quiet.process(input, undefined, new Set([]), undefined, { learn: false });
      loud.process(input, undefined, new Set([]), undefined, { learn: false });

      const before = decode(quiet.captureNetworkState().states);
      const after = decode(loud.captureNetworkState().states);
      let most = 0;
      for (let d = 1; d <= D; d++) most = Math.max(most, Math.abs(before[d * N + listener] - after[d * N + listener]));
      return most;
    };

    const allAgree = build(0);
    const halfContradict = build(4);
    expect(allAgree).toBeGreaterThan(0);
    // Eight neurons agreeing reach the listener; four against four erase each
    // other on the way. Measured at roughly 27 times less.
    expect(halfContradict).toBeLessThan(allAgree / 5);
  });
});
