/**
 * How a hive's agents learn differently, and how what they learned is
 * combined without replacing anything.
 *
 * ── Each agent is a different AI ───────────────────────────────────────
 *
 * Every agent starts from the same shared base network (shared-mesh.ts) and is
 * taught only the work it did. So after a project each agent's weights have
 * moved away from the base in its own direction: its own "delta", the same
 * kind of object one install publishes. teach() does that on the live engine
 * and puts the live brain back exactly as it found it.
 *
 * ── Combining them: an average, never a replacement ────────────────────
 *
 * mergeDeltas() is a weighted AVERAGE of the agents' deltas, with each agent's
 * weight its value (hive-mind.ts's zero-sum trust, which moves with accepted
 * and rejected work). Weights are normalised to sum to 1, so the merged
 * change is never bigger than the biggest single one, and an agent that kept
 * getting its work rejected pulls the result less than one that did not.
 *
 * The merged delta is then published as ONE more contributor in
 * extension-builder/shared-mesh/deltas/, exactly like an install's. Everyone
 * who loads the network averages every contributor together as
 * sum / (contributors + 1) (readOthersContribution), so the project's learning
 * is blended in with everyone else's and the shared base is never overwritten.
 * Publishing the same project again replaces only that project's own file.
 *
 * ── What it does NOT do (stated plainly) ───────────────────────────────
 *
 * - While an agent works it still answers through the ONE live brain: the
 *   engine can hold one set of weights at a time, and swapping them under a
 *   chat in progress would corrupt it. What differs per agent is what it
 *   LEARNS, not how it speaks while working.
 * - Teaching streams text through the Zip Loop a byte at a time, which is slow
 *   by design, so each call is capped (maxBytes).
 * - Nothing leaves the device unless sharing is opted into
 *   (NEUROCLAW_SHARED_LEARNING=1), the same gate as everything else in
 *   shared-mesh-sync.ts. Without it the merged delta is saved locally only.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NetworkStateSnapshot } from "./onebrain.js";
import type { DoorwayLock } from "./doorway-lock.js";
import { sharedLearningEnabled } from "./shared-mesh-sync.js";
import {
  combine,
  encodeDelta,
  extractCore,
  injectCore,
  loadOwnDelta,
  readBaseFile,
  rms,
  saveOwnDelta,
  zerosLike,
  type CoreArrays,
  type MeshShape,
} from "./shared-mesh.js";

// ── Combining ──────────────────────────────────────────────────────────

export interface WeightedDelta {
  id: string;
  /** How much this agent counts. Only the proportions matter. */
  weight: number;
  delta: CoreArrays;
}

export interface MergeResult {
  merged: CoreArrays;
  /** Each contributor's share of the average, summing to 1. */
  shares: Array<{ id: string; share: number }>;
}

/**
 * The weighted average of several deltas: sum(w * delta) / sum(w). Anyone with
 * no weight, or whose arrays do not line up with the first contributor's, is
 * left out rather than guessed at. Null if nobody is left.
 */
export function mergeDeltas(parts: WeightedDelta[]): MergeResult | null {
  const usable = parts.filter(p => Number.isFinite(p.weight) && p.weight > 0 && p.delta && Object.keys(p.delta).length > 0);
  if (usable.length === 0) return null;
  const keys = Object.keys(usable[0].delta);
  const fits = (d: CoreArrays): boolean =>
    Object.keys(d).length === keys.length && keys.every(k => d[k] && d[k].length === usable[0].delta[k].length);
  const members = usable.filter(p => fits(p.delta));
  const total = members.reduce((n, p) => n + p.weight, 0);
  const merged = zerosLike(usable[0].delta);
  for (const p of members) {
    const w = p.weight / total;
    for (const k of keys) {
      const out = merged[k];
      const src = p.delta[k];
      for (let i = 0; i < out.length; i++) out[i] += src[i] * w;
    }
  }
  return { merged, shares: members.map(p => ({ id: p.id, share: p.weight / total })) };
}

// ── Teaching one agent ─────────────────────────────────────────────────

/** The two engine calls teaching needs. The real HyperDimensionalEngine has both. */
export interface LearnerEngine {
  captureNetworkState(): NetworkStateSnapshot;
  restoreNetworkState(snapshot: NetworkStateSnapshot): boolean;
}

export interface AgentLearner {
  /** Teach one agent from some text. Resolves with whether it took, and why not if it did not. */
  teach(agentId: string, text: string): Promise<{ ok: boolean; reason?: string }>;
  /** What this agent has learned so far, as a change from the shared base. Null if nothing. */
  delta(agentId: string): CoreArrays | null;
  /** Throw away what this agent learned (it was deleted). */
  forget(agentId: string): void;
  /** Give `toId` a copy of what `fromId` has learned, so a variant starts where its parent is. False if there was nothing to copy. */
  clone(fromId: string, toId: string): boolean;
  /** The base every delta is measured against, or null if there is none to learn on. */
  base(): { baseId: string; shape: MeshShape } | null;
}

export interface MeshLearnerOptions {
  engine: () => LearnerEngine | null;
  /** The lock every caller of this engine's doorway holds, so a swap never overlaps a chat. */
  lock: DoorwayLock;
  /** Streams text into the mesh through its Zip Loop. Called with the lock already held, so it must not take it again. */
  feed: (text: string) => Promise<void>;
  baseFile: string;
  /** Where each agent's delta is kept. */
  dir: string;
  /** Most bytes of text per teach() call. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 512;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

export class MeshAgentLearner implements AgentLearner {
  private loaded: { baseId: string; shape: MeshShape; baseCore: CoreArrays } | null = null;

  constructor(private readonly opts: MeshLearnerOptions) {}

  private loadBase() {
    if (this.loaded) return this.loaded;
    const base = readBaseFile(this.opts.baseFile);
    const baseCore = base ? extractCore(base.snapshot, base.shape) : null;
    if (!base || !baseCore) return null;
    this.loaded = { baseId: base.baseId, shape: base.shape, baseCore };
    return this.loaded;
  }

  private pathFor(agentId: string): string | null {
    return SAFE_ID.test(agentId) ? join(this.opts.dir, `${agentId}.delta.json.gz`) : null;
  }

  base() {
    const b = this.loadBase();
    return b ? { baseId: b.baseId, shape: b.shape } : null;
  }

  delta(agentId: string): CoreArrays | null {
    const b = this.loadBase();
    const file = this.pathFor(agentId);
    if (!b || !file) return null;
    const own = loadOwnDelta(file, b.baseId, b.baseCore);
    return own && rms(own) > 0 ? own : null;
  }

  forget(agentId: string): void {
    const file = this.pathFor(agentId);
    if (file) rmSync(file, { force: true });
  }

  clone(fromId: string, toId: string): boolean {
    const from = this.pathFor(fromId);
    const to = this.pathFor(toId);
    if (!from || !to || !existsSync(from)) return false;
    try {
      mkdirSync(this.opts.dir, { recursive: true });
      copyFileSync(from, to);
      return true;
    } catch {
      return false;
    }
  }

  async teach(agentId: string, text: string): Promise<{ ok: boolean; reason?: string }> {
    const b = this.loadBase();
    const file = this.pathFor(agentId);
    if (!b || !file) return { ok: false, reason: b ? "bad agent id" : "no shared base to learn against" };
    const bytes = Buffer.from(String(text ?? ""), "utf8");
    if (bytes.length === 0) return { ok: false, reason: "nothing to teach" };
    const lesson = bytes.subarray(0, this.opts.maxBytes ?? DEFAULT_MAX_BYTES).toString("utf8");

    return this.opts.lock.run(async () => {
      const engine = this.opts.engine();
      if (!engine) return { ok: false, reason: "the brain is not running yet" };
      const live = engine.captureNetworkState();
      try {
        // Start where this agent left off: the base plus what it already learned.
        const own = loadOwnDelta(file, b.baseId, b.baseCore) ?? zerosLike(b.baseCore);
        const start = injectCore(live, combine(b.baseCore, own), b.shape);
        if (!start || !engine.restoreNetworkState(start)) return { ok: false, reason: "the brain's shape does not match the shared base" };
        await this.opts.feed(lesson);
        const after = extractCore(engine.captureNetworkState(), b.shape);
        if (!after) return { ok: false, reason: "the brain changed shape while learning" };
        mkdirSync(this.opts.dir, { recursive: true });
        saveOwnDelta(file, combine(after, b.baseCore, -1), b.baseId);
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      } finally {
        // Whatever happened, the live brain goes back exactly as it was.
        engine.restoreNetworkState(live);
      }
    });
  }
}

// ── Publishing ─────────────────────────────────────────────────────────

/** A project's contributor id: stable, so publishing it again replaces its own file and nobody else's. */
export function projectDeltaId(projectId: string): string {
  return createHash("sha256").update(`hive:${projectId}`).digest("hex").slice(0, 16);
}

export interface PublishPaths {
  root: string;
  deltasDir?: string;
  localDir?: string;
  publishScript?: string;
}

export interface PublishResult {
  id: string;
  /** Repo-relative path of the delta file. */
  relPath: string;
  /** "queued" = handed to the publish script; "off" = saved on this device only because sharing is not opted into. */
  push: "queued" | "off" | "no-script" | "failed";
  reason?: string;
}

export function publishMergedDelta(args: {
  projectId: string;
  merged: CoreArrays;
  baseId: string;
  shape: MeshShape;
  paths: PublishPaths;
  enabled?: boolean;
  spawnFn?: typeof spawn;
}): PublishResult | null {
  const { projectId, merged, baseId, shape, paths } = args;
  const delta = encodeDelta(merged, baseId, shape);
  // Nothing learned is not worth a file, let alone a commit.
  if (Object.values(delta.arrays).every(a => a.scale === 0)) return null;

  const id = projectDeltaId(projectId);
  const relPath = `extension-builder/shared-mesh/deltas/${id}.json`;
  const deltasDir = paths.deltasDir ?? join(paths.root, "extension-builder", "shared-mesh", "deltas");
  const localDir = paths.localDir ?? join(paths.root, "extension-builder", "shared-mesh-local");
  const content = JSON.stringify(delta) + "\n";

  // Always kept here, so this device's own network can average it in.
  mkdirSync(deltasDir, { recursive: true });
  writeFileSync(join(deltasDir, `${id}.json`), content, "utf8");

  if (!(args.enabled ?? sharedLearningEnabled())) {
    return { id, relPath, push: "off", reason: "Sharing is not turned on (NEUROCLAW_SHARED_LEARNING=1), so this stays on this device." };
  }
  const script = paths.publishScript ?? join(paths.root, "scripts", "shared-mesh-publish.mjs");
  if (!existsSync(script)) return { id, relPath, push: "no-script", reason: "The publish script is missing." };

  // Its own outbox, so it can never overwrite the install's regular one.
  mkdirSync(localDir, { recursive: true });
  const outbox = join(localDir, `outbox-hive-${id}.json`);
  const hash = createHash("sha256").update(content).digest("hex");
  writeFileSync(outbox, JSON.stringify({ relPath, content, hash }), "utf8");
  try {
    const child = (args.spawnFn ?? spawn)(process.execPath, [script, outbox], { cwd: paths.root, detached: true, stdio: "ignore", env: process.env });
    child.on?.("error", () => undefined);
    child.unref?.();
    return { id, relPath, push: "queued" };
  } catch (err) {
    return { id, relPath, push: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}
