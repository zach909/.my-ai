#!/usr/bin/env node
/**
 * Claude Code hook: stops the assistant from bringing third-party code into
 * this repo. Wired up in .claude/settings.json; see AGENTS.md.
 *
 *   pre   (PreToolUse)  Bash: refuse package installs, npx downloads, git clone / submodule,
 *                       curl|sh.  Write/Edit: refuse edits to the guard itself, and refuse
 *                       text that imports a package, carries someone else's licence banner,
 *                       or is bundled output.
 *   post  (PostToolUse) Write/Edit: re-scan the whole file as saved (catches package.json).
 *   stop  (Stop)        Scan the repo; refuse to finish while anything third-party is in it.
 *
 * Exit 2 sends the message on stderr back to the assistant. Node built-ins only.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARD_FILES, scanCommands, scanFile, scanRepo } from '../../scripts/check-no-third-party.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mode = process.argv[2];

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* no payload: treat as empty */ }

const RULE = 'This repo takes no third-party code (AGENTS.md). Write it yourself with Node built-ins, the Python standard library and this project\'s own modules. If you think it really needs a library, stop and ask the owner.';

function refuse(lines) {
  console.error([...lines, '', RULE].join('\n'));
  process.exit(2);
}

function relative(file) {
  if (!file) return null;
  const rel = path.relative(ROOT, path.resolve(ROOT, file)).split(path.sep).join('/');
  return rel.startsWith('..') ? null : rel;
}

const isProtected = (rel) => GUARD_FILES.includes(rel) || rel.startsWith('.githooks/') || rel.startsWith('.claude/hooks/');
const show = (vs) => vs.slice(0, 12).map((v) => `  ${v.file}:${v.line} [${v.rule}] ${v.message}`);

function editedTexts(tool, params) {
  if (tool === 'Write') return [params.content || ''];
  if (tool === 'Edit') return [params.new_string || ''];
  if (tool === 'MultiEdit') return (params.edits || []).map((e) => e.new_string || '');
  return [];
}

const tool = input.tool_name;
const params = input.tool_input || {};

if (mode === 'pre') {
  if (tool === 'Bash') {
    const cmd = String(params.command || '');
    const found = [];
    scanCommands('<command>', cmd, found);
    for (const m of cmd.matchAll(/\bgit\s+clone\s+(?:-[-\w=]+\s+)*(\S+)/g)) {
      if (!/localhost|127\.0\.0\.1|zach909\//.test(m[1])) found.push({ file: '<command>', line: 1, rule: 'command', message: `clones ${m[1]}, which is someone else's repository` });
    }
    if (found.length) refuse(['Blocked: this command would bring in third-party code.', ...show(found)]);
  }
  if (['Write', 'Edit', 'MultiEdit'].includes(tool)) {
    const rel = relative(params.file_path);
    if (rel && isProtected(rel)) refuse([`Blocked: ${rel} is the lock on third-party code. Only the owner may change it.`]);
    if (rel && !rel.endsWith('package.json')) {
      const found = editedTexts(tool, params).flatMap((t) => scanFile(rel, t));
      if (found.length) refuse(['Blocked: this edit would add third-party code.', ...show(found)]);
    }
  }
} else if (mode === 'post') {
  if (['Write', 'Edit', 'MultiEdit'].includes(tool)) {
    const rel = relative(params.file_path);
    if (rel && !isProtected(rel) && existsSync(path.join(ROOT, rel))) {
      let text = '';
      try { text = readFileSync(path.join(ROOT, rel), 'utf8'); } catch { /* binary or unreadable */ }
      const found = scanFile(rel, text);
      if (found.length) refuse([`${rel} now contains third-party code. Take it out.`, ...show(found)]);
    }
  }
} else if (mode === 'stop') {
  if (!input.stop_hook_active) {
    const found = scanRepo();
    if (found.length) refuse([`The repo still contains third-party code (${found.length} problem(s)). Remove it before finishing:`, ...show(found)]);
  }
}
process.exit(0);
