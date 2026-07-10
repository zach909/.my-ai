import { MoERouter } from './moe-router.js';
import { NeuronMesh } from './mesh.js';
import { HyperDimensionalEngine } from './hyperdimensional.js';
import { RLMTrainer } from './rlm.js';
import { ValueRangeAllocator } from './value-range.js';
import { QuantumNeuralNet } from './quantum-net.js';
import { ZipIOSystem } from './zip-io.js';
import { AlignmentVeto, type VetoDecision } from './alignment-veto.js';
import type { NeuronState } from '../../interface/types.js';
import { pluginExtensions } from '../../plugins/index.js';
import { PROGRAMMING_SKILLS } from '../programming-skills.js';

export interface PipelineConfig {
  embeddingDim: number;
  hiddenDim: number;
  meshNodes: number;
  hyperDimensions: number;
  /**
   * Directory for the zip-loop's periodic disk checkpoints. When set, the
   * ring buffer's context survives past its own live window (and past
   * process restarts) by reloading the last checkpoint on startup. Omit to
   * keep the loop purely in-memory (checkpoints still get a tmpdir path but
   * are never auto-restored).
   */
  zipPersistDir?: string;
  /** Section 3.3 tuning: consecutive over-tolerance settle iterations
   *  required before live correction fires. Defaults to the engine's own
   *  default (3) when omitted. */
  hyperSustainedDivergenceTicks?: number;
  /** Section 3.3 tuning: energy-divergence-from-EMA threshold a settle
   *  iteration must exceed to count toward sustained divergence. Defaults
   *  to the engine's own default (0.05) when omitted. */
  hyperDivergenceTolerance?: number;
}

export interface PipelineStep {
  name: string;
  inputShape: number[];
  outputShape: number[];
  durationMs: number;
}

export interface PipelineResult {
  output: number[];
  steps: PipelineStep[];
  totalDurationMs: number;
  /** Real plugin/skill ids the MoE router picked for this run, if any */
  selectedPlugins: string[];
  /** Section 3: alignment veto verdict on this run's chosen action. */
  alignment: VetoDecision;
  /** Section 3.2: this tick's self-model prediction-error signal. */
  selfModelSurprise: number;
  /** Section 3.3: 1 if live correction fired on this tick's hyperdimensional settle, else 0. */
  liveCorrections: number;
}

interface RunRecord {
  totalDurationMs: number;
  stepDurations: Map<string, number>;
}

const DEFAULT_CONFIG: PipelineConfig = {
  embeddingDim: 768,
  hiddenDim: 512,
  meshNodes: 32,
  hyperDimensions: 64,
};

const HYPER_NEURON_COUNT = 64;

export class NeuroPipeline {
  private config: PipelineConfig;

  // Subsystem instances — initialized lazily on first run to keep construction fast
  private moeRouter: MoERouter | null = null;
  private mesh: NeuronMesh | null = null;
  private hyperEngine: HyperDimensionalEngine | null = null;
  private rlm: RLMTrainer | null = null;
  private valueRange: ValueRangeAllocator | null = null;
  private quantumNet: QuantumNeuralNet | null = null;
  private zipIO: ZipIOSystem | null = null;
  private alignmentVeto: AlignmentVeto | null = null;

  // Elastic value budget: how many neuron slots it covers, and whether
  // initializeNeurons() has been called yet for this pipeline instance.
  private valueBudgetSize = 0;
  private valueInitialized = false;

  // MoE expert index → real plugin/skill id, populated once at subsystem
  // init so routing decisions name an actual capability instead of an
  // anonymous randomly-initialized expert network.
  private expertPluginMap: Map<number, string> = new Map();

  // Timing history for stats
  private runHistory: RunRecord[] = [];

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Lazy initialisation ──────────────────────────────────────────────────

  private ensureSubsystems(): void {
    if (this.moeRouter) return; // already initialised

    // The value budget must cover every neuron that consults it for a
    // learning rate — both the mesh nodes and the (separately-indexed)
    // hyperdimensional neurons — so size it to the larger of the two.
    this.valueBudgetSize = Math.max(this.config.meshNodes, HYPER_NEURON_COUNT);

    this.valueRange = new ValueRangeAllocator({
      enabled: true,
      totalPoints: this.valueBudgetSize * 10,
      minLearningRate: 0.0001,
      maxLearningRate: 0.01,
      redistributionInterval: 100,
      decayFactor: 0.01,
    });

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
  async restorePersistedState(): Promise<void> {
    this.ensureSubsystems();
    if (this.config.zipPersistDir) {
      await this.zipIO!.restore();
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
  private ensureValueInitialized(): void {
    if (this.valueInitialized) return;
    const neuronStates: NeuronState[] = [];
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
    this.valueRange!.initializeNeurons(neuronStates);
    this.valueInitialized = true;
  }

  private getValueLearningRates(): Map<number, number> {
    this.ensureValueInitialized();
    const { neuronAllocations } = this.valueRange!.getDistribution();
    const rates = new Map<number, number>();
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
  private getValeFractions(): Map<number, number> {
    this.ensureValueInitialized();
    const fractions = this.valueRange!.getValeFractions();
    const vale = new Map<number, number>();
    for (const [id, frac] of fractions) vale.set(Number(id), frac);
    return vale;
  }

  /**
   * Feed a subsystem's per-neuron activity (how much each neuron just
   * changed) back into the value budget: neurons that changed a lot give up
   * value points (become more plastic / lower-value); neurons that barely
   * changed keep theirs and gradually accrue points redistributed from
   * unstable neighbors (the zero-sum "learn but don't forget" mechanism).
   */
  private feedbackToValueBudget(deltaByNode: Map<number, number>): void {
    for (const [id, delta] of deltaByNode) {
      this.valueRange!.updateNeuronValue(String(id), -delta);
    }
    this.valueRange!.applyDecay();
  }

  // ─── Core pipeline ───────────────────────────────────────────────────────

  /**
   * Run all 7 subsystems in sequence on an embedding vector.
   * 
   * Run all 6 subsystems in sequence on an embedding vector.
   *
   * Sequence:
   *   0. ZipIO   — infinite loop context ingestion (Section 1.10)
   *   1. MoE     — mixture-of-experts routing on the embedding
   *   2. Mesh    — propagation through the neuron mesh
   *   3. HyperDim — hyper-dimensional state processing
   *   4. Quantum — quantum interference for exclusive input neurons
   *   5. RLM     — reinforcement-learning action selection
   *   6. Token gen — combine outputs → final output vector
   */
  async run(embedding: Float32Array, inputText?: string): Promise<PipelineResult> {
    this.ensureSubsystems();

    // Step 0: Ingest input into Zip I/O Loop if text provided
    if (inputText) {
      await this.zipIO!.ingest(inputText);
    }

    const steps: PipelineStep[] = [];
    const pipelineStart = Date.now();

    // ── Step 1: MoE routing ─────────────────────────────────────────────────
    let moeOutput: Float32Array;
    let selectedPlugins: string[] = [];
    {
      const t0 = Date.now();
      // Resize embedding to match inputDim if needed
      const inputVec = this.resizeVector(embedding, this.config.embeddingDim);
      const layerOut = this.moeRouter!.forward(inputVec, 0);
      moeOutput = layerOut.output;
      selectedPlugins = layerOut.decision.expertIndices
        .map(i => this.expertPluginMap.get(i))
        .filter((id): id is string => id !== undefined);
      const durationMs = Date.now() - t0;
      steps.push({
        name: 'moe-router',
        inputShape: [this.config.embeddingDim],
        outputShape: [moeOutput.length],
        durationMs,
      });
    }

    // ── Step 2: Mesh propagation ────────────────────────────────────────────
    let meshOutput: number[];
    {
      const t0 = Date.now();
      // Distribute MoE outputs across mesh input nodes
      const meshInputs = new Map<number, number>();
      const meshNodeCount = Math.min(this.config.meshNodes, moeOutput.length);
      for (let i = 0; i < meshNodeCount; i++) {
        meshInputs.set(i, moeOutput[i] || 0);
      }
      const propagation = this.mesh!.propagate(meshInputs, this.getValeFractions());
      // Collect final state values as an ordered array
      meshOutput = Array.from(propagation.finalStates.values());

      // Elastic value budget gates how much each mesh node's connections are
      // allowed to change this tick, then the resulting change feeds back
      // into the budget itself.
      const learningRates = this.getValueLearningRates();
      const meshDeltas = this.mesh!.applyValueWeightedLearning(learningRates);
      this.feedbackToValueBudget(meshDeltas);

      const durationMs = Date.now() - t0;
      steps.push({
        name: 'mesh-propagation',
        inputShape: [meshNodeCount],
        outputShape: [meshOutput.length],
        durationMs,
      });
    }

    // ── Step 3: Hyper-dimensional processing ────────────────────────────────
    let hyperOutput: number[];
    let selfModelSurprise = 0;
    let liveCorrections = 0;
    {
      const t0 = Date.now();
      // Pad/truncate mesh output to hyperDimensions
      const hyperInput = this.resizeArray(meshOutput, this.config.hyperDimensions);
      const learningRates = this.getValueLearningRates();
      const hyperResult = this.hyperEngine!.process(hyperInput, learningRates, undefined, this.getValeFractions());
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
    let quantumOutput: number[];
    {
      const t0 = Date.now();
      // Register neurons with exclusive inputs, each carrying a candidate
      // superposition drawn from its own value plus its neighbors' — this is
      // what makes phase-consensus and Grover amplification meaningful; a
      // neuron with only one possible state has nothing to interfere with.
      const quantumNeurons: string[] = [];
      const n = Math.min(10, hyperOutput.length);
      for (let i = 0; i < n; i++) {
        const neuronId = `q_neuron_${i}`;
        this.quantumNet!.addNeuron(neuronId, hyperOutput[i]);
        const candidates = [
          hyperOutput[i],
          hyperOutput[(i + 1) % hyperOutput.length],
          hyperOutput[(i + hyperOutput.length - 1) % hyperOutput.length],
        ];
        this.quantumNet!.createSuperposition(neuronId, candidates);
        quantumNeurons.push(neuronId);
      }

      // Phase-consensus across the whole group: with randomized phases this
      // can genuinely cancel (destructive) as well as reinforce (constructive),
      // unlike the old always-in-phase (phase=0) setup.
      const consensusMagnitude = this.quantumNet!.phaseConsensus(quantumNeurons);

      // Grover-style amplification: mark and amplify whichever neuron currently
      // carries the strongest signal, separately from the consensus step above.
      let target = quantumNeurons[0];
      let targetHeight = -Infinity;
      for (const id of quantumNeurons) {
        const state = this.quantumNet!.getState(id);
        if (state && state.height > targetHeight) {
          targetHeight = state.height;
          target = id;
        }
      }
      this.quantumNet!.groverAmplify(quantumNeurons, target);

      // Collapse — amplitude-weighted sampling from the (now amplified)
      // Born-rule distribution built by createSuperposition/groverAmplify.
      quantumOutput = quantumNeurons.map(id => this.quantumNet!.collapse(id));
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
    let rlmAction: number;
    let rlmThinkingSteps: number[];
    {
      const t0 = Date.now();
      // Build state vector from quantum output, sized to rlm stateDim
      const stateVec = new Float32Array(
        this.resizeArray(quantumOutput, this.config.hiddenDim)
      );
      const decision = this.rlm!.selectAction(stateVec);
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
    let alignment: VetoDecision;
    {
      const t0 = Date.now();
      const capabilities: string[] = [];
      for (const pluginId of selectedPlugins) {
        const def = pluginExtensions[pluginId as keyof typeof pluginExtensions];
        if (def?.capabilities) capabilities.push(...def.capabilities);
      }
      alignment = this.alignmentVeto!.evaluate(
        { id: `rlm-action-${rlmAction}`, name: `action ${rlmAction}`, capabilities, reversible: true },
        { selfModelSurprise },
      );
      steps.push({
        name: 'alignment-veto',
        inputShape: [capabilities.length],
        outputShape: [alignment.allowed ? 1 : 0],
        durationMs: Date.now() - t0,
      });
    }

    // ── Step 6: Token generation (combination) ──────────────────────────────
    let finalOutput: number[];
    {
      const t0 = Date.now();
      
      // Emit output to Zip I/O Loop
      const outputText = `Action:${rlmAction}|Quantum:${quantumOutput.slice(0,3).join(',')}|Steps:${rlmThinkingSteps.length}`;
      await this.zipIO!.emit(outputText);
      
      finalOutput = this.generateOutput(
        quantumOutput,
        moeOutput,
        rlmAction,
        rlmThinkingSteps
      );
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
    const stepDurations = new Map<string, number>();
    for (const s of steps) {
      stepDurations.set(s.name, s.durationMs);
    }
    this.runHistory.push({ totalDurationMs, stepDurations });

    return {
      output: finalOutput,
      steps,
      totalDurationMs,
      selectedPlugins,
      alignment,
      selfModelSurprise,
      liveCorrections,
    };
  }

  // ─── Stats ──────────────────────────────────────────────────────────

  getStats(): { avgDurationMs: number; stepBreakdown: Map<string, number>; runsCount: number } {
    const runsCount = this.runHistory.length;
    if (runsCount === 0) {
      return { avgDurationMs: 0, stepBreakdown: new Map(), runsCount: 0 };
    }

    const totalDuration = this.runHistory.reduce((s, r) => s + r.totalDurationMs, 0);
    const avgDurationMs = totalDuration / runsCount;

    // Average duration per step across all runs
    const stepTotals = new Map<string, { sum: number; count: number }>();
    for (const record of this.runHistory) {
      for (const [stepName, dur] of record.stepDurations) {
        const existing = stepTotals.get(stepName) ?? { sum: 0, count: 0 };
        stepTotals.set(stepName, { sum: existing.sum + dur, count: existing.count + 1 });
      }
    }

    const stepBreakdown = new Map<string, number>();
    for (const [name, { sum, count }] of stepTotals) {
      stepBreakdown.set(name, sum / count);
    }

    return { avgDurationMs, stepBreakdown, runsCount };
  }

  // ─── Reset ──────────────────────────────────────────────────────────

  reset(): void {
    this.runHistory = [];
    // Tear down subsystems so they are re-created fresh on next run
    this.moeRouter = null;
    this.mesh = null;
    this.hyperEngine = null;
    this.rlm = null;
    this.valueRange = null;
    this.quantumNet = null;
    this.zipIO = null;
    this.valueInitialized = false;
  }

  /**
   * Access the Zip I/O system for context iteration
   */
  getZipIO(): ZipIOSystem | null {
    return this.zipIO;
  }

  /**
   * MoE expert index → real plugin/skill id, for introspection of which
   * concrete capability each expert slot represents.
   */
  getExpertPluginMap(): Map<number, string> {
    return new Map(this.expertPluginMap);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Resize a Float32Array to targetLength, zero-padding or truncating.
   */
  private resizeVector(vec: Float32Array, targetLength: number): Float32Array {
    if (vec.length === targetLength) return vec;
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
  private resizeArray(arr: number[], targetLength: number): number[] {
    if (arr.length === targetLength) return arr;
    const out = new Array<number>(targetLength).fill(0);
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
  private generateOutput(
    hyperOutput: number[],
    moeOutput: Float32Array,
    rlmAction: number,
    rlmThinkingSteps: number[]
  ): number[] {
    const outLen = this.config.embeddingDim;
    const out = new Array<number>(outLen).fill(0);

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
