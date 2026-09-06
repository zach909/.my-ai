import { MoERouter } from './onebrain.js';
import { HyperDimensionalEngine } from './onebrain.js';
import { RLMTrainer } from './rlm.js';
import { ValueRangeAllocator } from './value-range.js';
import { QuantumNeuralNet } from './onebrain.js';
import { ZipIOSystem } from './zip-io.js';
import { AlignmentVeto, type VetoDecision } from './alignment-veto.js';
import type { NeuronState } from '../../interface/types.js';
import { pluginExtensions } from '../../plugins/index.js';
import { PROGRAMMING_SKILLS } from '../programming-skills.js';
import { embedText } from './neuro-lang.js';

export interface PipelineConfig {
  embeddingDim: number;
  hiddenDim: number;
  /**
   * Kept for callers that still pass it; it no longer sizes a mesh, because
   * the separate mesh is gone. The one network's size is HYPER_NEURON_COUNT
   * plus however many neurons the experts and installed skills grew it by.
   */
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
  /**
   * Kept so existing configs still load. It selects nothing any more: there is
   * one network, and it is the hyperdimensional mesh. The two stages this used
   * to choose between -- an Elastic Core and a fallback NeuronMesh -- both
   * computed a plain weighted sum in front of the real network, which is what
   * made "every other neuron is part of it" false for half the agent's
   * neurons.
   */
  useElasticCore?: boolean;
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
  /** Section 3.3: 1 if live correction fired on this tick's hyperdimensional settle, else 0. */
  liveCorrections: number;
  /** Per-elastic-core-neuron movement from this tick, keyed by neuron id. */
  /** Per-neuron state change this tick, from the one network. */
  networkStateDeltas: Map<number, number>;
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
  useElasticCore: true,
};

const HYPER_NEURON_COUNT = 64;

export class NeuroPipeline {
  private config: PipelineConfig;

  // Subsystem instances — initialized lazily on first run to keep construction fast
  private moeRouter: MoERouter | null = null;
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
  /** What each expert is FOR, in words -- its name and capabilities, not just its id. */
  private expertMeaning: Map<string, string> = new Map();

  // Deterministic registry from real expert id -> neuron ids in the network.
  // Every plugin/skill expert gets at least one concrete neuron in the ONE
  // mesh; when the expert catalog outgrows the base size, ensureSubsystems()
  // grows the network and the value budget instead of silently reusing or
  // folding ids. An expert is a group of neurons inside the network, not a
  // network of its own.
  private expertNeuronRegistry: Map<string, number[]> = new Map();

  // Timing history for stats
  private runHistory: RunRecord[] = [];
  /**
   * run() -- reachable today only via NeuroclawRunner.startContinuous()'s
   * tick loop -- pushed to runHistory with no cap at all, the same
   * unbounded-array pattern already fixed this session for several other
   * classes' hot-path logs. A plain FIFO trim alone would silently make
   * getStats().runsCount plateau instead of reflecting the true lifetime
   * count (cli.ts displays it as "Pipeline: N runs"), so the true count is
   * tracked separately from the capped averaging window.
   */
  private readonly runHistoryCapacity = 5000;
  private totalRunsCount = 0;

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Lazy initialisation ──────────────────────────────────────────────────

  private ensureSubsystems(): void {
    if (this.moeRouter) return; // already initialised

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
    this.expertMeaning.clear();
    for (const def of Object.values(pluginExtensions)) {
      const expertId = this.moeRouter.addExpert({
        id: def.id,
        name: def.name,
        specialization: def.capabilities.join(',') || def.type,
      });
      this.expertPluginMap.set(expertId, def.id);
      this.expertMeaning.set(def.id, `${def.id} ${def.name} ${def.capabilities.join(' ')} ${def.type}`);
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
      this.expertMeaning.set(id, `${id} ${expertType} skills ${expertType}`);
    }

    // Expert neurons live in the ONE network, not in a stage in front of it.
    //
    // They used to be neurons of the Elastic Core, which ran before the
    // hyperdimensional engine and computed a plain weighted sum -- no network
    // weight, no network bias, no wave. So the neurons that carry the agent's
    // skills were the ones NOT running the equation, which is the wrong way
    // round. They are grouped neurons of the hyperdimensional mesh now: wired
    // all-to-all like every other, carrying every term, and gated per tick by
    // the group label rather than by living somewhere else.
    //
    // Registered after the engine is built, below, because it is the thing
    // they are being registered into.

    // The value budget must cover every neuron that consults it for a
    // learning rate — mesh nodes, any Elastic Core neurons grown for expert
    // coverage, and the separately-indexed hyperdimensional neurons.
    this.valueBudgetSize = HYPER_NEURON_COUNT;
    this.valueRange = new ValueRangeAllocator({
      enabled: true,
      totalPoints: this.valueBudgetSize * 10,
      minLearningRate: 0.0001,
      maxLearningRate: 0.01,
      redistributionInterval: 100,
      decayFactor: 0.01,
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
      // The hyperdimensional term and the wave layer, ON.
      //
      // Both defaulted to 0 in the engine, deliberately, so that adding them
      // could not change the arithmetic of every existing caller at once. The
      // cost of that caution was that nothing ever turned them on: the whole
      // structure -- the network's weight and bias in every connection, the
      // wave copy of each, the shared pool -- existed and was tested and was
      // not what the running agent actually computed. Real, tested, and
      // unreachable is the defect this project keeps finding in itself.
      //
      // So the live pipeline runs the full equation. Every connection carries
      // its own weight and bias plus the whole network's, in numbers and in
      // waves, and every neuron reads the pool at its own frequency.
      hyperGain: 1,
      hyperAdd: 1,
      hyperWaveGain: 1,
      hyperWaveAdd: 1,
      // Modest: this one lands inside tanh on every neuron, so it is the term
      // that saturates the mesh if it is set carelessly.
      waveGain: 0.1,
      // A bias on every connection, not one per receiving neuron shared across
      // all of them -- c = x*w + b per CONNECTION, as the architecture asks.
      connectionBias: true,
      // Room to settle. The engine's default ceiling is 8, and a wave network
      // needs more than that to reach its steady oscillation -- measured, 27
      // iterations on the first tick and 4-9 after. With a ceiling of 8 the
      // loop hit the wall every single tick and never once reported settling,
      // which made "the network settles into a state that represents the
      // input" a description of something that was not happening. Costs
      // nothing on a settled network, because the loop now stops when the
      // residual stops falling rather than running to the ceiling.
      propagationSteps: 32,
      ...(this.config.hyperSustainedDivergenceTicks !== undefined
        ? { sustainedDivergenceTicks: this.config.hyperSustainedDivergenceTicks } : {}),
      ...(this.config.hyperDivergenceTolerance !== undefined
        ? { divergenceTolerance: this.config.hyperDivergenceTolerance } : {}),
    });

    // Every expert gets its neurons in that one network. Grown past the base
    // size when the catalogue outruns it, so a machine with many plugins does
    // not have to share one neuron between two skills.
    const expertIds = Array.from(this.expertPluginMap.values());
    this.expertNeuronRegistry.clear();
    for (let i = 0; i < expertIds.length; i++) {
      const expertId = expertIds[i];
      const neuronId = i < HYPER_NEURON_COUNT ? i : this.hyperEngine.addNeurons(1)[0];
      if (neuronId === undefined) continue;
      this.hyperEngine.setNeuronGroup(neuronId, expertId);
      // Make the region a SPECIALITY, not just a label.
      //
      // Grouping a neuron and doing nothing else left every expert region
      // identical, so capabilityGap() -- which asks which region took the
      // input up -- had 43 regions that all answered the same thing to
      // everything. A familiar sentence read 0.955 of the usual level and a
      // string of symbols nothing had ever seen read 1.000.
      //
      // Tuning the incoming weights is what makes a region able to answer
      // differently; its state cannot, because a non-driven neuron is
      // recomputed from its inputs every tick.
      // Tuned to what the expert is FOR, not to its bare id.
      //
      // An id is one word -- "location", "camera" -- and ordinary traffic
      // does not line up with a single word, so every region read the same
      // low number for a sentence as for a string of symbols and nothing
      // could be told apart. The name and capabilities describe the same
      // expert in enough words to overlap with what people actually type.
      const meaning = this.expertMeaning.get(expertId) ?? expertId;
      this.hyperEngine.tuneNeuronTo(neuronId, 0, embedText(meaning, this.hyperEngine.getDimensions()));
      this.expertNeuronRegistry.set(expertId, [neuronId]);
    }
    this.valueBudgetSize = Math.max(this.valueBudgetSize, this.hyperEngine.getNeuronCount());

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

  /**
   * Grow the network by one neuron and enroll it in the zero-sum
   * ValueRangeAllocator without reinitializing existing allocations.
   *
   * Was addElasticNeuron(), and grew the Elastic Core -- a stage that no
   * longer exists. There is one network now, so growing is unambiguous: the
   * new neuron joins the mesh all-to-all and carries the same equation as
   * every neuron already in it.
   */
  growNetwork(group?: string): number {
    this.ensureSubsystems();
    this.ensureValueInitialized();
    const [neuronId] = this.hyperEngine!.addNeurons(1);
    if (neuronId === undefined) return -1;
    if (group) this.hyperEngine!.setNeuronGroup(neuronId, group);
    this.valueRange!.addNeuron(String(neuronId));
    this.valueBudgetSize = Math.max(this.valueBudgetSize, neuronId + 1);
    return neuronId;
  }

  getValeFraction(neuronId: number): number | undefined {
    this.ensureValueInitialized();
    return this.valueRange!.getValeFractions().get(String(neuronId));
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

    // ── Step 2: the network ─────────────────────────────────────────────
    //
    // ONE network, one equation. This used to be two stages: an Elastic Core
    // that computed a plain weighted sum, and then the hyperdimensional engine
    // that computed the real thing on whatever the first stage handed it. Half
    // the agent's neurons -- including every expert's, which is the worst half
    // to pick -- were therefore outside the equation entirely: no network
    // weight, no network bias, no wave, not connected to the neurons in the
    // other stage at all.
    //
    // Now the router's output goes straight into the mesh every neuron lives
    // in. Experts are groups of neurons inside it rather than a stage in front
    // of it: `activeGroups` says which are being asked this tick, `driven`
    // says which are fed the input directly, and everything else in the
    // network still computes, still all-to-all, still carrying its own weight
    // and bias plus the whole network's, in numbers and in waves.
    let hyperOutput: number[];
    let liveCorrections = 0;
    let networkStateDeltas = new Map<number, number>();
    {
      const t0 = Date.now();
      const networkInput = this.resizeArray(Array.from(this.resizeVector(moeOutput, this.config.hiddenDim)), this.config.hyperDimensions);
      const activeGroups = selectedPlugins.length > 0 ? new Set(selectedPlugins) : undefined;
      const driven = this.neuronIdsForExperts(selectedPlugins);
      const hyperResult = this.hyperEngine!.process(
        networkInput,
        this.getValueLearningRates(),
        driven.size > 0 ? driven : new Set([0]),
        this.getValeFractions(),
        { activeGroups },
      );
      hyperOutput = hyperResult.outputVector;
      liveCorrections = hyperResult.liveCorrections;
      networkStateDeltas = new Map(hyperResult.stateDeltas);
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
    // Capabilities come from whichever plugin experts the MoE actually picked.
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
      liveCorrections,
      networkStateDeltas,
    };
  }

  // ─── Stats ──────────────────────────────────────────────────────────

  getStats(): { avgDurationMs: number; stepBreakdown: Map<string, number>; runsCount: number } {
    // runsCount is the true lifetime total (totalRunsCount), independent of
    // runHistory's capped averaging window -- capping the window must not
    // make this displayed counter silently plateau.
    if (this.runHistory.length === 0) {
      return { avgDurationMs: 0, stepBreakdown: new Map(), runsCount: this.totalRunsCount };
    }

    const totalDuration = this.runHistory.reduce((s, r) => s + r.totalDurationMs, 0);
    const avgDurationMs = totalDuration / this.runHistory.length;

    // Average duration per step across all runs currently in the window
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

    return { avgDurationMs, stepBreakdown, runsCount: this.totalRunsCount };
  }

  // ─── Reset ──────────────────────────────────────────────────────────

  reset(): void {
    this.runHistory = [];
    this.totalRunsCount = 0;
    // Tear down subsystems so they are re-created fresh on next run
    this.moeRouter = null;
    this.hyperEngine = null;
    this.rlm = null;
    this.valueRange = null;
    this.expertNeuronRegistry.clear();
    this.quantumNet = null;
    this.zipIO = null;
    this.valueInitialized = false;
  }

  /**
   * Access the Zip I/O system for context iteration
   */
  /**
   * Build the subsystems now, without running anything through them.
   *
   * They were only ever built lazily by run(), and restorePersistedState() --
   * the other caller -- is skipped entirely unless zip persistence is
   * configured. So in a default deployment the pipeline's mesh and engine did
   * not exist until the first query, and anything asking the pipeline about
   * itself before then got null and had to guess whether that meant "empty" or
   * "not yet". This makes "make it ready" something a caller can just say.
   */
  ensureReady(): void {
    this.ensureSubsystems();
  }

  /**
   * The hyper-dimensional engine, once a run (or ensureReady()) has built it.
   *
   * Null before the first run rather than lazily constructed: building it here
   * would create a second engine with none of the run's configuration, and a
   * caller reaching an empty stand-in while believing it has the brain is
   * worse than being told there is nothing yet.
   *
   * Exposed so the Zip Loop (zip-halt.ts) can drive the real mesh through its
   * two input and two output neurons instead of a private copy of one.
   */
  getHyperEngine(): HyperDimensionalEngine | null {
    return this.hyperEngine;
  }

  /**
   * Build the brain now, and hand it back.
   *
   * getHyperEngine() deliberately returns null before the first run rather
   * than conjuring a stand-in. But there is one caller that legitimately needs
   * the real network before anything has been asked of it: installing a net
   * skill, which means grafting neurons INTO the mesh. On a fresh boot, saved
   * skills would otherwise find nothing to join and fall back to being
   * sentences in memory -- which is the exact difference between a net skill
   * and a prompting skill.
   *
   * This is the same construction the first run would do, done earlier and on
   * purpose, so what a skill joins is the real network and not a copy of it.
   */
  ensureBrain(): HyperDimensionalEngine {
    this.ensureSubsystems();
    return this.hyperEngine!;
  }

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

  /** Real plugin/skill id -> Elastic Core neuron ids that exist. */
  getExpertNeuronRegistry(): Map<string, number[]> {
    this.ensureSubsystems();
    return new Map(Array.from(this.expertNeuronRegistry, ([id, neurons]) => [id, [...neurons]]));
  }

  private neuronIdsForExperts(expertIds: string[]): Set<number> {
    const ids = new Set<number>();
    for (const expertId of expertIds) {
      for (const neuronId of this.expertNeuronRegistry.get(expertId) ?? []) ids.add(neuronId);
    }
    return ids;
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
