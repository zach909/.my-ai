/**
 * Makes a publish actually leave the device.
 *
 * store.ts writes a published item into `store/` and stops there. That is
 * only half of what the store promises: an item sitting untracked in a
 * working copy is exactly as device-local as the thing the store exists to
 * replace -- it dies with the machine, and nobody else ever sees it. This
 * module is the other half: it commits the item's own paths and pushes them,
 * so `git pull` on any other clone is a complete sync.
 *
 * Three rules shape everything here.
 *
 * 1. Only the store's own paths are ever committed. Never a blanket
 *    `git add -A`, never a branch change. Someone publishing a skill has not
 *    asked to commit whatever else is in their working tree, and a store
 *    publish that swept up unrelated edits would be a far worse bug than one
 *    that failed to sync. (A rebase may autostash their edits and put them
 *    straight back -- that moves nothing into a commit.)
 *
 * 2. Failure is reported, never swallowed and never faked. No git, no remote,
 *    no credentials, no network, a rejected push -- each is a real outcome
 *    with a real reason, returned to the caller so the UI can say "saved on
 *    this device only" instead of implying the item reached everyone. The
 *    files are already written by the time we get here, so a sync failure
 *    must not fail the publish; it downgrades it.
 *
 * 3. A rejected push is retried exactly once, after rebasing on the remote.
 *    Two people publishing at the same time is the normal case, not an
 *    error. Retrying forever is not -- one retry resolves the race, and a
 *    second failure is a real problem the caller should hear about.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** What a sync attempt actually did. Every field is observed, never assumed. */
export interface StoreSyncResult {
  /** True only when a commit was actually created. */
  committed: boolean;
  /** True only when a push actually succeeded. */
  pushed: boolean;
  /** The branch that was pushed, when there was one. */
  branch?: string;
  /**
   * Why the sync did not fully happen. Present whenever `pushed` is false,
   * phrased for a person reading it in the UI.
   */
  reason?: string;
}

/**
 * Bounded so a hung network call cannot wedge a publish request forever.
 * A push of a few small files is a sub-second operation; 30s is generous.
 */
const GIT_TIMEOUT_MS = 30_000;

interface GitRun {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Runs one git command. Uses execFile with an argument array rather than a
 * shell string: item names reach this module from the network, and no amount
 * of name validation upstream is a good reason to hand attacker-influenced
 * text to a shell.
 */
function git(args: string[], cwd: string): Promise<GitRun> {
  return new Promise(resolve => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        // A publish must never block on git asking a human for a password.
        // Without this a missing credential turns into a hung request
        // instead of a clean "could not push" the user can act on.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}

/** The repository root containing `store/`, or null when there is no git repo. */
async function repoRoot(storeDir: string): Promise<string | null> {
  const start = existsSync(storeDir) ? storeDir : path.dirname(storeDir);
  const res = await git(["rev-parse", "--show-toplevel"], start);
  if (!res.ok) return null;
  const root = res.stdout.trim();
  return root.length > 0 ? root : null;
}

/**
 * Commits the given store paths and pushes them.
 *
 * `paths` are absolute; they are made repo-relative before staging so the
 * command is identical no matter where the process was started from.
 * Deleted paths are handled by the same call: `git add -A -- <path>` stages a
 * removal as readily as an addition, which is what makes an unpublish
 * propagate instead of silently reappearing on the next pull.
 */
export async function syncStorePaths(
  paths: string[],
  message: string,
  opts: { storeDir: string; remote?: string },
): Promise<StoreSyncResult> {
  // An explicit opt-out, for anyone running a private instance who does not
  // want publishes leaving the machine at all. Off by default: the store's
  // entire purpose is that publishing is not device-local.
  if (process.env.NEUROCLAW_STORE_NO_SYNC === "1") {
    return { committed: false, pushed: false, reason: "Store sync is disabled (NEUROCLAW_STORE_NO_SYNC=1)." };
  }

  const root = await repoRoot(opts.storeDir);
  if (!root) {
    return {
      committed: false,
      pushed: false,
      reason: "Not a git repository, so there is nowhere to push. The item is saved on this device only.",
    };
  }

  const relPaths = paths.map(p => path.relative(root, p)).filter(p => p.length > 0 && !p.startsWith(".."));
  if (relPaths.length === 0) {
    return { committed: false, pushed: false, reason: "Nothing inside the repository to commit." };
  }

  // -A so a removed item stages as a deletion; `--` so a path can never be
  // read as an option.
  const add = await git(["add", "-A", "--", ...relPaths], root);
  if (!add.ok) {
    return { committed: false, pushed: false, reason: `Could not stage the change: ${firstLine(add.stderr)}` };
  }

  // Nothing staged means the files on disk already match HEAD -- a republish
  // of identical content. That is a success with no work to do, not a
  // failure, and committing an empty change would be noise in everyone's log.
  const staged = await git(["diff", "--cached", "--quiet", "--", ...relPaths], root);
  if (staged.ok) {
    return { committed: false, pushed: true, reason: "Already up to date — the store already had exactly this." };
  }

  // Only the store paths are committed, even if the working tree has other
  // changes staged: `--only` restricts the commit to these pathspecs.
  const commit = await git(["commit", "--only", "-m", message, "--", ...relPaths], root);
  if (!commit.ok) {
    return { committed: false, pushed: false, reason: `Could not commit: ${firstLine(commit.stderr || commit.stdout)}` };
  }

  const branchRes = await git(["rev-parse", "--abbrev-ref", "HEAD"], root);
  const branch = branchRes.stdout.trim();
  if (!branchRes.ok || branch === "" || branch === "HEAD") {
    return {
      committed: true,
      pushed: false,
      reason: "Committed, but HEAD is detached so there is no branch to push. Check out a branch and push to share it.",
    };
  }

  const remote = opts.remote ?? "origin";
  const remotes = await git(["remote"], root);
  if (!remotes.ok || !remotes.stdout.split("\n").map(s => s.trim()).includes(remote)) {
    return {
      committed: true,
      pushed: false,
      branch,
      reason: `Committed, but this clone has no "${remote}" remote, so it stayed on this device.`,
    };
  }

  const push = await git(["push", remote, `HEAD:${branch}`], root);
  if (push.ok) return { committed: true, pushed: true, branch };

  // Someone else pushed first. Rebase our single store commit on top of
  // theirs and try once more -- concurrent publishes are the expected case.
  //
  // --autostash because the publisher is a person who was in the middle of
  // something: having unstaged edits is the normal state of a working tree,
  // and without this git refuses to rebase and the publish silently never
  // reaches anyone. Autostash restores those edits afterwards and never
  // commits them -- the commit above was already restricted to the store
  // paths by --only.
  const pull = await git(["pull", "--rebase", "--autostash", remote, branch], root);
  if (!pull.ok) {
    return {
      committed: true,
      pushed: false,
      branch,
      reason: `Committed, but the push was rejected and rebasing on ${remote}/${branch} failed: ${firstLine(pull.stderr)}`,
    };
  }
  const retry = await git(["push", remote, `HEAD:${branch}`], root);
  if (retry.ok) return { committed: true, pushed: true, branch };

  return {
    committed: true,
    pushed: false,
    branch,
    reason: `Committed on this device, but the push failed: ${firstLine(retry.stderr)}`,
  };
}

/**
 * Git writes multi-line hints to stderr; the first meaningful line is what a
 * person needs. Truncated because this reaches a UI, not a terminal.
 */
function firstLine(text: string): string {
  const line = text
    .split("\n")
    .map(s => s.trim())
    .find(s => s.length > 0);
  if (!line) return "no details available";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
