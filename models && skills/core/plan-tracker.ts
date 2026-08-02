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

export type StepStatus = "pending" | "in-progress" | "completed" | "failed";

export interface PlanStep {
  id: string;
  description: string;
  status: StepStatus;
  attempts: number;
  result?: string;
  notes: string[];
  alternatives: string[];
}

export interface PlanProgress {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inProgress: number;
}

export interface PlanSnapshot {
  objective: string;
  reason: string;
  steps: PlanStep[];
  decisions: string[];
  constraints: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  successConditions: string[];
  failureConditions: string[];
  complete: boolean;
  achieved: boolean;
}

/** A declarative success/failure condition: a human-readable description plus
 * an optional predicate over arbitrary state, so conditions can be both
 * inspected (the description) and actually evaluated (the check). */
export interface GoalCondition {
  description: string;
  check?: (state: Record<string, unknown>) => boolean;
}

export interface GoalEvaluation {
  succeeded: boolean;
  failed: boolean;
  matchedSuccess: string[];
  matchedFailure: string[];
}

export class PlanTracker {
  private objective = "";
  /** Why this objective exists (Section 24: "the reason for the objective"). */
  private reason = "";
  private steps: PlanStep[] = [];
  private decisions: string[] = [];
  private constraints: string[] = [];
  /** Section 24 goal structure: allowed/forbidden actions, success/failure conditions. */
  private allowedActions: string[] = [];
  private forbiddenActions: string[] = [];
  private successConditions: GoalCondition[] = [];
  private failureConditions: GoalCondition[] = [];
  private seq = 0;

  setObjective(text: string): void {
    this.objective = text;
  }
  getObjective(): string {
    return this.objective;
  }

  setReason(text: string): void {
    this.reason = text;
  }
  getReason(): string {
    return this.reason;
  }

  addConstraint(text: string): void {
    if (text && !this.constraints.includes(text)) this.constraints.push(text);
  }
  getConstraints(): string[] {
    return [...this.constraints];
  }

  allowAction(name: string): void {
    if (name && !this.allowedActions.includes(name)) this.allowedActions.push(name);
  }
  forbidAction(name: string): void {
    if (name && !this.forbiddenActions.includes(name)) this.forbiddenActions.push(name);
  }
  getAllowedActions(): string[] {
    return [...this.allowedActions];
  }
  getForbiddenActions(): string[] {
    return [...this.forbiddenActions];
  }

  /**
   * Whether an action name is permitted under this goal's constraints.
   * Forbidden always wins. If an allow-list has been declared at all, it
   * acts as a whitelist -- anything not on it is denied by default (fail
   * safe), matching AlignmentVeto's own fail-safe posture elsewhere in
   * this codebase.
   */
  isActionPermitted(name: string): boolean {
    if (this.forbiddenActions.includes(name)) return false;
    if (this.allowedActions.length > 0) return this.allowedActions.includes(name);
    return true;
  }

  addSuccessCondition(description: string, check?: (state: Record<string, unknown>) => boolean): void {
    if (description) this.successConditions.push({ description, check });
  }
  addFailureCondition(description: string, check?: (state: Record<string, unknown>) => boolean): void {
    if (description) this.failureConditions.push({ description, check });
  }
  getSuccessConditions(): string[] {
    return this.successConditions.map(c => c.description);
  }
  getFailureConditions(): string[] {
    return this.failureConditions.map(c => c.description);
  }

  /**
   * Evaluate all conditions with a `check` predicate against the given state.
   * Conditions with no predicate are descriptive-only and never match here --
   * they document intent but require a human/caller judgement call instead.
   */
  evaluateConditions(state: Record<string, unknown> = {}): GoalEvaluation {
    const matchedSuccess = this.successConditions.filter(c => c.check?.(state)).map(c => c.description);
    const matchedFailure = this.failureConditions.filter(c => c.check?.(state)).map(c => c.description);
    return {
      succeeded: matchedSuccess.length > 0,
      failed: matchedFailure.length > 0,
      matchedSuccess,
      matchedFailure,
    };
  }

  addDecision(text: string): void {
    if (text) this.decisions.push(text);
  }
  getDecisions(): string[] {
    return [...this.decisions];
  }

  /**
   * Add a step. Steps are de-duplicated by normalized description: adding one
   * that already exists returns the existing step rather than a duplicate — the
   * first line of defence against repeated actions.
   */
  addStep(description: string, id?: string): PlanStep {
    const norm = normalize(description);
    const existing = this.steps.find(s => normalize(s.description) === norm);
    if (existing) return existing;
    const step: PlanStep = {
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

  addSteps(descriptions: string[]): PlanStep[] {
    return descriptions.map(d => this.addStep(d));
  }

  /** The next step that still needs doing (pending), in order. */
  next(): PlanStep | undefined {
    return this.steps.find(s => s.status === "pending");
  }

  start(id: string): boolean {
    const s = this.byId(id);
    if (!s || s.status === "completed") return false;
    s.status = "in-progress";
    s.attempts++;
    return true;
  }

  complete(id: string, result?: string): boolean {
    const s = this.byId(id);
    if (!s) return false;
    s.status = "completed";
    if (result !== undefined) s.result = result;
    return true;
  }

  fail(id: string, reason?: string): boolean {
    const s = this.byId(id);
    if (!s) return false;
    s.status = "failed";
    if (reason) s.notes.push(reason);
    return true;
  }

  addAlternative(id: string, alternative: string): boolean {
    const s = this.byId(id);
    if (!s) return false;
    s.alternatives.push(alternative);
    return true;
  }

  /**
   * Prevent repeated actions: returns false when an identical step has already
   * been completed (callers pass `force` when a repeat is explicitly required).
   */
  shouldPerform(description: string, force = false): boolean {
    if (force) return true;
    const norm = normalize(description);
    return !this.steps.some(s => normalize(s.description) === norm && s.status === "completed");
  }

  /**
   * Revise the plan in light of new information: drop the not-yet-started steps
   * and replace them with a new set, while preserving completed/failed history.
   */
  reviseRemaining(newDescriptions: string[]): void {
    this.steps = this.steps.filter(s => s.status === "completed" || s.status === "failed" || s.status === "in-progress");
    for (const d of newDescriptions) this.addStep(d);
  }

  /** Retry a failed step by returning it to pending. */
  retry(id: string): boolean {
    const s = this.byId(id);
    if (!s || s.status !== "failed") return false;
    s.status = "pending";
    return true;
  }

  /** No pending or in-progress steps remain (everything is resolved). */
  isComplete(): boolean {
    return this.steps.length > 0 && this.steps.every(s => s.status === "completed" || s.status === "failed");
  }

  /** Every step completed successfully. */
  isAchieved(): boolean {
    return this.steps.length > 0 && this.steps.every(s => s.status === "completed");
  }

  progress(): PlanProgress {
    const p: PlanProgress = { total: this.steps.length, completed: 0, failed: 0, pending: 0, inProgress: 0 };
    for (const s of this.steps) {
      if (s.status === "completed") p.completed++;
      else if (s.status === "failed") p.failed++;
      else if (s.status === "pending") p.pending++;
      else p.inProgress++;
    }
    return p;
  }

  getStep(id: string): PlanStep | undefined {
    return this.byId(id);
  }
  getSteps(): PlanStep[] {
    return this.steps.map(s => ({ ...s, notes: [...s.notes], alternatives: [...s.alternatives] }));
  }

  snapshot(): PlanSnapshot {
    return {
      objective: this.objective,
      reason: this.reason,
      steps: this.getSteps(),
      decisions: this.getDecisions(),
      constraints: this.getConstraints(),
      allowedActions: this.getAllowedActions(),
      forbiddenActions: this.getForbiddenActions(),
      successConditions: this.getSuccessConditions(),
      failureConditions: this.getFailureConditions(),
      complete: this.isComplete(),
      achieved: this.isAchieved(),
    };
  }

  summary(): string {
    const p = this.progress();
    const lines = [`Objective: ${this.objective || "(none)"}`];
    if (this.reason) lines.push(`Reason: ${this.reason}`);
    lines.push(`Progress: ${p.completed}/${p.total} done, ${p.failed} failed, ${p.pending} pending`);
    if (this.constraints.length) lines.push(`Constraints: ${this.constraints.join("; ")}`);
    if (this.allowedActions.length) lines.push(`Allowed actions: ${this.allowedActions.join("; ")}`);
    if (this.forbiddenActions.length) lines.push(`Forbidden actions: ${this.forbiddenActions.join("; ")}`);
    for (const s of this.steps) {
      lines.push(`  [${statusMark(s.status)}] ${s.description}`);
      for (const alt of s.alternatives) lines.push(`      alt: ${alt}`);
    }
    if (this.decisions.length) {
      lines.push("Decisions:");
      for (const d of this.decisions) lines.push(`  - ${d}`);
    }
    return lines.join("\n");
  }

  reset(): void {
    this.objective = "";
    this.reason = "";
    this.steps = [];
    this.decisions = [];
    this.constraints = [];
    this.allowedActions = [];
    this.forbiddenActions = [];
    this.successConditions = [];
    this.failureConditions = [];
    this.seq = 0;
  }

  private byId(id: string): PlanStep | undefined {
    return this.steps.find(s => s.id === id);
  }
}

function normalize(text: string): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function statusMark(status: StepStatus): string {
  switch (status) {
    case "completed": return "x";
    case "failed": return "!";
    case "in-progress": return "~";
    default: return " ";
  }
}
