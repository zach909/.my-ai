#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NeuroclawLLM } from "../models && skills/llm.js";
import { NeuroPipeline } from "../models && skills/core/pipeline.js";
import { PluginRegistry } from "../plugin_manager/registry.js";
import { createPluginInstance, pluginExtensions } from "../plugins/index.js";
import { SystemAccess } from "./system-access.js";
import { CapabilitiesRegistry } from "./capabilities.js";
import { CLI } from "./cli.js";
import { NeuroclawRunner } from "./runner.js";
import { WebServer } from "./web-server.js";
import { MixtureOfExperts } from "../models && skills/moe.js";
/**
 * Composition root. cli.ts, runner.ts and web-server.ts only export classes —
 * before this file existed nothing instantiated them, so `npm start`, the
 * `prometheus` bin, and server.py's `web` spawn all loaded a class definition
 * and exited without launching anything. This wires the dependency graph once
 * and starts either the interactive CLI or the HTTP backend.
 */
/**
 * Instantiate and activate a real implementation for every plugin/skill in
 * the extension catalog (plugins/index.ts's `pluginExtensions`) and register
 * it into the registry `bootstrap()` only pre-seeded with placeholder
 * definitions.
 *
 * Before this existed, `interface/main.ts` — the actual composition root for
 * `npm start`, `npm run dev`/`npm run server`, and the `web` mode
 * interface/server.py's /api/plugins proxies to — only ever called
 * `pluginRegistry.bootstrap()`. That populates `definitions`/`skills` (so
 * `plugins`/`skills` listings and status counts show real names/counts) but
 * never touches the `plugins` instance map, so `PluginRegistry.dispatch()`
 * (called on every CLI/web message — see cli.ts and runner.ts) always found
 * `this.plugins.get(pluginId)` empty and fell through to `null`. Every real
 * plugin implementation under plugins/*.ts (location, camera, file-system,
 * self-heal, the plugin-maker/skill-maker extensions, ...) was therefore
 * dead code in the actually-running app, reachable only from tests and from
 * `src/index.ts`'s `NeuroclawSystem`, which nothing instantiates outside its
 * own test file. This mirrors the correct wiring `NeuroclawSystem.initialize()`
 * already does, so both composition roots register the same real plugins the
 * same way.
 */
async function registerRealPlugins(pluginRegistry) {
    for (const [key, def] of Object.entries(pluginExtensions)) {
        const skillDef = def.type === "skill-expert"
            ? {
                id: def.id,
                name: def.name,
                description: `${def.name} MoE expert`,
                expertIndex: pluginRegistry.getSkillCount(),
                specialization: def.capabilities[0] ?? def.id,
                selfAuthored: false,
            }
            : undefined;
        try {
            const instance = createPluginInstance(def.name, def, skillDef, pluginRegistry.getMoE().getMesh());
            pluginRegistry.register(def, instance);
            if (skillDef)
                pluginRegistry.registerSkill(skillDef, def.id);
        }
        catch (e) {
            console.warn(`Failed to instantiate extension "${key}":`, e);
        }
    }
    // call-history reads from phone-calls' log rather than keeping its own
    // separate copy; wire that dependency once both plugins exist.
    const callHistoryInstance = pluginRegistry.getPluginInstance("call-history");
    const phoneCallsInstance = pluginRegistry.getPluginInstance("phone-calls");
    if (callHistoryInstance && phoneCallsInstance) {
        callHistoryInstance.setSource(phoneCallsInstance);
    }
    for (const id of Object.keys(pluginExtensions)) {
        try {
            await pluginRegistry.activate(id);
        }
        catch (e) {
            console.warn(`Failed to activate plugin "${id}":`, e);
        }
    }
}
async function buildCore() {
    const llm = new NeuroclawLLM();
    const pipeline = new NeuroPipeline();
    // One brain here too: back the plugin MoE with the language brain's own
    // mesh so this boot path doesn't rebuild the fracture src/index.ts closes --
    // plugin neurons and language neurons belong to the same all-to-all network.
    const pluginRegistry = new PluginRegistry(new MixtureOfExperts(2, llm.mesh));
    // bootstrap() only seeds placeholder PluginDefinitions/SkillDefinitions
    // (id/name pairs, no BasePlugin instance) from the static catalogs in
    // plugin_manager/registry-data.ts, purely so `plugins`/`skills` listings
    // and status counts have something to show before real registration runs.
    await pluginRegistry.bootstrap();
    await registerRealPlugins(pluginRegistry);
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
