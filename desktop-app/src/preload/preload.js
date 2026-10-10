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



async function recordScreenClip(args = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || typeof MediaRecorder === 'undefined') {
    return { success: false, status: 'unsupported', error: 'Screen recording is unavailable in this runtime.' };
  }
  const requested = Number(args.durationMs);
  const durationMs = Number.isFinite(requested) ? Math.max(1000, Math.min(15000, requested)) : 5000;
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return { success: false, status: 'no-video-track' };
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type)) || '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const completed = new Promise((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onerror = event => reject(new Error(event.error && event.error.message || 'Screen recording failed.'));
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
          if (blob.size > 15 * 1024 * 1024) return resolve({ success: false, status: 'size-limit', error: 'Screen clip exceeded 15 MB.' });
          const dataUrl = await new Promise((resolveData, rejectData) => {
            const reader = new FileReader();
            reader.onload = () => resolveData(reader.result);
            reader.onerror = () => rejectData(new Error('Could not encode screen clip.'));
            reader.readAsDataURL(blob);
          });
          resolve({ success: true, mimeType: blob.type || 'video/webm', dataUrl, durationMs, sourcePickerShown: true });
        } catch (error) { reject(error); }
      };
    });
    recorder.start();
    await new Promise(resolve => setTimeout(resolve, durationMs));
    if (recorder.state !== 'inactive') recorder.stop();
    return await completed;
  } catch (error) {
    return { success: false, status: 'capture-failed-or-canceled', error: String(error && error.message || error).slice(0, 500) };
  } finally {
    if (stream) stream.getTracks().forEach(track => track.stop());
  }
}

function synthesizeSpeech(args = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    return { success: false, status: 'unsupported', error: 'Speech synthesis is unavailable in this runtime.' };
  }
  const text = typeof args.text === 'string' ? args.text.trim() : '';
  if (!text || text.length > 5000) return { success: false, error: 'Provide text containing 1–5000 characters.' };
  const utterance = new SpeechSynthesisUtterance(text);
  if (typeof args.language === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(args.language)) utterance.lang = args.language;
  if (Number.isFinite(Number(args.rate))) utterance.rate = Math.max(0.5, Math.min(2, Number(args.rate)));
  if (Number.isFinite(Number(args.pitch))) utterance.pitch = Math.max(0, Math.min(2, Number(args.pitch)));
  return new Promise(resolve => {
    utterance.onend = () => resolve({ success: true, spokenCharacters: text.length, language: utterance.lang, localRuntimeSpeech: true });
    utterance.onerror = event => resolve({ success: false, status: event.error || 'speech-error', error: 'Speech synthesis failed.' });
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance); }
    catch (error) { resolve({ success: false, error: String(error && error.message || error).slice(0, 300) }); }
  });
}

async function playLocalAudio(args = {}) {
  if (typeof Audio === 'undefined') return { success: false, status: 'unsupported' };
  const source = typeof args.dataUrl === 'string' ? args.dataUrl : '';
  if (!/^data:audio\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+$/.test(source) || source.length > 14 * 1024 * 1024) {
    return { success: false, error: 'Only a base64 audio data URL of at most 10 MB is accepted; remote URLs are not supported.' };
  }
  return new Promise(resolve => {
    const audio = new Audio(source);
    const timer = setTimeout(() => { audio.pause(); resolve({ success: false, status: 'timeout', error: 'Audio playback exceeded 30 seconds.' }); }, 30000);
    audio.onended = () => { clearTimeout(timer); resolve({ success: true, played: true }); };
    audio.onerror = () => { clearTimeout(timer); resolve({ success: false, status: 'playback-error', error: 'Audio could not be played.' }); };
    audio.play().catch(error => { clearTimeout(timer); resolve({ success: false, status: 'playback-blocked', error: String(error && error.message || error).slice(0, 300) }); });
  });
}

function runSpeechRecognition(args = {}, wakeMode = false) {
  const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!Recognition) return Promise.resolve({ success: false, status: 'unsupported', error: 'SpeechRecognition is not available in this Electron runtime. No background listener was started.' });
  const language = typeof args.language === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(args.language) ? args.language : 'en-US';
  const wakeWord = typeof args.wakeWord === 'string' && args.wakeWord.trim() ? args.wakeWord.trim().toLocaleLowerCase() : 'hey neuroclaw';
  const requested = Number(args.durationMs);
  const durationMs = Number.isFinite(requested) ? Math.max(1000, Math.min(wakeMode ? 60000 : 15000, requested)) : (wakeMode ? 15000 : 10000);
  return new Promise(resolve => {
    let settled = false;
    const recognition = new Recognition();
    recognition.lang = language;
    recognition.continuous = wakeMode;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let transcript = '';
    let timer;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { recognition.stop(); } catch {}
      resolve(result);
    };
    recognition.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal || !result[0]) continue;
        const phrase = String(result[0].transcript || '').trim();
        if (!phrase) continue;
        transcript = phrase;
        if (!wakeMode) finish({ success: true, transcript, language, userStarted: true, providerMayUseNetwork: true });
        else if (phrase.toLocaleLowerCase().includes(wakeWord)) finish({ success: true, detected: true, wakeWord, transcript: phrase, language, userStarted: true, providerMayUseNetwork: true });
      }
    };
    recognition.onerror = event => finish({ success: false, status: String(event.error || 'recognition-error'), error: 'Speech recognition failed or permission was denied.' });
    recognition.onend = () => {
      if (wakeMode && !settled) finish({ success: true, detected: false, wakeWord, lastTranscript: transcript, timedOut: true, userStarted: true });
      else if (!settled && transcript) finish({ success: true, transcript, language, userStarted: true, providerMayUseNetwork: true });
      else if (!settled) finish({ success: false, status: 'no-speech', error: 'No speech was recognized.' });
    };
    timer = setTimeout(() => finish({ success: true, ...(wakeMode ? { detected: false, wakeWord, lastTranscript: transcript } : { transcript }), timedOut: true, userStarted: true }), durationMs);
    try { recognition.start(); } catch (error) { finish({ success: false, status: 'start-failed', error: String(error && error.message || error).slice(0, 300) }); }
  });
}

function readAppAccessibilityTree(args = {}) {
  if (typeof document === 'undefined') return { success: false, status: 'unsupported' };
  const maxItems = Number.isFinite(Number(args.maxItems)) ? Math.max(1, Math.min(300, Number(args.maxItems))) : 150;
  const visible = element => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const nodes = Array.from(document.querySelectorAll('button,a,input,textarea,select,[role],[aria-label],[contenteditable="true"]'))
    .filter(visible).slice(0, maxItems).map(element => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || undefined,
      label: (element.getAttribute('aria-label') || element.innerText || element.getAttribute('placeholder') || element.getAttribute('title') || '').trim().slice(0, 300),
      type: element.getAttribute('type') || undefined,
      disabled: Boolean(element.disabled),
      value: /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) ? String(element.value || '').slice(0, 300) : undefined,
    }));
  return { success: true, scope: 'current .my-ai renderer only; not other Windows applications', nodes, count: nodes.length, truncated: document.querySelectorAll('button,a,input,textarea,select,[role],[aria-label],[contenteditable="true"]').length > nodes.length };
}

function automateAppKeyboard(args = {}) {
  if (typeof document === 'undefined') return { success: false, status: 'unsupported' };
  const active = document.activeElement;
  const text = typeof args.text === 'string' ? args.text : '';
  if (!active || !/^(INPUT|TEXTAREA)$/.test(active.tagName) && !active.isContentEditable) return { success: false, error: 'Focus a text input in the .my-ai window first.' };
  if (args.action !== 'typeText' || text.length > 5000) return { success: false, error: 'Supported action is typeText with at most 5000 characters.' };
  if (active.disabled || active.readOnly) return { success: false, error: 'The focused field is disabled or read-only.' };
  if (active.isContentEditable) active.textContent = (active.textContent || '') + text;
  else {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(active), 'value')?.set;
    if (setter) setter.call(active, active.value + text); else active.value += text;
  }
  active.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  active.dispatchEvent(new Event('change', { bubbles: true }));
  return { success: true, action: 'typeText', characters: text.length, scope: 'focused field in current .my-ai window only' };
}

function automateAppPointer(args = {}) {
  if (typeof document === 'undefined') return { success: false, status: 'unsupported' };
  const targetText = typeof args.targetText === 'string' ? args.targetText.trim().toLocaleLowerCase() : '';
  if (!targetText || targetText.length > 200) return { success: false, error: 'Provide targetText (1–200 characters) matching a visible button or link.' };
  const targets = Array.from(document.querySelectorAll('button,a,[role="button"]')).filter(element => {
    const style = window.getComputedStyle(element), rect = element.getBoundingClientRect();
    const label = (element.getAttribute('aria-label') || element.innerText || element.getAttribute('title') || '').trim().toLocaleLowerCase();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && !element.disabled && label === targetText;
  });
  if (targets.length !== 1) return { success: false, error: targets.length ? 'Target label is ambiguous; no action was taken.' : 'No visible enabled button or link exactly matched that label.' };
  targets[0].click();
  return { success: true, action: 'click', targetText, scope: 'current .my-ai window only' };
}

async function captureScreenFrame() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    return { success: false, status: 'unsupported', error: 'Screen capture is unavailable in this runtime.' };
  }
  let stream;
  try {
    // Chromium/Electron displays its native source picker; no hidden capture.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    const track = stream.getVideoTracks()[0];
    if (!track) return { success: false, status: 'no-video-track' };
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Screen source did not become ready in time.')), 7000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('Could not initialize screen preview.')); };
    });
    await video.play();
    await new Promise(resolve => setTimeout(resolve, 250));
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth || 1280, 2560);
    canvas.height = Math.min(video.videoHeight || 720, 1440);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas capture is unavailable.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { success: true, mimeType: 'image/jpeg', dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height, sourcePickerShown: true };
  } catch (error) {
    return { success: false, status: 'capture-failed-or-canceled', error: String(error && error.message || error).slice(0, 500) };
  } finally {
    if (stream) stream.getTracks().forEach(track => track.stop());
  }
}

async function captureSystemAudio(args = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || typeof MediaRecorder === 'undefined') {
    return { success: false, status: 'unsupported', error: 'System audio capture is unavailable in this runtime.' };
  }
  const requested = Number(args.durationMs);
  const durationMs = Number.isFinite(requested) ? Math.max(1000, Math.min(15000, requested)) : 5000;
  let stream;
  try {
    // Windows/Electron may expose audio only for sources that support it.
    // The OS/Chromium picker remains visible and the user chooses the source.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return { success: false, status: 'no-audio-track', error: 'The selected source did not provide system audio.' };
    const audioStream = new MediaStream(audioTracks);
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type)) || '';
    const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const completed = new Promise((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onerror = event => reject(new Error(event.error && event.error.message || 'Audio recording failed.'));
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          if (blob.size > 10 * 1024 * 1024) return resolve({ success: false, status: 'size-limit', error: 'Audio sample exceeded 10 MB.' });
          const dataUrl = await new Promise((resolveData, rejectData) => {
            const reader = new FileReader();
            reader.onload = () => resolveData(reader.result);
            reader.onerror = () => rejectData(new Error('Could not encode audio sample.'));
            reader.readAsDataURL(blob);
          });
          resolve({ success: true, mimeType: blob.type || 'audio/webm', dataUrl, durationMs, sourcePickerShown: true });
        } catch (error) { reject(error); }
      };
    });
    recorder.start();
    await new Promise(resolve => setTimeout(resolve, durationMs));
    if (recorder.state !== 'inactive') recorder.stop();
    return await completed;
  } catch (error) {
    return { success: false, status: 'capture-failed-or-canceled', error: String(error && error.message || error).slice(0, 500) };
  } finally {
    if (stream) stream.getTracks().forEach(track => track.stop());
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  // File System Operations
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  
  // System Information
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // macOS permission status and consent/settings helpers.
  getMacOSPermissionsStatus: () => ipcRenderer.invoke('macos-permissions-status'),
  requestMacOSMediaAccess: (mediaType) => ipcRenderer.invoke('macos-request-media-access', mediaType),
  openMacOSPrivacySettings: (permission) => ipcRenderer.invoke('macos-open-privacy-settings', permission),
  // Individual permission tools: electronAPI.macOSPermissionTools.<toolId>.status/request/openSettings()
  // The registry is generated from stable tool IDs, with all operations mediated by the main process.
  getMacOSPermissionTools: () => ipcRenderer.invoke('macos-permission-tools-list'),
  macOSPermissionTool: (permission, action, options) => ipcRenderer.invoke('macos-permission-tool', permission, action, options),
  macOSPermissionTools: Object.fromEntries([
    'location','contacts','calendars','reminders','photos','camera','microphone','speechRecognition',
    'bluetooth','localNetwork','automation','accessibility','inputMonitoring','screenRecording','fullDiskAccess',
    'filesAndFolders','desktopFolder','documentsFolder','downloadsFolder','networkVolumes','removableVolumes',
    'mediaAppleMusic','homeKit','focus','motionFitness','developerTools','remoteDesktop','notifications','keychain',
    'administrator','appManagement','systemEvents','shortcuts','voiceActivation','systemAudio','fileSelection',
    'directorySelection','cameraDevices','microphoneDevices','locationWhenInUse','calendarWrite','contactsWrite',
    'photosAddOnly','networkClient','networkServer','usbAccessories','printing','screenCapture','audioInput',
    'audioOutput','biometricAuthentication','passwordAutoFill','systemConfiguration','kernelExtensions',
    'backgroundItems','accessibilityAutomation','appleEvents','audioCapture','siri','userTracking',
    'systemPolicyAppBundles','systemPolicyAppData','systemPolicySysAdminFiles','virtualMachineNetworking',
    'voiceBanking','webBrowserPublicKeyCredential','postEvent','calendarWriteOnly','calendarFullAccess',
    'remindersFullAccess','appDataContainers','appBundleManagement','systemAdminFiles','userSelectedFiles',
    'userSelectedFolders','energyKitGuidance','externalCameraMedia','fileProviderDomain',
    'fileProviderPresence','focusStatus','gameCenterFriends','systemPolicyDeveloperFiles',
    'accessibilityService',
    'bluetoothAlways',
    'calendarService',
    'cameraService',
    'microphoneService',
    'motionService',
    'photosService',
    'photosAddService',
    'remindersService',
    'remoteDesktopService',
    'screenCaptureService',
    'speechRecognitionService',
    'homeKitService',
    'fileProviderDomainService',
    'fileProviderPresenceService',
    'focusStatusService',
    'gameCenterFriendsService',
    'systemPolicyAppBundlesService',
    'systemPolicyAppDataService',
    'systemPolicySysAdminFilesService',
    'userTrackingService',
    'appleEventsService',
    'audioCaptureService',
    'postEventService',
    'developerToolService',
    'listenEventService',
    'mediaLibraryService',
    'systemPolicyDesktopFolderService',
    'systemPolicyDocumentsFolderService',
    'systemPolicyDownloadsFolderService',
    'systemPolicyNetworkVolumesService',
    'systemPolicyRemovableVolumesService',
    'systemPolicyAllFilesService',
    'systemPolicyDeveloperFilesService',
    'virtualMachineNetworkingService',
    'voiceBankingService',
    'webBrowserPublicKeyCredentialService',
    'energyKitGuidanceService',
    'externalCameraMediaService',
    'mainCamera',
    'bluetoothPeripheralLegacy',
    'locationAlwaysLegacy',
    'locationTemporaryFullAccuracy',
    'locationAccuracyPreference',
    'systemExtensionApproval',
    'driverExtensionApproval',
    'networkExtensionConfiguration',
    'endpointSecurityClient',
    'sandboxEntitlements',
    'loginItemManagement',
    'notificationAuthorization',
    'keychainItemAccess',
    'privilegedHelperAuthorization',
    'virtualizationFramework',
    'networkClientEntitlement',
    'networkServerEntitlement',
    'addressBook','developerTool','listenEvent','mediaLibrary','systemPolicyAllFiles','systemPolicyDesktopFolder',
    'systemPolicyDocumentsFolder','systemPolicyDownloadsFolder','systemPolicyNetworkVolumes','systemPolicyRemovableVolumes'
  ].map((id) => [id, {
    status: () => ipcRenderer.invoke('macos-permission-tool', id, 'status'),
    request: () => ipcRenderer.invoke('macos-permission-tool', id, 'request'),
    openSettings: () => ipcRenderer.invoke('macos-permission-tool', id, 'open-settings'),
    selectFile: (options) => ipcRenderer.invoke('macos-permission-tool', id, 'select-file', options),
    selectDirectory: (options) => ipcRenderer.invoke('macos-permission-tool', id, 'select-directory', options),
  }])) ,
  
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
    voiceActivation: (args = {}) => runSpeechRecognition(args, true),
    speechRecognition: (args = {}) => runSpeechRecognition(args, false),
    notifications: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'notifications', args),
    screenCapture: () => captureScreenFrame(),
    screenRecording: (args = {}) => recordScreenClip(args),
    systemAudioCapture: (args = {}) => captureSystemAudio(args),
    audioRecording: (args = {}) => recordMicrophone(args),
    speechSynthesis: (args = {}) => synthesizeSpeech(args),
    audioPlayback: (args = {}) => playLocalAudio(args),
    accessibility: (args = {}) => readAppAccessibilityTree(args),
    inputMonitoring: (args = {}) => ipcRenderer.invoke('windows-tools:run', 'inputMonitoring', args),
    keyboardAutomation: (args = {}) => automateAppKeyboard(args),
    pointerAutomation: (args = {}) => automateAppPointer(args),
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
