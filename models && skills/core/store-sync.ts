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
 * Four rules shape everything here.
 *
 * 1. Only the store's own paths are ever committed. Never a blanket
 *    `git add -A`, never a branch change. Someone publishing a skill has not
 *    asked to commit whatever else is in their working tree, and a store
 *    publish that swept up unrelated edits would be a far worse bug than one
 *    that failed to sync.
 *
 * 2. Store content lives on its own branch (`store` by default, see
 *    NEUROCLAW_STORE_BRANCH), never on whatever branch a machine happens to
 *    have checked out. Skills, plugins, wiki pages, and anything else
 *    published here are shared state, not part of any one feature branch's
 *    history -- publishing must never depend on which branch a developer is
 *    mid-task on, and must never land a "store: publish x" commit in their
 *    feature branch's history. This is done entirely with plumbing
 *    (read-tree / write-tree / commit-tree) against a throwaway index, so a
 *    publish never touches the developer's actual checkout, HEAD, or index
 *    at all -- there is no branch to switch back to afterwards because none
 *    was ever switched.
 *
 * 3. Failure is reported, never swallowed and never faked. No git, no remote,
 *    no credentials, no network, a rejected push -- each is a real outcome
 *    with a real reason, returned to the caller so the UI can say "saved on
 *    this device only" instead of implying the item reached everyone. The
 *    files are already written by the time we get here, so a sync failure
 *    must not fail the publish; it downgrades it.
 *
 * 4. A rejected push is retried exactly once, after re-fetching the store
 *    branch's current tip and rebuilding the commit on top of it. Two people
 *    publishing at the same time is the normal case, not an error. Retrying
 *    forever is not -- one retry resolves the race, and a second failure is
 *    a real problem the caller should hear about.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** What a sync attempt actually did. Every field is observed, never assumed. */
export interface StoreSyncResult {
  /** True only when a commit was actually created. */
  committed: boolean;
  /** True only when a push actually succeeded. */
  pushed: boolean;
  /** The branch that was (or would have been) pushed. */
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

/** The hash of the empty tree -- the same in every git repository ever. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * The branch all store content lives on. Fixed, not derived from whatever a
 * machine has checked out -- see rule 2 above. Overridable for anyone
 * running a private instance with a different naming convention, and for
 * tests that want isolation from each other.
 */
export const DEFAULT_STORE_BRANCH = process.env.NEUROCLAW_STORE_BRANCH?.trim() || "store";

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
function git(args: string[], cwd: string, extraEnv?: NodeJS.ProcessEnv): Promise<GitRun> {
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
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extraEnv },
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
 * One attempt at building and pushing the store branch's next commit,
 * entirely against a throwaway index (GIT_INDEX_FILE) rooted on the store
 * branch's current remote tip -- never the developer's real index, and never
 * their checked-out branch or HEAD.
 */
async function attemptSync(
  root: string,
  remote: string,
  branch: string,
  relPaths: string[],
  message: string,
  tmpIndex: string,
): Promise<{ pushed: boolean; changed: boolean; error?: string }> {
  const envIdx = { GIT_INDEX_FILE: tmpIndex };

  // Best-effort: an unreachable remote or a store branch that does not exist
  // yet both leave this simply not updating the remote-tracking ref, which
  // rev-parse below reports honestly.
  await git(["fetch", remote, `${branch}:refs/remotes/${remote}/${branch}`], root);
  const rev = await git(["rev-parse", `${remote}/${branch}`], root);
  const parent = rev.ok ? rev.stdout.trim() : null;
  const baseTree = parent ? `${parent}^{tree}` : EMPTY_TREE;

  const read = await git(["read-tree", baseTree], root, envIdx);
  if (!read.ok) {
    return { pushed: false, changed: false, error: `Could not read the store branch: ${firstLine(read.stderr)}` };
  }

  // -A so a removed item stages as a deletion; `--` so a path can never be
  // read as an option. `git add` reads the actual files on disk regardless
  // of which index is active, so this picks up exactly what the caller
  // wrote, without disturbing the developer's own staged changes.
  const add = await git(["add", "-A", "--", ...relPaths], root, envIdx);
  if (!add.ok) {
    return { pushed: false, changed: false, error: `Could not stage the change: ${firstLine(add.stderr)}` };
  }

  // Nothing staged means the files on disk already match the store branch --
  // a republish of identical content. That is a success with no work to do,
  // not a failure, and committing an empty change would be noise in
  // everyone's log.
  const diff = await git(["diff-index", "--quiet", "--cached", baseTree], root, envIdx);
  if (diff.ok) return { pushed: true, changed: false };

  const writeTree = await git(["write-tree"], root, envIdx);
  if (!writeTree.ok) {
    return { pushed: false, changed: true, error: `Could not build the tree: ${firstLine(writeTree.stderr)}` };
  }
  const newTree = writeTree.stdout.trim();

  const commitArgs = parent
    ? ["commit-tree", newTree, "-p", parent, "-m", message]
    : ["commit-tree", newTree, "-m", message];
  const commitTree = await git(commitArgs, root, envIdx);
  if (!commitTree.ok) {
    return { pushed: false, changed: true, error: `Could not commit: ${firstLine(commitTree.stderr)}` };
  }
  const commit = commitTree.stdout.trim();

  const push = await git(["push", remote, `${commit}:refs/heads/${branch}`], root);
  if (!push.ok) {
    return { pushed: false, changed: true, error: firstLine(push.stderr) };
  }
  // Keep the local view of the store branch fresh without a second network
  // round trip -- purely a courtesy, not load-bearing for anything above.
  await git(["update-ref", `refs/remotes/${remote}/${branch}`, commit], root);
  return { pushed: true, changed: true };
}

/**
 * Commits the given store paths onto the store branch and pushes them.
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
  opts: { storeDir: string; remote?: string; branch?: string },
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

  const branch = opts.branch ?? DEFAULT_STORE_BRANCH;
  const remote = opts.remote ?? "origin";

  const remotes = await git(["remote"], root);
  if (!remotes.ok || !remotes.stdout.split("\n").map(s => s.trim()).includes(remote)) {
    return {
      committed: false,
      pushed: false,
      branch,
      reason: `This clone has no "${remote}" remote, so the item is saved on this device only.`,
    };
  }

  const tmpDir = mkdtempSync(path.join(tmpdir(), "neuroclaw-store-sync-"));
  const tmpIndex = path.join(tmpDir, "index");
  try {
    const first = await attemptSync(root, remote, branch, relPaths, message, tmpIndex);
    if (!first.changed) {
      if (first.error) return { committed: false, pushed: false, branch, reason: first.error };
      return { committed: false, pushed: true, branch, reason: "Already up to date — the store already had exactly this." };
    }
    if (first.pushed) return { committed: true, pushed: true, branch };

    // Someone else published to the store branch first. Re-fetch its new
    // tip, rebuild the commit on top of it, and try exactly once more --
    // concurrent publishes are the expected case, not an error.
    const second = await attemptSync(root, remote, branch, relPaths, message, tmpIndex);
    if (!second.changed) {
      // The retry's rebuild landed on content identical to the new tip --
      // someone else published exactly this first.
      return { committed: true, pushed: true, branch, reason: "Already up to date — the store already had exactly this." };
    }
    if (second.pushed) return { committed: true, pushed: true, branch };

    return {
      committed: true,
      pushed: false,
      branch,
      reason: `Committed, but the push to ${remote}/${branch} failed: ${second.error ?? first.error ?? "unknown error"}`,
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
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
