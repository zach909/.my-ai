/**
 * A stand-in for node:path on the phone. Same reasoning as fs-shim.ts: the
 * only callers reached from mobile/brain/src/index.ts are gated on a file
 * path the phone never sets, so these never actually run there -- they
 * exist so the module graph resolves at bundle time.
 */
function join(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? (i === 0 ? "/" : ".") : p.slice(0, i);
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

const path = { join, dirname, basename };
export default path;
export { join, dirname, basename };
