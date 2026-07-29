/**
 * Preload Script
 * This script runs in a privileged context and exposes safe APIs to the renderer
 * via contextBridge, maintaining security while enabling native functionality.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File System Operations
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  
  // System Information
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  
  // Process Management
  spawnProcess: (command, args, options) => 
    ipcRenderer.invoke('spawn-process', command, args, options),
  execCommand: (command, options) => 
    ipcRenderer.invoke('exec-command', command, options),
  
  // External Interactions
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  
  // Event Listeners
  onProcessOutput: (callback) => {
    ipcRenderer.on('process-output', (event, data) => callback(data));
  },
  removeProcessOutputListener: () => {
    ipcRenderer.removeAllListeners('process-output');
  },
  
  // Platform detection helper
  platform: process.platform,
});

console.log('Preload script loaded successfully');
