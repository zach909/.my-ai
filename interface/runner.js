import { EventEmitter } from 'node:events';
import { EncryptionManager } from './encryption.js';
import { SystemAccess } from './system-access.js';
export class NeuroclawRunner extends EventEmitter {
    llm;
    pipeline;
    thesaurus;
    pluginRegistry;
    encryptionManager;
    systemAccess;
    multiDesktopManager;
    running = false;
    startTime = null;
    constructor(llm, pipeline, thesaurus, pluginRegistry, systemAccess, multiDesktopManager) {
        super();
        this.llm = llm;
        this.pipeline = pipeline;
        this.thesaurus = thesaurus;
        this.pluginRegistry = pluginRegistry;
        this.encryptionManager = new EncryptionManager();
        this.systemAccess = systemAccess ?? new SystemAccess({ multiDesktop: true, multiMouse: true, multiKeyboard: true });
        this.multiDesktopManager = multiDesktopManager ?? this.systemAccess.getMultiDesktop();
    }
    async generate(prompt) {
        if (!this.running)
            await this.start();
        // Run THORNS analysis first to determine intent
        const thornsOut = await this.llm.thinkAbout(prompt);
        this.emit('thought', thornsOut);
        // Try plugin dispatch: active plugins get first chance at the intent
        const pluginResult = await this.pluginRegistry.dispatch(prompt, thornsOut.intent.intent);
        if (pluginResult != null) {
            this.emit('plugin-response', { intent: thornsOut.intent.intent, result: pluginResult });
            return `[Plugin] ${pluginResult}`;
        }
        // Fall through to LLM generation (all 6 neural subsystems)
        return this.llm.generate(prompt);
    }
    async start() {
        if (this.running)
            return;
        this.emit('boot', { phase: 'initializing', message: 'Starting Neuroclaw...' });
        this.running = true;
        this.startTime = Date.now();
        this.emit('boot', { phase: 'llm', message: `LLM: ${this.llm.getStats().neuronCount} neurons` });
        this.emit('boot', { phase: 'encryption', message: 'Encryption ready' });
        this.emit('boot', { phase: 'system-access', message: 'System access ready' });
        // Initialize multi-desktop and virtual input devices
        try {
            const ws = await this.multiDesktopManager.initAiWorkspace();
            this.multiDesktopManager.createAiVirtualPointer();
            this.multiDesktopManager.createAiVirtualKeyboard();
            this.emit('boot', { phase: 'multi-desktop', message: `AI workspace ${ws}, virtual input devices ready` });
        }
        catch (e) {
            this.emit('boot', { phase: 'multi-desktop', message: `Multi-desktop: ${e}` });
        }
        this.emit('boot', { phase: 'plugins', message: `${this.pluginRegistry.getPluginCount()} plugins registered` });
        this.emit('ready', { message: 'Neuroclaw operational' });
    }
    async stop() {
        this.running = false;
        this.startTime = null;
        this.emit('shutdown', { phase: 'complete', message: 'Stopped' });
    }
    getStatus() {
        return {
            running: this.running,
            subsystems: {
                llm: true,
                plugins: this.pluginRegistry.getPluginCount() > 0,
                webServer: false,
                encryption: true,
                systemAccess: true,
                multiDesktop: true,
            },
            energy: { currentWatts: 0, averageWatts: 0, peakWatts: 0, totalKWh: 0 },
            uptime: this.startTime ? (Date.now() - this.startTime) / 1000 : 0,
            llm: this.llm.getStats(),
        };
    }
    isRunning() { return this.running; }
    getEncryptionManager() { return this.encryptionManager; }
    getSystemAccess() { return this.systemAccess; }
    getMultiDesktopManager() { return this.multiDesktopManager; }
    getLLM() { return this.llm; }
    getPipeline() { return this.pipeline; }
    getThesaurus() { return this.thesaurus; }
    getPluginRegistry() { return this.pluginRegistry; }
}
