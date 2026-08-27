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
