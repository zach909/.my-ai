/**
 * Short-term context: freeze the mesh when a turn stops, thaw it when the
 * conversation comes back.
 *
 * Two kinds of context, kept apart on purpose:
 *
 *   - SHORT TERM (this file). When a turn stops, the neurons are left in some
 *     state: that state IS what the mesh was "thinking about". Freeze it,
 *     keyed by conversation, and when that conversation is picked up again
 *     soon after, put the neurons back exactly as they were. Instant, exact,
 *     and it fades: past a time limit it is dropped.
 *   - LONG TERM (context-replay.ts). The whole chat history, as a short
 *     replay prompt that makes the same neurons fire as if the whole history
 *     had been fed in. Slower to use (it goes through the Zip Loop), but it
 *     keeps for as long as the conversation does.
 *
 * Opening a conversation tries the frozen state first and falls back to the
 * replay (see NeuroclawSystem.continueThread).
 *
 * What gets frozen is only the ACTIVITY: neuron states, energies, each
 * neuron's own wave, the shared wave pool. Never the learned network (weights,
 * biases, connection waves). Those belong to the one mesh that every
 * conversation shares and that keeps learning; putting back an old copy of
 * them would erase what it has learned since. A thaw therefore takes the mesh
 * as it is now and swaps in the frozen activity.
 *
 * Nothing here turns text into tokens, and nothing is stored on disk: short
 * term is ephemeral, and the long-term replay is what survives a restart.
 */

import type { HyperDimensionalEngine, NetworkStateSnapshot } from "./onebrain.js";

/** The parts of a snapshot that are what the network is doing, not what it has learned. */
const ACTIVITY_KEYS = [
  "states", "energies",
  // Where each neuron's wave currently sits. The engine advances it every settle
  // iteration (that is what makes the pool oscillate across calls), so it is time,
  // not structure; learning only nudges it slightly (phase lock). Left out, a
  // thawed mesh on the live configuration (wave layer on) ran at a different phase
  // from the one that stopped: two identical runs differed by 1e-2.
  "wavePhase",
  "neuronWaveRe", "neuronWaveIm",
  "wavePoolRe", "wavePoolIm",
  "emaEnergy", "hasEma", "sustainedDivergence",
] as const;

type ActivityKey = typeof ACTIVITY_KEYS[number];

/** A frozen moment of activity. Fits only a mesh with the same shape. */
export type FrozenActivity = Pick<NetworkStateSnapshot, "shape" | "states" | "energies"> &
  Partial<Pick<NetworkStateSnapshot, Exclude<ActivityKey, "states" | "energies">>>;

/** Keep only the activity half of a full snapshot (for example the one a stopped run already captured). */
export function activityOf(snapshot: NetworkStateSnapshot): FrozenActivity {
  const out: Record<string, unknown> = { shape: { ...snapshot.shape } };
  for (const key of ACTIVITY_KEYS) {
    const value = snapshot[key];
    if (value !== undefined) out[key] = value;
  }
  return out as FrozenActivity;
}

/** Freeze the mesh's activity right now. */
export function freezeActivity(engine: Pick<HyperDimensionalEngine, "captureNetworkState">): FrozenActivity {
  return activityOf(engine.captureNetworkState());
}

/**
 * Put frozen activity back, leaving everything learned as it is now. False
 * (and nothing changed) when the mesh has a different shape, for example
 * because neurons were added since.
 */
export function thawActivity(engine: Pick<HyperDimensionalEngine, "captureNetworkState" | "restoreNetworkState">, frozen: FrozenActivity): boolean {
  const now = engine.captureNetworkState();
  if (now.shape.neurons !== frozen.shape.neurons || now.shape.dimensions !== frozen.shape.dimensions) return false;
  return engine.restoreNetworkState({ ...now, ...frozen });
}

export interface ThreadContextOptions {
  /** How long a frozen state stays usable. Default 15 minutes: it is short-term. */
  ttlMs?: number;
  /** How many conversations are held; the one untouched longest is dropped first. Default 8. */
  maxThreads?: number;
  /** Test hook: the clock. */
  now?: () => number;
}

export type ThawResult =
  | { thawed: true; ageMs: number }
  | { thawed: false; reason: "none" | "expired" | "mismatch" };

interface Frozen {
  activity: FrozenActivity;
  at: number;
}

/** Frozen activity per conversation, in memory, for a little while. */
export class ThreadContext {
  private readonly frozen = new Map<string, Frozen>();
  private readonly ttlMs: number;
  private readonly maxThreads: number;
  private readonly now: () => number;

  constructor(opts: ThreadContextOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 15 * 60_000;
    this.maxThreads = Math.max(1, opts.maxThreads ?? 8);
    this.now = opts.now ?? Date.now;
  }

  /** Freeze the mesh as it is for this conversation. */
  freeze(threadId: string, engine: Pick<HyperDimensionalEngine, "captureNetworkState">): void {
    this.hold(threadId, freezeActivity(engine));
  }

  /** Keep activity that was already captured, for example by the run that just stopped. */
  hold(threadId: string, activity: FrozenActivity): void {
    // Re-inserting moves it to the end, so the Map's order is least to most recently frozen.
    this.frozen.delete(threadId);
    this.frozen.set(threadId, { activity, at: this.now() });
    while (this.frozen.size > this.maxThreads) {
      const oldest = this.frozen.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.frozen.delete(oldest);
    }
  }

  /** Put this conversation's frozen activity back into the mesh, if there is some and it is still fresh. */
  thaw(threadId: string, engine: Pick<HyperDimensionalEngine, "captureNetworkState" | "restoreNetworkState">): ThawResult {
    const entry = this.frozen.get(threadId);
    if (!entry) return { thawed: false, reason: "none" };
    const ageMs = this.now() - entry.at;
    if (ageMs > this.ttlMs) {
      this.frozen.delete(threadId);
      return { thawed: false, reason: "expired" };
    }
    if (!thawActivity(engine, entry.activity)) return { thawed: false, reason: "mismatch" };
    return { thawed: true, ageMs };
  }

  /** Is there frozen activity for this conversation that is still fresh? */
  has(threadId: string): boolean {
    const entry = this.frozen.get(threadId);
    return !!entry && this.now() - entry.at <= this.ttlMs;
  }

  forget(threadId: string): void {
    this.frozen.delete(threadId);
  }

  get size(): number {
    return this.frozen.size;
  }
}
