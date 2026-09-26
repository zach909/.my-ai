/**
 * shared-mesh-sync.ts — runs shared-mesh.ts against the live engine.
 *
 *   boot()  load base -> add this install's saved learning -> add everyone
 *           else's (unless sharing is off). Called once, right after the
 *           engine is built.
 *   tick()  every NEUROCLAW_SHARED_LEARNING_INTERVAL_MS: save this install's
 *           learning locally, pick up any newer deltas from other installs,
 *           and -- if this install's learning moved since the last push --
 *           queue a push.
 *
 * The push itself (git fetch/commit/push, all synchronous) never runs in this
 * process: it would freeze the HTTP server for as long as the network takes.
 * tick() writes an outbox file and starts scripts/shared-mesh-publish.mjs as
 * a detached child to do it.
 *
 * OFF BY DEFAULT (opt-in). NEUROCLAW_SHARED_LEARNING=1 turns on both
 * directions -- pushing this install's learning and merging in everyone
 * else's. This install's own learning is kept across restarts either way.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HyperDimensionalEngine } from "./onebrain.js";
import type { DoorwayLock } from "./doorway-lock.js";
import {
  combine,
  encodeDelta,
  extractCore,
  getInstallId,
  injectCore,
  loadOwnDelta,
  readBaseFile,
  readOthersContribution,
  saveOwnDelta,
  zerosLike,
  type CoreArrays,
  type MeshShape,
} from "./shared-mesh.js";

export const DEFAULT_SYNC_INTERVAL_MS = 30 * 60 * 1000;

export function sharedLearningEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEUROCLAW_SHARED_LEARNING === "1";
}

export interface SharedMeshPaths {
  /** Repo root; everything else is relative to it unless overridden. */
  root: string;
  baseFile?: string;
  deltasDir?: string;
  localDir?: string;
  publishScript?: string;
}

export interface SyncStatus {
  enabled: boolean;
  loaded: boolean;
  reason?: string;
  installId?: string;
  baseId?: string;
  otherInstalls: number;
  ownDeltaRms: number;
  lastSavedAt: number | null;
  lastPublishQueuedAt: number | null;
}

type SpawnFn = typeof spawn;

export class SharedMeshSync {
  private readonly baseFile: string;
  private readonly deltasDir: string;
  private readonly localDir: string;
  private readonly publishScript: string;
  private readonly root: string;

  private baseId = "";
  private shape: MeshShape | null = null;
  private baseCore: CoreArrays | null = null;
  private othersApplied: CoreArrays | null = null;
  private othersFingerprint = "";
  private installId = "";
  private status: SyncStatus;

  constructor(
    private readonly getEngine: () => HyperDimensionalEngine | null,
    private readonly lock: DoorwayLock | null,
    paths: SharedMeshPaths,
    private readonly opts: { enabled?: boolean; spawnFn?: SpawnFn; log?: (msg: string) => void } = {},
  ) {
    this.root = paths.root;
    this.baseFile = paths.baseFile ?? join(paths.root, "extension-builder", "shared-mesh", "base.json");
    this.deltasDir = paths.deltasDir ?? join(paths.root, "extension-builder", "shared-mesh", "deltas");
    this.localDir = paths.localDir ?? join(paths.root, "extension-builder", "shared-mesh-local");
    this.publishScript = paths.publishScript ?? join(paths.root, "scripts", "shared-mesh-publish.mjs");
    this.status = {
      enabled: this.enabled,
      loaded: false,
      otherInstalls: 0,
      ownDeltaRms: 0,
      lastSavedAt: null,
      lastPublishQueuedAt: null,
    };
  }

  private get enabled(): boolean {
    return this.opts.enabled ?? sharedLearningEnabled();
  }

  private log(msg: string): void {
    (this.opts.log ?? ((m: string) => console.log(`[shared-mesh] ${m}`)))(msg);
  }

  getStatus(): SyncStatus {
    return { ...this.status, enabled: this.enabled };
  }

  private get ownPath(): string { return join(this.localDir, "own-delta.json.gz"); }
  private get statePath(): string { return join(this.localDir, "state.json"); }
  private get outboxPath(): string { return join(this.localDir, "outbox.json"); }

  private readState(): { lastPublishedHash?: string; lastPublishAt?: number } {
    try {
      return JSON.parse(readFileSync(this.statePath, "utf8"));
    } catch {
      return {};
    }
  }

  private writeState(patch: Record<string, unknown>): void {
    mkdirSync(this.localDir, { recursive: true });
    writeFileSync(this.statePath, JSON.stringify({ ...this.readState(), ...patch }, null, 2) + "\n", "utf8");
  }

  /**
   * Put the shared base, this install's saved learning, and (if sharing is
   * on) everyone else's into the engine. Returns false -- and leaves the
   * engine exactly as it was -- if there is no usable base or it doesn't fit.
   */
  boot(): boolean {
    const engine = this.getEngine();
    if (!engine) return this.fail("no engine");
    const base = readBaseFile(this.baseFile);
    if (!base) return this.fail(`no usable base at ${this.baseFile}`);
    const baseCore = extractCore(base.snapshot, base.shape);
    if (!baseCore) return this.fail("base snapshot is missing learned arrays");

    const current = engine.captureNetworkState();
    const currentCore = extractCore(current, base.shape);
    if (!currentCore) {
      return this.fail(`engine shape ${current.shape.neurons}x${current.shape.dimensions} doesn't contain base ${base.shape.neurons}x${base.shape.dimensions}`);
    }
    // The engine and the base must agree on WHICH arrays exist (e.g. both
    // with or both without per-connection biases), or core arithmetic would
    // silently skip some.
    const keys = Object.keys(baseCore).sort().join(",");
    if (keys !== Object.keys(currentCore).sort().join(",")) return this.fail("engine and base carry different learned arrays");

    this.baseId = base.baseId;
    this.shape = base.shape;
    this.baseCore = baseCore;
    this.installId = getInstallId(join(this.localDir, "install-id"));

    const own = loadOwnDelta(this.ownPath, this.baseId, baseCore) ?? zerosLike(baseCore);
    const others = this.enabled ? this.readOthers() : { contribution: zerosLike(baseCore), installs: 0, fingerprint: "" };

    const core = combine(combine(baseCore, own), others.contribution);
    const next = injectCore(current, core, base.shape);
    if (!next || !engine.restoreNetworkState(next)) return this.fail("engine refused the restored network");

    this.othersApplied = others.contribution;
    this.othersFingerprint = others.fingerprint;
    this.status = {
      ...this.status,
      loaded: true,
      reason: undefined,
      installId: this.installId,
      baseId: this.baseId,
      otherInstalls: others.installs,
    };
    this.log(
      `loaded shared base ${this.baseId}` +
        (this.enabled ? ` + learning from ${others.installs} other install(s)` : " (sharing off -- opt in with NEUROCLAW_SHARED_LEARNING=1)"),
    );
    return true;
  }

  private fail(reason: string): boolean {
    this.status = { ...this.status, loaded: false, reason };
    this.log(`not loaded: ${reason}`);
    return false;
  }

  private readOthers() {
    return readOthersContribution(this.deltasDir, {
      baseId: this.baseId,
      shape: this.shape!,
      expectedKeys: Object.keys(this.baseCore!),
      excludeInstallId: this.installId,
      template: this.baseCore!,
    });
  }

  /** What this install has learned on its own: core - base - what it absorbed from others. */
  private ownDelta(core: CoreArrays): CoreArrays {
    return combine(combine(core, this.baseCore!, -1), this.othersApplied!, -1);
  }

  /** One sync pass. Never throws. */
  async tick(now = Date.now()): Promise<void> {
    if (!this.status.loaded || !this.baseCore || !this.shape) return;
    try {
      const run = async () => this.tickLocked(now);
      if (this.lock) await this.lock.run(run);
      else await run();
    } catch (err) {
      this.log(`sync pass failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private tickLocked(now: number): void {
    const engine = this.getEngine();
    if (!engine) return;
    const snapshot = engine.captureNetworkState();
    const core = extractCore(snapshot, this.shape!);
    if (!core) return;

    // 1. Keep this install's own learning across restarts.
    const own = this.ownDelta(core);
    saveOwnDelta(this.ownPath, own, this.baseId);
    this.status.lastSavedAt = now;
    let ownRms = 0;
    for (const v of Object.values(own)) for (let i = 0; i < v.length; i++) ownRms += v[i] * v[i];
    this.status.ownDeltaRms = Math.sqrt(ownRms / Math.max(1, Object.values(own).reduce((n, v) => n + v.length, 0)));

    if (!this.enabled) return;

    // 2. Anything new from other installs (pulled in by git) -- swap the old
    //    contribution for the new one, leaving this install's own learning
    //    where it is.
    const others = this.readOthers();
    if (others.fingerprint !== this.othersFingerprint) {
      const updated = combine(combine(core, this.othersApplied!, -1), others.contribution);
      const next = injectCore(snapshot, updated, this.shape!);
      if (next && engine.restoreNetworkState(next)) {
        this.othersApplied = others.contribution;
        this.othersFingerprint = others.fingerprint;
        this.status.otherInstalls = others.installs;
        this.log(`merged learning from ${others.installs} other install(s)`);
      }
    }

    // 3. Push this install's learning if it changed since the last push.
    this.queuePublish(own, now);
  }

  private queuePublish(own: CoreArrays, now: number): void {
    const delta = encodeDelta(own, this.baseId, this.shape!);
    const content = JSON.stringify(delta) + "\n";
    const hash = createHash("sha256").update(content).digest("hex");
    const state = this.readState();
    if (state.lastPublishedHash === hash) return;
    // All-zero learning (a fresh install that hasn't been used) isn't worth a commit.
    if (Object.values(delta.arrays).every(a => a.scale === 0)) return;

    mkdirSync(this.localDir, { recursive: true });
    writeFileSync(
      this.outboxPath,
      JSON.stringify({ relPath: `extension-builder/shared-mesh/deltas/${this.installId}.json`, content, hash }),
      "utf8",
    );
    if (!existsSync(this.publishScript)) return;
    try {
      const child = (this.opts.spawnFn ?? spawn)(process.execPath, [this.publishScript], {
        cwd: this.root,
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.on?.("error", (err: Error) => this.log(`could not start push (non-fatal): ${err.message}`));
      child.unref?.();
      this.status.lastPublishQueuedAt = now;
    } catch (err) {
      this.log(`could not start push (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
