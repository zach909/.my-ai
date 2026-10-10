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
