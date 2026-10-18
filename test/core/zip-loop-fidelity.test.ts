/**
 * Zip Loop bit fidelity: do the bits that go in come out unchanged, and does
 * the loop refuse rather than alter what it cannot carry?
 *
 * This is TRANSMISSION, not understanding. A doorway that hands every bit over
 * perfectly shows nothing about whether the network makes sense of them; that
 * is measured elsewhere (zip-generalization.test.ts). What this pins down is
 * the part that has to be exact for anything else to mean something:
 *
 *   input side   the neurons driven, tick by tick, are a one-to-one encoding of
 *                the bits sent: decode them with a decoder written here from the
 *                spec and the original sequence comes back, for all-zero,
 *                all-one, alternating, random, and every length.
 *   output side  a sequence the network clocks out is read back exactly, on a
 *                dense mesh (mean energy 0.9, where the activity line used to be
 *                unreachable), repeatedly, and with noise up to half the margin.
 *                A tie between the two data neurons is not guessed at.
 *   refusals     empty input sends nothing and learns nothing; a value that is
 *                not a bit or not a byte is refused before any bit goes in.
 *   real mesh    on a seeded engine the same bits give the same state, and
 *                different bits give different states.
 */
import { describe, it, expect } from 'vitest';
import { HyperDimensionalEngine, ZipLoopInterface, ZIP_LOOP_DEFAULT_IDS, zipLoopIdsFor } from '../../models && skills/core/onebrain';

const SEND_IDS = ZIP_LOOP_DEFAULT_IDS;                       // bit0/1 in/out + send pair
const RAMP_IDS = { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3, toggleIn: 4, toggleOut: 5 };  // the live mesh

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randomBits = (n: number, seed: number): Array<0 | 1> => {
  const r = rng(seed);
  return Array.from({ length: n }, () => (r() < 0.5 ? 0 : 1));
};

/** Records every drive set, plays back scripted output energies. */
function fakeEngine(opts: { mean?: number; script?: Array<{ zero: number; one: number; send?: number; toggle?: number }>; toggleOutId?: number } = {}) {
  const driven: number[][] = [];
  let processCalls = 0;
  let tick = -1;
  const script = opts.script ?? [];
  const engine = {
    getDimensions: () => 4,
    getPropagationSteps: () => 8,
    setPropagationSteps: () => {},
    setWaveSignature: () => true,
    meanNeuronEnergy: () => opts.mean ?? 0.1,
    process: (_i: number[], _a: unknown, set: Set<number>) => {
      processCalls++;
      driven.push([...set].sort((x, y) => x - y));
      if (set.size === 0) tick++;
      return { settleIterations: 1 };
    },
    getNeuronEnergy: (id: number) => {
      const t = script[tick] ?? { zero: 0, one: 0, send: 0, toggle: 0 };
      if (id === opts.toggleOutId) return t.toggle ?? 0;
      if (id === SEND_IDS.bit0Out) return t.zero;
      if (id === SEND_IDS.bit1Out) return t.one;
      if (id === SEND_IDS.sendOut) return t.send ?? 0;
      return 0;
    },
    captureNetworkState: () => ({}),
  };
  return { engine: engine as never, driven, calls: () => processCalls };
}

/** Decode what a ramp-mode doorway drove, from the spec: one tick per bit, data neuron = value, ramp alternates max, min, ... */
function decodeRamp(driven: number[][]): Array<0 | 1> {
  return driven.map((set, k) => {
    const hasRamp = set.includes(RAMP_IDS.toggleIn);
    expect(hasRamp).toBe(k % 2 === 0);                         // the ramp level is the bit's place in the message
    const zero = set.includes(RAMP_IDS.bit0In), one = set.includes(RAMP_IDS.bit1In);
    expect(zero !== one).toBe(true);                           // exactly one data neuron, never both, never neither
    return one ? 1 : 0;
  });
}
/** Decode a send-pair doorway: setup tick (data), commit tick (data + send). A bit exists only where send fired. */
function decodeSend(driven: number[][]): Array<0 | 1> {
  const bits: Array<0 | 1> = [];
  for (let k = 0; k < driven.length; k++) {
    if (!driven[k].includes(SEND_IDS.sendIn as number)) continue;
    const one = driven[k].includes(SEND_IDS.bit1In), zero = driven[k].includes(SEND_IDS.bit0In);
    expect(one !== zero).toBe(true);
    bits.push(one ? 1 : 0);
  }
  return bits;
}

const SEQUENCES: Array<[string, Array<0 | 1>]> = [
  ['all zero', Array(40).fill(0)],
  ['all one', Array(40).fill(1)],
  ['alternating 0101', Array.from({ length: 40 }, (_, i) => (i % 2) as 0 | 1)],
  ['alternating 1010', Array.from({ length: 40 }, (_, i) => ((i + 1) % 2) as 0 | 1)],
  ['single 0', [0]],
  ['single 1', [1]],
  ['pairs 0011', Array.from({ length: 40 }, (_, i) => ((i >> 1) % 2) as 0 | 1)],
];

describe('input side: the neurons driven are a one-to-one encoding of the bits', () => {
  for (const [name, bits] of SEQUENCES) {
    it(`${name}: ramp (live) and send-pair doorways decode back to the bits sent`, () => {
      const ramp = fakeEngine();
      const z = new ZipLoopInterface(ramp.engine, RAMP_IDS);
      for (const b of bits) z.sendBit(b);
      expect(ramp.driven.length).toBe(bits.length);              // one tick per bit
      expect(decodeRamp(ramp.driven)).toEqual(bits);

      const send = fakeEngine();
      const s = new ZipLoopInterface(send.engine, SEND_IDS);
      for (const b of bits) s.sendBit(b);
      expect(decodeSend(send.driven)).toEqual(bits);
    });
  }

  for (const length of [1, 2, 7, 8, 9, 63, 64, 65, 255, 1024]) {
    it(`random ${length}-bit sequences (5 seeds) are recovered exactly`, () => {
      for (let seed = 1; seed <= 5; seed++) {
        const bits = randomBits(length, seed * 1000 + length);
        const e = fakeEngine();
        const z = new ZipLoopInterface(e.engine, RAMP_IDS);
        for (const b of bits) z.sendBit(b);
        expect(decodeRamp(e.driven)).toEqual(bits);
      }
    });
  }

  it('every byte value 0..255 goes in MSB first and decodes back to itself', () => {
    for (let v = 0; v < 256; v++) {
      const e = fakeEngine();
      new ZipLoopInterface(e.engine, RAMP_IDS).sendByte(v);
      const bits = decodeRamp(e.driven);
      expect(bits.length).toBe(8);
      expect(bits.reduce<number>((acc, b) => (acc << 1) | b, 0)).toBe(v);
    }
  });

  it('"0" and "00" and "000" are different inputs (the number of ticks differs)', () => {
    const lens = [1, 2, 3].map((n) => { const e = fakeEngine(); const z = new ZipLoopInterface(e.engine, RAMP_IDS); for (let i = 0; i < n; i++) z.sendBit(0); return e.driven.length; });
    expect(lens).toEqual([1, 2, 3]);
  });

  it('a second message starts again from the ramp at max, so repeating a message repeats the drive exactly', () => {
    const bits = randomBits(24, 7);
    const run = () => {
      const e = fakeEngine();
      const z = new ZipLoopInterface(e.engine, RAMP_IDS);
      for (const b of bits) z.sendBit(b);
      z.learnFromEvent();
      const first = e.driven.slice(0, bits.length);
      e.driven.length = 0;
      for (const b of bits) z.sendBit(b);
      return { first, second: e.driven.slice(0, bits.length) };
    };
    const { first, second } = run();
    expect(second).toEqual(first);
  });
});

describe('refusals: nothing is changed silently', () => {
  it('refuses a value that is not a bit', () => {
    for (const bad of [2, -1, 0.5, NaN, '1', null, undefined, true]) {
      const e = fakeEngine();
      expect(() => new ZipLoopInterface(e.engine, RAMP_IDS).sendBit(bad as never)).toThrow(RangeError);
      expect(e.calls()).toBe(0);                                  // and nothing was driven
    }
  });

  it('refuses a value that is not a byte (300 used to go in as 44, -1 as 255, NaN as 0)', () => {
    for (const bad of [256, 300, -1, 1.5, NaN, Infinity, '65', null, undefined]) {
      const e = fakeEngine();
      expect(() => new ZipLoopInterface(e.engine, RAMP_IDS).sendByte(bad as never)).toThrow(RangeError);
      expect(e.calls()).toBe(0);
    }
  });

  it('checks the whole message before the first bit goes in', () => {
    const e = fakeEngine();
    const z = new ZipLoopInterface(e.engine, RAMP_IDS);
    expect(() => z.sendBytes([1, 2, 3, 300])).toThrow(RangeError);
    expect(e.calls()).toBe(0);                                    // not even the first three bytes
  });

  it('empty input sends nothing and learns nothing, even after an earlier message', () => {
    const e = fakeEngine();
    const z = new ZipLoopInterface(e.engine, RAMP_IDS);
    z.sendBytes(new Uint8Array(0));
    expect(e.calls()).toBe(0);
    z.sendBytes(new Uint8Array([0xA5]));
    const after = e.calls();
    z.sendBytes(new Uint8Array(0));                                // used to re-drive the last bit and learn from it
    expect(e.calls()).toBe(after);
    expect(z.receiveBits(0)).toEqual([]);
  });

  it('accepts a plain array of bytes as well as a Uint8Array', () => {
    const a = fakeEngine(), b = fakeEngine();
    new ZipLoopInterface(a.engine, RAMP_IDS).sendBytes([1, 2, 255]);
    new ZipLoopInterface(b.engine, RAMP_IDS).sendBytes(new Uint8Array([1, 2, 255]));
    expect(a.driven).toEqual(b.driven);
  });
});

/** The energies a network that clocks out `bits` shows, on a mesh of the given mean energy. */
function ramped(bits: Array<0 | 1>, { hi, lo }: { hi: number; lo: number }) {
  return bits.map((b, k) => ({ zero: b ? lo : hi, one: b ? hi : lo, toggle: k % 2 === 0 ? 1 : 0 }));
}

describe('output side: a sequence the network clocks out is read back exactly', () => {
  for (const [name, bits] of SEQUENCES) {
    it(`${name} on a DENSE mesh (mean energy 0.9) in ramp mode`, () => {
      const { engine } = fakeEngine({ mean: 0.9, script: ramped(bits, { hi: 1, lo: 0.2 }), toggleOutId: RAMP_IDS.toggleOut });
      expect(new ZipLoopInterface(engine, RAMP_IDS).receiveBits(bits.length)).toEqual(bits);
    });
  }

  it('random sequences of many lengths, on sparse and dense meshes', () => {
    for (const mean of [0.05, 0.1, 0.5, 0.9]) {
      for (const length of [1, 3, 8, 9, 64, 200]) {
        const bits = randomBits(length, length * 31 + 5);
        const { engine } = fakeEngine({ mean, script: ramped(bits, { hi: 1, lo: 0.1 }), toggleOutId: RAMP_IDS.toggleOut });
        expect(new ZipLoopInterface(engine, RAMP_IDS).receiveBits(length)).toEqual(bits);
      }
    }
  });

  it('repeated transmission: reading the same scripted network again gives the same bits every time', () => {
    const bits = randomBits(64, 99);
    for (let r = 0; r < 5; r++) {
      const { engine } = fakeEngine({ mean: 0.9, script: ramped(bits, { hi: 1, lo: 0.3 }), toggleOutId: RAMP_IDS.toggleOut });
      expect(new ZipLoopInterface(engine, RAMP_IDS).receiveBits(64)).toEqual(bits);
    }
  });

  it('whole bytes come out as bytes, MSB first', () => {
    const message = [0x00, 0xFF, 0xA5, 0x5A, 0x01, 0x80];
    const bits = message.flatMap((v) => Array.from({ length: 8 }, (_, i) => ((v >> (7 - i)) & 1) as 0 | 1));
    const { engine } = fakeEngine({ mean: 0.9, script: ramped(bits, { hi: 1, lo: 0.2 }), toggleOutId: RAMP_IDS.toggleOut });
    const zip = new ZipLoopInterface(engine, RAMP_IDS);
    expect(Array.from(zip.receiveBytes(message.length))).toEqual(message);
  });

  it('noise up to half the margin never flips a bit', () => {
    const r = rng(2024);
    const bits = randomBits(400, 5);
    const gap = 0.8, noise = gap * 0.45;                           // data neurons differ by 0.8; wobble each by up to 0.36
    const script = bits.map((b, k) => ({
      zero: (b ? 0.2 : 1) + (r() * 2 - 1) * noise * 0.5,
      one: (b ? 1 : 0.2) + (r() * 2 - 1) * noise * 0.5,
      toggle: k % 2 === 0 ? 1 : 0,
    }));
    const { engine } = fakeEngine({ mean: 0.9, script, toggleOutId: RAMP_IDS.toggleOut });
    expect(new ZipLoopInterface(engine, RAMP_IDS).receiveBits(400)).toEqual(bits);
  });

  it('a collision (both data neurons equally strong) is not guessed: the read stops and says so', () => {
    const bits: Array<0 | 1> = [1, 0, 1, 1];
    const script = ramped(bits, { hi: 1, lo: 0.2 });
    script[2] = { zero: 0.7, one: 0.7, toggle: 1 };                  // the third bit is unreadable
    const { engine } = fakeEngine({ mean: 0.1, script, toggleOutId: RAMP_IDS.toggleOut });
    const zip = new ZipLoopInterface(engine, RAMP_IDS);
    const got = zip.receiveBits(4);
    expect(got).toEqual([1, 0]);                                     // what was readable, and nothing invented after it
    expect(zip.ambiguousReads()).toBe(1);
  });

  it('send-pair mode: same collision rule', () => {
    const script = [
      { zero: 0.2, one: 1, send: 0 }, { zero: 0.2, one: 1, send: 1 },   // bit 1
      { zero: 0.5, one: 0.5, send: 0 }, { zero: 0.5, one: 0.5, send: 1 }, // tie
    ];
    const { engine } = fakeEngine({ mean: 0.1, script });
    const zip = new ZipLoopInterface(engine, SEND_IDS);
    expect(zip.receiveBits(2)).toEqual([1]);
    expect(zip.ambiguousReads()).toBe(1);
  });
});

describe('real mesh: same bits, same state; different bits, different state', () => {
  const live = { dimensions: 8, neuronCount: 16, seed: 11, hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true, propagationSteps: 32 };
  const stateAfter = (bits: Array<0 | 1>, seed = 11, memory = true) => {
    const engine = new HyperDimensionalEngine({ ...live, seed });
    const zip = new ZipLoopInterface(engine, zipLoopIdsFor(engine), memory ? { memory: { vale: 0.97 } } : {});
    for (const b of bits) zip.sendBit(b);
    return Array.from(engine.getContextMatrix().data);
  };
  const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

  it('the engine honours its seed: two engines with one seed are identical, with another seed they differ', () => {
    expect(stateAfter([1, 0, 1, 1], 11)).toEqual(stateAfter([1, 0, 1, 1], 11));
    expect(dist(stateAfter([1, 0, 1, 1], 11), stateAfter([1, 0, 1, 1], 12))).toBeGreaterThan(1e-3);
  });

  it('repeated transmission lands on the same state every time', () => {
    const bits = randomBits(24, 3);
    const first = stateAfter(bits);
    for (let r = 0; r < 3; r++) expect(stateAfter(bits)).toEqual(first);
  });

  it('all-zero, all-one, alternating and random sequences leave four different states', () => {
    const named = SEQUENCES.slice(0, 3).map(([, b]) => b.slice(0, 24)).concat([randomBits(24, 8)]);
    const states = named.map((b) => stateAfter(b));
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) expect(dist(states[i], states[j])).toBeGreaterThan(1e-4);
    }
  });

  it('with the memory on, a different FIRST bit still shows in the state many bits later', () => {
    const tail = randomBits(20, 4);
    expect(dist(stateAfter([0, ...tail]), stateAfter([1, ...tail]))).toBeGreaterThan(1e-6);
  });
});
