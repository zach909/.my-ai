/**
 * The fast path IS the equation.
 *
 * HyperDimensionalEngine.settle() computes the equation with flat typed
 * arrays, hoisted rows, an unrolled inner loop and folded terms, because it
 * runs on every tick of the agent. equation.ts computes the same thing one
 * neuron and one term at a time, named after what each term is.
 *
 * Two implementations of one equation is how an equation quietly stops being
 * the equation -- unless something checks. This is that something: same
 * network, same input, same answer.
 */
import { describe, it, expect } from 'vitest';
import { HyperDimensionalEngine, MIN_WAVE_FREQ, MAX_WAVE_FREQ } from '../../models && skills/core/onebrain';
import { applyEquation, type EquationState, type EquationSettings } from '../../models && skills/core/equation';

const decode = (b64: string) => {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

/** Read a running engine into the plain form the equation takes. */
function readEngine(engine: HyperDimensionalEngine): EquationState {
  const s = engine.captureNetworkState();
  return {
    neurons: s.shape.neurons,
    dimensions: s.shape.dimensions + 1,
    states: decode(s.states),
    bias: decode(s.bias),
    connDiag: decode(s.connDiag),
    connShift: decode(s.connShift),
    connBias: s.connBias ? decode(s.connBias) : new Float32Array(0),
    modWeight: decode(s.modWeight),
    addWeight: decode(s.addWeight),
    senderGain: decode(s.senderGain as string),
    connWaveGain: decode(s.connWaveGain),
    connWavePhase: decode(s.connWavePhase),
    connWaveBias: decode(s.connWaveBias),
    connWaveBiasIm: decode(s.connWaveBiasIm as string),
    connWaveShift: decode(s.connWaveShift),
    modWaveWeight: decode(s.modWaveWeight),
    addWaveWeight: decode(s.addWaveWeight),
    neuronWaveBiasRe: decode(s.neuronWaveBiasRe),
    neuronWaveBiasIm: decode(s.neuronWaveBiasIm),
    waveFreq: decode(s.waveFreq),
    wavePhase: decode(s.wavePhase),
    waveRe: decode(s.neuronWaveRe as string),
    waveIm: decode(s.neuronWaveIm as string),
    poolRe: decode(s.wavePoolRe as string),
    poolIm: decode(s.wavePoolIm as string),
  };
}

const settingsFor = (config: Record<string, number | boolean>): EquationSettings => ({
  hyperGain: (config.hyperGain as number) ?? 0,
  hyperAdd: (config.hyperAdd as number) ?? 0,
  hyperScale: (config.hyperScale as number) ?? 0,
  hyperWaveGain: (config.hyperWaveGain as number) ?? 0,
  hyperWaveAdd: (config.hyperWaveAdd as number) ?? 0,
  waveGain: (config.waveGain as number) ?? 0,
  waveFeedback: (config.waveFeedback as number) ?? 0.5,
  crossInfluenceStrength: (config.crossInfluenceStrength as number) ?? 0.3,
  connectionBias: (config.connectionBias as boolean) ?? false,
  minWaveFreq: MIN_WAVE_FREQ,
  maxWaveFreq: MAX_WAVE_FREQ,
  waveBins: 64,
  poolCeiling: 8,
  divergenceTolerance: (config.divergenceTolerance as number) ?? 0.05,
  sustainedDivergenceTicks: (config.sustainedDivergenceTicks as number) ?? 3,
});

describe('one equation, two implementations, one answer', () => {
  /**
   * Run both on the same network for one settle iteration and compare.
   * propagationSteps is 1 so this compares ONE application of the equation
   * rather than a settled fixed point, where a difference could hide.
   */
  const agree = (config: Record<string, number | boolean>, driven = new Set([0])) => {
    const engine = new HyperDimensionalEngine({
      neuronCount: 9,
      dimensions: 4,
      propagationSteps: 1,
      ...config,
    });
    // A few ticks first, so nothing is being compared at its initial values:
    // the waves have formed, the pool has content, the connections have moved.
    for (let t = 0; t < 3; t++) engine.process(new Array(4).fill(0.35), undefined, driven);

    const before = readEngine(engine);
    const snapshot = engine.captureNetworkState();
    const input = [0.4, -0.2, 0.15, 0.6];
    // Live correction's own state travels too: it fires rarely, and a run
    // where it fired in the engine and not here disagreed by 0.14.
    const plain = applyEquation(before, settingsFor(config), input, driven, new Set(), {
      emaEnergy: snapshot.emaEnergy ?? 0,
      hasEma: snapshot.hasEma ?? false,
      sustainedDivergence: snapshot.sustainedDivergence ?? 0,
      influenceDecay: 0.95,
    });

    engine.process(input, undefined, driven, undefined, { learn: false });
    const after = readEngine(engine);

    const worst = (a: Float32Array, b: Float32Array) =>
      a.reduce((max, v, i) => Math.max(max, Math.abs(v - b[i])), 0);
    return {
      states: worst(after.states, plain.states),
      waves: Math.max(worst(after.waveRe, plain.waveRe), worst(after.waveIm, plain.waveIm)),
      pool: Math.max(worst(after.poolRe, plain.poolRe), worst(after.poolIm, plain.poolIm)),
    };
  };

  it('agrees with nothing turned on', () => {
    const d = agree({});
    expect(d.states).toBeLessThan(1e-6);
  });

  it('agrees on the network weight added to every connection', () => {
    expect(agree({ hyperGain: 1 }).states).toBeLessThan(1e-6);
  });

  it('agrees on the network bias added to every connection', () => {
    expect(agree({ hyperAdd: 1 }).states).toBeLessThan(1e-6);
  });

  it('agrees on the network scaling every connection', () => {
    expect(agree({ hyperScale: 1 }).states).toBeLessThan(1e-6);
  });

  it('agrees on a bias for every connection', () => {
    expect(agree({ connectionBias: true, hyperGain: 1, hyperAdd: 1 }).states).toBeLessThan(1e-6);
  });

  it('agrees on the wave: what each neuron hears, carries, and puts in the pool', () => {
    const d = agree({ waveGain: 0.3, waveFeedback: 0.5 });
    expect(d.states).toBeLessThan(1e-6);
    expect(d.waves).toBeLessThan(1e-6);
    expect(d.pool).toBeLessThan(1e-6);
  });

  it('agrees on the wave copies of the network weight and bias', () => {
    const d = agree({ waveGain: 0.3, waveFeedback: 0.5, hyperWaveGain: 1, hyperWaveAdd: 1 });
    expect(d.states).toBeLessThan(1e-6);
    expect(d.waves).toBeLessThan(1e-6);
    expect(d.pool).toBeLessThan(1e-6);
  });

  it('agrees with every term of the equation turned on at once', () => {
    // The configuration the live agent runs, and then some: numbers and waves,
    // connection and network, scaled and added, a bias on every connection.
    const d = agree({
      hyperGain: 1,
      hyperAdd: 1,
      hyperScale: 1,
      hyperWaveGain: 1,
      hyperWaveAdd: 1,
      waveGain: 0.3,
      waveFeedback: 0.5,
      connectionBias: true,
    });
    expect(d.states).toBeLessThan(1e-6);
    expect(d.waves).toBeLessThan(1e-6);
    expect(d.pool).toBeLessThan(1e-6);
  });

  it('agrees about which neurons are driven', () => {
    const d = agree({ hyperGain: 1, waveGain: 0.3 }, new Set([2, 5]));
    expect(d.states).toBeLessThan(1e-6);
    expect(d.waves).toBeLessThan(1e-6);
  });
});
