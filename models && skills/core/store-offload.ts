/**
 * Offloading downloaded store items that have gone unused, and getting them
 * back when they are needed.
 *
 * A device ends up holding two kinds of local copy of a published item:
 *
 *   store      the payload files cached under store/<kind>/<name>/ when someone
 *              downloaded, installed or applied them (store-fetch.ts)
 *   installed  the copy under extension-builder/installed/<kind>/<name>/
 *              (store-install.ts)
 *
 * Both are caches of something on the store branch. Neither needs to stay once
 * nothing has used it for a while. This removes the payload files of items that
 * have been idle past a threshold and leaves the small index behind:
 *
 *   - the store item keeps its manifest.json, so it still shows in the
 *     catalogue with its files listed as "not on this device";
 *   - the installed item keeps installed.json, now marked `offloadedAt`, so it
 *     is still listed as installed.
 *
 * Getting an item back needs no new machinery. fetchItemFile() already
 * downloads any file the manifest lists that is missing, verified against the
 * manifest's sha256, and installItem()/applyMod()/read_mod all go through it.
 *
 * The one rule that matters: nothing is removed unless the store branch is
 * confirmed to hold it. A local copy that was never pushed, that differs from
 * what was pushed, or that cannot be checked because the remote is unreachable
 * is the only copy there is, and is left alone. "Confirmed" means the git
 * object of the remote file equals the git object of the local bytes -- a
 * comparison of content, not of names, done on a freshly fetched ref and
 * without downloading any payload.
 *
 * Never offloaded: a mod that is currently applied (its target files are live
 * on this device), and any kind outside OFFLOAD_KINDS.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync } from "node:fs";
import path from "node:path";
import { assertKind, assertSafeName, itemDir, listCatalog, readItem, storeRoot, type StoreItem } from "./store.js";
import { DEFAULT_STORE_BRANCH } from "./store-sync.js";
import { installedRoot, listInstalledItems, type InstalledRecord } from "./store-install.js";
import { isApplied } from "./mod-apply.js";
import { readUsage, type UsageMap } from "./store-usage.js";
import { writeJsonAtomic } from "./atomic-write.js";

/** The store kinds whose downloaded copies are offloaded: skills, plugins and modifications. */
export const OFFLOAD_KINDS = ["net-skills", "prompting", "plugins", "mods"] as const;

export const DEFAULT_IDLE_DAYS = 30;
const DAY_MS = 86_400_000;
const GIT_TIMEOUT_MS = 30_000;
const FIRST_RUN_DELAY_MS = 10 * 60_000;
const DEFAULT_INTERVAL_MS = DAY_MS;
const MIN_INTERVAL_MS = 60 * 60_000;

/** Days idle before an item is offloaded: NEUROCLAW_OFFLOAD_DAYS, else 30. */
export function configuredIdleDays(): number {
  const raw = Number(process.env.NEUROCLAW_OFFLOAD_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_DAYS;
}

export interface OffloadCandidate {
  kind: string;
  name: string;
  title: string;
  lastUsedAt: number;
  idleDays: number;
  /** Bytes of cached store payload that would be freed. */
  storeBytes: number;
  /** Bytes of installed copy that would be freed. */
  installedBytes: number;
}

export interface OffloadedItem extends OffloadCandidate {
  layers: Array<"store" | "installed">;
  freedBytes: number;
}

export interface SkippedItem {
  kind: string;
  name: string;
  reason: string;
}

export interface OffloadReport {
  at: number;
  idleDays: number;
  dryRun: boolean;
  /** Items past the idle threshold. */
  idle: number;
  /** Whether the store branch could be checked at all. */
  cloud: { ok: boolean; reason?: string };
  /** What was removed, or with dryRun what would be. */
  offloaded: OffloadedItem[];
  skipped: SkippedItem[];
  freedBytes: number;
}

// ── Finding what is idle ──────────────────────────────────────────────────

function localPayloads(item: StoreItem): Array<{ file: string; bytes: number }> {
  const root = path.resolve(itemDir(item.kind, item.name));
  const out: Array<{ file: string; bytes: number }> = [];
  for (const f of item.files) {
    if (!f.local) continue;
    const file = path.resolve(root, f.filename);
    if (file.startsWith(root + path.sep)) out.push({ file, bytes: f.bytes });
  }
  return out;
}

function installedPayloads(record: InstalledRecord): Array<{ file: string; bytes: number }> {
  if (record.offloadedAt) return [];
  const root = path.resolve(installedRoot(), record.kind, record.name);
  const out: Array<{ file: string; bytes: number }> = [];
  for (const f of record.files) {
    const file = path.resolve(root, f.filename);
    if (file.startsWith(root + path.sep) && existsSync(file)) out.push({ file, bytes: f.bytes });
  }
  return out;
}

function lastUse(item: StoreItem, record: InstalledRecord | null, usage: UsageMap, now: number): number {
  const used = Math.max(usage[`${item.kind}/${item.name}`]?.lastUsedAt ?? 0, record?.installedAt ?? 0);
  if (used > 0) return used;
  // Nothing recorded and not installed: the payload was cached before use was
  // tracked, or published from here. When the file landed is the best signal.
  let newest = 0;
  for (const { file } of localPayloads(item)) {
    newest = Math.max(newest, statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0);
  }
  // No signal at all means "just seen", never "ancient": an unknown age must
  // not be the reason something gets removed.
  return newest || now;
}

interface Found {
  candidates: Array<{ item: StoreItem; record: InstalledRecord | null; candidate: OffloadCandidate }>;
  skipped: SkippedItem[];
}

function findIdle(idleDays: number, now: number): Found {
  const usage = readUsage();
  const installed = new Map(listInstalledItems().map(r => [`${r.kind}/${r.name}`, r]));
  const catalog = listCatalog();
  const out: Found = { candidates: [], skipped: [] };
  const seen = new Set<string>();

  const consider = (item: StoreItem): void => {
    const key = `${item.kind}/${item.name}`;
    seen.add(key);
    const record = installed.get(key) ?? null;
    const store = localPayloads(item);
    const inst = record ? installedPayloads(record) : [];
    if (store.length === 0 && inst.length === 0) return;

    const used = lastUse(item, record, usage, now);
    const idle = (now - used) / DAY_MS;
    if (idle < idleDays) return;

    if (item.kind === "mods" && isApplied(item.name)) {
      out.skipped.push({ kind: item.kind, name: item.name, reason: "this mod is applied on this device" });
      return;
    }
    out.candidates.push({
      item,
      record,
      candidate: {
        kind: item.kind,
        name: item.name,
        title: item.title,
        lastUsedAt: used,
        idleDays: Math.floor(idle),
        storeBytes: store.reduce((n, f) => n + f.bytes, 0),
        installedBytes: inst.reduce((n, f) => n + f.bytes, 0),
      },
    });
  };

  for (const kind of OFFLOAD_KINDS) for (const item of catalog[kind] ?? []) consider(item);

  // An installed copy whose store entry is gone cannot be re-fetched from
  // anywhere, so it is the only copy left and is never a candidate.
  for (const [key, record] of installed) {
    if (seen.has(key) || !(OFFLOAD_KINDS as readonly string[]).includes(record.kind)) continue;
    if (installedPayloads(record).length > 0) {
      out.skipped.push({ kind: record.kind, name: record.name, reason: "no longer in the store, so this is the only copy" });
    }
  }
  return out;
}

/** What is idle right now. Reads the disk only; nothing is checked against the cloud and nothing changes. */
export function listOffloadCandidates(opts: { idleDays?: number; now?: number } = {}): OffloadCandidate[] {
  return findIdle(opts.idleDays ?? configuredIdleDays(), opts.now ?? Date.now()).candidates.map(c => c.candidate);
}

// ── Confirming the store branch holds an item ─────────────────────────────

export interface CloudCheck {
  ok: boolean;
  reason?: string;
}

export type CloudSource = { check(item: StoreItem): CloudCheck } | { unavailable: string };

function git(args: string[], cwd: string): Promise<{ ok: boolean; stdout: Buffer }> {
  return new Promise(resolve => {
    execFile("git", args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024, encoding: "buffer" }, (err, stdout) => {
      resolve({ ok: !err, stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? "")) });
    });
  });
}

function gitObjectId(bytes: Buffer, idLength: number): string {
  return createHash(idLength === 64 ? "sha256" : "sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

/**
 * The store branch as GitHub has it right now.
 *
 * Fetches first and fails closed: a stale remote-tracking ref could still list
 * a file the remote has since lost, and "probably there" is not enough to
 * delete the only local copy.
 */
export async function gitCloudSource(opts: { remote?: string; branch?: string } = {}): Promise<CloudSource> {
  if (process.env.NEUROCLAW_STORE_NO_SYNC === "1") {
    return { unavailable: "Store sync is disabled (NEUROCLAW_STORE_NO_SYNC=1), so nothing can be confirmed on the cloud." };
  }
  const remote = opts.remote ?? "origin";
  const branch = opts.branch ?? DEFAULT_STORE_BRANCH;
  const root = storeRoot();
  const start = existsSync(root) ? root : path.dirname(root);

  const top = await git(["rev-parse", "--show-toplevel"], start);
  if (!top.ok) return { unavailable: "The store is not inside a git repository, so there is no cloud copy to confirm." };
  const repo = top.stdout.toString("utf8").trim();

  const fetched = await git(["fetch", remote, `${branch}:refs/remotes/${remote}/${branch}`], repo);
  if (!fetched.ok) return { unavailable: `Could not reach "${remote}" to confirm the "${branch}" branch.` };

  const rel = path.relative(repo, root).split(path.sep).join("/");
  if (!rel || rel.startsWith("..")) return { unavailable: "The store directory is outside the repository." };

  const listing = await git(["ls-tree", "-r", "-z", `${remote}/${branch}`, "--", rel], repo);
  if (!listing.ok) return { unavailable: `Could not read the "${branch}" branch on "${remote}".` };

  const remoteIds = new Map<string, string>();
  let idLength = 40;
  for (const entry of listing.stdout.toString("utf8").split("\0")) {
    const m = /^\d+ blob ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
    if (!m) continue;
    idLength = m[1].length;
    remoteIds.set(m[2], m[1]);
  }

  return {
    check(item: StoreItem): CloudCheck {
      const base = `${rel}/${item.kind}/${item.name}`;
      const itemRoot = path.resolve(itemDir(item.kind, item.name));
      for (const f of item.files) {
        const remoteId = remoteIds.get(`${base}/${f.filename}`);
        if (!remoteId) return { ok: false, reason: `"${f.filename}" is not on the "${branch}" branch yet` };
        if (!f.local) continue;
        const local = path.resolve(itemRoot, f.filename);
        if (!local.startsWith(itemRoot + path.sep)) return { ok: false, reason: `"${f.filename}" resolves outside the item` };
        if (gitObjectId(readFileSync(local), idLength) !== remoteId) {
          return { ok: false, reason: `"${f.filename}" differs from the copy on the "${branch}" branch (or is stored as an LFS pointer there)` };
        }
      }
      return { ok: true };
    },
  };
}

// ── Removing ──────────────────────────────────────────────────────────────

function pruneEmptyDirs(dir: string, keep: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirs(path.join(dir, entry.name), keep);
  }
  if (path.resolve(dir) !== path.resolve(keep) && readdirSync(dir).length === 0) rmdirSync(dir);
}

function hasFileIndex(item: StoreItem): boolean {
  try {
    const manifest = JSON.parse(readFileSync(path.join(itemDir(item.kind, item.name), "manifest.json"), "utf8")) as { files?: unknown };
    return Array.isArray(manifest.files);
  } catch {
    return false;
  }
}

function removeFiles(files: Array<{ file: string; bytes: number }>, root: string): number {
  let freed = 0;
  for (const { file } of files) {
    const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    rmSync(file, { force: true });
    freed += size;
  }
  pruneEmptyDirs(root, root);
  return freed;
}

function offloadInstalled(record: InstalledRecord, now: number): number {
  assertKind(record.kind);
  assertSafeName(record.name);
  const dir = path.resolve(installedRoot(), record.kind, record.name);
  const freed = removeFiles(installedPayloads(record), dir);
  writeJsonAtomic(path.join(dir, "installed.json"), { ...record, offloadedAt: now });
  return freed;
}

let inFlight: Promise<OffloadReport> | null = null;

/**
 * Offload every item that has been idle for `idleDays` and is confirmed on the
 * store branch. One run at a time: a second call while one is running gets the
 * first run's report rather than racing it.
 */
export function offloadIdle(
  opts: { idleDays?: number; now?: number; dryRun?: boolean; cloud?: CloudSource } = {},
): Promise<OffloadReport> {
  if (inFlight) return inFlight;
  const run = runOffload(opts).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

async function runOffload(
  opts: { idleDays?: number; now?: number; dryRun?: boolean; cloud?: CloudSource },
): Promise<OffloadReport> {
  const idleDays = opts.idleDays ?? configuredIdleDays();
  const now = opts.now ?? Date.now();
  const dryRun = opts.dryRun === true;
  const { candidates, skipped } = findIdle(idleDays, now);
  const report: OffloadReport = {
    at: now,
    idleDays,
    dryRun,
    idle: candidates.length,
    cloud: { ok: true },
    offloaded: [],
    skipped: [...skipped],
    freedBytes: 0,
  };
  // Nothing idle means no reason to touch the network at all.
  if (candidates.length === 0) return report;

  const cloud = opts.cloud ?? (await gitCloudSource());
  if ("unavailable" in cloud) {
    report.cloud = { ok: false, reason: cloud.unavailable };
    for (const { candidate } of candidates) {
      report.skipped.push({ kind: candidate.kind, name: candidate.name, reason: cloud.unavailable });
    }
    return report;
  }

  for (const { item, record, candidate } of candidates) {
    const skip = (reason: string): void => {
      report.skipped.push({ kind: item.kind, name: item.name, reason });
    };
    if (!hasFileIndex(item)) {
      skip("its manifest has no file index, so its files could not be listed again after removal");
      continue;
    }
    const check = cloud.check(item);
    if (!check.ok) {
      skip(`not confirmed on the cloud: ${check.reason ?? "unknown"}`);
      continue;
    }
    if (dryRun) {
      report.offloaded.push({
        ...candidate,
        layers: [...(candidate.storeBytes > 0 ? ["store" as const] : []), ...(candidate.installedBytes > 0 ? ["installed" as const] : [])],
        freedBytes: candidate.storeBytes + candidate.installedBytes,
      });
      report.freedBytes += candidate.storeBytes + candidate.installedBytes;
      continue;
    }

    // The cloud check can take a moment. If the item was used meanwhile, it is
    // not idle any more and stays.
    const current = readItem(item.kind, item.name);
    if (!current || lastUse(current, record, readUsage(), now) > candidate.lastUsedAt) {
      skip("it was used while the offload was running");
      continue;
    }

    const layers: Array<"store" | "installed"> = [];
    let freed = 0;
    try {
      const storeFiles = localPayloads(current);
      if (storeFiles.length > 0) {
        freed += removeFiles(storeFiles, path.resolve(itemDir(item.kind, item.name)));
        layers.push("store");
      }
      if (record && installedPayloads(record).length > 0) {
        freed += offloadInstalled(record, Date.now());
        layers.push("installed");
      }
    } catch (err) {
      skip(`could not remove its files: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    report.offloaded.push({ ...candidate, layers, freedBytes: freed });
    report.freedBytes += freed;
  }
  return report;
}

// ── Running it on a schedule ──────────────────────────────────────────────

/**
 * Offload on a timer for as long as the process lives. Self-scheduling, so a
 * slow run delays the next one instead of overlapping it. NEUROCLAW_AUTO_OFFLOAD=0
 * turns it off. Returns a function that stops it.
 */
let autoStop: (() => void) | null = null;

export function startAutoOffload(
  opts: { firstDelayMs?: number; intervalMs?: number; log?: (message: string) => void } = {},
): () => void {
  if (process.env.NEUROCLAW_AUTO_OFFLOAD === "0") return () => {};
  if (autoStop) return autoStop;
  const log = opts.log ?? ((m: string) => console.log(m));
  const interval = Math.max(MIN_INTERVAL_MS, opts.intervalMs ?? DEFAULT_INTERVAL_MS);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    try {
      const report = await offloadIdle();
      if (report.offloaded.length > 0) {
        const mb = (report.freedBytes / 1024 / 1024).toFixed(1);
        log(`[offload] moved ${report.offloaded.length} unused store item(s) off this device (${mb} MB); they download again when needed.`);
      }
    } catch (err) {
      console.warn("[offload] run failed:", err instanceof Error ? err.message : err);
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), interval);
      timer.unref();
    }
  };
  timer = setTimeout(() => void tick(), opts.firstDelayMs ?? FIRST_RUN_DELAY_MS);
  timer.unref();
  autoStop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    autoStop = null;
  };
  return autoStop;
}
