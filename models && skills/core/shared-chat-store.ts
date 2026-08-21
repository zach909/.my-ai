/**
 * Shared Chat Store — multiple named chat rooms every human who can reach
 * this server sees and can post into (see interface/web-server.ts's
 * remoteAccessLock for who that is; this store has no access control of
 * its own), with the bot as one participant among others in each rather
 * than the exclusive other side of the conversation.
 *
 * This is deliberately different from chat-history-store.ts's AI Chat
 * threads (one thread per browser tab, always exactly one human talking to
 * exactly the bot) and from chat-group.ts's Chat Groups (multiple AI agent
 * *personas* collaborating with each other, no humans involved). Here the
 * participants are real people -- each room is one flat, shared log so
 * everyone who opens it sees the same conversation, and the bot only
 * speaks when summoned (see web-server.ts's POST .../ask) or when it has
 * something to publish, same as any other participant.
 *
 * Originally one single room; a Bot Wiki page's "Discuss in Chat" now
 * opens (or creates) a room named after that page instead of dropping
 * everyone into one undifferentiated feed, and a "General" room always
 * exists for anything that isn't about a specific page.
 *
 * Layout on disk: <rootDir>/rooms.json (the room index: id/name/
 * createdAt/lastMessageAt) and <rootDir>/rooms/<id>/messages.json (one
 * room's message log) -- same directory-per-thing convention as
 * skill-upload-store.ts's extension-builder/extensions/<name>/.
 *
 * Deliberately homedir-relative, NOT under generated/ alongside skills/
 * plugins/prompts/wiki: those are static, self-authored artifacts meant
 * to be committed and published like any other repo change. This is live,
 * ephemeral conversation between real people talking to each other and to
 * the AI on one running server -- "it is just people talking", not a
 * generated artifact meant for git history. "Public" for chat means
 * "anyone who reaches this server sees the same room" (remoteAccessLock
 * still governs who that is), not "committed to GitHub".
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

export interface SharedChatRoom {
  id: string;
  name: string;
  createdAt: number;
  lastMessageAt: number | null;
}

export class SharedChatError extends Error {}

// Keeps a room from growing without bound -- oldest messages drop off
// first, same tradeoff wiki-store.ts and chat-history-store.ts don't need
// to make (those are one file per page/thread, this is one shared log
// per room).
const MAX_MESSAGES = 500;
const AUTHOR_MAX = 40;
const TEXT_MAX = 4000;
const ROOM_NAME_MAX = 60;
const GENERAL_ROOM_ID = "general";
const GENERAL_ROOM_NAME = "General";

/** Same intent as wiki-store.ts's/skill-upload-store.ts's SAFE_NAME -- a room id is only ever a path segment, never shown on its own (the room's `name` is what's displayed). */
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "room";
}

export class SharedChatStore {
  private readonly rootDir: string;
  private readonly roomsIndexFile: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? join(homedir(), ".neuroclaw", "shared-chat");
    if (!existsSync(this.rootDir)) mkdirSync(this.rootDir, { recursive: true });
    this.roomsIndexFile = join(this.rootDir, "rooms.json");
  }

  private roomDir(id: string): string {
    return join(this.rootDir, "rooms", id);
  }

  private messagesFile(id: string): string {
    return join(this.roomDir(id), "messages.json");
  }

  private readRoomsIndex(): SharedChatRoom[] {
    if (!existsSync(this.roomsIndexFile)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.roomsIndexFile, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private writeRoomsIndex(rooms: SharedChatRoom[]): void {
    writeFileSync(this.roomsIndexFile, JSON.stringify(rooms, null, 2), "utf8");
  }

  private readMessages(id: string): SharedChatMessage[] {
    const file = this.messagesFile(id);
    if (!existsSync(file)) return [];
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private writeMessages(id: string, messages: SharedChatMessage[]): void {
    writeFileSync(this.messagesFile(id), JSON.stringify(messages, null, 2), "utf8");
  }

  /** Every room, General first, then most-recently-active first -- what the room picker shows. */
  listRooms(): SharedChatRoom[] {
    this.ensureGeneralRoom();
    const rooms = this.readRoomsIndex();
    return [...rooms].sort((a, b) => {
      if (a.id === GENERAL_ROOM_ID) return -1;
      if (b.id === GENERAL_ROOM_ID) return 1;
      return (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt);
    });
  }

  private ensureGeneralRoom(): void {
    const rooms = this.readRoomsIndex();
    if (rooms.some((r) => r.id === GENERAL_ROOM_ID)) return;
    rooms.push({ id: GENERAL_ROOM_ID, name: GENERAL_ROOM_NAME, createdAt: Date.now(), lastMessageAt: null });
    this.writeRoomsIndex(rooms);
  }

  /**
   * Finds a room by name (case-insensitive) or creates one -- idempotent,
   * so a page's "Discuss in Chat" can call this every time without
   * spawning a fresh room per click. Room ids are slugified from the name
   * and de-duplicated with a numeric suffix on a genuine collision
   * (two different names that slugify the same way).
   */
  ensureRoom(name: string): SharedChatRoom {
    const trimmed = name.trim().slice(0, ROOM_NAME_MAX);
    if (!trimmed) {
      throw new SharedChatError("A room name is required.");
    }
    this.ensureGeneralRoom();
    const rooms = this.readRoomsIndex();
    const existing = rooms.find((r) => r.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    let id = slugify(trimmed);
    let suffix = 2;
    while (rooms.some((r) => r.id === id)) {
      id = `${slugify(trimmed)}-${suffix++}`;
    }
    const room: SharedChatRoom = { id, name: trimmed, createdAt: Date.now(), lastMessageAt: null };
    rooms.push(room);
    this.writeRoomsIndex(rooms);
    return room;
  }

  private requireRoom(id: string): SharedChatRoom {
    this.ensureGeneralRoom();
    const room = this.readRoomsIndex().find((r) => r.id === id);
    if (!room) {
      throw new SharedChatError(`No chat room "${id}".`);
    }
    return room;
  }

  /**
   * A room's messages, oldest first. Pass `since` (the id of the last
   * message a client already has) to get only what's newer than it --
   * what the frontend's poll loop uses so it isn't re-fetching the whole
   * room every few seconds. An unrecognized `since` (the room was pruned
   * past it, or it's just wrong) falls back to returning everything
   * rather than silently returning nothing.
   */
  list(roomId: string, since?: string): SharedChatMessage[] {
    this.requireRoom(roomId);
    const messages = this.readMessages(roomId);
    if (!since) return messages;
    const index = messages.findIndex((m) => m.id === since);
    return index === -1 ? messages : messages.slice(index + 1);
  }

  post(roomId: string, author: string, text: string, isBot = false): SharedChatMessage {
    const room = this.requireRoom(roomId);
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
    const dir = this.roomDir(roomId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const messages = this.readMessages(roomId);
    messages.push(message);
    if (messages.length > MAX_MESSAGES) {
      messages.splice(0, messages.length - MAX_MESSAGES);
    }
    this.writeMessages(roomId, messages);
    const rooms = this.readRoomsIndex();
    const idx = rooms.findIndex((r) => r.id === roomId);
    if (idx !== -1) {
      rooms[idx] = { ...room, lastMessageAt: message.time };
      this.writeRoomsIndex(rooms);
    }
    return message;
  }
}

let sharedInstance: SharedChatStore | null = null;
/** One store per process, same convention as plugin_manager/registry.ts's default export instance. */
export function getSharedChatStore(): SharedChatStore {
  if (!sharedInstance) sharedInstance = new SharedChatStore();
  return sharedInstance;
}
