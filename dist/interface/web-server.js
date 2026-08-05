import http from 'node:http';
import crypto from 'node:crypto';
import { AppLauncher } from './app-launcher.js';
import { EncryptionManager } from './encryption.js';
import { ChatHistoryStore } from '../models && skills/core/chat-history-store.js';
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
        return new Promise((resolve) => {
            this.server?.close(() => { this.server = null; resolve(); });
        });
    }
    getPort() { return this.port; }
    setSecurityHeaders(res) {
        // Security: Restricted CORS and standard security headers
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
                const { getNeuroclawSystem } = await import('../src/index.js');
                const system = await getNeuroclawSystem();
                let remembered = 0;
                for (const n of neurons) {
                    const def = (n.definition ?? '').trim();
                    if (!def || !n.name)
                        continue;
                    system.memory.remember(`${n.name}: ${def}`, { importance: 0.7, tags: ['extension', name] });
                    remembered++;
                }
                this.sendJson(res, { ok: true, savedAs: filename, neuronCount: neurons.length, remembered });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.sendJson(res, { error: msg }, 500);
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
