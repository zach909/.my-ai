/**
 * Minimal semantic versioning (Section 8 of docs/EXTENSION_SYSTEM.md).
 *
 * No external "semver" package -- consistent with the rest of the repo's
 * "no external APIs, local and deterministic" convention (see
 * models && skills/core/long-term-memory.ts, context-compressor.ts). Supports
 * the subset of range syntax the Extension System actually needs: exact
 * versions, "*", "^x.y.z" (compatible-with, same major), "~x.y.z"
 * (compatible-with, same major.minor), and ">=x.y.z".
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(v: string): Version {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec((v || "").trim());
  if (!m) throw new Error(`Invalid semantic version: "${v}"`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function isValidVersion(v: string): boolean {
  try {
    parseVersion(v);
    return true;
  } catch {
    return false;
  }
}

/** -1 if a<b, 0 if equal, 1 if a>b. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;
  return 0;
}

export function gt(a: string, b: string): boolean {
  return compareVersions(a, b) > 0;
}

/** Does `version` satisfy `range`? */
export function satisfies(version: string, range: string): boolean {
  const r = (range || "*").trim();
  if (r === "*" || r === "") return isValidVersion(version);
  if (r.startsWith("^")) {
    const base = parseVersion(r.slice(1));
    const v = parseVersion(version);
    if (v.major !== base.major) return false;
    return compareVersions(version, r.slice(1)) >= 0;
  }
  if (r.startsWith("~")) {
    const base = parseVersion(r.slice(1));
    const v = parseVersion(version);
    if (v.major !== base.major || v.minor !== base.minor) return false;
    return compareVersions(version, r.slice(1)) >= 0;
  }
  if (r.startsWith(">=")) {
    return compareVersions(version, r.slice(2).trim()) >= 0;
  }
  // Exact match.
  return compareVersions(version, r) === 0;
}

/** Pick the highest available version satisfying `range`, or null. */
export function resolveBest(available: string[], range: string): string | null {
  const candidates = available.filter(v => satisfies(v, range));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, v) => (gt(v, best) ? v : best));
}
