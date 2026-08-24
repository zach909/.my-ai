/**
 * Skill Upload Store — lets a skill's five real artifacts be uploaded and
 * stored together as one package, instead of only being producible by
 * running the full Extension Builder pipeline:
 *
 *   - plugin        the plugin/extension source that wires the skill into
 *                    the running app (see plugins/*.ts, plugin_manager/)
 *   - source skill   the exact, editable, un-quantized definition -- what
 *                    `saveWithoutQuantization` produces (see wiki/Quantization.md)
 *   - binary skill   the quantized, deployment-ready form -- what
 *                    `installWithQuantization` produces
 *   - algorithm      the training/improvement recipe that produced the
 *                    binary skill from the source one (which variations
 *                    were kept vs. discarded, hyperparameters, ...) -- see
 *                    docs/SKILL_ACQUISITION_LOOP.md's "record the
 *                    improvement algorithm" step
 *   - rsi test       a test that exercises the skill in the context of
 *                    recursive self-improvement (docs/
 *                    SELF_IMPROVEMENT_IMPLEMENTATION_PLAN.md) -- does
 *                    applying/training this skill actually leave the
 *                    system better, not just different
 *
 * Plus one open-ended slot: extra files -- anything that doesn't fit the
 * five above (reference data, a README, a sample input, ...). Unlike the
 * five named slots (each holds exactly one file, replaced wholesale on
 * re-upload), extra files accumulate: uploading a new one adds it, and
 * re-uploading the same filename replaces just that one file.
 *
 * Every named slot is optional independently -- a package can start with
 * just a source skill and gain the rest later via repeated uploads under
 * the same name (each upload only overwrites the slots it includes).
 *
 * Layout on disk: extension-builder/extensions/<name>/ containing a real
 * file per uploaded slot (original filename preserved), an extra-files/
 * subdirectory for the open-ended slot, and manifest.json recording which
 * slot each file belongs to and when it was uploaded.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { syncStorePaths, type StoreSyncResult } from "./store-sync.js";

const SAFE_NAME = /^[A-Za-z0-9_-]+$/;
// Same intent as wiki-store.ts's SAFE_NAME for page names -- but an
// uploaded file's own name is shown to a human (in the package listing)
// and only ever used as a path segment, never interpolated into a shell
// command or URL, so '.' is allowed (extensions matter here) while '/' and
// '..' are still rejected outright.
const SAFE_FILENAME = /^[A-Za-z0-9_.-]+$/;

export const SKILL_UPLOAD_SLOTS = ["plugin", "sourceSkill", "binarySkill", "algorithm", "rsiTest"] as const;
export type SkillUploadSlot = (typeof SKILL_UPLOAD_SLOTS)[number];

export class SkillUploadError extends Error {}

export interface SkillUploadFile {
  filename: string;
  content: string;
}

export interface SkillUploadManifestEntry {
  filename: string;
  uploadedAt: number;
  bytes: number;
}

export interface SkillUploadManifest {
  slots: Partial<Record<SkillUploadSlot, SkillUploadManifestEntry>>;
  extraFiles: SkillUploadManifestEntry[];
  /**
   * Name of a bot-published wiki page (see wiki-store.ts) documenting this
   * skill -- e.g. what it does, how it was trained, known limitations.
   * Stored as just the name, not a copy of the content: the page keeps
   * living in wiki/bot/, stays editable there (including by the AI), and a
   * skill package can be repointed at a different page (or unlinked)
   * without touching the wiki at all. Optional, and only ever a *bot*
   * page -- linking a curated wiki/ page here would let a skill upload
   * imply an editorial page is "about" it, which isn't this feature's
   * call to make.
   */
  wikiPage?: string;
  /**
   * Set once the package's rsiTest file has actually been run and passed
   * (see interface/web-server.ts's POST .../run-rsi-test) -- "recursive
   * self-improvement" per docs/SELF_IMPROVEMENT_IMPLEMENTATION_PLAN.md,
   * i.e. the test's own judgment that applying this skill genuinely left
   * the system better, not just different. A passing run also installs
   * the package's skill files (same path as install-skill), so this flag
   * is what the UI shows as "Published" rather than a separate publish
   * step -- there's no meaningfully different action to take after a
   * passing RSI test.
   */
  rsiPassed?: { at: number; message?: string };
}

export interface SkillUploadSummary extends SkillUploadManifest {
  name: string;
}

function extensionsDir(): string {
  return path.resolve(process.cwd(), "extension-builder", "extensions");
}

function packageDir(name: string): string {
  return path.join(extensionsDir(), name);
}

function extraFilesDir(name: string): string {
  return path.join(packageDir(name), "extra-files");
}

function manifestPath(name: string): string {
  return path.join(packageDir(name), "manifest.json");
}

function assertSafeName(name: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new SkillUploadError(`"${name}" is not a valid skill package name -- letters, digits, '-', and '_' only.`);
  }
}

function assertSafeFilename(filename: string): void {
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\") || !SAFE_FILENAME.test(filename)) {
    throw new SkillUploadError(`"${filename}" is not a valid filename.`);
  }
}

function readManifest(name: string): SkillUploadManifest {
  const file = manifestPath(name);
  if (!existsSync(file)) return { slots: {}, extraFiles: [] };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    // Tolerates the original flat { [slot]: entry } shape (before extra
    // files existed) alongside the current { slots, extraFiles } one, so an
    // old manifest on disk doesn't need a migration step.
    if (raw && typeof raw === "object" && ("slots" in raw || "extraFiles" in raw || "wikiPage" in raw)) {
      const manifest: SkillUploadManifest = {
        slots: raw.slots ?? {},
        extraFiles: Array.isArray(raw.extraFiles) ? raw.extraFiles : [],
      };
      if (typeof raw.wikiPage === "string") manifest.wikiPage = raw.wikiPage;
      if (raw.rsiPassed && typeof raw.rsiPassed === "object" && typeof raw.rsiPassed.at === "number") {
        manifest.rsiPassed = { at: raw.rsiPassed.at, message: typeof raw.rsiPassed.message === "string" ? raw.rsiPassed.message : undefined };
      }
      return manifest;
    }
    return { slots: raw ?? {}, extraFiles: [] };
  } catch {
    return { slots: {}, extraFiles: [] };
  }
}

function writeManifest(name: string, manifest: SkillUploadManifest): void {
  writeFileSync(manifestPath(name), JSON.stringify(manifest, null, 2), "utf8");
}

export function listSkillUploads(): SkillUploadSummary[] {
  const dir = extensionsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, ...readManifest(entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readSkillUpload(name: string): SkillUploadSummary | null {
  assertSafeName(name);
  if (!existsSync(packageDir(name))) return null;
  return { name, ...readManifest(name) };
}

export function readSkillUploadFile(name: string, slot: SkillUploadSlot): SkillUploadFile | null {
  assertSafeName(name);
  const entry = readManifest(name).slots[slot];
  if (!entry) return null;
  const file = path.join(packageDir(name), entry.filename);
  if (!existsSync(file)) return null;
  return { filename: entry.filename, content: readFileSync(file, "utf8") };
}

export function readSkillUploadExtraFile(name: string, filename: string): SkillUploadFile | null {
  assertSafeName(name);
  const manifest = readManifest(name);
  if (!manifest.extraFiles.some((f) => f.filename === filename)) return null;
  const file = path.join(extraFilesDir(name), filename);
  if (!existsSync(file)) return null;
  return { filename, content: readFileSync(file, "utf8") };
}

/**
 * Save one or more of the five named slots into a package, creating it if
 * it doesn't exist yet. Only the slots present in `files` are
 * written/overwritten -- an upload that only includes an updated
 * algorithm, say, leaves the other four slots (and their manifest
 * entries) untouched. Existing extra files are always left alone by this
 * function; use saveSkillUploadExtraFiles() for those.
 */
export function saveSkillUpload(name: string, files: Partial<Record<SkillUploadSlot, SkillUploadFile>>): SkillUploadSummary {
  assertSafeName(name);
  const entries = Object.entries(files).filter(([, f]) => f !== undefined) as [SkillUploadSlot, SkillUploadFile][];
  if (entries.length === 0) {
    throw new SkillUploadError("Provide at least one file to upload.");
  }
  const dir = packageDir(name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const manifest = readManifest(name);
  for (const [slot, file] of entries) {
    assertSafeFilename(file.filename);
    if (!file.content) {
      throw new SkillUploadError(`"${file.filename}" (${slot}) is empty.`);
    }
    writeFileSync(path.join(dir, file.filename), file.content, "utf8");
    manifest.slots[slot] = { filename: file.filename, uploadedAt: Date.now(), bytes: Buffer.byteLength(file.content, "utf8") };
  }
  writeManifest(name, manifest);
  return { name, ...manifest };
}

/**
 * Add (or, for a filename already present, replace) one or more open-ended
 * "extra files" -- the slot for anything that doesn't fit the five named
 * ones. Unlike saveSkillUpload()'s named slots, these accumulate rather
 * than each holding a single file.
 */
export function saveSkillUploadExtraFiles(name: string, files: SkillUploadFile[]): SkillUploadSummary {
  assertSafeName(name);
  if (files.length === 0) {
    throw new SkillUploadError("Provide at least one file to upload.");
  }
  const dir = extraFilesDir(name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const manifest = readManifest(name);
  for (const file of files) {
    assertSafeFilename(file.filename);
    if (!file.content) {
      throw new SkillUploadError(`"${file.filename}" is empty.`);
    }
    writeFileSync(path.join(dir, file.filename), file.content, "utf8");
    const entry: SkillUploadManifestEntry = { filename: file.filename, uploadedAt: Date.now(), bytes: Buffer.byteLength(file.content, "utf8") };
    const existingIndex = manifest.extraFiles.findIndex((f) => f.filename === file.filename);
    if (existingIndex >= 0) manifest.extraFiles[existingIndex] = entry;
    else manifest.extraFiles.push(entry);
  }
  writeManifest(name, manifest);
  return { name, ...manifest };
}

/**
 * Point a package at a bot wiki page as its documentation, replacing
 * whatever it was linked to before. Creates the package (with no slots or
 * extra files yet) if `name` doesn't already exist -- same as
 * saveSkillUpload(), a package can start from just a wiki link and gain
 * real artifacts later. Whether `wikiPageName` actually names an existing
 * *bot* wiki page is the caller's job (web-server.ts checks via
 * wiki-store.ts before calling this) -- this store only persists the
 * name, the same separation saveSkillUpload() keeps from the plugin
 * registry it feeds.
 */
export function linkSkillUploadWiki(name: string, wikiPageName: string): SkillUploadSummary {
  assertSafeName(name);
  const dir = packageDir(name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const manifest = readManifest(name);
  manifest.wikiPage = wikiPageName;
  writeManifest(name, manifest);
  return { name, ...manifest };
}

/** Unlinks the package's wiki page, if any. Leaves the wiki page itself untouched -- this only ever removes the pointer. */
export function unlinkSkillUploadWiki(name: string): SkillUploadSummary {
  assertSafeName(name);
  if (!existsSync(packageDir(name))) {
    throw new SkillUploadError(`No skill package named "${name}".`);
  }
  const manifest = readManifest(name);
  delete manifest.wikiPage;
  writeManifest(name, manifest);
  return { name, ...manifest };
}

/** Records that the package's RSI test has passed -- see SkillUploadManifest's `rsiPassed` doc comment. */
export function recordSkillUploadRsiPass(name: string, message?: string): SkillUploadSummary {
  assertSafeName(name);
  if (!existsSync(packageDir(name))) {
    throw new SkillUploadError(`No skill package named "${name}".`);
  }
  const manifest = readManifest(name);
  manifest.rsiPassed = { at: Date.now(), message };
  writeManifest(name, manifest);
  return { name, ...manifest };
}

/** Removes one extra file by name, leaving the rest of the package (including other extra files) untouched. */
export function deleteSkillUploadExtraFile(name: string, filename: string): void {
  assertSafeName(name);
  const manifest = readManifest(name);
  const index = manifest.extraFiles.findIndex((f) => f.filename === filename);
  if (index === -1) {
    throw new SkillUploadError(`No extra file named "${filename}" in "${name}".`);
  }
  const file = path.join(extraFilesDir(name), filename);
  if (existsSync(file)) rmSync(file, { force: true });
  manifest.extraFiles.splice(index, 1);
  writeManifest(name, manifest);
}

/** Removes the whole package -- all uploaded slots, extra files, and the manifest together, not one file at a time. */
export function deleteSkillUpload(name: string): void {
  assertSafeName(name);
  const dir = packageDir(name);
  if (!existsSync(dir)) {
    throw new SkillUploadError(`No skill package named "${name}".`);
  }
  rmSync(dir, { recursive: true, force: true });
}


/**
 * Save a package's files and actually share it.
 *
 * saveSkillUpload() writes into the package's folder and stops, which leaves
 * an uploaded plugin/source/binary skill device-local -- the exact thing the
 * store exists to avoid. This commits and pushes the package folder so every
 * other clone gets it on the next pull, and reports honestly when it could
 * not (see store-sync.ts).
 */
export async function saveSkillUploadAndSync(
  name: string,
  files: Partial<Record<SkillUploadSlot, SkillUploadFile>>,
): Promise<{ pkg: SkillUploadSummary; sync: StoreSyncResult }> {
  const pkg = saveSkillUpload(name, files);
  const sync = await syncStorePaths([packageDir(name)], `uploads: publish ${name}`, {
    storeDir: extensionsDir(),
  });
  return { pkg, sync };
}

/** Same, for a package's extra files. */
export async function saveSkillUploadExtraFilesAndSync(
  name: string,
  files: SkillUploadFile[],
): Promise<{ pkg: SkillUploadSummary; sync: StoreSyncResult }> {
  const pkg = saveSkillUploadExtraFiles(name, files);
  const sync = await syncStorePaths([packageDir(name)], `uploads: add files to ${name}`, {
    storeDir: extensionsDir(),
  });
  return { pkg, sync };
}

/** Delete a package and propagate the removal, so a pull cannot resurrect it. */
export async function deleteSkillUploadAndSync(name: string): Promise<StoreSyncResult> {
  const dir = packageDir(name);
  deleteSkillUpload(name);
  return syncStorePaths([dir], `uploads: remove ${name}`, { storeDir: extensionsDir() });
}


/**
 * The remaining package mutations, each followed by the same push.
 *
 * These change manifest.json rather than the uploaded files, and it would be
 * easy to think that makes them local bookkeeping. It does not: "this package
 * passed its RSI test" and "this package is documented by that wiki page" are
 * exactly the facts someone else needs in order to judge whether to install
 * it. Left unsynced, a package would arrive on everyone else's machine
 * looking untested and undocumented no matter what its author recorded.
 */
export async function linkSkillUploadWikiAndSync(
  name: string,
  wikiPageName: string,
): Promise<{ pkg: SkillUploadSummary; sync: StoreSyncResult }> {
  const pkg = linkSkillUploadWiki(name, wikiPageName);
  const sync = await syncStorePaths([packageDir(name)], `uploads: link ${name} to wiki/${wikiPageName}`, {
    storeDir: extensionsDir(),
  });
  return { pkg, sync };
}

export async function unlinkSkillUploadWikiAndSync(
  name: string,
): Promise<{ pkg: SkillUploadSummary; sync: StoreSyncResult }> {
  const pkg = unlinkSkillUploadWiki(name);
  const sync = await syncStorePaths([packageDir(name)], `uploads: unlink ${name} from its wiki page`, {
    storeDir: extensionsDir(),
  });
  return { pkg, sync };
}

/** A pass is the signal others use to decide whether to trust the package, so it has to travel. */
export async function recordSkillUploadRsiPassAndSync(
  name: string,
  message?: string,
): Promise<{ pkg: SkillUploadSummary; sync: StoreSyncResult }> {
  const pkg = recordSkillUploadRsiPass(name, message);
  const sync = await syncStorePaths([packageDir(name)], `uploads: ${name} passed its RSI test`, {
    storeDir: extensionsDir(),
  });
  return { pkg, sync };
}

export async function deleteSkillUploadExtraFileAndSync(name: string, filename: string): Promise<StoreSyncResult> {
  deleteSkillUploadExtraFile(name, filename);
  return syncStorePaths([packageDir(name)], `uploads: remove ${filename} from ${name}`, {
    storeDir: extensionsDir(),
  });
}
