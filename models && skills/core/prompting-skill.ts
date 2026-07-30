/**
 * Prompting Skill (Spec Section 10).
 *
 * Deliberately NOT named "Skill"/"SkillDefinition" (plugin_manager/types.ts,
 * the Skill Maker's registered-expert concept, Section 26) -- this is a
 * distinct capability for understanding and improving *prompts themselves*,
 * not an installable, self-authored expert the Mixture-of-Experts routes
 * around. A PromptingSkill instance is not registered in PluginRegistry and
 * has no SkillDefinition; it's plain orchestration logic that sits in front
 * of the goal structure (PlanTracker, Section 24) and the empathy-driven
 * autonomy gate (EmpathyEngine, Section 12).
 *
 * Understands the user's goal, identifies missing information, breaks a
 * complex request into smaller tasks, selects the relevant capability, and
 * improves unclear instructions -- then records the result onto the shared
 * PlanTracker rather than keeping a private, disconnected notion of "the
 * plan", so downstream constraint/success-condition checks operate on the
 * same goal record everything else in the system sees.
 */

import { IntentRouter, type SystemCapability } from "./intent-router.js";
import { PlanTracker, type GoalEvaluation } from "./plan-tracker.js";
import { EmpathyEngine } from "./empathy.js";

export interface PromptAnalysis {
  objective: string;
  missingInfo: string[];
  subtasks: string[];
  selectedCapability: SystemCapability;
  confidence: number;
  clarifiedPrompt: string;
}

/** Vague filler phrases that signal the request is under-specified. */
const VAGUE_MARKERS = ["the thing", "you know", "something like that", "whatever works", "etc", "idk", "kind of a"];

/** Split points for breaking a compound request into ordered subtasks. */
const SEQUENCE_SPLIT = /\s*(?:,?\s+and then\s+|\s*;\s*|\n)\s*/i;
const NUMBERED_ITEM = /^\s*\d+[.)]\s*/;

export class PromptingSkill {
  constructor(
    private readonly intentRouter: IntentRouter,
    private readonly plan: PlanTracker,
    private readonly empathy: EmpathyEngine,
  ) {}

  /**
   * Understand a raw user prompt well enough to act on it: detect missing
   * information, break it into subtasks, select the capability it routes to,
   * and record the objective/reason/steps onto the shared PlanTracker.
   */
  understand(input: string, reason?: string): PromptAnalysis {
    const trimmed = (input || "").trim();
    const missingInfo = this.detectMissingInfo(trimmed);
    const subtasks = this.breakDown(trimmed);
    const route = this.intentRouter.route(trimmed);

    this.plan.setObjective(trimmed);
    if (reason) this.plan.setReason(reason);
    if (subtasks.length > 1) this.plan.addSteps(subtasks);
    else if (trimmed) this.plan.addStep(trimmed);

    return {
      objective: trimmed,
      missingInfo,
      subtasks,
      selectedCapability: route.capability,
      confidence: route.confidence,
      clarifiedPrompt: this.clarify(trimmed, missingInfo),
    };
  }

  /**
   * Whether the system should proceed autonomously on the analyzed prompt or
   * pause and ask the user the missing-info questions first. Missing
   * information always blocks autonomy outright (fail safe: acting on a
   * guess is worse than asking); otherwise this defers to the same
   * empathy-derived alignment gate every other autonomous decision in this
   * codebase goes through (EmpathyEngine.canMakeAutonomousDecision()), not a
   * separate, ad hoc rule.
   */
  shouldProceedAutonomously(analysis: PromptAnalysis): boolean {
    if (analysis.missingInfo.length > 0) return false;
    return this.empathy.canMakeAutonomousDecision();
  }

  /**
   * Check whether a completed result actually satisfies the goal recorded on
   * the PlanTracker, using its declarative success/failure conditions
   * (Section 24) rather than just assuming the steps ran.
   */
  checkResult(state: Record<string, unknown> = {}): GoalEvaluation {
    return this.plan.evaluateConditions(state);
  }

  /** Deterministic, keyword-based gap detection -- same style as the rest of
   * this codebase's local heuristics (AlignmentVeto, EmpathyEngine). */
  private detectMissingInfo(input: string): string[] {
    const gaps: string[] = [];
    if (!input) {
      gaps.push("the request is empty");
      return gaps;
    }
    const lower = input.toLowerCase();
    const wordCount = input.split(/\s+/).filter(Boolean).length;

    if (wordCount <= 2) {
      gaps.push("the request is too short to identify a concrete objective");
    }
    for (const marker of VAGUE_MARKERS) {
      if (lower.includes(marker)) {
        gaps.push(`vague reference: "${marker}"`);
      }
    }
    // A bare pronoun subject with nothing else to anchor it to (no prior
    // objective on the shared plan to resolve it against).
    if (/^(it|this|that|these|those)\b/.test(lower) && !this.plan.getObjective()) {
      gaps.push("pronoun has no prior objective to resolve against");
    }
    return gaps;
  }

  /** Split an input containing multiple sequential asks into ordered subtasks. */
  private breakDown(input: string): string[] {
    if (!input) return [];
    const parts = input
      .split(SEQUENCE_SPLIT)
      .map(p => p.replace(NUMBERED_ITEM, "").trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : [input];
  }

  private clarify(input: string, missingInfo: string[]): string {
    if (missingInfo.length === 0) return input;
    return `${input} (needs clarification: ${missingInfo.join("; ")})`;
  }
}
