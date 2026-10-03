/**
 * shared-mesh.ts — "when one person's agent learns, everyone's agent learns",
 * done with WEIGHT CHANGES rather than conversation text.
 *
 * The live mesh (the one HyperDimensionalEngine NeuroPipeline.ensureBrain()
 * builds) trains itself on everything fed through its Zip Loop doorway. This
 * module makes that learning (a) survive restarts and (b) travel between
 * installs through this project's GitHub repository:
 *
 *   base   extension-builder/shared-mesh/base.json          (tracked)
 *          One canonical starting network. The engine initialises from
 *          Math.random(), so without a shared start neuron 5 on one machine
 *          has nothing to do with neuron 5 on another, and averaging their
 *          changes would be averaging noise. Every install loads this first.
 *
 *   delta  extension-builder/shared-mesh/deltas/<id>.json   (tracked)
 *          One file per install: how far THAT install's own learning has
 *          moved the shared block away from base, int8-quantised and gzipped.
 *          <id> is random, generated once per install -- not a name, email,
 *          or machine fingerprint. One file each means installs never edit
 *          the same file, so their pushes can't conflict on content.
 *
 *   local  extension-builder/shared-mesh-local/             (gitignored)
 *          This install's own delta at full precision, its id, and sync
 *          bookkeeping.
 *
 * What a network holds is   core = base + own + others,   where
 *   own    = what this install learned itself (persisted locally, published),
 *   others = sum of every other install's published delta / (installs + 1)
 *            -- federated averaging: the more installs contribute, the less
 *            any single one can move everybody else.
 * `own` is always computed as core - base - others_applied, so what gets
 * published is only this install's learning, never an echo of what it
 * absorbed from someone else (which would otherwise bounce between installs
 * and amplify).
 *
 * Only LEARNED parameters travel (connection weights, biases, the
 * hyperdimensional and wave coefficients). Activations -- neuron states,
 * energies, where each wave currently sits -- are this machine's moment, not
 * knowledge, and are never shared.
 *
 * The mesh grows (net skills graft neurons in with addNeurons()), so installs
 * differ in size. Every weight array is laid out receiver-major with the
 * original neurons first (see addNeurons() in onebrain.ts), so the base-sized
 * block is the same neurons on every install and is what gets shared. Neurons
 * grafted later stay local.
 *
 * Deltas pulled from other installs are untrusted input: decodeDelta()
 * checks the exact shape, the base they were computed against, every value's
 * finiteness, and a hard cap on magnitude before anything is applied.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import type { NetworkStateSnapshot } from "./onebrain.js";

/** How each learned array is laid out, in terms of neurons N and D = dimensions + 1. */
type Layout = "conn" | "nd" | "nn" | "n";

/** Every learned parameter the snapshot carries. Activations are deliberately absent. */
export const LEARNED_ARRAYS: Readonly<Record<string, Layout>> = {
  connDiag: "conn",
  connShift: "conn",
  connBias: "conn",
  bias: "nd",
  modWeight: "nn",
  addWeight: "nn",
  modWaveWeight: "nn",
  addWaveWeight: "nn",
  connWaveGain: "nn",
  connWavePhase: "nn",
  connWaveBias: "nn",
  connWaveBiasIm: "nn",
  connWaveShift: "nn",
  senderGain: "n",
  neuronWaveBiasRe: "n",
  neuronWaveBiasIm: "n",
  waveFreq: "n",
};

export type CoreArrays = Record<string, Float32Array>;

export interface MeshShape {
  neurons: number;
  dimensions: number;
}

/** Biggest per-value change one install's delta may carry. Real learning moves weights by far less. */
export const MAX_DELTA_ABS = 4;
/** Biggest delta file accepted from anyone, compressed or not. */
export const MAX_DELTA_FILE_BYTES = 8 * 1024 * 1024;

function layoutLength(layout: Layout, n: number, d: number): number {
  switch (layout) {
    case "conn": return n * d * n;
    case "nd": return n * d;
    case "nn": return n * n;
    case "n": return n;
  }
}

function decodeF32(encoded: unknown): Float32Array | null {
  if (typeof encoded !== "string" || encoded.length === 0) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength % 4 !== 0) return null;
  const out = new Float32Array(bytes.byteLength / 4);
  Buffer.from(out.buffer).set(bytes);
  return out;
}

function encodeF32(values: Float32Array): string {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString("base64");
}

/**
 * The base-sized block of every learned array in `snapshot`, which may come
 * from a network that has grown past the base. Null if the snapshot is
 * smaller than the base or has a different dimensionality.
 */
export function extractCore(snapshot: NetworkStateSnapshot, base: MeshShape): CoreArrays | null {
  const N = snapshot.shape.neurons;
  const Nb = base.neurons;
  if (snapshot.shape.dimensions !== base.dimensions || N < Nb) return null;
  const D = base.dimensions + 1;
  const out: CoreArrays = {};
  for (const [key, layout] of Object.entries(LEARNED_ARRAYS)) {
    const src = decodeF32((snapshot as unknown as Record<string, unknown>)[key]);
    if (!src) {
      if (key === "connBias") continue; // only present when the engine runs per-connection biases
      return null;
    }
    if (src.length !== layoutLength(layout, N, D)) return null;
    const dst = new Float32Array(layoutLength(layout, Nb, D));
    switch (layout) {
      case "conn":
        for (let i = 0; i < Nb; i++) {
          for (let d = 0; d < D; d++) {
            dst.set(src.subarray((i * D + d) * N, (i * D + d) * N + Nb), (i * D + d) * Nb);
          }
        }
        break;
      case "nd":
      case "n":
        dst.set(src.subarray(0, dst.length));
        break;
      case "nn":
        for (let i = 0; i < Nb; i++) dst.set(src.subarray(i * N, i * N + Nb), i * Nb);
        break;
    }
    out[key] = dst;
  }
  return out;
}

/** `snapshot` with its base-sized block replaced by `core`. Everything outside the block is untouched. */
export function injectCore(snapshot: NetworkStateSnapshot, core: CoreArrays, base: MeshShape): NetworkStateSnapshot | null {
  const N = snapshot.shape.neurons;
  const Nb = base.neurons;
  if (snapshot.shape.dimensions !== base.dimensions || N < Nb) return null;
  const D = base.dimensions + 1;
  const next: Record<string, unknown> = { ...snapshot };
  for (const [key, block] of Object.entries(core)) {
    const layout = LEARNED_ARRAYS[key];
    if (!layout) continue;
    const dst = decodeF32(next[key]);
    if (!dst || dst.length !== layoutLength(layout, N, D) || block.length !== layoutLength(layout, Nb, D)) return null;
    switch (layout) {
      case "conn":
        for (let i = 0; i < Nb; i++) {
          for (let d = 0; d < D; d++) {
            dst.set(block.subarray((i * D + d) * Nb, (i * D + d + 1) * Nb), (i * D + d) * N);
          }
        }
        break;
      case "nd":
      case "n":
        dst.set(block);
        break;
      case "nn":
        for (let i = 0; i < Nb; i++) dst.set(block.subarray(i * Nb, (i + 1) * Nb), i * N);
        break;
    }
    next[key] = encodeF32(dst);
  }
  return next as unknown as NetworkStateSnapshot;
}

/** a + sign*b, per array. Arrays missing from either side are skipped. */
export function combine(a: CoreArrays, b: CoreArrays, sign = 1): CoreArrays {
  const out: CoreArrays = {};
  for (const [key, av] of Object.entries(a)) {
    const bv = b[key];
    if (!bv || bv.length !== av.length) {
      out[key] = av.slice();
      continue;
    }
    const r = new Float32Array(av.length);
    for (let i = 0; i < av.length; i++) r[i] = av[i] + sign * bv[i];
    out[key] = r;
  }
  return out;
}

export function zerosLike(a: CoreArrays): CoreArrays {
  const out: CoreArrays = {};
  for (const [key, v] of Object.entries(a)) out[key] = new Float32Array(v.length);
  return out;
}

/** Root-mean-square of every value across every array. */
export function rms(a: CoreArrays): number {
  let sum = 0;
  let count = 0;
  for (const v of Object.values(a)) {
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    count += v.length;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

// ─── Base ──────────────────────────────────────────────────────────────────

export interface BaseFile {
  version: 1;
  baseId: string;
  shape: MeshShape;
  /** gzip + base64 of the full NetworkStateSnapshot JSON. */
  snapshot: string;
}

export function makeBaseFile(snapshot: NetworkStateSnapshot): BaseFile {
  const json = JSON.stringify(snapshot);
  return {
    version: 1,
    baseId: createHash("sha256").update(json).digest("hex").slice(0, 16),
    shape: { ...snapshot.shape },
    snapshot: gzipSync(Buffer.from(json)).toString("base64"),
  };
}

export function readBaseFile(path: string): { baseId: string; shape: MeshShape; snapshot: NetworkStateSnapshot } | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as BaseFile;
    if (parsed?.version !== 1 || typeof parsed.baseId !== "string" || typeof parsed.snapshot !== "string") return null;
    const snapshot = JSON.parse(gunzipSync(Buffer.from(parsed.snapshot, "base64")).toString("utf8")) as NetworkStateSnapshot;
    if (!snapshot?.shape || snapshot.shape.neurons !== parsed.shape?.neurons || snapshot.shape.dimensions !== parsed.shape?.dimensions) return null;
    return { baseId: parsed.baseId, shape: parsed.shape, snapshot };
  } catch {
    return null;
  }
}

// ─── Deltas ────────────────────────────────────────────────────────────────

export interface DeltaFile {
  version: 1;
  baseId: string;
  shape: MeshShape;
  /** Per array: the int8 step size, and gzip + base64 of the Int8Array. */
  arrays: Record<string, { scale: number; data: string }>;
}

/** int8-quantises a delta: ~4x smaller before gzip, far smaller after, since most weights barely move. */
export function encodeDelta(delta: CoreArrays, baseId: string, shape: MeshShape): DeltaFile {
  const arrays: DeltaFile["arrays"] = {};
  for (const [key, v] of Object.entries(delta)) {
    let maxAbs = 0;
    for (let i = 0; i < v.length; i++) {
      const a = Math.abs(v[i]);
      if (Number.isFinite(a) && a > maxAbs) maxAbs = a;
    }
    maxAbs = Math.min(maxAbs, MAX_DELTA_ABS);
    const scale = maxAbs / 127;
    const q = new Int8Array(v.length);
    if (scale > 0) {
      for (let i = 0; i < v.length; i++) {
        const x = Number.isFinite(v[i]) ? v[i] : 0;
        q[i] = Math.max(-127, Math.min(127, Math.round(x / scale)));
      }
    }
    arrays[key] = { scale, data: gzipSync(Buffer.from(q.buffer)).toString("base64") };
  }
  return { version: 1, baseId, shape: { ...shape }, arrays };
}

/**
 * Parses and validates a delta. Null for anything that doesn't fit exactly:
 * a different base, a different shape, an unknown or missing array, a length
 * mismatch, a non-finite or oversized step.
 */
export function decodeDelta(raw: unknown, baseId: string, shape: MeshShape, expectedKeys: string[]): CoreArrays | null {
  const file = raw as DeltaFile;
  if (!file || file.version !== 1 || file.baseId !== baseId) return null;
  if (file.shape?.neurons !== shape.neurons || file.shape?.dimensions !== shape.dimensions) return null;
  if (!file.arrays || typeof file.arrays !== "object") return null;
  const D = shape.dimensions + 1;
  const out: CoreArrays = {};
  for (const key of expectedKeys) {
    const entry = file.arrays[key];
    const layout = LEARNED_ARRAYS[key];
    if (!entry || !layout) return null;
    const { scale, data } = entry;
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale < 0 || scale * 127 > MAX_DELTA_ABS + 1e-6) return null;
    if (typeof data !== "string") return null;
    const len = layoutLength(layout, shape.neurons, D);
    let bytes: Buffer;
    try {
      bytes = gunzipSync(Buffer.from(data, "base64"), { maxOutputLength: len + 1 });
    } catch {
      return null;
    }
    if (bytes.byteLength !== len) return null;
    const q = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const v = new Float32Array(len);
    for (let i = 0; i < len; i++) v[i] = q[i] * scale;
    out[key] = v;
  }
  return out;
}

/**
 * Every OTHER install's delta in `dir`, combined as sum / (count + 1). Returns
 * the combined contribution, how many installs it came from, and a
 * fingerprint of the files used (so a caller can skip work when nothing
 * changed).
 */
export function readOthersContribution(
  dir: string,
  opts: { baseId: string; shape: MeshShape; expectedKeys: string[]; excludeInstallId: string; template: CoreArrays },
): { contribution: CoreArrays; installs: number; fingerprint: string } {
  const contribution = zerosLike(opts.template);
  const hash = createHash("sha256");
  let installs = 0;
  let files: string[] = [];
  try {
    files = existsSync(dir) ? readdirSync(dir).filter(f => /^[a-f0-9]{16}\.json$/.test(f)).sort() : [];
  } catch {
    files = [];
  }
  const decoded: CoreArrays[] = [];
  for (const f of files) {
    if (f === `${opts.excludeInstallId}.json`) continue;
    const full = join(dir, f);
    try {
      if (statSync(full).size > MAX_DELTA_FILE_BYTES) continue;
      const text = readFileSync(full, "utf8");
      const delta = decodeDelta(JSON.parse(text), opts.baseId, opts.shape, opts.expectedKeys);
      if (!delta) continue;
      decoded.push(delta);
      hash.update(f).update(createHash("sha256").update(text).digest("hex"));
    } catch {
      continue;
    }
  }
  installs = decoded.length;
  if (installs > 0) {
    const weight = 1 / (installs + 1);
    for (const delta of decoded) {
      for (const [key, v] of Object.entries(delta)) {
        const acc = contribution[key];
        if (!acc || acc.length !== v.length) continue;
        for (let i = 0; i < v.length; i++) acc[i] += v[i] * weight;
      }
    }
  }
  return { contribution, installs, fingerprint: hash.digest("hex").slice(0, 16) };
}

// ─── Local persistence ─────────────────────────────────────────────────────

/** A random id generated once per install and kept locally. Only ever used as this install's delta file name. */
export function getInstallId(path: string): string {
  try {
    if (existsSync(path)) {
      const id = readFileSync(path, "utf8").trim();
      if (/^[a-f0-9]{16}$/.test(id)) return id;
    }
  } catch {
    // Unreadable -- make a new one.
  }
  const id = randomBytes(8).toString("hex");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, id + "\n", "utf8");
  return id;
}

/** This install's own delta, full precision, for surviving restarts. */
export function saveOwnDelta(path: string, own: CoreArrays, baseId: string): void {
  const arrays: Record<string, string> = {};
  for (const [key, v] of Object.entries(own)) arrays[key] = encodeF32(v);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, gzipSync(Buffer.from(JSON.stringify({ version: 1, baseId, arrays }))));
}

export function loadOwnDelta(path: string, baseId: string, template: CoreArrays): CoreArrays | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
    if (parsed?.version !== 1 || parsed.baseId !== baseId) return null;
    const out: CoreArrays = {};
    for (const [key, t] of Object.entries(template)) {
      const v = decodeF32(parsed.arrays?.[key]);
      if (!v || v.length !== t.length) return null;
      for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return null;
      out[key] = v;
    }
    return out;
  } catch {
    return null;
  }
}
