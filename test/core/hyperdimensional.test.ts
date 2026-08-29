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

  it('lets a distant neuron change what a connection contributes, through the network weight', () => {
    // Weights zeroed and every connection bias set to the same constant: the
    // connection's own result is now a fixed number that no neuron's state can
    // touch. Anything a distant neuron does must therefore have arrived
    // through the network's weight, which is added to every connection's own.
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

  it('still moves a neuron whose every incoming weight is zero', () => {
    // The difference between adding the network's weight and multiplying by
    // it, made decisive. With every connection weight at zero and no
    // connection bias, a multiplying network term has nothing to act on --
    // zero times whatever the network says is zero, and the neuron cannot
    // move. Added, the network's weight is a weight of its own, and it does.
    const silence = (engine: HyperDimensionalEngine) => {
      const snapshot = engine.captureNetworkState();
      engine.restoreNetworkState({
        ...snapshot,
        connDiag: encode(new Float32Array(decode(snapshot.connDiag).length)),
        connShift: encode(new Float32Array(decode(snapshot.connShift).length)),
        bias: encode(new Float32Array(decode(snapshot.bias).length)),
      });
    };

    const measure = (config: Record<string, number>) => {
      const engine = new HyperDimensionalEngine({ ...base, ...config });
      silence(engine);
      engine.process(input, undefined, driven, undefined, { learn: false });
      const states = decode(engine.captureNetworkState().states);
      // The undriven half: whatever moved here came from the network term.
      let moved = 0;
      for (let i = base.neuronCount / 2; i < base.neuronCount; i++) {
        for (let d = 1; d <= base.dimensions; d++) moved += Math.abs(states[d * base.neuronCount + i]);
      }
      return moved;
    };

    expect(measure({})).toBeCloseTo(0, 6);
    expect(measure({ hyperGain: 1 })).toBeGreaterThan(1e-6);
    expect(measure({ hyperAdd: 1 })).toBeGreaterThan(1e-6);
  });

  it('lets the whole network scale every connection as well as add to it', () => {
    // The two ways the network's say can combine with a connection's own
    // weight, and both are in the spec: multiply what the connection produced,
    // and add to the weight that produced it. They fail differently, which is
    // the reason for having both -- a scale near zero can hold the entire mesh
    // still, an added weight never can.
    const seed = new HyperDimensionalEngine(base).captureNetworkState();
    const measure = (config: Record<string, number>) => {
      const engine = new HyperDimensionalEngine({ ...base, ...config });
      engine.restoreNetworkState(seed);
      engine.process(input, undefined, driven, undefined, { learn: false });
      return decode(engine.captureNetworkState().states);
    };

    const off = measure({});
    const scaled = measure({ hyperScale: 1 });
    const added = measure({ hyperGain: 1 });
    const both = measure({ hyperScale: 1, hyperGain: 1 });

    // Each does something...
    expect(spread(scaled, off, -1)).toBeGreaterThan(1e-6);
    expect(spread(added, off, -1)).toBeGreaterThan(1e-6);
    // ...and they are not each other.
    expect(spread(scaled, added, -1)).toBeGreaterThan(1e-6);
    expect(spread(both, scaled, -1)).toBeGreaterThan(1e-6);
    expect(spread(both, added, -1)).toBeGreaterThan(1e-6);
  });

  it('leaves every connection exactly as it was when the scale is off', () => {
    // Off has to be a scale of exactly 1. Anything merely close to 1 makes
    // "the feature is off" and "the feature is on and nearly neutral"
    // indistinguishable, which is how a default quietly becomes a behaviour.
    const seed = new HyperDimensionalEngine(base).captureNetworkState();
    const run = (config: Record<string, number>) => {
      const engine = new HyperDimensionalEngine({ ...base, ...config });
      engine.restoreNetworkState(seed);
      engine.process(input, undefined, driven, undefined, { learn: false });
      return engine.captureNetworkState().states;
    };
    expect(run({ hyperScale: 0 })).toBe(run({}));
  });

  it('lets the network hold the whole mesh still, which an added weight cannot', () => {
    // What the scale can do and the added weight cannot: with every neuron's
    // say cancelling to nothing, every connection in the network contributes
    // nothing at once. That is the mechanism, not a bug in it.
    const engine = new HyperDimensionalEngine({ ...base, hyperScale: 1 });
    const snapshot = engine.captureNetworkState();
    // Every neuron's variable zero: the network's say is exactly zero however
    // loud the states are.
    engine.restoreNetworkState({
      ...snapshot,
      // Every window blank: every connection's reading of the network is
      // exactly zero however loud the states are.
      modWeight: encode(new Float32Array(base.neuronCount * base.neuronCount)),
      bias: encode(new Float32Array(decode(snapshot.bias).length)),
    });
    engine.process(input, undefined, driven, undefined, { learn: false });
    const states = decode(engine.captureNetworkState().states);
    for (let i = 0; i < base.neuronCount; i++) {
      if (driven.has(i)) continue;
      for (let d = 1; d <= base.dimensions; d++) {
        expect(Math.abs(states[d * base.neuronCount + i])).toBeLessThan(1e-6);
      }
    }
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

  it('carries every connection\'s own window into the network in the snapshot', () => {
    // They are part of the network. Restore the connections without them and
    // every connection is scaled and offset by a different network than the
    // one that stopped.
    //
    // A ROW per receiving neuron, not one variable per neuron: modWeight[i][k]
    // is how neuron i's window weighs neuron k, so two connections read the
    // same network state differently. Plus one gain per sender, which is what
    // makes it per CONNECTION rather than per receiver.
    const engine = new HyperDimensionalEngine({ ...base, hyperGain: 1, hyperAdd: 1 });
    const saved = engine.captureNetworkState();
    expect(decode(saved.modWeight).length).toBe(base.neuronCount * base.neuronCount);
    expect(decode(saved.addWeight).length).toBe(base.neuronCount * base.neuronCount);
    expect(decode(saved.senderGain as string).length).toBe(base.neuronCount);

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
 * The wave pool.
 *
 * Every neuron owns a wave. Its input sets that wave's height, the wave goes
 * into a shared pool, and what a neuron RECEIVES is what the pool is doing at
 * its own wave -- so a wave formed by others gives a neuron an input nobody
 * handed it. Waves that agree add up; waves that contradict each other cancel.
 *
 * These test the pool directly rather than through a neuron's final state.
 * Everything downstream of the pool -- tanh saturation, the energy-based
 * damping, the connection maths -- also moves when you poke a neuron, so
 * measuring "did those two waves cancel" through a settled state means
 * measuring three other mechanisms at the same time. Twice while writing this
 * the answer came back as a confident zero that turned out to be saturation.
 */
describe('the wave pool', () => {
  const decode = (b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  };
  const encode = (f: Float32Array) =>
    Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');

  const N = 4;
  const D = 2;
  /** Neurons 0, 1 and 2 share a wave; 2 is half a cycle out. 3 is elsewhere. */
  const config = {
    neuronCount: N,
    dimensions: D,
    propagationSteps: 1,
    waveGain: 1,
    // Signatures only, no echo: a neuron passing a wave ALONG is loud whatever
    // its own phase, so echo would add where signatures cancel. Both are real;
    // this isolates the one being measured.
    waveFeedback: 0,
    waveFrequencies: [0.3, 0.3, 0.3, 0.1],
    wavePhases: [0, 0, Math.PI, 0],
  };

  /**
   * Only these neurons carry anything, and they are DRIVEN.
   *
   * A neuron's wave is whatever formed inside it out of what flowed in, so a
   * neuron with nothing flowing in has no wave to contribute. Sources are the
   * exception and the origin: driven from outside, they emit their own
   * signature, and everything else in the pool descends from them.
   */
  const poolAfter = (speakers: number[]) => {
    const engine = new HyperDimensionalEngine(config);
    const snapshot = engine.captureNetworkState();
    const states = new Float32Array(decode(snapshot.states).length);
    for (const speaker of speakers) for (let d = 1; d <= D; d++) states[d * N + speaker] = 0.5;
    engine.restoreNetworkState({ ...snapshot, states: encode(states) });
    engine.process(new Array(D).fill(0.5), undefined, new Set(speakers), undefined, { learn: false });
    return engine.poolContent();
  };

  it('puts a neuron\'s ripple into the pool at its own frequency', () => {
    const pool = poolAfter([0]);
    expect(pool).toHaveLength(1);
    expect(pool[0].frequency).toBeCloseTo(0.3, 1);
    expect(pool[0].magnitude).toBeGreaterThan(0);
  });

  it('magnifies agreement: two neurons on the same wave add up', () => {
    const alone = poolAfter([0])[0].magnitude;
    const together = poolAfter([0, 1])[0].magnitude;
    expect(together).toBeCloseTo(alone * 2, 5);
  });

  it('cancels contradiction: equal and opposite annihilate exactly', () => {
    // Perfect enemies. Not "small" -- zero.
    const pool = poolAfter([0, 2]);
    const shared = pool.find(entry => Math.abs(entry.frequency - 0.3) < 0.02);
    expect(shared).toBeUndefined();
  });

  it('keeps different frequencies apart rather than mixing them', () => {
    const pool = poolAfter([0, 3]);
    expect(pool).toHaveLength(2);
    const frequencies = pool.map(entry => entry.frequency).sort((a, b) => a - b);
    expect(frequencies[0]).toBeCloseTo(0.1, 1);
    expect(frequencies[1]).toBeCloseTo(0.3, 1);
  });

  it('gives a neuron with nothing flowing into it no wave to contribute', () => {
    // Its wave is whatever formed inside it, so with an empty pool and no
    // source driving it there is nothing to be made of. This caught a real
    // one: with the self-removal left unguarded, an undriven network with an
    // empty pool reported waves in it, conjured out of the subtraction alone.
    const engine = new HyperDimensionalEngine(config);
    const snapshot = engine.captureNetworkState();
    const states = new Float32Array(decode(snapshot.states).length);
    for (let d = 1; d <= D; d++) states[d * N + 1] = 0.5;
    engine.restoreNetworkState({ ...snapshot, states: encode(states) });
    engine.process(new Array(D).fill(0.5), undefined, new Set([]), undefined, { learn: false });
    expect(engine.poolContent()).toEqual([]);
  });

  it('carries a source\'s wave onward through the neurons that heard it', () => {
    // How a wave gets past the neurons that can hear its source directly:
    // each one passes on what formed inside it, edited by the connection it
    // arrived through.
    const engine = new HyperDimensionalEngine({ ...config, waveFeedback: 0.5 });
    const snapshot = engine.captureNetworkState();
    const states = new Float32Array(decode(snapshot.states).length);
    for (let d = 1; d <= D; d++) states[d * N + 0] = 0.5;
    engine.restoreNetworkState({ ...snapshot, states: encode(states) });

    // The source's own frequency, followed by name rather than by position --
    // and named by what the pool reports rather than by the configured 0.3,
    // since poolContent() gives the frequency of the BIN, which is the
    // configured value rounded to the nearest bin centre.
    //
    // Position stops working the moment the wave reaches a frequency below the
    // source's, which is exactly what travelling looks like: "the first bin"
    // silently becomes a different bin.
    let sourceFrequency = 0;
    const at = (f: number) => engine.poolContent().find(b => b.frequency === f)?.magnitude ?? 0;
    const elsewhere = (f: number) => engine.poolContent().filter(b => b.frequency !== f).length;

    const magnitudes: number[] = [];
    const spread: number[] = [];
    for (let t = 0; t < 3; t++) {
      engine.process(new Array(D).fill(0.5), undefined, new Set([0]), undefined, { learn: false });
      if (t === 0) {
        // Only the source has emitted yet, so the loudest bin is its own.
        sourceFrequency = engine.poolContent().reduce(
          (loudest, bin) => (bin.magnitude > loudest.magnitude ? bin : loudest),
        ).frequency;
      }
      magnitudes.push(at(sourceFrequency));
      spread.push(elsewhere(sourceFrequency));
    }
    // It reaches a frequency the source does not occupy: a neuron that heard
    // it is passing on what formed inside it, at its own pitch.
    expect(spread[2]).toBeGreaterThan(0);
    // And at the source's own frequency it grows -- the neuron that shares
    // that wave is adding to it -- without running away.
    expect(magnitudes[2]).toBeGreaterThan(magnitudes[0]);
    expect(magnitudes[2]).toBeLessThan(magnitudes[0] * 4);
  });

  it('carries the giving neuron\'s own wave, not everyone\'s at that pitch', () => {
    // "You run the wave with the wave of the neuron that is giving a wave."
    //
    // A connection used to multiply the shared POOL's content at the giving
    // neuron's frequency. Two neurons on the same frequency were therefore
    // indistinguishable to everything downstream: silence one of them and the
    // other's wave arrived in its place, because what the connection read was
    // the bin, not the neuron.
    //
    // Three neurons share 0.3 here, so the bin is shared and the neurons are
    // not. Drive two of them and the receiver hears two different waves; drive
    // one and it hears one. If the connection read the bin, the totals would
    // match whenever the bin's content matched.
    const settings = { ...config, waveFeedback: 0.5, propagationSteps: 1 };
    const seed = new HyperDimensionalEngine(settings).captureNetworkState();

    const heardBy3 = (speakers: number[]) => {
      const engine = new HyperDimensionalEngine(settings);
      engine.restoreNetworkState(seed);
      const snapshot = engine.captureNetworkState();
      const states = Float32Array.from(decode(snapshot.states));
      for (const speaker of speakers) {
        for (let d = 1; d <= D; d++) states[d * N + speaker] = 0.5;
      }
      engine.restoreNetworkState({ ...snapshot, states: encode(states) });
      for (let t = 0; t < 2; t++) {
        engine.process(new Array(D).fill(0.5), undefined, new Set(speakers), undefined, { learn: false });
      }
      const after = decode(engine.captureNetworkState().states);
      // Neuron 3 is on its own frequency and is nobody's source here.
      return after[1 * N + 3];
    };

    // Neurons 0 and 2 are both on 0.3, half a cycle apart (see config's
    // wavePhases), so as SIGNATURES in one bin they largely cancel. As two
    // separate waves along two separate connections they do not.
    const fromOne = heardBy3([0]);
    const fromBoth = heardBy3([0, 2]);
    expect(Math.abs(fromBoth - fromOne)).toBeGreaterThan(1e-6);
  });

  it('starts again with the wave each neuron was carrying', () => {
    // "When it stops it saves the input of each neuron... then it'll start at
    // the same place." A neuron's wave is part of what it was holding, so a
    // restore that dropped it would bring the network back with its numbers
    // intact and every neuron silent.
    const engine = new HyperDimensionalEngine({ ...config, waveFeedback: 0.5 });
    const snapshot = engine.captureNetworkState();
    const states = Float32Array.from(decode(snapshot.states));
    for (let d = 1; d <= D; d++) states[d * N + 0] = 0.5;
    engine.restoreNetworkState({ ...snapshot, states: encode(states) });
    for (let t = 0; t < 3; t++) {
      engine.process(new Array(D).fill(0.5), undefined, new Set([0]), undefined, { learn: false });
    }

    const stopped = engine.captureNetworkState();
    expect(typeof stopped.neuronWaveRe).toBe('string');
    expect(decode(stopped.neuronWaveRe as string)).toHaveLength(N);
    // Something was actually being carried, or this proves nothing.
    expect(decode(stopped.neuronWaveRe as string).some(v => v !== 0)).toBe(true);

    // Brought back and carried on: the same next tick, not a network that
    // has to build its waves again from nothing.
    const resumed = new HyperDimensionalEngine({ ...config, waveFeedback: 0.5 });
    expect(resumed.restoreNetworkState(stopped)).toBe(true);
    resumed.process(new Array(D).fill(0.5), undefined, new Set([0]), undefined, { learn: false });
    engine.process(new Array(D).fill(0.5), undefined, new Set([0]), undefined, { learn: false });
    expect(resumed.captureNetworkState().states).toBe(engine.captureNetworkState().states);

    // And a snapshot from before neurons had a wave still loads, as silence.
    const older = { ...stopped };
    delete (older as Record<string, unknown>).neuronWaveRe;
    delete (older as Record<string, unknown>).neuronWaveIm;
    delete (older as Record<string, unknown>).wavePoolRe;
    delete (older as Record<string, unknown>).wavePoolIm;
    const revived = new HyperDimensionalEngine({ ...config, waveFeedback: 0.5 });
    expect(revived.restoreNetworkState(older)).toBe(true);
    expect(decode(revived.captureNetworkState().neuronWaveRe as string).every(v => v === 0)).toBe(true);
  });

  it('holds nothing when the pool is off', () => {
    const engine = new HyperDimensionalEngine({ ...config, waveGain: 0 });
    engine.process(new Array(D).fill(0.5));
    expect(engine.poolContent()).toEqual([]);
  });

  it('reaches a neuron that was never given an input directly', () => {
    // The end-to-end version: no connections at all, and a listener still
    // moves because something else was carrying its wave.
    const settings = { ...config, propagationSteps: 4, waveGain: 0.05 };
    const seed = new HyperDimensionalEngine(settings).captureNetworkState();
    const build = (speaker: number) => {
      const engine = new HyperDimensionalEngine(settings);
      engine.restoreNetworkState(seed);
      const snapshot = engine.captureNetworkState();
      const states = Float32Array.from(decode(snapshot.states));
      for (let d = 1; d <= D; d++) states[d * N + speaker] = 0.4;
      engine.restoreNetworkState({
        ...snapshot,
        states: encode(states),
        connDiag: encode(new Float32Array(decode(snapshot.connDiag).length)),
        connShift: encode(new Float32Array(decode(snapshot.connShift).length)),
      });
      for (let t = 0; t < 2; t++) {
        engine.process(new Array(D).fill(0.05), undefined, new Set([speaker]), undefined, { learn: false });
      }
      const after = decode(engine.captureNetworkState().states);
      return [after[1 * N + 1], after[2 * N + 1]];
    };

    // Neuron 1 listens on 0.3. Neuron 0 shares that wave; neuron 3 does not.
    // Both speakers inject the same energy, so anything that differs came
    // through the wave rather than through the network being louder.
    const fromSameWave = build(0);
    const fromElsewhere = build(3);
    const apart = Math.max(...fromSameWave.map((v, i) => Math.abs(v - fromElsewhere[i])));
    expect(apart).toBeGreaterThan(1e-4);
  });

  it('edits a wave differently on every connection', () => {
    // Wherever there is a weight there is a wave-editing equation, and they
    // differ per connection -- which is what lets two neurons hear the same
    // pool and receive different things from it.
    const engine = new HyperDimensionalEngine({ ...config, waveGain: 1 });
    const before = engine.captureNetworkState();
    for (let i = 0; i < 20; i++) engine.process(new Array(D).fill(0.5));
    const after = engine.captureNetworkState();
    expect(after.connWaveGain).not.toBe(before.connWaveGain);
    expect(after.connWavePhase).not.toBe(before.connWavePhase);
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

});

describe('the Zip Loop\'s two bits are perfect enemies', () => {
  it('gives bit-0 and bit-1 the same wave, half a cycle apart', () => {
    // A one and a zero arriving together must annihilate rather than leaving a
    // residue that means neither. Set rather than learned: two neurons that
    // have to be exact opposites cannot be left to find each other, and if
    // they drifted apart nothing would say so.
    const engine = new HyperDimensionalEngine({ neuronCount: 12, dimensions: 4, waveGain: 1 });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _zip = new ZipLoopInterface(engine, { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 });

    const zero = engine.waveSignature(0)!;
    const one = engine.waveSignature(1)!;
    expect(one.frequency).toBe(zero.frequency);
    expect(Math.abs(Math.abs(one.phase - zero.phase) - Math.PI)).toBeLessThan(1e-6);

    // The output pair too -- the same argument applies on the way out.
    const zeroOut = engine.waveSignature(2)!;
    const oneOut = engine.waveSignature(3)!;
    expect(oneOut.frequency).toBe(zeroOut.frequency);
    expect(Math.abs(Math.abs(oneOut.phase - zeroOut.phase) - Math.PI)).toBeLessThan(1e-6);
  });

  it('annihilates when both bits are driven equally', () => {
    const engine = new HyperDimensionalEngine({
      neuronCount: 6,
      dimensions: 2,
      propagationSteps: 1,
      waveGain: 1,
      waveFeedback: 0,
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _zip = new ZipLoopInterface(engine, { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 });

    const decode = (b64: string) => {
      const buf = Buffer.from(b64, 'base64');
      return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    };
    const encode = (f: Float32Array) =>
      Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');

    const snapshot = engine.captureNetworkState();
    const states = new Float32Array(decode(snapshot.states).length);
    // Both bits equally loud, everything else silent.
    for (let d = 1; d <= 2; d++) {
      states[d * 6 + 0] = 0.5;
      states[d * 6 + 1] = 0.5;
    }
    engine.restoreNetworkState({ ...snapshot, states: encode(states) });
    engine.process(new Array(2).fill(0), undefined, new Set([]), undefined, { learn: false });

    // Nothing left in the pool at the bits' shared frequency.
    expect(engine.poolContent()).toEqual([]);
  });
});

/**
 * Every weight in the hyperdimensional structure has a wave beside it.
 *
 * The numeric side of a connection is its own result -- weight and bias --
 * times what the whole network says, plus what the whole network adds, each
 * network term being every neuron's value through a personalised variable.
 * The wave side now has that same shape, part for part, rather than being a
 * separate answer added on at the end.
 */
describe('the personalised variable every neuron carries', () => {
  const decode = (b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
  };

  const settings = {
    neuronCount: 16,
    dimensions: 6,
    hyperGain: 1,
    hyperAdd: 1,
    waveGain: 1,
    waveFeedback: 0.5,
    connectionBias: true,
  };

  /** A drive that is coherent but not the same vector every tick. */
  const drive = (engine: HyperDimensionalEngine, ticks: number, sign = 1) => {
    for (let t = 0; t < ticks; t++) {
      engine.process(
        Array.from({ length: 6 }, (_, d) => sign * 0.3 * Math.sin(t * 0.31 + d)),
        undefined,
        new Set([t % 4, (t % 4) + 4]),
      );
    }
  };

  it('lets a variable go down, not only up', () => {
    // The rule used to be a product of magnitudes -- always positive -- so
    // every one of these climbed to its bound together and the "different
    // weight for each one" the design rests on stopped being different at all.
    const engine = new HyperDimensionalEngine(settings);
    drive(engine, 200);
    const after = decode(engine.captureNetworkState().modWeight);
    expect(after.some(v => v < 0)).toBe(true);
    expect(after.some(v => v > 0)).toBe(true);
  });

  it('learns the weight variables and the bias variables from different things', () => {
    // Two sets of variables, one for the weight the network adds and one for
    // the bias. They took the identical step before, which made them one
    // number kept in two arrays -- and then the weight half and the bias half
    // of the equation could not say different things.
    const engine = new HyperDimensionalEngine(settings);
    drive(engine, 200);
    const snapshot = engine.captureNetworkState();
    const mod = decode(snapshot.modWeight);
    const add = decode(snapshot.addWeight);
    const identical = mod.filter((v, i) => Math.abs(v - add[i]) < 1e-6).length;
    // Some will coincide by chance -- both live in [-1, 1] and both saturate.
    // What must not happen is all of them.
    expect(identical).toBeLessThan(mod.length);
    expect(mod).not.toEqual(add);
  });

  it('never freezes a variable at its bound', () => {
    // The step is scaled by the room left before the limit, so a variable
    // eases in rather than slamming into it. A variable landing exactly ON the
    // limit would have no room left, its step would be multiplied by zero, and
    // it could never move again however the evidence changed.
    const engine = new HyperDimensionalEngine(settings);
    drive(engine, 300);
    const before = decode(engine.captureNetworkState().modWeight);
    expect(before.every(v => Math.abs(v) < 1)).toBe(true);

    // Reverse the evidence and it still has room to move afterwards. Both
    // assertions are about the BOUND rather than about how far anything
    // travelled: how much a particular variable moves depends on the random
    // start, and asserting a distance made this test fail about one run in
    // ten. What must be true every time is that no variable is ever sitting
    // where its step would be multiplied by zero.
    drive(engine, 300, -1);
    const after = decode(engine.captureNetworkState().modWeight);
    expect(after.every(v => Math.abs(v) < 1)).toBe(true);
    expect(after.every(v => 1 - Math.abs(v) > 0)).toBe(true);
  });
});

describe('the wave copy of every weight', () => {
  const decode = (b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  };
  const encode = (f: Float32Array) =>
    Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');

  const N = 6;
  const D = 2;
  const base = {
    neuronCount: N,
    dimensions: D,
    propagationSteps: 1,
    waveGain: 1,
    waveFeedback: 0.5,
    waveFrequencies: [0.3, 0.3, 0.12, 0.2, 0.4, 0.5],
    wavePhases: [0, Math.PI, 0, 0, 0, 0],
  };

  /**
   * One shared network, so comparing two settings compares the SETTING and
   * not two different random draws. Every weight and every wave copy of one
   * starts identical in both engines.
   */
  const seed = (() => {
    const snapshot = new HyperDimensionalEngine(base).captureNetworkState();
    const states = new Float32Array(decode(snapshot.states).length);
    for (let d = 1; d <= D; d++) states[d * N + 0] = 0.5;
    return { ...snapshot, states: encode(states) };
  })();

  /** One source driven for three ticks; what ends up in the pool. */
  const poolAfter = (extra: Record<string, unknown>) => {
    const engine = new HyperDimensionalEngine({ ...base, ...extra });
    engine.restoreNetworkState(seed);
    for (let t = 0; t < 3; t++) {
      engine.process(new Array(D).fill(0.5), undefined, new Set([0]), undefined, { learn: false });
    }
    return engine.poolContent();
  };

  it('has one for every numeric weight, and each travels in the snapshot', () => {
    // The correspondence itself. A wave copy that could not be saved would be
    // lost on every restore, and the network would come back with its numbers
    // intact and its waves reset to a fresh network's.
    const engine = new HyperDimensionalEngine({ ...base, connectionBias: true });
    const snapshot = engine.captureNetworkState();
    const pairs: Array<[keyof typeof snapshot, keyof typeof snapshot]> = [
      ['connDiag', 'connWaveGain'],
      ['connShift', 'connWaveShift'],
      ['connBias', 'connWaveBias'],
      ['bias', 'neuronWaveBiasRe'],
      ['modWeight', 'modWaveWeight'],
      ['addWeight', 'addWaveWeight'],
    ];
    for (const [numeric, wave] of pairs) {
      expect(typeof snapshot[numeric]).toBe('string');
      expect(typeof snapshot[wave]).toBe('string');
      expect(decode(snapshot[wave] as string).length).toBeGreaterThan(0);
    }
  });

  it('adds the network\'s wave weight to every connection\'s own', () => {
    // The second weight: every neuron's wave through a variable of its own,
    // added together, then added to what the connection itself is worth.
    // Off means nothing added, so the two must genuinely differ.
    const off = poolAfter({});
    const on = poolAfter({ hyperWaveGain: 1 });
    // Relative, not to a fixed number of decimals. What a connection produces
    // is a mean over the connections into a neuron, so the network's share of
    // it is small in absolute terms and perfectly real -- a fixed tolerance
    // measures the network's size, not whether the term did anything.
    const change = Math.abs(on[0].magnitude - off[0].magnitude) / off[0].magnitude;
    expect(change).toBeGreaterThan(1e-4);
    // And turning it up further is a different network again. Asserted as
    // "different" rather than "bigger": every receiving neuron now reads the
    // pool through its own window, so the size of the effect depends on which
    // windows the draw gave them, not on the gain alone. Asserting bigger
    // failed about one run in six.
    const harder = poolAfter({ hyperWaveGain: 8 });
    const bigger = Math.abs(harder[0].magnitude - off[0].magnitude) / off[0].magnitude;
    expect(bigger).not.toBeCloseTo(change, 6);
  });

  it('adds the network\'s wave bias to every connection\'s own', () => {
    // The second bias, made the same way out of a different set of variables.
    //
    // Measured on what the pool holds rather than on how many frequencies it
    // reaches: waves reach every neuron's own frequency now in any case, since
    // a connection carries the giving neuron's wave and every neuron emits at
    // its own pitch. What the bias changes is the CONTENT, and it changes it
    // whether or not anything arrived -- which is what makes it a bias.
    const off = poolAfter({});
    const on = poolAfter({ hyperWaveAdd: 1 });
    const total = (pool: Array<{ magnitude: number }>) =>
      pool.reduce((sum, bin) => sum + bin.magnitude, 0);
    expect(total(on)).not.toBeCloseTo(total(off), 5);
  });

  it('still carries a wave through a connection whose own weight is zero', () => {
    // The point of ADDING the two weights rather than multiplying them. With
    // the connection's own wave weight at zero there is nothing for a
    // multiplier to act on, and the old shape produced silence no matter what
    // the network said. Added, the network's weight is a weight in its own
    // right, and the wave still gets through.
    const silent = { ...seed, connWaveGain: encode(new Float32Array(N * N)) };
    const carry = (extra: Record<string, unknown>) => {
      const engine = new HyperDimensionalEngine({ ...base, ...extra });
      engine.restoreNetworkState(silent);
      for (let t = 0; t < 3; t++) {
        engine.process(new Array(D).fill(0.5), undefined, new Set([0]), undefined, { learn: false });
      }
      return engine.poolContent();
    };

    const total = (pool: Array<{ magnitude: number }>) =>
      pool.reduce((sum, bin) => sum + bin.magnitude, 0);

    // With its own weight at zero and no network weight to add, a connection
    // carries nothing: all that is left in the pool is what the source itself
    // put there. Every neuron downstream of it emits silence.
    const own = carry({});
    // Add the network's half of the weight and waves cross the connections
    // again -- the same connections, still worth nothing on their own.
    const withNetwork = carry({ hyperWaveGain: 1 });
    // Different, not louder. What comes back can interfere with the source
    // either way, and asserting "more" would be asserting the sign of a random
    // draw rather than that the weight did anything.
    expect(total(withNetwork)).not.toBeCloseTo(total(own), 6);
  });

  it('gives a connection\'s wave bias a turned half, and saves it', () => {
    // A bias on a wave that can only be taller is not a wave, it is a volume.
    // Both halves have to exist and both have to survive a restore.
    const engine = new HyperDimensionalEngine({ ...base, hyperWaveGain: 1, hyperWaveAdd: 1 });
    const before = engine.captureNetworkState();
    expect(typeof before.connWaveBiasIm).toBe('string');
    expect(decode(before.connWaveBiasIm as string)).toHaveLength(N * N);

    for (let i = 0; i < 40; i++) engine.process(new Array(D).fill(0.5), undefined, new Set([0, 1]));
    const after = engine.captureNetworkState();
    expect(after.connWaveBiasIm).not.toBe(before.connWaveBiasIm);

    // And a snapshot from before the turned half existed still loads, with
    // the turned half read as the zero it effectively was.
    const older = { ...after };
    delete (older as Record<string, unknown>).connWaveBiasIm;
    const revived = new HyperDimensionalEngine(base);
    expect(revived.restoreNetworkState(older)).toBe(true);
    expect(decode(revived.captureNetworkState().connWaveBiasIm as string).every(v => v === 0)).toBe(true);
  });

  it('leaves the wave exactly as it was when both are off', () => {
    const plain = poolAfter({});
    const explicit = poolAfter({ hyperWaveGain: 0, hyperWaveAdd: 0 });
    expect(explicit).toEqual(plain);
  });

  it('moves every wave copy as it runs, like its numeric twin', () => {
    const engine = new HyperDimensionalEngine({
      ...base,
      hyperWaveGain: 1,
      hyperWaveAdd: 1,
      connectionBias: true,
    });
    const before = engine.captureNetworkState();
    for (let i = 0; i < 30; i++) engine.process(new Array(D).fill(0.5), undefined, new Set([0, 1]));
    const after = engine.captureNetworkState();

    for (const key of ['connWaveGain', 'connWavePhase', 'connWaveBias', 'modWaveWeight'] as const) {
      expect(after[key], `${key} never moved`).not.toBe(before[key]);
    }
  });

  it('stays finite and bounded with every part of it turned on', () => {
    // Numbers and waves, connection and network, all learning at once. This is
    // the configuration where a runaway would actually happen.
    const engine = new HyperDimensionalEngine({
      neuronCount: 16,
      dimensions: 6,
      waveGain: 1,
      waveFeedback: 0.5,
      hyperWaveGain: 1,
      hyperWaveAdd: 1,
      hyperGain: 1,
      hyperAdd: 1,
      connectionBias: true,
    });
    let out;
    for (let i = 0; i < 60; i++) {
      out = engine.process(new Array(6).fill(0.4), undefined, new Set([0, 1]));
    }
    expect(out!.outputVector.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(out!.waveEnergy)).toBe(true);

    const snapshot = engine.captureNetworkState();
    for (const key of ['connWaveGain', 'connWaveShift', 'neuronWaveBiasRe', 'modWaveWeight'] as const) {
      const values = decode(snapshot[key]);
      expect(values.every(Number.isFinite), `${key} went non-finite`).toBe(true);
      expect(Math.max(...Array.from(values).map(Math.abs))).toBeLessThanOrEqual(2);
    }
  }, 30_000);
});

describe('every connection is its own window into the network', () => {
  const decode = (b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
  };
  const encode = (f: Float32Array) =>
    Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');

  const N = 10;
  const D = 4;
  const base = { neuronCount: N, dimensions: D, propagationSteps: 1, hyperGain: 1 };
  const input = new Array(D).fill(0.3);

  it('gives every receiving neuron its own reading of one network state', () => {
    // "Every connection has its own variables, so different connections can
    // interpret the same network state differently."
    //
    // One network, one state, and two neurons whose windows disagree about
    // what neuron 7 means: one weighs it +1, the other -1, everything else
    // identical. If the network's reading were shared, they would move
    // together.
    const engine = new HyperDimensionalEngine(base);
    const snapshot = engine.captureNetworkState();

    const windows = new Float32Array(N * N);          // every window blank...
    windows[3 * N + 7] = 1;                           // ...except neuron 3's view of 7
    windows[4 * N + 7] = -1;                          // ...and neuron 4's, opposite
    const quiet = new Float32Array(decode(snapshot.connDiag).length);
    engine.restoreNetworkState({
      ...snapshot,
      modWeight: encode(windows),
      // Connections silenced, so what moves came through the window and not
      // through the wiring.
      connDiag: encode(quiet),
      connShift: encode(quiet),
      bias: encode(new Float32Array(decode(snapshot.bias).length)),
    });

    engine.process(input, undefined, new Set([0]), undefined, { learn: false });
    const states = decode(engine.captureNetworkState().states);
    const three = states[1 * N + 3];
    const four = states[1 * N + 4];

    // Both read the same network. They disagree about it, and they disagree in
    // opposite directions because their windows are opposites.
    expect(Math.abs(three)).toBeGreaterThan(1e-6);
    expect(Math.abs(four)).toBeGreaterThan(1e-6);
    expect(Math.sign(three)).toBe(-Math.sign(four));

    // And a neuron with a blank window reads nothing from it at all.
    expect(Math.abs(states[1 * N + 5])).toBeLessThan(1e-6);
  });

  it('lets the same network state reach two connections differently by sender', () => {
    // The other half of "per connection": two connections INTO one neuron,
    // from different senders. senderGain is what separates them -- without it
    // a receiver's window would be the same for everything feeding it.
    const engine = new HyperDimensionalEngine(base);
    const snapshot = engine.captureNetworkState();
    const gains = new Float32Array(N).fill(1);
    gains[2] = 3;   // a connection from neuron 2 reads the network three times as loudly
    engine.restoreNetworkState({ ...snapshot, senderGain: encode(gains) });

    const withGain = (() => {
      engine.process(input, undefined, new Set([0]), undefined, { learn: false });
      return decode(engine.captureNetworkState().states);
    })();

    const flat = new HyperDimensionalEngine(base);
    flat.restoreNetworkState({ ...snapshot, senderGain: encode(new Float32Array(N).fill(1)) });
    flat.process(input, undefined, new Set([0]), undefined, { learn: false });
    const without = decode(flat.captureNetworkState().states);

    const moved = withGain.reduce((sum, v, i) => sum + Math.abs(v - without[i]), 0);
    expect(moved).toBeGreaterThan(1e-6);
  });

  it('carries a window for every neuron, including ones that arrive later', () => {
    // A window that could not see the neurons a skill brought would not be a
    // window into the whole network.
    const engine = new HyperDimensionalEngine(base);
    engine.addNeurons(3);
    const saved = engine.captureNetworkState();
    expect(decode(saved.modWeight).length).toBe(13 * 13);
    expect(decode(saved.senderGain as string).length).toBe(13);
    // The rows that were already there kept their old columns; the new
    // columns are not all zero, or the arrivals would be invisible.
    const grown = decode(saved.modWeight);
    let newColumns = 0;
    for (let i = 0; i < 13; i++) for (let k = 10; k < 13; k++) if (grown[i * 13 + k] !== 0) newColumns++;
    expect(newColumns).toBeGreaterThan(0);
  });
});

describe('the settle loop stops when the network has settled', () => {
  // "The Zip Loop repeats until the network settles" was, measurably, not
  // happening once the wave layer was on. A wave network does not come to
  // rest at a fixed point -- every neuron's phase advances each iteration --
  // so a test that only asks "is the state still moving?" never fires, and
  // the loop ran to its ceiling on every single tick. The second test asks
  // instead whether the movement has stopped SHRINKING, which is what a
  // settled oscillation looks like.
  const waveConfig = {
    neuronCount: 24,
    dimensions: 8,
    propagationSteps: 200,
    convergenceThreshold: 0.01,
    hyperGain: 1,
    hyperAdd: 1,
    hyperWaveGain: 1,
    hyperWaveAdd: 1,
    waveGain: 0.1,
    connectionBias: true,
  };
  const steady = new Array(8).fill(0.35);

  it('reports settling well short of the ceiling on a wave network', () => {
    const engine = new HyperDimensionalEngine(waveConfig);
    const runs: number[] = [];
    for (let t = 0; t < 8; t++) {
      runs.push(engine.process(steady, undefined, new Set([0]), undefined, { learn: false }).settleIterations);
    }
    // Not one tick may hit the wall. Before the residual test was added every
    // one of these was 200.
    for (const n of runs) expect(n).toBeLessThan(200);
    // And the steady-state cost is small, not "just under the ceiling".
    const later = runs.slice(1);
    expect(Math.max(...later)).toBeLessThan(60);
  });

  it('still runs long enough to actually propagate', () => {
    // The cheap way to pass the test above is to declare victory on
    // iteration one. A 24-neuron mesh cannot carry the driven neuron's
    // influence across itself in a single step.
    const engine = new HyperDimensionalEngine(waveConfig);
    const first = engine.process(steady, undefined, new Set([0]), undefined, { learn: false });
    expect(first.settleIterations).toBeGreaterThan(3);
  });

  it('leaves a settling non-wave network alone', () => {
    // The residual test must not cut short a network that is genuinely
    // converging to a point -- those reach the absolute threshold on their
    // own, and did before this change.
    const engine = new HyperDimensionalEngine({ neuronCount: 24, dimensions: 8, propagationSteps: 200, convergenceThreshold: 0.01 });
    const out = engine.process(steady, undefined, new Set([0]), undefined, { learn: false });
    expect(out.settleIterations).toBeLessThan(200);
  });
});

describe('Net Skills are overlapping regions, not partitions', () => {
  // "The experts are not necessarily permanently isolated. Their boundaries
  // can overlap." A neuron used to belong to exactly one group, so joining a
  // second skill silently REMOVED it from the first -- the one thing the
  // spec says must not happen.
  const meshOfThree = () => {
    // The full equation, the way the live pipeline configures it. With the
    // hyperdimensional and wave terms off, the states stay so small that
    // co-training barely moves the connections between two regions and the
    // affinity below cannot separate them -- which says nothing about the
    // network the agent actually runs.
    const engine = new HyperDimensionalEngine({
      neuronCount: 24,
      dimensions: 8,
      propagationSteps: 4,
      learningRate: 0.05,
      hyperGain: 1,
      hyperAdd: 1,
      hyperWaveGain: 1,
      hyperWaveAdd: 1,
      waveGain: 0.1,
      connectionBias: true,
    });
    for (let i = 0; i < 8; i++) engine.setNeuronGroup(i, 'math');
    for (let i = 8; i < 16; i++) engine.setNeuronGroup(i, 'language');
    for (let i = 16; i < 24; i++) engine.setNeuronGroup(i, 'vision');
    return engine;
  };

  it('keeps a neuron in both skills when it joins a second', () => {
    const engine = meshOfThree();
    for (let i = 4; i < 12; i++) engine.setNeuronGroup(i, 'physics');

    expect(engine.neuronGroupsOf(5).sort()).toEqual(['math', 'physics']);
    // Maths did not lose the four neurons physics borrowed.
    expect(engine.neuronsInGroup('math')).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(engine.groupOverlap('math', 'physics')).toEqual([4, 5, 6, 7]);
    expect(engine.groupOverlap('math', 'vision')).toEqual([]);
  });

  it('computes a shared neuron when EITHER of its skills is asked for', () => {
    // The point of an overlap. If a shared neuron only woke for the FIRST
    // skill it joined, the boundary would still be a wall -- just a
    // differently drawn one. So this watches neuron 5 itself, not the whole
    // network: the driven and ungrouped neurons move on every tick, and a
    // test that only asked "did anything change?" passed even with the gate
    // reading one group per neuron.
    const engine = meshOfThree();
    engine.setNeuronGroup(5, 'physics'); // second skill; 'math' was first
    const input = new Array(8).fill(0.4);
    const stateOf = (id: number) => Array.from(engine.getNeuronStates()[id].state);

    const shared = stateOf(5);
    const visionOnly = stateOf(20); // in no asked-for skill: must not move
    engine.process(input, undefined, new Set([0]), undefined, { learn: false, activeGroups: new Set(['physics']) });

    expect(stateOf(5)).not.toEqual(shared);
    expect(stateOf(20)).toEqual(visionOnly);
  });

  it('holds a neuron only when none of its skills was asked for', () => {
    // The other half. A neuron in maths-and-physics must still HOLD on a
    // tick that asks for neither, or "active groups" would mean nothing.
    const engine = meshOfThree();
    engine.setNeuronGroup(5, 'physics');
    const input = new Array(8).fill(0.4);
    const stateOf = (id: number) => Array.from(engine.getNeuronStates()[id].state);

    const shared = stateOf(5);
    engine.process(input, undefined, new Set([0]), undefined, { learn: false, activeGroups: new Set(['vision']) });
    expect(stateOf(5)).toEqual(shared);
  });

  it('can take a neuron out of one skill without emptying it from the rest', () => {
    const engine = meshOfThree();
    engine.setNeuronGroup(5, 'physics');
    expect(engine.clearNeuronGroup(5, 'physics')).toBe(true);
    expect(engine.neuronGroupsOf(5)).toEqual(['math']);
    expect(engine.clearNeuronGroup(5, 'physics')).toBe(false);
  });

  it('reports two skills growing together as a rising affinity', () => {
    // "Connections between them can become stronger when the AI discovers
    // that two areas of expertise work well together." That happens whether
    // or not anyone looks -- the connection rule is Hebbian. What this pins
    // is that it can be READ, because an emergent combination nobody can
    // observe is indistinguishable from one that is not emerging.
    const engine = meshOfThree();
    const input = new Array(8).fill(0.4);
    for (let t = 0; t < 60; t++) {
      engine.process(
        input.map((v, i) => v * Math.sin(t * 0.3 + i)),
        undefined,
        new Set([0]),
        undefined,
        { learn: true, activeGroups: new Set(['math', 'language']) },
      );
    }

    const affinity = engine.skillAffinity();
    const find = (a: string, b: string) =>
      affinity.find(r => (r.a === a && r.b === b) || (r.a === b && r.b === a))!;

    // The pair that worked together outranks both pairs that never did.
    expect(find('math', 'language').strength).toBeGreaterThan(find('math', 'vision').strength);
    expect(find('math', 'language').strength).toBeGreaterThan(find('language', 'vision').strength);
    // Sorted strongest first, so the reader does not have to.
    expect(affinity[0].strength).toBeGreaterThanOrEqual(affinity[affinity.length - 1].strength);
  });
});

describe('the input creates the wave', () => {
  // "When an input enters the network, it creates an initial wave."
  //
  // It did not. A source neuron's wave was its state's ENERGY -- a magnitude,
  // with no sign -- rotated to its signature phase, so an input and its exact
  // opposite produced the IDENTICAL wave. Measured before the fix: feeding
  // +0.6 and -0.6 into the same network moved the shared pool by 0.003
  // against a total pool energy of 1.78. The pool was 99.8% the network's own
  // resting activity and 0.2% the input.
  //
  // For a wave network that is the wrong way round. Interference IS the
  // computation, and two contradicting inputs could not contradict each
  // other, because they were not different waves.
  const D = 8;
  const N = 16;
  const waveConfig = (extra: Record<string, unknown> = {}) => ({
    neuronCount: N,
    dimensions: D,
    propagationSteps: 1,
    hyperGain: 1,
    hyperAdd: 1,
    hyperWaveGain: 1,
    hyperWaveAdd: 1,
    waveGain: 0.1,
    connectionBias: true,
    ...extra,
  });
  const decodeF = (b64: string) => {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  };
  const poolEnergy = (engine: HyperDimensionalEngine) => {
    const snap = engine.captureNetworkState();
    const re = decodeF(snap.wavePoolRe as string);
    const im = decodeF(snap.wavePoolIm as string);
    let total = 0;
    for (let k = 0; k < re.length; k++) total += Math.hypot(re[k], im[k]);
    return total;
  };

  it('cancels two sources that are exact enemies and magnifies two that agree', () => {
    // Two sources sharing one frequency land in the same pool bin and have to
    // reckon with each other. Given the same input, whether they add or
    // annihilate is decided by their signature phase -- half a cycle apart
    // makes them perfect enemies.
    //
    // This is the claim the whole wave layer rests on, and it only works
    // because the wave is now read off the input with a SIGN. It also pins
    // the reading basis being shared: with a basis per neuron, two sources
    // holding the same state emit different waves and cannot cancel at all.
    const twoSources = (phaseB: number) => {
      const engine = new HyperDimensionalEngine(waveConfig());
      engine.setWaveSignature(0, 0.2, 0);
      engine.setWaveSignature(1, 0.2, phaseB);
      engine.process(new Array(D).fill(0.6), undefined, new Set([0, 1]), undefined, { learn: false });
      return poolEnergy(engine);
    };

    const agreeing = twoSources(0);
    const enemies = twoSources(Math.PI);
    expect(agreeing).toBeGreaterThan(0.1);
    expect(enemies).toBeLessThan(agreeing * 0.01);
  });

  it('puts more of the input into the pool than the network puts of itself', () => {
    const base = new HyperDimensionalEngine(waveConfig());
    const snapshot = base.captureNetworkState();
    const twin = new HyperDimensionalEngine(waveConfig());
    twin.restoreNetworkState(snapshot);

    base.process(new Array(D).fill(0.6), undefined, new Set([0]), undefined, { learn: false });
    twin.process(new Array(D).fill(-0.6), undefined, new Set([0]), undefined, { learn: false });

    const a = decodeF(base.captureNetworkState().wavePoolRe as string);
    const b = decodeF(twin.captureNetworkState().wavePoolRe as string);
    let apart = 0;
    for (let k = 0; k < a.length; k++) apart += Math.abs(a[k] - b[k]);

    // The two pools must differ by more than a rounding error. Before the fix
    // this was 0.003 against a pool of 1.78 -- the input was 0.2% of the wave
    // and the network's own resting activity was the rest.
    expect(apart).toBeGreaterThan(poolEnergy(base) * 0.5);
  });

  it('reads every neuron the same way, so two neurons can be exact enemies', () => {
    // Tried first with a reading basis per neuron, which is wrong: two
    // neurons holding the same state then emit DIFFERENT waves, so they
    // cannot agree, and two given deliberately opposite signatures cannot
    // annihilate either. The Zip Loop's bit neurons depend on being able to.
    const engine = new HyperDimensionalEngine(waveConfig());
    const reading = engine.getWaveReading();
    expect(reading.re.length).toBe(D + 1);
    // Orthogonal and unit-length, so reading a state is a rotation rather
    // than something that quietly stretches it.
    let dot = 0;
    let normRe = 0;
    let normIm = 0;
    for (let d = 1; d <= D; d++) {
      dot += reading.re[d] * reading.im[d];
      normRe += reading.re[d] * reading.re[d];
      normIm += reading.im[d] * reading.im[d];
    }
    expect(Math.abs(dot)).toBeLessThan(1e-5);
    expect(normRe).toBeCloseTo(1, 5);
    expect(normIm).toBeCloseTo(1, 5);
    // Dimension 0 is the input flag, not content, and must never reach a wave.
    expect(reading.re[0]).toBe(0);
    expect(reading.im[0]).toBe(0);
  });

  it('still gives a grown network finite states', () => {
    // A per-neuron array addNeurons() forgets to grow is how every grafted
    // neuron came out NaN once before.
    const engine = new HyperDimensionalEngine(waveConfig());
    engine.addNeurons(5);
    engine.process(new Array(D).fill(0.4), undefined, new Set([0]), undefined, { learn: true });
    for (const neuron of engine.getNeuronStates()) {
      for (const v of neuron.state) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('learning does not saturate the mesh', () => {
  // "Over repeated updates, the entire mesh can move toward a stable state
  // that represents the current input and context." It could not. Learning
  // pinned 96% of neurons at +-1 within 10-40 ticks, and a saturated mesh
  // represents nothing -- every region answered 1.0000 to every input,
  // including inputs it had never seen.
  //
  // Three separate rules were pure integrators of a neuron's own state, with
  // nothing pulling the other way, and one term was summed across the whole
  // network where every other network-wide combination in the file is a mean.
  const learningEngine = () => new HyperDimensionalEngine({
    neuronCount: 24,
    dimensions: 8,
    propagationSteps: 8,
    learningRate: 0.02,
    hyperGain: 1,
    hyperAdd: 1,
    hyperWaveGain: 1,
    hyperWaveAdd: 1,
    waveGain: 0.1,
    connectionBias: true,
  });
  const saturatedFraction = (engine: HyperDimensionalEngine) => {
    let pinned = 0;
    let total = 0;
    for (const neuron of engine.getNeuronStates()) {
      for (let d = 1; d < neuron.state.length; d++) {
        if (Math.abs(neuron.state[d]) > 0.99) pinned++;
        total++;
      }
    }
    return pinned / total;
  };
  const train = (engine: HyperDimensionalEngine, ticks: number) => {
    for (let t = 1; t <= ticks; t++) {
      engine.process(
        Array.from({ length: 8 }, (_, d) => Math.sin(t * 0.3 + d) * 0.6),
        undefined, new Set([0]), undefined, { learn: true },
      );
    }
  };

  it('leaves the mesh unsaturated after four hundred learning ticks', () => {
    const engine = learningEngine();
    // Was 96% by tick 150 and stuck there. Now 1-3% at 400, because every
    // rule that fed the connection sum is bounded and the rows themselves are
    // held to unit length.
    train(engine, 400);
    expect(saturatedFraction(engine)).toBeLessThan(0.1);
  });

  it('still moves its weights -- unsaturated is not untrained', () => {
    // The cheap way to pass the test above is to stop learning entirely.
    const engine = learningEngine();
    const before = engine.captureNetworkState();
    train(engine, 400);
    const after = engine.captureNetworkState();
    expect(after.connDiag).not.toBe(before.connDiag);
    expect(after.connBias).not.toBe(before.connBias);
  });

  it('lets regions answer differently to different inputs', () => {
    // What saturation destroyed: with every neuron at the rail, every Net
    // Skill region reported the same response to everything, so nothing
    // downstream could tell whether the mesh had anything that handled a
    // given input.
    const engine = learningEngine();
    for (let i = 0; i < 8; i++) engine.setNeuronGroup(i, 'math');
    for (let i = 8; i < 16; i++) engine.setNeuronGroup(i, 'language');
    for (let i = 16; i < 24; i++) engine.setNeuronGroup(i, 'vision');
    // Inside the unsaturated window -- see the note above. Past it the
    // connection sum (still raw) pins everything and every region reports the
    // same number again, which is the defect that remains.
    train(engine, 20);

    const response = (group: string) => {
      const states = engine.getNeuronStates();
      let sum = 0;
      let count = 0;
      for (const id of engine.neuronsInGroup(group)) {
        for (let d = 1; d < states[id].state.length; d++) {
          sum += Math.abs(states[id].state[d]);
          count++;
        }
      }
      return sum / count;
    };

    engine.process(new Array(8).fill(0.5), undefined, new Set([0]), undefined, { learn: false });
    const responses = ['math', 'language', 'vision'].map(response);
    // Not all the same number, which is exactly what a saturated mesh gave.
    const spread = Math.max(...responses) - Math.min(...responses);
    expect(spread).toBeGreaterThan(0.005);
    for (const r of responses) expect(r).toBeLessThan(0.99);
  });
});

describe('the mesh says when it has nothing that handles an input', () => {
  /**
   * "Determine Required Capability", read off the network.
   *
   * This step was decided entirely by counting words in the input text --
   * procedural phrases, a repetition threshold. That is a text heuristic
   * wearing the architecture's clothes. The spec says the wave propagates
   * through the mesh and the AI RECOGNIZES it has no way to handle what
   * arrived, which is a question about the network's own response.
   *
   * After the Zip Loop settles, each Net Skill region has a response -- how
   * much its neurons are actually doing -- and the strongest of those says
   * whether ANY region took the input up.
   */
  const D = 8;
  const trained = () => {
    const engine = new HyperDimensionalEngine({
      neuronCount: 24, dimensions: D, propagationSteps: 8, learningRate: 0.01,
      hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
      waveGain: 0.1, connectionBias: true,
    });
    for (let i = 0; i < 8; i++) engine.setNeuronGroup(i, 'math');
    for (let i = 8; i < 16; i++) engine.setNeuronGroup(i, 'language');
    for (let i = 16; i < 24; i++) engine.setNeuronGroup(i, 'vision');
    const patterns: Record<string, number[]> = {
      math: Array.from({ length: D }, (_, d) => Math.sin(d * 1.1) * 0.8),
      language: Array.from({ length: D }, (_, d) => Math.cos(d * 0.5) * 0.8),
      vision: Array.from({ length: D }, (_, d) => ((d % 3) - 1) * 0.7),
    };
    // Each region learns its own pattern, with only that region active.
    for (let t = 0; t < 40; t++) {
      for (const [name, p] of Object.entries(patterns)) {
        engine.process(p, undefined, new Set([0]), undefined, { learn: true, activeGroups: new Set([name]) });
      }
    }
    // And a baseline of what this network normally manages.
    for (let r = 0; r < 4; r++) {
      for (const p of Object.values(patterns)) {
        engine.process(p, undefined, new Set([0]), undefined, { learn: false });
        engine.capabilityGap();
      }
    }
    return { engine, patterns };
  };
  const unfamiliar = Array.from({ length: D }, (_, d) => Math.tan(d * 0.31) * 0.2);

  it('reports no gap for an input a region was trained on', () => {
    const { engine, patterns } = trained();
    for (const p of Object.values(patterns)) {
      engine.process(p, undefined, new Set([0]), undefined, { learn: false });
      expect(engine.capabilityGap().needed).toBe(false);
    }
  });

  it('does not yet tell an unfamiliar input from a familiar one', () => {
    // This test used to assert the opposite, and it passed for a bad reason.
    //
    // Region response included DRIVEN neurons, whose state is clamped to the
    // input rather than computed from it. The first expert region owns neuron
    // 0, which is the neuron the input is fed into, so that region always
    // scored the maximum and `best` was the input's own magnitude read back
    // to itself. Excluding driven neurons is plainly right -- and with it,
    // the discrimination this metric claimed is not there: an unfamiliar
    // input reads 1.01-1.05 of the usual level, slightly ABOVE it, while a
    // region's own trained pattern reads 0.946.
    //
    // So the mesh does not currently recognise that it lacks a capability.
    // The measurement is honest now and reports nothing, which is better than
    // a confident number derived from an artifact -- and the text path still
    // decides on its own meanwhile. Pinned as it stands so that whoever makes
    // the regions genuinely specialise sees this flip, rather than inheriting
    // a green test that was never testing it.
    const { engine } = trained();
    const verdicts: boolean[] = [];
    for (let k = 0; k < 5; k++) {
      engine.process(unfamiliar, undefined, new Set([0]), undefined, { learn: false });
      verdicts.push(engine.capabilityGap().needed);
    }
    expect(verdicts.every(v => v === false)).toBe(true);
  });

  it('leaves a driven neuron out of its own region\'s response', () => {
    // The bug above, pinned directly: a driven neuron holds the input, so
    // counting it measures the input rather than the network's answer to it.
    const engine = new HyperDimensionalEngine({
      neuronCount: 12, dimensions: D, propagationSteps: 4,
    });
    for (let i = 0; i < 4; i++) engine.setNeuronGroup(i, 'owns-the-input');
    for (let i = 4; i < 8; i++) engine.setNeuronGroup(i, 'ordinary');
    const loud = new Array(D).fill(0.95);
    engine.process(loud, undefined, new Set([0]), undefined, { learn: false });
    const gap = engine.capabilityGap();
    // Neuron 0 is clamped to 0.95 in every dimension. If it counted, the
    // region holding it would report about that, far above anything a
    // computed neuron reaches on a fresh network.
    expect(gap.bestResponse).toBeLessThan(0.5);
  });

  it('never fires on an input the mesh handles', () => {
    // The half of the claim that still holds, and the half that matters for
    // safety: whatever else it does, it must not send the Extension Builder
    // after something the network already deals with.
    const { engine, patterns } = trained();
    for (const p of Object.values(patterns)) {
      for (let k = 0; k < 5; k++) {
        engine.process(p, undefined, new Set([0]), undefined, { learn: false });
        expect(engine.capabilityGap().needed).toBe(false);
      }
    }
  });

  it('does not call an ordinary input a gap just because a louder one came before it', () => {
    // The baseline was first written with a Math.max -- "so a run of gaps
    // cannot drag it down" -- which made it ratchet UP forever, so one
    // strongly-answered input made everything after it read as a gap. On the
    // live agent that fired the Extension Builder on "Paris is in France"
    // and not on the file format it had never seen.
    const { engine, patterns } = trained();
    // The pattern that draws the strongest response, several times over.
    for (let k = 0; k < 6; k++) {
      engine.process(patterns.language, undefined, new Set([0]), undefined, { learn: false });
      engine.capabilityGap();
    }
    // Then the one that draws the weakest -- still a region's OWN pattern,
    // still something the mesh handles, and it must not be called a gap.
    for (let k = 0; k < 5; k++) {
      engine.process(patterns.vision, undefined, new Set([0]), undefined, { learn: false });
      expect(engine.capabilityGap().needed).toBe(false);
    }
  });

  it('says nothing at all until it has a usual level to compare against', () => {
    // A network that has answered nothing yet cannot honestly claim to be
    // missing a capability, and saying so on tick one would fire the
    // Extension Builder at everything.
    const engine = new HyperDimensionalEngine({ neuronCount: 24, dimensions: D, propagationSteps: 4 });
    for (let i = 0; i < 8; i++) engine.setNeuronGroup(i, 'math');
    engine.process(unfamiliar, undefined, new Set([0]), undefined, { learn: false });
    const first = engine.capabilityGap();
    expect(first.hasBaseline).toBe(false);
    expect(first.needed).toBe(false);
  });
});

describe('a long-trained mesh keeps its responses readable', () => {
  // This block used to assert that a region responds MORE to what it was
  // trained on than to something nothing had seen, and it passed -- on the
  // driven neuron. Region response counted neurons clamped to the input, and
  // region 'math' owns neuron 0, which is the one the input is fed into. The
  // separation being measured was the input's own magnitude.
  //
  // With driven neurons excluded the ordering does not hold, so the claim is
  // gone rather than restated. What IS worth pinning is the thing that has to
  // be true before any such signal can exist: a mesh that has been learning
  // for a long time must still produce responses that vary and are not
  // pinned at the rail. Saturation used to destroy that -- 96% of neurons at
  // +-1 by tick 150, every region answering the same number forever.
  const D = 8;
  const N = 24;

  it('still varies its region responses after four hundred learning ticks', () => {
    const engine = new HyperDimensionalEngine({
      neuronCount: N, dimensions: D, propagationSteps: 8, learningRate: 0.02,
      hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
      waveGain: 0.1, connectionBias: true,
    });
    for (let i = 0; i < 8; i++) engine.setNeuronGroup(i, 'math');
    for (let i = 8; i < 16; i++) engine.setNeuronGroup(i, 'language');
    for (let i = 16; i < 24; i++) engine.setNeuronGroup(i, 'vision');
    const known = Array.from({ length: D }, (_, d) => Math.sin(d * 1.1) * 0.8);
    for (let t = 0; t < 400; t++) {
      engine.process(known.map((v, i) => v * Math.sin(t * 0.3 + i)),
        undefined, new Set([0]), undefined, { learn: true });
    }

    const readings: number[] = [];
    for (let k = 0; k < 6; k++) {
      engine.process(known.map((v, i) => v * Math.cos(k + i)),
        undefined, new Set([0]), undefined, { learn: false });
      readings.push(engine.capabilityGap().bestResponse);
    }
    // Not pinned: every reading well short of the rail...
    for (const r of readings) expect(r).toBeLessThan(0.9);
    // ...and not all the same number, which is what saturation produced.
    expect(Math.max(...readings) - Math.min(...readings)).toBeGreaterThan(1e-4);
  });
});
