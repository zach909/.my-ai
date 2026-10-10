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
  
  // Individual Windows capability tools. Each named method maps to one
  // capability ID; native operations still validate arguments and consent in
  // the main process.
  windowsTools: {
    list: () => ipcRenderer.invoke('windows-tools:list'),
    status: (id) => ipcRenderer.invoke('windows-tools:status', id),
    camera: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'camera', args),
    microphone: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'microphone', args),
    location: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'location', args),
    voiceActivation: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'voiceActivation', args),
    speechRecognition: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'speechRecognition', args),
    notifications: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'notifications', args),
    screenCapture: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'screenCapture', args),
    systemAudioCapture: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'systemAudioCapture', args),
    accessibility: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'accessibility', args),
    inputMonitoring: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'inputMonitoring', args),
    keyboardAutomation: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'keyboardAutomation', args),
    pointerAutomation: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'pointerAutomation', args),
    clipboardRead: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'clipboardRead', args),
    clipboardWrite: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'clipboardWrite', args),
    selectFile: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'selectFile', args),
    selectDirectory: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'selectDirectory', args),
    readSelectedFile: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'readSelectedFile', args),
    writeSelectedFile: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'writeSelectedFile', args),
    documents: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'documents', args),
    desktop: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'desktop', args),
    downloads: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'downloads', args),
    pictures: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'pictures', args),
    videos: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'videos', args),
    music: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'music', args),
    removableDrives: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'removableDrives', args),
    networkShares: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'networkShares', args),
    broadFilesystem: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'broadFilesystem', args),
    fileSearch: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'fileSearch', args),
    archiveFiles: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'archiveFiles', args),
    automaticDownloads: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'automaticDownloads', args),
    accountInfo: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'accountInfo', args),
    contacts: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'contacts', args),
    calendar: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'calendar', args),
    tasks: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'tasks', args),
    email: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'email', args),
    messaging: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'messaging', args),
    phoneCalls: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'phoneCalls', args),
    callHistory: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'callHistory', args),
    browserData: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'browserData', args),
    passwordManagers: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'passwordManagers', args),
    mediaLibrary: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'mediaLibrary', args),
    wifiStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'wifiStatus', args),
    wifiConfiguration: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'wifiConfiguration', args),
    networkInterfaces: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'networkInterfaces', args),
    bluetooth: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'bluetooth', args),
    unpairedDevices: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'unpairedDevices', args),
    usbDevices: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'usbDevices', args),
    printers: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'printers', args),
    printDocument: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'printDocument', args),
    audioDevices: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'audioDevices', args),
    displays: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'displays', args),
    localNetwork: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'localNetwork', args),
    systemInfo: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'systemInfo', args),
    installedApps: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'installedApps', args),
    processList: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'processList', args),
    launchProcess: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'launchProcess', args),
    stopOwnedProcess: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'stopOwnedProcess', args),
    appDiagnostics: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'appDiagnostics', args),
    startupSettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'startupSettings', args),
    backgroundOperation: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'backgroundOperation', args),
    scheduledTasks: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'scheduledTasks', args),
    windowsServices: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'windowsServices', args),
    powerBattery: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'powerBattery', args),
    registryRead: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'registryRead', args),
    registryWrite: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'registryWrite', args),
    environmentInfo: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'environmentInfo', args),
    developerTools: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'developerTools', args),
    firewallStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'firewallStatus', args),
    firewallChanges: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'firewallChanges', args),
    securityStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'securityStatus', args),
    eventLogs: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'eventLogs', args),
    uiAutomation: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'uiAutomation', args),
    openUrl: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'openUrl', args),
    openPath: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'openPath', args),
    systemSettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'systemSettings', args),
    adminOperation: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'adminOperation', args),
  },

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
