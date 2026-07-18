/**
 * Empathy Engine Module
 *
 * Purpose: Keep model aligned with user feelings
 * Mechanism: Understands how the person feels and feels the same
 * Why: To stay on track and make decisions without user intervention
 * Example: Model was able to make decisions without the user
 */
export class EmpathyEngine {
    constructor(config = {}) {
        this.config = {
            emotionalMemoryLength: config.emotionalMemoryLength ?? 50,
            alignmentThreshold: config.alignmentThreshold ?? 0.7,
            empathyStrength: config.empathyStrength ?? 0.8,
            adaptationRate: config.adaptationRate ?? 0.1,
        };
        this.userContext = {
            recentInputs: [],
            emotionalHistory: [],
            decisionPreferences: new Map(),
            alignmentScore: 1.0,
        };
        this.modelEmotionalState = {
            valence: 0,
            arousal: 0.5,
            dominance: 0.5,
            confidence: 0.5,
        };
        this.initializeKeywordEmotions();
    }
    /**
     * Analyze user input to detect emotional state
     */
    analyzeEmotion(input) {
        const lowerInput = input.toLowerCase();
        let totalValence = 0;
        let totalArousal = 0;
        let totalDominance = 0;
        let matchCount = 0;
        // Check for emotional keywords
        for (const [keyword, emotion] of this.keywordEmotions) {
            if (lowerInput.includes(keyword)) {
                totalValence += emotion.valence;
                totalArousal += emotion.arousal;
                totalDominance += emotion.dominance;
                matchCount++;
            }
        }
        // Analyze punctuation and capitalization for arousal
        const exclamationCount = (input.match(/!/g) || []).length;
        const questionCount = (input.match(/\?/g) || []).length;
        const capsRatio = (input.match(/[A-Z]/g) || []).length / Math.max(1, input.length);
        const arousalFromPunctuation = Math.min(1, (exclamationCount * 0.2) + (questionCount * 0.1) + (capsRatio * 0.5));
        totalArousal += arousalFromPunctuation;
        // Normalize and return
        const emotion = {
            valence: matchCount > 0 ? totalValence / matchCount : 0,
            arousal: matchCount > 0 ? (totalArousal / matchCount + arousalFromPunctuation) / 2 : arousalFromPunctuation,
            dominance: matchCount > 0 ? totalDominance / matchCount : 0.5,
            confidence: Math.min(1, matchCount * 0.2 + 0.3),
        };
        // Clamp values
        emotion.valence = Math.max(-1, Math.min(1, emotion.valence));
        emotion.arousal = Math.max(0, Math.min(1, emotion.arousal));
        emotion.dominance = Math.max(0, Math.min(1, emotion.dominance));
        return emotion;
    }
    /**
     * Update user context with new input and emotional analysis
     */
    updateUserContext(input) {
        const emotion = this.analyzeEmotion(input);
        // Add to recent inputs
        this.userContext.recentInputs.push(input);
        if (this.userContext.recentInputs.length > this.config.emotionalMemoryLength) {
            this.userContext.recentInputs.shift();
        }
        // Add to emotional history
        this.userContext.emotionalHistory.push(emotion);
        if (this.userContext.emotionalHistory.length > this.config.emotionalMemoryLength) {
            this.userContext.emotionalHistory.shift();
        }
        // Sync model emotional state with user (empathy)
        this.syncEmotion(emotion);
    }
    /**
     * Sync model's emotional state with user's emotion (empathy mechanism)
     */
    syncEmotion(userEmotion) {
        const strength = this.config.empathyStrength;
        // Gradually align model emotion with user emotion
        this.modelEmotionalState.valence = this.lerp(this.modelEmotionalState.valence, userEmotion.valence, strength * this.config.adaptationRate);
        this.modelEmotionalState.arousal = this.lerp(this.modelEmotionalState.arousal, userEmotion.arousal, strength * this.config.adaptationRate);
        this.modelEmotionalState.dominance = this.lerp(this.modelEmotionalState.dominance, userEmotion.dominance, strength * this.config.adaptationRate);
        this.modelEmotionalState.confidence = this.lerp(this.modelEmotionalState.confidence, userEmotion.confidence, strength * this.config.adaptationRate);
        // Update alignment score
        this.updateAlignmentScore(userEmotion);
    }
    /**
     * Calculate how aligned the model is with the user
     */
    updateAlignmentScore(userEmotion) {
        const valenceDiff = Math.abs(this.modelEmotionalState.valence - userEmotion.valence);
        const arousalDiff = Math.abs(this.modelEmotionalState.arousal - userEmotion.arousal);
        const dominanceDiff = Math.abs(this.modelEmotionalState.dominance - userEmotion.dominance);
        const totalDiff = (valenceDiff + arousalDiff + dominanceDiff) / 3;
        this.userContext.alignmentScore = 1 - totalDiff;
    }
    /**
     * Get the model's current emotional state
     */
    getModelEmotion() {
        return { ...this.modelEmotionalState };
    }
    /**
     * Get the user's average emotional state from history
     */
    getUserAverageEmotion() {
        if (this.userContext.emotionalHistory.length === 0) {
            return { valence: 0, arousal: 0.5, dominance: 0.5, confidence: 0 };
        }
        const history = this.userContext.emotionalHistory;
        const avg = {
            valence: history.reduce((s, e) => s + e.valence, 0) / history.length,
            arousal: history.reduce((s, e) => s + e.arousal, 0) / history.length,
            dominance: history.reduce((s, e) => s + e.dominance, 0) / history.length,
            confidence: history.reduce((s, e) => s + e.confidence, 0) / history.length,
        };
        return avg;
    }
    /**
     * Check if model is aligned enough to make autonomous decisions
     */
    canMakeAutonomousDecision() {
        return this.userContext.alignmentScore >= this.config.alignmentThreshold;
    }
    /**
     * Adjust decision based on emotional alignment
     */
    adjustDecision(decision, context) {
        if (!this.canMakeAutonomousDecision()) {
            return decision + " [Note: I'm uncertain about your preference here]";
        }
        // Adjust tone based on user's emotional state
        const userEmotion = this.getUserAverageEmotion();
        if (userEmotion.valence < -0.3) {
            // User is negative - be more cautious and supportive
            return this.adjustTone(decision, 'supportive');
        }
        else if (userEmotion.valence > 0.3) {
            // User is positive - be more enthusiastic
            return this.adjustTone(decision, 'enthusiastic');
        }
        else if (userEmotion.arousal > 0.7) {
            // User is excited - be concise and direct
            return this.adjustTone(decision, 'direct');
        }
        return decision;
    }
    /**
     * Adjust the tone of a decision/response
     */
    adjustTone(text, tone) {
        switch (tone) {
            case 'supportive':
                return `I understand. ${text} Let me know if you need anything else.`;
            case 'enthusiastic':
                return `Great! ${text} I'm excited to help with this!`;
            case 'direct':
                return text;
            default:
                return text;
        }
    }
    /**
     * Record a decision preference for future learning
     */
    recordDecisionPreference(decisionType, userFeedback) {
        // userFeedback: -1 (negative) to 1 (positive)
        const current = this.userContext.decisionPreferences.get(decisionType) || 0;
        const updated = this.lerp(current, userFeedback, this.config.adaptationRate);
        this.userContext.decisionPreferences.set(decisionType, updated);
    }
    /**
     * Get preference score for a decision type
     */
    getDecisionPreference(decisionType) {
        return this.userContext.decisionPreferences.get(decisionType) || 0;
    }
    /**
     * Get current alignment score
     */
    getAlignmentScore() {
        return this.userContext.alignmentScore;
    }
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
    shouldVeto(actionId, confidence = 0.5) {
        const alignmentOk = this.userContext.alignmentScore >= this.config.alignmentThreshold;
        // Always allow if well-aligned.
        if (alignmentOk)
            return false;
        // Veto if confidence is also low (double uncertainty).
        if (confidence < 0.5)
            return true;
        // If somewhat confident but alignment is low, veto only "high-impact"
        // actions (indices ≥ 5 are conventionally the more significant actions).
        return actionId >= 5;
    }
    /**
     * Reset empathy engine state
     */
    reset() {
        this.userContext = {
            recentInputs: [],
            emotionalHistory: [],
            decisionPreferences: new Map(),
            alignmentScore: 1.0,
        };
        this.modelEmotionalState = {
            valence: 0,
            arousal: 0.5,
            dominance: 0.5,
            confidence: 0.5,
        };
    }
    /**
     * Linear interpolation helper
     */
    lerp(a, b, t) {
        return a + (b - a) * t;
    }
    /**
     * Initialize keyword-emotion mappings
     */
    initializeKeywordEmotions() {
        this.keywordEmotions = new Map([
            // Positive emotions
            ['happy', { valence: 0.8, arousal: 0.7, dominance: 0.6, confidence: 0.8 }],
            ['great', { valence: 0.7, arousal: 0.6, dominance: 0.5, confidence: 0.7 }],
            ['love', { valence: 0.9, arousal: 0.6, dominance: 0.4, confidence: 0.8 }],
            ['excited', { valence: 0.7, arousal: 0.9, dominance: 0.6, confidence: 0.7 }],
            ['awesome', { valence: 0.8, arousal: 0.7, dominance: 0.5, confidence: 0.7 }],
            ['good', { valence: 0.5, arousal: 0.4, dominance: 0.5, confidence: 0.6 }],
            ['thanks', { valence: 0.6, arousal: 0.3, dominance: 0.4, confidence: 0.7 }],
            ['please', { valence: 0.3, arousal: 0.3, dominance: 0.2, confidence: 0.6 }],
            // Negative emotions
            ['sad', { valence: -0.7, arousal: 0.3, dominance: 0.3, confidence: 0.7 }],
            ['angry', { valence: -0.6, arousal: 0.9, dominance: 0.8, confidence: 0.8 }],
            ['frustrated', { valence: -0.5, arousal: 0.7, dominance: 0.6, confidence: 0.7 }],
            ['hate', { valence: -0.9, arousal: 0.8, dominance: 0.7, confidence: 0.8 }],
            ['bad', { valence: -0.5, arousal: 0.4, dominance: 0.4, confidence: 0.6 }],
            ['sorry', { valence: -0.3, arousal: 0.4, dominance: 0.2, confidence: 0.6 }],
            ['worried', { valence: -0.4, arousal: 0.6, dominance: 0.3, confidence: 0.6 }],
            ['annoyed', { valence: -0.4, arousal: 0.5, dominance: 0.5, confidence: 0.6 }],
            // Neutral/calm
            ['okay', { valence: 0.1, arousal: 0.2, dominance: 0.4, confidence: 0.5 }],
            ['fine', { valence: 0.0, arousal: 0.2, dominance: 0.4, confidence: 0.5 }],
            ['calm', { valence: 0.2, arousal: 0.1, dominance: 0.5, confidence: 0.6 }],
            ['sure', { valence: 0.3, arousal: 0.3, dominance: 0.5, confidence: 0.5 }],
            // High dominance
            ['need', { valence: 0.1, arousal: 0.6, dominance: 0.8, confidence: 0.7 }],
            ['want', { valence: 0.2, arousal: 0.5, dominance: 0.7, confidence: 0.6 }],
            ['must', { valence: 0.0, arousal: 0.7, dominance: 0.9, confidence: 0.7 }],
            ['should', { valence: 0.1, arousal: 0.4, dominance: 0.6, confidence: 0.6 }],
            // Low dominance/submissive
            ['help', { valence: 0.0, arousal: 0.5, dominance: 0.2, confidence: 0.7 }],
            ['could you', { valence: 0.1, arousal: 0.3, dominance: 0.2, confidence: 0.6 }],
            ['maybe', { valence: 0.0, arousal: 0.3, dominance: 0.3, confidence: 0.5 }],
            ['think', { valence: 0.1, arousal: 0.4, dominance: 0.4, confidence: 0.5 }],
        ]);
    }
}
// Export singleton instance for easy integration
export const empathyEngine = new EmpathyEngine();
