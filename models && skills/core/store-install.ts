/**
 * Installing store items onto THIS device.
 *
 * The store shows everything anyone published while holding only the payloads
 * someone asked for. That made "browse" and "download" real, but there was no
 * third step: nothing turned a downloaded item into something installed, for
 * any kind except prompting skills. So the catalogue could be read and could
 * not be used.
 *
 * The separation that matters is the same one prompting skills already draw.
 * Publishing is shared -- it commits and pushes, so it reaches everyone who
 * pulls. Installing is device-local, always, and never happens as a side
 * effect of publishing or of browsing: someone has to ask for it. One person
 * deciding what their agent runs must not decide it for everyone with a clone.
 *
 * Installing copies files into `extension-builder/installed/<kind>/<name>/`
 * rather than into the skill-upload packages directory next door. They could
 * have shared one namespace, but then installing something from the store
 * would silently overwrite a local package of the same name, and losing your
 * own work to someone else's upload is not an acceptable way to learn how
 * install works.
 *
 * Nothing here executes anything. Installing writes files and records what it
 * wrote. Running an installed skill is a separate, deliberate step through the
 * paths that already exist for it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { assertKind, assertSafeName, readItem, readItemFile, type StoreItem, type StoreKind } from "./store.js";
import { fetchItemFile } from "./store-fetch.js";
import { writeFileAtomic, writeJsonAtomic } from "./atomic-write.js";

export class StoreInstallError extends Error {}

/** Where installed items live. Device-local by design, overridable for tests. */
export function installedRoot(): string {
  return process.env.CORONA_INSTALLED_DIR
    ? path.resolve(process.env.CORONA_INSTALLED_DIR)
    : path.resolve(process.cwd(), "extension-builder", "installed");
}

/** The record written beside an installed item, so an install is inspectable later. */
export interface InstalledRecord {
  kind: StoreKind;
  name: string;
  title: string;
  author: string;
  /** The item's updatedAt at the moment it was installed -- what an update check compares against. */
  installedVersion: string;
  installedAt: number;
  files: Array<{ filename: string; bytes: number; sha256: string }>;
}

const RECORD = "installed.json";

/** How many files to download at once. Enough to hide latency, few enough not to look like a scraper. */
const DOWNLOAD_CONCURRENCY = 4;

function itemInstallDir(kind: string, name: string): string {
  // Validated here rather than relying on a caller having done it. installItem
  // reached this through readItem(), which validates -- but uninstallItem did
  // not, and `uninstallItem("skills", "..")` resolved to the installed root
  // itself, passed a containment check that allowed `dir === root`, and
  // rm -rf'd every installed item on the machine. It was reachable from the
  // uninstall route and from "store uninstall skills .." in chat, since the
  // command's own name pattern allows dots.
  assertKind(kind);
  assertSafeName(name);

  const root = path.resolve(installedRoot());
  const dir = path.resolve(root, kind, name);
  // Strictly BELOW the root, never equal to it: an item lives two levels down,
  // so a path that resolves to the root (or above) is not an item at all and
  // deleting it would take everything else with it.
  if (dir === root || !dir.startsWith(root + path.sep)) {
    throw new StoreInstallError(`"${kind}/${name}" is not a valid installed item path.`);
  }
  return dir;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface InstallResult {
  record: InstalledRecord;
  /** Files that had to be downloaded rather than already being on this device. */
  downloaded: string[];
  /** Files that could not be obtained at all, with the reason. Installing continues without them. */
  missing: Array<{ filename: string; reason: string }>;
}

/**
 * Install one published item.
 *
 * Files already on this device are used as they are; anything missing is
 * fetched, which is checksum-verified by fetchItemFile against the manifest.
 * A file that cannot be obtained does not abort the install -- it is reported.
 * An install that refuses entirely because one optional README was unreachable
 * would be worse than one that says which piece is absent.
 */
export async function installItem(kind: string, name: string): Promise<InstallResult> {
  const item = readItem(kind, name);
  if (!item) throw new StoreInstallError(`There is no published "${kind}/${name}" to install.`);
  if (item.files.length === 0) throw new StoreInstallError(`"${kind}/${name}" has no files to install.`);

  const dir = itemInstallDir(item.kind, item.name);
  const downloaded: string[] = [];
  const missing: Array<{ filename: string; reason: string }> = [];
  const written: InstalledRecord["files"] = [];

  const fetchOne = async (entry: (typeof item.files)[number]): Promise<void> => {
    let buf = readItemFile(item.kind, item.name, entry.filename);
    if (!buf) {
      try {
        buf = (await fetchItemFile(item.kind, item.name, entry.filename)).buf;
        downloaded.push(entry.filename);
      } catch (err) {
        missing.push({ filename: entry.filename, reason: err instanceof Error ? err.message : String(err) });
        return;
      }
    }
    const target = path.join(dir, entry.filename);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileAtomic(target, buf);
    written.push({ filename: entry.filename, bytes: buf.length, sha256: sha256(buf) });
  };

  // A worker pool rather than a sequential loop: every missing file is its own
  // round trip to GitHub, and doing twelve of them one after another spends
  // twelve latencies where four would do. Bounded rather than unbounded --
  // opening a socket per file would be a good way to get rate-limited, and an
  // install is not the place to discover that.
  const queue = [...item.files];
  const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await fetchOne(next);
  });
  await Promise.all(workers);
  // Order is not guaranteed by a pool, and a record whose file list reshuffles
  // between installs would make every diff of it noise.
  written.sort((a, b) => a.filename.localeCompare(b.filename));
  downloaded.sort();
  missing.sort((a, b) => a.filename.localeCompare(b.filename));

  if (written.length === 0) {
    throw new StoreInstallError(
      `Could not install "${kind}/${name}": none of its files could be obtained. ${missing[0]?.reason ?? ""}`.trim(),
    );
  }

  const record: InstalledRecord = {
    kind: item.kind,
    name: item.name,
    title: item.title,
    author: item.author,
    installedVersion: item.updatedAt,
    installedAt: Date.now(),
    files: written,
  };
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(path.join(dir, RECORD), record);
  return { record, downloaded, missing };
}

/**
 * Remove an installed item from this device.
 *
 * Open, unlike deleting from the store. Uninstalling touches only this
 * machine's copy and destroys nobody else's work, which is exactly the line
 * the rest of this system draws around destruction.
 */
export function uninstallItem(kind: string, name: string): boolean {
  const dir = itemInstallDir(kind, name);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function readInstalled(kind: string, name: string): InstalledRecord | null {
  const file = path.join(itemInstallDir(kind, name), RECORD);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as InstalledRecord;
  } catch {
    // A record we cannot parse means we cannot honestly claim it is
    // installed, so it is reported as absent rather than as a broken install.
    return null;
  }
}

export function isInstalled(kind: string, name: string): boolean {
  return readInstalled(kind, name) !== null;
}

/** Everything installed on this device, newest first. */
export function listInstalledItems(): InstalledRecord[] {
  const root = installedRoot();
  if (!existsSync(root)) return [];
  const out: InstalledRecord[] = [];
  for (const kind of readdirSync(root)) {
    const kindDir = path.join(root, kind);
    if (!statSync(kindDir).isDirectory()) continue;
    for (const name of readdirSync(kindDir)) {
      if (!statSync(path.join(kindDir, name)).isDirectory()) continue;
      const record = readInstalled(kind, name);
      if (record) out.push(record);
    }
  }
  return out.sort((a, b) => b.installedAt - a.installedAt);
}

/**
 * Which installed items the store has moved on from.
 *
 * Compares the file digests, not the timestamps. `updatedAt` has millisecond
 * resolution, so two publishes inside the same millisecond carry the same
 * stamp and an edit made that fast would be invisible to an update check --
 * which is exactly the kind of "worked when I tried it" bug that only shows up
 * on a fast machine. The digests are already in both the manifest and the
 * install record, they are what the download is verified against, and they
 * answer the real question: would updating change any bytes.
 */
export function changedFiles(record: InstalledRecord, published: StoreItem): string[] {
  const installed = new Map(record.files.map(f => [f.filename, f.sha256]));
  const changed: string[] = [];
  for (const f of published.files) {
    if (installed.get(f.filename) !== f.sha256) changed.push(f.filename);
  }
  // A file the published item no longer has is a change too: an install still
  // holding a removed file is out of date, not merely stale.
  for (const filename of installed.keys()) {
    if (!published.files.some(f => f.filename === filename)) changed.push(filename);
  }
  return changed.sort();
}

export function outdatedInstalls(): Array<{ record: InstalledRecord; published: StoreItem; changed: string[] }> {
  const out: Array<{ record: InstalledRecord; published: StoreItem; changed: string[] }> = [];
  for (const record of listInstalledItems()) {
    const published = readItem(record.kind, record.name);
    if (!published) continue;
    const changed = changedFiles(record, published);
    if (changed.length > 0) out.push({ record, published, changed });
  }
  return out;
}

/** Reinstall everything that has moved on. Returns what was updated and what failed. */
export async function updateInstalls(): Promise<{
  updated: InstalledRecord[];
  failed: Array<{ kind: string; name: string; reason: string }>;
}> {
  const updated: InstalledRecord[] = [];
  const failed: Array<{ kind: string; name: string; reason: string }> = [];
  for (const { record } of outdatedInstalls()) {
    try {
      updated.push((await installItem(record.kind, record.name)).record);
    } catch (err) {
      failed.push({ kind: record.kind, name: record.name, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { updated, failed };
}

/** An installed item's file, read back from this device. */
export function readInstalledFile(kind: string, name: string, filename: string): Buffer | null {
  const dir = itemInstallDir(kind, name);
  const full = path.resolve(dir, filename);
  if (!full.startsWith(dir + path.sep)) return null;
  return existsSync(full) && statSync(full).isFile() ? readFileSync(full) : null;
}

/** One thing an installed item wants the system to remember. */
export interface ActivatableMemory {
  content: string;
  payload?: string;
  tags: string[];
}

export interface ActivationPlan {
  /** Files that carried loadable knowledge. */
  from: string[];
  memories: ActivatableMemory[];
  /**
   * Set when the item installed fine but carries nothing this system knows how
   * to load -- a Python bridge and a README, say. Not an error: plenty of
   * useful store items are instructions for a human, and reporting that
   * honestly beats implying something was activated.
   */
  nothingLoadable?: string;
}

/**
 * What an installed item would contribute if it were activated.
 *
 * Separate from doing it, so the caller owns the actual writes to memory and
 * this stays testable without a whole system. Reads only what the install
 * already wrote to this device.
 *
 * This exists because installing was inert. Files were copied into
 * extension-builder/installed/ and nothing ever read them back --
 * readInstalledFile had no callers at all, which the unreachable-code detector
 * is what surfaced. "Install" that produces files no part of the system
 * consumes is a copy, not an install.
 */
export function planActivation(kind: string, name: string): ActivationPlan {
  const record = readInstalled(kind, name);
  if (!record) return { from: [], memories: [], nothingLoadable: `"${kind}/${name}" is not installed.` };

  const from: string[] = [];
  const memories: ActivatableMemory[] = [];

  for (const file of record.files) {
    // Only the neuron-bearing JSON the rest of this system already understands.
    // Guessing at other formats would be inventing a loader for files nobody
    // agreed on a shape for.
    if (!/\.(skill|source|ext)\.json$/i.test(file.filename) && !/^skill\.json$/i.test(file.filename)) continue;
    const buf = readInstalledFile(kind, name, file.filename);
    if (!buf) continue;

    let parsed: { neurons?: unknown };
    try {
      parsed = JSON.parse(buf.toString("utf8")) as { neurons?: unknown };
    } catch {
      // A malformed file in an otherwise good item should not stop the rest
      // loading, and should not look like the item had nothing in it.
      continue;
    }
    const neurons = Array.isArray(parsed?.neurons) ? parsed.neurons : [];
    if (neurons.length === 0) continue;
    from.push(file.filename);

    for (const raw of neurons) {
      const neuron = raw as { name?: string; definition?: string; scripts?: Array<{ userSays?: string; response?: string }> };
      if (!neuron?.name) continue;
      const definition = (neuron.definition ?? "").trim();
      if (definition) {
        memories.push({ content: `${neuron.name}: ${definition}`, tags: ["store-install", `${kind}/${name}`] });
      }
      for (const script of neuron.scripts ?? []) {
        const userSays = (script?.userSays ?? "").trim();
        const response = (script?.response ?? "").trim();
        if (!userSays || !response) continue;
        memories.push({ content: userSays, payload: response, tags: ["skill-script", "store-install", `${kind}/${name}`] });
      }
    }
  }

  if (memories.length === 0) {
    return {
      from,
      memories,
      nothingLoadable:
        `"${kind}/${name}" is installed, but carries nothing this system knows how to load ` +
        `(no neuron definitions or skill scripts). Its files are on disk and can be read.`,
    };
  }
  return { from, memories };
}
