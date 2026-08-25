import { PLUGIN_LIST, LANGUAGE_SKILLS } from "./registry-data.js";
import { MixtureOfExperts } from "../models && skills/core/onebrain.js";
/** Strips anything but alphanumerics/hyphen/underscore, so the id can never contain a path separator or "..". */
function sanitizePluginIdForPath(pluginId) {
    return pluginId.replace(/[^a-zA-Z0-9_-]+/g, "_") || "unknown";
}
export class PluginRegistry {
    constructor(moe) {
        this.plugins = new Map();
        this.definitions = new Map();
        this.skills = new Map();
        this.skillPluginMap = new Map();
        this.activePlugins = new Set();
        this.intentMap = {};
        /** Each registered plugin's neuron ids in `moe`'s shared mesh, set once in register(). */
        this.pluginNeuronIds = new Map();
        this.moe = moe ?? new MixtureOfExperts();
    }
    /** The shared neural mesh every registered plugin's neurons live in. */
    getMoE() {
        return this.moe;
    }
    /** A registered plugin's real neuron ids in the shared mesh, if any (absent for an id that was never register()'d). */
    getPluginNeuronIds(pluginId) {
        return this.pluginNeuronIds.get(pluginId);
    }
    register(definition, instance) {
        this.definitions.set(definition.id, definition);
        this.plugins.set(definition.id, instance);
        // Give the plugin real neurons in the shared mesh, wired all-to-all into
        // everything else already there (addExpert() -> NeuronMesh.addNode()).
        // skill-expert plugins get a full MoE expert group (multiple neurons,
        // scored by the router); api-connection plugins (file system, email,
        // browser, ...) get one presence neuron -- lighter, since their actual
        // capability genuinely can't be reduced to neuron weights (reading a
        // file or sending an email requires executing real I/O, not a weighted
        // sum), but their *activity* still becomes a real, wired part of the
        // mesh's propagation once dispatch() actually uses them (see
        // firePluginNeurons() below), not just a side-channel log entry.
        if (!this.moe.getExpert(definition.id)) {
            const neuronCount = definition.type === "skill-expert" ? 4 : 1;
            const expert = this.moe.addExpert(definition.id, definition.name, definition.capabilities?.[0] ?? definition.id, neuronCount);
            this.pluginNeuronIds.set(definition.id, expert.neuronIds);
        }
    }
    async activate(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) {
            throw new Error(`Plugin ${pluginId} not found`);
        }
        const context = this.createContext(pluginId);
        await plugin.onActivate(context);
        this.activePlugins.add(pluginId);
    }
    async deactivate(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) {
            throw new Error(`Plugin ${pluginId} not found`);
        }
        await plugin.onDeactivate();
        this.activePlugins.delete(pluginId);
    }
    registerSkill(skill, pluginId) {
        this.skills.set(skill.id, skill);
        this.skillPluginMap.set(skill.id, pluginId);
    }
    unregisterSkill(skillId) {
        this.skills.delete(skillId);
        this.skillPluginMap.delete(skillId);
    }
    listPlugins() {
        return Array.from(this.definitions.values());
    }
    listActivePlugins() {
        return Array.from(this.activePlugins).map((id) => this.definitions.get(id));
    }
    listSkills() {
        return Array.from(this.skills.values());
    }
    listActiveSkills() {
        return Array.from(this.skills.values()).filter((skill) => this.activePlugins.has(this.skillPluginMap.get(skill.id) ?? ""));
    }
    getPlugin(pluginId) {
        return this.definitions.get(pluginId);
    }
    getPluginInstance(pluginId) {
        return this.plugins.get(pluginId);
    }
    getSkill(skillId) {
        return this.skills.get(skillId);
    }
    getPluginCount() {
        return this.definitions.size;
    }
    getSkillCount() {
        return this.skills.size;
    }
    async bootstrap() {
        for (const pluginName of PLUGIN_LIST) {
            const definition = {
                id: pluginName.toLowerCase().replace(/\s+/g, "-"),
                name: pluginName,
                type: "api-connection",
                capabilities: [],
            };
            this.definitions.set(definition.id, definition);
        }
        for (const lang of LANGUAGE_SKILLS) {
            const skill = {
                id: lang.toLowerCase().replace(/\s+/g, "-"),
                name: lang,
                description: `Skill for ${lang}`,
                expertIndex: 0,
                specialization: lang,
                selfAuthored: true,
            };
            this.skills.set(skill.id, skill);
        }
    }
    setIntentMap(map) {
        this.intentMap = map;
    }
    // Route an input to the most relevant active plugin based on intent keyword
    async dispatch(input, intent) {
        const intentToPlugins = {
            ...{
                command: ['tools', 'self-heal', 'terminal', 'file-system'],
                creation: ['skill-maker', 'plugin-maker', 'wiki', 'file-system', 'browser'],
                // skill-maker always succeeds (even on empty input, it returns a
                // usage message rather than null), so the generic "creation" bucket
                // above can never actually reach plugin-maker regardless of caller
                // intent -- a real request for an *extension* would silently get a
                // skill instead. These give a caller that already knows which one it
                // wants a way to actually reach it.
                "skill-creation": ['skill-maker', 'file-system', 'browser'],
                "extension-creation": ['plugin-maker', 'file-system', 'browser'],
                // Same reasoning as the two buckets above: 'wiki' placed after
                // skill-maker/plugin-maker in the generic "creation" bucket would
                // never actually be reached, since skill-maker always returns a
                // non-null usage message even on unrelated input. A caller that
                // wants docs/SKILL_ACQUISITION_LOOP.md's "push the wiki page" step
                // specifically needs its own intent to actually reach WikiPlugin.
                documentation: ['wiki', 'file-system', 'browser'],
                exploration: ['browser', 'file-system'],
                // 'computer-access' is strictly non-greedy (onMessage returns null
                // unless the text names an access command), so it sits first in these
                // buckets without absorbing everything routed here. It has to be
                // reachable from ordinary phrasing: "turn off computer access" is the
                // one sentence that must always work.
                desktop: ['computer-access', 'multi-input'],
                input: ['computer-access', 'multi-input'],
                workspace: ['computer-access', 'multi-input'],
                access: ['computer-access'],
                terminal: ['computer-access', 'terminal'],
                // ToolsPlugin is strictly non-greedy: onMessage() returns null unless
                // the text actually names one of its tools, so unlike skill-maker it
                // can sit FIRST in a bucket without absorbing everything routed there.
                // It is listed ahead of the others precisely because when it does
                // match, an exact computed answer beats anything further down the
                // list improvising one.
                tools: ['tools'],
                query: ['tools', 'browser'],
                analysis: ['tools', 'file-system', 'browser'],
            },
            ...this.intentMap,
        };
        // Unmapped intents (plain conversation) get no plugin candidates — the
        // runner falls through to full neural generation instead of a web search.
        const baseCandidates = intentToPlugins[intent] ?? [];
        // THORNS' 'command'/'creation' intents come from generic verbs ("make",
        // "create", "write", ...) with no sense of WHAT is being made -- e.g.
        // "make a skill for X" lands as 'command' intent, where skill-maker
        // isn't even a candidate, so it could never be reached from that
        // ordinary phrasing (only from the dedicated 'skill-creation' intent a
        // different, non-chat call site uses). Reading the message's own
        // explicit target noun ("skill"/"plugin"/"extension"/"wiki") lets a
        // plain chat message reach the right one-shot creator without needing
        // the caller to already know which specific intent string to pass.
        // "wiki" takes priority and *excludes* skill-maker/plugin-maker
        // entirely when present: both are unconditionally greedy (return
        // non-null for literally any input, by design, for their own dedicated
        // intents -- see the skill-creation/extension-creation comment above),
        // so a wiki-directed message reaching either of them first would
        // silently create a bogus skill/plugin file instead of falling through
        // to WikiPlugin (or, failing its exact syntax, to null/neural
        // generation) -- returning nothing is a far smaller error than
        // fabricating an unwanted file on disk.
        let candidates = baseCandidates;
        if (intent === 'command' || intent === 'creation') {
            const lower = input.toLowerCase();
            if (/\bwiki\b/.test(lower)) {
                candidates = ['wiki', ...baseCandidates.filter(c => c !== 'skill-maker' && c !== 'plugin-maker')];
            }
            else if (/\bplugin\b|\bextension\b/.test(lower)) {
                candidates = ['plugin-maker', ...baseCandidates.filter(c => c !== 'skill-maker')];
            }
            else if (/\bskill\b/.test(lower)) {
                candidates = ['skill-maker', ...baseCandidates];
            }
        }
        for (const pluginId of candidates) {
            const plugin = this.plugins.get(pluginId);
            if (plugin && this.activePlugins.has(pluginId)) {
                try {
                    const result = await plugin.onMessage?.(input);
                    if (result != null) {
                        this.firePluginNeurons(pluginId);
                        return typeof result === "string" ? result : JSON.stringify(result);
                    }
                }
                catch { /* plugin failed, try next */ }
            }
        }
        return null;
    }
    /**
     * Drives a plugin's real mesh neurons to a fired state and propagates the
     * shared mesh -- so a plugin actually being used becomes a genuine part
     * of the neural system's dynamics (it can influence, and be influenced
     * by, every other neuron already wired into the same mesh), not just a
     * log line about which plugin ran. No-op for a pluginId register() never
     * gave neurons to.
     */
    firePluginNeurons(pluginId) {
        const neuronIds = this.pluginNeuronIds.get(pluginId);
        if (!neuronIds || neuronIds.length === 0)
            return;
        const meshInputs = new Map();
        for (const id of neuronIds)
            meshInputs.set(id, 1);
        this.moe.getMesh().propagate(meshInputs);
    }
    async healthCheck() {
        const results = new Map();
        for (const pluginId of this.activePlugins) {
            const plugin = this.plugins.get(pluginId);
            if (plugin && plugin.onHealthCheck) {
                try {
                    const ok = await plugin.onHealthCheck();
                    results.set(pluginId, ok);
                }
                catch {
                    results.set(pluginId, false);
                }
            }
        }
        return results;
    }
    createContext(pluginId) {
        const logger = {
            info: (message, ...args) => {
                console.log(`[${pluginId}] INFO: ${message}`, ...args);
            },
            warn: (message, ...args) => {
                console.warn(`[${pluginId}] WARN: ${message}`, ...args);
            },
            error: (message, ...args) => {
                console.error(`[${pluginId}] ERROR: ${message}`, ...args);
            },
            debug: (message, ...args) => {
                console.debug(`[${pluginId}] DEBUG: ${message}`, ...args);
            },
        };
        return {
            pluginId,
            // Sanitized rather than interpolated raw: dataDir is meant for plugins
            // to read/write their own persisted state, and an unsanitized pluginId
            // containing ".." would let path.join-style consumers escape ./data
            // entirely (the same class of bug fixed in extension_system/store.ts's
            // ExtensionStore.dir()) the moment something actually uses this field.
            dataDir: `./data/${sanitizePluginIdForPath(pluginId)}`,
            config: {},
            logger,
        };
    }
}
