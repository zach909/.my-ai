export { BackgroundQuantizer } from './quantizer';
export type { QuantizerConfig } from './quantizer';
export { ValueRangeAllocator } from './value-range';
export type { ValueRangeConfig, NeuronAllocation } from './value-range';
export { MoERouter } from './moe-router';
export type { MoEConfig, RouterDecision, MoELayerOutput, ExpertUtilizationStats } from './moe-router';
export { ExpertNetwork } from './expert';
export type { ExpertConfig, ExpertMetadata } from './expert';
export { NeuronMesh } from './mesh';
export type { NeuronNode, MeshTopology, PropagationResult, MeshConfig } from './mesh';
export { HyperDimensionalEngine } from './hyperdimensional';
export type { HyperNeuron, StateTransition, HyperDimensionalOutput, HyperConfig, SeenPattern } from './hyperdimensional';
export { RLMTrainer } from './rlm';
export type { RLMConfig, Experience, ThinkStep, ReplayBuffer, TrainingResult, PolicyState } from './rlm';
export { ThornsEngine, CodeToNet } from './thorns';
export type { QuestionDimension, ThornNode, QuestionNode, IntentResult, CrossCheckResult, SimulateResult, ThornsOutput, CodeNeuron, CodeNetTopology } from './thorns';
export { NeuroLangInterpreter } from './neuro-lang';
export type { ParseResult } from './neuro-lang';
export { NeuroPipeline } from './pipeline';
export type { PipelineConfig, PipelineStep, PipelineResult } from './pipeline';
export { QuantumNeuralNet, quantumNet } from './quantum-net';
export type { QuantumState, QuantumNeuron } from './quantum-net';
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
