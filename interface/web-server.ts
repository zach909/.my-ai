import http from 'node:http';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { NeuroclawRunner } from './runner.js';
import { AppLauncher } from './app-launcher.js';
import { EncryptionManager } from './encryption.js';
import { ChatHistoryStore, type ChatSource } from '../models && skills/core/chat-history-store.js';
import type { NetworkStateSnapshot } from '../models && skills/core/onebrain.js';
import {
  installFromStore,
  installPromptingSkill,
  listInstalled,
  loadRegistry,
  publishPromptingSkill,
  readPublishedPromptingSkill,
  uninstallPromptingSkill,
  isBuiltIn,
} from '../models && skills/core/prompting-skill-store.js';
import { PROMPTING_CATEGORIES, PROMPTING_CATEGORY_LABELS, PromptingSkillError, builtInPromptingSkills } from '../models && skills/core/prompting-skills.js';
import { listWikiPages, readWikiPage, publishWikiPageAndSync, deleteWikiPageAndSync, listWikiBackups, restoreWikiBackup, WikiNameError } from '../models && skills/core/wiki-store.js';
import { getSharedChatStore, SharedChatError } from '../models && skills/core/shared-chat-store.js';
import { getRemoteAccessStore, readCookie, RemoteAccessError, SESSION_COOKIE, SESSION_TTL_MS, MIN_PASSWORD_LENGTH } from '../models && skills/core/remote-access.js';
import { graftNetSkill, graftedSkills, type SkillNeuron } from '../models && skills/core/net-skill-graft.js';
import {
  STORE_KINDS,
  STORE_KIND_LABELS,
  StoreError,
  listCatalog,
  publishAndSync,
  readItem,
  readItemFile,
  deleteAndSync,
  type StoreFile,
} from '../models && skills/core/store.js';
import {
  listSkillUploads,
  readSkillUpload,
  readSkillUploadFile,
  readSkillUploadExtraFile,
  saveSkillUploadAndSync,
  saveSkillUploadExtraFilesAndSync,
  deleteSkillUploadAndSync,
  deleteSkillUploadExtraFileAndSync,
  linkSkillUploadWikiAndSync,
  unlinkSkillUploadWikiAndSync,
  recordSkillUploadRsiPassAndSync,
  SkillUploadError,
  SKILL_UPLOAD_SLOTS,
  type SkillUploadSlot,
  type SkillUploadFile,
} from '../models && skills/core/skill-upload-store.js';

type PyTorchTrainResult =
  { ok: true; torchVersion: string; epochsRun: number; converged: boolean; sampleLosses: number[]; sampleConverged: boolean[]; W: number[][]; b: number[][] }
  | { ok: false; error: string };

/**
 * Keeps exactly one `extension-builder/pytorch_trainer.py` subprocess alive
 * for the life of the server instead of spawning (and re-importing torch
 * in) a fresh one per request. `import torch` alone costs ~2s and a cold
 * python3+numpy+torch startup runs 4-25s depending on disk cache state --
 * dominating every single training call if paid per-request. Paying it once
 * here turns every call after the first into single-digit milliseconds
 * (the actual gradient descent), confirmed by timing the same spec run
 * three times through one persistent process vs. three fresh spawns.
 *
 * Protocol: one JSON object per line in on stdin, one JSON object per line
 * back on stdout, in request order -- see pytorch_trainer.py's own header
 * comment. Requests are queued and answered strictly FIFO (matches the
 * script's own single-threaded, line-at-a-time loop), so concurrent calls
 * to send() are safe: each just waits its turn in `pending`.
 */
class PyTorchTrainerWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: Array<{ resolve: (r: PyTorchTrainResult) => void }> = [];
  private stdoutBuf = '';
  private stderrBuf = '';
  // Serializes concurrent ensureSpawned() calls -- without this, two
  // requests racing in before the first spawn resolves would each see
  // `this.child === null` and spawn a second orphaned python3 process.
  private spawning: Promise<ChildProcessWithoutNullStreams | { error: string }> | null = null;

  private ensureSpawned(scriptPath: string): Promise<ChildProcessWithoutNullStreams | { error: string }> {
    if (this.child) return Promise.resolve(this.child);
    if (!this.spawning) {
      this.spawning = this.doSpawn(scriptPath).finally(() => { this.spawning = null; });
    }
    return this.spawning;
  }

  private async doSpawn(scriptPath: string): Promise<ChildProcessWithoutNullStreams | { error: string }> {
    let child: ChildProcessWithoutNullStreams;
    try {
      // Deferred import, not a top-level one: keeps `node:child_process`
      // (and the subprocess it can spawn) out of any code path that
      // doesn't actually use this optional backend.
      const { spawn } = await import('node:child_process');
      child = spawn('python3', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return { error: `could not launch python3: ${err instanceof Error ? err.message : String(err)}` };
    }
    child.stdout.on('data', (d: Buffer) => this.onStdout(d));
    child.stderr.on('data', (d: Buffer) => { this.stderrBuf += d; });
    const onDown = (detail: string) => {
      // The process is gone (crashed, killed, or python3/torch missing) --
      // fail every request still waiting on it and drop the reference so
      // the next call respawns fresh instead of writing into a dead pipe.
      const err: PyTorchTrainResult = { ok: false, error: detail };
      const waiting = this.pending;
      this.pending = [];
      this.child = null;
      for (const p of waiting) p.resolve(err);
    };
    child.on('error', (err) => onDown(`python3 not available: ${err.message}`));
    child.on('exit', (code, signal) => {
      if (this.pending.length > 0) {
        onDown(this.stderrBuf.trim() || `pytorch_trainer.py exited (code=${code}, signal=${signal})`);
      } else {
        this.child = null;
      }
    });
    this.child = child;
    return child;
  }

  private onStdout(chunk: Buffer): void {
    this.stdoutBuf += chunk;
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf('\n')) !== -1) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      const next = this.pending.shift();
      if (!next) continue; // stray output with nothing waiting on it
      try {
        next.resolve(JSON.parse(line));
      } catch {
        next.resolve({ ok: false, error: `could not parse pytorch_trainer.py output: ${line}` });
      }
    }
  }

  async send(scriptPath: string, spec: unknown): Promise<PyTorchTrainResult> {
    const child = await this.ensureSpawned(scriptPath);
    if (!('stdin' in child)) return { ok: false, error: child.error };
    return new Promise<PyTorchTrainResult>((resolve) => {
      this.pending.push({ resolve });
      child.stdin.write(JSON.stringify(spec) + '\n');
    });
  }

  /** Called from WebServer.stop() so a stopped server doesn't leave an orphaned python3 process behind. */
  shutdown(): void {
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
    const err: PyTorchTrainResult = { ok: false, error: 'server is shutting down' };
    for (const p of this.pending) p.resolve(err);
    this.pending = [];
  }
}

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Neuroclaw Terminal</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; color: #00ff41; font-family: 'Courier New', monospace; height: 100vh; display: flex; flex-direction: column; }
  #header { background: #111; padding: 12px 20px; border-bottom: 1px solid #00ff41; display: flex; justify-content: space-between; align-items: center; }
  #header h1 { font-size: 14px; font-weight: normal; text-transform: uppercase; letter-spacing: 2px; }
  #status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 8px; }
  #status-dot.online { background: #00ff41; box-shadow: 0 0 8px #00ff41; }
  #status-dot.offline { background: #ff0040; box-shadow: 0 0 8px #ff0040; }
  #chat-container { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  .message { position: relative; max-width: 80%; padding: 10px 14px; border-radius: 4px; line-height: 1.5; font-size: 13px; animation: fadeIn 0.3s ease-out; }
  .copy-btn { position: absolute; top: 4px; right: 4px; opacity: 0; background: #222; color: #00ff41; border: 1px solid #333; border-radius: 3px; font-size: 10px; padding: 2px 6px; cursor: pointer; transition: opacity 0.2s; }
  .message:hover .copy-btn, .copy-btn:focus { opacity: 1; }
  .edit-btn { background: none; border: none; color: #00ff41; opacity: 0.45; font-size: 13px; line-height: 1; padding: 2px 4px; margin-right: 6px; cursor: pointer; transition: opacity 0.2s; }
  .edit-btn:hover, .edit-btn:focus { opacity: 1; }
  .edit-area { width: 100%; box-sizing: border-box; background: #0b0b0b; color: #00ff41; border: 1px solid #00ff41; border-radius: 3px; font: inherit; padding: 6px; resize: vertical; min-height: 4.5em; }
  .edit-actions { display: flex; gap: 6px; margin-top: 6px; }
  .edit-actions button { background: #222; color: #00ff41; border: 1px solid #333; border-radius: 3px; font-size: 11px; padding: 3px 10px; cursor: pointer; }
  .edit-actions button:hover { border-color: #00ff41; }
  .edited-tag { color: #00ff41; opacity: 0.5; font-size: 10px; margin-left: 6px; }
  .dots-btn { background: none; border: none; color: #00ff41; opacity: 0.45; font-size: 14px; line-height: 1; padding: 2px 4px; margin-right: 6px; cursor: pointer; transition: opacity 0.2s; }
  .dots-btn:hover, .dots-btn:focus, .dots-btn[aria-expanded="true"] { opacity: 1; }
  .details { margin-top: 8px; border-left: 2px solid #00ff41; padding: 6px 10px; background: #0b0b0b; font-size: 11px; color: #8f8; }
  .details h4 { margin: 0 0 4px; font-size: 11px; color: #00ff41; text-transform: uppercase; letter-spacing: 0.05em; }
  .details dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0 0 6px; }
  .details dt { opacity: 0.6; }
  .details dd { margin: 0; word-break: break-word; }
  .details ul { margin: 0 0 6px; padding-left: 16px; }
  .details .none { opacity: 0.5; font-style: italic; }
  .message.user { align-self: flex-end; background: #003300; border: 1px solid #00ff4144; }
  .message.ai { align-self: flex-start; background: #111; border: 1px solid #333; }
  .message.system { align-self: center; background: #111; border: 1px solid #333; color: #888; font-style: italic; font-size: 11px; }
  .message.error { align-self: center; background: #330000; border: 1px solid #ff004044; color: #ff6666; }
  .timestamp { font-size: 10px; color: #888; margin-top: 4px; }
  #input-area { border-top: 1px solid #00ff4144; padding: 12px 20px; background: #111; display: flex; gap: 10px; }
  #input { flex: 1; background: #0a0a0a; border: 1px solid #333; color: #00ff41; padding: 10px 14px; font-family: 'Courier New', monospace; font-size: 13px; outline: none; border-radius: 4px; }
  #input:focus { border-color: #00ff41; }
  #input:disabled { opacity: 0.5; cursor: not-allowed; }
  #send-btn { background: #003300; color: #00ff41; border: 1px solid #00ff41; padding: 10px 20px; cursor: pointer; font-family: 'Courier New', monospace; font-size: 13px; border-radius: 4px; }
  #send-btn:hover { background: #005500; }
  #send-btn:active, #clear-btn:active { transform: translateY(1px); }
  #send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  #clear-btn { background: transparent; color: #888; border: 1px solid #333; padding: 4px 8px; cursor: pointer; font-family: 'Courier New', monospace; font-size: 11px; border-radius: 4px; transition: all 0.2s; }
  #clear-btn:hover { color: #00ff41; border-color: #00ff41; background: #003300; }
  *:focus-visible { outline: 1px solid #00ff41; outline-offset: 2px; }
  .thinking { color: #888; font-style: italic; font-size: 11px; align-self: flex-start; animation: pulse 1.5s infinite; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }
</style>
</head>
<body>
<div id="header">
  <h1><span id="status-dot" class="offline" role="img" aria-label="System status: Offline"></span>Neuroclaw v0.1.0</h1>
  <div style="display:flex; align-items:center; gap:15px;">
    <button id="clear-btn" aria-label="Clear chat history">Clear</button>
    <div id="status-text" style="font-size:12px;color:#888;">Starting...</div>
  </div>
</div>
<div id="chat-container" role="log" aria-live="polite" aria-atomic="false"></div>
<div id="input-area">
  <label for="input" class="sr-only">Message</label>
  <input type="text" id="input" placeholder="Type a message..." autofocus>
  <button id="send-btn">Send</button>
</div>
<script>
  const chat = document.getElementById('chat-container');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  const clearBtn = document.getElementById('clear-btn');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  let chatHistory = JSON.parse(localStorage.getItem('nc_hist') || '[]');
  const save = () => localStorage.setItem('nc_hist', JSON.stringify(chatHistory));
  /** One "label: value" row, skipped entirely when there is no value. */
  function row(dl, label, value) {
    if (value === null || value === undefined || value === '') return;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  /**
   * What the answer was built from.
   *
   * Renders only what the turn actually recorded. A section with nothing in
   * it says so rather than being hidden -- "no prompting skills applied" is a
   * real and useful answer, and hiding it would make an empty panel look like
   * a broken one.
   */
  function detailsPanel(d) {
    const box = document.createElement('div');
    box.className = 'details';
    const head = document.createElement('h4');
    head.textContent = 'How this answer was built';
    box.appendChild(head);
    if (!d) {
      const p = document.createElement('div');
      p.className = 'none';
      p.textContent = 'No details recorded for this response.';
      box.appendChild(p);
      return box;
    }

    const dl = document.createElement('dl');
    if (d.route) row(dl, 'routed to', d.route.capability + ' (confidence ' + d.route.confidence + ')');
    if (d.emotion) row(dl, 'read as', 'valence ' + d.emotion.valence + ', arousal ' + d.emotion.arousal);
    if (d.mesh) row(dl, 'mesh', d.mesh.neurons + ' neurons x ' + d.mesh.dimensions + ' dimensions');
    if (d.zipBytes) row(dl, 'zip loop', d.zipBytes + ' archive bytes through the bit neurons');
    if (d.ms !== undefined) row(dl, 'took', d.ms + ' ms');
    if (dl.children.length) box.appendChild(dl);

    const skills = document.createElement('div');
    const sh = document.createElement('h4');
    sh.textContent = 'Prompting skills zipped in';
    skills.appendChild(sh);
    if (d.skills && d.skills.length) {
      const ul = document.createElement('ul');
      d.skills.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
      skills.appendChild(ul);
    } else {
      const p = document.createElement('div');
      p.className = 'none';
      p.textContent = 'none applied';
      skills.appendChild(p);
    }
    box.appendChild(skills);

    const recall = document.createElement('div');
    const rh = document.createElement('h4');
    rh.textContent = 'Recalled from memory';
    recall.appendChild(rh);
    if (d.recalled && d.recalled.length) {
      const ul = document.createElement('ul');
      d.recalled.forEach(r => {
        const li = document.createElement('li');
        li.textContent = '[' + r.similarity + '] ' + r.text;
        ul.appendChild(li);
      });
      recall.appendChild(ul);
    } else {
      const p = document.createElement('div');
      p.className = 'none';
      p.textContent = 'nothing recalled';
      recall.appendChild(p);
    }
    box.appendChild(recall);
    return box;
  }

  function editedTag() {
    const tag = document.createElement('span');
    tag.className = 'edited-tag';
    tag.textContent = '(edited)';
    return tag;
  }

  /**
   * Swap the reply for a textarea, and put it back on save or cancel.
   *
   * The edit is applied to the transcript immediately and reported to the
   * server afterwards. That order is deliberate: the user's own transcript
   * must not depend on the network, and a correction that fails to file is
   * still a correction they made.
   */
  function openEditor(div, content, ts, pen, entry, onSaved) {
    if (div.querySelector('.edit-area')) return;
    const before = content.textContent;
    const area = document.createElement('textarea');
    area.className = 'edit-area';
    area.value = before;
    area.setAttribute('aria-label', 'Edit the AI response');
    const actions = document.createElement('div');
    actions.className = 'edit-actions';
    // saveBtn, not save: the outer scope already has a save() that persists
    // the transcript to localStorage, and shadowing it here means the edit
    // renders and is never stored.
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    actions.appendChild(saveBtn);
    actions.appendChild(cancel);

    content.style.display = 'none';
    pen.disabled = true;
    div.insertBefore(area, ts);
    div.insertBefore(actions, ts);
    area.focus();

    const close = () => {
      area.remove();
      actions.remove();
      content.style.display = '';
      pen.disabled = false;
    };
    cancel.onclick = close;
    area.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    saveBtn.onclick = async () => {
      const next = area.value;
      if (next.trim() === '' || next === before) { close(); return; }
      content.textContent = next;
      onSaved(next);
      // The prompt that produced this reply, for the mistake record: the last
      // user turn before it.
      let prompt = '';
      if (entry) {
        const at = chatHistory.indexOf(entry);
        for (let i = at - 1; i >= 0; i--) {
          if (chatHistory[i].role === 'user') { prompt = chatHistory[i].content; break; }
        }
        entry.content = next;
        entry.edited = true;
        save();
      }
      if (!ts.querySelector('.edited-tag')) ts.appendChild(editedTag());
      close();
      try {
        await fetch('/api/chat/correct', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ original: before, corrected: next, prompt })
        });
      } catch { /* the transcript is already fixed; filing it can wait */ }
    };
  }

  function addMessage(type, text, time, entry) {
    const div = document.createElement('div');
    div.className = 'message ' + type;
    // current is what this message says NOW -- an edit changes it, and Copy
    // and the next edit both have to pick up the change rather than the text
    // this message was first rendered with.
    let current = text;
    if (type === 'ai') {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy AI response');
      btn.onclick = () => {
        navigator.clipboard.writeText(current);
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 2000);
      };
      div.appendChild(btn);
    }
    const content = document.createElement('div');
    content.textContent = text;
    div.appendChild(content);
    const ts = document.createElement('div');
    ts.className = 'timestamp';
    if (type === 'ai') {
      // The pen, underneath the reply. Editing what the AI said is the most
      // valuable signal this thing gets and there was no way to give it: the
      // UI could copy a wrong answer but not fix one, so it stayed wrong in
      // the transcript, in memory, and in whatever the next turn was grounded
      // on.
      const pen = document.createElement('button');
      pen.className = 'edit-btn';
      pen.textContent = '\uD83D\uDD8A\uFE0F';
      pen.title = 'Edit what the AI said';
      pen.setAttribute('aria-label', 'Edit what the AI said');
      pen.onclick = () => openEditor(div, content, ts, pen, entry, (next) => { current = next; });
      ts.appendChild(pen);

      // Three dots, next to the pen: what the answer was built from. Closed
      // by default -- it is reference, not part of reading the reply.
      const dots = document.createElement('button');
      dots.className = 'dots-btn';
      dots.textContent = '\u22EF';
      dots.title = 'How this answer was built';
      dots.setAttribute('aria-label', 'How this answer was built');
      dots.setAttribute('aria-expanded', 'false');
      let panel = null;
      dots.onclick = () => {
        if (panel) {
          panel.remove();
          panel = null;
          dots.setAttribute('aria-expanded', 'false');
          return;
        }
        panel = detailsPanel(entry && entry.details);
        div.appendChild(panel);
        dots.setAttribute('aria-expanded', 'true');
      };
      ts.appendChild(dots);
    }
    const stamp = document.createElement('span');
    stamp.textContent = time || new Date().toLocaleTimeString();
    ts.appendChild(stamp);
    if (entry && entry.edited) ts.appendChild(editedTag());
    div.appendChild(ts);
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }
  function addThinking() {
    input.disabled = true;
    sendBtn.disabled = true;
    chat.setAttribute('aria-busy', 'true');
    const div = document.createElement('div');
    div.className = 'thinking';
    div.id = 'thinking-indicator';
    div.textContent = 'Thinking...';
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }
  function removeThinking() {
    input.disabled = false;
    sendBtn.disabled = false;
    chat.removeAttribute('aria-busy');
    const el = document.getElementById('thinking-indicator');
    if (el) el.remove();
    input.focus();
  }
  async function checkStatus() {
    try {
      // Timed. This page had the same bug the React app did: setInterval
      // around an untimed fetch, so a stalled backend accumulated requests
      // that never completed until the browser's per-host connection budget
      // was gone and the page could no longer send a chat message either.
      const res = await fetch('/api/status', { signal: AbortSignal.timeout(2500) });
      const data = await res.json();
      if (data.running) {
        statusDot.className = 'online';
        statusDot.setAttribute('aria-label', 'System status: Online');
        statusText.textContent = 'Online';
      } else {
        statusDot.className = 'offline';
        statusDot.setAttribute('aria-label', 'System status: Offline');
        statusText.textContent = 'Offline';
      }
    } catch {
      statusDot.className = 'offline';
      statusDot.setAttribute('aria-label', 'System status: Offline');
      statusText.textContent = 'Disconnected';
    }
  }
  async function sendMessage(msg) {
    if (!msg.trim()) return;
    const time = new Date().toLocaleTimeString();
    addMessage('user', msg, time);
    chatHistory.push({role: 'user', content: msg, time});
    save();
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;
    addThinking();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: msg, history: chatHistory.map(({role, content}) => ({role, content}))})
      });
      const data = await res.json();
      removeThinking();
      if (data.response) {
        const aiTime = new Date().toLocaleTimeString();
        // The entry is pushed BEFORE the message is rendered, and handed to
        // it: the pen edits this object in place, so it has to be the same
        // object the transcript is saved from.
        const entry = {role: 'assistant', content: data.response, time: aiTime, details: data.details};
        chatHistory.push(entry);
        addMessage('ai', data.response, aiTime, entry);
        save();
      } else if (data.error) { addMessage('error', 'Error: ' + data.error); }
    } catch { removeThinking(); addMessage('error', 'Error: Unable to reach server'); }
    finally {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
  const clearChat = () => {
    if (confirm('Clear chat history?')) {
      chat.innerHTML = '';
      chatHistory = [];
      localStorage.removeItem('nc_hist');
      addMessage('system', 'Chat cleared.');
    }
  };
  sendBtn.addEventListener('click', () => sendMessage(input.value));
  clearBtn.addEventListener('click', clearChat);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(input.value); });
  // Self-scheduling, not setInterval: the gap is measured from when a check
  // FINISHES, so a slow response delays the next one instead of overlapping.
  (async function pollStatus() {
    for (;;) {
      await checkStatus();
      await new Promise(r => setTimeout(r, 3000));
    }
  })();
  if (chatHistory.length) {
    chatHistory.forEach(m => addMessage(m.role === 'user' ? 'user' : 'ai', m.content, m.time, m));
  } else {
    addMessage('system', 'Neuroclaw ready. Type a message.');
  }
</script>
</body>
</html>`;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * A single password check, kept only in memory for the lifetime of one
 * running server process -- never written to disk, never persisted across
 * restarts. Compares with crypto.timingSafeEqual over a PBKDF2 hash (a
 * per-instance random salt) rather than comparing plaintext directly.
 */
class PasswordLock {
  private hash: Buffer | null = null;
  private salt: Buffer | null = null;
  private readonly encryption = new EncryptionManager();

  async set(password: string): Promise<void> {
    this.salt = crypto.randomBytes(16);
    this.hash = await this.encryption.hashPassword(password, this.salt);
  }

  get required(): boolean {
    return this.hash !== null;
  }

  async check(suppliedPassword: string): Promise<boolean> {
    if (!this.required) return true;
    const suppliedHash = await this.encryption.hashPassword(suppliedPassword || ' ', this.salt!).catch(() => null);
    if (!suppliedHash || suppliedHash.length !== this.hash!.length) return false;
    return crypto.timingSafeEqual(suppliedHash, this.hash!);
  }
}

/**
 * Which requests bypass the blanket remoteAccessLock gate to reach a route
 * handler directly, without a password, even on a non-localhost bind:
 * reading the wiki (any GET under /api/wiki), and *creating* a new wiki
 * page (POST /api/wiki -- the handler itself still re-checks auth if the
 * named page already exists, since only creation is meant to be public).
 * Exported as a pure, path/method-only predicate specifically so it's
 * directly testable without standing up a real server -- the one thing
 * that must never accidentally widen is exactly this set: DELETE
 * /api/wiki/:name, POST /api/wiki/:name/restore, and every route outside
 * /api/wiki (file-system, terminal-adjacent app launching, skill uploads,
 * ...) must always return false here.
 */
export function isWikiPublicRoute(pathname: string, method: string): boolean {
  if (method === 'GET') {
    return pathname === '/api/wiki' || /^\/api\/wiki\/[A-Za-z0-9_-]+$/.test(pathname);
  }
  if (method === 'POST') {
    return pathname === '/api/wiki';
  }
  return false;
}

/**
 * Which store routes need no credential.
 *
 * The store's purpose is that anyone can read what has been shared and anyone
 * can contribute to it, so browsing, downloading and publishing are all open.
 * DELETE is deliberately absent: publishing is open precisely so that
 * destroying cannot be. This mirrors the wiki's split — add freely, remove
 * only with authority.
 */
export function isStorePublicRoute(pathname: string, method: string): boolean {
  if (method === 'GET') {
    // /api/store, /api/store/:kind/:name, /api/store/:kind/:name/file/:filename
    return (
      pathname === '/api/store' ||
      /^\/api\/store\/[a-z]+\/[A-Za-z0-9._-]+$/.test(pathname) ||
      /^\/api\/store\/[a-z]+\/[A-Za-z0-9._-]+\/file\/.+$/.test(pathname)
    );
  }
  if (method === 'POST') {
    // Publishing a prompting skill is a publish like any other, so it is open.
    // Installing one is deliberately NOT here: publishing shares a document,
    // installing changes how this machine's agent actually behaves, and those
    // are not the same permission.
    //
    // /api/github/publish is open for the same reason and for the reason it
    // exists at all: pushing something public to GitHub without signing up
    // or signing in only means something if reaching it does not require
    // signing in to THIS app either. The GitHub credential is this
    // deployment's own, never the caller's -- see plugins/github-publish.ts.
    return pathname === '/api/store' || pathname === '/api/prompting-skills/publish' || pathname === '/api/github/publish';
  }
  return false;
}

/**
 * Which shared-chat routes need no credential.
 *
 * The chat rooms attached to wiki pages are public in the same sense the wiki
 * itself is: anyone who can reach this instance can read the conversation and
 * say something in it, with no account anywhere -- no GitHub, no sign-up, just
 * a name typed into a box. That is the whole point of a room hanging off a
 * public page; a page anyone can read and contribute to, with a discussion
 * only the owner can see, is not a discussion.
 *
 * Open: listing rooms, opening one, reading it, posting to it, creating one,
 * and summoning the bot into it. Deliberately absent, and this is the line
 * that must never move: DELETE. Publishing is open precisely so that
 * destroying can be privileged -- the same split the wiki and the store make.
 */
export function isSharedChatPublicRoute(pathname: string, method: string): boolean {
  if (method === 'GET') {
    return (
      pathname === '/api/shared-chat/rooms' ||
      /^\/api\/shared-chat\/rooms\/[a-z0-9-]+\/messages$/.test(pathname)
    );
  }
  if (method === 'POST') {
    return (
      pathname === '/api/shared-chat/rooms' ||
      /^\/api\/shared-chat\/rooms\/[a-z0-9-]+\/(messages|ask)$/.test(pathname)
    );
  }
  return false;
}

/**
 * Which routes exist so someone can log in at all, and therefore cannot
 * themselves require being logged in. Nothing here reads or changes anything
 * the password protects: it serves the login page, says whether a password
 * has been set, takes a login attempt, and ends a session.
 *
 * Setting the password is here too, and is the one that needs care: the
 * handler will only accept it from the machine itself, from someone holding
 * the setup code printed on the server's console, or from someone who already
 * knows the current password. Reaching the handler is not the same as being
 * allowed to change anything.
 */
export function isAuthPublicRoute(pathname: string, method: string): boolean {
  if (method === 'GET') return pathname === '/login' || pathname === '/api/auth/status';
  if (method === 'POST') {
    return pathname === '/api/auth/login' || pathname === '/api/auth/logout' || pathname === '/api/auth/password';
  }
  return false;
}

/**
 * An error whose cause is the request, not the server.
 *
 * Carries the status so a handler does not have to know which failures
 * parseBody can produce -- it catches, and sendError reads the number off the
 * error. Anything else thrown still answers 500, which is correct for it.
 */
export class HttpClientError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HttpClientError';
  }
}

/**
 * The status a thrown error should answer with.
 *
 * Pure and exported so the mapping can be tested without standing up a
 * server: an HttpClientError answers with what it carries, anything else is
 * this server's fault and answers 500.
 */
export function statusForError(err: unknown): number {
  return err instanceof HttpClientError ? err.status : 500;
}

/**
 * Reject a POST body that is not declared as JSON.
 *
 * Not a formality: this server sends no Access-Control-Allow-Origin, so a
 * cross-origin page cannot READ a response -- but a POST whose content type
 * is one of the CORS "simple" types is sent with no preflight at all, so it
 * would still be acted on. Requiring application/json forces a real preflight
 * the browser then refuses. 415 rather than 400: the body may be perfectly
 * well formed, it is the type that is unacceptable.
 */
export function assertJsonContentType(contentType: string): void {
  if (!/^application\/json(;|$)/i.test(contentType.trim())) {
    throw new HttpClientError('Content-Type must be application/json', 415);
  }
}

/** Parse a request body, or throw the 400 that a malformed one deserves. */
export function parseJsonBody(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpClientError('Invalid JSON', 400);
  }
}

export class WebServer {
  private runner: NeuroclawRunner;
  private launcher: AppLauncher;
  private server: http.Server | null = null;
  private port = 0;
  // Set only when start() is given a non-localhost host and a password --
  // see start()'s doc comment for why binding remotely without one is refused.
  private readonly remoteAccessLock = new PasswordLock();
  /**
   * The password someone can set from the interface and use to log in from
   * another device, stored (hashed) so it survives a restart. Independent of
   * remoteAccessLock, which is the process-lifetime NEUROCLAW_WEB_PASSWORD and
   * stays exactly as it was -- either one being satisfied is enough.
   */
  private readonly remoteAccess = getRemoteAccessStore();
  /**
   * True when this server is bound somewhere remote and has no password of any
   * kind yet. Nothing but the setup page answers while this is true: it is the
   * state between "reachable" and "claimed", and it ends the moment someone
   * sets a password.
   */
  private setupOnly = false;
  // Independent of remoteAccessLock: gates only /api/chat-groups/* (and the
  // /app/chat-groups page's own login prompt), even over an already-trusted
  // localhost connection -- set via NEUROCLAW_CHAT_GROUPS_PASSWORD.
  private readonly chatGroupsLock = new PasswordLock();
  private readonly chatHistory = new ChatHistoryStore();

  /**
   * Where a stopped run leaves what every neuron and every connection was.
   *
   * On disk as well as in the archive, because the archive goes back to
   * whoever asked and the point of saving state is that the NEXT run can pick
   * it up -- including a next run in a different process, after the machine
   * was turned off.
   */
  private networkStatePath(): string {
    return path.resolve(process.cwd(), 'config', 'network-state.json');
  }

  /** Returns how many neurons' worth of state was written. */
  private async saveNetworkState(snapshot: unknown): Promise<number> {
    const { writeJsonAtomic } = await import('../models && skills/core/atomic-write.js');
    writeJsonAtomic(this.networkStatePath(), snapshot);
    return (snapshot as { shape?: { neurons?: number } } | null)?.shape?.neurons ?? 0;
  }

  /**
   * The last saved state, or null. A missing or unreadable file is "nothing to
   * resume", not an error: the first run on a machine has no predecessor, and
   * a corrupt one is better started clean than half-restored.
   */
  private async readSavedNetworkState(): Promise<NetworkStateSnapshot | null> {
    try {
      const file = this.networkStatePath();
      if (!existsSync(file)) return null;
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as NetworkStateSnapshot | null;
      if (!parsed || typeof parsed !== 'object' || !parsed.shape) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  // Lazily spawned on first POST /api/extension/train-pytorch call, then
  // reused for the life of this server -- see PyTorchTrainerWorker's own
  // doc comment for why (torch import cost dominates a per-request spawn).
  private readonly pytorchWorker = new PyTorchTrainerWorker();
  // Set once by loadSavedExtensions() during start() -- surfaced via
  // GET /api/status so "did the runner actually pick up my trained
  // network on this boot" is observable, not just assumed.
  private loadedExtensions: { files: number; remembered: number; graftedNeurons: number } = { files: 0, remembered: 0, graftedNeurons: 0 };

  constructor(runner: NeuroclawRunner, launcher?: AppLauncher) {
    this.runner = runner;
    this.launcher = launcher ?? new AppLauncher();
  }

  /**
   * Start the server. `host` defaults to loopback-only, matching every prior
   * version of this file -- passing anything else exposes the AI's full
   * capabilities (terminal-adjacent app launching, file/extension writes,
   * ...) to the local network, so that path requires `password` and gates
   * every request behind HTTP Basic Auth. Binding remotely with no password
   * is refused outright rather than silently serving unauthenticated.
   */
  async start(port: number = 3000, host: string = '127.0.0.1', password?: string): Promise<void> {
    if (this.server) throw new Error('Web server already running');
    this.port = port;
    const isLocal = LOCAL_HOSTS.has(host);
    if (!isLocal) {
      if (password) {
        await this.remoteAccessLock.set(password);
      } else if (!this.remoteAccess.isSet()) {
        // No password anywhere. This used to refuse to bind, which is safe and
        // also makes setting one from another device impossible -- the page
        // that would let you is behind the port that will not open.
        //
        // So it binds, and serves exactly one thing: the setup page. Every
        // other route is refused until a password exists, and setting the
        // first one from off the machine needs the code printed right below,
        // which only someone looking at this console can see. Reachable, and
        // still not open.
        this.setupOnly = true;
        console.log(
          `\nNeuroclaw is bound to ${host}:${port} with no password set yet.\n` +
          `Open http://<this machine>:${port}/login and enter this setup code:\n\n` +
          `    ${this.remoteAccess.firstTimeSetupCode}\n\n` +
          `Until a password is set, nothing else on this server will answer.\n`
        );
      }
    }
    if (process.env.NEUROCLAW_CHAT_GROUPS_PASSWORD) {
      await this.chatGroupsLock.set(process.env.NEUROCLAW_CHAT_GROUPS_PASSWORD);
    }
    await this.runner.start();
    // Section 4.1: the continuous output loop should genuinely never stop
    // for the actual live web backend -- see runner.ts's start() for why
    // that's started explicitly here rather than unconditionally inside
    // start() itself (every short-lived NeuroclawRunner instance calls
    // start() too, and most never call stop()).
    this.runner.startContinuous();
    // Same reasoning, same placement: loading every saved extension is
    // real work (parsing N files, remembering M neurons) that only makes
    // sense to pay once per actual live server process, not once per
    // short-lived NeuroclawRunner test instance -- see loadSavedExtensions()'s
    // own doc comment for what this actually does and why it belongs here.
    this.loadedExtensions = await this.loadSavedExtensions();
    return new Promise<void>((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(port, host, () => resolve());
      this.server.on('error', (err: Error) => { this.server = null; reject(err); });
    });
  }

  /**
   * Is this request allowed past the blanket remote gate?
   *
   * Three ways in, and any one of them is enough:
   *   - the NEUROCLAW_WEB_PASSWORD given to start(), over HTTP Basic, exactly
   *     as before this file grew a login page;
   *   - a live session cookie, which is what the login page hands out;
   *   - the stored password over HTTP Basic, so scripts and curl can use the
   *     same credential a browser logs in with.
   *
   * With neither lock set -- a plain localhost run -- everything is allowed,
   * which is the behaviour this server has always had on loopback.
   */
  private async isRemotelyAuthorized(req: http.IncomingMessage): Promise<boolean> {
    if (this.remoteAccess.hasSession(readCookie(req.headers.cookie, SESSION_COOKIE))) return true;
    if (this.remoteAccessLock.required) {
      if (await this.isAuthorizedBasic(req, this.remoteAccessLock)) return true;
    }
    if (this.remoteAccess.isSet()) {
      const supplied = this.basicPassword(req);
      if (supplied !== null && await this.remoteAccess.check(supplied)) return true;
      return false;
    }
    // No stored password and no start()-time one: nothing to check against.
    return !this.remoteAccessLock.required;
  }

  /** Whether the request came from the machine this server runs on. */
  private isFromThisMachine(req: http.IncomingMessage): boolean {
    const address = req.socket.remoteAddress ?? '';
    // ::ffff:127.0.0.1 is how a v4 loopback connection looks on a v6 socket.
    const bare = address.startsWith('::ffff:') ? address.slice(7) : address;
    return LOCAL_HOSTS.has(bare);
  }

  /** The password half of an `Authorization: Basic ...` header, or null if there is not one. */
  private basicPassword(req: http.IncomingMessage): string | null {
    const match = /^Basic\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match) return null;
    let decoded: string;
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
      return null;
    }
    const sep = decoded.indexOf(':');
    return sep === -1 ? decoded : decoded.slice(sep + 1);
  }

  /**
   * The login page: one box on a plain page, and the first thing anyone sees
   * when they open this instance from another device.
   *
   * It is one page doing two jobs, because from the visitor's side they are
   * the same moment. With no password set it is the SETUP page -- pick one,
   * and from off the machine also type the code on the server's console. With
   * one set it is the LOGIN page. It asks /api/auth/status which it is rather
   * than being told, so a page left open through a restart still behaves.
   *
   * Inline styles and script, no build step and nothing fetched from
   * anywhere: this page has to work on an instance whose assets have not been
   * built, and it is the one page that must never depend on the network.
   */
  private loginPage(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Neuroclaw</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0b0d10; color:#e8eaed;
         font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  form { width:min(360px,90vw); padding:28px; background:#14171c;
         border:1px solid #232830; border-radius:14px; }
  h1 { margin:0 0 4px; font-size:19px; }
  p.sub { margin:0 0 20px; color:#9aa3af; font-size:13px; }
  label { display:block; margin:14px 0 6px; font-size:13px; color:#c5ccd6; }
  input { width:100%; box-sizing:border-box; padding:10px 12px; font-size:15px;
          background:#0b0d10; color:#e8eaed; border:1px solid #2b313a; border-radius:8px; }
  input:focus { outline:2px solid #4a7dff; outline-offset:1px; }
  button { width:100%; margin-top:20px; padding:11px; font-size:15px; font-weight:600;
           background:#4a7dff; color:#fff; border:0; border-radius:8px; cursor:pointer; }
  button[disabled] { opacity:.6; cursor:default; }
  .msg { margin-top:14px; font-size:13px; min-height:1.2em; }
  .msg.bad { color:#ff8080; }
  .msg.good { color:#7ddb9a; }
  .hidden { display:none; }
</style>
</head>
<body>
<form id="f" autocomplete="on">
  <h1 id="title">Log in</h1>
  <p class="sub" id="sub">This Neuroclaw instance is password protected.</p>

  <div id="setup-code-row" class="hidden">
    <label for="setupCode">Setup code</label>
    <input id="setupCode" name="setupCode" autocomplete="off" spellcheck="false"
           placeholder="shown on the server&#39;s console">
  </div>

  <label for="password" id="passwordLabel">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>

  <div id="confirm-row" class="hidden">
    <label for="confirm">Confirm password</label>
    <input id="confirm" name="confirm" type="password" autocomplete="new-password">
  </div>

  <button id="go" type="submit">Log in</button>
  <div class="msg" id="msg" role="status" aria-live="polite"></div>
</form>
<script>
  var setting = false;
  var el = function (id) { return document.getElementById(id); };
  function say(text, ok) {
    var m = el('msg');
    m.textContent = text;
    m.className = 'msg ' + (ok ? 'good' : 'bad');
  }
  fetch('/api/auth/status').then(function (r) { return r.json(); }).then(function (s) {
    if (s.loggedIn && s.passwordSet) { location.href = '/'; return; }
    setting = !s.passwordSet;
    if (!setting) return;
    el('title').textContent = 'Set a password';
    el('sub').textContent = 'Nobody has claimed this instance yet. Pick a password and it is yours -- '
      + 'it is what you will type to reach this from anywhere else. At least '
      + s.minPasswordLength + ' characters.';
    el('go').textContent = 'Set password';
    el('password').setAttribute('autocomplete', 'new-password');
    el('confirm-row').className = '';
    if (s.needsSetupCode) {
      el('setup-code-row').className = '';
      el('sub').textContent += ' Because you are not on the machine itself, it also needs '
        + 'the setup code printed on that machine&#39;s console.';
    }
  }).catch(function () { say('Could not reach the server.', false); });

  el('f').addEventListener('submit', function (event) {
    event.preventDefault();
    var password = el('password').value;
    if (setting && password !== el('confirm').value) { say('The two passwords do not match.', false); return; }
    el('go').disabled = true;
    say('', true);
    var body = setting
      ? { password: password, setupCode: el('setupCode').value }
      : { password: password };
    fetch(setting ? '/api/auth/password' : '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, data: data }; });
    }).then(function (result) {
      if (!result.ok) { say(result.data.error || 'That did not work.', false); el('go').disabled = false; return; }
      say(setting ? 'Password set. Opening...' : 'Welcome back.', true);
      location.href = '/';
    }).catch(function () {
      say('Could not reach the server.', false);
      el('go').disabled = false;
    });
  });
</script>
</body>
</html>`;
  }

  /** Constant-time check of an incoming `Authorization: Basic ...` header's password against `lock`. */
  private async isAuthorizedBasic(req: http.IncomingMessage, lock: PasswordLock): Promise<boolean> {
    if (!lock.required) return true;
    const header = req.headers.authorization ?? '';
    const match = /^Basic\s+(\S+)$/i.exec(header);
    if (!match) return false;
    let decoded: string;
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
      return false;
    }
    const sep = decoded.indexOf(':');
    const suppliedPassword = sep === -1 ? decoded : decoded.slice(sep + 1);
    return lock.check(suppliedPassword);
  }

  /**
   * Refuse an unauthenticated request.
   *
   * A browser asking for a page gets sent to the login page -- that is the
   * point of having one, and the native Basic-auth box it used to get instead
   * cannot say "set a password" or "here is where the setup code goes".
   * Anything else (fetch, curl, a script) gets the JSON 401 and the Basic
   * challenge it has always got, so nothing that worked before stops working.
   */
  private requireAuth(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.setSecurityHeaders(res);
    const wantsHtml = (req.headers.accept ?? '').includes('text/html');
    if (wantsHtml) {
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Neuroclaw", charset="UTF-8"');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: this.setupOnly ? 'No password is set yet. Open /login to set one.' : 'Authentication required',
      login: '/login',
      passwordSet: this.remoteAccess.isSet(),
    }));
  }

  /**
   * Gate for /api/chat-groups/* specifically, checked via a plain header
   * (not Authorization: Basic -- the chat-groups page shows its own login
   * form rather than the browser's native basic-auth prompt) so it can be
   * locked independently of remoteAccessLock, including over an
   * already-trusted localhost connection.
   */
  private async isChatGroupsAuthorized(req: http.IncomingMessage): Promise<boolean> {
    if (!this.chatGroupsLock.required) return true;
    const supplied = req.headers['x-chat-groups-password'];
    if (typeof supplied !== 'string') return false;
    return this.chatGroupsLock.check(supplied);
  }

  private requireChatGroupsAuth(res: http.ServerResponse): void {
    this.setSecurityHeaders(res);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Chat groups password required' }));
  }

  async stop(): Promise<void> {
    if (!this.server) throw new Error('Server not running');
    this.pytorchWorker.shutdown();
    return new Promise<void>((resolve) => {
      this.server?.close(() => { this.server = null; resolve(); });
    });
  }

  getPort(): number { return this.port; }

  private setSecurityHeaders(res: http.ServerResponse): void {
    // Security: Restricted CORS and standard security headers
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';");
  }

  private sendJson(res: http.ServerResponse, data: unknown, statusCode = 200): void {
    this.setSecurityHeaders(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendHtml(res: http.ServerResponse, html: string): void {
    this.setSecurityHeaders(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /**
   * Turn a thrown error into a response, using the status the error carries.
   *
   * Every POST handler used to answer 500 for anything parseBody rejected --
   * malformed JSON, a missing content type, a body over the limit. All three
   * are the CALLER's mistake, and 500 tells a caller the opposite: that the
   * request was fine and this server broke. A client retrying a 500 is doing
   * the right thing for a 500 and the wrong thing for a body it will never
   * fix, and monitoring counts it against this server's error rate.
   */
  private sendError(res: http.ServerResponse, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    const status = statusForError(err);
    this.sendJson(res, { error: msg }, status);
  }

  private async parseBody(req: http.IncomingMessage): Promise<unknown> {
    // CSRF: this server has no auth and setSecurityHeaders() never sends
    // Access-Control-Allow-Origin, so cross-origin JS can't *read* a
    // response -- but that alone doesn't stop the *request* from being
    // sent and acted on. A POST whose Content-Type is one of the CORS
    // "simple" types (text/plain, multipart/form-data,
    // application/x-www-form-urlencoded) never triggers a preflight, so
    // any page a victim's browser has open could silently POST here
    // (e.g. to /api/apps/launch, which passes body.command straight to
    // AppLauncher.launch() with no allowlist) and have it processed
    // before this fix. Requiring the real application/json content type
    // forces a real preflight for every POST body this server accepts --
    // and that preflight gets rejected by the browser itself, since no
    // Access-Control-Allow-Origin is ever sent back.
    assertJsonContentType(req.headers['content-type'] ?? '');
    const LIMIT = 1024 * 1024; // 1MB limit
    let totalSize = 0;
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > LIMIT) {
          req.destroy();
          reject(new HttpClientError('Request body too large (limit: 1MB)', 413));
        } else {
          chunks.push(chunk);
        }
      });
      req.on('end', () => {
        if (totalSize > LIMIT) return;
        const raw = Buffer.concat(chunks).toString('utf8');
        try { resolve(parseJsonBody(raw)); }
        catch (err) { reject(err); }
      });
      req.on('error', reject);
    });
  }

  /**
   * Shared by POST /api/extension/train-pytorch, /generate-coding-skills,
   * and /merge-with-saved: builds @definishon+scripting samples from a
   * plain neuron list the exact same way train-pytorch already does, then
   * trains them via the persistent PyTorchTrainerWorker. Extracted here
   * so the merge endpoint doesn't have to re-derive this logic to train
   * "the other" saved extension's neurons before averaging weights with
   * them.
   */
  private async trainNeuronsViaPyTorch(
    neurons: Array<{ name?: string; definition?: string; scripts?: Array<{ userSays?: string; response?: string }> }>,
    opts: { epochs?: number; learningRate?: number; tolerance?: number } = {},
  ): Promise<
    | { ok: true; names: string[]; W: number[][]; b: number[][]; samples: Array<{ readout: number; input: number[]; target: number[] }>; trainedNeurons: string[]; epochsRun: number; converged: boolean; torchVersion: string }
    | { ok: false; error: string }
  > {
    const dims = 16;
    const { embedText } = await import('../models && skills/core/neuro-lang.js');
    const definitionTrigger = new Array(dims).fill(0.7);

    type Sample = { readout: number; input: number[]; target: number[] };
    const samples: Sample[] = [];
    const names: string[] = [];
    for (const n of neurons) {
      if (!n.name) continue;
      const def = (n.definition ?? '').trim();
      const scripts = (n.scripts ?? []).filter(s => (s.userSays ?? '').trim() && (s.response ?? '').trim());
      if (!def && scripts.length === 0) continue;
      const readout = names.length;
      names.push(n.name);
      if (def) samples.push({ readout, input: definitionTrigger, target: embedText(def, dims) });
      for (const s of scripts) {
        samples.push({ readout, input: embedText(s.userSays!.trim(), dims), target: embedText(s.response!.trim(), dims) });
      }
    }

    if (samples.length === 0) {
      return { ok: true, names: [], W: [], b: [], samples: [], trainedNeurons: [], epochsRun: 0, converged: true, torchVersion: '' };
    }

    const path = await import('node:path');
    const scriptPath = path.resolve(process.cwd(), 'extension-builder', 'pytorch_trainer.py');
    const result = await this.pytorchWorker.send(scriptPath, {
      dims, numReadouts: names.length,
      epochs: opts.epochs ?? 1000, learningRate: opts.learningRate ?? 0.05, tolerance: opts.tolerance ?? 1e-3,
      samples,
    });
    if (result.ok === false) return { ok: false, error: result.error };

    const satisfiedReadouts = new Set<number>();
    const failedReadouts = new Set<number>();
    samples.forEach((s, i) => {
      if (result.sampleConverged[i]) satisfiedReadouts.add(s.readout); else failedReadouts.add(s.readout);
    });
    const trainedNeurons = names.filter((_, i) => satisfiedReadouts.has(i) && !failedReadouts.has(i));

    return {
      ok: true, names, W: result.W, b: result.b, samples,
      trainedNeurons, epochsRun: result.epochsRun, converged: result.converged, torchVersion: result.torchVersion,
    };
  }

  /**
   * "Integrate it into the runner of the model": every real Extension
   * Builder deliverable this session (Main Network, Coding Skills
   * Network, the merged network, ...) only ever became part of the live
   * agent when POST /api/extension/register happened to be called during
   * that one server process's lifetime -- system.memory.remember() has
   * no persistence of its own, so a trained network was invisible to the
   * agent again the moment the server restarted, with nothing to reload
   * it. This is the fix: on every real server boot, read every
   * previously saved extension file (extension-builder/extensions/*.ext.json
   * -- the exact artifacts train(), trainWithPyTorch(), Save, and
   * Install already write) and remember() each one's definitions/scripts
   * into the live NeuroclawSystem, the same way register() does for one
   * extension at a time. A trained network is now a permanent property
   * of the runner, not a one-session fluke of whoever happened to click
   * a button.
   *
   * Deliberately best-effort: a missing directory, an unreadable file, or
   * malformed JSON in one saved extension must never stop the server from
   * finishing its boot sequence -- skip that one file and keep going.
   */
  /**
   * Remembers one trained skill script as a directly-matchable (trigger,
   * response) pair -- `content` is the trigger text alone (what actually
   * gets embedded and compared against a live query), `payload` is the
   * literal response text to return verbatim on a confident match. This
   * replaced an earlier version that flattened both into one sentence
   * ("When asked X, Y responds: Z") and stored no payload at all -- that
   * meant the trigger's own embedding was diluted by boilerplate text
   * around it, AND there was no way to recover the exact response
   * without re-parsing the flattened sentence. Both are fixed here.
   *
   * Pinned, because an installed skill is knowledge the user deliberately
   * added: capacity eviction may drop what the system merely observed, but
   * never what someone installed.
   *
   * Tagged 'skill-script' (plus the source extension's name) so
   * bot-service.ts's live skill-match fast path (see SKILL_MATCH_THRESHOLD
   * there) can query this exact tag rather than mixing skill triggers in
   * with ordinary chat-turn memories.
   */
  private rememberSkillScript(
    system: { memory: { remember: (content: string, opts: { importance?: number; tags?: string[]; payload?: string; pinned?: boolean }) => unknown } },
    userSays: string,
    response: string,
    extName: string,
  ): void {
    system.memory.remember(userSays, { importance: 0.7, tags: ['skill-script', extName], payload: response, pinned: true });
  }

  /**
   * The actual "install a skill into the live system" logic -- wiring a
   * project's neuron definitions/scripts into this process's live
   * NeuroclawSystem memory, exactly as POST /api/extension/register has
   * done for a project built in the visual editor. Extracted so
   * POST /api/skill-uploads/:name/install-skill (a package's uploaded
   * binarySkill/sourceSkill file) goes through the identical real path
   * instead of a second, easy-to-drift copy of the same logic.
   */
  private async installSkillProject(
    name: string,
    neurons: Array<{ name?: string; value?: number; definition?: string; connections?: SkillNeuron['connections']; scripts?: Array<{ userSays?: string; response?: string }> }>,
  ): Promise<{ remembered: number; grafted: { added: number; connections: number; neuronCount: number; skipped?: string } }> {
    const { getNeuroclawSystem } = await import('../src/index.js');
    const system = await getNeuroclawSystem();

    // The graft, and the reason a net skill is a net skill: the neurons join
    // the main network, all-to-all, computed by the same hyperdimensional
    // equation and the same wave layer as everything already there. Before
    // this, installing turned a built network into sentences in long-term
    // memory and left the network itself untouched -- the agent could recall
    // what the skill was for and could not think with it, which is a prompting
    // skill wearing a net skill's name.
    //
    // Best effort on purpose: a network that has not been built yet (nothing
    // has run through the pipeline) has nothing to graft into, and that must
    // not stop the install -- the definitions below are still worth having.
    let grafted = { added: 0, connections: 0, neuronCount: 0, skipped: 'no network to join yet' as string | undefined };
    try {
      // ensureBrain(), not getHyperEngine(): on a fresh boot nothing has run
      // yet, and a skill that found no network to join would quietly fall back
      // to being a sentence in memory -- the exact difference this graft
      // exists to remove.
      const engine = system.pipeline.ensureBrain();
      if (engine) {
        const result = graftNetSkill(engine, name, neurons);
        grafted = {
          added: result.added,
          connections: result.connections,
          neuronCount: result.neuronCount,
          skipped: result.skipped,
        };
      }
    } catch (err) {
      grafted.skipped = err instanceof Error ? err.message : String(err);
    }

    let remembered = 0;
    for (const n of neurons) {
      if (!n.name) continue;
      const def = (n.definition ?? '').trim();
      if (def) {
        system.memory.remember(`${n.name}: ${def}`, { importance: 0.7, tags: ['extension', name], pinned: true });
        remembered++;
      }
      // Scripts are equally real recallable knowledge -- "when asked X,
      // the trained response is Y" is exactly what train()'s
      // trainDefinitions() pass shapes the mesh toward; recall() should
      // be able to surface it the same way a @definishon can. Also
      // reachable via bot-service.ts's live skill-match fast path
      // (see rememberSkillScript()'s own doc comment).
      for (const s of n.scripts ?? []) {
        const userSays = (s.userSays ?? '').trim();
        const response = (s.response ?? '').trim();
        if (!userSays || !response) continue;
        this.rememberSkillScript(system, userSays, response, name);
        remembered++;
      }
    }
    return { remembered, grafted };
  }

  /** Parses a skill file's { neurons: [...] } JSON, the shape install-skill and run-rsi-test both need. Throws a plain Error with a message safe to send straight to the client. */
  private parseSkillNeuronsFile(
    file: { filename: string; content: string },
  ): Array<{ name?: string; value?: number; definition?: string; scripts?: Array<{ userSays?: string; response?: string }> }> {
    let parsed: { neurons?: unknown };
    try {
      parsed = JSON.parse(file.content);
    } catch {
      throw new Error(`"${file.filename}" isn't valid JSON -- expected { neurons: [...] }`);
    }
    const neurons = Array.isArray(parsed?.neurons) ? parsed.neurons : [];
    if (neurons.length === 0) {
      throw new Error(`"${file.filename}" has no neurons array to install`);
    }
    return neurons;
  }

  /**
   * Dynamically imports an uploaded skill package's .js/.mjs file (the same
   * genuine code-execution path install-plugin uses) and returns its
   * default export (or, failing that, its first exported function) as a
   * callable. Used by run-algorithm and run-rsi-test, which both need to
   * actually execute an uploaded script rather than just read it.
   */
  private async importSkillUploadScript(name: string, file: { filename: string }): Promise<(...args: unknown[]) => unknown> {
    if (!/\.(mjs|js)$/i.test(file.filename)) {
      throw new Error(
        `"${file.filename}" is not a .js/.mjs file -- no TypeScript compiler is available at runtime to run a .ts file this way.`,
      );
    }
    const path = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const filePath = path.resolve(process.cwd(), 'extension-builder', 'extensions', name, file.filename);
    const moduleUrl = `${pathToFileURL(filePath).href}?t=${Date.now()}`;
    const mod = await import(/* @vite-ignore */ moduleUrl);
    const candidate = mod.default ?? Object.values(mod).find((v) => typeof v === 'function');
    if (typeof candidate !== 'function') {
      throw new Error(`"${file.filename}" doesn't export a function (checked default export and named exports)`);
    }
    return candidate as (...args: unknown[]) => unknown;
  }

  private async loadSavedExtensions(): Promise<{ files: number; remembered: number; graftedNeurons: number }> {
    try {
      const path = await import('node:path');
      const { promises: fs } = await import('node:fs');
      const dir = path.resolve(process.cwd(), 'extension-builder', 'extensions');
      let allEntries: string[];
      try {
        allEntries = await fs.readdir(dir);
      } catch {
        return { files: 0, remembered: 0, graftedNeurons: 0 }; // no extensions directory yet -- nothing to load, not an error
      }
      // Both the quantized (*.ext.json -- the historical format, still what
      // conversation-learning-agent.mjs and the manual /api/extension/register
      // endpoint below write) and unquantized (*.source.json -- what
      // scripts/skill-agent.mjs publishes per skill, see wiki/Self-Improvement.md's
      // "five things") artifact shapes carry the same {project|name, neurons}
      // structure below -- loading only *.ext.json silently never picked up
      // any skill-agent-published skill at all.
      const entries = allEntries.filter(f => f.endsWith('.ext.json') || f.endsWith('.source.json'));
      if (entries.length === 0) return { files: 0, remembered: 0, graftedNeurons: 0 };

      const { getNeuroclawSystem } = await import('../src/index.js');
      const system = await getNeuroclawSystem();

      let filesLoaded = 0;
      let remembered = 0;
      let graftedNeurons = 0;
      for (const filename of entries) {
        let data: { project?: { name?: string }; name?: string; neurons?: Array<{ name?: string; definition?: string; scripts?: Array<{ userSays?: string; response?: string }> }> };
        try {
          data = JSON.parse(await fs.readFile(path.join(dir, filename), 'utf8'));
        } catch {
          continue; // malformed/unreadable -- skip this one file, don't fail the boot
        }
        const extName = data.project?.name ?? data.name ?? filename;
        const neurons = Array.isArray(data.neurons) ? data.neurons : [];
        if (neurons.length === 0) continue;
        filesLoaded++;

        // Back into the mesh, on every boot. An installed net skill whose
        // neurons only existed in the session someone clicked Install in was
        // a net skill for one session and a paragraph of text ever after.
        try {
          const engine = system.pipeline.ensureBrain();
          const result = graftNetSkill(engine, extName, neurons);
          graftedNeurons += result.added;
        } catch {
          // A skill that cannot be grafted still gets remembered below. Losing
          // the graft is bad; losing the whole boot is worse.
        }

        for (const n of neurons) {
          if (!n.name) continue;
          const def = (n.definition ?? '').trim();
          if (def) {
            system.memory.remember(`${n.name}: ${def}`, { importance: 0.7, tags: ['extension', extName], pinned: true });
            remembered++;
          }
          for (const s of n.scripts ?? []) {
            const userSays = (s.userSays ?? '').trim();
            const response = (s.response ?? '').trim();
            if (!userSays || !response) continue;
            this.rememberSkillScript(system, userSays, response, extName);
            remembered++;
          }
        }
      }
      return { files: filesLoaded, remembered, graftedNeurons };
    } catch {
      return { files: 0, remembered: 0, graftedNeurons: 0 }; // never let a boot-time extension-load failure take the whole server down
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let parsedUrl: URL;
    try {
      // req.headers.host is a raw, attacker-controlled string with no
      // validation from Node's HTTP parser -- a malformed value (a space,
      // a non-numeric port, ...) makes new URL() throw TypeError: Invalid
      // URL. This runs before every route's own try/catch, as the raw
      // http.createServer callback with no .catch() and no process-wide
      // unhandledRejection handler, so an uncaught throw here crashed the
      // entire backend on one request, regardless of path or method.
      parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    } catch {
      this.sendJson(res, { error: 'Invalid request' }, 400);
      return;
    }
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    if (method === 'OPTIONS') {
      // No credentials are ever readable from a CORS preflight, so gating
      // it behind auth would only break legitimate preflighted requests --
      // the real request right after this is still checked below.
      this.setSecurityHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    // Wiki reads (and, in the POST handler below, *creating a new* page)
    // are exempt from remoteAccessLock, same reasoning as the OPTIONS
    // preflight above but for a different property: the wiki is meant to
    // be shared knowledge ("Public Shared AI Knowledge Database") anyone
    // should be able to read AND contribute to, not one of the sensitive
    // capabilities (terminal-adjacent app launching, file/extension
    // writes, ...) start()'s own doc comment says the password exists to
    // protect. This is deliberately narrower than "all wiki writes":
    // DELETE, and a POST that would *overwrite an existing* page, still go
    // through the normal gate -- letting anyone contribute a brand-new
    // page must never mean letting anyone deface or destroy what's already
    // there. The POST handler itself enforces the create-vs-overwrite
    // split (it needs to inspect the request body first); this exemption
    // only lets the request past the blanket gate to reach that check.
    //
    // The chat rooms are public on the same terms and for the same reason --
    // see isSharedChatPublicRoute -- and the login routes are public because
    // they are how someone stops being unauthenticated in the first place.
    const publicRoute =
      isWikiPublicRoute(pathname, method) ||
      isStorePublicRoute(pathname, method) ||
      isSharedChatPublicRoute(pathname, method) ||
      isAuthPublicRoute(pathname, method);

    // Bound remotely with no password set: only the login page answers, and
    // even the things that are normally public stay shut. An instance nobody
    // has claimed yet should not be publishing chat rooms to the internet.
    if (this.setupOnly && !isAuthPublicRoute(pathname, method)) {
      this.requireAuth(req, res);
      return;
    }

    if (!publicRoute && !(await this.isRemotelyAuthorized(req))) {
      this.requireAuth(req, res);
      return;
    }

    // ── Logging in ──────────────────────────────────────────────────────

    if (pathname === '/login' && method === 'GET') {
      this.sendHtml(res, this.loginPage());
      return;
    }

    // What the login page needs to know before anyone has typed anything:
    // whether this instance has a password at all (so it can show "set one"
    // rather than "enter it"), and whether the caller is already logged in.
    if (pathname === '/api/auth/status' && method === 'GET') {
      this.sendJson(res, {
        passwordSet: this.remoteAccess.isSet(),
        loggedIn: await this.isRemotelyAuthorized(req),
        onThisMachine: this.isFromThisMachine(req),
        needsSetupCode: !this.remoteAccess.isSet() && !this.isFromThisMachine(req),
        minPasswordLength: MIN_PASSWORD_LENGTH,
      });
      return;
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await this.parseBody(req) as Record<string, unknown> | null;
      const password = typeof body?.password === 'string' ? body.password : '';
      if (!this.remoteAccess.isSet()) {
        this.sendJson(res, { error: 'No password has been set on this instance yet.' }, 400);
        return;
      }
      if (!(await this.remoteAccess.check(password))) {
        // One message for both "no such password" and "wrong password", and
        // no timing shortcut: check() hashes before comparing either way.
        this.sendJson(res, { error: 'Wrong password.' }, 401);
        return;
      }
      const token = this.remoteAccess.openSession();
      this.setSecurityHeaders(res);
      res.setHeader('Set-Cookie',
        `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ loggedIn: true }));
      return;
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      this.remoteAccess.closeSession(readCookie(req.headers.cookie, SESSION_COOKIE));
      this.setSecurityHeaders(res);
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ loggedIn: false }));
      return;
    }

    // Set the password, or change it. Who is allowed is decided here rather
    // than in the store, which knows nothing about requests: someone at the
    // machine itself, someone holding the setup code from its console, or
    // someone who can already prove they know the current password.
    if (pathname === '/api/auth/password' && method === 'POST') {
      const body = await this.parseBody(req) as Record<string, unknown> | null;
      const password = typeof body?.password === 'string' ? body.password : '';
      const alreadySet = this.remoteAccess.isSet();
      const authorised = alreadySet
        ? this.isFromThisMachine(req) ||
          await this.isRemotelyAuthorized(req) ||
          (typeof body?.current === 'string' && await this.remoteAccess.check(body.current))
        : this.isFromThisMachine(req) || this.remoteAccess.checkSetupCode(body?.setupCode);
      try {
        await this.remoteAccess.set(password, authorised);
      } catch (err) {
        const message = err instanceof RemoteAccessError ? err.message : 'Could not set the password.';
        this.sendJson(res, { error: message }, authorised ? 400 : 403);
        return;
      }
      // Setting a password is what ends setup mode -- the instance is claimed,
      // and everything else can start answering.
      this.setupOnly = false;
      // Straight into a session, so nobody has to type it twice.
      const token = this.remoteAccess.openSession();
      this.setSecurityHeaders(res);
      res.setHeader('Set-Cookie',
        `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ passwordSet: true, loggedIn: true }));
      return;
    }

    // Unauthenticated on purpose (a boolean, nothing sensitive) -- the
    // chat-groups page needs to know whether to show its login form
    // *before* it has a password to send.
    if (pathname === '/api/chat-groups/lock-status' && method === 'GET') {
      this.sendJson(res, { locked: this.chatGroupsLock.required });
      return;
    }

    if (pathname.startsWith('/api/chat-groups/') && !(await this.isChatGroupsAuthorized(req))) {
      this.requireChatGroupsAuth(res);
      return;
    }

    if (pathname === '/' && method === 'GET') {
      this.sendHtml(res, HTML_TEMPLATE);
      return;
    }

    // ── The public store ────────────────────────────────────────────────
    // Everything published lives in `store/` at the repo root and travels with
    // the repository, so anyone who clones or pulls has the whole catalogue
    // without an account, a server, or access to the publisher's machine.

    if (pathname === '/api/store' && method === 'GET') {
      this.sendJson(res, { kinds: STORE_KINDS, labels: STORE_KIND_LABELS, catalog: listCatalog() });
      return;
    }

    // Publish or update an item. Open, like wiki creation.
    if (pathname === '/api/store' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as Record<string, unknown> | null;
        if (!body || typeof body.kind !== 'string' || typeof body.name !== 'string') {
          this.sendJson(res, { error: 'Expected "kind" and "name" strings.' }, 400);
          return;
        }
        // publishAndSync, not publishItem: writing the files is only half a
        // publish. The response carries the real sync outcome so the UI can
        // say "shared with everyone" or "saved on this device only" truthfully
        // rather than implying the item reached GitHub when it did not.
        const { item, sync } = await publishAndSync({
          kind: body.kind,
          name: body.name,
          title: typeof body.title === 'string' ? body.title : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
          author: typeof body.author === 'string' ? body.author : undefined,
          files: Array.isArray(body.files) ? (body.files as StoreFile[]) : [],
        });
        this.sendJson(res, { ...item, sync }, 201);
      } catch (err) {
        this.sendJson(
          res,
          { error: err instanceof Error ? err.message : String(err) },
          err instanceof StoreError ? 400 : 500
        );
      }
      return;
    }

    // ── Installing store items on this device ───────────────────────────
    // Publishing is open, because it shares something. Installing changes how
    // THIS machine behaves, so it goes through the normal gate -- the same
    // split prompting skills already draw. Nothing installs by being browsed.

    if (pathname === '/api/store/installed' && method === 'GET') {
      try {
        const { listInstalledItems, outdatedInstalls } = await import('../models && skills/core/store-install.js');
        this.sendJson(res, {
          installed: listInstalledItems(),
          outdated: outdatedInstalls().map(o => ({
            kind: o.record.kind,
            name: o.record.name,
            installedVersion: o.record.installedVersion,
            publishedVersion: o.published.updatedAt,
          })),
        });
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    if (pathname === '/api/store/install' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { kind?: string; name?: string } | null;
        if (typeof body?.kind !== 'string' || typeof body?.name !== 'string') {
          this.sendJson(res, { error: 'Expected { kind, name }.' }, 400);
          return;
        }
        const { installItem, planActivation } = await import('../models && skills/core/store-install.js');
        const installed = await installItem(body.kind, body.name);

        // Installing used to stop at copying files -- nothing ever read them
        // back, so an installed skill was inert. Whatever the item carries that
        // this system understands is loaded now, pinned like every other piece
        // of installed knowledge. This is not automatic installation: someone
        // asked for this specific item, and loading what they installed is the
        // point of installing it.
        const plan = planActivation(body.kind, body.name);
        let remembered = 0;
        let joinedMesh = 0;

        // A net skill joins the shared all-to-all mesh, which is what makes it
        // part of the network rather than a note about one. A prompting skill
        // carries no neurons and simply does not reach this.
        if (plan.neurons.length > 0) {
          try {
            const { getNeuroclawSystem } = await import('../src/index.js');
            const system = await getNeuroclawSystem();
            const ids = system.pluginRegistry.joinMesh(
              `installed:${body.kind}/${body.name}`,
              body.name,
              plan.neurons.length,
            );
            joinedMesh = ids.length;
          } catch (err) {
            // Failing to wire the mesh must not lose the install: the files are
            // on disk and the memories still load.
            console.warn('[store] could not wire the installed skill into the mesh:', err instanceof Error ? err.message : err);
          }
        }
        if (plan.memories.length > 0) {
          const { getNeuroclawSystem } = await import('../src/index.js');
          const system = await getNeuroclawSystem();
          for (const memory of plan.memories) {
            system.memory.remember(memory.content, {
              importance: 0.7,
              tags: memory.tags,
              payload: memory.payload,
              pinned: true,
            });
            remembered++;
          }
        }
        this.sendJson(
          res,
          { ...installed, activated: { remembered, joinedMesh, from: plan.from, note: plan.nothingLoadable } },
          201,
        );
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return;
    }

    // Uninstalling removes only this device's copy, so unlike deleting from
    // the store it destroys nobody else's work.
    if (pathname === '/api/store/uninstall' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { kind?: string; name?: string } | null;
        if (typeof body?.kind !== 'string' || typeof body?.name !== 'string') {
          this.sendJson(res, { error: 'Expected { kind, name }.' }, 400);
          return;
        }
        const { uninstallItem } = await import('../models && skills/core/store-install.js');
        this.sendJson(res, { removed: uninstallItem(body.kind, body.name) });
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return;
    }

    if (pathname === '/api/store/update' && method === 'POST') {
      try {
        const { updateInstalls } = await import('../models && skills/core/store-install.js');
        this.sendJson(res, await updateInstalls());
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    // Download one published file. Served as an attachment so a click saves it
    // rather than rendering a binary into the page.
    // The filename part accepts '/' so a nested file (scripts/run.py) is
    // reachable. It is NOT trusted for being in the URL: assertSafeFilename
    // and readItemFile's containment check are what actually guard it.
    const fileMatch = pathname.match(/^\/api\/store\/([a-z]+)\/([A-Za-z0-9._-]+)\/file\/(.+)$/);
    if (fileMatch && method === 'GET') {
      try {
        // Downloads on click. The catalogue lists everything published; the
        // bytes come down only when someone actually asks for this file, and
        // are cached afterwards so the device ends up holding exactly what its
        // owner chose to use.
        const { fetchItemFile } = await import('../models && skills/core/store-fetch.js');
        let buf: Buffer;
        try {
          ({ buf } = await fetchItemFile(fileMatch[1], fileMatch[2], fileMatch[3]));
        } catch (fetchErr) {
          // Reported rather than flattened to "not found": "we could not reach
          // GitHub" and "that file does not exist" are different problems and
          // the person needs to know which one they have.
          this.sendJson(res, { error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) }, 502);
          return;
        }
        if (!buf) {
          this.sendJson(res, { error: 'No such file.' }, 404);
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': buf.length,
          'Content-Disposition': `attachment; filename="${fileMatch[3]}"`,
        });
        res.end(buf);
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return;
    }

    const itemMatch = pathname.match(/^\/api\/store\/([a-z]+)\/([A-Za-z0-9._-]+)$/);
    if (itemMatch && method === 'GET') {
      try {
        const item = readItem(itemMatch[1], itemMatch[2]);
        if (!item) {
          this.sendJson(res, { error: 'Not found.' }, 404);
          return;
        }
        this.sendJson(res, item);
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return;
    }

    // ── Computer access: the off switches ───────────────────────────────
    // Everything here sits behind the blanket password gate, which is the
    // right default for it: these routes decide what the agent may do to the
    // machine. Turning access OFF is offered to the agent too (see
    // plugins/computer-access.ts); turning it back ON is only ever here,
    // because an agent that can restore its own access has no off switch.

    if (pathname === '/api/access' && method === 'GET') {
      try {
        const { describeAccess, sharedAccessManager } = await import('../models && skills/core/access-settings.js');
        this.sendJson(res, describeAccess(sharedAccessManager()));
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    if (pathname === '/api/access/switch' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { name?: string; on?: boolean } | null;
        const { ACCESS_SWITCHES } = await import('../models && skills/core/access-manager.js');
        const { describeAccess, sharedAccessManager } = await import('../models && skills/core/access-settings.js');
        if (!body || !(ACCESS_SWITCHES as readonly string[]).includes(String(body.name)) || typeof body.on !== 'boolean') {
          this.sendJson(res, { error: `Expected { name: ${ACCESS_SWITCHES.join('|')}, on: boolean }` }, 400);
          return;
        }
        const manager = sharedAccessManager();
        manager.setSwitch(body.name as (typeof ACCESS_SWITCHES)[number], body.on);
        this.sendJson(res, describeAccess(manager));
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    // Granting and revoking one capability at a time. A grant below the level
    // a capability requires is refused rather than quietly raised, so this
    // returns the AccessManager's own error text instead of inventing one.
    if (pathname === '/api/access/capability' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { capability?: string; level?: string | null; paths?: string[] } | null;
        const { CAPABILITIES, ACCESS_LEVELS } = await import('../models && skills/core/access-manager.js');
        const { describeAccess, sharedAccessManager, saveSettings } = await import('../models && skills/core/access-settings.js');
        if (!body || !(CAPABILITIES as readonly string[]).includes(String(body.capability))) {
          this.sendJson(res, { error: 'Expected { capability, level } where capability is a known capability.' }, 400);
          return;
        }
        const manager = sharedAccessManager();
        const capability = body.capability as (typeof CAPABILITIES)[number];
        if (body.level === null) {
          manager.revoke(capability);
        } else if ((ACCESS_LEVELS as readonly string[]).includes(String(body.level))) {
          manager.grant({
            capability,
            level: body.level as (typeof ACCESS_LEVELS)[number],
            paths: Array.isArray(body.paths) ? body.paths : undefined,
          });
        } else {
          this.sendJson(res, { error: `level must be null or one of ${ACCESS_LEVELS.join(', ')}.` }, 400);
          return;
        }
        // Grants are only persisted on a switch flip otherwise, and a grant
        // that vanishes at restart is the same broken promise as a switch
        // that does.
        saveSettings({ switches: manager.switchState(), grants: manager.list() });
        this.sendJson(res, describeAccess(manager));
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return;
    }

    // What this machine can actually do graphically. Reports rather than
    // pretends: no session, or a missing tool, comes back as plain text.
    if (pathname === '/api/access/probe' && method === 'GET') {
      try {
        const { DesktopControl } = await import('../models && skills/core/desktop-control.js');
        const { sharedAccessManager } = await import('../models && skills/core/access-settings.js');
        this.sendJson(res, await new DesktopControl(sharedAccessManager()).probe());
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    // ── Auto-update ─────────────────────────────────────────────────────
    // Checking is safe and changes nothing, so it is open. Applying rewrites
    // the working tree and can move code out from under the running process,
    // so it is gated like every other destructive operation here.

    if (pathname === '/api/updates' && method === 'GET') {
      try {
        const { checkForUpdates } = await import('../models && skills/core/auto-update.js');
        this.sendJson(res, await checkForUpdates());
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    if (pathname === '/api/updates/apply' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { code?: boolean; store?: boolean } | null;
        const { applyUpdates } = await import('../models && skills/core/auto-update.js');
        this.sendJson(res, await applyUpdates(body ?? {}));
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    // ── Memory files: what the agent remembers ──────────────────────────
    // Reading is open (it is this instance's own knowledge, and the wiki and
    // store are readable too). Forgetting is NOT -- it is destruction, and it
    // is gated for the same reason wiki and store deletion are.

    if (pathname === '/api/memory' && method === 'GET') {
      try {
        const { getNeuroclawSystem } = await import('../src/index.js');
        const system = await getNeuroclawSystem();
        const q = parsedUrl.searchParams.get('q')?.trim() ?? '';
        const tag = parsedUrl.searchParams.get('tag')?.trim() ?? '';
        const limit = Math.min(500, Math.max(1, Number(parsedUrl.searchParams.get('limit') ?? 100)));

        const all = system.memory.all();
        // Tag counts come from everything, not the filtered page, so the
        // summary does not silently change meaning as you search.
        const tagCounts: Record<string, number> = {};
        for (const item of all) for (const t of item.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;

        const needle = q.toLowerCase();
        const filtered = all
          .filter(item => !tag || item.tags.includes(tag))
          .filter(item => !needle || `${item.content} ${item.payload ?? ''}`.toLowerCase().includes(needle))
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, limit)
          .map(item => ({
            id: item.id,
            content: item.content,
            payload: item.payload,
            tags: item.tags,
            importance: item.importance,
            accessCount: item.accessCount,
            timestamp: item.timestamp,
            // Pinned items are installed knowledge and survive eviction; saying
            // so is the difference between "this will stay" and "this may go".
            pinned: item.pinned === true,
          }));

        this.sendJson(res, { total: all.length, capacityNote: 'pinned memories are exempt from eviction', tagCounts, memories: filtered });
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    // DELETE /api/memory/all — forget everything: every remembered item,
    // every AI Chat thread, and every shared chat room.
    //
    // Never public, and it never can be. It is behind the blanket gate above
    // like all destruction, and it is deliberately not one of the
    // isWikiPublicRoute / isStorePublicRoute / isSharedChatPublicRoute
    // exemptions: those exist so anyone can ADD to what is shared, and the
    // reason that is safe is precisely that this is not open to them.
    //
    // Requires an explicit `{ "confirm": "delete everything" }` body. A button
    // that empties someone's whole memory should be impossible to fire by
    // accident, by a mistyped URL, or by a stray DELETE from some other tool.
    if (pathname === '/api/memory/all' && method === 'DELETE') {
      try {
        const body = await this.parseBody(req) as Record<string, unknown> | null;
        if (body?.confirm !== 'delete everything') {
          this.sendJson(res, { error: 'Send {"confirm":"delete everything"} to confirm.' }, 400);
          return;
        }
        const { getNeuroclawSystem } = await import('../src/index.js');
        const system = await getNeuroclawSystem();
        const memories = system.memory.forgetAll();
        const threads = this.chatHistory.deleteAllThreads();
        const rooms = getSharedChatStore().deleteAllRooms();
        this.sendJson(res, { memories, threads, rooms });
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    const memoryMatch = pathname.match(/^\/api\/memory\/([A-Za-z0-9._-]+)$/);
    if (memoryMatch && method === 'DELETE') {
      try {
        const { getNeuroclawSystem } = await import('../src/index.js');
        const system = await getNeuroclawSystem();
        const forgotten = system.memory.forget(memoryMatch[1]);
        this.sendJson(res, { forgotten }, forgotten ? 200 : 404);
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    // ── Prompting skills ────────────────────────────────────────────────
    // The modular functions the agent calls inside its own perceive-think-act
    // loop. Publishing is open (it shares a document); installing is gated,
    // because it changes how this machine's agent actually behaves.

    if (pathname === '/api/prompting-skills' && method === 'GET') {
      const installed = listInstalled();
      const installedNames = new Set(installed.map(s => s.name));
      this.sendJson(res, {
        categories: PROMPTING_CATEGORIES,
        labels: PROMPTING_CATEGORY_LABELS,
        // The built-ins are reported separately so the UI can show that a
        // fresh install already has a working loop rather than three empty
        // steps -- and can mark which of them the user has since replaced.
        builtIn: builtInPromptingSkills().map(s => ({ ...s, replaced: installedNames.has(s.name) })),
        installed,
        active: loadRegistry().all(),
      });
      return;
    }

    const promptingMatch = pathname.match(/^\/api\/prompting-skills\/([A-Za-z0-9._-]+)$/);
    if (promptingMatch && method === 'GET') {
      try {
        const published = readPublishedPromptingSkill(promptingMatch[1]);
        if (!published) {
          this.sendJson(res, { error: 'No such published prompting skill.' }, 404);
          return;
        }
        this.sendJson(res, published);
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return;
    }

    // Publish: open, and pushed like every other publish so everyone who pulls
    // gets it.
    if (pathname === '/api/prompting-skills/publish' && method === 'POST') {
      try {
        const body = await this.parseBody(req);
        const { item, sync, skill } = await publishPromptingSkill(body);
        this.sendJson(res, { ...item, skill, sync }, 201);
      } catch (err) {
        this.sendJson(
          res,
          { error: err instanceof Error ? err.message : String(err) },
          err instanceof PromptingSkillError ? 400 : 500,
        );
      }
      return;
    }

    // POST /api/github/publish — push something public to GitHub with no
    // sign-up and no sign-in. The GitHub credential belongs to this
    // deployment, never to the caller; see plugins/github-publish.ts for why
    // that is what makes "no sign-in" real rather than a promise. Public like
    // every other publish route here, for the same reason: a publish gated
    // behind logging into THIS app would still be "sign in somewhere first".
    if (pathname === '/api/github/publish' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as Record<string, unknown> | null;
        if (!body || typeof body.name !== 'string' || !Array.isArray(body.files)) {
          this.sendJson(res, { error: 'Expected "name" (string) and "files" (array).' }, 400);
          return;
        }
        const { GithubPublishPlugin } = await import('../plugins/github-publish.js');
        const plugin = new GithubPublishPlugin({
          id: 'github-publish', name: 'GitHub Publish', type: 'api-connection', capabilities: [],
        });
        const result = await plugin.push({
          name: body.name,
          title: typeof body.title === 'string' ? body.title : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
          author: typeof body.author === 'string' ? body.author : undefined,
          files: body.files as Array<{ filename: string; content: string; encoding?: 'utf8' | 'base64' }>,
        });
        this.sendJson(res, result, result.pushed ? 201 : 202);
      } catch (err) {
        // Every throw from push() -- its own (empty payload, a weight file)
        // or publishAndSync()'s (bad name, too many files, over the size cap)
        // -- is a StoreError, the same distinction /api/store already makes.
        // A failure that is genuinely this server's (git unavailable, no
        // network, a rejected push) never throws: it comes back as
        // { pushed: false, reason } above.
        this.sendJson(
          res,
          { error: err instanceof Error ? err.message : String(err) },
          err instanceof StoreError ? 400 : 500,
        );
      }
      return;
    }

    // Install: from the store by name, or straight from a document the user or
    // the agent just wrote. Same endpoint, because both mean "the loop should
    // use this from now on" -- and re-installing under an existing name is how
    // an edit takes effect.
    if (pathname === '/api/prompting-skills/install' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as Record<string, unknown> | null;
        if (!body) {
          this.sendJson(res, { error: 'Expected a skill document or { "name": "..." }.' }, 400);
          return;
        }
        const skill = typeof body.name === 'string' && body.category === undefined
          ? installFromStore(body.name)
          : installPromptingSkill(body);
        this.sendJson(res, { installed: skill, active: loadRegistry().all() }, 201);
      } catch (err) {
        this.sendJson(
          res,
          { error: err instanceof Error ? err.message : String(err) },
          err instanceof PromptingSkillError ? 400 : 500,
        );
      }
      return;
    }

    if (promptingMatch && method === 'DELETE') {
      try {
        const name = promptingMatch[1];
        const removed = uninstallPromptingSkill(name);
        this.sendJson(
          res,
          {
            uninstalled: removed,
            // Removing an installed skill that shares a built-in's name
            // restores the built-in rather than leaving a hole, so the UI can
            // say so instead of the skill appearing to come back by itself.
            restoredBuiltIn: removed && isBuiltIn(name),
            active: loadRegistry().all(),
          },
          removed ? 200 : 404,
        );
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return;
    }

    // Removal is NOT public (see isStorePublicRoute): anyone may add, only an
    // authorised caller may destroy.
    if (itemMatch && method === 'DELETE') {
      try {
        // Pushed too, or the next pull would silently resurrect it.
        const { deleted, sync } = await deleteAndSync(itemMatch[1], itemMatch[2]);
        this.sendJson(res, { deleted, sync }, deleted ? 200 : 404);
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return;
    }

    if (pathname === '/api/status' && method === 'GET') {
      const status = this.runner.getStatus();
      this.sendJson(res, {
        running: status.running,
        uptime: Math.floor(status.uptime),
        subsystems: status.subsystems,
        // How many previously saved Extension Builder networks (Main
        // Network, Coding Skills Network, a merge, ...) this boot picked
        // up and remembered into the live agent -- see
        // loadSavedExtensions()'s own doc comment.
        loadedExtensions: this.loadedExtensions,
        llm: {
          neurons: status.llm.neuronCount,
          connections: status.llm.connectionCount,
          experts: status.llm.expertCount,
          expertsCount: status.llm.expertCount,
          generations: status.llm.generationCount,
          extensions: status.llm.selfExtensionCount,
          contextLength: status.llm.contextLength,
          valuePoints: status.llm.valueDistribution?.totalPoints ?? 0,
          hyperPatterns: status.llm.hyperPatternsSeen ?? 0,
          rlmExploration: (status.llm.rlmExplorationRate * 100).toFixed(1) + '%',
        },
      });
      return;
    }

    // GET /api/continuous/status — Section 4.1's continuous output loop
    // (startContinuous()/injectInput(), now actually running -- see
    // runner.ts's start()) genuinely never terminates; this reports its
    // real, current state (tick count, queued input, zip-io context held)
    // instead of the loop running invisibly with no way for a client to
    // ever observe "there is more, this isn't the whole context" versus
    // "the queue is actually empty right now."
    if (pathname === '/api/continuous/status' && method === 'GET') {
      this.sendJson(res, this.runner.getContinuousStatus());
      return;
    }

    // GET /api/net-skills — which net skills are actually IN the network, and
    // where each one's neurons live.
    //
    // The question this answers is the one that separates a net skill from a
    // prompting skill, and it used to be unanswerable: installing wrote
    // sentences into memory, so "is my skill part of the network" and "does
    // the agent have a note about my skill" looked identical from outside.
    // Now the mesh's own size and the skill's own neuron ids are the answer.
    if (pathname === '/api/net-skills' && method === 'GET') {
      try {
        const { getNeuroclawSystem } = await import('../src/index.js');
        const system = await getNeuroclawSystem();
        const engine = system.pipeline.getHyperEngine();
        if (!engine) {
          this.sendJson(res, { neuronCount: 0, skills: [], note: 'the network has not been built yet' });
          return;
        }
        // Plus how close the regions have grown to each other. Two skills
        // that keep being active together keep strengthening the connections
        // between them, and until this was reported that was happening where
        // nobody could see it -- which makes "the network develops new
        // combinations of expertise" indistinguishable from a story about a
        // network that does not. Strongest pair first, with the neurons the
        // two hold in common.
        this.sendJson(res, {
          neuronCount: engine.getNeuronCount(),
          dimensions: engine.getDimensions(),
          skills: graftedSkills(engine).map(entry => ({
            ...entry,
            neurons: engine.neuronsInGroup(entry.skill),
          })),
          affinity: engine.skillAffinity(),
        });
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    // POST /api/continuous/input — put something into the running loop right
    // now, without waiting for whatever it is currently doing to finish.
    //
    // This is what typing while it is thinking does. The reply to a message
    // still has to wait its turn (two answers racing land in whichever order
    // the network returns them), but the TEXT does not: it goes onto the zip
    // input on the next tick, so a thought you had mid-answer is part of what
    // the network is working on rather than something it hears about after it
    // has finished.
    //
    // Non-blocking by construction -- injectInput() appends and returns; the
    // tick already in flight is never interrupted.
    if (pathname === '/api/continuous/input' && method === 'POST') {
      const body = await this.parseBody(req) as Record<string, unknown> | null;
      const text = typeof body?.text === 'string' ? body.text.trim() : '';
      if (!text) {
        this.sendJson(res, { error: 'Expected a "text" string.' }, 400);
        return;
      }
      // Labelled, like every other turn that reaches the loop: the transcript
      // says who said it and a reserved dimension carries the same thing into
      // the embedding.
      const speaker = body?.speaker === 'ai' ? 'ai' : 'user';
      this.runner.injectInput(text, speaker);
      this.sendJson(res, { accepted: true, pending: this.runner.getContinuousStatus().pendingInputCount });
      return;
    }

    // GET /api/self-improvement/history — the graph data behind
    // src/routes/app/self-improvement.tsx: "I want a graph about how
    // the agent itself is doing on these tasks, and... how good it is
    // at passing the improvement test... a test for the AI and a graph
    // for npm run server." Reads three local, gitignored ledgers
    // directly off disk -- self-improve.mjs's own scoreboard (per-target
    // candidate scores + whether each was rewarded), skill-drill-agent.mjs's
    // quality history (per-skill held-out accuracy before/after each
    // drill + whether it improved), and skill-mesh-metrics.ts's own
    // ledger (every real chat message's direct-skill-match attempt, hit
    // or miss -- see ChatBot.matchSkillMesh()). All three already exist
    // as real, running local state; this endpoint doesn't compute
    // anything new, it just exposes what's already being recorded so
    // the UI can chart it. None of the files existing yet (a fresh
    // install, or the relevant agent disabled) degrades to an
    // empty-but-valid response, not an error.
    if (pathname === '/api/self-improvement/history' && method === 'GET') {
      const readJson = (relPath: string, fallback: unknown) => {
        try {
          const full = path.join(process.cwd(), relPath);
          if (!existsSync(full)) return fallback;
          return JSON.parse(readFileSync(full, 'utf8'));
        } catch {
          return fallback;
        }
      };
      const scoreboard = readJson('extension-builder/self-improvement-scoreboard.json', { targets: {} }) as {
        targets?: Record<string, { history?: unknown[] }>;
      };
      const drillHistory = readJson('extension-builder/skill-quality-history.json', { skills: {} }) as {
        skills?: Record<string, { history?: unknown[] }>;
      };
      const { readRecentSkillMeshAttempts } = await import('../src/lib/skill-mesh-metrics.js');
      this.sendJson(res, {
        selfImprovement: scoreboard.targets ?? {},
        skillDrills: drillHistory.skills ?? {},
        skillMeshAttempts: readRecentSkillMeshAttempts(),
      });
      return;
    }

    if (pathname === '/api/chat' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as
          { message?: string; history?: Array<{ role?: string; content?: string }> } | null;
        const message = body?.message;
        if (!message || typeof message !== 'string') {
          this.sendJson(res, { error: 'Missing message field' }, 400);
          return;
        }
        // The client (HTML_TEMPLATE's chat UI, above) already assembles and
        // sends the full conversation history with every request, but this
        // handler only ever read `message` -- runner.generate()'s second
        // argument (memoryContext, threaded into NeuroclawLLM.generate() to
        // ground the response in prior turns, Section 7 continuous context)
        // was always undefined. History entries are filtered rather than
        // rejected wholesale on a bad shape: this grounds the response, it
        // isn't a security boundary, so a malformed entry just doesn't
        // contribute rather than failing the whole chat request.
        const history = Array.isArray(body?.history)
          ? body.history
              .filter((h): h is { role: string; content: string } =>
                typeof h?.role === 'string' && typeof h?.content === 'string')
              .map(h => `${h.role}: ${h.content}`)
          : undefined;
        const response = await this.runner.generate(message, history);
        // What the turn actually used, for the three-dots panel. Read off the
        // system rather than rebuilt here: a details panel assembled from
        // guesses about what probably ran looks like evidence and is not.
        // Undefined when nothing recorded any, which the UI shows as "no
        // details recorded" rather than an empty panel.
        let details: unknown;
        try {
          const { getNeuroclawSystem } = await import('../src/index.js');
          details = (await getNeuroclawSystem()).lastTurnDetails ?? undefined;
        } catch { /* the details are not the answer; never fail the reply for them */ }
        this.sendJson(res, { response, details, timestamp: Date.now() });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // POST /api/chat/correct — the user rewrote something the AI said.
    //
    // The chat UI could copy a reply but not fix one, so a wrong answer
    // stayed wrong in the transcript, in memory, and in whatever the next
    // turn was grounded on. This is the pen button underneath an AI message.
    //
    // Behind the auth gate like everything else that writes: publishing is
    // open in this project, editing what the agent believes is not.
    if (pathname === '/api/chat/correct' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as
          { original?: string; corrected?: string; prompt?: string } | null;
        const original = typeof body?.original === 'string' ? body.original : '';
        const corrected = typeof body?.corrected === 'string' ? body.corrected : '';
        if (!corrected.trim()) {
          this.sendJson(res, { error: 'Missing corrected field' }, 400);
          return;
        }
        const { getNeuroclawSystem } = await import('../src/index.js');
        const system = await getNeuroclawSystem();
        const result = await system.recordCorrection({
          original,
          corrected,
          prompt: typeof body?.prompt === 'string' ? body.prompt : undefined,
        });
        this.sendJson(res, result);
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // POST /api/chat/messages — powers the React app's /app/chat page.
    // Distinct from /api/chat above (the standalone HTML terminal UI's
    // endpoint, which calls runner.generate() directly): this one goes
    // through ChatBot.processMessage(), which also returns agent-suggested
    // follow-up prompts alongside the reply.
    if (pathname === '/api/chat/messages' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { message?: string } | null;
        const message = body?.message;
        if (!message || typeof message !== 'string') {
          this.sendJson(res, { error: 'Missing message field' }, 400);
          return;
        }
        const { getBot } = await import('../src/server/bot-service.js');
        const { getNeuroclawSystem } = await import('../src/index.js');
        const bot = await getBot(await getNeuroclawSystem());
        const response = await bot.processMessage(message);
        this.sendJson(res, {
          message: response.message,
          confidence: response.confidence,
          reasoning: response.reasoning,
          suggestions: response.suggestions,
          metadata: response.metadata,
          timestamp: Date.now(),
        });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // GET /api/chat-groups/agents — hive agents available to the default
    // chat group, for the /app/chat-groups page's roster panel.
    if (pathname === '/api/chat-groups/agents' && method === 'GET') {
      try {
        const { getBot } = await import('../src/server/bot-service.js');
        const { getNeuroclawSystem } = await import('../src/index.js');
        const bot = await getBot(await getNeuroclawSystem());
        const system = bot.getSystem();
        if (!system) {
          this.sendJson(res, { error: 'Hive mind unavailable in fallback mode' }, 503);
          return;
        }
        this.sendJson(res, { agents: system.hive.list().map(a => a.snapshot()) });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // POST /api/chat-groups/collaborate — runs NeuroclawSystem.collaborate(),
    // which has the hive's chat group discuss a task and vote on a decision.
    // Powers the /app/chat-groups page.
    if (pathname === '/api/chat-groups/collaborate' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { task?: string } | null;
        const task = body?.task;
        if (!task || typeof task !== 'string') {
          this.sendJson(res, { error: 'Missing task field' }, 400);
          return;
        }
        const { getBot } = await import('../src/server/bot-service.js');
        const { getNeuroclawSystem } = await import('../src/index.js');
        const bot = await getBot(await getNeuroclawSystem());
        const system = bot.getSystem();
        if (!system) {
          this.sendJson(res, { error: 'Hive mind unavailable in fallback mode' }, 503);
          return;
        }
        const result = await system.collaborate(task);
        this.sendJson(res, {
          discussion: result.discussion,
          decision: result.decision,
          complete: result.complete,
          timestamp: Date.now(),
        });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // GET /api/chat-history/search?q=...&exclude=<threadId>&source=chat|chat-group
    // Token-overlap match against every persisted thread's messages, for the
    // "this looks like your earlier chat about X — continue there?" prompt.
    // Never called for an incognito conversation (the frontend simply skips
    // both this and /save entirely in that mode).
    if (pathname === '/api/chat-history/search' && method === 'GET') {
      const q = parsedUrl.searchParams.get('q') ?? '';
      const exclude = parsedUrl.searchParams.get('exclude') ?? undefined;
      const sourceParam = parsedUrl.searchParams.get('source');
      const source: ChatSource | undefined = sourceParam === 'chat' || sourceParam === 'chat-group' ? sourceParam : undefined;
      const matches = this.chatHistory.search(q, { excludeId: exclude, source, limit: 3 });
      this.sendJson(res, {
        matches: matches.map(m => ({
          threadId: m.thread.id,
          title: m.thread.title,
          source: m.thread.source,
          score: m.score,
          snippet: m.snippet,
          updatedAt: m.thread.updatedAt,
        })),
      });
      return;
    }

    // GET /api/chat-history/threads — every thread, lightweight summaries
    // only (id/title/source/updatedAt), for a history sidebar/page.
    if (pathname === '/api/chat-history/threads' && method === 'GET') {
      const sourceParam = parsedUrl.searchParams.get('source');
      const source: ChatSource | undefined = sourceParam === 'chat' || sourceParam === 'chat-group' ? sourceParam : undefined;
      const threads = this.chatHistory.listThreads()
        .filter(t => !source || t.source === source)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(t => ({ id: t.id, title: t.title, source: t.source, updatedAt: t.updatedAt, createdAt: t.createdAt }));
      this.sendJson(res, { threads });
      return;
    }

    // GET /api/chat-history/groups — every auto-organized chat group with its
    // member threads resolved to summaries. Groups are filed automatically
    // by ChatOrganizer on every /api/chat-history/save; there is no manual
    // "create group" step anywhere in this API on purpose.
    if (pathname === '/api/chat-history/groups' && method === 'GET') {
      this.sendJson(res, { groups: this.chatHistory.listGroupsWithThreads() });
      return;
    }

    // GET /api/chat-history/threads/:id — full message history for "continue there".
    const threadMatch = pathname.match(/^\/api\/chat-history\/threads\/([^/]+)$/);
    if (threadMatch && method === 'GET') {
      try {
        const thread = this.chatHistory.loadThread(decodeURIComponent(threadMatch[1]));
        if (!thread) {
          this.sendJson(res, { error: 'Thread not found' }, 404);
          return;
        }
        this.sendJson(res, { thread });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.sendJson(res, { error: msg }, 400);
      }
      return;
    }

    // POST /api/chat-history/save — append one message to a thread, creating
    // it if threadId is omitted/unknown. Called after every exchange in
    // non-incognito AI Chat / Chat Groups sessions.
    if (pathname === '/api/chat-history/save' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as
          { threadId?: string; source?: string; role?: string; content?: string } | null;
        if (body?.source !== 'chat' && body?.source !== 'chat-group') {
          this.sendJson(res, { error: 'source must be "chat" or "chat-group"' }, 400);
          return;
        }
        if (body.role !== 'user' && body.role !== 'assistant') {
          this.sendJson(res, { error: 'role must be "user" or "assistant"' }, 400);
          return;
        }
        if (typeof body.content !== 'string' || !body.content) {
          this.sendJson(res, { error: 'Missing content field' }, 400);
          return;
        }
        const thread = this.chatHistory.appendMessage(
          { role: body.role, content: body.content, timestamp: Date.now() },
          body.source,
          body.threadId
        );
        this.sendJson(res, { threadId: thread.id });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.sendJson(res, { error: msg }, 400);
      }
      return;
    }

    if (pathname === '/api/thorns' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { message?: string } | null;
        const message = body?.message ?? '';
        const thornsOut = await this.runner.getLLM().thinkAbout(message);
        this.sendJson(res, {
          response: thornsOut.response,
          intent: thornsOut.intent,
          crossCheck: thornsOut.crossCheck,
          simulation: thornsOut.simulation,
          noveltyScore: thornsOut.noveltyScore,
          timestamp: Date.now(),
        });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // POST /api/neuri — run NeuriLang code
    if (pathname === '/api/neuri' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { code?: string } | null;
        const code = body?.code ?? '';
        const { NeuroLangInterpreter } = await import('../models && skills/core/neuro-lang.js');
        const interp = new NeuroLangInterpreter();
        const parsed = await interp.parse(code);
        if (parsed.errors.length > 0) {
          this.sendJson(res, { errors: parsed.errors }, 400);
          return;
        }
        const neurons = await interp.evaluate(parsed);
        // Sections 21/22: surface the interpreter's own Code-to-Net self-test
        // and NetSearchEngine results -- previously this endpoint echoed back
        // only the raw parsed flags/code, never actually running either
        // built, unit-tested mechanism.
        //
        // evaluate() connects every neuron to every other by default, so
        // this response body is itself O(n^2) in the number of declared
        // neurons -- materializing each neuron's full connection list is a
        // second synchronous cost on top of evaluate()'s own loop (measured:
        // for 3000 plain neuron declarations, building this array alone took
        // longer than evaluate() itself). Chunked with the same periodic
        // yield so it doesn't reintroduce the freeze evaluate()'s own fix
        // just closed.
        const result: unknown[] = [];
        let entriesSinceYield = 0;
        for (const [name, n] of neurons) {
          const codeNet = interp.getCodeNet(name);
          const codeNetTest = codeNet ? interp.testCodeNet(name) : undefined;
          const netSearchHits = n.isNetSearch && n.netLocation ? interp.netSearch(n.netLocation) : undefined;
          result.push({
            name,
            value: n.value,
            definition: n.definition,
            isNetSearch: n.isNetSearch,
            netLocation: n.netLocation,
            isCodeNet: n.isCodeNet,
            code: n.code,
            connections: Array.from(n.connections.entries()),
            codeNet: codeNet ? { mode: codeNet.mode, arity: codeNet.arity, test: codeNetTest } : undefined,
            netSearchHits,
          });
          entriesSinceYield += n.connections.size;
          if (entriesSinceYield >= 200_000) {
            entriesSinceYield = 0;
            await new Promise<void>(resolve => setImmediate(resolve));
          }
        }
        this.sendJson(res, { neurons: result, printOutputs: parsed.printOutputs });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // GET /api/neurons?q=query — search neurons
    if (pathname === '/api/neurons' && method === 'GET') {
      const q = new URL(req.url ?? '/', 'http://localhost').searchParams.get('q') ?? '';
      const results = this.runner.getLLM().searchNeurons(q);
      this.sendJson(res, { results: results.slice(0, 50), total: results.length });
      return;
    }

    // GET /api/netsearch-generate?q=query — Section 22 Net Search: unlike
    // /api/neurons' plain substring search, this semantically scores every
    // neuron against the query and generates a new neuron wired to the best
    // matches with similarity-weighted edges. LLM.netSearchGenerate() was
    // fully built (extension-builder/builder.js) but had no live caller.
    if (pathname === '/api/netsearch-generate' && method === 'GET') {
      const q = new URL(req.url ?? '/', 'http://localhost').searchParams.get('q') ?? '';
      const result = this.runner.getLLM().netSearchGenerate(q);
      this.sendJson(res, { result });
      return;
    }

    // POST /api/train — train LLM on text
    if (pathname === '/api/train' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { text?: string } | null;
        if (body?.text !== undefined && typeof body.text !== 'string') {
          this.sendJson(res, { error: 'text must be a string' }, 400);
          return;
        }
        const text = body?.text ?? '';
        await this.runner.getLLM().trainOnText(text);
        const stats = this.runner.getLLM().getStats();
        this.sendJson(res, { ok: true, samplesProcessed: stats.samplesProcessed });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // GET /api/plugins — list all plugins and their status
    // GET /api/terminals -- every background terminal and what it has said.
    //
    // The architecture's cross-terminal awareness: one terminal running a
    // server, another running tests, and the agent able to see what happened
    // in either from wherever it currently is. Both halves were missing.
    // runBg() spawned with stdio: "ignore", so the operating system threw the
    // output away before anything could read it, and nothing outside the
    // tests ever called runBg at all -- so a background terminal was neither
    // observable nor reachable.
    //
    // Read-only on purpose. Starting and killing processes over HTTP is a
    // different decision with a different blast radius; this endpoint only
    // lets you see what is already running.
    if (pathname === '/api/terminals' && method === 'GET') {
      try {
        const registry = this.runner.getPluginRegistry();
        // getPluginInstance, not getPlugin -- the latter returns the
        // definition (name, version, capabilities), which has no terminals on
        // it and would have made this endpoint quietly report none.
        const terminal = registry.getPluginInstance('terminal') as unknown as
          { terminals?: () => unknown[] } | undefined;
        if (!terminal?.terminals) {
          this.sendJson(res, { terminals: [], note: 'the terminal plug-in is not loaded' });
          return;
        }
        const terminals = terminal.terminals();
        this.sendJson(res, {
          terminals,
          running: terminals.filter(t => (t as { running?: boolean }).running).length,
          failed: terminals.filter(t => {
            const code = (t as { exitCode?: number | null }).exitCode;
            return code !== null && code !== undefined && code !== 0;
          }).length,
        });
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    if (pathname === '/api/plugins' && method === 'GET') {
      const registry = this.runner.getPluginRegistry();
      const plugins = registry.listPlugins();
      const active = new Set(registry.listActivePlugins().map(p => p.id));
      this.sendJson(res, {
        plugins: plugins.map(p => ({ ...p, active: active.has(p.id) })),
        total: plugins.length,
        activeCount: active.size,
        skillCount: registry.getSkillCount(),
      });
      return;
    }

    // GET /api/wiki — every real page under wiki/*.md (the same content
    // GitHub's wiki tab renders), lightweight summaries only (name/title/
    // description) so /app/store can list them without fetching every full
    // file. Reads the actual repo directory on every call rather than
    // caching, matching this project's "wiki is a living doc, not a build
    // artifact" convention (see docs/SHARED_WIKI_SYSTEM.md) — a page
    // edited on disk (by a human, or by WikiPlugin.publish() below) shows
    // up on next load.
    if (pathname === '/api/wiki' && method === 'GET') {
      const pages = listWikiPages();
      this.sendJson(res, { pages, total: pages.length });
      return;
    }

    // POST /api/wiki — create or overwrite a page. This is the human-facing
    // half of docs/SKILL_ACQUISITION_LOOP.md's "push the wiki page" step;
    // the AI-facing half is plugins/wiki.ts's WikiPlugin.publish(), which
    // calls the exact same wiki-store.ts helper so a page looks identical
    // regardless of who published it.
    if (pathname === '/api/wiki' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { name?: string; title?: string; content?: string } | null;
        if (typeof body?.name !== 'string' || typeof body?.title !== 'string' || typeof body?.content !== 'string') {
          this.sendJson(res, { error: 'Expected { name, title, content } (all strings)' }, 400);
          return;
        }
        // Reaching here bypassed the blanket remoteAccessLock gate above
        // (isWikiPublicCreateRoute) precisely so a brand-new page can be
        // contributed without a password -- but overwriting a page that
        // already exists (bot- or curated-named) is an edit/replace, not a
        // contribution, and must still require it. A caller who *is*
        // authorized (has the password, or is on localhost where none is
        // required) can overwrite as before; this only blocks an
        // unauthenticated, non-local caller from replacing existing content.
        if (readWikiPage(body.name) && !(await this.isAuthorizedBasic(req, this.remoteAccessLock))) {
          this.requireAuth(req, res);
          return;
        }
        // ...AndSync: writing the file is only half a publish -- it has to
        // reach every other clone to mean anything.
        const { page, sync } = await publishWikiPageAndSync(body.name, body.title, body.content);
        this.sendJson(res, { ...page, sync }, 201);
      } catch (err) {
        const status = err instanceof WikiNameError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // GET /api/wiki/:name — one page's raw markdown. `name` must be a bare
    // filename stem (letters/digits/-/_ only, matching the page names
    // [[WikiLink]] syntax already uses throughout wiki/*.md) so this can
    // never escape the wiki/ directory — no `.`/`/` is accepted at all,
    // which rules out both `..` traversal and an absolute-path override.
    const wikiMatch = pathname.match(/^\/api\/wiki\/([A-Za-z0-9_-]+)$/);
    if (wikiMatch && method === 'GET') {
      const page = readWikiPage(wikiMatch[1]);
      if (!page) {
        this.sendJson(res, { error: `No wiki page named "${wikiMatch[1]}"` }, 404);
        return;
      }
      this.sendJson(res, page);
      return;
    }

    // DELETE /api/wiki/:name — remove a bot-published page. Same name rule
    // and route shape as the GET above; deleteWikiPage() itself refuses a
    // curated wiki/ name, so this can never touch the reviewed pages.
    // Backed up first (wiki-store.ts's backupBeforeChange()), so this is no
    // longer unrecoverable the way it was before.
    if (wikiMatch && method === 'DELETE') {
      try {
        await deleteWikiPageAndSync(wikiMatch[1]);
        this.sendJson(res, { name: wikiMatch[1], deleted: true });
      } catch (err) {
        const status = err instanceof WikiNameError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // GET /api/wiki/:name/backups — every snapshot backupBeforeChange() has
    // taken of this bot-published page (before each overwrite/edit/delete),
    // oldest first, so a caller can see what's recoverable before choosing
    // one to restore.
    const backupsMatch = pathname.match(/^\/api\/wiki\/([A-Za-z0-9_-]+)\/backups$/);
    if (backupsMatch && method === 'GET') {
      try {
        const backups = listWikiBackups(backupsMatch[1]);
        this.sendJson(res, { backups, total: backups.length });
      } catch (err) {
        const status = err instanceof WikiNameError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // POST /api/wiki/:name/restore — bring back a page's content from one
    // of its own backups (body: { timestamp }). A write, not a read, so
    // (unlike the routes above) this still goes through the normal
    // remoteAccessLock gate.
    const restoreMatch = pathname.match(/^\/api\/wiki\/([A-Za-z0-9_-]+)\/restore$/);
    if (restoreMatch && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { timestamp?: string } | null;
        if (typeof body?.timestamp !== 'string') {
          this.sendJson(res, { error: 'Expected { timestamp }' }, 400);
          return;
        }
        const page = restoreWikiBackup(restoreMatch[1], body.timestamp);
        this.sendJson(res, page);
      } catch (err) {
        const status = err instanceof WikiNameError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // GET /api/shared-chat/rooms — every chat room (General first, then
    // most-recently-active), for the Chat tab's room picker.
    if (pathname === '/api/shared-chat/rooms' && method === 'GET') {
      this.sendJson(res, { rooms: getSharedChatStore().listRooms() });
      return;
    }

    // POST /api/shared-chat/rooms — find-or-create a room by name. Body:
    // { name: string }. Idempotent (same name -> same room, matched
    // case-insensitively) so a Bot Wiki page's "Discuss in Chat" button
    // can call this every time it's clicked without spawning a fresh room
    // per click -- see shared-chat-store.ts's ensureRoom().
    if (pathname === '/api/shared-chat/rooms' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { name?: string } | null;
        if (typeof body?.name !== 'string') {
          this.sendJson(res, { error: 'Expected a "name" string field' }, 400);
          return;
        }
        const room = getSharedChatStore().ensureRoom(body.name);
        this.sendJson(res, room, 201);
      } catch (err) {
        const status = err instanceof SharedChatError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // GET /api/shared-chat/rooms/:roomId/messages?since=<id> — one room's
    // messages, oldest first. Unlike /api/chat and /api/chat/messages
    // (both always exactly one human talking to the bot) this is one
    // shared log every visitor to that room reads and posts into -- see
    // shared-chat-store.ts's doc comment. `since` (a message id the
    // client already has) returns only what's newer, which is what the
    // Chat tab's poll loop sends on every request after the first so it
    // isn't re-fetching the whole room.
    const sharedChatRoomMessagesMatch = pathname.match(/^\/api\/shared-chat\/rooms\/([a-z0-9-]+)\/messages$/);
    if (sharedChatRoomMessagesMatch && method === 'GET') {
      const roomId = sharedChatRoomMessagesMatch[1];
      try {
        const since = parsedUrl.searchParams.get('since') ?? undefined;
        this.sendJson(res, { messages: getSharedChatStore().list(roomId, since) });
      } catch (err) {
        const status = err instanceof SharedChatError ? 404 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // POST /api/shared-chat/rooms/:roomId/messages — post a message as a
    // human participant. Body: { author: string, text: string }. The bot
    // never appears here; it only ever posts via .../ask below (summoned)
    // or when something it did elsewhere chooses to announce itself in
    // the room, so it's always one voice among the room's participants,
    // never the implicit other half of every message.
    if (sharedChatRoomMessagesMatch && method === 'POST') {
      const roomId = sharedChatRoomMessagesMatch[1];
      try {
        const body = await this.parseBody(req) as { author?: string; text?: string } | null;
        if (typeof body?.author !== 'string' || typeof body?.text !== 'string') {
          this.sendJson(res, { error: 'Expected { author, text } (both strings)' }, 400);
          return;
        }
        const message = getSharedChatStore().post(roomId, body.author, body.text, false);
        this.sendJson(res, message, 201);
      } catch (err) {
        const status = err instanceof SharedChatError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // POST /api/shared-chat/rooms/:roomId/ask — summon the bot into the
    // room. Posts the asker's own message first (so everyone else in the
    // room sees the question, not just the answer), then generates and
    // posts the bot's reply under isBot: true. This is the only path that
    // makes the bot speak here -- there's no per-message auto-reply,
    // matching "the bot can talk and publish stuff to the chat but it
    // won't be you exclusively with the bot."
    const sharedChatRoomAskMatch = pathname.match(/^\/api\/shared-chat\/rooms\/([a-z0-9-]+)\/ask$/);
    if (sharedChatRoomAskMatch && method === 'POST') {
      const roomId = sharedChatRoomAskMatch[1];
      try {
        const body = await this.parseBody(req) as { author?: string; text?: string } | null;
        if (typeof body?.author !== 'string' || typeof body?.text !== 'string') {
          this.sendJson(res, { error: 'Expected { author, text } (both strings)' }, 400);
          return;
        }
        const store = getSharedChatStore();
        const asked = store.post(roomId, body.author, body.text, false);
        const { getBot } = await import('../src/server/bot-service.js');
        const { getNeuroclawSystem } = await import('../src/index.js');
        const bot = await getBot(await getNeuroclawSystem());
        const reply = await bot.processMessage(body.text);
        const answered = store.post(roomId, 'Bot', reply.message, true);
        this.sendJson(res, { asked, answered }, 201);
      } catch (err) {
        const status = err instanceof SharedChatError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // GET /api/skill-uploads — every skill package under
    // extension-builder/extensions/*/, with which of the five slots
    // (plugin/sourceSkill/binarySkill/algorithm/rsiTest) each one has
    // filled in so the /app/skill-uploads UI can show completeness at a
    // glance without fetching every file.
    if (pathname === '/api/skill-uploads' && method === 'GET') {
      this.sendJson(res, { packages: listSkillUploads() });
      return;
    }

    // POST /api/skill-uploads — create a package or add/replace slots on an
    // existing one. Body: { name: string, plugin?/sourceSkill?/binarySkill?/
    // algorithm?/rsiTest?: { filename: string, content: string } }. Only
    // the slots present in the body are written; the rest of an existing
    // package's slots are left exactly as they were.
    if (pathname === '/api/skill-uploads' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as Record<string, unknown> | null;
        if (typeof body?.name !== 'string') {
          this.sendJson(res, { error: 'Expected a "name" string field' }, 400);
          return;
        }
        const files: Partial<Record<SkillUploadSlot, SkillUploadFile>> = {};
        for (const slot of SKILL_UPLOAD_SLOTS) {
          const raw = body[slot];
          if (raw === undefined || raw === null) continue;
          if (
            typeof raw !== 'object' ||
            typeof (raw as Record<string, unknown>).filename !== 'string' ||
            typeof (raw as Record<string, unknown>).content !== 'string'
          ) {
            this.sendJson(res, { error: `"${slot}" must be { filename: string, content: string }` }, 400);
            return;
          }
          files[slot] = raw as SkillUploadFile;
        }
        const { pkg, sync } = await saveSkillUploadAndSync(body.name, files);
        this.sendJson(res, { ...pkg, sync }, 201);
      } catch (err) {
        const status = err instanceof SkillUploadError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // GET /api/skill-uploads/:name — one package's manifest (which slots it has, not their content).
    const skillUploadMatch = pathname.match(/^\/api\/skill-uploads\/([A-Za-z0-9_-]+)$/);
    if (skillUploadMatch && method === 'GET') {
      const pkg = readSkillUpload(skillUploadMatch[1]);
      if (!pkg) {
        this.sendJson(res, { error: `No skill package named "${skillUploadMatch[1]}"` }, 404);
        return;
      }
      this.sendJson(res, pkg);
      return;
    }

    // DELETE /api/skill-uploads/:name — remove the whole package (all slots + manifest together).
    if (skillUploadMatch && method === 'DELETE') {
      try {
        await deleteSkillUploadAndSync(skillUploadMatch[1]);
        this.sendJson(res, { name: skillUploadMatch[1], deleted: true });
      } catch (err) {
        const status = err instanceof SkillUploadError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // GET /api/skill-uploads/:name/:slot — one slot's raw file content, for
    // the UI's "view" affordance on an already-uploaded file.
    const skillUploadFileMatch = pathname.match(/^\/api\/skill-uploads\/([A-Za-z0-9_-]+)\/([A-Za-z]+)$/);
    if (skillUploadFileMatch && method === 'GET') {
      const [, name, slotParam] = skillUploadFileMatch;
      if (!(SKILL_UPLOAD_SLOTS as readonly string[]).includes(slotParam)) {
        this.sendJson(res, { error: `"${slotParam}" is not a valid slot` }, 400);
        return;
      }
      const file = readSkillUploadFile(name, slotParam as SkillUploadSlot);
      if (!file) {
        this.sendJson(res, { error: `No "${slotParam}" file uploaded for "${name}"` }, 404);
        return;
      }
      this.sendJson(res, file);
      return;
    }

    // POST /api/skill-uploads/:name/files — the open-ended "extra files"
    // slot: anything that doesn't fit the five named ones. Body:
    // { files: [{ filename, content }, ...] }. Unlike the named slots,
    // these accumulate -- re-uploading an existing filename replaces just
    // that one file, everything else in the package is untouched.
    const skillUploadExtraFilesMatch = pathname.match(/^\/api\/skill-uploads\/([A-Za-z0-9_-]+)\/files$/);
    if (skillUploadExtraFilesMatch && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { files?: unknown } | null;
        if (!Array.isArray(body?.files) || body.files.length === 0) {
          this.sendJson(res, { error: 'Expected a non-empty "files" array of { filename, content }' }, 400);
          return;
        }
        const files: SkillUploadFile[] = [];
        for (const raw of body.files) {
          if (typeof raw !== 'object' || raw === null || typeof (raw as Record<string, unknown>).filename !== 'string' || typeof (raw as Record<string, unknown>).content !== 'string') {
            this.sendJson(res, { error: 'Every file needs { filename: string, content: string }' }, 400);
            return;
          }
          files.push(raw as SkillUploadFile);
        }
        const { pkg, sync } = await saveSkillUploadExtraFilesAndSync(skillUploadExtraFilesMatch[1], files);
        this.sendJson(res, { ...pkg, sync }, 201);
      } catch (err) {
        const status = err instanceof SkillUploadError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // GET /api/skill-uploads/:name/files/:filename — one extra file's raw content.
    // DELETE /api/skill-uploads/:name/files/:filename — remove just that one extra file.
    const skillUploadExtraFileMatch = pathname.match(/^\/api\/skill-uploads\/([A-Za-z0-9_-]+)\/files\/([A-Za-z0-9_.-]+)$/);
    if (skillUploadExtraFileMatch && method === 'GET') {
      const [, name, filename] = skillUploadExtraFileMatch;
      const file = readSkillUploadExtraFile(name, decodeURIComponent(filename));
      if (!file) {
        this.sendJson(res, { error: `No extra file named "${filename}" in "${name}"` }, 404);
        return;
      }
      this.sendJson(res, file);
      return;
    }
    if (skillUploadExtraFileMatch && method === 'DELETE') {
      const [, name, filename] = skillUploadExtraFileMatch;
      try {
        await deleteSkillUploadExtraFileAndSync(name, decodeURIComponent(filename));
        this.sendJson(res, { name, filename, deleted: true });
      } catch (err) {
        const status = err instanceof SkillUploadError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // POST /api/skill-uploads/:name/install-skill — the real "Install"
    // action for a package's skill files: parses its binarySkill (falling
    // back to sourceSkill if no binary was uploaded) as a { neurons: [...] }
    // project and wires it into this process's live NeuroclawSystem memory
    // through the exact same installSkillProject() path
    // POST /api/extension/register already uses -- not a second,
    // easy-to-drift implementation of "install".
    const skillUploadInstallSkillMatch = pathname.match(/^\/api\/skill-uploads\/([A-Za-z0-9_-]+)\/install-skill$/);
    if (skillUploadInstallSkillMatch && method === 'POST') {
      const name = skillUploadInstallSkillMatch[1];
      try {
        const file = readSkillUploadFile(name, 'binarySkill') ?? readSkillUploadFile(name, 'sourceSkill');
        if (!file) {
          this.sendJson(res, { error: `"${name}" has no binarySkill or sourceSkill file to install` }, 400);
          return;
        }
        let neurons: ReturnType<WebServer['parseSkillNeuronsFile']>;
        try {
          neurons = this.parseSkillNeuronsFile(file);
        } catch (err) {
          this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
          return;
        }
        const { remembered, grafted } = await this.installSkillProject(name, neurons);
        this.sendJson(res, { ok: true, installedFrom: file.filename, neuronCount: neurons.length, remembered, grafted });
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    // POST /api/skill-uploads/:name/install-plugin — the real "Install"
    // action for a package's plugin file. This genuinely executes the
    // uploaded file as code (a real dynamic import()), so it only ever
    // proceeds for a plain .js/.mjs ES module -- a .ts file is refused
    // outright with a clear reason (no TypeScript compiler is available at
    // runtime here; add it to plugins/index.ts and rebuild instead) rather
    // than silently doing nothing. The loaded module's default export (or,
    // failing that, its first exported function) is instantiated with a
    // minimal PluginDefinition and must implement onActivate(context) --
    // BasePlugin's own contract (plugin_manager/sdk.ts) -- checked before
    // it's registered into the live PluginRegistry the same way
    // interface/main.ts's registerRealPlugins() wires every built-in
    // plugin.
    const skillUploadInstallPluginMatch = pathname.match(/^\/api\/skill-uploads\/([A-Za-z0-9_-]+)\/install-plugin$/);
    if (skillUploadInstallPluginMatch && method === 'POST') {
      const name = skillUploadInstallPluginMatch[1];
      try {
        const file = readSkillUploadFile(name, 'plugin');
        if (!file) {
          this.sendJson(res, { error: `"${name}" has no plugin file to install` }, 400);
          return;
        }
        if (!/\.(mjs|js)$/i.test(file.filename)) {
          this.sendJson(res, {
            error: `"${file.filename}" is not a .js/.mjs file -- no TypeScript compiler is available at runtime to install a .ts plugin this way. Add it to plugins/index.ts and rebuild instead.`,
          }, 400);
          return;
        }
        const path = await import('node:path');
        const { pathToFileURL } = await import('node:url');
        const filePath = path.resolve(process.cwd(), 'extension-builder', 'extensions', name, file.filename);
        // The cache-busting query string is deliberate: plain
        // import(filePath) would serve Node's cached module on a
        // reinstall after editing the same file, silently ignoring the
        // new content.
        const moduleUrl = `${pathToFileURL(filePath).href}?t=${Date.now()}`;
        const mod = await import(/* @vite-ignore */ moduleUrl);
        const Candidate = mod.default ?? Object.values(mod).find((v) => typeof v === 'function');
        if (typeof Candidate !== 'function') {
          this.sendJson(res, { error: `"${file.filename}" doesn't export a class/function (checked default export and named exports)` }, 400);
          return;
        }
        const definition = { id: name, name, type: 'api-connection' as const, capabilities: [] as string[] };
        let instance: { onActivate?: (context: unknown) => Promise<void> };
        try {
          instance = new Candidate(definition);
        } catch (err) {
          this.sendJson(res, { error: `Failed to construct the plugin: ${err instanceof Error ? err.message : String(err)}` }, 400);
          return;
        }
        if (typeof instance.onActivate !== 'function') {
          this.sendJson(res, { error: `"${file.filename}"'s exported class doesn't implement onActivate(context) -- not a valid BasePlugin subclass` }, 400);
          return;
        }
        const registry = this.runner.getPluginRegistry();
        registry.register(definition, instance as unknown as Parameters<typeof registry.register>[1]);
        await registry.activate(name);
        this.sendJson(res, { ok: true, installedFrom: file.filename, pluginId: name });
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    // POST /api/skill-uploads/:name/wiki — link a package to a bot wiki
    // page as its documentation. Body: { wikiPage: string }. Only a *bot*
    // page (wiki/bot/*.md) can be linked -- a curated wiki/ page is
    // reviewed, general-purpose documentation, not something a skill
    // upload should be able to claim as "about" it, so this checks the
    // page's source the same way deleteWikiPage()/WikiPlugin.edit() refuse
    // to touch a curated page.
    const skillUploadWikiMatch = pathname.match(/^\/api\/skill-uploads\/([A-Za-z0-9_-]+)\/wiki$/);
    if (skillUploadWikiMatch && method === 'POST') {
      const name = skillUploadWikiMatch[1];
      try {
        const body = await this.parseBody(req) as { wikiPage?: string } | null;
        if (typeof body?.wikiPage !== 'string' || !body.wikiPage) {
          this.sendJson(res, { error: 'Expected a "wikiPage" string field' }, 400);
          return;
        }
        const page = readWikiPage(body.wikiPage);
        if (!page) {
          this.sendJson(res, { error: `No wiki page named "${body.wikiPage}"` }, 404);
          return;
        }
        if (page.source !== 'bot') {
          this.sendJson(res, { error: `"${body.wikiPage}" is a curated wiki page -- only a bot-published page can be linked to a skill upload` }, 400);
          return;
        }
        const { pkg: summary } = await linkSkillUploadWikiAndSync(name, body.wikiPage);
        this.sendJson(res, summary);
      } catch (err) {
        const status = err instanceof SkillUploadError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // DELETE /api/skill-uploads/:name/wiki — unlink the package's wiki
    // page, if any. The wiki page itself is untouched; this only removes
    // the pointer skill-upload-store.ts keeps in the package's manifest.
    if (skillUploadWikiMatch && method === 'DELETE') {
      const name = skillUploadWikiMatch[1];
      try {
        const { pkg: summary } = await unlinkSkillUploadWikiAndSync(name);
        this.sendJson(res, summary);
      } catch (err) {
        const status = err instanceof SkillUploadError ? 400 : 500;
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, status);
      }
      return;
    }

    // POST /api/skill-uploads/:name/run-algorithm — genuinely executes a
    // package's uploaded improvement-algorithm file (.js/.mjs only, same
    // dynamic-import path install-plugin uses) against the live
    // NeuroclawSystem. The function is called as
    // `fn({ system, packageName })` and whatever it returns is sent back
    // verbatim (JSON-stringified) -- unlike install-skill/run-rsi-test,
    // there's no fixed "what running an algorithm means" contract beyond
    // "it's given the live system and can do real things to it", since
    // skill-upload-store.ts's own doc comment describes this slot as an
    // arbitrary recorded recipe (hyperparameters, which variations were
    // kept, ...), not a fixed shape.
    const skillUploadRunAlgorithmMatch = pathname.match(/^\/api\/skill-uploads\/([A-Za-z0-9_-]+)\/run-algorithm$/);
    if (skillUploadRunAlgorithmMatch && method === 'POST') {
      const name = skillUploadRunAlgorithmMatch[1];
      try {
        const file = readSkillUploadFile(name, 'algorithm');
        if (!file) {
          this.sendJson(res, { error: `"${name}" has no algorithm file to run` }, 400);
          return;
        }
        const fn = await this.importSkillUploadScript(name, file);
        const { getNeuroclawSystem } = await import('../src/index.js');
        const system = await getNeuroclawSystem();
        const result = await fn({ system, packageName: name });
        this.sendJson(res, { ok: true, ranFrom: file.filename, result: result === undefined ? null : result });
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return;
    }

    // POST /api/skill-uploads/:name/run-rsi-test — genuinely executes a
    // package's uploaded RSI test file (.js/.mjs only) against the live
    // system, same as run-algorithm. The function is called as
    // `fn({ system, packageName })` and its return value is normalized
    // into pass/fail: a plain boolean, or an object with a `passed`
    // field (optionally `message`/`score`). A pass does two real things,
    // not just record a flag:
    //   1. recordSkillUploadRsiPass() -- what the UI shows as "Published"
    //   2. if the package also has a binarySkill/sourceSkill file, installs
    //      it into live memory via the same installSkillProject() path
    //      install-skill uses -- "the test passed" and "the skill is
    //      installed" are the same real action here, not two separate
    //      steps the user has to remember to do in order.
    // A fail does neither -- the package's files (and any previous
    // rsiPassed record) are left exactly as they were.
    const skillUploadRunRsiTestMatch = pathname.match(/^\/api\/skill-uploads\/([A-Za-z0-9_-]+)\/run-rsi-test$/);
    if (skillUploadRunRsiTestMatch && method === 'POST') {
      const name = skillUploadRunRsiTestMatch[1];
      try {
        const file = readSkillUploadFile(name, 'rsiTest');
        if (!file) {
          this.sendJson(res, { error: `"${name}" has no rsiTest file to run` }, 400);
          return;
        }
        const fn = await this.importSkillUploadScript(name, file);
        const { getNeuroclawSystem } = await import('../src/index.js');
        const system = await getNeuroclawSystem();
        const raw = await fn({ system, packageName: name });
        const passed = typeof raw === 'boolean' ? raw : !!(raw as { passed?: unknown } | null)?.passed;
        const message = typeof raw === 'object' && raw !== null && typeof (raw as { message?: unknown }).message === 'string'
          ? (raw as { message: string }).message
          : undefined;
        const score = typeof raw === 'object' && raw !== null && typeof (raw as { score?: unknown }).score === 'number'
          ? (raw as { score: number }).score
          : undefined;
        if (!passed) {
          this.sendJson(res, { ok: true, passed: false, message, score, ranFrom: file.filename });
          return;
        }
        await recordSkillUploadRsiPassAndSync(name, message);
        let installed: { remembered: number; grafted: { added: number; connections: number; neuronCount: number; skipped?: string } } | null = null;
        const skillFile = readSkillUploadFile(name, 'binarySkill') ?? readSkillUploadFile(name, 'sourceSkill');
        if (skillFile) {
          try {
            const neurons = this.parseSkillNeuronsFile(skillFile);
            installed = await this.installSkillProject(name, neurons);
          } catch {
            // The RSI test passed and is recorded regardless -- a
            // malformed/missing skill file just means nothing to install,
            // not a reason to discard a real, already-passed test result.
          }
        }
        this.sendJson(res, { ok: true, passed: true, message, score, ranFrom: file.filename, installed });
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return;
    }

    // POST /api/extension/register — persist a project built in the *visual*
    // /builder editor (src/features/builder/use-builder.ts's client-side
    // ExtensionBuilder, entirely separate from /api/extension/build above)
    // and, unlike that JSON-in-JSON-out flow, actually wire its defined
    // neurons into this process's live NeuroclawSystem memory so a later
    // chat message can recall them (ReasoningEngine's "analogy" approach —
    // see reasoning-engine.ts) instead of the editor's Save/Install buttons
    // being a complete dead end: previously they only reported a byte count
    // and threw the built project away, wired to neither disk nor chat.
    if (pathname === '/api/extension/register' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as
          {
            name?: string;
            neurons?: Array<{
              name?: string; value?: number; definition?: string;
              scripts?: Array<{ userSays?: string; response?: string }>;
            }>;
          } | null;
        const name = (body?.name ?? '').trim() || `extension_${Date.now()}`;
        const neurons = Array.isArray(body?.neurons) ? body.neurons : [];

        const path = await import('node:path');
        const { promises: fs } = await import('node:fs');
        const dir = path.resolve(process.cwd(), 'extension-builder', 'extensions');
        await fs.mkdir(dir, { recursive: true });
        const safe = name.replace(/[^a-zA-Z0-9_-]+/g, '_');
        const filename = `${safe}_${Date.now()}.ext.json`;
        await fs.writeFile(path.join(dir, filename), JSON.stringify({ name, neurons }, null, 2), 'utf8');

        const { remembered, grafted } = await this.installSkillProject(name, neurons);

        // `grafted` is the part that makes this a NET skill: how many neurons
        // actually joined the running mesh and how many of the skill's own
        // connections came with them. Reported rather than assumed -- a graft
        // that silently did nothing would look exactly like one that worked.
        this.sendJson(res, { ok: true, savedAs: filename, neuronCount: neurons.length, remembered, grafted });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // POST /api/extension/train-pytorch — an ALTERNATIVE training backend to
    // ExtensionBuilder.train()'s hand-rolled JS delta rule
    // (HyperDimensionalEngine.trainDefinitions() in
    // "models && skills/core/onebrain.ts"): this one does genuine
    // torch.autograd/torch.optim gradient descent via a Python subprocess
    // (extension-builder/pytorch_trainer.py), against the PyTorch source
    // vendored under extension-builder/PyTorch for local reference/build.
    //
    // Deliberately NOT wired into extension-builder/builder.js: that file is
    // loaded directly in the browser (see its own header comment) with no
    // build step, so it cannot spawn a subprocess -- only server code can.
    //
    // Deliberately OPTIONAL, never a hard requirement: nothing here adds
    // `torch` to any manifest, and the app's install/build/existing JS
    // training path work identically whether or not a Python/torch
    // environment happens to exist on this machine. If python3 or the torch
    // import is missing, this endpoint reports that plainly (still 200, with
    // ok:false) instead of throwing -- the UI is expected to fall back to
    // the regular Train button, never to block on this being present.
    if (pathname === '/api/extension/train-pytorch' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as
          {
            neurons?: Array<{
              name?: string; definition?: string;
              scripts?: Array<{ userSays?: string; response?: string }>;
            }>;
            epochs?: number; learningRate?: number; tolerance?: number;
          } | null;
        const neurons = Array.isArray(body?.neurons) ? body.neurons : [];
        const dims = 16; // matches builder.js train()'s fixed dims

        const { embedText } = await import('../models && skills/core/neuro-lang.js');
        // Same fixed, concept-agnostic "recall your definition" drive vector
        // materialize() uses for every @definishon contract (see
        // definitionTrigger() in neuro-lang.ts) -- not exported, so mirrored
        // here rather than adding an export just for this one caller.
        const definitionTrigger = new Array(dims).fill(0.7);

        type Sample = { readout: number; input: number[]; target: number[] };
        const samples: Sample[] = [];
        const readoutNames: string[] = [];
        for (const n of neurons) {
          if (!n.name) continue;
          const def = (n.definition ?? '').trim();
          const scripts = (n.scripts ?? []).filter(
            s => (s.userSays ?? '').trim() && (s.response ?? '').trim()
          );
          if (!def && scripts.length === 0) continue;
          const readout = readoutNames.length;
          readoutNames.push(n.name);
          if (def) {
            samples.push({ readout, input: definitionTrigger, target: embedText(def, dims) });
          }
          for (const s of scripts) {
            samples.push({
              readout,
              input: embedText(s.userSays!.trim(), dims),
              target: embedText(s.response!.trim(), dims),
            });
          }
        }

        if (samples.length === 0) {
          this.sendJson(res, {
            ok: true, backend: 'pytorch', converged: true, epochs: 0,
            satisfied: [], conflicts: [], trainedNeurons: [],
          });
          return;
        }

        const spec = {
          dims,
          numReadouts: readoutNames.length,
          epochs: body?.epochs ?? 1000,
          learningRate: body?.learningRate ?? 0.05,
          tolerance: body?.tolerance ?? 1e-3,
          samples,
        };

        const path = await import('node:path');
        const scriptPath = path.resolve(process.cwd(), 'extension-builder', 'pytorch_trainer.py');
        // Reuses one already-warm subprocess (torch already imported) across
        // requests instead of spawning + re-importing torch every call --
        // see PyTorchTrainerWorker's doc comment.
        const pytorchResult = await this.pytorchWorker.send(scriptPath, spec);

        if (pytorchResult.ok === false) {
          this.sendJson(res, { ok: false, backend: 'pytorch', error: pytorchResult.error });
          return;
        }

        // Group per-sample convergence back up to per-neuron, the same
        // "definition AND every script" all-or-nothing rule builder.js's
        // train() applies.
        const satisfiedReadouts = new Set<number>();
        const failedReadouts = new Set<number>();
        samples.forEach((s, i) => {
          if (pytorchResult.sampleConverged[i]) satisfiedReadouts.add(s.readout);
          else failedReadouts.add(s.readout);
        });
        const trainedNeurons = readoutNames.filter(
          (_, i) => satisfiedReadouts.has(i) && !failedReadouts.has(i)
        );

        this.sendJson(res, {
          ok: true,
          backend: 'pytorch',
          torchVersion: pytorchResult.torchVersion,
          converged: pytorchResult.converged,
          epochs: pytorchResult.epochsRun,
          satisfied: trainedNeurons,
          conflicts: [], // per-dimension independent readouts can't collide the way shared-mesh weights can
          trainedNeurons,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.sendJson(res, { ok: false, backend: 'pytorch', error: msg }, 500);
      }
      return;
    }

    // POST /api/extension/generate-coding-skills — execution-grounded
    // training: each instantiation of a fixed code template (JS/Python/
    // Shell arithmetic, NeuroLang @value) is ACTUALLY RUN, and its neuron
    // is trained on the real (code -> result) it produced -- the live,
    // /builder-reachable equivalent of extension-builder/train-coding-
    // skills.mjs's one-time build script (see that file's doc comment for
    // why each instantiation gets its own readout rather than sharing
    // one: a single per-readout linear+tanh transform can't fit many
    // distinct random mappings at once -- an earlier version of the
    // standalone script measured a real, reproducible 0% held-out
    // accuracy trying that). Deliberately scoped to languages this
    // server can already run without new hard dependencies (Node/Python/
    // Shell/NeuroLang) -- see that file's header for the same reasoning.
    if (pathname === '/api/extension/generate-coding-skills' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { count?: number } | null;
        const perTemplate = Math.max(1, Math.min(50, body?.count ?? 5)); // capped -- this runs real subprocesses per instantiation

        const vm = await import('node:vm');
        const { spawnSync } = await import('node:child_process');
        const { NeuroLangInterpreter } = await import('../models && skills/core/neuro-lang.js');
        const neuroLang = new NeuroLangInterpreter();
        const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

        type Template = { name: string; lang: string; gen: () => string; run: (code: string) => Promise<string | null> };
        const templates: Template[] = [
          {
            name: 'skill_js_add', lang: 'javascript',
            gen: () => `${randInt(0, 50)} + ${randInt(0, 50)}`,
            run: async (code) => String(vm.runInContext(code, vm.createContext({}), { timeout: 1000 })),
          },
          {
            name: 'skill_python_mul', lang: 'python',
            gen: () => `print(${randInt(0, 15)} * ${randInt(0, 15)})`,
            run: async (code) => {
              const r = spawnSync('python3', ['-c', code], { timeout: 5000, encoding: 'utf8' });
              return r.error || r.status !== 0 ? null : r.stdout.trim();
            },
          },
          {
            name: 'skill_shell_sub', lang: 'shell',
            gen: () => `echo $(( ${randInt(10, 60)} - ${randInt(0, 10)} ))`,
            run: async (code) => {
              const r = spawnSync('bash', ['-c', code], { timeout: 5000, encoding: 'utf8' });
              return r.error || r.status !== 0 ? null : r.stdout.trim();
            },
          },
          {
            name: 'skill_neurolang_value', lang: 'neurolang',
            gen: () => `"n"@value="${(randInt(0, 100) / 100).toFixed(2)}"`,
            run: async (code) => {
              const result = await neuroLang.parse(code);
              const n = result.neurons.get('n');
              return n ? String(n.value) : null;
            },
          },
        ];

        const generated: Array<{ name: string; definition: string; scripts: Array<{ userSays: string; response: string }> }> = [];
        for (const t of templates) {
          for (let i = 0; i < perTemplate; i++) {
            const code = t.gen();
            const result = await t.run(code);
            if (result === null || result === undefined || result === '') continue; // this language's runtime isn't available here -- skip, don't fake it
            generated.push({
              name: `${t.name}_${generated.length}`,
              definition: code,
              scripts: [{ userSays: `What does \`${code}\` output?`, response: result }],
            });
          }
        }

        if (generated.length === 0) {
          this.sendJson(res, { ok: false, error: 'no language runtime (node/python3/bash) produced a result on this server' });
          return;
        }

        const trainResult = await this.trainNeuronsViaPyTorch(generated, { epochs: 800 });
        if (trainResult.ok === false) {
          this.sendJson(res, { ok: false, error: trainResult.error });
          return;
        }

        const trainedSet = new Set(trainResult.trainedNeurons);
        this.sendJson(res, {
          ok: true,
          neurons: generated.map(n => ({ ...n, trained: trainedSet.has(n.name) })),
          trainedCount: trainResult.trainedNeurons.length,
          totalCount: generated.length,
          epochs: trainResult.epochsRun,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.sendJson(res, { ok: false, error: msg }, 500);
      }
      return;
    }

    // POST /api/extension/merge-with-saved — real weight averaging
    // ("model soup") between the current /builder project and a
    // previously saved extension: both get trained fresh via PyTorch,
    // then for every neuron NAME present in both, the merged (W, b) row
    // is the genuine elementwise average of the two trained rows -- a
    // name in only one side carries over unchanged. The merged weights
    // are then fine-tuned for real on the union of both sides' samples
    // (not just assumed correct) before being reported back. Same
    // mechanism as extension-builder/merge-networks.mjs, live instead of
    // a one-time build step -- see that file's doc comment for why this
    // only makes sense for PyTorch-trained (@definishon/scripting)
    // neurons, never Code-to-Net's byte-chain ones (moby/Debian), which
    // have no trained weights to average in the first place.
    if (pathname === '/api/extension/merge-with-saved' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as
          {
            neurons?: Array<{ name?: string; definition?: string; scripts?: Array<{ userSays?: string; response?: string }> }>;
            savedFile?: string;
          } | null;
        const currentNeurons = Array.isArray(body?.neurons) ? body.neurons : [];
        const savedFile = (body?.savedFile ?? '').trim();
        if (!savedFile || /[\\/]|\.\./.test(savedFile)) {
          this.sendJson(res, { ok: false, error: 'savedFile must be a bare filename (no path segments)' }, 400);
          return;
        }

        const path = await import('node:path');
        const { promises: fs } = await import('node:fs');
        const dir = path.resolve(process.cwd(), 'extension-builder', 'extensions');
        const savedPath = path.join(dir, savedFile);
        if (path.dirname(savedPath) !== dir) {
          this.sendJson(res, { ok: false, error: 'savedFile resolved outside the extensions directory' }, 400);
          return;
        }
        let savedData: { neurons?: Array<{ name?: string; definition?: string; scripts?: Array<{ userSays?: string; response?: string }> }> };
        try {
          savedData = JSON.parse(await fs.readFile(savedPath, 'utf8'));
        } catch (err) {
          this.sendJson(res, { ok: false, error: `could not read "${savedFile}": ${err instanceof Error ? err.message : String(err)}` }, 404);
          return;
        }
        const savedNeurons = Array.isArray(savedData.neurons) ? savedData.neurons : [];

        const [a, b] = await Promise.all([
          this.trainNeuronsViaPyTorch(currentNeurons, { epochs: 800 }),
          this.trainNeuronsViaPyTorch(savedNeurons, { epochs: 800 }),
        ]);
        if (a.ok === false) { this.sendJson(res, { ok: false, error: `current project: ${a.error}` }); return; }
        if (b.ok === false) { this.sendJson(res, { ok: false, error: `"${savedFile}": ${b.error}` }); return; }
        if (a.names.length === 0 && b.names.length === 0) {
          this.sendJson(res, { ok: false, error: 'neither side has any trainable (@definishon or scripted) neurons to merge' });
          return;
        }

        // The actual merge: union of names, elementwise-averaged rows for
        // any name in both.
        const bIndexByName = new Map(b.names.map((n, i) => [n, i]));
        const mergedNames: string[] = [];
        const mergedW: number[][] = [];
        const mergedB: number[][] = [];
        let overlapCount = 0;
        for (let i = 0; i < a.names.length; i++) {
          const name = a.names[i];
          const bi = bIndexByName.get(name);
          if (bi === undefined) {
            mergedNames.push(name); mergedW.push(a.W[i]); mergedB.push(a.b[i]);
          } else {
            overlapCount++;
            mergedNames.push(name);
            mergedW.push(a.W[i].map((v, d) => (v + b.W[bi][d]) / 2));
            mergedB.push(a.b[i].map((v, d) => (v + b.b[bi][d]) / 2));
            bIndexByName.delete(name);
          }
        }
        for (const [name, bi] of bIndexByName) {
          mergedNames.push(name); mergedW.push(b.W[bi]); mergedB.push(b.b[bi]);
        }

        const mergedIndexByName = new Map(mergedNames.map((n, i) => [n, i]));
        const remap = (samples: typeof a.samples, names: string[]) =>
          samples.map(s => ({ ...s, readout: mergedIndexByName.get(names[s.readout])! }));
        const unionSamples = [...remap(a.samples, a.names), ...remap(b.samples, b.names)];

        const pathMod = await import('node:path');
        const scriptPath = pathMod.resolve(process.cwd(), 'extension-builder', 'pytorch_trainer.py');
        const fineTune = await this.pytorchWorker.send(scriptPath, {
          dims: 16, numReadouts: mergedNames.length, epochs: 800, learningRate: 0.05, tolerance: 1e-3,
          samples: unionSamples, initW: mergedW, initB: mergedB,
        });

        const currentByName = new Map(currentNeurons.map(n => [n.name, n]));
        const savedByName = new Map(savedNeurons.map(n => [n.name, n]));
        const trainedSet = new Set(
          fineTune.ok
            ? mergedNames.filter((_, i) => fineTune.sampleConverged
                .filter((_c, si) => unionSamples[si].readout === i)
                .every(Boolean))
            : [],
        );
        const mergedNeurons = mergedNames.map(name => {
          const src = currentByName.get(name) ?? savedByName.get(name);
          return {
            name,
            definition: src?.definition ?? '',
            scripts: src?.scripts ?? [],
            trained: trainedSet.has(name),
          };
        });

        this.sendJson(res, {
          ok: true,
          neurons: mergedNeurons,
          totalCount: mergedNeurons.length,
          overlapCount,
          fineTuneOk: fineTune.ok,
          fineTuneError: fineTune.ok === false ? fineTune.error : undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.sendJson(res, { ok: false, error: msg }, 500);
      }
      return;
    }

    // POST /api/zip-loop/file — a file goes straight into the network.
    //
    // The body IS the file: raw bytes, whatever they are. A recording arrives
    // here as a recording rather than as a transcript of itself, which matters
    // because transcribing first throws away everything about it except the
    // words -- and the doorway turns it into bits either way.
    //
    // ?path= chooses where in the archive it lands (default input/), so the
    // same route takes a recording, an image, or anything else without
    // needing a variant per kind of file.
    if (pathname === '/api/zip-loop/file' && method === 'POST') {
      const chunks: Buffer[] = [];
      let total = 0;
      // Same ceiling as the transcription route: generous for a recording,
      // bounded so a malformed or hostile request cannot grow without limit.
      const MAX_FILE_BYTES = 25 * 1024 * 1024;
      let tooLarge = false;
      await new Promise<void>((resolve) => {
        req.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_FILE_BYTES) {
            tooLarge = true;
            req.destroy();
            resolve();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => resolve());
        req.on('error', () => resolve());
      });
      if (tooLarge) {
        this.sendJson(res, { error: 'That file is too large to send through the doorway in one go.' }, 413);
        return;
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length === 0) {
        this.sendJson(res, { error: 'The body was empty — there is no file to send in.' }, 400);
        return;
      }

      const { ZIP_FOLDERS } = await import('../models && skills/core/zip-halt.js');
      const requested = parsedUrl.searchParams.get("path") ?? "";
      // Contained to the archive: a path that climbs out of it is not a file
      // in this tree, whatever it is.
      const safe = requested.replace(/\\/g, '/').replace(/(^|\/)\.\.(?=\/|$)/g, '').replace(/^\/+/, '');
      const filePath = safe || `${ZIP_FOLDERS.prompt}file-${Date.now()}`;

      this.sendJson(res, {
        ok: true,
        path: filePath,
        bytes: bytes.length,
        // Handed back ready to send: the caller posts this to
        // /api/zip-loop/run as `binary`, or keeps it for a later run.
        binary: { [filePath]: bytes.toString('base64') },
      });
      return;
    }

    // POST /api/zip-loop/run — send an archive in through two neurons and read
    // what comes back, until the network stops ITSELF.
    //
    // The architecture is all-to-all, so there is no last layer to fall out
    // of: signal goes in and keeps bouncing. Nothing here decides when the
    // work is done. The network says so, by writing a stop call into the
    // plugins/ folder of the archive it is emitting -- and that only counts
    // once it has also gone quiet, because writing "stop" and continuing to
    // type is not finishing.
    //
    // Two honest limits, reported rather than hidden. The ceiling is a
    // termination guarantee, not a halt condition: a network that has not been
    // TRAINED to emit the stop call will hit it every time, and the response
    // says "ceiling" and complete:false so nobody mistakes a cut-off run for a
    // finished one. And every bit is one full settle() of the mesh, so this is
    // slow by construction -- a few hundred ticks, not a few hundred thousand.
    if (pathname === '/api/zip-loop/run' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as
          {
            files?: Record<string, string>;
            binary?: Record<string, string>;
            archive?: string;
            prompt?: string;
            promptingSkills?: string[];
            plugins?: string[];
            includeHistory?: boolean;
            resume?: boolean;
            quietTicks?: number;
            maxTicks?: number;
          } | null;

        const { packZip, unpackZip, ZIP_FOLDERS, STOP_CALL, NETWORK_STATE_FILE, STOP_REPORT_FILE } =
          await import('../models && skills/core/zip-halt.js');

        // Three ways to say what goes in, because the whole point of an
        // archive doorway is that complicated things fit through it: a plain
        // prompt (dropped into input/ for you), an explicit tree of folders
        // and files, or an already-packed archive as base64 -- which is how
        // real files and folders from a disk get here without being retyped
        // as JSON.
        const files: Record<string, string> = {};
        if (typeof body?.prompt === 'string' && body.prompt.trim()) {
          files[`${ZIP_FOLDERS.prompt}prompt.txt`] = body.prompt;
        }
        for (const [path, content] of Object.entries(body?.files ?? {})) {
          if (typeof content === 'string') files[path] = content;
        }
        // Files that are not text go straight in as files. A recording does not
        // have to become a transcript before the network is allowed to see it
        // -- everything becomes bits at the doorway regardless, and turning
        // audio into words first throws away everything except the words.
        const binary: Record<string, string> = {};
        for (const [filePath, encoded] of Object.entries(body?.binary ?? {})) {
          if (typeof encoded === 'string') binary[filePath] = encoded;
        }

        if (typeof body?.archive === 'string' && body.archive) {
          const unpacked = unpackZip(new Uint8Array(Buffer.from(body.archive, 'base64')));
          if (!unpacked) {
            this.sendJson(res, { error: 'That archive could not be read. Send base64 of a packed zip tree.' }, 400);
            return;
          }
          Object.assign(files, unpacked.files);
          Object.assign(binary, unpacked.binary ?? {});
        }

        // memory/ is chat history from OTHER conversations -- the network's past
        // across sessions, handed to it through the same doorway as everything
        // else. Opt-in, because a run that did not ask to be given its history
        // should not silently be sending it through the mesh.
        if (body?.includeHistory) {
          const threads = this.chatHistory.listThreads().slice(0, 10);
          for (const thread of threads) {
            const transcript = thread.messages
              .map(m => `${m.role}: ${m.content}`)
              .join('\n');
            files[`${ZIP_FOLDERS.memory}${thread.id}.txt`] = transcript;
          }
        }

        const { getNeuroclawSystem } = await import('../src/index.js');
        const system = await getNeuroclawSystem();

        // A selected prompting skill goes IN THE ARCHIVE, in its own folder --
        // not spliced into the prompt, where guidance about how to go about
        // something would be indistinguishable from what was actually asked.
        //
        // This is not a net skill and there is no folder for one: a net skill
        // is neurons wired into the mesh, part of the network rather than
        // something handed to it.
        if (Array.isArray(body?.promptingSkills) && body.promptingSkills.length > 0) {
          const { builtInPromptingSkills } = await import('../models && skills/core/prompting-skills.js');
          const wanted = new Set(body.promptingSkills.map(String));
          // Installed skills first: installing one is how someone replaces a
          // built-in, so the installed version has to win the name.
          const installed = listInstalled();
          const installedNames = new Set(installed.map(skill => skill.name));
          const available = [...installed, ...builtInPromptingSkills().filter(skill => !installedNames.has(skill.name))];
          for (const skill of available) {
            if (!wanted.has(skill.name)) continue;
            // One folder per skill, holding the skill itself -- the same shape
            // a plug-in folder has, so anything reading the archive can walk
            // both the same way.
            files[`${ZIP_FOLDERS.promptingSkills}${skill.name}/SKILL.json`] = JSON.stringify(skill, null, 2);
          }
        }

        // Plug-ins: one folder each, carrying what that plug-in says it can do.
        // A plug-in is a capability with instructions, so what goes in is the
        // instructions -- not a name the network has to already know.
        if (Array.isArray(body?.plugins) && body.plugins.length > 0) {
          const wanted = new Set(body.plugins.map(String));
          for (const definition of system.pluginRegistry.listPlugins()) {
            if (!wanted.has(definition.id)) continue;
            files[`${ZIP_FOLDERS.plugins}${definition.id}/PLUGIN.json`] = JSON.stringify(
              {
                id: definition.id,
                name: definition.name,
                type: definition.type,
                capabilities: definition.capabilities ?? [],
              },
              null,
              2,
            );
          }
        }

        // The pipeline builds its mesh and engine lazily on first run, and in a
        // default deployment nothing had run it -- so this endpoint answered
        // "the network has not run yet" forever. Building them is a thing a
        // caller can now simply ask for.
        system.pipeline.ensureReady();
        const engine = system.pipeline.getHyperEngine();
        if (!engine) {
          this.sendJson(res, {
            error: 'The network has not run yet, so it has no engine to stream through. Ask it something first.',
          }, 409);
          return;
        }

        const { ZipLoopInterface } = await import('../models && skills/core/onebrain.js');
        const { runUntilStoppedAsync, DEFAULT_HALT } = await import('../models && skills/core/zip-halt.js');
        const zip = new ZipLoopInterface(engine, { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 });

        // Capped hard. One settle per bit means an unbounded ceiling here
        // would be a request that never returns.
        const maxTicks = Math.min(Math.max(1, Number(body?.maxTicks) || 512), 4096);
        const quietTicks = Math.min(Math.max(1, Number(body?.quietTicks) || DEFAULT_HALT.quietTicks), maxTicks);

        // Said up front, because it is the number that matters: every bit is
        // one settle() of the mesh, so the send alone costs bytesIn * 8 ticks
        // before a single bit of output is read.
        const bytesIn = packZip({ files, binary }).length;

        // Pick up where the last run stopped, if asked and if there is anything
        // to pick up. Skipped silently when there is no saved state -- a first
        // run has nothing to resume and that is not a failure.
        let resumed = false;
        if (body?.resume) {
          const saved = await this.readSavedNetworkState();
          if (saved) resumed = engine.restoreNetworkState(saved);
        }

        const result = await runUntilStoppedAsync(zip, { files, binary }, { quietTicks, maxTicks });

        // When it stops it saves the input of every neuron -- whatever the
        // reason it stopped. A run cut off at the ceiling has MORE worth
        // keeping than one that ended tidily, since its state is the only
        // record of how far it got. Written atomically, because the reason to
        // save state at all is to survive things ending badly.
        let savedNeurons = 0;
        if (result.networkState) {
          savedNeurons = await this.saveNetworkState(result.networkState);
        }
        this.sendJson(res, {
          ok: true,
          bytesIn,
          sendTicks: bytesIn * 8,
          // What was actually in the archive. A caller that asked for two
          // prompting skills and a plug-in should be able to see that all
          // three went in, rather than inferring it from a byte count.
          contents: [...Object.keys(files), ...Object.keys(binary)].sort(),
          // What the network has to write to end its own run.
          stopCall: STOP_CALL,
          reason: result.reason,
          complete: result.complete,
          sawStop: result.sawStop,
          ticks: result.ticks,
          bytesOut: result.raw.length,
          tree: result.tree,
          // Where the state went, on disk and inside the archive.
          savedNeurons,
          stateFile: NETWORK_STATE_FILE,
          // What the stop command found when it looked at every neuron.
          stopReport: result.stopReport,
          stopReportFile: STOP_REPORT_FILE,
          resumed,
        });
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    // POST /api/extension/plan-requirements — "here is what I need, make it true"
    //
    // The builder could always build a net skill once you knew which neurons
    // you wanted. This answers the question people actually start with: a list
    // of requirements. It plans a net skill by default -- that is the whole
    // point of the builder -- and reports separately which requirements would
    // be learned better from examples, so training a new network stays an
    // informed choice rather than something that happens to you.
    //
    // The plan is made AGAINST the main model, with the main model frozen. It
    // can see every neuron the main model already has, which is what lets it
    // say "you already have this" instead of rebuilding it, and the freeze is
    // verified rather than merely intended: a digest before, the same digest
    // after. Nothing here writes to the main model, and nothing here installs
    // anything -- the neurons join a mesh when someone installs the skill.
    if (pathname === '/api/extension/plan-requirements' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { requirements?: string[] | string } | null;
        const raw = body?.requirements;
        const requirements = Array.isArray(raw)
          ? raw
          : typeof raw === 'string'
            ? raw.split('\n')
            : [];
        const cleaned = requirements.map(r => String(r).trim()).filter(Boolean);
        if (cleaned.length === 0) {
          this.sendJson(res, { error: 'Give it at least one requirement — there is nothing to make true otherwise.' }, 400);
          return;
        }

        const { getNeuroclawSystem } = await import('../src/index.js');
        const system = await getNeuroclawSystem();
        const moe = system.pluginRegistry.getMoE?.();

        // One entry per neuron, so a change in neuron count changes the digest
        // too -- a freeze that only noticed renames would miss the failure that
        // actually matters, which is something quietly growing the main mesh.
        const view = {
          neuronNames: () => {
            const names: string[] = [];
            for (const expert of moe?.listExperts() ?? []) {
              for (let i = 0; i < expert.neuronIds.length; i++) names.push(expert.name);
            }
            return names;
          },
        };

        const { planAgainstFrozenModel } = await import('../models && skills/core/skill-freeze.js');
        const { plan, frozen, verified } = planAgainstFrozenModel(cleaned, view, {
          // The router knows about capabilities the mesh has no neuron named
          // for (a plugin that reads files is not a neuron called "read file"),
          // so it is consulted alongside the frozen model, not instead of it.
          //
          // Its raw score is a rank, not a confidence -- "8" means two matching
          // terms, and feeding that straight in meant nothing ever cleared the
          // planner's threshold, so the plan cheerfully proposed rebuilding
          // capabilities this machine plainly has. What crosses over is the
          // fraction of the requirement the plugin actually declares, on the
          // same 0-100 scale the frozen model reports.
          findExisting: task =>
            system.pluginRegistry
              .rankPlugins(task)
              .slice(0, 3)
              .map(r => ({
                id: r.id,
                score: r.inputTerms > 0 ? Math.min(100, Math.round((r.matched / r.inputTerms) * 100)) : 0,
                reason: r.reason,
              }))
              .filter(r => r.score >= 50),
        });

        this.sendJson(res, {
          ok: true,
          plan,
          neuroLang: plan.neuroLang,
          frozen: { neuronCount: frozen.neuronCount, digest: frozen.digest, frozenAt: frozen.frozenAt },
          mainModelUnchanged: verified,
        });
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    // POST /api/extension/build — build a real extension from NeuroLang and save it
    // POST /api/extension/publish — build a net skill and put it in the store.
    //
    // The Extension Builder builds net skills, and until now its output went to
    // extension-builder/extensions/ and stopped there. So the chain the whole
    // system is built around -- builder makes a net skill, it is published,
    // someone installs it, its neurons join the shared all-to-all mesh -- was
    // broken at the very first link. Anything built here was invisible to
    // everyone else.
    //
    // Publishing is open, like every other publish. It does NOT install: the
    // person on the other machine still chooses, and their install is what
    // wires the neurons into their network.
    if (pathname === '/api/extension/publish' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as
          { name?: string; description?: string; code?: string; quantize?: boolean; bits?: number; author?: string } | null;
        const name = (body?.name ?? '').trim();
        if (!name) {
          this.sendJson(res, { error: 'A net skill needs a name to be published under.' }, 400);
          return;
        }

        // The main model is frozen for the duration of the build. A skill is
        // built WITH the main model as part of the picture and cannot change
        // it, which is the training system's own rule (§8) applied to the
        // thing people do most often. The interesting failure is not a build
        // that crashes -- it is a build that quietly leaves the general
        // network different than it was, which nobody notices until the model
        // behaves differently and no history explains why. So it is checked,
        // not merely intended.
        const { getNeuroclawSystem: loadSystem } = await import('../src/index.js');
        const system = await loadSystem();
        const moe = system.pluginRegistry.getMoE?.();
        const mainModel = {
          neuronNames: () => {
            const names: string[] = [];
            for (const expert of moe?.listExperts() ?? []) {
              for (let i = 0; i < expert.neuronIds.length; i++) names.push(expert.name);
            }
            return names;
          },
        };
        const { freezeMainModel, assertMainModelUnchanged, MainModelChanged } =
          await import('../models && skills/core/skill-freeze.js');
        const frozen = freezeMainModel(mainModel);

        const { ExtensionBuilder } = await import('../extension-builder/builder.js');
        const builder = new ExtensionBuilder();
        const project = builder.createProject(name, body?.description ?? '');
        const parsed = await builder.parseNeuroLang(project.id, body?.code ?? '');
        if (!parsed.success) {
          // The builder's own errors, not a generic failure: someone fixing
          // their NeuroLang needs to know which line it disliked.
          this.sendJson(res, { errors: parsed.errors }, 400);
          return;
        }

        const quantize = body?.quantize === true;
        const bits = body?.bits ?? 8;
        const compiled = quantize
          ? await builder.installWithQuantization(project.id, { bits })
          : builder.saveWithoutQuantization(project.id);

        const proj = builder.getProject(project.id);
        const neurons = proj
          ? Array.from(proj.neurons.values()).map(n => ({ name: n.name, value: n.value, definition: n.definition }))
          : [];
        if (neurons.length === 0) {
          this.sendJson(res, { error: 'That built nothing — a net skill with no neurons has nothing to join a network with.' }, 400);
          return;
        }

        // Both artifacts, for the same reason skill-agent publishes both: the
        // compiled form is what installs, and the source form is what someone
        // reads before deciding to.
        const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || `skill-${Date.now()}`;
        const { publishAndSync } = await import('../models && skills/core/store.js');
        const { item, sync } = await publishAndSync({
          kind: 'skills',
          name: slug,
          title: name,
          description:
            (body?.description ?? '').trim() ||
            `A net skill built in the Extension Builder: ${neurons.length} neuron${neurons.length === 1 ? '' : 's'}.`,
          author: typeof body?.author === 'string' && body.author.trim() ? body.author.trim() : 'extension-builder',
          files: [
            { filename: `${slug}.skill.json`, content: compiled ?? JSON.stringify({ neurons }) },
            { filename: `${slug}.source.json`, content: JSON.stringify({ neurons, code: body?.code ?? '' }, null, 2) },
          ],
        });

        // Verified after the build, before anyone is told it succeeded: the
        // skill's neurons join a mesh when someone INSTALLS it, never here.
        try {
          assertMainModelUnchanged(frozen, mainModel);
        } catch (err) {
          if (err instanceof MainModelChanged) {
            this.sendJson(res, { error: err.message, published: true, item, mainModelUnchanged: false }, 409);
            return;
          }
          throw err;
        }

        this.sendJson(res, {
          ok: true,
          item,
          sync,
          neurons: neurons.length,
          quantized: quantize,
          frozenMainModel: { neuronCount: frozen.neuronCount, digest: frozen.digest },
          mainModelUnchanged: true,
        }, 201);
      } catch (err) {
        this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
      return;
    }

    if (pathname === '/api/extension/build' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as
          { name?: string; description?: string; code?: string; quantize?: boolean; bits?: number } | null;
        const name = (body?.name ?? '').trim() || `extension_${Date.now()}`;
        const code = body?.code ?? '';
        const { ExtensionBuilder } = await import('../extension-builder/builder.js');
        const builder = new ExtensionBuilder();
        const project = builder.createProject(name, body?.description ?? '');
        const parsed = await builder.parseNeuroLang(project.id, code);
        if (!parsed.success) {
          this.sendJson(res, { errors: parsed.errors }, 400);
          return;
        }
        if (body?.bits !== undefined && (typeof body.bits !== 'number' || !Number.isFinite(body.bits))) {
          this.sendJson(res, { error: 'bits must be a finite number' }, 400);
          return;
        }
        const quantize = body?.quantize === true;
        const bits = body?.bits ?? 8;
        const json = quantize
          ? await builder.installWithQuantization(project.id, { bits })
          : builder.saveWithoutQuantization(project.id);

        const path = await import('node:path');
        const { promises: fs } = await import('node:fs');
        const dir = path.resolve(process.cwd(), 'extension-builder', 'extensions');
        await fs.mkdir(dir, { recursive: true });
        const safe = name.replace(/[^a-zA-Z0-9_-]+/g, '_');
        const filename = `${safe}_${Date.now()}.ext.json`;
        await fs.writeFile(path.join(dir, filename), json ?? '{}', 'utf8');

        const proj = builder.getProject(project.id);
        const neurons = proj
          ? Array.from(proj.neurons.values()).map(n => ({ name: n.name, value: n.value, definition: n.definition }))
          : [];
        this.sendJson(res, {
          ok: true, name, savedAs: filename, quantized: quantize,
          bits: quantize ? bits : null, stats: builder.getStats(project.id), neurons,
        });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // GET /api/extension/list — list the extensions saved on disk
    if (pathname === '/api/extension/list' && method === 'GET') {
      try {
        const path = await import('node:path');
        const { promises: fs } = await import('node:fs');
        const dir = path.resolve(process.cwd(), 'extension-builder', 'extensions');
        let files: string[] = [];
        try { files = (await fs.readdir(dir)).filter(f => f.endsWith('.ext.json')); } catch { files = []; }
        const extensions: Array<{ file: string; name: string; neurons: number; quantized?: boolean; bits?: number | null }> = [];
        for (const f of files) {
          try {
            const data = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
            extensions.push({
              file: f, name: data.project?.name ?? f,
              neurons: Array.isArray(data.neurons) ? data.neurons.length : 0,
              quantized: data.quantized === true, bits: data.bits ?? null,
            });
          } catch { extensions.push({ file: f, name: f, neurons: 0 }); }
        }
        this.sendJson(res, { extensions, total: extensions.length });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // POST /api/apps/launch — launch an application via AppLauncher
    if (pathname === '/api/apps/launch' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as
          { command?: string; args?: string[]; name?: string; workspace?: number } | null;

        if (!body?.command || typeof body.command !== 'string') {
          this.sendJson(res, { error: 'Missing command field' }, 400);
          return;
        }
        if (body.args !== undefined && (!Array.isArray(body.args) || !body.args.every(a => typeof a === 'string'))) {
          this.sendJson(res, { error: 'args must be an array of strings' }, 400);
          return;
        }

        const app = this.launcher.launch(body.command, {
          name: body.name,
          args: body.args,
          workspace: body.workspace ?? -1,
          waitForWindow: true,
        });

        this.sendJson(res, {
          ok: true,
          appId: app.id,
          name: app.name,
          pid: app.pid,
          workspace: app.workspace,
        });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // GET /api/apps/list — list launched applications
    if (pathname === '/api/apps/list' && method === 'GET') {
      const apps = this.launcher.listApps();
      const active = this.launcher.listActive();
      this.sendJson(res, {
        apps: apps.map(a => ({ ...a, active: a.active })),
        total: apps.length,
        activeCount: active.length,
      });
      return;
    }

    // POST /api/apps/close — close a launched application
    if (pathname === '/api/apps/close' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { appId?: string } | null;
        
        if (!body?.appId) {
          this.sendJson(res, { error: 'Missing appId field' }, 400);
          return;
        }

        const closed = this.launcher.close(body.appId);
        this.sendJson(res, { ok: closed, appId: body.appId });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    // POST /api/apps/launch-package — launch .deb/.exe/.apk packages
    if (pathname === '/api/apps/launch-package' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as
          { path?: string; type?: 'deb' | 'exe' | 'apk' } | null;

        if (!body?.path || typeof body.path !== 'string') {
          this.sendJson(res, { error: 'Missing path field' }, 400);
          return;
        }
        // A path starting with "-" would be read as a flag by apt/wine/adb
        // (e.g. "-y", "--allow-downgrades") once it lands in the args array
        // below, rather than as the package path it's supposed to be --
        // launch() no longer runs these through a shell (see app-launcher.js),
        // so this is argument injection, not command injection, but it's the
        // same "attacker-controlled string reaches a privileged command
        // unvalidated" root cause and costs nothing to reject.
        if (body.path.startsWith('-')) {
          this.sendJson(res, { error: 'Invalid path field' }, 400);
          return;
        }

        const packagePath = body.path;
        let command: string;
        let args: string[] = [];
        const type = body.type || (
          packagePath.endsWith('.deb') ? 'deb' :
          packagePath.endsWith('.exe') ? 'exe' :
          packagePath.endsWith('.apk') ? 'apk' : undefined
        );

        switch (type) {
          case 'deb':
            command = 'sudo';
            args = ['apt', 'install', '-y', packagePath];
            break;
          case 'exe':
            command = 'wine';
            args = [packagePath];
            break;
          case 'apk':
            command = 'adb';
            args = ['install', packagePath];
            break;
          default:
            // Try to run as executable
            command = packagePath;
        }

        const app = this.launcher.launch(command, {
          name: packagePath.split('/').pop() || 'package',
          args,
          workspace: -1,
        });

        this.sendJson(res, {
          ok: true,
          appId: app.id,
          name: app.name,
          pid: app.pid,
          packageType: type,
        });
      } catch (err) {
        this.sendError(res, err);
      }
      return;
    }

    this.sendJson(res, { error: 'Not Found' }, 404);
  }
}
