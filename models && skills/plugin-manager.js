import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { createPluginInstance, pluginExtensions } from '../plugins/index.js';

// Per-plugin table mapping a short "action" name to the real method the
// underlying plugin instance exposes. Plugins not listed here are resolved
// generically (see resolveMethod) -- this table only exists for the plugins
// whose real method names don't already match the action verbs 1:1.
const ACTION_ALIASES = {
    camera: { capture: 'captureImage' },
    microphone: { record: 'startRecording', start: 'startRecording', stop: 'stopRecording' },
    notifications: { send: 'show' },
    location: { get: 'getCurrentPosition', current: 'getCurrentPosition' },
    'file-system': { read: 'readFile', write: 'writeFile', list: 'listDirectory', delete: 'deleteFile' },
    browser: { fetch: 'fetchUrl', unbookmark: 'removeBookmark' },
    calendar: { upcoming: 'getUpcoming' },
    email: { 'mark-read': 'markRead' },
    messaging: { conversation: 'getConversation', 'mark-read': 'markRead' },
    'app-diagnostics': { run: 'runDiagnostics', disk: 'checkDisk' },
    'voice-activation': { start: 'startListening', stop: 'stopListening', transcript: 'processTranscript' },
    'account-info': { info: 'getInfo', env: 'getEnv' },
    'call-history': { history: 'getCallHistory', stats: 'getStats' },
    'phone-calls': { history: 'getHistory', missed: 'getMissed' },
    robotics: {
        status: 'getStatus', 'move-joint': 'moveJoint', 'move-cartesian': 'moveCartesian',
        gripper: 'gripperControl', 'read-sensor': 'readSensor', 'read-all-sensors': 'readAllSensors',
        trajectory: 'executeTrajectory', 'e-stop': 'emergencyStop',
    },
    screenshots: { 'capture-area': 'captureArea' },
};

/** A stub SkillDefinition for skill-expert plugins (only "coding" needs one to construct). */
function skillDefinitionFor(def) {
    return {
        id: def.id,
        name: def.name,
        description: `${def.name} skill`,
        expertIndex: 0,
        specialization: def.id,
        selfAuthored: false,
    };
}

/**
 * PluginManager -- the real bridge between the neural core's action dispatch
 * and the actual OS-integration plugins in `plugins/*.ts` (the same catalog
 * `plugin_manager/registry.ts` and `NeuroclawSystem` use). Every plugin here
 * is a genuine, constructed instance of the real plugin class -- there is no
 * simulated or placeholder execution path.
 */
export class PluginManager {
    config;
    plugins;
    pluginHooks;
    constructor(config = {}) {
        this.config = {
            pluginsDirectory: config.pluginsDirectory ?? path.join(homedir(), '.neuroclaw', 'plugins'),
            autoLoad: config.autoLoad ?? true,
            maxPlugins: config.maxPlugins ?? 50,
            sandbox: config.sandbox ?? true,
            ...config
        };
        this.plugins = new Map();
        this.pluginHooks = new Map();
        this.ensureDirectory();
        this.initializeCorePlugins();
        if (this.config.autoLoad) {
            this.loadPlugins();
        }
    }
    ensureDirectory() {
        if (!fs.existsSync(this.config.pluginsDirectory)) {
            fs.mkdirSync(this.config.pluginsDirectory, { recursive: true });
        }
    }
    initializeCorePlugins() {
        for (const def of Object.values(pluginExtensions)) {
            this.registerPlugin({
                id: def.id,
                name: def.name,
                type: def.type,
                capabilities: def.capabilities,
                enabled: true,
                config: {},
            });
        }
    }
    registerPlugin(metadata) {
        if (this.plugins.size >= this.config.maxPlugins && !this.plugins.has(metadata.id)) {
            return false;
        }
        let real = null;
        let error;
        try {
            const definition = { id: metadata.id, name: metadata.name, type: metadata.type, capabilities: metadata.capabilities };
            const skillDef = metadata.type === 'skill-expert' ? skillDefinitionFor(definition) : undefined;
            real = createPluginInstance(metadata.name, definition, skillDef);
        }
        catch (err) {
            error = err instanceof Error ? err.message : String(err);
        }
        const instance = {
            metadata,
            real,
            initialized: false,
            lastUsed: 0,
            error,
        };
        this.plugins.set(metadata.id, instance);
        return true;
    }
    unregisterPlugin(pluginId) {
        return this.plugins.delete(pluginId);
    }
    enablePlugin(pluginId) {
        const instance = this.plugins.get(pluginId);
        if (!instance)
            return false;
        instance.metadata.enabled = true;
        return true;
    }
    disablePlugin(pluginId) {
        const instance = this.plugins.get(pluginId);
        if (!instance)
            return false;
        instance.metadata.enabled = false;
        instance.initialized = false;
        return true;
    }
    async initializePlugin(pluginId) {
        const instance = this.plugins.get(pluginId);
        if (!instance || !instance.metadata.enabled || !instance.real) {
            if (instance && !instance.real) {
                instance.error = instance.error ?? 'Plugin has no working implementation';
            }
            return false;
        }
        try {
            await instance.real.onActivate(this.createContext(pluginId));
            instance.initialized = true;
            instance.error = undefined;
            instance.lastUsed = Date.now();
            return true;
        }
        catch (err) {
            instance.error = err instanceof Error ? err.message : String(err);
            return false;
        }
    }
    createContext(pluginId) {
        const dataDir = path.join(this.config.pluginsDirectory, 'data', pluginId.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'unknown');
        return {
            pluginId,
            dataDir,
            config: this.plugins.get(pluginId)?.metadata.config ?? {},
            logger: {
                info: (message, ...args) => console.log(`[${pluginId}] INFO: ${message}`, ...args),
                warn: (message, ...args) => console.warn(`[${pluginId}] WARN: ${message}`, ...args),
                error: (message, ...args) => console.error(`[${pluginId}] ERROR: ${message}`, ...args),
                debug: (message, ...args) => console.debug(`[${pluginId}] DEBUG: ${message}`, ...args),
            },
        };
    }
    getPlugin(pluginId) {
        return this.plugins.get(pluginId);
    }
    listPlugins(type) {
        const all = Array.from(this.plugins.values()).map(p => p.metadata);
        if (type) {
            return all.filter(p => p.type === type);
        }
        return all;
    }
    getEnabledPlugins() {
        return Array.from(this.plugins.values())
            .filter(p => p.metadata.enabled)
            .map(p => p.metadata);
    }
    getInitializedPlugins() {
        return Array.from(this.plugins.values())
            .filter(p => p.initialized)
            .map(p => p.metadata);
    }
    loadPlugins() {
        if (!fs.existsSync(this.config.pluginsDirectory)) {
            return;
        }
        const files = fs.readdirSync(this.config.pluginsDirectory);
        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const filePath = path.join(this.config.pluginsDirectory, file);
                    const raw = fs.readFileSync(filePath, 'utf-8');
                    const saved = JSON.parse(raw);
                    // Only restore bookkeeping (enabled/config) for a plugin we already
                    // constructed a real implementation for -- never trust a JSON file
                    // on disk to invent a plugin identity out of thin air.
                    const existing = this.plugins.get(saved.id);
                    if (existing) {
                        existing.metadata.enabled = saved.enabled ?? existing.metadata.enabled;
                        existing.metadata.config = saved.config ?? existing.metadata.config;
                    }
                }
                catch (error) {
                    console.error(`Failed to load plugin from ${file}:`, error);
                }
            }
        }
    }
    savePlugin(pluginId) {
        const instance = this.plugins.get(pluginId);
        if (!instance)
            return false;
        try {
            const filePath = path.join(this.config.pluginsDirectory, `${pluginId}.json`);
            const json = JSON.stringify(instance.metadata, null, 2);
            fs.writeFileSync(filePath, json, 'utf-8');
            return true;
        }
        catch (error) {
            console.error(`Failed to save plugin ${pluginId}:`, error);
            return false;
        }
    }
    saveAllPlugins() {
        for (const pluginId of this.plugins.keys()) {
            this.savePlugin(pluginId);
        }
    }
    updatePluginConfig(pluginId, config) {
        const instance = this.plugins.get(pluginId);
        if (!instance)
            return false;
        instance.metadata.config = { ...instance.metadata.config, ...config };
        return true;
    }
    registerHook(hookName, callback) {
        if (!this.pluginHooks.has(hookName)) {
            this.pluginHooks.set(hookName, new Set());
        }
        this.pluginHooks.get(hookName).add(callback);
    }
    unregisterHook(hookName, callback) {
        const hooks = this.pluginHooks.get(hookName);
        if (hooks) {
            hooks.delete(callback);
        }
    }
    async executeHook(hookName, data) {
        const hooks = this.pluginHooks.get(hookName);
        if (!hooks)
            return [];
        const results = [];
        for (const hook of hooks) {
            try {
                const result = await hook(data);
                results.push(result);
            }
            catch (error) {
                console.error(`Hook ${hookName} failed:`, error);
            }
        }
        return results;
    }
    /** Resolve `action` to a real method name on `target`, or null if none exists. */
    resolveMethod(pluginId, target, action) {
        const alias = ACTION_ALIASES[pluginId]?.[action];
        if (alias && typeof target[alias] === 'function')
            return alias;
        if (typeof target[action] === 'function')
            return action;
        const camel = action.replace(/[-_](.)/g, (_, c) => c.toUpperCase());
        if (typeof target[camel] === 'function')
            return camel;
        return null;
    }
    /**
     * Execute `action` against the real plugin implementation. `data.args`,
     * if present, is spread as positional arguments to the resolved method;
     * otherwise `data` itself (minus nothing -- callers pass exactly what the
     * method needs) is passed as a single argument. Plugins that speak a
     * structured message protocol instead of discrete methods (multi-input)
     * are dispatched through `onMessage`.
     */
    async executePlugin(pluginId, action, data = {}) {
        const instance = this.plugins.get(pluginId);
        if (!instance || !instance.initialized || !instance.real) {
            return { error: 'Plugin not initialized' };
        }
        instance.lastUsed = Date.now();
        const target = instance.real;
        const methodName = this.resolveMethod(pluginId, target, action);
        try {
            if (methodName) {
                const args = Array.isArray(data?.args) ? data.args : (data !== undefined && data !== null ? [data] : []);
                const result = await target[methodName](...args);
                return { success: true, data: result };
            }
            if (typeof target.onMessage === 'function') {
                const result = await target.onMessage({ type: action, action, ...(data && typeof data === 'object' ? data : {}) });
                if (result != null)
                    return { success: true, data: result };
            }
            return { error: `Plugin ${pluginId} has no handler for action '${action}'` };
        }
        catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
        }
    }
    getPluginStats() {
        const byType = {};
        for (const instance of this.plugins.values()) {
            const t = instance.metadata.type;
            byType[t] = (byType[t] || 0) + 1;
        }
        return {
            total: this.plugins.size,
            enabled: this.getEnabledPlugins().length,
            initialized: this.getInitializedPlugins().length,
            byType,
        };
    }
    searchPlugins(query) {
        const lowerQuery = query.toLowerCase();
        return this.listPlugins().filter(plugin => plugin.name.toLowerCase().includes(lowerQuery) ||
            plugin.id.toLowerCase().includes(lowerQuery));
    }
    getConfig() {
        return { ...this.config };
    }
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * Auto-update plugin metadata from the source registry.
     * Checks for updated capabilities, names, or new plugins.
     */
    async autoUpdatePlugins() {
        const updates = [];
        const currentIds = new Set(this.plugins.keys());
        // Check for updates to existing plugins
        for (const [pluginId, instance] of this.plugins) {
            const def = Object.values(pluginExtensions).find(d => d.id === pluginId);
            if (def && instance.metadata) {
                let updated = false;
                if (def.capabilities?.length !== instance.metadata.capabilities?.length) {
                    instance.metadata.capabilities = [...(def.capabilities || [])];
                    updated = true;
                }
                if (def.name !== instance.metadata.name) {
                    instance.metadata.name = def.name;
                    updated = true;
                }
                if (updated) {
                    updates.push({ pluginId, type: 'metadata_updated' });
                }
            }
        }
        // Register any new plugins from the registry that aren't loaded yet
        for (const def of Object.values(pluginExtensions)) {
            if (!currentIds.has(def.id)) {
                const registered = this.registerPlugin({
                    id: def.id,
                    name: def.name,
                    type: def.type,
                    capabilities: def.capabilities,
                    enabled: true,
                    config: {},
                });
                if (registered) {
                    updates.push({ pluginId: def.id, type: 'new_plugin_registered' });
                }
            }
        }
        return updates;
    }
    async shutdown() {
        for (const [pluginId, instance] of this.plugins) {
            if (instance.initialized && instance.real) {
                try {
                    await instance.real.onDeactivate();
                }
                catch { /* best effort */ }
            }
            this.disablePlugin(pluginId);
        }
        this.saveAllPlugins();
    }
}
