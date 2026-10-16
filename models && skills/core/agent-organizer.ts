/**
 * The agent names the chat groups.
 *
 * chat-organizer.ts files every chat into a group the moment it is saved, from
 * the words in the chats alone. That is instant and always works, but its
 * names are just the commonest words ("deploy, server, docker"). This asks the
 * agent to read what a group is actually about and give it a proper topic
 * name, and the agent's name is what people see once it has one.
 *
 * The agent never replaces the filing, only the label:
 *   - Chats are still filed by the organizer, synchronously, with no agent.
 *   - The agent's title is stored beside the keyword name, not over it, so it
 *     survives every later save (ChatGroupRecord.title).
 *   - A reply that cannot be read as a short name changes nothing; the keyword
 *     name stays, and the group is not asked again until it changes or the
 *     gap passes. A slow or silent agent can never leave a chat unfiled.
 *   - Each pass names at most `limit` groups, because every one is a trip
 *     through the same mesh the chats are using.
 */

import type { ChatHistoryStore } from "./chat-history-store.js";
import { parseFolderReply, type Think } from "./projects.js";

export const DEFAULT_TITLE_GAP_MS = 10 * 60 * 1000;
const THREADS_SHOWN = 5;
const THREAD_CHARS = 100;

export interface TitleOptions {
  /** Most groups to name in one pass. */
  limit?: number;
  /** Least time before the same group is asked about again. */
  minGapMs?: number;
  now?: () => number;
}

export function titlePrompt(threadTitles: string[]): string {
  return (
    "These chats belong together. Give them one short topic name of two to four words.\n" +
    "Chats:\n" +
    threadTitles.map((t) => `- ${t}`).join("\n") +
    "\nReply with the name only."
  );
}

/** Names the groups that need it. Never throws. */
export async function titleGroupsWithAgent(store: ChatHistoryStore, think: Think, opts: TitleOptions = {}): Promise<{ asked: number; titled: number }> {
  const now = opts.now ?? Date.now;
  const due = store.groupsNeedingTitle(opts.minGapMs ?? DEFAULT_TITLE_GAP_MS, now()).slice(0, opts.limit ?? 2);
  let titled = 0;
  for (const group of due) {
    const titles = group.threadIds
      .map((id) => store.loadThread(id)?.title)
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .slice(0, THREADS_SHOWN)
      .map((t) => t.replace(/\s+/g, " ").slice(0, THREAD_CHARS));
    if (titles.length === 0) continue;
    let reply = "";
    try {
      reply = await think(titlePrompt(titles));
    } catch {
      reply = "";
    }
    const name = parseFolderReply(reply);
    if (store.setGroupTitle(group.id, name, now())) {
      if (name) titled++;
    }
  }
  return { asked: due.length, titled };
}
