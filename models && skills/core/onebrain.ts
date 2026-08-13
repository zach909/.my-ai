/**
 * OneBrain — the NeuroClaw engine's pure computation, in one file.
 *
 * Quantization math (dynamic/static, symmetric/asymmetric/mixed, real
 * bit-packing), the elastic zero-sum value budget, the all-to-all neuron
 * mesh (and its extension-builder-editable variant), the Mixture-of-Experts
 * router, hyperdimensional multi-ball neuron state, and the
 * quantum-interference neural net all live here as one file. quantizer.ts,
 * value-range.ts, mesh.ts, elastic-core.ts, hyperdimensional.ts,
 * quantum-net.ts, moe-router.ts, dual.ts, and complex.ts are now thin
 * `export * from './onebrain.js'` re-export shims, so every existing import
 * path keeps working unchanged.
 *
 * Deliberately NOT folded in here: quantization-config.ts,
 * quantization-hardware.ts, quantization-scheduler.ts, zip-io.ts, and
 * zip-io-loop.ts. Those five touch real Node built-ins (`node:fs`,
 * `node:os`, `zlib`, `node:path`, `node:crypto`) for config-file loading,
 * OS hardware detection, and disk persistence — genuinely server-only I/O,
 * not engine compute. They stayed merged in an earlier version of this
 * file, which broke client-side bundling: `src/features/builder/use-builder.ts`
 * (a React hook, running in the browser) imports `ExtensionBuilder` from
 * `extension-builder/builder.js`, which imports `BackgroundQuantizer` from
 * `quantizer.js` — and because `quantizer.js` re-exported everything from
 * this one file, that one import dragged `node:fs`/`node:os`/`zlib` into
 * the browser bundle too, crashing the /builder page at runtime ("Module
 * 'node:fs' has been externalized for browser compatibility"). Keeping
 * this file free of Node built-ins is what keeps it safe to import from
 * client code — don't merge those five back in without re-checking that.
 *
 * Sections are separated below by file-name banners for orientation; nothing
 * about the runtime behavior changed in the merge — see wiki/Quantization.md,
 * wiki/Elastic-Value-Budget.md, wiki/Neuron-Mesh.md, wiki/MoE.md,
 * wiki/Hyperdimensional.md, wiki/Zip-IO.md, and wiki/Quantum-Net.md for what
 * each section does.
 */


// ============================================================================
// complex.ts
// ============================================================================

// Section 13: complex numbers as a genuine division algebra (Hurwitz size 2).
// Phase-and-amplitude together is exactly one complex number, so the quantum
// interference layer stores/combines its state as complex values rather than a
// pair of disconnected real scalars driven by ad-hoc trigonometry.
//
// A complex number a + b·i with i² = -1. Every nonzero element has a unique
// inverse (it is a division algebra), which is what makes interference,
// rotation, and normalization behave correctly.

export interface Complex {
  re: number;
  im: number;
}

export const complex = (re: number, im: number = 0): Complex => ({ re, im });

/** Polar form: magnitude·e^{iθ} = magnitude·(cosθ + i·sinθ). */
export const fromPolar = (magnitude: number, phase: number): Complex => ({
  re: magnitude * Math.cos(phase),
  im: magnitude * Math.sin(phase),
});

export const complexAdd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const complexSub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });

/** (a+bi)(c+di) = (ac - bd) + (ad + bc)i — the i² = -1 rule. */
export const complexMul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export const complexScale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k });

/** Complex conjugate a - bi. */
export const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im });

/** Magnitude |a+bi| = sqrt(a² + b²). */
export const abs = (a: Complex): number => Math.hypot(a.re, a.im);

/** Squared magnitude (Born-rule probability weight, no sqrt). */
export const absSq = (a: Complex): number => a.re * a.re + a.im * a.im;

/** Argument (phase angle) in (-π, π]. */
export const arg = (a: Complex): number => Math.atan2(a.im, a.re);

/**
 * Multiplicative inverse 1/z = conj(z)/|z|². Defined for every nonzero z —
 * the division-algebra guarantee. Throws on zero.
 */
export const inv = (a: Complex): Complex => {
  const d = absSq(a);
  if (d === 0) throw new Error('complex inverse of zero');
  return { re: a.re / d, im: -a.im / d };
};

export const complexDiv = (a: Complex, b: Complex): Complex => complexMul(a, inv(b));

/** The imaginary unit i, with i·i = -1. */
export const I: Complex = { re: 0, im: 1 };

// ============================================================================
// dual.ts
// ============================================================================

// Section 13: dual numbers for live correction (section 12).
//
// A dual number is a + b·ε with ε² = 0. Carrying the derivative alongside the
// value means one forward evaluation yields both f(x) and f'(x) — forward-mode
// automatic differentiation. For live correction the self-model can then report
// not just its predicted value but its instantaneous rate of change in the same
// pass, so drift can be caught from the trend, not only the level.
//
// Dual numbers are NOT a division algebra (ε has no inverse), which is fine:
// they are used here as an autodiff carrier, not for interference/rotation.

export interface Dual {
  /** Primal value f(x). */
  val: number;
  /** Derivative f'(x) carried in the ε component. */
  der: number;
}

export const dual = (val: number, der: number = 0): Dual => ({ val, der });

/** A variable to differentiate with respect to: value x, derivative 1. */
export const variable = (x: number): Dual => ({ val: x, der: 1 });

/** A constant: derivative 0. */
export const constant = (x: number): Dual => ({ val: x, der: 0 });

export const dualAdd = (a: Dual, b: Dual): Dual => ({ val: a.val + b.val, der: a.der + b.der });
export const dualSub = (a: Dual, b: Dual): Dual => ({ val: a.val - b.val, der: a.der - b.der });

/** Product rule: (a + a'ε)(b + b'ε) = ab + (a'b + ab')ε  (the ε² term vanishes). */
export const dualMul = (a: Dual, b: Dual): Dual => ({
  val: a.val * b.val,
  der: a.der * b.val + a.val * b.der,
});

export const dualScale = (a: Dual, k: number): Dual => ({ val: a.val * k, der: a.der * k });

/** tanh with its derivative 1 - tanh² carried through — the mesh's activation. */
export const tanh = (a: Dual): Dual => {
  const t = Math.tanh(a.val);
  return { val: t, der: (1 - t * t) * a.der };
};

/** Quotient rule. */
export const dualDiv = (a: Dual, b: Dual): Dual => ({
  val: a.val / b.val,
  der: (a.der * b.val - a.val * b.der) / (b.val * b.val),
});

// ============================================================================
// quantizer.ts
// ============================================================================

// Background Quantization — core primitives.
//
// Two independent axes:
//  - MODE:   dynamic (scale computed fresh from the tensor at hand, no
//            calibration needed) vs static (scale computed once from
//            calibration data, then reused verbatim on every later call —
//            cheaper per-call, requires a calibration pass first).
//  - METHOD: symmetric (zero maps to zero, single scale) vs asymmetric
//            (zero-point offset, uses the full range for skewed data) vs
//            mixed (heuristically choose per tensor from its own spread).
//
// quantize()/quantizeModel()/serializeQuantized()/getConfig() are the
// original fake-quant API (dequantized Float32Array output — used by
// rlm.ts and elastic-core.ts-style quantization-aware training, where the
// forward pass needs to *read* quantized values but stay in float32). The
// pack()/unpack() pair below is what actually shrinks memory: it writes
// bit-packed integers, not a same-size float32 array carrying rounded
// values.

export type QuantizationMethod = 'symmetric' | 'asymmetric' | 'mixed';
export type QuantizationMode = 'dynamic' | 'static';

export interface QuantizerConfig {
  enabled: boolean;
  bits: number;
  method: QuantizationMethod;
  calibrationSamples: number;
  excludeLayers: string[];
  /** Default mode new calls use when not explicitly overridden. Defaults to 'dynamic'. */
  mode?: QuantizationMode;
}

export interface QuantizationScale {
  scale: number;
  zeroPoint: number;
  symmetric: boolean;
  bits: number;
}

/** Running statistics accumulated over one or more calibration batches. */
export interface CalibrationStats {
  min: number;
  max: number;
  absMax: number;
  mean: number;
  count: number;
}

/** Bit-packed tensor: the actual on-disk/in-memory reduced representation. */
export interface QuantizedTensor {
  packed: Uint8Array;
  length: number;
  scaleInfo: QuantizationScale;
}

/**
 * Clamp/validate a requested bit width. bits<=1 makes qMax (symmetric) or
 * levels (asymmetric) hit 0, so scale divides by zero -> Infinity -> every
 * dequantized weight becomes 0 * Infinity = NaN. 16 keeps qMax comfortably
 * inside a JS-safe integer range for the bit-packer below. Also NaN-safe:
 * a non-finite bits value (e.g. an unvalidated request field) falls back to
 * 8 instead of propagating NaN through every weight.
 */
export function clampBits(bits: unknown, fallback = 8): number {
  const requested = Math.floor(Number(bits));
  return Number.isFinite(requested) ? Math.max(2, Math.min(16, requested)) : fallback;
}

// ─── Calibration ────────────────────────────────────────────────────────────

/**
 * Accumulates min/max/mean statistics across repeated calibration batches
 * (e.g. successive activation tensors seen during a calibration run) so a
 * fixed scale/zero-point can be derived once and reused by quantizeStatic()
 * without rescanning data on every call.
 */
export class CalibrationCollector {
  private min = Infinity;
  private max = -Infinity;
  private sum = 0;
  private count = 0;

  observe(samples: Float32Array | number[]): void {
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      if (!Number.isFinite(v)) continue;
      if (v < this.min) this.min = v;
      if (v > this.max) this.max = v;
      this.sum += v;
      this.count++;
    }
  }

  reset(): void {
    this.min = Infinity;
    this.max = -Infinity;
    this.sum = 0;
    this.count = 0;
  }

  hasSamples(): boolean {
    return this.count > 0;
  }

  finalize(): CalibrationStats {
    if (this.count === 0) {
      return { min: 0, max: 0, absMax: 0, mean: 0, count: 0 };
    }
    return {
      min: this.min,
      max: this.max,
      absMax: Math.max(Math.abs(this.min), Math.abs(this.max)),
      mean: this.sum / this.count,
      count: this.count,
    };
  }
}

// ─── Scale derivation ───────────────────────────────────────────────────────

function symmetricScale(absMax: number, bits: number): QuantizationScale {
  const qMax = Math.floor((Math.pow(2, bits) - 1) / 2);
  const scale = (absMax / qMax) || 1;
  return { scale, zeroPoint: 0, symmetric: true, bits };
}

function asymmetricScale(min: number, max: number, bits: number): QuantizationScale {
  const levels = Math.pow(2, bits) - 1;
  const scale = ((max - min) / levels) || 1;
  const zeroPoint = Math.round(-min / scale);
  return { scale, zeroPoint, symmetric: false, bits };
}

/** True when a tensor's range is roughly balanced around zero (mixed-method heuristic). */
function isRoughlySymmetric(min: number, max: number): boolean {
  const absMax = Math.max(Math.abs(min), Math.abs(max));
  if (absMax === 0) return true;
  const symmetryRatio = Math.min(Math.abs(min), Math.abs(max)) / absMax;
  return symmetryRatio > 0.5;
}

function deriveScale(
  min: number,
  max: number,
  bits: number,
  method: QuantizationMethod,
): QuantizationScale {
  const absMax = Math.max(Math.abs(min), Math.abs(max));
  const useSymmetric = method === 'symmetric' || (method === 'mixed' && isRoughlySymmetric(min, max));
  return useSymmetric ? symmetricScale(absMax, bits) : asymmetricScale(min, max, bits);
}

function applyScale(value: number, scaleInfo: QuantizationScale): { level: number; dequantized: number } {
  const { scale, zeroPoint, symmetric, bits } = scaleInfo;
  if (symmetric) {
    const qMax = Math.floor((Math.pow(2, bits) - 1) / 2);
    const qMin = -qMax;
    const level = Math.max(qMin, Math.min(qMax, Math.round(value / scale)));
    return { level, dequantized: level * scale };
  }
  const levels = Math.pow(2, bits) - 1;
  const level = Math.max(0, Math.min(Math.round(levels), Math.round(value / scale + zeroPoint)));
  return { level, dequantized: (level - zeroPoint) * scale };
}

// ─── Bit packing (real memory reduction) ────────────────────────────────────

/**
 * Pack an array of small unsigned integer levels (each < 2^bits) into a
 * dense bitstream. This is what actually shrinks storage — quantize()
 * below dequantizes back to float32 for in-place fake-quant use (QAT),
 * whereas pack() is for persisting/transmitting the reduced-width form.
 */
export function packLevels(levels: Uint32Array, bits: number): Uint8Array {
  // BOLT OPTIMIZATION: Extremely fast-path for the highly frequent 8-bit case.
  // Directly set the Uint8Array using typed array copy, bypassing bitwise packing logic.
  if (bits === 8) {
    const out = new Uint8Array(levels.length);
    out.set(levels);
    return out;
  }

  const totalBits = levels.length * bits;
  const out = new Uint8Array(Math.ceil(totalBits / 8));
  let accumulator = 0;
  let bitCount = 0;
  let bytePos = 0;

  // OPTIMIZATION: Instead of bit-by-bit nesting, we accumulate bits in a 32-bit register
  // and write them to the output byte-by-byte, drastically reducing branch overhead and loop cycles.
  for (let i = 0; i < levels.length; i++) {
    accumulator |= levels[i] << bitCount;
    bitCount += bits;
    while (bitCount >= 8) {
      out[bytePos++] = accumulator & 0xFF;
      accumulator >>>= 8;
      bitCount -= 8;
    }
  }
  if (bitCount > 0) {
    out[bytePos] = accumulator & 0xFF;
  }
  return out;
}

export function unpackLevels(packed: Uint8Array, count: number, bits: number): Uint32Array {
  // BOLT OPTIMIZATION: Extremely fast-path for the highly frequent 8-bit case.
  // Directly set the Uint32Array using typed array copy, bypassing bitwise unpacking logic.
  // We use subarray(0, count) to be safe if the packed source buffer is larger than count.
  if (bits === 8) {
    const out = new Uint32Array(count);
    out.set(packed.subarray(0, count));
    return out;
  }

  const out = new Uint32Array(count);
  let accumulator = 0;
  let bitCount = 0;
  let bytePos = 0;
  const mask = (1 << bits) - 1;

  // OPTIMIZATION: Extract whole 'bits'-width integers from a register accumulator,
  // refilling it byte-by-byte from the stream only when needed. This completely bypasses
  // the slow bit-by-bit reconstruction loop.
  for (let i = 0; i < count; i++) {
    while (bitCount < bits) {
      const byte = packed[bytePos++] ?? 0;
      accumulator |= byte << bitCount;
      bitCount += 8;
    }
    out[i] = accumulator & mask;
    accumulator >>>= bits;
    bitCount -= bits;
  }
  return out;
}

// ─── BackgroundQuantizer ────────────────────────────────────────────────────

export class BackgroundQuantizer {
  private config: QuantizerConfig;
  private calibration = new Map<string, CalibrationCollector>();

  constructor(config: QuantizerConfig) {
    this.config = { ...config };
  }

  /**
   * Quantize a Float32Array to N-bit integers then dequantize back
   * (dynamic mode: scale is derived from this call's own min/max).
   * Symmetric: clamp to +/-absMax, scale = absMax / (2^(bits-1) - 1).
   * Asymmetric: min/max scale, zeroPoint offset.
   * Mixed: uses symmetric for layers with large spread, asymmetric otherwise.
   */
  quantize(weights: Float32Array, bits?: number, out?: Float32Array): Float32Array {
    const effectiveBits = clampBits(bits ?? this.config.bits);
    let wMin = Infinity;
    let wMax = -Infinity;
    const len = weights.length;
    let i = 0;
    for (; i < len - 3; i += 4) {
      const v0 = weights[i];
      const v1 = weights[i + 1];
      const v2 = weights[i + 2];
      const v3 = weights[i + 3];
      if (v0 < wMin) wMin = v0;
      if (v0 > wMax) wMax = v0;
      if (v1 < wMin) wMin = v1;
      if (v1 > wMax) wMax = v1;
      if (v2 < wMin) wMin = v2;
      if (v2 > wMax) wMax = v2;
      if (v3 < wMin) wMin = v3;
      if (v3 > wMax) wMax = v3;
    }
    for (; i < len; i++) {
      const v = weights[i];
      if (v < wMin) wMin = v;
      if (v > wMax) wMax = v;
    }
    if (wMax === wMin) {
      const result = out ?? new Float32Array(weights.length);
      result.set(weights);
      return result;
    }
    const scaleInfo = deriveScale(wMin, wMax, effectiveBits, this.config.method);
    return this.dequantizeWith(weights, scaleInfo, out);
  }

  /**
   * Static-mode counterpart to quantize(): reuses a scale/zero-point
   * derived once from calibration data (see calibrate()/CalibrationCollector)
   * instead of rescanning `weights` on every call. Cheaper per call and
   * gives every batch a consistent scale, at the cost of needing a
   * calibration pass up front and being less exact for out-of-distribution
   * inputs the calibration set didn't cover.
   */
  quantizeStatic(weights: Float32Array, stats: CalibrationStats, bits?: number, out?: Float32Array): Float32Array {
    const effectiveBits = clampBits(bits ?? this.config.bits);
    if (stats.count === 0 || stats.max === stats.min) {
      const result = out ?? new Float32Array(weights.length);
      result.set(weights);
      return result;
    }
    const scaleInfo = deriveScale(stats.min, stats.max, effectiveBits, this.config.method);
    return this.dequantizeWith(weights, scaleInfo, out);
  }

  /** Feed calibration samples for a named tensor/layer ahead of quantizeStatic(). */
  calibrate(layerKey: string, samples: Float32Array): void {
    let collector = this.calibration.get(layerKey);
    if (!collector) {
      collector = new CalibrationCollector();
      this.calibration.set(layerKey, collector);
    }
    collector.observe(samples);
  }

  getCalibrationStats(layerKey: string): CalibrationStats | undefined {
    return this.calibration.get(layerKey)?.finalize();
  }

  clearCalibration(layerKey?: string): void {
    if (layerKey) this.calibration.delete(layerKey);
    else this.calibration.clear();
  }

  private dequantizeWith(
    weights: Float32Array,
    scaleInfo: QuantizationScale,
    out?: Float32Array,
  ): Float32Array {
    const result = out || new Float32Array(weights.length);
    const { scale, zeroPoint, symmetric, bits } = scaleInfo;
    const len = weights.length;
    // OPTIMIZATION: Pre-computing the inverse scale (1.0 / scale) replaces slow floating-point division
    // with much faster multiplication inside the high-frequency loops.
    // Additionally, function calls to Math.min/Math.max are replaced with inline branchless ternary expressions
    // to bypass the call stack and reduce branching overhead.
    const invScale = 1.0 / scale;
    if (symmetric) {
      const qMax = Math.floor((Math.pow(2, bits) - 1) / 2);
      const qMin = -qMax;
      let i = 0;
      for (; i < len - 3; i += 4) {
        const w0 = weights[i];
        const w1 = weights[i + 1];
        const w2 = weights[i + 2];
        const w3 = weights[i + 3];

        const r0 = Math.round(w0 * invScale);
        const r1 = Math.round(w1 * invScale);
        const r2 = Math.round(w2 * invScale);
        const r3 = Math.round(w3 * invScale);

        const lv0 = r0 < qMin ? qMin : (r0 > qMax ? qMax : r0);
        const lv1 = r1 < qMin ? qMin : (r1 > qMax ? qMax : r1);
        const lv2 = r2 < qMin ? qMin : (r2 > qMax ? qMax : r2);
        const lv3 = r3 < qMin ? qMin : (r3 > qMax ? qMax : r3);

        result[i] = lv0 * scale;
        result[i + 1] = lv1 * scale;
        result[i + 2] = lv2 * scale;
        result[i + 3] = lv3 * scale;
      }
      for (; i < len; i++) {
        const r = Math.round(weights[i] * invScale);
        const level = r < qMin ? qMin : (r > qMax ? qMax : r);
        result[i] = level * scale;
      }
    } else {
      const levels = Math.pow(2, bits) - 1;
      const maxLevel = Math.round(levels);
      let i = 0;
      for (; i < len - 3; i += 4) {
        const w0 = weights[i];
        const w1 = weights[i + 1];
        const w2 = weights[i + 2];
        const w3 = weights[i + 3];

        const r0 = Math.round(w0 * invScale + zeroPoint);
        const r1 = Math.round(w1 * invScale + zeroPoint);
        const r2 = Math.round(w2 * invScale + zeroPoint);
        const r3 = Math.round(w3 * invScale + zeroPoint);

        const lv0 = r0 < 0 ? 0 : (r0 > maxLevel ? maxLevel : r0);
        const lv1 = r1 < 0 ? 0 : (r1 > maxLevel ? maxLevel : r1);
        const lv2 = r2 < 0 ? 0 : (r2 > maxLevel ? maxLevel : r2);
        const lv3 = r3 < 0 ? 0 : (r3 > maxLevel ? maxLevel : r3);

        result[i] = (lv0 - zeroPoint) * scale;
        result[i + 1] = (lv1 - zeroPoint) * scale;
        result[i + 2] = (lv2 - zeroPoint) * scale;
        result[i + 3] = (lv3 - zeroPoint) * scale;
      }
      for (; i < len; i++) {
        const r = Math.round(weights[i] * invScale + zeroPoint);
        const level = r < 0 ? 0 : (r > maxLevel ? maxLevel : r);
        result[i] = (level - zeroPoint) * scale;
      }
    }
    return result;
  }

  /**
   * Bit-pack a tensor for real storage reduction. Uses static calibration
   * stats when available for `layerKey`, otherwise derives a dynamic scale
   * from `weights` itself.
   */
  pack(weights: Float32Array, layerKey?: string, bits?: number): QuantizedTensor {
    const effectiveBits = clampBits(bits ?? this.config.bits);
    const stats = layerKey ? this.calibration.get(layerKey)?.finalize() : undefined;
    let min: number;
    let max: number;
    if (stats && stats.count > 0) {
      min = stats.min;
      max = stats.max;
    } else {
      min = Infinity;
      max = -Infinity;
      const len = weights.length;
      let i = 0;
      for (; i < len - 3; i += 4) {
        const v0 = weights[i];
        const v1 = weights[i + 1];
        const v2 = weights[i + 2];
        const v3 = weights[i + 3];
        if (v0 < min) min = v0;
        if (v0 > max) max = v0;
        if (v1 < min) min = v1;
        if (v1 > max) max = v1;
        if (v2 < min) min = v2;
        if (v2 > max) max = v2;
        if (v3 < min) min = v3;
        if (v3 > max) max = v3;
      }
      for (; i < len; i++) {
        const v = weights[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (min === Infinity) { min = 0; max = 0; }
    }
    if (max === min) { max = min + 1; } // avoid a zero-width range collapsing the scale
    const scaleInfo = deriveScale(min, max, effectiveBits, this.config.method);
    const offset = scaleInfo.symmetric ? Math.floor((Math.pow(2, effectiveBits) - 1) / 2) : 0;
    const levels = new Uint32Array(weights.length);
    const { scale, zeroPoint, symmetric, bits: sBits } = scaleInfo;
    const len = weights.length;
    // OPTIMIZATION: Pre-computing the inverse scale (1.0 / scale) replaces slow floating-point division
    // with much faster multiplication inside the high-frequency loops.
    // Additionally, function calls to Math.min/Math.max are replaced with inline branchless ternary expressions
    // to bypass the call stack and reduce branching overhead.
    const invScale = 1.0 / scale;
    if (symmetric) {
      const qMax = Math.floor((Math.pow(2, sBits) - 1) / 2);
      const qMin = -qMax;
      let i = 0;
      for (; i < len - 3; i += 4) {
        const r0 = Math.round(weights[i] * invScale);
        const r1 = Math.round(weights[i + 1] * invScale);
        const r2 = Math.round(weights[i + 2] * invScale);
        const r3 = Math.round(weights[i + 3] * invScale);

        const lv0 = r0 < qMin ? qMin : (r0 > qMax ? qMax : r0);
        const lv1 = r1 < qMin ? qMin : (r1 > qMax ? qMax : r1);
        const lv2 = r2 < qMin ? qMin : (r2 > qMax ? qMax : r2);
        const lv3 = r3 < qMin ? qMin : (r3 > qMax ? qMax : r3);

        levels[i] = lv0 + offset;
        levels[i + 1] = lv1 + offset;
        levels[i + 2] = lv2 + offset;
        levels[i + 3] = lv3 + offset;
      }
      for (; i < len; i++) {
        const r = Math.round(weights[i] * invScale);
        const level = r < qMin ? qMin : (r > qMax ? qMax : r);
        levels[i] = level + offset;
      }
    } else {
      const levelsCount = Math.pow(2, sBits) - 1;
      const maxLevel = Math.round(levelsCount);
      let i = 0;
      for (; i < len - 3; i += 4) {
        const r0 = Math.round(weights[i] * invScale + zeroPoint);
        const r1 = Math.round(weights[i + 1] * invScale + zeroPoint);
        const r2 = Math.round(weights[i + 2] * invScale + zeroPoint);
        const r3 = Math.round(weights[i + 3] * invScale + zeroPoint);

        const lv0 = r0 < 0 ? 0 : (r0 > maxLevel ? maxLevel : r0);
        const lv1 = r1 < 0 ? 0 : (r1 > maxLevel ? maxLevel : r1);
        const lv2 = r2 < 0 ? 0 : (r2 > maxLevel ? maxLevel : r2);
        const lv3 = r3 < 0 ? 0 : (r3 > maxLevel ? maxLevel : r3);

        levels[i] = lv0 + offset;
        levels[i + 1] = lv1 + offset;
        levels[i + 2] = lv2 + offset;
        levels[i + 3] = lv3 + offset;
      }
      for (; i < len; i++) {
        const r = Math.round(weights[i] * invScale + zeroPoint);
        const level = r < 0 ? 0 : (r > maxLevel ? maxLevel : r);
        levels[i] = level + offset;
      }
    }
    return {
      packed: packLevels(levels, effectiveBits),
      length: weights.length,
      scaleInfo,
    };
  }

  unpack(tensor: QuantizedTensor): Float32Array {
    const { scaleInfo, length } = tensor;
    const offset = scaleInfo.symmetric ? Math.floor((Math.pow(2, scaleInfo.bits) - 1) / 2) : 0;
    const levels = unpackLevels(tensor.packed, length, scaleInfo.bits);
    const out = new Float32Array(length);
    const scale = scaleInfo.scale;
    const zeroPoint = scaleInfo.zeroPoint;
    if (scaleInfo.symmetric) {
      let i = 0;
      for (; i < length - 3; i += 4) {
        out[i] = (levels[i] - offset) * scale;
        out[i + 1] = (levels[i + 1] - offset) * scale;
        out[i + 2] = (levels[i + 2] - offset) * scale;
        out[i + 3] = (levels[i + 3] - offset) * scale;
      }
      for (; i < length; i++) {
        out[i] = (levels[i] - offset) * scale;
      }
    } else {
      let i = 0;
      for (; i < length - 3; i += 4) {
        out[i] = (levels[i] - offset - zeroPoint) * scale;
        out[i + 1] = (levels[i + 1] - offset - zeroPoint) * scale;
        out[i + 2] = (levels[i + 2] - offset - zeroPoint) * scale;
        out[i + 3] = (levels[i + 3] - offset - zeroPoint) * scale;
      }
      for (; i < length; i++) {
        out[i] = (levels[i] - offset - zeroPoint) * scale;
      }
    }
    return out;
  }

  /**
   * Applies quantize() to each key not in excludeLayers.
   */
  quantizeModel(model: Record<string, Float32Array>): Record<string, Float32Array> {
    const result: Record<string, Float32Array> = {};
    const excluded = new Set(this.config.excludeLayers);
    for (const key of Object.keys(model)) {
      result[key] = excluded.has(key) ? model[key] : this.quantize(model[key]);
    }
    return result;
  }

  /**
   * Bit-packs every key not in excludeLayers, producing the real
   * reduced-size representation (unlike quantizeModel(), which stays
   * float32-shaped for QAT forward passes).
   */
  packModel(model: Record<string, Float32Array>, bits?: number): Record<string, QuantizedTensor> {
    const result: Record<string, QuantizedTensor> = {};
    const excluded = new Set(this.config.excludeLayers);
    for (const key of Object.keys(model)) {
      if (excluded.has(key)) continue;
      result[key] = this.pack(model[key], key, bits);
    }
    return result;
  }

  /**
   * Serialize a quantized model to JSON string.
   */
  serializeQuantized(model: Record<string, Float32Array>): string {
    const weights: Record<string, number[]> = {};
    for (const key of Object.keys(model)) {
      weights[key] = Array.from(model[key]);
    }
    return JSON.stringify({
      quantized: true,
      bits: this.config.bits,
      method: this.config.method,
      weights,
    });
  }

  /**
   * Serialize a bit-packed model (from packModel()) to JSON — packed bytes
   * are base64-encoded since JSON has no binary type. This is the format
   * that actually reflects on-disk memory savings; serializeQuantized()
   * above stays float32-shaped for round-tripping into QAT code paths.
   */
  serializePacked(packedModel: Record<string, QuantizedTensor>): string {
    const layers: Record<string, {
      packed: string; length: number; scale: number; zeroPoint: number; symmetric: boolean; bits: number;
    }> = {};
    for (const key of Object.keys(packedModel)) {
      const t = packedModel[key];
      layers[key] = {
        packed: Buffer.from(t.packed).toString('base64'),
        length: t.length,
        scale: t.scaleInfo.scale,
        zeroPoint: t.scaleInfo.zeroPoint,
        symmetric: t.scaleInfo.symmetric,
        bits: t.scaleInfo.bits,
      };
    }
    return JSON.stringify({ quantized: true, packed: true, method: this.config.method, layers });
  }

  deserializePacked(json: string): Record<string, QuantizedTensor> {
    const parsed = JSON.parse(json) as {
      layers: Record<string, { packed: string; length: number; scale: number; zeroPoint: number; symmetric: boolean; bits: number }>;
    };
    const result: Record<string, QuantizedTensor> = {};
    for (const key of Object.keys(parsed.layers)) {
      const l = parsed.layers[key];
      result[key] = {
        packed: new Uint8Array(Buffer.from(l.packed, 'base64')),
        length: l.length,
        scaleInfo: { scale: l.scale, zeroPoint: l.zeroPoint, symmetric: l.symmetric, bits: l.bits },
      };
    }
    return result;
  }

  getConfig(): QuantizerConfig {
    return { ...this.config };
  }
}

// ============================================================================
// value-range.ts
// ============================================================================

import type { NeuronState } from '../../interface/types.js';

export interface ValueRangeConfig {
  enabled: boolean;
  totalPoints: number;
  minLearningRate: number;
  maxLearningRate: number;
  redistributionInterval: number;
  decayFactor: number;
}

export interface NeuronAllocation {
  id: string;
  valuePoints: number;
  learningRate: number;
}

export class ValueRangeAllocator {
  private config: ValueRangeConfig;
  /** Map of neuron string-id → current value points */
  private allocations: Map<string, number>;
  private stepCount: number;

  constructor(config: ValueRangeConfig) {
    this.config = { ...config };
    this.allocations = new Map();
    this.stepCount = 0;
  }

  /**
   * Distribute totalPoints equally across all provided neurons.
   */
  initializeNeurons(neuronStates: NeuronState[]): void {
    this.allocations.clear();
    if (neuronStates.length === 0) return;
    const pointsEach = this.config.totalPoints / neuronStates.length;
    for (const ns of neuronStates) {
      this.allocations.set(ns.id, pointsEach);
    }
  }


  /**
   * Add a neuron to the existing zero-sum value budget without resetting the
   * learned distribution. The new neuron's initial points are taken
   * proportionally from existing neurons, then the allocation is normalized
   * back to the fixed totalPoints budget.
   */
  addNeuron(id: string, initialPoints?: number): void {
    if (this.allocations.has(id)) return;

    if (this.allocations.size === 0) {
      this.allocations.set(id, this.config.totalPoints);
      return;
    }

    const requestedInitial = initialPoints ?? (this.config.totalPoints / (this.allocations.size + 1));
    const clampedInitial = Math.min(
      this.config.totalPoints,
      Math.max(0, requestedInitial),
    );

    const totalBefore = Array.from(this.allocations.values()).reduce((sum, pts) => sum + pts, 0);
    if (totalBefore > 0 && clampedInitial > 0) {
      for (const [existingId, pts] of this.allocations) {
        const contribution = clampedInitial * (pts / totalBefore);
        this.allocations.set(existingId, Math.max(0, pts - contribution));
      }
    }

    this.allocations.set(id, clampedInitial);
    this._normalise();
  }

  /**
   * Zero-sum update: apply delta*0.1 to target neuron; redistribute
   * the opposite amount proportionally across all other neurons.
   */
  updateNeuronValue(id: string, delta: number): void {
    if (this.allocations.size === 0) return;
    const current = this.allocations.get(id) ?? 0;
    const change = delta * 0.1;
    const newVal = Math.max(0, current + change);
    const actualChange = newVal - current;
    this.allocations.set(id, newVal);

    // Redistribute the opposite change across others
    const otherIds = Array.from(this.allocations.keys()).filter(k => k !== id);
    if (otherIds.length === 0) return;
    const oppositePerOther = -actualChange / otherIds.length;
    for (const otherId of otherIds) {
      const otherVal = this.allocations.get(otherId) ?? 0;
      this.allocations.set(otherId, Math.max(0, otherVal + oppositePerOther));
    }

    // Re-normalise to keep the sum exactly at totalPoints
    this._normalise();
  }

  /**
   * Decay step: runs every redistributionInterval steps internally.
   * Each call is one step; when count reaches interval, decay fires.
   */
  applyDecay(): void {
    this.stepCount++;
    if (this.stepCount % this.config.redistributionInterval !== 0) return;

    // Decay each neuron by decayFactor, pool the reclaimed points
    let reclaimed = 0;
    for (const [id, pts] of this.allocations) {
      const loss = pts * this.config.decayFactor;
      this.allocations.set(id, pts - loss);
      reclaimed += loss;
    }

    // Redistribute equally
    if (this.allocations.size > 0) {
      const share = reclaimed / this.allocations.size;
      for (const [id, pts] of this.allocations) {
        this.allocations.set(id, pts + share);
      }
    }

    this._normalise();
  }

  /**
   * Returns current distribution.
   * neuronAllocations shape matches NeuronAllocation interface.
   */
  getDistribution(): { totalPoints: number; neuronAllocations: NeuronAllocation[] } {
    const neuronAllocations: NeuronAllocation[] = [];
    for (const [id, pts] of this.allocations) {
      neuronAllocations.push({
        id,
        valuePoints: pts,
        learningRate: this._pointsToLearningRate(pts),
      });
    }
    return { totalPoints: this.config.totalPoints, neuronAllocations };
  }

  /**
   * Vale as a [0,1] fraction of totalPoints per neuron — the value consulted
   * by state-transition gating (new_state = vale*old_state + (1-vale)*computed),
   * as opposed to getDistribution()'s learningRate (which gates weight
   * plasticity). Both read the same underlying zero-sum points; a
   * high-points neuron is simultaneously slow to re-weight *and* resistant
   * to having its state overwritten this tick.
   */
  getValeFractions(): Map<string, number> {
    const fractions = new Map<string, number>();
    const maxPts = this.config.totalPoints;
    for (const [id, pts] of this.allocations) {
      fractions.set(id, maxPts > 0 ? Math.min(1, Math.max(0, pts / maxPts)) : 0);
    }
    return fractions;
  }

  /**
   * Demotion: takes 50% of neuron's points and gives them to others equally.
   */
  demoteNeuron(id: string): void {
    const current = this.allocations.get(id) ?? 0;
    const taken = current * 0.5;
    this.allocations.set(id, current - taken);

    const otherIds = Array.from(this.allocations.keys()).filter(k => k !== id);
    if (otherIds.length === 0) return;
    const share = taken / otherIds.length;
    for (const otherId of otherIds) {
      const val = this.allocations.get(otherId) ?? 0;
      this.allocations.set(otherId, val + share);
    }

    this._normalise();
  }

  /** Convert value points to learning rate via linear interpolation.
   * More points → minLearningRate (stable). Fewer points → maxLearningRate (plastic).
   */
  private _pointsToLearningRate(pts: number): number {
    const maxPts = this.config.totalPoints;
    if (maxPts <= 0) return this.config.maxLearningRate;
    // fraction ∈ [0,1] where 1 = all points (most stable)
    const fraction = Math.min(1, Math.max(0, pts / maxPts));
    return this.config.maxLearningRate + fraction * (this.config.minLearningRate - this.config.maxLearningRate);
  }

  /** Rescale all allocations so they sum exactly to totalPoints. */
  private _normalise(): void {
    let total = 0;
    for (const pts of this.allocations.values()) total += pts;
    if (total <= 0 || this.allocations.size === 0) return;
    const scale = this.config.totalPoints / total;
    for (const [id, pts] of this.allocations) {
      this.allocations.set(id, Math.max(0, pts * scale));
    }
  }
}

// ============================================================================
// mesh.ts
// ============================================================================

export interface NeuronNode {
  id: number;
  activation: number;
  bias: number;
  connections: Map<number, number>;
  layer: number;
  activationHistory: number[];
}

export interface MeshTopology {
  nodes: NeuronNode[];
  edges: [number, number, number][];
  density: number;
  averagePathLength: number;
  clusteringCoefficient: number;
  nodeCount: number;
  edgeCount: number;
}

export interface PropagationResult {
  finalStates: Map<number, number>;
  iterations: number;
  converged: boolean;
  residual: number;
  nodeHistory: Map<number, number[]>;
}

export interface MeshConfig {
  initialNodeCount: number;
  nodeCount?: number;
  connectionDensity: number;
  initialConnectionWeight?: number;
  maxIterations: number;
  propagationSteps?: number;
  convergenceThreshold: number;
  activationFunction: 'relu' | 'tanh' | 'sigmoid' | 'swish';
  activationFn?: 'relu' | 'tanh' | 'sigmoid' | 'swish';
  learningRate: number;
  dampingFactor?: number;
  seed: number;
}

export class NeuronMesh {
  private config: MeshConfig;
  private nodes: Map<number, NeuronNode>;
  private nextId: number = 0;
  /**
   * Section 2.1: a skill/expert "group" is purely a label used by the MoE
   * router for gating which neurons compute on a given tick — it has zero
   * effect on wiring. A grouped node is still created (and wired all-to-all,
   * same as any other node) by addNode(); the group only matters to
   * propagate() when an activeGroups set is passed in.
   */
  private nodeGroups: Map<number, string> = new Map();

  // Performance cache for CSR layout
  private cacheValid: boolean = false;
  private cachedNodes: NeuronNode[] = [];
  private idToIndex: Map<number, number> = new Map();
  private flatWeights: Float32Array = new Float32Array(0);
  private flatIndices: Int32Array = new Int32Array(0);
  private rowStarts: Int32Array = new Int32Array(0);
  private biases: Float32Array = new Float32Array(0);
  private currActivations: Float32Array = new Float32Array(0);
  private nextActivations: Float32Array = new Float32Array(0);

  constructor(config: Partial<MeshConfig> = {}) {
    const nodeCount = config.nodeCount ?? config.initialNodeCount ?? 10;
    const actFn = config.activationFn || config.activationFunction || 'relu';
    this.config = {
      initialNodeCount: nodeCount,
      connectionDensity: 1.0,
      maxIterations: config.propagationSteps || config.maxIterations || 100,
      convergenceThreshold: config.convergenceThreshold ?? 0.001,
      activationFunction: actFn as 'relu' | 'tanh' | 'sigmoid' | 'swish',
      learningRate: config.learningRate ?? 0.01,
      seed: config.seed ?? 42,
    };
    this.nodes = new Map();
    const tempIds: number[] = [];
    for (let i = 0; i < this.config.initialNodeCount; i++) {
      const id = this.nextId++;
      const node: NeuronNode = {
        id,
        activation: 0,
        bias: (Math.random() * 2 - 1) * 0.1,
        connections: new Map(),
        layer: 0,
        activationHistory: [],
      };
      this.nodes.set(id, node);
      tempIds.push(id);
    }
    for (let i = 0; i < tempIds.length; i++) {
      for (let j = 0; j < tempIds.length; j++) {
        if (i === j) continue;
        const from = tempIds[i];
        const to = tempIds[j];
        const weight = (Math.random() * 2 - 1) * Math.sqrt(1 / tempIds.length);
        this.nodes.get(from)!.connections.set(to, weight);
      }
    }
    this.refreshCache();
  }

  /**
   * Synchronize the CSR cache with the current nodes Map.
   */
  private refreshCache(): void {
    this.cachedNodes = Array.from(this.nodes.values());
    const N = this.cachedNodes.length;
    this.idToIndex = new Map(this.cachedNodes.map((n, i) => [n.id, i]));
    this.biases = new Float32Array(this.cachedNodes.map(n => n.bias));
    this.currActivations = new Float32Array(this.cachedNodes.map(n => n.activation));
    this.nextActivations = new Float32Array(N);

    let totalEdges = 0;
    for (const n of this.cachedNodes) totalEdges += n.connections.size;

    this.flatWeights = new Float32Array(totalEdges);
    this.flatIndices = new Int32Array(totalEdges);
    this.rowStarts = new Int32Array(N + 1);

    let edgePtr = 0;
    for (let i = 0; i < N; i++) {
      const n = this.cachedNodes[i];
      this.rowStarts[i] = edgePtr;
      for (const [neighborId, weight] of n.connections) {
        const j = this.idToIndex.get(neighborId);
        if (j !== undefined) {
          this.flatIndices[edgePtr] = j;
          this.flatWeights[edgePtr] = weight;
          edgePtr++;
        }
      }
    }
    this.rowStarts[N] = edgePtr;
    this.cacheValid = true;
  }

  /**
   * @param vale Optional per-node vale fraction in [0,1] from the elastic
   *   value budget. Gates the state-transition itself (not just weight
   *   learning): new_state = vale*old_state + (1-vale)*computed_state, so a
   *   high-vale node resists moving to its freshly computed activation while
   *   a low-vale node adopts it almost entirely. Nodes absent from the map
   *   are ungated (vale=0, i.e. fully adopt the computed state).
   * @param activeGroups Section 2.1: when provided, only ungrouped (core)
   *   nodes and nodes whose group is in this set get their activation
   *   recomputed this tick — everyone else holds their last value (frozen,
   *   not disconnected). Frozen nodes are still read as neighbors by active
   *   nodes' weighted sums, and still hold live connections both directions,
   *   so the topology stays total while per-tick compute stays sparse.
   *   Omit to compute every node (the pre-2.1 behavior).
   */
  propagate(
    inputActivations: Map<number, number> | Map<string, number>,
    vale?: Map<number, number>,
    activeGroups?: Set<string>
  ): PropagationResult {
    if (!this.cacheValid) this.refreshCache();

    const nodes = this.cachedNodes;
    const N = nodes.length;
    const maxIters = this.config.maxIterations;

    // Bolt's Optimization: Pre-allocate standard arrays of size maxIters
    // to completely avoid memory allocations and garbage collection pressure in hot loops.
    const histories: number[][] = [];
    const nodeHistory = new Map<number, number[]>();
    for (let i = 0; i < N; i++) {
      const arr = new Array<number>(maxIters);
      histories.push(arr);
      nodeHistory.set(nodes[i].id, arr);
    }

    // Synchronize activations from source of truth and inputs
    for (let i = 0; i < N; i++) this.currActivations[i] = nodes[i].activation;

    for (const [id, val] of inputActivations) {
      const nId = typeof id === 'string' ? parseInt(id.replace('neuron_', ''), 10) : id;
      const idx = this.idToIndex.get(nId);
      if (idx !== undefined) {
        const node = nodes[idx];
        node.activation = val;
        node.activationHistory = [val];
        this.currActivations[idx] = val;
      }
    }

    const curr = this.currActivations;
    const next = this.nextActivations;

    const flatWeights = this.flatWeights;
    const flatIndices = this.flatIndices;
    const rowStarts = this.rowStarts;
    const biases = this.biases;

    // Resolve the activation function outside the hot loop to avoid dynamic lookup and switches
    const actFn = this.config.activationFunction;
    let activate: (x: number) => number;
    if (actFn === 'relu') {
      activate = (x) => x > 0 ? x : 0;
    } else if (actFn === 'tanh') {
      activate = Math.tanh;
    } else if (actFn === 'sigmoid') {
      activate = (x) => 1 / (1 + Math.exp(-x));
    } else if (actFn === 'swish') {
      activate = (x) => x / (1 + Math.exp(-x));
    } else {
      activate = (x) => x > 0 ? x : 0;
    }

    let iteration = 0, converged = false, residual = 0;

    // Fast-path: When there are no gates and no vale gating (most common case)
    if (!activeGroups && !vale) {
      for (; iteration < maxIters; iteration++) {
        for (let i = 0; i < N; i++) {
          let sum = biases[i];
          const start = rowStarts[i], end = rowStarts[i + 1];
          // Bolt's Optimization: Manual 8x loop unrolling for row-major dot product to reduce branch evaluation overhead.
          const limit = end - 7;
          let k = start;
          for (; k < limit; k += 8) {
            sum += curr[flatIndices[k]] * flatWeights[k]
                 + curr[flatIndices[k + 1]] * flatWeights[k + 1]
                 + curr[flatIndices[k + 2]] * flatWeights[k + 2]
                 + curr[flatIndices[k + 3]] * flatWeights[k + 3]
                 + curr[flatIndices[k + 4]] * flatWeights[k + 4]
                 + curr[flatIndices[k + 5]] * flatWeights[k + 5]
                 + curr[flatIndices[k + 6]] * flatWeights[k + 6]
                 + curr[flatIndices[k + 7]] * flatWeights[k + 7];
          }
          for (; k < end; k++) {
            sum += curr[flatIndices[k]] * flatWeights[k];
          }
          next[i] = activate(sum);
          histories[i][iteration] = next[i];
        }

        residual = 0;
        for (let i = 0; i < N; i++) {
          // OPTIMIZATION: Branchless ternary absolute difference to avoid Math.abs call overhead
          const diff = next[i] - curr[i];
          residual += diff < 0 ? -diff : diff;
          curr[i] = next[i];
          nodes[i].activation = curr[i];
        }
        if (this.checkConvergence(residual)) { converged = true; break; }
      }
    } else {
      // General path: When either gates or vale gating is active
      const gates = new Uint8Array(N);
      const vs = new Float32Array(N);
      const hasV = new Uint8Array(N);

      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        const g = this.nodeGroups.get(n.id);
        gates[i] = (activeGroups && g !== undefined && !activeGroups.has(g)) ? 1 : 0;
        const v = vale?.get(n.id);
        if (v !== undefined) { vs[i] = v; hasV[i] = 1; }
      }

      for (; iteration < maxIters; iteration++) {
        for (let i = 0; i < N; i++) {
          if (gates[i]) {
            next[i] = curr[i];
          } else {
            let sum = biases[i];
            const start = rowStarts[i], end = rowStarts[i + 1];
            // Bolt's Optimization: Manual 8x loop unrolling for row-major dot product to reduce branch evaluation overhead.
            const limit = end - 7;
            let k = start;
            for (; k < limit; k += 8) {
              sum += curr[flatIndices[k]] * flatWeights[k]
                   + curr[flatIndices[k + 1]] * flatWeights[k + 1]
                   + curr[flatIndices[k + 2]] * flatWeights[k + 2]
                   + curr[flatIndices[k + 3]] * flatWeights[k + 3]
                   + curr[flatIndices[k + 4]] * flatWeights[k + 4]
                   + curr[flatIndices[k + 5]] * flatWeights[k + 5]
                   + curr[flatIndices[k + 6]] * flatWeights[k + 6]
                   + curr[flatIndices[k + 7]] * flatWeights[k + 7];
            }
            for (; k < end; k++) {
              sum += curr[flatIndices[k]] * flatWeights[k];
            }
            const comp = activate(sum);
            next[i] = hasV[i] ? vs[i] * curr[i] + (1 - vs[i]) * comp : comp;
          }
          histories[i][iteration] = next[i];
        }

        residual = 0;
        for (let i = 0; i < N; i++) {
          // OPTIMIZATION: Branchless ternary absolute difference to avoid Math.abs call overhead
          const diff = next[i] - curr[i];
          residual += diff < 0 ? -diff : diff;
          curr[i] = next[i];
          nodes[i].activation = curr[i];
        }
        if (this.checkConvergence(residual)) { converged = true; break; }
      }
    }

    // Bolt's Optimization: Truncate pre-allocated arrays and bulk-append history to node's activationHistory
    const finalIters = converged ? iteration + 1 : iteration;
    for (let i = 0; i < N; i++) {
      const history = histories[i];
      history.length = finalIters;
      nodes[i].activationHistory.push(...history);
    }

    const finalStates = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      finalStates.set(nodes[i].id, nodes[i].activation);
    }

    return {
      finalStates,
      iterations: finalIters, converged, residual, nodeHistory
    };
  }

  /**
   * Hebbian weight update gated per-node by an externally supplied learning
   * rate (from the elastic value budget: high-value nodes get a low rate and
   * barely move, low-value nodes get a high rate and adapt quickly). Returns
   * the total absolute weight change applied from each node, so the caller
   * can feed it back into the value budget as a "how much did this node just
   * change" signal.
   */
  applyValueWeightedLearning(learningRates: Map<number, number>): Map<number, number> {
    if (!this.cacheValid) this.refreshCache();
    const deltaByNode = new Map<number, number>();
    const N = this.cachedNodes.length;

    for (let i = 0; i < N; i++) {
      const node = this.cachedNodes[i];
      const rate = learningRates.get(node.id) ?? this.config.learningRate;
      let totalDelta = 0;

      const rowStart = this.rowStarts[i];
      const rowEnd = this.rowStarts[i + 1];

      // Optimization: Iterate over CSR structure directly to update both Map and flatWeights
      for (let k = rowStart; k < rowEnd; k++) {
        const neighborIdx = this.flatIndices[k];
        const neighbor = this.cachedNodes[neighborIdx];
        const weight = this.flatWeights[k];

        const hebbian = rate * node.activation * neighbor.activation;
        const newWeight = Math.max(-2, Math.min(2, weight + hebbian));

        this.flatWeights[k] = newWeight;
        node.connections.set(neighbor.id, newWeight);
        totalDelta += Math.abs(newWeight - weight);
      }
      deltaByNode.set(node.id, totalDelta);
    }
    return deltaByNode;
  }

  /**
   * @param group Section 2.1: optional skill/expert label. Purely a router
   *   gating tag — the node is wired all-to-all at connectionDensity exactly
   *   like any ungrouped node, with zero effect on topology.
   */
  addNode(layer: number, group?: string): number {
    const id = this.nextId++;
    const node: NeuronNode = {
      id,
      activation: 0,
      bias: (Math.random() * 2 - 1) * 0.1,
      connections: new Map(),
      layer,
      activationHistory: [],
    };
    this.nodes.set(id, node);
    if (group !== undefined) this.nodeGroups.set(id, group);

    for (const [, other] of this.nodes) {
      if (other.id !== id && Math.random() < this.config.connectionDensity) {
        const weight = (Math.random() * 2 - 1) * Math.sqrt(1 / this.nodes.size);
        node.connections.set(other.id, weight);
        other.connections.set(id, weight);
      }
    }

    this.cacheValid = false;
    return id;
  }

  removeNode(id: number): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;
    for (const [, other] of this.nodes) {
      other.connections.delete(id);
    }
    this.nodes.delete(id);
    this.nodeGroups.delete(id);
    this.cacheValid = false;
    return true;
  }

  /** Section 2.1: node ids labeled with the given skill/expert group. */
  getGroupNodeIds(group: string): number[] {
    const ids: number[] = [];
    for (const [id, g] of this.nodeGroups) {
      if (g === group) ids.push(id);
    }
    return ids;
  }

  /** The skill/expert group a node was registered under, if any. */
  getNodeGroup(id: number): string | undefined {
    return this.nodeGroups.get(id);
  }

  /** All distinct skill/expert groups currently registered in the mesh. */
  getGroups(): string[] {
    return Array.from(new Set(this.nodeGroups.values()));
  }

  updateConnection(fromId: number, toId: number, newWeight: number): void {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (from && to) {
      from.connections.set(toId, newWeight);
      to.connections.set(fromId, newWeight);

      // If cache is valid, try to update it directly to avoid invalidation
      if (this.cacheValid) {
        const fromIdx = this.idToIndex.get(fromId);
        const toIdx = this.idToIndex.get(toId);

        if (fromIdx !== undefined && toIdx !== undefined) {
          // Update from -> to weight
          let foundFrom = false;
          for (let k = this.rowStarts[fromIdx]; k < this.rowStarts[fromIdx + 1]; k++) {
            if (this.flatIndices[k] === toIdx) {
              this.flatWeights[k] = newWeight;
              foundFrom = true;
              break;
            }
          }
          // Update to -> from weight
          let foundTo = false;
          for (let k = this.rowStarts[toIdx]; k < this.rowStarts[toIdx + 1]; k++) {
            if (this.flatIndices[k] === fromIdx) {
              this.flatWeights[k] = newWeight;
              foundTo = true;
              break;
            }
          }

          if (!foundFrom || !foundTo) this.cacheValid = false;
        } else {
          this.cacheValid = false;
        }
      }
    }
  }

  getTopology(): MeshTopology {
    const nodes = Array.from(this.nodes.values());
    const edges: [number, number, number][] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      for (const [neighborId, weight] of node.connections) {
        const key = Math.min(node.id, neighborId) + '_' + Math.max(node.id, neighborId);
        if (!seen.has(key)) {
          seen.add(key);
          edges.push([node.id, neighborId, weight]);
        }
      }
    }

    return {
      nodes,
      edges,
      density: this.nodes.size > 1 ? (2 * edges.length) / (this.nodes.size * (this.nodes.size - 1)) : 0,
      averagePathLength: this.computeAveragePathLength(),
      clusteringCoefficient: this.computeClusteringCoefficient(),
      nodeCount: this.nodes.size,
      edgeCount: edges.length,
    };
  }

  getNode(id: number): NeuronNode | undefined {
    return this.nodes.get(id);
  }

  getNodeCount(): number {
    return this.nodes.size;
  }

  private activate(x: number): number {
    switch (this.config.activationFunction) {
      case 'relu':
        return Math.max(0, x);
      case 'tanh':
        return Math.tanh(x);
      case 'sigmoid':
        return 1 / (1 + Math.exp(-x));
      case 'swish':
        return x / (1 + Math.exp(-x));
      default:
        return Math.max(0, x);
    }
  }

  private captureState(): Map<number, number> {
    const state = new Map<number, number>();
    for (const [id, node] of this.nodes) {
      state.set(id, node.activation);
    }
    return state;
  }

  private checkConvergence(residual: number): boolean {
    return residual < this.config.convergenceThreshold;
  }

  private computeAveragePathLength(): number {
    const nodeIds = Array.from(this.nodes.keys());
    let totalLength = 0;
    let pairs = 0;

    for (let i = 0; i < nodeIds.length; i++) {
      const distances = this.BFS(nodeIds[i]);
      for (let j = i + 1; j < nodeIds.length; j++) {
        const d = distances.get(nodeIds[j]);
        if (d !== undefined && d > 0) {
          totalLength += d;
          pairs++;
        }
      }
    }

    return pairs > 0 ? totalLength / pairs : 0;
  }

  private BFS(startId: number): Map<number, number> {
    const distances = new Map<number, number>();
    const queue: number[] = [startId];
    distances.set(startId, 0);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.nodes.get(current);
      if (!node) continue;
      const currentDist = distances.get(current) || 0;

      for (const [neighborId] of node.connections) {
        if (!distances.has(neighborId)) {
          distances.set(neighborId, currentDist + 1);
          queue.push(neighborId);
        }
      }
    }

    return distances;
  }

  private computeClusteringCoefficient(): number {
    let totalCoeff = 0;
    let nodeCount = 0;

    for (const [, node] of this.nodes) {
      const neighbors = Array.from(node.connections.keys());
      if (neighbors.length < 2) continue;

      let connectedPairs = 0;
      const totalPairs = (neighbors.length * (neighbors.length - 1)) / 2;

      for (let i = 0; i < neighbors.length; i++) {
        const neighborA = this.nodes.get(neighbors[i]);
        if (!neighborA) continue;
        for (let j = i + 1; j < neighbors.length; j++) {
          if (neighborA.connections.has(neighbors[j])) {
            connectedPairs++;
          }
        }
      }

      totalCoeff += connectedPairs / totalPairs;
      nodeCount++;
    }

    return nodeCount > 0 ? totalCoeff / nodeCount : 0;
  }
}

// ============================================================================
// elastic-core.ts
// ============================================================================

export interface ElasticCoreConfig {
  neuronCount?: number;
  stateDim?: number;
  inputDim?: number;
  outputDim?: number;
  maxTicks?: number;
  convergenceThreshold?: number;
  weightScale?: number;
  seed?: number;
  inputFlagDim?: number;
  /** Enable quantization-aware state settling: quantize inside forward and retain residual feedback. */
  quantizationAware?: boolean;
  /** Bit width for quantized state values when quantizationAware is enabled. */
  quantizationBits?: number;
}

export interface ElasticCoreRunOptions {
  /** Vale fraction per neuron in [0,1]. High vale resists state movement. */
  vale?: Map<number, number>;
  /** Optional MoE labels to compute this tick; unselected labelled neurons hold state. */
  activeGroups?: Set<string>;
  /** Externally-driven neuron ids for the input-source flag dimension. */
  drivenNeurons?: Set<number>;
}

export interface ElasticCoreResult {
  output: Float32Array;
  settledState: Float32Array;
  ticks: number;
  converged: boolean;
  residual: number;
  inputTopography: Map<number, number>;
  /** Per-neuron L1 state movement during the settle, for vale-budget feedback. */
  stateDeltas: Map<number, number>;
  /** Mean absolute residual introduced by the quantizer on this forward pass. */
  quantizationDrift: number;
}

export interface DefinitionCheckResult {
  neuronId: number;
  loss: number;
  satisfied: boolean;
  readout: Float32Array;
  target: Float32Array;
}

export interface ElasticCoreParameters {
  weights: Float32Array;
  biases: Float32Array;
  inputProjection: Float32Array;
  outputProjection: Float32Array;
  shapes: {
    weights: [targetNeurons: number, sourceNeurons: number, outDim: number, inDim: number];
    biases: [neurons: number, stateDim: number];
    inputProjection: [inputDim: number, stateDim: number];
    outputProjection: [stateDim: number, outputDim: number];
  };
}

export interface ElasticCoreGradients {
  weights?: Float32Array;
  biases?: Float32Array;
  inputProjection?: Float32Array;
  outputProjection?: Float32Array;
}

export interface ElasticCoreGradientOptions {
  learningRate?: number;
  weightDecay?: number;
  /** Vale fraction per neuron in [0,1]. High vale scales weight/bias updates down. */
  vale?: Map<number, number>;
  /** Additional multiplier applied after vale scaling. Defaults to 1. */
  scale?: number;
}

export interface ElasticCoreUpdateSummary {
  weightsL1: number;
  biasesL1: number;
  inputProjectionL1: number;
  outputProjectionL1: number;
}

/**
 * Experimental transformer-core replacement for NeuroClaw.
 *
 * This block intentionally keeps the surrounding transformer infrastructure
 * reusable: callers pass normal token/embedding vectors in and receive a normal
 * output embedding back. Internally, however, the attention/MLP block is
 * replaced by a true all-to-all mesh of multidimensional neurons. Every source
 * neuron owns a dense state vector and every target neuron receives a full
 * stateDim x stateDim weight block from every other source neuron. Bias is
 * added exactly once per target neuron/dimension after all incoming products
 * are summed.
 */
export class ElasticCoreBlock {
  private neuronCount: number;
  private readonly stateDim: number;
  private readonly inputDim: number;
  private readonly outputDim: number;
  private readonly maxTicks: number;
  private readonly convergenceThreshold: number;
  private readonly inputFlagDim: number;
  private readonly quantizationAware: boolean;
  private readonly quantizationBits: number;
  private quantizationResidual: Float32Array;
  private state: Float32Array;
  private bias: Float32Array;
  private weights: Float32Array;
  private inputProjection: Float32Array;
  private outputProjection: Float32Array;
  private nextState: Float32Array;
  private directInputFlags: Float32Array;
  private groups: Map<number, string> = new Map();
  private definitionTargets: Map<number, Float32Array> = new Map();
  private rngState: number;

  // Bolt's Optimization: Reusable scratch buffers to eliminate GC pressure in forward pass hot-paths
  private startState: Float32Array;
  private vAlloc: Float32Array;
  private frozen: Uint8Array;
  private sums: Float32Array;

  constructor(config: ElasticCoreConfig = {}) {
    this.neuronCount = config.neuronCount ?? 16;
    this.stateDim = config.stateDim ?? 8;
    this.inputDim = config.inputDim ?? this.stateDim;
    this.outputDim = config.outputDim ?? this.inputDim;
    this.maxTicks = config.maxTicks ?? 32;
    this.convergenceThreshold = config.convergenceThreshold ?? 1e-3;
    this.inputFlagDim = Math.min(this.stateDim - 1, Math.max(0, config.inputFlagDim ?? 0));
    this.quantizationAware = config.quantizationAware ?? false;
    this.quantizationBits = Math.max(2, Math.min(16, Math.floor(config.quantizationBits ?? 8)));
    this.rngState = config.seed ?? 123456789;

    this.state = new Float32Array(this.neuronCount * this.stateDim);
    this.quantizationResidual = new Float32Array(this.state.length);
    this.bias = new Float32Array(this.neuronCount * this.stateDim);
    this.weights = new Float32Array(this.neuronCount * this.neuronCount * this.stateDim * this.stateDim);
    this.inputProjection = new Float32Array(this.inputDim * this.stateDim);
    this.outputProjection = new Float32Array(this.stateDim * this.outputDim);
    this.nextState = new Float32Array(this.neuronCount * this.stateDim);
    this.directInputFlags = new Float32Array(this.neuronCount);

    // Bolt's Optimization: Initialize scratch buffers to avoid allocation inside forward loop
    this.startState = new Float32Array(this.neuronCount * this.stateDim);
    this.vAlloc = new Float32Array(this.neuronCount);
    this.frozen = new Uint8Array(this.neuronCount);
    this.sums = new Float32Array(this.stateDim);

    const scale = config.weightScale ?? Math.sqrt(1 / Math.max(1, this.neuronCount * this.stateDim));
    for (let i = 0; i < this.bias.length; i++) this.bias[i] = (this.rand() * 2 - 1) * 0.05;
    for (let t = 0; t < this.neuronCount; t++) {
      for (let s = 0; s < this.neuronCount; s++) {
        if (t === s) continue;
        for (let od = 0; od < this.stateDim; od++) {
          for (let id = 0; id < this.stateDim; id++) {
            this.weights[this.weightIndex(t, s, od, id)] = (this.rand() * 2 - 1) * scale;
          }
        }
      }
    }
    for (let i = 0; i < this.inputProjection.length; i++) this.inputProjection[i] = (this.rand() * 2 - 1) * scale;
    for (let i = 0; i < this.outputProjection.length; i++) this.outputProjection[i] = (this.rand() * 2 - 1) * scale;
  }

  setNeuronGroup(neuronId: number, group: string): void {
    this.assertNeuron(neuronId);
    this.groups.set(neuronId, group);
  }

  getNeuronCount(): number {
    return this.neuronCount;
  }

  getStateDim(): number {
    return this.stateDim;
  }

  connectionDensity(): number {
    return this.neuronCount <= 1 ? 0 : 1.0;
  }

  connectionBlock(target: number, source: number): Float32Array {
    this.assertNeuron(target); this.assertNeuron(source);
    const block = new Float32Array(this.stateDim * this.stateDim);
    for (let od = 0; od < this.stateDim; od++) for (let id = 0; id < this.stateDim; id++) {
      block[od * this.stateDim + id] = this.weights[this.weightIndex(target, source, od, id)];
    }
    return block;
  }

  /**
   * Program an explicit dense source->target block. This is how extension
   * builder definitions can install cross-dimensional links directly: every
   * output dimension of the target can read every input dimension of the source.
   */
  setConnectionBlock(target: number, source: number, block: Float32Array | number[]): void {
    this.assertNeuron(target); this.assertNeuron(source);
    if (target === source) throw new Error('self-connections are not part of the all-to-all core');
    if (block.length !== this.stateDim * this.stateDim) {
      throw new Error(`connection block must have ${this.stateDim * this.stateDim} entries`);
    }
    for (let od = 0; od < this.stateDim; od++) {
      for (let id = 0; id < this.stateDim; id++) {
        this.weights[this.weightIndex(target, source, od, id)] = block[od * this.stateDim + id];
      }
    }
  }

  /** Convenience helper for DSL-style scalar connections: fill the whole block. */
  setConnectionScalar(target: number, source: number, weight: number): void {
    this.setConnectionBlock(target, source, new Float32Array(this.stateDim * this.stateDim).fill(weight));
  }

  setDefinitionTarget(neuronId: number, target: ArrayLike<number>): void {
    this.assertNeuron(neuronId);
    const v = new Float32Array(this.stateDim);
    for (let i = 0; i < this.stateDim; i++) v[i] = target[i] ?? 0;
    this.definitionTargets.set(neuronId, v);
  }

  checkDefinition(neuronId: number, tolerance = 0.25): DefinitionCheckResult {
    this.assertNeuron(neuronId);
    const target = this.definitionTargets.get(neuronId) ?? new Float32Array(this.stateDim);
    const readout = new Float32Array(this.state.subarray(neuronId * this.stateDim, (neuronId + 1) * this.stateDim));
    let loss = 0;
    for (let d = 0; d < this.stateDim; d++) {
      const e = target[d] - readout[d];
      loss += e * e;
    }
    loss /= this.stateDim;
    return { neuronId, loss, satisfied: loss <= tolerance, readout, target };
  }

  /**
   * Add a live neuron to the core and wire it all-to-all with every existing
   * neuron. This is the Elastic Core side of the extension-builder story:
   * newly materialized NeuroLang/skill neurons become ordinary mesh neurons,
   * not a side table or separate adapter layer. Existing weights are preserved.
   */
  addNeuron(group?: string): number {
    const oldCount = this.neuronCount;
    const newCount = oldCount + 1;
    const newState = new Float32Array(newCount * this.stateDim);
    newState.set(this.state);
    const newResidual = new Float32Array(newCount * this.stateDim);
    newResidual.set(this.quantizationResidual);
    const newBias = new Float32Array(newCount * this.stateDim);
    newBias.set(this.bias);
    for (let d = 0; d < this.stateDim; d++) {
      newBias[oldCount * this.stateDim + d] = (this.rand() * 2 - 1) * 0.05;
    }
    const newDirectFlags = new Float32Array(newCount);
    newDirectFlags.set(this.directInputFlags);

    const oldWeights = this.weights;
    const newWeights = new Float32Array(newCount * newCount * this.stateDim * this.stateDim);
    const scale = Math.sqrt(1 / Math.max(1, newCount * this.stateDim));
    const newIndex = (target: number, source: number, outDim: number, inDim: number): number =>
      (((target * newCount + source) * this.stateDim + outDim) * this.stateDim + inDim);
    const oldIndex = (target: number, source: number, outDim: number, inDim: number): number =>
      (((target * oldCount + source) * this.stateDim + outDim) * this.stateDim + inDim);

    for (let t = 0; t < newCount; t++) {
      for (let src = 0; src < newCount; src++) {
        if (t === src) continue;
        for (let od = 0; od < this.stateDim; od++) {
          for (let id = 0; id < this.stateDim; id++) {
            if (t < oldCount && src < oldCount) {
              newWeights[newIndex(t, src, od, id)] = oldWeights[oldIndex(t, src, od, id)];
            } else {
              newWeights[newIndex(t, src, od, id)] = (this.rand() * 2 - 1) * scale;
            }
          }
        }
      }
    }

    this.neuronCount = newCount;
    this.state = newState;
    this.quantizationResidual = newResidual;
    this.bias = newBias;
    this.weights = newWeights;
    this.nextState = new Float32Array(newCount * this.stateDim);
    this.directInputFlags = newDirectFlags;

    // Bolt's Optimization: Resize scratch buffers when neuron count changes
    this.startState = new Float32Array(newCount * this.stateDim);
    this.vAlloc = new Float32Array(newCount);
    this.frozen = new Uint8Array(newCount);

    if (group !== undefined) this.groups.set(oldCount, group);
    return oldCount;
  }

  /**
   * Optimizer-facing structured parameter view. The returned typed arrays are
   * live references, so AdamW-style trainers can keep moments keyed to these
   * arrays and mutate them directly when needed.
   */
  getParameters(): ElasticCoreParameters {
    return {
      weights: this.weights,
      biases: this.bias,
      inputProjection: this.inputProjection,
      outputProjection: this.outputProjection,
      shapes: {
        weights: [this.neuronCount, this.neuronCount, this.stateDim, this.stateDim],
        biases: [this.neuronCount, this.stateDim],
        inputProjection: [this.inputDim, this.stateDim],
        outputProjection: [this.stateDim, this.outputDim],
      },
    };
  }

  /** Apply SGD/AdamW-compatible gradients in-place, with optional vale masks. */
  applyGradients(gradients: ElasticCoreGradients, options: ElasticCoreGradientOptions = {}): ElasticCoreUpdateSummary {
    const lr = options.learningRate ?? 1;
    const decay = options.weightDecay ?? 0;
    const scale = options.scale ?? 1;
    const summary: ElasticCoreUpdateSummary = { weightsL1: 0, biasesL1: 0, inputProjectionL1: 0, outputProjectionL1: 0 };

    if (gradients.weights) {
      this.assertGradientLength('weights', gradients.weights, this.weights.length);
      for (let t = 0; t < this.neuronCount; t++) {
        const tScale = this.updateScaleForNeuron(t, options.vale) * scale;
        for (let s = 0; s < this.neuronCount; s++) for (let od = 0; od < this.stateDim; od++) for (let id = 0; id < this.stateDim; id++) {
          const i = this.weightIndex(t, s, od, id);
          const update = lr * tScale * (gradients.weights[i] + decay * this.weights[i]);
          if (Number.isFinite(update)) { this.weights[i] -= update; summary.weightsL1 += Math.abs(update); }
        }
      }
    }

    if (gradients.biases) {
      this.assertGradientLength('biases', gradients.biases, this.bias.length);
      for (let n = 0; n < this.neuronCount; n++) {
        const nScale = this.updateScaleForNeuron(n, options.vale) * scale;
        for (let d = 0; d < this.stateDim; d++) {
          const i = n * this.stateDim + d;
          const update = lr * nScale * (gradients.biases[i] + decay * this.bias[i]);
          if (Number.isFinite(update)) { this.bias[i] -= update; summary.biasesL1 += Math.abs(update); }
        }
      }
    }

    if (gradients.inputProjection) {
      this.assertGradientLength('inputProjection', gradients.inputProjection, this.inputProjection.length);
      for (let i = 0; i < this.inputProjection.length; i++) {
        const update = lr * scale * (gradients.inputProjection[i] + decay * this.inputProjection[i]);
        if (Number.isFinite(update)) { this.inputProjection[i] -= update; summary.inputProjectionL1 += Math.abs(update); }
      }
    }

    if (gradients.outputProjection) {
      this.assertGradientLength('outputProjection', gradients.outputProjection, this.outputProjection.length);
      for (let d = 0; d < this.stateDim; d++) {
        let dimScale = 0;
        for (let n = 0; n < this.neuronCount; n++) dimScale += this.updateScaleForNeuron(n, options.vale);
        dimScale = (dimScale / this.neuronCount) * scale;
        for (let o = 0; o < this.outputDim; o++) {
          const i = d * this.outputDim + o;
          const update = lr * dimScale * (gradients.outputProjection[i] + decay * this.outputProjection[i]);
          if (Number.isFinite(update)) { this.outputProjection[i] -= update; summary.outputProjectionL1 += Math.abs(update); }
        }
      }
    }
    return summary;
  }

  forward(input: Float32Array, options: ElasticCoreRunOptions = {}): ElasticCoreResult {
    const driven = options.drivenNeurons ?? new Set([0]);
    const N = this.neuronCount;
    const SD = this.stateDim;
    this.clearDirectInputFlags();

    for (const n of driven) {
      if (n >= 0 && n < N) {
        this.directInputFlags[n] = 1;
        this.inject(n, input, true);
      }
    }

    // Bolt's Optimization: Copy state to pre-allocated startState and reuse pre-allocated scratch arrays
    this.startState.set(this.state);
    const startState = this.startState;
    const vAlloc = this.vAlloc;
    const frozen = this.frozen;

    // Clear frozen flags before reuse
    frozen.fill(0);

    for (let t = 0; t < N; t++) {
      vAlloc[t] = Math.min(1, Math.max(0, options.vale?.get(t) ?? 0));
      const group = this.groups.get(t);
      if (!driven.has(t) && options.activeGroups !== undefined && group !== undefined && !options.activeGroups.has(group)) {
        frozen[t] = 1;
      }
    }

    let ticks = 0, residual = 0, converged = false;
    const next = this.nextState;
    const weights = this.weights;
    const bias = this.bias;

    const sums = this.sums;
    for (; ticks < this.maxTicks; ticks++) {
      const curr = this.state;
      for (let t = 0; t < N; t++) {
        const off = t * SD;
        if (frozen[t]) {
          for (let d = 0; d < SD; d++) next[off + d] = curr[off + d];
          continue;
        }

        for (let od = 0; od < SD; od++) {
          sums[od] = bias[off + od];
        }

        // Split source loop to eliminate "s === t" branch with 4x loop unrolling
        for (let s = 0; s < t; s++) {
          const sOff = s * SD;
          const wBase = (t * N + s) * SD * SD;
          for (let od = 0; od < SD; od++) {
            const wRowOff = wBase + od * SD;
            let sum = sums[od];
            let id = 0;
            for (; id <= SD - 4; id += 4) {
              sum += curr[sOff + id] * weights[wRowOff + id]
                   + curr[sOff + id + 1] * weights[wRowOff + id + 1]
                   + curr[sOff + id + 2] * weights[wRowOff + id + 2]
                   + curr[sOff + id + 3] * weights[wRowOff + id + 3];
            }
            for (; id < SD; id++) {
              sum += curr[sOff + id] * weights[wRowOff + id];
            }
            sums[od] = sum;
          }
        }

        for (let s = t + 1; s < N; s++) {
          const sOff = s * SD;
          const wBase = (t * N + s) * SD * SD;
          for (let od = 0; od < SD; od++) {
            const wRowOff = wBase + od * SD;
            let sum = sums[od];
            let id = 0;
            for (; id <= SD - 4; id += 4) {
              sum += curr[sOff + id] * weights[wRowOff + id]
                   + curr[sOff + id + 1] * weights[wRowOff + id + 1]
                   + curr[sOff + id + 2] * weights[wRowOff + id + 2]
                   + curr[sOff + id + 3] * weights[wRowOff + id + 3];
            }
            for (; id < SD; id++) {
              sum += curr[sOff + id] * weights[wRowOff + id];
            }
            sums[od] = sum;
          }
        }

        const v = vAlloc[t];
        const oneMinusV = 1 - v;
        for (let od = 0; od < SD; od++) {
          next[off + od] = v * curr[off + od] + oneMinusV * Math.tanh(sums[od]);
        }
      }

      this.applyQuantizationInPlace(next);
      for (const n of driven) if (n >= 0 && n < N) next[n * SD + this.inputFlagDim] = 1;

      residual = 0;
      for (let i = 0; i < next.length; i++) {
        const diff = next[i] - curr[i];
        residual += diff < 0 ? -diff : diff;
        curr[i] = next[i];
      }
      if (residual < this.convergenceThreshold) { converged = true; ticks++; break; }
    }

    return {
      output: this.readout(),
      settledState: new Float32Array(this.state),
      ticks,
      converged,
      residual,
      inputTopography: this.inputTopography(),
      stateDeltas: this.stateDeltas(startState),
      quantizationDrift: this.meanAbs(this.quantizationResidual),
    };
  }

  private clearDirectInputFlags(): void {
    for (let n = 0; n < this.neuronCount; n++) {
      this.state[n * this.stateDim + this.inputFlagDim] = 0;
      this.directInputFlags[n] = 0;
    }
  }

  private inject(neuronId: number, input: Float32Array, flag: boolean): void {
    const off = neuronId * this.stateDim;
    for (let od = 0; od < this.stateDim; od++) {
      let sum = 0;
      for (let i = 0; i < Math.min(input.length, this.inputDim); i++) sum += input[i] * this.inputProjection[i * this.stateDim + od];
      this.state[off + od] = Math.tanh(sum);
    }
    if (flag) this.state[off + this.inputFlagDim] = 1;
  }

  /**
   * Section 8: In-place quantization with residual feedback. Compares each
   * state's candidate value (plus its accumulated error) to the nearest
   * dequantized level, then stores the new rounding error back into the
   * residual buffer so it is compensated for on the next tick. This lets
   * the network learn to "expect" its own quantized substrate.
   */
  /**
   * Section 8: In-place quantization with residual feedback. Compares each
   * state's candidate value (plus its accumulated error) to the nearest
   * dequantized level, then stores the new rounding error back into the
   * residual buffer so it is compensated for on the next tick. This lets
   * the network learn to "expect" its own quantized substrate.
   * 
   * Optimization: SIMD-friendly loop unrolling and branch-free clamping.
   */
  private applyQuantizationInPlace(next: Float32Array): void {
    if (!this.quantizationAware) {
      return;
    }
    const levels = (1 << this.quantizationBits) - 1;
    const invLevels = 1.0 / levels;
    const len = next.length;
    
    // Process in chunks of 4 for better CPU pipeline utilization
    let i = 0;
    for (; i + 3 < len; i += 4) {
      for (let j = 0; j < 4; j++) {
        const idx = i + j;
        const compensated = next[idx] + this.quantizationResidual[idx];
        const clamped = compensated < -1 ? -1 : (compensated > 1 ? 1 : compensated);
        const q = Math.round(((clamped + 1) * 0.5) * levels);
        const dequantized = q * invLevels * 2 - 1;
        this.quantizationResidual[idx] = clamped - dequantized;
        next[idx] = dequantized;
      }
    }
    // Handle remaining elements
    for (; i < len; i++) {
      const compensated = next[i] + this.quantizationResidual[i];
      const clamped = compensated < -1 ? -1 : (compensated > 1 ? 1 : compensated);
      const q = Math.round(((clamped + 1) * 0.5) * levels);
      const dequantized = q * invLevels * 2 - 1;
      this.quantizationResidual[i] = clamped - dequantized;
      next[i] = dequantized;
    }
  }

  private readout(): Float32Array {
    const mean = new Float32Array(this.stateDim);
    for (let n = 0; n < this.neuronCount; n++) for (let d = 0; d < this.stateDim; d++) mean[d] += this.state[n * this.stateDim + d] / this.neuronCount;
    const out = new Float32Array(this.outputDim);
    for (let o = 0; o < this.outputDim; o++) for (let d = 0; d < this.stateDim; d++) out[o] += mean[d] * this.outputProjection[d * this.outputDim + o];
    return out;
  }

  private meanAbs(values: Float32Array): number {
    let sum = 0;
    for (const value of values) sum += Math.abs(value);
    return sum / Math.max(1, values.length);
  }

  private stateDeltas(startState: Float32Array): Map<number, number> {
    const deltas = new Map<number, number>();
    for (let n = 0; n < this.neuronCount; n++) {
      let delta = 0;
      for (let d = 0; d < this.stateDim; d++) {
        const i = n * this.stateDim + d;
        delta += Math.abs(this.state[i] - startState[i]);
      }
      deltas.set(n, delta);
    }
    return deltas;
  }

  private inputTopography(): Map<number, number> {
    const topography = new Map<number, number>();
    for (let n = 0; n < this.neuronCount; n++) topography.set(n, this.directInputFlags[n]);
    return topography;
  }

  private weightIndex(target: number, source: number, outDim: number, inDim: number): number {
    return this.weightIndexForCount(this.neuronCount, target, source, outDim, inDim);
  }

  private weightIndexForCount(count: number, target: number, source: number, outDim: number, inDim: number): number {
    return (((target * count + source) * this.stateDim + outDim) * this.stateDim + inDim);
  }

  private updateScaleForNeuron(neuronId: number, vale?: Map<number, number>): number {
    const v = Math.min(1, Math.max(0, vale?.get(neuronId) ?? 0));
    return 1 - v;
  }

  private assertGradientLength(name: string, gradient: Float32Array, expected: number): void {
    if (gradient.length !== expected) throw new Error(`${name} gradient length ${gradient.length} !== ${expected}`);
  }

  private rand(): number {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private assertNeuron(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.neuronCount) throw new Error(`neuron id out of range: ${id}`);
  }
}

// ============================================================================
// hyperdimensional.ts
// ============================================================================

const dAdd = dualAdd;
const dScale = dualScale;

export interface HyperNeuron {
  id: number;
  /**
   * State vector, length = dimensions + 1. Index 0 is a reserved input-flag
   * dimension (1.0 when this neuron is directly externally driven this tick,
   * decaying/diffusing otherwise via the same propagation as any other
   * dimension); indices 1..dimensions are content.
   */
  state: Float32Array;
  energy: number;
  transitions: StateTransition[];
  influenceRadius: number;
  activationThreshold: number;
}

export interface StateTransition {
  fromState: Float32Array;
  toState: Float32Array;
  energy: number;
  timestamp: number;
  cause: string;
}

export interface HyperDimensionalOutput {
  outputVector: number[];
  activeStates: HyperNeuron[];
  totalEnergy: number;
  dimensionalEntropy: number;
  noveltyScore: number;
  transitionCount: number;
  /** Sum of absolute per-dimension state change this tick, keyed by neuron id */
  stateDeltas: Map<number, number>;
  /**
   * |predicted - actual| between the compressed self-model's forecast of
   * this tick's outputVector (made at the end of the previous tick) and what
   * actually happened. 0 on the first tick, when there is no prior forecast.
   */
  selfModelSurprise: number;
  /** Number of sustained-divergence corrections applied during this tick's settle loop. */
  liveCorrections: number;
  /** Per-neuron reading of the input-flag dimension after settling: how close each neuron is, this tick, to a directly-driven input. */
  inputTopography: Map<number, number>;
  /** Iterations the settle loop actually ran (<= propagationSteps). */
  settleIterations: number;
}

export interface HyperConfig {
  neuronCount: number;
  /** Content dimensions per neuron (excludes the reserved input-flag dimension). */
  dimensions: number;
  stateBits: number;
  learningRate: number;
  influenceDecay: number;
  energyThreshold: number;
  noveltyWindow: number;
  crossInfluenceStrength: number;
  /** Max iterations of propagate-to-convergence per process() call. */
  propagationSteps: number;
  /** Settle loop stops early once total residual change drops below this. */
  convergenceThreshold: number;
  /** Rank of the compressed self-model used for meta-awareness (section 10). */
  selfModelRank: number;
  /** Live-correction (section 12): per-iteration divergence above this is "off track". */
  divergenceTolerance: number;
  /** Live-correction: how many consecutive off-track iterations before damping kicks in. */
  sustainedDivergenceTicks: number;
}

export interface SeenPattern {
  hash: string;
  frequency: number;
  firstSeen: number;
  lastSeen: number;
  novelty: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Pearson correlation of two equal-length series; 0 if undefined (no variance). */
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

export class HyperDimensionalEngine {
  private config: HyperConfig;
  private neurons: HyperNeuron[];
  private seenPatterns: Map<string, SeenPattern>;
  private history: StateTransition[];
  private iteration: number = 0;
  private totalDims: number;

  /**
   * process() runs on every live NeuroclawLLM.generate() call, and none of
   * `history`, each neuron's own `transitions`, or `seenPatterns` had any
   * bound at all -- the constructor's `historyLength` config option (passed
   * by llm.js expecting a real cap) is actually aliased into `noveltyWindow`,
   * a recency-decay time constant, not an entry limit; nothing in this file
   * ever trims any of the three. `history` in particular has zero readers
   * anywhere in this file -- pure accumulated dead weight from the start.
   * Only the *last* entry of a neuron's `transitions` is ever read
   * (resolveStateTransitions()'s `fromState` lookup), so trimming from the
   * front is always safe there. `seenPatterns` eviction here is by
   * insertion order (first-seen), not true least-recently-used -- an honest
   * simplification, not a claim of LRU precision, matching the same
   * plain-cap approach already used for SharedBlackboard's log.
   */
  private readonly historyCapacity = 5000;
  private readonly perNeuronTransitionsCapacity = 100;
  private readonly seenPatternsCapacity = 5000;

  /**
   * Section 8: persistent per-connection weight tensor, all-to-all.
   * Flattened for cache locality: [targetNeuron][dimension][sourceNeuron]
   * This ensures that for a fixed target neuron i and dimension d,
   * we can iterate over all source neurons j sequentially.
   */
  private connDiag: Float32Array;
  private connShift: Float32Array;

  /** Bias is per-neuron (added once after the full summed product) */
  private bias: Float32Array;

  /** Consolidated state buffer: [dimension][neuron] for sequential access in hot loop */
  private allStates: Float32Array;

  // Section 10: compressed (rank-r) self-model
  private selfModelA: Float32Array;
  private selfModelB: Float32Array;
  private lastOutputVector: number[] | null = null;

  // Section 12: fast intra-settle self-model (EMA over mean content energy)
  private emaEnergy: number = 0;
  private hasEma: boolean = false;
  private sustainedDivergence: number = 0;

  // Pre-allocated scratch buffers
  private nextStatesBuffer: Float32Array;
  private tempCtx: Float32Array;
  private stateDeltasBuffer: Float32Array;
  private entropyHist: Uint32Array;
  private preSettleStatesBuffer: Float32Array;
  private preSettleEnergiesBuffer: Float32Array;
  private defaultDrivenIds: Set<number>;
  private selfModelHScratch: Float32Array;
  private selfModelErrorScratch: Float32Array;
  private selfModelDHScratch: Float32Array;
  private entropyLookup: Float64Array;

  private stateViews: Float32Array[];
  private isDrivenScratch: Uint8Array;
  private drivenIndicesScratch: Int32Array;
  private nonDrivenIndicesScratch: Int32Array;
  private vsScratch: Float32Array;
  private hasVScratch: Uint8Array;
  private ratesScratch: Float32Array;
  private deltaSumsScratch: Float32Array;

  constructor(config: Record<string, any> = {}) {
    this.config = {
      neuronCount: config.neuronCount ?? 100,
      dimensions: config.dimensions ?? config.hyperDimensions ?? 64,
      stateBits: config.stateBits ?? config.ballStates ?? 8,
      learningRate: config.learningRate ?? 0.1,
      influenceDecay: config.influenceDecay ?? config.noveltyDecay ?? 0.9,
      energyThreshold: config.stateTransitionThreshold ?? config.energyThreshold ?? 0.5,
      noveltyWindow: config.historyLength ?? config.noveltyWindow ?? 1000,
      crossInfluenceStrength: config.crossInfluenceStrength ?? 0.3,
      propagationSteps: config.propagationSteps ?? 8,
      convergenceThreshold: config.convergenceThreshold ?? 0.05,
      selfModelRank: config.selfModelRank ?? 4,
      divergenceTolerance: config.divergenceTolerance ?? 0.05,
      sustainedDivergenceTicks: config.sustainedDivergenceTicks ?? 3,
    };
    const N = this.config.neuronCount;
    const D = this.config.dimensions + 1;
    this.totalDims = D;
    this.neurons = [];
    this.seenPatterns = new Map();
    this.history = [];

    this.allStates = new Float32Array(D * N);
    this.connDiag = new Float32Array(N * D * N);
    this.connShift = new Float32Array(N * D * N);
    this.bias = new Float32Array(N * D);

    this.nextStatesBuffer = new Float32Array(N * D);
    this.tempCtx = new Float32Array(D);
    this.stateDeltasBuffer = new Float32Array(N);
    this.entropyHist = new Uint32Array(10);

    this.initializeNeurons();
    this.initializeConnections();

    this.preSettleStatesBuffer = new Float32Array(D * N);
    this.preSettleEnergiesBuffer = new Float32Array(N);
    this.defaultDrivenIds = new Set(this.neurons.map(n => n.id));

    // Pre-calculate the entropy lookup table for fast dimensional entropy calculations.
    // Since count is always an integer from 0 to N (neuronCount), there are exactly N + 1 possible probabilities.
    // Pre-calculating p * Math.log2(p) avoids transcendental Math.log2 calls in the hot loop.
    this.entropyLookup = new Float64Array(N + 1);
    this.entropyLookup[0] = 0; // 0 * log2(0) = 0
    for (let c = 1; c <= N; c++) {
      const p = c / N;
      this.entropyLookup[c] = p * Math.log2(p);
    }

    const rank = this.config.selfModelRank;
    const dims = this.config.dimensions;
    this.selfModelA = new Float32Array(dims * rank);
    this.selfModelB = new Float32Array(rank * dims);
    this.selfModelHScratch = new Float32Array(rank);
    this.selfModelErrorScratch = new Float32Array(dims);
    this.selfModelDHScratch = new Float32Array(rank);
    const scale = Math.sqrt(1 / Math.max(1, dims));
    for (let i = 0; i < this.selfModelA.length; i++) this.selfModelA[i] = (Math.random() * 2 - 1) * scale;
    for (let i = 0; i < this.selfModelB.length; i++) this.selfModelB[i] = (Math.random() * 2 - 1) * scale;

    this.stateViews = new Array<Float32Array>(D);
    for (let d = 0; d < D; d++) {
      this.stateViews[d] = this.allStates.subarray(d * N, (d + 1) * N);
    }
    this.isDrivenScratch = new Uint8Array(N);
    this.drivenIndicesScratch = new Int32Array(N);
    this.nonDrivenIndicesScratch = new Int32Array(N);
    this.vsScratch = new Float32Array(N);
    this.hasVScratch = new Uint8Array(N);
    this.ratesScratch = new Float32Array(N);
    this.deltaSumsScratch = new Float32Array(N);
  }

  /**
   * Run one tick: settle the mesh to convergence for the given input, apply
   * value-gated Hebbian weight learning, and derive all reported signals.
   */
  process(
    inputVector: number[] | Map<string, Float32Array>,
    learningRates?: Map<number, number>,
    directInputNeuronIds?: Set<number>,
    vale?: Map<number, number>
  ): HyperDimensionalOutput {
    let resolvedInput: number[];
    if (inputVector instanceof Map) {
      const arrays = Array.from(inputVector.values());
      if (arrays.length > 0) {
        resolvedInput = Array.from(arrays[0]);
      } else {
        resolvedInput = new Array(this.config.dimensions).fill(0);
      }
    } else {
      resolvedInput = inputVector;
    }

    const drivenIds = directInputNeuronIds ?? this.defaultDrivenIds;

    const N = this.neurons.length;
    const D = this.totalDims;

    // Fast pre-allocated copy
    this.preSettleStatesBuffer.set(this.allStates);
    for (let idx = 0; idx < N; idx++) {
      this.preSettleEnergiesBuffer[idx] = this.neurons[idx].energy;
    }

    const { stateDeltas, liveCorrections, iterations } = this.settle(resolvedInput, drivenIds, vale);

    this.applyWeightLearning(learningRates, stateDeltas);

    const transitions: StateTransition[] = [];
    for (let idx = 0; idx < N; idx++) {
      const neuron = this.neurons[idx];
      const newEnergy = this.computeStateEnergy(neuron.state);
      const oldEnergy = this.preSettleEnergiesBuffer[idx];
      if (newEnergy !== oldEnergy) {
        const fromState = new Float32Array(D);
        for (let d = 0; d < D; d++) {
          fromState[d] = this.preSettleStatesBuffer[d * N + idx];
        }
        transitions.push({
          fromState,
          toState: new Float32Array(neuron.state),
          energy: newEnergy - oldEnergy,
          timestamp: Date.now(),
          cause: 'input_update',
        });
      }
      neuron.energy = newEnergy;
    }

    const resolvedTransitions = this.resolveStateTransitions();

    const activeStates: HyperNeuron[] = [];
    const threshold = this.config.energyThreshold;
    for (let i = 0; i < N; i++) {
      const n = this.neurons[i];
      if (n.energy > threshold) {
        activeStates.push(n);
      }
    }
    const resolvedActive = activeStates.length > 0 ? activeStates : this.neurons;

    const outputVector = this.computeOutputVector(resolvedActive);

    let totalEnergy = 0;
    for (let idx = 0; idx < N; idx++) {
      totalEnergy += this.neurons[idx].energy;
    }

    const dimensionalEntropy = this.computeDimensionalEntropy();
    const patternHash = this.hashVector(outputVector);
    const patternNovelty = this.computeNoveltyScore(patternHash);

    let selfModelSurprise = 0;
    if (this.lastOutputVector) {
      const predicted = this.selfModelPredict(this.lastOutputVector);
      selfModelSurprise = this.meanAbsDiff(predicted, outputVector);
      this.selfModelTrainStep(this.lastOutputVector, predicted, outputVector);
    }
    this.lastOutputVector = outputVector;

    const noveltyScore = clamp(0.6 * patternNovelty + 0.4 * selfModelSurprise, 0, 1);

    this.recordPattern(patternHash, noveltyScore);
    this.history.push(...transitions, ...resolvedTransitions);
    if (this.history.length > this.historyCapacity) {
      this.history.splice(0, this.history.length - this.historyCapacity);
    }
    this.iteration++;

    const inputTopography = new Map<number, number>();
    for (let idx = 0; idx < N; idx++) {
      inputTopography.set(this.neurons[idx].id, this.neurons[idx].state[0]);
    }

    return {
      outputVector,
      activeStates: resolvedActive,
      totalEnergy,
      dimensionalEntropy,
      noveltyScore,
      transitionCount: resolvedTransitions.length,
      stateDeltas,
      selfModelSurprise,
      liveCorrections,
      inputTopography,
      settleIterations: iterations,
    };
  }

  hasSeenPattern(patternHash: string): boolean {
    return this.seenPatterns.has(patternHash);
  }

  getPatternNovelty(patternHash: string): number {
    return this.seenPatterns.get(patternHash)?.novelty ?? 1;
  }

  getSeenPatternCount(): number {
    return this.seenPatterns.size;
  }

  getHistory(): Array<{ hash: string; count: number; lastSeen: number; step: number }> {
    return Array.from(this.seenPatterns.entries()).map(([hash, pattern]) => ({
      hash,
      count: pattern.frequency,
      lastSeen: pattern.lastSeen,
      step: this.iteration,
    }));
  }

  getNeuronStates(): HyperNeuron[] {
    return this.neurons.map(n => ({ ...n, state: new Float32Array(n.state) }));
  }

  /** Total configured neuron count (fixed at construction). */
  getNeuronCount(): number {
    return this.neurons.length;
  }

  /** Content dimensions per neuron (excludes the reserved input-flag dimension). */
  getDimensions(): number {
    return this.config.dimensions;
  }

  /**
   * Section 2.3: directly set a connection's diagonal weight (targetId's
   * incoming weight from sourceId, for one content dimension) — the write
   * path the NeuroLang DSL's `@connections=` primitive uses to wire two
   * declared neurons together, rather than only ever learning weights
   * through Hebbian/delta-rule updates.
   */
  setConnectionWeight(targetId: number, sourceId: number, dim: number, weight: number): void {
    const D = this.totalDims;
    if (targetId === sourceId || dim < 0 || dim >= D) return;
    if (!this.neurons.some(n => n.id === targetId) || !this.neurons.some(n => n.id === sourceId)) return;
    const N = this.neurons.length;
    const idx = (targetId * D + dim) * N + sourceId;
    this.connDiag[idx] = clamp(weight, -2, 2);
  }

  getContextMatrix(): { data: Float32Array; neuronCount: number; dims: number } {
    const N = this.config.neuronCount;
    const D = this.totalDims;
    const data = new Float32Array(N * D);
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < D; d++) {
        data[i * D + d] = this.allStates[d * N + i];
      }
    }
    return { data, neuronCount: N, dims: D };
  }

  getInputTopography(): Map<number, number> {
    const map = new Map<number, number>();
    for (const n of this.neurons) map.set(n.id, n.state[0]);
    return map;
  }

  isExclusiveInput(threshold: number = 0.9): { exclusive: boolean; neuronId?: number } {
    const hot: number[] = [];
    for (const n of this.neurons) {
      if (n.state[0] >= threshold) hot.push(n.id);
    }
    return hot.length === 1 ? { exclusive: true, neuronId: hot[0] } : { exclusive: false };
  }

  /**
   * Section 9: on-demand symbolic trace. The mesh computes numerically (fast,
   * Pi-feasible); this reconstructs the *literal* pre-activation equation for
   * one neuron's dimension by walking backward through the weighted
   * connections that fed it, using the current settled state. Each term is
   * evaluated so callers see both the algebra and the numeric contribution,
   * ranked by magnitude — the human-readable version of the autograd graph.
   *
   * The settle rule reproduced here is:
   *   state_i[d] = tanh( bias_i[d]
   *     + Σ_j ( state_j[d]·Wdiag_ij[d]
   *           + state_j[(d-1)%D]·Wshift_ij[d]·crossInfluenceStrength ) )
   *
   * @returns null if the neuron/dimension is out of range.
   */
  traceNeuron(
    neuronId: number,
    dim: number,
    topK: number = 8
  ): {
    neuronId: number;
    dim: number;
    bias: number;
    preActivation: number;
    value: number;
    /**
     * True when this neuron was clamped to external input on the last tick
     * (its input-flag dimension is hot). Its stored state then comes from the
     * input, not from tanh(W·S), so `value` here is the *counterfactual* the
     * mesh would have settled to from its incoming connections alone, not the
     * clamped value actually held.
     */
    inputClamped: boolean;
    terms: Array<{ source: string; weight: number; sourceValue: number; contribution: number }>;
    equation: string;
  } | null {
    const D = this.totalDims;
    if (dim < 0 || dim >= D) return null;
    const target = this.neurons.find(n => n.id === neuronId);
    if (!target) return null;

    const N = this.neurons.length;
    const bias = this.bias[neuronId * D + dim];
    const rowOffset = (neuronId * D + dim) * N;
    const srcD = (dim - 1 + D) % D;
    const cross = this.config.crossInfluenceStrength;

    const terms: Array<{ source: string; weight: number; sourceValue: number; contribution: number }> = [];
    let preActivation = bias;
    for (const nj of this.neurons) {
      if (nj.id === neuronId) continue;
      const wd = this.connDiag[rowOffset + nj.id];
      const ws = this.connShift[rowOffset + nj.id];

      const diagContribution = nj.state[dim] * wd;
      preActivation += diagContribution;
      terms.push({ source: `n${nj.id}.d${dim}`, weight: wd, sourceValue: nj.state[dim], contribution: diagContribution });

      const shiftWeight = ws * cross;
      const shiftContribution = nj.state[srcD] * shiftWeight;
      preActivation += shiftContribution;
      terms.push({ source: `n${nj.id}.d${srcD}`, weight: shiftWeight, sourceValue: nj.state[srcD], contribution: shiftContribution });
    }

    terms.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const top = terms.slice(0, topK);

    const inputClamped = target.state[0] >= 0.9;

    const fmt = (v: number) => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(4);
    const body = top.map(t => `${fmt(t.weight)}·${t.source}`).join(' ');
    const omitted = terms.length > top.length ? ` … (+${terms.length - top.length} smaller terms)` : '';
    const clampNote = inputClamped ? ' [input-clamped: counterfactual]' : '';
    const equation = `n${neuronId}.d${dim} = tanh( ${fmt(bias)} ${body}${omitted} ) = ${Math.tanh(preActivation).toFixed(4)}${clampNote}`;

    return {
      neuronId,
      dim,
      bias,
      preActivation,
      value: Math.tanh(preActivation),
      inputClamped,
      terms: top,
      equation,
    };
  }

  /**
   * Section 4: declarative "definishon" training (neuron-level unit testing).
   * Each definition is a contract: when `driveNeuronId` is the *only*
   * externally-driven neuron (clamped to `input`), the mesh must settle so
   * that `readoutNeuronId`'s content matches `target`. We satisfy all
   * contracts at once by a delta-rule update on each readout neuron's incoming
   * weights (clamp → settle → check → adjust), plus a weight penalty so the
   * underdetermined solution prefers small weights.
   *
   * Contradictory contracts (e.g. same drive/readout, different targets) can
   * never all be satisfied; we detect them by tracking each contract's loss
   * over epochs and flagging pairs whose losses are strongly anti-correlated
   * (driving one down drives the other up).
   *
   * When a contract's loss is under `tolerance` its readout neuron is reported
   * as satisfied — the hook the notes describe for raising that neuron's vale
   * (locking it) in the external value budget.
   */
  trainDefinitions(
    definitions: Array<{ driveNeuronId: number; input: number[]; readoutNeuronId: number; target: number[] }>,
    opts: { epochs?: number; learningRate?: number; weightPenalty?: number; tolerance?: number } = {}
  ): {
    converged: boolean;
    epochs: number;
    losses: number[];
    satisfied: number[];
    conflicts: Array<{ a: number; b: number; correlation: number }>;
  } {
    const epochs = opts.epochs ?? 200;
    const lr = opts.learningRate ?? 0.1;
    const penalty = opts.weightPenalty ?? 1e-4;
    const tolerance = opts.tolerance ?? 1e-3;
    const dims = this.config.dimensions;
    const D = this.totalDims;

    const lossHistory: number[][] = definitions.map(() => []);
    let losses = definitions.map(() => Infinity);
    let converged = false;
    let ranEpochs = 0;

    for (let epoch = 0; epoch < epochs; epoch++) {
      ranEpochs = epoch + 1;
      losses = [];

      for (const def of definitions) {
        // clamp → settle → read
        this.settle(def.input, new Set([def.driveNeuronId]));
        const readout = this.neurons.find(n => n.id === def.readoutNeuronId);
        if (!readout) { losses.push(Infinity); continue; }

        // Delta rule on the readout's incoming diagonal weights, through tanh'.
        const N = this.neurons.length;
        const biasOffset = def.readoutNeuronId * D;
        let sse = 0;
        for (let d = 0; d < dims; d++) {
          const cd = d + 1; // content index (0 is the input flag)
          const actual = readout.state[cd];
          const err = (def.target[d] ?? 0) - actual;
          sse += err * err;
          const grad = err * (1 - actual * actual); // tanh'
          const rowOffset = (def.readoutNeuronId * D + cd) * N;
          for (const nj of this.neurons) {
            if (nj.id === def.readoutNeuronId) continue;
            const wdIdx = rowOffset + nj.id;
            this.connDiag[wdIdx] = clamp(this.connDiag[wdIdx] + lr * grad * nj.state[cd] - penalty * this.connDiag[wdIdx], -2, 2);
          }
          this.bias[biasOffset + cd] = clamp(this.bias[biasOffset + cd] + lr * grad - penalty * this.bias[biasOffset + cd], -1, 1);
        }
        losses.push(sse / dims);
      }

      for (let i = 0; i < definitions.length; i++) lossHistory[i].push(losses[i]);
      if (losses.every(l => l < tolerance)) { converged = true; break; }
    }

    const satisfied = definitions
      .map((def, i) => ({ id: def.readoutNeuronId, ok: losses[i] < tolerance }))
      .filter(x => x.ok)
      .map(x => x.id);

    const conflicts = this.detectDefinitionConflicts(definitions, losses, lossHistory, dims, tolerance);
    return { converged, epochs: ranEpochs, losses, satisfied, conflicts };
  }

  /**
   * Shared by trainDefinitions() (analytic delta rule) and
   * trainDefinitionsRandomSearch() (below) -- conflict detection doesn't
   * depend on which update rule got the losses to where they are, only on
   * the resulting loss trajectories and targets. A direct contradiction
   * (same readout, incompatible targets) drives both losses to a stuck,
   * near-flat equilibrium rather than a visibly oscillating one, so
   * anti-correlation of loss *levels* alone misses it. Combine two
   * signals over pairs that did not both converge: (1) a structural
   * check — they constrain the same readout to targets further apart
   * than tolerance allows; (2) anti-correlated loss *deltas* (satisfying
   * one epoch-over-epoch worsens the other).
   */
  private detectDefinitionConflicts(
    definitions: Array<{ readoutNeuronId: number; target: number[] }>,
    losses: number[],
    lossHistory: number[][],
    dims: number,
    tolerance: number,
  ): Array<{ a: number; b: number; correlation: number }> {
    const deltas = lossHistory.map(h => h.slice(1).map((v, k) => v - h[k]));
    const targetDist = (a: number[], b: number[]) => {
      let s = 0;
      for (let d = 0; d < dims; d++) { const e = (a[d] ?? 0) - (b[d] ?? 0); s += e * e; }
      return Math.sqrt(s / dims);
    };

    const conflicts: Array<{ a: number; b: number; correlation: number }> = [];
    for (let i = 0; i < definitions.length; i++) {
      for (let j = i + 1; j < definitions.length; j++) {
        if (losses[i] < tolerance && losses[j] < tolerance) continue;
        const structural =
          definitions[i].readoutNeuronId === definitions[j].readoutNeuronId &&
          targetDist(definitions[i].target, definitions[j].target) > Math.sqrt(tolerance);
        const corr = pearson(deltas[i], deltas[j]);
        if (structural || corr < -0.5) conflicts.push({ a: i, b: j, correlation: corr });
      }
    }
    return conflicts;
  }

  /**
   * Section 4 alternative: the SAME "clamp -> settle -> check -> adjust"
   * contract as trainDefinitions() above, but the adjustment itself is
   * random search (evolution-strategy style), not an analytic gradient --
   * "each variable is randomly changed, either positively or negatively;
   * if the result is good, move toward the change; if it's bad, move
   * away from it (revert)." Every definition's readout gets ONE random
   * step across all its incoming weights+bias together per epoch (not a
   * per-weight coordinate search, which would need one settle() call per
   * individual weight -- far too expensive for any real neuron count):
   * try the step, re-settle, keep it if the loss actually improved,
   * revert the whole step otherwise. Genuinely a different algorithm
   * from trainDefinitions()'s delta rule, not gradient descent given a
   * new name -- typically needs many more epochs to converge, since a
   * random step only has a roughly 50% chance of even pointing the right
   * direction, versus the delta rule's step being the exact direction of
   * steepest descent every time.
   */
  trainDefinitionsRandomSearch(
    definitions: Array<{ driveNeuronId: number; input: number[]; readoutNeuronId: number; target: number[] }>,
    opts: { epochs?: number; stepSize?: number; tolerance?: number } = {}
  ): {
    converged: boolean;
    epochs: number;
    losses: number[];
    satisfied: number[];
    conflicts: Array<{ a: number; b: number; correlation: number }>;
  } {
    const epochs = opts.epochs ?? 500; // random search needs more attempts than the delta rule to find the same minimum
    const stepSize = opts.stepSize ?? 0.15;
    const tolerance = opts.tolerance ?? 1e-3;
    const dims = this.config.dimensions;
    const D = this.totalDims;
    const N = this.neurons.length;

    const evalLoss = (def: { driveNeuronId: number; input: number[]; readoutNeuronId: number; target: number[] }): number => {
      this.settle(def.input, new Set([def.driveNeuronId]));
      const readout = this.neurons.find(n => n.id === def.readoutNeuronId);
      if (!readout) return Infinity;
      let sse = 0;
      for (let d = 0; d < dims; d++) {
        const err = (def.target[d] ?? 0) - readout.state[d + 1];
        sse += err * err;
      }
      return sse / dims;
    };

    const lossHistory: number[][] = definitions.map(() => []);
    let losses = definitions.map(() => Infinity);
    let converged = false;
    let ranEpochs = 0;

    for (let epoch = 0; epoch < epochs; epoch++) {
      ranEpochs = epoch + 1;
      losses = [];

      for (const def of definitions) {
        const baseline = evalLoss(def);
        const biasOffset = def.readoutNeuronId * D;

        // One random step across every weight+bias this readout has --
        // the same set trainDefinitions()'s delta rule updates -- tried
        // as a single unit, kept or reverted as a single unit.
        const snapshot: Array<{ idx: number; inDiag: boolean; value: number }> = [];
        for (let d = 0; d < dims; d++) {
          const cd = d + 1;
          const rowOffset = (def.readoutNeuronId * D + cd) * N;
          for (const nj of this.neurons) {
            if (nj.id === def.readoutNeuronId) continue;
            const wdIdx = rowOffset + nj.id;
            snapshot.push({ idx: wdIdx, inDiag: true, value: this.connDiag[wdIdx] });
            this.connDiag[wdIdx] = clamp(this.connDiag[wdIdx] + (Math.random() * 2 - 1) * stepSize, -2, 2);
          }
          const bIdx = biasOffset + cd;
          snapshot.push({ idx: bIdx, inDiag: false, value: this.bias[bIdx] });
          this.bias[bIdx] = clamp(this.bias[bIdx] + (Math.random() * 2 - 1) * stepSize, -1, 1);
        }

        const trial = evalLoss(def);
        if (trial < baseline) {
          losses.push(trial); // the random step genuinely helped -- keep it
        } else {
          for (const s of snapshot) {
            if (s.inDiag) this.connDiag[s.idx] = s.value; else this.bias[s.idx] = s.value;
          }
          losses.push(baseline); // it didn't help -- revert the whole step
        }
      }

      for (let i = 0; i < definitions.length; i++) lossHistory[i].push(losses[i]);
      if (losses.every(l => l < tolerance)) { converged = true; break; }
    }

    const satisfied = definitions
      .map((def, i) => ({ id: def.readoutNeuronId, ok: losses[i] < tolerance }))
      .filter(x => x.ok)
      .map(x => x.id);

    const conflicts = this.detectDefinitionConflicts(definitions, losses, lossHistory, dims, tolerance);
    return { converged, epochs: ranEpochs, losses, satisfied, conflicts };
  }

  private initializeNeurons(): void {
    const N = this.config.neuronCount;
    const D = this.totalDims;
    for (let i = 0; i < N; i++) {
      // Individual states are now interleaved in allStates,
      // we can't use subarray() for sequential per-neuron state easily
      // without sacrificing the hot loop's speed.
      // We'll keep 'state' as a separate Float32Array in HyperNeuron
      // for compatibility with other methods, but the hot loop
      // will use allStates directly.
      const state = new Float32Array(D);
      state[0] = 0;
      for (let d = 1; d < D; d++) {
        const val = Math.random() * 2 - 1;
        state[d] = val;
        this.allStates[d * N + i] = val;
      }
      this.neurons.push({
        id: i,
        state,
        energy: 0,
        transitions: [],
        influenceRadius: 0.1 + Math.random() * 0.4,
        activationThreshold: 0.3 + Math.random() * 0.4,
      });
    }
  }

  private initializeConnections(): void {
    const D = this.totalDims;
    const N = this.neurons.length;
    const scale = Math.sqrt(1 / Math.max(1, N));

    for (let i = 0; i < N; i++) {
      const biasOffset = i * D;
      for (let d = 0; d < D; d++) {
        this.bias[biasOffset + d] = 0;
      }

      for (let d = 0; d < D; d++) {
        const rowOffset = (i * D + d) * N;
        for (let j = 0; j < N; j++) {
          if (i === j) continue;
          this.connDiag[rowOffset + j] = (Math.random() * 2 - 1) * scale;
          this.connShift[rowOffset + j] = (Math.random() * 2 - 1) * scale * 0.5;
        }
      }
    }
  }

  /**
   * Propagate-to-convergence: S <- activate(bias + W . S), repeated.
   * Optimized for cache locality by using row-major access on weights
   * and consolidated sequential access on states.
   */
  private settle(
    resolvedInput: number[],
    drivenIds: Set<number>,
    vale?: Map<number, number>
  ): { stateDeltas: Map<number, number>; liveCorrections: number; iterations: number } {
    const D = this.totalDims;
    const N = this.neurons.length;
    const deltas = this.stateDeltasBuffer;
    deltas.fill(0);

    let liveCorrections = 0;
    let iterations = 0;
    const nextStates = this.nextStatesBuffer;
    const strength = this.config.crossInfluenceStrength;
    const dims = this.config.dimensions;

    // Pre-allocate fast lookup structures to avoid Map/Set lookup inside loop
    const isDriven = this.isDrivenScratch;
    isDriven.fill(0);
    for (const id of drivenIds) {
      if (id >= 0 && id < N) {
        isDriven[id] = 1;
      }
    }

    // BOLT OPTIMIZATION: Filter driven and non-driven indices up-front
    // This completely eliminates the nested branch checks `if (isDriven[i]) continue;` inside the hot loops.
    const drivenIndices = this.drivenIndicesScratch;
    const nonDrivenIndices = this.nonDrivenIndicesScratch;
    let drivenCount = 0;
    let nonDrivenCount = 0;
    for (let i = 0; i < N; i++) {
      if (isDriven[i]) {
        drivenIndices[drivenCount++] = i;
      } else {
        nonDrivenIndices[nonDrivenCount++] = i;
      }
    }

    const vs = this.vsScratch;
    const hasV = this.hasVScratch;
    hasV.fill(0);

    for (let i = 0; i < N; i++) {
      const v = vale?.get(i);
      if (v !== undefined) {
        vs[i] = v;
        hasV[i] = 1;
      }
    }

    // Pre-fetch all dimension views of allStates to avoid subarray() in hot loops
    const stateViews = this.stateViews;

    const DN = D * N;
    const connDiag = this.connDiag;
    const connShift = this.connShift;
    const bias = this.bias;

    // BOLT OPTIMIZATION: Pre-calculate driven content energy contribution and clamped input vector once.
    // Since input values are invariant during the entire settling run, we completely eliminate
    // redundant loops, array access, and Math.max/Math.min/clamping checks inside the propagation loop.
    let drivenEnergyContribution = 0;
    const clampedInput = new Float32Array(dims);
    for (let d = 0; d < dims; d++) {
      const inputVal = resolvedInput[d] ?? 0;
      const val = inputVal < -1 ? -1 : (inputVal > 1 ? 1 : inputVal);
      clampedInput[d] = val;
      drivenEnergyContribution += val * val;
    }
    const totalDrivenEnergyContribution = drivenCount * drivenEnergyContribution;

    for (; iterations < this.config.propagationSteps; iterations++) {
      // Initialize content energy with the pre-calculated constant driven energy contribution.
      let currentTotalContentEnergy = totalDrivenEnergyContribution;

      // Fill driven neurons state vectors into nextStates.
      // Keeping this inside the propagation loop is critical to ensure both state buffers
      // remain synchronized without corruption, while using pre-calculated clamped values
      // avoids any redundant evaluation overhead.
      for (let idx = 0; idx < drivenCount; idx++) {
        const i = drivenIndices[idx];
        const offset = i * D;
        nextStates[offset] = 1.0; // Mark as externally driven
        for (let d = 0; d < dims; d++) {
          nextStates[offset + d + 1] = clampedInput[d];
        }
      }

      // Handle non-driven neurons using loop-swapping to hoist dimension/state/weight views
      for (let d = 0; d < D; d++) {
        const sjRow = stateViews[d];
        const srcD = (d - 1 + D) % D;
        const sjShiftRow = stateViews[srcD];
        const dn = d * N;

        for (let idx = 0; idx < nonDrivenCount; idx++) {
          const i = nonDrivenIndices[idx];

          const biasOffset = i * D;
          const rowOffset = i * DN + dn;

          let dotDiag = 0;
          let dotShift = 0;
          // Direct indexing with cached arrays completely avoids subarray allocation overhead
          // Unrolled by 8x for cache-friendly fast computation
          let j = 0;
          const limit = N - 7;
          for (; j < limit; j += 8) {
            dotDiag += sjRow[j] * connDiag[rowOffset + j]
                     + sjRow[j + 1] * connDiag[rowOffset + j + 1]
                     + sjRow[j + 2] * connDiag[rowOffset + j + 2]
                     + sjRow[j + 3] * connDiag[rowOffset + j + 3]
                     + sjRow[j + 4] * connDiag[rowOffset + j + 4]
                     + sjRow[j + 5] * connDiag[rowOffset + j + 5]
                     + sjRow[j + 6] * connDiag[rowOffset + j + 6]
                     + sjRow[j + 7] * connDiag[rowOffset + j + 7];
            dotShift += sjShiftRow[j] * connShift[rowOffset + j]
                      + sjShiftRow[j + 1] * connShift[rowOffset + j + 1]
                      + sjShiftRow[j + 2] * connShift[rowOffset + j + 2]
                      + sjShiftRow[j + 3] * connShift[rowOffset + j + 3]
                      + sjShiftRow[j + 4] * connShift[rowOffset + j + 4]
                      + sjShiftRow[j + 5] * connShift[rowOffset + j + 5]
                      + sjShiftRow[j + 6] * connShift[rowOffset + j + 6]
                      + sjShiftRow[j + 7] * connShift[rowOffset + j + 7];
          }
          for (; j < N; j++) {
            dotDiag += sjRow[j] * connDiag[rowOffset + j];
            dotShift += sjShiftRow[j] * connShift[rowOffset + j];
          }

          const computedState = Math.tanh(bias[biasOffset + d] + dotDiag + dotShift * strength);
          const finalVal = hasV[i] ? vs[i] * this.neurons[i].state[d] + (1 - vs[i]) * computedState : computedState;
          nextStates[i * D + d] = finalVal;
          if (d > 0) {
            currentTotalContentEnergy += finalVal * finalVal;
          }
        }
      }

      const actualEnergy = currentTotalContentEnergy / (N * dims);
      const predictedEnergy = this.hasEma ? this.emaEnergy : actualEnergy;
      const divergence = Math.abs(actualEnergy - predictedEnergy);

      this.sustainedDivergence = divergence > this.config.divergenceTolerance ? this.sustainedDivergence + 1 : 0;

      if (this.sustainedDivergence >= this.config.sustainedDivergenceTicks) {
        for (let i = 0; i < N; i++) {
          if (isDriven[i]) continue;
          const offset = i * D;
          const state = this.neurons[i].state;
          for (let d = 0; d < D; d++) {
            nextStates[offset + d] = 0.5 * nextStates[offset + d] + 0.5 * state[d];
          }
        }
        liveCorrections++;
        this.sustainedDivergence = 0;
      }

      const settledEnergy = this.sustainedDivergence === 0 ? actualEnergy : this.meanContentEnergyBuffer(nextStates);
      this.emaEnergy = this.hasEma
        ? this.config.influenceDecay * this.emaEnergy + (1 - this.config.influenceDecay) * settledEnergy
        : settledEnergy;
      this.hasEma = true;

      let residual = 0;
      for (let d = 0; d < D; d++) {
        const sjRow = stateViews[d];
        for (let i = 0; i < N; i++) {
          const offset = i * D;
          const nextVal = nextStates[offset + d];
          const diff = Math.abs(nextVal - sjRow[i]);

          deltas[i] += diff;

          sjRow[i] = nextVal;
          this.neurons[i].state[d] = nextVal;
          residual += diff;
        }
      }

      if (residual < this.config.convergenceThreshold) {
        iterations++;
        break;
      }
    }

    const stateDeltas = new Map<number, number>();
    for (let i = 0; i < N; i++) stateDeltas.set(i, deltas[i]);

    return { stateDeltas, liveCorrections, iterations };
  }

  private applyWeightLearning(learningRates: Map<number, number> | undefined, stateDeltas: Map<number, number>): void {
    const D = this.totalDims;
    const N = this.neurons.length;

    // Pre-fetch all dimension views of allStates for sequential access
    const stateViews = this.stateViews;

    const rates = this.ratesScratch;
    const defaultRate = this.config.learningRate;
    for (let i = 0; i < N; i++) {
      rates[i] = learningRates?.get(i) ?? defaultRate;
    }

    const connDiag = this.connDiag;
    const connShift = this.connShift;
    const bias = this.bias;

    const deltaSums = this.deltaSumsScratch;
    deltaSums.fill(0);

    // Keep i as outer loop and d as middle loop to ensure perfect sequential cache-friendly access to connDiag/connShift
    for (let i = 0; i < N; i++) {
      const rate = rates[i];
      const si = this.neurons[i].state;
      let deltaSum = 0;

      for (let d = 0; d < D; d++) {
        const sjRow = stateViews[d];
        const srcD = (d - 1 + D) % D;
        const sjShiftRow = stateViews[srcD];

        const sid = si[d];
        const rateSid = rate * sid;
        const rowOffset = (i * D + d) * N;

        // Unroll j loop from 0 to i by 4x manually with sequential index offsets
        let j = 0;
        const limit1 = i - 3;
        let wdIdx = rowOffset;
        for (; j < limit1; j += 4) {
          const oldWd0 = connDiag[wdIdx];
          const valWd0 = oldWd0 + rateSid * sjRow[j];
          const newWd0 = valWd0 < -2 ? -2 : (valWd0 > 2 ? 2 : valWd0);
          connDiag[wdIdx] = newWd0;
          const diffWd0 = newWd0 - oldWd0;
          deltaSum += diffWd0 < 0 ? -diffWd0 : diffWd0;

          const oldWs0 = connShift[wdIdx];
          const valWs0 = oldWs0 + rateSid * sjShiftRow[j];
          const newWs0 = valWs0 < -2 ? -2 : (valWs0 > 2 ? 2 : valWs0);
          connShift[wdIdx] = newWs0;
          const diffWs0 = newWs0 - oldWs0;
          deltaSum += diffWs0 < 0 ? -diffWs0 : diffWs0;

          const oldWd1 = connDiag[wdIdx + 1];
          const valWd1 = oldWd1 + rateSid * sjRow[j + 1];
          const newWd1 = valWd1 < -2 ? -2 : (valWd1 > 2 ? 2 : valWd1);
          connDiag[wdIdx + 1] = newWd1;
          const diffWd1 = newWd1 - oldWd1;
          deltaSum += diffWd1 < 0 ? -diffWd1 : diffWd1;

          const oldWs1 = connShift[wdIdx + 1];
          const valWs1 = oldWs1 + rateSid * sjShiftRow[j + 1];
          const newWs1 = valWs1 < -2 ? -2 : (valWs1 > 2 ? 2 : valWs1);
          connShift[wdIdx + 1] = newWs1;
          const diffWs1 = newWs1 - oldWs1;
          deltaSum += diffWs1 < 0 ? -diffWs1 : diffWs1;

          const oldWd2 = connDiag[wdIdx + 2];
          const valWd2 = oldWd2 + rateSid * sjRow[j + 2];
          const newWd2 = valWd2 < -2 ? -2 : (valWd2 > 2 ? 2 : valWd2);
          connDiag[wdIdx + 2] = newWd2;
          const diffWd2 = newWd2 - oldWd2;
          deltaSum += diffWd2 < 0 ? -diffWd2 : diffWd2;

          const oldWs2 = connShift[wdIdx + 2];
          const valWs2 = oldWs2 + rateSid * sjShiftRow[j + 2];
          const newWs2 = valWs2 < -2 ? -2 : (valWs2 > 2 ? 2 : valWs2);
          connShift[wdIdx + 2] = newWs2;
          const diffWs2 = newWs2 - oldWs2;
          deltaSum += diffWs2 < 0 ? -diffWs2 : diffWs2;

          const oldWd3 = connDiag[wdIdx + 3];
          const valWd3 = oldWd3 + rateSid * sjRow[j + 3];
          const newWd3 = valWd3 < -2 ? -2 : (valWd3 > 2 ? 2 : valWd3);
          connDiag[wdIdx + 3] = newWd3;
          const diffWd3 = newWd3 - oldWd3;
          deltaSum += diffWd3 < 0 ? -diffWd3 : diffWd3;

          const oldWs3 = connShift[wdIdx + 3];
          const valWs3 = oldWs3 + rateSid * sjShiftRow[j + 3];
          const newWs3 = valWs3 < -2 ? -2 : (valWs3 > 2 ? 2 : valWs3);
          connShift[wdIdx + 3] = newWs3;
          const diffWs3 = newWs3 - oldWs3;
          deltaSum += diffWs3 < 0 ? -diffWs3 : diffWs3;

          wdIdx += 4;
        }
        for (; j < i; j++) {
          const oldWd = connDiag[wdIdx];
          const valWd = oldWd + rateSid * sjRow[j];
          const newWd = valWd < -2 ? -2 : (valWd > 2 ? 2 : valWd);
          connDiag[wdIdx] = newWd;
          const diffWd = newWd - oldWd;
          deltaSum += diffWd < 0 ? -diffWd : diffWd;

          const oldWs = connShift[wdIdx];
          const valWs = oldWs + rateSid * sjShiftRow[j];
          const newWs = valWs < -2 ? -2 : (valWs > 2 ? 2 : valWs);
          connShift[wdIdx] = newWs;
          const diffWs = newWs - oldWs;
          deltaSum += diffWs < 0 ? -diffWs : diffWs;
          wdIdx++;
        }

        // Unroll j loop from i + 1 to N by 4x manually with sequential index offsets
        let j2 = i + 1;
        const limit2 = N - 3;
        let wdIdx2 = rowOffset + j2;
        for (; j2 < limit2; j2 += 4) {
          const oldWd0 = connDiag[wdIdx2];
          const valWd0 = oldWd0 + rateSid * sjRow[j2];
          const newWd0 = valWd0 < -2 ? -2 : (valWd0 > 2 ? 2 : valWd0);
          connDiag[wdIdx2] = newWd0;
          const diffWd0 = newWd0 - oldWd0;
          deltaSum += diffWd0 < 0 ? -diffWd0 : diffWd0;

          const oldWs0 = connShift[wdIdx2];
          const valWs0 = oldWs0 + rateSid * sjShiftRow[j2];
          const newWs0 = valWs0 < -2 ? -2 : (valWs0 > 2 ? 2 : valWs0);
          connShift[wdIdx2] = newWs0;
          const diffWs0 = newWs0 - oldWs0;
          deltaSum += diffWs0 < 0 ? -diffWs0 : diffWs0;

          const oldWd1 = connDiag[wdIdx2 + 1];
          const valWd1 = oldWd1 + rateSid * sjRow[j2 + 1];
          const newWd1 = valWd1 < -2 ? -2 : (valWd1 > 2 ? 2 : valWd1);
          connDiag[wdIdx2 + 1] = newWd1;
          const diffWd1 = newWd1 - oldWd1;
          deltaSum += diffWd1 < 0 ? -diffWd1 : diffWd1;

          const oldWs1 = connShift[wdIdx2 + 1];
          const valWs1 = oldWs1 + rateSid * sjShiftRow[j2 + 1];
          const newWs1 = valWs1 < -2 ? -2 : (valWs1 > 2 ? 2 : valWs1);
          connShift[wdIdx2 + 1] = newWs1;
          const diffWs1 = newWs1 - oldWs1;
          deltaSum += diffWs1 < 0 ? -diffWs1 : diffWs1;

          const oldWd2 = connDiag[wdIdx2 + 2];
          const valWd2 = oldWd2 + rateSid * sjRow[j2 + 2];
          const newWd2 = valWd2 < -2 ? -2 : (valWd2 > 2 ? 2 : valWd2);
          connDiag[wdIdx2 + 2] = newWd2;
          const diffWd2 = newWd2 - oldWd2;
          deltaSum += diffWd2 < 0 ? -diffWd2 : diffWd2;

          const oldWs2 = connShift[wdIdx2 + 2];
          const valWs2 = oldWs2 + rateSid * sjShiftRow[j2 + 2];
          const newWs2 = valWs2 < -2 ? -2 : (valWs2 > 2 ? 2 : valWs2);
          connShift[wdIdx2 + 2] = newWs2;
          const diffWs2 = newWs2 - oldWs2;
          deltaSum += diffWs2 < 0 ? -diffWs2 : diffWs2;

          const oldWd3 = connDiag[wdIdx2 + 3];
          const valWd3 = oldWd3 + rateSid * sjRow[j2 + 3];
          const newWd3 = valWd3 < -2 ? -2 : (valWd3 > 2 ? 2 : valWd3);
          connDiag[wdIdx2 + 3] = newWd3;
          const diffWd3 = newWd3 - oldWd3;
          deltaSum += diffWd3 < 0 ? -diffWd3 : diffWd3;

          const oldWs3 = connShift[wdIdx2 + 3];
          const valWs3 = oldWs3 + rateSid * sjShiftRow[j2 + 3];
          const newWs3 = valWs3 < -2 ? -2 : (valWs3 > 2 ? 2 : valWs3);
          connShift[wdIdx2 + 3] = newWs3;
          const diffWs3 = newWs3 - oldWs3;
          deltaSum += diffWs3 < 0 ? -diffWs3 : diffWs3;

          wdIdx2 += 4;
        }
        for (; j2 < N; j2++) {
          const oldWd = connDiag[wdIdx2];
          const valWd = oldWd + rateSid * sjRow[j2];
          const newWd = valWd < -2 ? -2 : (valWd > 2 ? 2 : valWd);
          connDiag[wdIdx2] = newWd;
          const diffWd = newWd - oldWd;
          deltaSum += diffWd < 0 ? -diffWd : diffWd;

          const oldWs = connShift[wdIdx2];
          const valWs = oldWs + rateSid * sjShiftRow[j2];
          const newWs = valWs < -2 ? -2 : (valWs > 2 ? 2 : valWs);
          connShift[wdIdx2] = newWs;
          const diffWs = newWs - oldWs;
          deltaSum += diffWs < 0 ? -diffWs : diffWs;
          wdIdx2++;
        }
      }

      deltaSums[i] = deltaSum;
    }

    for (let i = 0; i < N; i++) {
      stateDeltas.set(i, (stateDeltas.get(i) ?? 0) + deltaSums[i]);
    }

    // Update biases after weight updates
    for (let i = 0; i < N; i++) {
      const rate = rates[i];
      const si = this.neurons[i].state;
      const biasOffset = i * D;
      for (let d = 0; d < D; d++) {
        const valB = bias[biasOffset + d] + rate * 0.1 * si[d];
        bias[biasOffset + d] = valB < -1 ? -1 : (valB > 1 ? 1 : valB);
      }
    }
  }

  private meanContentEnergyBuffer(buffer: Float32Array): number {
    const N = this.config.neuronCount;
    const dims = this.config.dimensions;
    const D = this.totalDims;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const offset = i * D;
      let d = 1;
      const limit = D - 3;
      for (; d < limit; d += 4) {
        const v0 = buffer[offset + d];
        const v1 = buffer[offset + d + 1];
        const v2 = buffer[offset + d + 2];
        const v3 = buffer[offset + d + 3];
        sum += v0 * v0 + v1 * v1 + v2 * v2 + v3 * v3;
      }
      for (; d < D; d++) {
        const val = buffer[offset + d];
        sum += val * val;
      }
    }
    return sum / (N * dims);
  }

  /**
   * Section 13 → §12: evaluate the compressed self-model AND its instantaneous
   * rate of change in a single forward pass using dual numbers. `velocity` is
   * the per-dimension rate of change of the input (e.g. current minus previous
   * output). Each input dimension enters as a dual (value, velocity) and is
   * propagated through the linear self-model, so the ε-component of the output
   * is the predicted derivative. Live correction can then react to the trend
   * (is divergence growing?) rather than only the current level.
   */
  predictSelfModelWithDerivative(vec: number[], velocity: number[]): { value: number[]; derivative: number[] } {
    const dims = this.config.dimensions;
    const rank = this.config.selfModelRank;

    const h: Dual[] = Array.from({ length: rank }, () => dual(0, 0));
    for (let d = 0; d < dims; d++) {
      const x = dual(vec[d] ?? 0, velocity[d] ?? 0);
      for (let r = 0; r < rank; r++) {
        h[r] = dAdd(h[r], dScale(x, this.selfModelA[d * rank + r]));
      }
    }

    const value = new Array<number>(dims).fill(0);
    const derivative = new Array<number>(dims).fill(0);
    for (let r = 0; r < rank; r++) {
      for (let d = 0; d < dims; d++) {
        const term = dScale(h[r], this.selfModelB[r * dims + d]);
        value[d] += term.val;
        derivative[d] += term.der;
      }
    }
    return { value, derivative };
  }

  /** Rank-r compressed self-model: predict(x) = B^T (A^T x). */
  private selfModelPredict(vec: number[]): number[] {
    const dims = this.config.dimensions;
    const rank = this.config.selfModelRank;
    const h = this.selfModelHScratch;
    h.fill(0);
    for (let d = 0; d < dims; d++) {
      const v = vec[d] ?? 0;
      const offset = d * rank;
      let r = 0;
      const limit = rank - 3;
      for (; r < limit; r += 4) {
        h[r] += v * this.selfModelA[offset + r];
        h[r + 1] += v * this.selfModelA[offset + r + 1];
        h[r + 2] += v * this.selfModelA[offset + r + 2];
        h[r + 3] += v * this.selfModelA[offset + r + 3];
      }
      for (; r < rank; r++) {
        h[r] += v * this.selfModelA[offset + r];
      }
    }
    const out = new Array<number>(dims).fill(0);
    for (let r = 0; r < rank; r++) {
      const hr = h[r];
      const bOffset = r * dims;
      let d = 0;
      const limit = dims - 3;
      for (; d < limit; d += 4) {
        out[d] += hr * this.selfModelB[bOffset + d];
        out[d + 1] += hr * this.selfModelB[bOffset + d + 1];
        out[d + 2] += hr * this.selfModelB[bOffset + d + 2];
        out[d + 3] += hr * this.selfModelB[bOffset + d + 3];
      }
      for (; d < dims; d++) {
        out[d] += hr * this.selfModelB[bOffset + d];
      }
    }
    return out;
  }

  private selfModelTrainStep(prevVec: number[], predicted: number[], actual: number[]): void {
    const dims = this.config.dimensions;
    const rank = this.config.selfModelRank;
    const lr = 0.01;

    // OPTIMIZATION: Reuse pre-computed h projection from selfModelPredict to avoid
    // O(dimensions * rank) redundant recalculations and Float32Array allocations.
    const h = this.selfModelHScratch;

    const error = this.selfModelErrorScratch;
    error.fill(0);
    for (let d = 0; d < dims; d++) error[d] = (actual[d] ?? 0) - (predicted[d] ?? 0);

    const dh = this.selfModelDHScratch;
    dh.fill(0);
    for (let r = 0; r < rank; r++) {
      let acc = 0;
      const bOffset = r * dims;
      let d = 0;
      const limit = dims - 3;
      // OPTIMIZATION: 4x loop unrolling to reduce branch overhead.
      for (; d < limit; d += 4) {
        acc += error[d] * this.selfModelB[bOffset + d]
             + error[d + 1] * this.selfModelB[bOffset + d + 1]
             + error[d + 2] * this.selfModelB[bOffset + d + 2]
             + error[d + 3] * this.selfModelB[bOffset + d + 3];
      }
      for (; d < dims; d++) {
        acc += error[d] * this.selfModelB[bOffset + d];
      }
      dh[r] = acc;
    }

    for (let r = 0; r < rank; r++) {
      const hr = h[r];
      const lrHr = lr * hr;
      const bOffset = r * dims;
      let d = 0;
      const limit = dims - 3;
      // OPTIMIZATION: 4x loop unrolling and factored multiplier out of inner loop.
      for (; d < limit; d += 4) {
        this.selfModelB[bOffset + d] += lrHr * error[d];
        this.selfModelB[bOffset + d + 1] += lrHr * error[d + 1];
        this.selfModelB[bOffset + d + 2] += lrHr * error[d + 2];
        this.selfModelB[bOffset + d + 3] += lrHr * error[d + 3];
      }
      for (; d < dims; d++) {
        this.selfModelB[bOffset + d] += lrHr * error[d];
      }
    }
    for (let d = 0; d < dims; d++) {
      const v = prevVec[d] ?? 0;
      const lrV = lr * v;
      const offset = d * rank;
      let r = 0;
      const limit = rank - 3;
      // OPTIMIZATION: 4x loop unrolling and factored multiplier out of inner loop.
      for (; r < limit; r += 4) {
        this.selfModelA[offset + r] += lrV * dh[r];
        this.selfModelA[offset + r + 1] += lrV * dh[r + 1];
        this.selfModelA[offset + r + 2] += lrV * dh[r + 2];
        this.selfModelA[offset + r + 3] += lrV * dh[r + 3];
      }
      for (; r < rank; r++) {
        this.selfModelA[offset + r] += lrV * dh[r];
      }
    }
  }

  private meanAbsDiff(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    if (n === 0) return 0;
    let sum = 0;
    let i = 0;
    const limit = n - 3;
    for (; i < limit; i += 4) {
      const d0 = a[i] - b[i];
      const d1 = a[i + 1] - b[i + 1];
      const d2 = a[i + 2] - b[i + 2];
      const d3 = a[i + 3] - b[i + 3];
      sum += (d0 < 0 ? -d0 : d0)
           + (d1 < 0 ? -d1 : d1)
           + (d2 < 0 ? -d2 : d2)
           + (d3 < 0 ? -d3 : d3);
    }
    for (; i < n; i++) {
      const diff = a[i] - b[i];
      sum += diff < 0 ? -diff : diff;
    }
    return sum / n;
  }

  private resolveStateTransitions(): StateTransition[] {
    const resolved: StateTransition[] = [];
    for (const neuron of this.neurons) {
      if (neuron.energy > this.config.energyThreshold) {
        const fromState = neuron.transitions.length > 0
          ? neuron.transitions[neuron.transitions.length - 1].toState
          : neuron.state;
        const transition: StateTransition = {
          fromState: new Float32Array(fromState),
          toState: new Float32Array(neuron.state),
          energy: neuron.energy,
          timestamp: Date.now(),
          cause: 'energy_resolved',
        };
        neuron.transitions.push(transition);
        if (neuron.transitions.length > this.perNeuronTransitionsCapacity) {
          neuron.transitions.splice(0, neuron.transitions.length - this.perNeuronTransitionsCapacity);
        }
        resolved.push(transition);
      }
    }
    return resolved;
  }

  private computeStateEnergy(state: Float32Array): number {
    let energy = 0;
    const len = state.length;
    let d = 1;
    const limit = len - 3;
    for (; d < limit; d += 4) {
      const v0 = state[d];
      const v1 = state[d + 1];
      const v2 = state[d + 2];
      const v3 = state[d + 3];
      energy += v0 * v0 + v1 * v1 + v2 * v2 + v3 * v3;
    }
    for (; d < len; d++) {
      const val = state[d];
      energy += val * val;
    }
    return energy / this.config.dimensions;
  }

  private computeOutputVector(activeStates: HyperNeuron[]): number[] {
    const dims = this.config.dimensions;
    const output = new Array(dims).fill(0);
    const len = activeStates.length;
    if (len === 0) return output;

    for (let i = 0; i < len; i++) {
      const neuron = activeStates[i];
      const state = neuron.state;
      const energy = neuron.energy;
      let d = 0;
      const limit = dims - 3;
      for (; d < limit; d += 4) {
        output[d] += state[d + 1] * energy;
        output[d + 1] += state[d + 2] * energy;
        output[d + 2] += state[d + 3] * energy;
        output[d + 3] += state[d + 4] * energy;
      }
      for (; d < dims; d++) {
        output[d] += state[d + 1] * energy;
      }
    }

    let sumSq = 0;
    let d = 0;
    const limitSq = dims - 3;
    for (; d < limitSq; d += 4) {
      const v0 = output[d];
      const v1 = output[d + 1];
      const v2 = output[d + 2];
      const v3 = output[d + 3];
      sumSq += v0 * v0 + v1 * v1 + v2 * v2 + v3 * v3;
    }
    for (; d < dims; d++) {
      const val = output[d];
      sumSq += val * val;
    }
    const norm = Math.sqrt(sumSq) || 1;
    const invNorm = 1.0 / norm;
    d = 0;
    const limitNorm = dims - 3;
    for (; d < limitNorm; d += 4) {
      output[d] *= invNorm;
      output[d + 1] *= invNorm;
      output[d + 2] *= invNorm;
      output[d + 3] *= invNorm;
    }
    for (; d < dims; d++) {
      output[d] *= invNorm;
    }

    return output;
  }

  /**
   * Neurons salient enough this tick to contribute to the output vector.
   * Falls back to every neuron when none clear energyThreshold, rather than
   * an empty set: computeOutputVector() treats "no active states" as "all
   * zero", so a hard cutoff with no fallback made the output vector (and
   * everything downstream of it — selfModelSurprise, noveltyScore,
   * patternHash) silently, permanently zero whenever the whole mesh's
   * energy happened to sit under the threshold — which, at the default
   * threshold and typical settled-state magnitudes, was most of the time,
   * including in the live pipeline's own default configuration.
   */
  private getActiveStates(): HyperNeuron[] {
    const active = this.neurons.filter(n => n.energy > this.config.energyThreshold);
    return active.length > 0 ? active : this.neurons;
  }

  private computeDimensionalEntropy(): number {
    const N = this.neurons.length;
    const dims = this.config.dimensions;
    let entropy = 0;
    const buckets = 10;
    const hist = this.entropyHist;

    for (let d = 0; d < dims; d++) {
      hist.fill(0);
      const rowOffset = (d + 1) * N;
      let i = 0;
      const limit = N - 7;
      for (; i < limit; i += 8) {
        const v0 = this.allStates[rowOffset + i];
        const v1 = this.allStates[rowOffset + i + 1];
        const v2 = this.allStates[rowOffset + i + 2];
        const v3 = this.allStates[rowOffset + i + 3];
        const v4 = this.allStates[rowOffset + i + 4];
        const v5 = this.allStates[rowOffset + i + 5];
        const v6 = this.allStates[rowOffset + i + 6];
        const v7 = this.allStates[rowOffset + i + 7];

        // BOLT OPTIMIZATION: Replace expensive Math.min and Math.floor calls in hot loops
        // with inline branchless ternaries and extremely fast bitwise OR `| 0` truncation.
        const idx0 = ((v0 + 1) * 5) | 0;
        const idx1 = ((v1 + 1) * 5) | 0;
        const idx2 = ((v2 + 1) * 5) | 0;
        const idx3 = ((v3 + 1) * 5) | 0;
        const idx4 = ((v4 + 1) * 5) | 0;
        const idx5 = ((v5 + 1) * 5) | 0;
        const idx6 = ((v6 + 1) * 5) | 0;
        const idx7 = ((v7 + 1) * 5) | 0;

        hist[idx0 > 9 ? 9 : (idx0 < 0 ? 0 : idx0)]++;
        hist[idx1 > 9 ? 9 : (idx1 < 0 ? 0 : idx1)]++;
        hist[idx2 > 9 ? 9 : (idx2 < 0 ? 0 : idx2)]++;
        hist[idx3 > 9 ? 9 : (idx3 < 0 ? 0 : idx3)]++;
        hist[idx4 > 9 ? 9 : (idx4 < 0 ? 0 : idx4)]++;
        hist[idx5 > 9 ? 9 : (idx5 < 0 ? 0 : idx5)]++;
        hist[idx6 > 9 ? 9 : (idx6 < 0 ? 0 : idx6)]++;
        hist[idx7 > 9 ? 9 : (idx7 < 0 ? 0 : idx7)]++;
      }
      for (; i < N; i++) {
        const v = this.allStates[rowOffset + i];
        const idx = ((v + 1) * 5) | 0;
        hist[idx > 9 ? 9 : (idx < 0 ? 0 : idx)]++;
      }
      for (let b = 0; b < buckets; b++) {
        entropy -= this.entropyLookup[hist[b]];
      }
    }
    return entropy / dims;
  }

  private computeNoveltyScore(patternHash: string): number {
    const seen = this.seenPatterns.get(patternHash);
    if (!seen) return 1;

    const timeSinceLastSeen = Date.now() - seen.lastSeen;
    const recencyFactor = Math.exp(-timeSinceLastSeen / this.config.noveltyWindow);
    const frequencyPenalty = Math.min(1, seen.frequency / 10);

    return Math.max(0, 1 - recencyFactor * frequencyPenalty);
  }

  private recordPattern(patternHash: string, novelty: number): void {
    const existing = this.seenPatterns.get(patternHash);
    if (existing) {
      existing.frequency++;
      existing.lastSeen = Date.now();
      existing.novelty = novelty;
    } else {
      this.seenPatterns.set(patternHash, {
        hash: patternHash,
        frequency: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        novelty,
      });
      while (this.seenPatterns.size > this.seenPatternsCapacity) {
        const oldest = this.seenPatterns.keys().next().value;
        if (oldest === undefined) break;
        this.seenPatterns.delete(oldest);
      }
    }
  }

  private hashVector(vector: number[]): string {
    let hash = 0;
    const len = vector.length;
    let i = 0;
    const limit = len - 3;
    for (; i < limit; i += 4) {
      const v0 = Math.round(vector[i] * 10000);
      const v1 = Math.round(vector[i + 1] * 10000);
      const v2 = Math.round(vector[i + 2] * 10000);
      const v3 = Math.round(vector[i + 3] * 10000);
      hash = ((hash << 5) - hash) + v0;
      hash = hash & hash;
      hash = ((hash << 5) - hash) + v1;
      hash = hash & hash;
      hash = ((hash << 5) - hash) + v2;
      hash = hash & hash;
      hash = ((hash << 5) - hash) + v3;
      hash = hash & hash;
    }
    for (; i < len; i++) {
      const val = Math.round(vector[i] * 10000);
      hash = ((hash << 5) - hash) + val;
      hash = hash & hash;
    }
    return `hd_${hash}`;
  }
}

// ============================================================================
// quantum-net.ts
// ============================================================================

/**
 * Quantum Neural Net Module
 * 
 * Uses quantum interference where a neuron's input defines the wave height,
 * and the wave is the neuron's signature. Applies when a neuron exclusively has an input.
 * 
 * Why: Easy to convert to quantum, and reaches beyond the classical domain.
 * Example: Neuron 2's signature was 4.5 and its height was 10.
 */

const cAdd = complexAdd;
const cMul = complexMul;
const cAbs = abs;
const cArg = arg;

export interface QuantumState {
  signature: number; // The unique wave identifier
  /**
   * Amplitude/phase (polar) is the storage form — a lossless representation
   * of the same complex number as {re, im}, and the natural one for phase
   * evolution. Converted to Complex via fromPolar() whenever
   * interference/consensus math needs genuine complex arithmetic.
   */
  height: number;    // Amplitude defined by input (= magnitude of the complex state)
  phase: number;     // Phase angle for interference (= argument of the complex state)
  probability: number; // Collapsed probability
}

export interface QuantumNeuron {
  id: string;
  inputExclusive: boolean;
  state: QuantumState;
  superposition: QuantumState[]; // Holds multiple potential states
}

export class QuantumNeuralNet {
  private neurons: Map<string, QuantumNeuron>;
  private planckConstant: number = 6.626e-34; // Scaled for simulation

  constructor() {
    this.neurons = new Map();
  }

  /**
   * Register a neuron with exclusive input capability
   */
  addNeuron(id: string, inputValue: number): QuantumNeuron {
    const signature = this.calculateSignature(id, inputValue);
    const height = this.calculateWaveHeight(inputValue);

    const neuron: QuantumNeuron = {
      id,
      inputExclusive: true,
      state: {
        signature,
        height,
        // Random initial phase — with phase fixed at 0 for every neuron,
        // phaseDiff was always 0 and destructive interference (cos(phaseDiff) < 0)
        // was mathematically unreachable. Randomizing lets neurons actually
        // land out of phase with each other.
        phase: Math.random() * Math.PI * 2,
        probability: 1.0
      },
      superposition: []
    };

    this.neurons.set(id, neuron);
    return neuron;
  }

  /**
   * Calculate the wave signature based on neuron ID and input
   * Example: Neuron 2 with input -> signature 4.5
   */
  private calculateSignature(id: string, input: number): number {
    // Hash the ID to a base value, modulated by input
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash % 100) / 10 + (input * 0.1);
  }

  /**
   * Input defines the wave height
   */
  private calculateWaveHeight(input: number): number {
    return Math.abs(input) * 10; // Scale factor for visibility
  }

  /**
   * Create superposition of states for a neuron
   */
  createSuperposition(neuronId: string, possibleInputs: number[]): void {
    const neuron = this.neurons.get(neuronId);
    if (!neuron) throw new Error(`Neuron ${neuronId} not found`);

    const candidates = possibleInputs.map(input => ({
      signature: this.calculateSignature(neuronId, input),
      height: this.calculateWaveHeight(input),
      phase: Math.random() * Math.PI * 2,
    }));

    // Born rule: probability ∝ amplitude² (height²), not a uniform 1/N split.
    // A uniform split makes every candidate state equally likely regardless
    // of how strong its wave actually is, which isn't "amplitude-weighted"
    // at all — it just looks like it because collapse() samples a distribution.
    const totalSq = candidates.reduce((s, c) => s + c.height * c.height, 0) || 1;

    neuron.superposition = candidates.map(c => ({
      ...c,
      probability: (c.height * c.height) / totalSq,
    }));
  }

  /**
   * Apply quantum interference between two neurons
   * Constructive or destructive based on phase difference
   */
  interfere(neuronIdA: string, neuronIdB: string): number {
    const neuronA = this.neurons.get(neuronIdA);
    const neuronB = this.neurons.get(neuronIdB);

    if (!neuronA || !neuronB) throw new Error('One or both neurons not found');

    // Section 13: interference as genuine complex arithmetic. Each state is
    // the phasor height·e^{iφ}; the resultant is their complex sum and the
    // returned amplitude is its magnitude |zA + zB|. This is exactly the old
    // sqrt(A² + B² + 2AB·cos Δφ) formula, but derived from the complex
    // substrate the phase-and-height pair actually represents.
    const zA = this.complexAmplitude(neuronA.state);
    const zB = this.complexAmplitude(neuronB.state);
    return cAbs(cAdd(zA, zB));
  }

  /**
   * Phase-consensus across a group of neurons — true destructive interference.
   * Sums each neuron's amplitude as a complex phasor (height·e^{iφ}); phasors
   * that disagree in phase cancel toward zero, phasors that agree reinforce
   * toward the sum of their heights. Returns the resultant magnitude.
   */
  phaseConsensus(neuronIds: string[]): number {
    let sum: Complex = { re: 0, im: 0 };
    for (const id of neuronIds) {
      const neuron = this.neurons.get(id);
      if (!neuron) continue;
      sum = cAdd(sum, this.complexAmplitude(neuron.state));
    }
    return cAbs(sum);
  }

  /** The state's phase-and-amplitude as a single complex number height·e^{iφ}. */
  private complexAmplitude(state: QuantumState): Complex {
    return fromPolar(state.height, state.phase);
  }

  /** Public complex-amplitude accessor: the neuron's genuine complex QIL state. */
  getComplexAmplitude(neuronId: string): Complex | null {
    const neuron = this.neurons.get(neuronId);
    return neuron ? this.complexAmplitude(neuron.state) : null;
  }

  /**
   * Grover-style amplitude amplification: flips the sign of the target
   * neuron's amplitude (oracle), then reflects every amplitude in the group
   * about their mean (diffuser). Iterating this grows the target's share of
   * total probability mass at the expense of the rest of the group.
   */
  groverAmplify(neuronIds: string[], targetId: string): void {
    const ids = neuronIds.filter(id => this.neurons.has(id));
    const targetIdx = ids.indexOf(targetId);
    if (targetIdx === -1 || ids.length === 0) return;

    const amplitudes = ids.map(id => this.neurons.get(id)!.state.height);

    // Oracle: mark the target by flipping its amplitude's sign.
    amplitudes[targetIdx] = -amplitudes[targetIdx];

    // Diffuser: inversion about the mean amplifies whatever was marked.
    const mean = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;
    for (let i = 0; i < amplitudes.length; i++) {
      amplitudes[i] = 2 * mean - amplitudes[i];
    }

    // Write back heights and re-derive Born-rule probabilities from the
    // new amplitudes so collapse() reflects the amplification.
    const totalSq = amplitudes.reduce((s, a) => s + a * a, 0) || 1;
    ids.forEach((id, i) => {
      const neuron = this.neurons.get(id)!;
      neuron.state.height = Math.abs(amplitudes[i]);
      neuron.state.probability = (amplitudes[i] * amplitudes[i]) / totalSq;
    });
  }

  /**
   * Collapse the wave function to a single state, sampling from the
   * amplitude-weighted (Born rule) probability distribution built by
   * createSuperposition / groverAmplify — not a plain uniform draw.
   */
  collapse(neuronId: string): number {
    const neuron = this.neurons.get(neuronId);
    if (!neuron) throw new Error(`Neuron ${neuronId} not found`);

    if (neuron.superposition.length === 0) {
      return neuron.state.height;
    }

    // Simple weighted random selection based on probability
    const rand = Math.random();
    let cumulative = 0;
    
    for (const state of neuron.superposition) {
      cumulative += state.probability;
      if (rand <= cumulative) {
        // Update main state to collapsed state
        neuron.state = { ...state, probability: 1.0 };
        neuron.superposition = [];
        return state.height;
      }
    }

    return neuron.state.height;
  }

  /**
   * Evolve the phase of a neuron over time (simulation step)
   */
  evolvePhase(neuronId: string, deltaTime: number): void {
    const neuron = this.neurons.get(neuronId);
    if (!neuron) return;

    // Phase evolution is a rotation of the complex state: multiplying by the
    // unit phasor e^{i*frequency*deltaTime} (a genuine complex multiplication)
    // rather than adding to the stored phase scalar directly.
    const frequency = neuron.state.signature;
    const current = fromPolar(neuron.state.height, neuron.state.phase);
    const rotor = fromPolar(1, frequency * deltaTime);
    const rotated = cMul(current, rotor);

    neuron.state.phase = cArg(rotated);
    // Normalize phase to [0, 2PI)
    neuron.state.phase = ((neuron.state.phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  /**
   * Get the current quantum state of a neuron
   */
  getState(neuronId: string): QuantumState | null {
    const neuron = this.neurons.get(neuronId);
    return neuron ? neuron.state : null;
  }

  /**
   * Check if a neuron has exclusive input (prerequisite for quantum behavior)
   */
  isExclusiveInput(neuronId: string): boolean {
    const neuron = this.neurons.get(neuronId);
    return neuron ? neuron.inputExclusive : false;
  }
}

// Export singleton instance for easy integration
export const quantumNet = new QuantumNeuralNet();

// ============================================================================
// moe-router.ts
// ============================================================================

export interface MoEConfig {
  expertCount: number;
  topK: number;
  capacityFactor: number;
  loadBalanceWeight: number;
  expertHiddenDim: number;
  inputDim: number;
  outputDim: number;
  routerHiddenDim: number;
}

export interface RouterDecision {
  expertIndices: number[];
  routerWeights: number[];
  expertOutputs: Float32Array[];
  combinedOutput: Float32Array;
  entropy: number;
  loadBalanceLoss: number;
}

export interface MoELayerOutput {
  output: Float32Array;
  decision: RouterDecision;
  layerIndex: number;
  expertContributions: Map<string, number>;
}

export interface ExpertUtilizationStats {
  expertId: number;
  utilization: number;
  totalCalls: number;
  totalTokens: number;
  avgWeight: number;
}

export class MoERouter {
  private config: MoEConfig;
  private experts: Map<number, { weights: Float32Array; bias: Float32Array }>;
  private routerWeights: Float32Array;
  private routerBias: Float32Array;
  private utilization: Map<number, { calls: number; tokens: number; weightSum: number }>;
  private iteration: number = 0;
  private scoresScratch: number[];
  private selectScratch: Int32Array;
  // OPTIMIZATION: Keep a pre-allocated pool of scratch Float32Arrays for expert outputs
  // to avoid garbage collection and memory allocation overhead on every route() call.
  private expertOutputsScratch: Float32Array[] = [];

  constructor(config: Partial<MoEConfig> & Record<string, any> = {}) {
    this.config = {
      expertCount: config.numExperts ?? config.expertCount ?? 8,
      topK: config.topK ?? 2,
      capacityFactor: config.capacityFactor ?? 1.25,
      loadBalanceWeight: config.loadBalancingLoss ?? config.loadBalanceWeight ?? 0.01,
      expertHiddenDim: config.expertHiddenDim ?? 512,
      inputDim: config.inputDim ?? 768,
      outputDim: config.outputDim ?? 768,
      routerHiddenDim: config.routerHiddenDim ?? 256,
    };
    this.experts = new Map();
    this.utilization = new Map();
    this.routerWeights = new Float32Array(this.config.inputDim * this.config.expertCount);
    this.routerBias = new Float32Array(this.config.expertCount);
    this.scoresScratch = new Array<number>(this.config.expertCount);
    this.selectScratch = new Int32Array(this.config.expertCount);

    // Initialize the expert output scratch pool to topK elements of outputDim size.
    this.expertOutputsScratch = Array.from(
      { length: this.config.topK },
      () => new Float32Array(this.config.outputDim)
    );

    this.initializeExpertWeights();
    this.initializeExperts();
  }

  private initializeExpertWeights(): void {
    const scale = Math.sqrt(2.0 / this.config.inputDim);
    for (let i = 0; i < this.routerWeights.length; i++) {
      this.routerWeights[i] = (Math.random() * 2 - 1) * scale;
    }
  }

  private initializeExperts(): void {
    for (let i = 0; i < this.config.expertCount; i++) {
      const fanIn = this.config.inputDim;
      const fanOut = this.config.expertHiddenDim;
      const scale = Math.sqrt(2.0 / fanIn);
      const weights = new Float32Array(fanIn * fanOut);
      const bias = new Float32Array(fanOut);
      for (let j = 0; j < weights.length; j++) {
        weights[j] = (Math.random() * 2 - 1) * scale;
      }
      this.experts.set(i, { weights, bias });
      this.utilization.set(i, { calls: 0, tokens: 0, weightSum: 0 });
    }
  }

  route(input: Float32Array): RouterDecision {
    const scores = this.computeRouterScores(input);
    const topKIndices = this.selectTopK(scores);

    // OPTIMIZATION: Manually map scores to topScores to avoid callback overhead.
    const numK = topKIndices.length;
    const topScores = new Array<number>(numK);
    for (let i = 0; i < numK; i++) {
      topScores[i] = scores[topKIndices[i]];
    }
    const routerWeights = this.softmax(topScores);

    // Ensure our expertOutputsScratch array pool is sufficiently sized for numK (top-K)
    while (this.expertOutputsScratch.length < numK) {
      this.expertOutputsScratch.push(new Float32Array(this.config.outputDim));
    }

    const expertOutputs: Float32Array[] = [];
    for (let i = 0; i < numK; i++) {
      const expertIdx = topKIndices[i];
      const expert = this.experts.get(expertIdx)!;

      // Grab a pre-allocated Float32Array scratch buffer instead of allocating a new one
      const output = this.expertOutputsScratch[i];
      output.fill(0);
      output.set(expert.bias);

      const weights = expert.weights;
      const hiddenDim = this.config.expertHiddenDim;

      // OPTIMIZATION: 8x loop unrolling on inner dimension and zero-value skip-path.
      const limit = hiddenDim - 7;
      for (let k = 0; k < input.length; k++) {
        const inputVal = input[k];
        if (inputVal === 0) continue; // Skip multiplications for zero-inputs (sparsity fast-path)
        const weightOffset = k * hiddenDim;
        let j = 0;
        for (; j < limit; j += 8) {
          output[j] += inputVal * weights[weightOffset + j];
          output[j + 1] += inputVal * weights[weightOffset + j + 1];
          output[j + 2] += inputVal * weights[weightOffset + j + 2];
          output[j + 3] += inputVal * weights[weightOffset + j + 3];
          output[j + 4] += inputVal * weights[weightOffset + j + 4];
          output[j + 5] += inputVal * weights[weightOffset + j + 5];
          output[j + 6] += inputVal * weights[weightOffset + j + 6];
          output[j + 7] += inputVal * weights[weightOffset + j + 7];
        }
        for (; j < hiddenDim; j++) {
          output[j] += inputVal * weights[weightOffset + j];
        }
      }

      expertOutputs.push(output);
      this.trackUtilization(expertIdx, routerWeights[i]);
    }

    const combinedOutput = new Float32Array(this.config.outputDim);

    // OPTIMIZATION: Specialize combination step for typical top-K configurations
    // to bypass nested loops, pointer indexing, and bounds checks.
    if (numK === 1) {
      const out0 = expertOutputs[0];
      const w0 = routerWeights[0];
      for (let j = 0; j < this.config.outputDim; j++) {
        combinedOutput[j] = out0[j] * w0;
      }
    } else if (numK === 2) {
      const out0 = expertOutputs[0];
      const out1 = expertOutputs[1];
      const w0 = routerWeights[0];
      const w1 = routerWeights[1];
      for (let j = 0; j < this.config.outputDim; j++) {
        combinedOutput[j] = out0[j] * w0 + out1[j] * w1;
      }
    } else if (numK === 4) {
      const out0 = expertOutputs[0];
      const out1 = expertOutputs[1];
      const out2 = expertOutputs[2];
      const out3 = expertOutputs[3];
      const w0 = routerWeights[0];
      const w1 = routerWeights[1];
      const w2 = routerWeights[2];
      const w3 = routerWeights[3];
      for (let j = 0; j < this.config.outputDim; j++) {
        combinedOutput[j] = out0[j] * w0 + out1[j] * w1 + out2[j] * w2 + out3[j] * w3;
      }
    } else {
      // General fallback loop for non-standard top-K values
      for (let j = 0; j < this.config.outputDim; j++) {
        let sum = 0;
        for (let i = 0; i < numK; i++) {
          sum += expertOutputs[i][j] * routerWeights[i];
        }
        combinedOutput[j] = sum;
      }
    }

    const entropy = this.computeEntropy(scores);
    const loadBalanceLoss = this.computeLoadBalanceLoss();

    return {
      expertIndices: topKIndices,
      routerWeights,
      expertOutputs,
      combinedOutput,
      entropy,
      loadBalanceLoss,
    };
  }

  forward(input: Float32Array, layerIndex: number = 0): MoELayerOutput {
    const decision = this.route(input);
    const expertContributions = new Map<string, number>();
    for (let i = 0; i < decision.expertIndices.length; i++) {
      expertContributions.set(`expert_${decision.expertIndices[i]}`, decision.routerWeights[i] || 0);
    }
    return {
      output: decision.combinedOutput,
      decision,
      layerIndex,
      expertContributions,
    };
  }

  addExpert(weights: Float32Array, bias: Float32Array): number;
  addExpert(config: { id: string; name: string; specialization: string }): number;
  addExpert(first: Float32Array | { id: string; name: string; specialization: string }, bias?: Float32Array): number {
    const expertId = this.experts.size;
    if (first instanceof Float32Array) {
      this.experts.set(expertId, { weights: first, bias: bias || new Float32Array(0) });
    } else {
      const dim = this.config.expertHiddenDim || 128;
      const weights = new Float32Array(this.config.inputDim * dim);
      const scale = Math.sqrt(2.0 / this.config.inputDim);
      for (let i = 0; i < weights.length; i++) {
        weights[i] = (Math.random() * 2 - 1) * scale;
      }
      this.experts.set(expertId, { weights, bias: new Float32Array(dim) });
    }
    this.utilization.set(expertId, { calls: 0, tokens: 0, weightSum: 0 });
    this.growRouterCapacity();
    return expertId;
  }

  /**
   * Grow routerWeights/routerBias to cover every expert currently registered.
   * Both addExpert overloads must call this: the router-scoring loop indexes
   * routerWeights as `input[i] * routerWeights[i * expertCount + e]`, so a
   * bumped expertCount without a resized routerWeights reads past the end of
   * the array (undefined -> NaN, which then poisons the whole pipeline).
   * The old flat-copy grow also silently scrambled the row-major
   * (inputDim x expertCount) layout whenever expertCount changed; this
   * rebuild copies element-by-element in (input, expert) coordinates so
   * existing experts keep their learned router weights.
   */
  private growRouterCapacity(): void {
    const inputDim = this.config.inputDim;
    const oldCount = this.routerBias.length;
    const newCount = this.experts.size;
    if (newCount <= oldCount) {
      this.config.expertCount = newCount;
      return;
    }

    const scale = Math.sqrt(2.0 / inputDim);
    const newWeights = new Float32Array(inputDim * newCount);
    for (let i = 0; i < inputDim; i++) {
      for (let e = 0; e < newCount; e++) {
        newWeights[i * newCount + e] = e < oldCount
          ? this.routerWeights[i * oldCount + e]
          : (Math.random() * 2 - 1) * scale;
      }
    }
    this.routerWeights = newWeights;

    const newBias = new Float32Array(newCount);
    newBias.set(this.routerBias);
    this.routerBias = newBias;

    this.scoresScratch = new Array<number>(newCount);
    this.selectScratch = new Int32Array(newCount);

    this.config.expertCount = newCount;
  }

  removeExpert(expertId: number): boolean {
    if (!this.experts.has(expertId)) return false;

    // The router indexes routerWeights as input[i] * routerWeights[i *
    // expertCount + e] and selectTopK returns dense positions 0..expertCount-1,
    // so experts must stay a contiguous 0..n-1 block. A bare delete would
    // shrink expertCount while leaving routerWeights at the old width and the
    // id space sparse, and the next forward() would index out of bounds.
    // Rebuild everything densely, dropping the removed expert's router column
    // and preserving each survivor's learned column.
    const inputDim = this.config.inputDim;
    const oldCount = this.routerBias.length;
    const survivors = Array.from(this.experts.keys())
      .filter(id => id !== expertId)
      .sort((a, b) => a - b);

    const newExperts = new Map<number, { weights: Float32Array; bias: Float32Array }>();
    const newUtil = new Map<number, { calls: number; tokens: number; weightSum: number }>();
    const newWeights = new Float32Array(inputDim * survivors.length);
    const newBias = new Float32Array(survivors.length);

    survivors.forEach((oldId, newId) => {
      newExperts.set(newId, this.experts.get(oldId)!);
      newUtil.set(newId, this.utilization.get(oldId) ?? { calls: 0, tokens: 0, weightSum: 0 });
      newBias[newId] = this.routerBias[oldId] ?? 0;
      for (let i = 0; i < inputDim; i++) {
        newWeights[i * survivors.length + newId] = this.routerWeights[i * oldCount + oldId] ?? 0;
      }
    });

    this.experts = newExperts;
    this.utilization = newUtil;
    this.routerWeights = newWeights;
    this.routerBias = newBias;
    this.scoresScratch = new Array<number>(survivors.length);
    this.selectScratch = new Int32Array(survivors.length);
    this.config.expertCount = survivors.length;
    return true;
  }

  setExpertWeights(expertId: number, weights: Float32Array, bias: Float32Array): void {
    if (this.experts.has(expertId)) {
      this.experts.set(expertId, { weights, bias });
    }
  }

  getUtilizationStats(): ExpertUtilizationStats[] {
    const stats: ExpertUtilizationStats[] = [];
    for (const [expertId, util] of this.utilization) {
      const totalCalls = util.calls;
      stats.push({
        expertId,
        utilization: totalCalls > 0 ? util.tokens / totalCalls : 0,
        totalCalls,
        totalTokens: util.tokens,
        avgWeight: totalCalls > 0 ? util.weightSum / totalCalls : 0,
      });
    }
    return stats;
  }

  getExpertCount(): number {
    return this.experts.size;
  }

  getExpertList(): number[] {
    return Array.from(this.experts.keys());
  }

  private computeRouterScores(input: Float32Array): number[] {
    const expertCount = this.config.expertCount;
    const scores = this.scoresScratch;
    const weights = this.routerWeights;
    const inputLen = input.length;
    const bias = this.routerBias;
    
    // OPTIMIZATION: Initialize scores with expert biases
    for (let exp = 0; exp < expertCount; exp++) {
      scores[exp] = bias[exp];
    }

    // OPTIMIZATION: Sequential cache-locality outer-input inner-expert loop.
    // Since weights are stored in (inputDim x expertCount) layout, scanning
    // expertCount contiguously keeps all memory accesses fully sequential (step size of 1).
    for (let i = 0; i < inputLen; i++) {
      const inputVal = input[i];
      if (inputVal === 0) continue; // Sparsity fast-path
      const weightOffset = i * expertCount;
      
      let exp = 0;
      const limit = expertCount - 7;
      for (; exp < limit; exp += 8) {
        scores[exp]     += inputVal * weights[weightOffset + exp];
        scores[exp + 1] += inputVal * weights[weightOffset + exp + 1];
        scores[exp + 2] += inputVal * weights[weightOffset + exp + 2];
        scores[exp + 3] += inputVal * weights[weightOffset + exp + 3];
        scores[exp + 4] += inputVal * weights[weightOffset + exp + 4];
        scores[exp + 5] += inputVal * weights[weightOffset + exp + 5];
        scores[exp + 6] += inputVal * weights[weightOffset + exp + 6];
        scores[exp + 7] += inputVal * weights[weightOffset + exp + 7];
      }
      for (; exp < expertCount; exp++) {
        scores[exp] += inputVal * weights[weightOffset + exp];
      }
    }
    return scores;
  }

  private selectTopK(scores: number[]): number[] {
    const k = Math.min(this.config.topK, scores.length);

    // OPTIMIZATION: Avoid sorting and allocations for small k
    if (k === 1) {
      let maxIdx = 0;
      let maxVal = scores[0];
      for (let i = 1; i < scores.length; i++) {
        if (scores[i] > maxVal) {
          maxVal = scores[i];
          maxIdx = i;
        }
      }
      return [maxIdx];
    } else if (k === 2 && scores.length >= 2) {
      let max0 = 0, max1 = 1;
      if (scores[1] > scores[0]) {
        max0 = 1;
        max1 = 0;
      }
      let val0 = scores[max0];
      let val1 = scores[max1];
      for (let i = 2; i < scores.length; i++) {
        const val = scores[i];
        if (val > val0) {
          val1 = val0;
          max1 = max0;
          val0 = val;
          max0 = i;
        } else if (val > val1) {
          val1 = val;
          max1 = i;
        }
      }
      return [max0, max1];
    } else if (k === 4 && scores.length >= 4) {
      // OPTIMIZATION: 4-element specialization using inline sorting network
      // and branchless element-shifting to completely bypass array sorting/allocations.
      let max0 = 0, max1 = 1, max2 = 2, max3 = 3;
      if (scores[max1] > scores[max0]) { const t = max0; max0 = max1; max1 = t; }
      if (scores[max2] > scores[max0]) { const t = max0; max0 = max2; max2 = t; }
      if (scores[max3] > scores[max0]) { const t = max0; max0 = max3; max3 = t; }
      if (scores[max2] > scores[max1]) { const t = max1; max1 = max2; max2 = t; }
      if (scores[max3] > scores[max1]) { const t = max1; max1 = max3; max3 = t; }
      if (scores[max3] > scores[max2]) { const t = max2; max2 = max3; max3 = t; }

      let val0 = scores[max0];
      let val1 = scores[max1];
      let val2 = scores[max2];
      let val3 = scores[max3];

      for (let i = 4; i < scores.length; i++) {
        const val = scores[i];
        if (val > val0) {
          val3 = val2; max3 = max2;
          val2 = val1; max2 = max1;
          val1 = val0; max1 = max0;
          val0 = val; max0 = i;
        } else if (val > val1) {
          val3 = val2; max3 = max2;
          val2 = val1; max2 = max1;
          val1 = val; max1 = i;
        } else if (val > val2) {
          val3 = val2; max3 = max2;
          val2 = val; max2 = i;
        } else if (val > val3) {
          val3 = val; max3 = i;
        }
      }
      return [max0, max1, max2, max3];
    }

    // OPTIMIZATION: Reuse pre-allocated selectScratch buffer to avoid allocations.
    const indices = this.selectScratch;
    for (let i = 0; i < scores.length; i++) {
      indices[i] = i;
    }
    indices.sort((a, b) => scores[b] - scores[a]);
    const result = new Array<number>(k);
    for (let i = 0; i < k; i++) {
      result[i] = indices[i];
    }
    return result;
  }

  private softmax(values: number[]): number[] {
    const len = values.length;
    // OPTIMIZATION: Specialize softmax for len === 1 and len === 2 to bypass allocation
    if (len === 1) {
      return [1.0];
    } else if (len === 2) {
      const v0 = values[0], v1 = values[1];
      const max = v0 > v1 ? v0 : v1;
      const e0 = Math.exp(v0 - max);
      const e1 = Math.exp(v1 - max);
      const sum = e0 + e1;
      return [e0 / sum, e1 / sum];
    } else if (len === 4) {
      // OPTIMIZATION: Specialize softmax for len === 4 to bypass loops, array allocations, and divisions.
      const v0 = values[0], v1 = values[1], v2 = values[2], v3 = values[3];
      let max = v0;
      if (v1 > max) max = v1;
      if (v2 > max) max = v2;
      if (v3 > max) max = v3;
      const e0 = Math.exp(v0 - max);
      const e1 = Math.exp(v1 - max);
      const e2 = Math.exp(v2 - max);
      const e3 = Math.exp(v3 - max);
      const sum = e0 + e1 + e2 + e3;
      const invSum = sum === 0 ? 1 : 1.0 / sum;
      return [e0 * invSum, e1 * invSum, e2 * invSum, e3 * invSum];
    }

    // OPTIMIZATION: Single-pass loops over standard arrays without spread operator
    // or nested/higher-order functions, avoiding GC and engine optimization boundaries.
    let max = values[0];
    for (let i = 1; i < len; i++) {
      if (values[i] > max) {
        max = values[i];
      }
    }
    const exps = new Float64Array(len);
    let sum = 0;
    for (let i = 0; i < len; i++) {
      const e = Math.exp(values[i] - max);
      exps[i] = e;
      sum += e;
    }
    if (sum === 0) sum = 1;
    const result = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      result[i] = exps[i] / sum;
    }
    return result;
  }

  private computeEntropy(scores: number[]): number {
    const probs = this.softmax(scores);
    let entropy = 0;
    for (const p of probs) {
      if (p > 0) entropy -= p * Math.log(p);
    }
    return entropy;
  }

  private computeLoadBalanceLoss(): number {
    const stats = this.getUtilizationStats();
    if (stats.length === 0) return 0;
    const totalUtil = stats.reduce((s, x) => s + x.utilization, 0);
    const meanUtil = totalUtil / stats.length;
    let variance = 0;
    for (const s of stats) {
      variance += Math.pow(s.utilization - meanUtil, 2);
    }
    return variance / stats.length;
  }

  private trackUtilization(expertId: number, weight: number): void {
    const util = this.utilization.get(expertId);
    if (util) {
      util.calls++;
      util.tokens++;
      util.weightSum += weight;
    }
  }

  private hashInput(input: Float32Array): string {
    let hash = 0;
    for (let i = 0; i < Math.min(input.length, 64); i++) {
      hash = ((hash << 5) - hash) + Math.round(input[i] * 1000);
      hash = hash & hash;
    }
    return `h_${hash}`;
  }
}
