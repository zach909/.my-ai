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
 *     Toggleable; off by default.
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

import { ValueRangeAllocator, type ValueRangeConfig } from './value-range.js';
import { MoERouter, type MoEConfig } from './onebrain.js';
import { NeuronMesh, type MeshConfig, type MeshTopology } from './onebrain.js';
import { HyperDimensionalEngine, type HyperConfig, type HyperNeuron } from './onebrain.js';
import { QuantumNeuralNet, type QuantumState } from './onebrain.js';
import { ZipIOSystem } from './zip-io.js';
import { pluginExtensions } from '../../plugins/index.js';
import { PROGRAMMING_SKILLS } from '../programming-skills.js';

export interface UnifiedBrainConfig {
  embeddingDim: number;
  hiddenDim: number;
  /** Unused for expert count: registerExperts() registers one real, named expert per plugin/skill category instead (see moe.ts/pipeline.ts). Kept only for config-object backward compatibility. */
  numExperts: number;
  meshNodes: number;
  hyperDimensions: number;
  /** Defaults to meshNodes/2 if omitted. */
  hyperNeurons?: number;
  ballStates?: number;
  valuePoints: number;
  /** Off by default -- toggle with setQuantumEnabled()/quantumEnabled config. */
  quantumEnabled: boolean;
  /** Where InfiniteZipLoop spills its ring buffer / checkpoints to disk. */
  persistDir?: string;
  /**
   * "onebrain delete backup llm" -- share ONE HyperDimensionalEngine instead
   * of this class quietly building a second, private one. Before this,
   * NeuroclawLLM (which answers every real chat reply) and NeuroPipeline
   * (which backs the Zip Loop doorway, continuous learning, and every net
   * skill graft) each ran their OWN separate hyperdimensional engine --
   * genuinely two brains, only one of which the user ever actually talked
   * to, while everything else (net skills installed mid-conversation,
   * continuous-learning predictions, the raw Zip Loop) silently trained and
   * read a different one. Passing the live engine in here (see
   * NeuroclawSystem's constructor) makes both halves of the same running
   * agent share one real, stateful, continuously-learning substrate.
   * Omitted, this class falls back to building its own (unit tests /
   * standalone NeuroclawLLM usage elsewhere still work unchanged).
   */
  hyperEngine?: HyperDimensionalEngine;
}

const DEFAULT_CONFIG: UnifiedBrainConfig = {
  embeddingDim: 64,
  hiddenDim: 128,
  numExperts: 4,
  meshNodes: 32,
  hyperDimensions: 64,
  valuePoints: 10000,
  quantumEnabled: false,
};

export interface ThinkResult {
  /** The raw numeric hidden state after mesh -> hyperdimensional (-> quantum, if enabled). */
  hiddenState: Float32Array;
  meshOutput: Map<number, number>;
  noveltyScore: number;
  quantumActive: boolean;
  quantumConsensus: number;
  /** MoE expert weighting used this tick, for callers that route generation through experts. */
  expertContributions: Map<string, number>;
  /** Real plugin/skill ids selected this tick (via expertPluginMap), not anonymous expert indices. */
  activeExperts: string[];
}

export interface BrainSnapshot {
  savedAt: number;
  mesh: MeshTopology;
  hyperNeurons: HyperNeuron[];
  quantum: Array<{ id: string; state: QuantumState }>;
  valeDistribution: { totalPoints: number; neuronAllocations: { id: string; valuePoints: number; learningRate: number }[] };
}

export class UnifiedBrain {
  private config: UnifiedBrainConfig;
  private vale: ValueRangeAllocator;
  private moe: MoERouter;
  private mesh: NeuronMesh;
  private hyper: HyperDimensionalEngine;
  private quantum: QuantumNeuralNet;
  private zipIO: ZipIOSystem;
  private stopRequested = false;
  private running = false;

  // MoE expert index -> real plugin/skill id, so routing decisions name an
  // actual capability (a real plugin, a real programming-skill category)
  // instead of an anonymous randomly-initialized expert. Mirrors the
  // registration pattern in pipeline.ts's ensureSubsystems().
  private expertPluginMap: Map<number, string> = new Map();

  constructor(config: Partial<UnifiedBrainConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    const valeConfig: ValueRangeConfig = {
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
    } as Partial<MoEConfig>);
    this.registerExperts();

    this.mesh = new NeuronMesh({
      nodeCount: this.config.meshNodes,
      connectionDensity: 1.0, // every neuron connected to every other neuron
      activationFn: 'swish',
    } as Partial<MeshConfig>);

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
    } as Partial<HyperConfig>);

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
  private registerExperts(): void {
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
  getExpertPluginMap(): Map<number, string> {
    return new Map(this.expertPluginMap);
  }

  setQuantumEnabled(enabled: boolean): void {
    this.config.quantumEnabled = enabled;
  }

  isQuantumEnabled(): boolean {
    return this.config.quantumEnabled;
  }

  getVale(): ValueRangeAllocator { return this.vale; }
  getMoE(): MoERouter { return this.moe; }
  getMesh(): NeuronMesh { return this.mesh; }
  getHyper(): HyperDimensionalEngine { return this.hyper; }
  getQuantum(): QuantumNeuralNet { return this.quantum; }
  getZipIO(): ZipIOSystem { return this.zipIO; }

  /**
   * One real forward pass, binary in / binary out via the zip loop:
   * MoE routing -> nonlinear all-connected mesh -> hyperdimensional
   * processing -> (optional) quantum interference. Returns the resulting
   * hidden state and signals; callers (NeuroclawLLM) decode that hidden
   * state into tokens rather than this file owning any text/token concerns.
   */
  async think(inputBytes: Buffer, embedding: Float32Array): Promise<ThinkResult> {
    await this.zipIO.ingest(inputBytes.toString('base64'));

    const moeOutput = this.moe.forward(embedding);
    const activeExperts = moeOutput.decision.expertIndices
      .map((i) => this.expertPluginMap.get(i))
      .filter((id): id is string => id !== undefined);
    // Remap MoERouter's anonymous "expert_N" contribution keys to the real
    // plugin/skill id behind that index, so applyValueFeedback's zero-sum
    // value updates reward a real, named capability -- not an opaque index.
    const expertContributions = new Map<string, number>();
    for (const [key, weight] of moeOutput.expertContributions) {
      const idx = Number(key.replace('expert_', ''));
      const realId = this.expertPluginMap.get(idx);
      expertContributions.set(realId ?? key, weight);
    }

    const meshInputs = new Map<string, number>();
    for (let i = 0; i < Math.min(moeOutput.output.length, this.config.meshNodes); i++) {
      meshInputs.set(`neuron_${i}`, moeOutput.output[i] ?? 0);
    }
    const valeFractionsById = this.vale.getValeFractions();
    const valeFractions = new Map<number, number>();
    for (const [id, frac] of valeFractionsById) {
      const numeric = Number(id.replace('neuron_', ''));
      if (!Number.isNaN(numeric)) valeFractions.set(numeric, frac);
    }
    const meshResult = this.mesh.propagate(meshInputs, valeFractions);

    // this.hyper.getDimensions(), not this.config.hyperDimensions: when the
    // engine was injected (see hyperEngine's doc comment above) it may have
    // been built with a different size than this instance's own config --
    // sizing off the config in that case would silently feed process() a
    // vector of the wrong length for the actual shared engine.
    const hyperDims = this.hyper.getDimensions();
    const meshArray: number[] = [];
    for (const [, v] of meshResult.finalStates) {
      if (meshArray.length < hyperDims) meshArray.push(v);
    }
    while (meshArray.length < hyperDims) meshArray.push(0);
    const hyperOutput = this.hyper.process(meshArray);

    let quantumActive = false;
    let quantumConsensus = 0;
    let hiddenSource = meshArray;
    if (this.config.quantumEnabled) {
      const quantumNeurons: string[] = [];
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
          if (state && state.height > bestHeight) { bestHeight = state.height; target = id; }
        }
        this.quantum.groverAmplify(quantumNeurons, target);
        hiddenSource = quantumNeurons.map(id => this.quantum.collapse(id));
        quantumActive = true;
      }
    }

    const hiddenState = new Float32Array(hiddenSource.length);
    for (let i = 0; i < hiddenSource.length; i++) hiddenState[i] = hiddenSource[i];

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
  applyValueFeedback(performance: number, expertContributions: Map<string, number>): void {
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
  async runAutonomous(
    nextInput: () => Promise<{ bytes: Buffer; embedding: Float32Array } | null>,
    onOutput: (result: ThinkResult) => void | Promise<void>,
    shouldStop: () => boolean = () => false,
    idleDelayMs = 25,
  ): Promise<void> {
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
    } finally {
      this.running = false;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Callable by anything the network itself can invoke (a tool, a plugin) to end the autonomous loop. */
  requestStop(): void {
    this.stopRequested = true;
  }

  /**
   * The network's own way of persisting itself and turning off: snapshot the
   * current input/activation state of every neuron, then stop the
   * autonomous loop. Distinct from extension-builder saves -- this is the
   * live brain's own state, not a packaged extension.
   */
  async saveAndStop(persist?: (snapshot: BrainSnapshot) => Promise<void>): Promise<BrainSnapshot> {
    const snapshot = this.save();
    if (persist) await persist(snapshot);
    this.requestStop();
    return snapshot;
  }

  /** Serializes the input state of every neuron (mesh, hyperdimensional, quantum) plus the value distribution. */
  save(): BrainSnapshot {
    const dist = this.vale.getDistribution();
    return {
      savedAt: Date.now(),
      mesh: this.mesh.getTopology(),
      hyperNeurons: this.hyper.getNeuronStates(),
      quantum: this.config.quantumEnabled
        ? this.mesh.getTopology().nodes
            .map((_, i) => `q_${i}`)
            .map((id) => ({ id, state: this.quantum.getState(id) }))
            .filter((q): q is { id: string; state: QuantumState } => q.state !== null)
        : [],
      valeDistribution: {
        totalPoints: dist.totalPoints,
        neuronAllocations: dist.neuronAllocations.map((a) => ({ id: a.id, valuePoints: a.valuePoints, learningRate: a.learningRate })),
      },
    };
  }

  reset(): void {
    this.stopRequested = false;
  }
}
