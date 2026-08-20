/**
 * Shared Chat Store — one chat room that every human who can reach this
 * server sees and can post into (see interface/web-server.ts's
 * remoteAccessLock for who that is; this store has no access control of
 * its own), with the bot as one participant among others rather than the
 * exclusive other side of the conversation.
 *
 * This is deliberately different from chat-history-store.ts's AI Chat
 * threads (one thread per browser tab, always exactly one human talking to
 * exactly the bot) and from chat-group.ts's Chat Groups (multiple AI agent
 * *personas* collaborating with each other, no humans involved). Here the
 * participants are real people -- the room is one flat, shared log so
 * everyone who opens the page sees the same conversation, and the bot only
 * speaks when summoned (see web-server.ts's POST /api/shared-chat/ask) or
 * when it has something to publish, same as any other participant.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface SharedChatMessage {
  id: string;
  author: string;
  text: string;
  isBot: boolean;
  time: number;
}

export class SharedChatError extends Error {}

// Keeps the room from growing without bound -- oldest messages drop off
// first, same tradeoff wiki-store.ts and chat-history-store.ts don't need
// to make (those are one file per page/thread, this is one shared log).
const MAX_MESSAGES = 500;
const AUTHOR_MAX = 40;
const TEXT_MAX = 4000;

export class SharedChatStore {
  private readonly file: string;

  constructor(rootDir?: string) {
    const dir = rootDir ?? join(homedir(), ".neuroclaw", "shared-chat");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.file = join(dir, "messages.json");
  }

  private read(): SharedChatMessage[] {
    if (!existsSync(this.file)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private write(messages: SharedChatMessage[]): void {
    writeFileSync(this.file, JSON.stringify(messages, null, 2), "utf8");
  }

  /**
   * All messages, oldest first. Pass `since` (the id of the last message a
   * client already has) to get only what's newer than it -- what the
   * frontend's poll loop uses so it isn't re-fetching the whole room every
   * few seconds. An unrecognized `since` (the room was pruned past it, or
   * it's just wrong) falls back to returning everything rather than
   * silently returning nothing.
   */
  list(since?: string): SharedChatMessage[] {
    const messages = this.read();
    if (!since) return messages;
    const index = messages.findIndex((m) => m.id === since);
    return index === -1 ? messages : messages.slice(index + 1);
  }

  post(author: string, text: string, isBot = false): SharedChatMessage {
    const trimmedAuthor = author.trim().slice(0, AUTHOR_MAX);
    const trimmedText = text.trim();
    if (!trimmedAuthor) {
      throw new SharedChatError("A display name is required to post.");
    }
    if (!trimmedText) {
      throw new SharedChatError("Message can't be empty.");
    }
    const message: SharedChatMessage = {
      id: randomUUID(),
      author: trimmedAuthor,
      text: trimmedText.slice(0, TEXT_MAX),
      isBot,
      time: Date.now(),
    };
    const messages = this.read();
    messages.push(message);
    if (messages.length > MAX_MESSAGES) {
      messages.splice(0, messages.length - MAX_MESSAGES);
    }
    this.write(messages);
    return message;
  }
}

let sharedInstance: SharedChatStore | null = null;
/** One store per process, same convention as plugin_manager/registry.ts's default export instance. */
export function getSharedChatStore(): SharedChatStore {
  if (!sharedInstance) sharedInstance = new SharedChatStore();
  return sharedInstance;
}
