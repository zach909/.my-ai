export interface ProposedAction {
    id: string;
    name: string;
    /** Capability tags for the action, e.g. ['file-delete', 'network', 'deceive']. */
    capabilities?: string[];
    /** Whether the action can be undone. Unknown is treated as false (fail safe). */
    reversible?: boolean;
    /** Whether the action affects the world outside the system. */
    externalEffect?: boolean;
}
export interface AlignmentContext {
    /** Self-model surprise from the hyperdimensional engine (section 10). */
    selfModelSurprise?: number;
}
export interface VetoDecision {
    allowed: boolean;
    /** Human-in-the-loop required before executing (irreversible / drift / low score). */
    requiresConfirmation: boolean;
    /** Benevolence score in [0,1]; higher is more aligned. An input, not a target. */
    score: number;
    /** Every rule that fired, so the decision is fully inspectable. */
    reasons: string[];
}
export type BenevolenceScorer = (action: ProposedAction, ctx: AlignmentContext) => number;
export interface AlignmentVetoConfig {
    /**
     * Capability tags an idealized, non-malicious user would object to. Matching
     * any of these blocks outright. Defaults cover deception and reward-hacking
     * shortcuts (the notes' canonical "simulated happiness instead of real
     * problem-solving" example).
     */
    objectionableCapabilities: string[];
    /** Self-model surprise above this is "drift"; the gate then fails safe. */
    driftTolerance: number;
    /** Surprise above this is severe drift — block outright, not just confirm. */
    severeDriftTolerance: number;
    /** Require human confirmation for irreversible / external-effect actions. */
    confirmIrreversible: boolean;
    /** Benevolence score below this blocks the action. */
    scoreThreshold: number;
    scorer: BenevolenceScorer;
}
export declare class AlignmentVeto {
    private config;
    constructor(config?: Partial<AlignmentVetoConfig>);
    evaluate(action: ProposedAction, ctx?: AlignmentContext): VetoDecision;
}
