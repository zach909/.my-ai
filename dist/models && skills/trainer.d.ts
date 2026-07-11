import { ElasticCoreBlock } from './core/elastic-core.js';
export interface TrainingConfig {
    contextWindow: number;
    learningRate: number;
    epochs: number;
    ngramOrder: number;
    hiddenDim: number;
    useElasticCore: boolean;
    elasticNeurons: number;
    elasticStateDim: number;
}
export interface NGramTable {
    counts: Map<string, Map<number, number>>;
    totals: Map<string, number>;
}
export interface TrainedWeights {
    embeddings: Map<number, Float32Array>;
    hiddenWeights: Float32Array[];
    outputWeights: Float32Array[];
    biases: Float32Array;
    ngramTables: NGramTable[];
    unigramFrequencies: Float32Array;
    trained: boolean;
    trainingLoss: number;
    samplesProcessed: number;
}
export declare class NeuroclawTrainer {
    private config;
    private weights;
    private vocabSize;
    private charToId;
    private idToChar;
    private elasticCore;
    constructor(vocabSize: number, charToId: Map<string, number>, idToChar: Map<number, string>, config?: Partial<TrainingConfig>);
    train(text?: string): void;
    private buildNGramTables;
    private trainEmbeddings;
    private trainHiddenLayer;
    private trainElasticCoreLayer;
    predict(contextChars: string): Float32Array;
    getEmbedding(tokenId: number): Float32Array | null;
    isTrained(): boolean;
    getTrainingLoss(): number;
    getSamplesProcessed(): number;
    getElasticCore(): ElasticCoreBlock | null;
}
