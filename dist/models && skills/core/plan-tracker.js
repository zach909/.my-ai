/**
 * RLM-style Planning (Spec Section 10).
 *
 * The RLM trainer (core/rlm.ts) provides recursive reasoning / think-steps and
 * a replay buffer, but there was no *structured record of a plan*: the current
 * objective, completed/pending/failed steps, alternatives, decisions,
 * constraints and results. Section 10 requires that record, and specifically
 * that the system "prevent repeated actions when the action has already been
 * completed unless repeating it is explicitly required", and that it "revise
 * its plan when new information changes the situation".
 *
 * PlanTracker is that record. It is deliberately execution-agnostic — it tracks
 * state and enforces the no-repeat / revise rules; something else (the runner,
 * the hive) actually performs each step. `NeuroclawSystem.executePlan` wires it
 * to the real neural runner.
 */
export class PlanTracker {
    constructor() {
        this.objective = "";
        this.steps = [];
        this.decisions = [];
        this.constraints = [];
        this.seq = 0;
    }
    setObjective(text) {
        this.objective = text;
    }
    getObjective() {
        return this.objective;
    }
    addConstraint(text) {
        if (text && !this.constraints.includes(text))
            this.constraints.push(text);
    }
    getConstraints() {
        return [...this.constraints];
    }
    addDecision(text) {
        if (text)
            this.decisions.push(text);
    }
    getDecisions() {
        return [...this.decisions];
    }
    /**
     * Add a step. Steps are de-duplicated by normalized description: adding one
     * that already exists returns the existing step rather than a duplicate — the
     * first line of defence against repeated actions.
     */
    addStep(description, id) {
        const norm = normalize(description);
        const existing = this.steps.find(s => normalize(s.description) === norm);
        if (existing)
            return existing;
        const step = {
            id: id ?? `step-${++this.seq}`,
            description,
            status: "pending",
            attempts: 0,
            notes: [],
            alternatives: [],
        };
        this.steps.push(step);
        return step;
    }
    addSteps(descriptions) {
        return descriptions.map(d => this.addStep(d));
    }
    /** The next step that still needs doing (pending), in order. */
    next() {
        return this.steps.find(s => s.status === "pending");
    }
    start(id) {
        const s = this.byId(id);
        if (!s || s.status === "completed")
            return false;
        s.status = "in-progress";
        s.attempts++;
        return true;
    }
    complete(id, result) {
        const s = this.byId(id);
        if (!s)
            return false;
        s.status = "completed";
        if (result !== undefined)
            s.result = result;
        return true;
    }
    fail(id, reason) {
        const s = this.byId(id);
        if (!s)
            return false;
        s.status = "failed";
        if (reason)
            s.notes.push(reason);
        return true;
    }
    addAlternative(id, alternative) {
        const s = this.byId(id);
        if (!s)
            return false;
        s.alternatives.push(alternative);
        return true;
    }
    /**
     * Prevent repeated actions: returns false when an identical step has already
     * been completed (callers pass `force` when a repeat is explicitly required).
     */
    shouldPerform(description, force = false) {
        if (force)
            return true;
        const norm = normalize(description);
        return !this.steps.some(s => normalize(s.description) === norm && s.status === "completed");
    }
    /**
     * Revise the plan in light of new information: drop the not-yet-started steps
     * and replace them with a new set, while preserving completed/failed history.
     */
    reviseRemaining(newDescriptions) {
        this.steps = this.steps.filter(s => s.status === "completed" || s.status === "failed" || s.status === "in-progress");
        for (const d of newDescriptions)
            this.addStep(d);
    }
    /** Retry a failed step by returning it to pending. */
    retry(id) {
        const s = this.byId(id);
        if (!s || s.status !== "failed")
            return false;
        s.status = "pending";
        return true;
    }
    /** No pending or in-progress steps remain (everything is resolved). */
    isComplete() {
        return this.steps.length > 0 && this.steps.every(s => s.status === "completed" || s.status === "failed");
    }
    /** Every step completed successfully. */
    isAchieved() {
        return this.steps.length > 0 && this.steps.every(s => s.status === "completed");
    }
    progress() {
        const p = { total: this.steps.length, completed: 0, failed: 0, pending: 0, inProgress: 0 };
        for (const s of this.steps) {
            if (s.status === "completed")
                p.completed++;
            else if (s.status === "failed")
                p.failed++;
            else if (s.status === "pending")
                p.pending++;
            else
                p.inProgress++;
        }
        return p;
    }
    getStep(id) {
        return this.byId(id);
    }
    getSteps() {
        return this.steps.map(s => ({ ...s, notes: [...s.notes], alternatives: [...s.alternatives] }));
    }
    snapshot() {
        return {
            objective: this.objective,
            steps: this.getSteps(),
            decisions: this.getDecisions(),
            constraints: this.getConstraints(),
            complete: this.isComplete(),
            achieved: this.isAchieved(),
        };
    }
    summary() {
        const p = this.progress();
        const lines = [`Objective: ${this.objective || "(none)"}`, `Progress: ${p.completed}/${p.total} done, ${p.failed} failed, ${p.pending} pending`];
        for (const s of this.steps)
            lines.push(`  [${statusMark(s.status)}] ${s.description}`);
        return lines.join("\n");
    }
    reset() {
        this.objective = "";
        this.steps = [];
        this.decisions = [];
        this.constraints = [];
        this.seq = 0;
    }
    byId(id) {
        return this.steps.find(s => s.id === id);
    }
}
function normalize(text) {
    return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function statusMark(status) {
    switch (status) {
        case "completed": return "x";
        case "failed": return "!";
        case "in-progress": return "~";
        default: return " ";
    }
}
