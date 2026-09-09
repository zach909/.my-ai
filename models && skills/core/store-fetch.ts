/**
 * Fetching a published file that is not on this device yet.
 *
 * The store's catalogue travels as an index -- every item's name, description,
 * file list, sizes and checksums -- which is small enough that every clone can
 * carry all of it. The payloads are the part that would make a device hold a
 * library it never asked for, so they are fetched when someone actually clicks
 * a file, and not before.
 *
 * The source is the repository the store already lives in: the `origin` remote
 * and the store branch (see store-sync.ts -- store content lives on its own
 * branch now, not whatever a device happens to have checked out), turned into
 * a raw file URL. Nothing new to configure and no third-party service -- the
 * same GitHub the publish just pushed to is where the download comes from.
 *
 * Two properties matter more than the transport:
 *
 *  - Every fetched file is checked against the sha256 the manifest recorded at
 *    publish time. A payload arriving over the network from a host nobody in
 *    this process controls is exactly where a silent substitution would land,
 *    and the index is signed by nothing -- but it IS what every other clone
 *    pulled, so a mismatch means the bytes are not what was published, and
 *    that is worth refusing over.
 *
 *  - A fetched file is cached to disk, so the second click is free and the
 *    device gradually holds exactly what its owner chose to use. That is the
 *    whole point: not "nothing local", but "only what you asked for".
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { readItem, storeRoot, assertKind, assertSafeName, assertSafeFilename, StoreError } from "./store.js";
import { DEFAULT_STORE_BRANCH } from "./store-sync.js";

/** Bounded so a stalled download cannot wedge a request forever. */
const FETCH_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 10_000;
/** `git archive` of the whole catalogue is still a small, text-only tree. */
const ARCHIVE_TIMEOUT_MS = 30_000;

/** Refuses a payload larger than the store's own per-file cap, even if the index claims otherwise. */
const MAX_FETCH_BYTES = 8 * 1024 * 1024;

export class StoreFetchError extends StoreError {}

function git(args: string[], cwd: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile("git", args, { cwd, timeout: GIT_TIMEOUT_MS }, (err, stdout) => {
      resolve(err ? null : String(stdout ?? "").trim());
    });
  });
}

/**
 * The repository root, or null when `startDir` is not inside a git repo.
 * Mirrors store-sync.ts's own repoRoot() -- kept separate rather than
 * imported, the same call github-link.ts's doc comment makes for its copy.
 */
async function repoRoot(startDir: string): Promise<string | null> {
  const start = existsSync(startDir) ? startDir : path.dirname(startDir);
  return git(["rev-parse", "--show-toplevel"], start);
}

export interface StoreCatalogPullResult {
  pulled: boolean;
  reason?: string;
}

/**
 * Populates (or refreshes) this device's local `store/` directory from the
 * store branch, so the catalogue is visible without anyone having to
 * publish something first.
 *
 * Store content no longer travels with `main` (see store-sync.ts) -- a
 * plain `git clone`/`git pull` of the app itself does not bring it along
 * anymore, so something has to. This is that something: it should be called
 * once at boot, before anything reads the catalogue.
 *
 * Uses `git archive`, which reads straight out of the store branch's
 * remote-tracking ref and writes plain files to a plain tar file -- it
 * never touches this repo's HEAD, branch, or index, the same guarantee
 * syncStorePaths() makes for the write side.
 *
 * This overlays rather than mirrors: it extracts files, it does not delete
 * ones already on disk that the store branch no longer has -- a plain
 * `tar -x` cannot express "and remove everything else". A device that only
 * ever calls this, and never `git pull`s a branch that used to carry
 * `store/` the old way, can keep a stale local copy of an item someone else
 * removed. That does not undo the removal -- readItem()/listCatalog() still
 * only ever show what actually got published, and a fresh clone of the
 * store branch has none of the stale file -- it is purely a property of one
 * long-lived device's disk, not of the store.
 *
 * `manifestsOnly`: "I want users to be able to view store without downloading
 * everything" -- readItem()/listCatalog() (store.ts) were already built to
 * need nothing but each item's manifest.json: a payload file that isn't on
 * disk just reports `local: false`, and store-fetch.ts's own per-file
 * fetchItemFile() below is what brings one down, on demand, when someone
 * actually asks for it. This function was the one place that didn't hold up
 * its end -- a plain `git archive` with no pathspec pulls every payload byte
 * of every published item, every time, before anyone has browsed anything.
 * `manifestsOnly: true` restricts the archive to `*manifest.json` (a git
 * pathspec, not a shell glob), so a boot-time catalogue refresh brings down
 * only what listing actually reads -- kilobytes, not whatever the total
 * store has grown to. Payload files a device already fetched on demand stay
 * on disk either way; this only changes what a *fresh* pull brings down.
 * Defaults to false (the original, full-archive behavior) so an explicit,
 * one-off full sync is still one call away for anything that wants it.
 */
export async function pullStoreCatalog(
  opts: { storeDir?: string; remote?: string; branch?: string; manifestsOnly?: boolean } = {},
): Promise<StoreCatalogPullResult> {
  const storeDir = opts.storeDir ?? storeRoot();
  const remote = opts.remote ?? "origin";
  const branch = opts.branch ?? DEFAULT_STORE_BRANCH;

  const root = await repoRoot(storeDir);
  if (!root) return { pulled: false, reason: "Not a git repository." };

  // Best-effort: an unreachable remote just leaves whatever remote-tracking
  // ref already exists from an earlier fetch, which rev-parse below reports
  // honestly either way.
  await git(["fetch", remote, `${branch}:refs/remotes/${remote}/${branch}`], root);
  const rev = await git(["rev-parse", `${remote}/${branch}`], root);
  if (rev === null) {
    return { pulled: false, reason: `No "${branch}" branch on "${remote}" yet -- nothing has been published there so far.` };
  }

  const tmpFile = path.join(tmpdir(), `neuroclaw-store-archive-${process.pid}-${Date.now()}.tar`);
  try {
    const archiveArgs = opts.manifestsOnly
      ? ["archive", "--output", tmpFile, rev, "--", "*manifest.json"]
      : ["archive", "--output", tmpFile, rev];
    // A `manifestsOnly` pathspec matching zero files (nothing published yet
    // anywhere) is `git archive` exiting non-zero with "did not match any
    // files" -- a real, successful answer ("empty catalogue"), not a failure
    // to read the branch, so it's told apart from every other archive error
    // instead of being reported as one.
    const archiveResult = await new Promise<{ ok: boolean; stderr: string }>(resolve => {
      execFile("git", archiveArgs, { cwd: root, timeout: ARCHIVE_TIMEOUT_MS }, (err, _stdout, stderr) => {
        resolve({ ok: !err, stderr: String(stderr ?? "") });
      });
    });
    if (!archiveResult.ok) {
      if (opts.manifestsOnly && /did not match any files/.test(archiveResult.stderr)) {
        return { pulled: true };
      }
      return { pulled: false, reason: "Could not read the store branch's contents." };
    }

    const extracted = await new Promise<boolean>(resolve => {
      execFile("tar", ["-xf", tmpFile, "-C", root], { timeout: ARCHIVE_TIMEOUT_MS }, err => resolve(!err));
    });
    if (!extracted) return { pulled: false, reason: "Could not extract the store branch's contents." };
  } finally {
    try {
      rmSync(tmpFile, { force: true });
    } catch {
      // Best-effort cleanup of a temp file; leaving it behind is harmless.
    }
  }

  return { pulled: true };
}

/**
 * Turns the repository's `origin` into the owner/repo a raw URL needs.
 *
 * Handles both URL shapes git uses (https and ssh) because a clone made either
 * way should be able to download, and someone who cloned over ssh has done
 * nothing wrong.
 */
export function parseGitHubRemote(remote: string): { owner: string; repo: string } | null {
  const cleaned = remote.trim().replace(/\.git$/, "");
  const https = cleaned.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+)$/);
  if (https) return { owner: https[1], repo: https[2] };
  const ssh = cleaned.match(/^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+)$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  return null;
}

/**
 * Why a download source could not be worked out. Separate from the URL itself
 * because "there is no remote" and "the remote is not GitHub" and "I cannot
 * tell which branch you are on" need different things done about them, and a
 * single null told the person the wrong one -- the first version of this
 * reported "no origin remote" on a clone that had one.
 */
export type RawUrlProblem = "no-remote" | "not-github" | "no-branch";

export async function resolveRawUrlBase(): Promise<{ base: string; refs: string[] } | { problem: RawUrlProblem }> {
  const root = storeRoot();
  const start = existsSync(root) ? root : path.dirname(root);

  const remote = await git(["remote", "get-url", "origin"], start);
  if (!remote) return { problem: "no-remote" };
  const parsed = parseGitHubRemote(remote);
  if (!parsed) return { problem: "not-github" };

  // Published files live on the store branch (store-sync.ts), not on
  // whatever branch this device happens to have checked out for app
  // development -- so that is the primary ref to fetch from.
  const branch = DEFAULT_STORE_BRANCH;

  // Candidate refs, most specific first. Branch names are NOT URL-encoded:
  // this project's branches contain '/', and raw.githubusercontent needs those
  // slashes intact -- encoding them turns a real ref into a 404.
  //
  // The currently checked-out branch and the default branch are fallbacks,
  // not the primary source: a fresh clone that has not yet fetched the store
  // branch, or a private instance that has never renamed NEUROCLAW_STORE_BRANCH
  // away from a branch that happens to not exist there, should still be able
  // to find a file that an older publish committed straight onto a regular
  // branch before this module existed.
  const refs = [branch];
  const checkedOut =
    (await git(["symbolic-ref", "--short", "HEAD"], start)) ??
    (await git(["rev-parse", "--abbrev-ref", "HEAD"], start)) ??
    "";
  if (checkedOut && checkedOut !== "HEAD" && !refs.includes(checkedOut)) refs.push(checkedOut);
  const head = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], start);
  const defaultBranch = head?.replace(/^origin\//, "");
  if (defaultBranch && !refs.includes(defaultBranch)) refs.push(defaultBranch);
  else if (!refs.includes("main")) refs.push("main");

  return {
    base: `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}`,
    refs: refs.map(r => `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${r}`),
  };
}

/** Where this clone's published files can be read from, or null when that cannot be worked out. */
export async function rawUrlBase(): Promise<string | null> {
  const resolved = await resolveRawUrlBase();
  return "base" in resolved ? resolved.base : null;
}

const PROBLEM_TEXT: Record<RawUrlProblem, string> = {
  "no-remote": "there is no 'origin' remote to fetch it from. Add one, or pull the repository.",
  "not-github": "this clone's 'origin' is not a GitHub URL, and downloads are served from GitHub raw.",
  "no-branch": "this clone is not on a named branch, so there is no branch to download from. Check one out.",
};

export interface FetchResult {
  buf: Buffer;
  /** True when the bytes were already here and nothing was downloaded. */
  cached: boolean;
  /** Where it came from, when it was downloaded. */
  url?: string;
}

/**
 * Returns a published file's bytes, downloading them if this device does not
 * have them yet.
 *
 * Throws rather than returning something plausible when the download fails or
 * the checksum does not match: a store that quietly served the wrong bytes
 * would be worse than one that could not serve them at all.
 */
export async function fetchItemFile(kind: string, name: string, filename: string): Promise<FetchResult> {
  assertKind(kind);
  assertSafeName(name);
  assertSafeFilename(filename);

  const item = readItem(kind, name);
  if (!item) throw new StoreFetchError(`There is no published "${kind}/${name}".`);
  const entry = item.files.find(f => f.filename === filename);
  if (!entry) throw new StoreFetchError(`"${filename}" is not part of ${kind}/${name}.`);

  const target = path.resolve(storeRoot(), kind, name, filename);
  const itemRoot = path.resolve(storeRoot(), kind, name);
  if (!target.startsWith(itemRoot + path.sep)) {
    throw new StoreFetchError(`"${filename}" would resolve outside the item.`);
  }

  if (entry.local) {
    const { readFileSync } = await import("node:fs");
    return { buf: readFileSync(target), cached: true };
  }

  if (entry.bytes > MAX_FETCH_BYTES) {
    throw new StoreFetchError(
      `"${filename}" is ${(entry.bytes / 1024 / 1024).toFixed(1)} MB, over the ${MAX_FETCH_BYTES / 1024 / 1024} MB limit.`,
    );
  }

  const resolved = await resolveRawUrlBase();
  if (!("base" in resolved)) {
    throw new StoreFetchError(`"${filename}" is not on this device, and ${PROBLEM_TEXT[resolved.problem]}`);
  }

  const suffix = `/store/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/${filename
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  let res: Response | null = null;
  let url = "";
  let lastStatus = 0;
  for (const refBase of resolved.refs) {
    url = `${refBase}${suffix}`;
    try {
      const attempt = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (attempt.ok) {
        res = attempt;
        break;
      }
      lastStatus = attempt.status;
    } catch (err) {
      throw new StoreFetchError(
        `Could not reach GitHub to download "${filename}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (!res) {
    throw new StoreFetchError(
      `GitHub returned ${lastStatus} for "${filename}" on every branch tried (${resolved.refs.length}). It may not have been pushed yet.`,
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FETCH_BYTES) {
    throw new StoreFetchError(`"${filename}" downloaded larger than the ${MAX_FETCH_BYTES / 1024 / 1024} MB limit.`);
  }

  // The index recorded this hash when the file was published, and every clone
  // pulled the same index. Bytes that do not match it are not the published
  // file, whatever else they may be.
  const got = createHash("sha256").update(buf).digest("hex");
  if (entry.sha256 && got !== entry.sha256) {
    throw new StoreFetchError(
      `"${filename}" did not match its published checksum, so it was not saved. Expected ${entry.sha256.slice(0, 16)}…, got ${got.slice(0, 16)}….`,
    );
  }

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, buf);
  return { buf, cached: false, url };
}
