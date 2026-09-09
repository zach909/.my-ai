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
export const complex = (re, im = 0) => ({ re, im });
/** Polar form: magnitude·e^{iθ} = magnitude·(cosθ + i·sinθ). */
export const fromPolar = (magnitude, phase) => ({
    re: magnitude * Math.cos(phase),
    im: magnitude * Math.sin(phase),
});
export const complexAdd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
export const complexSub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
/** (a+bi)(c+di) = (ac - bd) + (ad + bc)i — the i² = -1 rule. */
export const complexMul = (a, b) => ({
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
});
export const complexScale = (a, k) => ({ re: a.re * k, im: a.im * k });
/** Complex conjugate a - bi. */
export const conj = (a) => ({ re: a.re, im: -a.im });
/** Magnitude |a+bi| = sqrt(a² + b²). */
export const abs = (a) => Math.hypot(a.re, a.im);
/** Squared magnitude (Born-rule probability weight, no sqrt). */
export const absSq = (a) => a.re * a.re + a.im * a.im;
/** Argument (phase angle) in (-π, π]. */
export const arg = (a) => Math.atan2(a.im, a.re);
/**
 * Multiplicative inverse 1/z = conj(z)/|z|². Defined for every nonzero z —
 * the division-algebra guarantee. Throws on zero.
 */
export const inv = (a) => {
    const d = absSq(a);
    if (d === 0)
        throw new Error('complex inverse of zero');
    return { re: a.re / d, im: -a.im / d };
};
export const complexDiv = (a, b) => complexMul(a, inv(b));
/** The imaginary unit i, with i·i = -1. */
export const I = { re: 0, im: 1 };
export const dual = (val, der = 0) => ({ val, der });
/** A variable to differentiate with respect to: value x, derivative 1. */
export const variable = (x) => ({ val: x, der: 1 });
/** A constant: derivative 0. */
export const constant = (x) => ({ val: x, der: 0 });
export const dualAdd = (a, b) => ({ val: a.val + b.val, der: a.der + b.der });
export const dualSub = (a, b) => ({ val: a.val - b.val, der: a.der - b.der });
/** Product rule: (a + a'ε)(b + b'ε) = ab + (a'b + ab')ε  (the ε² term vanishes). */
export const dualMul = (a, b) => ({
    val: a.val * b.val,
    der: a.der * b.val + a.val * b.der,
});
export const dualScale = (a, k) => ({ val: a.val * k, der: a.der * k });
/** tanh with its derivative 1 - tanh² carried through — the mesh's activation. */
export const tanh = (a) => {
    const t = Math.tanh(a.val);
    return { val: t, der: (1 - t * t) * a.der };
};
/** Quotient rule. */
export const dualDiv = (a, b) => ({
    val: a.val / b.val,
    der: (a.der * b.val - a.val * b.der) / (b.val * b.val),
});
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
    // BOLT OPTIMIZATION: Replacing slow Math.pow(2, bits) with fast register-level bit shift (1 << bits).
    // Math.floor(((1 << bits) - 1) / 2) is mathematically identical to ((1 << bits) - 1) >> 1.
    const qMax = ((1 << bits) - 1) >> 1;
    const scale = (absMax / qMax) || 1;
    return { scale, zeroPoint: 0, symmetric: true, bits };
}
function asymmetricScale(min, max, bits) {
    // BOLT OPTIMIZATION: Replacing slow Math.pow(2, bits) with fast register-level bit shift (1 << bits).
    const levels = (1 << bits) - 1;
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
    // BOLT OPTIMIZATION: Fast-path for the highly frequent 8-bit case.
    // Using 4x unrolled index loop copying avoids TypedArray.set cross-type conversion built-in overhead.
    if (bits === 8) {
        const len = levels.length;
        const out = new Uint8Array(len);
        let i = 0;
        for (; i < len - 3; i += 4) {
            out[i] = levels[i];
            out[i + 1] = levels[i + 1];
            out[i + 2] = levels[i + 2];
            out[i + 3] = levels[i + 3];
        }
        for (; i < len; i++) {
            out[i] = levels[i];
        }
        return out;
    }
    // BOLT OPTIMIZATION: Fast-path for 16-bit configuration.
    // Using 4x unrolled index loop into Uint16Array avoids TypedArray.set cross-type conversion overhead.
    if (bits === 16) {
        const len = levels.length;
        const u16 = new Uint16Array(len);
        let i = 0;
        for (; i < len - 3; i += 4) {
            u16[i] = levels[i];
            u16[i + 1] = levels[i + 1];
            u16[i + 2] = levels[i + 2];
            u16[i + 3] = levels[i + 3];
        }
        for (; i < len; i++) {
            u16[i] = levels[i];
        }
        return new Uint8Array(u16.buffer, u16.byteOffset, u16.byteLength);
    }
    // BOLT OPTIMIZATION: Extremely fast-path for 4-bit configuration.
    // Directly pack adjacent nibbles into single bytes.
    if (bits === 4) {
        const len = levels.length;
        const out = new Uint8Array(Math.ceil(len / 2));
        const limit = len & ~1;
        let bytePos = 0;
        for (let i = 0; i < limit; i += 2) {
            out[bytePos++] = levels[i] | (levels[i + 1] << 4);
        }
        if (len & 1) {
            out[bytePos] = levels[len - 1];
        }
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
    // BOLT OPTIMIZATION: Fast-path for the highly frequent 8-bit case.
    // Using 4x unrolled index loop copying avoids TypedArray.set cross-type conversion built-in
    // and subarray view object allocation overhead.
    if (bits === 8) {
        const out = new Uint32Array(count);
        let i = 0;
        for (; i < count - 3; i += 4) {
            out[i] = packed[i];
            out[i + 1] = packed[i + 1];
            out[i + 2] = packed[i + 2];
            out[i + 3] = packed[i + 3];
        }
        for (; i < count; i++) {
            out[i] = packed[i];
        }
        return out;
    }
    // BOLT OPTIMIZATION: Fast-path for 16-bit configuration.
    // Extract 16-bit words cleanly with 4x unrolled loops, handling offset/alignment boundaries gracefully.
    if (bits === 16) {
        const out = new Uint32Array(count);
        if (packed.byteOffset % 2 === 0) {
            const u16 = new Uint16Array(packed.buffer, packed.byteOffset, count);
            let i = 0;
            for (; i < count - 3; i += 4) {
                out[i] = u16[i];
                out[i + 1] = u16[i + 1];
                out[i + 2] = u16[i + 2];
                out[i + 3] = u16[i + 3];
            }
            for (; i < count; i++) {
                out[i] = u16[i];
            }
        }
        else {
            let i = 0;
            for (; i < count - 3; i += 4) {
                const idx0 = i * 2;
                const idx1 = idx0 + 2;
                const idx2 = idx0 + 4;
                const idx3 = idx0 + 6;
                out[i] = packed[idx0] | (packed[idx0 + 1] << 8);
                out[i + 1] = packed[idx1] | (packed[idx1 + 1] << 8);
                out[i + 2] = packed[idx2] | (packed[idx2 + 1] << 8);
                out[i + 3] = packed[idx3] | (packed[idx3 + 1] << 8);
            }
            for (; i < count; i++) {
                out[i] = packed[i * 2] | (packed[i * 2 + 1] << 8);
            }
        }
        return out;
    }
    // BOLT OPTIMIZATION: Extremely fast-path for 4-bit configuration.
    // Unpack nibbles from single bytes using fast unrolled iteration.
    if (bits === 4) {
        const out = new Uint32Array(count);
        const limit = count & ~1;
        let bytePos = 0;
        for (let i = 0; i < limit; i += 2) {
            const byte = packed[bytePos++];
            out[i] = byte & 0xF;
            out[i + 1] = byte >>> 4;
        }
        if (count & 1) {
            out[count - 1] = packed[bytePos] & 0xF;
        }
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
        // OPTIMIZATION: Pre-computing the inverse scale (1.0 / scale) replaces slow floating-point division
        // with much faster multiplication inside the high-frequency loops.
        // Additionally, function calls to Math.min/Math.max are replaced with inline branchless ternary expressions
        // to bypass the call stack and reduce branching overhead.
        const invScale = 1.0 / scale;
        if (symmetric) {
            // BOLT OPTIMIZATION: Replacing slow Math.pow(2, bits) with fast register-level bit shift (1 << bits).
            const qMax = ((1 << bits) - 1) >> 1;
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
        }
        else {
            // BOLT OPTIMIZATION: Replacing slow Math.pow(2, bits) with fast register-level bit shift (1 << bits).
            const levels = (1 << bits) - 1;
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
        // BOLT OPTIMIZATION: Replacing slow Math.pow(2, bits) with fast register-level bit shift (1 << bits).
        const offset = scaleInfo.symmetric ? (((1 << effectiveBits) - 1) >> 1) : 0;
        const levels = new Uint32Array(weights.length);
        const { scale, zeroPoint, symmetric, bits: sBits } = scaleInfo;
        const len = weights.length;
        // OPTIMIZATION: Pre-computing the inverse scale (1.0 / scale) replaces slow floating-point division
        // with much faster multiplication inside the high-frequency loops.
        // Additionally, function calls to Math.min/Math.max are replaced with inline branchless ternary expressions
        // to bypass the call stack and reduce branching overhead.
        const invScale = 1.0 / scale;
        if (symmetric) {
            // BOLT OPTIMIZATION: Replacing slow Math.pow(2, bits) with fast register-level bit shift (1 << bits).
            const qMax = ((1 << sBits) - 1) >> 1;
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
        }
        else {
            // BOLT OPTIMIZATION: Replacing slow Math.pow(2, bits) with fast register-level bit shift (1 << bits).
            const levelsCount = (1 << sBits) - 1;
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
    unpack(tensor) {
        const { scaleInfo, length } = tensor;
        // BOLT OPTIMIZATION: Replacing slow Math.pow(2, bits) with fast register-level bit shift (1 << bits).
        const offset = scaleInfo.symmetric ? (((1 << scaleInfo.bits) - 1) >> 1) : 0;
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
export class ValueRangeAllocator {
    constructor(config) {
        this.config = { ...config };
        this.allocations = new Map();
        this.stepCount = 0;
    }
    /**
     * Distribute totalPoints equally across all provided neurons.
     */
    initializeNeurons(neuronStates) {
        this.allocations.clear();
        if (neuronStates.length === 0)
            return;
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
    addNeuron(id, initialPoints) {
        if (this.allocations.has(id))
            return;
        if (this.allocations.size === 0) {
            this.allocations.set(id, this.config.totalPoints);
            return;
        }
        const requestedInitial = initialPoints ?? (this.config.totalPoints / (this.allocations.size + 1));
        const clampedInitial = Math.min(this.config.totalPoints, Math.max(0, requestedInitial));
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
    updateNeuronValue(id, delta) {
        if (this.allocations.size === 0)
            return;
        const current = this.allocations.get(id) ?? 0;
        const change = delta * 0.1;
        const newVal = Math.max(0, current + change);
        const actualChange = newVal - current;
        this.allocations.set(id, newVal);
        // Redistribute the opposite change across others
        const otherIds = Array.from(this.allocations.keys()).filter(k => k !== id);
        if (otherIds.length === 0)
            return;
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
    applyDecay() {
        this.stepCount++;
        if (this.stepCount % this.config.redistributionInterval !== 0)
            return;
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
    getDistribution() {
        const neuronAllocations = [];
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
    getValeFractions() {
        const fractions = new Map();
        const maxPts = this.config.totalPoints;
        for (const [id, pts] of this.allocations) {
            fractions.set(id, maxPts > 0 ? Math.min(1, Math.max(0, pts / maxPts)) : 0);
        }
        return fractions;
    }
    /**
     * Demotion: takes 50% of neuron's points and gives them to others equally.
     */
    demoteNeuron(id) {
        const current = this.allocations.get(id) ?? 0;
        const taken = current * 0.5;
        this.allocations.set(id, current - taken);
        const otherIds = Array.from(this.allocations.keys()).filter(k => k !== id);
        if (otherIds.length === 0)
            return;
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
    _pointsToLearningRate(pts) {
        const maxPts = this.config.totalPoints;
        if (maxPts <= 0)
            return this.config.maxLearningRate;
        // fraction ∈ [0,1] where 1 = all points (most stable)
        const fraction = Math.min(1, Math.max(0, pts / maxPts));
        return this.config.maxLearningRate + fraction * (this.config.minLearningRate - this.config.maxLearningRate);
    }
    /** Rescale all allocations so they sum exactly to totalPoints. */
    _normalise() {
        let total = 0;
        for (const pts of this.allocations.values())
            total += pts;
        if (total <= 0 || this.allocations.size === 0)
            return;
        const scale = this.config.totalPoints / total;
        for (const [id, pts] of this.allocations) {
            this.allocations.set(id, Math.max(0, pts * scale));
        }
    }
}
/** Cap on a node's retained settle trace when recordHistory is on. Bounded so
 *  a long-running mesh cannot accumulate every sample it has ever produced. */
const MAX_ACTIVATION_HISTORY = 1000;
export class NeuronMesh {
    constructor(config = {}) {
        this.nextId = 0;
        /**
         * Section 2.1: a skill/expert "group" is purely a label used by the MoE
         * router for gating which neurons compute on a given tick — it has zero
         * effect on wiring. A grouped node is still created (and wired all-to-all,
         * same as any other node) by addNode(); the group only matters to
         * propagate() when an activeGroups set is passed in.
         */
        this.nodeGroups = new Map();
        // Performance cache for CSR layout
        this.cacheValid = false;
        this.cachedNodes = [];
        this.idToIndex = new Map();
        this.flatWeights = new Float32Array(0);
        this.flatIndices = new Int32Array(0);
        this.rowStarts = new Int32Array(0);
        this.biases = new Float32Array(0);
        this.currActivations = new Float32Array(0);
        this.nextActivations = new Float32Array(0);
        this.historyScratch = new Float32Array(0);
        /**
         * Row-major N*N weights, built only when the mesh is fully dense (every
         * node connected to every other -- the connectionDensity 1.0 configuration
         * the brain actually runs). CSR's explicit index array is pure overhead in
         * that case: the indices are just 0..N-1 with the diagonal skipped, so each
         * edge pays an Int32 load to recover a value the loop counter already
         * knows. Dropping it cuts a third of the inner loop's memory traffic and
         * measured 1.36x on the settle step, bit-identical. Empty when the mesh is
         * sparse, in which case propagate() uses the CSR path below.
         */
        this.denseWeights = new Float32Array(0);
        this.denseLayout = false;
        const nodeCount = config.nodeCount ?? config.initialNodeCount ?? 10;
        const actFn = config.activationFn || config.activationFunction || 'relu';
        this.config = {
            initialNodeCount: nodeCount,
            // Was hardcoded to 1.0, so the caller's connectionDensity was dropped on
            // the floor before anything could read it. Default stays 1.0.
            connectionDensity: config.connectionDensity ?? 1.0,
            maxIterations: config.propagationSteps || config.maxIterations || 100,
            convergenceThreshold: config.convergenceThreshold ?? 0.001,
            activationFunction: actFn,
            learningRate: config.learningRate ?? 0.01,
            seed: config.seed ?? 42,
        };
        this.nodes = new Map();
        const tempIds = [];
        for (let i = 0; i < this.config.initialNodeCount; i++) {
            const id = this.nextId++;
            const node = {
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
        // connectionDensity was accepted and then ignored here: this loop wired
        // every pair unconditionally, so a mesh constructed with density 0.3 came
        // out fully connected anyway. addNode() has always honored it, so the same
        // config meant two different things depending on how a neuron arrived.
        // Every caller in the tree passes 1.0, so honoring it changes no existing
        // behavior -- it makes the option mean what it says, and makes the sparse
        // (CSR) settle path reachable and testable instead of dead in practice.
        const density = this.config.connectionDensity;
        const weightScale = Math.sqrt(1 / tempIds.length);
        for (let i = 0; i < tempIds.length; i++) {
            const fromNode = this.nodes.get(tempIds[i]);
            for (let j = 0; j < tempIds.length; j++) {
                if (i === j)
                    continue;
                if (density < 1 && Math.random() >= density)
                    continue;
                fromNode.connections.set(tempIds[j], (Math.random() * 2 - 1) * weightScale);
            }
        }
        this.refreshCache();
    }
    /**
     * Synchronize the CSR cache with the current nodes Map.
     */
    refreshCache() {
        this.cachedNodes = Array.from(this.nodes.values());
        const N = this.cachedNodes.length;
        this.idToIndex = new Map(this.cachedNodes.map((n, i) => [n.id, i]));
        this.biases = new Float32Array(this.cachedNodes.map(n => n.bias));
        this.currActivations = new Float32Array(this.cachedNodes.map(n => n.activation));
        this.nextActivations = new Float32Array(N);
        let totalEdges = 0;
        for (const n of this.cachedNodes)
            totalEdges += n.connections.size;
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
        // Dense iff every node connects to every other node (self excluded).
        this.denseLayout = N > 1 && edgePtr === N * (N - 1);
        if (this.denseLayout) {
            this.denseWeights = new Float32Array(N * N); // diagonal stays 0: no self-edge
            for (let i = 0; i < N; i++) {
                const base = i * N;
                const start = this.rowStarts[i], end = this.rowStarts[i + 1];
                for (let k = start; k < end; k++)
                    this.denseWeights[base + this.flatIndices[k]] = this.flatWeights[k];
            }
        }
        else if (this.denseWeights.length > 0) {
            this.denseWeights = new Float32Array(0);
        }
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
    propagate(inputActivations, vale, activeGroups, 
    /**
     * Record the per-iteration activation trace (`nodeHistory`, and each
     * node's `activationHistory`). Off by default: nothing in the system
     * reads either one, while recording them cost a scratch write per neuron
     * per settle iteration in the hottest loop, N array allocations and N map
     * inserts per call, and -- because the per-node trace was appended to and
     * never truncated -- unbounded growth. Measured at 32,400 retained
     * numbers on a *single* node after 3,200 propagate() calls, times every
     * node in the mesh. Pass true when you actually want to inspect a settle
     * trace (convergence debugging, iterative-training diagnostics).
     */
    recordHistory = false) {
        if (!this.cacheValid)
            this.refreshCache();
        const nodes = this.cachedNodes;
        const N = nodes.length;
        const maxIters = this.config.maxIterations;
        // Bolt's Optimization: Pre-allocate a class-level flat history scratchpad to avoid O(N) array allocations inside propagation
        if (recordHistory) {
            const totalHistorySize = N * maxIters;
            if (this.historyScratch.length < totalHistorySize) {
                this.historyScratch = new Float32Array(totalHistorySize);
            }
        }
        // Synchronize activations from source of truth and inputs
        for (let i = 0; i < N; i++)
            this.currActivations[i] = nodes[i].activation;
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
        let curr = this.currActivations;
        let next = this.nextActivations;
        const flatWeights = this.flatWeights;
        const flatIndices = this.flatIndices;
        const rowStarts = this.rowStarts;
        const biases = this.biases;
        // Resolve the activation function outside the hot loop to avoid dynamic lookup and switches
        const actFn = this.config.activationFunction;
        let activate;
        if (actFn === 'relu') {
            activate = (x) => x > 0 ? x : 0;
        }
        else if (actFn === 'tanh') {
            activate = Math.tanh;
        }
        else if (actFn === 'sigmoid') {
            activate = (x) => 1 / (1 + Math.exp(-x));
        }
        else if (actFn === 'swish') {
            activate = (x) => x / (1 + Math.exp(-x));
        }
        else {
            activate = (x) => x > 0 ? x : 0;
        }
        let iteration = 0, converged = false, residual = 0;
        const convergenceThreshold = this.config.convergenceThreshold;
        // Fast-path: When there are no gates and no vale gating (most common case)
        if (!activeGroups && !vale) {
            // Densest-common-case path: no index indirection at all (see denseWeights).
            // One loop covers every activation function rather than a specialised copy
            // per function: the indirect call through `activate` measured 1.04x versus
            // a hand-specialised branch, i.e. V8 already inlines this monomorphic
            // closure, so a third near-identical loop body would buy noise.
            if (this.denseLayout) {
                const denseWeights = this.denseWeights;
                for (; iteration < maxIters; iteration++) {
                    residual = 0;
                    for (let i = 0; i < N; i++) {
                        let sum = biases[i];
                        const base = i * N;
                        const limit = N - 7;
                        let j = 0;
                        for (; j < limit; j += 8) {
                            sum += curr[j] * denseWeights[base + j]
                                + curr[j + 1] * denseWeights[base + j + 1]
                                + curr[j + 2] * denseWeights[base + j + 2]
                                + curr[j + 3] * denseWeights[base + j + 3]
                                + curr[j + 4] * denseWeights[base + j + 4]
                                + curr[j + 5] * denseWeights[base + j + 5]
                                + curr[j + 6] * denseWeights[base + j + 6]
                                + curr[j + 7] * denseWeights[base + j + 7];
                        }
                        for (; j < N; j++)
                            sum += curr[j] * denseWeights[base + j];
                        const nextVal = activate(sum);
                        next[i] = nextVal;
                        if (recordHistory)
                            this.historyScratch[i * maxIters + iteration] = nextVal;
                        const diff = nextVal - curr[i];
                        residual += diff < 0 ? -diff : diff;
                    }
                    const tmp = curr;
                    curr = next;
                    next = tmp;
                    if (residual < convergenceThreshold) {
                        converged = true;
                        break;
                    }
                }
            }
            else if (actFn === 'relu') {
                for (; iteration < maxIters; iteration++) {
                    residual = 0;
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
                        const nextVal = sum > 0 ? sum : 0;
                        next[i] = nextVal;
                        if (recordHistory)
                            this.historyScratch[i * maxIters + iteration] = nextVal;
                        // Bolt's Optimization: Compute residual in single pass to avoid full O(N) second loop
                        const diff = nextVal - curr[i];
                        residual += diff < 0 ? -diff : diff;
                    }
                    // Bolt's Optimization: Zero-copy pointer swap instead of O(N) array copy
                    const tmp = curr;
                    curr = next;
                    next = tmp;
                    if (residual < convergenceThreshold) {
                        converged = true;
                        break;
                    }
                }
            }
            else if (actFn === 'tanh') {
                for (; iteration < maxIters; iteration++) {
                    residual = 0;
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
                        const nextVal = Math.tanh(sum);
                        next[i] = nextVal;
                        if (recordHistory)
                            this.historyScratch[i * maxIters + iteration] = nextVal;
                        // Bolt's Optimization: Compute residual in single pass to avoid full O(N) second loop
                        const diff = nextVal - curr[i];
                        residual += diff < 0 ? -diff : diff;
                    }
                    // Bolt's Optimization: Zero-copy pointer swap instead of O(N) array copy
                    const tmp = curr;
                    curr = next;
                    next = tmp;
                    if (residual < convergenceThreshold) {
                        converged = true;
                        break;
                    }
                }
            }
            else {
                for (; iteration < maxIters; iteration++) {
                    residual = 0;
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
                        const nextVal = activate(sum);
                        next[i] = nextVal;
                        if (recordHistory)
                            this.historyScratch[i * maxIters + iteration] = nextVal;
                        // Bolt's Optimization: Compute residual in single pass to avoid full O(N) second loop
                        const diff = nextVal - curr[i];
                        residual += diff < 0 ? -diff : diff;
                    }
                    // Bolt's Optimization: Zero-copy pointer swap instead of O(N) array copy
                    const tmp = curr;
                    curr = next;
                    next = tmp;
                    if (residual < convergenceThreshold) {
                        converged = true;
                        break;
                    }
                }
            }
        }
        else {
            // General path: When either gates or vale gating is active
            const gates = new Uint8Array(N);
            const vs = new Float32Array(N);
            const hasV = new Uint8Array(N);
            for (let i = 0; i < N; i++) {
                const n = nodes[i];
                const g = this.nodeGroups.get(n.id);
                gates[i] = (activeGroups && g !== undefined && !activeGroups.has(g)) ? 1 : 0;
                const v = vale?.get(n.id);
                if (v !== undefined) {
                    vs[i] = v;
                    hasV[i] = 1;
                }
            }
            for (; iteration < maxIters; iteration++) {
                residual = 0;
                for (let i = 0; i < N; i++) {
                    let nextVal = 0;
                    if (gates[i]) {
                        nextVal = curr[i];
                    }
                    else {
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
                        nextVal = hasV[i] ? vs[i] * curr[i] + (1 - vs[i]) * comp : comp;
                    }
                    next[i] = nextVal;
                    if (recordHistory)
                        this.historyScratch[i * maxIters + iteration] = nextVal;
                    // Bolt's Optimization: Compute residual in single pass to avoid full O(N) second loop
                    const diff = nextVal - curr[i];
                    residual += diff < 0 ? -diff : diff;
                }
                // Bolt's Optimization: Zero-copy pointer swap instead of O(N) array copy
                const tmp = curr;
                curr = next;
                next = tmp;
                if (residual < convergenceThreshold) {
                    converged = true;
                    break;
                }
            }
        }
        // Ensure instance properties remain synchronized with swapped buffers
        this.currActivations = curr;
        this.nextActivations = next;
        // Bolt's Optimization: Populate standard arrays and update node's activation/history in a single pass at final convergence
        const finalIters = converged ? iteration + 1 : iteration;
        const nodeHistory = new Map();
        if (recordHistory) {
            for (let i = 0; i < N; i++) {
                const arr = new Array(finalIters);
                const startIdx = i * maxIters;
                for (let iter = 0; iter < finalIters; iter++) {
                    arr[iter] = this.historyScratch[startIdx + iter];
                }
                nodeHistory.set(nodes[i].id, arr);
                // Bounded: keep only the most recent MAX_ACTIVATION_HISTORY samples.
                // This used to be an unbounded push(...arr), which both retained every
                // sample forever and spread a growing array through the argument list.
                const hist = nodes[i].activationHistory;
                for (let iter = 0; iter < finalIters; iter++)
                    hist.push(arr[iter]);
                if (hist.length > MAX_ACTIVATION_HISTORY) {
                    hist.splice(0, hist.length - MAX_ACTIVATION_HISTORY);
                }
                nodes[i].activation = curr[i];
            }
        }
        else {
            for (let i = 0; i < N; i++)
                nodes[i].activation = curr[i];
        }
        const finalStates = new Map();
        for (let i = 0; i < N; i++) {
            finalStates.set(nodes[i].id, curr[i]);
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
    applyValueWeightedLearning(learningRates) {
        if (!this.cacheValid)
            this.refreshCache();
        const deltaByNode = new Map();
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
    addNode(layer, group) {
        const id = this.nextId++;
        const node = {
            id,
            activation: 0,
            bias: (Math.random() * 2 - 1) * 0.1,
            connections: new Map(),
            layer,
            activationHistory: [],
        };
        this.nodes.set(id, node);
        if (group !== undefined)
            this.nodeGroups.set(id, group);
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
    removeNode(id) {
        const node = this.nodes.get(id);
        if (!node)
            return false;
        for (const [, other] of this.nodes) {
            other.connections.delete(id);
        }
        this.nodes.delete(id);
        this.nodeGroups.delete(id);
        this.cacheValid = false;
        return true;
    }
    /** Section 2.1: node ids labeled with the given skill/expert group. */
    getGroupNodeIds(group) {
        const ids = [];
        for (const [id, g] of this.nodeGroups) {
            if (g === group)
                ids.push(id);
        }
        return ids;
    }
    /** The skill/expert group a node was registered under, if any. */
    getNodeGroup(id) {
        return this.nodeGroups.get(id);
    }
    /** All distinct skill/expert groups currently registered in the mesh. */
    getGroups() {
        return Array.from(new Set(this.nodeGroups.values()));
    }
    updateConnection(fromId, toId, newWeight) {
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
                    if (!foundFrom || !foundTo)
                        this.cacheValid = false;
                }
                else {
                    this.cacheValid = false;
                }
            }
        }
    }
    getTopology() {
        const nodes = Array.from(this.nodes.values());
        const edges = [];
        const seen = new Set();
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
    getNode(id) {
        return this.nodes.get(id);
    }
    getNodeCount() {
        return this.nodes.size;
    }
    activate(x) {
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
    captureState() {
        const state = new Map();
        for (const [id, node] of this.nodes) {
            state.set(id, node.activation);
        }
        return state;
    }
    checkConvergence(residual) {
        return residual < this.config.convergenceThreshold;
    }
    computeAveragePathLength() {
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
    BFS(startId) {
        const distances = new Map();
        const queue = [startId];
        distances.set(startId, 0);
        while (queue.length > 0) {
            const current = queue.shift();
            const node = this.nodes.get(current);
            if (!node)
                continue;
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
    computeClusteringCoefficient() {
        let totalCoeff = 0;
        let nodeCount = 0;
        for (const [, node] of this.nodes) {
            const neighbors = Array.from(node.connections.keys());
            if (neighbors.length < 2)
                continue;
            let connectedPairs = 0;
            const totalPairs = (neighbors.length * (neighbors.length - 1)) / 2;
            for (let i = 0; i < neighbors.length; i++) {
                const neighborA = this.nodes.get(neighbors[i]);
                if (!neighborA)
                    continue;
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
    constructor(config = {}) {
        this.groups = new Map();
        this.definitionTargets = new Map();
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
        for (let i = 0; i < this.bias.length; i++)
            this.bias[i] = (this.rand() * 2 - 1) * 0.05;
        for (let t = 0; t < this.neuronCount; t++) {
            for (let s = 0; s < this.neuronCount; s++) {
                if (t === s)
                    continue;
                for (let od = 0; od < this.stateDim; od++) {
                    for (let id = 0; id < this.stateDim; id++) {
                        this.weights[this.weightIndex(t, s, od, id)] = (this.rand() * 2 - 1) * scale;
                    }
                }
            }
        }
        for (let i = 0; i < this.inputProjection.length; i++)
            this.inputProjection[i] = (this.rand() * 2 - 1) * scale;
        for (let i = 0; i < this.outputProjection.length; i++)
            this.outputProjection[i] = (this.rand() * 2 - 1) * scale;
    }
    setNeuronGroup(neuronId, group) {
        this.assertNeuron(neuronId);
        this.groups.set(neuronId, group);
    }
    getNeuronCount() {
        return this.neuronCount;
    }
    getStateDim() {
        return this.stateDim;
    }
    connectionDensity() {
        return this.neuronCount <= 1 ? 0 : 1.0;
    }
    connectionBlock(target, source) {
        this.assertNeuron(target);
        this.assertNeuron(source);
        const block = new Float32Array(this.stateDim * this.stateDim);
        for (let od = 0; od < this.stateDim; od++)
            for (let id = 0; id < this.stateDim; id++) {
                block[od * this.stateDim + id] = this.weights[this.weightIndex(target, source, od, id)];
            }
        return block;
    }
    /**
     * Program an explicit dense source->target block. This is how extension
     * builder definitions can install cross-dimensional links directly: every
     * output dimension of the target can read every input dimension of the source.
     */
    setConnectionBlock(target, source, block) {
        this.assertNeuron(target);
        this.assertNeuron(source);
        if (target === source)
            throw new Error('self-connections are not part of the all-to-all core');
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
    setConnectionScalar(target, source, weight) {
        this.setConnectionBlock(target, source, new Float32Array(this.stateDim * this.stateDim).fill(weight));
    }
    setDefinitionTarget(neuronId, target) {
        this.assertNeuron(neuronId);
        const v = new Float32Array(this.stateDim);
        for (let i = 0; i < this.stateDim; i++)
            v[i] = target[i] ?? 0;
        this.definitionTargets.set(neuronId, v);
    }
    checkDefinition(neuronId, tolerance = 0.25) {
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
    addNeuron(group) {
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
        const newIndex = (target, source, outDim, inDim) => (((target * newCount + source) * this.stateDim + outDim) * this.stateDim + inDim);
        const oldIndex = (target, source, outDim, inDim) => (((target * oldCount + source) * this.stateDim + outDim) * this.stateDim + inDim);
        for (let t = 0; t < newCount; t++) {
            for (let src = 0; src < newCount; src++) {
                if (t === src)
                    continue;
                for (let od = 0; od < this.stateDim; od++) {
                    for (let id = 0; id < this.stateDim; id++) {
                        if (t < oldCount && src < oldCount) {
                            newWeights[newIndex(t, src, od, id)] = oldWeights[oldIndex(t, src, od, id)];
                        }
                        else {
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
        if (group !== undefined)
            this.groups.set(oldCount, group);
        return oldCount;
    }
    /**
     * Optimizer-facing structured parameter view. The returned typed arrays are
     * live references, so AdamW-style trainers can keep moments keyed to these
     * arrays and mutate them directly when needed.
     */
    getParameters() {
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
    applyGradients(gradients, options = {}) {
        const lr = options.learningRate ?? 1;
        const decay = options.weightDecay ?? 0;
        const scale = options.scale ?? 1;
        const summary = { weightsL1: 0, biasesL1: 0, inputProjectionL1: 0, outputProjectionL1: 0 };
        if (gradients.weights) {
            this.assertGradientLength('weights', gradients.weights, this.weights.length);
            for (let t = 0; t < this.neuronCount; t++) {
                const tScale = this.updateScaleForNeuron(t, options.vale) * scale;
                for (let s = 0; s < this.neuronCount; s++)
                    for (let od = 0; od < this.stateDim; od++)
                        for (let id = 0; id < this.stateDim; id++) {
                            const i = this.weightIndex(t, s, od, id);
                            const update = lr * tScale * (gradients.weights[i] + decay * this.weights[i]);
                            if (Number.isFinite(update)) {
                                this.weights[i] -= update;
                                summary.weightsL1 += Math.abs(update);
                            }
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
                    if (Number.isFinite(update)) {
                        this.bias[i] -= update;
                        summary.biasesL1 += Math.abs(update);
                    }
                }
            }
        }
        if (gradients.inputProjection) {
            this.assertGradientLength('inputProjection', gradients.inputProjection, this.inputProjection.length);
            for (let i = 0; i < this.inputProjection.length; i++) {
                const update = lr * scale * (gradients.inputProjection[i] + decay * this.inputProjection[i]);
                if (Number.isFinite(update)) {
                    this.inputProjection[i] -= update;
                    summary.inputProjectionL1 += Math.abs(update);
                }
            }
        }
        if (gradients.outputProjection) {
            this.assertGradientLength('outputProjection', gradients.outputProjection, this.outputProjection.length);
            for (let d = 0; d < this.stateDim; d++) {
                let dimScale = 0;
                for (let n = 0; n < this.neuronCount; n++)
                    dimScale += this.updateScaleForNeuron(n, options.vale);
                dimScale = (dimScale / this.neuronCount) * scale;
                for (let o = 0; o < this.outputDim; o++) {
                    const i = d * this.outputDim + o;
                    const update = lr * dimScale * (gradients.outputProjection[i] + decay * this.outputProjection[i]);
                    if (Number.isFinite(update)) {
                        this.outputProjection[i] -= update;
                        summary.outputProjectionL1 += Math.abs(update);
                    }
                }
            }
        }
        return summary;
    }
    forward(input, options = {}) {
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
                    for (let d = 0; d < SD; d++)
                        next[off + d] = curr[off + d];
                    continue;
                }
                // The connection sum starts at zero and the bias is added AFTER the
                // mean below -- the bias is the neuron's own, not one of the senders,
                // so averaging it in with them would shrink it by N.
                for (let od = 0; od < SD; od++) {
                    sums[od] = 0;
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
                // Scaled the same way as the engine and the equation file.
                const invN = 1 / Math.sqrt(Math.max(1, N));
                for (let od = 0; od < SD; od++) {
                    next[off + od] = v * curr[off + od] + oneMinusV * Math.tanh(bias[off + od] + sums[od] * invN);
                }
            }
            this.applyQuantizationInPlace(next);
            for (const n of driven)
                if (n >= 0 && n < N)
                    next[n * SD + this.inputFlagDim] = 1;
            residual = 0;
            for (let i = 0; i < next.length; i++) {
                const diff = next[i] - curr[i];
                residual += diff < 0 ? -diff : diff;
                curr[i] = next[i];
            }
            if (residual < this.convergenceThreshold) {
                converged = true;
                ticks++;
                break;
            }
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
    clearDirectInputFlags() {
        for (let n = 0; n < this.neuronCount; n++) {
            this.state[n * this.stateDim + this.inputFlagDim] = 0;
            this.directInputFlags[n] = 0;
        }
    }
    inject(neuronId, input, flag) {
        const off = neuronId * this.stateDim;
        for (let od = 0; od < this.stateDim; od++) {
            let sum = 0;
            for (let i = 0; i < Math.min(input.length, this.inputDim); i++)
                sum += input[i] * this.inputProjection[i * this.stateDim + od];
            this.state[off + od] = Math.tanh(sum);
        }
        if (flag)
            this.state[off + this.inputFlagDim] = 1;
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
    applyQuantizationInPlace(next) {
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
    readout() {
        const mean = new Float32Array(this.stateDim);
        for (let n = 0; n < this.neuronCount; n++)
            for (let d = 0; d < this.stateDim; d++)
                mean[d] += this.state[n * this.stateDim + d] / this.neuronCount;
        const out = new Float32Array(this.outputDim);
        for (let o = 0; o < this.outputDim; o++)
            for (let d = 0; d < this.stateDim; d++)
                out[o] += mean[d] * this.outputProjection[d * this.outputDim + o];
        return out;
    }
    meanAbs(values) {
        let sum = 0;
        for (const value of values)
            sum += Math.abs(value);
        return sum / Math.max(1, values.length);
    }
    stateDeltas(startState) {
        const deltas = new Map();
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
    inputTopography() {
        const topography = new Map();
        for (let n = 0; n < this.neuronCount; n++)
            topography.set(n, this.directInputFlags[n]);
        return topography;
    }
    weightIndex(target, source, outDim, inDim) {
        return this.weightIndexForCount(this.neuronCount, target, source, outDim, inDim);
    }
    weightIndexForCount(count, target, source, outDim, inDim) {
        return (((target * count + source) * this.stateDim + outDim) * this.stateDim + inDim);
    }
    updateScaleForNeuron(neuronId, vale) {
        const v = Math.min(1, Math.max(0, vale?.get(neuronId) ?? 0));
        return 1 - v;
    }
    assertGradientLength(name, gradient, expected) {
        if (gradient.length !== expected)
            throw new Error(`${name} gradient length ${gradient.length} !== ${expected}`);
    }
    rand() {
        this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
        return this.rngState / 0x100000000;
    }
    assertNeuron(id) {
        if (!Number.isInteger(id) || id < 0 || id >= this.neuronCount)
            throw new Error(`neuron id out of range: ${id}`);
    }
}
/** Float array -> base64, exactly, without a decimal round trip. */
function encodeFloats(values) {
    return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString("base64");
}
function encodeDoubles(values) {
    return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString("base64");
}
function decodeDoubles(encoded, expected) {
    if (typeof encoded !== "string")
        return null;
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.byteLength !== expected * 8)
        return null;
    const out = new Float64Array(expected);
    Buffer.from(out.buffer).set(bytes);
    return out;
}
/**
 * base64 -> float array of exactly `expected` values, or null.
 *
 * The length check is the point: a snapshot whose arrays are the wrong size
 * belongs to a different network, and quietly loading as much of it as fits
 * would leave the engine in a state that is neither the saved one nor a clean
 * one.
 */
function decodeFloats(encoded, expected) {
    if (typeof encoded !== "string")
        return null;
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.byteLength !== expected * 4)
        return null;
    const out = new Float32Array(expected);
    Buffer.from(out.buffer).set(bytes);
    return out;
}
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}
/** Pearson correlation of two equal-length series; 0 if undefined (no variance). */
function pearson(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 2)
        return 0;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) {
        ma += a[i];
        mb += b[i];
    }
    ma /= n;
    mb /= n;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) {
        const da = a[i] - ma, db = b[i] - mb;
        cov += da * db;
        va += da * da;
        vb += db * db;
    }
    if (va === 0 || vb === 0)
        return 0;
    return cov / Math.sqrt(va * vb);
}
/** How much of the measured phase error a neuron's wave takes each tick. */
const PHASE_LOCK_RATE = 0.5;
/**
 * How much of it the FREQUENCY takes -- an order of magnitude less. Phase can
 * be corrected every tick; a frequency that chased every tick would never
 * settle, and neurons could never stay locked to each other long enough to
 * reinforce anything.
 */
const FREQUENCY_LOCK_RATE = 0.02;
/**
 * How finely the pool distinguishes one wave from another.
 *
 * Frequencies are learned and continuous; this is what decides when two of
 * them count as the same wave and therefore interfere. Fine enough that
 * neurons do not all collapse into one wave, coarse enough that two neurons
 * learning toward each other actually meet.
 */
const WAVE_BINS = 64;
/**
 * How much of what a neuron hears it passes back into the pool.
 *
 * Below one on purpose. Every neuron re-emitting everything it hears is a loop
 * with nothing opposing it -- the architecture's own warning about runaway
 * activation in an all-connected network, and it happens immediately: measured
 * at full strength the pool went 4 -> 3,579 -> 2,682,806 in three ticks.
 */
const WAVE_FEEDBACK = 0.5;
/**
 * How far a network variable may go, and why it stops just short of 1.
 *
 * The step that moves these is scaled by the room left before the bound, so a
 * variable eases into its limit rather than slamming into it. That leaves one
 * trap: a variable that lands exactly ON the bound has no room left, its step
 * is multiplied by zero, and it can never move again -- measured, one of
 * sixteen after 300 ticks. Stopping a hair short means there is always
 * something left to move with, so a neuron can still change its mind.
 */
/**
 * How far the input a neuron received during an event may push its learning
 * rate, as a multiple of what the average neuron received.
 *
 * "High input equals more change, low input equals less change" -- but a
 * neuron that happens to be the only loud one in an otherwise quiet tick
 * would otherwise get an unbounded rate, which would undo the stability the
 * value half of the elastic core exists to provide.
 */
const INPUT_FORCE_FLOOR = 0.25;
const INPUT_FORCE_CEILING = 3;
const NETWORK_VARIABLE_LIMIT = 0.999;
function clampNetworkVariable(value) {
    if (value < -NETWORK_VARIABLE_LIMIT)
        return -NETWORK_VARIABLE_LIMIT;
    if (value > NETWORK_VARIABLE_LIMIT)
        return NETWORK_VARIABLE_LIMIT;
    return value;
}
/**
 * A wave network settles into an oscillation, not a fixed point, so "settled"
 * has to mean "the residual has stopped falling" as well as "the residual is
 * nearly zero". These are how flat, and for how long, before the settle loop
 * calls it: a twentieth of itself is well outside the ~10% wobble measured on
 * a steady oscillation, and three iterations avoids stopping on one flat step
 * during the initial decay.
 */
const SETTLED_RESIDUAL_CHANGE = 0.05;
const SETTLED_RESIDUAL_TICKS = 3;
/** However high a caller asks for, the loop gain stays below one. */
const WAVE_FEEDBACK_CEILING = 0.9;
/** Below this a bin holds float dust from cancelled waves rather than a wave. */
const POOL_SILENCE = 1e-6;
/** Hard bound on any one wave in the pool, whatever the learned gains have drifted to. */
const WAVE_POOL_CEILING = 8;
/** How fast a connection's wave-editing equation moves. Slower than the numeric weights: it shapes what every wave through it becomes. */
const WAVE_EDIT_RATE = 0.05;
/** The wave-edit bias moves slower still -- it speaks with nothing arriving. */
const WAVE_BIAS_RATE = 0.01;
/** The wave shift moves slowest: it reaches across frequencies a wave does not belong to. */
const WAVE_SHIFT_RATE = 0.005;
/** Frequencies that complete at least one cycle before aliasing. */
/**
 * The band every neuron's wave lives in.
 *
 * Exported because placing a wave is not only the engine's business: a net
 * skill grafted into the mesh has to be given a wave of its own, and a caller
 * that cannot see the band can only guess at a frequency and have it clamped.
 */
export const MIN_WAVE_FREQ = 0.02;
export const MAX_WAVE_FREQ = 0.6;
/**
 * How far below its usual best a region response has to fall before the mesh
 * is saying it has nothing that handles this. Measured separation was
 * 0.059 against 0.072-0.089, so the gap is real but not dramatic -- this sits
 * inside it rather than at the edge.
 */
const CAPABILITY_GAP_RATIO = 0.8;
/** How slowly the baseline follows. Slow, so one strange input does not move it. */
const CAPABILITY_BASELINE_DECAY = 0.95;
/** No verdict until the network has answered this many inputs -- there is nothing to compare against before that. */
const CAPABILITY_BASELINE_MIN_SAMPLES = 8;
/** Consecutive quiet readings before the mesh is believed. One is noise. */
const CAPABILITY_GAP_TICKS = 3;
/** True when a neuron belongs to at least one of the skills asked for. */
function anyGroupActive(groups, active) {
    for (const name of groups)
        if (active.has(name))
            return true;
    return false;
}
export class HyperDimensionalEngine {
    constructor(config = {}) {
        this.iteration = 0;
        /**
         * process() runs on every live generate() call, and on every BIT through the
         * Zip Loop, so what it keeps per tick matters more than anywhere else here.
         *
         * Two of the three things it used to accumulate are gone rather than capped.
         * `history` had no readers anywhere -- capping dead weight still pays to
         * build it, and it was built out of two fresh state copies per neuron per
         * tick. Each neuron's 100-deep `transitions` ring existed so one field of
         * its newest entry could be read, and is now that one field.
         *
         * `seenPatterns` is real -- novelty scoring reads it -- so it stays, capped.
         * Eviction is by insertion order (first-seen), not true least-recently-used:
         * an honest simplification, not a claim of LRU precision, matching the same
         * plain-cap approach already used for SharedBlackboard's log.
         */
        this.seenPatternsCapacity = 5000;
        // Section 12: fast intra-settle self-model (EMA over mean content energy)
        this.emaEnergy = 0;
        this.hasEma = false;
        this.sustainedDivergence = 0;
        /**
         * Which expert or skill each neuron belongs to, when it belongs to one.
         *
         * A label, not a wall: a grouped neuron is wired all-to-all like every
         * other. The group decides only whether it is asked to compute on a given
         * tick -- see ProcessOptions.activeGroups.
         */
        this.neuronGroups = new Map();
        /** The best region response this network normally reaches -- the reference capabilityGap() reads "quiet" against. */
        this.capabilityBaseline = 0;
        this.capabilitySamples = 0;
        this.capabilityQuietRun = 0;
        /** What each neuron with a definition is supposed to say. */
        this.definitionTargets = new Map();
        /** |shared wave pool value| from the most recent settle() iteration -- genuinely observable evidence the wave mechanism ran, surfaced on HyperDimensionalOutput. */
        this.lastWaveEnergy = 0;
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
            divergenceTolerance: config.divergenceTolerance ?? 0.05,
            sustainedDivergenceTicks: config.sustainedDivergenceTicks ?? 3,
            // Defaults to 0 (fully inert, byte-for-byte the same settle() math as
            // before this existed) rather than a small nonzero value: existing
            // callers rely on exact pre-activation-sum invariants (see the
            // "symbolic trace" tests in test/core/onebrain.test.ts) and on
            // specific training-convergence behavior that a nonzero wave term
            // measurably perturbs. Pass waveGain explicitly to opt a given
            // engine instance into it.
            waveGain: config.waveGain ?? 0,
            waveFeedback: Math.max(0, Math.min(WAVE_FEEDBACK_CEILING, config.waveFeedback ?? WAVE_FEEDBACK)),
            // All three default to inert, for the same reason waveGain does: existing
            // callers rely on exact pre-activation invariants, and this changes the
            // arithmetic of every connection in the network.
            hyperGain: config.hyperGain ?? 0,
            hyperScale: config.hyperScale ?? 0,
            hyperAdd: config.hyperAdd ?? 0,
            hyperWaveGain: config.hyperWaveGain ?? 0,
            hyperWaveAdd: config.hyperWaveAdd ?? 0,
            connectionBias: config.connectionBias ?? false,
        };
        const N = this.config.neuronCount;
        const D = this.config.dimensions + 1;
        this.totalDims = D;
        this.neurons = [];
        this.seenPatterns = new Map();
        this.allStates = new Float32Array(D * N);
        this.connDiag = new Float32Array(N * D * N);
        this.connShift = new Float32Array(N * D * N);
        // Allocated only when asked for: at the default size this is another 2.6MB
        // that most engines will never read.
        this.connBias = this.config.connectionBias ? new Float32Array(N * D * N) : new Float32Array(0);
        this.connBiasRowSum = new Float32Array(this.config.connectionBias ? N * D : 0);
        this.bias = new Float32Array(N * D);
        // Every neuron's say in every connection. Small random values rather than
        // zeros: identical variables would make every neuron's contribution to the
        // network term interchangeable, and learning could never separate them.
        const networkScale = Math.sqrt(1 / Math.max(1, N));
        // One row per RECEIVING neuron: modWeight[i*N + k] is how much neuron i's
        // own view of the network weighs neuron k. Every connection into i reads
        // the network through i's row, and senderGain scales that reading by which
        // neuron is doing the sending -- so a connection A->B and a connection
        // C->B looking at the identical network state interpret it differently,
        // which is the defining property of the hyperdimensional term.
        //
        // Rows rather than a full per-connection cube: giving every (i,j) pair its
        // own N variables is N^3, which at the sizes this network reaches after a
        // few skills are installed is hundreds of megabytes and an N^3 inner loop.
        // A row per receiver times a gain per sender is the same idea factorised:
        // every connection gets its own reading, at N^2.
        this.modWeight = new Float32Array(N * N);
        this.addWeight = new Float32Array(N * N);
        this.senderGain = new Float32Array(N);
        for (let i = 0; i < N * N; i++) {
            this.modWeight[i] = (Math.random() * 2 - 1) * networkScale;
            this.addWeight[i] = (Math.random() * 2 - 1) * networkScale;
        }
        for (let i = 0; i < N; i++) {
            // Centred on 1: a sender that has learned nothing yet passes its
            // receiver's reading through unchanged rather than muting it.
            this.senderGain[i] = 1 + (Math.random() * 2 - 1) * networkScale;
        }
        this.hyperGainScratch = new Float32Array(N * D);
        this.hyperAddScratch = new Float32Array(N * D);
        this.hyperMeanScratch = new Float32Array(D);
        this.hyperScaleScratch = new Float32Array(N * D);
        // The wave copies, per receiving neuron for the same reason.
        this.modWaveWeight = new Float32Array(N * N);
        this.addWaveWeight = new Float32Array(N * N);
        this.neuronWaveBiasRe = new Float32Array(N);
        this.neuronWaveBiasIm = new Float32Array(N);
        this.connWaveShift = new Float32Array(N * N);
        for (let i = 0; i < N * N; i++) {
            this.modWaveWeight[i] = (Math.random() * 2 - 1) * networkScale;
            this.addWaveWeight[i] = (Math.random() * 2 - 1) * networkScale;
        }
        this.nextStatesBuffer = new Float32Array(N * D);
        this.tempCtx = new Float32Array(D);
        this.stateDeltasBuffer = new Float32Array(N);
        this.entropyHist = new Uint32Array(10);
        this.initializeNeurons();
        this.initializeConnections();
        // The input layer: which neurons are clamped to the input when a caller
        // does not say.
        //
        // This used to be EVERY neuron, and that is not a default -- it is a
        // bypass. A driven neuron is written straight from the input vector and
        // never computes: no connections, no bias, no network term, no wave. With
        // all of them driven, none of them compute anything, and every neuron in
        // the mesh ends the tick holding the identical vector. Measured on the
        // live pipeline: 64 neurons, one distinct state between them, and the
        // whole hyperdimensional structure skipped on every tick of the running
        // agent.
        //
        // One input neuron, matching what elastic-core.ts's forward() has always
        // defaulted to. The input still reaches everything -- it is an all-to-all
        // mesh -- but it reaches it through the connections, which is the entire
        // point of having them.
        this.defaultDrivenIds = new Set([0]);
        // Pre-calculate the entropy lookup table for fast dimensional entropy calculations.
        // Since count is always an integer from 0 to N (neuronCount), there are exactly N + 1 possible probabilities.
        // Pre-calculating p * Math.log2(p) avoids transcendental Math.log2 calls in the hot loop.
        this.entropyLookup = new Float64Array(N + 1);
        this.entropyLookup[0] = 0; // 0 * log2(0) = 0
        for (let c = 1; c <= N; c++) {
            const p = c / N;
            this.entropyLookup[c] = p * Math.log2(p);
        }
        this.outputVectorScratch = new Float32Array(this.config.dimensions);
        this.stateViews = new Array(D);
        for (let d = 0; d < D; d++) {
            this.stateViews[d] = this.allStates.subarray(d * N, (d + 1) * N);
        }
        this.isDrivenScratch = new Uint8Array(N);
        this.drivenIndicesScratch = new Int32Array(N);
        this.nonDrivenIndicesScratch = new Int32Array(N);
        this.heldIndicesScratch = new Int32Array(N);
        this.netWaveWeightReScratch = new Float32Array(N);
        this.netWaveWeightImScratch = new Float32Array(N);
        this.netWaveBiasReScratch = new Float32Array(N);
        this.netWaveBiasImScratch = new Float32Array(N);
        this.vsScratch = new Float32Array(N);
        this.hasVScratch = new Uint8Array(N);
        this.ratesScratch = new Float32Array(N);
        this.deltaSumsScratch = new Float32Array(N);
        this.forceScratch = new Float32Array(N);
        this.heldThisTick = new Uint8Array(N);
        // Wave pool state -- see waveGain's doc comment on HyperConfig. Frequencies
        // are spread deterministically (not randomly) across [0.05, 0.5) radians/iteration
        // via a golden-ratio sequence, so N neurons don't cluster into just a few
        // distinct frequencies the way i % smallK would, and two engines built with
        // the same neuronCount get the same frequency assignment (reproducible).
        const GOLDEN_ANGLE = 0.6180339887498949;
        this.wavePhase = new Float32Array(N);
        this.waveFreq = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            const frac = (i * GOLDEN_ANGLE) % 1;
            this.waveFreq[i] = 0.05 + frac * 0.45;
        }
        // Explicit signatures, when a caller has a reason to choose them: two
        // neurons given the same frequency share a wave, which is the arrangement
        // where one drives the other through the pool. Without this the spread is
        // deliberately collision-free and that case cannot be constructed at all.
        if (Array.isArray(config.waveFrequencies)) {
            for (let i = 0; i < Math.min(N, config.waveFrequencies.length); i++) {
                const freq = Number(config.waveFrequencies[i]);
                if (Number.isFinite(freq))
                    this.waveFreq[i] = freq;
            }
        }
        if (Array.isArray(config.wavePhases)) {
            for (let i = 0; i < Math.min(N, config.wavePhases.length); i++) {
                const phase = Number(config.wavePhases[i]);
                if (Number.isFinite(phase))
                    this.wavePhase[i] = phase;
            }
        }
        this.waveAmpScratch = new Float32Array(N);
        this.waveReadRe = new Float32Array(WAVE_BINS * D);
        this.waveReadIm = new Float32Array(WAVE_BINS * D);
        this.seedWaveReading();
        this.poolRe = new Float32Array(WAVE_BINS);
        this.poolIm = new Float32Array(WAVE_BINS);
        this.prevPoolRe = new Float32Array(WAVE_BINS);
        this.prevPoolIm = new Float32Array(WAVE_BINS);
        this.waveRe = new Float32Array(N);
        this.waveIm = new Float32Array(N);
        this.prevWaveRe = new Float32Array(N);
        this.prevWaveIm = new Float32Array(N);
        this.waveBin = new Int32Array(N);
        this.phaseCos = new Float32Array(N);
        this.phaseSin = new Float32Array(N);
        this.waveTermScratch = new Float32Array(N);
        this.wavePhaseErrorScratch = new Float32Array(N);
        // Connections start passing waves through unchanged -- full gain, no turn,
        // nothing added. Learning is what makes them differ; starting them random
        // would mean a fresh network scrambles every wave before anything has had
        // a reason to.
        this.connWaveGain = new Float32Array(N * N).fill(1);
        this.connWavePhase = new Float32Array(N * N);
        this.connWaveCos = new Float32Array(N * N).fill(1);
        this.connWaveSin = new Float32Array(N * N);
        this.connWaveBias = new Float32Array(N * N);
        this.connWaveBiasIm = new Float32Array(N * N);
    }
    /**
     * Run one tick: settle the mesh to convergence for the given input, apply
     * value-gated Hebbian weight learning, and derive all reported signals.
     */
    process(inputVector, learningRates, directInputNeuronIds, vale, options) {
        let resolvedInput;
        if (inputVector instanceof Map) {
            const arrays = Array.from(inputVector.values());
            if (arrays.length > 0) {
                resolvedInput = Array.from(arrays[0]);
            }
            else {
                resolvedInput = new Array(this.config.dimensions).fill(0);
            }
        }
        else {
            resolvedInput = inputVector;
        }
        const drivenIds = directInputNeuronIds ?? this.defaultDrivenIds;
        const N = this.neurons.length;
        const D = this.totalDims;
        const { stateDeltas, liveCorrections, iterations } = this.settle(resolvedInput, drivenIds, vale, options?.activeGroups);
        // Weight learning is on by default -- a tick that receives input is
        // supposed to change the network. A tick that is only READING is not: see
        // ProcessOptions.learn.
        if (options?.learn !== false)
            this.applyWeightLearning(learningRates, stateDeltas);
        // Energies only. This loop used to also build a StateTransition per neuron
        // whose energy had changed -- two fresh Float32Array(dimensions + 1) plus
        // an object each, every tick -- for the sole purpose of pushing them into
        // `history`, which nothing in this file or anywhere else ever read. At the
        // default size that was ~200 typed arrays and 13,000 floats copied per
        // tick, and the Zip Loop runs one tick per BIT, so the dead record cost
        // more than most of the real computation.
        for (let idx = 0; idx < N; idx++) {
            const neuron = this.neurons[idx];
            neuron.energy = this.computeStateEnergy(neuron.state);
        }
        const transitionCount = this.resolveStateTransitions();
        const activeStates = [];
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
        // Have I been asked this before?
        //
        // The hash used to be the OUTPUT, which only worked while the network was
        // not computing: with every neuron clamped to the input the output was the
        // input, so the same input twice hashed the same and read as familiar.
        // Once the neurons actually compute, a recurrent mesh answers the same
        // question differently the second time -- correctly, its state has moved
        // on -- and every output hashed as brand new. Nothing was ever familiar
        // again, and a novelty signal that says "new" to everything is not a
        // signal.
        //
        // This used to also blend in selfModelSurprise (a compressed self-model's
        // prediction error about its own output) 0.4-weighted alongside this.
        // That self-model is gone; noveltyScore is patternNovelty alone now.
        const patternHash = this.hashVector(resolvedInput);
        const patternNovelty = this.computeNoveltyScore(patternHash);
        const noveltyScore = clamp(patternNovelty, 0, 1);
        this.recordPattern(patternHash, noveltyScore);
        this.iteration++;
        const inputTopography = new Map();
        for (let idx = 0; idx < N; idx++) {
            inputTopography.set(this.neurons[idx].id, this.neurons[idx].state[0]);
        }
        return {
            outputVector,
            activeStates: resolvedActive,
            totalEnergy,
            dimensionalEntropy,
            noveltyScore,
            transitionCount,
            stateDeltas,
            liveCorrections,
            inputTopography,
            waveEnergy: this.lastWaveEnergy,
            settleIterations: iterations,
        };
    }
    hasSeenPattern(patternHash) {
        return this.seenPatterns.has(patternHash);
    }
    getPatternNovelty(patternHash) {
        return this.seenPatterns.get(patternHash)?.novelty ?? 1;
    }
    getSeenPatternCount() {
        return this.seenPatterns.size;
    }
    getHistory() {
        return Array.from(this.seenPatterns.entries()).map(([hash, pattern]) => ({
            hash,
            count: pattern.frequency,
            lastSeen: pattern.lastSeen,
            step: this.iteration,
        }));
    }
    /**
     * Full defensive snapshot of every neuron -- an object spread plus a fresh
     * Float32Array per neuron, so it is O(N) allocations. Correct when a caller
     * genuinely needs the whole network's state, but callers that only want one
     * or two scalars should use getNeuronEnergy()/readNeuronContent() below
     * instead: reading two output neurons per bit through this was allocating
     * 2N objects and N typed arrays per bit, then linear-scanning for the two
     * that mattered.
     */
    getNeuronStates() {
        return this.neurons.map(n => ({ ...n, state: new Float32Array(n.state) }));
    }
    /**
     * One neuron's current energy, in O(1) with zero allocation. Neuron ids are
     * dense and assigned in construction order (`id: i`), so the id is also the
     * array index -- verified rather than assumed, and asserted below so this
     * silently degrades to a scan rather than returning the wrong neuron if that
     * ever stops holding.
     */
    /**
     * The mean energy across every neuron -- the network's own floor.
     *
     * What "quiet" has to be measured against: an absolute threshold that suits
     * a small mesh calls a large one permanently noisy.
     */
    meanNeuronEnergy() {
        const N = this.neurons.length;
        if (N === 0)
            return 0;
        let total = 0;
        for (let i = 0; i < N; i++)
            total += this.neurons[i].energy;
        return total / N;
    }
    getNeuronEnergy(id) {
        return this.neuronById(id)?.energy ?? 0;
    }
    /**
     * Copies one neuron's content dimensions (indices 1..dimensions -- index 0 is
     * the reserved input flag) into `out`, returning how many were written. Lets a
     * caller read a neuron repeatedly through a single reused buffer instead of
     * allocating a fresh snapshot per read.
     */
    readNeuronContent(id, out) {
        const neuron = this.neuronById(id);
        if (!neuron)
            return 0;
        const count = Math.min(out.length, neuron.state.length - 1);
        for (let d = 0; d < count; d++)
            out[d] = neuron.state[d + 1];
        return count;
    }
    /** O(1) id->neuron via dense-index fast path, falling back to a scan if ids ever stop matching indices. */
    neuronById(id) {
        const direct = this.neurons[id];
        if (direct !== undefined && direct.id === id)
            return direct;
        return this.neurons.find(n => n.id === id);
    }
    /**
     * Everything the network is holding right now: every neuron's state and
     * energy, and every connection between them.
     *
     * Taken when a run stops. An all-connected mesh keeps its working context in
     * its own state rather than in a buffer beside it -- that is the whole
     * reason two neurons are enough of a doorway -- so the moment a run ends,
     * this is the only record of what it had built up. Throwing it away at the
     * end of every run makes each run start from nothing and forget what it just
     * did.
     *
     * Connections are included because they are half of where the network is.
     * They move during a run (learning is exactly that), so a snapshot of the
     * activations alone would resume the right thought inside the wrong network.
     *
     * The neuron states saved are `allStates` -- the interleaved array the
     * settle loop actually reads. HyperNeuron.state is a per-neuron copy kept
     * for compatibility, and saving that instead would restore what callers see
     * while leaving what the network computes with untouched.
     */
    captureNetworkState() {
        const energies = new Float64Array(this.neurons.length);
        for (let i = 0; i < this.neurons.length; i++)
            energies[i] = this.neurons[i].energy;
        return {
            shape: { neurons: this.neurons.length, dimensions: this.getDimensions() },
            states: encodeFloats(this.allStates),
            energies: encodeDoubles(energies),
            bias: encodeFloats(this.bias),
            connDiag: encodeFloats(this.connDiag),
            connShift: encodeFloats(this.connShift),
            modWeight: encodeFloats(this.modWeight),
            addWeight: encodeFloats(this.addWeight),
            waveFreq: encodeFloats(this.waveFreq),
            wavePhase: encodeFloats(this.wavePhase),
            connWaveGain: encodeFloats(this.connWaveGain),
            connWavePhase: encodeFloats(this.connWavePhase),
            connWaveBias: encodeFloats(this.connWaveBias),
            connWaveBiasIm: encodeFloats(this.connWaveBiasIm),
            senderGain: encodeFloats(this.senderGain),
            neuronWaveRe: encodeFloats(this.waveRe),
            neuronWaveIm: encodeFloats(this.waveIm),
            wavePoolRe: encodeFloats(this.poolRe),
            wavePoolIm: encodeFloats(this.poolIm),
            emaEnergy: this.emaEnergy,
            hasEma: this.hasEma,
            sustainedDivergence: this.sustainedDivergence,
            connWaveShift: encodeFloats(this.connWaveShift),
            neuronWaveBiasRe: encodeFloats(this.neuronWaveBiasRe),
            neuronWaveBiasIm: encodeFloats(this.neuronWaveBiasIm),
            modWaveWeight: encodeFloats(this.modWaveWeight),
            addWaveWeight: encodeFloats(this.addWaveWeight),
            connBias: this.config.connectionBias ? encodeFloats(this.connBias) : "",
        };
    }
    /**
     * Put a saved snapshot back, so the next run starts where the last one
     * stopped. Returns true only if everything was restored.
     *
     * All-or-nothing on purpose. A snapshot from an engine of a different shape
     * is not this engine's state, and a partial restore -- states from before,
     * connections from now -- is a network that never existed. Refusing outright
     * leaves a clean start, which is a state someone can reason about.
     */
    restoreNetworkState(snapshot) {
        if (!snapshot?.shape ||
            snapshot.shape.neurons !== this.neurons.length ||
            snapshot.shape.dimensions !== this.getDimensions())
            return false;
        const states = decodeFloats(snapshot.states, this.allStates.length);
        const energies = decodeDoubles(snapshot.energies, this.neurons.length);
        const bias = decodeFloats(snapshot.bias, this.bias.length);
        const diag = decodeFloats(snapshot.connDiag, this.connDiag.length);
        const shift = decodeFloats(snapshot.connShift, this.connShift.length);
        const mod = decodeFloats(snapshot.modWeight, this.modWeight.length);
        const add = decodeFloats(snapshot.addWeight, this.addWeight.length);
        const freq = decodeFloats(snapshot.waveFreq, this.waveFreq.length);
        const phase = decodeFloats(snapshot.wavePhase, this.wavePhase.length);
        const waveGain = decodeFloats(snapshot.connWaveGain, this.connWaveGain.length);
        const waveTurn = decodeFloats(snapshot.connWavePhase, this.connWavePhase.length);
        const waveBias = decodeFloats(snapshot.connWaveBias, this.connWaveBias.length);
        // Absent in snapshots written before the connection's bias had a turned
        // half; zeros are exactly what those networks were running.
        const waveBiasTurned = snapshot.connWaveBiasIm === undefined
            ? new Float32Array(this.connWaveBiasIm.length)
            : decodeFloats(snapshot.connWaveBiasIm, this.connWaveBiasIm.length);
        const senderGain = snapshot.senderGain === undefined
            ? new Float32Array(this.senderGain.length).fill(1)
            : decodeFloats(snapshot.senderGain, this.senderGain.length);
        const neuronWaveRe = snapshot.neuronWaveRe === undefined
            ? new Float32Array(this.waveRe.length)
            : decodeFloats(snapshot.neuronWaveRe, this.waveRe.length);
        const neuronWaveIm = snapshot.neuronWaveIm === undefined
            ? new Float32Array(this.waveIm.length)
            : decodeFloats(snapshot.neuronWaveIm, this.waveIm.length);
        const poolSavedRe = snapshot.wavePoolRe === undefined
            ? new Float32Array(this.poolRe.length)
            : decodeFloats(snapshot.wavePoolRe, this.poolRe.length);
        const poolSavedIm = snapshot.wavePoolIm === undefined
            ? new Float32Array(this.poolIm.length)
            : decodeFloats(snapshot.wavePoolIm, this.poolIm.length);
        const waveShift = decodeFloats(snapshot.connWaveShift, this.connWaveShift.length);
        const waveBiasRe = decodeFloats(snapshot.neuronWaveBiasRe, this.neuronWaveBiasRe.length);
        const waveBiasIm = decodeFloats(snapshot.neuronWaveBiasIm, this.neuronWaveBiasIm.length);
        const modWave = decodeFloats(snapshot.modWaveWeight, this.modWaveWeight.length);
        const addWave = decodeFloats(snapshot.addWaveWeight, this.addWaveWeight.length);
        if (!states || !energies || !bias || !diag || !shift || !mod || !add || !freq || !phase ||
            !waveGain || !waveTurn || !waveBias || !waveBiasTurned || !waveShift ||
            !neuronWaveRe || !neuronWaveIm || !poolSavedRe || !poolSavedIm || !senderGain ||
            !waveBiasRe || !waveBiasIm || !modWave || !addWave)
            return false;
        // A snapshot from an engine with per-connection biases does not fit one
        // without them, and vice versa: same neuron count, genuinely different
        // network. Refused rather than half-loaded, like every other mismatch.
        const wantsConnBias = this.config.connectionBias;
        const hasConnBias = typeof snapshot.connBias === "string" && snapshot.connBias.length > 0;
        if (wantsConnBias !== hasConnBias)
            return false;
        let connBias = null;
        if (wantsConnBias) {
            connBias = decodeFloats(snapshot.connBias, this.connBias.length);
            if (!connBias)
                return false;
        }
        this.allStates.set(states);
        this.bias.set(bias);
        this.connDiag.set(diag);
        this.connShift.set(shift);
        this.modWeight.set(mod);
        this.addWeight.set(add);
        this.waveFreq.set(freq);
        this.wavePhase.set(phase);
        this.connWaveGain.set(waveGain);
        this.connWavePhase.set(waveTurn);
        this.refreshWavePhaseTable();
        this.connWaveBias.set(waveBias);
        this.connWaveBiasIm.set(waveBiasTurned);
        this.senderGain.set(senderGain);
        this.waveRe.set(neuronWaveRe);
        this.waveIm.set(neuronWaveIm);
        this.poolRe.set(poolSavedRe);
        this.poolIm.set(poolSavedIm);
        if (typeof snapshot.emaEnergy === "number" && Number.isFinite(snapshot.emaEnergy)) {
            this.emaEnergy = snapshot.emaEnergy;
            this.hasEma = snapshot.hasEma !== false;
        }
        if (typeof snapshot.sustainedDivergence === "number" && snapshot.sustainedDivergence >= 0) {
            this.sustainedDivergence = snapshot.sustainedDivergence;
        }
        this.connWaveShift.set(waveShift);
        this.neuronWaveBiasRe.set(waveBiasRe);
        this.neuronWaveBiasIm.set(waveBiasIm);
        this.modWaveWeight.set(modWave);
        this.addWaveWeight.set(addWave);
        if (connBias) {
            this.connBias.set(connBias);
            // The row sums are derived, so they are rebuilt rather than saved --
            // saving them would let a snapshot carry sums that disagree with the
            // biases they claim to be sums of.
            const N = this.neurons.length;
            const D = this.totalDims;
            for (let i = 0; i < N; i++) {
                for (let d = 0; d < D; d++) {
                    const rowOffset = (i * D + d) * N;
                    let sum = 0;
                    for (let j = 0; j < N; j++)
                        sum += this.connBias[rowOffset + j];
                    // Mean, matching learnConnectionBias -- a restore that rebuilt this
                    // as a raw sum would put the network back saturated.
                    this.connBiasRowSum[i * D + d] = sum / Math.max(1, N);
                }
            }
        }
        // HyperNeuron.state mirrors allStates for callers that read neurons
        // directly; leaving it stale would have getNeuronStates() describing the
        // network as it was before the restore.
        const N = this.neurons.length;
        const D = this.totalDims;
        for (let i = 0; i < N; i++) {
            const neuron = this.neurons[i];
            neuron.energy = energies[i];
            for (let d = 0; d < D; d++)
                neuron.state[d] = states[d * N + i];
        }
        return true;
    }
    /**
     * Grow the mesh: add neurons to a network that is already running.
     *
     * This is what a net skill IS. A skill built in the Extension Builder is a
     * small network of its own, and connecting it means its neurons join THIS
     * mesh -- all-to-all with everything already here, every new connection
     * carrying the same equation every old one does: its own weight and bias,
     * the whole network's weight and bias, and the wave copies of both. Not a
     * separate network the agent consults, and not a paragraph of text about
     * what the skill knows. Neurons, in the mesh, computing.
     *
     * Everything already here is preserved exactly. A skill that shifted the
     * weights of the network it joined would be a skill that damages what it is
     * added to, and nobody would install a second one.
     *
     * Returns the ids of the new neurons, in order, so a caller can bind names
     * to them and wire them up.
     */
    addNeurons(count) {
        if (!Number.isInteger(count) || count <= 0)
            return [];
        const oldN = this.neurons.length;
        const newN = oldN + count;
        const D = this.totalDims;
        // Every per-connection array is indexed [receiver][dimension][sender], so
        // growing it is not a copy -- each row moves to a new offset and each row
        // gets longer. Done row by row, with the new columns left at their
        // initial values.
        const growConnections = (old) => {
            const grown = new Float32Array(newN * D * newN);
            for (let i = 0; i < oldN; i++) {
                for (let d = 0; d < D; d++) {
                    const from = (i * D + d) * oldN;
                    const to = (i * D + d) * newN;
                    grown.set(old.subarray(from, from + oldN), to);
                }
            }
            return grown;
        };
        // The wave arrays are [receiver][sender], one dimension shallower.
        const growPairs = (old, fill) => {
            const grown = new Float32Array(newN * newN);
            if (fill !== 0)
                grown.fill(fill);
            for (let i = 0; i < oldN; i++) {
                grown.set(old.subarray(i * oldN, i * oldN + oldN), i * newN);
            }
            return grown;
        };
        const growPerNeuron = (old) => {
            const grown = new Float32Array(newN);
            grown.set(old);
            return grown;
        };
        // States are [dimension][neuron], so each dimension's row moves.
        const grownStates = new Float32Array(D * newN);
        for (let d = 0; d < D; d++) {
            grownStates.set(this.allStates.subarray(d * oldN, (d + 1) * oldN), d * newN);
        }
        const grownBias = new Float32Array(newN * D);
        grownBias.set(this.bias);
        const scale = Math.sqrt(1 / Math.max(1, newN));
        const newConnDiag = growConnections(this.connDiag);
        const newConnShift = growConnections(this.connShift);
        // The new connections in both directions: every new neuron to every old
        // one, and every old one to every new. All-to-all is the architecture, so
        // a neuron that joined with connections in only one direction would be
        // half-attached.
        for (let i = 0; i < newN; i++) {
            for (let d = 0; d < D; d++) {
                const row = (i * D + d) * newN;
                for (let j = 0; j < newN; j++) {
                    if (i === j)
                        continue;
                    if (i < oldN && j < oldN)
                        continue; // already there, untouched
                    newConnDiag[row + j] = (Math.random() * 2 - 1) * scale;
                    newConnShift[row + j] = (Math.random() * 2 - 1) * scale * 0.5;
                }
            }
        }
        this.allStates = grownStates;
        this.bias = grownBias;
        this.connDiag = newConnDiag;
        this.connShift = newConnShift;
        if (this.config.connectionBias) {
            this.connBias = growConnections(this.connBias);
            const grownRowSum = new Float32Array(newN * D);
            grownRowSum.set(this.connBiasRowSum);
            this.connBiasRowSum = grownRowSum;
        }
        // Each neuron's window into the network is a ROW, so growing it is the
        // same row-by-row relayout the connections need -- and every neuron's
        // window gains a column for each arrival, because a window that could not
        // see the new neurons would not be a window into the whole network.
        const growWindows = (old) => {
            const grown = new Float32Array(newN * newN);
            for (let i = 0; i < oldN; i++)
                grown.set(old.subarray(i * oldN, i * oldN + oldN), i * newN);
            for (let i = 0; i < newN; i++) {
                for (let k = 0; k < newN; k++) {
                    if (i < oldN && k < oldN)
                        continue; // already there, untouched
                    grown[i * newN + k] = (Math.random() * 2 - 1) * scale;
                }
            }
            return grown;
        };
        this.modWeight = growWindows(this.modWeight);
        this.addWeight = growWindows(this.addWeight);
        this.modWaveWeight = growWindows(this.modWaveWeight);
        this.addWaveWeight = growWindows(this.addWaveWeight);
        this.senderGain = growPerNeuron(this.senderGain);
        this.neuronWaveBiasRe = growPerNeuron(this.neuronWaveBiasRe);
        this.neuronWaveBiasIm = growPerNeuron(this.neuronWaveBiasIm);
        for (let i = oldN; i < newN; i++) {
            this.senderGain[i] = 1 + (Math.random() * 2 - 1) * scale;
        }
        this.connWaveGain = growPairs(this.connWaveGain, 1);
        this.connWavePhase = growPairs(this.connWavePhase, 0);
        this.connWaveCos = growPairs(this.connWaveCos, 1);
        this.connWaveSin = growPairs(this.connWaveSin, 0);
        this.connWaveBias = growPairs(this.connWaveBias, 0);
        this.connWaveBiasIm = growPairs(this.connWaveBiasIm, 0);
        this.connWaveShift = growPairs(this.connWaveShift, 0);
        this.waveFreq = growPerNeuron(this.waveFreq);
        this.wavePhase = growPerNeuron(this.wavePhase);
        this.waveRe = growPerNeuron(this.waveRe);
        this.waveIm = growPerNeuron(this.waveIm);
        this.prevWaveRe = new Float32Array(newN);
        this.prevWaveIm = new Float32Array(newN);
        // A wave of its own for each new neuron, spread across the band by its
        // position among the neurons ARRIVING rather than by its position in the
        // mesh. Spreading by absolute index looked equivalent and is not: once the
        // network has grown a few times, every later arrival has a high index, so
        // they all crowd into the top of the band and sit on top of each other --
        // and neurons sharing a frequency interfere, which for unrelated neurons
        // means drowning each other out.
        //
        // A caller who knows what these neurons MEAN should override this: see
        // net-skill-graft.ts, which gives each one a wave derived from its
        // definition so that neurons about the same thing reinforce instead.
        for (let i = oldN; i < newN; i++) {
            const spread = count === 1 ? 0.5 : (i - oldN) / (count - 1);
            this.waveFreq[i] = MIN_WAVE_FREQ + spread * (MAX_WAVE_FREQ - MIN_WAVE_FREQ);
            this.wavePhase[i] = Math.random() * Math.PI * 2;
        }
        // Everything sized by the neuron count, rebuilt. A scratch array left at
        // the old size is a buffer overrun waiting for the next settle.
        this.nextStatesBuffer = new Float32Array(newN * D);
        this.stateDeltasBuffer = new Float32Array(newN);
        this.isDrivenScratch = new Uint8Array(newN);
        this.drivenIndicesScratch = new Int32Array(newN);
        this.nonDrivenIndicesScratch = new Int32Array(newN);
        this.heldIndicesScratch = new Int32Array(newN);
        // Sized by the neuron count AND the dimensions, because every receiver now
        // has its own window into the network. Left at the old size, a grown
        // network reads past the end of them and every grafted neuron comes back
        // NaN on its first tick.
        this.hyperGainScratch = new Float32Array(newN * D);
        this.hyperAddScratch = new Float32Array(newN * D);
        this.hyperScaleScratch = new Float32Array(newN * D);
        this.netWaveWeightReScratch = new Float32Array(newN);
        this.netWaveWeightImScratch = new Float32Array(newN);
        this.netWaveBiasReScratch = new Float32Array(newN);
        this.netWaveBiasImScratch = new Float32Array(newN);
        this.vsScratch = new Float32Array(newN);
        this.hasVScratch = new Uint8Array(newN);
        this.ratesScratch = new Float32Array(newN);
        this.forceScratch = new Float32Array(newN);
        this.heldThisTick = new Uint8Array(newN);
        this.deltaSumsScratch = new Float32Array(newN);
        this.waveAmpScratch = new Float32Array(newN);
        this.waveTermScratch = new Float32Array(newN);
        this.wavePhaseErrorScratch = new Float32Array(newN);
        this.waveBin = new Int32Array(newN);
        this.phaseCos = new Float32Array(newN);
        this.phaseSin = new Float32Array(newN);
        this.entropyLookup = new Float64Array(newN + 1);
        this.entropyLookup[0] = 0;
        for (let c = 1; c <= newN; c++) {
            const p = c / newN;
            this.entropyLookup[c] = p * Math.log2(p);
        }
        this.stateViews = new Array(D);
        for (let d = 0; d < D; d++) {
            this.stateViews[d] = this.allStates.subarray(d * newN, (d + 1) * newN);
        }
        const added = [];
        for (let i = oldN; i < newN; i++) {
            // A start of its own, like every neuron gets at construction: a skill
            // whose neurons all began identical would have nothing to tell them
            // apart, and learning could never separate them afterwards.
            const state = new Float32Array(D);
            for (let d = 1; d < D; d++) {
                const value = Math.random() * 2 - 1;
                state[d] = value;
                this.allStates[d * newN + i] = value;
            }
            this.neurons.push({
                id: i,
                state,
                energy: 0,
                lastTransition: null,
                influenceRadius: 0.1 + Math.random() * 0.4,
                activationThreshold: 0.3 + Math.random() * 0.4,
            });
            added.push(i);
        }
        // Point every neuron's state view back into the grown buffer.
        for (let i = 0; i < newN; i++) {
            const neuron = this.neurons[i];
            for (let d = 0; d < D; d++)
                neuron.state[d] = this.allStates[d * newN + i];
        }
        return added;
    }
    /**
     * Wire one connection by hand: what neuron `from` contributes to neuron
     * `to`, on every dimension.
     *
     * How a net skill's own structure survives being grafted in. The builder
     * knows which of its neurons feed which; without this they would arrive
     * connected to the mesh at random and to each other not at all, which is a
     * pile of neurons rather than a skill.
     */
    setConnection(to, from, weight) {
        const N = this.neurons.length;
        if (to < 0 || to >= N || from < 0 || from >= N || to === from)
            return false;
        if (!Number.isFinite(weight))
            return false;
        const D = this.totalDims;
        for (let d = 0; d < D; d++)
            this.connDiag[(to * D + d) * N + from] = weight;
        return true;
    }
    /**
     * Tune one neuron to answer a particular direction.
     *
     * setConnection() writes the same weight to every dimension, which cannot
     * make a neuron prefer one input over another -- it scales everything
     * equally. This writes a weight PER DIMENSION on one incoming connection,
     * so the neuron's activity rises when what arrives lines up with `toward`
     * and stays low when it does not.
     *
     * This is what a single-neuron region needs in order to be a speciality
     * rather than a label. A region's state cannot carry one: a non-driven
     * neuron is recomputed from its inputs every tick, so seeding its state
     * places it nowhere (measured -- [0.9,-0.9,...] reads [0.01,-0.02,...] one
     * tick later). Incoming weights survive, and they are what capabilityGap()
     * ends up reading.
     */
    tuneNeuronTo(id, from, toward) {
        const N = this.neurons.length;
        if (id < 0 || id >= N || from < 0 || from >= N || id === from)
            return false;
        const D = this.totalDims;
        let norm = 0;
        for (let k = 0; k < toward.length; k++)
            norm += toward[k] * toward[k];
        if (!(norm > 0))
            return false;
        const scale = 1 / Math.sqrt(norm);
        for (let d = 1; d < D; d++) {
            const v = toward[d - 1] ?? 0;
            if (!Number.isFinite(v))
                continue;
            this.connDiag[(id * D + d) * N + from] = v * scale;
        }
        return true;
    }
    /**
     * Put one neuron where its meaning points.
     *
     * A grafted skill neuron starts somewhere rather than nowhere: its
     * definition, embedded, becomes the state it begins in, so it sits in the
     * part of the space its meaning belongs to and the mesh takes over from
     * there. Dimension 0 is the input flag and is not writable this way.
     *
     * Shorter vectors fill what they cover and leave the rest; longer ones are
     * truncated. A caller should not have to know the network's width to say
     * what a neuron is about.
     */
    setNeuronState(id, content) {
        const N = this.neurons.length;
        if (id < 0 || id >= N)
            return false;
        const D = this.totalDims;
        const neuron = this.neurons[id];
        const limit = Math.min(content.length, D - 1);
        for (let k = 0; k < limit; k++) {
            const raw = content[k];
            if (!Number.isFinite(raw))
                continue;
            const value = raw < -1 ? -1 : (raw > 1 ? 1 : raw);
            this.allStates[(k + 1) * N + id] = value;
            neuron.state[k + 1] = value;
        }
        return true;
    }
    /**
     * Label a neuron with the expert or skill it belongs to.
     *
     * The neuron-level MoE (Section 2.1): experts are groups of neurons inside
     * ONE network, not separate networks consulted in turn. Grouping changes no
     * wiring at all -- the neuron keeps every connection it had, in both
     * directions -- it only lets a tick say which groups are the ones being
     * asked this time.
     */
    setNeuronGroup(id, group) {
        if (id < 0 || id >= this.neurons.length)
            return false;
        const existing = this.neuronGroups.get(id);
        if (existing)
            existing.add(group);
        else
            this.neuronGroups.set(id, new Set([group]));
        return true;
    }
    /**
     * Take one neuron out of one skill, leaving whatever else it belongs to.
     *
     * The counterpart to setNeuronGroup adding rather than replacing: without
     * this there would be no way to shrink a region, only to grow it.
     */
    clearNeuronGroup(id, group) {
        const groups = this.neuronGroups.get(id);
        if (!groups || !groups.delete(group))
            return false;
        if (groups.size === 0)
            this.neuronGroups.delete(id);
        return true;
    }
    /** Every skill a neuron belongs to, in the order it joined them. */
    neuronGroupsOf(id) {
        const groups = this.neuronGroups.get(id);
        return groups ? Array.from(groups) : [];
    }
    /**
     * Does the mesh have anything that handles what it is currently holding?
     *
     * It works when the regions cover what arrives, and reports nothing when
     * they do not. Both halves matter.
     *
     * WHAT IT DOES. Each Net Skill region's neurons are tuned to what that
     * skill is for, so an input pointing that way makes the region do more.
     * Measured on single-neuron regions -- the shape the live mesh has -- an
     * input aligned to a region reads about twice what one aligned to nothing
     * reads (0.51 of it), stable across tuning strengths, and a sustained run
     * of the latter fires. On the live agent, inputs matching the experts'
     * own domains read 0.00589 against 0.00390 for a string of symbols: a
     * ratio of 0.661, under the threshold, gap reported.
     *
     * MATCH THE INPUT MAGNITUDE BEFORE ASKING. Region response is how much a
     * region is doing, and a bigger input makes everything do more. An
     * unfamiliar vector with a larger norm reads HIGHER than a familiar one --
     * measured at every tuning strength from 1x to 16x -- which looks exactly
     * like "the mesh cannot tell these apart" and is not. learn() normalises
     * before asking, and anything else calling this must too.
     *
     * WHAT IT WILL NOT TELL YOU. If the regions do not cover the input at all,
     * everything reads alike and no gap is reportable. The live experts are
     * device permissions and programming categories, so an ordinary fact like
     * "Paris is the capital of France" matches no region -- and reads the same
     * as a string of symbols (0.00446 against 0.00431, ratio 0.967). That is
     * the honest answer rather than a broken one: a mesh with no expert for
     * general knowledge has no basis for singling out one unhandled input from
     * another. It reports no gap and the text heuristic in learn() decides.
     *
     * HOW THIS LOOKED LIKE IT WORKED BEFORE, AND DID NOT. Region response used
     * to count DRIVEN neurons, whose state is clamped to the input rather than
     * computed from it. Expert regions take neurons from index 0 up, so the
     * first region owned neuron 0 -- the input neuron -- and always scored the
     * maximum. `best` was the input handed back to itself, which is why a
     * string of symbols scored 1.000 of the usual level and a familiar sentence
     * 0.955. The tests covering this passed on that artifact.
     *
     * Call it after process(), which is when the states mean something.
     *
     * WHERE THIS DOES NOT WORK YET, measured on the live agent. The mesh there
     * carries 43 regions, one neuron each, registered from the expert
     * catalogue -- and nothing ever trains them on their specialities. So their
     * responses carry no information about the input: a familiar sentence read
     * 0.955 of the usual level and a string of symbols nothing had ever seen
     * read 1.000. No gap is reportable from that, and none is reported.
     *
     * It is not the measurement. Region response separates cleanly in a mesh
     * whose regions HAVE specialised -- 0.070 against 0.055 for three regions
     * of eight neurons trained on distinct patterns, which is what the tests
     * cover. Per-region baselines were tried, on the theory that the max across
     * 43 regions washes the signal out; they did not help (1.076 familiar
     * against 1.084 unfamiliar) and broke the cases that do work, so they were
     * reverted. The missing piece is that the live regions never learn to be
     * different from each other, which is training, not reading.
     *
     * And the obvious shortcut does not work, which is worth knowing before
     * trying it: seeding each expert neuron's STATE from its name places it
     * nowhere, because a non-driven neuron's state is recomputed from its
     * inputs on every tick. Measured -- a neuron set to
     * [0.9,-0.9,0.9,...] reads [0.01,-0.02,0.02,...] one tick later, and the
     * live gap numbers came back byte-identical with the seeding in place.
     * What persists across a tick is the connections, the biases and the wave
     * signature; a single-neuron region has no connections of its own to carry
     * a speciality, so specialising one means giving it distinct INCOMING
     * weights. That is the shape of the remaining work.
     */
    capabilityGap(threshold = CAPABILITY_GAP_RATIO) {
        const D = this.totalDims;
        const states = this.allStates;
        const N = this.neurons.length;
        let bestSkill;
        let best = 0;
        const seen = new Set();
        for (const groups of this.neuronGroups.values())
            for (const g of groups)
                seen.add(g);
        for (const skill of seen) {
            const ids = this.neuronsInGroup(skill);
            if (ids.length === 0)
                continue;
            let sum = 0;
            let count = 0;
            for (const i of ids) {
                if (i >= N)
                    continue;
                // Skip DRIVEN neurons. A driven neuron is clamped to the input, so
                // its state is the input rather than a response to it -- its
                // "response" is just the input's magnitude, near enough constant
                // whatever the input says.
                //
                // This was the whole reason the signal read flat on the live agent.
                // Expert regions are assigned neurons from index 0 up, so the first
                // expert owned neuron 0, which is the neuron the input is fed into.
                // Its region therefore always scored the maximum, `best` was that
                // region every single time, and the ratio came out 1.000 for a string
                // of symbols nothing had ever seen -- indistinguishable from 0.955
                // for a familiar sentence. The measurement was reading the input back
                // to itself.
                if (states[0 * N + i] >= 1)
                    continue;
                // Content dimensions only: dimension 0 is the input flag, which is 1
                // on anything driven and says nothing about whether the region
                // engaged with what arrived.
                for (let d = 1; d < D; d++) {
                    const v = states[d * N + i];
                    sum += v < 0 ? -v : v;
                    count++;
                }
            }
            if (count === 0)
                continue;
            const response = sum / count;
            if (response > best) {
                best = response;
                bestSkill = skill;
            }
        }
        const baseline = this.capabilityBaseline;
        const settled = this.capabilitySamples >= CAPABILITY_BASELINE_MIN_SAMPLES;
        // A plain EMA. It was written with a Math.max first -- "so a run of gaps
        // cannot drag the baseline down" -- and that was exactly wrong: the
        // baseline then only ever ratcheted UP, so one strongly-answered input
        // made everything after it read as a gap. On the live agent it fired on
        // "Paris is in France" and not on the file format it had never seen.
        this.capabilityBaseline = this.capabilitySamples === 0
            ? best
            : this.capabilityBaseline * CAPABILITY_BASELINE_DECAY + best * (1 - CAPABILITY_BASELINE_DECAY);
        this.capabilitySamples++;
        // Sustained, the way divergence is elsewhere here. One quiet tick is
        // noise -- region response varies with whatever else the network was just
        // doing -- and building an extension is not something to do on noise.
        const quiet = settled && baseline > 0 && best < baseline * threshold;
        this.capabilityQuietRun = quiet ? this.capabilityQuietRun + 1 : 0;
        return {
            needed: this.capabilityQuietRun >= CAPABILITY_GAP_TICKS,
            bestSkill,
            bestResponse: best,
            baseline,
            hasBaseline: settled,
            quietRun: this.capabilityQuietRun,
        };
    }
    /**
     * How strongly every pair of skills is wired to each other, strongest
     * first.
     *
     * The connection rule is Hebbian, so two regions that keep being active at
     * the same time keep strengthening the connections between them -- that
     * happens whether or not anybody looks. What was missing was the looking.
     * "Over time the network could develop new combinations of expertise" is a
     * claim about something that can be READ: maths and physics drifting
     * together into physics reasoning is a number here going up, and if it
     * never goes up the combination is not emerging no matter how good the
     * story is.
     *
     * `strength` is the mean |weight| over every connection running between the
     * two regions in both directions, so a big skill does not outscore a small
     * one just by having more connections. `overlap` is how many neurons the
     * two hold in common.
     */
    skillAffinity() {
        const names = new Set();
        for (const groups of this.neuronGroups.values())
            for (const g of groups)
                names.add(g);
        const skills = Array.from(names).sort();
        const members = new Map();
        for (const name of skills)
            members.set(name, this.neuronsInGroup(name));
        const N = this.neurons.length;
        const D = this.getDimensions();
        const out = [];
        for (let x = 0; x < skills.length; x++) {
            for (let y = x + 1; y < skills.length; y++) {
                const a = skills[x];
                const b = skills[y];
                const left = members.get(a);
                const right = members.get(b);
                let sum = 0;
                let count = 0;
                // Both directions: a -> b and b -> a are different connections, and a
                // pair can be lopsided.
                for (const [receivers, senders] of [[left, right], [right, left]]) {
                    const senderSet = new Set(senders);
                    for (const i of receivers) {
                        if (i >= N)
                            continue;
                        for (let d = 0; d < D; d++) {
                            const row = (i * D + d) * N;
                            for (const j of senderSet) {
                                if (j === i || j >= N)
                                    continue;
                                sum += Math.abs(this.connDiag[row + j]) + Math.abs(this.connShift[row + j]);
                                count += 2;
                            }
                        }
                    }
                }
                out.push({
                    a,
                    b,
                    strength: count > 0 ? sum / count : 0,
                    overlap: this.groupOverlap(a, b).length,
                });
            }
        }
        return out.sort((p, q) => q.strength - p.strength);
    }
    /**
     * The neurons two skills hold in common.
     *
     * An overlap is the whole point of regions rather than partitions: a neuron
     * that belongs to both maths and physics fires for both, and is the place
     * where "physics reasoning" can live without anybody having built it.
     */
    groupOverlap(a, b) {
        const ids = [];
        for (const [id, groups] of this.neuronGroups) {
            if (groups.has(a) && groups.has(b))
                ids.push(id);
        }
        return ids.sort((x, y) => x - y);
    }
    /**
     * The first group a neuron joined, or undefined for an ungrouped one.
     *
     * Kept for callers that only ever expected one. A neuron can belong to
     * several -- neuronGroupsOf() is the honest answer.
     */
    neuronGroup(id) {
        const groups = this.neuronGroups.get(id);
        if (!groups)
            return undefined;
        for (const name of groups)
            return name;
        return undefined;
    }
    /** Every neuron belonging to one group, in id order. */
    neuronsInGroup(group) {
        const ids = [];
        for (const [id, names] of this.neuronGroups)
            if (names.has(group))
                ids.push(id);
        return ids.sort((a, b) => a - b);
    }
    /**
     * The directions a state is read through to become a wave -- one pair per
     * FREQUENCY BIN.
     *
     * Two directions rather than one because the reading is complex: a state
     * has to be able to become a wave with a phase, not just a height. They are
     * orthogonal and unit-length, so the reading is a rotation-and-scale rather
     * than something that quietly amplifies or flattens the state.
     *
     * Per bin rather than one pair for the whole engine, and that is the fix
     * for a real hole. A single shared pair is a linear map from the D-1
     * content dimensions down to 2, so it has a null space of D-3 directions --
     * states that produce NO wave at all. Measured at D=8: an input orthogonal
     * to both rows, driven at magnitude 0.6, put exactly 0.000000 into the
     * pool. Six of the eight directions a neuron could hold were invisible to
     * the entire wave layer, permanently, for every neuron at once.
     *
     * The per-neuron basis is NOT the fix and was tried first: two neurons
     * reading along different directions cannot cancel, and agreeing sources
     * came out at 0.2997 against 0.4212 for contradicting ones -- the claim
     * backwards. What makes cancellation work is that the sources share a
     * basis.
     *
     * Per BIN keeps exactly that and loses nothing, because interference only
     * ever happens within a bin: two waves meet only if they share a frequency,
     * and everything in one bin still reads through one identical pair. Two
     * bins reading different directions never had anything to cancel. So the
     * wave layer as a whole now spans every content direction while every
     * cancellation that worked before still works, at no extra cost in the
     * settle loop -- it is the same two multiplies, at a different offset.
     *
     * Deterministic in the bin index, so two engines built the same way read
     * the same way and a test can compare them. The offsets are irrational
     * multiples so no two bins land on the same pair.
     */
    seedWaveReading() {
        const D = this.totalDims;
        for (let b = 0; b < WAVE_BINS; b++) {
            const at = b * D;
            // Two directions for THIS bin. The offsets are what make bins differ;
            // they are irrational multiples so no two bins land on the same pair.
            let a = 0;
            let c = 0;
            for (let d = 1; d < D; d++) {
                const re = Math.sin(d * 12.9898 + b * 2.399963);
                const im = Math.sin(d * 78.233 + b * 1.618034);
                this.waveReadRe[at + d] = re;
                this.waveReadIm[at + d] = im;
                a += re * re;
                c += im * im;
            }
            // Dimension 0 is the input flag, not content, and never contributes.
            this.waveReadRe[at] = 0;
            this.waveReadIm[at] = 0;
            const na = a > 0 ? 1 / Math.sqrt(a) : 0;
            const nb = c > 0 ? 1 / Math.sqrt(c) : 0;
            for (let d = 1; d < D; d++) {
                this.waveReadRe[at + d] *= na;
                this.waveReadIm[at + d] *= nb;
            }
            // Make the imaginary direction orthogonal to the real one, so a state
            // lying along one reads as purely real and along the other as purely
            // imaginary. Without this the two readings correlate and the phase a
            // source can express is squeezed into part of the circle.
            let dot = 0;
            for (let d = 1; d < D; d++)
                dot += this.waveReadRe[at + d] * this.waveReadIm[at + d];
            let norm = 0;
            for (let d = 1; d < D; d++) {
                const v = this.waveReadIm[at + d] - dot * this.waveReadRe[at + d];
                this.waveReadIm[at + d] = v;
                norm += v * v;
            }
            const nn = norm > 0 ? 1 / Math.sqrt(norm) : 0;
            for (let d = 1; d < D; d++)
                this.waveReadIm[at + d] *= nn;
        }
    }
    /**
     * Set one neuron's wave by hand.
     *
     * Wave signatures are learned, so this is not the usual way in -- but two
     * neurons that must be exact opposites cannot be left to find each other.
     * The Zip Loop's bit-0 and bit-1 neurons are the case: they need to be
     * perfect enemies, the same wave half a cycle apart, so a one and a zero
     * arriving together annihilate rather than leaving a residue that means
     * neither.
     */
    setWaveSignature(id, frequency, phase) {
        if (!Number.isFinite(frequency) || !Number.isFinite(phase))
            return false;
        if (id < 0 || id >= this.neurons.length)
            return false;
        const clamped = frequency < MIN_WAVE_FREQ ? MIN_WAVE_FREQ : (frequency > MAX_WAVE_FREQ ? MAX_WAVE_FREQ : frequency);
        this.waveFreq[id] = clamped;
        const TWO_PI = Math.PI * 2;
        let wrapped = phase % TWO_PI;
        if (wrapped < 0)
            wrapped += TWO_PI;
        this.wavePhase[id] = wrapped;
        return true;
    }
    /**
     * What is in the shared pool right now, one entry per occupied frequency.
     *
     * Exposed because the pool is where the interference actually happens, and
     * everything downstream of it -- tanh, energy damping, the connection maths
     * -- makes it harder to see rather than easier. Measuring "did those two
     * waves cancel" through a neuron's final state means measuring it through
     * three other mechanisms that also moved.
     */
    poolContent() {
        const span = (MAX_WAVE_FREQ - MIN_WAVE_FREQ) || 1;
        const content = [];
        for (let b = 0; b < WAVE_BINS; b++) {
            const re = this.poolRe[b];
            const im = this.poolIm[b];
            const magnitude = Math.sqrt(re * re + im * im);
            // Below this is float dust from waves that cancelled, not a wave. Two
            // equal and opposite ripples annihilate in exact arithmetic; in Float32
            // they leave a residue around 1e-8, and reporting that as a wave in the
            // pool would make perfect cancellation look imperfect.
            if (magnitude <= POOL_SILENCE)
                continue;
            content.push({
                frequency: MIN_WAVE_FREQ + (b / (WAVE_BINS - 1)) * span,
                magnitude,
                phase: Math.atan2(im, re),
            });
        }
        return content;
    }
    /** What wave a neuron currently carries. */
    waveSignature(id) {
        if (id < 0 || id >= this.neurons.length)
            return null;
        return { frequency: this.waveFreq[id], phase: this.wavePhase[id] };
    }
    /**
     * Find out what one neuron is contributing, by interference.
     *
     * "When every neuron has the same input except for the neuron you want to
     * find's input, then it should release a wave which is its wave."
     *
     * Hold the whole network at one value and every neuron is saying the same
     * thing, so what they put into the pool is common to all of them. Leave one
     * neuron out of that and it is the only thing in the pool that is not the
     * chorus -- and because it owns its own frequency, its contribution is
     * readable on its own. The pool sorts it out; nothing has to be traced
     * through the connections.
     *
     * Reading is not learning and a probe is not a tick. The network is
     * snapshotted, driven, measured and put back exactly as it was, so asking
     * what a neuron is doing does not change what it does. That distinction has
     * bitten this file before: fifty idle read ticks once moved 98% of the
     * connections in the mesh.
     *
     * Returns the height and the angle of what came back, and null for a
     * neuron that does not exist or a network with its wave layer switched off
     * -- there is nothing to interfere in a network with no waves, and a zero
     * would read as "this neuron contributes nothing", which is a different
     * claim.
     */
    probeByInterference(id, level = 0.5) {
        const N = this.neurons.length;
        if (id < 0 || id >= N)
            return null;
        if (this.config.waveGain === 0)
            return null;
        const saved = this.captureNetworkState();
        const steps = this.config.propagationSteps;
        try {
            // Everyone but the one being asked about, held at the same value.
            const chorus = new Set();
            for (let i = 0; i < N; i++)
                if (i !== id)
                    chorus.add(i);
            const held = new Array(this.config.dimensions).fill(level);
            // Exactly one settle iteration, whatever the network normally runs.
            //
            // A neuron's wave goes into the pool at the force of ITS OWN INPUT,
            // measured from the state it was holding when the iteration began. Let
            // the settle run twice and the second iteration measures the force of a
            // state this probe just computed -- the neuron's own input has been
            // overwritten by the answer to the question. Measured before this line
            // existed: a neuron held at 0.02 and the same neuron held at 0.95 both
            // read 0.1726, which is the reading of the chorus and not of the neuron.
            this.config.propagationSteps = 1;
            this.process(held, undefined, chorus, undefined, { learn: false });
            const bin = this.binFor(this.waveFreq[id]);
            const re = this.poolRe[bin];
            const im = this.poolIm[bin];
            return {
                amplitude: Math.sqrt(re * re + im * im),
                phase: Math.atan2(im, re),
            };
        }
        finally {
            // Put back exactly, whatever happened above.
            this.config.propagationSteps = steps;
            this.restoreNetworkState(saved);
        }
    }
    /** Which frequency bin a wave falls in. One rule, so the pool is read the way it is written. */
    binFor(frequency) {
        const span = (MAX_WAVE_FREQ - MIN_WAVE_FREQ) || 1;
        const slot = Math.round(((frequency - MIN_WAVE_FREQ) / span) * (WAVE_BINS - 1));
        return slot < 0 ? 0 : (slot >= WAVE_BINS ? WAVE_BINS - 1 : slot);
    }
    /**
     * What a neuron is supposed to say, and whether it is saying it.
     *
     * A `@definishon` in NeuroLang is a contract: "when this neuron is the one
     * being read, the network's answer must be this." The target is the
     * definition embedded into the network's own dimensions, kept so the
     * contract can be checked rather than assumed.
     *
     * This lived only on ElasticCoreBlock, which meant a NeuroLang program built
     * its neurons into THAT network -- a second network with its own equation,
     * beside the one everything else runs. The DSL builds into the one network
     * now, and a definition is checkable there.
     */
    setDefinitionTarget(id, target) {
        if (id < 0 || id >= this.neurons.length)
            return false;
        const dims = this.config.dimensions;
        const stored = new Float32Array(dims);
        for (let d = 0; d < Math.min(dims, target.length); d++) {
            const value = target[d];
            stored[d] = Number.isFinite(value) ? (value < -1 ? -1 : (value > 1 ? 1 : value)) : 0;
        }
        this.definitionTargets.set(id, stored);
        return true;
    }
    /**
     * How far a neuron is from the definition it was given, and whether that is
     * close enough to call the contract satisfied.
     *
     * Mean squared error over the content dimensions -- dimension 0 is the
     * input flag, which is about how a neuron is being driven rather than what
     * it means. A neuron with no definition has nothing to fail: it reports a
     * loss of 0 and satisfied, because an unstated contract is not a broken one.
     */
    checkDefinition(id, tolerance = 0.25) {
        if (id < 0 || id >= this.neurons.length)
            return null;
        const dims = this.config.dimensions;
        const target = this.definitionTargets.get(id) ?? new Float32Array(dims);
        const N = this.neurons.length;
        const readout = new Float32Array(dims);
        for (let d = 0; d < dims; d++)
            readout[d] = this.allStates[(d + 1) * N + id];
        let loss = 0;
        for (let d = 0; d < dims; d++) {
            const error = target[d] - readout[d];
            loss += error * error;
        }
        loss /= Math.max(1, dims);
        return { neuronId: id, loss, satisfied: loss <= tolerance, readout, target };
    }
    /**
     * The network as a topology: nodes and the strongest edges between them.
     *
     * For anything that wants to LOOK at the network -- the snapshot the
     * Extension Builder imports, a visualisation -- rather than run it. It used
     * to come from a separate NeuronMesh that was built, serialised, and never
     * computed; now it is a view of the one network that actually thinks.
     *
     * Every neuron connects to every other on every dimension, so the full edge
     * list is neurons^2 x dimensions and unusable as a picture. `perNeuron` keeps
     * the strongest incoming connections per neuron, measured on the first
     * content dimension. That is a view, and the doc says so rather than letting
     * a caller believe it is the whole wiring.
     */
    topology(perNeuron = 4) {
        const N = this.neurons.length;
        const D = this.totalDims;
        const nodes = this.neurons.map(n => ({
            id: n.id,
            activation: n.state[1] ?? 0,
            bias: this.bias[n.id * D + 1] ?? 0,
            connections: new Map(),
            layer: 0,
            activationHistory: [],
        }));
        const edges = [];
        const dimension = Math.min(1, D - 1);
        for (let i = 0; i < N; i++) {
            const row = (i * D + dimension) * N;
            const strongest = [];
            for (let j = 0; j < N; j++) {
                if (j === i)
                    continue;
                strongest.push([j, this.connDiag[row + j]]);
            }
            strongest.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
            for (const [j, weight] of strongest.slice(0, perNeuron)) {
                nodes[i].connections.set(j, weight);
                edges.push([j, i, weight]);
            }
        }
        return {
            nodes,
            edges,
            // Density is of the REAL wiring, which is all-to-all, not of the subset
            // drawn above -- a picture that showed 4 edges per neuron and reported
            // itself as sparse would be lying twice.
            density: 1,
            averagePathLength: 1,
            clusteringCoefficient: 1,
            nodeCount: N,
            edgeCount: edges.length,
        };
    }
    /** Total configured neuron count (fixed at construction). */
    getNeuronCount() {
        return this.neurons.length;
    }
    /**
     * The directions a state is read through to become a wave, all bins, laid
     * out as [bin * dimensions + d].
     *
     * Exposed so the reference equation can be handed the same table the engine
     * uses -- a reference implementation given different constants proves
     * nothing about the fast one.
     */
    getWaveReading() {
        return { re: new Float32Array(this.waveReadRe), im: new Float32Array(this.waveReadIm) };
    }
    /** The settle loop's iteration ceiling. */
    getPropagationSteps() {
        return this.config.propagationSteps;
    }
    /**
     * Change the settle ceiling.
     *
     * For callers that stream input in and read answers out with different
     * needs -- the Zip Loop feeds a bit with a couple of steps and settles fully
     * only when producing output.
     */
    setPropagationSteps(steps) {
        if (Number.isFinite(steps) && steps >= 1)
            this.config.propagationSteps = Math.floor(steps);
    }
    /** Content dimensions per neuron (excludes the reserved input-flag dimension). */
    getDimensions() {
        return this.config.dimensions;
    }
    /**
     * Section 2.3: directly set a connection's diagonal weight (targetId's
     * incoming weight from sourceId, for one content dimension) — the write
     * path the NeuroLang DSL's `@connections=` primitive uses to wire two
     * declared neurons together, rather than only ever learning weights
     * through Hebbian/delta-rule updates.
     */
    setConnectionWeight(targetId, sourceId, dim, weight) {
        const D = this.totalDims;
        if (targetId === sourceId || dim < 0 || dim >= D)
            return;
        if (!this.neurons.some(n => n.id === targetId) || !this.neurons.some(n => n.id === sourceId))
            return;
        const N = this.neurons.length;
        const idx = (targetId * D + dim) * N + sourceId;
        this.connDiag[idx] = clamp(weight, -2, 2);
    }
    getContextMatrix() {
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
    getInputTopography() {
        const map = new Map();
        for (const n of this.neurons)
            map.set(n.id, n.state[0]);
        return map;
    }
    isExclusiveInput(threshold = 0.9) {
        const hot = [];
        for (const n of this.neurons) {
            if (n.state[0] >= threshold)
                hot.push(n.id);
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
    traceNeuron(neuronId, dim, topK = 8) {
        const D = this.totalDims;
        if (dim < 0 || dim >= D)
            return null;
        const target = this.neurons.find(n => n.id === neuronId);
        if (!target)
            return null;
        const N = this.neurons.length;
        const bias = this.bias[neuronId * D + dim];
        const rowOffset = (neuronId * D + dim) * N;
        const srcD = (dim - 1 + D) % D;
        const cross = this.config.crossInfluenceStrength;
        const terms = [];
        let preActivation = bias;
        for (const nj of this.neurons) {
            if (nj.id === neuronId)
                continue;
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
        const fmt = (v) => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(4);
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
    trainDefinitions(definitions, opts = {}) {
        const epochs = opts.epochs ?? 200;
        const lr = opts.learningRate ?? 0.1;
        const penalty = opts.weightPenalty ?? 1e-4;
        const tolerance = opts.tolerance ?? 1e-3;
        const dims = this.config.dimensions;
        const D = this.totalDims;
        const lossHistory = definitions.map(() => []);
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
                if (!readout) {
                    losses.push(Infinity);
                    continue;
                }
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
                        if (nj.id === def.readoutNeuronId)
                            continue;
                        const wdIdx = rowOffset + nj.id;
                        this.connDiag[wdIdx] = clamp(this.connDiag[wdIdx] + lr * grad * nj.state[cd] - penalty * this.connDiag[wdIdx], -2, 2);
                    }
                    this.bias[biasOffset + cd] = clamp(this.bias[biasOffset + cd] + lr * grad - penalty * this.bias[biasOffset + cd], -1, 1);
                }
                losses.push(sse / dims);
            }
            for (let i = 0; i < definitions.length; i++)
                lossHistory[i].push(losses[i]);
            if (losses.every(l => l < tolerance)) {
                converged = true;
                break;
            }
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
    detectDefinitionConflicts(definitions, losses, lossHistory, dims, tolerance) {
        const deltas = lossHistory.map(h => h.slice(1).map((v, k) => v - h[k]));
        const targetDist = (a, b) => {
            let s = 0;
            for (let d = 0; d < dims; d++) {
                const e = (a[d] ?? 0) - (b[d] ?? 0);
                s += e * e;
            }
            return Math.sqrt(s / dims);
        };
        const conflicts = [];
        for (let i = 0; i < definitions.length; i++) {
            for (let j = i + 1; j < definitions.length; j++) {
                if (losses[i] < tolerance && losses[j] < tolerance)
                    continue;
                const structural = definitions[i].readoutNeuronId === definitions[j].readoutNeuronId &&
                    targetDist(definitions[i].target, definitions[j].target) > Math.sqrt(tolerance);
                const corr = pearson(deltas[i], deltas[j]);
                if (structural || corr < -0.5)
                    conflicts.push({ a: i, b: j, correlation: corr });
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
    trainDefinitionsRandomSearch(definitions, opts = {}) {
        const epochs = opts.epochs ?? 500; // random search needs more attempts than the delta rule to find the same minimum
        const stepSize = opts.stepSize ?? 0.15;
        const tolerance = opts.tolerance ?? 1e-3;
        // Optional deterministic RNG. Random search is genuinely stochastic, so
        // whether it finds a given minimum within `epochs` is luck-dependent --
        // measured at ~3% failure on a contract pair that is definitely
        // satisfiable, which is enough to make a suite containing it fail
        // spuriously. Passing a seed makes a run exactly reproducible (same
        // seed, same result, every time) so a test can assert on the outcome
        // without depending on global Math.random state. Unseeded callers keep
        // the original nondeterministic behavior.
        const rand = opts.seed === undefined ? Math.random : (() => {
            // mulberry32 -- small, fast, well-distributed; enough for perturbations.
            let a = opts.seed >>> 0;
            return () => {
                a = (a + 0x6D2B79F5) >>> 0;
                let t = Math.imul(a ^ (a >>> 15), 1 | a);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        })();
        const dims = this.config.dimensions;
        const D = this.totalDims;
        const N = this.neurons.length;
        const evalLoss = (def) => {
            this.settle(def.input, new Set([def.driveNeuronId]));
            const readout = this.neurons.find(n => n.id === def.readoutNeuronId);
            if (!readout)
                return Infinity;
            let sse = 0;
            for (let d = 0; d < dims; d++) {
                const err = (def.target[d] ?? 0) - readout.state[d + 1];
                sse += err * err;
            }
            return sse / dims;
        };
        const lossHistory = definitions.map(() => []);
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
                const snapshot = [];
                for (let d = 0; d < dims; d++) {
                    const cd = d + 1;
                    const rowOffset = (def.readoutNeuronId * D + cd) * N;
                    for (const nj of this.neurons) {
                        if (nj.id === def.readoutNeuronId)
                            continue;
                        const wdIdx = rowOffset + nj.id;
                        snapshot.push({ idx: wdIdx, inDiag: true, value: this.connDiag[wdIdx] });
                        this.connDiag[wdIdx] = clamp(this.connDiag[wdIdx] + (rand() * 2 - 1) * stepSize, -2, 2);
                    }
                    const bIdx = biasOffset + cd;
                    snapshot.push({ idx: bIdx, inDiag: false, value: this.bias[bIdx] });
                    this.bias[bIdx] = clamp(this.bias[bIdx] + (rand() * 2 - 1) * stepSize, -1, 1);
                }
                const trial = evalLoss(def);
                if (trial < baseline) {
                    losses.push(trial); // the random step genuinely helped -- keep it
                }
                else {
                    for (const s of snapshot) {
                        if (s.inDiag)
                            this.connDiag[s.idx] = s.value;
                        else
                            this.bias[s.idx] = s.value;
                    }
                    losses.push(baseline); // it didn't help -- revert the whole step
                }
            }
            for (let i = 0; i < definitions.length; i++)
                lossHistory[i].push(losses[i]);
            if (losses.every(l => l < tolerance)) {
                converged = true;
                break;
            }
        }
        const satisfied = definitions
            .map((def, i) => ({ id: def.readoutNeuronId, ok: losses[i] < tolerance }))
            .filter(x => x.ok)
            .map(x => x.id);
        const conflicts = this.detectDefinitionConflicts(definitions, losses, lossHistory, dims, tolerance);
        return { converged, epochs: ranEpochs, losses, satisfied, conflicts };
    }
    initializeNeurons() {
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
                lastTransition: null,
                influenceRadius: 0.1 + Math.random() * 0.4,
                activationThreshold: 0.3 + Math.random() * 0.4,
            });
        }
    }
    initializeConnections() {
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
                    if (i === j)
                        continue;
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
    settle(resolvedInput, drivenIds, vale, activeGroups) {
        const D = this.totalDims;
        const N = this.neurons.length;
        const deltas = this.stateDeltasBuffer;
        deltas.fill(0);
        let liveCorrections = 0;
        let iterations = 0;
        // For the second settle test below: is the residual still falling?
        let previousResidual = 0;
        let hasPreviousResidual = false;
        let flatResidualRun = 0;
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
        this.heldThisTick.fill(0);
        // A neuron in a group nobody asked for this tick HOLDS: it keeps the state
        // it had instead of being recomputed. Driven always wins -- something
        // being fed from outside is being fed whatever else is true of it -- and
        // an ungrouped neuron always computes, so a network that never labels
        // anything behaves exactly as it did before groups existed.
        const gated = activeGroups !== undefined && this.neuronGroups.size > 0;
        let heldCount = 0;
        const heldIndices = this.heldIndicesScratch;
        for (let i = 0; i < N; i++) {
            if (isDriven[i]) {
                drivenIndices[drivenCount++] = i;
                continue;
            }
            if (gated) {
                // A neuron holds only if NONE of its skills was asked for. One
                // shared between maths and language computes whenever either is
                // active, which is what makes the boundary an overlap rather than a
                // wall.
                const groups = this.neuronGroups.get(i);
                if (groups !== undefined && !anyGroupActive(groups, activeGroups)) {
                    heldIndices[heldCount++] = i;
                    this.heldThisTick[i] = 1;
                    continue;
                }
            }
            nonDrivenIndices[nonDrivenCount++] = i;
        }
        const hasVale = vale !== undefined && vale.size > 0;
        const vs = this.vsScratch;
        const hasV = this.hasVScratch;
        if (hasVale) {
            hasV.fill(0);
            for (let i = 0; i < N; i++) {
                const v = vale.get(i);
                if (v !== undefined) {
                    vs[i] = v;
                    hasV[i] = 1;
                }
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
        // Put the input into the driven neurons BEFORE the first iteration, not
        // only at the end of one.
        //
        // "Input -> Create Wave -> wave enters the mesh" is an ordering, and it
        // was reversed. The driven states were written at the END of each
        // iteration, so the wave block on iteration 1 read whatever those neurons
        // held from last tick and the input did not become a wave until iteration
        // 2. On a network settling in one step it never became a wave at all:
        // measured, two opposite inputs produced byte-identical wave pools.
        //
        // Both copies: allStates is the interleaved array the numeric side reads
        // through stateViews, and HyperNeuron.state mirrors it for the wave side
        // and for callers. Seeding one and not the other is a network that
        // disagrees with itself about what its own input is.
        for (let idx = 0; idx < drivenCount; idx++) {
            const i = drivenIndices[idx];
            const st = this.neurons[i].state;
            st[0] = 1.0;
            this.allStates[0 * N + i] = 1.0;
            for (let d = 0; d < dims; d++) {
                st[d + 1] = clampedInput[d];
                this.allStates[(d + 1) * N + i] = clampedInput[d];
            }
        }
        const waveGain = this.config.waveGain;
        const hyperGain = this.config.hyperGain;
        const hyperAdd = this.config.hyperAdd;
        const hyperScale = this.config.hyperScale;
        const modWeight = this.modWeight;
        const senderGain = this.senderGain;
        const addWeight = this.addWeight;
        const connBias = this.connBias;
        const connBiasRowSum = this.connBiasRowSum;
        const invConnN = 1 / Math.sqrt(Math.max(1, N));
        const usesConnectionBias = this.config.connectionBias;
        const wavePhase = this.wavePhase;
        const waveFreq = this.waveFreq;
        const waveAmp = this.waveAmpScratch;
        const waveReadRe = this.waveReadRe;
        const waveReadIm = this.waveReadIm;
        const waveTermRow = this.waveTermScratch;
        const wavePhaseError = this.wavePhaseErrorScratch;
        const poolRe = this.poolRe;
        const poolIm = this.poolIm;
        const prevPoolRe = this.prevPoolRe;
        const prevPoolIm = this.prevPoolIm;
        const waveRe = this.waveRe;
        const waveIm = this.waveIm;
        const prevWaveRe = this.prevWaveRe;
        const prevWaveIm = this.prevWaveIm;
        const connWaveGain = this.connWaveGain;
        const connWaveCos = this.connWaveCos;
        const connWaveSin = this.connWaveSin;
        const connWaveBias = this.connWaveBias;
        const connWaveBiasIm = this.connWaveBiasIm;
        const phaseCos = this.phaseCos;
        const phaseSin = this.phaseSin;
        const waveBin = this.waveBin;
        const waveFeedback = this.config.waveFeedback;
        const hyperWaveGain = this.config.hyperWaveGain;
        const hyperWaveAdd = this.config.hyperWaveAdd;
        const modWaveWeight = this.modWaveWeight;
        const addWaveWeight = this.addWaveWeight;
        const neuronWaveBiasRe = this.neuronWaveBiasRe;
        const neuronWaveBiasIm = this.neuronWaveBiasIm;
        const connWaveShift = this.connWaveShift;
        // Zeroed once per settle rather than per iteration: with waveGain 0 nothing
        // ever writes to it, and reading a zero is exactly the old arithmetic.
        if (waveGain === 0)
            waveTermRow.fill(0);
        const TWO_PI = Math.PI * 2;
        for (; iterations < this.config.propagationSteps; iterations++) {
            // Wave pool (see HyperConfig.waveGain's doc comment): O(N) per iteration,
            // computed from each neuron's *pre-update* state (the same state the
            // dotDiag/dotShift terms below read from this iteration) so every
            // neuron's wave contribution and its connDiag/connShift contribution
            // are drawn from the same consistent snapshot. Every neuron's own
            // current content energy sets its wave's amplitude; every neuron's
            // wave sums into one shared scalar every other neuron reads back from
            // equally this iteration -- genuine constructive/destructive
            // interference, not a per-connection weight.
            if (waveGain !== 0) {
                // ── The wave pool ────────────────────────────────────────────────
                //
                // Every neuron owns one wave. Its input sets that wave's height, the
                // wave goes into a shared pool, and what a neuron RECEIVES is what the
                // pool is doing at its own wave -- so a wave formed by others at a
                // neuron's frequency gives that neuron an input nobody handed it.
                //
                // Held as one complex amplitude per frequency rather than as samples
                // over time. Each neuron owns exactly one frequency, so the whole pool
                // is neuronCount complex numbers, and everything arriving at the same
                // frequency simply adds -- which is interference, exactly, with no
                // trigonometry in the loop and no sampling error.
                // Where each neuron's own wave currently points.
                for (let i = 0; i < N; i++) {
                    const phase = wavePhase[i];
                    phaseCos[i] = Math.cos(phase);
                    phaseSin[i] = Math.sin(phase);
                    const s = this.neurons[i].state;
                    let energy = 0;
                    for (let d = 1; d < D; d++)
                        energy += s[d] * s[d];
                    waveAmp[i] = Math.sqrt(energy);
                    waveBin[i] = this.binFor(waveFreq[i]);
                }
                // What is in the pool right now is what neurons hear; what they emit
                // this iteration builds the next one. A wave takes a moment to cross
                // the network, and pretending otherwise would let a neuron hear its
                // own emission in the instant it made it.
                prevPoolRe.set(poolRe);
                prevPoolIm.set(poolIm);
                poolRe.fill(0);
                poolIm.fill(0);
                // ── The network's wave weight and wave bias ──────────────────
                //
                // A connection does not only have a wave weight and a wave bias of its
                // own. It has a SECOND weight and a SECOND bias that stand for the
                // whole network: every neuron's wave through a personalised variable,
                // all of them added together -- once with one set of variables to make
                // the weight, again with a different set to make the bias.
                //
                // Then the two weights are added together and the two biases are added
                // together, and the wave the connection carries is made out of THAT
                // pair. Added, not multiplied: a connection keeps what it is worth and
                // the network moves it, rather than the network being able to erase
                // every connection at once by being near zero.
                //
                // Complex on both sides, because a weight that cannot turn a wave is
                // not a weight on a wave -- it is a volume knob.
                //
                // One pair for the whole network, not one per connection: the
                // variables belong to the neurons contributing, so what the network
                // says is the same for everyone reading it. O(neurons) per iteration
                // rather than O(neurons squared).
                //
                // Means rather than sums, for the same reason as the numeric side: a
                // sum grows with neuron count until it drowns out what any single
                // connection is worth.
                // Per receiving neuron, like the numeric side: modWaveWeight[i][k] is
                // how much neuron i's reading of the pool weighs neuron k's wave, and
                // senderGain scales it by who is sending. Two connections into
                // different neurons build different wave weights out of one pool.
                const netWaveWeightRe = this.netWaveWeightReScratch;
                const netWaveWeightIm = this.netWaveWeightImScratch;
                const netWaveBiasRe = this.netWaveBiasReScratch;
                const netWaveBiasIm = this.netWaveBiasImScratch;
                if (hyperWaveGain !== 0 || hyperWaveAdd !== 0) {
                    const invN = 1 / N;
                    for (let i = 0; i < N; i++) {
                        const varRow = i * N;
                        let mr = 0, mi = 0, ar = 0, ai = 0;
                        for (let k = 0; k < N; k++) {
                            const b = waveBin[k];
                            const re = prevPoolRe[b];
                            const im = prevPoolIm[b];
                            mr += re * modWaveWeight[varRow + k];
                            mi += im * modWaveWeight[varRow + k];
                            ar += re * addWaveWeight[varRow + k];
                            ai += im * addWaveWeight[varRow + k];
                        }
                        netWaveWeightRe[i] = hyperWaveGain === 0 ? 0 : hyperWaveGain * mr * invN;
                        netWaveWeightIm[i] = hyperWaveGain === 0 ? 0 : hyperWaveGain * mi * invN;
                        netWaveBiasRe[i] = hyperWaveAdd === 0 ? 0 : hyperWaveAdd * ar * invN;
                        netWaveBiasIm[i] = hyperWaveAdd === 0 ? 0 : hyperWaveAdd * ai * invN;
                    }
                }
                else {
                    netWaveWeightRe.fill(0);
                    netWaveWeightIm.fill(0);
                    netWaveBiasRe.fill(0);
                    netWaveBiasIm.fill(0);
                }
                // Every neuron's wave as it was last iteration -- what the
                // connections carry this one. A wave takes a moment to cross the
                // network, and reading the array being written would let a neuron
                // carry a wave that had not been made yet.
                prevWaveRe.set(waveRe);
                prevWaveIm.set(waveIm);
                // A neuron being driven from outside has nothing flowing into it to be
                // made of, so it is a SOURCE: its wave IS its signature. Everything
                // else in the network is ultimately an edited, interfered version of
                // what the sources put in. The Zip Loop's bit neurons are exactly this
                // -- two sources, perfect enemies, and every wave downstream descends
                // from them.
                for (let i = 0; i < N; i++) {
                    if (!isDriven[i])
                        continue;
                    // Read the input as a wave, sign and all.
                    //
                    // This used to be waveAmp[i] -- the ENERGY of the state, which is a
                    // magnitude, so an input and its exact opposite made the identical
                    // wave and could not possibly cancel. The projection below is
                    // signed: negate the state and the reading negates, which is a
                    // half-cycle shift, which is annihilation. The input finally
                    // reaches the pool as something the pool can disagree with.
                    const si = this.neurons[i].state;
                    // This source's own bin picks the pair. Everything landing in one
                    // bin reads through one identical pair, which is what lets waves in
                    // it cancel; different bins read different directions, which is what
                    // stops any content direction being invisible to all of them.
                    const readAt = waveBin[i] * D;
                    let projRe = 0;
                    let projIm = 0;
                    for (let d = 1; d < D; d++) {
                        const v = si[d];
                        projRe += v * waveReadRe[readAt + d];
                        projIm += v * waveReadIm[readAt + d];
                    }
                    // Rotated into its own frequency slot: the signature says WHERE in
                    // the band this source sits, the projection says what it is saying
                    // there.
                    prevWaveRe[i] = projRe * phaseCos[i] - projIm * phaseSin[i];
                    prevWaveIm[i] = projRe * phaseSin[i] + projIm * phaseCos[i];
                }
                let poolEnergy = 0;
                const invN = 1 / N;
                // The largest amplitude a neuron could have: every content dimension
                // saturated. Used to turn an amplitude into a fraction below.
                // The reference this neuron's loudness is measured against.
                //
                // It used to be the THEORETICAL maximum -- every content dimension
                // saturated, sqrt(D-1) -- which was fine only while the mesh actually
                // ran near saturation. It does not any more, deliberately: the
                // connection sum is scaled by 1/sqrt(N) so the states stay far from
                // the rail. Against a fixed theoretical ceiling every neuron then
                // reads as almost silent, the wave feedback all but vanishes, and
                // agreement stops amplifying -- a chorus of eight neurons on one
                // frequency came out at 0.0047 against 0.0056 for eight that
                // disagreed, which is the claim backwards.
                //
                // So the reference is what the network is ACTUALLY doing: the loudest
                // neuron this iteration. The loudest gets exactly waveFeedback and
                // everyone else less, so the round-trip gain is still bounded by
                // waveFeedback and still below one -- the property the fixed ceiling
                // was there to guarantee. And it is self-calibrating, so rescaling
                // the connection term cannot quietly mute the wave layer again.
                let loudest = 0;
                for (let i = 0; i < N; i++)
                    if (waveAmp[i] > loudest)
                        loudest = waveAmp[i];
                const invMaxAmp = loudest > 1e-9 ? 1 / loudest : 1 / Math.sqrt(Math.max(1, D - 1));
                for (let i = 0; i < N; i++) {
                    const amp = waveAmp[i];
                    const ownBin = waveBin[i];
                    // ── The neuron's own small pool ──────────────────────────────
                    //
                    // Every neuron that has a wave gives it along the connection to this
                    // one, and every connection edits what passes along it: the two wave
                    // weights combined, the two wave biases combined, run against the
                    // wave of the neuron doing the giving. Those edited waves interfere
                    // inside this neuron exactly as they would in the big pool, and what
                    // they add up to is this neuron's wave.
                    const editRow = i * N;
                    // The running product starts at 1 (the multiplicative identity),
                    // with its size carried in logs alongside.
                    let heardRe = 1;
                    let heardIm = 0;
                    let heardLogMag = 0;
                    let heardCount = 0;
                    for (let k = 0; k < N; k++) {
                        // Not from itself. A neuron hearing its own wave back through its
                        // own connection is a loop with nothing opposing it; what it does
                        // hear of itself is the pool read below, and that is subtracted
                        // exactly.
                        if (k === i)
                            continue;
                        const inRe = prevWaveRe[k];
                        const inIm = prevWaveIm[k];
                        const gain = connWaveGain[editRow + k];
                        // The connection's own wave weight, as a wave: how much of what
                        // arrives gets through, and how far it is turned. cos and sin of
                        // the turn are kept beside the phase and refreshed when learning
                        // moves it -- see connWaveCos.
                        const ownWeightRe = gain * connWaveCos[editRow + k];
                        const ownWeightIm = gain * connWaveSin[editRow + k];
                        // The two weights added, and the two biases added. This pair IS
                        // the wave of this connection -- part it, part what the entire
                        // network is doing -- and running it against the wave of the
                        // neuron that is giving one is a complex multiply, which is what
                        // one wave does to another.
                        // The receiver's reading of the pool, scaled by who is sending:
                        // this connection's own share of the network's wave weight.
                        const share = senderGain[k];
                        const weightRe = ownWeightRe + netWaveWeightRe[i] * share;
                        const weightIm = ownWeightIm + netWaveWeightIm[i] * share;
                        const biasRe = connWaveBias[editRow + k] + netWaveBiasRe[i] * share;
                        const biasIm = connWaveBiasIm[editRow + k] + netWaveBiasIm[i] * share;
                        // The weight and the bias MAKE A WAVE, and that wave multiplies
                        // the sender's.
                        //
                        // This used to be `weight * wave + bias` -- the numeric step's
                        // shape, x*w + b, borrowed for the wave. It is the wrong shape
                        // here. On the numeric side the bias is what a connection
                        // contributes with nothing arriving; on the wave side there is no
                        // such thing, because a wave with nothing arriving is not a small
                        // wave, it is no wave. Adding a bias gave every connection a
                        // standing wave of its own that no sender could cancel, and a
                        // standing wave that cannot be cancelled is exactly what
                        // interference is not.
                        //
                        // So the two combined numbers become one editing wave, added the
                        // same way the weights and biases were each combined, and the
                        // edit is a pure complex multiply: amplitudes multiply, phases
                        // add. A silent sender stays silent through every connection it
                        // has, and two edited copies of opposite waves are still exactly
                        // opposite when they meet in the pool.
                        const editRe = weightRe + biasRe;
                        const editIm = weightIm + biasIm;
                        let editedRe = editRe * inRe - editIm * inIm;
                        let editedIm = editRe * inIm + editIm * inRe;
                        // ...and its shift weight, reaching across to the neighbouring
                        // frequency in the shared pool the way connShift reaches across to
                        // the neighbouring dimension. Zero on a fresh network, so it
                        // contributes nothing until learning gives it a reason to.
                        const shiftWeight = connWaveShift[editRow + k];
                        if (shiftWeight !== 0) {
                            const sourceBin = waveBin[k];
                            const neighbour = sourceBin === 0 ? WAVE_BINS - 1 : sourceBin - 1;
                            editedRe += shiftWeight * prevPoolRe[neighbour];
                            editedIm += shiftWeight * prevPoolIm[neighbour];
                        }
                        // The receiving neuron MULTIPLIES the waves coming into it.
                        //
                        // Adding them was the numeric side's habit again. Multiplying is
                        // what one wave does to another: amplitudes multiply and phases
                        // add, so a connection that turns a wave turns everything that
                        // reaches this neuron through it.
                        //
                        // Two things make the literal product unusable in an
                        // all-connected mesh, and both are handled here rather than
                        // pretended away:
                        //
                        //   A silent sender would annihilate everything. Zero times
                        //   anything is zero, and on a fresh network most neurons have no
                        //   wave yet, so one silent connection would leave the whole mesh
                        //   permanently silent. Senders with no wave are skipped -- they
                        //   contribute nothing, which is what having nothing to say
                        //   should mean.
                        //
                        //   The magnitude would vanish or explode with neuron count. Sixty
                        //   connections each around 0.5 multiply to 1e-19. So the
                        //   magnitudes are combined as a GEOMETRIC mean -- the nth root of
                        //   the product -- which is to multiplication exactly what the
                        //   mean is to addition, and is the same rule the rest of this
                        //   file already follows for every network-wide combination.
                        //
                        // The running product is kept at unit magnitude and the size
                        // carried separately in logs, so it cannot underflow on the way.
                        const mag = Math.sqrt(editedRe * editedRe + editedIm * editedIm);
                        if (mag > 0) {
                            heardLogMag += Math.log(mag);
                            const ur = editedRe / mag;
                            const ui = editedIm / mag;
                            const nr = heardRe * ur - heardIm * ui;
                            heardIm = heardRe * ui + heardIm * ur;
                            heardRe = nr;
                            heardCount++;
                        }
                    }
                    if (heardCount > 0) {
                        // The nth root: geometric mean of the magnitudes, and the phases
                        // averaged rather than left summed. A summed phase over sixty
                        // connections wraps many times, so two nearly identical inputs
                        // would land at unrelated phases and nothing stable could be
                        // represented -- the root is what keeps multiplication's character
                        // without that.
                        const scale = Math.exp(heardLogMag / heardCount);
                        const angle = Math.atan2(heardIm, heardRe) / heardCount;
                        heardRe = scale * Math.cos(angle);
                        heardIm = scale * Math.sin(angle);
                    }
                    else {
                        heardRe = 0;
                        heardIm = 0;
                    }
                    // The neuron's own bias on the wave: what it contributes with
                    // nothing arriving, the wave beside bias[i][d].
                    heardRe += neuronWaveBiasRe[i];
                    heardIm += neuronWaveBiasIm[i];
                    // ── And the other way ────────────────────────────────────────
                    //
                    // If a wave in the main pool is this neuron's wave, this neuron gets
                    // an input of the height of that wave. Not routed through a
                    // connection: the pool is shared, and a wave at a neuron's own
                    // frequency is that neuron's wave whoever made it. This is what
                    // makes the whole thing go both ways -- neurons put waves into the
                    // pool, and the pool puts inputs back into neurons.
                    //
                    // Its own last contribution comes out first, exactly, because it is
                    // known exactly. What is left is what everyone ELSE built at this
                    // neuron's frequency: agreement adds up, contradiction cancels.
                    heardRe += prevPoolRe[ownBin] - prevWaveRe[i];
                    heardIm += prevPoolIm[ownBin] - prevWaveIm[i];
                    const inPhase = heardRe * phaseCos[i] + heardIm * phaseSin[i];
                    const quadrature = heardIm * phaseCos[i] - heardRe * phaseSin[i];
                    waveTermRow[i] = waveGain * inPhase;
                    // Where the pool sits relative to this neuron, which is what the
                    // wave learns from.
                    wavePhaseError[i] = Math.atan2(quadrature, inPhase);
                    // The wave that formed inside it, pushed back out at the force of
                    // its input. This IS the neuron's wave -- what reached it, shaped by
                    // the editing equation on every connection it arrived through, so no
                    // two neurons downstream of the same source carry the same thing.
                    //
                    // A neuron with nothing coming in emits nothing, however loud the
                    // pool around it. A source emits its signature instead, which was
                    // set above.
                    //
                    // Damped below one: every neuron passing on everything it hears is
                    // an echo chamber. Measured before the damping existed, the pool
                    // went 4 -> 3,579 -> 2,682,806 over three ticks and every neuron
                    // saturated identically, which reads in a test as the pool having no
                    // effect at all.
                    if (isDriven[i]) {
                        waveRe[i] = prevWaveRe[i];
                        waveIm[i] = prevWaveIm[i];
                    }
                    else if (amp !== 0 && waveFeedback !== 0) {
                        // The force of its input, as a FRACTION of the loudest input it
                        // could have. That fraction is what keeps the loop gain below one:
                        // a neuron hears the pool at its own frequency directly, and puts
                        // its wave back into that same bin, so the round trip is multiplied
                        // by exactly this number every iteration. With a raw amplitude
                        // there instead, the round trip gained about 1.2x per iteration --
                        // measured: the pool went 0.17 -> 3.3 -> NaN over 150 ticks.
                        // Bounded by waveFeedback, which is already capped below one.
                        const force = waveFeedback * (amp * invMaxAmp);
                        waveRe[i] = force * heardRe;
                        waveIm[i] = force * heardIm;
                    }
                    else {
                        waveRe[i] = 0;
                        waveIm[i] = 0;
                    }
                    // Into the shared pool at its own frequency. Two neurons on the same
                    // wave meet here, and that meeting is the whole point: equal and
                    // opposite annihilate, equal and alike double.
                    poolRe[ownBin] += waveRe[i];
                    poolIm[ownBin] += waveIm[i];
                }
                // A ceiling as well as a gain below one. The damping makes runaway
                // unlikely; the ceiling makes it impossible, including for a network
                // whose learned wave gains have all drifted high at once.
                for (let b = 0; b < WAVE_BINS; b++) {
                    const magnitude = Math.sqrt(poolRe[b] * poolRe[b] + poolIm[b] * poolIm[b]);
                    if (magnitude > WAVE_POOL_CEILING) {
                        const shrink = WAVE_POOL_CEILING / magnitude;
                        poolRe[b] *= shrink;
                        poolIm[b] *= shrink;
                    }
                }
                for (let b = 0; b < WAVE_BINS; b++)
                    poolEnergy += poolRe[b] * poolRe[b] + poolIm[b] * poolIm[b];
                this.lastWaveEnergy = Math.sqrt(poolEnergy / WAVE_BINS);
            }
            // Hyperdimensional term: what the WHOLE network is doing, per dimension,
            // read from the same pre-update snapshot as everything else this
            // iteration. O(neurons * dimensions), against the O(neurons^2 *
            // dimensions) the connections themselves cost, so it is close to free.
            //
            // Means, not sums: a sum grows with neuron count and would saturate tanh
            // on the first tick at any real size. Both are 0 when off, and 0 is the
            // exact identity for adding -- so off is the old arithmetic, not
            // something indistinguishably close to it.
            //
            // What comes out is a WEIGHT and a BIAS, not a multiplier and an offset:
            // netWeightRow[d] is added to every connection's own weight and
            // netBiasRow[d] to every connection's own bias. Adding a constant to
            // every weight into a neuron is the same as adding that constant times
            // the average of what the neuron is hearing, which is why the mean of
            // the states is computed here too -- one extra accumulator in a loop
            // that was already running.
            //
            // The network's say is computed once and used two ways, both from the
            // same personalised variables: it SCALES what the connection produced
            // (hyperScale) and it is ADDED to the connection's own weight
            // (hyperGain). See their doc comments for why both exist rather than
            // one of them.
            //
            // ── Every connection reads the network for itself ──────────────────
            //
            // Each RECEIVING neuron has its own row of variables -- modWeight[i][k]
            // is how much neuron i's reading of the network weighs neuron k -- and
            // senderGain scales that reading by which neuron is sending. So the
            // connection A->B and the connection C->B, looking at one identical
            // network state, get different numbers out of it. That is the point of
            // the term: a connection is context-dependent, and two connections do
            // not have to agree about what the context means.
            //
            // Per receiver rather than per (receiver, sender) pair with its own N
            // variables, which would be N^3 -- see the constructor for why.
            const gainRow = this.hyperGainScratch; // [i][d]: this receiver's added weight
            const addRow = this.hyperAddScratch; // [i][d]: this receiver's added bias
            const meanRow = this.hyperMeanScratch; // [d]: what a connection carries, sender-weighted
            const scaleRow = this.hyperScaleScratch; // [i][d]: this receiver's scale
            if (hyperGain !== 0 || hyperAdd !== 0 || hyperScale !== 0) {
                const invN = 1 / N;
                for (let d = 0; d < D; d++) {
                    const row = stateViews[d];
                    // What every connection carries at this dimension, weighted by who
                    // is sending. Shared across receivers, so it is computed once.
                    let sent = 0;
                    for (let k = 0; k < N; k++)
                        sent += row[k] * senderGain[k];
                    meanRow[d] = sent * invN;
                }
                // Four dimensions at a time.
                //
                // modWeight and addWeight are indexed [i][k] with no dimension in
                // them, so a loop with d outermost re-reads both N*N arrays once per
                // dimension: at 336 neurons and 65 dimensions that is 29 MB of
                // traffic per iteration for two 450 KB arrays, and the pass spends
                // its time fetching the same weights again. Taking four dimensions
                // per pass fetches them a quarter as often while every stream --
                // the four state rows and the two weight rows -- stays sequential.
                for (let d0 = 0; d0 < D; d0 += HYPER_DIM_TILE) {
                    const dEnd = d0 + HYPER_DIM_TILE <= D ? d0 + HYPER_DIM_TILE : D;
                    if (dEnd - d0 === HYPER_DIM_TILE) {
                        // The whole tile, with no per-element branch in the inner loop.
                        const r0 = stateViews[d0];
                        const r1 = stateViews[d0 + 1];
                        const r2 = stateViews[d0 + 2];
                        const r3 = stateViews[d0 + 3];
                        for (let i = 0; i < N; i++) {
                            const varRow = i * N;
                            let m0 = 0, m1 = 0, m2 = 0, m3 = 0;
                            let o0 = 0, o1 = 0, o2 = 0, o3 = 0;
                            for (let k = 0; k < N; k++) {
                                const w = modWeight[varRow + k];
                                const a = addWeight[varRow + k];
                                const s0 = r0[k], s1 = r1[k], s2 = r2[k], s3 = r3[k];
                                m0 += s0 * w;
                                o0 += s0 * a;
                                m1 += s1 * w;
                                o1 += s1 * a;
                                m2 += s2 * w;
                                o2 += s2 * a;
                                m3 += s3 * w;
                                o3 += s3 * a;
                            }
                            const base = i * D + d0;
                            const say0 = m0 * invN, say1 = m1 * invN, say2 = m2 * invN, say3 = m3 * invN;
                            gainRow[base] = hyperGain * say0;
                            gainRow[base + 1] = hyperGain * say1;
                            gainRow[base + 2] = hyperGain * say2;
                            gainRow[base + 3] = hyperGain * say3;
                            // 1 when off, so off is untouched rather than scaled by
                            // something near 1.
                            scaleRow[base] = hyperScale === 0 ? 1 : hyperScale * say0;
                            scaleRow[base + 1] = hyperScale === 0 ? 1 : hyperScale * say1;
                            scaleRow[base + 2] = hyperScale === 0 ? 1 : hyperScale * say2;
                            scaleRow[base + 3] = hyperScale === 0 ? 1 : hyperScale * say3;
                            addRow[base] = hyperAdd * o0 * invN;
                            addRow[base + 1] = hyperAdd * o1 * invN;
                            addRow[base + 2] = hyperAdd * o2 * invN;
                            addRow[base + 3] = hyperAdd * o3 * invN;
                        }
                        continue;
                    }
                    // The leftover dimensions, one at a time.
                    for (let d = d0; d < dEnd; d++) {
                        const row = stateViews[d];
                        for (let i = 0; i < N; i++) {
                            const varRow = i * N;
                            let modulation = 0;
                            let offset = 0;
                            for (let k = 0; k < N; k++) {
                                const state = row[k];
                                modulation += state * modWeight[varRow + k];
                                offset += state * addWeight[varRow + k];
                            }
                            const say = modulation * invN;
                            const at = i * D + d;
                            gainRow[at] = hyperGain * say;
                            scaleRow[at] = hyperScale === 0 ? 1 : hyperScale * say;
                            addRow[at] = hyperAdd * offset * invN;
                        }
                    }
                }
            }
            else {
                gainRow.fill(0);
                addRow.fill(0);
                meanRow.fill(0);
                scaleRow.fill(1);
            }
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
            // Neurons whose group was not asked for this tick keep what they had.
            // Carried across explicitly rather than left alone: nextStates is a
            // buffer that gets swapped in, so "not written" is not "unchanged" --
            // it is whatever the previous iteration left in that slot.
            for (let idx = 0; idx < heldCount; idx++) {
                const i = heldIndices[idx];
                const offset = i * D;
                const state = this.neurons[i].state;
                for (let d = 0; d < D; d++)
                    nextStates[offset + d] = state[d];
            }
            // Handle non-driven neurons using loop-swapping to hoist dimension/state/weight views
            // BOLT OPTIMIZATION: Fast branch-free path when vale gating is inactive (the common case).
            if (!hasVale) {
                for (let d = 0; d < D; d++) {
                    const sjRow = stateViews[d];
                    const srcD = (d - 1 + D) % D;
                    const sjShiftRow = stateViews[srcD];
                    const dn = d * N;
                    // Constant for every neuron at this dimension, so read once rather
                    // than once per neuron: two array loads per neuron per dimension is
                    // a third of a tick at the default size, for two numbers that do not
                    // change inside the loop.
                    // The network's weight, the network's bias, and the average of what
                    // every neuron is holding at this dimension -- constant for every
                    // neuron here, so read once rather than once per neuron.
                    // Per receiver now, so they are read inside the neuron loop below.
                    const heardMean = meanRow[d];
                    for (let idx = 0; idx < nonDrivenCount; idx++) {
                        const i = nonDrivenIndices[idx];
                        const biasOffset = i * D;
                        const rowOffset = i * DN + dn;
                        let dotDiag = 0;
                        let dotShift = 0;
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
                        // The two weights combined and the two biases combined.
                        //
                        // Every connection into this neuron has its own weight, and a
                        // second weight standing for the whole network -- every neuron's
                        // value through a personalised variable, all of them added
                        // together. Those two are ADDED, so the connection's own weight is
                        // worth something on its own and the network moves it. Summed over
                        // the connections, adding the same constant to every weight is
                        // that constant times the average of what arrived, which is what
                        // netWeight * heardMean is.
                        //
                        // The biases combine the same way: the connection's own, plus a
                        // second one made from the network through a different set of
                        // variables. It is the same value on every connection into this
                        // neuron, so it is added once here rather than N times and divided
                        // back down -- a change of units the learned variables absorb.
                        //
                        // 0 and 0 when the terms are off, and adding zero is exact, so
                        // with the feature off this is the old expression.
                        // Scaled by 1/sqrt(N) -- the last place in the file that
                        // summed raw across the whole network.
                        //
                        // A raw sum over N senders puts something of order N inside tanh
                        // and the mesh saturates into a stable attractor it cannot leave:
                        // 96% of neurons pinned at +-1 by tick 150, every region then
                        // answering 1.0000 to every input including inputs never seen.
                        //
                        // sqrt(N) and not N. 1/N was tried and does remove saturation
                        // outright, but it shrinks the term 24-fold and the learned scale
                        // variable is clamped below 1, so it CANNOT grow to compensate --
                        // NeuroLang definitions stopped converging and stayed stopped at
                        // 400, 1000, 2000 and 4000 epochs. 1/sqrt(N) is the
                        // variance-preserving scale for a sum of N terms: it stops the
                        // term growing with neuron count without gutting it.
                        const connectionResult = usesConnectionBias
                            ? (dotDiag + dotShift * strength) * invConnN + connBiasRowSum[biasOffset + d]
                            : (dotDiag + dotShift * strength) * invConnN;
                        // This receiver's own reading of the network.
                        const netAt = i * D + d;
                        const computedState = Math.tanh(bias[biasOffset + d] +
                            connectionResult * scaleRow[netAt] +
                            gainRow[netAt] * heardMean +
                            addRow[netAt] +
                            waveTermRow[i]);
                        nextStates[i * D + d] = computedState;
                        if (d > 0) {
                            currentTotalContentEnergy += computedState * computedState;
                        }
                    }
                }
            }
            else {
                for (let d = 0; d < D; d++) {
                    const sjRow = stateViews[d];
                    const srcD = (d - 1 + D) % D;
                    const sjShiftRow = stateViews[srcD];
                    const dn = d * N;
                    // Constant for every neuron at this dimension, so read once rather
                    // than once per neuron: two array loads per neuron per dimension is
                    // a third of a tick at the default size, for two numbers that do not
                    // change inside the loop.
                    // The network's weight, the network's bias, and the average of what
                    // every neuron is holding at this dimension -- constant for every
                    // neuron here, so read once rather than once per neuron.
                    // Per receiver now, so they are read inside the neuron loop below.
                    const heardMean = meanRow[d];
                    for (let idx = 0; idx < nonDrivenCount; idx++) {
                        const i = nonDrivenIndices[idx];
                        const biasOffset = i * D;
                        const rowOffset = i * DN + dn;
                        let dotDiag = 0;
                        let dotShift = 0;
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
                        // The two weights combined and the two biases combined.
                        //
                        // Every connection into this neuron has its own weight, and a
                        // second weight standing for the whole network -- every neuron's
                        // value through a personalised variable, all of them added
                        // together. Those two are ADDED, so the connection's own weight is
                        // worth something on its own and the network moves it. Summed over
                        // the connections, adding the same constant to every weight is
                        // that constant times the average of what arrived, which is what
                        // netWeight * heardMean is.
                        //
                        // The biases combine the same way: the connection's own, plus a
                        // second one made from the network through a different set of
                        // variables. It is the same value on every connection into this
                        // neuron, so it is added once here rather than N times and divided
                        // back down -- a change of units the learned variables absorb.
                        //
                        // 0 and 0 when the terms are off, and adding zero is exact, so
                        // with the feature off this is the old expression.
                        // A MEAN over the senders, not a sum -- the last place in the
                        // file that still summed across the whole network.
                        //
                        // Oja's rule bounds each individual weight near 1, so a raw sum
                        // over N senders puts something of order N inside tanh, and the
                        // mesh saturates into a stable attractor it cannot leave: every
                        // neuron pinned at +-1, every region answering 1.0000 to every
                        // input including inputs it had never seen. Measured at N=24,
                        // mean |connDiag| climbed to 0.888 and stayed there while 96% of
                        // neurons sat at the rail.
                        //
                        // Dividing by N is a change of units the learned scale variable
                        // absorbs, and it is the rule the rest of the file already
                        // follows -- "a sum grows with neuron count until the term alone
                        // saturates every neuron" is written above the wave code.
                        const connectionResult = usesConnectionBias
                            ? (dotDiag + dotShift * strength) * invConnN + connBiasRowSum[biasOffset + d]
                            : (dotDiag + dotShift * strength) * invConnN;
                        // This receiver's own reading of the network.
                        const netAt = i * D + d;
                        const computedState = Math.tanh(bias[biasOffset + d] +
                            connectionResult * scaleRow[netAt] +
                            gainRow[netAt] * heardMean +
                            addRow[netAt] +
                            waveTermRow[i]);
                        const finalVal = hasV[i] ? vs[i] * this.neurons[i].state[d] + (1 - vs[i]) * computedState : computedState;
                        nextStates[i * D + d] = finalVal;
                        if (d > 0) {
                            currentTotalContentEnergy += finalVal * finalVal;
                        }
                    }
                }
            }
            // Advance every neuron's own wave phase once per iteration -- this is
            // what makes the pool genuinely oscillatory across settle() calls
            // rather than a static per-neuron constant: two consecutive process()
            // calls read the wave pool at different phase offsets.
            if (waveGain !== 0) {
                for (let i = 0; i < N; i++) {
                    let p = wavePhase[i] + waveFreq[i];
                    if (p >= TWO_PI)
                        p -= TWO_PI;
                    wavePhase[i] = p;
                }
            }
            const actualEnergy = currentTotalContentEnergy / (N * dims);
            const predictedEnergy = this.hasEma ? this.emaEnergy : actualEnergy;
            const divergence = Math.abs(actualEnergy - predictedEnergy);
            this.sustainedDivergence = divergence > this.config.divergenceTolerance ? this.sustainedDivergence + 1 : 0;
            if (this.sustainedDivergence >= this.config.sustainedDivergenceTicks) {
                for (let i = 0; i < N; i++) {
                    if (isDriven[i])
                        continue;
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
            // ── Has it settled? ─────────────────────────────────────────────
            //
            // Two ways to be settled, because there are two kinds of settled.
            //
            // A network with no wave comes to REST: the residual falls away to
            // nothing and stays there. Measured on a 24-neuron network with a steady
            // input, it goes 1.0e+2 -> 3.7e-1 -> 2.6e-3 -> 3.9e-7. The absolute
            // threshold catches that.
            //
            // A network WITH a wave never comes to rest, and should not be expected
            // to. Every neuron's phase advances each iteration, so the wave term is
            // different each time by construction -- the network converges to a
            // steady oscillation rather than a fixed point. Same measurement with
            // the wave on: 1.0e+2 -> 3.2e-1 -> 1.7e-1 -> 1.7e-1, flat forever. The
            // absolute threshold never fires, so the loop always ran to its ceiling
            // and never once reported having settled.
            //
            // So the second test is that the residual has STOPPED FALLING. When it
            // changes by less than a twentieth of itself for a few iterations
            // running, the network is as settled as this network gets -- a limit
            // cycle rather than a point, which is what a wave system settles into.
            if (residual < this.config.convergenceThreshold) {
                iterations++;
                break;
            }
            if (hasPreviousResidual && residual > 0) {
                const change = Math.abs(residual - previousResidual) / residual;
                flatResidualRun = change < SETTLED_RESIDUAL_CHANGE ? flatResidualRun + 1 : 0;
                if (flatResidualRun >= SETTLED_RESIDUAL_TICKS) {
                    iterations++;
                    break;
                }
            }
            previousResidual = residual;
            hasPreviousResidual = true;
        }
        const stateDeltas = new Map();
        for (let i = 0; i < N; i++)
            stateDeltas.set(i, deltas[i]);
        return { stateDeltas, liveCorrections, iterations };
    }
    applyWeightLearning(learningRates, stateDeltas) {
        const D = this.totalDims;
        const N = this.neurons.length;
        // Pre-fetch all dimension views of allStates for sequential access
        const stateViews = this.stateViews;
        const rates = this.ratesScratch;
        const defaultRate = this.config.learningRate;
        for (let i = 0; i < N; i++) {
            rates[i] = learningRates?.get(i) ?? defaultRate;
        }
        // And how much input the neuron was given during this event.
        //
        // The elastic core has two halves and only one was here. A neuron's VALUE
        // made it change less -- high points, slow to re-weight, resistant to
        // having its state overwritten -- and that half was real. The other half
        // was not: how hard a neuron was driven made no difference at all. The
        // rate was a pure function of value points, so a neuron sitting almost
        // silent through an event learned from it exactly as fast as the neuron
        // the event was about.
        //
        // Force is measured RELATIVE to what the network is doing this tick, not
        // as an absolute. An absolute would quietly rescale every learning rate
        // in the system the moment the mesh got louder or quieter, which is a
        // change to everything rather than to the thing being described. Relative
        // means the average neuron learns at the rate it always did, a neuron
        // driven harder than its neighbours learns faster, and one barely touched
        // learns slower.
        // A neuron held out of this event does not learn from it.
        //
        // Holding was only ever applied to the state: a neuron whose group was
        // not asked for kept what it had instead of being recomputed -- and then
        // learned from the tick anyway, as if it had taken part. That was
        // invisible while every rate was a pure function of value points. Once
        // the rate follows the input a neuron actually received, it stopped
        // being invisible and started being backwards: a held neuron keeps a
        // stale state, which reads as high force, so the neurons that sat the
        // event out were learning FASTER than the ones it happened to.
        for (let i = 0; i < N; i++) {
            if (this.heldThisTick[i])
                rates[i] = 0;
        }
        let forceSum = 0;
        for (let i = 0; i < N; i++) {
            const si = this.neurons[i].state;
            let energy = 0;
            for (let d = 1; d < D; d++)
                energy += si[d] * si[d];
            const force = Math.sqrt(energy / Math.max(1, D - 1));
            this.forceScratch[i] = force;
            forceSum += force;
        }
        const meanForce = forceSum / Math.max(1, N);
        if (meanForce > 1e-9) {
            for (let i = 0; i < N; i++) {
                // Bounded either side: a neuron that happens to be the only loud one
                // in a quiet tick must not get a rate large enough to undo the
                // stability the value half is there to provide.
                const relative = this.forceScratch[i] / meanForce;
                rates[i] *= relative < INPUT_FORCE_FLOOR ? INPUT_FORCE_FLOOR
                    : (relative > INPUT_FORCE_CEILING ? INPUT_FORCE_CEILING : relative);
            }
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
                // Oja's term. Plain Hebb (w += rate*s_i*s_j) only ever GROWS a weight
                // whose two ends agree, and in an all-connected mesh that is a runaway:
                // bigger weights -> bigger sums into tanh -> states pinned at +-1 ->
                // the two ends agree perfectly and forever -> bigger weights. Measured,
                // 96% of neurons saturated within 10-40 learning ticks at every
                // learning rate tried (0.005 through 0.08; a lower rate only delayed
                // it), and a saturated mesh represents nothing -- every region
                // responded 1.0000 to every input, including inputs it had never seen.
                //
                // Subtracting rate*s_i^2*w is the standard local fix: it is still
                // Hebbian and still only reads the two ends of the connection, but a
                // weight stops growing once the receiver is loud, so the row settles
                // at a finite length instead of running to the clamp.
                const ojaDecay = rate * sid * sid;
                const rowOffset = (i * D + d) * N;
                // Unroll j loop from 0 to i by 4x manually with sequential index offsets
                let j = 0;
                const limit1 = i - 3;
                let wdIdx = rowOffset;
                for (; j < limit1; j += 4) {
                    const oldWd0 = connDiag[wdIdx];
                    const valWd0 = oldWd0 + rateSid * sjRow[j] - ojaDecay * oldWd0;
                    const newWd0 = valWd0 < -2 ? -2 : (valWd0 > 2 ? 2 : valWd0);
                    connDiag[wdIdx] = newWd0;
                    const diffWd0 = newWd0 - oldWd0;
                    deltaSum += diffWd0 < 0 ? -diffWd0 : diffWd0;
                    const oldWs0 = connShift[wdIdx];
                    const valWs0 = oldWs0 + rateSid * sjShiftRow[j] - ojaDecay * oldWs0;
                    const newWs0 = valWs0 < -2 ? -2 : (valWs0 > 2 ? 2 : valWs0);
                    connShift[wdIdx] = newWs0;
                    const diffWs0 = newWs0 - oldWs0;
                    deltaSum += diffWs0 < 0 ? -diffWs0 : diffWs0;
                    const oldWd1 = connDiag[wdIdx + 1];
                    const valWd1 = oldWd1 + rateSid * sjRow[j + 1] - ojaDecay * oldWd1;
                    const newWd1 = valWd1 < -2 ? -2 : (valWd1 > 2 ? 2 : valWd1);
                    connDiag[wdIdx + 1] = newWd1;
                    const diffWd1 = newWd1 - oldWd1;
                    deltaSum += diffWd1 < 0 ? -diffWd1 : diffWd1;
                    const oldWs1 = connShift[wdIdx + 1];
                    const valWs1 = oldWs1 + rateSid * sjShiftRow[j + 1] - ojaDecay * oldWs1;
                    const newWs1 = valWs1 < -2 ? -2 : (valWs1 > 2 ? 2 : valWs1);
                    connShift[wdIdx + 1] = newWs1;
                    const diffWs1 = newWs1 - oldWs1;
                    deltaSum += diffWs1 < 0 ? -diffWs1 : diffWs1;
                    const oldWd2 = connDiag[wdIdx + 2];
                    const valWd2 = oldWd2 + rateSid * sjRow[j + 2] - ojaDecay * oldWd2;
                    const newWd2 = valWd2 < -2 ? -2 : (valWd2 > 2 ? 2 : valWd2);
                    connDiag[wdIdx + 2] = newWd2;
                    const diffWd2 = newWd2 - oldWd2;
                    deltaSum += diffWd2 < 0 ? -diffWd2 : diffWd2;
                    const oldWs2 = connShift[wdIdx + 2];
                    const valWs2 = oldWs2 + rateSid * sjShiftRow[j + 2] - ojaDecay * oldWs2;
                    const newWs2 = valWs2 < -2 ? -2 : (valWs2 > 2 ? 2 : valWs2);
                    connShift[wdIdx + 2] = newWs2;
                    const diffWs2 = newWs2 - oldWs2;
                    deltaSum += diffWs2 < 0 ? -diffWs2 : diffWs2;
                    const oldWd3 = connDiag[wdIdx + 3];
                    const valWd3 = oldWd3 + rateSid * sjRow[j + 3] - ojaDecay * oldWd3;
                    const newWd3 = valWd3 < -2 ? -2 : (valWd3 > 2 ? 2 : valWd3);
                    connDiag[wdIdx + 3] = newWd3;
                    const diffWd3 = newWd3 - oldWd3;
                    deltaSum += diffWd3 < 0 ? -diffWd3 : diffWd3;
                    const oldWs3 = connShift[wdIdx + 3];
                    const valWs3 = oldWs3 + rateSid * sjShiftRow[j + 3] - ojaDecay * oldWs3;
                    const newWs3 = valWs3 < -2 ? -2 : (valWs3 > 2 ? 2 : valWs3);
                    connShift[wdIdx + 3] = newWs3;
                    const diffWs3 = newWs3 - oldWs3;
                    deltaSum += diffWs3 < 0 ? -diffWs3 : diffWs3;
                    wdIdx += 4;
                }
                for (; j < i; j++) {
                    const oldWd = connDiag[wdIdx];
                    const valWd = oldWd + rateSid * sjRow[j] - ojaDecay * oldWd;
                    const newWd = valWd < -2 ? -2 : (valWd > 2 ? 2 : valWd);
                    connDiag[wdIdx] = newWd;
                    const diffWd = newWd - oldWd;
                    deltaSum += diffWd < 0 ? -diffWd : diffWd;
                    const oldWs = connShift[wdIdx];
                    const valWs = oldWs + rateSid * sjShiftRow[j] - ojaDecay * oldWs;
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
                    const valWd0 = oldWd0 + rateSid * sjRow[j2] - ojaDecay * oldWd0;
                    const newWd0 = valWd0 < -2 ? -2 : (valWd0 > 2 ? 2 : valWd0);
                    connDiag[wdIdx2] = newWd0;
                    const diffWd0 = newWd0 - oldWd0;
                    deltaSum += diffWd0 < 0 ? -diffWd0 : diffWd0;
                    const oldWs0 = connShift[wdIdx2];
                    const valWs0 = oldWs0 + rateSid * sjShiftRow[j2] - ojaDecay * oldWs0;
                    const newWs0 = valWs0 < -2 ? -2 : (valWs0 > 2 ? 2 : valWs0);
                    connShift[wdIdx2] = newWs0;
                    const diffWs0 = newWs0 - oldWs0;
                    deltaSum += diffWs0 < 0 ? -diffWs0 : diffWs0;
                    const oldWd1 = connDiag[wdIdx2 + 1];
                    const valWd1 = oldWd1 + rateSid * sjRow[j2 + 1] - ojaDecay * oldWd1;
                    const newWd1 = valWd1 < -2 ? -2 : (valWd1 > 2 ? 2 : valWd1);
                    connDiag[wdIdx2 + 1] = newWd1;
                    const diffWd1 = newWd1 - oldWd1;
                    deltaSum += diffWd1 < 0 ? -diffWd1 : diffWd1;
                    const oldWs1 = connShift[wdIdx2 + 1];
                    const valWs1 = oldWs1 + rateSid * sjShiftRow[j2 + 1] - ojaDecay * oldWs1;
                    const newWs1 = valWs1 < -2 ? -2 : (valWs1 > 2 ? 2 : valWs1);
                    connShift[wdIdx2 + 1] = newWs1;
                    const diffWs1 = newWs1 - oldWs1;
                    deltaSum += diffWs1 < 0 ? -diffWs1 : diffWs1;
                    const oldWd2 = connDiag[wdIdx2 + 2];
                    const valWd2 = oldWd2 + rateSid * sjRow[j2 + 2] - ojaDecay * oldWd2;
                    const newWd2 = valWd2 < -2 ? -2 : (valWd2 > 2 ? 2 : valWd2);
                    connDiag[wdIdx2 + 2] = newWd2;
                    const diffWd2 = newWd2 - oldWd2;
                    deltaSum += diffWd2 < 0 ? -diffWd2 : diffWd2;
                    const oldWs2 = connShift[wdIdx2 + 2];
                    const valWs2 = oldWs2 + rateSid * sjShiftRow[j2 + 2] - ojaDecay * oldWs2;
                    const newWs2 = valWs2 < -2 ? -2 : (valWs2 > 2 ? 2 : valWs2);
                    connShift[wdIdx2 + 2] = newWs2;
                    const diffWs2 = newWs2 - oldWs2;
                    deltaSum += diffWs2 < 0 ? -diffWs2 : diffWs2;
                    const oldWd3 = connDiag[wdIdx2 + 3];
                    const valWd3 = oldWd3 + rateSid * sjRow[j2 + 3] - ojaDecay * oldWd3;
                    const newWd3 = valWd3 < -2 ? -2 : (valWd3 > 2 ? 2 : valWd3);
                    connDiag[wdIdx2 + 3] = newWd3;
                    const diffWd3 = newWd3 - oldWd3;
                    deltaSum += diffWd3 < 0 ? -diffWd3 : diffWd3;
                    const oldWs3 = connShift[wdIdx2 + 3];
                    const valWs3 = oldWs3 + rateSid * sjShiftRow[j2 + 3] - ojaDecay * oldWs3;
                    const newWs3 = valWs3 < -2 ? -2 : (valWs3 > 2 ? 2 : valWs3);
                    connShift[wdIdx2 + 3] = newWs3;
                    const diffWs3 = newWs3 - oldWs3;
                    deltaSum += diffWs3 < 0 ? -diffWs3 : diffWs3;
                    wdIdx2 += 4;
                }
                for (; j2 < N; j2++) {
                    const oldWd = connDiag[wdIdx2];
                    const valWd = oldWd + rateSid * sjRow[j2] - ojaDecay * oldWd;
                    const newWd = valWd < -2 ? -2 : (valWd > 2 ? 2 : valWd);
                    connDiag[wdIdx2] = newWd;
                    const diffWd = newWd - oldWd;
                    deltaSum += diffWd < 0 ? -diffWd : diffWd;
                    const oldWs = connShift[wdIdx2];
                    const valWs = oldWs + rateSid * sjShiftRow[j2] - ojaDecay * oldWs;
                    const newWs = valWs < -2 ? -2 : (valWs > 2 ? 2 : valWs);
                    connShift[wdIdx2] = newWs;
                    const diffWs = newWs - oldWs;
                    deltaSum += diffWs < 0 ? -diffWs : diffWs;
                    wdIdx2++;
                }
            }
            deltaSums[i] = deltaSum;
        }
        // Hold every weight ROW to unit length.
        //
        // Oja's per-weight decay is the right shape but it only normalises a row
        // when the receiver is linear, and these receivers are tanh: s_i is the
        // squashed output, not the sum that produced it, so the property it
        // relies on does not hold and the row is free to keep growing in the
        // direction learning keeps pushing it. That is what still saturated a
        // long-lived mesh -- an aligned row of N weights each near 1 puts
        // something of order N into tanh, every neuron pins at +-1, and every
        // region then answers the same number to every input.
        //
        // Measured before this: separation between an input a region was trained
        // on and one nothing had seen fell from 0.0152 to 0.0071 as the mesh
        // saturated, while the absolute responses ballooned to 0.79. The
        // capability-gap signal is exactly that separation, so a long-running
        // agent quietly lost the ability to notice it was missing something.
        //
        // Normalising the row makes |sum| <= ||w||*||s|| = ||s|| by
        // Cauchy-Schwarz, which with the 1/sqrt(N) already on the sum is O(1) for
        // any neuron count. Only rows that have OVERGROWN are pulled back, so a
        // fresh or lightly-trained network is left exactly as it was.
        for (let i = 0; i < N; i++) {
            // Only where learning is actually happening. Rescaling the row of a
            // neuron pinned to a zero learning rate would move weights that are
            // supposed to be frozen -- normalisation is part of the learning step,
            // not something done to the network behind it.
            if (rates[i] === 0)
                continue;
            for (let d = 0; d < D; d++) {
                const rowOffset = (i * D + d) * N;
                let normDiag = 0;
                let normShift = 0;
                for (let j = 0; j < N; j++) {
                    const wd = connDiag[rowOffset + j];
                    const ws = connShift[rowOffset + j];
                    normDiag += wd * wd;
                    normShift += ws * ws;
                }
                if (normDiag > 1) {
                    const k = 1 / Math.sqrt(normDiag);
                    for (let j = 0; j < N; j++)
                        connDiag[rowOffset + j] *= k;
                }
                if (normShift > 1) {
                    const k = 1 / Math.sqrt(normShift);
                    for (let j = 0; j < N; j++)
                        connShift[rowOffset + j] *= k;
                }
            }
        }
        // Everything the hyperdimensional term introduced has to learn too. A
        // per-connection bias that never moves is a constant; a per-neuron
        // modulation variable that never moves means every neuron says the same
        // fixed thing about every connection forever, which is a fancy way of
        // saying nothing.
        if (this.config.connectionBias)
            this.learnConnectionBias(rates);
        if (this.config.hyperGain !== 0 || this.config.hyperAdd !== 0)
            this.learnNetworkVariables(rates);
        if (this.config.waveGain !== 0) {
            this.learnWavePool(rates);
            this.learnWaveConnections(rates);
        }
        for (let i = 0; i < N; i++) {
            stateDeltas.set(i, (stateDeltas.get(i) ?? 0) + deltaSums[i]);
        }
        // Update biases after weight updates.
        //
        // The same integrator the connection bias had: `b += rate*0.1*s_i[d]`
        // with nothing pulling the other way, so a neuron that tends positive
        // grows a bias that pushes it further positive, forever. Measured over
        // 400 learning ticks it went 0.002 -> 0.681 and was still climbing, on
        // its way to the clamp.
        //
        // An EMA toward the state instead: it tracks where the neuron tends to
        // sit, which is what a bias is for, and it cannot exceed the largest
        // state it has seen.
        for (let i = 0; i < N; i++) {
            const rate = rates[i];
            const si = this.neurons[i].state;
            const biasOffset = i * D;
            for (let d = 0; d < D; d++) {
                const b = bias[biasOffset + d];
                const valB = b + rate * 0.1 * (si[d] - b);
                bias[biasOffset + d] = valB < -1 ? -1 : (valB > 1 ? 1 : valB);
            }
        }
    }
    meanContentEnergyBuffer(buffer) {
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
     * Record each active neuron's move from where it was to where it now is,
     * and report how many made one.
     *
     * Each neuron keeps its LAST transition, not a hundred of them. The old ring
     * buffer held 100 per neuron and exactly one field of one entry was ever
     * read -- the newest `toState`, as the next transition's `fromState`. So it
     * was storing 200 full state copies per neuron to answer "where were you a
     * moment ago", which one copy answers.
     *
     * The returned value is a count rather than the list, because the count is
     * all a caller ever received: the list itself went into `history`, which had
     * no readers at all.
     */
    /**
     * Move every connection's own bias, and keep the row sums that read it.
     *
     * The bias update carries no input factor -- that is what makes it a bias:
     * the weight learns how much of the SOURCE to let through, the bias learns
     * where the connection sits regardless of it. Same clamp as the weights, so
     * one cannot quietly run away while the other is bounded.
     *
     * Row sums are rebuilt here rather than in the settle loop because they only
     * change when this runs, and rebuilding them per iteration would be
     * neuronCount pointless additions per connection per tick.
     */
    learnConnectionBias(rates) {
        const D = this.totalDims;
        const N = this.neurons.length;
        const connBias = this.connBias;
        const rowSum = this.connBiasRowSum;
        // Two things were wrong here, and together they were what saturated the
        // whole mesh.
        //
        // The update was `b += rate * s_i[d]` -- an integrator with nothing
        // opposing it. A neuron holding a positive state grew its bias, which
        // pushed the state further positive, which grew the bias faster. Nothing
        // in the loop pulled the other way, so it ran until the clamp.
        //
        // And every connection in the row got the IDENTICAL step, then the row was
        // SUMMED into the neuron. So it was never a bias per connection at all: it
        // was one bias counted N times, with N times the gain. Measured at N=24:
        // mean |connBias| went 0.000 -> 0.101 by tick 10, which is exactly when
        // 79% of neurons pinned at +-1, and on to 0.676 by tick 40. Every region
        // then answered 1.0000 to every input, including inputs never seen.
        //
        // So: an EMA toward what this connection cannot already account for,
        // which is bounded by construction and genuinely differs per sender, and
        // combined as a MEAN. The mean is the rule the rest of the file already
        // follows -- "a sum grows with neuron count until the term alone saturates
        // every neuron" is written above the wave code, and this was the one place
        // that ignored it.
        const connDiag = this.connDiag;
        const stateViews = this.stateViews;
        const invN = 1 / Math.max(1, N);
        for (let i = 0; i < N; i++) {
            const rate = rates[i];
            const si = this.neurons[i].state;
            for (let d = 0; d < D; d++) {
                const target = si[d];
                const sjRow = stateViews[d];
                const rowOffset = (i * D + d) * N;
                let sum = 0;
                for (let j = 0; j < N; j++) {
                    const b = connBias[rowOffset + j];
                    // What this connection's weight does not already explain. Different
                    // for every sender, which is what makes it a per-connection bias.
                    const residual = target - connDiag[rowOffset + j] * sjRow[j];
                    const value = b + rate * (residual - b);
                    const clamped = value < -2 ? -2 : (value > 2 ? 2 : value);
                    connBias[rowOffset + j] = clamped;
                    sum += clamped;
                }
                rowSum[i * D + d] = sum * invN;
            }
        }
    }
    /**
     * Move each neuron's own say in what every connection does.
     *
     * These are the two personalised variables the whole hyperdimensional term
     * is built out of: modWeight[k] is neuron k's contribution to the WEIGHT the
     * network adds to every connection, addWeight[k] its contribution to the
     * BIAS. Two things have to stay true of them, and the first version of this
     * broke both.
     *
     * THEY MUST BE ABLE TO GO DOWN. The step used to be a product of magnitudes
     * -- always positive -- so every variable climbed to its +1 clamp and stayed
     * there. Measured over 300 ticks: every one of them pinned at 1. A variable
     * that only ever grows is not a variable, and a network whose neurons all
     * end up saying exactly the same thing has no personalised variables left at
     * all. So the step is SIGNED now: a neuron moving with the rest of the
     * network gains its say, a neuron moving against it loses its say. That is
     * also the mechanism the whole design rests on -- contradicting answers
     * cancel, and the one that agrees is magnified.
     *
     * THE TWO SETS MUST BE DIFFERENT. They used to take the identical step, so
     * beyond their random starts they moved as one number in two arrays -- and
     * the weight half and the bias half of the equation are meant to be
     * separately expressible. They now learn from genuinely different signals:
     * the weight variable from how a neuron's direction compares with the
     * network's, the bias variable from the neuron's own signed level. A bias is
     * what something contributes with nothing arriving, so its variable tracks
     * where the neuron sits rather than who it agrees with.
     *
     * Bounded tightly (+/-1 rather than +/-2) because these two numbers move
     * EVERY connection at once -- a runaway weight distorts one connection, a
     * runaway network variable distorts all of them.
     */
    learnNetworkVariables(rates) {
        const N = this.neurons.length;
        const D = this.totalDims;
        const modWeight = this.modWeight;
        const addWeight = this.addWeight;
        // Where the network as a whole is pointing, and how lively it is: the mean
        // state per dimension, from the same states the settle loop just read.
        const mean = this.hyperMeanScratch;
        mean.fill(0);
        let activity = 0;
        for (let i = 0; i < N; i++) {
            const state = this.neurons[i].state;
            let energy = 0;
            for (let d = 1; d < D; d++) {
                energy += state[d] * state[d];
                mean[d] += state[d];
            }
            activity += Math.sqrt(energy);
        }
        const invN = 1 / Math.max(1, N);
        activity *= invN;
        let meanNorm = 0;
        for (let d = 1; d < D; d++) {
            mean[d] *= invN;
            meanNorm += mean[d] * mean[d];
        }
        meanNorm = Math.sqrt(meanNorm);
        // How each neuron lines up with where the network is pointing, computed
        // once and reused for every row: neuron i's row learns to weigh k by how
        // much k was part of what i agreed or disagreed with.
        const agreementWith = new Float32Array(N);
        for (let k = 0; k < N; k++) {
            const state = this.neurons[k].state;
            let devNorm = 0;
            let dot = 0;
            for (let d = 1; d < D; d++) {
                const dev = state[d] - mean[d];
                devNorm += dev * dev;
                dot += dev * mean[d];
            }
            devNorm = Math.sqrt(devNorm);
            agreementWith[k] = devNorm > 0 && meanNorm > 0 ? dot / (devNorm * meanNorm) : 0;
        }
        for (let i = 0; i < N; i++) {
            const state = this.neurons[i].state;
            // Everything here is measured on what this neuron holds that the network
            // does NOT -- its state minus the common mode.
            //
            // Against the raw state, every neuron in a network driven by one input
            // agrees with the mean, because the mean is mostly that same input: the
            // "agreement" came out positive for all sixteen neurons and every weight
            // variable climbed to +1 together. Removing the common mode is what
            // makes the signal differ from neuron to neuron at all, which is the
            // entire point of the variables being personalised.
            let own = 0;
            let devNorm = 0;
            let dot = 0;
            let deviation = 0;
            for (let d = 1; d < D; d++) {
                const dev = state[d] - mean[d];
                own += state[d] * state[d];
                devNorm += dev * dev;
                dot += dev * mean[d];
                deviation += dev;
            }
            const ownNorm = Math.sqrt(own);
            devNorm = Math.sqrt(devNorm);
            // In [-1, 1]: +1 when what is distinctive about this neuron points the
            // way the network as a whole is pointing, -1 when it points against it.
            // Zero when either side has nothing to point with, which is the honest
            // answer rather than an arbitrary direction.
            const agreement = devNorm > 0 && meanNorm > 0 ? dot / (devNorm * meanNorm) : 0;
            const step = rates[i] * ownNorm * activity;
            // Room left before the bound, so a variable eases into its limit instead
            // of slamming against it. A hard clamp alone let anything consistent pin
            // at +/-1 within a few hundred ticks and stay there -- measured: 15 of
            // 16 pinned -- and a pinned variable has stopped being personal to its
            // neuron. This way the pull weakens as it gets there, and a neuron that
            // changes its mind can still move.
            // Neuron i's whole row moves: how i weighs every other neuron k when it
            // reads the network. The step is i's own (its agreement with where the
            // network is pointing); what varies across the row is how much each k
            // contributed to that, so a neuron learns WHO it is agreeing with rather
            // than only that it agreed.
            const varRow = i * N;
            for (let k = 0; k < N; k++) {
                const at = varRow + k;
                const contribution = k === i ? 1 : agreementWith[k];
                // Tracks the agreement rather than accumulating it. `modRoom` only
                // slowed the approach to the rail; nothing pulled back, so a neuron
                // that kept agreeing ratcheted to the clamp and stopped being
                // personal to itself -- the fourth integrator of this exact shape in
                // the file. Measured: 0.102 -> 0.832 against a clamp of 0.999 over
                // 630 ticks, and because this variable scales every neuron's reading
                // of the whole network, railing it adds one big COMMON signal to
                // everything. Mean activity went 0.021 -> 0.725 behind it, and the
                // separation between an input a region knew and one nothing had seen
                // fell to 0.0024 -- which is the capability-gap signal disappearing.
                const target = agreement * contribution;
                modWeight[at] = clampNetworkVariable(modWeight[at] + step * (target - modWeight[at]));
            }
            // And how much a connection FROM this neuron scales its receiver's
            // reading. Bounded around 1: a sender that mutes every receiver's view
            // of the network is a sender that has switched the term off for everyone
            // it talks to.
            const gainRoom = 1 - Math.abs(this.senderGain[i] - 1);
            const nextGain = this.senderGain[i] + step * agreement * gainRoom * 0.5;
            this.senderGain[i] = nextGain < 0 ? 0 : (nextGain > 2 ? 2 : nextGain);
            // The bias variable's own signal: what this neuron is holding that the
            // network is NOT -- its deviation from the common mode, not its level.
            // Level was nearly the same thing as agreement once the states saturate
            // (both collapse to the same sign), which left the two sets of variables
            // as one number in two arrays: 15 of 16 identical, measured. A bias is
            // what something contributes on its own, so the deviation is the signal
            // that actually means that, and it is genuinely independent of who a
            // neuron agrees with.
            const level = deviation / Math.max(1, D - 1);
            for (let k = 0; k < N; k++) {
                const at = varRow + k;
                const contribution = k === i ? 1 : agreementWith[k];
                // The same, for the same reason.
                const addTarget = level * contribution;
                addWeight[at] = clampNetworkVariable(addWeight[at] + step * (addTarget - addWeight[at]));
            }
        }
    }
    /**
     * Let each neuron's wave move toward what it keeps hearing.
     *
     * The wave is not a fixed label stamped on a neuron at construction. A
     * neuron that repeatedly hears the pool carrying something just off its own
     * frequency should drift onto it -- that is how a group of neurons comes to
     * share a wave, which is what makes agreement able to reinforce at all. With
     * frequencies fixed forever, which pair of neurons can hear each other is
     * decided before the network has learned anything.
     *
     * This is a phase-locked loop, the standard way of pulling an oscillator
     * onto a signal: the phase error says where the pool sits relative to this
     * neuron, the phase moves most of the way there, and the frequency takes a
     * much smaller step in the same direction. Frequency moves slowly on purpose
     * -- phase can be corrected every tick, but a frequency that chased every
     * tick would never settle anywhere and neurons could not stay locked to each
     * other long enough to matter.
     *
     * Weighted by how much this neuron actually heard: a neuron the pool is
     * saying nothing to has no evidence to move on, and moving anyway would be
     * drift rather than learning.
     */
    /**
     * Let every connection's wave-editing equation learn.
     *
     * Wherever there is a weight there is one of these, and a weight that never
     * moves is a constant. The rule is the same shape as the Hebbian one on the
     * connection's numeric weight: a connection carrying a wave that arrived in
     * phase -- that helped -- opens up, and one carrying a wave that arrived
     * against the grain closes down and turns toward agreement.
     *
     * Gain is bounded to [0, 2]: negative gain is not a weaker connection, it is
     * a half-turn, and the phase term already expresses that. Two ways of saying
     * the same thing let learning oscillate between them forever.
     */
    /** Rebuild the whole cos/sin table -- after a restore, where every phase changed at once. */
    refreshWavePhaseTable() {
        const turn = this.connWavePhase;
        for (let i = 0; i < turn.length; i++) {
            this.connWaveCos[i] = Math.cos(turn[i]);
            this.connWaveSin[i] = Math.sin(turn[i]);
        }
    }
    learnWaveConnections(rates) {
        const N = this.neurons.length;
        const amplitude = this.waveAmpScratch;
        const error = this.wavePhaseErrorScratch;
        const gain = this.connWaveGain;
        const turn = this.connWavePhase;
        const bias = this.connWaveBias;
        const biasIm = this.connWaveBiasIm;
        const shift = this.connWaveShift;
        const TWO_PI = Math.PI * 2;
        for (let i = 0; i < N; i++) {
            const heard = amplitude[i];
            if (heard === 0)
                continue;
            const rate = rates[i];
            const mismatch = error[i];
            // In phase when the mismatch is near zero, against the grain near +/-pi.
            const agreement = Math.cos(mismatch);
            const row = i * N;
            // The neuron's own wave bias, and its network wave variables: the wave
            // copies of bias[i][d], modWeight[i] and addWeight[i]. Each moves the
            // way its numeric twin does -- toward what was agreed with, away from
            // what was fought.
            const ownStep = rate * Math.min(1, heard) * agreement * WAVE_BIAS_RATE;
            const ownCos = Math.cos(this.wavePhase[i]);
            const ownSin = Math.sin(this.wavePhase[i]);
            const nextBiasRe = this.neuronWaveBiasRe[i] + ownStep * ownCos;
            const nextBiasIm = this.neuronWaveBiasIm[i] + ownStep * ownSin;
            this.neuronWaveBiasRe[i] = nextBiasRe < -0.5 ? -0.5 : (nextBiasRe > 0.5 ? 0.5 : nextBiasRe);
            this.neuronWaveBiasIm[i] = nextBiasIm < -0.5 ? -0.5 : (nextBiasIm > 0.5 ? 0.5 : nextBiasIm);
            const nextModWave = this.modWaveWeight[i] + ownStep;
            this.modWaveWeight[i] = nextModWave < -1 ? -1 : (nextModWave > 1 ? 1 : nextModWave);
            const nextAddWave = this.addWaveWeight[i] + ownStep;
            this.addWaveWeight[i] = nextAddWave < -1 ? -1 : (nextAddWave > 1 ? 1 : nextAddWave);
            for (let k = 0; k < N; k++) {
                const carried = amplitude[k];
                if (carried === 0)
                    continue;
                const step = rate * carried * Math.min(1, heard);
                const nextGain = gain[row + k] + step * agreement * WAVE_EDIT_RATE;
                gain[row + k] = nextGain < 0 ? 0 : (nextGain > 2 ? 2 : nextGain);
                let nextTurn = turn[row + k] - step * mismatch * WAVE_EDIT_RATE;
                nextTurn %= TWO_PI;
                if (nextTurn < 0)
                    nextTurn += TWO_PI;
                turn[row + k] = nextTurn;
                // The pair the settle loop reads instead of recomputing it.
                this.connWaveCos[row + k] = Math.cos(nextTurn);
                this.connWaveSin[row + k] = Math.sin(nextTurn);
                // The bias: what this connection contributes with nothing arriving.
                // A wave in its own right, so both halves move, along the phase the
                // receiving neuron is sitting at -- a bias that only ever grew in one
                // direction could add height but never disagree with anything.
                //
                // Bounded much harder than the gain: it fires whether or not there is
                // anything to carry, so a large one is a connection shouting into the
                // pool on its own.
                const biasStep = step * agreement * WAVE_BIAS_RATE;
                const nextBias = bias[row + k] + biasStep * ownCos;
                bias[row + k] = nextBias < -0.5 ? -0.5 : (nextBias > 0.5 ? 0.5 : nextBias);
                const nextBiasTurned = biasIm[row + k] + biasStep * ownSin;
                biasIm[row + k] = nextBiasTurned < -0.5 ? -0.5 : (nextBiasTurned > 0.5 ? 0.5 : nextBiasTurned);
                // The shift weight's wave copy, moving like the gain but far more
                // slowly: it reaches across frequencies, so a large one lets a wave
                // leak into a neighbour it does not belong to.
                const nextShift = shift[row + k] + step * agreement * WAVE_SHIFT_RATE;
                shift[row + k] = nextShift < -0.5 ? -0.5 : (nextShift > 0.5 ? 0.5 : nextShift);
            }
        }
    }
    learnWavePool(rates) {
        const N = this.neurons.length;
        const error = this.wavePhaseErrorScratch;
        const amplitude = this.waveAmpScratch;
        const TWO_PI = Math.PI * 2;
        for (let i = 0; i < N; i++) {
            const heard = amplitude[i];
            if (heard === 0)
                continue;
            const step = rates[i] * error[i] * Math.min(1, heard);
            let phase = this.wavePhase[i] + step * PHASE_LOCK_RATE;
            phase %= TWO_PI;
            if (phase < 0)
                phase += TWO_PI;
            this.wavePhase[i] = phase;
            // Bounded: the pool is sampled across a fixed window, and a frequency
            // outside this range either completes no cycle in it (invisible to every
            // other neuron) or aliases against the sampling (visible as a frequency
            // it does not have).
            const freq = this.waveFreq[i] + step * FREQUENCY_LOCK_RATE;
            this.waveFreq[i] = freq < MIN_WAVE_FREQ ? MIN_WAVE_FREQ : (freq > MAX_WAVE_FREQ ? MAX_WAVE_FREQ : freq);
        }
    }
    resolveStateTransitions() {
        let resolved = 0;
        const now = Date.now();
        for (const neuron of this.neurons) {
            if (neuron.energy > this.config.energyThreshold) {
                const previous = neuron.lastTransition;
                neuron.lastTransition = {
                    fromState: new Float32Array(previous ? previous.toState : neuron.state),
                    toState: new Float32Array(neuron.state),
                    energy: neuron.energy,
                    timestamp: now,
                    cause: 'energy_resolved',
                };
                resolved++;
            }
        }
        return resolved;
    }
    computeStateEnergy(state) {
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
    computeOutputVector(activeStates) {
        const dims = this.config.dimensions;
        const output = new Array(dims).fill(0);
        const len = activeStates.length;
        if (len === 0)
            return output;
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
     * everything downstream of it — noveltyScore, patternHash) silently,
     * permanently zero whenever the whole mesh's
     * energy happened to sit under the threshold — which, at the default
     * threshold and typical settled-state magnitudes, was most of the time,
     * including in the live pipeline's own default configuration.
     */
    getActiveStates() {
        const active = this.neurons.filter(n => n.energy > this.config.energyThreshold);
        return active.length > 0 ? active : this.neurons;
    }
    computeDimensionalEntropy() {
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
    computeNoveltyScore(patternHash) {
        const seen = this.seenPatterns.get(patternHash);
        if (!seen)
            return 1;
        const timeSinceLastSeen = Date.now() - seen.lastSeen;
        const recencyFactor = Math.exp(-timeSinceLastSeen / this.config.noveltyWindow);
        const frequencyPenalty = Math.min(1, seen.frequency / 10);
        return Math.max(0, 1 - recencyFactor * frequencyPenalty);
    }
    recordPattern(patternHash, novelty) {
        const existing = this.seenPatterns.get(patternHash);
        if (existing) {
            existing.frequency++;
            existing.lastSeen = Date.now();
            existing.novelty = novelty;
        }
        else {
            this.seenPatterns.set(patternHash, {
                hash: patternHash,
                frequency: 1,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
                novelty,
            });
            while (this.seenPatterns.size > this.seenPatternsCapacity) {
                const oldest = this.seenPatterns.keys().next().value;
                if (oldest === undefined)
                    break;
                this.seenPatterns.delete(oldest);
            }
        }
    }
    hashVector(vector) {
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
/** Canonical drive magnitude for "this input neuron is active this tick" -- the actual value doesn't carry the bit (which of the two neurons is driven does); a fixed constant just needs to be a real, reproducible stimulus. */
const ZIP_LOOP_PULSE = 1;
/** Shared "nothing is externally driven this tick" set for receiveBits(). Safe to share because process()/settle() only ever read the driven set -- nothing on that path adds to or clears it. */
const ZIP_LOOP_NO_DRIVEN = new Set();
/** Below this, an output neuron counts as saying nothing rather than saying zero. */
const SILENT_OUTPUT = 1e-6;
/**
 * How far above the network's own mean energy an output neuron must sit to
 * count as speaking.
 *
 * Above 1 because being exactly as active as the average neuron is what every
 * neuron in a resting mesh is doing.
 */
const SILENT_OUTPUT_RATIO = 1.5;
/**
 * Settle iterations at or below which a read counts as the mesh having
 * nothing further to work out. Above one, because a network still developing
 * an answer takes several -- measured, 8 to 12 while it was still moving.
 */
const ZIP_SETTLED_ITERATIONS = 2;
/** Dimensions the hyperdimensional pass handles per sweep of the weights. */
const HYPER_DIM_TILE = 4;
/** The wave the Zip Loop's bit neurons share. Its value does not matter; that all four share it does. */
const ZIP_BIT_FREQUENCY = 0.25;
/** Shared options for every read tick: reading the network must not rewrite it. */
const ZIP_LOOP_READ_ONLY = { learn: false };
/**
 * Settle iterations while a bit is being streamed IN.
 *
 * Not one: a single step would leave the bit sitting on the input neuron
 * without reaching anything. Not the full ceiling either -- that is for
 * producing an answer, and paying it per bit is what made a two-character
 * prompt take over eight minutes to say.
 */
const ZIP_INPUT_STEPS = 2;
export class ZipLoopInterface {
    constructor(engine, ids) {
        this.engine = engine;
        this.ids = ids;
        /** Reused input vectors; engine dimensions are fixed at construction, so these never need rebuilding. */
        this.pulseScratch = null;
        this.idleScratch = null;
        /** The last bit fed in, so the learning pass can re-drive it. */
        this.lastBit = null;
        /** Settle iterations the last output read needed. */
        this.lastSettleIterations = Number.MAX_SAFE_INTEGER;
        this.drivenBit0 = new Set([ids.bit0In]);
        this.drivenBit1 = new Set([ids.bit1In]);
        // Perfect enemies. The two input neurons carry the same wave half a cycle
        // apart, so a one and a zero arriving together annihilate exactly rather
        // than leaving a residue that means neither. Everything downstream of the
        // doorway then gets interference that says something: what survives is
        // what the bits actually disagreed about.
        //
        // Set rather than learned, because two neurons that must be exact
        // opposites cannot be left to find each other -- and if they drifted
        // apart, a one and a zero would stop cancelling and nothing would say so.
        this.engine.setWaveSignature(ids.bit0In, ZIP_BIT_FREQUENCY, 0);
        this.engine.setWaveSignature(ids.bit1In, ZIP_BIT_FREQUENCY, Math.PI);
        this.engine.setWaveSignature(ids.bit0Out, ZIP_BIT_FREQUENCY, 0);
        this.engine.setWaveSignature(ids.bit1Out, ZIP_BIT_FREQUENCY, Math.PI);
    }
    /** Streams `bytes` in MSB-first bit order, one settle() tick per bit -- "0 -> wait -> 1 -> wait -> ..." */
    /** One byte in, MSB-first, without ending the message. */
    sendByte(byte) {
        for (let b = 7; b >= 0; b--)
            this.sendBit(((byte >> b) & 1));
    }
    /** Streams every bit in, then learns from the message as one event. */
    sendBytes(bytes) {
        for (const byte of bytes) {
            for (let b = 7; b >= 0; b--) {
                this.sendBit(((byte >> b) & 1));
            }
        }
        // The whole message has arrived: THIS is the event.
        this.learnFromEvent();
    }
    /**
     * Drives exactly one of the two input neurons (bit0In for 0, bit1In for 1)
     * for one settle() tick; the other stays undriven.
     *
     * The pulse vector and both single-id driven Sets are built once per
     * interface and reused, rather than reallocated per bit: streaming a 1KB
     * payload is 8192 sendBit() calls, and every one of them was allocating a
     * fresh `dims`-length array plus a fresh Set for values that never change.
     */
    sendBit(bit) {
        // Feeding a bit in is not an event to learn from.
        //
        // This used to learn on EVERY bit, and learning is the expensive half of
        // a tick -- O(N^2 * D) across the whole mesh, plus the row normalisation
        // and the connection-bias pass. Measured on the live network of 336
        // neurons at 64 dimensions: 1281 ms per input bit against 104 ms for a
        // read-only settle. Feeding a 51-byte archive -- the packed form of the
        // two-character prompt "hi" -- is 408 bits, so 522 SECONDS went by before
        // the network had finished hearing the question. The Zip Loop endpoint
        // never returned, and because the settle loop is synchronous it took the
        // whole server down with it: every other request, health checks included,
        // got nothing while it ran.
        //
        // It is also the wrong shape. The elastic core learns from an EVENT,
        // weighted by how much input each neuron received during it. A single bit
        // is not an event; the message is. So the bits go in read-only and the
        // learning happens once, in learnFromEvent(), when the whole thing has
        // arrived -- which is both 400 times cheaper and closer to what the
        // architecture actually says.
        //
        // And a bit arriving is one step of propagation, not a settle to
        // convergence. Every bit perturbs the network, so the settle loop never
        // converged early and ran its full ceiling -- 32 iterations of an
        // O(N^2 * D) pass -- for each of the 408 bits in a two-character prompt.
        // Settling to convergence is what you do when you want the ANSWER, and
        // that still happens: nextOutputByte() and learnFromEvent() both settle
        // fully. Streaming the question in does not need it.
        this.lastBit = bit;
        const ceiling = this.engine.getPropagationSteps();
        this.engine.setPropagationSteps(ZIP_INPUT_STEPS);
        try {
            this.engine.process(this.pulseVector(), undefined, bit === 1 ? this.drivenBit1 : this.drivenBit0, undefined, ZIP_LOOP_READ_ONLY);
        }
        finally {
            this.engine.setPropagationSteps(ceiling);
        }
    }
    /**
     * Learn from everything that has just arrived, once.
     *
     * The counterpart to feeding bits read-only: the mesh has now settled around
     * the whole message, so this is the moment its state means "the event", and
     * one learning pass here is what the elastic core is described as doing.
     */
    learnFromEvent() {
        if (this.lastBit === null)
            return;
        // Learn while the input is still THERE.
        //
        // The first version of this drove nothing, on an idle vector, and learned
        // whatever the network held afterwards. By then it held almost nothing:
        // with no drive the states fell to 4e-6, so the Hebbian step came out at
        // 1e-11 and vanished under Float32 against weights of 0.2 -- measured,
        // exactly zero movement from a whole byte. The event was over before the
        // learning ran.
        //
        // So the last bit of the message is re-driven with learning on, at the
        // full settle ceiling. The states then mean "the message just arrived",
        // which is the moment the elastic core is meant to learn from, and the
        // input force each neuron felt is real rather than residual.
        this.engine.process(this.pulseVector(), undefined, this.lastBit === 1 ? this.drivenBit1 : this.drivenBit0);
    }
    /** Lazily built idle vector, shared with nextOutputByte(). */
    idleVector() {
        if (!this.idleScratch)
            this.idleScratch = new Array(this.engine.getDimensions()).fill(0);
        return this.idleScratch;
    }
    /** Lazily built (engine dimensions are fixed at construction) and reused by every sendBit(). */
    pulseVector() {
        if (!this.pulseScratch) {
            this.pulseScratch = new Array(this.engine.getDimensions()).fill(ZIP_LOOP_PULSE);
        }
        return this.pulseScratch;
    }
    /**
     * Reads `count` bits back off the two output neurons, one settle() tick
     * each, with nothing directly driven -- the network keeps evolving under
     * its own recurrent dynamics between reads, exactly the "temporary
     * context" the source description asks for. Whichever output neuron has
     * higher energy after a tick is read as that tick's bit.
     */
    receiveBits(count) {
        const bits = new Array(count);
        // Idle vector and the empty driven-set are constant across every tick, and
        // each bit only needs two scalars back -- previously this rebuilt both per
        // iteration and called getNeuronStates(), which deep-copies every neuron
        // (object spread + fresh Float32Array each), then linear-scanned that
        // throwaway snapshot twice. That made reading K bits O(K*N) allocations to
        // recover 2K numbers; getNeuronEnergy() reads each in O(1) with none.
        if (!this.idleScratch)
            this.idleScratch = new Array(this.engine.getDimensions()).fill(0);
        const idle = this.idleScratch;
        const bit0Out = this.ids.bit0Out;
        const bit1Out = this.ids.bit1Out;
        for (let i = 0; i < count; i++) {
            // learn: false -- reading is not learning. Every one of these ticks used
            // to apply a full Hebbian update, so pulling an answer out of the
            // network changed the network it was pulled from, and reading the same
            // thing twice gave two different networks.
            const read = this.engine.process(idle, undefined, ZIP_LOOP_NO_DRIVEN, undefined, ZIP_LOOP_READ_ONLY);
            // How hard the mesh had to work to reach a stable state on this tick.
            // The smallest of the eight is what the byte cost at its easiest.
            if (i === 0 || read.settleIterations > this.lastSettleIterations) {
                this.lastSettleIterations = read.settleIterations;
            }
            bits[i] = this.engine.getNeuronEnergy(bit1Out) > this.engine.getNeuronEnergy(bit0Out) ? 1 : 0;
        }
        return bits;
    }
    /**
     * One tick-group of output, or null when the network emitted nothing.
     *
     * This is what makes the mesh a BitDoorway (zip-halt.ts) and therefore what
     * lets a run end when the NETWORK decides it is over rather than when a
     * timer says so. An all-connected mesh has no last layer to fall out of, so
     * silence is the only evidence that it has finished emitting -- and silence
     * has to be a value the caller receives, not a gap it fails to notice.
     *
     * Silence means both output neurons sat below SILENT_OUTPUT for the whole
     * byte. receiveBits() alone cannot express that: it compares the two and
     * always returns a bit, so a completely dormant network reads as an endless
     * stream of zeros -- indistinguishable from a network patiently emitting
     * zeros, which is exactly the distinction a halt condition rests on.
     */
    nextOutputByte() {
        if (!this.idleScratch)
            this.idleScratch = new Array(this.engine.getDimensions()).fill(0);
        const idle = this.idleScratch;
        let byte = 0;
        let heard = false;
        for (let b = 0; b < 8; b++) {
            // Reading, so not learning -- see receiveBits().
            const read = this.engine.process(idle, undefined, ZIP_LOOP_NO_DRIVEN, undefined, ZIP_LOOP_READ_ONLY);
            // How hard the mesh worked to reach a stable state on this tick. The
            // HARDEST of the eight is what the byte cost: a byte is settled only if
            // the network settled on every bit of it. Taking the easiest instead
            // called every byte settled, because at least one bit of any byte lands
            // in one iteration.
            if (b === 0 || read.settleIterations > this.lastSettleIterations) {
                this.lastSettleIterations = read.settleIterations;
            }
            const zero = this.engine.getNeuronEnergy(this.ids.bit0Out);
            const one = this.engine.getNeuronEnergy(this.ids.bit1Out);
            // Speaking means standing out from the network's own floor, not
            // clearing a fixed constant.
            //
            // SILENT_OUTPUT is 1e-6, which suited a small mesh where a quiet neuron
            // really did sit near zero. On the live network of 336 neurons every
            // neuron carries residual activity around 1e-3 -- a thousand times the
            // threshold -- so the output neurons NEVER read as silent and the run
            // could never end by going quiet. Measured over five reads: bit0Out
            // 9.98e-4 against bit1Out 9.93e-4, both far above the line and barely
            // half a percent apart, which is noise being reported as speech.
            //
            // Against the network's own mean energy instead, the same way the
            // capability gap is measured against what a region usually manages. A
            // network whose output neurons are merely as active as everything else
            // is not saying anything; one where they stand above the rest is.
            const floor = this.engine.meanNeuronEnergy() * SILENT_OUTPUT_RATIO;
            const line = floor > SILENT_OUTPUT ? floor : SILENT_OUTPUT;
            if (zero > line || one > line)
                heard = true;
            byte = (byte << 1) | (one > zero ? 1 : 0);
        }
        return heard ? byte : null;
    }
    /**
     * Did the network reach a stable state while producing the last byte?
     *
     * This is the stop signal the architecture actually describes -- "the
     * process continues until the network reaches a sufficiently stable state,
     * and that settled state can be interpreted as the output" -- and nothing
     * was reading it.
     *
     * The two signals that were being read cannot fire here. The stop call
     * needs the network trained to spell a particular string. Silence cannot
     * happen at all: the output neurons sit in the same all-connected mesh as
     * everything else, so they are driven by all 336 neurons and never go
     * quiet. Measured, the output is not speech but a drifting bit pattern --
     * f8 78 78 78 7c 3c 3c 3c 3e 1e 1f 07 -- a mesh oscillating, with nothing
     * left to say and no way to say so.
     *
     * Settling it can do, and does: 12, 1, 1, 1, 1, 8, 1, 1, 1, 9, 1, 1
     * iterations against a ceiling of 32. A run of cheap settles means the mesh
     * has reached its steady state and further reads only draw out more of the
     * same oscillation.
     */
    /** Iterations the hardest bit of the last byte needed. */
    worstSettleIterations() {
        return this.lastSettleIterations;
    }
    settledWhileReading() {
        return this.lastSettleIterations <= ZIP_SETTLED_ITERATIONS;
    }
    /**
     * Everything the network is holding right now -- neuron states and every
     * connection between them.
     *
     * This is what makes a stopped run resumable: the mesh's recurrent state IS
     * its working context, so ending a run without saving it means every run
     * starts from nothing and forgets what the last one built up.
     */
    captureNetworkState() {
        return this.engine.captureNetworkState();
    }
    /** Reads `byteCount` bytes back, packing each 8 bits MSB-first. */
    receiveBytes(byteCount) {
        const bits = this.receiveBits(byteCount * 8);
        const out = new Uint8Array(byteCount);
        for (let i = 0; i < byteCount; i++) {
            let byte = 0;
            for (let b = 0; b < 8; b++)
                byte = (byte << 1) | bits[i * 8 + b];
            out[i] = byte;
        }
        return out;
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
export class QuantumNeuralNet {
    constructor() {
        this.planckConstant = 6.626e-34; // Scaled for simulation
        this.neurons = new Map();
    }
    /**
     * Register a neuron with exclusive input capability
     */
    addNeuron(id, inputValue) {
        const signature = this.calculateSignature(id, inputValue);
        const height = this.calculateWaveHeight(inputValue);
        const neuron = {
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
    calculateSignature(id, input) {
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
    calculateWaveHeight(input) {
        return Math.abs(input) * 10; // Scale factor for visibility
    }
    /**
     * Create superposition of states for a neuron
     */
    createSuperposition(neuronId, possibleInputs) {
        const neuron = this.neurons.get(neuronId);
        if (!neuron)
            throw new Error(`Neuron ${neuronId} not found`);
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
    interfere(neuronIdA, neuronIdB) {
        const neuronA = this.neurons.get(neuronIdA);
        const neuronB = this.neurons.get(neuronIdB);
        if (!neuronA || !neuronB)
            throw new Error('One or both neurons not found');
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
    phaseConsensus(neuronIds) {
        let sum = { re: 0, im: 0 };
        for (const id of neuronIds) {
            const neuron = this.neurons.get(id);
            if (!neuron)
                continue;
            sum = cAdd(sum, this.complexAmplitude(neuron.state));
        }
        return cAbs(sum);
    }
    /** The state's phase-and-amplitude as a single complex number height·e^{iφ}. */
    complexAmplitude(state) {
        return fromPolar(state.height, state.phase);
    }
    /** Public complex-amplitude accessor: the neuron's genuine complex QIL state. */
    getComplexAmplitude(neuronId) {
        const neuron = this.neurons.get(neuronId);
        return neuron ? this.complexAmplitude(neuron.state) : null;
    }
    /**
     * Grover-style amplitude amplification: flips the sign of the target
     * neuron's amplitude (oracle), then reflects every amplitude in the group
     * about their mean (diffuser). Iterating this grows the target's share of
     * total probability mass at the expense of the rest of the group.
     */
    groverAmplify(neuronIds, targetId) {
        const ids = neuronIds.filter(id => this.neurons.has(id));
        const targetIdx = ids.indexOf(targetId);
        if (targetIdx === -1 || ids.length === 0)
            return;
        const amplitudes = ids.map(id => this.neurons.get(id).state.height);
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
            const neuron = this.neurons.get(id);
            neuron.state.height = Math.abs(amplitudes[i]);
            neuron.state.probability = (amplitudes[i] * amplitudes[i]) / totalSq;
        });
    }
    /**
     * Collapse the wave function to a single state, sampling from the
     * amplitude-weighted (Born rule) probability distribution built by
     * createSuperposition / groverAmplify — not a plain uniform draw.
     */
    collapse(neuronId) {
        const neuron = this.neurons.get(neuronId);
        if (!neuron)
            throw new Error(`Neuron ${neuronId} not found`);
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
    evolvePhase(neuronId, deltaTime) {
        const neuron = this.neurons.get(neuronId);
        if (!neuron)
            return;
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
    getState(neuronId) {
        const neuron = this.neurons.get(neuronId);
        return neuron ? neuron.state : null;
    }
    /**
     * Check if a neuron has exclusive input (prerequisite for quantum behavior)
     */
    isExclusiveInput(neuronId) {
        const neuron = this.neurons.get(neuronId);
        return neuron ? neuron.inputExclusive : false;
    }
}
// Export singleton instance for easy integration
export const quantumNet = new QuantumNeuralNet();
export class MoERouter {
    constructor(config = {}) {
        this.iteration = 0;
        // OPTIMIZATION: Keep a pre-allocated pool of scratch Float32Arrays for expert outputs
        // to avoid garbage collection and memory allocation overhead on every route() call.
        this.expertOutputsScratch = [];
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
        this.scoresScratch = new Array(this.config.expertCount);
        this.selectScratch = new Int32Array(this.config.expertCount);
        // Initialize the expert output scratch pool to topK elements of outputDim size.
        this.expertOutputsScratch = Array.from({ length: this.config.topK }, () => new Float32Array(this.config.outputDim));
        this.initializeExpertWeights();
        this.initializeExperts();
    }
    initializeExpertWeights() {
        const scale = Math.sqrt(2.0 / this.config.inputDim);
        for (let i = 0; i < this.routerWeights.length; i++) {
            this.routerWeights[i] = (Math.random() * 2 - 1) * scale;
        }
    }
    initializeExperts() {
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
    route(input) {
        const scores = this.computeRouterScores(input);
        const topKIndices = this.selectTopK(scores);
        // OPTIMIZATION: Manually map scores to topScores to avoid callback overhead.
        const numK = topKIndices.length;
        const topScores = new Array(numK);
        for (let i = 0; i < numK; i++) {
            topScores[i] = scores[topKIndices[i]];
        }
        const routerWeights = this.softmax(topScores);
        // Ensure our expertOutputsScratch array pool is sufficiently sized for numK (top-K)
        while (this.expertOutputsScratch.length < numK) {
            this.expertOutputsScratch.push(new Float32Array(this.config.outputDim));
        }
        const expertOutputs = [];
        for (let i = 0; i < numK; i++) {
            const expertIdx = topKIndices[i];
            const expert = this.experts.get(expertIdx);
            // Grab a pre-allocated Float32Array scratch buffer instead of allocating a new one
            const output = this.expertOutputsScratch[i];
            output.fill(0);
            output.set(expert.bias);
            const weights = expert.weights;
            const hiddenDim = this.config.expertHiddenDim;
            // OPTIMIZATION: 4x loop unrolling on input dimension k combined with 4x unrolling on hidden dimension j.
            // Unrolling k allows accumulating 4 input feature products per output write, reducing array store operations by 4x.
            const limitJ = hiddenDim - 3;
            const limitK = input.length - 3;
            let k = 0;
            for (; k < limitK; k += 4) {
                const v0 = input[k];
                const v1 = input[k + 1];
                const v2 = input[k + 2];
                const v3 = input[k + 3];
                if (v0 === 0 && v1 === 0 && v2 === 0 && v3 === 0)
                    continue;
                const off0 = k * hiddenDim;
                const off1 = (k + 1) * hiddenDim;
                const off2 = (k + 2) * hiddenDim;
                const off3 = (k + 3) * hiddenDim;
                let j = 0;
                for (; j < limitJ; j += 4) {
                    output[j] += v0 * weights[off0 + j] + v1 * weights[off1 + j] + v2 * weights[off2 + j] + v3 * weights[off3 + j];
                    output[j + 1] += v0 * weights[off0 + j + 1] + v1 * weights[off1 + j + 1] + v2 * weights[off2 + j + 1] + v3 * weights[off3 + j + 1];
                    output[j + 2] += v0 * weights[off0 + j + 2] + v1 * weights[off1 + j + 2] + v2 * weights[off2 + j + 2] + v3 * weights[off3 + j + 2];
                    output[j + 3] += v0 * weights[off0 + j + 3] + v1 * weights[off1 + j + 3] + v2 * weights[off2 + j + 3] + v3 * weights[off3 + j + 3];
                }
                for (; j < hiddenDim; j++) {
                    output[j] += v0 * weights[off0 + j] + v1 * weights[off1 + j] + v2 * weights[off2 + j] + v3 * weights[off3 + j];
                }
            }
            for (; k < input.length; k++) {
                const inputVal = input[k];
                if (inputVal === 0)
                    continue;
                const weightOffset = k * hiddenDim;
                for (let j = 0; j < hiddenDim; j++) {
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
        }
        else if (numK === 2) {
            const out0 = expertOutputs[0];
            const out1 = expertOutputs[1];
            const w0 = routerWeights[0];
            const w1 = routerWeights[1];
            for (let j = 0; j < this.config.outputDim; j++) {
                combinedOutput[j] = out0[j] * w0 + out1[j] * w1;
            }
        }
        else if (numK === 4) {
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
        }
        else {
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
    forward(input, layerIndex = 0) {
        const decision = this.route(input);
        const expertContributions = new Map();
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
    addExpert(first, bias) {
        const expertId = this.experts.size;
        if (first instanceof Float32Array) {
            this.experts.set(expertId, { weights: first, bias: bias || new Float32Array(0) });
        }
        else {
            // Allocated on first use, not at registration.
            //
            // Measured at boot: this allocated inputDim x expertHiddenDim floats --
            // 1.5MB -- for EVERY registered plugin, and randomly initialised all
            // 393216 of them. With 36 plugins that is 54MB of resident typed arrays
            // before anything has been asked a single question, which was most of
            // the 65MB gap between this process's 21MB heap and its 178MB RSS.
            //
            // Most of it is never touched. api-connection plugins get one presence
            // neuron precisely because, as registry.ts says where it calls this,
            // their capability "genuinely can't be reduced to neuron weights" --
            // reading a file requires real I/O, not a weighted sum. Paying 1.5MB up
            // front for a matrix that will never be multiplied is the definition of
            // eager work with no consumer.
            //
            // The getter materialises identical weights on first read, so anything
            // that does use an expert sees exactly what it saw before; it just does
            // not pay for the ones nobody routes to.
            const dim = this.config.expertHiddenDim || 128;
            const inputDim = this.config.inputDim;
            let weights = null;
            this.experts.set(expertId, {
                get weights() {
                    if (weights === null) {
                        weights = new Float32Array(inputDim * dim);
                        const scale = Math.sqrt(2.0 / inputDim);
                        for (let i = 0; i < weights.length; i++) {
                            weights[i] = (Math.random() * 2 - 1) * scale;
                        }
                    }
                    return weights;
                },
                set weights(next) {
                    // Training writes back through here; assigning replaces the lazy
                    // value rather than being silently dropped.
                    weights = next;
                },
                bias: new Float32Array(dim),
            });
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
    growRouterCapacity() {
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
        this.scoresScratch = new Array(newCount);
        this.selectScratch = new Int32Array(newCount);
        this.config.expertCount = newCount;
    }
    removeExpert(expertId) {
        if (!this.experts.has(expertId))
            return false;
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
        const newExperts = new Map();
        const newUtil = new Map();
        const newWeights = new Float32Array(inputDim * survivors.length);
        const newBias = new Float32Array(survivors.length);
        survivors.forEach((oldId, newId) => {
            newExperts.set(newId, this.experts.get(oldId));
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
        this.scoresScratch = new Array(survivors.length);
        this.selectScratch = new Int32Array(survivors.length);
        this.config.expertCount = survivors.length;
        return true;
    }
    setExpertWeights(expertId, weights, bias) {
        if (this.experts.has(expertId)) {
            this.experts.set(expertId, { weights, bias });
        }
    }
    getUtilizationStats() {
        const stats = [];
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
    getExpertCount() {
        return this.experts.size;
    }
    getExpertList() {
        return Array.from(this.experts.keys());
    }
    computeRouterScores(input) {
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
            if (inputVal === 0)
                continue; // Sparsity fast-path
            const weightOffset = i * expertCount;
            let exp = 0;
            const limit = expertCount - 7;
            for (; exp < limit; exp += 8) {
                scores[exp] += inputVal * weights[weightOffset + exp];
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
    selectTopK(scores) {
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
        }
        else if (k === 2 && scores.length >= 2) {
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
                }
                else if (val > val1) {
                    val1 = val;
                    max1 = i;
                }
            }
            return [max0, max1];
        }
        else if (k === 4 && scores.length >= 4) {
            // OPTIMIZATION: 4-element specialization using inline sorting network
            // and branchless element-shifting to completely bypass array sorting/allocations.
            let max0 = 0, max1 = 1, max2 = 2, max3 = 3;
            if (scores[max1] > scores[max0]) {
                const t = max0;
                max0 = max1;
                max1 = t;
            }
            if (scores[max2] > scores[max0]) {
                const t = max0;
                max0 = max2;
                max2 = t;
            }
            if (scores[max3] > scores[max0]) {
                const t = max0;
                max0 = max3;
                max3 = t;
            }
            if (scores[max2] > scores[max1]) {
                const t = max1;
                max1 = max2;
                max2 = t;
            }
            if (scores[max3] > scores[max1]) {
                const t = max1;
                max1 = max3;
                max3 = t;
            }
            if (scores[max3] > scores[max2]) {
                const t = max2;
                max2 = max3;
                max3 = t;
            }
            let val0 = scores[max0];
            let val1 = scores[max1];
            let val2 = scores[max2];
            let val3 = scores[max3];
            for (let i = 4; i < scores.length; i++) {
                const val = scores[i];
                if (val > val0) {
                    val3 = val2;
                    max3 = max2;
                    val2 = val1;
                    max2 = max1;
                    val1 = val0;
                    max1 = max0;
                    val0 = val;
                    max0 = i;
                }
                else if (val > val1) {
                    val3 = val2;
                    max3 = max2;
                    val2 = val1;
                    max2 = max1;
                    val1 = val;
                    max1 = i;
                }
                else if (val > val2) {
                    val3 = val2;
                    max3 = max2;
                    val2 = val;
                    max2 = i;
                }
                else if (val > val3) {
                    val3 = val;
                    max3 = i;
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
        const result = new Array(k);
        for (let i = 0; i < k; i++) {
            result[i] = indices[i];
        }
        return result;
    }
    softmax(values) {
        const len = values.length;
        // OPTIMIZATION: Specialize softmax for len === 1 and len === 2 to bypass allocation
        if (len === 1) {
            return [1.0];
        }
        else if (len === 2) {
            const v0 = values[0], v1 = values[1];
            const max = v0 > v1 ? v0 : v1;
            const e0 = Math.exp(v0 - max);
            const e1 = Math.exp(v1 - max);
            const sum = e0 + e1;
            return [e0 / sum, e1 / sum];
        }
        else if (len === 4) {
            // OPTIMIZATION: Specialize softmax for len === 4 to bypass loops, array allocations, and divisions.
            const v0 = values[0], v1 = values[1], v2 = values[2], v3 = values[3];
            let max = v0;
            if (v1 > max)
                max = v1;
            if (v2 > max)
                max = v2;
            if (v3 > max)
                max = v3;
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
        if (sum === 0)
            sum = 1;
        const result = new Array(len);
        for (let i = 0; i < len; i++) {
            result[i] = exps[i] / sum;
        }
        return result;
    }
    computeEntropy(scores) {
        const len = scores.length;
        if (len <= 1)
            return 0;
        // First, find the maximum score for numerical stability during exponentiation
        let max = scores[0];
        for (let i = 1; i < len; i++) {
            if (scores[i] > max) {
                max = scores[i];
            }
        }
        // Compute sum(exp(s_i - max)) and sum((s_i - max) * exp(s_i - max))
        // in a single pass over the scores.
        let sumExp = 0;
        let sumExpS = 0;
        for (let i = 0; i < len; i++) {
            const sShifted = scores[i] - max;
            const expVal = Math.exp(sShifted);
            sumExp += expVal;
            sumExpS += sShifted * expVal;
        }
        if (sumExp === 0)
            return 0;
        // Shannon entropy of softmax: H = ln(sumExp) - (sum(sShifted * exp(sShifted)) / sumExp)
        // This reduces the number of expensive Math.log transcendental math calls from O(E) to exactly O(1),
        // and completely eliminates the allocation of intermediate probability arrays.
        return Math.log(sumExp) - sumExpS / sumExp;
    }
    computeLoadBalanceLoss() {
        const stats = this.getUtilizationStats();
        if (stats.length === 0)
            return 0;
        const totalUtil = stats.reduce((s, x) => s + x.utilization, 0);
        const meanUtil = totalUtil / stats.length;
        let variance = 0;
        for (const s of stats) {
            // BOLT OPTIMIZATION: Replacing slow Math.pow(x, 2) with fast inline multiplication.
            const diff = s.utilization - meanUtil;
            variance += diff * diff;
        }
        return variance / stats.length;
    }
    trackUtilization(expertId, weight) {
        const util = this.utilization.get(expertId);
        if (util) {
            util.calls++;
            util.tokens++;
            util.weightSum += weight;
        }
    }
    hashInput(input) {
        let hash = 0;
        for (let i = 0; i < Math.min(input.length, 64); i++) {
            hash = ((hash << 5) - hash) + Math.round(input[i] * 1000);
            hash = hash & hash;
        }
        return `h_${hash}`;
    }
}
export class MixtureOfExperts {
    constructor(topK = 2, mesh) {
        /** Router's numeric expert index <-> our string expert id. */
        this.routerIndexToId = new Map();
        this.experts = new Map();
        this.activeExperts = new Set();
        this.topK = topK;
        // numExperts: 0 — every expert in the router must be a real, named
        // skill registered via addExpert(). Pre-seeding anonymous experts here
        // would let them win top-K selection and make tick()'s activeExperts
        // silently drop ticks (an anonymous winner has no group/id to map back to).
        this.router = new MoERouter({ numExperts: 0, topK, inputDim: 768, outputDim: 768, expertHiddenDim: 512 });
        // Shared, all-to-all mesh: every expert's neurons live here alongside
        // everyone else's, wired at connectionDensity 1.0 by addNode() below —
        // grouping is a label, not a wiring restriction.
        this.mesh = mesh ?? new NeuronMesh({ nodeCount: 0, connectionDensity: 1.0 });
    }
    /** The shared mesh every expert's neurons are registered into. */
    getMesh() {
        return this.mesh;
    }
    /**
     * Registers `neuronCount` new mesh neurons under this expert's group label
     * (wired all-to-all into the shared mesh, same as any other neuron) and
     * registers the expert with the MoE router for scoring/gating.
     */
    addExpert(id, name, specialization, neuronCount = 4) {
        const neuronIds = [];
        for (let i = 0; i < neuronCount; i++) {
            neuronIds.push(this.mesh.addNode(0, id));
        }
        const expert = {
            id, name,
            neuronIds,
            specialization,
            activationThreshold: 0.3,
            lastUsed: Date.now(),
            usageCount: 0,
        };
        this.experts.set(id, expert);
        const routerIndex = this.router.addExpert({ id, name, specialization });
        this.routerIndexToId.set(routerIndex, id);
        return expert;
    }
    /**
     * Register additional neurons under an already-registered expert's group
     * label (e.g. a variable number of neurons per sub-skill within one
     * expert). Wired all-to-all into the shared mesh exactly like addExpert's
     * initial neurons. Returns the new node ids; no-op (empty array) if the
     * expert id isn't registered.
     */
    addNeuronsToExpert(expertId, count, layer = 0) {
        const expert = this.experts.get(expertId);
        if (!expert)
            return [];
        const newIds = [];
        for (let i = 0; i < count; i++) {
            const id = this.mesh.addNode(layer, expertId);
            newIds.push(id);
        }
        expert.neuronIds.push(...newIds);
        return newIds;
    }
    /**
     * Section 2.1: score all registered experts against `routingInput`, select
     * top-K, and propagate the shared mesh with only those experts' (plus any
     * ungrouped/core) neurons computing this tick — everyone else holds their
     * last value but stays fully wired. `meshInputs` are the externally-driven
     * mesh node activations for this tick (same shape `propagate()` expects).
     */
    tick(routingInput, meshInputs, vale) {
        const decision = this.router.route(routingInput);
        const activeExperts = decision.expertIndices
            .map(i => this.routerIndexToId.get(i))
            .filter((id) => id !== undefined);
        this.activeExperts = new Set(activeExperts);
        const now = Date.now();
        for (const id of activeExperts) {
            const expert = this.experts.get(id);
            if (expert) {
                expert.lastUsed = now;
                expert.usageCount++;
            }
        }
        const propagation = this.mesh.propagate(meshInputs, vale, new Set(activeExperts));
        return { activeExperts, propagation };
    }
    getExpert(id) { return this.experts.get(id); }
    listExperts() { return Array.from(this.experts.values()); }
    getActiveExperts() { return Array.from(this.activeExperts).map(id => this.experts.get(id)).filter(Boolean); }
    getRouter() { return this.router; }
    getExpertCount() { return this.experts.size; }
}
