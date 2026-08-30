/**
 * Does the agent that actually runs compute the equation?
 *
 * Every part of the hyperdimensional structure defaults to inert in the engine
 * -- deliberately, so that adding it could not silently change the arithmetic
 * of every existing caller at once. The cost of that caution was that nothing
 * ever turned it on: the network's weight and bias in every connection, the
 * wave copy of each, the shared pool, all of it existed, was tested, and was
 * not what the running agent computed. Real, tested, and unreachable.
 *
 * So this tests the live pipeline rather than an engine built by a test, and
 * it tests what the engine DOES rather than what it was configured with -- a
 * config getter would pass just as happily on a network that ignored its own
 * settings.
 */
import { describe, it, expect } from 'vitest';
import { NeuroPipeline } from '../../models && skills/core/pipeline';

describe('the live pipeline runs the whole equation', () => {
  const settings = { embeddingDim: 32, hiddenDim: 32, meshNodes: 16, hyperDimensions: 16 };

  const decode = (b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
  };

  const ran = async () => {
    const pipeline = new NeuroPipeline(settings);
    const embedding = new Float32Array(32);
    for (let i = 0; i < 32; i++) embedding[i] = Math.sin(i * 0.7) * 0.4;
    await pipeline.run(embedding, 'the wave of a neuron is made of the waves that reach it');
    const engine = pipeline.getHyperEngine();
    expect(engine, 'the pipeline ran without building its own brain').not.toBeNull();
    return { pipeline, engine: engine! };
  };

  it('has neurons that compute rather than neurons clamped to the input', async () => {
    // The regression this exists to catch, and it was silently true: the
    // engine's default input layer was EVERY neuron. A driven neuron is
    // written straight from the input vector and never computes -- no
    // connections, no bias, no network term, no wave -- so with all of them
    // driven, none of them computed anything. Measured on the live pipeline
    // before this was fixed: 64 neurons and one distinct state between them,
    // the whole structure skipped on every tick.
    const { engine } = await ran();
    const snapshot = engine.captureNetworkState();
    const states = decode(snapshot.states);
    const distinct = new Set(states.map(v => v.toFixed(6))).size;
    // Not "a few different values" -- most of them different. Anything near 1
    // means the mesh is echoing one number back at itself.
    expect(distinct).toBeGreaterThan(states.length / 2);
  });

  it('answers differently when it is told something different', async () => {
    // The end of the same thread: a network whose neurons are clamped to the
    // input produces the input, which looks like working right up until you
    // ask whether the answer depends on the question.
    const statesFor = async (seed: (i: number) => number, text: string) => {
      const pipeline = new NeuroPipeline(settings);
      const embedding = new Float32Array(32);
      for (let i = 0; i < 32; i++) embedding[i] = seed(i);
      await pipeline.run(embedding, text);
      return decode(pipeline.getHyperEngine()!.captureNetworkState().states);
    };

    const one = await statesFor(i => Math.sin(i * 0.7) * 0.4, 'the wave of a neuron');
    const other = await statesFor(i => Math.cos(i * 0.13) * -0.4, 'something else entirely');
    const difference = one.reduce((sum, v, i) => sum + Math.abs(v - other[i]), 0);
    const size = one.reduce((sum, v) => sum + Math.abs(v), 0);
    // The difference is the same order as the signal itself, not a rounding
    // error on top of two identical answers.
    expect(difference).toBeGreaterThan(size * 0.1);
  });

  it('gives every connection a bias of its own, not one shared per neuron', async () => {
    const { engine } = await ran();
    const connBias = engine.captureNetworkState().connBias;
    // Empty string is what a network without per-connection biases saves.
    expect(typeof connBias).toBe('string');
    expect(connBias.length).toBeGreaterThan(0);
  });

  it('has waves in the pool, not an empty one', async () => {
    const { engine } = await ran();
    // Something is in the shared pool: the wave layer is running, not sitting
    // at a gain of zero where every neuron is deaf to every other's wave.
    expect(engine.poolContent().length).toBeGreaterThan(0);
  });

  it('moves the network variables every neuron carries', async () => {
    const { pipeline, engine } = await ran();
    const before = engine.captureNetworkState();
    const embedding = new Float32Array(32);
    for (let i = 0; i < 32; i++) embedding[i] = Math.cos(i * 0.4) * 0.4;
    // Ten, not three. The bias variable learns from how far a neuron sits from
    // the network's own level, which is a genuinely smaller signal than the
    // weight variable's -- measured at about a fortieth of it on the first
    // tick, and comparable after a handful. Three runs moved the weight
    // variables and left the bias ones unchanged in Float32, which reads as
    // "dead" and is only "slower".
    for (let i = 0; i < 10; i++) await pipeline.run(embedding, 'again, with something else to say');
    const after = engine.captureNetworkState();

    // The variables the network's own weight and bias are made of.
    expect(after.modWeight).not.toBe(before.modWeight);
    expect(after.addWeight).not.toBe(before.addWeight);
    // And their wave copies.
    expect(after.connWaveGain).not.toBe(before.connWaveGain);
    // Still finite after all of it, which is the thing a live network has to
    // stay whatever else is true of it.
    expect(decode(after.modWeight).every(Number.isFinite)).toBe(true);
    expect(decode(after.connWaveGain).every(Number.isFinite)).toBe(true);
  });
});
