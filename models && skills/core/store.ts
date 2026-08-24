/**
 * The public store: everything anyone publishes, in one folder that travels
 * with the repository.
 *
 * The whole point is that a published item is NOT device-local. It is written
 * into `store/` at the repo root, committed, and pushed to GitHub. Anyone who
 * clones or pulls the repository gets every published skill, plugin, binary,
 * source drop, file and wiki page — without access to the publisher's machine,
 * without an account, and without a server anyone has to keep running. The
 * catalog is derived from the files on disk rather than a database, so `git
 * pull` alone is a complete sync.
 *
 * Publishing is open; installing is not automatic. An item sitting in the
 * store does nothing until someone chooses to install it (see
 * plugin/skill installation elsewhere) — the same rule the wiki follows, where
 * anyone may add and only a privileged caller may destroy.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { syncStorePaths, type StoreSyncResult } from "./store-sync.js";

/** What kinds of thing the store holds. Each is a folder under `store/`. */
export const STORE_KINDS = ["skills", "plugins", "binaries", "source", "files", "wiki"] as const;
export type StoreKind = (typeof STORE_KINDS)[number];

/** Human labels, used by the UI so the names live in one place. */
export const STORE_KIND_LABELS: Record<StoreKind, string> = {
  skills: "Skills",
  plugins: "Plugins & Tools",
  binaries: "Binary Skills",
  source: "Source Code",
  files: "Files",
  wiki: "Wiki Pages",
};

export class StoreError extends Error {}

/**
 * Caps. Generous enough for a real binary skill, small enough that one publish
 * cannot bloat every clone of the repository — everybody who pulls pays for
 * whatever anyone pushes, which is exactly why this is bounded.
 */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ITEM_BYTES = 32 * 1024 * 1024;
const MAX_FILES_PER_ITEM = 64;

export interface StoreFile {
  filename: string;
  /** Text content, or base64 when `encoding` is "base64". */
  content: string;
  encoding?: "utf8" | "base64";
}

export interface StoreFileInfo {
  filename: string;
  bytes: number;
  /** SHA-256, so a consumer can tell whether a pulled file changed. */
  sha256: string;
}

export interface StoreItem {
  kind: StoreKind;
  name: string;
  title: string;
  description: string;
  /** Free-form, e.g. a GitHub handle. Never verified — it is a label, not an identity. */
  author: string;
  publishedAt: string;
  updatedAt: string;
  files: StoreFileInfo[];
  totalBytes: number;
}

export function storeRoot(): string {
  // Overridable so tests never write into the real store.
  return process.env.NEUROCLAW_STORE_DIR
    ? path.resolve(process.env.NEUROCLAW_STORE_DIR)
    : path.resolve(process.cwd(), "store");
}

function kindDir(kind: StoreKind): string {
  return path.join(storeRoot(), kind);
}

function itemDir(kind: StoreKind, name: string): string {
  return path.join(kindDir(kind), name);
}

const MANIFEST = "manifest.json";

/**
 * Item and file names are attacker-controlled: anyone can publish. A name that
 * escapes its folder would let a publish overwrite files elsewhere in the
 * repository of everyone who pulls, so this is a whitelist rather than a
 * blacklist of bad patterns.
 */
export function assertSafeName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) || name.includes("..")) {
    throw new StoreError(
      `"${name}" is not a valid name — letters, digits, '.', '-' and '_' only, up to 64 characters, and it cannot contain '..'.`
    );
  }
}

/** Same rules for filenames, plus an explicit rejection of any path separator. */
export function assertSafeFilename(filename: string): void {
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new StoreError(`"${filename}" cannot contain a path separator or '..'.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(filename)) {
    throw new StoreError(`"${filename}" is not a valid filename.`);
  }
}

export function assertKind(kind: string): asserts kind is StoreKind {
  if (!(STORE_KINDS as readonly string[]).includes(kind)) {
    throw new StoreError(`"${kind}" is not a store section. Expected one of: ${STORE_KINDS.join(", ")}.`);
  }
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Publish (or update) an item. Existing files are kept unless the publish
 * replaces them by name, so an update can add one file without re-uploading
 * everything.
 */
export function publishItem(input: {
  kind: string;
  name: string;
  title?: string;
  description?: string;
  author?: string;
  files: StoreFile[];
}): StoreItem {
  assertKind(input.kind);
  assertSafeName(input.name);
  const kind = input.kind;

  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new StoreError("A publish needs at least one file.");
  }
  if (input.files.length > MAX_FILES_PER_ITEM) {
    throw new StoreError(`Too many files (max ${MAX_FILES_PER_ITEM}).`);
  }

  const dir = itemDir(kind, input.name);
  const existing = existsSync(path.join(dir, MANIFEST)) ? readItem(kind, input.name) : null;

  const decoded: Array<{ filename: string; buf: Buffer }> = [];
  for (const f of input.files) {
    if (typeof f?.filename !== "string" || typeof f?.content !== "string") {
      throw new StoreError("Each file needs a filename and content.");
    }
    assertSafeFilename(f.filename);
    const buf = Buffer.from(f.content, f.encoding === "base64" ? "base64" : "utf8");
    if (buf.length > MAX_FILE_BYTES) {
      throw new StoreError(`"${f.filename}" is larger than the ${MAX_FILE_BYTES / 1024 / 1024} MB per-file limit.`);
    }
    decoded.push({ filename: f.filename, buf });
  }

  // Count what the item will weigh AFTER the update, including files being
  // kept, so repeated small publishes cannot creep past the cap.
  const replaced = new Set(decoded.map(d => d.filename));
  const keptBytes = (existing?.files ?? [])
    .filter(f => !replaced.has(f.filename))
    .reduce((n, f) => n + f.bytes, 0);
  const newBytes = decoded.reduce((n, d) => n + d.buf.length, 0);
  if (keptBytes + newBytes > MAX_ITEM_BYTES) {
    throw new StoreError(`That would put "${input.name}" over the ${MAX_ITEM_BYTES / 1024 / 1024} MB per-item limit.`);
  }

  mkdirSync(dir, { recursive: true });
  for (const d of decoded) writeFileSync(path.join(dir, d.filename), d.buf);

  const now = new Date().toISOString();
  const manifest = {
    kind,
    name: input.name,
    title: (input.title ?? existing?.title ?? input.name).slice(0, 200),
    description: (input.description ?? existing?.description ?? "").slice(0, 2000),
    author: (input.author ?? existing?.author ?? "anonymous").slice(0, 100),
    publishedAt: existing?.publishedAt ?? now,
    updatedAt: now,
  };
  writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  return readItem(kind, input.name)!;
}

/**
 * Publish, then actually share it.
 *
 * publishItem() alone only writes files into a working copy -- which is as
 * device-local as not publishing at all. This commits and pushes the item's
 * own folder so every other clone gets it on the next pull, and reports what
 * really happened rather than assuming it worked. The item is returned either
 * way: the files are on disk before the sync is attempted, so a machine with
 * no network still publishes locally and says so.
 */
export async function publishAndSync(input: {
  kind: string;
  name: string;
  title?: string;
  description?: string;
  author?: string;
  files: StoreFile[];
}): Promise<{ item: StoreItem; sync: StoreSyncResult }> {
  const item = publishItem(input);
  const sync = await syncStorePaths(
    [itemDir(item.kind, item.name)],
    `store: publish ${item.kind}/${item.name}`,
    { storeDir: storeRoot() },
  );
  return { item, sync };
}

/**
 * Delete, then propagate the deletion.
 *
 * Without this an unpublish is undone by the next `git pull`, which would
 * make removal look like it worked and then silently reverse it. Deletion is
 * already the privileged operation (see the route gate); this only makes it
 * mean what it says.
 */
export async function deleteAndSync(
  kind: string,
  name: string,
): Promise<{ deleted: boolean; sync?: StoreSyncResult }> {
  assertKind(kind);
  assertSafeName(name);
  const dir = itemDir(kind, name);
  const deleted = deleteItem(kind, name);
  if (!deleted) return { deleted: false };
  const sync = await syncStorePaths([dir], `store: remove ${kind}/${name}`, { storeDir: storeRoot() });
  return { deleted: true, sync };
}

/** Read one item, or null when it does not exist. */
export function readItem(kind: string, name: string): StoreItem | null {
  assertKind(kind);
  assertSafeName(name);
  const dir = itemDir(kind, name);
  const manifestFile = path.join(dir, MANIFEST);
  if (!existsSync(manifestFile)) return null;

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Record<string, unknown>;
  } catch {
    // A hand-edited or half-pulled manifest should not take down the whole
    // catalog listing, so treat it as absent rather than throwing.
    return null;
  }

  const files: StoreFileInfo[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === MANIFEST) continue;
    const full = path.join(dir, entry);
    if (!statSync(full).isFile()) continue;
    const buf = readFileSync(full);
    files.push({ filename: entry, bytes: buf.length, sha256: sha256(buf) });
  }
  files.sort((a, b) => a.filename.localeCompare(b.filename));

  return {
    kind,
    name,
    title: String(manifest.title ?? name),
    description: String(manifest.description ?? ""),
    author: String(manifest.author ?? "anonymous"),
    publishedAt: String(manifest.publishedAt ?? ""),
    updatedAt: String(manifest.updatedAt ?? ""),
    files,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
  };
}

/** Everything published, newest first within each section. */
export function listCatalog(): Record<StoreKind, StoreItem[]> {
  const out = {} as Record<StoreKind, StoreItem[]>;
  for (const kind of STORE_KINDS) {
    const dir = kindDir(kind);
    const items: StoreItem[] = [];
    if (existsSync(dir)) {
      for (const entry of readdirSync(dir)) {
        if (!statSync(path.join(dir, entry)).isDirectory()) continue;
        try {
          const item = readItem(kind, entry);
          if (item) items.push(item);
        } catch {
          // One malformed item must not hide the rest of the store.
        }
      }
    }
    items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    out[kind] = items;
  }
  return out;
}

/** Read one published file, for download or install. Null when absent. */
export function readItemFile(kind: string, name: string, filename: string): Buffer | null {
  assertKind(kind);
  assertSafeName(name);
  assertSafeFilename(filename);
  const full = path.join(itemDir(kind, name), filename);
  // Belt and braces: the name checks above should make this impossible, but a
  // containment check costs nothing and this path is attacker-influenced.
  const root = path.normalize(itemDir(kind, name));
  if (!path.normalize(full).startsWith(root)) return null;
  return existsSync(full) && statSync(full).isFile() ? readFileSync(full) : null;
}

/**
 * Remove an item. Privileged — the web layer must not expose this to anonymous
 * callers, for the same reason wiki deletion is gated: publishing is open so
 * that anyone can contribute, and destruction is not.
 */
export function deleteItem(kind: string, name: string): boolean {
  assertKind(kind);
  assertSafeName(name);
  const dir = itemDir(kind, name);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
