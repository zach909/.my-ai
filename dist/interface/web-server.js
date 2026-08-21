import http from 'node:http';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { AppLauncher } from './app-launcher.js';
import { EncryptionManager } from './encryption.js';
import { ChatHistoryStore } from '../models && skills/core/chat-history-store.js';
import { listWikiPages, readWikiPage, publishWikiPage, deleteWikiPage, WikiNameError } from '../models && skills/core/wiki-store.js';
import { getSharedChatStore, SharedChatError } from '../models && skills/core/shared-chat-store.js';
import { listSkillUploads, readSkillUpload, readSkillUploadFile, readSkillUploadExtraFile, saveSkillUpload, saveSkillUploadExtraFiles, deleteSkillUpload, deleteSkillUploadExtraFile, linkSkillUploadWiki, unlinkSkillUploadWiki, recordSkillUploadRsiPass, SkillUploadError, SKILL_UPLOAD_SLOTS, } from '../models && skills/core/skill-upload-store.js';
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
    constructor() {
        this.child = null;
        this.pending = [];
        this.stdoutBuf = '';
        this.stderrBuf = '';
        // Serializes concurrent ensureSpawned() calls -- without this, two
        // requests racing in before the first spawn resolves would each see
        // `this.child === null` and spawn a second orphaned python3 process.
        this.spawning = null;
    }
    ensureSpawned(scriptPath) {
        if (this.child)
            return Promise.resolve(this.child);
        if (!this.spawning) {
            this.spawning = this.doSpawn(scriptPath).finally(() => { this.spawning = null; });
        }
        return this.spawning;
    }
    async doSpawn(scriptPath) {
        let child;
        try {
            // Deferred import, not a top-level one: keeps `node:child_process`
            // (and the subprocess it can spawn) out of any code path that
            // doesn't actually use this optional backend.
            const { spawn } = await import('node:child_process');
            child = spawn('python3', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
        }
        catch (err) {
            return { error: `could not launch python3: ${err instanceof Error ? err.message : String(err)}` };
        }
        child.stdout.on('data', (d) => this.onStdout(d));
        child.stderr.on('data', (d) => { this.stderrBuf += d; });
        const onDown = (detail) => {
            // The process is gone (crashed, killed, or python3/torch missing) --
            // fail every request still waiting on it and drop the reference so
            // the next call respawns fresh instead of writing into a dead pipe.
            const err = { ok: false, error: detail };
            const waiting = this.pending;
            this.pending = [];
            this.child = null;
            for (const p of waiting)
                p.resolve(err);
        };
        child.on('error', (err) => onDown(`python3 not available: ${err.message}`));
        child.on('exit', (code, signal) => {
            if (this.pending.length > 0) {
                onDown(this.stderrBuf.trim() || `pytorch_trainer.py exited (code=${code}, signal=${signal})`);
            }
            else {
                this.child = null;
            }
        });
        this.child = child;
        return child;
    }
    onStdout(chunk) {
        this.stdoutBuf += chunk;
        let nl;
        while ((nl = this.stdoutBuf.indexOf('\n')) !== -1) {
            const line = this.stdoutBuf.slice(0, nl).trim();
            this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
            if (!line)
                continue;
            const next = this.pending.shift();
            if (!next)
                continue; // stray output with nothing waiting on it
            try {
                next.resolve(JSON.parse(line));
            }
            catch {
                next.resolve({ ok: false, error: `could not parse pytorch_trainer.py output: ${line}` });
            }
        }
    }
    async send(scriptPath, spec) {
        const child = await this.ensureSpawned(scriptPath);
        if (!('stdin' in child))
            return { ok: false, error: child.error };
        return new Promise((resolve) => {
            this.pending.push({ resolve });
            child.stdin.write(JSON.stringify(spec) + '\n');
        });
    }
    /** Called from WebServer.stop() so a stopped server doesn't leave an orphaned python3 process behind. */
    shutdown() {
        this.child?.stdin.end();
        this.child?.kill();
        this.child = null;
        const err = { ok: false, error: 'server is shutting down' };
        for (const p of this.pending)
            p.resolve(err);
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
  function addMessage(type, text, time) {
    const div = document.createElement('div');
    div.className = 'message ' + type;
    if (type === 'ai') {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy AI response');
      btn.onclick = () => {
        navigator.clipboard.writeText(text);
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
    ts.textContent = time || new Date().toLocaleTimeString();
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
      const res = await fetch('/api/status');
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
        addMessage('ai', data.response, aiTime);
        chatHistory.push({role: 'assistant', content: data.response, time: aiTime});
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
  setInterval(checkStatus, 3000);
  checkStatus();
  if (chatHistory.length) {
    chatHistory.forEach(m => addMessage(m.role === 'user' ? 'user' : 'ai', m.content, m.time));
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
    constructor() {
        this.hash = null;
        this.salt = null;
        this.encryption = new EncryptionManager();
    }
    async set(password) {
        this.salt = crypto.randomBytes(16);
        this.hash = await this.encryption.hashPassword(password, this.salt);
    }
    get required() {
        return this.hash !== null;
    }
    async check(suppliedPassword) {
        if (!this.required)
            return true;
        const suppliedHash = await this.encryption.hashPassword(suppliedPassword || ' ', this.salt).catch(() => null);
        if (!suppliedHash || suppliedHash.length !== this.hash.length)
            return false;
        return crypto.timingSafeEqual(suppliedHash, this.hash);
    }
}
export class WebServer {
    constructor(runner, launcher) {
        this.server = null;
        this.port = 0;
        // Set only when start() is given a non-localhost host and a password --
        // see start()'s doc comment for why binding remotely without one is refused.
        this.remoteAccessLock = new PasswordLock();
        // Independent of remoteAccessLock: gates only /api/chat-groups/* (and the
        // /app/chat-groups page's own login prompt), even over an already-trusted
        // localhost connection -- set via NEUROCLAW_CHAT_GROUPS_PASSWORD.
        this.chatGroupsLock = new PasswordLock();
        this.chatHistory = new ChatHistoryStore();
        // Lazily spawned on first POST /api/extension/train-pytorch call, then
        // reused for the life of this server -- see PyTorchTrainerWorker's own
        // doc comment for why (torch import cost dominates a per-request spawn).
        this.pytorchWorker = new PyTorchTrainerWorker();
        // Set once by loadSavedExtensions() during start() -- surfaced via
        // GET /api/status so "did the runner actually pick up my trained
        // network on this boot" is observable, not just assumed.
        this.loadedExtensions = { files: 0, remembered: 0 };
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
    async start(port = 3000, host = '127.0.0.1', password) {
        if (this.server)
            throw new Error('Web server already running');
        this.port = port;
        const isLocal = LOCAL_HOSTS.has(host);
        if (!isLocal) {
            if (!password) {
                throw new Error(`Refusing to bind to ${host}: a password is required for non-localhost access ` +
                    `(set NEUROCLAW_WEB_PASSWORD). Binding stays loopback-only otherwise.`);
            }
            await this.remoteAccessLock.set(password);
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
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => this.handleRequest(req, res));
            this.server.listen(port, host, () => resolve());
            this.server.on('error', (err) => { this.server = null; reject(err); });
        });
    }
    /** Constant-time check of an incoming `Authorization: Basic ...` header's password against `lock`. */
    async isAuthorizedBasic(req, lock) {
        if (!lock.required)
            return true;
        const header = req.headers.authorization ?? '';
        const match = /^Basic\s+(\S+)$/i.exec(header);
        if (!match)
            return false;
        let decoded;
        try {
            decoded = Buffer.from(match[1], 'base64').toString('utf8');
        }
        catch {
            return false;
        }
        const sep = decoded.indexOf(':');
        const suppliedPassword = sep === -1 ? decoded : decoded.slice(sep + 1);
        return lock.check(suppliedPassword);
    }
    requireAuth(res) {
        this.setSecurityHeaders(res);
        res.setHeader('WWW-Authenticate', 'Basic realm="Neuroclaw", charset="UTF-8"');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required' }));
    }
    /**
     * Gate for /api/chat-groups/* specifically, checked via a plain header
     * (not Authorization: Basic -- the chat-groups page shows its own login
     * form rather than the browser's native basic-auth prompt) so it can be
     * locked independently of remoteAccessLock, including over an
     * already-trusted localhost connection.
     */
    async isChatGroupsAuthorized(req) {
        if (!this.chatGroupsLock.required)
            return true;
        const supplied = req.headers['x-chat-groups-password'];
        if (typeof supplied !== 'string')
            return false;
        return this.chatGroupsLock.check(supplied);
    }
    requireChatGroupsAuth(res) {
        this.setSecurityHeaders(res);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Chat groups password required' }));
    }
    async stop() {
        if (!this.server)
            throw new Error('Server not running');
        this.pytorchWorker.shutdown();
        return new Promise((resolve) => {
            this.server?.close(() => { this.server = null; resolve(); });
        });
    }
    getPort() { return this.port; }
    setSecurityHeaders(res) {
        // Security: Restricted CORS and standard security headers
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';");
    }
    sendJson(res, data, statusCode = 200) {
        this.setSecurityHeaders(res);
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }
    sendHtml(res, html) {
        this.setSecurityHeaders(res);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    }
    async parseBody(req) {
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
        const contentType = req.headers['content-type'] ?? '';
        if (!/^application\/json(;|$)/i.test(contentType.trim())) {
            throw new Error('Content-Type must be application/json');
        }
        const LIMIT = 1024 * 1024; // 1MB limit
        let totalSize = 0;
        return new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', (chunk) => {
                totalSize += chunk.length;
                if (totalSize > LIMIT) {
                    req.destroy();
                    reject(new Error('Request body too large (limit: 1MB)'));
                }
                else {
                    chunks.push(chunk);
                }
            });
            req.on('end', () => {
                if (totalSize > LIMIT)
                    return;
                const raw = Buffer.concat(chunks).toString('utf8');
                if (!raw) {
                    resolve(null);
                    return;
                }
                try {
                    resolve(JSON.parse(raw));
                }
                catch {
                    reject(new Error('Invalid JSON'));
                }
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
    async trainNeuronsViaPyTorch(neurons, opts = {}) {
        const dims = 16;
        const { embedText } = await import('../models && skills/core/neuro-lang.js');
        const definitionTrigger = new Array(dims).fill(0.7);
        const samples = [];
        const names = [];
        for (const n of neurons) {
            if (!n.name)
                continue;
            const def = (n.definition ?? '').trim();
            const scripts = (n.scripts ?? []).filter(s => (s.userSays ?? '').trim() && (s.response ?? '').trim());
            if (!def && scripts.length === 0)
                continue;
            const readout = names.length;
            names.push(n.name);
            if (def)
                samples.push({ readout, input: definitionTrigger, target: embedText(def, dims) });
            for (const s of scripts) {
                samples.push({ readout, input: embedText(s.userSays.trim(), dims), target: embedText(s.response.trim(), dims) });
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
        if (result.ok === false)
            return { ok: false, error: result.error };
        const satisfiedReadouts = new Set();
        const failedReadouts = new Set();
        samples.forEach((s, i) => {
            if (result.sampleConverged[i])
                satisfiedReadouts.add(s.readout);
            else
                failedReadouts.add(s.readout);
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
     * Tagged 'skill-script' (plus the source extension's name) so
     * bot-service.ts's live skill-match fast path (see SKILL_MATCH_THRESHOLD
     * there) can query this exact tag rather than mixing skill triggers in
     * with ordinary chat-turn memories.
     */
    rememberSkillScript(system, userSays, response, extName) {
        system.memory.remember(userSays, { importance: 0.7, tags: ['skill-script', extName], payload: response });
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
    async installSkillProject(name, neurons) {
        const { getNeuroclawSystem } = await import('../src/index.js');
        const system = await getNeuroclawSystem();
        let remembered = 0;
        for (const n of neurons) {
            if (!n.name)
                continue;
            const def = (n.definition ?? '').trim();
            if (def) {
                system.memory.remember(`${n.name}: ${def}`, { importance: 0.7, tags: ['extension', name] });
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
                if (!userSays || !response)
                    continue;
                this.rememberSkillScript(system, userSays, response, name);
                remembered++;
            }
        }
        return { remembered };
    }
    /** Parses a skill file's { neurons: [...] } JSON, the shape install-skill and run-rsi-test both need. Throws a plain Error with a message safe to send straight to the client. */
    parseSkillNeuronsFile(file) {
        let parsed;
        try {
            parsed = JSON.parse(file.content);
        }
        catch {
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
    async importSkillUploadScript(name, file) {
        if (!/\.(mjs|js)$/i.test(file.filename)) {
            throw new Error(`"${file.filename}" is not a .js/.mjs file -- no TypeScript compiler is available at runtime to run a .ts file this way.`);
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
        return candidate;
    }
    async loadSavedExtensions() {
        try {
            const path = await import('node:path');
            const { promises: fs } = await import('node:fs');
            const dir = path.resolve(process.cwd(), 'extension-builder', 'extensions');
            let allEntries;
            try {
                allEntries = await fs.readdir(dir);
            }
            catch {
                return { files: 0, remembered: 0 }; // no extensions directory yet -- nothing to load, not an error
            }
            // Both the quantized (*.ext.json -- the historical format, still what
            // conversation-learning-agent.mjs and the manual /api/extension/register
            // endpoint below write) and unquantized (*.source.json -- what
            // scripts/skill-agent.mjs publishes per skill, see wiki/Self-Improvement.md's
            // "five things") artifact shapes carry the same {project|name, neurons}
            // structure below -- loading only *.ext.json silently never picked up
            // any skill-agent-published skill at all.
            const entries = allEntries.filter(f => f.endsWith('.ext.json') || f.endsWith('.source.json'));
            if (entries.length === 0)
                return { files: 0, remembered: 0 };
            const { getNeuroclawSystem } = await import('../src/index.js');
            const system = await getNeuroclawSystem();
            let filesLoaded = 0;
            let remembered = 0;
            for (const filename of entries) {
                let data;
                try {
                    data = JSON.parse(await fs.readFile(path.join(dir, filename), 'utf8'));
                }
                catch {
                    continue; // malformed/unreadable -- skip this one file, don't fail the boot
                }
                const extName = data.project?.name ?? data.name ?? filename;
                const neurons = Array.isArray(data.neurons) ? data.neurons : [];
                if (neurons.length === 0)
                    continue;
                filesLoaded++;
                for (const n of neurons) {
                    if (!n.name)
                        continue;
                    const def = (n.definition ?? '').trim();
                    if (def) {
                        system.memory.remember(`${n.name}: ${def}`, { importance: 0.7, tags: ['extension', extName] });
                        remembered++;
                    }
                    for (const s of n.scripts ?? []) {
                        const userSays = (s.userSays ?? '').trim();
                        const response = (s.response ?? '').trim();
                        if (!userSays || !response)
                            continue;
                        this.rememberSkillScript(system, userSays, response, extName);
                        remembered++;
                    }
                }
            }
            return { files: filesLoaded, remembered };
        }
        catch {
            return { files: 0, remembered: 0 }; // never let a boot-time extension-load failure take the whole server down
        }
    }
    async handleRequest(req, res) {
        let parsedUrl;
        try {
            // req.headers.host is a raw, attacker-controlled string with no
            // validation from Node's HTTP parser -- a malformed value (a space,
            // a non-numeric port, ...) makes new URL() throw TypeError: Invalid
            // URL. This runs before every route's own try/catch, as the raw
            // http.createServer callback with no .catch() and no process-wide
            // unhandledRejection handler, so an uncaught throw here crashed the
            // entire backend on one request, regardless of path or method.
            parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        }
        catch {
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
        if (!(await this.isAuthorizedBasic(req, this.remoteAccessLock))) {
            this.requireAuth(res);
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
            const readJson = (relPath, fallback) => {
                try {
                    const full = path.join(process.cwd(), relPath);
                    if (!existsSync(full))
                        return fallback;
                    return JSON.parse(readFileSync(full, 'utf8'));
                }
                catch {
                    return fallback;
                }
            };
            const scoreboard = readJson('extension-builder/self-improvement-scoreboard.json', { targets: {} });
            const drillHistory = readJson('extension-builder/skill-quality-history.json', { skills: {} });
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
                const body = await this.parseBody(req);
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
                        .filter((h) => typeof h?.role === 'string' && typeof h?.content === 'string')
                        .map(h => `${h.role}: ${h.content}`)
                    : undefined;
                const response = await this.runner.generate(message, history);
                this.sendJson(res, { response, timestamp: Date.now() });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
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
                const body = await this.parseBody(req);
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
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
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
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
            }
            return;
        }
        // POST /api/chat-groups/collaborate — runs NeuroclawSystem.collaborate(),
        // which has the hive's chat group discuss a task and vote on a decision.
        // Powers the /app/chat-groups page.
        if (pathname === '/api/chat-groups/collaborate' && method === 'POST') {
            try {
                const body = await this.parseBody(req);
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
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
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
            const source = sourceParam === 'chat' || sourceParam === 'chat-group' ? sourceParam : undefined;
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
            const source = sourceParam === 'chat' || sourceParam === 'chat-group' ? sourceParam : undefined;
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
            }
            catch (err) {
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
                const body = await this.parseBody(req);
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
                const thread = this.chatHistory.appendMessage({ role: body.role, content: body.content, timestamp: Date.now() }, body.source, body.threadId);
                this.sendJson(res, { threadId: thread.id });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 400);
            }
            return;
        }
        if (pathname === '/api/thorns' && method === 'POST') {
            try {
                const body = await this.parseBody(req);
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
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
            }
            return;
        }
        // POST /api/neuri — run NeuriLang code
        if (pathname === '/api/neuri' && method === 'POST') {
            try {
                const body = await this.parseBody(req);
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
                const result = [];
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
                    if (entriesSinceYield >= 200000) {
                        entriesSinceYield = 0;
                        await new Promise(resolve => setImmediate(resolve));
                    }
                }
                this.sendJson(res, { neurons: result, printOutputs: parsed.printOutputs });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
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
                const body = await this.parseBody(req);
                if (body?.text !== undefined && typeof body.text !== 'string') {
                    this.sendJson(res, { error: 'text must be a string' }, 400);
                    return;
                }
                const text = body?.text ?? '';
                await this.runner.getLLM().trainOnText(text);
                const stats = this.runner.getLLM().getStats();
                this.sendJson(res, { ok: true, samplesProcessed: stats.samplesProcessed });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
            }
            return;
        }
        // GET /api/plugins — list all plugins and their status
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
        // description) so /app/wiki can list them without fetching every full
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
                const body = await this.parseBody(req);
                if (typeof body?.name !== 'string' || typeof body?.title !== 'string' || typeof body?.content !== 'string') {
                    this.sendJson(res, { error: 'Expected { name, title, content } (all strings)' }, 400);
                    return;
                }
                const page = publishWikiPage(body.name, body.title, body.content);
                this.sendJson(res, page, 201);
            }
            catch (err) {
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
        if (wikiMatch && method === 'DELETE') {
            try {
                deleteWikiPage(wikiMatch[1]);
                this.sendJson(res, { name: wikiMatch[1], deleted: true });
            }
            catch (err) {
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
                const body = await this.parseBody(req);
                if (typeof body?.name !== 'string') {
                    this.sendJson(res, { error: 'Expected a "name" string field' }, 400);
                    return;
                }
                const room = getSharedChatStore().ensureRoom(body.name);
                this.sendJson(res, room, 201);
            }
            catch (err) {
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
            }
            catch (err) {
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
                const body = await this.parseBody(req);
                if (typeof body?.author !== 'string' || typeof body?.text !== 'string') {
                    this.sendJson(res, { error: 'Expected { author, text } (both strings)' }, 400);
                    return;
                }
                const message = getSharedChatStore().post(roomId, body.author, body.text, false);
                this.sendJson(res, message, 201);
            }
            catch (err) {
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
                const body = await this.parseBody(req);
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
            }
            catch (err) {
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
                const body = await this.parseBody(req);
                if (typeof body?.name !== 'string') {
                    this.sendJson(res, { error: 'Expected a "name" string field' }, 400);
                    return;
                }
                const files = {};
                for (const slot of SKILL_UPLOAD_SLOTS) {
                    const raw = body[slot];
                    if (raw === undefined || raw === null)
                        continue;
                    if (typeof raw !== 'object' ||
                        typeof raw.filename !== 'string' ||
                        typeof raw.content !== 'string') {
                        this.sendJson(res, { error: `"${slot}" must be { filename: string, content: string }` }, 400);
                        return;
                    }
                    files[slot] = raw;
                }
                const pkg = saveSkillUpload(body.name, files);
                this.sendJson(res, pkg, 201);
            }
            catch (err) {
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
                deleteSkillUpload(skillUploadMatch[1]);
                this.sendJson(res, { name: skillUploadMatch[1], deleted: true });
            }
            catch (err) {
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
            if (!SKILL_UPLOAD_SLOTS.includes(slotParam)) {
                this.sendJson(res, { error: `"${slotParam}" is not a valid slot` }, 400);
                return;
            }
            const file = readSkillUploadFile(name, slotParam);
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
                const body = await this.parseBody(req);
                if (!Array.isArray(body?.files) || body.files.length === 0) {
                    this.sendJson(res, { error: 'Expected a non-empty "files" array of { filename, content }' }, 400);
                    return;
                }
                const files = [];
                for (const raw of body.files) {
                    if (typeof raw !== 'object' || raw === null || typeof raw.filename !== 'string' || typeof raw.content !== 'string') {
                        this.sendJson(res, { error: 'Every file needs { filename: string, content: string }' }, 400);
                        return;
                    }
                    files.push(raw);
                }
                const pkg = saveSkillUploadExtraFiles(skillUploadExtraFilesMatch[1], files);
                this.sendJson(res, pkg, 201);
            }
            catch (err) {
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
                deleteSkillUploadExtraFile(name, decodeURIComponent(filename));
                this.sendJson(res, { name, filename, deleted: true });
            }
            catch (err) {
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
                let neurons;
                try {
                    neurons = this.parseSkillNeuronsFile(file);
                }
                catch (err) {
                    this.sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
                    return;
                }
                const { remembered } = await this.installSkillProject(name, neurons);
                this.sendJson(res, { ok: true, installedFrom: file.filename, neuronCount: neurons.length, remembered });
            }
            catch (err) {
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
                const definition = { id: name, name, type: 'api-connection', capabilities: [] };
                let instance;
                try {
                    instance = new Candidate(definition);
                }
                catch (err) {
                    this.sendJson(res, { error: `Failed to construct the plugin: ${err instanceof Error ? err.message : String(err)}` }, 400);
                    return;
                }
                if (typeof instance.onActivate !== 'function') {
                    this.sendJson(res, { error: `"${file.filename}"'s exported class doesn't implement onActivate(context) -- not a valid BasePlugin subclass` }, 400);
                    return;
                }
                const registry = this.runner.getPluginRegistry();
                registry.register(definition, instance);
                await registry.activate(name);
                this.sendJson(res, { ok: true, installedFrom: file.filename, pluginId: name });
            }
            catch (err) {
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
                const body = await this.parseBody(req);
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
                const summary = linkSkillUploadWiki(name, body.wikiPage);
                this.sendJson(res, summary);
            }
            catch (err) {
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
                const summary = unlinkSkillUploadWiki(name);
                this.sendJson(res, summary);
            }
            catch (err) {
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
            }
            catch (err) {
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
                const passed = typeof raw === 'boolean' ? raw : !!raw?.passed;
                const message = typeof raw === 'object' && raw !== null && typeof raw.message === 'string'
                    ? raw.message
                    : undefined;
                const score = typeof raw === 'object' && raw !== null && typeof raw.score === 'number'
                    ? raw.score
                    : undefined;
                if (!passed) {
                    this.sendJson(res, { ok: true, passed: false, message, score, ranFrom: file.filename });
                    return;
                }
                recordSkillUploadRsiPass(name, message);
                let installed = null;
                const skillFile = readSkillUploadFile(name, 'binarySkill') ?? readSkillUploadFile(name, 'sourceSkill');
                if (skillFile) {
                    try {
                        const neurons = this.parseSkillNeuronsFile(skillFile);
                        installed = await this.installSkillProject(name, neurons);
                    }
                    catch {
                        // The RSI test passed and is recorded regardless -- a
                        // malformed/missing skill file just means nothing to install,
                        // not a reason to discard a real, already-passed test result.
                    }
                }
                this.sendJson(res, { ok: true, passed: true, message, score, ranFrom: file.filename, installed });
            }
            catch (err) {
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
                const body = await this.parseBody(req);
                const name = (body?.name ?? '').trim() || `extension_${Date.now()}`;
                const neurons = Array.isArray(body?.neurons) ? body.neurons : [];
                const path = await import('node:path');
                const { promises: fs } = await import('node:fs');
                const dir = path.resolve(process.cwd(), 'extension-builder', 'extensions');
                await fs.mkdir(dir, { recursive: true });
                const safe = name.replace(/[^a-zA-Z0-9_-]+/g, '_');
                const filename = `${safe}_${Date.now()}.ext.json`;
                await fs.writeFile(path.join(dir, filename), JSON.stringify({ name, neurons }, null, 2), 'utf8');
                const { remembered } = await this.installSkillProject(name, neurons);
                this.sendJson(res, { ok: true, savedAs: filename, neuronCount: neurons.length, remembered });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
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
                const body = await this.parseBody(req);
                const neurons = Array.isArray(body?.neurons) ? body.neurons : [];
                const dims = 16; // matches builder.js train()'s fixed dims
                const { embedText } = await import('../models && skills/core/neuro-lang.js');
                // Same fixed, concept-agnostic "recall your definition" drive vector
                // materialize() uses for every @definishon contract (see
                // definitionTrigger() in neuro-lang.ts) -- not exported, so mirrored
                // here rather than adding an export just for this one caller.
                const definitionTrigger = new Array(dims).fill(0.7);
                const samples = [];
                const readoutNames = [];
                for (const n of neurons) {
                    if (!n.name)
                        continue;
                    const def = (n.definition ?? '').trim();
                    const scripts = (n.scripts ?? []).filter(s => (s.userSays ?? '').trim() && (s.response ?? '').trim());
                    if (!def && scripts.length === 0)
                        continue;
                    const readout = readoutNames.length;
                    readoutNames.push(n.name);
                    if (def) {
                        samples.push({ readout, input: definitionTrigger, target: embedText(def, dims) });
                    }
                    for (const s of scripts) {
                        samples.push({
                            readout,
                            input: embedText(s.userSays.trim(), dims),
                            target: embedText(s.response.trim(), dims),
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
                const satisfiedReadouts = new Set();
                const failedReadouts = new Set();
                samples.forEach((s, i) => {
                    if (pytorchResult.sampleConverged[i])
                        satisfiedReadouts.add(s.readout);
                    else
                        failedReadouts.add(s.readout);
                });
                const trainedNeurons = readoutNames.filter((_, i) => satisfiedReadouts.has(i) && !failedReadouts.has(i));
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
            }
            catch (err) {
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
                const body = await this.parseBody(req);
                const perTemplate = Math.max(1, Math.min(50, body?.count ?? 5)); // capped -- this runs real subprocesses per instantiation
                const vm = await import('node:vm');
                const { spawnSync } = await import('node:child_process');
                const { NeuroLangInterpreter } = await import('../models && skills/core/neuro-lang.js');
                const neuroLang = new NeuroLangInterpreter();
                const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
                const templates = [
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
                const generated = [];
                for (const t of templates) {
                    for (let i = 0; i < perTemplate; i++) {
                        const code = t.gen();
                        const result = await t.run(code);
                        if (result === null || result === undefined || result === '')
                            continue; // this language's runtime isn't available here -- skip, don't fake it
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
            }
            catch (err) {
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
                const body = await this.parseBody(req);
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
                let savedData;
                try {
                    savedData = JSON.parse(await fs.readFile(savedPath, 'utf8'));
                }
                catch (err) {
                    this.sendJson(res, { ok: false, error: `could not read "${savedFile}": ${err instanceof Error ? err.message : String(err)}` }, 404);
                    return;
                }
                const savedNeurons = Array.isArray(savedData.neurons) ? savedData.neurons : [];
                const [a, b] = await Promise.all([
                    this.trainNeuronsViaPyTorch(currentNeurons, { epochs: 800 }),
                    this.trainNeuronsViaPyTorch(savedNeurons, { epochs: 800 }),
                ]);
                if (a.ok === false) {
                    this.sendJson(res, { ok: false, error: `current project: ${a.error}` });
                    return;
                }
                if (b.ok === false) {
                    this.sendJson(res, { ok: false, error: `"${savedFile}": ${b.error}` });
                    return;
                }
                if (a.names.length === 0 && b.names.length === 0) {
                    this.sendJson(res, { ok: false, error: 'neither side has any trainable (@definishon or scripted) neurons to merge' });
                    return;
                }
                // The actual merge: union of names, elementwise-averaged rows for
                // any name in both.
                const bIndexByName = new Map(b.names.map((n, i) => [n, i]));
                const mergedNames = [];
                const mergedW = [];
                const mergedB = [];
                let overlapCount = 0;
                for (let i = 0; i < a.names.length; i++) {
                    const name = a.names[i];
                    const bi = bIndexByName.get(name);
                    if (bi === undefined) {
                        mergedNames.push(name);
                        mergedW.push(a.W[i]);
                        mergedB.push(a.b[i]);
                    }
                    else {
                        overlapCount++;
                        mergedNames.push(name);
                        mergedW.push(a.W[i].map((v, d) => (v + b.W[bi][d]) / 2));
                        mergedB.push(a.b[i].map((v, d) => (v + b.b[bi][d]) / 2));
                        bIndexByName.delete(name);
                    }
                }
                for (const [name, bi] of bIndexByName) {
                    mergedNames.push(name);
                    mergedW.push(b.W[bi]);
                    mergedB.push(b.b[bi]);
                }
                const mergedIndexByName = new Map(mergedNames.map((n, i) => [n, i]));
                const remap = (samples, names) => samples.map(s => ({ ...s, readout: mergedIndexByName.get(names[s.readout]) }));
                const unionSamples = [...remap(a.samples, a.names), ...remap(b.samples, b.names)];
                const pathMod = await import('node:path');
                const scriptPath = pathMod.resolve(process.cwd(), 'extension-builder', 'pytorch_trainer.py');
                const fineTune = await this.pytorchWorker.send(scriptPath, {
                    dims: 16, numReadouts: mergedNames.length, epochs: 800, learningRate: 0.05, tolerance: 1e-3,
                    samples: unionSamples, initW: mergedW, initB: mergedB,
                });
                const currentByName = new Map(currentNeurons.map(n => [n.name, n]));
                const savedByName = new Map(savedNeurons.map(n => [n.name, n]));
                const trainedSet = new Set(fineTune.ok
                    ? mergedNames.filter((_, i) => fineTune.sampleConverged
                        .filter((_c, si) => unionSamples[si].readout === i)
                        .every(Boolean))
                    : []);
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
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { ok: false, error: msg }, 500);
            }
            return;
        }
        // POST /api/extension/build — build a real extension from NeuroLang and save it
        if (pathname === '/api/extension/build' && method === 'POST') {
            try {
                const body = await this.parseBody(req);
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
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
            }
            return;
        }
        // GET /api/extension/list — list the extensions saved on disk
        if (pathname === '/api/extension/list' && method === 'GET') {
            try {
                const path = await import('node:path');
                const { promises: fs } = await import('node:fs');
                const dir = path.resolve(process.cwd(), 'extension-builder', 'extensions');
                let files = [];
                try {
                    files = (await fs.readdir(dir)).filter(f => f.endsWith('.ext.json'));
                }
                catch {
                    files = [];
                }
                const extensions = [];
                for (const f of files) {
                    try {
                        const data = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
                        extensions.push({
                            file: f, name: data.project?.name ?? f,
                            neurons: Array.isArray(data.neurons) ? data.neurons.length : 0,
                            quantized: data.quantized === true, bits: data.bits ?? null,
                        });
                    }
                    catch {
                        extensions.push({ file: f, name: f, neurons: 0 });
                    }
                }
                this.sendJson(res, { extensions, total: extensions.length });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
            }
            return;
        }
        // POST /api/apps/launch — launch an application via AppLauncher
        if (pathname === '/api/apps/launch' && method === 'POST') {
            try {
                const body = await this.parseBody(req);
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
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
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
                const body = await this.parseBody(req);
                if (!body?.appId) {
                    this.sendJson(res, { error: 'Missing appId field' }, 400);
                    return;
                }
                const closed = this.launcher.close(body.appId);
                this.sendJson(res, { ok: closed, appId: body.appId });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
            }
            return;
        }
        // POST /api/apps/launch-package — launch .deb/.exe/.apk packages
        if (pathname === '/api/apps/launch-package' && method === 'POST') {
            try {
                const body = await this.parseBody(req);
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
                let command;
                let args = [];
                const type = body.type || (packagePath.endsWith('.deb') ? 'deb' :
                    packagePath.endsWith('.exe') ? 'exe' :
                        packagePath.endsWith('.apk') ? 'apk' : undefined);
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
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
            }
            return;
        }
        this.sendJson(res, { error: 'Not Found' }, 404);
    }
}
