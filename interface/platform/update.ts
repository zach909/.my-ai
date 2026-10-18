/**
 * "Is there a newer version of the app?" -- the in-app update status.
 *
 * This is about the packaged application, not the git checkout (that is
 * models && skills/core/auto-update.ts, which stays as it is for source
 * users). It only reports. It never downloads or installs anything: a signed
 * installer must not be replaced behind the user's back, so the result carries
 * the artifact, its SHA-256 and a link, and the person chooses.
 *
 * Four outcomes, never a silent one:
 *   current       this build is at or ahead of the newest release on its channel
 *   available     a newer release exists (with the right file for this machine)
 *   failed        the check itself could not complete (offline, bad manifest...)
 *   unconfigured  no manifest address is set, so nothing was checked
 */
import { compareVersions, parseSemver, type Channel } from './version.js';
import { validateManifest, type ManifestArtifact, type ReleaseManifest } from './release-manifest.js';
import type { PlatformId } from './adapters.js';

export const DEFAULT_MANIFEST_URL = 'https://github.com/zach909/.my-ai/releases/latest/download/release-manifest.json';
const MAX_MANIFEST_BYTES = 256 * 1024;
const TIMEOUT_MS = 8000;

export type UpdateState = 'current' | 'available' | 'failed' | 'unconfigured';

export interface UpdateStatus {
  state: UpdateState;
  current: string;
  latest: string | null;
  channel: Channel;
  message: string;
  artifact: ManifestArtifact | null;
  commit: string | null;
  checkedAt: string;
}

export interface UpdateQuery {
  current: string;
  channel: Channel;
  platform: PlatformId;
  arch: string;
  /** http(s) address of release-manifest.json, or '' to skip the check. */
  manifestUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/** Only https, or plain http to this machine (so a local test server or a LAN mirror on localhost works). */
export function isAcceptableManifestUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]');
  } catch {
    return false;
  }
}

/** The file for this machine: exact platform + arch, else an "any" build for the platform. */
export function pickArtifact(manifest: ReleaseManifest, platform: PlatformId, arch: string): ManifestArtifact | null {
  const mine = manifest.artifacts.filter((a) => a.platform === platform);
  return mine.find((a) => a.arch === arch) ?? mine.find((a) => a.arch === 'any') ?? null;
}

/** Decide the status from an already-validated manifest. Pure: no network, no clock besides `checkedAt`. */
export function evaluateManifest(manifest: ReleaseManifest, q: Pick<UpdateQuery, 'current' | 'channel' | 'platform' | 'arch'>, checkedAt: string): UpdateStatus {
  const base = { current: q.current, channel: q.channel, checkedAt };
  if (!parseSemver(q.current)) {
    return { ...base, state: 'failed', latest: manifest.version, message: `This build's version (${q.current}) is not a valid version number, so it cannot be compared.`, artifact: null, commit: manifest.commit };
  }
  // A stable install never offers a beta, and a beta install is offered stable releases too.
  if (manifest.channel === 'beta' && q.channel === 'stable') {
    return { ...base, state: 'current', latest: null, message: 'The newest release found is a beta; you are on the stable channel, so nothing is offered.', artifact: null, commit: manifest.commit };
  }
  const cmp = compareVersions(manifest.version, q.current);
  if (cmp === null || cmp <= 0) {
    return { ...base, state: 'current', latest: manifest.version, message: `You have the newest version (${q.current}).`, artifact: null, commit: manifest.commit };
  }
  const artifact = pickArtifact(manifest, q.platform, q.arch);
  if (!artifact) {
    return { ...base, state: 'failed', latest: manifest.version, message: `Version ${manifest.version} exists, but this release has no ${q.platform}/${q.arch} build yet. It may still be building or that build failed.`, artifact: null, commit: manifest.commit };
  }
  const how = artifact.signing === 'unsigned' ? ' This file is not code-signed; your system may warn before opening it.' : '';
  return { ...base, state: 'available', latest: manifest.version, message: `Version ${manifest.version} is available (you have ${q.current}).${how}`, artifact, commit: manifest.commit };
}

export async function checkAppUpdate(q: UpdateQuery): Promise<UpdateStatus> {
  const checkedAt = (q.now ? q.now() : new Date()).toISOString();
  const base = { current: q.current, channel: q.channel, checkedAt, latest: null, artifact: null, commit: null };
  if (!q.manifestUrl) {
    return { ...base, state: 'unconfigured', message: 'No update address is set, so no check was made.' };
  }
  if (!isAcceptableManifestUrl(q.manifestUrl)) {
    return { ...base, state: 'failed', message: 'The update address must start with https:// (or be a local http:// address).' };
  }
  const doFetch = q.fetchImpl ?? fetch;
  try {
    const res = await doFetch(q.manifestUrl, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' }, redirect: 'follow' });
    if (!res.ok) {
      return { ...base, state: 'failed', message: res.status === 404 ? 'No release has been published at the update address yet.' : `The update server answered ${res.status}.` };
    }
    const text = await res.text();
    if (text.length > MAX_MANIFEST_BYTES) return { ...base, state: 'failed', message: 'The release manifest is unreasonably large, so it was ignored.' };
    let manifest: ReleaseManifest;
    try {
      manifest = validateManifest(JSON.parse(text));
    } catch (e) {
      return { ...base, state: 'failed', message: `The release manifest is not valid: ${e instanceof Error ? e.message : String(e)}` };
    }
    return evaluateManifest(manifest, q, checkedAt);
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ...base, state: 'failed', message: timedOut ? 'The update server did not answer in time. Check your connection and try again.' : `Could not reach the update server: ${e instanceof Error ? e.message : String(e)}` };
  }
}
