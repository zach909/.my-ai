/**
 * Writing a file so a power cut cannot leave it half-written.
 *
 * Every one of this project's 33 state writes was a plain writeFileSync, which
 * truncates the file and then writes it. Lose power between those two steps
 * and what remains is an empty or partial file.
 *
 * That is not theoretical, and the worst case is not the one you would guess.
 * Truncating a store manifest to half its length does not corrupt an item --
 * it makes the item DISAPPEAR. readItem parses the manifest, fails, and
 * returns null, so the item drops out of the catalogue completely while every
 * one of its payload files sits intact on disk beside it. The work is not lost
 * from the disk; it is lost from the only place anyone looks.
 *
 * The fix is the standard one, and the reason it works is worth stating
 * because it is easy to implement almost-correctly:
 *
 *   1. Write the new content to a temporary file IN THE SAME DIRECTORY.
 *      Same directory matters -- rename is only atomic within a filesystem,
 *      and /tmp is very often a different one.
 *   2. fsync it, so the bytes are on the device and not merely in the page
 *      cache. Without this the rename can land before the content does, and a
 *      crash leaves a name pointing at nothing.
 *   3. Rename it over the target. POSIX rename is atomic: any reader sees
 *      either the whole old file or the whole new one, never a mixture.
 *   4. fsync the directory, so the rename itself is durable.
 *
 * Step 4 is best-effort: it is not supported everywhere, and failing to make
 * a rename durable is much less bad than refusing to save at all.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import path from "node:path";

/**
 * Write a file atomically. A reader either sees the previous content or the
 * new content, never a partial write.
 */
/**
 * How long a temporary file may linger before it is assumed abandoned.
 *
 * SIGKILL and a real power cut both stop the process before any cleanup can
 * run, so temporaries WILL be left behind -- that is not a bug to fix, it is
 * the situation this whole file exists for. What matters is that they do not
 * accumulate forever. Generous enough that a slow write in progress is never
 * mistaken for wreckage.
 */
const STALE_TMP_MS = 60_000;

/**
 * Remove temporaries this directory is still carrying from an interrupted
 * write. Cheap: one readdir on a directory we are about to write to anyway.
 */
function sweepStaleTemporaries(dir: string): void {
  try {
    const now = Date.now();
    for (const entry of readdirSync(dir)) {
      if (!entry.startsWith(".") || !entry.endsWith(".tmp")) continue;
      const full = path.join(dir, entry);
      try {
        if (now - statSync(full).mtimeMs > STALE_TMP_MS) rmSync(full, { force: true });
      } catch {
        /* vanished under us, or not ours to remove */
      }
    }
  } catch {
    /* unreadable directory: the write below will report the real problem */
  }
}

export function writeFileAtomic(file: string, data: string | Buffer): void {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  sweepStaleTemporaries(dir);

  // Same directory as the target, and unique enough that two concurrent
  // writers cannot collide on the temporary name.
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;

  let fd: number | null = null;
  try {
    fd = openSync(tmp, "w");
    writeSync(fd, buf);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tmp, file);
  } catch (err) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
    // Never leave the temporary behind: a directory slowly filling with
    // .manifest.json.1234.tmp files is its own kind of failure, and the store
    // lists directories by name.
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* nothing more to do */
    }
    throw err;
  }

  // Make the rename itself durable. Best-effort: not supported on every
  // platform or filesystem, and a non-durable rename is far better than a
  // refused save.
  try {
    const dirFd = openSync(dir, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    /* directory fsync unavailable here */
  }
}

/** Convenience for the common case: pretty-printed JSON with a trailing newline. */
export function writeJsonAtomic(file: string, value: unknown): void {
  writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n");
}
