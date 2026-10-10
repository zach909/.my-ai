/**
 * Windows capability tools.
 *
 * Each catalog entry is a distinct tool ID. A tool is not considered working
 * merely because it is listed: adapters and Windows permissions are verified
 * separately at runtime.
 */
'use strict';
const os = require('os');

const DEFINITIONS = [
  ['camera','Camera capture','privacy','browser-permission','Use an approved camera stream from the renderer.'],
  ['microphone','Microphone capture','privacy','browser-permission','Use an approved microphone stream from the renderer.'],
  ['location','Location services','privacy','browser-permission','Request geolocation through the platform permission flow.'],
  ['voiceActivation','Voice activation / wake word','privacy','adapter-required','Requires opt-in wake-word engine, visible listening status, and mute control.'],
  ['speechRecognition','Speech recognition','privacy','adapter-required','Requires a speech engine and microphone consent.'],
  ['notifications','Desktop notifications','privacy','native','Show a desktop notification after user authorization.'],
  ['screenCapture','Screen capture','privacy','adapter-required','Requires a user-visible capture picker and active-session consent.'],
  ['systemAudioCapture','System audio capture','privacy','adapter-required','Requires platform-specific support and explicit consent.'],
  ['accessibility','Accessibility tree','privacy','adapter-required','Requires a Windows UI Automation adapter.'],
  ['inputMonitoring','Input monitoring','privacy','adapter-required','Requires explicit opt-in and a narrow visible use case.'],
  ['keyboardAutomation','Keyboard automation','automation','adapter-required','Requires user-authorized automation adapter.'],
  ['pointerAutomation','Pointer automation','automation','adapter-required','Requires user-authorized automation adapter.'],
  ['clipboardRead','Read clipboard','privacy','native-consent','Read only after explicit user action or opt-in.'],
  ['clipboardWrite','Write clipboard','privacy','native','Write supplied text to the system clipboard.'],
  ['selectFile','Choose a file','files','native','Open the native file picker.'],
  ['selectDirectory','Choose a folder','files','native','Open the native folder picker.'],
  ['readSelectedFile','Read a user-selected file','files','native','Read a file selected in the current session.'],
  ['writeSelectedFile','Write a user-selected destination','files','native','Write to a user-selected destination.'],
  ['documents','Documents library','files','user-consent','Requires user-selected/authorized folder.'],
  ['desktop','Desktop folder','files','user-consent','Requires user-selected/authorized folder.'],
  ['downloads','Downloads folder','files','user-consent','Requires user-selected/authorized folder.'],
  ['pictures','Pictures library','files','user-consent','Requires user-selected/authorized folder.'],
  ['videos','Videos library','files','user-consent','Requires user-selected/authorized folder.'],
  ['music','Music library','files','user-consent','Requires user-selected/authorized folder.'],
  ['removableDrives','Removable drives','files','user-consent','Requires selected drive and normal Windows ACL access.'],
  ['networkShares','Network shares','files','user-consent','Requires selected share and normal Windows/network authorization.'],
  ['broadFilesystem','Broad filesystem access','files','adapter-required','Bounded by account ACLs; there is no universal grant.'],
  ['fileSearch','Search files','files','adapter-required','Requires scoped search/indexing implementation.'],
  ['archiveFiles','Create and extract archives','files','adapter-required','Requires archive implementation and path traversal validation.'],
  ['automaticDownloads','Automatic downloads','files','adapter-required','Requires destination, file-type rules, and confirmation policy.'],
  ['accountInfo','Account/profile information','personal-data','adapter-required','Requires supported Windows or provider API.'],
  ['contacts','Contacts','personal-data','adapter-required','Requires explicit contacts-provider integration.'],
  ['calendar','Calendar events','personal-data','adapter-required','Requires calendar-provider integration.'],
  ['tasks','Tasks and reminders','personal-data','adapter-required','Requires tasks/reminders-provider integration.'],
  ['email','Email and attachments','communications','adapter-required','Requires configured mail provider and user authorization.'],
  ['messaging','Messaging services','communications','adapter-required','Requires authorized service-specific integration.'],
  ['phoneCalls','Phone / VoIP calls','communications','adapter-required','Requires supported telephony or VoIP integration.'],
  ['callHistory','Call history','personal-data','adapter-required','Requires provider that explicitly exposes call history.'],
  ['browserData','Browser bookmarks/history/downloads','personal-data','adapter-required','Use supported browser APIs or user exports; do not extract protected secrets.'],
  ['passwordManagers','Password/passkey providers','security','adapter-required','Use documented sign-in/passkey flows; never dump credential stores.'],
  ['mediaLibrary','Media library metadata','personal-data','adapter-required','Requires scoped media-library adapter.'],
  ['wifiStatus','Wi-Fi status','devices','adapter-required','Query supported network-interface metadata.'],
  ['wifiConfiguration','Wi-Fi configuration','devices','admin-or-adapter','Changes require native API and may require elevation.'],
  ['networkInterfaces','Network interfaces','devices','native','List local network-interface metadata.'],
  ['bluetooth','Bluetooth radio and paired devices','devices','adapter-required','Requires Windows Bluetooth API adapter.'],
  ['unpairedDevices','Nearby/unpaired device discovery','devices','adapter-required','Requires supported discovery API and explicit consent.'],
  ['usbDevices','USB / serial devices','devices','adapter-required','Requires device-specific API and normal driver permissions.'],
  ['printers','Printers and print queues','devices','adapter-required','Query installed printer names; printing still needs user choice.'],
  ['printDocument','Print a document','devices','adapter-required','Requires a native print dialog integration.'],
  ['audioDevices','Audio input/output devices','devices','adapter-required','Requires device enumeration adapter; capture remains permission-gated.'],
  ['displays','Display metadata','devices','adapter-required','Requires Electron screen metadata or Windows display adapter.'],
  ['localNetwork','Local-network communication','network','native','Subject to firewall and network policy.'],
  ['systemInfo','Operating system and hardware info','system','native','Return basic OS and runtime metadata.'],
  ['installedApps','Installed application inventory','system','adapter-required','Use supported inventory sources and disclose scope.'],
  ['processList','Running-process metadata','system','native-windows','List process metadata, not process memory or secrets.'],
  ['launchProcess','Launch a program','system','native','Launch explicit executable/arguments; no shell by default.'],
  ['stopOwnedProcess','Stop an app-owned process','system','native','Only stop process handles created and tracked by this app.'],
  ['appDiagnostics','Application diagnostics and logs','system','native','Read .my-ai-owned logs and diagnostic state.'],
  ['startupSettings','Startup launch setting','system','adapter-required','Requires user-visible setting and off switch.'],
  ['backgroundOperation','Background operation','system','native','Run only when configured; show status and controls.'],
  ['scheduledTasks','Scheduled tasks','system','admin-or-adapter','Creating/modifying tasks requires explicit approval.'],
  ['windowsServices','Windows services','system','admin-or-adapter','Service install/control requires administrator authorization.'],
  ['powerBattery','Power and battery information','system','adapter-required','Requires supported system-information APIs.'],
  ['registryRead','Read approved registry keys','system','adapter-required','Only documented keys; no credential/security-secret harvesting.'],
  ['registryWrite','Write approved registry keys','system','admin-or-adapter','Allowlisted keys and explicit confirmation only.'],
  ['environmentInfo','Environment and PATH information','developer','native','Return selected environment metadata without exposing secrets.'],
  ['developerTools','Developer tools and Git','developer','native','Run allowlisted tools with explicit arguments.'],
  ['firewallStatus','Firewall status','security','adapter-required','Read-only inspection through supported Windows interfaces.'],
  ['firewallChanges','Firewall changes','security','admin-or-adapter','Requires elevation and explicit confirmation.'],
  ['securityStatus','Windows security status','security','adapter-required','Read through supported Windows security interfaces.'],
  ['eventLogs','Windows event logs','system','admin-or-adapter','Read only logs available to the current account.'],
  ['uiAutomation','UI automation','automation','adapter-required','Requires supported UI Automation and user-authorized workflows.'],
  ['openUrl','Open a web URL','system','native','Only open http/https URLs in default browser.'],
  ['openPath','Open a file or folder','files','native','Open a user-selected path with the operating system.'],
  ['systemSettings','System settings inspection','system','adapter-required','Inspect supported settings; changes need confirmation.'],
  ['adminOperation','Elevated administrative operation','security','admin-or-adapter','No silent elevation or UAC bypass; explicit approved elevation only.'],
];

const byId = new Map(DEFINITIONS.map(([id,label,category,implementation,description]) => [
  id, { id, toolName: 'windows.' + id, label, category, implementation, description },
]));

function listTools() {
  return DEFINITIONS.map(([id,label,category,implementation,description]) => ({
    id, toolName: 'windows.' + id, label, category, implementation, description,
    status: implementation === 'native' || implementation === 'native-windows'
      ? 'partially-available'
      : implementation === 'user-consent' || implementation === 'browser-permission'
        ? 'consent-required' : 'adapter-required',
  }));
}

function getTool(id) { return byId.get(id) || null; }

function getToolStatus(id) {
  const tool = getTool(id);
  if (!tool) return { success: false, error: 'Unknown Windows capability tool.' };
  const result = { success: true, ...tool, platform: process.platform };
  if (tool.implementation === 'native-windows' && process.platform !== 'win32') {
    result.available = false;
    result.status = 'unsupported-on-platform';
  } else if (tool.implementation === 'adapter-required' || tool.implementation === 'admin-or-adapter') {
    result.available = false;
    result.status = 'adapter-required';
  } else if (id === 'systemInfo') {
    result.available = true;
    result.details = {
      platform: process.platform, release: os.release(), arch: os.arch(),
      hostname: os.hostname(), totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(),
    };
  } else {
    result.available = true;
  }
  return result;
}

module.exports = { listTools, getTool, getToolStatus };
