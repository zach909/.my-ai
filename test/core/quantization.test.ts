/**
 * Tests for the Background Quantization system: core quantize/pack
 * primitives (quantizer.ts), hardware/mixed-precision estimation
 * (quantization-hardware.ts), the background scheduler
 * (quantization-scheduler.ts), and config normalization
 * (quantization-config.ts).
 */

import {
  BackgroundQuantizer,
  CalibrationCollector,
  packLevels,
  unpackLevels,
  clampBits,
} from '../../models && skills/core/quantizer.js';
import {
  detectHardwareProfile,
  computeSensitivity,
  resolveLayerBits,
  estimateMemorySavings,
  estimatePowerSavingsPercent,
  estimatePerformanceGain,
} from '../../models && skills/core/quantization-hardware.js';
import { BackgroundQuantizationScheduler } from '../../models && skills/core/quantization-scheduler.js';
import {
  normalizeQuantizationConfig,
  DEFAULT_QUANTIZATION_CONFIG,
} from '../../models && skills/core/quantization-config.js';

function makeQuantizer(overrides: Partial<{ bits: number; method: 'symmetric' | 'asymmetric' | 'mixed' }> = {}) {
  return new BackgroundQuantizer({
    enabled: true,
    bits: overrides.bits ?? 8,
    method: overrides.method ?? 'symmetric',
    calibrationSamples: 0,
    excludeLayers: [],
  });
}

describe('clampBits', () => {
  test('clamps into [2, 16]', () => {
    expect(clampBits(1)).toBe(2);
    expect(clampBits(99)).toBe(16);
    expect(clampBits(8)).toBe(8);
  });

  test('falls back to default on non-finite input instead of propagating NaN', () => {
    expect(clampBits(NaN)).toBe(8);
    expect(clampBits(undefined)).toBe(8);
    expect(clampBits('not-a-number')).toBe(8);
    expect(clampBits(NaN, 4)).toBe(4);
  });
});

describe('BackgroundQuantizer.quantize (dynamic mode)', () => {
  test('round-trips a symmetric tensor within one quantization step', () => {
    const q = makeQuantizer({ bits: 8, method: 'symmetric' });
    const weights = new Float32Array([-1, -0.5, 0, 0.5, 1]);
    const out = q.quantize(weights);
    expect(out.length).toBe(weights.length);
    for (let i = 0; i < weights.length; i++) {
      expect(Math.abs(out[i] - weights[i])).toBeLessThan(0.02);
    }
  });

  test('degenerate (all-equal) tensor returns an unchanged copy, not NaN', () => {
    const q = makeQuantizer();
    const weights = new Float32Array([3, 3, 3, 3]);
    const out = q.quantize(weights);
    expect(Array.from(out)).toEqual([3, 3, 3, 3]);
  });

  test('asymmetric method handles a skewed positive-only range', () => {
    const q = makeQuantizer({ bits: 8, method: 'asymmetric' });
    const weights = new Float32Array([0, 10, 20, 30, 40]);
    const out = q.quantize(weights);
    for (let i = 0; i < weights.length; i++) {
      expect(Math.abs(out[i] - weights[i])).toBeLessThan(1);
    }
  });

  test('bits argument overrides config bits per call', () => {
    const q = makeQuantizer({ bits: 8 });
    const weights = new Float32Array([-1, -0.3, 0.7, 1]);
    const coarse = q.quantize(weights, 2);
    const fine = q.quantize(weights, 16);
    const coarseErr = Math.abs(coarse[1] - weights[1]);
    const fineErr = Math.abs(fine[1] - weights[1]);
    expect(fineErr).toBeLessThanOrEqual(coarseErr);
  });

  test('never produces NaN across a spread of bit widths', () => {
    const weights = new Float32Array([-5, -1.2, 0, 0.3, 4.4]);
    for (const bits of [2, 3, 4, 8, 12, 16]) {
      const q = makeQuantizer({ bits });
      const out = q.quantize(weights);
      for (const v of out) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('CalibrationCollector + quantizeStatic', () => {
  test('accumulates stats across multiple observe() batches', () => {
    const collector = new CalibrationCollector();
    expect(collector.hasSamples()).toBe(false);
    collector.observe(new Float32Array([1, 2, 3]));
    collector.observe(new Float32Array([-4, 5]));
    const stats = collector.finalize();
    expect(stats.min).toBe(-4);
    expect(stats.max).toBe(5);
    expect(stats.count).toBe(5);
    expect(stats.absMax).toBe(5);
  });

  test('empty collector finalizes to a zeroed, non-throwing result', () => {
    const stats = new CalibrationCollector().finalize();
    expect(stats).toEqual({ min: 0, max: 0, absMax: 0, mean: 0, count: 0 });
  });

  test('quantizeStatic reuses calibration stats instead of the call-time tensor range', () => {
    const q = makeQuantizer({ bits: 8, method: 'asymmetric' });
    q.calibrate('layer1', new Float32Array([0, 100]));
    const stats = q.getCalibrationStats('layer1')!;
    // A narrow-range tensor quantized against the *wide* calibration range
    // should land close to its true values but with static (not per-call)
    // rounding granularity — verifies the fixed scale is actually applied.
    const narrow = new Float32Array([40, 50, 60]);
    const out = q.quantizeStatic(narrow, stats);
    for (let i = 0; i < narrow.length; i++) {
      expect(Math.abs(out[i] - narrow[i])).toBeLessThan(1);
    }
  });

  test('quantizeStatic on empty stats returns an unchanged copy', () => {
    const q = makeQuantizer();
    const stats = new CalibrationCollector().finalize();
    const weights = new Float32Array([1, 2, 3]);
    expect(Array.from(q.quantizeStatic(weights, stats))).toEqual([1, 2, 3]);
  });
});

describe('bit packing (real memory reduction)', () => {
  test('packLevels/unpackLevels round-trip exactly for arbitrary bit widths', () => {
    for (const bits of [2, 3, 4, 8, 12, 16]) {
      const max = Math.pow(2, bits) - 1;
      const levels = new Uint32Array([0, 1, max, Math.floor(max / 2), max - 1]);
      const packed = packLevels(levels, bits);
      const unpacked = unpackLevels(packed, levels.length, bits);
      expect(Array.from(unpacked)).toEqual(Array.from(levels));
    }
  });

  test('BackgroundQuantizer.pack/unpack round-trips within one quantization step', () => {
    const q = makeQuantizer({ bits: 8, method: 'symmetric' });
    const weights = new Float32Array([-2, -1, 0, 1, 2, 1.5, -1.5]);
    const tensor = q.pack(weights);
    expect(tensor.length).toBe(weights.length);
    // 8 bits * 7 elements = 56 bits = 7 bytes, vs 28 bytes as float32.
    expect(tensor.packed.length).toBe(7);
    const out = q.unpack(tensor);
    for (let i = 0; i < weights.length; i++) {
      expect(Math.abs(out[i] - weights[i])).toBeLessThan(0.05);
    }
  });

  test('pack() uses calibration stats for the named layer when present', () => {
    const q = makeQuantizer({ bits: 8, method: 'asymmetric' });
    q.calibrate('w1', new Float32Array([0, 200]));
    const tensor = q.pack(new Float32Array([50, 100]), 'w1');
    expect(tensor.scaleInfo.symmetric).toBe(false);
    // Scale derives from the calibrated [0,200] range, not the passed-in [50,100].
    expect(tensor.scaleInfo.scale).toBeCloseTo(200 / 255, 5);
  });
});

describe('quantizeModel / packModel / serialization', () => {
  test('quantizeModel skips excluded layers verbatim', () => {
    const q = new BackgroundQuantizer({
      enabled: true, bits: 4, method: 'symmetric', calibrationSamples: 0, excludeLayers: ['keep_me'],
    });
    const model = { keep_me: new Float32Array([1, 2, 3]), quantize_me: new Float32Array([1, 2, 3]) };
    const out = q.quantizeModel(model);
    expect(Array.from(out.keep_me)).toEqual([1, 2, 3]);
    expect(out.quantize_me).not.toBe(model.quantize_me);
  });

  test('serializeQuantized / round trip through JSON', () => {
    const q = makeQuantizer();
    const model = { a: new Float32Array([1, 2]), b: new Float32Array([3, 4]) };
    const json = JSON.parse(q.serializeQuantized(q.quantizeModel(model)));
    expect(json.quantized).toBe(true);
    expect(json.weights.a[0]).toBeCloseTo(1, 1);
    expect(json.weights.a[1]).toBeCloseTo(2, 1);
  });

  test('serializePacked / deserializePacked round trip preserves values', () => {
    const q = makeQuantizer({ bits: 8, method: 'symmetric' });
    const model = { layerA: new Float32Array([-1, 0, 1, 0.5]) };
    const packed = q.packModel(model);
    const json = q.serializePacked(packed);
    const restored = q.deserializePacked(json);
    const out = q.unpack(restored.layerA);
    for (let i = 0; i < model.layerA.length; i++) {
      expect(Math.abs(out[i] - model.layerA[i])).toBeLessThan(0.05);
    }
  });
});

describe('hardware profile + mixed precision + estimates', () => {
  test('detectHardwareProfile returns internally consistent values', () => {
    const profile = detectHardwareProfile();
    expect(profile.cores).toBeGreaterThanOrEqual(1);
    expect([64, 128, 256]).toContain(profile.simdWidthBits);
    expect(profile.preferredBits).toBeGreaterThanOrEqual(2);
  });

  test('computeSensitivity is 0 for a constant tensor and positive for a spread one', () => {
    expect(computeSensitivity(new Float32Array([5, 5, 5]))).toBe(0);
    expect(computeSensitivity(new Float32Array([1, 100, -50, 3]))).toBeGreaterThan(0);
  });

  test('resolveLayerBits honors explicit rules over defaults', () => {
    const bits = resolveLayerBits('output_bias', new Float32Array([1, 2, 3]), {
      defaultBits: 8,
      rules: [{ pattern: /bias$/, bits: 16 }],
    });
    expect(bits).toBe(16);
  });

  test('resolveLayerBits falls back to defaultBits with no matching rule', () => {
    const bits = resolveLayerBits('hidden_1', new Float32Array([1, 2, 3]), {
      defaultBits: 8,
      rules: [{ pattern: /bias$/, bits: 16 }],
    });
    expect(bits).toBe(8);
  });

  test('estimateMemorySavings matches the packed-byte math', () => {
    const est = estimateMemorySavings(1000, 8);
    expect(est.originalBytes).toBe(4000);
    expect(est.quantizedBytes).toBe(1000);
    expect(est.savedBytes).toBe(3000);
    expect(est.compressionRatio).toBeCloseTo(4, 5);
  });

  test('lower bit widths estimate greater power savings and performance gain', () => {
    const profile = detectHardwareProfile();
    const power8 = estimatePowerSavingsPercent(8, profile);
    const power16 = estimatePowerSavingsPercent(16, profile);
    expect(power8).toBeGreaterThan(power16);

    const perf8 = estimatePerformanceGain(8, profile);
    const perf16 = estimatePerformanceGain(16, profile);
    expect(perf8).toBeGreaterThan(perf16);
  });
});

describe('BackgroundQuantizationScheduler', () => {
  test('enqueue -> waitFor produces packed tensors for every non-excluded layer', async () => {
    const scheduler = new BackgroundQuantizationScheduler();
    const model = {
      layerA: new Float32Array([1, 2, 3]),
      layerB: new Float32Array([-1, -2, -3]),
      skip: new Float32Array([9, 9, 9]),
    };
    const jobId = scheduler.quantizeAfterBuild(model, {
      quantizerConfig: { enabled: true, bits: 8, method: 'symmetric', calibrationSamples: 0, excludeLayers: ['skip'] },
      layersPerTick: 1,
    });
    const result = await scheduler.waitFor(jobId);
    expect(Object.keys(result.packed).sort()).toEqual(['layerA', 'layerB']);
    expect(result.bitsByLayer.layerA).toBe(8);
  });

  test('progress reaches done with all layers accounted for', async () => {
    const scheduler = new BackgroundQuantizationScheduler();
    const events: string[] = [];
    scheduler.onProgress(p => events.push(p.status));
    const model = { a: new Float32Array([1, 2]), b: new Float32Array([3, 4]) };
    const jobId = scheduler.quantizeAfterBuild(model, {
      quantizerConfig: { enabled: true, bits: 8, method: 'symmetric', calibrationSamples: 0, excludeLayers: [] },
    });
    await scheduler.waitFor(jobId);
    const finalProgress = scheduler.getJob(jobId)!;
    expect(finalProgress.status).toBe('done');
    expect(finalProgress.layersDone).toBe(2);
    expect(events).toContain('done');
  });

  test('mixed precision policy assigns different bit widths per layer', async () => {
    const scheduler = new BackgroundQuantizationScheduler();
    const model = {
      output_bias: new Float32Array([1, 2, 3]),
      hidden_1: new Float32Array([1, 2, 3]),
    };
    const jobId = scheduler.quantizeAfterBuild(model, {
      quantizerConfig: { enabled: true, bits: 8, method: 'symmetric', calibrationSamples: 0, excludeLayers: [] },
      mixedPrecisionPolicy: { defaultBits: 8, rules: [{ pattern: /bias$/, bits: 16 }] },
    });
    const result = await scheduler.waitFor(jobId);
    expect(result.bitsByLayer.output_bias).toBe(16);
    expect(result.bitsByLayer.hidden_1).toBe(8);
  });

  test('waitFor on an unknown jobId throws', async () => {
    const scheduler = new BackgroundQuantizationScheduler();
    await expect(scheduler.waitFor('does_not_exist')).rejects.toThrow();
  });

  test('calibration data feeds static-style quantization before the quantizing phase', async () => {
    const scheduler = new BackgroundQuantizationScheduler();
    const model = { w: new Float32Array([10, 20, 30]) };
    const jobId = scheduler.quantizeAfterBuild(model, {
      quantizerConfig: { enabled: true, bits: 8, method: 'asymmetric', calibrationSamples: 0, excludeLayers: [] },
      calibrationData: { w: new Float32Array([0, 100]) },
    });
    const progress = scheduler.getJob(jobId);
    expect(progress).toBeDefined();
    const result = await scheduler.waitFor(jobId);
    expect(result.packed.w.scaleInfo.scale).toBeCloseTo(100 / 255, 5);
  });
});

describe('quantization-config normalization', () => {
  test('empty input falls back to defaults', () => {
    const cfg = normalizeQuantizationConfig({});
    expect(cfg.quantizer.bits).toBe(DEFAULT_QUANTIZATION_CONFIG.quantizer.bits);
    expect(cfg.quantizer.method).toBe(DEFAULT_QUANTIZATION_CONFIG.quantizer.method);
  });

  test('invalid method/mode strings fall back rather than propagating garbage', () => {
    const cfg = normalizeQuantizationConfig({ method: 'not-a-method', mode: 'not-a-mode' });
    expect(cfg.quantizer.method).toBe(DEFAULT_QUANTIZATION_CONFIG.quantizer.method);
    expect(cfg.quantizer.mode).toBe('dynamic');
  });

  test('out-of-range bits get clamped, not rejected', () => {
    const cfg = normalizeQuantizationConfig({ bits: 999 });
    expect(cfg.quantizer.bits).toBe(16);
  });

  test('mixedPrecisionPolicy rules with string patterns compile to RegExp', () => {
    const cfg = normalizeQuantizationConfig({
      mixedPrecisionPolicy: { defaultBits: 8, rules: [{ pattern: 'bias$', bits: 16 }] },
    });
    expect(cfg.mixedPrecisionPolicy?.rules[0].pattern).toBeInstanceOf(RegExp);
    expect(cfg.mixedPrecisionPolicy?.rules[0].bits).toBe(16);
  });
});

describe('Memory-Optimized Quantization Out-Buffer & RLMTrainer (Bolt)', () => {
  test('BackgroundQuantizer.quantize supports optional out-buffer parameter', () => {
    const q = makeQuantizer({ bits: 8, method: 'symmetric' });
    const weights = new Float32Array([-1.0, -0.5, 0.0, 0.5, 1.0]);
    const outBuffer = new Float32Array(weights.length);

    const returned = q.quantize(weights, undefined, outBuffer);

    expect(returned).toBe(outBuffer); // Ensure it wrote in-place to the supplied buffer
    expect(outBuffer[0]).toBeCloseTo(-1.0, 2);
    expect(outBuffer[4]).toBeCloseTo(1.0, 2);
  });

  test('BackgroundQuantizer.quantizeStatic supports optional out-buffer parameter', () => {
    const q = makeQuantizer({ bits: 8, method: 'asymmetric' });
    const stats = { min: -1.0, max: 1.0, absMax: 1.0, mean: 0.0, count: 5 };
    const weights = new Float32Array([-0.8, 0.0, 0.8]);
    const outBuffer = new Float32Array(weights.length);

    const returned = q.quantizeStatic(weights, stats, undefined, outBuffer);

    expect(returned).toBe(outBuffer); // Ensure it wrote in-place to the supplied buffer
    expect(outBuffer[0]).toBeCloseTo(-0.8, 2);
  });

  test('RLMTrainer utilizes pre-allocated scratch buffers and executes training correctly', async () => {
    const { RLMTrainer } = await import('../../models && skills/core/rlm.js');
    const trainer = new RLMTrainer({
      stateDim: 8,
      actionDim: 3,
      quantizationEnabled: true,
      replayBufferSize: 10,
    });

    const state = new Float32Array(8).fill(0.5);
    const nextState = new Float32Array(8).fill(0.1);

    trainer.addExperience({
      state,
      action: 1,
      reward: 1.5,
      nextState,
      done: false,
      priority: 1.0,
      timestamp: Date.now()
    });

    const res = await trainer.train();
    expect(res.loss).toBeDefined();
    expect(res.stepsTrained).toBe(1);
  });
});
