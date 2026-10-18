/**
 * The existing AI engine stays connected and functional behind the shared application.
 * Starts the real backend and talks to it: no mocks, no stand-in replies.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

test('the engine reports itself running with its subsystems and mesh', async () => {
  const r = await api(srv.url, '/api/status');
  assert.equal(r.status, 200);
  assert.equal(r.json.running, true);
  assert.equal(r.json.subsystems.llm, true);
  assert.equal(r.json.subsystems.plugins, true);
  assert.ok(r.json.llm.experts > 0, 'the mesh has experts');
  assert.ok(r.json.llm.valuePoints > 0);
});

test('chat goes through the engine and comes back with a reply', async () => {
  const r = await api(srv.url, '/api/chat', { method: 'POST', body: { message: 'hello, are you there?' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(typeof r.json.response, 'string');
  assert.ok(r.json.response.length > 0, 'a real reply, not empty');
  assert.equal(typeof r.json.timestamp, 'number');
});

test('chat refuses a request with no message instead of inventing one', async () => {
  const r = await api(srv.url, '/api/chat', { method: 'POST', body: {} });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /message/i);
});

test('plugins are registered and active, with real names', async () => {
  const r = await api(srv.url, '/api/plugins');
  assert.equal(r.status, 200);
  assert.ok(r.json.plugins.length >= 10, `only ${r.json.plugins.length} plugins`);
  assert.ok(r.json.plugins.some((p) => p.active), 'at least one active plugin');
  for (const id of ['location', 'camera', 'microphone']) assert.ok(r.json.plugins.some((p) => p.id === id), `${id} plugin listed`);
});

test('memory, skills, history and the store answer', async () => {
  for (const p of ['/api/memory', '/api/net-skills', '/api/chat-history/threads', '/api/store', '/api/prompting-skills', '/api/neurons']) {
    const r = await api(srv.url, p);
    assert.equal(r.status, 200, `${p} -> ${r.status} ${r.text.slice(0, 120)}`);
    assert.ok(r.json !== null, `${p} returns JSON`);
  }
});

test('a chat message saves and the thread comes back through the history routes', async () => {
  const first = await api(srv.url, '/api/chat-history/save', { method: 'POST', body: { source: 'chat', role: 'user', content: 'platform test message' } });
  assert.equal(first.status, 200, first.text);
  const threadId = first.json.id ?? first.json.thread?.id ?? first.json.threadId;
  assert.ok(threadId, `a thread id comes back: ${first.text.slice(0, 200)}`);
  const second = await api(srv.url, '/api/chat-history/save', { method: 'POST', body: { source: 'chat', role: 'assistant', content: 'platform test reply', threadId } });
  assert.equal(second.status, 200, second.text);
  const list = await api(srv.url, '/api/chat-history/threads');
  assert.ok(list.json.threads.some((t) => t.id === threadId), 'saved thread is listed');
  const found = await api(srv.url, '/api/chat-history/search?q=platform');
  assert.equal(found.status, 200);
});
