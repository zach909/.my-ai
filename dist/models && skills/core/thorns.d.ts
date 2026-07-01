/**
 * THORNS Engine — Thinking, Hypothesis, Observation, Reasoning, Novelty, Synthesis
 *
 * Multi-dimensional question analysis with cross-checking and simulation.
 * Used for intent detection, planning, and autonomous reasoning.
 */
export interface QuestionDimension {
    id: string;
    name: string;
    weight: number;
    answered: boolean;
    confidence: number;
}
export interface ThornNode {
    id: string;
    dimension: QuestionDimension;
    children: string[];
    parent: string | null;
    depth: number;
}
export interface QuestionNode {
    id: string;
    text: string;
    dimensions: QuestionDimension[];
    thorns: ThornNode[];
    intent: IntentResult;
    crossCheck: CrossCheckResult;
    simulation: SimulateResult;
}
export interface IntentResult {
    intent: 'query' | 'command' | 'creation' | 'analysis' | 'exploration';
    confidence: number;
    keywords: string[];
    entities: string[];
}
export interface CrossCheckResult {
    overallConfidence: number;
    dimensionScores: Map<string, number>;
    conflicts: string[];
    agreements: string[];
}
export interface SimulateResult {
    bestAction: string;
    alternatives: string[];
    successProbability: number;
    steps: string[];
}
export interface ThornsOutput {
    response: string;
    intent: IntentResult;
    crossCheck: CrossCheckResult;
    actionPlan: string[];
    simulation: SimulateResult;
    noveltyScore: number;
}
export interface CodeNeuron {
    id: string;
    bytecode: number[];
    behavior: string;
    inputs: string[];
    outputs: string[];
}
export interface CodeNetTopology {
    neurons: CodeNeuron[];
    connections: [string, string, number][];
    inputLayer: string[];
    outputLayer: string[];
}
export declare class ThornsEngine {
    private thesaurus;
    private questionHistory;
    private maxHistoryLength;
    constructor();
    /**
     * Main thinking entry point — analyzes input through all THORNS dimensions
     */
    think(input: string): Promise<ThornsOutput>;
    /**
     * Build a question node from input text
     */
    private buildQuestionNode;
    /**
     * Decompose input into question dimensions
     */
    private decomposeIntoDimensions;
    /**
     * Generate hypotheses about the input meaning
     */
    private generateHypotheses;
    /**
     * Gather observations from dictionary and thesaurus
     */
    private gatherObservations;
    /**
     * Cross-check hypotheses against observations
     */
    private crossCheck;
    /**
     * Compute novelty score based on history
     */
    private computeNovelty;
    /**
     * Simple text similarity using word overlap
     */
    private computeTextSimilarity;
    /**
     * Detect user intent from input and analysis
     */
    private detectIntent;
    /**
     * Simulate possible actions and their outcomes
     */
    private simulateActions;
    /**
     * Synthesize final response from all analysis components
     */
    private synthesizeResponse;
    /**
     * Get thesaurus data for a word
     */
    getThesaurusData(word: string): {
        X: string[];
        Y: string;
        Z: string[];
    } | null;
    /**
     * Get question history for debugging/analysis
     */
    getHistory(): QuestionNode[];
    /**
     * Clear history
     */
    clearHistory(): void;
}
/**
 * CodeToNet — Convert binary code to neural network representation
 */
export declare class CodeToNet {
    private neurons;
    private connections;
    constructor();
    /**
     * Import binary code and convert to neural net
     */
    importCode(bytecode: number[], behavior: string): CodeNetTopology;
    /**
     * Get topology as serializable object
     */
    getTopology(): CodeNetTopology;
    /**
     * Clear all neurons and connections
     */
    clear(): void;
}
