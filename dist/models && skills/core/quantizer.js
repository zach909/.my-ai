export class BackgroundQuantizer {
    config;
    constructor(config) {
        this.config = { ...config };
    }
    /**
     * Quantize a Float32Array to N-bit integers then dequantize back.
     * Symmetric: clamp to ±absMax, scale = absMax / (2^(bits-1) - 1).
     * Asymmetric: min/max scale, zeroPoint offset.
     * Mixed: uses symmetric for layers with large spread, asymmetric otherwise.
     */
    quantize(weights, bits) {
        const effectiveBits = bits ?? this.config.bits;
        const method = this.config.method;
        const levels = Math.pow(2, effectiveBits) - 1;
        const qMax = Math.floor(levels / 2);
        const qMin = -qMax;
        let wMin = Infinity;
        let wMax = -Infinity;
        for (let i = 0; i < weights.length; i++) {
            if (weights[i] < wMin)
                wMin = weights[i];
            if (weights[i] > wMax)
                wMax = weights[i];
        }
        // Degenerate case: all same value
        if (wMax === wMin) {
            return new Float32Array(weights);
        }
        const absMax = Math.max(Math.abs(wMin), Math.abs(wMax));
        // Mixed: use symmetric when the range is roughly balanced (absMax close to symmetric bound)
        const symmetryRatio = absMax > 0 ? Math.min(Math.abs(wMin), Math.abs(wMax)) / absMax : 0;
        const useSymmetric = method === 'symmetric' || (method === 'mixed' && symmetryRatio > 0.5);
        const result = new Float32Array(weights.length);
        if (useSymmetric) {
            // Symmetric: zero is exactly representable, scale = absMax / qMax
            const scale = absMax / qMax || 1;
            for (let i = 0; i < weights.length; i++) {
                const q = Math.round(weights[i] / scale);
                const qClamped = Math.max(qMin, Math.min(qMax, q));
                result[i] = qClamped * scale;
            }
        }
        else {
            // Asymmetric: zeroPoint offsets the quantized domain
            const scale = (wMax - wMin) / levels || 1;
            const zeroPoint = Math.round(-wMin / scale);
            const qLevelMin = 0;
            const qLevelMax = Math.round(levels);
            for (let i = 0; i < weights.length; i++) {
                const q = Math.round(weights[i] / scale + zeroPoint);
                const qClamped = Math.max(qLevelMin, Math.min(qLevelMax, q));
                result[i] = (qClamped - zeroPoint) * scale;
            }
        }
        return result;
    }
    /**
     * Applies quantize() to each key not in excludeLayers.
     */
    quantizeModel(model) {
        const result = {};
        const excluded = new Set(this.config.excludeLayers);
        for (const key of Object.keys(model)) {
            if (excluded.has(key)) {
                result[key] = model[key];
            }
            else {
                result[key] = this.quantize(model[key]);
            }
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
    getConfig() {
        return { ...this.config };
    }
}
