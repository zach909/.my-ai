/**
 * "your chats and pinned chats" -- pinning a thread so it survives outside
 * ChatHistoryPanel's normal recency view and shows up on its own
 * /app/pinned-chats nav entry (GET /api/chat-history/threads?pinned=true,
 * POST /api/chat-history/threads/:id/pin -- both in interface/web-server.ts).
 * This covers the storage layer those routes are thin wrappers over.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChatHistoryStore } from "../../models && skills/core/chat-history-store.js";

describe("ChatHistoryStore.setPinned", () => {
  let tmp: string;
  let store: ChatHistoryStore;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "chat-history-pin-"));
    store = new ChatHistoryStore(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null for a thread that doesn't exist", () => {
    expect(store.setPinned("nope", true)).toBeNull();
  });

  it("pins a thread and persists it across a fresh load", () => {
    const thread = store.appendMessage({ role: "user", content: "hello", timestamp: Date.now() }, "chat");
    expect(thread.pinned).toBeUndefined();

    const pinned = store.setPinned(thread.id, true);
    expect(pinned?.pinned).toBe(true);

    // A fresh instance reading the same directory -- proves this wrote to
    // disk, not just an in-memory object.
    const reloaded = new ChatHistoryStore(tmp).loadThread(thread.id);
    expect(reloaded?.pinned).toBe(true);
  });

  it("unpins a previously pinned thread", () => {
    const thread = store.appendMessage({ role: "user", content: "hello", timestamp: Date.now() }, "chat");
    store.setPinned(thread.id, true);
    const unpinned = store.setPinned(thread.id, false);
    expect(unpinned?.pinned).toBe(false);
  });

  it("pinning does not change updatedAt -- pinning something shouldn't also bump it to the top of a recency-sorted list", () => {
    const thread = store.appendMessage({ role: "user", content: "hello", timestamp: Date.now() }, "chat");
    const before = thread.updatedAt;
    const pinned = store.setPinned(thread.id, true);
    expect(pinned?.updatedAt).toBe(before);
  });

  it("leaves messages and title untouched", () => {
    const thread = store.appendMessage({ role: "user", content: "hello there", timestamp: Date.now() }, "chat");
    const pinned = store.setPinned(thread.id, true);
    expect(pinned?.title).toBe(thread.title);
    expect(pinned?.messages).toEqual(thread.messages);
  });
});

describe("ChatHistoryStore.listGroupsWithThreads -- pinned flows through to grouped summaries too", () => {
  let tmp: string;
  let store: ChatHistoryStore;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "chat-history-pin-groups-"));
    store = new ChatHistoryStore(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("a grouped thread's summary reflects its pinned state", () => {
    const thread = store.appendMessage({ role: "user", content: "some distinctive topic words here", timestamp: Date.now() }, "chat");
    store.setPinned(thread.id, true);

    const groups = store.listGroupsWithThreads();
    const summary = groups.flatMap((g) => g.threads).find((t) => t.id === thread.id);
    expect(summary?.pinned).toBe(true);
  });
});
