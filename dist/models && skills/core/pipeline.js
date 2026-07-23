import { MoERouter } from './moe-router.js';
import { NeuronMesh } from './mesh.js';
import { HyperDimensionalEngine } from './hyperdimensional.js';
import { RLMTrainer } from './rlm.js';
import { ValueRangeAllocator } from './value-range.js';
import { QuantumNeuralNet } from './quantum-net.js';
import { ZipIOSystem } from './zip-io.js';
import { AlignmentVeto } from './alignment-veto.js';
import { ElasticCoreBlock } from './elastic-core.js';
import { pluginExtensions } from '../../plugins/index.js';
import { PROGRAMMING_SKILLS } from '../programming-skills.js';
const DEFAULT_CONFIG = {
    embeddingDim: 768,
    hiddenDim: 512,
    meshNodes: 32,
    hyperDimensions: 64,
    useElasticCore: true,
};
const HYPER_NEURON_COUNT = 64;
export class NeuroPipeline {
    constructor(config = {}) {
        // Subsystem instances — initialized lazily on first run to keep construction fast
        this.moeRouter = null;
        this.mesh = null;
        this.hyperEngine = null;
        this.rlm = null;
        this.valueRange = null;
        this.quantumNet = null;
        this.zipIO = null;
        this.alignmentVeto = null;
        this.elasticCore = null;
        // Elastic value budget: how many neuron slots it covers, and whether
        // initializeNeurons() has been called yet for this pipeline instance.
        this.valueBudgetSize = 0;
        this.valueInitialized = false;
        // MoE expert index → real plugin/skill id, populated once at subsystem
        // init so routing decisions name an actual capability instead of an
        // anonymous randomly-initialized expert network.
        this.expertPluginMap = new Map();
        // Deterministic registry from real expert id -> Elastic Core neuron ids.
        // Every plugin/skill expert gets at least one concrete neuron; when the
        // expert catalog outgrows meshNodes, ensureSubsystems() grows the Elastic
        // Core and value budget instead of silently reusing/folding ids.
        this.expertNeuronRegistry = new Map();
        // Timing history for stats
        this.runHistory = [];
        /**
         * run() -- reachable today only via NeuroclawRunner.startContinuous()'s
         * tick loop -- pushed to runHistory with no cap at all, the same
         * unbounded-array pattern already fixed this session for several other
         * classes' hot-path logs. A plain FIFO trim alone would silently make
         * getStats().runsCount plateau instead of reflecting the true lifetime
         * count (cli.ts displays it as "Pipeline: N runs"), so the true count is
         * tracked separately from the capped averaging window.
         */
        this.runHistoryCapacity = 5000;
        this.totalRunsCount = 0;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    // ─── Lazy initialisation ──────────────────────────────────────────────────
    ensureSubsystems() {
        if (this.moeRouter)
            return; // already initialised
        this.moeRouter = new MoERouter({
            // numExperts: 0 — every expert must be a real, named plugin/skill
            // registered below. Pre-seeding anonymous experts here would let them
            // win top-K routing with nothing behind their index (Section 2.2).
            numExperts: 0,
            topK: 2,
            inputDim: this.config.embeddingDim,
            outputDim: this.config.hiddenDim,
            expertHiddenDim: this.config.hiddenDim,
            loadBalancingLoss: 0.01,
        });
        // Register every plugin/skill (Section 1.11 / Section 2.2) as a real MoE
        // expert so routing decisions can be traced back to an actual
        // capability — not left as anonymous, randomly-initialized experts with
        // nothing behind their index.
        this.expertPluginMap.clear();
        for (const def of Object.values(pluginExtensions)) {
            const expertId = this.moeRouter.addExpert({
                id: def.id,
                name: def.name,
                specialization: def.capabilities.join(',') || def.type,
            });
            this.expertPluginMap.set(expertId, def.id);
        }
        // Section 2.2: every skill in programming-skills.ts must be registered
        // too. Registering one expert per individual skill (584 entries, each a
        // full inputDim*hiddenDim weight matrix) would be a multi-hundred-MB
        // memory blowup for what are really lookup/metadata records, not
        // independent computational units — so, matching the grouping the
        // (dead) SkillsManager already used, one expert is registered per
        // distinct expertType category, and every individual skill maps to it.
        const skillExpertTypes = new Set(PROGRAMMING_SKILLS.map(s => s.expertType));
        for (const expertType of skillExpertTypes) {
            const id = `skill_${expertType}`;
            const expertId = this.moeRouter.addExpert({
                id,
                name: `${expertType} skills`,
                specialization: expertType,
            });
            this.expertPluginMap.set(expertId, id);
        }
        this.elasticCore = new ElasticCoreBlock({
            neuronCount: this.config.meshNodes,
            stateDim: Math.max(4, Math.min(64, this.config.hyperDimensions)),
            inputDim: this.config.hiddenDim,
            outputDim: this.config.hiddenDim,
            maxTicks: 20,
            convergenceThreshold: 0.01,
            seed: 42,
            quantizationAware: true,
            quantizationBits: 8,
        });
        const expertIds = Array.from(this.expertPluginMap.values());
        this.expertNeuronRegistry.clear();
        for (let i = 0; i < expertIds.length; i++) {
            const expertId = expertIds[i];
            const neuronId = i < this.config.meshNodes ? i : this.elasticCore.addNeuron(expertId);
            this.elasticCore.setNeuronGroup(neuronId, expertId);
            this.expertNeuronRegistry.set(expertId, [neuronId]);
        }
        // The value budget must cover every neuron that consults it for a
        // learning rate — mesh nodes, any Elastic Core neurons grown for expert
        // coverage, and the separately-indexed hyperdimensional neurons.
        this.valueBudgetSize = Math.max(this.elasticCore.getNeuronCount(), HYPER_NEURON_COUNT);
        this.valueRange = new ValueRangeAllocator({
            enabled: true,
            totalPoints: this.valueBudgetSize * 10,
            minLearningRate: 0.0001,
            maxLearningRate: 0.01,
            redistributionInterval: 100,
            decayFactor: 0.01,
        });
        this.mesh = new NeuronMesh({
            nodeCount: this.config.meshNodes,
            connectionDensity: 1.0,
            propagationSteps: 20,
            convergenceThreshold: 0.01,
            activationFn: 'relu',
            learningRate: 0.01,
            initialConnectionWeight: 0.01,
            dampingFactor: 0.85,
            seed: 42,
        });
        this.hyperEngine = new HyperDimensionalEngine({
            dimensions: this.config.hyperDimensions,
            ballStates: 8,
            neuronCount: HYPER_NEURON_COUNT,
            stateTransitionThreshold: 0.4,
            noveltyDecay: 0.05,
            historyLength: 500,
            learningRate: 0.05,
            influenceDecay: 0.95,
            crossInfluenceStrength: 0.2,
            ...(this.config.hyperSustainedDivergenceTicks !== undefined
                ? { sustainedDivergenceTicks: this.config.hyperSustainedDivergenceTicks } : {}),
            ...(this.config.hyperDivergenceTolerance !== undefined
                ? { divergenceTolerance: this.config.hyperDivergenceTolerance } : {}),
        });
        this.rlm = new RLMTrainer({
            hiddenDim: this.config.hiddenDim,
            stateDim: this.config.hiddenDim,
            actionDim: 10,
            explorationRate: 0.3,
            discountFactor: 0.99,
            replayBufferSize: 10000,
            batchSize: 32,
            thinkSteps: 3,
        });
        this.quantumNet = new QuantumNeuralNet();
        this.alignmentVeto = new AlignmentVeto();
        // 50k chunks for the ring buffer's live window; when zipPersistDir is
        // set, periodic checkpoints there let context survive past that window
        // (and past process restarts) — restored below before the first run.
        this.zipIO = new ZipIOSystem(50000, this.config.zipPersistDir);
    }
    /**
     * Reload the zip-loop's last disk checkpoint, if zipPersistDir is
     * configured and a checkpoint exists. Call once after construction/reset
     * and before the first run() to pick up context from a prior process.
     */
    async restorePersistedState() {
        this.ensureSubsystems();
        if (this.config.zipPersistDir) {
            await this.zipIO.restore();
        }
    }
    /**
     * Elastic value budget → per-neuron learning rates (Section 1.3 / audit
     * item 1). Higher value points → lower learning rate (stable, "locked in"
     * knowledge); lower value points → higher learning rate (plastic, still
     * adapting). Node ids from both the mesh and the hyperdimensional engine
     * share this one budget space, sized to the larger of the two in
     * ensureSubsystems().
     */
    ensureValueInitialized() {
        if (this.valueInitialized)
            return;
        const neuronStates = [];
        for (let i = 0; i < this.valueBudgetSize; i++) {
            neuronStates.push({
                id: String(i),
                name: `neuron_${i}`,
                value: 0,
                learningRate: 0,
                states: new Map(),
                connections: new Map(),
                expertGroup: null,
                active: true,
            });
        }
        this.valueRange.initializeNeurons(neuronStates);
        this.valueInitialized = true;
    }
    getValueLearningRates() {
        this.ensureValueInitialized();
        const { neuronAllocations } = this.valueRange.getDistribution();
        const rates = new Map();
        for (const alloc of neuronAllocations) {
            rates.set(Number(alloc.id), alloc.learningRate);
        }
        return rates;
    }
    /**
     * The same zero-sum points as getValueLearningRates(), read as a raw [0,1]
     * vale fraction instead of a learning rate. This is what gates the
     * state-transition blend (new_state = vale*old_state + (1-vale)*computed)
     * in both the mesh and the hyperdimensional engine, so a neuron's
     * accumulated value simultaneously slows its weight updates *and* makes
     * its activation resist being overwritten each tick.
     */
    getValeFractions() {
        this.ensureValueInitialized();
        const fractions = this.valueRange.getValeFractions();
        const vale = new Map();
        for (const [id, frac] of fractions)
            vale.set(Number(id), frac);
        return vale;
    }
    /**
     * Feed a subsystem's per-neuron activity (how much each neuron just
     * changed) back into the value budget: neurons that changed a lot give up
     * value points (become more plastic / lower-value); neurons that barely
     * changed keep theirs and gradually accrue points redistributed from
     * unstable neighbors (the zero-sum "learn but don't forget" mechanism).
     */
    feedbackToValueBudget(deltaByNode) {
        for (const [id, delta] of deltaByNode) {
            this.valueRange.updateNeuronValue(String(id), -delta);
        }
        this.valueRange.applyDecay();
    }
    /**
     * Grow the Elastic Core by one neuron and enroll the new neuron id in the
     * zero-sum ValueRangeAllocator without reinitializing existing allocations.
     */
    addElasticNeuron(group) {
        this.ensureSubsystems();
        this.ensureValueInitialized();
        const neuronId = this.elasticCore.addNeuron(group);
        this.valueRange.addNeuron(String(neuronId));
        this.valueBudgetSize = Math.max(this.valueBudgetSize, neuronId + 1);
        return neuronId;
    }
    getValeFraction(neuronId) {
        this.ensureValueInitialized();
        return this.valueRange.getValeFractions().get(String(neuronId));
    }
    // ─── Core pipeline ───────────────────────────────────────────────────────
    /**
     * Run all 7 subsystems in sequence on an embedding vector.
     *
     * Sequence:
     *   0. ZipIO   — infinite loop context ingestion (Section 1.10)
     *   1. MoE     — mixture-of-experts routing on the embedding
     *   2. Elastic — all-to-all multidimensional transformer-core replacement
     *   3. HyperDim — hyper-dimensional state processing
     *   4. Quantum — quantum interference for exclusive input neurons
     *   5. RLM     — reinforcement-learning action selection
     *   6. Token gen — combine outputs → final output vector
     */
    async run(embedding, inputText) {
        this.ensureSubsystems();
        // Step 0: Ingest input into Zip I/O Loop if text provided
        if (inputText) {
            await this.zipIO.ingest(inputText);
        }
        const steps = [];
        const pipelineStart = Date.now();
        // ── Step 1: MoE routing ─────────────────────────────────────────────────
        let moeOutput;
        let selectedPlugins = [];
        {
            const t0 = Date.now();
            // Resize embedding to match inputDim if needed
            const inputVec = this.resizeVector(embedding, this.config.embeddingDim);
            const layerOut = this.moeRouter.forward(inputVec, 0);
            moeOutput = layerOut.output;
            selectedPlugins = layerOut.decision.expertIndices
                .map(i => this.expertPluginMap.get(i))
                .filter((id) => id !== undefined);
            const durationMs = Date.now() - t0;
            steps.push({
                name: 'moe-router',
                inputShape: [this.config.embeddingDim],
                outputShape: [moeOutput.length],
                durationMs,
            });
        }
        // ── Step 2: Transformer-core replacement / fallback mesh ───────────────
        let coreOutput;
        let elasticStateDeltas = new Map();
        if (this.config.useElasticCore !== false) {
            const t0 = Date.now();
            const coreInput = this.resizeVector(moeOutput, this.config.hiddenDim);
            const activeGroups = selectedPlugins.length > 0 ? new Set(selectedPlugins) : undefined;
            const drivenNeurons = this.neuronIdsForExperts(selectedPlugins);
            const result = this.elasticCore.forward(coreInput, {
                vale: this.getValeFractions(),
                activeGroups,
                drivenNeurons: drivenNeurons.size > 0 ? drivenNeurons : new Set([0]),
            });
            coreOutput = Array.from(result.output);
            elasticStateDeltas = new Map(result.stateDeltas);
            this.feedbackToValueBudget(result.stateDeltas);
            const durationMs = Date.now() - t0;
            steps.push({
                name: 'elastic-core',
                inputShape: [coreInput.length],
                outputShape: [coreOutput.length],
                durationMs,
            });
        }
        else {
            const t0 = Date.now();
            const meshInputs = new Map();
            const meshNodeCount = Math.min(this.config.meshNodes, moeOutput.length);
            for (let i = 0; i < meshNodeCount; i++)
                meshInputs.set(i, moeOutput[i] || 0);
            const propagation = this.mesh.propagate(meshInputs, this.getValeFractions());
            coreOutput = Array.from(propagation.finalStates.values());
            const meshDeltas = this.mesh.applyValueWeightedLearning(this.getValueLearningRates());
            this.feedbackToValueBudget(meshDeltas);
            const durationMs = Date.now() - t0;
            steps.push({
                name: 'mesh-propagation',
                inputShape: [meshNodeCount],
                outputShape: [coreOutput.length],
                durationMs,
            });
        }
        // ── Step 3: Hyper-dimensional processing ────────────────────────────────
        let hyperOutput;
        let selfModelSurprise = 0;
        let liveCorrections = 0;
        {
            const t0 = Date.now();
            // Pad/truncate elastic core output to hyperDimensions
            const hyperInput = this.resizeArray(coreOutput, this.config.hyperDimensions);
            const learningRates = this.getValueLearningRates();
            const hyperResult = this.hyperEngine.process(hyperInput, learningRates, undefined, this.getValeFractions());
            hyperOutput = hyperResult.outputVector;
            selfModelSurprise = hyperResult.selfModelSurprise;
            liveCorrections = hyperResult.liveCorrections;
            this.feedbackToValueBudget(hyperResult.stateDeltas);
            const durationMs = Date.now() - t0;
            steps.push({
                name: 'hyper-dimensional',
                inputShape: [this.config.hyperDimensions],
                outputShape: [hyperOutput.length],
                durationMs,
            });
        }
        // ── Step 4: Quantum neural net processing ───────────────────────────────
        let quantumOutput;
        {
            const t0 = Date.now();
            // Register neurons with exclusive inputs, each carrying a candidate
            // superposition drawn from its own value plus its neighbors' — this is
            // what makes phase-consensus and Grover amplification meaningful; a
            // neuron with only one possible state has nothing to interfere with.
            const quantumNeurons = [];
            const n = Math.min(10, hyperOutput.length);
            for (let i = 0; i < n; i++) {
                const neuronId = `q_neuron_${i}`;
                this.quantumNet.addNeuron(neuronId, hyperOutput[i]);
                const candidates = [
                    hyperOutput[i],
                    hyperOutput[(i + 1) % hyperOutput.length],
                    hyperOutput[(i + hyperOutput.length - 1) % hyperOutput.length],
                ];
                this.quantumNet.createSuperposition(neuronId, candidates);
                quantumNeurons.push(neuronId);
            }
            // Phase-consensus across the whole group: with randomized phases this
            // can genuinely cancel (destructive) as well as reinforce (constructive),
            // unlike the old always-in-phase (phase=0) setup.
            const consensusMagnitude = this.quantumNet.phaseConsensus(quantumNeurons);
            // Grover-style amplification: mark and amplify whichever neuron currently
            // carries the strongest signal, separately from the consensus step above.
            let target = quantumNeurons[0];
            let targetHeight = -Infinity;
            for (const id of quantumNeurons) {
                const state = this.quantumNet.getState(id);
                if (state && state.height > targetHeight) {
                    targetHeight = state.height;
                    target = id;
                }
            }
            this.quantumNet.groverAmplify(quantumNeurons, target);
            // Collapse — amplitude-weighted sampling from the (now amplified)
            // Born-rule distribution built by createSuperposition/groverAmplify.
            quantumOutput = quantumNeurons.map(id => this.quantumNet.collapse(id));
            // Fold the group-level consensus magnitude in as a shared bias term so
            // destructive cancellation actually shows up in the pipeline output.
            const consensusBias = consensusMagnitude / (quantumNeurons.length || 1);
            quantumOutput = quantumOutput.map(v => v + consensusBias * 0.1);
            const durationMs = Date.now() - t0;
            steps.push({
                name: 'quantum-interference',
                inputShape: [quantumNeurons.length],
                outputShape: [quantumOutput.length],
                durationMs,
            });
        }
        // ── Step 5: RLM decision ────────────────────────────────────────────────
        let rlmAction;
        let rlmThinkingSteps;
        {
            const t0 = Date.now();
            // Build state vector from quantum output, sized to rlm stateDim
            const stateVec = new Float32Array(this.resizeArray(quantumOutput, this.config.hiddenDim));
            const decision = this.rlm.selectAction(stateVec);
            rlmAction = decision.action;
            rlmThinkingSteps = decision.thinkingSteps;
            const durationMs = Date.now() - t0;
            steps.push({
                name: 'rlm-decision',
                inputShape: [this.config.hiddenDim],
                outputShape: [1],
                durationMs,
            });
        }
        // ── Step 5b: Alignment veto ─────────────────────────────────────────────
        // Gate the chosen action rather than optimizing toward an alignment score.
        // Capabilities come from whichever plugin experts the MoE actually picked,
        // and drift is the self-model surprise from the hyperdimensional stage, so
        // a run that diverged from what the network expected fails safe.
        let alignment;
        {
            const t0 = Date.now();
            const capabilities = [];
            for (const pluginId of selectedPlugins) {
                const def = pluginExtensions[pluginId];
                if (def?.capabilities)
                    capabilities.push(...def.capabilities);
            }
            alignment = this.alignmentVeto.evaluate({ id: `rlm-action-${rlmAction}`, name: `action ${rlmAction}`, capabilities, reversible: true }, { selfModelSurprise });
            steps.push({
                name: 'alignment-veto',
                inputShape: [capabilities.length],
                outputShape: [alignment.allowed ? 1 : 0],
                durationMs: Date.now() - t0,
            });
        }
        // ── Step 6: Token generation (combination) ──────────────────────────────
        let finalOutput;
        {
            const t0 = Date.now();
            // Emit output to Zip I/O Loop
            const outputText = `Action:${rlmAction}|Quantum:${quantumOutput.slice(0, 3).join(',')}|Steps:${rlmThinkingSteps.length}`;
            await this.zipIO.emit(outputText);
            finalOutput = this.generateOutput(quantumOutput, moeOutput, rlmAction, rlmThinkingSteps);
            const durationMs = Date.now() - t0;
            steps.push({
                name: 'token-generation',
                inputShape: [quantumOutput.length + moeOutput.length],
                outputShape: [finalOutput.length],
                durationMs,
            });
        }
        const totalDurationMs = Date.now() - pipelineStart;
        // Record timings for stats
        const stepDurations = new Map();
        for (const s of steps) {
            stepDurations.set(s.name, s.durationMs);
        }
        this.runHistory.push({ totalDurationMs, stepDurations });
        this.totalRunsCount++;
        if (this.runHistory.length > this.runHistoryCapacity) {
            this.runHistory.splice(0, this.runHistory.length - this.runHistoryCapacity);
        }
        return {
            output: finalOutput,
            steps,
            totalDurationMs,
            selectedPlugins,
            alignment,
            selfModelSurprise,
            liveCorrections,
            elasticStateDeltas,
        };
    }
    // ─── Stats ──────────────────────────────────────────────────────────
    getStats() {
        // runsCount is the true lifetime total (totalRunsCount), independent of
        // runHistory's capped averaging window -- capping the window must not
        // make this displayed counter silently plateau.
        if (this.runHistory.length === 0) {
            return { avgDurationMs: 0, stepBreakdown: new Map(), runsCount: this.totalRunsCount };
        }
        const totalDuration = this.runHistory.reduce((s, r) => s + r.totalDurationMs, 0);
        const avgDurationMs = totalDuration / this.runHistory.length;
        // Average duration per step across all runs currently in the window
        const stepTotals = new Map();
        for (const record of this.runHistory) {
            for (const [stepName, dur] of record.stepDurations) {
                const existing = stepTotals.get(stepName) ?? { sum: 0, count: 0 };
                stepTotals.set(stepName, { sum: existing.sum + dur, count: existing.count + 1 });
            }
        }
        const stepBreakdown = new Map();
        for (const [name, { sum, count }] of stepTotals) {
            stepBreakdown.set(name, sum / count);
        }
        return { avgDurationMs, stepBreakdown, runsCount: this.totalRunsCount };
    }
    // ─── Reset ──────────────────────────────────────────────────────────
    reset() {
        this.runHistory = [];
        this.totalRunsCount = 0;
        // Tear down subsystems so they are re-created fresh on next run
        this.moeRouter = null;
        this.mesh = null;
        this.hyperEngine = null;
        this.rlm = null;
        this.valueRange = null;
        this.elasticCore = null;
        this.expertNeuronRegistry.clear();
        this.quantumNet = null;
        this.zipIO = null;
        this.valueInitialized = false;
    }
    /**
     * Access the Zip I/O system for context iteration
     */
    getZipIO() {
        return this.zipIO;
    }
    /**
     * MoE expert index → real plugin/skill id, for introspection of which
     * concrete capability each expert slot represents.
     */
    getExpertPluginMap() {
        return new Map(this.expertPluginMap);
    }
    /** Real plugin/skill id -> Elastic Core neuron ids that exist. */
    getExpertNeuronRegistry() {
        this.ensureSubsystems();
        return new Map(Array.from(this.expertNeuronRegistry, ([id, neurons]) => [id, [...neurons]]));
    }
    neuronIdsForExperts(expertIds) {
        const ids = new Set();
        for (const expertId of expertIds) {
            for (const neuronId of this.expertNeuronRegistry.get(expertId) ?? [])
                ids.add(neuronId);
        }
        return ids;
    }
    // ─── Private helpers ──────────────────────────────────────────────────────
    /**
     * Resize a Float32Array to targetLength, zero-padding or truncating.
     */
    resizeVector(vec, targetLength) {
        if (vec.length === targetLength)
            return vec;
        const out = new Float32Array(targetLength);
        const copyLen = Math.min(vec.length, targetLength);
        for (let i = 0; i < copyLen; i++) {
            out[i] = vec[i];
        }
        return out;
    }
    /**
     * Resize a number[] to targetLength, zero-padding or truncating.
     */
    resizeArray(arr, targetLength) {
        if (arr.length === targetLength)
            return arr;
        const out = new Array(targetLength).fill(0);
        const copyLen = Math.min(arr.length, targetLength);
        for (let i = 0; i < copyLen; i++) {
            out[i] = arr[i];
        }
        return out;
    }
    /**
     * Combine subsystem outputs into a final output vector.
     *
     * The output vector length matches embeddingDim so it can feed back into
     * the embedding space. Each position is a weighted blend of:
     *   - hyper-dimensional output (primary signal, weight 0.6)
     *   - MoE output (secondary signal, weight 0.3)
     *   - RLM action gate (weight 0.1)
     */
    generateOutput(hyperOutput, moeOutput, rlmAction, rlmThinkingSteps) {
        const outLen = this.config.embeddingDim;
        const out = new Array(outLen).fill(0);
        // Action gate: normalise action index to [0,1] and use as a scaling factor
        const actionGate = rlmAction / Math.max(10, rlmAction + 1);
        // Thinking-step entropy as an additional novelty signal
        const thinkEntropy = rlmThinkingSteps.length > 0
            ? rlmThinkingSteps.reduce((s, a) => s + a, 0) / (rlmThinkingSteps.length * 10)
            : 0;
        for (let i = 0; i < outLen; i++) {
            const hyper = hyperOutput[i % hyperOutput.length] ?? 0;
            const moe = moeOutput[i % moeOutput.length] ?? 0;
            const contextBias = (actionGate + thinkEntropy) / 2;
            out[i] = hyper * 0.6 + moe * 0.3 + contextBias * 0.1;
        }
        // L2-normalise so downstream layers receive unit-norm vectors
        const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
        for (let i = 0; i < outLen; i++) {
            out[i] /= norm;
        }
        return out;
    }
}
