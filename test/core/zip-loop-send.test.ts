/**
 * The Zip Loop's send neuron, on both sides.
 *
 * A data neuron alone cannot say how many bits it means: bit0 held for three
 * ticks could be "0", "00" or "000". Send alternates -- off while a bit is set
 * up, fully on to commit it -- so a bit exists only where send fired.
 */
import { describe, it, expect } from 'vitest';
import { ZipLoopInterface, ZIP_LOOP_DEFAULT_IDS, zipLoopIdsFor } from '../../models && skills/core/onebrain';

const IDS = ZIP_LOOP_DEFAULT_IDS;
const TOGGLE = { ...IDS, toggleIn: 6, toggleOut: 7 };
/** The live ids: a ramp in place of send, one tick per bit. */
const RAMP = { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3, toggleIn: 4, toggleOut: 5 };

/**
 * Just enough of HyperDimensionalEngine for the Zip Loop: records which
 * neurons each tick drove, and plays back scripted output energies.
 */
function fakeEngine(outputScript: Array<{ zero: number; one: number; send: number; toggle?: number }> = [], toggleOutId = TOGGLE.toggleOut) {
  const driven: number[][] = [];
  let tick = -1;
  const engine = {
    getDimensions: () => 4,
    getPropagationSteps: () => 8,
    setPropagationSteps: () => {},
    setWaveSignature: () => true,
    meanNeuronEnergy: () => 0.1,
    process: (_input: number[], _a: unknown, set: Set<number>) => {
      driven.push([...set].sort((a, b) => a - b));
      if (set.size === 0) tick++;
      return { settleIterations: 1 };
    },
    getNeuronEnergy: (id: number) => {
      const t = outputScript[tick] ?? { zero: 0, one: 0, send: 0 };
      if (id === toggleOutId) return t.toggle ?? 0;
      if (id === IDS.bit0Out) return t.zero;
      if (id === IDS.bit1Out) return t.one;
      if (id === IDS.sendOut) return t.send;
      return 0;
    },
    captureNetworkState: () => ({}),
  };
  return { engine: engine as never, driven };
}

const ON = 1; // well above the active line (mean 0.1 x 1.5)
const OFF = 0;

describe('Zip Loop input: data, then data + send', () => {
  it('sends every bit as a setup tick and a commit tick', () => {
    const { engine, driven } = fakeEngine();
    const zip = new ZipLoopInterface(engine, IDS);
    zip.sendBit(0);
    zip.sendBit(0);
    zip.sendBit(1);
    expect(driven).toEqual([
      [IDS.bit0In], [IDS.bit0In, IDS.sendIn],
      [IDS.bit0In], [IDS.bit0In, IDS.sendIn],
      [IDS.bit1In], [IDS.bit1In, IDS.sendIn],
    ]);
  });

  it('"0" and "00" are different inputs: one send versus two', () => {
    const one = fakeEngine(); new ZipLoopInterface(one.engine, IDS).sendBit(0);
    const two = fakeEngine(); const z = new ZipLoopInterface(two.engine, IDS); z.sendBit(0); z.sendBit(0);
    const sends = (d: number[][]) => d.filter((s) => s.includes(IDS.sendIn)).length;
    expect(sends(one.driven)).toBe(1);
    expect(sends(two.driven)).toBe(2);
  });
});

describe('Zip Loop output: a bit only when send turns on', () => {
  it('reads repeated zeros as separate bits, one per send', () => {
    const { engine } = fakeEngine([
      { zero: ON, one: OFF, send: OFF },
      { zero: ON, one: OFF, send: ON },  // bit 0
      { zero: ON, one: OFF, send: OFF },
      { zero: ON, one: OFF, send: ON },  // bit 0
    ]);
    expect(new ZipLoopInterface(engine, IDS).receiveBits(2)).toEqual([0, 0]);
  });

  it('holding send on does not repeat the bit', () => {
    const { engine } = fakeEngine([
      { zero: OFF, one: ON, send: ON },  // bit 1
      { zero: OFF, one: ON, send: ON },  // still on: not a new bit
      { zero: OFF, one: ON, send: ON },
      { zero: OFF, one: ON, send: ON },
    ]);
    expect(new ZipLoopInterface(engine, IDS).receiveBits(2)).toEqual([1]);
  });

  it('a network that never fires send has said nothing', () => {
    const { engine } = fakeEngine(Array(40).fill({ zero: ON, one: OFF, send: OFF }));
    const zip = new ZipLoopInterface(engine, IDS);
    expect(zip.receiveBits(4)).toEqual([]);
    expect(zip.nextOutputByte()).toBeNull();
  });

  it('assembles a byte from eight sent bits, MSB first', () => {
    const bits = [1, 0, 1, 1, 0, 0, 1, 1];
    const script = bits.flatMap((b) => [
      { zero: b ? OFF : ON, one: b ? ON : OFF, send: OFF },
      { zero: b ? OFF : ON, one: b ? ON : OFF, send: ON },
    ]);
    expect(new ZipLoopInterface(fakeEngine(script).engine, IDS).nextOutputByte()).toBe(0b10110011);
  });

  it('a byte cut short (send stops part way) ends the message', () => {
    const script = [0, 1, 0].flatMap((b) => [
      { zero: b ? OFF : ON, one: b ? ON : OFF, send: OFF },
      { zero: b ? OFF : ON, one: b ? ON : OFF, send: ON },
    ]);
    expect(new ZipLoopInterface(fakeEngine(script).engine, IDS).nextOutputByte()).toBeNull();
  });
});

describe('Zip Loop toggle neuron: flips every bit', () => {
  it('drives the toggle on alternate bits, so "00" differs from "0" by more than a count', () => {
    const { engine, driven } = fakeEngine();
    const zip = new ZipLoopInterface(engine, TOGGLE);
    zip.sendBit(0);
    zip.sendBit(0);
    zip.sendBit(0);
    const T = TOGGLE.toggleIn;
    expect(driven).toEqual([
      [IDS.bit0In], [IDS.bit0In, IDS.sendIn],
      [IDS.bit0In, T], [IDS.bit0In, IDS.sendIn, T],
      [IDS.bit0In], [IDS.bit0In, IDS.sendIn],
    ]);
  });

  it('starts every message from low again', () => {
    const { engine, driven } = fakeEngine();
    const zip = new ZipLoopInterface(engine, TOGGLE);
    zip.sendBit(1);
    zip.learnFromEvent();
    driven.length = 0;
    zip.sendBit(1);
    expect(driven[0]).toEqual([IDS.bit1In]);
  });

  it('reads two equal bits as two when send stays held on but the toggle flips', () => {
    const { engine } = fakeEngine([
      { zero: ON, one: OFF, send: ON, toggle: OFF },
      { zero: ON, one: OFF, send: ON, toggle: ON },
      { zero: ON, one: OFF, send: ON, toggle: ON },
      { zero: ON, one: OFF, send: ON, toggle: OFF },
    ]);
    expect(new ZipLoopInterface(engine, TOGGLE).receiveBits(3)).toEqual([0, 0, 0]);
  });

  it('does not double-count a bit whose toggle flips on the tick before send', () => {
    const { engine } = fakeEngine([
      { zero: ON, one: OFF, send: OFF, toggle: ON },
      { zero: ON, one: OFF, send: ON, toggle: ON },
    ]);
    expect(new ZipLoopInterface(engine, TOGGLE).receiveBits(2)).toEqual([0]);
  });

  it('refuses half a toggle pair, and is unchanged without one', () => {
    const { engine } = fakeEngine();
    expect(() => new ZipLoopInterface(engine, { ...IDS, toggleIn: 6 })).toThrow();
    const plain = fakeEngine();
    new ZipLoopInterface(plain.engine, IDS).sendBit(0);
    expect(plain.driven).toEqual([[IDS.bit0In], [IDS.bit0In, IDS.sendIn]]);
  });
});

describe('Zip Loop ramp: max to min, one tick per bit, replacing send', () => {
  const rampEngine = (script: Array<{ zero: number; one: number; send: number; toggle?: number }> = []) =>
    fakeEngine(script, RAMP.toggleOut);

  it('sends each bit in a single tick, the ramp at max on even bits and min on odd', () => {
    const { engine, driven } = rampEngine();
    const zip = new ZipLoopInterface(engine, RAMP);
    zip.sendBit(0);
    zip.sendBit(0);
    zip.sendBit(1);
    expect(driven).toEqual([
      [RAMP.bit0In, RAMP.toggleIn],
      [RAMP.bit0In],
      [RAMP.bit1In, RAMP.toggleIn],
    ]);
  });

  it('never drives a send neuron, and "0" and "00" differ by their flips', () => {
    const one = rampEngine(); new ZipLoopInterface(one.engine, RAMP).sendBit(0);
    const two = rampEngine(); const z = new ZipLoopInterface(two.engine, RAMP); z.sendBit(0); z.sendBit(0);
    expect(one.driven.length).toBe(1);
    expect(two.driven.length).toBe(2);
    expect(two.driven[0]).not.toEqual(two.driven[1]);
  });

  it('starts every message at max again', () => {
    const { engine, driven } = rampEngine();
    const zip = new ZipLoopInterface(engine, RAMP);
    zip.sendBit(1);
    zip.learnFromEvent();
    driven.length = 0;
    zip.sendBit(1);
    expect(driven[0]).toEqual([RAMP.bit1In, RAMP.toggleIn]);
  });

  it('reads one bit per flip of the ramp, including repeated zeros', () => {
    const { engine } = rampEngine([
      { zero: ON, one: OFF, send: OFF, toggle: ON },   // max: bit 0
      { zero: ON, one: OFF, send: OFF, toggle: OFF },  // min: bit 0
      { zero: OFF, one: ON, send: OFF, toggle: ON },   // max: bit 1
    ]);
    expect(new ZipLoopInterface(engine, RAMP).receiveBits(3)).toEqual([0, 0, 1]);
  });

  it('a ramp that stops flipping means the network stopped sending', () => {
    const { engine } = rampEngine(Array(40).fill({ zero: ON, one: OFF, send: OFF, toggle: ON }));
    const zip = new ZipLoopInterface(engine, RAMP);
    // one flip (rest -> max) gives a first bit, then it holds: nothing more.
    expect(zip.receiveBits(4)).toEqual([0]);
    expect(zip.nextOutputByte()).toBeNull();
  });

  it('assembles a byte from eight flips, MSB first', () => {
    const bits = [1, 0, 1, 1, 0, 0, 1, 1];
    const script = bits.map((b, k) => ({ zero: b ? OFF : ON, one: b ? ON : OFF, send: OFF, toggle: k % 2 === 0 ? ON : OFF }));
    expect(new ZipLoopInterface(rampEngine(script).engine, RAMP).nextOutputByte()).toBe(0b10110011);
  });

  it('needs a send pair or a ramp pair to clock its bits', () => {
    const { engine } = rampEngine();
    expect(() => new ZipLoopInterface(engine, { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 })).toThrow();
    expect(() => new ZipLoopInterface(engine, { ...IDS, sendOut: undefined })).toThrow();
  });
});

describe('the live mesh uses the ramp in place of send', () => {
  it('gives neurons 4 and 5 to the ramp and none to send', () => {
    expect(zipLoopIdsFor({ getNeuronCount: () => 64 })).toEqual(RAMP);
  });
});
