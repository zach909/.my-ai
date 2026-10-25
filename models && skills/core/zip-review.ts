/**
 * Final-product review for a zip the AI is about to hand out.
 *
 * "Make the AI have to verify it's the final product: read the zip, then either
 * say yes, or say no, it needs to be edited, edit it, and read it again."
 *
 * A zip does not go out because whoever made it says it is done. It goes out
 * because it was OPENED and READ BACK, and a judge said yes to what was
 * actually inside. The loop is:
 *
 *   read the file from disk -> look inside -> judge says yes or no
 *     yes -> done, the file goes out
 *     no  -> the judge's edits are applied, the zip is rewritten, and the next
 *            round reads it from disk again (never from the edit's own memory,
 *            so a bad rewrite is caught like any other flaw)
 *
 * The judge is injected. The host passes the AI's own judgment; with none, the
 * structural judge below applies, which only ever says no for things that are
 * plainly broken (damaged, empty, duplicate or unsafe names), never for taste.
 *
 * The loop is bounded, and it is honest about it: if the judge is still saying
 * no after `maxRounds`, or says no with nothing to change, the result is
 * `approved: false` with the last reasons -- the file is NOT reported as
 * verified, and the caller decides what to tell the user.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { ZipError, readZip, writeZip, type ZipEntry } from "./zip-archive.js";

/** One change to the zip's contents. */
export type ZipEdit =
  | { op: "set"; name: string; text?: string; base64?: string }
  | { op: "delete"; name: string }
  | { op: "rename"; from: string; to: string };

export interface ZipEntryView {
  name: string;
  bytes: number;
  /** The first part of the file when it is text; absent for binary files. */
  preview?: string;
  /** True when `preview` stops before the end of the file. */
  truncated?: boolean;
}

/** What the judge is shown: the zip as read back from disk this round. */
export interface ZipView {
  path: string;
  round: number;
  /** Set when the file could not be read as a zip at all; `entries` is then empty. */
  unreadable?: string;
  entries: ZipEntryView[];
  /** Plain problems found by looking at the structure. Empty is not the same as good -- it only means nothing is broken. */
  problems: string[];
}

export type ZipVerdict =
  | { verdict: "yes"; note?: string }
  | { verdict: "no"; reasons: string[]; edits: ZipEdit[] };

export type ZipJudge = (view: ZipView) => ZipVerdict | Promise<ZipVerdict>;

export interface ZipReviewRound {
  round: number;
  verdict: "yes" | "no";
  reasons: string[];
  editsApplied: number;
}

export interface ZipReviewResult {
  /** True only if a judge said yes to a zip read back from disk. */
  approved: boolean;
  /** How many times the zip was read. */
  rounds: number;
  /** Why it is not approved (or the judge's closing note when it is). */
  notes: string[];
  trace: ZipReviewRound[];
}

export interface ZipReviewOptions {
  /** Most times to read the zip. Default 5. */
  maxRounds?: number;
  /** Largest preview of one text file shown to the judge. Default 4000 characters. */
  previewChars?: number;
}

const DEFAULT_MAX_ROUNDS = 5;
const DEFAULT_PREVIEW_CHARS = 4000;

/** Text if the bytes are valid UTF-8 with no NULs; null for anything binary. */
function asText(data: Buffer): string | null {
  if (data.includes(0)) return null;
  const text = data.toString("utf8");
  return text.includes("�") ? null : text;
}

function unsafeName(name: string): boolean {
  return name.startsWith("/") || name.includes("\\") || /(^|\/)\.\.(\/|$)/.test(name) || /^[a-zA-Z]:/.test(name);
}

/** The safe form of a name that `unsafeName` rejected. */
function safeName(name: string): string {
  const parts = name.replace(/\\/g, "/").replace(/^[a-zA-Z]:/, "").split("/").filter(p => p !== "" && p !== "." && p !== "..");
  return parts.join("/");
}

/** Read a zip from disk into what a judge needs. Never throws: a file that cannot be read is reported in `unreadable`. */
export function inspectZip(zipPath: string, round = 1, previewChars = DEFAULT_PREVIEW_CHARS): ZipView {
  const view: ZipView = { path: zipPath, round, entries: [], problems: [] };
  let entries: ZipEntry[];
  try {
    entries = readZip(readFileSync(zipPath));
  } catch (err) {
    view.unreadable = err instanceof ZipError ? err.message : `The file could not be read: ${(err as Error).message}`;
    view.problems.push(view.unreadable);
    return view;
  }
  if (entries.length === 0) view.problems.push("The zip has no files in it.");
  const seen = new Set<string>();
  for (const e of entries) {
    const text = asText(e.data);
    view.entries.push({
      name: e.name,
      bytes: e.data.length,
      ...(text === null ? {} : { preview: text.slice(0, previewChars), truncated: text.length > previewChars }),
    });
    if (unsafeName(e.name)) view.problems.push(`"${e.name}" has a path that could write outside the folder it is unpacked into.`);
    if (seen.has(e.name)) view.problems.push(`"${e.name}" appears more than once.`);
    seen.add(e.name);
  }
  return view;
}

/**
 * The judge used when the host supplies none: yes unless the structure is
 * broken, and for the breakages that have one obvious fix, it says what to
 * change. A damaged or empty zip gets "no" with no edits, because there is
 * nothing here to repair it from.
 */
export const structuralJudge: ZipJudge = view => {
  if (view.problems.length === 0) return { verdict: "yes", note: `${view.entries.length} file(s) read back and nothing is broken.` };
  const edits: ZipEdit[] = [];
  if (!view.unreadable) {
    const names = view.entries.map(e => e.name);
    for (const name of names) {
      if (unsafeName(name)) {
        const fixed = safeName(name);
        if (fixed) edits.push({ op: "rename", from: name, to: fixed });
        else edits.push({ op: "delete", name });
      }
    }
  }
  return { verdict: "no", reasons: view.problems, edits };
};

/** Applies edits in order. Duplicate names collapse to the last one written. Throws ZipError for an edit that names a file that is not there. */
export function applyEdits(entries: ZipEntry[], edits: ZipEdit[]): ZipEntry[] {
  let out = entries.map(e => ({ name: e.name, data: e.data }));
  for (const edit of edits) {
    if (edit.op === "set") {
      if (!edit.name) throw new ZipError("An edit has no file name.");
      const data = edit.base64 !== undefined ? Buffer.from(edit.base64, "base64") : Buffer.from(edit.text ?? "", "utf8");
      const at = out.findIndex(e => e.name === edit.name);
      if (at >= 0) out[at] = { name: edit.name, data };
      else out.push({ name: edit.name, data });
    } else if (edit.op === "delete") {
      if (!out.some(e => e.name === edit.name)) throw new ZipError(`Cannot delete "${edit.name}": it is not in the zip.`);
      out = out.filter(e => e.name !== edit.name);
    } else {
      const at = out.findIndex(e => e.name === edit.from);
      if (at < 0) throw new ZipError(`Cannot rename "${edit.from}": it is not in the zip.`);
      if (!edit.to) throw new ZipError("An edit renames a file to nothing.");
      out[at] = { name: edit.to, data: out[at].data };
    }
  }
  const last = new Map<string, ZipEntry>();
  for (const e of out) last.set(e.name, e);
  return [...last.values()];
}

/**
 * Review a zip until a judge approves it or the rounds run out.
 *
 * Each round reads the file from disk fresh. An edit that cannot be applied
 * (it names a file that is not there, or the zip was unreadable to begin with)
 * is recorded as the reason and ends the review unapproved rather than being
 * skipped, because skipping it would make the next "yes" a statement about a
 * zip nobody changed.
 */
export async function reviewZip(zipPath: string, judge: ZipJudge = structuralJudge, options: ZipReviewOptions = {}): Promise<ZipReviewResult> {
  const maxRounds = Math.max(1, options.maxRounds ?? DEFAULT_MAX_ROUNDS);
  const previewChars = options.previewChars ?? DEFAULT_PREVIEW_CHARS;
  const trace: ZipReviewRound[] = [];

  if (!existsSync(zipPath)) {
    return { approved: false, rounds: 0, notes: ["The file is not there to review."], trace };
  }

  for (let round = 1; round <= maxRounds; round++) {
    const view = inspectZip(zipPath, round, previewChars);
    let verdict: ZipVerdict;
    try {
      verdict = await judge(view);
    } catch (err) {
      // A judge that fails has not said yes. Stopping here, unapproved, is the
      // only answer that does not claim a review that did not happen.
      const reason = `The reviewer failed: ${(err as Error).message}`;
      trace.push({ round, verdict: "no", reasons: [reason], editsApplied: 0 });
      return { approved: false, rounds: round, notes: [reason], trace };
    }

    if (verdict.verdict === "yes") {
      trace.push({ round, verdict: "yes", reasons: verdict.note ? [verdict.note] : [], editsApplied: 0 });
      return { approved: true, rounds: round, notes: verdict.note ? [verdict.note] : [], trace };
    }

    if (verdict.edits.length === 0) {
      trace.push({ round, verdict: "no", reasons: verdict.reasons, editsApplied: 0 });
      return { approved: false, rounds: round, notes: [...verdict.reasons, "Nothing was changed, so reading it again would only repeat this."], trace };
    }

    try {
      const rewritten = writeZip(applyEdits(readZip(readFileSync(zipPath)), verdict.edits));
      // Written beside the zip and renamed over it, so a failed write cannot leave half a zip where the finished one was.
      const tmp = `${zipPath}.reviewing`;
      writeFileSync(tmp, rewritten);
      renameSync(tmp, zipPath);
    } catch (err) {
      const reason = `The edits could not be applied: ${(err as Error).message}`;
      trace.push({ round, verdict: "no", reasons: [...verdict.reasons, reason], editsApplied: 0 });
      return { approved: false, rounds: round, notes: [...verdict.reasons, reason], trace };
    }
    trace.push({ round, verdict: "no", reasons: verdict.reasons, editsApplied: verdict.edits.length });
  }

  const last = trace[trace.length - 1];
  return {
    approved: false,
    rounds: maxRounds,
    notes: [...(last?.reasons ?? []), `Still not approved after ${maxRounds} reads.`],
    trace,
  };
}
