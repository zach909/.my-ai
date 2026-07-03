export interface WH {
    text: string;
    synonyms: string[];
    examples: string[];
    definition: string;
}
export interface IntentAnalysis {
    rawInput: string;
    dimensions: {
        what: WH;
        who: WH;
        how: WH;
        why: WH;
        where: WH;
        when: WH;
    };
    coreConcept: string;
    confidence: number;
}
export interface SimulationResult {
    plan: string[];
    crossChecks: string[];
    errors: string[];
    output: string;
}
export interface ReviewOutcome {
    status: "done" | "continue" | "error";
    feedback: string;
    correctedOutput?: string;
}
export interface FinalOutput {
    input: string;
    output: string;
    plan: string[];
    iterations: number;
    saved: boolean;
}
export declare class SimulationEngine {
    analyzeIntent(input: string): IntentAnalysis;
    simulate(intent: IntentAnalysis): SimulationResult;
    review(result: SimulationResult): ReviewOutcome;
    run(input: string, maxIterations?: number): FinalOutput;
}
