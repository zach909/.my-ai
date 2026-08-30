/**
 * Turning "committed and pushed" into a link a person can actually click.
 *
 * syncStorePaths() (store-sync.ts) already does the real work: it commits a
 * publisher's files and pushes them, with no GitHub credential from the
 * person publishing -- the machine's own git remote does that, the same way
 * it already pushes wiki edits and store items. What it hands back is a
 * commit outcome (committed/pushed/branch), which is honest but not
 * something a person can DO anything with. This module is the missing step:
 * given the repo git already pushed to and the paths that were published,
 * work out the URL those paths are actually browsable at.
 *
 * Deliberately narrow. It reads `git remote get-url` on the repo the publish
 * already happened in -- it does not create a repository, does not touch
 * credentials, and does not talk to the GitHub API. If the remote is not a
 * GitHub remote, or there is no remote, the caller gets told that plainly
 * rather than handed a guessed URL.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const GIT_TIMEOUT_MS = 10_000;

function git(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile(
      "git",
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }),
    );
  });
}

/**
 * `owner/repo` out of any of the URL shapes git actually stores for a GitHub
 * remote: `git@github.com:owner/repo.git`, `https://github.com/owner/repo`,
 * `https://github.com/owner/repo.git`, `ssh://git@github.com/owner/repo.git`.
 * Returns null for anything that is not a GitHub remote -- a self-hosted
 * git server, a local path, GitLab, Bitbucket. Guessing a GitHub-shaped URL
 * for a non-GitHub remote would hand back a broken link that LOOKS right.
 */
export function githubRepoSlug(remoteUrl: string): string | null {
  const url = remoteUrl.trim();
  const patterns = [
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/,
    /^(?:https?|ssh):\/\/(?:git@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
    /^github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
  ];
  for (const p of patterns) {
    const m = p.exec(url);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return null;
}

export interface GithubLink {
  /** The URL to hand back to a publisher, or null when one could not be built. */
  url: string | null;
  /** Why not, when url is null -- phrased for a person reading it. */
  reason?: string;
  slug?: string;
}

/**
 * The repo's top-level directory containing `from`, or null when `from` is
 * not inside a git repository. Mirrors store-sync.ts's own repoRoot(), kept
 * separate rather than imported so this module has no dependency on the
 * store -- it is a generic "path plus branch plus remote -> URL" utility.
 */
async function repoRoot(from: string): Promise<string | null> {
  const start = existsSync(from) ? from : path.dirname(from);
  const res = await git(["rev-parse", "--show-toplevel"], start);
  if (!res.ok) return null;
  const root = res.stdout.trim();
  return root.length > 0 ? root : null;
}

async function slugFor(cwd: string, remote: string): Promise<{ slug: string } | { reason: string }> {
  const res = await git(["remote", "get-url", remote], cwd);
  if (!res.ok) return { reason: `No "${remote}" remote to read a URL from.` };
  const slug = githubRepoSlug(res.stdout);
  if (!slug) return { reason: `The "${remote}" remote is not a github.com repository.` };
  return { slug };
}

/**
 * The browsable GitHub URL for the file at `absPath`, on `branch`.
 *
 * `absPath` is an ABSOLUTE filesystem path, not something the caller has to
 * pre-relativize against the repo root: the repo root is resolved here from
 * `absPath` itself via `git rev-parse --show-toplevel`, which is the only
 * way to get that answer right regardless of where the repo's working copy
 * (or an overridden store directory) happens to sit relative to it.
 */
export async function githubFileUrl(
  absPath: string,
  branch: string,
  opts: { remote?: string } = {},
): Promise<GithubLink> {
  const remote = opts.remote ?? "origin";
  // absPath names a FILE, and `git rev-parse` needs a directory to run in --
  // its own containing directory, which is on the same repo either way.
  const root = await repoRoot(path.dirname(absPath));
  if (!root) return { url: null, reason: "Not inside a git repository." };
  const rel = path.relative(root, absPath);
  if (rel.startsWith("..") || rel === "") {
    return { url: null, reason: "The path is outside the repository." };
  }
  const found = await slugFor(root, remote);
  if ("reason" in found) return { url: null, reason: found.reason };
  const cleanPath = rel.split(path.sep).map(encodeURIComponent).join("/");
  return { url: `https://github.com/${found.slug}/blob/${encodeURIComponent(branch)}/${cleanPath}`, slug: found.slug };
}

/** Same, for a directory rather than one file -- what a multi-file publish gets. */
export async function githubDirUrl(
  absDir: string,
  branch: string,
  opts: { remote?: string } = {},
): Promise<GithubLink> {
  const remote = opts.remote ?? "origin";
  const root = await repoRoot(absDir);
  if (!root) return { url: null, reason: "Not inside a git repository." };
  const rel = path.relative(root, absDir);
  if (rel.startsWith("..")) {
    return { url: null, reason: "The path is outside the repository." };
  }
  const found = await slugFor(root, remote);
  if ("reason" in found) return { url: null, reason: found.reason };
  const cleanPath = rel === "" ? "" : rel.split(path.sep).map(encodeURIComponent).join("/");
  const url = cleanPath
    ? `https://github.com/${found.slug}/tree/${encodeURIComponent(branch)}/${cleanPath}`
    : `https://github.com/${found.slug}/tree/${encodeURIComponent(branch)}`;
  return { url, slug: found.slug };
}
