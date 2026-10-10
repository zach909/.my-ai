/**
 * Preload Script
 * This script runs in a privileged context and exposes safe APIs to the renderer
 * via contextBridge, maintaining security while enabling native functionality.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Bounded sensor tools run in the renderer's isolated preload context so
// media streams never cross the contextBridge. Only the captured result crosses.
async function captureCameraPhoto() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { success: false, status: 'unsupported', error: 'Camera capture is unavailable in this renderer.' };
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Camera did not become ready in time.')), 5000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('Could not initialize camera preview.')); };
    });
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth || 1280, 1920);
    canvas.height = Math.min(video.videoHeight || 720, 1080);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas capture is unavailable.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { success: true, mimeType: 'image/jpeg', dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height };
  } catch (error) {
    return { success: false, error: error && error.message ? error.message : String(error) };
  } finally {
    if (stream) stream.getTracks().forEach((track) => track.stop());
  }
}

async function recordMicrophone(args = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    return { success: false, status: 'unsupported', error: 'Microphone recording is unavailable in this renderer.' };
  }
  const seconds = Math.max(1, Math.min(10, Number.isFinite(args.seconds) ? Math.floor(args.seconds) : 5));
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
    const finished = new Promise((resolve, reject) => {
      recorder.onerror = () => reject(new Error('Microphone recording failed.'));
      recorder.onstop = resolve;
    });
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    recorder.stop();
    await finished;
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return { success: true, mimeType: blob.type || 'audio/webm', seconds, base64: btoa(binary) };
  } catch (error) {
    return { success: false, error: error && error.message ? error.message : String(error) };
  } finally {
    if (stream) stream.getTracks().forEach((track) => track.stop());
  }
}

function getCurrentLocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ success: false, status: 'unsupported', error: 'Geolocation is unavailable in this renderer.' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        success: true,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        timestamp: position.timestamp,
      }),
      (error) => resolve({ success: false, error: error.message, code: error.code }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

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
    camera: () => captureCameraPhoto(),
    microphone: (args = {}) => recordMicrophone(args),
    location: () => getCurrentLocation(),
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
