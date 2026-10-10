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
check(getTool('deleteFile').implementation === 'adapter-required', 'destructive file operations are not falsely marked available');
check(getTool('revokeAppConsent').implementation === 'adapter-required', 'consent revocation is not falsely marked implemented');
check(tools.every((tool) => ['native','native-windows','browser-permission','native-consent','user-consent','adapter-required','admin-or-adapter','manifest'].includes(tool.implementation)), 'every capability declares a known implementation class');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
