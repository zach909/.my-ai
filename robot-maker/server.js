import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const VENV_PY = path.join(ROOT, '.venv', 'bin', 'python');
const BRIDGE = path.join(__dirname, 'bridge.py');
const PIPELINE_OUT = path.join(ROOT, 'pipeline', 'out');

const pipelineJobs = {};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

async function ollamaChat(messages, opts = {}) {
  const body = JSON.stringify({
    model: 'gguf/DeepSeek-Janus-Pro-7B:latest',
    messages,
    stream: false,
    options: {
      num_predict: opts.num_predict ?? 120,
      temperature: opts.temperature ?? 0.8,
    },
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180000); // 3 min max per Ollama call
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body, signal: ac.signal,
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json();
    return (data.message?.content || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

function parseJSON(text) {
  text = text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/```[a-z]*\n?/g, '').trim();
  }
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s !== -1 && e !== -1) {
    try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
  }
  return null;
}

// ── API routes ───────────────────────────────────────────────────
async function handleAPI(req, res) {
  const url = new URL(req.url, `http://localhost`);
  const parts = url.pathname.split('/').filter(Boolean);

  // POST /api/describe
  if (parts[1] === 'describe' && req.method === 'POST') {
    const body = await jsonBody(req);
    const { sex = 'female', hint = '' } = body;
    const extra = hint ? ` Incorporate: ${hint}.` : '';
    const prompt = `Describe the physical appearance of a ${sex} humanoid robot in one vivid paragraph (3-4 sentences). Cover its chassis, materials, colour, face, and overall silhouette. Be concrete and visual.${extra}`;
    try {
      const reply = await ollamaChat(
        [{ role: 'user', content: prompt }],
        { num_predict: 200, temperature: 0.9 }
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ description: reply }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/chat
  if (parts[1] === 'chat' && req.method === 'POST') {
    const body = await jsonBody(req);
    const { messages = [], context = '' } = body;
    const sysMsg = {
      role: 'system',
      content: `You are the design assistant for a robot-builder app. The user is refining a robot's look and character. Be concise and concrete. When asked to change something, restate the updated detail clearly.\n\nCurrent robot:\n${context}`,
    };
    try {
      const reply = await ollamaChat([sysMsg, ...messages], { num_predict: 150, temperature: 0.7 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/generate-image — generate a placeholder body image (fast, no TripoSR)
  if (parts[1] === 'generate-image' && req.method === 'POST') {
    const body = await jsonBody(req);
    const { sex = 'female', description = '' } = body;
    try {
      const result = await generateImage(sex, description);
      if (result.image && result.image.startsWith(PIPELINE_OUT)) {
        result.image = '/out/' + path.relative(PIPELINE_OUT, result.image);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/character
  if (parts[1] === 'character' && req.method === 'POST') {
    const body = await jsonBody(req);
    const { sex = 'female', description = '', hint = '' } = body;
    const extra = hint ? ` Direction: ${hint}.` : '';
    const prompt = `You are creating a character sheet for a robot. Return STRICT JSON only with keys: "name", "model_designation", "personality", "backstory", "voice", "quirks" (array).\nSex: ${sex}.\nAppearance: ${description}${extra}\nReturn ONLY the JSON object.`;
    try {
      const raw = await ollamaChat(
        [{ role: 'user', content: prompt }],
        { num_predict: 200, temperature: 0.9 }
      );
      const data = parseJSON(raw) || {
        name: sex === 'male' ? 'Unit-7' : 'Vera-7',
        model_designation: 'ZB-7',
        personality: 'Calm, precise.',
        backstory: 'Built as a movement-study android.',
        voice: sex === 'male' ? 'Warm baritone' : 'Soft alto',
        quirks: ['tilts head', 'counts joints'],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/build — start pipeline in background
  if (parts[1] === 'build' && req.method === 'POST') {
    const body = await jsonBody(req);
    const { sex = 'female', hint = '', description = '', run_dir } = body;
    const jobId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    pipelineJobs[jobId] = { status: 'running', progress: 'Starting...' };

    runPipeline(sex, hint, description, run_dir)
      .then(result => {
        if (result.image && result.image.startsWith(PIPELINE_OUT))
          result.image = '/out/' + path.relative(PIPELINE_OUT, result.image);
        if (result.preview && result.preview.startsWith(PIPELINE_OUT))
          result.preview = '/out/' + path.relative(PIPELINE_OUT, result.preview);
        if (result.mesh && result.mesh.startsWith(PIPELINE_OUT))
          result.mesh = '/out/' + path.relative(PIPELINE_OUT, result.mesh);
        pipelineJobs[jobId] = { status: 'done', result };
      })
      .catch(e => {
        pipelineJobs[jobId] = { status: 'error', error: e.message };
      });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jobId }));
    return;
  }

  // GET /api/build-status — poll for pipeline completion
  if (parts[1] === 'build-status' && req.method === 'GET') {
    const jobId = url.searchParams.get('jobId');
    const job = pipelineJobs[jobId];
    if (!job) { res.writeHead(404); res.end(JSON.stringify({ error: 'unknown job' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(job));
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
}

function runPipeline(sex, hint, description, run_dir) {
  return new Promise((resolve, reject) => {
    const py = fs.existsSync(VENV_PY) ? VENV_PY : 'python3';
    const args = [BRIDGE, '--sex', sex];
    if (hint) args.push('--hint', hint);
    if (description) args.push('--description', description);
    if (run_dir) args.push('--out-dir', run_dir);
    execFile(py, args, {
      timeout: 600000,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Pipeline failed: ${err.message}\n${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(`Invalid JSON from bridge:\n${stdout}`));
      }
    });
  });
}

function generateImage(sex, description) {
  return new Promise((resolve, reject) => {
    const py = fs.existsSync(VENV_PY) ? VENV_PY : 'python3';
    const args = [BRIDGE, '--sex', sex, '--image-only'];
    if (description) args.push('--description', description);
    execFile(py, args, {
      timeout: 120000, // 2 min for image only
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Image gen failed: ${err.message}\n${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(`Invalid JSON from bridge:\n${stdout}`));
      }
    });
  });
}

function jsonBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── Static file server ───────────────────────────────────────────
function serveStatic(req, res) {
  // Serve pipeline output files under /out/
  if (req.url.startsWith('/out/')) {
    const filePath = path.join(PIPELINE_OUT, req.url.slice(5));
    const ext = path.extname(filePath);
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }
  let filePath = path.join(PUBLIC, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(d2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── Server ───────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleAPI(req, res);
  serveStatic(req, res);
});

server.requestTimeout = 0;
server.timeout = 0;
server.keepAliveTimeout = 0;
server.listen(PORT, () => {
  console.log(`Robot Maker running at http://localhost:${PORT}`);
});
