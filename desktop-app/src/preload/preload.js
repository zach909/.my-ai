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

    readFileMetadata: (args = {}) => ipcRenderer.invoke('windows-tools:run', "readFileMetadata", args),
    createFile: (args = {}) => ipcRenderer.invoke('windows-tools:run', "createFile", args),
    updateFile: (args = {}) => ipcRenderer.invoke('windows-tools:run', "updateFile", args),
    moveFile: (args = {}) => ipcRenderer.invoke('windows-tools:run', "moveFile", args),
    renameFile: (args = {}) => ipcRenderer.invoke('windows-tools:run', "renameFile", args),
    deleteFile: (args = {}) => ipcRenderer.invoke('windows-tools:run', "deleteFile", args),
    watchFiles: (args = {}) => ipcRenderer.invoke('windows-tools:run', "watchFiles", args),
    fileAssociations: (args = {}) => ipcRenderer.invoke('windows-tools:run', "fileAssociations", args),
    dragAndDrop: (args = {}) => ipcRenderer.invoke('windows-tools:run', "dragAndDrop", args),
    onedriveFiles: (args = {}) => ipcRenderer.invoke('windows-tools:run', "onedriveFiles", args),
    appData: (args = {}) => ipcRenderer.invoke('windows-tools:run', "appData", args),
    encryptedMemory: (args = {}) => ipcRenderer.invoke('windows-tools:run', "encryptedMemory", args),
    scannerDevices: (args = {}) => ipcRenderer.invoke('windows-tools:run', "scannerDevices", args),
    nfcProximity: (args = {}) => ipcRenderer.invoke('windows-tools:run', "nfcProximity", args),
    deviceMetadata: (args = {}) => ipcRenderer.invoke('windows-tools:run', "deviceMetadata", args),
    deviceNotifications: (args = {}) => ipcRenderer.invoke('windows-tools:run', "deviceNotifications", args),
    ethernetStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "ethernetStatus", args),
    networkDiscovery: (args = {}) => ipcRenderer.invoke('windows-tools:run', "networkDiscovery", args),
    dnsConfiguration: (args = {}) => ipcRenderer.invoke('windows-tools:run', "dnsConfiguration", args),
    proxyConfiguration: (args = {}) => ipcRenderer.invoke('windows-tools:run', "proxyConfiguration", args),
    vpnStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "vpnStatus", args),
    vpnConfiguration: (args = {}) => ipcRenderer.invoke('windows-tools:run', "vpnConfiguration", args),
    networkMonitor: (args = {}) => ipcRenderer.invoke('windows-tools:run', "networkMonitor", args),
    networkPortStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "networkPortStatus", args),
    appInstallInventory: (args = {}) => ipcRenderer.invoke('windows-tools:run', "appInstallInventory", args),
    appLaunch: (args = {}) => ipcRenderer.invoke('windows-tools:run', "appLaunch", args),
    appFocus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "appFocus", args),
    appWindowList: (args = {}) => ipcRenderer.invoke('windows-tools:run', "appWindowList", args),
    appWindowControl: (args = {}) => ipcRenderer.invoke('windows-tools:run', "appWindowControl", args),
    screenMetadata: (args = {}) => ipcRenderer.invoke('windows-tools:run', "screenMetadata", args),
    screenRecording: (args = {}) => ipcRenderer.invoke('windows-tools:run', "screenRecording", args),
    ocrScreen: (args = {}) => ipcRenderer.invoke('windows-tools:run', "ocrScreen", args),
    microphoneDevices: (args = {}) => ipcRenderer.invoke('windows-tools:run', "microphoneDevices", args),
    speakerDevices: (args = {}) => ipcRenderer.invoke('windows-tools:run', "speakerDevices", args),
    audioPlayback: (args = {}) => ipcRenderer.invoke('windows-tools:run', "audioPlayback", args),
    audioRecording: (args = {}) => ipcRenderer.invoke('windows-tools:run', "audioRecording", args),
    hotkeys: (args = {}) => ipcRenderer.invoke('windows-tools:run', "hotkeys", args),
    speechSynthesis: (args = {}) => ipcRenderer.invoke('windows-tools:run', "speechSynthesis", args),
    notificationActions: (args = {}) => ipcRenderer.invoke('windows-tools:run', "notificationActions", args),
    locationSettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', "locationSettings", args),
    privacySettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', "privacySettings", args),
    windowsUpdateStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsUpdateStatus", args),
    defenderStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "defenderStatus", args),
    deviceEncryptionStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "deviceEncryptionStatus", args),
    secureBootStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "secureBootStatus", args),
    firewallProfiles: (args = {}) => ipcRenderer.invoke('windows-tools:run', "firewallProfiles", args),
    eventLogQuery: (args = {}) => ipcRenderer.invoke('windows-tools:run', "eventLogQuery", args),
    crashReports: (args = {}) => ipcRenderer.invoke('windows-tools:run', "crashReports", args),
    performanceMetrics: (args = {}) => ipcRenderer.invoke('windows-tools:run', "performanceMetrics", args),
    diskSpace: (args = {}) => ipcRenderer.invoke('windows-tools:run', "diskSpace", args),
    batteryStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "batteryStatus", args),
    sleepSettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', "sleepSettings", args),
    startupPrograms: (args = {}) => ipcRenderer.invoke('windows-tools:run', "startupPrograms", args),
    manageStartup: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manageStartup", args),
    scheduledTaskList: (args = {}) => ipcRenderer.invoke('windows-tools:run', "scheduledTaskList", args),
    serviceInventory: (args = {}) => ipcRenderer.invoke('windows-tools:run', "serviceInventory", args),
    serviceControl: (args = {}) => ipcRenderer.invoke('windows-tools:run', "serviceControl", args),
    registryInspect: (args = {}) => ipcRenderer.invoke('windows-tools:run', "registryInspect", args),
    registryModify: (args = {}) => ipcRenderer.invoke('windows-tools:run', "registryModify", args),
    environmentRead: (args = {}) => ipcRenderer.invoke('windows-tools:run', "environmentRead", args),
    environmentModify: (args = {}) => ipcRenderer.invoke('windows-tools:run', "environmentModify", args),
    gitRepositories: (args = {}) => ipcRenderer.invoke('windows-tools:run', "gitRepositories", args),
    terminalCommands: (args = {}) => ipcRenderer.invoke('windows-tools:run', "terminalCommands", args),
    compilerTools: (args = {}) => ipcRenderer.invoke('windows-tools:run', "compilerTools", args),
    taskManager: (args = {}) => ipcRenderer.invoke('windows-tools:run', "taskManager", args),
    processMetrics: (args = {}) => ipcRenderer.invoke('windows-tools:run', "processMetrics", args),
    processMonitor: (args = {}) => ipcRenderer.invoke('windows-tools:run', "processMonitor", args),
    processTerminate: (args = {}) => ipcRenderer.invoke('windows-tools:run', "processTerminate", args),
    credentialManager: (args = {}) => ipcRenderer.invoke('windows-tools:run', "credentialManager", args),
    signInProviders: (args = {}) => ipcRenderer.invoke('windows-tools:run', "signInProviders", args),
    userAccountMetadata: (args = {}) => ipcRenderer.invoke('windows-tools:run', "userAccountMetadata", args),
    accessibilitySettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', "accessibilitySettings", args),
    accessibilityActions: (args = {}) => ipcRenderer.invoke('windows-tools:run', "accessibilityActions", args),
    inputDeviceStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "inputDeviceStatus", args),
    clipboardImageRead: (args = {}) => ipcRenderer.invoke('windows-tools:run', "clipboardImageRead", args),
    clipboardClear: (args = {}) => ipcRenderer.invoke('windows-tools:run', "clipboardClear", args),
    printToPdf: (args = {}) => ipcRenderer.invoke('windows-tools:run', "printToPdf", args),
    defaultApps: (args = {}) => ipcRenderer.invoke('windows-tools:run', "defaultApps", args),
    appPermissions: (args = {}) => ipcRenderer.invoke('windows-tools:run', "appPermissions", args),
    timeZoneSettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', "timeZoneSettings", args),
    localeSettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', "localeSettings", args),
    systemSoundSettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', "systemSoundSettings", args),
    cameraDevices: (args = {}) => ipcRenderer.invoke('windows-tools:run', "cameraDevices", args),
    devicePowerStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "devicePowerStatus", args),
    windowsCapabilityState: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsCapabilityState", args),
    permissionAuditLog: (args = {}) => ipcRenderer.invoke('windows-tools:run', "permissionAuditLog", args),
    permissionControls: (args = {}) => ipcRenderer.invoke('windows-tools:run', "permissionControls", args),
    consentHistory: (args = {}) => ipcRenderer.invoke('windows-tools:run', "consentHistory", args),
    revokeAppConsent: (args = {}) => ipcRenderer.invoke('windows-tools:run', "revokeAppConsent", args),
    dataExport: (args = {}) => ipcRenderer.invoke('windows-tools:run', "dataExport", args),
    dataDelete: (args = {}) => ipcRenderer.invoke('windows-tools:run', "dataDelete", args),
    backupRestore: (args = {}) => ipcRenderer.invoke('windows-tools:run', "backupRestore", args),
    windowsAppCapabilities: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsAppCapabilities", args),
    manifestInternetClient: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestInternetClient", args),
    manifestInternetClientServer: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestInternetClientServer", args),
    manifestPrivateNetwork: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestPrivateNetwork", args),
    manifestBroadFileSystem: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestBroadFileSystem", args),
    manifestAppointments: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestAppointments", args),
    manifestContacts: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestContacts", args),
    manifestUserAccountInfo: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestUserAccountInfo", args),
    manifestVoipCall: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestVoipCall", args),
    manifestChat: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestChat", args),
    manifestBlockedChatMessages: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestBlockedChatMessages", args),
    manifestPhoneCall: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestPhoneCall", args),
    manifestPhoneCallHistory: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestPhoneCallHistory", args),
    manifestObjects3D: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestObjects3D", args),
    manifestMusicLibrary: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestMusicLibrary", args),
    manifestPicturesLibrary: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestPicturesLibrary", args),
    manifestVideosLibrary: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestVideosLibrary", args),
    manifestRemovableStorage: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestRemovableStorage", args),
    manifestDocumentsLibrary: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestDocumentsLibrary", args),
    manifestBackgroundMedia: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestBackgroundMedia", args),
    manifestRemoteSystem: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestRemoteSystem", args),
    manifestAllJoyn: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestAllJoyn", args),
    manifestSystemManagement: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestSystemManagement", args),
    manifestPackageQuery: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestPackageQuery", args),
    manifestPackageManagement: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestPackageManagement", args),
    manifestScreenDuplication: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestScreenDuplication", args),
    manifestAppCaptureSettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestAppCaptureSettings", args),
    manifestWalletSystem: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestWalletSystem", args),
    manifestRunFullTrust: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestRunFullTrust", args),
    manifestAppDiagnostics: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestAppDiagnostics", args),
    manifestNfc: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestNfc", args),
    manifestBluetooth: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestBluetooth", args),
    manifestWebcam: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestWebcam", args),
    manifestMicrophone: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestMicrophone", args),
    manifestLocation: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestLocation", args),
    manifestHumanInterface: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestHumanInterface", args),
    manifestSerialCommunication: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestSerialCommunication", args),
    manifestUsb: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestUsb", args),
    manifestGpio: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestGpio", args),
    manifestI2c: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestI2c", args),
    manifestSpi: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestSpi", args),
    manifestPointOfService: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestPointOfService", args),
    manifestLowLevelDevices: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestLowLevelDevices", args),
    manifestSpatialPerception: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestSpatialPerception", args),
    manifestBackgroundTasks: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestBackgroundTasks", args),
    manifestExpandedResources: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestExpandedResources", args),
    manifestSmbios: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestSmbios", args),
    manifestEnterpriseAuthentication: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestEnterpriseAuthentication", args),
    manifestSharedUserCertificates: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestSharedUserCertificates", args),
    manifestCredentialManager: (args = {}) => ipcRenderer.invoke('windows-tools:run', "manifestCredentialManager", args),
    windowsSecurityContext: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsSecurityContext", args),
    fileAccessControl: (args = {}) => ipcRenderer.invoke('windows-tools:run', "fileAccessControl", args),
    windowsPermissionSettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsPermissionSettings", args),
    networkProfileStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "networkProfileStatus", args),
    windowsPolicyStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsPolicyStatus", args),
    windowsUpdateSettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsUpdateSettings", args),
    windowsSecuritySettings: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsSecuritySettings", args),
    uacStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "uacStatus", args),
    uacElevationRequest: (args = {}) => ipcRenderer.invoke('windows-tools:run', "uacElevationRequest", args),
    aclPermissionCheck: (args = {}) => ipcRenderer.invoke('windows-tools:run', "aclPermissionCheck", args),
    registryPermissionCheck: (args = {}) => ipcRenderer.invoke('windows-tools:run', "registryPermissionCheck", args),
    windowsCapabilityManifest: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsCapabilityManifest", args),
    windowsTokenPrivileges: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsTokenPrivileges", args),
    windowsFirewallStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsFirewallStatus", args),
    windowsDefenderStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsDefenderStatus", args),
    windowsServiceStatus: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsServiceStatus", args),
    windowsServiceSecurityDescriptor: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsServiceSecurityDescriptor", args),
    windowsAccountPolicy: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsAccountPolicy", args),
    windowsNetworkShares: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsNetworkShares", args),
    windowsPowerShellExecutionPolicy: (args = {}) => ipcRenderer.invoke('windows-tools:run', "windowsPowerShellExecutionPolicy", args),
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
