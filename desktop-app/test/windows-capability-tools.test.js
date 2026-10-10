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
check(tools.length >= 220, 'catalog covers 220+ individually named Windows capability tools');
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
check(getToolStatus('contacts').status === 'adapter-required', 'unsupported provider tools report adapter-required status');
check(getTool('deleteFile').implementation === 'adapter-required', 'destructive file operations are not falsely marked available');
check(getTool('revokeAppConsent').implementation === 'adapter-required', 'consent revocation is not falsely marked implemented');
check(tools.every((tool) => ['native','native-windows','browser-permission','native-consent','user-consent','adapter-required','admin-or-adapter','manifest'].includes(tool.implementation)), 'every capability declares a known implementation class');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
