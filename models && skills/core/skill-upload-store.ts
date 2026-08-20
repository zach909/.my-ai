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
 * Every slot is optional independently -- a package can start with just a
 * source skill and gain the rest later via repeated uploads under the same
 * name (each upload only overwrites the slots it includes).
 *
 * Layout on disk: extension-builder/extensions/<name>/ containing a real
 * file per uploaded slot (original filename preserved) plus manifest.json
 * recording which slot each file belongs to and when it was uploaded.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

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

export interface SkillUploadSummary {
  name: string;
  slots: Partial<Record<SkillUploadSlot, SkillUploadManifestEntry>>;
}

function extensionsDir(): string {
  return path.resolve(process.cwd(), "extension-builder", "extensions");
}

function packageDir(name: string): string {
  return path.join(extensionsDir(), name);
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

function readManifest(name: string): Partial<Record<SkillUploadSlot, SkillUploadManifestEntry>> {
  const file = manifestPath(name);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function listSkillUploads(): SkillUploadSummary[] {
  const dir = extensionsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, slots: readManifest(entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readSkillUpload(name: string): SkillUploadSummary | null {
  assertSafeName(name);
  if (!existsSync(packageDir(name))) return null;
  return { name, slots: readManifest(name) };
}

export function readSkillUploadFile(name: string, slot: SkillUploadSlot): SkillUploadFile | null {
  assertSafeName(name);
  const manifest = readManifest(name);
  const entry = manifest[slot];
  if (!entry) return null;
  const file = path.join(packageDir(name), entry.filename);
  if (!existsSync(file)) return null;
  return { filename: entry.filename, content: readFileSync(file, "utf8") };
}

/**
 * Save one or more slots into a package, creating it if it doesn't exist
 * yet. Only the slots present in `files` are written/overwritten -- an
 * upload that only includes an updated algorithm, say, leaves the other
 * four slots (and their manifest entries) untouched.
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
    manifest[slot] = { filename: file.filename, uploadedAt: Date.now(), bytes: Buffer.byteLength(file.content, "utf8") };
  }
  writeFileSync(manifestPath(name), JSON.stringify(manifest, null, 2), "utf8");
  return { name, slots: manifest };
}

/** Removes the whole package -- all uploaded slots and the manifest together, not one slot at a time. */
export function deleteSkillUpload(name: string): void {
  assertSafeName(name);
  const dir = packageDir(name);
  if (!existsSync(dir)) {
    throw new SkillUploadError(`No skill package named "${name}".`);
  }
  rmSync(dir, { recursive: true, force: true });
}
