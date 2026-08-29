/**
 * Logging in from somewhere else.
 *
 * Two things are being tested and they pull in opposite directions: the chat
 * rooms have to be genuinely open (no password, no account, nothing), and
 * everything else has to stay shut. The route predicates are pure functions
 * precisely so the line between those two can be pinned down here without
 * standing up a server.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  RemoteAccessStore,
  RemoteAccessError,
  readCookie,
  MIN_PASSWORD_LENGTH,
} from '../../models && skills/core/remote-access';
import {
  isSharedChatPublicRoute,
  isAuthPublicRoute,
  isWikiPublicRoute,
  isStorePublicRoute,
} from '../../interface/web-server';

describe('the remote password', () => {
  let dir: string;
  let store: RemoteAccessStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'neuroclaw-remote-access-'));
    store = new RemoteAccessStore(join(dir, 'remote-access.json'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('starts unset, and an unset instance accepts nothing', async () => {
    expect(store.isSet()).toBe(false);
    // Not "accepts anything" -- an instance with no password refuses every
    // password rather than matching them all.
    expect(await store.check('anything')).toBe(false);
  });

  it('remembers a password across a restart', async () => {
    await store.set('correct horse battery', true);
    const restarted = new RemoteAccessStore(join(dir, 'remote-access.json'));
    expect(restarted.isSet()).toBe(true);
    expect(await restarted.check('correct horse battery')).toBe(true);
    expect(await restarted.check('correct horse batteri')).toBe(false);
  });

  it('never writes the password down', async () => {
    const file = join(dir, 'remote-access.json');
    await store.set('hunter2-hunter2', true);
    const raw = require('node:fs').readFileSync(file, 'utf8');
    expect(raw).not.toContain('hunter2');
    expect(JSON.parse(raw).hash).toBeTypeOf('string');
  });

  it('keeps the credential file to itself', async () => {
    const file = join(dir, 'remote-access.json');
    await store.set('a good long password', true);
    // 0600. Skipped where the filesystem has no such concept.
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o077).toBe(0);
    }
  });

  it('refuses a password too short to be worth having', async () => {
    await expect(store.set('short', true)).rejects.toBeInstanceOf(RemoteAccessError);
    expect('short'.length).toBeLessThan(MIN_PASSWORD_LENGTH);
    expect(store.isSet()).toBe(false);
  });

  it('refuses to set one at all without authority', async () => {
    await expect(store.set('a good long password', false)).rejects.toBeInstanceOf(RemoteAccessError);
    expect(store.isSet()).toBe(false);
  });

  it('only accepts this run\'s setup code', () => {
    expect(store.checkSetupCode(store.firstTimeSetupCode)).toBe(true);
    expect(store.checkSetupCode(store.firstTimeSetupCode.toUpperCase())).toBe(true);
    expect(store.checkSetupCode('deadbeef')).toBe(false);
    expect(store.checkSetupCode('')).toBe(false);
    expect(store.checkSetupCode(undefined)).toBe(false);
    // A code from another process is worth nothing here.
    const other = new RemoteAccessStore(join(dir, 'other.json'));
    expect(store.checkSetupCode(other.firstTimeSetupCode)).toBe(false);
  });

  it('hands out sessions and takes them back', async () => {
    await store.set('a good long password', true);
    const token = store.openSession();
    expect(store.hasSession(token)).toBe(true);
    expect(store.hasSession('not-a-token')).toBe(false);
    expect(store.hasSession(undefined)).toBe(false);
    store.closeSession(token);
    expect(store.hasSession(token)).toBe(false);
  });

  it('ends every session when the password changes', async () => {
    await store.set('a good long password', true);
    const token = store.openSession();
    expect(store.hasSession(token)).toBe(true);
    await store.set('a different long password', true);
    // The old session was bought with the old password.
    expect(store.hasSession(token)).toBe(false);
    expect(store.liveSessions()).toBe(0);
  });

  it('needs authority to remove the password, like every other destruction', async () => {
    await store.set('a good long password', true);
    expect(() => store.clear(false)).toThrow(RemoteAccessError);
    expect(store.isSet()).toBe(true);
    store.clear(true);
    expect(store.isSet()).toBe(false);
    expect(existsSync(join(dir, 'remote-access.json'))).toBe(false);
  });

  it('reads one cookie out of a header without being fooled by the others', () => {
    expect(readCookie('a=1; neuroclaw_session=abc; b=2', 'neuroclaw_session')).toBe('abc');
    expect(readCookie('not_neuroclaw_session=abc', 'neuroclaw_session')).toBe(null);
    expect(readCookie(undefined, 'neuroclaw_session')).toBe(null);
    expect(readCookie('neuroclaw_session=', 'neuroclaw_session')).toBe('');
  });
});

describe('what needs no password', () => {
  it('opens the chat rooms to anyone who can reach the server', () => {
    expect(isSharedChatPublicRoute('/api/shared-chat/rooms', 'GET')).toBe(true);
    expect(isSharedChatPublicRoute('/api/shared-chat/rooms', 'POST')).toBe(true);
    expect(isSharedChatPublicRoute('/api/shared-chat/rooms/general/messages', 'GET')).toBe(true);
    expect(isSharedChatPublicRoute('/api/shared-chat/rooms/general/messages', 'POST')).toBe(true);
    expect(isSharedChatPublicRoute('/api/shared-chat/rooms/general/ask', 'POST')).toBe(true);
  });

  it('never opens deleting one', () => {
    // The line that must not move. Anyone may add to a room; removing is
    // authority, the same split the wiki and the store make.
    expect(isSharedChatPublicRoute('/api/shared-chat/rooms/general', 'DELETE')).toBe(false);
    expect(isSharedChatPublicRoute('/api/shared-chat/rooms/general/messages', 'DELETE')).toBe(false);
    expect(isSharedChatPublicRoute('/api/memory/all', 'DELETE')).toBe(false);
    expect(isWikiPublicRoute('/api/memory/all', 'DELETE')).toBe(false);
    expect(isStorePublicRoute('/api/memory/all', 'DELETE')).toBe(false);
    expect(isAuthPublicRoute('/api/memory/all', 'DELETE')).toBe(false);
  });

  it('does not let a chat-shaped path reach anything else', () => {
    expect(isSharedChatPublicRoute('/api/shared-chat/rooms/general/../../terminal', 'POST')).toBe(false);
    expect(isSharedChatPublicRoute('/api/terminal', 'POST')).toBe(false);
    expect(isSharedChatPublicRoute('/api/files', 'GET')).toBe(false);
    expect(isSharedChatPublicRoute('/api/shared-chat/rooms/GENERAL/messages', 'GET')).toBe(false);
  });

  it('opens exactly the routes someone needs to log in, and nothing else', () => {
    expect(isAuthPublicRoute('/login', 'GET')).toBe(true);
    expect(isAuthPublicRoute('/api/auth/status', 'GET')).toBe(true);
    expect(isAuthPublicRoute('/api/auth/login', 'POST')).toBe(true);
    expect(isAuthPublicRoute('/api/auth/logout', 'POST')).toBe(true);
    // Reachable, but the handler still decides who may actually set one.
    expect(isAuthPublicRoute('/api/auth/password', 'POST')).toBe(true);
    expect(isAuthPublicRoute('/api/auth/password', 'DELETE')).toBe(false);
    expect(isAuthPublicRoute('/api/chat', 'POST')).toBe(false);
    expect(isAuthPublicRoute('/', 'GET')).toBe(false);
  });
});
