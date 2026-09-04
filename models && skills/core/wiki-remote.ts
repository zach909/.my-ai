/**
 * Bot-published wiki pages, visible without landing on this device's disk.
 *
 * wiki-store.ts's listWikiPages()/readWikiPage() only ever see wiki/bot/
 * as it exists locally -- a page published from a DIFFERENT device reaches
 * the store branch (publishWikiPageAndSync -> syncStorePaths, see
 * wiki-store.ts) but this device never pulls it back down, so it stayed
 * invisible here until someone republished it from this exact machine.
 * "Bot Wiki" showing empty while the store branch plainly has pages on it
 * was that gap.
 *
 * This closes it the way the person asked: readable straight from the store
 * branch, not synced to local disk first. `git show <remote>/<branch>:path`
 * reads a blob out of the remote-tracking ref directly -- it touches this
 * repo's object database (git's own cache, unavoidable) but writes nothing
 * under wiki/, and never touches this repo's HEAD, checked-out branch, or
 * working tree. A page fetched this way is not "on this device" in the
 * sense that matters here: nothing under wiki/bot/ changed, and a second
 * read goes back to the store branch again rather than reading a local copy.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { DEFAULT_STORE_BRANCH } from "./store-sync.js";
import { extractWikiSummary, type WikiPage, type WikiPageSummary } from "./wiki-store.js";

const GIT_TIMEOUT_MS = 15_000;

function git(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string }> {
  return new Promise(resolve => {
    execFile(
      "git",
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout) => resolve({ ok: !err, stdout: String(stdout ?? "") }),
    );
  });
}

/** The repository root containing `wiki/`, or null when there is no git repo. */
async function repoRoot(startDir: string): Promise<string | null> {
  const start = existsSync(startDir) ? startDir : path.dirname(startDir);
  const res = await git(["rev-parse", "--show-toplevel"], start);
  if (!res.ok) return null;
  const root = res.stdout.trim();
  return root.length > 0 ? root : null;
}

/**
 * Best-effort: fetches the store branch and returns the ref to read it at,
 * or null when there is no repo, no remote, or no store branch yet (a fresh
 * repo that has never had anything published to it). Never throws -- a
 * remote wiki being unreachable is not a reason to fail a page read that
 * might still succeed locally.
 */
async function remoteRef(remote: string, branch: string): Promise<{ root: string; ref: string } | null> {
  const root = await repoRoot(process.cwd());
  if (!root) return null;
  await git(["fetch", remote, `${branch}:refs/remotes/${remote}/${branch}`], root);
  const rev = await git(["rev-parse", `${remote}/${branch}`], root);
  if (!rev.ok) return null;
  return { root, ref: `${remote}/${branch}` };
}

/**
 * Every bot-published page name on the store branch, whether or not it has
 * ever reached this device's disk. `git ls-tree` reads the tree directly --
 * no fetch of file contents beyond the tree listing itself.
 */
async function remoteBotPageNames(remote: string, branch: string): Promise<{ root: string; ref: string; names: string[] } | null> {
  const target = await remoteRef(remote, branch);
  if (!target) return null;
  const listed = await git(["ls-tree", "--name-only", "-r", `${target.ref}:wiki/bot`], target.root);
  if (!listed.ok) return { ...target, names: [] };
  const names = listed.stdout
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.endsWith(".md") && !l.includes("/")) // top-level only -- excludes .backups/*
    .map(l => l.slice(0, -3));
  return { ...target, names };
}

/**
 * Summaries for every bot-published page on the store branch that is NOT
 * already in `excludeNames` (the caller's local listWikiPages() results,
 * typically) -- so a caller can show "everything that exists" without
 * listing a page twice just because it happens to be on both the store
 * branch and this device.
 */
export async function listRemoteOnlyBotPages(excludeNames: ReadonlySet<string>): Promise<WikiPageSummary[]> {
  const remote = process.env.NEUROCLAW_STORE_REMOTE?.trim() || "origin";
  const branch = DEFAULT_STORE_BRANCH;
  const found = await remoteBotPageNames(remote, branch);
  if (!found) return [];

  const summaries: WikiPageSummary[] = [];
  for (const name of found.names) {
    if (excludeNames.has(name)) continue;
    const shown = await git(["show", `${found.ref}:wiki/bot/${name}.md`], found.root);
    if (!shown.ok) continue;
    summaries.push({ name, source: "bot", ...extractWikiSummary(shown.stdout) });
  }
  return summaries.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * One bot-published page's content, read straight from the store branch.
 * Returns null when it isn't there (no repo, no remote, no store branch, or
 * no page by that name on it) rather than throwing -- the caller already
 * tried the local copy first and this is the fallback, not the primary path.
 */
export async function readRemoteBotPage(name: string): Promise<WikiPage | null> {
  const remote = process.env.NEUROCLAW_STORE_REMOTE?.trim() || "origin";
  const branch = DEFAULT_STORE_BRANCH;
  const target = await remoteRef(remote, branch);
  if (!target) return null;
  const shown = await git(["show", `${target.ref}:wiki/bot/${name}.md`], target.root);
  if (!shown.ok) return null;
  return { name, source: "bot", content: shown.stdout, ...extractWikiSummary(shown.stdout) };
}
