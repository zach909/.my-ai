import { PLUGIN_LIST, LANGUAGE_SKILLS } from "./registry-data.js";
/** Strips anything but alphanumerics/hyphen/underscore, so the id can never contain a path separator or "..". */
function sanitizePluginIdForPath(pluginId) {
    return pluginId.replace(/[^a-zA-Z0-9_-]+/g, "_") || "unknown";
}
export class PluginRegistry {
    constructor() {
        this.plugins = new Map();
        this.definitions = new Map();
        this.skills = new Map();
        this.skillPluginMap = new Map();
        this.activePlugins = new Set();
        this.intentMap = {};
    }
    register(definition, instance) {
        this.definitions.set(definition.id, definition);
        this.plugins.set(definition.id, instance);
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
                command: ['self-heal', 'terminal', 'file-system'],
                creation: ['skill-maker', 'plugin-maker', 'file-system', 'browser'],
                // skill-maker always succeeds (even on empty input, it returns a
                // usage message rather than null), so the generic "creation" bucket
                // above can never actually reach plugin-maker regardless of caller
                // intent -- a real request for an *extension* would silently get a
                // skill instead. These give a caller that already knows which one it
                // wants a way to actually reach it.
                "skill-creation": ['skill-maker', 'file-system', 'browser'],
                "extension-creation": ['plugin-maker', 'file-system', 'browser'],
                exploration: ['browser', 'file-system'],
                analysis: ['file-system', 'browser'],
                query: ['browser'],
                desktop: ['multi-input'],
                input: ['multi-input'],
                workspace: ['multi-input'],
                terminal: ['terminal'],
            },
            ...this.intentMap,
        };
        // Unmapped intents (plain conversation) get no plugin candidates — the
        // runner falls through to full neural generation instead of a web search.
        const candidates = intentToPlugins[intent] ?? [];
        for (const pluginId of candidates) {
            const plugin = this.plugins.get(pluginId);
            if (plugin && this.activePlugins.has(pluginId)) {
                try {
                    const result = await plugin.onMessage?.(input);
                    if (result != null)
                        return typeof result === "string" ? result : JSON.stringify(result);
                }
                catch { /* plugin failed, try next */ }
            }
        }
        return null;
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
