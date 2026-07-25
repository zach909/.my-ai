/**
 * Main Process Entry Point
 * This is the main entry point for the Electron application.
 * It handles native OS interactions, file system access, and process management.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

/**
 * Create the main application window
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

  // Load the renderer HTML
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools in development (optional)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Application lifecycle events
 */
app.whenReady().then(() => {
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

ipcMain.handle('select-file', async (options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: options.filters || [],
    title: options.title || 'Select File',
  });
  return result;
});

ipcMain.handle('read-file', async (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('write-file', async (filePath, content) => {
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
ipcMain.handle('spawn-process', async (command, args = [], options = {}) => {
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

ipcMain.handle('exec-command', async (command, options = {}) => {
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

// Open external URLs in default browser
ipcMain.handle('open-external', async (url) => {
  await shell.openExternal(url);
  return { success: true };
});

// Show item in file manager
ipcMain.handle('show-in-folder', async (filePath) => {
  shell.showItemInFolder(filePath);
  return { success: true };
});

console.log('Desktop App initialized successfully!');
console.log(`Platform: ${process.platform}`);
console.log(`Architecture: ${process.arch}`);
