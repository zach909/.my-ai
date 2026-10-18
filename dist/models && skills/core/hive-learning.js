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
import { sharedLearningEnabled } from "./shared-mesh-sync.js";
import { combine, encodeDelta, extractCore, injectCore, loadOwnDelta, readBaseFile, rms, saveOwnDelta, zerosLike, } from "./shared-mesh.js";
/**
 * The weighted average of several deltas: sum(w * delta) / sum(w). Anyone with
 * no weight, or whose arrays do not line up with the first contributor's, is
 * left out rather than guessed at. Null if nobody is left.
 */
export function mergeDeltas(parts) {
    const usable = parts.filter(p => Number.isFinite(p.weight) && p.weight > 0 && p.delta && Object.keys(p.delta).length > 0);
    if (usable.length === 0)
        return null;
    const keys = Object.keys(usable[0].delta);
    const fits = (d) => Object.keys(d).length === keys.length && keys.every(k => d[k] && d[k].length === usable[0].delta[k].length);
    const members = usable.filter(p => fits(p.delta));
    const total = members.reduce((n, p) => n + p.weight, 0);
    const merged = zerosLike(usable[0].delta);
    for (const p of members) {
        const w = p.weight / total;
        for (const k of keys) {
            const out = merged[k];
            const src = p.delta[k];
            for (let i = 0; i < out.length; i++)
                out[i] += src[i] * w;
        }
    }
    return { merged, shares: members.map(p => ({ id: p.id, share: p.weight / total })) };
}
const DEFAULT_MAX_BYTES = 512;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
export class MeshAgentLearner {
    constructor(opts) {
        this.opts = opts;
        this.loaded = null;
    }
    loadBase() {
        if (this.loaded)
            return this.loaded;
        const base = readBaseFile(this.opts.baseFile);
        const baseCore = base ? extractCore(base.snapshot, base.shape) : null;
        if (!base || !baseCore)
            return null;
        this.loaded = { baseId: base.baseId, shape: base.shape, baseCore };
        return this.loaded;
    }
    pathFor(agentId) {
        return SAFE_ID.test(agentId) ? join(this.opts.dir, `${agentId}.delta.json.gz`) : null;
    }
    base() {
        const b = this.loadBase();
        return b ? { baseId: b.baseId, shape: b.shape } : null;
    }
    delta(agentId) {
        const b = this.loadBase();
        const file = this.pathFor(agentId);
        if (!b || !file)
            return null;
        const own = loadOwnDelta(file, b.baseId, b.baseCore);
        return own && rms(own) > 0 ? own : null;
    }
    forget(agentId) {
        const file = this.pathFor(agentId);
        if (file)
            rmSync(file, { force: true });
    }
    clone(fromId, toId) {
        const from = this.pathFor(fromId);
        const to = this.pathFor(toId);
        if (!from || !to || !existsSync(from))
            return false;
        try {
            mkdirSync(this.opts.dir, { recursive: true });
            copyFileSync(from, to);
            return true;
        }
        catch {
            return false;
        }
    }
    async teach(agentId, text) {
        const b = this.loadBase();
        const file = this.pathFor(agentId);
        if (!b || !file)
            return { ok: false, reason: b ? "bad agent id" : "no shared base to learn against" };
        const bytes = Buffer.from(String(text ?? ""), "utf8");
        if (bytes.length === 0)
            return { ok: false, reason: "nothing to teach" };
        const lesson = bytes.subarray(0, this.opts.maxBytes ?? DEFAULT_MAX_BYTES).toString("utf8");
        return this.opts.lock.run(async () => {
            const engine = this.opts.engine();
            if (!engine)
                return { ok: false, reason: "the brain is not running yet" };
            const live = engine.captureNetworkState();
            try {
                // Start where this agent left off: the base plus what it already learned.
                const own = loadOwnDelta(file, b.baseId, b.baseCore) ?? zerosLike(b.baseCore);
                const start = injectCore(live, combine(b.baseCore, own), b.shape);
                if (!start || !engine.restoreNetworkState(start))
                    return { ok: false, reason: "the brain's shape does not match the shared base" };
                await this.opts.feed(lesson);
                const after = extractCore(engine.captureNetworkState(), b.shape);
                if (!after)
                    return { ok: false, reason: "the brain changed shape while learning" };
                mkdirSync(this.opts.dir, { recursive: true });
                saveOwnDelta(file, combine(after, b.baseCore, -1), b.baseId);
                return { ok: true };
            }
            catch (err) {
                return { ok: false, reason: err instanceof Error ? err.message : String(err) };
            }
            finally {
                // Whatever happened, the live brain goes back exactly as it was.
                engine.restoreNetworkState(live);
            }
        });
    }
}
// ── Publishing ─────────────────────────────────────────────────────────
/** A project's contributor id: stable, so publishing it again replaces its own file and nobody else's. */
export function projectDeltaId(projectId) {
    return createHash("sha256").update(`hive:${projectId}`).digest("hex").slice(0, 16);
}
export function publishMergedDelta(args) {
    const { projectId, merged, baseId, shape, paths } = args;
    const delta = encodeDelta(merged, baseId, shape);
    // Nothing learned is not worth a file, let alone a commit.
    if (Object.values(delta.arrays).every(a => a.scale === 0))
        return null;
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
    if (!existsSync(script))
        return { id, relPath, push: "no-script", reason: "The publish script is missing." };
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
    }
    catch (err) {
        return { id, relPath, push: "failed", reason: err instanceof Error ? err.message : String(err) };
    }
}
