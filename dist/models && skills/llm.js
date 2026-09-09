import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ExtensionBuilder } from "../extension-builder/builder.js";
import { ExtensionManager } from "../extension_system/manager.js";
import { BackgroundQuantizer } from "./core/quantizer.js";
import { UnifiedBrain } from "./core/unified-brain.js";
import { RLMTrainer } from "./core/rlm.js";
import { ThornsEngine } from "./core/thorns.js";
import { Tokenizer } from "./tokenizer.js";
import { NeuroclawTrainer } from "./trainer.js";
const DEFAULT_LLM_CONFIG = {
    embeddingDim: 64, hiddenDim: 128, numExperts: 4, meshNodes: 32,
    hyperNeurons: 16, hyperDimensions: 64, ballStates: 4,
    thinkSteps: 3, valuePoints: 10000, contextLength: 512,
};
export class NeuroclawLLM {
    config;
    builder;
    tokenizer;
    trainer;
    quantizer;
    brain;
    codeTrainer;
    predictorMode = "word";
    rlmTrainer;
    thornsEngine;
    projectId = "";
    built = false;
    trained = false;
    context = "";
    selfExtensions = new Map();
    selfExtensionsDir;
    generationCount = 0;
    autonomousStopRequested = false;
    /**
     * "onebrain delete backup llm" -- `hyperEngine`, when passed, is the ONE
     * real HyperDimensionalEngine this instance's UnifiedBrain computes
     * through, instead of building a private second one. NeuroclawSystem
     * (src/index.ts) passes its own NeuroPipeline's engine here so that a
     * chat reply (this class) and everything else that touches the live
     * mesh (the Zip Loop doorway, continuous learning, every net skill
     * graft -- all of which go through that same NeuroPipeline) are the
     * same running brain, not two that happen to sit in the same process.
     * Omitted, this class builds its own engine (every other caller --
     * interface/main.ts's CLI/legacy web boot, tests, model-manager.js --
     * still gets a real, working, standalone LLM unchanged).
     */
    constructor(config = {}, hyperEngine = null) {
        this.config = { ...DEFAULT_LLM_CONFIG, ...config };
        this.builder = new ExtensionBuilder();
        this.tokenizer = new Tokenizer();
        this.selfExtensionsDir = this.config.selfExtensionsDir ?? join(homedir(), ".neuroclaw", "extensions");
        if (!existsSync(this.selfExtensionsDir)) {
            mkdirSync(this.selfExtensionsDir, { recursive: true });
        }
        // The versioned, dependency-aware, permissioned extension registry
        // (extension_system/) is the durable record of record for every
        // self-created extension -- a separate rootDir from selfExtensionsDir
        // so its own <id>/<version>/manifest.json+payload.bin layout never
        // collides with the flat model.json/index.jsonl files above.
        this.extensionManager = new ExtensionManager({ rootDir: join(this.selfExtensionsDir, "registry") });
        this.extensionManager.load();
        this.trainer = new NeuroclawTrainer(this.tokenizer.getVocabSize(), this.tokenizer.getCharToId(), this.tokenizer.getIdToChar(), { hiddenDim: this.config.hiddenDim });
        // A second, independently-trained predictor over the same char
        // vocabulary -- kept separate from `trainer` so training on code
        // (trainOnCode) never dilutes the prose n-gram statistics, and vice
        // versa. Selected at generation time via predictorMode.
        this.codeTrainer = new NeuroclawTrainer(this.tokenizer.getVocabSize(), this.tokenizer.getCharToId(), this.tokenizer.getIdToChar(), { hiddenDim: this.config.hiddenDim });
        this.quantizer = new BackgroundQuantizer({
            enabled: true, bits: 4, method: "mixed",
            calibrationSamples: 128, excludeLayers: []
        });
        // UnifiedBrain is the single module that *is* the model: value
        // system, MoE, the nonlinear all-connected mesh, hyperdimensional
        // thinking, the (always-on) quantum net, and zip-loop binary I/O.
        // Everything below that used to construct its own separate
        // ValueRangeAllocator/MoERouter/NeuronMesh/HyperDimensionalEngine now
        // reads them from this one instance via the getters below, instead
        // of being a fourth disconnected copy of the same subsystems.
        this.brain = new UnifiedBrain({
            embeddingDim: this.config.embeddingDim,
            hiddenDim: this.config.hiddenDim,
            numExperts: this.config.numExperts,
            meshNodes: this.config.meshNodes,
            hyperDimensions: this.config.hyperDimensions,
            hyperNeurons: this.config.hyperNeurons,
            ballStates: this.config.ballStates,
            valuePoints: this.config.valuePoints,
            // Unused -- UnifiedBrain always runs quantum interference now.
            quantumEnabled: this.config.quantumEnabled ?? true,
            persistDir: this.config.selfExtensionsDir ? join(this.config.selfExtensionsDir, "brain") : undefined,
            hyperEngine: hyperEngine ?? undefined,
        });
        this.thornsEngine = new ThornsEngine();
        this.rlmTrainer = new RLMTrainer({
            hiddenDim: this.config.hiddenDim, stateDim: this.config.hiddenDim,
            actionDim: this.tokenizer.getVocabSize(), explorationRate: 0.1,
            discountFactor: 0.99, replayBufferSize: 10000, batchSize: 32,
            thinkSteps: this.config.thinkSteps
        });
        this.thornsEngine.connectCore(this.valueAllocator, this.mesh, this.hyperEngine, this.rlmTrainer, this.moeRouter);
    }
    /** Zero-sum elastic value budget -- delegates to UnifiedBrain, the single source of truth. */
    get valueAllocator() { return this.brain.getVale(); }
    /** Mixture of Experts router -- delegates to UnifiedBrain. */
    get moeRouter() { return this.brain.getMoE(); }
    /** Nonlinear, all-connected neuron mesh -- delegates to UnifiedBrain. */
    get mesh() { return this.brain.getMesh(); }
    /** Hyperdimensional thinking engine -- delegates to UnifiedBrain. */
    get hyperEngine() { return this.brain.getHyper(); }
    /**
     * "add quantum interference always on" -- UnifiedBrain.think() now runs
     * this stage unconditionally. Kept as a no-op passthrough only so
     * existing callers (the Settings page, /api/settings/brain) don't break.
     */
    setQuantumEnabled(enabled) { this.brain.setQuantumEnabled(enabled); }
    isQuantumEnabled() { return this.brain.isQuantumEnabled(); }
    /** Selects which predictor generate() samples from: the prose model or the code model. */
    setPredictorMode(mode) { this.predictorMode = mode === "code" ? "code" : "word"; }
    getPredictorMode() { return this.predictorMode; }
    /** Trains the separate code predictor (does not touch the prose trainer's statistics). */
    async trainOnCode(code) { await this.codeTrainer.train(code); }
    /**
     * Builds the extension-builder project that backs this model. Its neuron
     * baseline is real, not synthetic filler:
     *  - if `code` is supplied (the foreground case -- e.g. code the user
     *    just gave you), that code becomes the model via CodeToNet
     *    (importCodeToNet), same as the manual "code net" builder action.
     *  - otherwise the baseline is imported directly from UnifiedBrain's own
     *    live mesh/vale snapshot (importFromBrainSnapshot) -- the actual
     *    connected model, not a randomly-wired stand-in.
     */
    async build(code) {
        if (this.built)
            return;
        const project = this.builder.createProject("NeuroClaw LLM", "Full-stack neural language model");
        this.projectId = project.id;
        let neuronIds;
        if (typeof code === "string" && code.length > 0) {
            const bytes = Buffer.from(code, "utf-8");
            const n = this.builder.importCodeToNet(this.projectId, "user-code", bytes);
            neuronIds = n ? [n.id] : [];
        }
        else {
            const snapshot = this.brain.save();
            const imported = this.builder.importFromBrainSnapshot(this.projectId, snapshot);
            neuronIds = imported ? Array.from(project.neurons.keys()) : [];
        }
        this.builder.addAPIOutputLayer(this.projectId, {
            endpoints: [], port: 8080, host: "localhost", authRequired: false
        });
        const neuronStates = neuronIds.map((id) => ({
            id, name: "", value: 0, learningRate: 0,
            states: new Map(), connections: new Map(),
            expertGroup: null, active: true
        }));
        this.valueAllocator.initializeNeurons(neuronStates);
        this.builder.trainNetSearch(this.projectId, 50);
        await this.trainer.train();
        this.trained = true;
        this.built = true;
    }
    /** Explicit foreground code-first build: the given code becomes the model's actual baseline, not background filler. */
    async buildFromCode(code) {
        this.built = false;
        await this.build(code);
    }
    async trainOnText(text) {
        await this.trainer.train(text);
        this.trained = true;
    }
    /**
     * Teach the language model something new without erasing what it already
     * knows. trainOnText() calls train(), which rebuilds every table from the
     * one string it is given -- so two trainOnText() calls do not teach two
     * things, the second erases the first. learnText() accumulates instead
     * (see NeuroclawTrainer.learnText), which is what makes teaching a fact
     * and then asking about it actually work.
     */
    async learnText(text) {
        await this.trainer.learnText(text);
        this.trained = true;
    }
    /** Characters of accumulated teaching material behind the prose predictor. */
    getLearnedCorpusSize() { return this.trainer.getCorpusSize(); }
    async generate(prompt, options = {}) {
        if (!this.built)
            await this.build();
        this.context = (this.context + ' ' + prompt).slice(-this.config.contextLength);
        // Step 1: THORNS — intent detection, cross-check, simulation, plan.
        // These signals now feed expert routing/RLM reward only -- they no
        // longer get spliced into the visible response text (see below).
        const thornsOutput = await this.thornsEngine.think(prompt);
        if (thornsOutput.intent.confidence > 0.3) {
            this.moeRouter.addExpert({
                id: `thorns_${thornsOutput.intent.intent}_${this.generationCount}`,
                name: `Thorns:${thornsOutput.intent.intent}`,
                specialization: 'thorns-intent',
            });
        }
        // Step 2: Embedding — resize to embeddingDim for correct MoE input
        const lastChar = prompt[prompt.length - 1] ?? ' ';
        const lastCharId = this.tokenizer.charToTokenId(lastChar);
        const rawEmb = this.trainer.getEmbedding(lastCharId) ??
            this.tokenizer.tokenToEmbedding(lastCharId, this.config.hiddenDim);
        const embedding = new Float32Array(this.config.embeddingDim);
        for (let i = 0; i < this.config.embeddingDim; i++)
            embedding[i] = rawEmb[i] ?? 0;
        // Steps 3-5: one real forward pass through UnifiedBrain -- MoE routing,
        // the nonlinear all-connected mesh, hyperdimensional processing, and
        // (if enabled) quantum interference -- replacing three separately
        // constructed, disconnected copies of the same subsystems.
        const thinkResult = await this.brain.think(Buffer.from(prompt, 'utf-8'), embedding);
        // Step 6: RLM — think through possibilities, avoid repeated actions
        const stateVec = new Float32Array(this.config.hiddenDim);
        for (let i = 0; i < Math.min(thinkResult.hiddenState.length, this.config.hiddenDim); i++) {
            stateVec[i] = thinkResult.hiddenState[i] ?? 0;
        }
        const rlmDecision = this.rlmTrainer.selectAction(stateVec);
        // Step 7: real generation -- autoregressively sample from the
        // predictor's own probability distribution (previously computed but
        // never called: NeuroclawTrainer.predict() + sampleFromProbs()) over
        // the selected vocabulary (word or code, per predictorMode), instead
        // of a hand-written template wrapped around the subsystem signals.
        const predictor = this.predictorMode === 'code' ? this.codeTrainer : this.trainer;
        const temperature = options.temperature ?? 0.8;
        const maxTokens = options.maxTokens ?? 80;
        let generated = this.generateTokens(this.context, predictor, maxTokens, temperature);
        // A completely empty decode (e.g. the very first token sampled to
        // end-of-sequence) gets one retry at a higher temperature -- THORNS'
        // own templated .response never becomes the visible output, even as
        // a fallback.
        if (generated.trim().length === 0) {
            generated = this.generateTokens(this.context, predictor, maxTokens, Math.min(1.5, temperature + 0.4));
        }
        const output = generated.trim();
        // Zero-sum value update: higher-performing experts gain value points
        const perf = thornsOutput.crossCheck.overallConfidence;
        this.brain.applyValueFeedback(perf, thinkResult.expertContributions);
        // RLM experience replay
        this.rlmTrainer.addExperience({
            state: stateVec, action: rlmDecision.action,
            reward: perf, nextState: embedding,
            done: false, thinkingSteps: rlmDecision.thinkingSteps,
            priority: perf, timestamp: Date.now(),
        });
        this.rlmTrainer.train();
        // THORNS iterative review: if confidence is low, take a second read
        // on the prompt and let it inform the *next* RLM training signal --
        // it's feedback for learning, not more text stapled onto the answer.
        const reviewThreshold = 0.5;
        if (thornsOutput.crossCheck.overallConfidence < reviewThreshold || thornsOutput.intent.intent === 'query') {
            const reviewOutput = await this.thornsEngine.think(`review: ${prompt}`);
            if (reviewOutput.crossCheck.overallConfidence > thornsOutput.crossCheck.overallConfidence) {
                this.rlmTrainer.addExperience({
                    state: stateVec, action: rlmDecision.action,
                    reward: reviewOutput.crossCheck.overallConfidence,
                    nextState: embedding, done: false,
                    thinkingSteps: rlmDecision.thinkingSteps,
                    priority: reviewOutput.crossCheck.overallConfidence,
                    timestamp: Date.now(),
                });
            }
        }
        // Confidence lives underneath the response, on its own line -- never
        // interleaved into the generated text itself.
        const confidencePct = (perf * 100).toFixed(0);
        let finalOutput = `${output}\n\nConfidence: ${confidencePct}%`;
        // Every 5 generations create a memory extension (saved without → installed with quantization)
        this.generationCount++;
        if (this.generationCount % 5 === 0)
            await this.createSelfExtension(prompt, finalOutput);
        // Continuous context (Section 7): if relevant prior conversation turns
        // were supplied, ground the response in them so the answer is not
        // computed as an isolated event. Done after createSelfExtension so the
        // stored extension keeps the clean, memory-free output.
        if (Array.isArray(options.memoryContext) && options.memoryContext.length > 0) {
            const grounding = options.memoryContext.map((m) => `  • ${String(m).slice(0, 120)}`).join('\n');
            finalOutput = `${finalOutput}\n\n[Grounded in ${options.memoryContext.length} related memory]\n${grounding}`;
        }
        return finalOutput;
    }
    /** Real autoregressive decode: samples one character at a time from `predictor`'s own distribution. */
    generateTokens(seedContext, predictor, maxTokens, temperature) {
        let context = seedContext;
        let generated = '';
        const eos = this.tokenizer.getSpecialTokens().eos;
        for (let i = 0; i < maxTokens; i++) {
            const probs = predictor.predict(context.slice(-8));
            const nextId = this.sampleFromProbs(probs, temperature);
            if (nextId === eos)
                break;
            const ch = this.tokenizer.tokenIdToChar(nextId);
            generated += ch;
            context += ch;
        }
        return generated;
    }
    /**
     * Keeps running -- pulls the next prompt, generates, hands the result to
     * onOutput -- until stopped. This is the "not autonomous" gap closed:
     * previously every entry point was one request in, one response out,
     * with nothing that kept going on its own.
     */
    async runAutonomous(nextPrompt, onOutput, shouldStop = () => false, idleDelayMs = 25) {
        this.autonomousStopRequested = false;
        while (!this.autonomousStopRequested && !shouldStop()) {
            const prompt = await nextPrompt();
            if (prompt === null || prompt === undefined) {
                await new Promise((resolve) => setTimeout(resolve, idleDelayMs));
                continue;
            }
            const output = await this.generate(prompt);
            await onOutput(output);
        }
    }
    requestAutonomousStop() { this.autonomousStopRequested = true; }
    /** The model's own way of persisting its live neuron state and turning the autonomous loop off. */
    async saveAndStop() {
        const snapshot = this.brain.save();
        this.requestAutonomousStop();
        this.brain.requestStop();
        return snapshot;
    }
    async createSelfExtension(prompt, output) {
        const extId = `self_ext_${this.generationCount}`;
        const extProject = this.builder.createProject(`Memory: ${prompt.slice(0, 30)}`, "Self-authored extension storing learned patterns");
        const inputTokens = this.tokenizer.encode(prompt.slice(0, 20));
        const outputTokens = this.tokenizer.encode(output.slice(0, 20));
        const inputIds = [];
        const outputIds = [];
        for (let i = 0; i < Math.min(inputTokens.length, 10); i++) {
            const n = this.builder.addNeuron(extProject.id, `mem_in_${inputTokens[i]}`, 0);
            if (n) {
                inputIds.push(n.id);
            }
        }
        for (let i = 0; i < Math.min(outputTokens.length, 10); i++) {
            const n = this.builder.addNeuron(extProject.id, `mem_out_${outputTokens[i]}`, 1);
            if (n) {
                outputIds.push(n.id);
            }
        }
        for (const fromId of inputIds) {
            for (const toId of outputIds) {
                const weight = (Math.random() - 0.5) * 0.5;
                this.builder.connectNeurons(extProject.id, fromId, toId, weight);
            }
        }
        const saved = this.builder.saveWithoutQuantization(extProject.id);
        if (saved) {
            this.selfExtensions.set(extId, saved);
            const extDir = join(this.selfExtensionsDir, extId);
            if (!existsSync(extDir))
                mkdirSync(extDir, { recursive: true });
            writeFileSync(join(extDir, "model.json"), saved, "utf-8");
            const quantized = await this.builder.installWithQuantization(extProject.id, { bits: 4 });
            if (quantized)
                writeFileSync(join(extDir, "model.q4.json"), quantized, "utf-8");
            appendFileSync(join(this.selfExtensionsDir, "index.jsonl"), JSON.stringify({ id: extId, prompt: prompt.slice(0, 100), time: Date.now() }) + "\n", "utf-8");
            // Register the same payload with the real extension registry so it
            // is versioned, permission-gated, and content-hash verifiable --
            // best-effort: a registry failure must never break self-extension
            // creation, which the MoE routing above already depends on.
            try {
                const record = await this.extensionManager.autoCreate({
                    id: extId,
                    name: `Memory: ${prompt.slice(0, 30)}`,
                    kind: "memory",
                    description: `Self-authored memory extension learned from: ${prompt.slice(0, 100)}`,
                    payload: Buffer.from(saved, "utf-8"),
                    createdBy: "self-extension",
                    sources: [prompt.slice(0, 100)],
                });
                await this.extensionManager.activate(record.manifest.id, record.manifest.version);
            }
            catch (err) {
                console.error(`Failed to register self-extension ${extId} with ExtensionManager:`, err);
            }
        }
        const extProj = this.builder.getProject(extProject.id);
        if (extProj) {
            this.moeRouter.addExpert({
                id: extId, name: `Memory: ${prompt.slice(0, 20)}`, specialization: "memory-recall"
            });
        }
        // The extension is now fully persisted (this.selfExtensions + disk) and
        // registered as a MoE expert -- the builder's own in-memory copy of the
        // project (neurons/connections/layers Maps) has no further purpose.
        // reloadSelfExtensions() reads only from disk/this.selfExtensions, never
        // from builder.projects, so this is inert to every other consumer.
        // Without this, every 5th generate() call on this long-lived instance
        // (the web server and CLI reuse one NeuroclawLLM/ExtensionBuilder for
        // their whole process lifetime) permanently grew builder.projects with
        // an entry nothing ever read again -- an unbounded leak on a live path.
        this.builder.deleteProject(extProject.id);
    }
    thinkAbout(prompt) {
        return this.thornsEngine.think(prompt);
    }
    async loadModel(model) {
        if (model.config) {
            const cfg = model.config;
            if (cfg.embeddingDim)
                this.config.embeddingDim = cfg.embeddingDim;
            if (cfg.hiddenDim)
                this.config.hiddenDim = cfg.hiddenDim;
            if (cfg.numExperts)
                this.config.numExperts = cfg.numExperts;
            if (cfg.contextLength)
                this.config.contextLength = cfg.contextLength;
        }
        // Reload the builder with new config if already built
        if (this.built) {
            this.built = false;
            await this.build();
        }
    }
    unloadModel() {
        this.built = false;
        this.context = '';
        this.generationCount = 0;
    }
    getActiveModel() {
        if (!this.built)
            return null;
        const stats = this.getStats();
        return { id: this.projectId, neurons: stats.neuronCount, experts: stats.expertCount };
    }
    reloadSelfExtensions() {
        const indexPath = join(this.selfExtensionsDir, "index.jsonl");
        if (!existsSync(indexPath))
            return;
        const lines = readFileSync(indexPath, "utf-8").split("\n").filter(Boolean);
        let loaded = 0;
        for (const line of lines) {
            try {
                const meta = JSON.parse(line);
                if (!this.selfExtensions.has(meta.id)) {
                    const modelPath = join(this.selfExtensionsDir, meta.id, "model.json");
                    if (existsSync(modelPath)) {
                        const data = readFileSync(modelPath, "utf-8");
                        this.selfExtensions.set(meta.id, data);
                        this.moeRouter.addExpert({
                            id: meta.id,
                            name: `Memory: ${meta.prompt.slice(0, 20)}`,
                            specialization: "memory-recall",
                        });
                        loaded++;
                    }
                }
            }
            catch { /* malformed line — skip */ }
        }
        if (loaded > 0)
            console.error(`[NeuroClaw] Reloaded ${loaded} self-extension(s)`);
    }
    async quantize() {
        if (!this.built)
            return null;
        return this.builder.installWithQuantization(this.projectId, { bits: 4 });
    }
    save() {
        if (!this.built)
            return null;
        return this.builder.saveWithoutQuantization(this.projectId);
    }
    searchNeurons(query) { return this.builder.searchNeurons(this.projectId, query); }
    netSearch(query) { return this.builder.netSearch(this.projectId, query); }
    netSearchGenerate(query, topK = 3) { return this.builder.netSearchGenerate(this.projectId, query, topK); }
    typeOutput(neuronId, inputValue) { return this.builder.typeModelOutput(this.projectId, neuronId, inputValue); }
    getStats() {
        const project = this.builder.getProject(this.projectId);
        const valueDistribution = this.valueAllocator.getDistribution();
        const moeStats = this.moeRouter.getUtilizationStats();
        return {
            built: this.built, trained: this.trained,
            trainingLoss: this.trainer.getTrainingLoss(),
            samplesProcessed: this.trainer.getSamplesProcessed(),
            neuronCount: project?.neurons.size ?? 0,
            connectionCount: project?.connections.size ?? 0,
            layerCount: project?.layers.size ?? 0,
            expertCount: this.moeRouter.getExpertCount(),
            moeUtilization: moeStats,
            valueDistribution: {
                totalPoints: valueDistribution.totalPoints,
                neuronCount: valueDistribution.neuronAllocations.length
            },
            hyperPatternsSeen: this.hyperEngine.getSeenPatternCount(),
            rlmBufferSize: this.rlmTrainer.getBufferSize(),
            rlmExplorationRate: this.rlmTrainer.getExplorationRate(),
            selfExtensionCount: this.selfExtensions.size,
            generationCount: this.generationCount,
            contextLength: this.context.length,
        };
    }
    getHyperHistory() { return this.hyperEngine.getHistory(); }
    traceNeuron(neuronId, dim, topK = 8) { return this.hyperEngine.traceNeuron(neuronId, dim, topK); }
    demoteFailingNeurons(failureId) {
        this.valueAllocator.demoteNeuron(failureId);
    }
    getBuilder() { return this.builder; }
    getExtensionManager() { return this.extensionManager; }
    getTokenizer() { return this.tokenizer; }
    getTrainer() { return this.trainer; }
    getMoERouter() { return this.moeRouter; }
    isBuilt() { return this.built; }
    sampleFromProbs(probs, temperature) {
        const logits = new Float32Array(probs.length);
        for (let i = 0; i < probs.length; i++) {
            logits[i] = Math.log(Math.max(probs[i] ?? 1e-10, 1e-10)) / Math.max(temperature, 0.01);
        }
        let maxLogit = -Infinity;
        for (let i = 0; i < logits.length; i++)
            if (logits[i] > maxLogit)
                maxLogit = logits[i];
        let sumExp = 0;
        const scaled = new Float32Array(logits.length);
        for (let i = 0; i < logits.length; i++) {
            scaled[i] = Math.exp(logits[i] - maxLogit);
            sumExp += scaled[i];
        }
        if (sumExp <= 0)
            return 4;
        for (let i = 0; i < scaled.length; i++)
            scaled[i] = scaled[i] / sumExp;
        let r = Math.random();
        for (let i = 0; i < scaled.length; i++) {
            r -= scaled[i];
            if (r <= 0)
                return i;
        }
        return scaled.length - 1;
    }
}
