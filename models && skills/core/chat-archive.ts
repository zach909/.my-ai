/**
 * Take your chats with you: all of them in one zip, and a way to bring them
 * back after resetting a machine.
 *
 * The zip holds `manifest.json` and one `threads/<id>.json` per conversation,
 * which is the same JSON the store keeps on disk. Importing is careful because
 * the file is whatever someone hands over:
 *
 *   - every thread is rebuilt field by field from its checked parts, so
 *     unknown keys in the file never reach the store;
 *   - a thread whose id is already here is skipped, never overwritten, so
 *     importing the same zip twice (or into a machine that kept some chats)
 *     changes nothing the second time;
 *   - names inside the zip are only read to find threads; nothing is ever
 *     written to a path taken from the zip.
 *
 * Imported chats are filed into groups like any other. They are NOT replayed
 * into the mesh: they are old conversations being kept, not new teaching.
 */

import type { ChatHistoryStore, ChatMessage, ChatSource, ChatThread } from "./chat-history-store.js";
import { ZipError, readZip, writeZip, type ZipEntry } from "./zip-archive.js";

export const FORMAT = "neuroclaw-chats";
export const MAX_THREADS = 5000;
const MAX_MESSAGES = 5000;
const MAX_CONTENT = 200_000;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface ImportResult {
  added: number;
  /** Already here, so left alone. */
  skipped: number;
  /** In the zip but not a chat this store would accept. */
  invalid: number;
}

/** Every chat of the current store, as a zip. */
export function exportChats(store: ChatHistoryStore, now = new Date()): Buffer {
  const threads = store.listThreads().filter(t => t && typeof t.id === "string" && ID_RE.test(t.id)).slice(0, MAX_THREADS);
  const entries: ZipEntry[] = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify({ format: FORMAT, version: 1, exportedAt: now.toISOString(), threads: threads.length }, null, 2)) },
    ...threads.map(t => ({ name: `threads/${t.id}.json`, data: Buffer.from(JSON.stringify(t)) })),
  ];
  return writeZip(entries, now);
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A thread rebuilt from checked parts, or null if the file's version of it is not acceptable. */
function cleanThread(raw: unknown): ChatThread | null {
  const t = raw as Partial<ChatThread> | null;
  if (!t || typeof t !== "object") return null;
  if (typeof t.id !== "string" || !ID_RE.test(t.id)) return null;
  const source: ChatSource = t.source === "chat-group" ? "chat-group" : "chat";
  if (!Array.isArray(t.messages) || t.messages.length > MAX_MESSAGES) return null;
  const messages: ChatMessage[] = [];
  for (const m of t.messages as Array<Partial<ChatMessage>>) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || m.content.length > MAX_CONTENT) return null;
    messages.push({ role: m.role, content: m.content, timestamp: finite(m.timestamp) ? m.timestamp : 0 });
  }
  const createdAt = finite(t.createdAt) ? t.createdAt : 0;
  const clean: ChatThread = {
    id: t.id,
    source,
    title: typeof t.title === "string" ? t.title.slice(0, 200) : "(untitled)",
    messages,
    createdAt,
    updatedAt: finite(t.updatedAt) ? t.updatedAt : createdAt,
  };
  if (t.pinned === true) clean.pinned = true;
  return clean;
}

/** Bring the chats in a zip back. Throws ZipError if the file is not a zip of ours. */
export function importChats(store: ChatHistoryStore, zip: Buffer): ImportResult {
  const entries = readZip(zip);
  const manifest = entries.find(e => e.name === "manifest.json");
  let ok = false;
  try {
    ok = manifest !== undefined && (JSON.parse(manifest.data.toString("utf8")) as { format?: unknown }).format === FORMAT;
  } catch {
    ok = false;
  }
  if (!ok) throw new ZipError("That zip is not a NeuroClaw chat export.");

  const result: ImportResult = { added: 0, skipped: 0, invalid: 0 };
  let seen = 0;
  for (const e of entries) {
    if (!/^threads\/[^/]+\.json$/.test(e.name)) continue;
    if (++seen > MAX_THREADS) { result.invalid++; continue; }
    let thread: ChatThread | null = null;
    try {
      thread = cleanThread(JSON.parse(e.data.toString("utf8")));
    } catch {
      thread = null;
    }
    if (!thread) { result.invalid++; continue; }
    if (store.importThread(thread)) result.added++;
    else result.skipped++;
  }
  return result;
}
