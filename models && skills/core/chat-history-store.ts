/**
 * Chat History Store — persists AI Chat and Chat Group threads to disk so a
 * new conversation can be matched against past ones ("this looks like your
 * earlier chat about X — continue there?").
 *
 * Deliberately not RAM-only: unlike the chat-groups access password (which
 * only ever needs to live for one tab's session), a similarity match is
 * useless if history vanishes on reload. Incognito mode (the caller simply
 * not calling save()/search() for that session) is how a RAM-only
 * conversation opts back out -- this store itself always persists whatever
 * it's given.
 *
 * Layout on disk: `<rootDir>/<threadId>.json`, one file per thread. Follows
 * extension_system/store.ts's id-sanitization convention (single path
 * segment only, no traversal).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ChatOrganizer, type ChatGroupRecord } from "./chat-organizer.js";

export type ChatSource = "chat" | "chat-group";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatThread {
  id: string;
  source: ChatSource;
  /** First user message, truncated -- used as the thread's display title. */
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatMatch {
  thread: ChatThread;
  score: number;
  /** The stored message that scored highest against the query, for display. */
  snippet: string;
}

const TITLE_MAX = 80;

function tokenize(text: string): string[] {
  return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
}

/** Token-overlap similarity, [0,1] -- same convention as net-search.ts's cosineTokens. */
function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let overlap = 0;
  for (const t of new Set(a)) if (setB.has(t)) overlap++;
  return overlap / Math.sqrt(a.length * b.length);
}

export class ChatHistoryStore {
  private readonly rootDir: string;
  private readonly organizer: ChatOrganizer;

  constructor(rootDir?: string, organizer?: ChatOrganizer) {
    this.rootDir = rootDir ?? join(homedir(), ".neuroclaw", "chat-history");
    this.organizer = organizer ?? new ChatOrganizer();
  }

  private assertSafeId(id: string): void {
    if (!id || id === "." || id === ".." || id.includes("/") || id.includes("\\")) {
      throw new Error(`Invalid thread id "${id}": must not contain path separators or be "." / ".."`);
    }
  }

  private path(id: string): string {
    this.assertSafeId(id);
    return join(this.rootDir, `${id}.json`);
  }

  private ensureDir(): void {
    if (!existsSync(this.rootDir)) mkdirSync(this.rootDir, { recursive: true });
  }

  loadThread(id: string): ChatThread | null {
    const p = this.path(id);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as ChatThread;
    } catch {
      return null;
    }
  }

  listThreads(): ChatThread[] {
    if (!existsSync(this.rootDir)) return [];
    const threads: ChatThread[] = [];
    for (const entry of readdirSync(this.rootDir)) {
      if (!entry.endsWith(".json")) continue;
      try {
        threads.push(JSON.parse(readFileSync(join(this.rootDir, entry), "utf8")) as ChatThread);
      } catch {
        // Skip a corrupted/partial file rather than failing the whole listing.
      }
    }
    return threads;
  }

  deleteThread(id: string): boolean {
    const p = this.path(id);
    if (!existsSync(p)) return false;
    unlinkSync(p);
    this.organizer.removeThread(id);
    return true;
  }

  /**
   * Append a message, creating a new thread if `threadId` is omitted or
   * unknown. Returns the updated thread. Every save automatically files the
   * thread into a topic group via ChatOrganizer -- callers never have to
   * organize a chat themselves.
   */
  appendMessage(message: ChatMessage, source: ChatSource, threadId?: string): ChatThread {
    this.ensureDir();
    const existing = threadId ? this.loadThread(threadId) : null;
    const now = Date.now();
    const thread: ChatThread = existing ?? {
      id: threadId ?? randomUUID(),
      source,
      title: message.role === "user" ? message.content.slice(0, TITLE_MAX) : "(untitled)",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    thread.messages.push(message);
    thread.updatedAt = now;
    writeFileSync(this.path(thread.id), JSON.stringify(thread), "utf8");
    this.organizer.assign(thread);
    return thread;
  }

  /** Every persisted group, most recently active first. */
  listGroups(): ChatGroupRecord[] {
    return this.organizer.listGroups();
  }

  /** The group a given thread was automatically filed into, if any. */
  groupForThread(threadId: string): ChatGroupRecord | undefined {
    return this.organizer.getGroupForThread(threadId);
  }

  /**
   * Every group with its member threads resolved to lightweight summaries
   * (id/title/source/updatedAt), for a history sidebar/page -- the full
   * message bodies stay behind loadThread()/threads/:id so this stays cheap
   * even with a lot of history.
   */
  listGroupsWithThreads(): Array<ChatGroupRecord & { threads: Array<{ id: string; title: string; source: ChatSource; updatedAt: number }> }> {
    const threadsById = new Map(this.listThreads().map((t) => [t.id, t]));
    return this.listGroups().map((group) => ({
      ...group,
      threads: group.threadIds
        .map((id) => threadsById.get(id))
        .filter((t): t is ChatThread => !!t)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((t) => ({ id: t.id, title: t.title, source: t.source, updatedAt: t.updatedAt })),
    }));
  }

  /**
   * Token-overlap search across every stored thread's full message content.
   * `excludeId` skips the thread currently being written to (matching it
   * against itself is meaningless). Returns matches sorted by score
   * descending, above a floor that filters out near-zero incidental overlap.
   */
  search(query: string, opts: { excludeId?: string; limit?: number; source?: ChatSource } = {}): ChatMatch[] {
    const q = tokenize(query);
    if (q.length === 0) return [];
    const limit = opts.limit ?? 5;
    const results: ChatMatch[] = [];
    for (const thread of this.listThreads()) {
      if (thread.id === opts.excludeId) continue;
      if (opts.source && thread.source !== opts.source) continue;
      let best = { score: 0, snippet: "" };
      for (const m of thread.messages) {
        const score = tokenOverlap(q, tokenize(m.content));
        if (score > best.score) best = { score, snippet: m.content.slice(0, 200) };
      }
      if (best.score > 0.15) results.push({ thread, score: best.score, snippet: best.snippet });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
