/**
 * A very small Chrome DevTools Protocol driver for the platform tests.
 *
 * Node built-ins only (child_process, fs, os, the global fetch and WebSocket in
 * Node 22+). It drives whatever Chromium/Chrome is installed, so the tests can
 * prove real behaviour (a page lays out at phone width, a button click saves a
 * setting, the extension opens the app) without any browser-automation
 * library. When no browser is installed, `findChrome()` returns null and the
 * tests that need one report themselves as skipped, with that reason.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const candidates = [process.env.CHROME_BIN];
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pw && existsSync(pw)) {
    for (const d of readdirSync(pw)) {
      if (/^chromium-\d+$/.test(d)) {
        candidates.push(path.join(pw, d, 'chrome-linux', 'chrome'), path.join(pw, d, 'chrome-linux64', 'chrome'));
      }
    }
  }
  candidates.push(
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  );
  return candidates.find((c) => c && existsSync(c)) ?? null;
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}`)); else resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(new Session(ws)));
    ws.addEventListener('error', () => reject(new Error(`could not connect to ${url}`)));
  });
}

export class Page {
  constructor(session, targetId, base) {
    this.s = session; this.targetId = targetId; this.base = base;
    this.errors = [];
    /** Messages of JavaScript dialogs (alert, confirm) the page opened. They are answered automatically so a page can never freeze the test. */
    this.dialogs = [];
    this.dialogAnswer = true;
    session.on((m) => {
      if (m.method === 'Page.javascriptDialogOpening') {
        this.dialogs.push(m.params.message);
        session.send('Page.handleJavaScriptDialog', { accept: this.dialogAnswer }).catch(() => {});
      }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'exception');
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    });
  }
  /** Phone-like emulation: real viewport width, touch events, device pixel ratio. */
  async emulate({ width, height, mobile = false, scale = 1 }) {
    await this.s.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
    await this.s.send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
  }
  async goto(url, waitFor = 'document.readyState === "complete"') {
    await this.s.send('Page.navigate', { url });
    await this.waitFor(waitFor, 15000);
  }
  async eval(expression) {
    const r = await this.s.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async waitFor(expression, timeout = 8000) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try { last = await this.eval(expression); if (last) return last; } catch (e) { last = e.message; }
      await sleep(80);
    }
    throw new Error(`timed out waiting for: ${expression} (last: ${last})`);
  }
  /** A real pointer click at the centre of the element, so a covered or off-screen control fails the way it would for a person. */
  async click(selector) {
    const box = await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2, w:r.width, h:r.height}; })()`);
    if (!box) throw new Error(`no element for ${selector}`);
    const hit = await this.eval(`(() => { const e = document.elementFromPoint(${box.x}, ${box.y}); const t = document.querySelector(${JSON.stringify(selector)}); return !!e && (e === t || t.contains(e) || e.contains(t)); })()`);
    if (!hit) throw new Error(`${selector} is covered or off-screen at (${Math.round(box.x)}, ${Math.round(box.y)})`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.s.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    return box;
  }
  async type(selector, text) {
    await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select && e.select(); })()`);
    await this.s.send('Input.insertText', { text });
  }
  async screenshot(file) {
    const { data } = await this.s.send('Page.captureScreenshot', { format: 'png' });
    (await import('node:fs')).writeFileSync(file, Buffer.from(data, 'base64'));
  }
  async close() {
    try { await fetch(`${this.base}/json/close/${this.targetId}`); } catch { /* already closed */ }
    this.s.close();
  }
}

export class Browser {
  static async launch({ extensions = [], extraArgs = [] } = {}) {
    const bin = findChrome();
    if (!bin) throw new Error('no Chrome/Chromium found (set CHROME_BIN)');
    const profile = mkdtempSync(path.join(tmpdir(), 'nc-chrome-'));
    const args = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      // Branded Chrome 137+ ignores --load-extension unless this feature is switched off; other builds accept it anyway.
      ...(extensions.length ? ['--disable-features=DisableLoadExtensionCommandLineSwitch', `--load-extension=${extensions.join(',')}`, `--disable-extensions-except=${extensions.join(',')}`] : []),
      ...extraArgs, 'about:blank',
    ];
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const port = await new Promise((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('Chrome did not start: ' + buf.slice(-300))), 20000);
      child.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
        if (m) { clearTimeout(t); resolve(Number(m[1])); }
      });
      child.on('exit', (code) => { clearTimeout(t); reject(new Error(`Chrome exited (${code}): ${buf.slice(-300)}`)); });
    });
    return new Browser(child, port, profile);
  }
  constructor(child, port, profile) { this.child = child; this.port = port; this.profile = profile; this.base = `http://127.0.0.1:${port}`; }
  async targets() { return (await fetch(`${this.base}/json/list`)).json(); }
  async newPage(url = 'about:blank') {
    const t = await (await fetch(`${this.base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
    const session = await connect(t.webSocketDebuggerUrl);
    await session.send('Page.enable'); await session.send('Runtime.enable');
    return new Page(session, t.id, this.base);
  }
  async attach(target) {
    const session = await connect(target.webSocketDebuggerUrl);
    // Service workers have no Page domain; pages do.
    if (target.type === 'page') await session.send('Page.enable');
    await session.send('Runtime.enable');
    return new Page(session, target.id, this.base);
  }
  async close() {
    this.child.kill('SIGKILL');
    await sleep(100);
    try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
