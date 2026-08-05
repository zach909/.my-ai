/**
 * Chat Organizer -- automatically files every chat/chat-group thread into a
 * topic group as it's saved. "Chat groups" here means folders that organize
 * AI Chat / Chat Group *history threads* by what they're about; it is
 * deliberately a different thing from:
 *   - chat-group.ts's ChatGroup (hive-mind agents collaborating on one task,
 *     Spec Section 14) -- that's a live collaboration session, not a folder.
 *   - PromptLibrary / prompting skills -- a saved, reusable prompt template.
 * "Chat groups is just a feature" (organizing history) is exactly what this
 * file does and nothing more: no hardcoded category list, no keyword
 * dictionary shipped ahead of time. Every group name and membership is
 * derived purely from the tokens that actually appear in the threads
 * themselves, discovered incrementally as threads are saved.
 *
 * Grouping happens automatically -- ChatHistoryStore calls assign() itself on
 * every appendMessage()/deleteThread(), so nothing else has to remember to
 * organize a chat; it is filed the moment it's written.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChatThread } from "./chat-history-store.js";

export interface ChatGroupRecord {
  id: string;
  /** Derived from the group's most distinctive shared tokens -- never hand-picked. */
  name: string;
  /** Ranked tokens this group's membership was matched against, most distinctive first. */
  keywords: string[];
  threadIds: string[];
  createdAt: number;
  updatedAt: number;
}

interface OrganizerIndex {
  groups: ChatGroupRecord[];
  /** threadId -> groupId, so a thread that keeps growing stays in the group it was first filed under. */
  threadGroup: Record<string, string>;
}

// A small, generic stopword list -- filtering these out is what lets the
// remaining tokens actually be distinctive per topic instead of every group
// converging on the same handful of filler words.
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "for", "and", "or", "but", "with", "at", "by",
  "this", "that", "these", "those", "it", "its", "as", "if", "then",
  "so", "do", "does", "did", "can", "could", "will", "would", "should",
  "have", "has", "had", "not", "no", "yes", "you", "your", "i", "me",
  "my", "we", "our", "us", "what", "how", "why", "when", "where", "who",
  "which", "please", "thanks", "thank", "hi", "hello", "just", "like",
  "get", "got", "want", "need", "make", "made", "about", "into", "out",
]);

const NEW_GROUP_THRESHOLD = 0.18;
const KEYWORDS_PER_GROUP = 8;
const KEYWORDS_FOR_NAME = 3;

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Ranked distinctive tokens across a thread's full message content, most frequent first. */
function threadKeywords(thread: ChatThread, topN: number): string[] {
  const counts = new Map<string, number>();
  for (const m of thread.messages) {
    for (const t of tokenize(m.content)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([t]) => t);
}

/** Overlap similarity between two keyword sets, [0,1] -- same convention as chat-history-store.ts's tokenOverlap. */
function keywordOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let overlap = 0;
  for (const t of new Set(a)) if (setB.has(t)) overlap++;
  return overlap / Math.sqrt(a.length * b.length);
}

export class ChatOrganizer {
  private readonly indexPath: string;

  constructor(indexPath?: string) {
    this.indexPath = indexPath ?? join(homedir(), ".neuroclaw", "chat-groups-index.json");
  }

  private load(): OrganizerIndex {
    if (!existsSync(this.indexPath)) return { groups: [], threadGroup: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, "utf8")) as OrganizerIndex;
      return {
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        threadGroup: parsed.threadGroup && typeof parsed.threadGroup === "object" ? parsed.threadGroup : {},
      };
    } catch {
      return { groups: [], threadGroup: {} };
    }
  }

  private persist(index: OrganizerIndex): void {
    const dir = join(homedir(), ".neuroclaw");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.indexPath, JSON.stringify(index), "utf8");
  }

  private nameFrom(keywords: string[]): string {
    return keywords.slice(0, KEYWORDS_FOR_NAME).join(", ") || "General";
  }

  /**
   * File a thread into a group: refreshes the existing group if the thread
   * was already assigned (so it doesn't hop groups as it grows), otherwise
   * matches it against every existing group's keyword profile and either
   * joins the best match or creates a brand-new group from its own
   * keywords. Always called automatically on save -- never a manual step.
   */
  assign(thread: ChatThread): ChatGroupRecord {
    const index = this.load();
    const now = Date.now();
    const keywords = threadKeywords(thread, KEYWORDS_PER_GROUP);
    const existingGroupId = index.threadGroup[thread.id];

    if (existingGroupId) {
      const group = index.groups.find((g) => g.id === existingGroupId);
      if (group) {
        // Merge in any newly-surfaced keywords as the thread's content grows,
        // re-ranking by combined frequency so the group's profile stays live.
        const merged = new Map<string, number>();
        group.keywords.forEach((k, i) => merged.set(k, group.keywords.length - i));
        keywords.forEach((k, i) => merged.set(k, (merged.get(k) ?? 0) + (keywords.length - i)));
        group.keywords = Array.from(merged.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, KEYWORDS_PER_GROUP)
          .map(([k]) => k);
        group.name = this.nameFrom(group.keywords);
        if (!group.threadIds.includes(thread.id)) group.threadIds.push(thread.id);
        group.updatedAt = now;
        this.persist(index);
        return group;
      }
      // Index drifted (group deleted out from under it) -- fall through and refile.
    }

    let best: { group: ChatGroupRecord; score: number } | null = null;
    for (const group of index.groups) {
      const score = keywordOverlap(keywords, group.keywords);
      if (!best || score > best.score) best = { group, score };
    }

    let group: ChatGroupRecord;
    if (best && best.score >= NEW_GROUP_THRESHOLD) {
      group = best.group;
      const merged = new Map<string, number>();
      group.keywords.forEach((k, i) => merged.set(k, group.keywords.length - i));
      keywords.forEach((k, i) => merged.set(k, (merged.get(k) ?? 0) + (keywords.length - i)));
      group.keywords = Array.from(merged.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, KEYWORDS_PER_GROUP)
        .map(([k]) => k);
      group.name = this.nameFrom(group.keywords);
      group.updatedAt = now;
    } else {
      group = {
        id: randomUUID(),
        name: this.nameFrom(keywords),
        keywords,
        threadIds: [],
        createdAt: now,
        updatedAt: now,
      };
      index.groups.push(group);
    }
    if (!group.threadIds.includes(thread.id)) group.threadIds.push(thread.id);
    index.threadGroup[thread.id] = group.id;
    this.persist(index);
    return group;
  }

  /** Drop a thread from whatever group it's in; deletes the group too if that was its last member. */
  removeThread(threadId: string): void {
    const index = this.load();
    const groupId = index.threadGroup[threadId];
    if (!groupId) return;
    delete index.threadGroup[threadId];
    const group = index.groups.find((g) => g.id === groupId);
    if (group) {
      group.threadIds = group.threadIds.filter((id) => id !== threadId);
      if (group.threadIds.length === 0) {
        index.groups = index.groups.filter((g) => g.id !== groupId);
      }
    }
    this.persist(index);
  }

  listGroups(): ChatGroupRecord[] {
    return this.load().groups.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getGroupForThread(threadId: string): ChatGroupRecord | undefined {
    const index = this.load();
    const groupId = index.threadGroup[threadId];
    return groupId ? index.groups.find((g) => g.id === groupId) : undefined;
  }
}
