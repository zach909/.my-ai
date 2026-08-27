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
