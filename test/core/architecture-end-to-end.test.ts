/**
 * The whole architecture, in one place, measured.
 *
 * Every other test file pins one mechanism. This one walks the architecture
 * as it was described, end to end, so that "does the thing actually work"
 * has a single answer that can be re-run rather than a transcript to trust.
 *
 * Every assertion here is a measurement. Two of them started life as a
 * printed PASS with nothing behind it -- the Zip Loop's bit neurons, and the
 * claim that the network-derived weight and bias participate at all -- and
 * both are now the strongest checks in the file, because a claim you assert
 * instead of measuring is the one most likely to be wrong.
 */

import { describe, it, expect } from 'vitest';
import { HyperDimensionalEngine, ZipLoopInterface } from '../../models && skills/core/onebrain.js';
import { runUntilStopped } from '../../models && skills/core/zip-halt.js';
import { graftNetSkill } from '../../models && skills/core/net-skill-graft.js';

const D = 8;
const N = 16;
const config = () => ({
  neuronCount: N, dimensions: D, propagationSteps: 24, convergenceThreshold: 0.01,
  hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
  waveGain: 0.1, connectionBias: true,
});
const decode = (b64: string) => {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Float32Array(bytes.buffer);
};

describe('the architecture, end to end', () => {
  it('connects every neuron to every other neuron', () => {
    const engine = new HyperDimensionalEngine(config());
    const snap = engine.captureNetworkState();
    const diag = decode(snap.connDiag);
    const shift = decode(snap.connShift);
    const totalDims = diag.length / (N * N);
    let dead = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        let any = false;
        for (let d = 0; d < totalDims; d++) {
          const k = (i * totalDims + d) * N + j;
          if (diag[k] !== 0 || shift[k] !== 0) any = true;
        }
        if (!any) dead++;
      }
    }
    expect(dead).toBe(0);
  });

  it('gives every neuron a multi-dimensional state', () => {
    const engine = new HyperDimensionalEngine(config());
    for (const neuron of engine.getNeuronStates()) {
      expect(neuron.state.length).toBe(D + 1);
    }
  });

  it('actually uses the network-derived weight and bias, not just stores them', () => {
    // The half of the hyperdimensional term that is easiest to have present
    // and inert. Zeroing the two rows every connection reads the network
    // through must change the answer, or that half is decoration.
    const engine = new HyperDimensionalEngine(config());
    const snap = engine.captureNetworkState();
    expect(decode(snap.modWeight).length).toBe(N * N);
    expect(decode(snap.addWeight).length).toBe(N * N);

    const answerWith = (state: typeof snap) => {
      const g = new HyperDimensionalEngine(config());
      g.restoreNetworkState(state);
      g.process(new Array(D).fill(0.5), undefined, new Set([0]), undefined, { learn: false });
      return decode(g.captureNetworkState().states);
    };
    const zeros = btoa(String.fromCharCode(...new Uint8Array(new Float32Array(N * N).buffer)));
    const withNetwork = answerWith(snap);
    const without = answerWith({ ...snap, modWeight: zeros, addWeight: zeros });

    let apart = 0;
    for (let i = 0; i < withNetwork.length; i++) apart += Math.abs(withNetwork[i] - without[i]);
    expect(apart).toBeGreaterThan(1e-6);
  });

  it('cancels opposite waves in the bin they share, and stays silent on silence', () => {
    const loudestBin = (phaseB: number) => {
      const g = new HyperDimensionalEngine(config());
      g.setWaveSignature(0, 0.2, 0);
      g.setWaveSignature(1, 0.2, phaseB);
      g.process(new Array(D).fill(0.6), undefined, new Set([0, 1]), undefined, { learn: false });
      const snap = g.captureNetworkState();
      const re = decode(snap.wavePoolRe as string);
      const im = decode(snap.wavePoolIm as string);
      let peak = 0;
      for (let k = 0; k < re.length; k++) peak = Math.max(peak, Math.hypot(re[k], im[k]));
      return peak;
    };
    const agreeing = loudestBin(0);
    const opposite = loudestBin(Math.PI);
    expect(agreeing).toBeGreaterThan(0.5);
    expect(opposite).toBeLessThan(agreeing * 0.02);

    const quiet = new HyperDimensionalEngine(config());
    quiet.process(new Array(D).fill(0), undefined, new Set([0]), undefined, { learn: false });
    const snap = quiet.captureNetworkState();
    const re = decode(snap.wavePoolRe as string);
    const im = decode(snap.wavePoolIm as string);
    let energy = 0;
    for (let k = 0; k < re.length; k++) energy += Math.hypot(re[k], im[k]);
    expect(energy).toBe(0);
  });

  it('streams a byte through the 1 and 0 neurons, which are exact enemies', () => {
    const engine = new HyperDimensionalEngine(config());
    const zip = new ZipLoopInterface(engine, { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 });
    const snap = engine.captureNetworkState();
    const freq = decode(snap.waveFreq as string);
    const phase = decode(snap.wavePhase as string);
    // One frequency, half a cycle apart: a one and a zero arriving together
    // annihilate rather than leaving a residue meaning neither.
    expect(freq[0]).toBe(freq[1]);
    expect(Math.abs(Math.abs(phase[0] - phase[1]) - Math.PI)).toBeLessThan(1e-6);

    // And the byte really drives them, MSB first, alternating.
    const drove: number[] = [];
    const real = engine.process.bind(engine);
    (engine as unknown as { process: unknown }).process = (
      input: number[], a: unknown, driven: Set<number>, ...rest: unknown[]
    ) => {
      if (driven && driven.size === 1) drove.push([...driven][0]);
      return (real as (...args: unknown[]) => unknown)(input, a, driven, ...rest);
    };
    zip.sendBytes(new Uint8Array([0b10110011]));
    (engine as unknown as { process: unknown }).process = real;
    expect(drove.slice(0, 8)).toEqual([1, 0, 1, 1, 0, 0, 1, 1]);
  });

  it('grows the mesh when a net skill arrives', () => {
    const engine = new HyperDimensionalEngine(config());
    const before = engine.getNeuronCount();
    graftNetSkill(engine, 'optics', [
      { name: 'lens', definition: 'bends light' },
      { name: 'ray', definition: 'a path of light' },
    ]);
    expect(engine.getNeuronCount()).toBeGreaterThan(before);
    expect(engine.neuronsInGroup('optics').length).toBe(2);
  });

  it('changes a hard-driven neuron far more than a barely-touched one', () => {
    const engine = new HyperDimensionalEngine({
      neuronCount: 16, dimensions: D, propagationSteps: 6, learningRate: 0.03,
      hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
      waveGain: 0.1, connectionBias: true,
    });
    for (let j = 1; j < 5; j++) engine.setConnection(j, 0, 1.9);
    for (let j = 10; j < 15; j++) engine.setConnection(j, 0, 0.02);
    const before = decode(engine.captureNetworkState().connDiag);
    for (let t = 0; t < 40; t++) {
      engine.process(new Array(D).fill(0.8), undefined, new Set([0]), undefined, { learn: true });
    }
    const after = decode(engine.captureNetworkState().connDiag);
    const totalDims = before.length / (16 * 16);
    const moved = (i: number) => {
      let sum = 0;
      for (let d = 0; d < totalDims; d++) {
        for (let j = 0; j < 16; j++) {
          const k = (i * totalDims + d) * 16 + j;
          sum += Math.abs(after[k] - before[k]);
        }
      }
      return sum;
    };
    let loud = 0;
    for (let j = 1; j < 5; j++) loud += moved(j);
    let quiet = 0;
    for (let j = 10; j < 15; j++) quiet += moved(j);
    // Hebbian learning already scales with activity; the bar is above what it
    // gives alone (measured 14.6x with the input coupling disabled).
    expect((loud / 4) / Math.max(1e-9, quiet / 5)).toBeGreaterThan(20);
  });

  it('stops itself, runs the stop command, and accounts for every neuron', () => {
    const engine = new HyperDimensionalEngine({
      neuronCount: 64, dimensions: 16, propagationSteps: 16,
      hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
      waveGain: 0.1, connectionBias: true,
    });
    const zip = new ZipLoopInterface(engine, { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 });
    const result = runUntilStopped(zip, { files: { 'prompt/prompt.txt': 'hi' } }, { quietTicks: 3, maxTicks: 200 });

    // It stopped because it settled, not because it ran out of budget.
    expect(result.reason).toBe('settled');
    expect(result.complete).toBe(true);
    expect(result.ticks).toBeLessThan(200);

    // And the command that runs on stopping looked at every neuron.
    expect(result.stopReport).toBeTruthy();
    expect(result.stopReport!.expectedNeurons).toBe(64);
    expect(result.stopReport!.statesFound).toBe(64);
    expect(result.stopReport!.finite).toBe(64);
    expect(result.stopReport!.allAccountedFor).toBe(true);
    expect(result.stopReport!.notes).toEqual([]);
  }, 60_000);
});
