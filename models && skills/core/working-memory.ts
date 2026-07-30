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

import type { PlanTracker, PlanSnapshot } from "./plan-tracker.js";
import type { LongTermMemory, MemoryItem, RememberOptions } from "./long-term-memory.js";

export interface WorkingMemorySnapshot {
  goal: string;
  constraints: string[];
  plan: PlanSnapshot;
  inputs: string[];
  activeReasoning: string[];
  temporaryCalculations: Record<string, unknown>;
  intermediateResults: string[];
}

export class WorkingMemory {
  private inputs: string[] = [];
  private activeReasoning: string[] = [];
  private temporaryCalculations: Map<string, unknown> = new Map();
  private intermediateResults: string[] = [];

  constructor(private readonly plan: PlanTracker) {}

  // Goal/constraints/plan are never duplicated here -- always read straight
  // through to the shared PlanTracker so there is exactly one source of truth.
  getGoal(): string {
    return this.plan.getObjective();
  }
  getConstraints(): string[] {
    return this.plan.getConstraints();
  }
  getCurrentPlan(): PlanSnapshot {
    return this.plan.snapshot();
  }

  addInput(input: string): void {
    if (input) this.inputs.push(input);
  }
  getInputs(): string[] {
    return [...this.inputs];
  }

  addReasoningStep(step: string): void {
    if (step) this.activeReasoning.push(step);
  }
  getReasoning(): string[] {
    return [...this.activeReasoning];
  }

  setCalculation(key: string, value: unknown): void {
    this.temporaryCalculations.set(key, value);
  }
  getCalculation(key: string): unknown {
    return this.temporaryCalculations.get(key);
  }
  getCalculations(): Record<string, unknown> {
    return Object.fromEntries(this.temporaryCalculations);
  }

  addIntermediateResult(result: string): void {
    if (result) this.intermediateResults.push(result);
  }
  getIntermediateResults(): string[] {
    return [...this.intermediateResults];
  }

  snapshot(): WorkingMemorySnapshot {
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
  commitToLongTerm(memory: LongTermMemory, opts?: RememberOptions): MemoryItem[] {
    const goal = this.getGoal();
    const texts = [
      goal ? `Goal: ${goal}` : null,
      ...this.intermediateResults,
    ].filter((t): t is string => !!t);
    const items = texts.length > 0 ? memory.consolidateFrom(texts, opts) : [];
    this.clearTaskState();
    return items;
  }

  /** Clear this task's scratch state (inputs/reasoning/calculations/results). */
  clearTaskState(): void {
    this.inputs = [];
    this.activeReasoning = [];
    this.temporaryCalculations = new Map();
    this.intermediateResults = [];
  }
}
