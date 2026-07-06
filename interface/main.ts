#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NeuroclawLLM } from "../models && skills/llm.js";
import { NeuroPipeline } from "../models && skills/core/pipeline.js";
import { ThesaurusDictionary } from "../models && skills/thesaurus.js";
import { PluginRegistry } from "../plugin_manager/registry.js";
import { SystemAccess } from "./system-access.js";
import { CLI } from "./cli.js";

/**
 * Composition root. Neither cli.ts nor runner.ts instantiate anything on their
 * own — they only export classes — so before this file existed `npm start` and
 * the `prometheus` bin both loaded a class definition and exited without ever
 * launching the app. This wires the dependency graph and starts the
 * interactive CLI.
 */
export async function bootstrap(): Promise<CLI> {
  const llm = new NeuroclawLLM();
  const pipeline = new NeuroPipeline();
  const thesaurus = new ThesaurusDictionary();
  const pluginRegistry = new PluginRegistry();
  const systemAccess = new SystemAccess({ multiDesktop: true, multiMouse: true, multiKeyboard: true });

  return new CLI(
    llm,
    pipeline,
    thesaurus,
    pluginRegistry,
    systemAccess,
    systemAccess.getMultiDesktop(),
  );
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
  bootstrap()
    .then(cli => cli.startInteractive())
    .catch(err => {
      console.error('Failed to start Neuroclaw:', err);
      process.exit(1);
    });
}
