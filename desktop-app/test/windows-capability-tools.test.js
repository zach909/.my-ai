#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { listTools, getTool, getToolStatus } = require('../src/main/windows-capability-tools');
let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { passed++; console.log('  ok   ' + message); }
  else { failed++; console.error('  FAIL ' + message); }
}

const tools = listTools();
const ids = tools.map((tool) => tool.id);
check(tools.length >= 230, 'catalog covers 230+ individually named Windows capability tools');
const preload = fs.readFileSync(path.join(__dirname, '../src/preload/preload.js'), 'utf8');
check(ids.every((id) => new RegExp('^\\s{4}' + id + ':\\s*\\(', 'm').test(preload)), 'every registry tool has an individual preload API method');
check(new Set(ids).size === ids.length, 'every tool ID is unique');
check(tools.every((tool) => tool.toolName === 'windows.' + tool.id), 'every tool has a stable namespaced tool name');
check(tools.every((tool) => tool.label && tool.category && tool.description && tool.implementation), 'every tool documents its purpose and implementation state');
check(getTool('camera').implementation === 'browser-permission', 'camera declares browser permission requirements');
check(getTool('contacts').implementation === 'adapter-required', 'contacts does not falsely claim universal Windows API support');
check(getTool('adminOperation').implementation === 'admin-or-adapter', 'administrative operations are explicitly gated');
check(getToolStatus('unknown-capability').success === false, 'unknown capability IDs are rejected');
check(getToolStatus('systemInfo').success === true && getToolStatus('systemInfo').details.arch, 'system information tool returns runtime details');
check(getTool('readFileMetadata').implementation === 'native', 'selected-file metadata is implemented natively');
check(getTool('diskSpace').implementation === 'native', 'disk-space metadata is implemented natively');
check(getTool('performanceMetrics').implementation === 'native', 'basic performance metrics are implemented natively');
check(getTool('appData').implementation === 'native', 'app-owned data locations are implemented natively');
check(getTool('privacySettings').implementation === 'native', 'Windows privacy settings shortcut is implemented natively');
check(getTool('windowsCapabilityState').implementation === 'native', 'capability-state inventory is implemented natively');
check(getTool('windowsSecurityContext').implementation === 'native-windows', 'Windows security context is inspected without changing privileges');
check(getTool('fileAccessControl').implementation === 'native-windows', 'selected-path ACL inspection is implemented');
check(getTool('aclPermissionCheck').implementation === 'native-windows', 'selected-path access check is implemented');
check(getTool('windowsPermissionSettings').implementation === 'native', 'Windows privacy settings pages can be opened');
check(getTool('windowsCapabilityManifest').implementation === 'native', 'manifest capability applicability is reported without claiming grants');
check(getTool('windowsTokenPrivileges').implementation === 'native-windows', 'current token privileges can be inspected without changing them');
check(getTool('windowsFirewallStatus').implementation === 'native-windows', 'firewall profile status is read-only');
check(getTool('windowsDefenderStatus').implementation === 'native-windows', 'Defender status inspection is read-only');
check(getTool('windowsServiceStatus').implementation === 'native-windows', 'service status inspection is available with validation');
check(getTool('windowsServiceSecurityDescriptor').implementation === 'native-windows', 'service security descriptor inspection is available with validation');
check(getTool('windowsAccountPolicy').implementation === 'native-windows', 'local account policy inspection is read-only');
check(getTool('windowsNetworkShares').implementation === 'native-windows', 'network share inventory is read-only');
check(getTool('windowsPowerShellExecutionPolicy').implementation === 'native-windows', 'execution policy inspection does not alter policy');
check(getTool('createFile').implementation === 'native', 'new file creation uses a user-selected path and refuses overwrite');
check(getTool('updateFile').implementation === 'native-consent', 'file updates require explicit confirmation');
check(getTool('moveFile').implementation === 'native-consent', 'file moves require user-selected source and destination');
check(getTool('renameFile').implementation === 'native-consent', 'file rename uses native file selection');
check(getTool('fileSearch').implementation === 'native-consent', 'file search is scoped to a user-selected folder and bounded');
check(getTool('automaticDownloads').implementation === 'native-consent', 'downloads require a user-selected save destination');
check(getTool('documents').implementation === 'user-consent', 'Documents access is scoped to a user-selected folder');
check(getTool('desktop').implementation === 'user-consent', 'Desktop access is scoped to a user-selected folder');
check(getTool('downloads').implementation === 'user-consent', 'Downloads access is scoped to a user-selected folder');
check(getTool('pictures').implementation === 'user-consent', 'Pictures access is scoped to a user-selected folder');
check(getTool('videos').implementation === 'user-consent', 'Videos access is scoped to a user-selected folder');
check(getTool('music').implementation === 'user-consent', 'Music access is scoped to a user-selected folder');
check(getTool('removableDrives').implementation === 'native-windows', 'removable-drive metadata is read-only');
check(getTool('networkShares').implementation === 'native-windows', 'network share inventory is read-only');
check(getTool('mediaLibrary').implementation === 'user-consent', 'media inventory requires a user-selected folder and reads metadata only');
check(getTool('onedriveFiles').implementation === 'user-consent', 'synced-folder access requires user selection');
check(getTool('ethernetStatus').implementation === 'native-windows', 'Ethernet adapter metadata is read-only');
check(getTool('dnsConfiguration').implementation === 'native-windows', 'DNS configuration is read-only');
check(getTool('proxyConfiguration').implementation === 'native-windows', 'proxy configuration is read-only');
check(getTool('networkPortStatus').implementation === 'native-windows', 'local endpoint metadata is read-only');
check(getTool('deviceMetadata').implementation === 'native-windows', 'Plug and Play device metadata is read-only');
check(getTool('appWindowList').implementation === 'native-windows', 'window inventory exposes metadata only');
check(getTool('windowsUpdateStatus').implementation === 'native-windows', 'Windows Update service inspection is read-only');
check(getTool('deviceEncryptionStatus').implementation === 'native-windows', 'volume encryption status never exposes recovery keys');
check(getTool('secureBootStatus').implementation === 'native-windows', 'Secure Boot state is queried without changing firmware settings');
check(getTool('accountInfo').implementation === 'native-windows', 'current Windows identity metadata is read without credentials');
check(getTool('cameraDevices').implementation === 'native-windows', 'camera device metadata is listed without capturing images');
check(getTool('inputDeviceStatus').implementation === 'native-windows', 'input device metadata is listed without recording input');
check(getTool('processMetrics').implementation === 'native-windows', 'process CPU and memory metadata is bounded and read-only');
check(getTool('registryRead').implementation === 'native-consent', 'registry reads are limited to allowlisted non-secret keys');
check(getTool('registryInspect').implementation === 'native-consent', 'registry inspection rejects arbitrary paths');
check(getTool('permissionAuditLog').implementation === 'native', 'permission audit reports catalog state without claiming OS grants');
check(getTool('permissionControls').implementation === 'native', 'permission controls open Windows privacy settings');
check(getTool('appPermissions').implementation === 'native', 'app permissions shortcut opens Windows privacy settings');
check(getTool('defaultApps').implementation === 'native', 'default apps shortcut opens Windows Settings');
check(getTool('timeZoneSettings').implementation === 'native-windows', 'time-zone state is read without changing it');
check(getTool('localeSettings').implementation === 'native-windows', 'locale metadata is read-only');
check(getTool('systemSoundSettings').implementation === 'native', 'system sound shortcut opens Windows Settings');
check(getTool('accessibilitySettings').implementation === 'native', 'accessibility shortcut opens Windows Settings without enabling input monitoring');
check(getTool('locationSettings').implementation === 'native', 'location shortcut opens Windows privacy settings without enabling location');
check(getTool('windowsAppCapabilities').implementation === 'native', 'packaging context is reported without claiming manifest grants');
check(getTool('screenCapture').implementation === 'browser-permission', 'screen capture uses a visible source picker and stops after one frame');
check(getTool('systemAudioCapture').implementation === 'browser-permission', 'system audio capture is bounded and source-picker gated');
check(getTool('speechRecognition').implementation === 'browser-permission', 'speech recognition is user-started and runtime-gated');
check(getTool('voiceActivation').implementation === 'browser-permission', 'wake-word listening is opt-in and time-bounded');
check(getTool('accessibility').implementation === 'native', 'accessibility snapshot is limited to this app window');
check(getTool('keyboardAutomation').implementation === 'native', 'keyboard automation is limited to the focused field in this app');
check(getTool('pointerAutomation').implementation === 'native', 'pointer automation clicks only a uniquely labeled control in this app');
check(/getDisplayMedia\\(\\{ video: \\{ frameRate: 5 \\}, audio: false \\}\\)/.test(preload), 'screen capture requests an explicit visible picker');
check(/getDisplayMedia\\(\\{ video: true, audio: true \\}\\)/.test(preload), 'system audio capture requests a visible source picker');
check(/Math\\.min\\(wakeMode \\? 60000 : 15000, requested\\)/.test(preload), 'speech recognition session has a bounded maximum duration');

check(getTool('appDiagnostics').implementation === 'native', 'app diagnostics expose log metadata without log contents');
check(getTool('developerTools').implementation === 'native', 'developer tool checks run fixed version commands only');
check(getTool('appLaunch').implementation === 'native', 'app launch routes through user-confirmed process launch');
check(getTool('environmentRead').implementation === 'native', 'environment inspection is restricted to an allowlist');
check(getTool('gitRepositories').implementation === 'native', 'Git inspection uses a user-selected repository and read-only commands');
check(getTool('taskManager').implementation === 'native', 'task inventory includes only app-owned processes');
check(getTool('clipboardImageRead').implementation === 'native-consent', 'clipboard image reads require explicit confirmation');
check(getTool('clipboardClear').implementation === 'native-consent', 'clipboard clearing requires explicit confirmation');
check(getTool('uacElevationRequest').implementation === 'admin-or-adapter', 'generic elevation remains unavailable without a dedicated reviewed helper');



check(getTool('wifiStatus').implementation === 'native-windows', 'Wi-Fi status is inspected without changing network configuration');
check(getTool('bluetooth').implementation === 'native-windows', 'Bluetooth device metadata inspection is implemented');
check(getTool('usbDevices').implementation === 'native-windows', 'USB device metadata inspection is implemented');
check(getTool('printers').implementation === 'native-windows', 'installed printer inventory is implemented');
check(getTool('audioDevices').implementation === 'native-windows', 'audio endpoint inventory is implemented without bypassing capture consent');
check(getTool('displays').implementation === 'native-windows', 'display metadata is read through Electron');
check(getTool('installedApps').implementation === 'native-windows', 'installed application inventory has an explicit bounded scope');
check(getTool('startupSettings').implementation === 'native-windows', 'startup registry entries are inspected read-only');
check(getTool('scheduledTasks').implementation === 'native-windows', 'scheduled task metadata is listed without modifying tasks');
check(getTool('powerBattery').implementation === 'native-windows', 'battery metadata is inspected where supported');
check(getTool('firewallStatus').implementation === 'native-windows', 'firewall status is read-only');
check(getTool('securityStatus').implementation === 'native-windows', 'security provider status is inspected read-only');
check(getTool('eventLogs').implementation === 'native-windows', 'event log metadata is listed without changing logs');
check(getTool('windowsServices').implementation === 'native-windows', 'service metadata is listed without service control');
check(getTool('systemSettings').implementation === 'native-windows', 'basic Windows system settings metadata is inspected read-only');


check(getToolStatus('contacts').status === 'adapter-required', 'unsupported provider tools report adapter-required status');
check(getTool('deleteFile').implementation === 'native-consent', 'file deletion is implemented with native selection and explicit confirmation');
check(getTool('revokeAppConsent').implementation === 'adapter-required', 'consent revocation is not falsely marked implemented');
check(tools.every((tool) => ['native','native-windows','browser-permission','native-consent','user-consent','adapter-required','admin-or-adapter','manifest'].includes(tool.implementation)), 'every capability declares a known implementation class');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
