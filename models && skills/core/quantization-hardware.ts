// Background Quantization — hardware profiling, mixed precision policy,
// and memory/power/performance estimation.
//
// None of this touches the actual weight math (that's quantizer.ts); it
// answers "how many bits should this layer get, and what does that buy us"
// so the scheduler and the extension builder can make that call without
// every caller re-deriving the same heuristics.

import * as os from 'node:os';

export type HardwareKernel = 'scalar' | 'simd128' | 'simd256' | 'int8-dot';

export interface HardwareProfile {
  name: string;
  cores: number;
  /** Bits handled per SIMD lane group; 128/256 map to common SSE/AVX2-class widths, 64 is a conservative fallback. */
  simdWidthBits: 64 | 128 | 256;
  /** Whether the runtime should assume fast native int8 dot-product paths (heuristic, not real feature detection). */
  supportsInt8Dot: boolean;
  /** Bit width this profile gets the best combination of speed/memory from. */
  preferredBits: number;
  preferredKernel: HardwareKernel;
}

/**
 * Best-effort hardware profile from what Node exposes (core count, arch).
 * There's no real SIMD/ISA feature detection available from JS alone, so
 * this is a conservative heuristic: more cores and a 64-bit arch bias
 * toward wider kernels and int8 as the default target; low-core-count
 * environments (e.g. constrained containers) bias toward more aggressive
 * (lower-bit) quantization to keep memory pressure down instead.
 */
export function detectHardwareProfile(): HardwareProfile {
  const cores = Math.max(1, os.cpus()?.length ?? 1);
  const arch64 = os.arch() === 'x64' || os.arch() === 'arm64';
  const simdWidthBits: HardwareProfile['simdWidthBits'] = arch64 ? (cores >= 4 ? 256 : 128) : 64;
  const supportsInt8Dot = arch64 && cores >= 2;
  const preferredBits = cores <= 1 ? 4 : supportsInt8Dot ? 8 : 8;
  const preferredKernel: HardwareKernel = supportsInt8Dot ? 'int8-dot' : simdWidthBits >= 128 ? 'simd128' : 'scalar';
  return {
    name: `${os.arch()}-${cores}core`,
    cores,
    simdWidthBits,
    supportsInt8Dot,
    preferredBits,
    preferredKernel,
  };
}

// ─── Mixed precision ────────────────────────────────────────────────────────

export interface LayerPrecisionRule {
  /** Matched against layer key with RegExp.test() (or exact string equality for a plain string). */
  pattern: RegExp | string;
  bits: number;
}

export interface MixedPrecisionPolicy {
  /** Bits used for any layer that matches no rule and isn't sensitivity-adjusted. */
  defaultBits: number;
  rules: LayerPrecisionRule[];
  /**
   * When set, layers not covered by an explicit rule get their bit width
   * nudged by sensitivity: high-spread (high coefficient-of-variation)
   * layers are assumed more sensitive to rounding and keep defaultBits+4
   * (capped at 16); low-spread layers drop to defaultBits-2 (floored at 2).
   */
  sensitivityAdjust?: boolean;
}

function matchesRule(layerKey: string, rule: LayerPrecisionRule): boolean {
  return typeof rule.pattern === 'string' ? rule.pattern === layerKey : rule.pattern.test(layerKey);
}

/** Coefficient of variation (stddev / |mean|) as a cheap proxy for how "spread out" a tensor's values are. */
export function computeSensitivity(weights: Float32Array): number {
  if (weights.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += weights[i];
  const mean = sum / weights.length;
  let variance = 0;
  for (let i = 0; i < weights.length; i++) {
    const d = weights[i] - mean;
    variance += d * d;
  }
  variance /= weights.length;
  const stddev = Math.sqrt(variance);
  return stddev / (Math.abs(mean) || 1);
}

/** Resolve the bit width a specific layer should use under a mixed precision policy. */
export function resolveLayerBits(
  layerKey: string,
  weights: Float32Array,
  policy: MixedPrecisionPolicy,
): number {
  for (const rule of policy.rules) {
    if (matchesRule(layerKey, rule)) return clampToValidBits(rule.bits);
  }
  if (policy.sensitivityAdjust) {
    const sensitivity = computeSensitivity(weights);
    if (sensitivity > 1) return clampToValidBits(policy.defaultBits + 4);
    if (sensitivity < 0.1) return clampToValidBits(policy.defaultBits - 2);
  }
  return clampToValidBits(policy.defaultBits);
}

function clampToValidBits(bits: number): number {
  return Math.max(2, Math.min(16, Math.floor(bits)));
}

// ─── Memory / power / performance estimation ───────────────────────────────

export interface MemoryEstimate {
  originalBytes: number;
  quantizedBytes: number;
  savedBytes: number;
  compressionRatio: number;
}

/** Float32 tensor -> packed N-bit tensor memory delta. */
export function estimateMemorySavings(elementCount: number, bits: number): MemoryEstimate {
  const originalBytes = elementCount * 4;
  const quantizedBytes = Math.ceil((elementCount * bits) / 8);
  return {
    originalBytes,
    quantizedBytes,
    savedBytes: originalBytes - quantizedBytes,
    compressionRatio: quantizedBytes > 0 ? originalBytes / quantizedBytes : Infinity,
  };
}

/**
 * Heuristic power-draw reduction estimate relative to fp32. Narrower
 * integer ops move fewer bits per cycle and (on hardware with an int8 dot
 * path) skip float ALUs entirely, so this models savings as roughly linear
 * in bits saved versus fp32, with a fixed bonus when the target profile has
 * a dedicated int8 path. This is a planning-time estimate, not a measured
 * figure — it exists so the scheduler/report can surface a number, not to
 * be cited as a hardware benchmark.
 */
export function estimatePowerSavingsPercent(bits: number, profile: HardwareProfile): number {
  const bitRatio = 1 - bits / 32;
  const int8Bonus = bits <= 8 && profile.supportsInt8Dot ? 0.1 : 0;
  return Math.max(0, Math.min(0.9, bitRatio + int8Bonus)) * 100;
}

/**
 * Heuristic throughput multiplier relative to fp32 scalar execution.
 * Wider SIMD lanes fit more narrow-width elements per instruction
 * (simdWidthBits / bits lanes vs simdWidthBits / 32 for fp32), and an
 * int8 dot-product kernel gets an additional fixed multiplier on top.
 */
export function estimatePerformanceGain(bits: number, profile: HardwareProfile): number {
  const fp32Lanes = profile.simdWidthBits / 32;
  const quantizedLanes = profile.simdWidthBits / bits;
  const laneGain = quantizedLanes / fp32Lanes;
  const kernelBonus = bits <= 8 && profile.supportsInt8Dot ? 1.5 : 1;
  return laneGain * kernelBonus;
}
