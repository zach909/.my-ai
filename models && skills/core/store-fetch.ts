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
 * and the current branch, turned into a raw file URL. Nothing new to configure
 * and no third-party service -- the same GitHub the publish just pushed to is
 * where the download comes from.
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
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readItem, storeRoot, assertKind, assertSafeName, assertSafeFilename, StoreError } from "./store.js";

/** Bounded so a stalled download cannot wedge a request forever. */
const FETCH_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 10_000;

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

  // symbolic-ref works on a branch with no commits yet, which rev-parse does
  // not -- and a fresh clone that has only fetched the index is exactly that
  // situation.
  const branch =
    (await git(["symbolic-ref", "--short", "HEAD"], start)) ??
    (await git(["rev-parse", "--abbrev-ref", "HEAD"], start)) ??
    "";
  if (!branch || branch === "HEAD") return { problem: "no-branch" };

  // Candidate refs, most specific first. The branch name is NOT URL-encoded:
  // this project's branches contain '/', and raw.githubusercontent needs those
  // slashes intact -- encoding them turns a real ref into a 404.
  //
  // The default branch is a fallback rather than a nicety. A working branch
  // gets merged and deleted, and after that its published files live only on
  // the default branch; without this, every device still on that branch loses
  // the ability to download anything, which is precisely when someone would
  // be trying to.
  const refs = [branch];
  const head = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], start);
  const defaultBranch = head?.replace(/^origin\//, "");
  if (defaultBranch && defaultBranch !== branch) refs.push(defaultBranch);
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
