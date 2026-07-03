import * as fs from "fs";
import * as path from "path";

interface ModelData {
  id: string;
  name: string;
  version: string;
  format: string;
  weights: Record<string, number[]>;
  metadata?: Record<string, any>;
}

class ModelFileLoader {
  loadModel(filePath: string): ModelData {
    const absolutePath = path.resolve(filePath);
    const raw = fs.readFileSync(absolutePath, "utf-8");
    const data = JSON.parse(raw);
    if (!this.validateModel(data)) {
      throw new Error(`Invalid model format in file: ${filePath}`);
    }
    return data as ModelData;
  }

  getModelInfo(model: ModelData): Record<string, any> {
    return {
      id: model.id,
      name: model.name,
      version: model.version,
      format: model.format,
      weightCount: Object.keys(model.weights).length,
      weightShapes: Object.fromEntries(
        Object.entries(model.weights).map(([k, v]) => [k, v.length])
      ),
      metadata: model.metadata || {},
    };
  }

  listModels(directory: string): string[] {
    const dir = path.resolve(directory);
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => path.join(dir, f));
  }

  validateModel(data: any): data is ModelData {
    if (!data || typeof data !== "object") return false;
    if (typeof data.id !== "string" || !data.id) return false;
    if (typeof data.name !== "string") return false;
    if (typeof data.version !== "string") return false;
    if (typeof data.format !== "string") return false;
    if (!data.weights || typeof data.weights !== "object" || Array.isArray(data.weights)) return false;
    for (const key of Object.keys(data.weights)) {
      if (!Array.isArray(data.weights[key])) return false;
    }
    return true;
  }
}

export { ModelFileLoader };
export type { ModelData as LegacyModelData } from "./index.js";

export { NeuroclawLLM } from "./llm.js";
export type { LLMConfig, GenerateOptions } from "./llm.js";
export { SkillsManager } from "./skills-manager.js";
export type { SkillActivation, SkillUsageStats, SkillsManagerConfig } from "./skills-manager.js";
export { PROGRAMMING_SKILLS, getSkillById, getSkillsByCategory, getSkillsByExpertType, searchSkills, getAllCategories, getAllExpertTypes } from "./programming-skills.js";
export type { ProgrammingSkill } from "./programming-skills.js";
export { ModelManager } from "./model-manager.js";
export type { ModelMetadata, ModelData, ModelLoadOptions, ModelSaveOptions, ModelManagerConfig } from "./model-manager.js";
export { PluginManager } from "./plugin-manager.js";
export type { PluginMetadata, PluginInstance, PluginManagerConfig } from "./plugin-manager.js";
export { MixtureOfExperts } from "./moe.js";
export type { Expert } from "./moe.js";
export { ThesaurusDictionary, ThesaurusFactory } from "./thesaurus.js";
export type { DictionaryEntry, ThesaurusData } from "./thesaurus.js";
export { NeuroclawTrainer } from "./trainer.js";
export type { TrainingConfig, NGramTable, TrainedWeights } from "./trainer.js";
export { Tokenizer } from "./tokenizer.js";
export { Neuron } from "./neuron.js";
export type { NeuronState } from "./neuron.js";
export { SimulationEngine } from "./simulation.js";
export type { IntentAnalysis, SimulationResult, ReviewOutcome, FinalOutput, WH } from "./simulation.js";
export { lookupDictionary, lookupThesaurus, lookupWord } from "./dictionary.js";
export type { ThesaurusEntry, WordLookup } from "./dictionary.js";
export { BackgroundQuantizer } from "./core/quantizer.js";
export type { QuantizerConfig } from "./core/quantizer.js";
export { ValueRangeAllocator } from "./core/value-range.js";
export type { ValueRangeConfig, NeuronAllocation } from "./core/value-range.js";
export { MoERouter } from "./core/moe-router.js";
export type { MoEConfig, RouterDecision, MoELayerOutput, ExpertUtilizationStats } from "./core/moe-router.js";
export { NeuronMesh } from "./core/mesh.js";
export type { NeuronNode, MeshTopology, PropagationResult, MeshConfig } from "./core/mesh.js";
export { HyperDimensionalEngine } from "./core/hyperdimensional.js";
export type { HyperNeuron, StateTransition, HyperDimensionalOutput, HyperConfig, SeenPattern } from "./core/hyperdimensional.js";
export { RLMTrainer } from "./core/rlm.js";
export type { RLMConfig, Experience, ThinkStep, ReplayBuffer, TrainingResult, PolicyState } from "./core/rlm.js";
export { NeuroLangInterpreter } from "./core/neuro-lang.js";
export type { NeuriNeuron, ParseResult } from "./core/neuro-lang.js";
export { NeuroPipeline } from "./core/pipeline.js";
export type { PipelineConfig, PipelineStep, PipelineResult } from "./core/pipeline.js";
export { ExpertNetwork } from "./core/expert.js";
export type { ExpertConfig, ExpertMetadata } from "./core/expert.js";
