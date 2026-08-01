#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NeuroclawLLM } from "../models && skills/llm.js";
import { NeuroPipeline } from "../models && skills/core/pipeline.js";
import { ThesaurusDictionary } from "../models && skills/thesaurus.js";
import { PluginRegistry } from "../plugin_manager/registry.js";
import { SystemAccess } from "./system-access.js";
import { CapabilitiesRegistry } from "./capabilities.js";
import { CLI } from "./cli.js";
import { NeuroclawRunner } from "./runner.js";
import { WebServer } from "./web-server.js";

/**
 * Composition root. cli.ts, runner.ts and web-server.ts only export classes —
 * before this file existed nothing instantiated them, so `npm start`, the
 * `prometheus` bin, and server.py's `web` spawn all loaded a class definition
 * and exited without launching anything. This wires the dependency graph once
 * and starts either the interactive CLI or the HTTP backend.
 */
async function buildCore() {
  const llm = new NeuroclawLLM();
  const pipeline = new NeuroPipeline();
  const thesaurus = new ThesaurusDictionary();
  const pluginRegistry = new PluginRegistry();
  // Populate the plugin/skill catalog so the app launches with its real
  // registry (the `plugins` command and status counts) instead of an empty one.
  await pluginRegistry.bootstrap();
  const systemAccess = new SystemAccess({ multiDesktop: true, multiMouse: true, multiKeyboard: true });
  // Detects live capabilities and (if scripts/install.sh has run) loads this
  // machine's storage/OS/BIOS/driver profile for personalization -- see
  // CapabilitiesRegistry.getPersonalizationPrompt().
  const capabilities = new CapabilitiesRegistry();
  return { llm, pipeline, thesaurus, pluginRegistry, systemAccess, capabilities };
}

export async function bootstrap(): Promise<CLI> {
  const { llm, pipeline, thesaurus, pluginRegistry, systemAccess, capabilities } = await buildCore();
  return new CLI(llm, pipeline, thesaurus, pluginRegistry, systemAccess, systemAccess.getMultiDesktop(), capabilities);
}

/**
 * Start the HTTP backend the Python bridge (interface/server.py) proxies to.
 * This is what makes "collapse Python/TS duplication through server.py" real:
 * server.py delegates /api/chat and /api/status here instead of falling back
 * to its own canned responses.
 */
export async function startWeb(port: number): Promise<WebServer> {
  const { llm, pipeline, thesaurus, pluginRegistry, systemAccess } = await buildCore();
  const runner = new NeuroclawRunner(llm, pipeline, thesaurus, pluginRegistry, systemAccess, systemAccess.getMultiDesktop());
  const web = new WebServer(runner);
  await web.start(port);
  return web;
}

/** True when this module is the process entry point (not merely imported). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const [mode, portArg] = process.argv.slice(2);
  if (mode === 'web') {
    const port = Number(portArg) || 7861;
    startWeb(port)
      .then(() => console.log(`Neuroclaw HTTP backend listening on http://127.0.0.1:${port}`))
      .catch(err => { console.error('Failed to start web backend:', err); process.exit(1); });
  } else {
    bootstrap()
      .then(cli => cli.startInteractive())
      .catch(err => { console.error('Failed to start Neuroclaw:', err); process.exit(1); });
  }
}
