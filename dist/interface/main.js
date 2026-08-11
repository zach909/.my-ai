#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NeuroclawLLM } from "../models && skills/llm.js";
import { NeuroPipeline } from "../models && skills/core/pipeline.js";
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
    const pluginRegistry = new PluginRegistry();
    // Populate the plugin/skill catalog so the app launches with its real
    // registry (the `plugins` command and status counts) instead of an empty one.
    await pluginRegistry.bootstrap();
    const systemAccess = new SystemAccess({ multiDesktop: true, multiMouse: true, multiKeyboard: true });
    // Detects live capabilities and (if scripts/install.sh has run) loads this
    // machine's storage/OS/BIOS/driver profile for personalization -- see
    // CapabilitiesRegistry.getPersonalizationPrompt().
    const capabilities = new CapabilitiesRegistry();
    return { llm, pipeline, pluginRegistry, systemAccess, capabilities };
}
export async function bootstrap() {
    const { llm, pipeline, pluginRegistry, systemAccess, capabilities } = await buildCore();
    return new CLI(llm, pipeline, pluginRegistry, systemAccess, systemAccess.getMultiDesktop(), capabilities);
}
/**
 * Start the HTTP backend the Python bridge (interface/server.py) proxies to.
 * This is what makes "collapse Python/TS duplication through server.py" real:
 * server.py delegates /api/chat and /api/status here instead of falling back
 * to its own canned responses.
 */
export async function startWeb(port) {
    const { llm, pipeline, pluginRegistry, systemAccess } = await buildCore();
    const runner = new NeuroclawRunner(llm, pipeline, pluginRegistry, systemAccess, systemAccess.getMultiDesktop());
    const web = new WebServer(runner);
    // Loopback-only unless NEUROCLAW_WEB_HOST opts into remote access, in
    // which case NEUROCLAW_WEB_PASSWORD is required -- see WebServer.start()'s
    // doc comment for why an unauthenticated remote bind is refused outright.
    const host = process.env.NEUROCLAW_WEB_HOST || '127.0.0.1';
    await web.start(port, host, process.env.NEUROCLAW_WEB_PASSWORD);
    return web;
}
/** True when this module is the process entry point (not merely imported). */
function isEntryPoint() {
    const entry = process.argv[1];
    if (!entry)
        return false;
    try {
        return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
    }
    catch {
        return false;
    }
}
if (isEntryPoint()) {
    const [mode, portArg] = process.argv.slice(2);
    if (mode === 'web') {
        const port = Number(portArg) || 7861;
        const host = process.env.NEUROCLAW_WEB_HOST || '127.0.0.1';
        startWeb(port)
            .then(() => console.log(`Neuroclaw HTTP backend listening on http://${host}:${port}`))
            .catch(err => {
            // EADDRINUSE is common and self-explanatory once you know the
            // cause: `npm run dev` and `npm run server` both default to the
            // same backend port (7861), so leaving one running and starting
            // the other collides -- a real report from running exactly that.
            // The raw Node stack trace this used to print didn't say why;
            // this does.
            if (err && err.code === 'EADDRINUSE') {
                console.error(`Failed to start web backend: port ${port} is already in use.\n` +
                    `This usually means another Neuroclaw backend is already running -- ` +
                    `check for an existing 'npm run dev' or 'npm run server' in another ` +
                    `terminal, or pass a different port: node dist/interface/main.js web <port>.`);
            }
            else {
                console.error('Failed to start web backend:', err);
            }
            process.exit(1);
        });
    }
    else {
        bootstrap()
            .then(cli => cli.startInteractive())
            .catch(err => { console.error('Failed to start Neuroclaw:', err); process.exit(1); });
    }
}
