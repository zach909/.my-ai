/**
 * Working Memory (Spec Section 3).
 *
 * Temporary, task-scoped scratch state, distinct from the three other memory-
 * shaped systems already in this codebase so it doesn't duplicate any of
 * them:
 *   - PlanTracker (Section 24) already owns the goal, constraints, and plan
 *     steps -- WorkingMemory delegates to it via composition rather than
 *     keeping a second, driftable copy of "the current goal".
 *   - ZipIOSystem (Section 14) is the raw input/output circular buffer --
 *     compressed conversation/generation history, not structured task state.
 *   - LongTermMemory (Section 7) is persistent, relevance-retrieved storage.
 *     WorkingMemory is where a task's scratch state lives *while the task is
 *     running*; commitToLongTerm() is the one-way door from here into there
 *     ("when the task is finished, useful information can be transferred
 *     into long-term memory").
 *
 * What's left for WorkingMemory to actually own: current inputs, the active
 * reasoning trace, temporary calculations, and intermediate results.
 */
export class WorkingMemory {
    constructor(plan) {
        this.plan = plan;
        this.inputs = [];
        this.activeReasoning = [];
        this.temporaryCalculations = new Map();
        this.intermediateResults = [];
    }
    // Goal/constraints/plan are never duplicated here -- always read straight
    // through to the shared PlanTracker so there is exactly one source of truth.
    getGoal() {
        return this.plan.getObjective();
    }
    getConstraints() {
        return this.plan.getConstraints();
    }
    getCurrentPlan() {
        return this.plan.snapshot();
    }
    addInput(input) {
        if (input)
            this.inputs.push(input);
    }
    getInputs() {
        return [...this.inputs];
    }
    addReasoningStep(step) {
        if (step)
            this.activeReasoning.push(step);
    }
    getReasoning() {
        return [...this.activeReasoning];
    }
    setCalculation(key, value) {
        this.temporaryCalculations.set(key, value);
    }
    getCalculation(key) {
        return this.temporaryCalculations.get(key);
    }
    getCalculations() {
        return Object.fromEntries(this.temporaryCalculations);
    }
    addIntermediateResult(result) {
        if (result)
            this.intermediateResults.push(result);
    }
    getIntermediateResults() {
        return [...this.intermediateResults];
    }
    snapshot() {
        return {
            goal: this.getGoal(),
            constraints: this.getConstraints(),
            plan: this.getCurrentPlan(),
            inputs: this.getInputs(),
            activeReasoning: this.getReasoning(),
            temporaryCalculations: this.getCalculations(),
            intermediateResults: this.getIntermediateResults(),
        };
    }
    /**
     * Transfer this task's useful scratch state into long-term memory, then
     * clear the scratch state for the next task. The goal/constraints/plan
     * themselves are NOT cleared here -- that's PlanTracker.reset()'s job,
     * called separately by whoever owns starting the next task.
     */
    commitToLongTerm(memory, opts) {
        const goal = this.getGoal();
        const texts = [
            goal ? `Goal: ${goal}` : null,
            ...this.intermediateResults,
        ].filter((t) => !!t);
        const items = texts.length > 0 ? memory.consolidateFrom(texts, opts) : [];
        this.clearTaskState();
        return items;
    }
    /** Clear this task's scratch state (inputs/reasoning/calculations/results). */
    clearTaskState() {
        this.inputs = [];
        this.activeReasoning = [];
        this.temporaryCalculations = new Map();
        this.intermediateResults = [];
    }
}
