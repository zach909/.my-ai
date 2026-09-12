/**
 * Chat Attachments — lets a chat turn hand the browser a real file to
 * download, not just talk about one.
 *
 * "I wanted to instantly upload any files. I wanted to download those
 * files, not pull them as needed." Uploading is the chat page's own
 * staged-file mechanism (stage-file.ts); this is the other direction --
 * a file the AI's own reply points at gets downloaded to the browser the
 * moment that reply arrives, rather than sitting there as a path the user
 * has to separately go fetch.
 *
 * The chat pipeline (agent-capabilities.ts's callPlugin()/useBestTool())
 * only ever gets back PLAIN TEXT from a plugin's onMessage() -- there is
 * no field anywhere in that path for "also, here is a file." Rather than
 * widen that whole contract, a plugin (currently: FileSystemPlugin's
 * "send <path>" command) registers a file HERE and embeds the returned id
 * in its own text reply as a `[[ATTACH:<id>]]` marker; agent-capabilities.ts
 * strips that marker back out and resolves it into real attachment
 * metadata on the way to BotResponse. One small side-channel, not a
 * pipeline-wide type change.
 *
 * In-memory and short-lived on purpose: this is a handoff to a browser
 * that is (in the local-first case this app is built for) either running
 * on the same machine or on the same local network, expected to download
 * within seconds of the reply appearing, not a durable file host. A
 * restart forgets every pending attachment, which is correct -- nothing
 * durable was ever promised.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface ChatAttachment {
  id: string;
  filename: string;
  bytes: number;
}

interface Entry {
  absPath: string;
  filename: string;
  expiresAt: number;
}

const TTL_MS = 15 * 60 * 1000;
const registry = new Map<string, Entry>();

function sweep(): void {
  const now = Date.now();
  for (const [id, entry] of registry) {
    if (entry.expiresAt <= now) registry.delete(id);
  }
}

/**
 * Registers a file for one-time-window download. Returns null (never
 * throws) for a path that does not exist or is not a regular file --
 * same "report, don't crash the reply" convention as everything else on
 * this chat-response path, since a stale/mistyped path is the normal case
 * of someone asking for a file that moved, not a bug.
 */
export function registerAttachment(filePath: string): ChatAttachment | null {
  sweep();
  if (!existsSync(filePath)) return null;
  const stat = statSync(filePath);
  if (!stat.isFile()) return null;
  const id = randomUUID();
  registry.set(id, { absPath: filePath, filename: path.basename(filePath), expiresAt: Date.now() + TTL_MS });
  return { id, filename: path.basename(filePath), bytes: stat.size };
}

/** The absolute path a live attachment id points at, or null if it never existed, already expired, or the file has since been removed from disk. */
export function resolveAttachment(id: string): { absPath: string; filename: string } | null {
  sweep();
  const entry = registry.get(id);
  if (!entry) return null;
  if (!existsSync(entry.absPath)) return null;
  return { absPath: entry.absPath, filename: entry.filename };
}

/** Same lookup as resolveAttachment(), plus the current file size -- what agent-capabilities.ts needs to turn a bare `[[ATTACH:<id>]]` marker back into full ChatAttachment metadata for BotResponse. */
export function attachmentMetadata(id: string): ChatAttachment | null {
  const resolved = resolveAttachment(id);
  if (!resolved) return null;
  return { id, filename: resolved.filename, bytes: statSync(resolved.absPath).size };
}
