/**
 * Main Process Entry Point
 * This is the main entry point for the Electron application.
 * It handles native OS interactions, file system access, and process management.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, exec, execFileSync } = require('child_process');
const crypto = require('crypto');
const selfsigned = require('selfsigned');
const { startAppServer, DESKTOP_TOKEN_HEADER } = require('./app-server');
const windowsCapabilityTools = require('./windows-capability-tools');

/**
 * Best-effort blocklist for the most common catastrophic-accident shell
 * patterns, ported from plugins/plugin_terminal.py's `_is_blocked` (that
 * Python terminal plugin guards this exact class of full-shell-access
 * capability; this file's exec-command/spawn-process IPC handlers are the
 * equivalent surface exposed to the renderer via preload.js's
 * contextBridge, but had no guard at all). NOT a security boundary against
 * a deliberately hostile command -- see plugin_terminal.py's docstring.
 */
const FORK_BOMB = /:\(\)\{\s*[:\s|&]+\};:/;
const DANGEROUS_SIMPLE = /\bmkfs|\bshutdown|\breboot|\bhalt|\bpoweroff/i;
const DD_RAW_DISK = /\bdd\b.*\bof=\/dev\/(sd[a-z]|nvme|mmcblk)/i;
const RM_CMD = /\brm\b/i;
const RM_RECURSIVE = /(?<![\w-])-[a-zA-Z]*r[a-zA-Z]*(?![\w-])|--recursive\b/i;
const RM_FORCE = /(?<![\w-])-[a-zA-Z]*f[a-zA-Z]*(?![\w-])|--force\b/i;
const ROOT_LIKE_PATH = /(?<!\S)\/+[*.]{0,3}(?=\s|$|;|&|\|)/;

function isBlockedCommand(cmd) {
  if (FORK_BOMB.test(cmd) || DANGEROUS_SIMPLE.test(cmd) || DD_RAW_DISK.test(cmd)) return true;
  if (RM_CMD.test(cmd) && RM_RECURSIVE.test(cmd) && RM_FORCE.test(cmd) && ROOT_LIKE_PATH.test(cmd)) return true;
  return false;
}

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;
let backendProcess;
let appServer;

/**
 * Where the built app (dist/interface/main.js + dist/index.html) lives.
 *
 * In a dev checkout that is three levels up from src/main -- the repo root.
 * In a PACKAGED app it is not: __dirname is
 * `<app>/resources/app.asar/src/main`, so the same climb lands on
 * `resources/`, and the app looked for `resources/scripts/build-backend.mjs`
 * and died on startup. `extraResources` in package.json now copies the built
 * dist/ to `resources/dist`, which is exactly what process.resourcesPath
 * points at.
 */
const IS_PACKAGED = Boolean(app && app.isPackaged);
const REPO_ROOT = IS_PACKAGED ? process.resourcesPath : path.join(__dirname, '..', '..', '..');
const BACKEND_PORT = 7861;
const APP_PORT = 4173;
// Set by test/ipc-handlers.test.js: that suite only exercises the IPC
// handlers below via a fake Electron shell and must not spawn a real
// backend process or block on ensureBuilt()/waitForBackend().
const SKIP_BACKEND = process.env.DESKTOP_APP_SKIP_BACKEND === '1';

/**
 * Per-launch secret proving a request came from this app's own window rather
 * than a browser pointed at the same localhost port. Regenerated every start
 * and never persisted, so there is nothing to leak between runs.
 */
const DESKTOP_TOKEN = crypto.randomBytes(32).toString('hex');

/**
 * The certificate this launch serves the window over, and its fingerprint.
 * Generated in memory at startup and never written to disk, so there is no key
 * file to leak or to go stale, and every run is a fresh identity.
 */
let tlsCert = null;
let tlsFingerprint = null;

/** Generate the per-launch self-signed certificate for 127.0.0.1. */
async function createTlsCert() {
  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: '127.0.0.1' }],
    {
      days: 1,
      keySize: 2048,
      algorithm: 'sha256',
      // Modern TLS clients ignore commonName entirely and match on SAN, so a
      // cert without this is rejected outright by Chromium.
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 7, ip: '127.0.0.1' },
            { type: 2, value: 'localhost' },
          ],
        },
      ],
    }
  );
  const x509 = new crypto.X509Certificate(pems.cert);
  return { key: pems.private, cert: pems.cert, fingerprint: x509.fingerprint256 };
}

/**
 * Build whichever half of the app (backend JS / frontend static site) is
 * missing from `<repo>/dist`. Fast no-op on a repo that already ships a
 * prebuilt dist/ (the normal case for a packaged app); only a from-source
 * dev checkout pays the build cost, once.
 */
function ensureBuilt() {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  // A packaged app ships a prebuilt dist/ and has no repo, no npm scripts and
  // a read-only bundle -- there is nothing to build and nothing to build it
  // with. Say so plainly instead of shelling out to a build that cannot work.
  if (IS_PACKAGED) {
    const backendEntry = path.join(REPO_ROOT, 'dist', 'interface', 'main.js');
    if (!fs.existsSync(backendEntry)) {
      throw new Error(
        `Packaged app is missing its built application at ${backendEntry}. ` +
        'This means the build did not copy dist/ into the package -- check ' +
        'the "extraResources" entry in desktop-app/package.json.'
      );
    }
    return;
  }

  if (!fs.existsSync(path.join(REPO_ROOT, 'dist', 'interface', 'main.js'))) {
    console.log('[desktop-app] backend not built — running scripts/build-backend.mjs...');
    execFileSync('node', ['scripts/build-backend.mjs'], { cwd: REPO_ROOT, stdio: 'inherit' });
  }

  if (!fs.existsSync(path.join(REPO_ROOT, 'dist', 'index.html'))) {
    console.log('[desktop-app] frontend not built — running npm run build...');
    execFileSync(npmCmd, ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  }
}

/** Poll the backend's /api/status until it responds or `timeoutMs` elapses. */
function waitForBackend(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/status', timeout: 1000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) return reject(new Error('Backend did not become ready in time'));
        setTimeout(attempt, 300);
      });
      req.on('timeout', () => req.destroy());
    };
    attempt();
  });
}

/**
 * Create the main application window, pointed at the local app-server
 * (static frontend + /api proxy to the Neuroclaw backend) rather than the
 * template's demo HTML page.
 */
/**
 * Explicit, per-session consent for Chromium/Electron permissions.
 *
 * Electron desktop apps do not have a universal Windows permission manifest.
 * This handler governs webContents permissions only; native Windows features
 * still need their own API, authorization, and runtime checks.
 */
const SESSION_PERMISSION_GRANTS = new Set();
const SESSION_PERMISSION_DENIALS = new Set();
const WEB_PERMISSION_LABELS = {
  media: 'camera and/or microphone',
  geolocation: 'location',
  notifications: 'desktop notifications',
  fullscreen: 'fullscreen mode',
  pointerLock: 'pointer lock',
  'clipboard-read': 'reading clipboard contents',
  'clipboard-sanitized-write': 'writing to the clipboard',
  midi: 'MIDI device access',
  'midi-sysex': 'MIDI system-exclusive device access',
};

function isTrustedAppFrame(frameUrl) {
  try {
    const parsed = new URL(frameUrl);
    if (parsed.protocol === 'file:') {
      const rendererRoot = path.resolve(__dirname, '../renderer') + path.sep;
      const candidate = path.resolve(decodeURIComponent(parsed.pathname));
      return candidate.startsWith(rendererRoot);
    }
    return parsed.protocol === 'https:' &&
      parsed.hostname === '127.0.0.1' &&
      parsed.port === String(APP_PORT);
  } catch {
    return false;
  }
}

function permissionGrantKey(permission, frameUrl) {
  try { return permission + ':' + new URL(frameUrl).origin; } catch { return permission + ':' + frameUrl; }
}

function installPermissionHandlers() {
  const appSession = session && session.defaultSession;
  // Electron always provides defaultSession in production. Tests and minimal
  // embeddings may omit it, so leave permissions unavailable rather than fail startup.
  if (!appSession || typeof appSession.setPermissionRequestHandler !== 'function') return;
  appSession.setPermissionRequestHandler(async (webContents, permission, callback, details = {}) => {
    const requestingUrl = details.requestingUrl ||
      (webContents && webContents.getURL ? webContents.getURL() : '');
    if (!isTrustedAppFrame(requestingUrl)) {
      callback(false);
      return;
    }

    // Unknown permissions are denied rather than silently granted.
    const label = WEB_PERMISSION_LABELS[permission];
    if (!label) {
      callback(false);
      return;
    }

    const key = permissionGrantKey(permission, requestingUrl);
    if (SESSION_PERMISSION_GRANTS.has(key)) {
      callback(true);
      return;
    }
    if (SESSION_PERMISSION_DENIALS.has(key) || !mainWindow || mainWindow.isDestroyed()) {
      callback(false);
      return;
    }

    try {
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Allow for this session', 'Deny'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Permission request',
        message: 'Allow .my-ai to use ' + label + '?',
        detail: 'This applies only to this app session. Windows privacy settings and device availability may still block access.',
      });
      if (result.response === 0) {
        SESSION_PERMISSION_GRANTS.add(key);
        callback(true);
      } else {
        SESSION_PERMISSION_DENIALS.add(key);
        callback(false);
      }
    } catch {
      callback(false);
    }
  });

  if (typeof appSession.setPermissionCheckHandler === 'function') appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const origin = requestingOrigin || (webContents && webContents.getURL ? webContents.getURL() : '');
    if (!isTrustedAppFrame(origin)) return false;
    if (!WEB_PERMISSION_LABELS[permission]) return false;
    return SESSION_PERMISSION_GRANTS.has(permissionGrantKey(permission, origin));
  });
}

function createWindow() {
  // Stamp the per-launch token on every request this window makes -- the page,
  // its assets, and its /api calls all go through here. A browser opening the
  // same URL sends no such header and gets 403.
  // Only when we actually started the token-protected app-server; with
  // SKIP_BACKEND there is no server to authenticate to.
  if (!SKIP_BACKEND) {
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: [`https://127.0.0.1:${APP_PORT}/*`] },
      (details, callback) => {
        callback({ requestHeaders: { ...details.requestHeaders, [DESKTOP_TOKEN_HEADER]: DESKTOP_TOKEN } });
      }
    );
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '../../assets/icon.png'),
  });

  if (SKIP_BACKEND) {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  } else {
    // The boot screen: instant, self-contained, no server needed. Replaced
    // with the real app by whenReady() once startNeuroclaw() resolves.
    mainWindow.loadFile(path.join(__dirname, '../renderer/loading.html'));
  }

  // Open DevTools in development (optional)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startNeuroclaw() {
  ensureBuilt();

  // Run the backend on Electron's own bundled Node rather than a `node` from
  // PATH: an end user installing a .deb or AppImage has no reason to have
  // Node installed, and spawning a bare 'node' would fail on their machine
  // while working fine on any developer's. ELECTRON_RUN_AS_NODE makes
  // process.execPath behave as a plain Node binary.
  backendProcess = spawn(process.execPath, ['dist/interface/main.js', 'web', String(BACKEND_PORT)], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  backendProcess.on('exit', (code) => {
    console.log(`[desktop-app] backend process exited with code ${code}`);
  });

  await waitForBackend(BACKEND_PORT);

  tlsCert = await createTlsCert();
  tlsFingerprint = tlsCert.fingerprint;

  appServer = await startAppServer({
    distDir: path.join(REPO_ROOT, 'dist'),
    backendPort: BACKEND_PORT,
    port: APP_PORT,
    authToken: DESKTOP_TOKEN,
    tls: { key: tlsCert.key, cert: tlsCert.cert },
  });
}

function stopNeuroclaw() {
  if (appServer) {
    appServer.close();
    appServer = undefined;
  }
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = undefined;
  }
}

/**
 * Application lifecycle events
 */
/**
 * One running copy per machine. Clicking the desktop icon while Corona is
 * already open used to launch a second process, which would then race the
 * first for ports 7861/4173 and fail -- the icon appeared to do nothing. The
 * second instance now hands off to the first, which raises and focuses its
 * window, so the icon always means "show me Corona".
 *
 * Not applied under SKIP_BACKEND: the IPC test suite loads this file directly
 * with a fake Electron whose app has no lock methods, and must not exit.
 */
if (!SKIP_BACKEND && typeof app.requestSingleInstanceLock === 'function' && !app.requestSingleInstanceLock()) {
  app.quit();
} else {

if (!SKIP_BACKEND && typeof app.on === 'function') {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

/**
 * The window's certificate is self-signed, so Chromium rejects it by default.
 * Rather than disabling verification (which would accept ANY certificate,
 * including one presented by something else that grabbed the port first), this
 * accepts exactly one: the certificate this launch generated, matched on its
 * SHA-256 fingerprint. That is strictly stronger than ordinary CA trust here --
 * a public CA would vouch for any holder of a cert for this name, whereas this
 * accepts only the key pair created in this process a moment ago.
 */
if (!SKIP_BACKEND && typeof app.on === 'function') {
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    const expected = tlsFingerprint;
    const presented = certificate && certificate.fingerprint;
    // Electron reports fingerprints as "sha256/<base64>"; node's X509 gives
    // colon-separated hex. Compare on the raw bytes so the formats cannot
    // silently fail to match and quietly fall through to a rejection.
    if (expected && presented && normalizeFingerprint(presented) === normalizeFingerprint(expected)) {
      event.preventDefault();
      callback(true);
      return;
    }
    callback(false);
  });
}

/** "sha256/<base64>" or "AA:BB:.." -> lowercase hex, for format-independent comparison. */
function normalizeFingerprint(fp) {
  if (typeof fp !== 'string') return ''
  if (fp.startsWith('sha256/')) {
    return Buffer.from(fp.slice('sha256/'.length), 'base64').toString('hex').toLowerCase();
  }
  return fp.replace(/:/g, '').toLowerCase();
}

app.whenReady().then(async () => {
  installPermissionHandlers();

  // Window first, backend second. The other order meant the user clicked the
  // icon and got nothing at all for as long as the backend took to boot
  // (measured at 13-18s), which is indistinguishable from a failed launch.
  // The window now appears immediately showing the boot screen, and swaps to
  // the app once the server is actually up.
  createWindow();

  if (!SKIP_BACKEND) {
    try {
      await startNeuroclaw();
      // Only now does the real URL exist to load.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(`https://127.0.0.1:${APP_PORT}`);
      }
    } catch (error) {
      console.error('[desktop-app] failed to start Neuroclaw:', error);
      // Leave the boot screen up and say what went wrong, rather than sitting
      // on "Starting..." forever or dropping the user on a blank window.
      if (mainWindow && !mainWindow.isDestroyed()) {
        const message = String(error && error.message ? error.message : error);
        mainWindow.webContents.executeJavaScript(
          `(() => { const d = document.getElementById('detail');
             if (d) { d.className = 'detail error';
               d.textContent = ${JSON.stringify('Corona could not start: ' + message)}; }
             const m = document.querySelector('.mark');
             if (m) m.style.animation = 'none'; })()`
        ).catch(() => { /* window may have closed */ });
      }
    }
  }

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  stopNeuroclaw();
});

/**
 * IPC Handlers for Native OS Interactions
 */

// Windows capability tools. New handlers are restricted to this app's own
// BrowserWindow. Each catalog entry has its own exposed tool name; tools that
// need a provider/native adapter return adapter-required instead of faking access.
function isTrustedCapabilityCaller(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() &&
    event && event.sender && event.sender.id === mainWindow.webContents.id);
}

ipcMain.handle('windows-tools:list', async (event) => {
  if (!isTrustedCapabilityCaller(event)) return { success: false, error: 'Untrusted IPC caller.' };
  return { success: true, tools: windowsCapabilityTools.listTools() };
});

ipcMain.handle('windows-tools:status', async (event, id) => {
  if (!isTrustedCapabilityCaller(event)) return { success: false, error: 'Untrusted IPC caller.' };
  return windowsCapabilityTools.getToolStatus(id);
});

ipcMain.handle('windows-tools:run', async (event, id, args = {}) => {
  if (!isTrustedCapabilityCaller(event)) return { success: false, error: 'Untrusted IPC caller.' };
  const tool = windowsCapabilityTools.getTool(id);
  if (!tool) return { success: false, error: 'Unknown Windows capability tool.' };
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { success: false, error: 'Tool arguments must be an object.' };
  }

  try {
    switch (id) {
      case 'selectFile': {
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openFile'],
          title: typeof args.title === 'string' ? args.title.slice(0, 120) : 'Choose a file',
          filters: Array.isArray(args.filters) ? args.filters : [],
        });
        return { success: !result.canceled, canceled: result.canceled, paths: result.filePaths };
      }
      case 'selectDirectory': {
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory'],
          title: typeof args.title === 'string' ? args.title.slice(0, 120) : 'Choose a folder',
        });
        return { success: !result.canceled, canceled: result.canceled, paths: result.filePaths };
      }
      case 'readSelectedFile': {
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openFile'], title: 'Choose a file to read',
        });
        if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };
        const stat = fs.statSync(result.filePaths[0]);
        if (!stat.isFile() || stat.size > 10 * 1024 * 1024) {
          return { success: false, error: 'Choose a regular file no larger than 10 MB.' };
        }
        return { success: true, path: result.filePaths[0], content: fs.readFileSync(result.filePaths[0], 'utf-8') };
      }
      case 'writeSelectedFile': {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: 'Choose where to save text',
          defaultPath: typeof args.defaultPath === 'string' ? path.basename(args.defaultPath) : 'output.txt',
        });
        if (result.canceled || !result.filePath) return { success: false, canceled: true };
        if (typeof args.content !== 'string') return { success: false, error: 'content must be a string.' };
        if (Buffer.byteLength(args.content, 'utf8') > 10 * 1024 * 1024) {
          return { success: false, error: 'Content exceeds the 10 MB limit.' };
        }
        fs.writeFileSync(result.filePath, args.content, { encoding: 'utf8', flag: 'w' });
        return { success: true, path: result.filePath };
      }
      case 'clipboardWrite': {
        const { clipboard } = require('electron');
        if (typeof args.text !== 'string') return { success: false, error: 'text must be a string.' };
        clipboard.writeText(args.text.slice(0, 1000000));
        return { success: true };
      }
      case 'notifications': {
        const { Notification } = require('electron');
        if (!Notification || !Notification.isSupported()) {
          return { success: false, status: 'unsupported', error: 'Desktop notifications are not supported here.' };
        }
        const title = typeof args.title === 'string' ? args.title.slice(0, 120) : '.my-ai';
        const body = typeof args.body === 'string' ? args.body.slice(0, 2000) : '';
        new Notification({ title, body }).show();
        return { success: true };
      }
      case 'networkInterfaces':
        return { success: true, interfaces: require('os').networkInterfaces() };
      case 'environmentInfo': {
        const safeKeys = ['OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'ComSpec', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH'];
        const env = {};
        for (const key of safeKeys) {
          if (process.env[key] !== undefined) env[key] = process.env[key];
        }
        return { success: true, environment: env };
      }
      case 'systemInfo':
        return windowsCapabilityTools.getToolStatus('systemInfo');
      case 'openUrl': {
        if (typeof args.url !== 'string') return { success: false, error: 'url must be a string.' };
        const parsed = new URL(args.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return { success: false, error: 'Only http and https URLs are allowed.' };
        await shell.openExternal(parsed.href);
        return { success: true };
      }
      case 'openPath': {
        if (typeof args.path !== 'string' || !path.isAbsolute(args.path)) {
          return { success: false, error: 'An absolute path is required.' };
        }
        const error = await shell.openPath(args.path);
        return error ? { success: false, error } : { success: true };
      }
      case 'processList': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const stdout = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
          encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024,
        });
        return { success: true, output: stdout };
      }
      default:
        return {
          success: false,
          status: tool.implementation === 'admin-or-adapter' ? 'admin-or-adapter-required' : 'adapter-required',
          tool: tool.toolName,
          message: tool.description,
        };
    }
  } catch (error) {
    return { success: false, error: error && error.message ? error.message : String(error) };
  }
});

// File System Operations
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Directory',
  });
  return result;
});

ipcMain.handle('select-file', async (event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: options.filters || [],
    title: options.title || 'Select File',
  });
  return result;
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-system-info', async () => {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    homeDir: require('os').homedir(),
    tmpDir: require('os').tmpdir(),
  };
});

// Process Management - Launch local processes
ipcMain.handle('spawn-process', async (event, command, args = [], options = {}) => {
  if (isBlockedCommand([command, ...args].join(' '))) {
    return { success: false, error: 'Blocked: destructive command pattern detected' };
  }
  return new Promise((resolve) => {
    const childProcess = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      shell: options.shell || false,
    });

    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      // Optionally send output to renderer
      mainWindow.webContents.send('process-output', { type: 'stdout', data: data.toString() });
    });

    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      mainWindow.webContents.send('process-output', { type: 'stderr', data: data.toString() });
    });

    childProcess.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code,
        stdout,
        stderr,
      });
    });

    childProcess.on('error', (error) => {
      resolve({
        success: false,
        error: error.message,
      });
    });
  });
});

ipcMain.handle('exec-command', async (event, command, options = {}) => {
  if (isBlockedCommand(command)) {
    return { success: false, error: 'Blocked: destructive command pattern detected', stdout: '', stderr: '' };
  }
  return new Promise((resolve) => {
    exec(command, {
      cwd: options.cwd || process.cwd(),
      maxBuffer: options.maxBuffer || 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          success: false,
          error: error.message,
          stdout,
          stderr,
        });
      } else {
        resolve({
          success: true,
          stdout,
          stderr,
        });
      }
    });
  });
});

// Open external URLs in default browser, strictly validating protocol to prevent unsafe protocols (like file://, ms-msdt:) or RCE.
ipcMain.handle('open-external', async (event, url) => {
  if (typeof url !== 'string') {
    return { success: false, error: 'Blocked: invalid URL type' };
  }
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { success: false, error: 'Blocked: unsafe protocol scheme' };
    }
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Blocked: invalid URL format' };
  }
});

// Show item in file manager
ipcMain.handle('show-in-folder', async (event, filePath) => {
  shell.showItemInFolder(filePath);
  return { success: true };
});

console.log('Desktop App initialized successfully!');
console.log(`Platform: ${process.platform}`);
console.log(`Architecture: ${process.arch}`);

} // end single-instance guard
