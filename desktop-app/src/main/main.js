/**
 * Main Process Entry Point
 * This is the main entry point for the Electron application.
 * It handles native OS interactions, file system access, and process management.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, exec, execFileSync } = require('child_process');
const { startAppServer } = require('./app-server');

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
function createWindow() {
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
    mainWindow.loadURL(`http://127.0.0.1:${APP_PORT}`);
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

  appServer = await startAppServer({
    distDir: path.join(REPO_ROOT, 'dist'),
    backendPort: BACKEND_PORT,
    port: APP_PORT,
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
app.whenReady().then(async () => {
  if (!SKIP_BACKEND) {
    try {
      await startNeuroclaw();
    } catch (error) {
      console.error('[desktop-app] failed to start Neuroclaw:', error);
    }
  }
  createWindow();

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
