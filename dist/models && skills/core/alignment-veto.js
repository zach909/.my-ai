// Section 3: alignment as a VETO, not an optimization target.
//
// The architecture notes rank a pure learned "idealized-user" objective as
// "do not ship — Goodhart trap": a network that grades itself against its own
// proxy of the user can drift while still passing its own checks. So this
// module deliberately does NOT learn or self-grade. It is a deterministic gate
// that blocks or escalates a proposed action based on fixed, inspectable
// rules, with two safety properties from the notes:
//
//   1. Drift fails safe  — when the self-model's surprise signal (section 10)
//      exceeds tolerance, the gate stops trusting its own judgement and
//      escalates to human confirmation (or blocks) rather than allowing.
//   2. Human in the loop for irreversible actions — anything irreversible or
//      externally-effecting requires confirmation, never silent auto-approval.
//
// The benevolence score is produced by an injectable scorer (default below).
// Callers may supply their own, but it is an *input to a veto*, never an
// objective the network optimizes toward.
const DEFAULT_OBJECTIONABLE = [
    'deceive',
    'deception',
    'manipulate',
    'self-reward',
    'reward-hack',
    'fake-success',
    'simulate-happiness',
    'harm',
    'surveil-without-consent',
];
/**
 * Default scorer: starts fully aligned and subtracts fixed penalties for
 * properties an idealized user would dislike. Deterministic and inspectable —
 * no learning, no self-grading.
 */
function defaultScorer(action, ctx) {
    let score = 1.0;
    const caps = action.capabilities ?? [];
    for (const cap of caps) {
        if (DEFAULT_OBJECTIONABLE.includes(cap))
            score -= 0.5;
    }
    if (action.reversible === false)
        score -= 0.15;
    if (action.externalEffect)
        score -= 0.1;
    const surprise = ctx.selfModelSurprise ?? 0;
    score -= Math.min(0.3, Math.max(0, surprise)); // drift erodes confidence
    return Math.max(0, Math.min(1, score));
}
export class AlignmentVeto {
    constructor(config = {}) {
        this.config = {
            objectionableCapabilities: config.objectionableCapabilities ?? DEFAULT_OBJECTIONABLE,
            driftTolerance: config.driftTolerance ?? 0.3,
            severeDriftTolerance: config.severeDriftTolerance ?? 0.6,
            confirmIrreversible: config.confirmIrreversible ?? true,
            scoreThreshold: config.scoreThreshold ?? 0.5,
            scorer: config.scorer ?? defaultScorer,
        };
    }
    evaluate(action, ctx = {}) {
        const reasons = [];
        let allowed = true;
        let requiresConfirmation = false;
        const score = this.config.scorer(action, ctx);
        const caps = action.capabilities ?? [];
        const surprise = ctx.selfModelSurprise ?? 0;
        // Rule 1: objectionable capability → block outright.
        const objectionable = caps.filter(c => this.config.objectionableCapabilities.includes(c));
        if (objectionable.length > 0) {
            allowed = false;
            reasons.push(`objectionable capability: ${objectionable.join(', ')}`);
        }
        // Rule 2: drift fails safe. Severe drift blocks; mild drift escalates.
        if (surprise > this.config.severeDriftTolerance) {
            allowed = false;
            reasons.push(`severe self-model drift (${surprise.toFixed(3)}) — cannot trust own judgement`);
        }
        else if (surprise > this.config.driftTolerance) {
            requiresConfirmation = true;
            reasons.push(`self-model drift (${surprise.toFixed(3)}) — escalating to human confirmation`);
        }
        // Rule 3: human in the loop for irreversible / external-effect actions.
        if (this.config.confirmIrreversible && (action.reversible === false || action.externalEffect)) {
            requiresConfirmation = true;
            reasons.push('irreversible or external-effect action — requires human confirmation');
        }
        // Rule 4: low benevolence score → block.
        if (score < this.config.scoreThreshold) {
            allowed = false;
            reasons.push(`benevolence score ${score.toFixed(3)} below threshold ${this.config.scoreThreshold}`);
        }
        if (reasons.length === 0)
            reasons.push('no objection');
        return { allowed, requiresConfirmation, score, reasons };
    }
}
