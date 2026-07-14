import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
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
        if (this.config.autoLoad) {
            this.loadPlugins();
        }
        this.initializeCorePlugins();
    }
    ensureDirectory() {
        if (!fs.existsSync(this.config.pluginsDirectory)) {
            fs.mkdirSync(this.config.pluginsDirectory, { recursive: true });
        }
    }
    initializeCorePlugins() {
        // Define core plugins
        const corePlugins = [
            {
                id: 'camera',
                name: 'Camera Plugin',
                version: '1.0.0',
                description: 'Captures images and video from camera devices',
                author: 'NeuroClaw',
                category: 'input',
                enabled: true,
                permissions: ['camera', 'filesystem'],
                dependencies: [],
                config: { resolution: '1080p', fps: 30 }
            },
            {
                id: 'microphone',
                name: 'Microphone Plugin',
                version: '1.0.0',
                description: 'Captures audio from microphone devices',
                author: 'NeuroClaw',
                category: 'input',
                enabled: true,
                permissions: ['audio', 'microphone'],
                dependencies: [],
                config: { sampleRate: 44100, channels: 2 }
            },
            {
                id: 'speaker',
                name: 'Speaker Plugin',
                version: '1.0.0',
                description: 'Outputs audio to speaker devices',
                author: 'NeuroClaw',
                category: 'output',
                enabled: true,
                permissions: ['audio', 'speaker'],
                dependencies: [],
                config: { volume: 0.8 }
            },
            {
                id: 'display',
                name: 'Display Plugin',
                version: '1.0.0',
                description: 'Displays visual output to screen',
                author: 'NeuroClaw',
                category: 'output',
                enabled: true,
                permissions: ['display', 'window'],
                dependencies: [],
                config: { fullscreen: false, resolution: '1920x1080' }
            },
            {
                id: 'terminal',
                name: 'Terminal Plugin',
                version: '1.0.0',
                description: 'Provides terminal/command line access',
                author: 'NeuroClaw',
                category: 'system',
                enabled: true,
                permissions: ['terminal', 'process'],
                dependencies: [],
                config: { shell: '/bin/bash' }
            },
            {
                id: 'filesystem',
                name: 'Filesystem Plugin',
                version: '1.0.0',
                description: 'Provides file system access',
                author: 'NeuroClaw',
                category: 'storage',
                enabled: true,
                permissions: ['filesystem', 'read', 'write'],
                dependencies: [],
                config: { allowedPaths: [homedir()] }
            },
            {
                id: 'network',
                name: 'Network Plugin',
                version: '1.0.0',
                description: 'Provides network communication capabilities',
                author: 'NeuroClaw',
                category: 'network',
                enabled: true,
                permissions: ['network', 'http', 'websocket'],
                dependencies: [],
                config: { maxConnections: 100, timeout: 30000 }
            },
            {
                id: 'clipboard',
                name: 'Clipboard Plugin',
                version: '1.0.0',
                description: 'Provides clipboard access',
                author: 'NeuroClaw',
                category: 'input',
                enabled: true,
                permissions: ['clipboard'],
                dependencies: [],
                config: {}
            },
            {
                id: 'notification',
                name: 'Notification Plugin',
                version: '1.0.0',
                description: 'Sends system notifications',
                author: 'NeuroClaw',
                category: 'output',
                enabled: true,
                permissions: ['notification'],
                dependencies: [],
                config: {}
            },
            {
                id: 'multidesktop',
                name: 'Multi-Desktop Plugin',
                version: '1.0.0',
                description: 'Manages multiple virtual desktops',
                author: 'NeuroClaw',
                category: 'system',
                enabled: true,
                permissions: ['window', 'desktop'],
                dependencies: ['display'],
                config: { maxDesktops: 10 }
            },
            {
                id: 'multimouse',
                name: 'Multi-Mouse Plugin',
                version: '1.0.0',
                description: 'Supports multiple mouse input devices',
                author: 'NeuroClaw',
                category: 'input',
                enabled: true,
                permissions: ['input', 'mouse'],
                dependencies: [],
                config: { maxMice: 4 }
            },
            {
                id: 'multikb',
                name: 'Multi-Keyboard Plugin',
                version: '1.0.0',
                description: 'Supports multiple keyboard input devices',
                author: 'NeuroClaw',
                category: 'input',
                enabled: true,
                permissions: ['input', 'keyboard'],
                dependencies: [],
                config: { maxKeyboards: 4 }
            }
        ];
        for (const plugin of corePlugins) {
            this.registerPlugin(plugin);
        }
    }
    registerPlugin(metadata) {
        if (this.plugins.size >= this.config.maxPlugins) {
            return false;
        }
        const instance = {
            metadata,
            initialized: false,
            lastUsed: 0
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
    initializePlugin(pluginId) {
        const instance = this.plugins.get(pluginId);
        if (!instance || !instance.metadata.enabled) {
            return false;
        }
        // Check dependencies
        for (const dep of instance.metadata.dependencies) {
            const depInstance = this.plugins.get(dep);
            if (!depInstance || !depInstance.metadata.enabled || !depInstance.initialized) {
                instance.error = `Dependency ${dep} not available`;
                return false;
            }
        }
        // Initialize plugin (simulated)
        instance.initialized = true;
        instance.error = undefined;
        instance.lastUsed = Date.now();
        return true;
    }
    getPlugin(pluginId) {
        return this.plugins.get(pluginId);
    }
    listPlugins(category) {
        const allPlugins = Array.from(this.plugins.values()).map(p => p.metadata);
        if (category) {
            return allPlugins.filter(p => p.category === category);
        }
        return allPlugins;
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
                    const metadata = JSON.parse(raw);
                    this.registerPlugin(metadata);
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
    executePlugin(pluginId, action, data) {
        const instance = this.plugins.get(pluginId);
        if (!instance || !instance.initialized) {
            return { error: 'Plugin not initialized' };
        }
        instance.lastUsed = Date.now();
        // Simulate plugin execution based on category
        switch (instance.metadata.category) {
            case 'input':
                return this.executeInputPlugin(instance, action, data);
            case 'output':
                return this.executeOutputPlugin(instance, action, data);
            case 'processing':
                return this.executeProcessingPlugin(instance, action, data);
            case 'storage':
                return this.executeStoragePlugin(instance, action, data);
            case 'network':
                return this.executeNetworkPlugin(instance, action, data);
            case 'system':
                return this.executeSystemPlugin(instance, action, data);
            default:
                return { error: 'Unknown plugin category' };
        }
    }
    executeInputPlugin(instance, action, data) {
        switch (instance.metadata.id) {
            case 'camera':
                if (action === 'capture') {
                    return { success: true, data: 'image_data_placeholder', timestamp: Date.now() };
                }
                break;
            case 'microphone':
                if (action === 'record') {
                    return { success: true, data: 'audio_data_placeholder', duration: data.duration || 1000 };
                }
                break;
            case 'clipboard':
                if (action === 'read') {
                    return { success: true, data: 'clipboard_content_placeholder' };
                }
                if (action === 'write') {
                    return { success: true };
                }
                break;
        }
        return { error: 'Unknown action' };
    }
    executeOutputPlugin(instance, action, data) {
        switch (instance.metadata.id) {
            case 'speaker':
                if (action === 'play') {
                    return { success: true, duration: data.duration || 1000 };
                }
                break;
            case 'display':
                if (action === 'show') {
                    return { success: true };
                }
                break;
            case 'notification':
                if (action === 'send') {
                    return { success: true, title: data.title, body: data.body };
                }
                break;
        }
        return { error: 'Unknown action' };
    }
    executeProcessingPlugin(instance, action, data) {
        return { success: true, processed: true };
    }
    executeStoragePlugin(instance, action, data) {
        switch (instance.metadata.id) {
            case 'filesystem':
                if (action === 'read') {
                    return { success: true, data: 'file_content_placeholder' };
                }
                if (action === 'write') {
                    return { success: true, bytesWritten: data.length || 0 };
                }
                if (action === 'list') {
                    return { success: true, files: ['file1.txt', 'file2.txt'] };
                }
                break;
        }
        return { error: 'Unknown action' };
    }
    executeNetworkPlugin(instance, action, data) {
        switch (instance.metadata.id) {
            case 'network':
                if (action === 'request') {
                    return { success: true, status: 200, data: 'response_placeholder' };
                }
                if (action === 'connect') {
                    return { success: true, connected: true };
                }
                break;
        }
        return { error: 'Unknown action' };
    }
    executeSystemPlugin(instance, action, data) {
        switch (instance.metadata.id) {
            case 'terminal':
                if (action === 'execute') {
                    return { success: true, exitCode: 0, output: 'command_output_placeholder' };
                }
                break;
            case 'multidesktop':
                if (action === 'switch') {
                    return { success: true, desktop: data.desktop || 0 };
                }
                if (action === 'create') {
                    return { success: true, desktop: 1 };
                }
                break;
            case 'multimouse':
                if (action === 'get') {
                    return { success: true, devices: ['mouse_0', 'mouse_1'] };
                }
                break;
            case 'multikb':
                if (action === 'get') {
                    return { success: true, devices: ['keyboard_0', 'keyboard_1'] };
                }
                break;
        }
        return { error: 'Unknown action' };
    }
    getPluginStats() {
        const byCategory = {};
        for (const instance of this.plugins.values()) {
            const cat = instance.metadata.category;
            byCategory[cat] = (byCategory[cat] || 0) + 1;
        }
        return {
            total: this.plugins.size,
            enabled: this.getEnabledPlugins().length,
            initialized: this.getInitializedPlugins().length,
            byCategory
        };
    }
    searchPlugins(query) {
        const lowerQuery = query.toLowerCase();
        return this.listPlugins().filter(plugin => plugin.name.toLowerCase().includes(lowerQuery) ||
            plugin.description.toLowerCase().includes(lowerQuery) ||
            plugin.id.toLowerCase().includes(lowerQuery));
    }
    getConfig() {
        return { ...this.config };
    }
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    shutdown() {
        // Disable all plugins
        for (const pluginId of this.plugins.keys()) {
            this.disablePlugin(pluginId);
        }
        this.saveAllPlugins();
    }
}
