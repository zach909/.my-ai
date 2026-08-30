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
import { HyperDimensionalEngine, ElasticCoreBlock, MIN_WAVE_FREQ, MAX_WAVE_FREQ } from '../../models && skills/core/onebrain';
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

const settingsFor = (config: Record<string, number | boolean>, reading?: { re: Float32Array; im: Float32Array }): EquationSettings => ({
  hyperGain: (config.hyperGain as number) ?? 0,
  hyperAdd: (config.hyperAdd as number) ?? 0,
  hyperScale: (config.hyperScale as number) ?? 0,
  hyperWaveGain: (config.hyperWaveGain as number) ?? 0,
  hyperWaveAdd: (config.hyperWaveAdd as number) ?? 0,
  waveGain: (config.waveGain as number) ?? 0,
  waveFeedback: (config.waveFeedback as number) ?? 0.5,
  // Handed the engine's own pair, not a copy made here: a reference
  // implementation given different constants proves nothing about the fast
  // one.
  waveReadRe: reading?.re ?? new Float32Array(0),
  waveReadIm: reading?.im ?? new Float32Array(0),
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
  const agree = (
    config: Record<string, number | boolean>,
    driven = new Set([0]),
    vale?: Map<number, number>,
  ) => {
    const engine = new HyperDimensionalEngine({
      neuronCount: 9,
      dimensions: 4,
      propagationSteps: 1,
      ...config,
    });
    // A few ticks first, so nothing is being compared at its initial values:
    // the waves have formed, the pool has content, the connections have moved.
    for (let t = 0; t < 3; t++) engine.process(new Array(4).fill(0.35), undefined, driven, vale);

    const before = readEngine(engine);
    const snapshot = engine.captureNetworkState();
    const input = [0.4, -0.2, 0.15, 0.6];
    // Live correction's own state travels too: it fires rarely, and a run
    // where it fired in the engine and not here disagreed by 0.14.
    if (vale) {
      const asArray = new Float32Array(before.neurons);
      for (const [id, v] of vale) asArray[id] = v;
      before.vale = asArray;
    }
    const plain = applyEquation(before, settingsFor(config, engine.getWaveReading()), input, driven, new Set(), {
      emaEnergy: snapshot.emaEnergy ?? 0,
      hasEma: snapshot.hasEma ?? false,
      sustainedDivergence: snapshot.sustainedDivergence ?? 0,
      influenceDecay: 0.95,
    });

    engine.process(input, undefined, driven, vale, { learn: false });
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

  it('agrees on vale -- how much each neuron holds still', () => {
    // The blend v*previous + (1-v)*computed. Every implementation of the
    // equation has it and the written-down one did not, which is exactly the
    // kind of omission this comparison exists to find.
    const vale = new Map([[1, 0.9], [2, 0.4], [3, 0.0], [5, 0.75]]);
    const d = agree({ hyperGain: 1, hyperAdd: 1, waveGain: 0.3 }, new Set([0]), vale);
    expect(d.states).toBeLessThan(1e-6);
    expect(d.waves).toBeLessThan(1e-6);
  });

  it('agrees about which neurons are driven', () => {
    const d = agree({ hyperGain: 1, waveGain: 0.3 }, new Set([2, 5]));
    expect(d.states).toBeLessThan(1e-6);
    expect(d.waves).toBeLessThan(1e-6);
  });
});

describe('the elastic core is the same equation', () => {
  /**
   * The elastic core keeps a whole block per connection -- every source
   * dimension reaching every receiving dimension -- where the engine keeps two
   * bands of that block. That is the only difference between them, and the
   * equation file says so in one place rather than the two files each having
   * their own arithmetic.
   *
   * So: run the elastic core one tick, run the written-down equation on the
   * same numbers in its block form, and require the same answer.
   */
  const SD = 4;
  const N = 5;

  /**
   * Give the core something to hold before comparing.
   *
   * A fresh ElasticCoreBlock starts at zero, and one tick from zero is
   * tanh(bias) whatever the weights are -- so the comparison passed even with
   * the connection term deliberately broken. Caught by mutating the equation
   * and watching nothing fail.
   */
  const warm = (core: ElasticCoreBlock) => {
    for (let t = 0; t < 3; t++) {
      core.forward(Float32Array.from({ length: SD }, (_, i) => 0.4 - i * 0.15), {
        drivenNeurons: new Set([0, 2]),
      });
    }
  };

  const stateOf = (core: ElasticCoreBlock): Float32Array => {
    // Dimension-major, the layout the equation takes.
    const states = new Float32Array(SD * N);
    for (let i = 0; i < N; i++) {
      const readout = core.checkDefinition(i).readout;
      for (let d = 0; d < SD; d++) states[d * N + i] = readout[d];
    }
    return states;
  };

  const blank = (n: number) => new Float32Array(n);

  const equationStateFor = (core: ElasticCoreBlock, vale?: Float32Array): EquationState => {
    const params = core.getParameters();
    return {
      neurons: N,
      dimensions: SD,
      states: stateOf(core),
      bias: Float32Array.from(params.biases),
      connDiag: blank(N * SD * N),
      connShift: blank(N * SD * N),
      connBias: blank(0),
      connBlock: Float32Array.from(params.weights),
      vale,
      modWeight: blank(N * N),
      addWeight: blank(N * N),
      senderGain: new Float32Array(N).fill(1),
      connWaveGain: blank(N * N),
      connWavePhase: blank(N * N),
      connWaveBias: blank(N * N),
      connWaveBiasIm: blank(N * N),
      connWaveShift: blank(N * N),
      modWaveWeight: blank(N * N),
      addWaveWeight: blank(N * N),
      neuronWaveBiasRe: blank(N),
      neuronWaveBiasIm: blank(N),
      waveFreq: blank(N),
      wavePhase: blank(N),
      waveRe: blank(N),
      waveIm: blank(N),
      poolRe: blank(64),
      poolIm: blank(64),
    };
  };

  const settings: EquationSettings = {
    hyperGain: 0, hyperAdd: 0, hyperScale: 0,
    hyperWaveGain: 0, hyperWaveAdd: 0,
    waveGain: 0, waveFeedback: 0,
    waveReadRe: new Float32Array(8), waveReadIm: new Float32Array(8),
    crossInfluenceStrength: 0,
    connectionBias: false,
    minWaveFreq: MIN_WAVE_FREQ, maxWaveFreq: MAX_WAVE_FREQ, waveBins: 64, poolCeiling: 8,
    // Live correction is the engine's; the elastic core has none, so it must
    // never fire here.
    divergenceTolerance: Number.POSITIVE_INFINITY, sustainedDivergenceTicks: 1_000_000,
    // The elastic core wipes the input flag before every tick; the engine
    // computes that dimension. The only difference between them.
    clearInputFlagFirst: true,
  };

  const worst = (a: Float32Array, b: Float32Array) =>
    a.reduce((max, v, i) => Math.max(max, Math.abs(v - b[i])), 0);

  it('computes what the equation file says, block form and all', () => {
    const core = new ElasticCoreBlock({
      neuronCount: N, stateDim: SD, inputDim: SD, outputDim: SD,
      maxTicks: 1, convergenceThreshold: 0, seed: 17,
    });
    warm(core);
    const before = equationStateFor(core);
    // No driven neurons: the elastic core projects an input through its own
    // input projection when it has one, which is a different thing from the
    // equation and not what is being compared here. This compares the update.
    const plain = applyEquation(before, settings, [], new Set());
    core.forward(new Float32Array(SD), { drivenNeurons: new Set() });
    expect(worst(stateOf(core), plain.states)).toBeLessThan(1e-6);
  });

  it('agrees on vale, the same blend the engine uses', () => {
    const core = new ElasticCoreBlock({
      neuronCount: N, stateDim: SD, inputDim: SD, outputDim: SD,
      maxTicks: 1, convergenceThreshold: 0, seed: 23,
    });
    const vale = new Map([[0, 0.9], [2, 0.5], [4, 0.25]]);
    const asArray = new Float32Array(N);
    for (const [id, v] of vale) asArray[id] = v;

    warm(core);
    const before = equationStateFor(core, asArray);
    const plain = applyEquation(before, settings, [], new Set());
    core.forward(new Float32Array(SD), { drivenNeurons: new Set(), vale });
    expect(worst(stateOf(core), plain.states)).toBeLessThan(1e-6);
  });

  it('agrees on a held group, which both call holding still', () => {
    const core = new ElasticCoreBlock({
      neuronCount: N, stateDim: SD, inputDim: SD, outputDim: SD,
      maxTicks: 1, convergenceThreshold: 0, seed: 31,
    });
    core.setNeuronGroup(3, 'weather');
    core.setNeuronGroup(4, 'tides');
    warm(core);

    const before = equationStateFor(core);
    const plain = applyEquation(before, settings, [], new Set(), new Set([4]));
    core.forward(new Float32Array(SD), {
      drivenNeurons: new Set(),
      activeGroups: new Set(['weather']),
    });
    expect(worst(stateOf(core), plain.states)).toBeLessThan(1e-6);
  });
});
