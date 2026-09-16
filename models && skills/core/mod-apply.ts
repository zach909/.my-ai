/**
 * Applying a mod: writing a published item's files directly onto THIS
 * device's own working copy of the repository, at the same relative path
 * they were published under.
 *
 * Every other store kind installs into an isolated folder under
 * extension-builder/installed/<kind>/<name>/ (see store-install.ts) -- a copy
 * that cannot touch anything else on the machine until something else
 * deliberately reads it back. A mod is the one kind that does not work that
 * way, because modding IS overwriting a real file: a mod published as
 * `src/routes/app/store.tsx` is meant to become that file, not a harmless
 * copy sitting next to it.
 *
 * That makes applying a mod the most powerful thing this store can do to a
 * device, so it earns extra care in three places:
 *
 *  - What a mod may target. Store filenames already go through
 *    assertSafeFilename (store.ts), which was written for a different
 *    reason -- keeping a publish inside its own item folder -- but happens to
 *    give exactly the property a mod needs too: no absolute paths, no `..`,
 *    and no segment starting with `.`. That last rule is the one doing the
 *    real work here: it means a mod can never be published targeting
 *    `.git/`, `.github/`, `.claude/`, `.env`, or any other dotfile, because
 *    the filename would have been refused at publish time, long before
 *    anyone applies it. This module adds one more check on top for its own
 *    peace of mind (containment within the target root), but the dotfile
 *    protection is inherited, not reimplemented.
 *
 *  - Reversibility. Applying a mod backs up whatever was at each target path
 *    before touching it -- the real bytes if a file was there, or the fact
 *    that nothing was, so a file the mod created can be removed rather than
 *    left behind. revertMod() undoes exactly that, file by file, and leaves
 *    alone anything that has changed since (see its own comment).
 *
 *  - Never automatic. Nothing here runs from a publish, a browse, or a
 *    catalogue refresh. Applying is its own deliberate call, same as every
 *    other install in this store -- publishing is shared, using it is not.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { assertSafeName, readItem, readItemFile, type StoreItem } from "./store.js";
import { fetchItemFile } from "./store-fetch.js";
import { writeFileAtomic, writeJsonAtomic } from "./atomic-write.js";

export class ModApplyError extends Error {}

const MOD_KIND = "mods";

/**
 * The working copy a mod writes into. Defaults to the process's own working
 * directory, the same convention storeRoot() uses -- overridable so a test
 * never touches this repository's real files.
 */
export function modsTargetRoot(): string {
  return process.env.CORONA_MODS_TARGET_DIR
    ? path.resolve(process.env.CORONA_MODS_TARGET_DIR)
    : process.cwd();
}

/**
 * Where pre-mod originals are kept. Device-local, like everything else
 * installed -- see installedRoot() in store-install.ts, which this
 * deliberately does not share: a mod's backups are not an "installed item"
 * in that sense, and mixing the two namespaces would let a same-named
 * install of another kind collide with a mod's backup.
 */
function backupRoot(): string {
  return process.env.CORONA_MODS_BACKUP_DIR
    ? path.resolve(process.env.CORONA_MODS_BACKUP_DIR)
    : path.resolve(process.cwd(), "extension-builder", "installed", "mods-backup");
}

function backupDir(name: string): string {
  assertSafeName(name);
  const root = path.resolve(backupRoot());
  const dir = path.resolve(root, name);
  // Strictly below the root: the same lesson store-install.ts's
  // itemInstallDir() learned the hard way, applied here before it needs its
  // own incident to justify it.
  if (dir === root || !dir.startsWith(root + path.sep)) {
    throw new ModApplyError(`"${name}" is not a valid mod name.`);
  }
  return dir;
}

const RECORD = "applied.json";

/** One file's before/after, so a revert knows exactly what to put back. */
export interface AppliedFileRecord {
  filename: string;
  /** Null when the file did not exist before this mod first touched it -- applying created it, so reverting removes it. */
  originalSha256: string | null;
  modSha256: string;
}

export interface AppliedRecord {
  name: string;
  title: string;
  author: string;
  /** The item's updatedAt at the moment it was (most recently) applied -- what an update check compares against. */
  appliedVersion: string;
  appliedAt: number;
  files: AppliedFileRecord[];
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function readFileIfPresent(file: string): Buffer | null {
  return existsSync(file) && statSync(file).isFile() ? readFileSync(file) : null;
}

/** Resolves a mod file's target path, refusing anything that would land outside the working copy. */
function resolveTarget(filename: string): string {
  const root = path.resolve(modsTargetRoot());
  const target = path.resolve(root, filename);
  if (!target.startsWith(root + path.sep)) {
    throw new ModApplyError(`"${filename}" would write outside the working copy.`);
  }
  return target;
}

export interface ApplyResult {
  record: AppliedRecord;
  /** Files that existed before and now hold the mod's content. */
  changed: string[];
  /** Files that did not exist before and now do. */
  created: string[];
  /** Files whose on-disk bytes already matched the mod -- nothing written. */
  unchanged: string[];
  /** Files that had to be downloaded rather than already being on this device. */
  downloaded: string[];
  /** Files that could not be obtained at all. Applying continues without them. */
  missing: Array<{ filename: string; reason: string }>;
}

/**
 * Apply a published mod to this device's working copy.
 *
 * Safe to call again on a mod that is already applied -- e.g. after the mod
 * was republished with changes. A re-apply overwrites the target files with
 * the current published content, but the ORIGINAL backup (what was on disk
 * before the mod ever touched this device) is captured once and kept: a
 * second apply must never mistake "what the mod itself last wrote" for "what
 * was really there before", or reverting after two applies would only ever
 * undo the second one.
 */
export async function applyMod(name: string): Promise<ApplyResult> {
  const item = readItem(MOD_KIND, name);
  if (!item) throw new ModApplyError(`There is no published mod "${name}" to apply.`);
  if (item.files.length === 0) throw new ModApplyError(`"${name}" has no files to apply.`);

  const dir = backupDir(name);
  const priorByFile = new Map((readApplied(name)?.files ?? []).map(f => [f.filename, f]));

  const downloaded: string[] = [];
  const missing: Array<{ filename: string; reason: string }> = [];
  const backups: AppliedFileRecord[] = [];
  const changed: string[] = [];
  const created: string[] = [];
  const unchanged: string[] = [];

  for (const entry of item.files) {
    const target = resolveTarget(entry.filename);

    let buf = readItemFile(MOD_KIND, item.name, entry.filename);
    if (!buf) {
      try {
        buf = (await fetchItemFile(MOD_KIND, item.name, entry.filename)).buf;
        downloaded.push(entry.filename);
      } catch (err) {
        missing.push({ filename: entry.filename, reason: err instanceof Error ? err.message : String(err) });
        continue;
      }
    }
    const modSha256 = sha256(buf);

    const prior = priorByFile.get(entry.filename);
    const backupTarget = path.join(dir, "originals", entry.filename);
    let originalSha256: string | null;
    if (prior) {
      // Already applied once before -- keep the ORIGINAL backup as is. What
      // is on disk right now is (at best) this mod's own earlier content,
      // never the true pre-mod state, so recapturing it here would silently
      // replace the one copy of what a revert is supposed to restore.
      originalSha256 = prior.originalSha256;
    } else {
      const existing = readFileIfPresent(target);
      originalSha256 = existing ? sha256(existing) : null;
      if (existing) {
        mkdirSync(path.dirname(backupTarget), { recursive: true });
        writeFileAtomic(backupTarget, existing);
      } else {
        // Nothing to back up. Clear any stale backup left by an unrelated
        // earlier item of the same name, so a later revert cannot restore
        // bytes that were never this file's real original.
        try {
          rmSync(backupTarget, { force: true });
        } catch {
          /* never existed */
        }
      }
    }
    backups.push({ filename: entry.filename, originalSha256, modSha256 });

    const current = readFileIfPresent(target);
    const currentSha256 = current ? sha256(current) : null;
    if (currentSha256 === modSha256) {
      unchanged.push(entry.filename);
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileAtomic(target, buf);
    if (current) changed.push(entry.filename);
    else created.push(entry.filename);
  }

  if (changed.length === 0 && created.length === 0 && unchanged.length === 0) {
    throw new ModApplyError(
      `Could not apply "${name}": none of its files could be obtained. ${missing[0]?.reason ?? ""}`.trim(),
    );
  }

  const record: AppliedRecord = {
    name: item.name,
    title: item.title,
    author: item.author,
    appliedVersion: item.updatedAt,
    appliedAt: Date.now(),
    files: backups,
  };
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(path.join(dir, RECORD), record);

  return { record, changed, created, unchanged, downloaded, missing };
}

export function readApplied(name: string): AppliedRecord | null {
  const file = path.join(backupDir(name), RECORD);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as AppliedRecord;
  } catch {
    // A record we cannot parse means we cannot honestly claim it is applied.
    return null;
  }
}

export function isApplied(name: string): boolean {
  return readApplied(name) !== null;
}

/** Every mod applied on this device, most recently applied first. */
export function listAppliedMods(): AppliedRecord[] {
  const root = backupRoot();
  if (!existsSync(root)) return [];
  const out: AppliedRecord[] = [];
  for (const name of readdirSync(root)) {
    if (!statSync(path.join(root, name)).isDirectory()) continue;
    const record = readApplied(name);
    if (record) out.push(record);
  }
  return out.sort((a, b) => b.appliedAt - a.appliedAt);
}

/** Which of an applied mod's files the published item has since moved on from. Mirrors store-install.ts's changedFiles(). */
export function appliedChangedFiles(record: AppliedRecord, published: StoreItem): string[] {
  const applied = new Map(record.files.map(f => [f.filename, f.modSha256]));
  const changed: string[] = [];
  for (const f of published.files) {
    if (applied.get(f.filename) !== f.sha256) changed.push(f.filename);
  }
  return changed.sort();
}

export function outdatedAppliedMods(): Array<{ record: AppliedRecord; published: StoreItem; changed: string[] }> {
  const out: Array<{ record: AppliedRecord; published: StoreItem; changed: string[] }> = [];
  for (const record of listAppliedMods()) {
    const published = readItem(MOD_KIND, record.name);
    if (!published) continue;
    const changed = appliedChangedFiles(record, published);
    if (changed.length > 0) out.push({ record, published, changed });
  }
  return out;
}

export interface RevertResult {
  /** Put back to their pre-mod content. */
  restored: string[];
  /** Removed because they did not exist before the mod created them. */
  removed: string[];
  /** Left alone: current bytes match neither the mod nor the backed-up original, so something else changed this file since. */
  skipped: Array<{ filename: string; reason: string }>;
}

/**
 * Undo a previously applied mod, file by file: restore whatever was on disk
 * before, or delete a file the mod created where nothing existed.
 *
 * A file whose current content matches neither the mod's own bytes nor the
 * backed-up original is left alone and reported rather than overwritten --
 * something else touched it since the mod was applied (a manual edit, a git
 * pull, another mod), and guessing which version to keep would make the
 * revert do exactly the silent overwrite it exists to prevent.
 */
export function revertMod(name: string): RevertResult {
  const record = readApplied(name);
  if (!record) throw new ModApplyError(`"${name}" is not currently applied.`);

  const dir = backupDir(name);
  const restored: string[] = [];
  const removed: string[] = [];
  const skipped: Array<{ filename: string; reason: string }> = [];

  for (const entry of record.files) {
    const target = resolveTarget(entry.filename);
    const current = readFileIfPresent(target);
    const currentSha256 = current ? sha256(current) : null;

    if (currentSha256 !== entry.modSha256 && currentSha256 !== entry.originalSha256) {
      skipped.push({ filename: entry.filename, reason: "changed since the mod was applied -- left as is." });
      continue;
    }

    if (entry.originalSha256 === null) {
      if (current) rmSync(target, { force: true });
      removed.push(entry.filename);
      continue;
    }

    const backupFile = path.join(dir, "originals", entry.filename);
    const original = readFileIfPresent(backupFile);
    if (!original) {
      skipped.push({ filename: entry.filename, reason: "its backup is missing -- left as is." });
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileAtomic(target, original);
    restored.push(entry.filename);
  }

  // Only clear the record once every file has been dealt with above -- a
  // skipped file's backup staying on disk is what lets a later, manual
  // retry still find it instead of having already thrown it away.
  if (skipped.length === 0) {
    rmSync(dir, { recursive: true, force: true });
  } else {
    const remaining: AppliedRecord = { ...record, files: record.files.filter(f => skipped.some(s => s.filename === f.filename)) };
    writeJsonAtomic(path.join(dir, RECORD), remaining);
  }

  return { restored, removed, skipped };
}
