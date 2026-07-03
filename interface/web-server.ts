import http from 'node:http';
import { NeuroclawRunner } from './runner.js';

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
  .message { max-width: 80%; padding: 10px 14px; border-radius: 4px; line-height: 1.5; font-size: 13px; }
  .message.user { align-self: flex-end; background: #003300; border: 1px solid #00ff4144; }
  .message.ai { align-self: flex-start; background: #111; border: 1px solid #333; }
  .message.system { align-self: center; background: #111; border: 1px solid #333; color: #888; font-style: italic; font-size: 11px; }
  .message.error { align-self: center; background: #330000; border: 1px solid #ff004044; color: #ff6666; }
  .timestamp { font-size: 10px; color: #555; margin-top: 4px; }
  #input-area { border-top: 1px solid #00ff4144; padding: 12px 20px; background: #111; display: flex; gap: 10px; }
  #input { flex: 1; background: #0a0a0a; border: 1px solid #333; color: #00ff41; padding: 10px 14px; font-family: 'Courier New', monospace; font-size: 13px; outline: none; border-radius: 4px; }
  #input:focus { border-color: #00ff41; }
  #send-btn { background: #003300; color: #00ff41; border: 1px solid #00ff41; padding: 10px 20px; cursor: pointer; font-family: 'Courier New', monospace; font-size: 13px; border-radius: 4px; }
  #send-btn:hover { background: #005500; }
  .thinking { color: #888; font-style: italic; font-size: 11px; align-self: flex-start; }
</style>
</head>
<body>
<div id="header">
  <h1><span id="status-dot" class="offline"></span>Neuroclaw v0.1.0</h1>
  <div id="status-text" style="font-size:12px;color:#555;">Starting...</div>
</div>
<div id="chat-container"></div>
<div id="input-area">
  <input type="text" id="input" placeholder="Type a message..." autofocus>
  <button id="send-btn">Send</button>
</div>
<script>
  const chat = document.getElementById('chat-container');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  let chatHistory = [];
  function addMessage(type, text) {
    const div = document.createElement('div');
    div.className = 'message ' + type;
    const content = document.createElement('div');
    content.textContent = text;
    div.appendChild(content);
    const ts = document.createElement('div');
    ts.className = 'timestamp';
    ts.textContent = new Date().toLocaleTimeString();
    div.appendChild(ts);
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }
  function addThinking() {
    const div = document.createElement('div');
    div.className = 'thinking';
    div.id = 'thinking-indicator';
    div.textContent = 'Thinking...';
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }
  function removeThinking() {
    const el = document.getElementById('thinking-indicator');
    if (el) el.remove();
  }
  async function checkStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.running) { statusDot.className = 'online'; statusText.textContent = 'Online'; }
      else { statusDot.className = 'offline'; statusText.textContent = 'Offline'; }
    } catch { statusDot.className = 'offline'; statusText.textContent = 'Disconnected'; }
  }
  async function sendMessage(msg) {
    if (!msg.trim()) return;
    addMessage('user', msg);
    chatHistory.push({role: 'user', content: msg});
    input.value = '';
    addThinking();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: msg, history: chatHistory})
      });
      const data = await res.json();
      removeThinking();
      if (data.response) {
        addMessage('ai', data.response);
        chatHistory.push({role: 'assistant', content: data.response});
      } else if (data.error) { addMessage('error', 'Error: ' + data.error); }
    } catch { removeThinking(); addMessage('error', 'Error: Unable to reach server'); }
  }
  sendBtn.addEventListener('click', () => sendMessage(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(input.value); });
  setInterval(checkStatus, 3000);
  checkStatus();
  addMessage('system', 'Neuroclaw ready. Type a message.');
</script>
</body>
</html>`;

export class WebServer {
  private runner: NeuroclawRunner;
  private server: http.Server | null = null;
  private port = 0;

  constructor(runner: NeuroclawRunner) {
    this.runner = runner;
  }

  async start(port: number = 3000): Promise<void> {
    if (this.server) throw new Error('Web server already running');
    this.port = port;
    await this.runner.start();
    return new Promise<void>((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(port, () => resolve());
      this.server.on('error', (err: Error) => { this.server = null; reject(err); });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) throw new Error('Server not running');
    return new Promise<void>((resolve) => {
      this.server?.close(() => { this.server = null; resolve(); });
    });
  }

  getPort(): number { return this.port; }

  private setCorsHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  private sendJson(res: http.ServerResponse, data: unknown, statusCode = 200): void {
    this.setCorsHeaders(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendHtml(res: http.ServerResponse, html: string): void {
    this.setCorsHeaders(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private async parseBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) { resolve(null); return; }
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    if (method === 'OPTIONS') {
      this.setCorsHeaders(res);
      res.writeHead(204);
      res.end();
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
        const body = await this.parseBody(req) as { message?: string } | null;
        const message = body?.message;
        if (!message || typeof message !== 'string') {
          this.sendJson(res, { error: 'Missing message field' }, 400);
          return;
        }
        const response = await this.runner.generate(message);
        this.sendJson(res, { response, timestamp: Date.now() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.sendJson(res, { error: msg }, 500);
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
        const msg = err instanceof Error ? err.message : String(err);
        this.sendJson(res, { error: msg }, 500);
      }
      return;
    }

    // GET /api/dict/:word — thesaurus/dictionary lookup
    const dictMatch = pathname.match(/^\/api\/dict\/(.+)$/);
    if (dictMatch && method === 'GET') {
      const word = decodeURIComponent(dictMatch[1]);
      const thesaurus = this.runner.getThesaurus();
      const def = thesaurus.getDefinition(word);
      const syns = thesaurus.getSynonyms(word);
      const examples = thesaurus.getExamples(word);
      if (!def && syns.length === 0) {
        this.sendJson(res, { error: `"${word}" not in dictionary` }, 404);
      } else {
        this.sendJson(res, { word, Y: def ?? '', X: syns, Z: examples });
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
        const parsed = interp.parse(code);
        if (parsed.errors.length > 0) {
          this.sendJson(res, { errors: parsed.errors }, 400);
          return;
        }
        const neurons = interp.evaluate(parsed);
        const result = Array.from(neurons.entries()).map(([name, n]) => ({
          name,
          value: n.value,
          definition: n.definition,
          isNetSearch: n.isNetSearch,
          netLocation: n.netLocation,
          isCodeNet: n.isCodeNet,
          code: n.code,
          connections: Array.from(n.connections.entries()),
        }));
        this.sendJson(res, { neurons: result, printOutputs: parsed.printOutputs });
      } catch (err) {
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

    // POST /api/train — train LLM on text
    if (pathname === '/api/train' && method === 'POST') {
      try {
        const body = await this.parseBody(req) as { text?: string } | null;
        const text = body?.text ?? '';
        this.runner.getLLM().trainOnText(text);
        const stats = this.runner.getLLM().getStats();
        this.sendJson(res, { ok: true, samplesProcessed: stats.samplesProcessed });
      } catch (err) {
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

    this.sendJson(res, { error: 'Not Found' }, 404);
  }
}
