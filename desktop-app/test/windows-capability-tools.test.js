#!/usr/bin/env node
'use strict';

const { listTools, getTool, getToolStatus } = require('../src/main/windows-capability-tools');
let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { passed++; console.log('  ok   ' + message); }
  else { failed++; console.error('  FAIL ' + message); }
}

const tools = listTools();
const ids = tools.map((tool) => tool.id);
check(tools.length >= 70, 'catalog includes an individual tool for each listed capability');
check(new Set(ids).size === ids.length, 'every tool ID is unique');
check(tools.every((tool) => tool.toolName === 'windows.' + tool.id), 'every tool has a stable namespaced tool name');
check(tools.every((tool) => tool.label && tool.category && tool.description && tool.implementation), 'every tool documents its purpose and implementation state');
check(getTool('camera').implementation === 'browser-permission', 'camera declares browser permission requirements');
check(getTool('contacts').implementation === 'adapter-required', 'contacts does not falsely claim universal Windows API support');
check(getTool('adminOperation').implementation === 'admin-or-adapter', 'administrative operations are explicitly gated');
check(getToolStatus('unknown-capability').success === false, 'unknown capability IDs are rejected');
check(getToolStatus('systemInfo').success === true && getToolStatus('systemInfo').details.arch, 'system information tool returns runtime details');
check(getToolStatus('contacts').status === 'adapter-required', 'unsupported provider tools report adapter-required status');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
