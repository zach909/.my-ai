import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { BackgroundQuantizer } from './core/quantizer.js';
import { NeuroclawLLM } from './llm.js';
export class ModelManager {
    config;
    models;
    loadedModels;
    quantizer;
    autoSaveTimer;
    constructor(config = {}) {
        this.config = {
            modelsDirectory: config.modelsDirectory ?? path.join(homedir(), '.neuroclaw', 'models'),
            maxCacheSize: config.maxCacheSize ?? 5,
            autoSave: config.autoSave ?? false,
            autoSaveInterval: config.autoSaveInterval ?? 300000, // 5 minutes
            defaultQuantizationBits: config.defaultQuantizationBits ?? 4,
            ...config
        };
        this.models = new Map();
        this.loadedModels = new Map();
        this.quantizer = new BackgroundQuantizer({
            enabled: true,
            bits: this.config.defaultQuantizationBits,
            method: 'mixed',
            calibrationSamples: 128,
            excludeLayers: []
        });
        this.autoSaveTimer = null;
        this.ensureDirectory();
        if (this.config.autoSave) {
            this.startAutoSave();
        }
    }
    ensureDirectory() {
        if (!fs.existsSync(this.config.modelsDirectory)) {
            fs.mkdirSync(this.config.modelsDirectory, { recursive: true });
        }
    }
    startAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }
        this.autoSaveTimer = setInterval(() => {
            this.saveAllModels();
        }, this.config.autoSaveInterval);
    }
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }
    registerModel(modelData) {
        const modelId = modelData.metadata.id;
        this.models.set(modelId, modelData);
        return modelId;
    }
    loadModel(modelId, options = { loadWeights: true, loadConfig: true, quantize: false }) {
        const modelPath = path.join(this.config.modelsDirectory, `${modelId}.json`);
        if (!fs.existsSync(modelPath)) {
            return null;
        }
        try {
            const raw = fs.readFileSync(modelPath, 'utf-8');
            const data = JSON.parse(raw);
            // Convert weight arrays back to Float32Array
            if (options.loadWeights && data.weights) {
                const convertedWeights = {};
                for (const [key, value] of Object.entries(data.weights)) {
                    convertedWeights[key] = new Float32Array(value);
                }
                data.weights = convertedWeights;
                // Quantize if requested
                if (options.quantize) {
                    const bits = options.quantizationBits ?? this.config.defaultQuantizationBits;
                    this.quantizer = new BackgroundQuantizer({
                        enabled: true,
                        bits,
                        method: 'mixed',
                        calibrationSamples: 128,
                        excludeLayers: []
                    });
                    // Convert to Float32Array for quantization
                    const floatWeights = {};
                    for (const [key, value] of Object.entries(data.weights)) {
                        floatWeights[key] = value instanceof Float32Array ? value : new Float32Array(value);
                    }
                    data.weights = this.quantizer.quantizeModel(floatWeights);
                    data.metadata.quantizationBits = bits;
                    data.metadata.format = 'quantized';
                }
            }
            this.models.set(modelId, data);
            return data;
        }
        catch (error) {
            console.error(`Failed to load model ${modelId}:`, error);
            return null;
        }
    }
    saveModel(modelId, options = { quantize: false, includeCheckpoints: false, compression: false }) {
        const modelData = this.models.get(modelId);
        if (!modelData) {
            return false;
        }
        try {
            let weightsToSave = modelData.weights;
            // Quantize if requested
            if (options.quantize) {
                const bits = options.quantizationBits ?? this.config.defaultQuantizationBits;
                this.quantizer = new BackgroundQuantizer({
                    enabled: true,
                    bits,
                    method: 'mixed',
                    calibrationSamples: 128,
                    excludeLayers: []
                });
                // Convert to Float32Array for quantization
                const floatWeights = {};
                for (const [key, value] of Object.entries(modelData.weights)) {
                    floatWeights[key] = value instanceof Float32Array ? value : new Float32Array(value);
                }
                weightsToSave = this.quantizer.quantizeModel(floatWeights);
                modelData.metadata.quantizationBits = bits;
                modelData.metadata.format = 'quantized';
            }
            // Convert Float32Array to regular arrays for JSON serialization
            const serializableWeights = {};
            for (const [key, value] of Object.entries(weightsToSave)) {
                serializableWeights[key] = Array.from(value);
            }
            const dataToSave = {
                ...modelData,
                weights: serializableWeights
            };
            // Remove checkpoints if not included
            if (!options.includeCheckpoints) {
                delete dataToSave.checkpoints;
            }
            const modelPath = path.join(this.config.modelsDirectory, `${modelId}.json`);
            const json = JSON.stringify(dataToSave, null, 2);
            fs.writeFileSync(modelPath, json, 'utf-8');
            // Update metadata
            modelData.metadata.updatedAt = Date.now();
            modelData.metadata.size = Buffer.byteLength(json, 'utf-8');
            return true;
        }
        catch (error) {
            console.error(`Failed to save model ${modelId}:`, error);
            return false;
        }
    }
    saveAllModels() {
        for (const modelId of this.models.keys()) {
            this.saveModel(modelId);
        }
    }
    deleteModel(modelId) {
        const modelPath = path.join(this.config.modelsDirectory, `${modelId}.json`);
        if (fs.existsSync(modelPath)) {
            fs.unlinkSync(modelPath);
        }
        this.models.delete(modelId);
        this.loadedModels.delete(modelId);
        return true;
    }
    getModel(modelId) {
        return this.models.get(modelId);
    }
    listModels() {
        const metadata = [];
        // List from memory
        for (const modelData of this.models.values()) {
            metadata.push(modelData.metadata);
        }
        // Also scan directory for models not in memory
        if (fs.existsSync(this.config.modelsDirectory)) {
            const files = fs.readdirSync(this.config.modelsDirectory);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const modelId = file.replace('.json', '');
                    if (!this.models.has(modelId)) {
                        try {
                            const modelPath = path.join(this.config.modelsDirectory, file);
                            const raw = fs.readFileSync(modelPath, 'utf-8');
                            const data = JSON.parse(raw);
                            metadata.push(data.metadata);
                        }
                        catch (error) {
                            // Skip invalid files
                        }
                    }
                }
            }
        }
        return metadata.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    loadLLM(modelId) {
        const modelData = this.getModel(modelId);
        if (!modelData) {
            return null;
        }
        // Check if already loaded
        if (this.loadedModels.has(modelId)) {
            return this.loadedModels.get(modelId);
        }
        // Check cache size
        if (this.loadedModels.size >= this.config.maxCacheSize) {
            // Unload least recently used model
            const firstKey = this.loadedModels.keys().next().value;
            if (firstKey) {
                this.unloadLLM(firstKey);
            }
        }
        // Create new LLM instance with model config
        const llm = new NeuroclawLLM(modelData.config);
        this.loadedModels.set(modelId, llm);
        return llm;
    }
    unloadLLM(modelId) {
        return this.loadedModels.delete(modelId);
    }
    getLoadedLLM(modelId) {
        return this.loadedModels.get(modelId);
    }
    createModel(name, description, config) {
        const modelId = `model_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const metadata = {
            id: modelId,
            name,
            version: '1.0.0',
            description,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            size: 0,
            format: 'json',
            tags: [],
            author: 'NeuroClaw',
            license: 'MIT'
        };
        const modelData = {
            metadata,
            weights: {},
            config,
            checkpoints: []
        };
        this.models.set(modelId, modelData);
        return modelData;
    }
    updateModelWeights(modelId, weights) {
        const modelData = this.models.get(modelId);
        if (!modelData) {
            return false;
        }
        modelData.weights = weights;
        modelData.metadata.updatedAt = Date.now();
        return true;
    }
    updateModelConfig(modelId, config) {
        const modelData = this.models.get(modelId);
        if (!modelData) {
            return false;
        }
        modelData.config = { ...modelData.config, ...config };
        modelData.metadata.updatedAt = Date.now();
        return true;
    }
    addCheckpoint(modelId, checkpointId) {
        const modelData = this.models.get(modelId);
        if (!modelData) {
            return false;
        }
        if (!modelData.checkpoints) {
            modelData.checkpoints = [];
        }
        modelData.checkpoints.push(checkpointId);
        modelData.metadata.updatedAt = Date.now();
        return true;
    }
    exportModel(modelId, exportPath) {
        const modelData = this.models.get(modelId);
        if (!modelData) {
            return false;
        }
        try {
            // Convert Float32Array to regular arrays
            const serializableWeights = {};
            for (const [key, value] of Object.entries(modelData.weights)) {
                serializableWeights[key] = Array.from(value);
            }
            const dataToSave = {
                ...modelData,
                weights: serializableWeights
            };
            const json = JSON.stringify(dataToSave, null, 2);
            fs.writeFileSync(exportPath, json, 'utf-8');
            return true;
        }
        catch (error) {
            console.error(`Failed to export model ${modelId}:`, error);
            return false;
        }
    }
    importModel(importPath, modelId) {
        try {
            const raw = fs.readFileSync(importPath, 'utf-8');
            const data = JSON.parse(raw);
            // Convert weight arrays back to Float32Array
            const convertedWeights = {};
            for (const [key, value] of Object.entries(data.weights)) {
                convertedWeights[key] = new Float32Array(value);
            }
            data.weights = convertedWeights;
            // Use provided ID or generate new one
            const finalModelId = modelId ?? data.metadata.id;
            data.metadata.id = finalModelId;
            data.metadata.updatedAt = Date.now();
            this.models.set(finalModelId, data);
            return finalModelId;
        }
        catch (error) {
            console.error(`Failed to import model from ${importPath}:`, error);
            return null;
        }
    }
    searchModels(query) {
        const lowerQuery = query.toLowerCase();
        const allModels = this.listModels();
        return allModels.filter(model => model.name.toLowerCase().includes(lowerQuery) ||
            model.description.toLowerCase().includes(lowerQuery) ||
            model.tags.some(tag => tag.toLowerCase().includes(lowerQuery)));
    }
    addTag(modelId, tag) {
        const modelData = this.models.get(modelId);
        if (!modelData) {
            return false;
        }
        if (!modelData.metadata.tags.includes(tag)) {
            modelData.metadata.tags.push(tag);
            modelData.metadata.updatedAt = Date.now();
        }
        return true;
    }
    removeTag(modelId, tag) {
        const modelData = this.models.get(modelId);
        if (!modelData) {
            return false;
        }
        const index = modelData.metadata.tags.indexOf(tag);
        if (index > -1) {
            modelData.metadata.tags.splice(index, 1);
            modelData.metadata.updatedAt = Date.now();
        }
        return true;
    }
    getModelStats(modelId) {
        const modelData = this.models.get(modelId);
        if (!modelData) {
            return null;
        }
        let totalParameters = 0;
        for (const weights of Object.values(modelData.weights)) {
            totalParameters += weights.length;
        }
        return {
            weightCount: Object.keys(modelData.weights).length,
            totalParameters,
            sizeBytes: modelData.metadata.size,
            format: modelData.metadata.format,
            quantized: modelData.metadata.format === 'quantized'
        };
    }
    clearCache() {
        this.loadedModels.clear();
    }
    getConfig() {
        return { ...this.config };
    }
    updateConfig(config) {
        const oldAutoSave = this.config.autoSave;
        this.config = { ...this.config, ...config };
        // Restart auto-save if changed
        if (this.config.autoSave !== oldAutoSave) {
            if (this.config.autoSave) {
                this.startAutoSave();
            }
            else {
                this.stopAutoSave();
            }
        }
    }
    shutdown() {
        this.stopAutoSave();
        this.saveAllModels();
        this.clearCache();
    }
    /**
     * Auto-update model metadata and check for new models.
     * Synchronizes with the model registry and updates quantization settings.
     */
    async autoUpdateModels() {
        const updates = [];
        // Check for any models that need metadata updates
        for (const [modelId, modelData] of this.models) {
            // Update tags if needed
            if (modelData.metadata && !modelData.metadata.tags) {
                modelData.metadata.tags = [];
                updates.push({ modelId, type: 'metadata_updated' });
            }
            // Check if quantization settings are current
            if (this.config.defaultQuantizationBits && 
                modelData.metadata.format === 'quantized' &&
                modelData.metadata.quantizationBits !== this.config.defaultQuantizationBits) {
                updates.push({ modelId, type: 'quantization_mismatch', suggestedBits: this.config.defaultQuantizationBits });
            }
        }
        // Scan directory for new model files
        if (fs.existsSync(this.config.modelsDirectory)) {
            const files = fs.readdirSync(this.config.modelsDirectory);
            for (const file of files.filter(f => f.endsWith('.json'))) {
                const modelId = file.replace('.json', '');
                if (!this.models.has(modelId)) {
                    // New model file found, load it
                    const loaded = this.loadModel(modelId);
                    if (loaded) {
                        updates.push({ modelId, type: 'new_model_loaded' });
                    }
                }
            }
        }
        return updates;
    }
    /**
     * Update a specific model's configuration or weights.
     */
    updateModel(modelId, updates) {
        const modelData = this.models.get(modelId);
        if (!modelData) {
            return false;
        }
        // Apply metadata updates
        if (updates.metadata) {
            modelData.metadata = { ...modelData.metadata, ...updates.metadata };
        }
        // Apply weight updates
        if (updates.weights) {
            modelData.weights = { ...modelData.weights, ...updates.weights };
        }
        // Apply config updates
        if (updates.config) {
            modelData.config = { ...modelData.config, ...updates.config };
        }
        modelData.metadata.updatedAt = Date.now();
        return true;
    }
}
