import { EventEmitter } from 'node:events';
import { EncryptionManager } from './encryption.js';
import { SystemAccess } from './system-access.js';
import { embedText } from "../models && skills/core/neuro-lang.js";
export class NeuroclawRunner extends EventEmitter {
    constructor(llm, pipeline, pluginRegistry, systemAccess, multiDesktopManager) {
        super();
        this.running = false;
        this.startTime = null;
        // ── Section 4.1: continuous parallel output ─────────────────────────────
        // Two independent loops communicating only through shared pipeline state
        // (the mesh/hyperdimensional engine inside this.pipeline), not a blocking
        // call/return interface: injectInput() is a fire-and-forget write to a
        // shared queue; the output loop drains it on its own schedule and keeps
        // ticking (propagate -> QIL collapse -> zip-io append, via pipeline.run())
        // whether or not anything new was queued.
        this.continuousTimer = null;
        this.pendingInputs = [];
        this.continuousTickInFlight = false;
        this.continuousEmbeddingDim = 768;
        /** How many continuousTick() runs have actually fired since start() — real, not simulated. */
        this.continuousTickCount = 0;
        this.llm = llm;
        this.pipeline = pipeline;
        this.pluginRegistry = pluginRegistry;
        this.encryptionManager = new EncryptionManager();
        this.systemAccess = systemAccess ?? new SystemAccess({ multiDesktop: true, multiMouse: true, multiKeyboard: true });
        this.multiDesktopManager = multiDesktopManager ?? this.systemAccess.getMultiDesktop();
    }
    async generate(prompt, memoryContext) {
        if (!this.running)
            await this.start();
        // Section 4.1/7: every real prompt also feeds the continuous output
        // loop's own queue -- "the model never stopped and was autonomous and
        // never forgot the context as new prompts were added" is what
        // injectInput() is *for*; before this it was only ever a public method
        // nothing actually called, so the loop (once started) just ticked on
        // the mesh's own recurrent dynamics with no real user input reaching
        // it at all.
        this.injectInput(prompt);
        // Run THORNS analysis first to determine intent. Intent detection and
        // plugin routing always use the raw prompt, so recalled memory never
        // distorts which capability handles the request.
        const thornsOut = await this.llm.thinkAbout(prompt);
        this.emit('thought', thornsOut);
        // Try plugin dispatch: active plugins get first chance at the intent
        const pluginResult = await this.pluginRegistry.dispatch(prompt, thornsOut.intent.intent);
        if (pluginResult != null) {
            this.emit('plugin-response', { intent: thornsOut.intent.intent, result: pluginResult });
            return `[Plugin] ${pluginResult}`;
        }
        // Fall through to LLM generation (all 6 neural subsystems), grounded in any
        // relevant recalled conversation turns (continuous context, Section 7).
        return this.llm.generate(prompt, memoryContext && memoryContext.length ? { memoryContext } : undefined);
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
        // Section 4.1: the continuous output loop existed (startContinuous(),
        // continuousTick(), stopContinuous() -- the latter already called from
        // stop() below in anticipation of this) but nothing ever called
        // startContinuous() itself, so "the AI never stops" was true only of
        // the *code*, never of a running process.
        //
        // Deliberately NOT started unconditionally here, though: start() is
        // called by every NeuroclawRunner instance, including the ~65 short-lived
        // ones test/smoke.mjs constructs directly and never stops -- unconditionally
        // starting a real 200ms setInterval from every one of those left dozens of
        // live timers each still calling pipeline.run() (real mesh propagation)
        // long after their owning test had moved on, which starved later tests of
        // the event loop badly enough to hang the whole suite. The one place that
        // should genuinely run forever is the actual live web server process --
        // see WebServer.start() in interface/web-server.ts, which calls
        // startContinuous() itself, right after this start() call returns.
    }
    async stop() {
        this.stopContinuous();
        this.running = false;
        this.startTime = null;
        this.emit('shutdown', { phase: 'complete', message: 'Stopped' });
    }
    /**
     * Section 4.1: non-blocking input injection. Returns immediately — never
     * waits for the output loop to pause or finish a tick. The queued text is
     * picked up by whichever tick fires next; if none is ever queued, the
     * output loop keeps running on the mesh's own recurrent dynamics alone.
     */
    injectInput(text) {
        this.pendingInputs.push(text);
    }
    /** Whether the continuous output loop is currently running. */
    isContinuousRunning() {
        return this.continuousTimer !== null;
    }
    /**
     * Section 4.1: starts the continuous output loop. Each tick runs
     * pipeline.run() — propagate, QIL collapse, RLM thinking-steps, live
     * correction, and a zip-io append — unconditionally, on `intervalMs`,
     * regardless of whether injectInput() queued anything new. A tick that's
     * still in flight when the timer fires again is left to finish rather
     * than overlapped (Node has one thread; overlapping would race two
     * concurrent writes into the same mesh state), so "continuous" here means
     * decoupled and non-blocking for the caller, not literally simultaneous.
     */
    startContinuous(intervalMs = 200) {
        if (this.continuousTimer)
            return;
        this.continuousTimer = setInterval(() => {
            if (this.continuousTickInFlight)
                return; // previous tick still running; skip this firing
            this.continuousTickInFlight = true;
            this.continuousTick()
                .catch(err => this.emit('continuous-error', err))
                .finally(() => { this.continuousTickInFlight = false; });
        }, intervalMs);
        this.emit('continuous-start', { intervalMs });
    }
    stopContinuous() {
        if (!this.continuousTimer)
            return;
        clearInterval(this.continuousTimer);
        this.continuousTimer = null;
        this.emit('continuous-stop', {});
    }
    async continuousTick() {
        // Drain everything queued since the last tick. New injectInput() calls
        // that land *during* this tick's own (async) run() simply go into the
        // array for the *next* drain — they are never blocked by this one.
        const queued = this.pendingInputs.splice(0, this.pendingInputs.length);
        const text = queued.length > 0 ? queued.join(' ') : undefined;
        const embedding = new Float32Array(this.continuousEmbeddingDim);
        if (text) {
            const vec = embedText(text, this.continuousEmbeddingDim);
            embedding.set(vec);
        }
        const result = await this.pipeline.run(embedding, text);
        this.continuousTickCount++;
        this.emit('continuous-tick', result);
        return result;
    }
    /**
     * Real, currently-observable state of the continuous loop and its zip-io
     * context -- for a status endpoint to report honestly, not to fabricate a
     * "still thinking" message independent of whether anything is actually
     * still queued. `contextItemsHeld` is the zip loop's own item counts
     * (Section 1.10); undefined when the pipeline hasn't allocated a zipIO
     * instance yet (lazy init -- see pipeline.ts).
     */
    getContinuousStatus() {
        const zipIO = this.pipeline.getZipIO();
        return {
            running: this.isContinuousRunning(),
            tickCount: this.continuousTickCount,
            pendingInputCount: this.pendingInputs.length,
            contextItemsHeld: zipIO
                ? {
                    input: zipIO.inputLoop.getTotalContextSize(),
                    output: zipIO.outputLoop.getTotalContextSize(),
                }
                : undefined,
        };
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
    getPluginRegistry() { return this.pluginRegistry; }
}
