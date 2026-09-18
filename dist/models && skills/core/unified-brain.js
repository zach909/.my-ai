/**
 * UnifiedBrain -- the single module that *is* the model.
 *
 * Composes exactly the neural substrate the spec describes as one thing:
 *   - Value system (ValueRangeAllocator): zero-sum elastic plasticity budget.
 *   - Mixture of Experts (MoERouter): which neuron groups run.
 *   - Nonlinear mesh (NeuronMesh): every neuron connected to every other
 *     neuron, moving away from linear computing.
 *   - Hyperdimensional thinking (HyperDimensionalEngine): multi-ball-state
 *     memory and novelty detection.
 *   - Quantum net (QuantumNeuralNet): simulated quantum interference --
 *     connections between neurons are the "entanglement", input magnitude is
 *     wave height, and interference/consensus can shift the collapsed value.
 *     Always on -- "add quantum interference always on" -- every think()
 *     runs this stage; there is no off switch any more (see
 *     setQuantumEnabled()'s own doc comment).
 *   - Zip I/O (ZipIOSystem/InfiniteZipLoop): binary in, binary out, as a loop
 *     that wraps back to the start once its window fills.
 *   - An autonomous run loop that keeps going instead of stopping after one
 *     exchange, plus a self-triggerable save-and-stop.
 *
 * Deliberately excluded: extension-builder and model quantization. Those are
 * a separate concern (see extension-builder/builder.js and
 * models && skills/core/quantizer.ts) -- this file only imports the six
 * subsystems above.
 */
import { ValueRangeAllocator } from './value-range.js';
import { MoERouter } from './onebrain.js';
import { NeuronMesh } from './onebrain.js';
import { HyperDimensionalEngine } from './onebrain.js';
import { QuantumNeuralNet } from './onebrain.js';
import { ZipIOSystem } from './zip-io.js';
import { pluginExtensions } from '../../plugins/index.js';
import { PROGRAMMING_SKILLS } from '../programming-skills.js';
const DEFAULT_CONFIG = {
    embeddingDim: 64,
    hiddenDim: 128,
    numExperts: 4,
    meshNodes: 32,
    hyperDimensions: 64,
    valuePoints: 10000,
    quantumEnabled: true, // vestigial -- see the field's own doc comment
};
export class UnifiedBrain {
    constructor(config = {}) {
        this.stopRequested = false;
        this.running = false;
        // MoE expert index -> real plugin/skill id, so routing decisions name an
        // actual capability (a real plugin, a real programming-skill category)
        // instead of an anonymous randomly-initialized expert. Mirrors the
        // registration pattern in pipeline.ts's ensureSubsystems().
        this.expertPluginMap = new Map();
        this.config = { ...DEFAULT_CONFIG, ...config };
        const valeConfig = {
            enabled: true,
            totalPoints: this.config.valuePoints,
            minLearningRate: 0.0001,
            maxLearningRate: 0.01,
            redistributionInterval: 100,
            decayFactor: 0.01,
        };
        this.vale = new ValueRangeAllocator(valeConfig);
        this.moe = new MoERouter({
            // expertCount: 0 -- every expert registered below is a real, named
            // plugin or programming-skill category (Section 26/2.2), not an
            // anonymous randomly-initialized expert with nothing behind its index.
            expertCount: 0,
            topK: 2,
            inputDim: this.config.embeddingDim,
            outputDim: this.config.hiddenDim,
            expertHiddenDim: this.config.hiddenDim,
        });
        this.registerExperts();
        this.mesh = new NeuronMesh({
            nodeCount: this.config.meshNodes,
            connectionDensity: 1.0, // every neuron connected to every other neuron
            activationFn: 'swish',
        });
        // Shared, not owned: when the caller hands in the live NeuroPipeline's
        // own engine (see hyperEngine's doc comment above), this class never
        // constructs a second one -- see this.think()'s own note about reading
        // dimensions from the engine itself rather than this.config, so an
        // injected engine of a different size is never silently mismatched.
        this.hyper = config.hyperEngine ?? new HyperDimensionalEngine({
            neuronCount: this.config.hyperNeurons ?? Math.max(8, Math.floor(this.config.meshNodes / 2)),
            dimensions: this.config.hyperDimensions,
            ballStates: this.config.ballStates ?? 4,
            // The same full equation pipeline.ts runs -- see the comment there for
            // why these are set explicitly rather than left at the engine's inert
            // defaults. Both real construction sites, or the structure is still only
            // half reachable.
            hyperGain: 1,
            hyperAdd: 1,
            hyperWaveGain: 1,
            hyperWaveAdd: 1,
            waveGain: 0.1,
            connectionBias: true,
        });
        this.quantum = new QuantumNeuralNet();
        this.zipIO = new ZipIOSystem(50000, this.config.persistDir);
    }
    /**
     * Register one real MoE expert per plugin (Section 26) and one per
     * distinct programming-skill category (Section 2.2), so this file's own
     * MoE routing -- not just pipeline.ts's parallel one -- is traceable back
     * to an actual capability. One expert per plugin id keeps the weight-
     * matrix count bounded to the real catalog size; skills are grouped by
     * expertType (not one-per-skill) for the same reason pipeline.ts groups
     * them -- 500+ individual skill entries are lookup/metadata records, not
     * independent computational units worth a full weight matrix each.
     */
    registerExperts() {
        this.expertPluginMap.clear();
        for (const def of Object.values(pluginExtensions)) {
            const expertId = this.moe.addExpert({
                id: def.id,
                name: def.name,
                specialization: def.capabilities.join(',') || def.type,
            });
            this.expertPluginMap.set(expertId, def.id);
        }
        const skillExpertTypes = new Set(PROGRAMMING_SKILLS.map(s => s.expertType));
        for (const expertType of skillExpertTypes) {
            const id = `skill_${expertType}`;
            const expertId = this.moe.addExpert({
                id,
                name: `${expertType} skills`,
                specialization: expertType,
            });
            this.expertPluginMap.set(expertId, id);
        }
    }
    /** Real expert index -> plugin/skill id map, for callers that want to trace a routing decision. */
    getExpertPluginMap() {
        return new Map(this.expertPluginMap);
    }
    /**
     * "add quantum interference always on" -- quantum interference now runs on
     * every think(), unconditionally. This is kept, as a no-op, only so
     * existing callers (the Settings page's toggle, /api/settings/brain,
     * llm.js) don't break; it no longer turns anything off.
     */
    setQuantumEnabled(_enabled) {
        // Deliberately does nothing -- see this method's own doc comment.
    }
    isQuantumEnabled() {
        return true;
    }
    getVale() { return this.vale; }
    getMoE() { return this.moe; }
    getMesh() { return this.mesh; }
    getHyper() { return this.hyper; }
    getQuantum() { return this.quantum; }
    getZipIO() { return this.zipIO; }
    /**
     * One real forward pass, binary in / binary out via the zip loop:
     * MoE routing -> nonlinear all-connected mesh -> hyperdimensional
     * processing -> (optional) quantum interference. Returns the resulting
     * hidden state and signals; callers (NeuroclawLLM) decode that hidden
     * state into tokens rather than this file owning any text/token concerns.
     */
    async think(inputBytes, embedding) {
        await this.zipIO.ingest(inputBytes.toString('base64'));
        const moeOutput = this.moe.forward(embedding);
        const activeExperts = moeOutput.decision.expertIndices
            .map((i) => this.expertPluginMap.get(i))
            .filter((id) => id !== undefined);
        // Remap MoERouter's anonymous "expert_N" contribution keys to the real
        // plugin/skill id behind that index, so applyValueFeedback's zero-sum
        // value updates reward a real, named capability -- not an opaque index.
        const expertContributions = new Map();
        for (const [key, weight] of moeOutput.expertContributions) {
            const idx = Number(key.replace('expert_', ''));
            const realId = this.expertPluginMap.get(idx);
            expertContributions.set(realId ?? key, weight);
        }
        const meshInputs = new Map();
        for (let i = 0; i < Math.min(moeOutput.output.length, this.config.meshNodes); i++) {
            meshInputs.set(`neuron_${i}`, moeOutput.output[i] ?? 0);
        }
        const valeFractionsById = this.vale.getValeFractions();
        const valeFractions = new Map();
        for (const [id, frac] of valeFractionsById) {
            const numeric = Number(id.replace('neuron_', ''));
            if (!Number.isNaN(numeric))
                valeFractions.set(numeric, frac);
        }
        const meshResult = this.mesh.propagate(meshInputs, valeFractions);
        // this.hyper.getDimensions(), not this.config.hyperDimensions: when the
        // engine was injected (see hyperEngine's doc comment above) it may have
        // been built with a different size than this instance's own config --
        // sizing off the config in that case would silently feed process() a
        // vector of the wrong length for the actual shared engine.
        const hyperDims = this.hyper.getDimensions();
        const meshArray = [];
        for (const [, v] of meshResult.finalStates) {
            if (meshArray.length < hyperDims)
                meshArray.push(v);
        }
        while (meshArray.length < hyperDims)
            meshArray.push(0);
        const hyperOutput = this.hyper.process(meshArray);
        // "add quantum interference always on" -- this stage always runs now,
        // unconditionally (there used to be an `if (this.config.quantumEnabled)`
        // gate here; see UnifiedBrainConfig.quantumEnabled's own doc comment for
        // why that field is now vestigial).
        let quantumActive = false;
        let quantumConsensus = 0;
        let hiddenSource = meshArray;
        {
            const quantumNeurons = [];
            for (let i = 0; i < Math.min(meshArray.length, 16); i++) {
                const neuronId = `q_${i}`;
                this.quantum.addNeuron(neuronId, meshArray[i]);
                this.quantum.createSuperposition(neuronId, [meshArray[i], hyperOutput.outputVector[i] ?? 0]);
                quantumNeurons.push(neuronId);
            }
            if (quantumNeurons.length > 0) {
                quantumConsensus = this.quantum.phaseConsensus(quantumNeurons);
                let target = quantumNeurons[0];
                let bestHeight = -Infinity;
                for (const id of quantumNeurons) {
                    const state = this.quantum.getState(id);
                    if (state && state.height > bestHeight) {
                        bestHeight = state.height;
                        target = id;
                    }
                }
                this.quantum.groverAmplify(quantumNeurons, target);
                hiddenSource = quantumNeurons.map(id => this.quantum.collapse(id));
                quantumActive = true;
            }
        }
        const hiddenState = new Float32Array(hiddenSource.length);
        for (let i = 0; i < hiddenSource.length; i++)
            hiddenState[i] = hiddenSource[i];
        const outputBytes = Buffer.from(hiddenState.buffer.slice(0, hiddenState.byteLength));
        await this.zipIO.emit(outputBytes.toString('base64'));
        return {
            hiddenState,
            meshOutput: meshResult.finalStates,
            noveltyScore: hyperOutput.noveltyScore ?? 0,
            quantumActive,
            quantumConsensus,
            expertContributions,
            activeExperts,
        };
    }
    /** Zero-sum value feedback: reward the experts/neurons that contributed, then decay. */
    applyValueFeedback(performance, expertContributions) {
        for (const [expertId, weight] of expertContributions) {
            this.vale.updateNeuronValue(expertId, performance * weight);
        }
        this.vale.applyDecay();
    }
    /**
     * Runs continuously -- pulls the next input, thinks, emits the output --
     * until stopped. Never returns on its own just because one exchange
     * finished; that's the "not autonomous" gap this closes. Stops only when
     * `shouldStop()` (an external caller) or the network's own
     * requestStop()/saveAndStop() call flips the internal flag.
     */
    async runAutonomous(nextInput, onOutput, shouldStop = () => false, idleDelayMs = 25) {
        this.stopRequested = false;
        this.running = true;
        try {
            while (!this.stopRequested && !shouldStop()) {
                const input = await nextInput();
                if (input === null) {
                    await new Promise((resolve) => setTimeout(resolve, idleDelayMs));
                    continue; // no input yet -- keep looping, do not stop
                }
                const result = await this.think(input.bytes, input.embedding);
                await onOutput(result);
            }
        }
        finally {
            this.running = false;
        }
    }
    isRunning() {
        return this.running;
    }
    /** Callable by anything the network itself can invoke (a tool, a plugin) to end the autonomous loop. */
    requestStop() {
        this.stopRequested = true;
    }
    /**
     * The network's own way of persisting itself and turning off: snapshot the
     * current input/activation state of every neuron, then stop the
     * autonomous loop. Distinct from extension-builder saves -- this is the
     * live brain's own state, not a packaged extension.
     */
    async saveAndStop(persist) {
        const snapshot = this.save();
        if (persist)
            await persist(snapshot);
        this.requestStop();
        return snapshot;
    }
    /** Serializes the input state of every neuron (mesh, hyperdimensional, quantum) plus the value distribution. */
    save() {
        const dist = this.vale.getDistribution();
        return {
            savedAt: Date.now(),
            mesh: this.mesh.getTopology(),
            hyperNeurons: this.hyper.getNeuronStates(),
            // Always on now (see UnifiedBrainConfig.quantumEnabled's doc comment),
            // so this is no longer conditional.
            quantum: this.mesh.getTopology().nodes
                .map((_, i) => `q_${i}`)
                .map((id) => ({ id, state: this.quantum.getState(id) }))
                .filter((q) => q.state !== null),
            valeDistribution: {
                totalPoints: dist.totalPoints,
                neuronAllocations: dist.neuronAllocations.map((a) => ({ id: a.id, valuePoints: a.valuePoints, learningRate: a.learningRate })),
            },
        };
    }
    reset() {
        this.stopRequested = false;
    }
}
