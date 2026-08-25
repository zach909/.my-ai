/**
 * Keeping both halves current: the code that runs everything, and the store
 * items this device has actually downloaded.
 *
 * They update from the same place -- the repository -- but they are genuinely
 * different things and are reported separately, because someone may well want
 * a new skill file without pulling a month of application changes, or the
 * reverse.
 *
 * Two rules shape this.
 *
 * Checking is safe and applying is not, so they are separate calls. Checking
 * fetches and compares; it changes nothing. Applying rewrites the working tree
 * and re-downloads files. A single "update" button that did both the moment
 * the page loaded would be the wrong shape for something that can move code
 * out from under a running process.
 *
 * Only files this device already has are refreshed. The store's whole promise
 * is that you hold what you chose to hold; an update that helpfully pulled
 * down every item that changed would quietly undo that.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { listCatalog, storeRoot, STORE_KINDS, type StoreFileInfo } from "./store.js";

const GIT_TIMEOUT_MS = 60_000;

export class AutoUpdateError extends Error {}

function git(args: string[], cwd: string): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise(resolve => {
    execFile(
      "git",
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (error, stdout, stderr) => {
        resolve({ ok: !error, out: String(stdout ?? "").trim(), err: String(stderr ?? "").trim() });
      },
    );
  });
}

function repoDir(): string {
  const root = storeRoot();
  return existsSync(root) ? root : path.dirname(root);
}

export interface CodeUpdate {
  /** How many commits this clone is behind its branch on the remote. */
  behind: number;
  /** How many it is ahead -- local work that a pull has to rebase over. */
  ahead: number;
  branch: string;
  /** One line per incoming commit, newest first, capped. */
  commits: string[];
  /** Set when the check could not run; the numbers are then meaningless. */
  problem?: string;
}

export interface StoreUpdate {
  kind: string;
  name: string;
  filename: string;
  /** What the index says it should be now. */
  sha256: string;
}

export interface UpdateReport {
  code: CodeUpdate;
  /** Only files this device already downloaded, whose contents no longer match the index. */
  store: StoreUpdate[];
  checkedAt: string;
}

const MAX_COMMITS_LISTED = 20;

/**
 * Looks for updates without changing anything.
 *
 * The store half deliberately compares the file on disk against the checksum
 * in the index rather than asking the network per file: the index arrives with
 * the same fetch that tells us about code changes, so one round trip covers
 * both and a device with fifty downloaded files does not make fifty requests
 * to find out nothing changed.
 */
export async function checkForUpdates(): Promise<UpdateReport> {
  const cwd = repoDir();
  const checkedAt = new Date().toISOString();

  const code: CodeUpdate = { behind: 0, ahead: 0, branch: "", commits: [] };

  const branch = await git(["symbolic-ref", "--short", "HEAD"], cwd);
  if (!branch.ok || !branch.out) {
    code.problem = "This clone is not on a named branch, so there is nothing to compare against.";
    return { code, store: [], checkedAt };
  }
  code.branch = branch.out;

  let fetched = await git(["fetch", "origin", code.branch], cwd);
  if (!fetched.ok) {
    // The branch may have been merged and deleted upstream, which is the
    // normal end of a working branch -- and precisely when someone wants to
    // know that the default branch has moved on. Fall back to it rather than
    // reporting a dead end.
    const head = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd);
    const fallback = head.ok ? head.out.replace(/^origin\//, "") : "main";
    if (fallback && fallback !== code.branch) {
      const retry = await git(["fetch", "origin", fallback], cwd);
      if (retry.ok) {
        code.branch = fallback;
        code.problem = `Your branch is gone from the remote; comparing against "${fallback}" instead.`;
        fetched = retry;
      }
    }
  }
  if (!fetched.ok) {
    // Reported rather than treated as "up to date": an unreachable remote and
    // a clone with nothing new look identical from the numbers alone, and
    // telling someone they are current when the check failed is worse than
    // telling them the check failed.
    code.problem = `Could not reach the remote: ${fetched.err.split("\n")[0] || "unknown error"}`;
    return { code, store: await staleDownloads(), checkedAt };
  }

  const counts = await git(["rev-list", "--left-right", "--count", `HEAD...origin/${code.branch}`], cwd);
  if (counts.ok) {
    const [ahead, behind] = counts.out.split(/\s+/).map(n => Number(n) || 0);
    code.ahead = ahead;
    code.behind = behind;
  }

  if (code.behind > 0) {
    const log = await git(
      ["log", "--oneline", `--max-count=${MAX_COMMITS_LISTED}`, `HEAD..origin/${code.branch}`],
      cwd,
    );
    if (log.ok && log.out) code.commits = log.out.split("\n");
  }

  return { code, store: await staleDownloads(), checkedAt };
}

/**
 * Downloaded files whose bytes no longer match what the index says they should
 * be. Files this device never downloaded are not updates -- there is nothing
 * to update.
 */
async function staleDownloads(): Promise<StoreUpdate[]> {
  const stale: StoreUpdate[] = [];
  let catalog: Record<string, Array<{ name: string; files: StoreFileInfo[] }>>;
  try {
    catalog = listCatalog() as unknown as Record<string, Array<{ name: string; files: StoreFileInfo[] }>>;
  } catch {
    return stale;
  }

  for (const kind of STORE_KINDS) {
    for (const item of catalog[kind] ?? []) {
      for (const file of item.files) {
        if (!file.local || !file.sha256) continue;
        const full = path.resolve(storeRoot(), kind, item.name, file.filename);
        try {
          const onDisk = createHash("sha256").update(readFileSync(full)).digest("hex");
          if (onDisk !== file.sha256) {
            stale.push({ kind, name: item.name, filename: file.filename, sha256: file.sha256 });
          }
        } catch {
          // Unreadable right now -- not something to report as an update.
          continue;
        }
      }
    }
  }
  return stale;
}

export interface ApplyResult {
  codeUpdated: boolean;
  codePulled?: string;
  codeProblem?: string;
  filesRefreshed: string[];
  fileProblems: string[];
  /** True when the code changed, so the running process is now older than its own source. */
  restartRequired: boolean;
}

/**
 * Applies what `checkForUpdates` found.
 *
 * `--autostash` for the same reason the store's own sync uses it: the person
 * running this is quite likely in the middle of something, and refusing to
 * update because of unsaved edits is a worse outcome than stashing them and
 * putting them straight back.
 */
export async function applyUpdates(opts: { code?: boolean; store?: boolean } = {}): Promise<ApplyResult> {
  const doCode = opts.code !== false;
  const doStore = opts.store !== false;
  const cwd = repoDir();
  const result: ApplyResult = { codeUpdated: false, filesRefreshed: [], fileProblems: [], restartRequired: false };

  if (doCode) {
    const branch = await git(["symbolic-ref", "--short", "HEAD"], cwd);
    if (!branch.ok || !branch.out) {
      result.codeProblem = "Not on a named branch, so there is nothing to pull.";
    } else {
      const before = await git(["rev-parse", "HEAD"], cwd);
      const pull = await git(["pull", "--rebase", "--autostash", "origin", branch.out], cwd);
      if (!pull.ok) {
        result.codeProblem = `Could not pull: ${pull.err.split("\n")[0] || "unknown error"}`;
      } else {
        const after = await git(["rev-parse", "HEAD"], cwd);
        result.codeUpdated = before.out !== after.out;
        result.codePulled = pull.out.split("\n")[0];
        // Said plainly rather than left for the user to work out: the files on
        // disk have moved on, and the process serving this response has not.
        result.restartRequired = result.codeUpdated;
      }
    }
  }

  if (doStore) {
    // Re-checked after the pull, because the pull is what brought the new
    // index -- checking before it would look at yesterday's answer.
    const stale = await staleDownloads();
    const { fetchItemFile } = await import("./store-fetch.js");
    for (const entry of stale) {
      const label = `${entry.kind}/${entry.name}/${entry.filename}`;
      try {
        const { unlinkSync } = await import("node:fs");
        // Removed first so the fetch sees it as absent and downloads rather
        // than serving the stale copy back.
        unlinkSync(path.resolve(storeRoot(), entry.kind, entry.name, entry.filename));
        await fetchItemFile(entry.kind, entry.name, entry.filename);
        result.filesRefreshed.push(label);
      } catch (err) {
        result.fileProblems.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return result;
}
