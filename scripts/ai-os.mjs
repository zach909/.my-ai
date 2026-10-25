#!/usr/bin/env node
/**
 * AI OS mode from a terminal: make NeuroClaw part of this computer's sign-in, or take it out again.
 *
 *   node scripts/ai-os.mjs status     is it on, how, and which files it uses
 *   node scripts/ai-os.mjs enable     start the engine at every sign-in (and now, if nothing is running)
 *   node scripts/ai-os.mjs disable    stop doing that and remove what enable wrote
 *   add --json for machine-readable output
 *
 * Needs the backend built (node scripts/build-backend.mjs). No administrator rights: it only writes into
 * your own account (a systemd user service or autostart entry, a LaunchAgent, or a per-user startup value).
 * It grants the agent no extra access; Computer Access and tool safety work exactly as before.
 * The logic is in interface/platform/ai-os.ts. Node built-ins only.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'dist', 'interface', 'platform', 'ai-os.js');
const PORT = Number(process.env.NEUROCLAW_WEB_PORT) || 7861;

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('-')) ?? 'status';
const json = args.includes('--json');

function usage() {
  console.log('usage: node scripts/ai-os.mjs [status|enable|disable] [--json]');
}

/** True when a NeuroClaw engine already answers on the port (starting a second one would fail). */
async function engineRunning() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/status`, { signal: AbortSignal.timeout(1500) });
    const j = r.ok ? await r.json().catch(() => null) : null;
    return !!(j && j.running === true && j.subsystems);
  } catch { return false; }
}

async function main() {
  if (args.includes('--help') || args.includes('-h')) { usage(); return; }
  if (!['status', 'enable', 'disable'].includes(command)) { usage(); process.exitCode = 2; return; }
  if (!existsSync(MODULE)) {
    console.error('The backend is not built yet. Run: node scripts/build-backend.mjs');
    process.exitCode = 1;
    return;
  }
  const ai = await import(pathToFileURL(MODULE).href);
  const env = ai.currentEnv();

  if (command === 'status') {
    const s = ai.aiOsStatus(env);
    if (json) console.log(JSON.stringify(s, null, 2));
    else if (!s.supported) console.log(`Not available here: ${s.reason}`);
    else {
      console.log(`AI OS mode is ${s.enabled ? 'ON' : 'off'} (${s.mechanism}).`);
      console.log(s.summary);
      if (s.enabled) for (const f of s.files) console.log(`  ${f}`);
    }
    return;
  }

  const result = command === 'enable'
    ? ai.enableAiOs(env, undefined, { startNow: !(await engineRunning()) })
    : ai.disableAiOs(env);
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const s of result.steps) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.step}${s.detail ? ` (${s.detail})` : ''}`);
    console.log(result.message);
  }
  if (!result.ok) process.exitCode = 1;
}

main().catch((e) => { console.error('[ai-os] failed:', e.message); process.exit(1); });
