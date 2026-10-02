#!/usr/bin/env node
/**
 * tool-call-dataset.mjs -- labelled (prompt -> tool, arguments) examples.
 *
 * What teaching OneBrain to pick a tool needs as input. It is data only. The
 * network cannot yet be taught from it: a measured attempt to train tool
 * neurons on prompts (see docs/ONEBRAIN_CHAT_AND_TOOLS.md) made every tool fire
 * for every prompt, because the mesh state left by a packed prompt barely
 * depends on the prompt. Until that is fixed, tool-router.ts is what turns a
 * message into a call; this file is the labelled set a learned router would
 * be trained and scored against.
 *
 *   explicit: true   phrased the way tool-router.ts recognises -- the router
 *                    must agree with the label (test/core/tool-router.test.ts)
 *   explicit: false  a natural paraphrase the router deliberately ignores;
 *                    the part a learned router would have to get right
 *
 * Usage: node scripts/tool-call-dataset.mjs > tool-calls.jsonl
 */
import { fileURLToPath } from 'node:url'

const PATHS = ['notes.txt', 'src/index.ts', 'README.md', 'docs/plan.md', 'config/app.json']
const DIRS = ['src', 'docs', 'test', 'scripts', '.']
const COMMANDS = ['ls -la', 'pwd', 'git status', 'npm test', 'echo hello']

/** @returns {Array<{prompt: string, plugin: string, tool: string, args: Record<string, unknown>, explicit: boolean}>} */
export function buildToolCallExamples() {
  const out = []
  const add = (prompt, plugin, tool, args, explicit) => out.push({ prompt, plugin, tool, args, explicit })

  for (const command of COMMANDS) {
    add(`run \`${command}\``, 'terminal', 'run', { command }, true)
    add(`please execute the command \`${command}\``, 'terminal', 'run', { command }, true)
    add(`run command: ${command}`, 'terminal', 'run', { command }, true)
    add(`$ ${command}`, 'terminal', 'run', { command }, true)
    add(`can you check the output of ${command} for me`, 'terminal', 'run', { command }, false)
  }
  for (const path of PATHS) {
    add(`read file ${path}`, 'terminal', 'read_file', { path }, true)
    add(`show me the file ${path}`, 'terminal', 'read_file', { path }, true)
    add(`what is in ${path}`, 'terminal', 'read_file', { path }, false)
    add(`write file ${path} with hello world`, 'terminal', 'write_file', { path, content: 'hello world' }, true)
  }
  for (const path of DIRS) {
    add(`list directory ${path}`, 'terminal', 'list_directory', { path }, true)
    add(`ls ${path}`, 'terminal', 'list_directory', { path }, true)
    add(`what files are in the ${path} folder`, 'terminal', 'list_directory', { path }, false)
  }
  add('list terminals', 'terminal', 'list_terminals', {}, true)
  add('what background terminals are running', 'terminal', 'list_terminals', {}, false)
  add('list windows', 'desktop', 'list_windows', {}, true)
  add('what windows are open', 'desktop', 'list_windows', {}, true)
  add('which apps do I have open right now', 'desktop', 'list_windows', {}, false)
  add('take a screenshot', 'desktop', 'screenshot', {}, true)
  add('show me what is on my screen', 'desktop', 'screenshot', {}, false)
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const example of buildToolCallExamples()) console.log(JSON.stringify(example))
}
