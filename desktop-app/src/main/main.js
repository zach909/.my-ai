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
const ownedCapabilityProcesses = new Map();
const capabilityFileWatchers = new Map();

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
  for (const entry of capabilityFileWatchers.values()) { try { entry.watcher.close(); } catch {} }
  capabilityFileWatchers.clear();
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
      case 'documents':
      case 'desktop':
      case 'downloads':
      case 'pictures':
      case 'videos':
      case 'music':
      case 'broadFilesystem':
      case 'onedriveFiles': {
        const defaultPaths = {
          documents: app.getPath('documents'),
          desktop: app.getPath('desktop'),
          downloads: app.getPath('downloads'),
          pictures: app.getPath('pictures'),
          videos: app.getPath('videos'),
          music: app.getPath('music'),
          broadFilesystem: app.getPath('home'),
          onedriveFiles: app.getPath('home'),
        };
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory', 'createDirectory'],
          title: 'Choose the folder .my-ai may access for this operation',
          defaultPath: defaultPaths[id],
        });
        if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };
        return { success: true, path: result.filePaths[0], scope: 'user-selected folder only', persistentGrant: false };
      }
      case 'createFile':
      case 'automaticDownloads': {
        if (typeof args.content !== 'string') return { success: false, error: 'content must be a string.' };
        if (Buffer.byteLength(args.content, 'utf8') > 10 * 1024 * 1024) return { success: false, error: 'Content exceeds the 10 MB limit.' };
        const result = await dialog.showSaveDialog(mainWindow, {
          title: 'Choose where to create the new file',
          defaultPath: typeof args.defaultPath === 'string' ? path.basename(args.defaultPath) : 'new-file.txt',
        });
        if (result.canceled || !result.filePath) return { success: false, canceled: true };
        try {
          fs.writeFileSync(result.filePath, args.content, { encoding: 'utf8', flag: 'wx' });
          return { success: true, path: result.filePath, created: true };
        } catch (error) {
          if (error && error.code === 'EEXIST') return { success: false, error: 'The destination already exists; no file was overwritten.' };
          throw error;
        }
      }
      case 'updateFile': {
        if (typeof args.content !== 'string') return { success: false, error: 'content must be a string.' };
        if (Buffer.byteLength(args.content, 'utf8') > 10 * 1024 * 1024) return { success: false, error: 'Content exceeds the 10 MB limit.' };
        const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title: 'Choose the file to update' });
        if (selected.canceled || !selected.filePaths[0]) return { success: false, canceled: true };
        const target = selected.filePaths[0];
        const stat = fs.statSync(target);
        if (!stat.isFile() || stat.size > 10 * 1024 * 1024) return { success: false, error: 'Choose a regular file no larger than 10 MB.' };
        const approval = await dialog.showMessageBox(mainWindow, {
          type: 'warning', buttons: ['Replace file contents', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
          title: 'Confirm file update', message: 'Replace the contents of ' + path.basename(target) + '?',
          detail: 'The existing contents will be overwritten.',
        });
        if (approval.response !== 0) return { success: false, canceled: true };
        fs.writeFileSync(target, args.content, { encoding: 'utf8', flag: 'w' });
        return { success: true, path: target, updated: true };
      }
      case 'moveFile':
      case 'renameFile': {
        const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title: 'Choose the file to move or rename' });
        if (selected.canceled || !selected.filePaths[0]) return { success: false, canceled: true };
        const source = selected.filePaths[0];
        if (!fs.statSync(source).isFile()) return { success: false, error: 'Only regular files are supported.' };
        const destination = await dialog.showSaveDialog(mainWindow, {
          title: id === 'moveFile' ? 'Choose the destination path' : 'Choose the new file name',
          defaultPath: path.join(path.dirname(source), path.basename(source)),
        });
        if (destination.canceled || !destination.filePath) return { success: false, canceled: true };
        if (path.resolve(source).toLowerCase() === path.resolve(destination.filePath).toLowerCase()) {
          return { success: false, error: 'Source and destination are the same path.' };
        }
        if (fs.existsSync(destination.filePath)) return { success: false, error: 'Destination already exists; no file was overwritten.' };
        fs.renameSync(source, destination.filePath);
        return { success: true, source, path: destination.filePath, moved: true };
      }
      case 'deleteFile': {
        const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title: 'Choose the file to delete' });
        if (selected.canceled || !selected.filePaths[0]) return { success: false, canceled: true };
        const target = selected.filePaths[0];
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink()) return { success: false, error: 'Only regular files can be deleted; folders and symbolic links are not supported.' };
        const approval = await dialog.showMessageBox(mainWindow, {
          type: 'warning', buttons: ['Delete file', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
          title: 'Confirm permanent deletion', message: 'Delete ' + path.basename(target) + '?',
          detail: 'This removes the selected file and may not be reversible.',
        });
        if (approval.response !== 0) return { success: false, canceled: true };
        fs.unlinkSync(target);
        return { success: true, path: target, deleted: true };
      }
      case 'fileSearch':
      case 'mediaLibrary': {
        const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: id === 'fileSearch' ? 'Choose a folder to search' : 'Choose a media folder to inspect' });
        if (selected.canceled || !selected.filePaths[0]) return { success: false, canceled: true };
        const root = selected.filePaths[0];
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
        if (id === 'fileSearch' && !query) return { success: false, error: 'query must be a non-empty file-name fragment.' };
        const results = [];
        let visited = 0;
        let truncated = false;
        const maxVisited = 50000;
        const maxResults = 5000;
        const walk = (directory, depth) => {
          if (depth > 10 || visited >= maxVisited || results.length >= maxResults) { truncated = true; return; }
          let children;
          try { children = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
          for (const child of children) {
            if (++visited > maxVisited || results.length >= maxResults) { truncated = true; return; }
            const fullPath = path.join(directory, child.name);
            if (child.isSymbolicLink()) continue;
            if (id === 'fileSearch' && child.name.toLowerCase().includes(query)) {
              results.push({ path: fullPath, name: child.name, isDirectory: child.isDirectory() });
            } else if (id === 'mediaLibrary' && child.isFile() && /\.(mp3|wav|flac|m4a|aac|ogg|mp4|mkv|mov|avi|jpg|jpeg|png|gif|webp|bmp)$/i.test(child.name)) {
              let stat;
              try { stat = fs.statSync(fullPath); } catch { continue; }
              results.push({ path: fullPath, name: child.name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() });
            }
            if (child.isDirectory()) walk(fullPath, depth + 1);
            if (visited >= maxVisited || results.length >= maxResults) { truncated = true; return; }
          }
        };
        walk(root, 0);
        return { success: true, root, results, count: results.length, truncated, visitedEntries: visited, note: 'Only names and basic metadata were inspected; file contents were not read.' };
      }
      case 'networkShares': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const mapped = execFileSync('net.exe', ['use'], { encoding: 'utf8', timeout: 7000, windowsHide: true });
        let localShares = '';
        try { localShares = execFileSync('net.exe', ['share'], { encoding: 'utf8', timeout: 7000, windowsHide: true }); } catch {}
        return { success: true, mappedShares: mapped.slice(0, 20000), localShares: localShares.slice(0, 20000), readOnly: true };
      }
      case 'removableDrives': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, drives: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true, note: 'Drive metadata only; file access still follows normal Windows permissions.' };
      }
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
      case 'clipboardImageRead': {
        const { clipboard } = require('electron');
        const approval = await dialog.showMessageBox(mainWindow, {
          type: 'warning', buttons: ['Read clipboard image', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
          title: 'Sensitive permission', message: 'Allow .my-ai to read the current clipboard image?',
          detail: 'Clipboard images may contain private information. Only the current image will be returned.',
        });
        if (approval.response !== 0) return { success: false, canceled: true };
        const image = clipboard.readImage();
        if (image.isEmpty()) return { success: false, error: 'The clipboard does not contain an image.' };
        const png = image.toPNG();
        if (png.length > 10 * 1024 * 1024) return { success: false, error: 'Clipboard image exceeds the 10 MB limit.' };
        return { success: true, mimeType: 'image/png', width: image.getSize().width, height: image.getSize().height, base64: png.toString('base64') };
      }
      case 'clipboardClear': {
        const { clipboard } = require('electron');
        const approval = await dialog.showMessageBox(mainWindow, {
          type: 'warning', buttons: ['Clear clipboard', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
          title: 'Confirm clipboard clearing', message: 'Clear the current clipboard contents?',
          detail: 'This affects all clipboard formats currently stored in Windows.',
        });
        if (approval.response !== 0) return { success: false, canceled: true };
        clipboard.clear();
        return { success: true, cleared: true };
      }
      case 'clipboardRead': {
        const { clipboard } = require('electron');
        const approval = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          buttons: ['Read clipboard', 'Cancel'],
          defaultId: 1, cancelId: 1, noLink: true,
          title: 'Sensitive permission',
          message: 'Allow .my-ai to read the current clipboard text?',
          detail: 'Clipboard contents can include private information. Only the current text value will be returned.',
        });
        if (approval.response !== 0) return { success: false, canceled: true };
        return { success: true, text: clipboard.readText().slice(0, 1000000) };
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
      case 'localNetwork':
        return { success: true, interfaces: require('os').networkInterfaces() };
      case 'environmentInfo':
      case 'environmentRead': {
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
      case 'launchProcess':
      case 'appLaunch': {
        if (typeof args.executable !== 'string' || !args.executable.trim()) {
          return { success: false, error: 'executable must be a non-empty path or command name.' };
        }
        if (!Array.isArray(args.args || []) || (args.args || []).length > 128 ||
            (args.args || []).some((arg) => typeof arg !== 'string')) {
          return { success: false, error: 'args must be an array of up to 128 strings.' };
        }
        const approval = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          buttons: ['Launch', 'Cancel'],
          defaultId: 1, cancelId: 1, noLink: true,
          title: 'Launch external program',
          message: 'Allow .my-ai to launch ' + path.basename(args.executable) + '?',
          detail: 'Arguments: ' + (args.args || []).join(' ').slice(0, 1000) + '\\nThe program will run with your current Windows account permissions.',
        });
        if (approval.response !== 0) return { success: false, canceled: true };
        const child = spawn(args.executable, args.args || [], {
          cwd: typeof args.cwd === 'string' && path.isAbsolute(args.cwd) ? args.cwd : process.cwd(),
          shell: false,
          windowsHide: false,
          stdio: 'ignore',
        });
        const processToken = crypto.randomUUID();
        ownedCapabilityProcesses.set(processToken, child);
        child.once('exit', () => ownedCapabilityProcesses.delete(processToken));
        child.once('error', () => ownedCapabilityProcesses.delete(processToken));
        return { success: true, processToken, pid: child.pid };
      }
      case 'stopOwnedProcess': {
        if (typeof args.processToken !== 'string' || !ownedCapabilityProcesses.has(args.processToken)) {
          return { success: false, error: 'Unknown process token; only processes launched by this tool can be stopped.' };
        }
        const child = ownedCapabilityProcesses.get(args.processToken);
        try {
          const stopped = child.kill();
          if (stopped) ownedCapabilityProcesses.delete(args.processToken);
          return { success: stopped, error: stopped ? undefined : 'The process could not be stopped.' };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
      case 'processList': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const stdout = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
          encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024,
        });
        return { success: true, output: stdout };
      }
      case 'readFileMetadata': {
        const selected = await dialog.showOpenDialog(mainWindow, {
          properties: ['openFile'], title: 'Choose a file to inspect',
        });
        if (selected.canceled || !selected.filePaths[0]) return { success: false, canceled: true };
        const filePath = selected.filePaths[0];
        const stat = fs.statSync(filePath);
        return {
          success: true, path: filePath, name: path.basename(filePath),
          isFile: stat.isFile(), isDirectory: stat.isDirectory(), sizeBytes: stat.size,
          createdAt: stat.birthtime.toISOString(), modifiedAt: stat.mtime.toISOString(),
          accessedAt: stat.atime.toISOString(),
        };
      }
      case 'appData':
        return {
          success: true,
          userData: app.getPath('userData'),
          logs: app.getPath('logs'),
          temp: app.getPath('temp'),
        };
      case 'diskSpace': {
        const selected = await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory'], title: 'Choose a drive or folder to inspect',
        });
        if (selected.canceled || !selected.filePaths[0]) return { success: false, canceled: true };
        if (typeof fs.statfsSync !== 'function') {
          return { success: false, status: 'unsupported', error: 'Filesystem statistics are unavailable in this runtime.' };
        }
        const stat = fs.statfsSync(selected.filePaths[0]);
        return {
          success: true, path: selected.filePaths[0],
          blockSizeBytes: stat.bsize,
          totalBytes: stat.blocks * stat.bsize,
          freeBytes: stat.bfree * stat.bsize,
          availableBytes: stat.bavail * stat.bsize,
        };
      }
      case 'performanceMetrics': {
        const os = require('os');
        return {
          success: true,
          uptimeSeconds: os.uptime(),
          totalMemoryBytes: os.totalmem(),
          freeMemoryBytes: os.freemem(),
          processMemory: process.memoryUsage(),
          cpuCount: os.cpus().length,
          loadAverage: os.loadavg(),
        };
      }
      case 'windowsCapabilityState':
        return { success: true, platform: process.platform, tools: windowsCapabilityTools.listTools() };
      case 'privacySettings': {
        if (process.platform !== 'win32') {
          return { success: false, status: 'unsupported-on-platform', error: 'Windows privacy settings are only available on Windows.' };
        }
        await shell.openExternal('ms-settings:privacy');
        return { success: true, opened: 'ms-settings:privacy' };
      }
      case 'windowsSecurityContext':
      case 'uacStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const account = execFileSync('whoami.exe', ['/user'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        const groups = execFileSync('whoami.exe', ['/groups'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        const elevated = /S-1-16-12288|S-1-16-16384/.test(groups);
        return {
          success: true,
          user: account.trim().slice(0, 4000),
          groups: groups.trim().slice(0, 24000),
          elevated,
          note: 'Reports the current process token only; this does not grant or change privileges.',
        };
      }
      case 'uacElevationRequest': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const action = args.action || 'status';
        if (action === 'status') {
          const groups = execFileSync('whoami.exe', ['/groups'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
          return { success: true, elevated: /S-1-16-12288|S-1-16-16384/.test(groups), action: 'status' };
        }
        if (action !== 'relaunch-elevated') return { success: false, error: 'Only status and relaunch-elevated are supported.' };
        const approval = await dialog.showMessageBox(mainWindow, {
          type: 'warning', buttons: ['Request administrator access', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
          title: 'Restart .my-ai as administrator?',
          message: 'Windows will show a User Account Control (UAC) prompt.',
          detail: 'If you approve, .my-ai will relaunch as administrator. This does not bypass UAC, grant SYSTEM privileges, or enable unrestricted access. Save your work first.',
        });
        if (approval.response !== 0) return { success: false, canceled: true };
        const executable = process.execPath;
        const launchArgs = app.isPackaged ? [] : [app.getAppPath()];
        const exe64 = Buffer.from(executable, 'utf8').toString('base64');
        const args64 = Buffer.from(JSON.stringify(launchArgs), 'utf8').toString('base64');
        const script = [
          "$ErrorActionPreference = 'Stop'",
          "$exe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + exe64 + "'))",
          "$raw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + args64 + "'))",
          "$items = @(ConvertFrom-Json -InputObject $raw)",
          "$quoted = @($items | ForEach-Object { '"' + ([string]$_).Replace('"', '\\"') + '"' })",
          "try { Start-Process -FilePath $exe -ArgumentList ($quoted -join ' ') -Verb RunAs -ErrorAction Stop; exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }"
        ].join('\n');
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        try {
          execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 256 * 1024 });
          app.quit();
          return { success: true, requested: true, relaunching: true, note: 'Windows UAC decides whether elevation is granted.' };
        } catch (error) {
          return { success: false, status: 'elevation-not-started', error: String(error && error.message || error).slice(0, 2000), note: 'The current process remains unelevated; no UAC bypass was attempted.' };
        }
      }
      case 'fileAccessControl': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const selected = await dialog.showOpenDialog(mainWindow, {
          properties: ['openFile', 'openDirectory'], title: 'Choose a file or folder to inspect its Windows ACL',
        });
        if (selected.canceled || !selected.filePaths[0]) return { success: false, canceled: true };
        const output = execFileSync('icacls.exe', [selected.filePaths[0]], {
          encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024,
        });
        return { success: true, path: selected.filePaths[0], acl: output.slice(0, 50000) };
      }
      case 'aclPermissionCheck': {
        const selected = await dialog.showOpenDialog(mainWindow, {
          properties: ['openFile', 'openDirectory'], title: 'Choose a path to check current-account access',
        });
        if (selected.canceled || !selected.filePaths[0]) return { success: false, canceled: true };
        const target = selected.filePaths[0];
        const result = { success: true, path: target, read: false, write: false, execute: false };
        try { fs.accessSync(target, fs.constants.R_OK); result.read = true; } catch {}
        try { fs.accessSync(target, fs.constants.W_OK); result.write = true; } catch {}
        try { fs.accessSync(target, fs.constants.X_OK); result.execute = true; } catch {}
        result.note = 'Best-effort access check for this process; actual access can differ for child processes, network paths, or later operations.';
        return result;
      }
      case 'windowsPermissionSettings': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const pages = {
          camera: 'ms-settings:privacy-webcam',
          microphone: 'ms-settings:privacy-microphone',
          location: 'ms-settings:privacy-location',
          contacts: 'ms-settings:privacy-contacts',
          calendar: 'ms-settings:privacy-calendar',
          notifications: 'ms-settings:notifications',
          filesystem: 'ms-settings:privacy-broadfilesystemaccess',
          general: 'ms-settings:privacy',
        };
        const page = typeof args.capability === 'string' ? args.capability : 'general';
        if (!Object.prototype.hasOwnProperty.call(pages, page)) {
          return { success: false, error: 'Unsupported settings page. Use camera, microphone, location, contacts, calendar, notifications, filesystem, or general.' };
        }
        await shell.openExternal(pages[page]);
        return { success: true, opened: pages[page] };
      }
      case 'windowsUpdateSettings': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        await shell.openExternal('ms-settings:windowsupdate');
        return { success: true, opened: 'ms-settings:windowsupdate' };
      }
      case 'windowsSecuritySettings': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        await shell.openExternal('windowsdefender:');
        return { success: true, opened: 'windowsdefender:' };
      }
      case 'networkProfileStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const output = execFileSync('netsh.exe', ['wlan', 'show', 'interfaces'], {
          encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024,
        });
        return { success: true, wifiInterfaceStatus: output.slice(0, 30000) };
      }
      case 'windowsCapabilityManifest':
        return {
          success: true,
          platform: process.platform,
          packaged: Boolean(app.isPackaged),
          packagePath: app.getAppPath(),
          note: 'This Electron desktop app does not automatically receive UWP/MSIX capabilities. Manifest capability requirements depend on package identity, trust level, Windows version, and API. This reports context only, not granted capabilities.',
        };
      case 'windowsTokenPrivileges': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const output = execFileSync('whoami.exe', ['/priv'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        return { success: true, privileges: output.slice(0, 30000), note: 'Read-only view of this process token; privileges are not enabled or changed.' };
      }
      case 'windowsFirewallStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const output = execFileSync('netsh.exe', ['advfirewall', 'show', 'allprofiles'], { encoding: 'utf8', timeout: 7000, windowsHide: true });
        return { success: true, profiles: output.slice(0, 30000) };
      }
      case 'windowsDefenderStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = 'Get-MpComputerStatus | Select-Object AMServiceEnabled,AntivirusEnabled,AntispywareEnabled,RealTimeProtectionEnabled,BehaviorMonitorEnabled,IoavProtectionEnabled,NISEnabled,AntivirusSignatureLastUpdated | ConvertTo-Json -Compress';
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, status: JSON.parse(output.trim()) };
      }
      case 'windowsServiceStatus':
      case 'windowsServiceSecurityDescriptor': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const serviceName = args.serviceName;
        if (typeof serviceName !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(serviceName)) {
          return { success: false, error: 'serviceName must be a simple Windows service name.' };
        }
        const command = id === 'windowsServiceStatus' ? 'query' : 'sdshow';
        const output = execFileSync('sc.exe', [command, serviceName], { encoding: 'utf8', timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, serviceName, output: output.slice(0, 30000), readOnly: true };
      }
      case 'windowsAccountPolicy': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const output = execFileSync('net.exe', ['accounts'], { encoding: 'utf8', timeout: 7000, windowsHide: true });
        return { success: true, policy: output.slice(0, 20000), note: 'Local summary only; domain policy can override these values.' };
      }
      case 'windowsNetworkShares': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const mapped = execFileSync('net.exe', ['use'], { encoding: 'utf8', timeout: 7000, windowsHide: true });
        let localShares = '';
        try { localShares = execFileSync('net.exe', ['share'], { encoding: 'utf8', timeout: 7000, windowsHide: true }); } catch {}
        return { success: true, mappedShares: mapped.slice(0, 20000), localShares: localShares.slice(0, 20000) };
      }
      case 'windowsPowerShellExecutionPolicy': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = 'Get-ExecutionPolicy -List | Select-Object Scope,ExecutionPolicy | ConvertTo-Json -Compress';
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, policies: JSON.parse(output.trim()), note: 'Reports policy only; does not change or bypass it.' };
      }
      case 'wifiStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const output = execFileSync('netsh.exe', ['wlan', 'show', 'interfaces'], { encoding: 'utf8', timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, output: output.slice(0, 30000), readOnly: true };
      }
      case 'bluetooth':
      case 'usbDevices':
      case 'audioDevices':
      case 'microphoneDevices':
      case 'speakerDevices': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const filters = {
          bluetooth: "Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue",
          usbDevices: "Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'USB*' -or $_.InstanceId -like 'USB\\*' }",
          audioDevices: "Get-PnpDevice -Class AudioEndpoint -PresentOnly -ErrorAction SilentlyContinue"
        };
        const command = filters[id] + " | Select-Object Status,Class,FriendlyName,InstanceId | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 12000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        return { success: true, devices: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true, note: 'Device metadata only; no device access or driver changes.' };
      }
      case 'printers': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-Printer -ErrorAction Stop | Select-Object Name,Type,DriverName,PortName,PrinterStatus,Shared | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 12000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        return { success: true, printers: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true };
      }
      case 'displays':
      case 'screenMetadata': {
        const { screen } = require('electron');
        return { success: true, displays: screen.getAllDisplays().map((display) => ({
          id: display.id, bounds: display.bounds, workArea: display.workArea,
          scaleFactor: display.scaleFactor, rotation: display.rotation,
          size: display.size, internal: display.internal,
        })) };
      }
      case 'installedApps':
      case 'appInstallInventory': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "$paths=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName,DisplayVersion,Publisher,InstallDate | Sort-Object DisplayName | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        return { success: true, applications: output.trim() ? JSON.parse(output.trim()) : [], scope: 'visible uninstall registry entries; not a complete inventory of portable or per-user packaged apps' };
      }
      case 'startupSettings':
      case 'startupPrograms': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "$run=@(); foreach($p in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run')) { if(Test-Path $p) { $v=Get-ItemProperty $p; foreach($x in $v.PSObject.Properties) { if($x.Name -notmatch '^PS') { $run += [pscustomobject]@{RegistryPath=$p;Name=$x.Name;Command=[string]$x.Value} } } } }; $run | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 12000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        return { success: true, entries: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true, note: 'Common Run keys only; Startup folders and scheduled tasks are separate.' };
      }
      case 'scheduledTasks': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-ScheduledTask -ErrorAction Stop | Select-Object TaskName,TaskPath,State,Author,Description | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        return { success: true, tasks: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true };
      }
      case 'powerBattery':
      case 'batteryStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object Name,Status,EstimatedChargeRemaining,BatteryStatus,EstimatedRunTime | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, batteries: output.trim() ? JSON.parse(output.trim()) : [], note: 'No battery data is normal on desktop PCs or systems without supported battery telemetry.' };
      }
      case 'firewallStatus':
      case 'firewallProfiles': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const output = execFileSync('netsh.exe', ['advfirewall', 'show', 'allprofiles'], { encoding: 'utf8', timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, profiles: output.slice(0, 30000), readOnly: true };
      }
      case 'securityStatus':
      case 'defenderStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-MpComputerStatus -ErrorAction Stop | Select-Object AMServiceEnabled,AntivirusEnabled,AntispywareEnabled,RealTimeProtectionEnabled,BehaviorMonitorEnabled,IoavProtectionEnabled,NISEnabled,AntivirusSignatureLastUpdated | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 12000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, status: JSON.parse(output.trim()), readOnly: true };
      }
      case 'eventLogs': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-WinEvent -ListLog * -ErrorAction SilentlyContinue | Select-Object LogName,RecordCount,IsEnabled,LogType | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        return { success: true, logs: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true, note: 'Lists log metadata only; individual event reads may need additional rights.' };
      }
      case 'windowsServices': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-Service | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        return { success: true, services: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true, note: 'Listing only; service control and installation are not exposed by this tool.' };
      }
      case 'ethernetStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-NetAdapter -ErrorAction SilentlyContinue | Select-Object Name,InterfaceDescription,Status,MacAddress,LinkSpeed,MediaType | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 12000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        return { success: true, adapters: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true };
      }
      case 'dnsConfiguration': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-DnsClientServerAddress -ErrorAction SilentlyContinue | Select-Object InterfaceAlias,AddressFamily,ServerAddresses | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 12000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        return { success: true, dns: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true };
      }
      case 'proxyConfiguration': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const winhttp = execFileSync('netsh.exe', ['winhttp', 'show', 'proxy'], { encoding: 'utf8', timeout: 7000, windowsHide: true });
        const command = "$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue; [pscustomobject]@{ProxyEnable=$p.ProxyEnable;ProxyServer=$p.ProxyServer;AutoConfigURL=$p.AutoConfigURL} | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, winHttp: winhttp.slice(0, 10000), currentUser: output.trim() ? JSON.parse(output.trim()) : null, readOnly: true };
      }
      case 'networkPortStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const output = execFileSync('netstat.exe', ['-ano'], { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        return { success: true, endpoints: output.slice(0, 100000), readOnly: true, note: 'Local endpoint metadata only; this does not inspect packet contents.' };
      }
      case 'deviceMetadata': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Select-Object Status,Class,FriendlyName,InstanceId | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        return { success: true, devices: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true, note: 'Metadata only; no device contents or driver controls are accessed.' };
      }
      case 'appWindowList': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName,Id,MainWindowTitle | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 12000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        return { success: true, windows: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true, note: 'Visible window metadata only; this does not read other applications’ content.' };
      }
      case 'accountInfo':
      case 'userAccountMetadata': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const user = execFileSync('whoami.exe', ['/user'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        const groups = execFileSync('whoami.exe', ['/groups'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        return { success: true, user: user.slice(0, 8000), groups: groups.slice(0, 20000), readOnly: true, note: 'Identity and group metadata only; no credentials or authentication tokens are returned.' };
      }
      case 'cameraDevices':
      case 'inputDeviceStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = id === 'cameraDevices'
          ? "Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Class -in @('Camera','Image') -or $_.FriendlyName -match 'camera|webcam' } | Select-Object Status,Class,FriendlyName,InstanceId | ConvertTo-Json -Compress"
          : "Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Class -in @('Keyboard','Mouse','HIDClass') } | Select-Object Status,Class,FriendlyName,InstanceId | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 3 * 1024 * 1024 });
        return { success: true, devices: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true, note: 'Device metadata only; no images or keystrokes are captured.' };
      }
      case 'processMetrics': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-Process -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending | Select-Object -First 100 ProcessName,Id,CPU,WorkingSet64,PrivateMemorySize64,StartTime | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 12000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        return { success: true, processes: output.trim() ? JSON.parse(output.trim()) : [], readOnly: true, note: 'Process metadata only; process memory and credentials are not inspected.' };
      }
      case 'registryRead':
      case 'registryInspect': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const allowedKeys = {
          userStartup: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
          machineStartup: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
          userShellFolders: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
          userInternetSettings: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
        };
        if (typeof args.key !== 'string' || !Object.prototype.hasOwnProperty.call(allowedKeys, args.key)) {
          return { success: false, error: 'Choose an allowlisted registry category: userStartup, machineStartup, userShellFolders, or userInternetSettings.' };
        }
        const output = execFileSync('reg.exe', ['query', allowedKeys[args.key]], { encoding: 'utf8', timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, category: args.key, registryOutput: output.slice(0, 30000), readOnly: true, note: 'Only predefined non-secret registry locations are supported.' };
      }
      case 'appDiagnostics': {
        let files = [];
        const logPath = app.getPath('logs');
        try {
          files = fs.readdirSync(logPath, { withFileTypes: true }).filter((entry) => entry.isFile()).slice(0, 200).map((entry) => {
            const fullPath = path.join(logPath, entry.name);
            let stat;
            try { stat = fs.statSync(fullPath); } catch { return { name: entry.name, unavailable: true }; }
            return { name: entry.name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
          });
        } catch {}
        return { success: true, appVersion: app.getVersion(), platform: process.platform, logDirectory: logPath, logFiles: files, readOnly: true, note: 'File names and metadata only; log contents are not returned.' };
      }
      case 'taskManager':
        return {
          success: true,
          tasks: Array.from(ownedCapabilityProcesses.entries()).map(([processToken, child]) => ({
            processToken, pid: child.pid || null, executable: child.spawnfile || null,
            running: Boolean(child.pid && child.exitCode === null && !child.killed),
          })),
          scope: 'Only processes launched and tracked by this app.',
        };
      case 'developerTools': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const tools = [
          ['git.exe', ['--version']], ['node.exe', ['--version']],
          ['python.exe', ['--version']], ['py.exe', ['--version']],
        ];
        const results = tools.map(([executable, argv]) => {
          try {
            const version = execFileSync(executable, argv, { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 256 * 1024 });
            return { executable, available: true, version: version.trim().slice(0, 1000) };
          } catch (error) {
            return { executable, available: false, reason: error && error.code === 'ENOENT' ? 'not-installed-or-not-on-PATH' : (error.message || String(error)).slice(0, 500) };
          }
        });
        return { success: true, tools: results, readOnly: true, note: 'Only fixed version commands were run; arbitrary commands are not accepted by this tool.' };
      }
      case 'gitRepositories': {
        const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Choose a Git repository folder to inspect' });
        if (selected.canceled || !selected.filePaths[0]) return { success: false, canceled: true };
        const cwd = selected.filePaths[0];
        const runGit = (argv) => execFileSync('git.exe', argv, { cwd, encoding: 'utf8', timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 });
        try {
          const root = runGit(['rev-parse', '--show-toplevel']).trim();
          const status = runGit(['status', '--short', '--branch']).slice(0, 20000);
          let lastCommit = '';
          try { lastCommit = runGit(['log', '-1', '--format=%h %s']).trim().slice(0, 1000); } catch {}
          return { success: true, repository: root, status, lastCommit, readOnly: true };
        } catch (error) {
          return { success: false, error: 'The selected folder is not a readable Git repository or Git is unavailable.', detail: (error.message || String(error)).slice(0, 1000) };
        }
      }
      case 'windowsAppCapabilities':
        return {
          success: true, platform: process.platform, packaged: Boolean(app.isPackaged),
          packagePath: app.getAppPath(),
          note: 'Electron packaging context only. This does not claim that MSIX/AppContainer capabilities are declared or granted.',
        };
      case 'permissionAuditLog':
        return { success: true, platform: process.platform, tools: windowsCapabilityTools.listTools(), note: 'Capability catalog and implementation states only; not a log of OS permission grants.' };
      case 'permissionControls':
      case 'appPermissions':
      case 'locationSettings':
      case 'accessibilitySettings':
      case 'defaultApps':
      case 'systemSoundSettings': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const pages = {
          permissionControls: 'ms-settings:privacy',
          appPermissions: 'ms-settings:privacy',
          locationSettings: 'ms-settings:privacy-location',
          accessibilitySettings: 'ms-settings:easeofaccess',
          defaultApps: 'ms-settings:defaultapps',
          systemSoundSettings: 'ms-settings:sound',
        };
        await shell.openExternal(pages[id]);
        return { success: true, opened: pages[id], note: 'The user remains in control of Windows Settings.' };
      }
      case 'timeZoneSettings': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const timezone = execFileSync('tzutil.exe', ['/g'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        await shell.openExternal('ms-settings:dateandtime');
        return { success: true, timeZone: timezone.trim(), opened: 'ms-settings:dateandtime', readOnly: true };
      }
      case 'localeSettings': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-WinSystemLocale | Select-Object Name,DisplayName | ConvertTo-Json -Compress; Write-Output '---CURRENT-CULTURE---'; Get-Culture | Select-Object Name,DisplayName,DateTimeFormat | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, localeInfo: output.slice(0, 20000), readOnly: true };
      }
      case 'devicePowerStatus':
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        return { success: true, platform: process.platform, batteryTool: 'powerBattery', note: 'See powerBattery for supported battery telemetry.' };
      case 'windowsUpdateStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-Service -Name wuauserv -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, service: output.trim() ? JSON.parse(output.trim()) : null, readOnly: true, note: 'Service state only; this does not report whether all updates are installed.' };
      }
      case 'sleepSettings': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const output = execFileSync('powercfg.exe', ['/query'], { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        return { success: true, powerScheme: output.slice(0, 60000), readOnly: true };
      }
      case 'deviceEncryptionStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const output = execFileSync('manage-bde.exe', ['-status'], { encoding: 'utf8', timeout: 12000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        return { success: true, volumes: output.slice(0, 60000), readOnly: true, note: 'Encryption status only; recovery keys are never requested or returned.' };
      }
      case 'secureBootStatus': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "try { [pscustomobject]@{Supported=$true;SecureBootEnabled=[bool](Confirm-SecureBootUEFI -ErrorAction Stop)} | ConvertTo-Json -Compress } catch { [pscustomobject]@{Supported=$false;Reason=$_.Exception.Message} | ConvertTo-Json -Compress }";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, result: JSON.parse(output.trim()), readOnly: true };
      }
      case 'systemSettings': {
        if (process.platform !== 'win32') return { success: false, status: 'unsupported-on-platform' };
        const command = "Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsBuildNumber,OsArchitecture,CsName,CsDomain,CsSystemType | ConvertTo-Json -Compress";
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { success: true, system: JSON.parse(output.trim()), readOnly: true };
      }
      case 'watchFiles': {
        const operation = typeof args.operation === 'string' ? args.operation : 'start';
        if (operation === 'stop' || operation === 'status') {
          if (typeof args.watchToken !== 'string' || !capabilityFileWatchers.has(args.watchToken)) return { success: false, error: 'Unknown watch token.' };
          const entry = capabilityFileWatchers.get(args.watchToken);
          if (operation === 'stop') { entry.watcher.close(); capabilityFileWatchers.delete(args.watchToken); return { success: true, stopped: true, path: entry.path }; }
          const events = entry.events.splice(0, 100);
          return { success: true, watchToken: args.watchToken, path: entry.path, events, queuedEvents: entry.events.length, active: true };
        }
        if (operation !== 'start') return { success: false, error: 'operation must be start, status, or stop.' };
        if (capabilityFileWatchers.size >= 20) return { success: false, error: 'At most 20 file watches may be active.' };
        const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Choose a folder for file-change monitoring' });
        if (selected.canceled || !selected.filePaths[0]) return { success: false, canceled: true };
        const folder = selected.filePaths[0];
        const approval = await dialog.showMessageBox(mainWindow, {
          type: 'warning', buttons: ['Start monitoring', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
          title: 'Monitor folder changes', message: 'Allow .my-ai to monitor changes in this folder?',
          detail: folder + '\nMonitoring is non-recursive. File names and change types may be recorded until you stop the watch or quit the app.',
        });
        if (approval.response !== 0) return { success: false, canceled: true };
        const watchToken = crypto.randomUUID();
        const entry = { path: folder, events: [], watcher: null };
        entry.watcher = fs.watch(folder, { persistent: false }, (eventType, filename) => {
          if (entry.events.length >= 500) entry.events.shift();
          entry.events.push({ eventType: String(eventType).slice(0, 40), name: filename == null ? null : String(filename).slice(0, 1024), at: new Date().toISOString() });
        });
        capabilityFileWatchers.set(watchToken, entry);
        return { success: true, watchToken, path: folder, recursive: false, active: true };
      }
      case 'printToPdf': {
        if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: 'The app window is not available.' };
        const selected = await dialog.showSaveDialog(mainWindow, {
          title: 'Export the current .my-ai window to PDF',
          defaultPath: typeof args.defaultPath === 'string' ? path.basename(args.defaultPath).replace(/\.pdf$/i, '') + '.pdf' : 'my-ai-export.pdf',
          filters: [{ name: 'PDF document', extensions: ['pdf'] }],
        });
        if (selected.canceled || !selected.filePath) return { success: false, canceled: true };
        const outputPath = selected.filePath.toLowerCase().endsWith('.pdf') ? selected.filePath : selected.filePath + '.pdf';
        const approval = await dialog.showMessageBox(mainWindow, {
          type: 'question', buttons: ['Export PDF', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
          title: 'Confirm PDF export', message: 'Export the current .my-ai window to PDF?',
          detail: 'The PDF will be written to: ' + outputPath,
        });
        if (approval.response !== 0) return { success: false, canceled: true };
        const pdf = await mainWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
        if (pdf.length > 50 * 1024 * 1024) return { success: false, error: 'Generated PDF exceeds the 50 MB limit.' };
        fs.writeFileSync(outputPath, pdf, { flag: 'wx' });
        return { success: true, path: outputPath, bytes: pdf.length, content: 'current-app-window' };
      }
      case 'manageStartup': {
        if (!['win32', 'darwin'].includes(process.platform)) return { success: false, status: 'unsupported-on-platform' };
        if (typeof args.enabled !== 'boolean') return { success: false, error: 'enabled must be a boolean.' };
        const approval = await dialog.showMessageBox(mainWindow, {
          type: 'question', buttons: [args.enabled ? 'Enable startup' : 'Disable startup', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
          title: 'Change startup setting',
          message: (args.enabled ? 'Start' : 'Do not start') + ' .my-ai when you sign in?',
          detail: 'This changes only .my-ai’s own login-item setting. It does not install a service or scheduled task.',
        });
        if (approval.response !== 0) return { success: false, canceled: true };
        app.setLoginItemSettings({ openAtLogin: args.enabled, openAsHidden: false });
        const actual = app.getLoginItemSettings();
        return { success: true, requested: args.enabled, openAtLogin: actual.openAtLogin, note: 'The OS or packaging format may affect whether this setting is honored.' };
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
