/**
 * Self-Improvement (ASI §5).
 *
 * Controlled, measurable self-improvement: a proposed change is tested against
 * the current version, and kept only if it produces a measurable benefit —
 * never a blind change. Versioned snapshots let a failed change be identified
 * and reverted. This is the safe, test-and-verify wrapper the spec requires;
 * the *scoring* of a candidate is supplied by the caller (e.g. a held-out task
 * score, a smoke-pass count), so improvement is grounded in real evaluation.
 */
export class SelfImprovement {
    constructor(cfg = {}) {
        this.versions = new Map();
        this.log = [];
        this.seq = 0;
        this.margin = cfg.margin ?? 1e-9;
    }
    /** Save a known-good version of a target's state for later rollback. */
    snapshot(target, state) {
        const stack = this.versions.get(target) ?? [];
        stack.push(clone(state));
        this.versions.set(target, stack);
    }
    /** Number of stored versions for a target. */
    versionCount(target) {
        return this.versions.get(target)?.length ?? 0;
    }
    /** Revert to the previous stored version (drops the current), returning it. */
    rollback(target) {
        const stack = this.versions.get(target);
        if (!stack || stack.length === 0)
            return undefined;
        if (stack.length > 1)
            stack.pop();
        return clone(stack[stack.length - 1]);
    }
    /**
     * Evaluate a candidate change against the current version. Runs both scorers,
     * keeps the candidate only if it beats the baseline by at least `margin`, and
     * records the decision. Returns whether the change was kept.
     */
    async evaluate(target, description, baseline, candidate) {
        const baselineScore = await baseline();
        const candidateScore = await candidate();
        const kept = candidateScore > baselineScore + this.margin;
        const improvement = {
            id: `imp-${++this.seq}`,
            target,
            description,
            baselineScore,
            candidateScore,
            kept,
            timestamp: Date.now(),
        };
        this.log.push(improvement);
        return improvement;
    }
    /** Improvements that were kept (measured a real benefit). */
    kept() {
        return this.log.filter(i => i.kept);
    }
    history() {
        return [...this.log];
    }
}
function clone(x) {
    try {
        return structuredClone(x);
    }
    catch {
        return JSON.parse(JSON.stringify(x));
    }
}
