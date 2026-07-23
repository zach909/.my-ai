import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ExtensionBuilder } from "../extension-builder/builder.js";
import { BackgroundQuantizer } from "./core/quantizer.js";
import { ValueRangeAllocator } from "./core/value-range.js";
import { MoERouter } from "./core/moe-router.js";
import { NeuronMesh } from "./core/mesh.js";
import { HyperDimensionalEngine } from "./core/hyperdimensional.js";
import { RLMTrainer } from "./core/rlm.js";
import { ThornsEngine } from "./core/thorns.js";
import { NeuroPipeline } from "./core/pipeline.js";
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
    valueAllocator;
    moeRouter;
    mesh;
    hyperEngine;
    rlmTrainer;
    thornsEngine;
    projectId = "";
    built = false;
    trained = false;
    context = "";
    selfExtensions = new Map();
    selfExtensionsDir;
    generationCount = 0;
    pipeline = null;
    constructor(config = {}) {
        this.config = { ...DEFAULT_LLM_CONFIG, ...config };
        this.builder = new ExtensionBuilder();
        this.tokenizer = new Tokenizer();
        this.selfExtensionsDir = this.config.selfExtensionsDir ?? join(homedir(), ".neuroclaw", "extensions");
        if (!existsSync(this.selfExtensionsDir)) {
            mkdirSync(this.selfExtensionsDir, { recursive: true });
        }
        this.trainer = new NeuroclawTrainer(this.tokenizer.getVocabSize(), this.tokenizer.getCharToId(), this.tokenizer.getIdToChar(), { hiddenDim: this.config.hiddenDim });
        this.quantizer = new BackgroundQuantizer({
            enabled: true, bits: 4, method: "mixed",
            calibrationSamples: 128, excludeLayers: []
        });
        this.valueAllocator = new ValueRangeAllocator({
            enabled: true, totalPoints: this.config.valuePoints,
            minLearningRate: 0.0001, maxLearningRate: 0.01,
            redistributionInterval: 100, decayFactor: 0.01
        });
        this.moeRouter = new MoERouter({
            numExperts: this.config.numExperts, topK: 2,
            inputDim: this.config.embeddingDim, outputDim: this.config.hiddenDim,
            expertHiddenDim: this.config.hiddenDim, loadBalancingLoss: 0.01
        });
        this.mesh = new NeuronMesh({
            nodeCount: this.config.meshNodes, initialConnectionWeight: 0.01,
            propagationSteps: 5, convergenceThreshold: 0.001,
            dampingFactor: 0.85, activationFn: "tanh"
        });
        this.hyperEngine = new HyperDimensionalEngine({
            dimensions: this.config.hyperDimensions, ballStates: this.config.ballStates,
            neuronCount: this.config.hyperNeurons, stateTransitionThreshold: 0.3,
            noveltyDecay: 0.01, historyLength: 1000
        });
        this.thornsEngine = new ThornsEngine();
        this.rlmTrainer = new RLMTrainer({
            hiddenDim: this.config.hiddenDim, stateDim: this.config.hiddenDim,
            actionDim: this.tokenizer.getVocabSize(), explorationRate: 0.1,
            discountFactor: 0.99, replayBufferSize: 10000, batchSize: 32,
            thinkSteps: this.config.thinkSteps
        });
        this.thornsEngine.connectCore(this.valueAllocator, this.mesh, this.hyperEngine, this.rlmTrainer, this.moeRouter);
        this.pipeline = new NeuroPipeline({
            embeddingDim: this.config.embeddingDim,
            hiddenDim: this.config.hiddenDim,
            meshNodes: this.config.meshNodes,
            hyperDimensions: this.config.hyperDimensions,
        });
    }
    connectThesaurus(thesaurus) {
        this.thornsEngine.connectThesaurus({
            getSynonyms: (w) => thesaurus.getSynonyms(w),
            getDefinition: (w) => thesaurus.getDefinition(w),
            getExamples: (w) => thesaurus.getExamples(w),
            lookup: (w) => {
                const e = thesaurus.lookup(w);
                return e ? { word: e.word, definition: e.definition, synonyms: e.synonyms, examples: e.examples } : undefined;
            },
        });
    }
    build() {
        if (this.built)
            return;
        const project = this.builder.createProject("NeuroClaw LLM", "Full-stack neural language model");
        this.projectId = project.id;
        const inputLayer = this.builder.addLayer(this.projectId, "Embedding Input", "input");
        const inputNeurons = [];
        for (let i = 0; i < this.config.embeddingDim; i++) {
            const n = this.builder.addNeuron(this.projectId, `embed_${i}`, 0, { x: i * 20, y: 0 });
            if (n)
                inputNeurons.push(n.id);
        }
        if (inputLayer)
            inputLayer.neurons = inputNeurons;
        const hiddenLayer = this.builder.addLayer(this.projectId, "MoE Hidden", "hidden");
        const hiddenNeurons = [];
        for (let i = 0; i < this.config.hiddenDim; i++) {
            const n = this.builder.addNeuron(this.projectId, `hidden_${i}`, 1, { x: i * 20, y: 200 });
            if (n)
                hiddenNeurons.push(n.id);
        }
        if (hiddenLayer)
            hiddenLayer.neurons = hiddenNeurons;
        const vocabSize = Math.min(this.tokenizer.getVocabSize(), this.config.hiddenDim);
        const outputLayer = this.builder.addLayer(this.projectId, "Vocab Output", "output");
        const outputNeurons = [];
        for (let i = 0; i < vocabSize; i++) {
            const n = this.builder.addNeuron(this.projectId, `vocab_${i}`, 2, { x: i * 20, y: 400 });
            if (n)
                outputNeurons.push(n.id);
        }
        if (outputLayer)
            outputLayer.neurons = outputNeurons;
        for (let i = 0; i < inputNeurons.length; i++) {
            for (let j = 0; j < hiddenNeurons.length; j++) {
                if (Math.random() < 0.3) {
                    const w = (Math.random() - 0.5) * Math.sqrt(2.0 / this.config.embeddingDim);
                    const from = inputNeurons[i];
                    const to = hiddenNeurons[j];
                    if (from && to)
                        this.builder.connectNeurons(this.projectId, from, to, w);
                }
            }
        }
        for (let i = 0; i < hiddenNeurons.length; i++) {
            for (let j = 0; j < outputNeurons.length; j++) {
                if (Math.random() < 0.3) {
                    const w = (Math.random() - 0.5) * Math.sqrt(2.0 / this.config.hiddenDim);
                    const from = hiddenNeurons[i];
                    const to = outputNeurons[j];
                    if (from && to)
                        this.builder.connectNeurons(this.projectId, from, to, w);
                }
            }
        }
        for (const nid of inputNeurons)
            this.builder.dragLabel(this.projectId, nid, "embedding");
        for (const nid of hiddenNeurons)
            this.builder.dragLabel(this.projectId, nid, "expert-hidden");
        for (const nid of outputNeurons)
            this.builder.dragLabel(this.projectId, nid, "vocab-logit");
        this.builder.addAPIOutputLayer(this.projectId, {
            endpoints: [], port: 8080, host: "localhost", authRequired: false
        });
        const allNeuronIds = [...inputNeurons, ...hiddenNeurons, ...outputNeurons];
        const neuronStates = allNeuronIds.map((id) => ({
            id, name: "", value: 0, learningRate: 0,
            states: new Map(), connections: new Map(),
            expertGroup: null, active: true
        }));
        this.valueAllocator.initializeNeurons(neuronStates);
        this.builder.trainNetSearch(this.projectId, 50);
        this.trainer.train();
        this.trained = true;
        this.built = true;
    }
    trainOnText(text) {
        this.trainer.train(text);
        this.trained = true;
    }
    async generate(prompt, options = {}) {
        if (!this.built)
            this.build();
        this.context = (this.context + ' ' + prompt).slice(-this.config.contextLength);
        // Step 1: THORNS — intent detection, cross-check, simulation, plan
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
        // Step 3: MoE — route input through mixture of experts
        const moeOutput = this.moeRouter.forward(embedding);
        // Step 4: Mesh — propagate signals across all-connected neuron mesh
        const meshInputs = new Map();
        for (let i = 0; i < Math.min(moeOutput.output.length, this.config.meshNodes); i++) {
            meshInputs.set(`neuron_${i}`, moeOutput.output[i] ?? 0);
        }
        const meshResult = this.mesh.propagate(meshInputs);
        // Step 5: Hyper-dimensional — multi-ball state update, novelty detection
        const meshArray = [];
        for (const [, v] of meshResult.finalStates) {
            if (meshArray.length < this.config.hyperDimensions)
                meshArray.push(v);
        }
        while (meshArray.length < this.config.hyperDimensions)
            meshArray.push(0);
        const hyperOutput = this.hyperEngine.process(meshArray);
        // Step 6: RLM — think through possibilities, avoid repeated actions
        const stateVec = new Float32Array(this.config.hiddenDim);
        for (let i = 0; i < Math.min(moeOutput.output.length, this.config.hiddenDim); i++) {
            stateVec[i] = moeOutput.output[i] ?? 0;
        }
        const rlmDecision = this.rlmTrainer.selectAction(stateVec);
        // Build structured text output from all 6 subsystem signals + THORNS + thesaurus
        const output = this.buildTextResponse(prompt, thornsOutput, hyperOutput, rlmDecision, moeOutput);
        // Zero-sum value update: higher-performing experts gain value points
        const perf = thornsOutput.crossCheck.overallConfidence;
        for (const [expertId, weight] of moeOutput.expertContributions) {
            this.valueAllocator.updateNeuronValue(expertId, perf * weight);
        }
        this.valueAllocator.applyDecay();
        // RLM experience replay
        this.rlmTrainer.addExperience({
            state: stateVec, action: rlmDecision.action,
            reward: perf, nextState: embedding,
            done: false, thinkingSteps: rlmDecision.thinkingSteps,
            priority: perf, timestamp: Date.now(),
        });
        this.rlmTrainer.train();
        // THORNS iterative review loop: plan → review → continue/done
        // If confidence is below threshold, run a second pass and take the better result
        const reviewThreshold = 0.5;
        let finalOutput = output;
        if (thornsOutput.crossCheck.overallConfidence < reviewThreshold || thornsOutput.intent.intent === 'query') {
            const reviewOutput = await this.thornsEngine.think(`review: ${prompt}`);
            if (reviewOutput.crossCheck.overallConfidence > thornsOutput.crossCheck.overallConfidence) {
                const revisedPlan = reviewOutput.actionPlan.join(' → ');
                finalOutput = `${output}\n  [Review→${reviewOutput.simulation.bestAction}] ${revisedPlan}`;
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
            finalOutput = `${finalOutput}\n  [Grounded in ${options.memoryContext.length} related memory]\n${grounding}`;
        }
        return finalOutput;
    }
    buildTextResponse(prompt, thorns, hyper, rlm, moe) {
        const intent = thorns.intent.intent;
        const confidence = (thorns.crossCheck.overallConfidence * 100).toFixed(0);
        const plan = thorns.actionPlan.join(' → ');
        const isNovel = hyper.noveltyScore > 0.4;
        const novelTag = isNovel ? '[novel]' : '[familiar]';
        // L = THORNS/dictionary lookup: get X (synonyms), Y (definition), Z (examples) per keyword
        const keywords = prompt.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        const contextParts = [];
        for (const word of keywords.slice(0, 4)) {
            const t = this.thornsEngine.getThesaurusData(word);
            if (t) {
                if (t.Y)
                    contextParts.push(`${word}: ${t.Y.slice(0, 60)}`);
                else if (t.X.length > 0)
                    contextParts.push(`${word} ≈ ${t.X.slice(0, 2).join(', ')}`);
            }
        }
        const contextLine = contextParts.length > 0
            ? `\n  Dictionary: ${contextParts.slice(0, 3).join(' | ')}`
            : '';
        // Top expert selected by MoE
        const topExpert = Array.from(moe.expertContributions.entries())
            .sort((a, b) => b[1] - a[1])[0];
        const expertNote = topExpert ? ` via ${topExpert[0]}` : '';
        // Thinking steps logged by RLM (avoids repeating same actions)
        const thinkNote = rlm.thinkingSteps.length > 0
            ? ` (${rlm.thinkingSteps.length} think steps)`
            : '';
        switch (intent) {
            case 'command':
                return `[Execute${expertNote}${thinkNote}] ${plan}${contextLine}\n  ${novelTag} confidence:${confidence}%`;
            case 'creation':
                return `[Build${expertNote}${thinkNote}] ${plan}${contextLine}\n  ${novelTag} confidence:${confidence}%`;
            case 'analysis':
                return `[Analysis${expertNote}${thinkNote}] ${plan}${contextLine}\n  ${novelTag} confidence:${confidence}%`;
            case 'exploration':
                return `[Explore${expertNote}${thinkNote}] ${plan}${contextLine}\n  ${novelTag} confidence:${confidence}%`;
            case 'query': {
                // Build a conversational answer using dictionary definitions + synonyms
                const words = prompt.toLowerCase().split(/\W+/).filter(w => w.length > 3);
                const answerParts = [];
                for (const w of words.slice(0, 5)) {
                    const t = this.thornsEngine.getThesaurusData(w);
                    if (t?.Y)
                        answerParts.push(`${w} means: ${t.Y}`);
                    else if (t && t.X.length > 0)
                        answerParts.push(`${w} (also: ${t.X.slice(0, 3).join(', ')})`);
                }
                // When the dictionary yields no definitions we fall back to the
                // THORNS response, which already carries its own Plan/novelty/
                // confidence footer — returning it verbatim avoids emitting a
                // second, duplicate "Plan:" line.
                if (answerParts.length === 0) {
                    return thorns.response;
                }
                const answer = answerParts.join('. ');
                return `${answer}${contextLine}\n  Plan: ${plan} | ${novelTag} confidence:${confidence}%`;
            }
            default:
                return `${thorns.response}${contextLine}\n  ${novelTag} confidence:${confidence}%`;
        }
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
    loadModel(model) {
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
            this.build();
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
        return this.builder.installWithQuantization(this.projectId);
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
    getTokenizer() { return this.tokenizer; }
    getTrainer() { return this.trainer; }
    getMoERouter() { return this.moeRouter; }
    isBuilt() { return this.built; }
    getPipeline() { return this.pipeline; }
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
