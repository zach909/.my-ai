/**
 * "Delete all memory and chats" — the one button that has to actually mean
 * all of it.
 *
 * The failure worth guarding against is not a crash. It is a delete that
 * quietly keeps something: a pinned memory, a chat group still pointing at
 * threads that no longer exist, a room directory left on disk with its
 * messages in it. Someone who asks for all of it to go and is told it went
 * has no way to check.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LongTermMemory } from '../../models && skills/core/long-term-memory';
import { ChatHistoryStore } from '../../models && skills/core/chat-history-store';
import { SharedChatStore } from '../../models && skills/core/shared-chat-store';

describe('deleting everything', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'neuroclaw-wipe-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('forgets pinned memories too', () => {
    const memory = new LongTermMemory();
    memory.remember('ordinary', { tags: ['a'] });
    memory.remember('installed knowledge', { tags: ['skill'], pinned: true });
    expect(memory.size()).toBe(2);

    const forgotten = memory.forgetAll();

    // Pinned means exempt from EVICTION -- the store pushing something out on
    // its own. It does not mean exempt from being asked to forget.
    expect(forgotten).toBe(2);
    expect(memory.size()).toBe(0);
    expect(memory.evictableCount()).toBe(0);
  });

  it('leaves nothing behind to search', () => {
    const memory = new LongTermMemory();
    memory.remember('the thing I said', { tags: ['chat'] });
    memory.forgetAll();
    expect(memory.retrieve('thing')).toHaveLength(0);
    expect(memory.all()).toHaveLength(0);
  });

  it('deletes every chat thread and the groups they were filed into', () => {
    const store = new ChatHistoryStore(dir);
    store.appendMessage({ role: 'user', content: 'about neural networks', time: Date.now() }, 'chat');
    store.appendMessage({ role: 'user', content: 'about something else entirely', time: Date.now() }, 'chat');
    expect(store.listThreads()).toHaveLength(2);

    const deleted = store.deleteAllThreads();

    expect(deleted).toBe(2);
    expect(store.listThreads()).toHaveLength(0);
    // A group still naming threads that are gone is a half-delete.
    for (const group of store.listGroups()) {
      expect(group.threadIds).toHaveLength(0);
    }
  });

  it('deletes every chat room, and the messages in them', () => {
    const store = new SharedChatStore(dir);
    const general = store.ensureRoom('General');
    const other = store.ensureRoom('Wave Theory');
    store.post(general.id, 'someone', 'hello');
    store.post(other.id, 'someone else', 'a wave is a wave');

    const deleted = store.deleteAllRooms();

    expect(deleted).toBe(2);
    expect(store.listRooms().filter(r => r.lastMessageAt !== null)).toHaveLength(0);
    // Not just delisted -- the messages are off the disk.
    const roomsDir = join(dir, 'rooms');
    if (existsSync(roomsDir)) expect(readdirSync(roomsDir)).toHaveLength(0);
  });

  it('brings General back empty rather than keeping the old one', () => {
    const store = new SharedChatStore(dir);
    const general = store.ensureRoom('General');
    store.post(general.id, 'someone', 'this should not survive');
    store.deleteAllRooms();

    const fresh = store.ensureRoom('General');
    expect(store.list(fresh.id)).toHaveLength(0);
  });
});
