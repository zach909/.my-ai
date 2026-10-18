/**
 * The release manifest: one JSON file published with every release that says
 * which version it is, which source commit built it, and exactly which files
 * belong to it (with their SHA-256), per platform and architecture.
 *
 * scripts/release/manifest.mjs writes it from the artifacts the pipeline really
 * produced (a platform whose build failed has no entry, never a placeholder).
 * The app's update check reads it and `validateManifest` refuses anything that
 * is not exactly this shape, so a damaged or hostile manifest becomes a "failed"
 * update status rather than a bad download link.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { parseSemver, type Channel } from './version.js';
import { PLATFORM_IDS, type PlatformId } from './adapters.js';

export type SigningState = 'unsigned' | 'signed';

export interface ManifestArtifact {
  /** File name as published, e.g. neuroclaw-0.1.0-linux-x64.deb */
  name: string;
  platform: PlatformId;
  /** x64, arm64 or "any" (extension, web). */
  arch: string;
  /** What it is, e.g. linux-deb, windows-installer-exe, chrome-extension-zip. */
  kind: string;
  sha256: string;
  size: number;
  /** "unsigned" until a signing credential was available to the build. */
  signing: SigningState;
}

export interface ReleaseManifest {
  schema: 1;
  version: string;
  channel: Channel;
  commit: string;
  builtAt: string;
  artifacts: ManifestArtifact[];
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Returns the manifest, or throws an Error whose message says what is wrong. */
export function validateManifest(input: unknown): ReleaseManifest {
  if (!input || typeof input !== 'object') throw new Error('manifest is not an object');
  const m = input as Record<string, unknown>;
  if (m.schema !== 1) throw new Error(`unsupported manifest schema ${String(m.schema)}`);
  if (typeof m.version !== 'string' || !parseSemver(m.version)) throw new Error('manifest has no valid version');
  if (m.channel !== 'stable' && m.channel !== 'beta' && m.channel !== 'dev') throw new Error('manifest channel must be stable, beta or dev');
  if (typeof m.commit !== 'string' || !HEX40.test(m.commit)) throw new Error('manifest commit must be a 40-character git hash');
  if (typeof m.builtAt !== 'string' || Number.isNaN(Date.parse(m.builtAt))) throw new Error('manifest builtAt is not a date');
  if (!Array.isArray(m.artifacts)) throw new Error('manifest artifacts must be a list');
  const seen = new Set<string>();
  const artifacts = m.artifacts.map((raw, i): ManifestArtifact => {
    const a = raw as Record<string, unknown>;
    const where = `artifacts[${i}]`;
    if (typeof a?.name !== 'string' || !SAFE_NAME.test(a.name)) throw new Error(`${where}.name is not a plain file name`);
    if (seen.has(a.name)) throw new Error(`${where}.name is listed twice`);
    seen.add(a.name);
    if (!PLATFORM_IDS.includes(a.platform as PlatformId)) throw new Error(`${where}.platform is not a known platform`);
    if (typeof a.arch !== 'string' || !/^[a-z0-9_]{1,16}$/.test(a.arch)) throw new Error(`${where}.arch is invalid`);
    if (typeof a.kind !== 'string' || !/^[a-z0-9-]{1,48}$/.test(a.kind)) throw new Error(`${where}.kind is invalid`);
    if (typeof a.sha256 !== 'string' || !HEX64.test(a.sha256)) throw new Error(`${where}.sha256 must be 64 hex characters`);
    if (typeof a.size !== 'number' || !Number.isInteger(a.size) || a.size <= 0) throw new Error(`${where}.size must be a positive integer`);
    if (a.signing !== 'unsigned' && a.signing !== 'signed') throw new Error(`${where}.signing must be unsigned or signed`);
    return { name: a.name, platform: a.platform as PlatformId, arch: a.arch, kind: a.kind, sha256: a.sha256, size: a.size, signing: a.signing };
  });
  return { schema: 1, version: m.version, channel: m.channel, commit: m.commit, builtAt: m.builtAt, artifacts };
}

/** SHA-256 of a file on disk, hex. Used both to write the manifest and to verify a download against it. */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

/** True only when the file's hash equals the manifest entry's. A mismatch means do not install it. */
export async function verifyArtifact(file: string, artifact: Pick<ManifestArtifact, 'sha256'>): Promise<boolean> {
  return (await sha256File(file)) === artifact.sha256;
}
