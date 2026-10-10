/**
 * Main Process Entry Point
 * This is the main entry point for the Electron application.
 * It handles native OS interactions, file system access, and process management.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, session, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, exec, execFileSync } = require('child_process');
const crypto = require('crypto');
const selfsigned = require('selfsigned');
const { startAppServer, DESKTOP_TOKEN_HEADER } = require('./app-server');

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
  const appSession = session.defaultSession;
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

  appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
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

// macOS privacy permissions. Electron can request only a subset directly;
// other protected categories must be approved by the user in System Settings.
const MACOS_PRIVACY_SETTINGS = {
  location: 'Privacy_LocationServices',
  contacts: 'Privacy_Contacts',
  calendars: 'Privacy_Calendars',
  reminders: 'Privacy_Reminders',
  photos: 'Privacy_Photos',
  camera: 'Privacy_Camera',
  microphone: 'Privacy_Microphone',
  speechRecognition: 'Privacy_SpeechRecognition',
  accessibility: 'Privacy_Accessibility',
  inputMonitoring: 'Privacy_ListenEvent',
  screenRecording: 'Privacy_ScreenCapture',
  fullDiskAccess: 'Privacy_AllFiles',
  automation: 'Privacy_Automation',
  bluetooth: 'Privacy_Bluetooth',
  localNetwork: 'Privacy_LocalNetwork',
};

function getMacOSPermissionStatus() {
  if (process.platform !== 'darwin') return { supported: false, platform: process.platform, permissions: {} };
  const permissions = {};
  for (const permission of ['camera', 'microphone', 'screen']) {
    try {
      permissions[permission] = systemPreferences && typeof systemPreferences.getMediaAccessStatus === 'function'
        ? systemPreferences.getMediaAccessStatus(permission) : 'unsupported';
    } catch (_) {
      permissions[permission] = 'unknown';
    }
  }
  for (const permission of Object.keys(MACOS_PRIVACY_SETTINGS)) {
    if (!(permission in permissions)) permissions[permission] = 'settings-required';
  }
  // Do not claim a TCC category is granted when Electron cannot query it.
  return { supported: true, platform: 'darwin', permissions };
}

ipcMain.handle('macos-permissions-status', async () => getMacOSPermissionStatus());

ipcMain.handle('macos-request-media-access', async (event, mediaType) => {
  if (process.platform !== 'darwin') return { success: false, status: 'unsupported', error: 'This request is only supported on macOS.' };
  if (!['camera', 'microphone'].includes(mediaType)) return { success: false, status: 'unsupported', error: 'Only camera and microphone access can be requested through this API.' };
  try {
    if (!systemPreferences || typeof systemPreferences.askForMediaAccess !== 'function') {
      return { success: false, status: 'unsupported', error: 'This Electron version does not expose the required permission API.' };
    }
    const granted = await systemPreferences.askForMediaAccess(mediaType);
    return { success: true, status: granted ? 'granted' : 'denied' };
  } catch (error) {
    return { success: false, status: 'error', error: error.message };
  }
});

ipcMain.handle('macos-open-privacy-settings', async (event, permission) => {
  if (process.platform !== 'darwin') return { success: false, error: 'System Privacy Settings links are only supported on macOS.' };
  const pane = MACOS_PRIVACY_SETTINGS[permission];
  if (!pane) return { success: false, error: 'Unknown privacy settings category.' };
  try {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?' + pane);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Comprehensive macOS permission/tool registry. This reports what Electron can verify,
// routes explicit user-approved requests, and opens System Settings for TCC grants.
// It never edits TCC databases or bypasses macOS consent.
const MACOS_PERMISSION_TOOL_CATALOG = {
  location: { label: 'Location Services', pane: 'Privacy_LocationServices', kind: 'settings' },
  contacts: { label: 'Contacts', pane: 'Privacy_Contacts', kind: 'settings' },
  calendars: { label: 'Calendars', pane: 'Privacy_Calendars', kind: 'settings' },
  reminders: { label: 'Reminders', pane: 'Privacy_Reminders', kind: 'settings' },
  photos: { label: 'Photos', pane: 'Privacy_Photos', kind: 'settings' },
  camera: { label: 'Camera', pane: 'Privacy_Camera', kind: 'media', media: 'camera' },
  microphone: { label: 'Microphone', pane: 'Privacy_Microphone', kind: 'media', media: 'microphone' },
  speechRecognition: { label: 'Speech Recognition', pane: 'Privacy_SpeechRecognition', kind: 'settings' },
  bluetooth: { label: 'Bluetooth', pane: 'Privacy_Bluetooth', kind: 'settings' },
  localNetwork: { label: 'Local Network', pane: 'Privacy_LocalNetwork', kind: 'settings' },
  automation: { label: 'Automation / Apple Events', pane: 'Privacy_Automation', kind: 'settings' },
  accessibility: { label: 'Accessibility', pane: 'Privacy_Accessibility', kind: 'settings' },
  inputMonitoring: { label: 'Input Monitoring', pane: 'Privacy_ListenEvent', kind: 'settings' },
  screenRecording: { label: 'Screen & System Audio Recording', pane: 'Privacy_ScreenCapture', kind: 'settings', statusMedia: 'screen' },
  fullDiskAccess: { label: 'Full Disk Access', pane: 'Privacy_AllFiles', kind: 'settings' },
  filesAndFolders: { label: 'Files and Folders', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  desktopFolder: { label: 'Desktop folder', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  documentsFolder: { label: 'Documents folder', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  downloadsFolder: { label: 'Downloads folder', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  networkVolumes: { label: 'Network volumes', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  removableVolumes: { label: 'Removable volumes', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  mediaAppleMusic: { label: 'Media & Apple Music', pane: 'Privacy_Media', kind: 'settings' },
  homeKit: { label: 'HomeKit', pane: 'Privacy_HomeKit', kind: 'settings' },
  focus: { label: 'Focus', pane: 'Privacy_Focus', kind: 'settings' },
  motionFitness: { label: 'Motion & Fitness', pane: 'Privacy_Motion', kind: 'settings' },
  developerTools: { label: 'Developer Tools', pane: 'Privacy_DeveloperTools', kind: 'settings' },
  remoteDesktop: { label: 'Remote Desktop', pane: 'Privacy_RemoteDesktop', kind: 'settings' },
  notifications: { label: 'Notifications', pane: null, kind: 'capability' },
  keychain: { label: 'Keychain', pane: null, kind: 'capability' },
  administrator: { label: 'Administrator authorization', pane: null, kind: 'capability' },
  appManagement: { label: 'App Management', pane: 'Privacy_AppManagement', kind: 'settings' },
  systemEvents: { label: 'System Events / Apple Events', pane: 'Privacy_Automation', kind: 'settings' },
  shortcuts: { label: 'Shortcuts', pane: 'Privacy_Automation', kind: 'settings' },
  voiceActivation: { label: 'Voice activation', pane: 'Privacy_Microphone', kind: 'media', media: 'microphone' },
  systemAudio: { label: 'System audio capture', pane: 'Privacy_ScreenCapture', kind: 'settings', statusMedia: 'screen' },
  fileSelection: { label: 'User-selected files', pane: null, kind: 'file-picker' },
  directorySelection: { label: 'User-selected folders', pane: null, kind: 'directory-picker' },
  cameraDevices: { label: 'Camera devices', pane: 'Privacy_Camera', kind: 'media', media: 'camera' },
  microphoneDevices: { label: 'Microphone devices', pane: 'Privacy_Microphone', kind: 'media', media: 'microphone' },
  locationWhenInUse: { label: 'Location while using the app', pane: 'Privacy_LocationServices', kind: 'settings' },
  calendarWrite: { label: 'Calendar read/write access', pane: 'Privacy_Calendars', kind: 'settings' },
  contactsWrite: { label: 'Contacts read/write access', pane: 'Privacy_Contacts', kind: 'settings' },
  photosAddOnly: { label: 'Add-only photo access', pane: 'Privacy_Photos', kind: 'settings' },
  networkClient: { label: 'Outgoing network connections', pane: null, kind: 'capability' },
  networkServer: { label: 'Incoming network connections', pane: null, kind: 'capability' },
  usbAccessories: { label: 'USB accessories', pane: null, kind: 'capability' },
  printing: { label: 'Printing', pane: null, kind: 'capability' },
  screenCapture: { label: 'Screen capture', pane: 'Privacy_ScreenCapture', kind: 'settings', statusMedia: 'screen' },
  audioInput: { label: 'Audio input', pane: 'Privacy_Microphone', kind: 'media', media: 'microphone' },
  audioOutput: { label: 'Audio output', pane: null, kind: 'capability' },
  biometricAuthentication: { label: 'Touch ID / biometric authentication', pane: null, kind: 'capability' },
  passwordAutoFill: { label: 'Password AutoFill', pane: null, kind: 'capability' },
  systemConfiguration: { label: 'System configuration changes', pane: null, kind: 'capability' },
  kernelExtensions: { label: 'System extensions', pane: null, kind: 'capability' },
  backgroundItems: { label: 'Background items / login items', pane: null, kind: 'capability' },
  accessibilityAutomation: { label: 'Accessibility-based app control', pane: 'Privacy_Accessibility', kind: 'settings' },
  // Apple-documented protected-resource services from the macOS TCC service list.
  appleEvents: { label: 'Apple Events', service: 'AppleEvents', pane: 'Privacy_Automation', kind: 'settings' },
  audioCapture: { label: 'System audio capture', service: 'AudioCapture', pane: 'Privacy_ScreenCapture', kind: 'settings', statusMedia: 'screen' },
  siri: { label: 'Siri', service: 'Siri', pane: null, kind: 'settings' },
  userTracking: { label: 'User tracking / advertising identifier', service: 'UserTracking', pane: null, kind: 'settings' },
  systemPolicyAppBundles: { label: 'Access and manage app bundles', service: 'SystemPolicyAppBundles', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  systemPolicyAppData: { label: 'Other apps’ protected container data', service: 'SystemPolicyAppData', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  systemPolicySysAdminFiles: { label: 'System administration files', service: 'SystemPolicySysAdminFiles', pane: 'Privacy_AllFiles', kind: 'settings' },
  virtualMachineNetworking: { label: 'Virtual machine networking', service: 'VirtualMachineNetworking', pane: null, kind: 'capability' },
  voiceBanking: { label: 'Personal Voice / voice banking', service: 'VoiceBanking', pane: null, kind: 'settings' },
  webBrowserPublicKeyCredential: { label: 'Browser passkeys / public-key credentials', service: 'WebBrowserPublicKeyCredential', pane: null, kind: 'capability' },
  postEvent: { label: 'Post synthetic system input events', service: 'PostEvent', pane: 'Privacy_Accessibility', kind: 'settings' },
  calendarWriteOnly: { label: 'Calendar write-only access', service: 'Calendar', pane: 'Privacy_Calendars', kind: 'settings' },
  calendarFullAccess: { label: 'Calendar full access', service: 'Calendar', pane: 'Privacy_Calendars', kind: 'settings' },
  remindersFullAccess: { label: 'Reminders full access', service: 'Reminders', pane: 'Privacy_Reminders', kind: 'settings' },
  appDataContainers: { label: 'Application data containers', service: 'SystemPolicyAppData', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  appBundleManagement: { label: 'Application bundle management', service: 'SystemPolicyAppBundles', pane: 'Privacy_AppManagement', kind: 'settings' },
  systemAdminFiles: { label: 'System administration files', service: 'SystemPolicySysAdminFiles', pane: 'Privacy_AllFiles', kind: 'settings' },
  userSelectedFiles: { label: 'User-selected file access', service: null, pane: null, kind: 'file-picker' },
  userSelectedFolders: { label: 'User-selected folder access', service: null, pane: null, kind: 'directory-picker' },
  // Remaining protected-resource services in Apple's documented macOS service list.
  energyKitGuidance: { label: 'EnergyKit energy-use guidance', service: 'EnergyKitGuidance', pane: null, kind: 'capability' },
  externalCameraMedia: { label: 'External camera media', service: 'ExternalCameraMedia', pane: 'Privacy_Camera', kind: 'settings', statusMedia: 'camera' },
  fileProviderDomain: { label: 'File Provider domains', service: 'FileProviderDomain', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  fileProviderPresence: { label: 'File Provider presence information', service: 'FileProviderPresence', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  focusStatus: { label: 'Focus status', service: 'FocusStatus', pane: 'Privacy_Focus', kind: 'settings' },
  gameCenterFriends: { label: 'Game Center friends list', service: 'GameCenterFriends', pane: null, kind: 'settings' },
  systemPolicyDeveloperFiles: { label: 'Protected developer files', service: 'SystemPolicyDeveloperFiles', pane: 'Privacy_DeveloperTools', kind: 'settings' },

  // Explicit one-tool-per-service aliases for Apple TCC service names.
  accessibilityService: { label: "Accessibility service", service: "Accessibility", pane: "Privacy_Accessibility", kind: "settings" },
  bluetoothAlways: { label: "Bluetooth Always authorization", service: "BluetoothAlways", pane: "Privacy_Bluetooth", kind: "settings" },
  calendarService: { label: "Calendar authorization service", service: "Calendar", pane: "Privacy_Calendars", kind: "settings" },
  cameraService: { label: "Camera authorization service", service: "Camera", pane: "Privacy_Camera", kind: "media", media: 'camera' },
  microphoneService: { label: "Microphone authorization service", service: "Microphone", pane: "Privacy_Microphone", kind: "media", media: 'microphone' },
  motionService: { label: "Motion data authorization service", service: "Motion", pane: "Privacy_Motion", kind: "settings" },
  photosService: { label: "Photos library authorization service", service: "Photos", pane: "Privacy_Photos", kind: "settings" },
  photosAddService: { label: "Photos add-only authorization service", service: "PhotosAdd", pane: "Privacy_Photos", kind: "settings" },
  remindersService: { label: "Reminders authorization service", service: "Reminders", pane: "Privacy_Reminders", kind: "settings" },
  remoteDesktopService: { label: "Remote Desktop authorization service", service: "RemoteDesktop", pane: "Privacy_RemoteDesktop", kind: "settings" },
  screenCaptureService: { label: "Screen capture authorization service", service: "ScreenCapture", pane: "Privacy_ScreenCapture", kind: "settings", statusMedia: 'screen' },
  speechRecognitionService: { label: "Speech recognition authorization service", service: "SpeechRecognition", pane: "Privacy_SpeechRecognition", kind: "settings" },
  homeKitService: { label: "HomeKit authorization service", service: "HomeKit", pane: "Privacy_HomeKit", kind: "settings" },
  fileProviderDomainService: { label: "File Provider domain authorization service", service: "FileProviderDomain", pane: "Privacy_FilesAndFolders", kind: "settings" },
  fileProviderPresenceService: { label: "File Provider presence authorization service", service: "FileProviderPresence", pane: "Privacy_FilesAndFolders", kind: "settings" },
  focusStatusService: { label: "Focus status authorization service", service: "FocusStatus", pane: "Privacy_Focus", kind: "settings" },
  gameCenterFriendsService: { label: "Game Center friends authorization service", service: "GameCenterFriends", pane: null, kind: "settings" },
  systemPolicyAppBundlesService: { label: "App bundle protected-resource service", service: "SystemPolicyAppBundles", pane: "Privacy_FilesAndFolders", kind: "settings" },
  systemPolicyAppDataService: { label: "App data protected-resource service", service: "SystemPolicyAppData", pane: "Privacy_FilesAndFolders", kind: "settings" },
  systemPolicySysAdminFilesService: { label: "System administration protected-resource service", service: "SystemPolicySysAdminFiles", pane: "Privacy_AllFiles", kind: "settings" },
  userTrackingService: { label: "User tracking authorization service", service: "UserTracking", pane: null, kind: "settings" },
  appleEventsService: { label: "Apple Events automation authorization service", service: "AppleEvents", pane: "Privacy_Automation", kind: "settings" },
  audioCaptureService: { label: "System audio capture authorization service", service: "AudioCapture", pane: "Privacy_ScreenCapture", kind: "settings", statusMedia: 'screen' },
  postEventService: { label: "Synthetic input event authorization service", service: "PostEvent", pane: "Privacy_Accessibility", kind: "settings" },
  developerToolService: { label: "Developer Tool authorization service", service: "DeveloperTool", pane: "Privacy_DeveloperTools", kind: "settings" },
  listenEventService: { label: "Input Monitoring authorization service", service: "ListenEvent", pane: "Privacy_ListenEvent", kind: "settings" },
  mediaLibraryService: { label: "Media library authorization service", service: "MediaLibrary", pane: "Privacy_Media", kind: "settings" },
  systemPolicyDesktopFolderService: { label: "Desktop folder protected-resource service", service: "SystemPolicyDesktopFolder", pane: "Privacy_FilesAndFolders", kind: "settings" },
  systemPolicyDocumentsFolderService: { label: "Documents folder protected-resource service", service: "SystemPolicyDocumentsFolder", pane: "Privacy_FilesAndFolders", kind: "settings" },
  systemPolicyDownloadsFolderService: { label: "Downloads folder protected-resource service", service: "SystemPolicyDownloadsFolder", pane: "Privacy_FilesAndFolders", kind: "settings" },
  systemPolicyNetworkVolumesService: { label: "Network volume protected-resource service", service: "SystemPolicyNetworkVolumes", pane: "Privacy_FilesAndFolders", kind: "settings" },
  systemPolicyRemovableVolumesService: { label: "Removable volume protected-resource service", service: "SystemPolicyRemovableVolumes", pane: "Privacy_FilesAndFolders", kind: "settings" },
  systemPolicyAllFilesService: { label: "Full Disk Access protected-resource service", service: "SystemPolicyAllFiles", pane: "Privacy_AllFiles", kind: "settings" },
  systemPolicyDeveloperFilesService: { label: "Developer files protected-resource service", service: "SystemPolicyDeveloperFiles", pane: "Privacy_DeveloperTools", kind: "settings" },
  virtualMachineNetworkingService: { label: "Virtual machine networking service", service: "VirtualMachineNetworking", pane: null, kind: "capability" },
  voiceBankingService: { label: "Personal Voice / voice banking service", service: "VoiceBanking", pane: null, kind: "settings" },
  webBrowserPublicKeyCredentialService: { label: "Browser public-key credential service", service: "WebBrowserPublicKeyCredential", pane: null, kind: "capability" },
  energyKitGuidanceService: { label: "EnergyKit guidance service", service: "EnergyKitGuidance", pane: null, kind: "capability" },
  externalCameraMediaService: { label: "External camera media service", service: "ExternalCameraMedia", pane: "Privacy_Camera", kind: "settings", statusMedia: 'camera' },

  mainCamera: { label: 'Main camera access', pane: 'Privacy_Camera', kind: 'media', media: 'camera' },
  // Additional macOS capabilities that require entitlements, app-specific APIs, or separate OS approval.
  systemExtensionApproval: { label: "System extension installation and approval", service: "SystemExtension", pane: "Privacy_Security", kind: "capability" },
  driverExtensionApproval: { label: "Driver extension installation and approval", service: "DriverExtension", pane: "Privacy_Security", kind: "capability" },
  networkExtensionConfiguration: { label: "Network Extension configuration", service: "NetworkExtension", pane: null, kind: "capability" },
  endpointSecurityClient: { label: "Endpoint Security client entitlement", service: "EndpointSecurity", pane: null, kind: "capability" },
  sandboxEntitlements: { label: "App Sandbox entitlements", service: "AppSandbox", pane: null, kind: "capability" },
  loginItemManagement: { label: "Login item and background task management", service: "BackgroundItems", pane: null, kind: "capability" },
  notificationAuthorization: { label: "Notification authorization", service: "Notifications", pane: null, kind: "capability" },
  keychainItemAccess: { label: "Keychain item access groups", service: "Keychain", pane: null, kind: "capability" },
  privilegedHelperAuthorization: { label: "Privileged helper tool installation", service: "PrivilegedHelper", pane: null, kind: "capability" },
  virtualizationFramework: { label: "Virtualization framework entitlement", service: "Virtualization", pane: null, kind: "capability" },
  networkClientEntitlement: { label: "Outbound network client entitlement", service: "NetworkClient", pane: null, kind: "capability" },
  networkServerEntitlement: { label: "Inbound network server entitlement", service: "NetworkServer", pane: null, kind: "capability" },

  // Exact service-name aliases from Apple's published protected-resource reset list.
  addressBook: { label: 'Contacts (AddressBook service)', service: 'AddressBook', pane: 'Privacy_Contacts', kind: 'settings' },
  developerTool: { label: 'Developer Tool execution', service: 'DeveloperTool', pane: 'Privacy_DeveloperTools', kind: 'settings' },
  listenEvent: { label: 'Input Monitoring (ListenEvent service)', service: 'ListenEvent', pane: 'Privacy_ListenEvent', kind: 'settings' },
  mediaLibrary: { label: 'Apple Music media library', service: 'MediaLibrary', pane: 'Privacy_Media', kind: 'settings' },
  systemPolicyAllFiles: { label: 'Full Disk Access (SystemPolicyAllFiles service)', service: 'SystemPolicyAllFiles', pane: 'Privacy_AllFiles', kind: 'settings' },
  systemPolicyDesktopFolder: { label: 'Desktop folder protected access', service: 'SystemPolicyDesktopFolder', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  systemPolicyDocumentsFolder: { label: 'Documents folder protected access', service: 'SystemPolicyDocumentsFolder', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  systemPolicyDownloadsFolder: { label: 'Downloads folder protected access', service: 'SystemPolicyDownloadsFolder', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  systemPolicyNetworkVolumes: { label: 'Network volumes protected access', service: 'SystemPolicyNetworkVolumes', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
  systemPolicyRemovableVolumes: { label: 'Removable volumes protected access', service: 'SystemPolicyRemovableVolumes', pane: 'Privacy_FilesAndFolders', kind: 'settings' },
};

function getMacOSPermissionToolStatus(permission) {
  const item = MACOS_PERMISSION_TOOL_CATALOG[permission];
  if (!item) return { success: false, status: 'unknown-permission', error: 'Unknown permission tool.' };
  if (process.platform !== 'darwin') return { success: true, supported: false, status: 'unsupported-platform', permission, label: item.label };
  const statusMedia = item.statusMedia || item.media;
  if (statusMedia && systemPreferences && typeof systemPreferences.getMediaAccessStatus === 'function') {
    try { return { success: true, supported: true, permission, label: item.label, status: systemPreferences.getMediaAccessStatus(statusMedia) }; }
    catch (error) { return { success: true, supported: true, permission, label: item.label, status: 'unknown', detail: error.message }; }
  }
  return { success: true, supported: true, permission, label: item.label, status: item.kind === 'capability' ? 'capability-check-required' : 'user-approval-or-feature-check-required', canOpenSettings: Boolean(item.pane) };
}

async function runMacOSPermissionTool(permission, action, options = {}) {
  const item = MACOS_PERMISSION_TOOL_CATALOG[permission];
  if (!item) return { success: false, status: 'unknown-permission', error: 'Unknown permission tool.' };
  if (process.platform !== 'darwin') return { success: false, status: 'unsupported-platform', error: 'This tool is macOS-specific.' };
  if (action === 'status') return getMacOSPermissionToolStatus(permission);
  if (action === 'open-settings') {
    if (!item.pane) return { success: false, status: 'manual-or-feature-specific', error: 'This capability has no dedicated macOS Privacy & Security pane. Use its feature-specific API or system authorization flow.' };
    try {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?' + item.pane);
      return { success: true, status: 'settings-opened', permission, label: item.label, nextStep: 'Review the app permission in System Settings. macOS may require restarting the app.' };
    } catch (error) { return { success: false, status: 'error', error: error.message }; }
  }
  if (action === 'request') {
    if (item.media && systemPreferences && typeof systemPreferences.askForMediaAccess === 'function') {
      try {
        const granted = await systemPreferences.askForMediaAccess(item.media);
        return { success: true, status: granted ? 'granted' : 'denied', permission, label: item.label };
      } catch (error) { return { success: false, status: 'error', error: error.message }; }
    }
    return { success: false, status: 'user-action-required', permission, label: item.label, message: item.pane ? 'macOS does not expose a general programmatic request for this permission. Open System Settings and approve it there.' : 'This is not a single TCC permission. Use the specific feature API and its native authorization flow.' };
  }
  if (action === 'select-file' && (item.kind === 'file-picker' || permission === 'filesAndFolders')) {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title: options.title || 'Choose a file', filters: Array.isArray(options.filters) ? options.filters : [] });
    return { success: !result.canceled, status: result.canceled ? 'cancelled' : 'selected', paths: result.filePaths };
  }
  if (action === 'select-directory' && (item.kind === 'directory-picker' || permission === 'filesAndFolders')) {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: options.title || 'Choose a folder' });
    return { success: !result.canceled, status: result.canceled ? 'cancelled' : 'selected', paths: result.filePaths };
  }
  return { success: false, status: 'unsupported-action', error: 'Supported actions are status, request, open-settings, select-file, and select-directory.' };
}

ipcMain.handle('macos-permission-tool', async (_event, permission, action, options) => {
  try { return await runMacOSPermissionTool(permission, action, options || {}); }
  catch (error) { return { success: false, status: 'error', error: error.message }; }
});

ipcMain.handle('macos-permission-tools-list', async () => ({
  platform: process.platform,
  tools: Object.entries(MACOS_PERMISSION_TOOL_CATALOG).map(([id, item]) => ({ id, label: item.label, actions: ['status', 'request', 'open-settings', ...(item.kind === 'file-picker' ? ['select-file'] : []), ...(item.kind === 'directory-picker' ? ['select-directory'] : [])], requestMethod: item.kind === 'media' ? 'native-request' : item.pane ? 'user-approved-settings' : 'feature-specific' })),
}));

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
