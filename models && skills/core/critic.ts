/**
 * Critic and Verification Systems (ASI §23).
 *
 * "The AI should not rely on a single process to judge its own answer."
 * `ReasoningEngine.reason()` already computes a `verified` flag, but that
 * flag is produced by the exact same process that produced the answer — it
 * only checks "did every subproblem resolve", never independently checks a
 * calculation, challenges an assumption against the evidence, tests code, or
 * compares this answer against an alternative. This module is a genuinely
 * separate system, composed from the existing independent tools (the
 * `KnowledgeGraph`'s contradiction search, `MathEngine`'s calculation
 * verification, `MistakeTracker`'s known-failure patterns) plus its own
 * assumption-challenge and answer-comparison logic, rather than duplicating
 * any of them.
 */

import type { KnowledgeGraph } from "./knowledge-graph.js";
import { MathEngine } from "./math-engine.js";
import type { MistakeTracker } from "./mistake-tracker.js";
import type { ReasoningResult } from "./reasoning-engine.js";

export interface CalculationClaim {
  expression: string;
  claimed: number;
  vars?: Record<string, number>;
}

export interface CalculationCheck extends CalculationClaim {
  verified: boolean;
  actual: number;
  difference: number;
}

export interface AssumptionChallenge {
  assumption: string;
  supported: boolean;
  reason: string;
}

export interface ContradictionFinding {
  from: string;
  to: string;
  assertedAs: string;
  contradictedAs: string;
}

export interface CodeTestResult {
  code: string;
  passed: boolean;
  detail: string;
}

export interface ReviewInput {
  /** The answer/result being reviewed. */
  claim: string;
  /** Facts the claim is supposed to rest on (e.g. ReasoningResult.available). */
  supportingFacts?: string[];
  /** Assumptions to specifically challenge (e.g. ReasoningResult.assumptions). */
  assumptions?: string[];
  /** Arithmetic/algebraic claims embedded in the result, to independently recompute. */
  calculations?: CalculationClaim[];
  /** Source snippets to test, if a code-test hook is supplied. */
  code?: string[];
  /** Entity names this claim concerns, to scope contradiction search. Matched case-insensitively against KnowledgeGraph relation endpoints; omit to search unscoped. */
  entities?: string[];
  /** A label identifying the task, for known-error-pattern lookup (defaults to `claim`). */
  task?: string;
}

export interface CriticReport {
  claim: string;
  knownErrorPatterns: string[];
  contradictions: ContradictionFinding[];
  calculationChecks: CalculationCheck[];
  assumptionChallenges: AssumptionChallenge[];
  codeTests: CodeTestResult[];
  passed: boolean;
  confidence: number;
  issues: string[];
}

export interface CriticDeps {
  knowledge?: KnowledgeGraph;
  math?: MathEngine;
  mistakes?: MistakeTracker;
  /** Runs a code snippet in whatever sandboxed environment the caller trusts (e.g. a plugin), and reports pass/fail. Never executed here directly — code-testing without a supplied runner is skipped, not faked. */
  testCode?: (code: string) => { passed: boolean; detail: string } | Promise<{ passed: boolean; detail: string }>;
}

export class Critic {
  private readonly math: MathEngine;

  constructor(private deps: CriticDeps = {}) {
    this.math = deps.math ?? new MathEngine();
  }

  /**
   * Independently review a single claim: search for known error patterns,
   * recompute any embedded calculations, challenge every stated assumption
   * against the supporting evidence, search the knowledge graph for
   * contradictions touching the entities involved, and run any supplied code
   * tests. Never trusts the caller's own verdict on itself.
   */
  async review(input: ReviewInput): Promise<CriticReport> {
    const issues: string[] = [];

    // "Search for errors": known failure patterns similar to this task,
    // looked up independently rather than trusting whatever bias the
    // process that produced the claim already applied internally.
    const knownErrorPatterns = this.deps.mistakes
      ? this.deps.mistakes.lessons(input.task ?? input.claim)
      : [];
    if (knownErrorPatterns.length) {
      issues.push(`${knownErrorPatterns.length} known failure pattern(s) apply to this task`);
    }

    // "Check calculations": recompute every embedded arithmetic claim from
    // scratch and compare, instead of trusting the number as stated.
    const calculationChecks: CalculationCheck[] = (input.calculations ?? []).map((c) => {
      const v = this.math.verify(c.expression, c.claimed, c.vars ?? {});
      return { ...c, verified: v.verified, actual: v.actual, difference: v.difference };
    });
    for (const c of calculationChecks) {
      if (!c.verified) {
        issues.push(`calculation failed: "${c.expression}" claimed ${c.claimed}, actual ${c.actual}`);
      }
    }

    // "Challenge assumptions": an assumption only counts as supported if some
    // supporting fact actually corroborates it. An assumption with nothing
    // behind it is exactly what "challenge" means here, not accepted at face
    // value just because the reasoning process that produced it believed it.
    const facts = input.supportingFacts ?? [];
    const assumptionChallenges: AssumptionChallenge[] = (input.assumptions ?? []).map((a) => {
      const supported = facts.some((f) => overlaps(f, a));
      return {
        assumption: a,
        supported,
        reason: supported
          ? "corroborated by at least one supporting fact"
          : "no supporting fact corroborates this assumption",
      };
    });
    for (const ac of assumptionChallenges) {
      if (!ac.supported) issues.push(`unchallenged assumption: "${ac.assumption}"`);
    }

    // "Search for contradictions": scoped to the entities this claim actually
    // concerns, so a global contradiction elsewhere in the graph isn't
    // wrongly attributed to a claim that has nothing to do with it.
    const contradictions: ContradictionFinding[] = [];
    if (this.deps.knowledge) {
      const scope = input.entities?.map((e) => e.toLowerCase().trim());
      for (const { a, b } of this.deps.knowledge.findContradictions()) {
        const inScope = !scope || scope.length === 0
          || scope.includes(a.from.toLowerCase().trim())
          || scope.includes(a.to.toLowerCase().trim());
        if (inScope) {
          contradictions.push({ from: a.from, to: a.to, assertedAs: a.type, contradictedAs: b.type });
        }
      }
      if (contradictions.length) issues.push(`${contradictions.length} contradiction(s) found in knowledge graph`);
    }

    // "Test code": only runs if the caller supplied a sandboxed runner.
    // Never executes anything itself — an uninjected hook means code-testing
    // is honestly skipped, not silently assumed to pass.
    const codeTests: CodeTestResult[] = [];
    if (this.deps.testCode) {
      for (const code of input.code ?? []) {
        const r = await this.deps.testCode(code);
        codeTests.push({ code, passed: r.passed, detail: r.detail });
        if (!r.passed) issues.push(`code test failed: ${r.detail}`);
      }
    }

    const passed =
      calculationChecks.every((c) => c.verified) &&
      assumptionChallenges.every((a) => a.supported) &&
      contradictions.length === 0 &&
      codeTests.every((c) => c.passed);

    let confidence = passed ? 0.9 : 0.6;
    confidence -= 0.15 * issues.length;
    confidence -= 0.05 * knownErrorPatterns.length;
    confidence = clamp01(confidence);

    return {
      claim: input.claim,
      knownErrorPatterns,
      contradictions,
      calculationChecks,
      assumptionChallenges,
      codeTests,
      passed,
      confidence,
      issues,
    };
  }

  /**
   * "The final answer can be selected after multiple systems evaluate the
   * result" — independently review each candidate answer to the same
   * problem and pick the one that best survives scrutiny, rather than
   * defaulting to whichever candidate happened to be produced first or by
   * the most senior agent.
   */
  async compareAnswers(
    candidates: Array<{ id: string } & ReviewInput>
  ): Promise<{ bestId: string; reports: Map<string, CriticReport> }> {
    const reports = new Map<string, CriticReport>();
    for (const c of candidates) reports.set(c.id, await this.review(c));
    let bestId = candidates[0]?.id ?? "";
    let bestScore = -Infinity;
    for (const [id, r] of reports) {
      const score = (r.passed ? 1 : 0) + r.confidence;
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
    return { bestId, reports };
  }

  /**
   * Build review input directly from a ReasoningEngine result, so the two
   * systems compose instead of the caller re-deriving the same fields.
   */
  static fromReasoningResult(result: ReasoningResult, extra: Partial<ReviewInput> = {}): ReviewInput {
    return {
      claim: result.result,
      task: result.problem,
      supportingFacts: result.available,
      assumptions: result.assumptions,
      entities: [result.objective],
      ...extra,
    };
  }
}

/** Token-overlap check: does `fact` corroborate `assumption`? Deterministic, no embeddings. */
function overlaps(fact: string, assumption: string): boolean {
  const factTokens = new Set(tokenize(fact));
  const assumptionTokens = tokenize(assumption).filter((t) => t.length > 2);
  if (assumptionTokens.length === 0) return false;
  const hits = assumptionTokens.filter((t) => factTokens.has(t)).length;
  return hits / assumptionTokens.length >= 0.4;
}

function tokenize(text: string): string[] {
  return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
