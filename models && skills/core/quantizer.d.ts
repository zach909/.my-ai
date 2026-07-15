export interface QuantizerConfig {
    enabled: boolean;
    bits: number;
    method: 'symmetric' | 'asymmetric' | 'mixed';
    calibrationSamples: number;
    excludeLayers: string[];
}
export declare class BackgroundQuantizer {
    private config;
    constructor(config: QuantizerConfig);
    /**
     * Quantize a Float32Array to N-bit integers then dequantize back.
     * Symmetric: clamp to ±absMax, scale = absMax / (2^(bits-1) - 1).
     * Asymmetric: min/max scale, zeroPoint offset.
     * Mixed: uses symmetric for layers with large spread, asymmetric otherwise.
     */
    quantize(weights: Float32Array, bits?: number): Float32Array;
    /**
     * Applies quantize() to each key not in excludeLayers.
     */
    quantizeModel(model: Record<string, Float32Array>): Record<string, Float32Array>;
    /**
     * Serialize a quantized model to JSON string.
     */
    serializeQuantized(model: Record<string, Float32Array>): string;
    getConfig(): QuantizerConfig;
}
