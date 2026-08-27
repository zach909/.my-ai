/**
 * Put bytes into the archive that is going into the network.
 *
 * One path, used by everything that can produce a file: the attach button, the
 * recorder, and pasting. They were about to be three copies of the same fetch
 * with three slightly different error strings, which is how two of them
 * quietly stop matching the third.
 *
 * Uploading is not sending. This places the bytes in the archive and stops;
 * pushing that archive through the two input neurons costs one settle of the
 * mesh per BIT, so it happens once, later, for everything at once.
 */

/** Generous for a recording or a document, bounded so a mis-click cannot try to send a disc image. */
export const MAX_STAGED_BYTES = 25 * 1024 * 1024

export interface StagedFile {
  path: string
  bytes: number
  /** Ready to zip with the rest: { "prompt/name.ext": "<base64>" } */
  binary: Record<string, string>
}

export class StageError extends Error {}

/**
 * Upload one blob as a file and return where it landed.
 *
 * Throws StageError with something a person can act on -- "too large", "could
 * not reach" -- rather than returning null and leaving the caller to invent a
 * message for a failure it cannot describe.
 */
export async function stageFile(
  blob: Blob,
  name: string,
  folder = 'prompt/',
): Promise<StagedFile> {
  if (blob.size === 0) throw new StageError('That is empty — there is nothing to send in.')
  if (blob.size > MAX_STAGED_BYTES) {
    throw new StageError(
      `That is ${(blob.size / 1024 / 1024).toFixed(1)}MB. The doorway takes up to 25MB in one go.`,
    )
  }

  let res: Response
  try {
    // The body IS the file. No form encoding, no description of it.
    res = await fetch(`/api/zip-loop/file?path=${encodeURIComponent(`${folder}${name}`)}`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    })
  } catch {
    throw new StageError('Could not reach the local network.')
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new StageError(data?.error || `Could not attach the file (${res.status})`)
  return { path: data.path, bytes: data.bytes, binary: data.binary }
}

/**
 * A filename for something that arrived without one -- a recording, a paste.
 *
 * Timestamped rather than counted, so two of them in the same session cannot
 * collide and silently replace each other in the archive.
 */
export function generatedName(prefix: string, extension: string): string {
  return `${prefix}-${Date.now()}.${extension}`
}
