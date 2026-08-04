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
/**
 * Clamp/validate a requested bit width. bits<=1 makes qMax (symmetric) or
 * levels (asymmetric) hit 0, so scale divides by zero -> Infinity -> every
 * dequantized weight becomes 0 * Infinity = NaN. 16 keeps qMax comfortably
 * inside a JS-safe integer range for the bit-packer below. Also NaN-safe:
 * a non-finite bits value (e.g. an unvalidated request field) falls back to
 * 8 instead of propagating NaN through every weight.
 */
export function clampBits(bits, fallback = 8) {
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
    constructor() {
        this.min = Infinity;
        this.max = -Infinity;
        this.sum = 0;
        this.count = 0;
    }
    observe(samples) {
        for (let i = 0; i < samples.length; i++) {
            const v = samples[i];
            if (!Number.isFinite(v))
                continue;
            if (v < this.min)
                this.min = v;
            if (v > this.max)
                this.max = v;
            this.sum += v;
            this.count++;
        }
    }
    reset() {
        this.min = Infinity;
        this.max = -Infinity;
        this.sum = 0;
        this.count = 0;
    }
    hasSamples() {
        return this.count > 0;
    }
    finalize() {
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
function symmetricScale(absMax, bits) {
    const qMax = Math.floor((Math.pow(2, bits) - 1) / 2);
    const scale = (absMax / qMax) || 1;
    return { scale, zeroPoint: 0, symmetric: true, bits };
}
function asymmetricScale(min, max, bits) {
    const levels = Math.pow(2, bits) - 1;
    const scale = ((max - min) / levels) || 1;
    const zeroPoint = Math.round(-min / scale);
    return { scale, zeroPoint, symmetric: false, bits };
}
/** True when a tensor's range is roughly balanced around zero (mixed-method heuristic). */
function isRoughlySymmetric(min, max) {
    const absMax = Math.max(Math.abs(min), Math.abs(max));
    if (absMax === 0)
        return true;
    const symmetryRatio = Math.min(Math.abs(min), Math.abs(max)) / absMax;
    return symmetryRatio > 0.5;
}
function deriveScale(min, max, bits, method) {
    const absMax = Math.max(Math.abs(min), Math.abs(max));
    const useSymmetric = method === 'symmetric' || (method === 'mixed' && isRoughlySymmetric(min, max));
    return useSymmetric ? symmetricScale(absMax, bits) : asymmetricScale(min, max, bits);
}
function applyScale(value, scaleInfo) {
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
export function packLevels(levels, bits) {
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
export function unpackLevels(packed, count, bits) {
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
    constructor(config) {
        this.calibration = new Map();
        this.config = { ...config };
    }
    /**
     * Quantize a Float32Array to N-bit integers then dequantize back
     * (dynamic mode: scale is derived from this call's own min/max).
     * Symmetric: clamp to +/-absMax, scale = absMax / (2^(bits-1) - 1).
     * Asymmetric: min/max scale, zeroPoint offset.
     * Mixed: uses symmetric for layers with large spread, asymmetric otherwise.
     */
    quantize(weights, bits, out) {
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
            if (v0 < wMin)
                wMin = v0;
            if (v0 > wMax)
                wMax = v0;
            if (v1 < wMin)
                wMin = v1;
            if (v1 > wMax)
                wMax = v1;
            if (v2 < wMin)
                wMin = v2;
            if (v2 > wMax)
                wMax = v2;
            if (v3 < wMin)
                wMin = v3;
            if (v3 > wMax)
                wMax = v3;
        }
        for (; i < len; i++) {
            const v = weights[i];
            if (v < wMin)
                wMin = v;
            if (v > wMax)
                wMax = v;
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
    quantizeStatic(weights, stats, bits, out) {
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
    calibrate(layerKey, samples) {
        let collector = this.calibration.get(layerKey);
        if (!collector) {
            collector = new CalibrationCollector();
            this.calibration.set(layerKey, collector);
        }
        collector.observe(samples);
    }
    getCalibrationStats(layerKey) {
        return this.calibration.get(layerKey)?.finalize();
    }
    clearCalibration(layerKey) {
        if (layerKey)
            this.calibration.delete(layerKey);
        else
            this.calibration.clear();
    }
    dequantizeWith(weights, scaleInfo, out) {
        const result = out || new Float32Array(weights.length);
        const { scale, zeroPoint, symmetric, bits } = scaleInfo;
        const len = weights.length;
        if (symmetric) {
            const qMax = Math.floor((Math.pow(2, bits) - 1) / 2);
            const qMin = -qMax;
            let i = 0;
            for (; i < len - 3; i += 4) {
                const w0 = weights[i];
                const w1 = weights[i + 1];
                const w2 = weights[i + 2];
                const w3 = weights[i + 3];
                const lv0 = Math.max(qMin, Math.min(qMax, Math.round(w0 / scale)));
                const lv1 = Math.max(qMin, Math.min(qMax, Math.round(w1 / scale)));
                const lv2 = Math.max(qMin, Math.min(qMax, Math.round(w2 / scale)));
                const lv3 = Math.max(qMin, Math.min(qMax, Math.round(w3 / scale)));
                result[i] = lv0 * scale;
                result[i + 1] = lv1 * scale;
                result[i + 2] = lv2 * scale;
                result[i + 3] = lv3 * scale;
            }
            for (; i < len; i++) {
                const level = Math.max(qMin, Math.min(qMax, Math.round(weights[i] / scale)));
                result[i] = level * scale;
            }
        }
        else {
            const levels = Math.pow(2, bits) - 1;
            const maxLevel = Math.round(levels);
            let i = 0;
            for (; i < len - 3; i += 4) {
                const w0 = weights[i];
                const w1 = weights[i + 1];
                const w2 = weights[i + 2];
                const w3 = weights[i + 3];
                const lv0 = Math.max(0, Math.min(maxLevel, Math.round(w0 / scale + zeroPoint)));
                const lv1 = Math.max(0, Math.min(maxLevel, Math.round(w1 / scale + zeroPoint)));
                const lv2 = Math.max(0, Math.min(maxLevel, Math.round(w2 / scale + zeroPoint)));
                const lv3 = Math.max(0, Math.min(maxLevel, Math.round(w3 / scale + zeroPoint)));
                result[i] = (lv0 - zeroPoint) * scale;
                result[i + 1] = (lv1 - zeroPoint) * scale;
                result[i + 2] = (lv2 - zeroPoint) * scale;
                result[i + 3] = (lv3 - zeroPoint) * scale;
            }
            for (; i < len; i++) {
                const level = Math.max(0, Math.min(maxLevel, Math.round(weights[i] / scale + zeroPoint)));
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
    pack(weights, layerKey, bits) {
        const effectiveBits = clampBits(bits ?? this.config.bits);
        const stats = layerKey ? this.calibration.get(layerKey)?.finalize() : undefined;
        let min;
        let max;
        if (stats && stats.count > 0) {
            min = stats.min;
            max = stats.max;
        }
        else {
            min = Infinity;
            max = -Infinity;
            const len = weights.length;
            let i = 0;
            for (; i < len - 3; i += 4) {
                const v0 = weights[i];
                const v1 = weights[i + 1];
                const v2 = weights[i + 2];
                const v3 = weights[i + 3];
                if (v0 < min)
                    min = v0;
                if (v0 > max)
                    max = v0;
                if (v1 < min)
                    min = v1;
                if (v1 > max)
                    max = v1;
                if (v2 < min)
                    min = v2;
                if (v2 > max)
                    max = v2;
                if (v3 < min)
                    min = v3;
                if (v3 > max)
                    max = v3;
            }
            for (; i < len; i++) {
                const v = weights[i];
                if (v < min)
                    min = v;
                if (v > max)
                    max = v;
            }
            if (min === Infinity) {
                min = 0;
                max = 0;
            }
        }
        if (max === min) {
            max = min + 1;
        } // avoid a zero-width range collapsing the scale
        const scaleInfo = deriveScale(min, max, effectiveBits, this.config.method);
        const offset = scaleInfo.symmetric ? Math.floor((Math.pow(2, effectiveBits) - 1) / 2) : 0;
        const levels = new Uint32Array(weights.length);
        const { scale, zeroPoint, symmetric, bits: sBits } = scaleInfo;
        const len = weights.length;
        if (symmetric) {
            const qMax = Math.floor((Math.pow(2, sBits) - 1) / 2);
            const qMin = -qMax;
            let i = 0;
            for (; i < len - 3; i += 4) {
                const lv0 = Math.max(qMin, Math.min(qMax, Math.round(weights[i] / scale)));
                const lv1 = Math.max(qMin, Math.min(qMax, Math.round(weights[i + 1] / scale)));
                const lv2 = Math.max(qMin, Math.min(qMax, Math.round(weights[i + 2] / scale)));
                const lv3 = Math.max(qMin, Math.min(qMax, Math.round(weights[i + 3] / scale)));
                levels[i] = lv0 + offset;
                levels[i + 1] = lv1 + offset;
                levels[i + 2] = lv2 + offset;
                levels[i + 3] = lv3 + offset;
            }
            for (; i < len; i++) {
                const level = Math.max(qMin, Math.min(qMax, Math.round(weights[i] / scale)));
                levels[i] = level + offset;
            }
        }
        else {
            const levelsCount = Math.pow(2, sBits) - 1;
            const maxLevel = Math.round(levelsCount);
            let i = 0;
            for (; i < len - 3; i += 4) {
                const lv0 = Math.max(0, Math.min(maxLevel, Math.round(weights[i] / scale + zeroPoint)));
                const lv1 = Math.max(0, Math.min(maxLevel, Math.round(weights[i + 1] / scale + zeroPoint)));
                const lv2 = Math.max(0, Math.min(maxLevel, Math.round(weights[i + 2] / scale + zeroPoint)));
                const lv3 = Math.max(0, Math.min(maxLevel, Math.round(weights[i + 3] / scale + zeroPoint)));
                levels[i] = lv0 + offset;
                levels[i + 1] = lv1 + offset;
                levels[i + 2] = lv2 + offset;
                levels[i + 3] = lv3 + offset;
            }
            for (; i < len; i++) {
                const level = Math.max(0, Math.min(maxLevel, Math.round(weights[i] / scale + zeroPoint)));
                levels[i] = level + offset;
            }
        }
        return {
            packed: packLevels(levels, effectiveBits),
            length: weights.length,
            scaleInfo,
        };
    }
    unpack(tensor) {
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
        }
        else {
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
    quantizeModel(model) {
        const result = {};
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
    packModel(model, bits) {
        const result = {};
        const excluded = new Set(this.config.excludeLayers);
        for (const key of Object.keys(model)) {
            if (excluded.has(key))
                continue;
            result[key] = this.pack(model[key], key, bits);
        }
        return result;
    }
    /**
     * Serialize a quantized model to JSON string.
     */
    serializeQuantized(model) {
        const weights = {};
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
    serializePacked(packedModel) {
        const layers = {};
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
    deserializePacked(json) {
        const parsed = JSON.parse(json);
        const result = {};
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
    getConfig() {
        return { ...this.config };
    }
}
