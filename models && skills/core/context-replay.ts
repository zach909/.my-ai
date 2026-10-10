/**
 * Context compression through the Zip Loop.
 *
 * Earlier chats give the AI context, and the only way context reaches the mesh
 * is as bits through the Zip Loop at roughly 37 ms a bit. Streaming a whole
 * old conversation back in every time it is continued is far too slow, and
 * summarising it as text (context-compressor.ts) throws away what the mesh
 * actually took from it, which is which neurons it lit.
 *
 * This works from the neurons instead:
 *
 *   1. See what the old conversation did: feed it through the doorway once and
 *      note how every neuron moved (the signature).
 *   2. Make a prompt that does the same thing, much shorter: a few bytes which,
 *      fed through the same doorway from the same starting point, move the
 *      neurons the same way. First the cheap candidates (the last few bytes of
 *      the history itself), then a bit by bit search that keeps whichever bit
 *      lands closer.
 *   3. Put the mesh back exactly as it was, so finding the prompt changes
 *      nothing.
 *
 * Later, continuing the conversation is: feed that short prompt, then add the
 * new prompt and its context as usual.
 *
 * Nothing here turns text into tokens. The history is its UTF-8 bytes, the
 * replay is bytes, and both go in as bits.
 *
 * A replay is only ever used if it really does reproduce the neurons well
 * enough, and is shorter than what it replaces. Otherwise there is no
 * compression and the caller carries on as before.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.js";
import { zipLoopIdsFor, type HyperDimensionalEngine, type ZipLoopInterface } from "./onebrain.js";

/** The six neurons the Zip Loop drives and reads (bit in, bit out, and the ramp). */
const ZIP_DOORWAY_IDS: readonly number[] = Object.values(zipLoopIdsFor({ getNeuronCount: () => 0 })).filter((v): v is number => typeof v === "number");

/** What the search needs from a mesh. Small so a test can stand in a toy network for the real one. */
export interface ContextProbe {
  /** Put one bit through the doorway (settles the mesh). Must not learn from it. */
  feedBit(bit: 0 | 1): void;
  /** How every neuron is right now. */
  signature(): ArrayLike<number>;
  /** Save the mesh as it is, to put back after a trial. */
  checkpoint(): unknown;
  /** Put back what checkpoint() saved. */
  rewind(token: unknown): void;
}

export interface ReplayOptions {
  /** Longest replay worth having, in bytes. Default 16. */
  maxBytes?: number;
  /** Stop looking once a replay is this close (cosine of the neuron changes). Default 0.97. */
  target?: number;
  /** Below this a replay is not good enough to use at all. Default 0.85. */
  minimum?: number;
  /** Give up looking after this long and keep the best so far. Default 120000. */
  maxMs?: number;
  /** Test hook: the clock. */
  now?: () => number;
  /** Gives the event loop a turn between trials, so the server stays responsive while this runs. */
  yieldTo?: () => Promise<void>;
}

export interface ReplayResult {
  bytes: Uint8Array;
  /** How closely it moves the neurons the way the full history did, 0..1. */
  similarity: number;
  originalBytes: number;
  method: "nothing-to-replay" | "tail" | "search";
  /** How many trial runs it took. */
  trials: number;
}

function bitsOf(bytes: Uint8Array): Array<0 | 1> {
  const bits: Array<0 | 1> = [];
  for (const byte of bytes) for (let b = 7; b >= 0; b--) bits.push(((byte >> b) & 1) as 0 | 1);
  return bits;
}

function delta(sig: ArrayLike<number>, base: ArrayLike<number>): Float64Array {
  const out = new Float64Array(sig.length);
  for (let i = 0; i < sig.length; i++) out[i] = sig[i] - (base[i] ?? 0);
  return out;
}

function norm(v: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

/**
 * How alike two movements of the neurons are: the same direction AND the same
 * amount. Direction alone would call a half-sized move a perfect match, but
 * the point is to leave the neurons in the same state, not one pointing the
 * same way.
 */
function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const na = norm(a), nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  const direction = Math.max(-1, Math.min(1, dot / (na * nb)));
  return direction * (Math.min(na, nb) / Math.max(na, nb));
}

/**
 * Find a short prompt that moves the neurons the way `history` did. Leaves the
 * mesh exactly as it found it. Returns null when there is no worthwhile
 * compression: nothing to compress, no replay close enough, or none shorter
 * than the history.
 */
export async function compressContext(probe: ContextProbe, history: Uint8Array, opts: ReplayOptions = {}): Promise<ReplayResult | null> {
  const maxBytes = opts.maxBytes ?? 16;
  const target = opts.target ?? 0.97;
  const minimum = opts.minimum ?? 0.85;
  const maxMs = opts.maxMs ?? 120_000;
  const now = opts.now ?? Date.now;
  const yieldTo = opts.yieldTo ?? (() => new Promise<void>(r => setImmediate(r)));
  if (history.length === 0) return null;

  const started = now();
  const out = (): boolean => now() - started > maxMs;
  const start = probe.checkpoint();
  const base = Array.from(probe.signature());
  let trials = 0;

  try {
    // 1. What the whole history did.
    let fed = 0;
    for (const bit of bitsOf(history)) {
      probe.feedBit(bit);
      if (++fed % 64 === 0) await yieldTo();
    }
    const full = delta(probe.signature(), base);
    trials++;
    probe.rewind(start);

    if (norm(full) < 1e-12) {
      return { bytes: new Uint8Array(0), similarity: 1, originalBytes: history.length, method: "nothing-to-replay", trials };
    }

    const score = async (bytes: Uint8Array): Promise<number> => {
      for (const bit of bitsOf(bytes)) probe.feedBit(bit);
      const s = cosine(delta(probe.signature(), base), full);
      probe.rewind(start);
      trials++;
      await yieldTo();
      return s;
    };

    let best: { bytes: Uint8Array; similarity: number; method: "tail" | "search" } | null = null;
    const consider = (bytes: Uint8Array, similarity: number, method: "tail" | "search"): void => {
      // Higher similarity wins; at nearly equal similarity the shorter one does.
      if (!best || similarity > best.similarity + 0.005 || (similarity >= best.similarity - 0.005 && bytes.length < best.bytes.length)) {
        best = { bytes, similarity, method };
      }
    };

    // 2a. The cheap candidates: the last few bytes of the history itself.
    const limit = Math.min(maxBytes, history.length - 1);
    for (let len = 1; len <= limit && !out(); len = len < 4 ? len + 1 : len * 2) {
      const tail = history.slice(history.length - len);
      const similarity = await score(tail);
      consider(tail, similarity, "tail");
      if (similarity >= target) break;
    }

    // 2b. A bit by bit search, only if no tail was close enough. One byte at
    // a time, keeping whichever bit moves the neurons closer to the target.
    if ((!best || (best as { similarity: number }).similarity < target) && limit >= 1) {
      const chosen: Array<0 | 1> = [];
      outer: for (let byte = 0; byte < limit; byte++) {
        for (let b = 0; b < 8; b++) {
          if (out()) break outer;
          const here = probe.checkpoint();
          probe.feedBit(0);
          const s0 = cosine(delta(probe.signature(), base), full);
          probe.rewind(here);
          probe.feedBit(1);
          const s1 = cosine(delta(probe.signature(), base), full);
          trials += 2;
          if (s0 >= s1) { probe.rewind(here); probe.feedBit(0); chosen.push(0); }
          else chosen.push(1);
          await yieldTo();
        }
        const bytes = new Uint8Array(chosen.length / 8);
        for (let i = 0; i < bytes.length; i++) {
          let v = 0;
          for (let k = 0; k < 8; k++) v = (v << 1) | chosen[i * 8 + k];
          bytes[i] = v;
        }
        const similarity = cosine(delta(probe.signature(), base), full);
        consider(bytes, similarity, "search");
        if (similarity >= target) break;
      }
      probe.rewind(start);
    }

    const result = best as { bytes: Uint8Array; similarity: number; method: "tail" | "search" } | null;
    if (!result || result.similarity < minimum || result.bytes.length >= history.length) return null;
    return { bytes: result.bytes, similarity: result.similarity, originalBytes: history.length, method: result.method, trials };
  } finally {
    // Whatever happened, finding the prompt must not have changed the mesh.
    probe.rewind(start);
  }
}

/** Feed a replay through a doorway as bits, without learning from it: it is context, not an event. */
export async function primeWithReplay(
  probe: Pick<ContextProbe, "feedBit">,
  replay: Uint8Array,
  yieldTo: () => Promise<void> = () => new Promise<void>(r => setImmediate(r)),
): Promise<void> {
  for (const byte of replay) {
    for (let b = 7; b >= 0; b--) probe.feedBit(((byte >> b) & 1) as 0 | 1);
    await yieldTo();
  }
}

/** How many neurons besides the doorway's own to watch. */
export const WATCHED_NEURONS = 24;

/** The two sides of the doorway the probe needs from the engine. */
type ProbeEngine = Pick<HyperDimensionalEngine,
  "getNeuronCount" | "getDimensions" | "getConnectionWeight" | "readNeuronContent" | "getNeuronEnergy" | "captureNetworkState" | "restoreNetworkState">;

/**
 * The neurons wired most tightly to the Zip Loop's own neurons. The mesh is
 * all-to-all, so everything is connected to the doorway somehow; what matters
 * is how strongly. These are the ones that feel a bit going in and are what
 * the doorway's output reads from, so their state is the context.
 */
export function neuronsTiedToDoorway(engine: ProbeEngine, doorway: readonly number[], count: number = WATCHED_NEURONS): number[] {
  const n = engine.getNeuronCount();
  const dims = engine.getDimensions();   // content dimensions; the input flag is dimension 0 of the weights too, so the loop runs to <= dims
  const own = new Set(doorway);
  const scored: Array<{ id: number; strength: number }> = [];
  for (let id = 0; id < n; id++) {
    if (own.has(id)) continue;
    let strength = 0;
    for (const d of doorway) {
      if (d >= n) continue;
      for (let dim = 0; dim <= dims; dim++) {
        strength += Math.abs(engine.getConnectionWeight(id, d, dim)) + Math.abs(engine.getConnectionWeight(d, id, dim));
      }
    }
    scored.push({ id, strength });
  }
  scored.sort((a, b) => b.strength - a.strength || a.id - b.id);
  return [...doorway.filter(d => d < n), ...scored.slice(0, count).map(s => s.id)];
}

/**
 * The real mesh behind the Zip Loop, as a probe. What it reads is the whole
 * state of the doorway's neurons and the ones wired most tightly to them
 * (every content dimension and the energy of each), not every neuron in the
 * mesh: those are the ones a replay has to put back.
 */
export function zipLoopProbe(engine: HyperDimensionalEngine, zip: ZipLoopInterface, doorway: readonly number[] = ZIP_DOORWAY_IDS): ContextProbe {
  const watched = neuronsTiedToDoorway(engine, doorway);
  const dims = engine.getDimensions();
  const scratch = new Float32Array(dims);
  return {
    feedBit: bit => zip.sendBit(bit),
    signature: () => {
      const out = new Float64Array(watched.length * (dims + 1));
      let at = 0;
      for (const id of watched) {
        const wrote = engine.readNeuronContent(id, scratch);
        for (let d = 0; d < wrote; d++) out[at++] = scratch[d];
        at += dims - wrote;
        out[at++] = engine.getNeuronEnergy(id);
      }
      return out;
    },
    checkpoint: () => engine.captureNetworkState(),
    rewind: token => { engine.restoreNetworkState(token as ReturnType<HyperDimensionalEngine["captureNetworkState"]>); },
  };
}

// ── Keeping replays between runs ──────────────────────────────────────────

export interface StoredReplay {
  /** Digest of the history text this was made from. */
  digest: string;
  /** Base64 of the replay bytes; empty when nothing worthwhile was found. */
  replay: string;
  found: boolean;
  similarity: number;
  originalBytes: number;
  method: ReplayResult["method"] | "none";
  at: number;
}

export function digestOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32);
}

/** One replay per conversation, kept on this device. */
export class ReplayStore {
  private records: Record<string, StoredReplay> = {};

  constructor(private readonly file: string | null = null) {
    if (file && existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, StoredReplay>;
        if (parsed && typeof parsed === "object") this.records = parsed;
      } catch {
        // A damaged file starts over; replays are rebuilt when a conversation is next continued.
      }
    }
  }

  get(threadId: string): StoredReplay | null {
    return this.records[threadId] ?? null;
  }

  /** The replay bytes to feed, or null when none was found for this conversation. */
  replayFor(threadId: string): Uint8Array | null {
    const rec = this.records[threadId];
    return rec?.found ? new Uint8Array(Buffer.from(rec.replay, "base64")) : null;
  }

  /** Is what is stored made from this very text? */
  isCurrent(threadId: string, text: string): boolean {
    return this.records[threadId]?.digest === digestOf(text);
  }

  set(threadId: string, text: string, result: ReplayResult | null): StoredReplay {
    const rec: StoredReplay = {
      digest: digestOf(text),
      replay: result ? Buffer.from(result.bytes).toString("base64") : "",
      found: result !== null,
      similarity: result?.similarity ?? 0,
      originalBytes: result?.originalBytes ?? Buffer.byteLength(text, "utf8"),
      method: result?.method ?? "none",
      at: Date.now(),
    };
    this.records[threadId] = rec;
    this.save();
    return rec;
  }

  forget(threadId: string): void {
    if (this.records[threadId]) {
      delete this.records[threadId];
      this.save();
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeJsonAtomic(this.file, this.records);
    } catch {
      // Bookkeeping must not break a chat.
    }
  }
}
