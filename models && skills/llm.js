import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { ExtensionBuilder } from "../extension-builder/builder.js";
import { ExtensionManager } from "../extension_system/manager.js";
import { BackgroundQuantizer } from "./core/quantizer.js";
import { UnifiedBrain } from "./core/unified-brain.js";
import { RLMTrainer } from "./core/rlm.js";
import { ThornsEngine } from "./core/thorns.js";
import { Tokenizer } from "./tokenizer.js";
import { NeuroclawTrainer } from "./trainer.js";
import { ZipLoopInterface } from "./core/onebrain.js";
import { runUntilStoppedAsync, ZIP_FOLDERS } from "./core/zip-halt.js";
const DEFAULT_LLM_CONFIG = {
    embeddingDim: 64, hiddenDim: 128, numExperts: 4, meshNodes: 32,
    hyperNeurons: 16, hyperDimensions: 64, ballStates: 4,
    thinkSteps: 3, valuePoints: 10000, contextLength: 512,
};
// "You have two AIs, and one is one brain. And then you have a normal
// LLM. I do not want the LLM. I want one brain." -- the same two
// input/two output neuron ids /api/zip-loop/run wires up, reused here so
// a chat reply and a manual zip-loop run drive the identical doorway
// into the identical mesh, not two different conventions for the same
// four neurons.
const ONE_BRAIN_NEURON_IDS = { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 };
// Bounds a chat turn's one-brain run to something an interactive reply
// can wait on. Every OUTPUT byte read is a full settle() of the mesh --
// real work, not padding (see zip-halt.ts/onebrain.ts's own comments on
// why that is expensive) -- so this is a latency knob, not a quality
// one: raising it buys the mesh more room to speak, at the cost of a
// slower reply.
const GENERATE_MAX_TICKS = 256;
// The INPUT side of a zip-loop run has no ceiling of its own (see the
// comment where this is used) -- every character sent through the
// doorway costs 8 real sendBit() calls, so this is what actually keeps
// a long prompt from turning one chat turn into a multi-minute run.
const ONE_BRAIN_PROMPT_CHAR_CAP = 200;
// Self-extensions that ship with the repo (models && skills/self_ext_*,
// including the merged self_ext_combined). Resolved from source or from
// the dist/ copy of this file, whichever is running.
function defaultBundledExtensionsDir() {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [here, resolve(here, "..", "..", "models && skills")];
    return candidates.find((d) => existsSync(join(d, "index.jsonl"))) ?? null;
}
// Both on-disk self-extension formats: the older one (neurons as
// [id, {label}] pairs, weights[conn.weightIndex], memory_input_/
// memory_output_ labels) and the current builder one (neuron objects with
// `name`, conn.weight, mem_in_/mem_out_ names).
const SELF_EXT_IN = /^(?:memory_input|mem_in)_(\d+)$/;
const SELF_EXT_OUT = /^(?:memory_output|mem_out)_(\d+)$/;
function parseSelfExtension(json) {
    const m = typeof json === "string" ? JSON.parse(json) : json;
    const neurons = new Map();
    for (const entry of m.neurons ?? []) {
        const n = Array.isArray(entry) ? entry[1] : entry;
        const label = n.label ?? n.name ?? "";
        const inMatch = SELF_EXT_IN.exec(label);
        const outMatch = SELF_EXT_OUT.exec(label);
        if (inMatch)
            neurons.set(n.id, { side: "in", token: Number(inMatch[1]) });
        else if (outMatch)
            neurons.set(n.id, { side: "out", token: Number(outMatch[1]) });
    }
    const edges = [];
    for (const entry of m.connections ?? []) {
        const c = Array.isArray(entry) ? entry[1] : entry;
        const from = neurons.get(c.fromNeuronId ?? c.from);
        const to = neurons.get(c.toNeuronId ?? c.to);
        const w = typeof c.weight === "number" ? c.weight : m.weights?.[c.weightIndex];
        if (from?.side === "in" && to?.side === "out" && typeof w === "number" && Number.isFinite(w)) {
            edges.push({ from: from.token, to: to.token, weight: w });
        }
    }
    return edges;
}
export class NeuroclawLLM {
    config;
    builder;
    tokenizer;
    trainer;
    quantizer;
    brain;
    rlmTrainer;
    thornsEngine;
    projectId = "";
    built = false;
    trained = false;
    context = "";
    selfExtensions = new Map();
    /** Parsed (inputToken -> outputToken, weight) edges per loaded self-extension, for recall. */
    selfExtensionEdges = new Map();
    selfExtensionsDir;
    bundledExtensionsDir;
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
        this.bundledExtensionsDir = this.config.bundledExtensionsDir === undefined
            ? defaultBundledExtensionsDir()
            : this.config.bundledExtensionsDir;
        // The versioned, dependency-aware, permissioned extension registry
        // (extension_system/) is the durable record of record for every
        // self-created extension -- a separate rootDir from selfExtensionsDir
        // so its own <id>/<version>/manifest.json+payload.bin layout never
        // collides with the flat model.json/index.jsonl files above.
        this.extensionManager = new ExtensionManager({ rootDir: join(this.selfExtensionsDir, "registry") });
        this.extensionManager.load();
        // Still real, still used: NOT the "other AI" that used to answer
        // chat (that was this.codeTrainer + generateTokens(), removed --
        // see generate()'s own comment). This trainer backs the mesh's
        // own INPUT representation (Step 2's embedding lookup below) and
        // the text-learning surface (trainOnText/learnText), which is
        // OneBrain's own perception, not a second voice competing with it.
        this.trainer = new NeuroclawTrainer(this.tokenizer.getVocabSize(), this.tokenizer.getCharToId(), this.tokenizer.getIdToChar(), { hiddenDim: this.config.hiddenDim });
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
        // Self-extensions survive restarts: bring back everything this
        // install created, plus the ones bundled with the repo.
        this.reloadSelfExtensions();
        if (this.bundledExtensionsDir && resolve(this.bundledExtensionsDir) !== resolve(this.selfExtensionsDir)) {
            this.reloadSelfExtensions(this.bundledExtensionsDir);
        }
        await this.registerLoadedSelfExtensions();
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
        // Step 7: real generation -- fed through OneBrain's own zip-loop
        // doorway (the same two-input/two-output-neuron path
        // /api/zip-loop/run drives), not a separately-trained char sampler
        // wrapped around the mesh's thinking. "You have two AIs... I do
        // not want the LLM. I want one brain." What comes back is
        // whatever the SAME mesh Step 3-5 just thought with actually wrote
        // to output/ -- real neuron output, chosen over sampling from
        // this.trainer's own separate distribution.
        //
        // Expensive on purpose: every output byte read is a full settle()
        // of the mesh (see zip-halt.ts/onebrain.ts's own comments on why
        // that costs real time), so a one-brain reply can take noticeably
        // longer than the old char sampler did -- GENERATE_MAX_TICKS
        // bounds that rather than eliminating it.
        //
        // The INPUT side is not bounded by maxTicks at all -- runLoop()
        // feeds the whole packed archive in before the ceiling ever
        // applies to anything (see zip-halt.ts's own comment on exactly
        // this). Fine for a manual /api/zip-loop/run file upload; fatal
        // here, where `prompt` is whatever any caller of generate() hands
        // in -- a full document, a long history-grounded turn, code being
        // trained on. A large prompt fed in whole made this hang the
        // smoke suite for minutes with zero test progress. What the mesh
        // uses to THINK (Step 3-5 above, thornsEngine, the embedding) is
        // still the untruncated prompt; only the copy sent through this
        // doorway is capped, since the doorway's cost is per BIT of
        // archive, not per character of meaning.
        const oneBrainPrompt = prompt.length > ONE_BRAIN_PROMPT_CHAR_CAP ? prompt.slice(0, ONE_BRAIN_PROMPT_CHAR_CAP) : prompt;
        const zip = new ZipLoopInterface(this.brain.getHyper(), ONE_BRAIN_NEURON_IDS);
        const oneBrainRun = await runUntilStoppedAsync(zip, { files: { [`${ZIP_FOLDERS.prompt}prompt.txt`]: oneBrainPrompt } }, { quietTicks: 32, maxTicks: GENERATE_MAX_TICKS });
        const oneBrainOutput = Object.entries(oneBrainRun.tree?.files ?? {})
            .filter(([path]) => path.startsWith(ZIP_FOLDERS.output))
            .map(([, content]) => content)
            .join('\n')
            .trim();
        // "Remember to delete every AI that is not the OneBrain." The old
        // fallback here, when one brain had nothing yet, was a SECOND,
        // separately-trained char sampler (this.trainer/this.codeTrainer)
        // answering in its place -- exactly the other AI this generate()
        // exists to not be. Removed rather than gated: what stands in when
        // one brain is silent is now a single fixed sentence, not
        // generated by anything. It is not smarter, it is not an answer,
        // and it does not pretend to be either -- it is what "the network
        // has not been taught to say anything here yet" actually looks
        // like, until real training (conversation-learning-agent.mjs,
        // grafted back into this same mesh on every boot -- see
        // web-server.ts's loadSavedExtensions()) gives it something to
        // write to output/.
        const generated = oneBrainOutput.length > 0
            ? oneBrainOutput
            : 'one brain has nothing trained to say here yet.';
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
            try { this.selfExtensionEdges.set(extId, parseSelfExtension(saved)); } catch { /* recall-only index */ }
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
    /**
     * Load self-extensions listed in `dir`/index.jsonl as MoE experts.
     * A merged extension (meta.json with `sources`) supersedes the models it
     * was built from: those source ids are not loaded separately from the
     * same directory, so combining never double-counts an expert.
     */
    reloadSelfExtensions(dir = this.selfExtensionsDir) {
        const indexPath = join(dir, "index.jsonl");
        if (!existsSync(indexPath))
            return 0;
        const lines = readFileSync(indexPath, "utf-8").split("\n").filter(Boolean);
        const metas = [];
        for (const line of lines) {
            try { metas.push(JSON.parse(line)); } catch { /* malformed line — skip */ }
        }
        const superseded = new Set();
        for (const id of new Set(metas.map((m) => m.id))) {
            const metaPath = join(dir, id, "meta.json");
            if (!existsSync(metaPath))
                continue;
            try {
                const sources = JSON.parse(readFileSync(metaPath, "utf-8")).sources;
                if (Array.isArray(sources) && existsSync(join(dir, id, "model.json")))
                    sources.forEach((s) => superseded.add(s));
            }
            catch { /* unreadable meta — treat as plain extension */ }
        }
        let loaded = 0;
        for (const meta of metas) {
            if (this.selfExtensions.has(meta.id) || superseded.has(meta.id))
                continue;
            const modelPath = join(dir, meta.id, "model.json");
            if (!existsSync(modelPath))
                continue;
            try {
                const data = readFileSync(modelPath, "utf-8");
                this.selfExtensionEdges.set(meta.id, parseSelfExtension(data));
                this.selfExtensions.set(meta.id, data);
                this.moeRouter.addExpert({
                    id: meta.id,
                    name: `Memory: ${String(meta.prompt ?? meta.name ?? meta.id).slice(0, 20)}`,
                    specialization: "memory-recall",
                });
                loaded++;
            }
            catch { /* corrupt model file — skip */ }
        }
        if (loaded > 0)
            console.error(`[NeuroClaw] Reloaded ${loaded} self-extension(s) from ${dir}`);
        return loaded;
    }
    /**
     * Record every loaded self-extension in the versioned, content-hashed
     * extension registry (extension_system/), once. Already-registered ids
     * are left alone so restarts do not mint a new version each boot.
     * Best-effort, like createSelfExtension()'s registration.
     */
    async registerLoadedSelfExtensions() {
        for (const [id, data] of this.selfExtensions) {
            try {
                if (this.extensionManager.store.listVersions(id).length > 0)
                    continue;
                const record = await this.extensionManager.autoCreate({
                    id, name: `Memory: ${id}`, kind: "memory",
                    description: `Self-authored memory extension ${id}`,
                    payload: Buffer.from(data, "utf-8"),
                    createdBy: "self-extension",
                    sources: [id],
                });
                await this.extensionManager.activate(record.manifest.id, record.manifest.version);
            }
            catch (err) {
                console.error(`Failed to register self-extension ${id} with ExtensionManager:`, err);
            }
        }
    }
    /**
     * Run the loaded self-extensions' weights on `prompt`: every input-token
     * neuron whose character occurs in the prompt fires, its weighted edges
     * feed the output-token neurons, and the strongest outputs come back.
     * This is the "store memory" half of self-built extensions actually
     * being read, not just registered.
     */
    recallFromSelfExtensions(prompt, topK = 5) {
        const active = new Set([this.tokenizer.specialTokens?.bos ?? 1]);
        for (const ch of String(prompt))
            active.add(this.tokenizer.charToTokenId(ch));
        const special = new Set(Object.values(this.tokenizer.specialTokens ?? {}));
        const scores = new Map();
        const byExtension = [];
        for (const [id, edges] of this.selfExtensionEdges) {
            let activation = 0;
            for (const e of edges) {
                if (!active.has(e.from))
                    continue;
                scores.set(e.to, (scores.get(e.to) ?? 0) + e.weight);
                activation += Math.abs(e.weight);
            }
            if (activation > 0)
                byExtension.push({ id, activation });
        }
        const outputs = [...scores.entries()]
            .filter(([token]) => !special.has(token))
            .sort((a, b) => b[1] - a[1])
            .slice(0, topK)
            .map(([token, score]) => ({ token, char: this.tokenizer.tokenIdToChar(token), score }));
        byExtension.sort((a, b) => b.activation - a.activation);
        return { outputs, extensions: byExtension };
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
}
