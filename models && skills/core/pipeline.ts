import { MoERouter } from './moe-router.js';
import { NeuronMesh } from './mesh.js';
import { HyperDimensionalEngine } from './hyperdimensional.js';
import { RLMTrainer } from './rlm.js';
import { ValueRangeAllocator } from './value-range.js';
import { QuantumNeuralNet } from './quantum-net.js';
import { ZipIOSystem } from './zip-io.js';

export interface PipelineConfig {
  embeddingDim: number;
  hiddenDim: number;
  meshNodes: number;
  hyperDimensions: number;
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

  // Timing history for stats
  private runHistory: RunRecord[] = [];

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Lazy initialisation ──────────────────────────────────────────────────

  private ensureSubsystems(): void {
    if (this.moeRouter) return; // already initialised

    this.valueRange = new ValueRangeAllocator({
      enabled: true,
      totalPoints: this.config.meshNodes * 10,
      minLearningRate: 0.0001,
      maxLearningRate: 0.01,
      redistributionInterval: 100,
      decayFactor: 0.01,
    });

    this.moeRouter = new MoERouter({
      numExperts: 8,
      topK: 2,
      inputDim: this.config.embeddingDim,
      outputDim: this.config.hiddenDim,
      expertHiddenDim: this.config.hiddenDim,
      loadBalancingLoss: 0.01,
    });

    this.mesh = new NeuronMesh({
      nodeCount: this.config.meshNodes,
      connectionDensity: 0.3,
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
      neuronCount: 64,
      stateTransitionThreshold: 0.4,
      noveltyDecay: 0.05,
      historyLength: 500,
      learningRate: 0.05,
      influenceDecay: 0.95,
      crossInfluenceStrength: 0.2,
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

    this.zipIO = new ZipIOSystem(50000); // 50k chunks for massive context loop
  }

  // ─── Core pipeline ────────────────────────────────────────────────────────

  /**
   * Run all 7 subsystems in sequence on an embedding vector.
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
    {
      const t0 = Date.now();
      // Resize embedding to match inputDim if needed
      const inputVec = this.resizeVector(embedding, this.config.embeddingDim);
      const layerOut = this.moeRouter!.forward(inputVec, 0);
      moeOutput = layerOut.output;
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
      const propagation = this.mesh!.propagate(meshInputs);
      // Collect final state values as an ordered array
      meshOutput = Array.from(propagation.finalStates.values());
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
    {
      const t0 = Date.now();
      // Pad/truncate mesh output to hyperDimensions
      const hyperInput = this.resizeArray(meshOutput, this.config.hyperDimensions);
      const hyperResult = this.hyperEngine!.process(hyperInput);
      hyperOutput = hyperResult.outputVector;
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
      // Register neurons with exclusive inputs and apply quantum interference
      const quantumNeurons: string[] = [];
      for (let i = 0; i < Math.min(10, hyperOutput.length); i++) {
        const neuronId = `q_neuron_${i}`;
        this.quantumNet!.addNeuron(neuronId, hyperOutput[i]);
        quantumNeurons.push(neuronId);
      }
      
      // Apply interference between adjacent neurons
      for (let i = 0; i < quantumNeurons.length - 1; i++) {
        this.quantumNet!.interfere(quantumNeurons[i], quantumNeurons[i + 1]);
      }
      
      // Collapse and collect outputs
      quantumOutput = quantumNeurons.map(id => this.quantumNet!.collapse(id));
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
    };
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

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

  // ─── Reset ────────────────────────────────────────────────────────────────

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
  }

  /**
   * Access the Zip I/O system for context iteration
   */
  getZipIO(): ZipIOSystem | null {
    return this.zipIO;
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
