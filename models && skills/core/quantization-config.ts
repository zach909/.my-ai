// Background Quantization — configuration loading.
//
// Reads config/quantization.json (repo root) and merges it over hard
// defaults, so the file only needs to specify overrides. Every field is
// validated/clamped rather than trusted verbatim — this config can come
// from a checked-in file that's hand-edited, so a typo (a string where a
// number is expected, a stray negative bits value) must degrade to a safe
// default instead of poisoning every quantized weight downstream.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { clampBits, type QuantizationMethod, type QuantizationMode, type QuantizerConfig } from './onebrain.js';
import type { MixedPrecisionPolicy } from './quantization-hardware.js';

export interface QuantizationSystemConfig {
  quantizer: QuantizerConfig;
  layersPerTick: number;
  mixedPrecisionPolicy?: MixedPrecisionPolicy;
}

const VALID_METHODS: QuantizationMethod[] = ['symmetric', 'asymmetric', 'mixed'];
const VALID_MODES: QuantizationMode[] = ['dynamic', 'static'];

export const DEFAULT_QUANTIZATION_CONFIG: QuantizationSystemConfig = {
  quantizer: {
    enabled: true,
    bits: 8,
    method: 'mixed',
    mode: 'dynamic',
    calibrationSamples: 256,
    excludeLayers: [],
  },
  layersPerTick: 4,
};

function coerceMethod(value: unknown, fallback: QuantizationMethod): QuantizationMethod {
  return typeof value === 'string' && (VALID_METHODS as string[]).includes(value)
    ? (value as QuantizationMethod)
    : fallback;
}

function coerceMode(value: unknown, fallback: QuantizationMode): QuantizationMode {
  return typeof value === 'string' && (VALID_MODES as string[]).includes(value)
    ? (value as QuantizationMode)
    : fallback;
}

/** Merge an arbitrary parsed-JSON blob over the defaults, validating every field. */
export function normalizeQuantizationConfig(raw: unknown): QuantizationSystemConfig {
  const input = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const defaults = DEFAULT_QUANTIZATION_CONFIG;

  const excludeLayers = Array.isArray(input.excludeLayers)
    ? input.excludeLayers.filter((v): v is string => typeof v === 'string')
    : defaults.quantizer.excludeLayers;

  const quantizer: QuantizerConfig = {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : defaults.quantizer.enabled,
    bits: clampBits(input.bits, defaults.quantizer.bits),
    method: coerceMethod(input.method, defaults.quantizer.method),
    mode: coerceMode(input.mode, defaults.quantizer.mode ?? 'dynamic'),
    calibrationSamples: Number.isFinite(Number(input.calibrationSamples))
      ? Math.max(0, Math.floor(Number(input.calibrationSamples)))
      : defaults.quantizer.calibrationSamples,
    excludeLayers,
  };

  const layersPerTick = Number.isFinite(Number(input.layersPerTick))
    ? Math.max(1, Math.floor(Number(input.layersPerTick)))
    : defaults.layersPerTick;

  let mixedPrecisionPolicy: MixedPrecisionPolicy | undefined;
  const rawPolicy = input.mixedPrecisionPolicy;
  if (rawPolicy && typeof rawPolicy === 'object') {
    const p = rawPolicy as Record<string, unknown>;
    const rules = Array.isArray(p.rules)
      ? p.rules
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map(r => ({
            pattern: typeof r.pattern === 'string' ? new RegExp(r.pattern) : /^$/,
            bits: clampBits(r.bits, quantizer.bits),
          }))
      : [];
    mixedPrecisionPolicy = {
      defaultBits: clampBits(p.defaultBits, quantizer.bits),
      sensitivityAdjust: typeof p.sensitivityAdjust === 'boolean' ? p.sensitivityAdjust : false,
      rules,
    };
  }

  return { quantizer, layersPerTick, mixedPrecisionPolicy };
}

/**
 * Load config/quantization.json relative to the given repo root (defaults
 * to process.cwd()). Missing file or parse failure falls back to
 * DEFAULT_QUANTIZATION_CONFIG rather than throwing — a background
 * subsystem shouldn't take down startup over an optional config file.
 */
export async function loadQuantizationConfig(repoRoot: string = process.cwd()): Promise<QuantizationSystemConfig> {
  const configPath = path.join(repoRoot, 'config', 'quantization.json');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return normalizeQuantizationConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_QUANTIZATION_CONFIG;
  }
}
