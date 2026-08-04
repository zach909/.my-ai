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
      if (out) {
        out.set(weights);
        return out;
      }
      return new Float32Array(weights);
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
      if (out) {
        out.set(weights);
        return out;
      }
      return new Float32Array(weights);
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
