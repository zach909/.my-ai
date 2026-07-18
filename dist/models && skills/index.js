import * as fs from "fs";
import * as path from "path";
class ModelFileLoader {
    loadModel(filePath) {
        const absolutePath = path.resolve(filePath);
        const raw = fs.readFileSync(absolutePath, "utf-8");
        const data = JSON.parse(raw);
        if (!this.validateModel(data)) {
            throw new Error(`Invalid model format in file: ${filePath}`);
        }
        return data;
    }
    getModelInfo(model) {
        return {
            id: model.id,
            name: model.name,
            version: model.version,
            format: model.format,
            weightCount: Object.keys(model.weights).length,
            weightShapes: Object.fromEntries(Object.entries(model.weights).map(([k, v]) => [k, v.length])),
            metadata: model.metadata || {},
        };
    }
    listModels(directory) {
        const dir = path.resolve(directory);
        if (!fs.existsSync(dir)) {
            return [];
        }
        return fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => path.join(dir, f));
    }
    validateModel(data) {
        if (!data || typeof data !== "object")
            return false;
        if (typeof data.id !== "string" || !data.id)
            return false;
        if (typeof data.name !== "string")
            return false;
        if (typeof data.version !== "string")
            return false;
        if (typeof data.format !== "string")
            return false;
        if (!data.weights || typeof data.weights !== "object" || Array.isArray(data.weights))
            return false;
        for (const key of Object.keys(data.weights)) {
            if (!Array.isArray(data.weights[key]))
                return false;
        }
        return true;
    }
}
export { ModelFileLoader };
export { NeuroclawLLM } from "./llm.js";
export { SkillsManager } from "./skills-manager.js";
export { PROGRAMMING_SKILLS, getSkillById, getSkillsByCategory, getSkillsByExpertType, searchSkills, getAllCategories, getAllExpertTypes } from "./programming-skills.js";
export { ModelManager } from "./model-manager.js";
export { PluginManager } from "./plugin-manager.js";
export { MixtureOfExperts } from "./moe.js";
export { ThesaurusDictionary, ThesaurusFactory } from "./thesaurus.js";
export { NeuroclawTrainer } from "./trainer.js";
export { Tokenizer } from "./tokenizer.js";
export { Neuron } from "./neuron.js";
export { SimulationEngine } from "./simulation.js";
export { lookupDictionary, lookupThesaurus, lookupWord } from "./dictionary.js";
export { BackgroundQuantizer } from "./core/quantizer.js";
export { ValueRangeAllocator } from "./core/value-range.js";
export { MoERouter } from "./core/moe-router.js";
export { NeuronMesh } from "./core/mesh.js";
export { HyperDimensionalEngine } from "./core/hyperdimensional.js";
export { RLMTrainer } from "./core/rlm.js";
export { NeuroLangInterpreter } from "./core/neuro-lang.js";
export { NeuroPipeline } from "./core/pipeline.js";
export { ExpertNetwork } from "./core/expert.js";
