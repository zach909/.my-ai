export { BackgroundQuantizer, CalibrationCollector, packLevels, unpackLevels, clampBits } from './quantizer';
export type {
  QuantizerConfig,
  QuantizationMethod,
  QuantizationMode,
  QuantizationScale,
  CalibrationStats,
  QuantizedTensor,
} from './quantizer';
export {
  detectHardwareProfile,
  computeSensitivity,
  resolveLayerBits,
  estimateMemorySavings,
  estimatePowerSavingsPercent,
  estimatePerformanceGain,
} from './quantization-hardware';
export type { HardwareProfile, HardwareKernel, LayerPrecisionRule, MixedPrecisionPolicy, MemoryEstimate } from './quantization-hardware';
export { BackgroundQuantizationScheduler } from './quantization-scheduler';
export type { QuantizationJobStatus, QuantizationJobProgress, QuantizationJobResult, ScheduleOptions } from './quantization-scheduler';
export { loadQuantizationConfig, normalizeQuantizationConfig, DEFAULT_QUANTIZATION_CONFIG } from './quantization-config';
export type { QuantizationSystemConfig } from './quantization-config';
export { ValueRangeAllocator } from './value-range';
export type { ValueRangeConfig, NeuronAllocation } from './value-range';
export { MoERouter } from './onebrain.js';
export type { MoEConfig, RouterDecision, MoELayerOutput, ExpertUtilizationStats } from './onebrain.js';
export { ExpertNetwork } from './expert';
export type { ExpertConfig, ExpertMetadata } from './expert';
export { NeuronMesh } from './onebrain.js';
export type { NeuronNode, MeshTopology, PropagationResult, MeshConfig } from './onebrain.js';
export { HyperDimensionalEngine } from './onebrain.js';
export type { HyperNeuron, StateTransition, HyperDimensionalOutput, HyperConfig, SeenPattern } from './onebrain.js';
export { RLMTrainer } from './rlm';
export type { RLMConfig, Experience, ThinkStep, ReplayBuffer, TrainingResult, PolicyState } from './rlm';
export { ThornsEngine, CodeToNet } from './thorns';
export type { QuestionDimension, ThornNode, QuestionNode, IntentResult, CrossCheckResult, SimulateResult, ThornsOutput, CodeNeuron, CodeNetTopology } from './thorns';
export { NeuroLangInterpreter } from './neuro-lang';
export type { ParseResult } from './neuro-lang';
export { NeuroPipeline } from './pipeline';
export type { PipelineConfig, PipelineStep, PipelineResult } from './pipeline';
export { QuantumNeuralNet, quantumNet } from './onebrain.js';
export type { QuantumState, QuantumNeuron } from './onebrain.js';
export { ZipIOSystem, InfiniteZipLoop } from './zip-io';
export type { ZipChunk } from './zip-io';

export { AlignmentVeto } from './alignment-veto';
export type { ProposedAction, AlignmentContext, VetoDecision, BenevolenceScorer, AlignmentVetoConfig } from './alignment-veto';

export { ElasticCoreBlock } from './elastic-core';
export type { ElasticCoreConfig, ElasticCoreRunOptions, ElasticCoreResult } from './elastic-core';

// Behavioral Code-to-Net (Section 21) — complements the structural CodeToNet in thorns.
export { CodeToNetCompiler, CodeNet } from './code-to-net';
export type { CodeNetMode, CodeNetJSON, CodeNetFunctionParams, CompileOptions, TestReport } from './code-to-net';

// Hive Mind (Section 13) & Chat Groups (Section 14).
export { HiveMind, HiveAgent, SharedBlackboard } from './hive-mind';
export type { HiveAgentSpec, AgentThinkFn, DelegateOptions } from './hive-mind';
export { ChatGroup } from './chat-group';
export type { ChatMessage, Decision } from './chat-group';

// Net Search (Section 22) — search over neural structures.
export { NetSearchEngine } from './net-search';
export type { SearchMode, SearchableStructure, SearchResult, NetSearchOptions } from './net-search';

// Long-term memory & retrieval (Section 7).
export { LongTermMemory } from './long-term-memory';
export type { MemoryItem, MemoryHit, RememberOptions, RetrieveOptions } from './long-term-memory';

// RLM-style planning (Section 10).
export { PlanTracker } from './plan-tracker';
export type { PlanStep, StepStatus, PlanProgress, PlanSnapshot } from './plan-tracker';

// Self-healing (Section 24).
export { SelfHealer } from './self-healer';
export type { HealableComponent, HealResult, HealReport } from './self-healer';

// Semantic context compression (Section 7).
export { ContextCompressor } from './context-compressor';
export type { CompressOptions, CompressionResult } from './context-compressor';

// System-level capability routing (Section 6).
export { IntentRouter } from './intent-router';
export type { SystemCapability, RouteDecision } from './intent-router';

// System-level self-modeling / prediction-vs-actual (Section 11 / ASI §9-10).
export { SelfMonitor } from './self-monitor';
export type { Observation, Severity, SelfMonitorConfig } from './self-monitor';

// AGI / ASI capability layer.
export { MistakeTracker } from './mistake-tracker';           // ASI §6
export type { Mistake, MistakeInput, FailureCause } from './mistake-tracker';
export { KnowledgeGraph } from './knowledge-graph';           // ASI §4
export type { Concept, Relation, ConceptHit } from './knowledge-graph';
export { ReasoningEngine } from './reasoning-engine';         // ASI §2 / §8
export type { ReasoningResult, ReasoningDeps, Approach, Subresult, ReasoningStep } from './reasoning-engine';
export { KnowledgeTransfer } from './knowledge-transfer';     // ASI §7
export type { SolvedProblem, TransferHit } from './knowledge-transfer';
export { SelfModel } from './self-model';                     // ASI §9
export type { DomainStat } from './self-model';
export { SelfImprovement } from './self-improvement';         // ASI §5
export type { Improvement } from './self-improvement';
export { AutonomousLearner } from './autonomous-learner';     // ASI §3
export type { LearnDecision, LearnResult, LearnOptions } from './autonomous-learner';
export { PredictionEngine } from './prediction-engine';       // ASI §10
export type { Prediction, PredictedOutcome, Comparison } from './prediction-engine';
export { DiscoveryEngine } from './discovery-engine';         // ASI §11
export type { Hypothesis, TestResult, Combination } from './discovery-engine';
