/**
 * Empathy Engine Module
 *
 * Purpose: Keep model aligned with user feelings
 * Mechanism: Understands how the person feels and feels the same
 * Why: To stay on track and make decisions without user intervention
 * Example: Model was able to make decisions without the user
 */
export interface EmotionalState {
    valence: number;
    arousal: number;
    dominance: number;
    confidence: number;
}
export interface UserContext {
    recentInputs: string[];
    emotionalHistory: EmotionalState[];
    decisionPreferences: Map<string, number>;
    alignmentScore: number;
}
export interface EmpathyConfig {
    emotionalMemoryLength: number;
    alignmentThreshold: number;
    empathyStrength: number;
    adaptationRate: number;
}
export declare class EmpathyEngine {
    private config;
    private userContext;
    private modelEmotionalState;
    private keywordEmotions;
    constructor(config?: Partial<EmpathyConfig>);
    /**
     * Analyze user input to detect emotional state
     */
    analyzeEmotion(input: string): EmotionalState;
    /**
     * Update user context with new input and emotional analysis
     */
    updateUserContext(input: string): void;
    /**
     * Sync model's emotional state with user's emotion (empathy mechanism)
     */
    private syncEmotion;
    /**
     * Calculate how aligned the model is with the user
     */
    private updateAlignmentScore;
    /**
     * Get the model's current emotional state
     */
    getModelEmotion(): EmotionalState;
    /**
     * Get the user's average emotional state from history
     */
    getUserAverageEmotion(): EmotionalState;
    /**
     * Check if model is aligned enough to make autonomous decisions
     */
    canMakeAutonomousDecision(): boolean;
    /**
     * Adjust decision based on emotional alignment
     */
    adjustDecision(decision: string, context: string): string;
    /**
     * Adjust the tone of a decision/response
     */
    private adjustTone;
    /**
     * Record a decision preference for future learning
     */
    recordDecisionPreference(decisionType: string, userFeedback: number): void;
    /**
     * Get preference score for a decision type
     */
    getDecisionPreference(decisionType: string): number;
    /**
     * Get current alignment score
     */
    getAlignmentScore(): number;
    /**
     * Section 3 alignment veto: returns true when the proposed action should
     * be blocked because the model's alignment with the user is too low.
     *
     * Drift fails safe: when we can't be confident the action matches the
     * idealized user's preferences, we block it rather than guess.
     *
     * @param actionId  The RLM action index (or any numeric action id)
     * @param confidence  How confident the model is in this action (0-1).
     *                    Low confidence + low alignment = hard veto.
     */
    shouldVeto(actionId: number, confidence?: number): boolean;
    /**
     * Reset empathy engine state
     */
    reset(): void;
    /**
     * Linear interpolation helper
     */
    private lerp;
    /**
     * Initialize keyword-emotion mappings
     */
    private initializeKeywordEmotions;
}
export declare const empathyEngine: EmpathyEngine;
