/**
 * Scientific & Creative Discovery (ASI §11).
 *
 * Generates and tests hypotheses from observations (observe → find patterns →
 * propose explanations → test against new observations → accept/reject), and
 * supports creativity by combining concepts that have not previously been
 * connected. Built on the `KnowledgeGraph` so a supported hypothesis or a
 * novel combination becomes real, connected knowledge rather than a one-off
 * string.
 *
 * The "pattern" a hypothesis proposes is a co-occurrence regularity across
 * observations (subject/object token pairs that repeatedly appear together) —
 * deterministic and falsifiable: `test()` genuinely checks a new observation
 * against the hypothesis and updates its support, rejecting it once
 * contradictions dominate.
 */

import { KnowledgeGraph } from "./knowledge-graph.js";

export interface Hypothesis {
  id: string;
  cause: string;
  effect: string;
  supportCount: number;
  contradictionCount: number;
  confidence: number;
  rejected: boolean;
  /** Promoted into the KnowledgeGraph as durable knowledge (see `improve()`). */
  promoted: boolean;
}

export interface TestResult {
  hypothesis: Hypothesis;
  supported: boolean;
  reason: string;
}

export interface Combination {
  name: string;
  definition: string;
  sources: [string, string];
}

export class DiscoveryEngine {
  private observations: string[] = [];
  private hypotheses = new Map<string, Hypothesis>();
  private seq = 0;
  private combinationFeedback = new Map<string, { useful: number; notUseful: number }>();

  constructor(private knowledge: KnowledgeGraph) {}

  /** Record a raw observation for later pattern-finding. */
  observe(fact: string): void {
    if (fact && fact.trim()) this.observations.push(fact.trim());
  }

  /**
   * Generate hypotheses: find token pairs that co-occur across observations
   * more often than chance would suggest, and propose "cause -> effect"
   * explanations ranked by how often the pattern holds.
   */
  generateHypotheses(topK = 5): Hypothesis[] {
    const tokenSets = this.observations.map(o => new Set(tokenize(o)));
    const pairCounts = new Map<string, number>();
    const singleCounts = new Map<string, number>();

    for (const set of tokenSets) {
      const tokens = Array.from(set);
      for (const t of tokens) singleCounts.set(t, (singleCounts.get(t) ?? 0) + 1);
      for (let i = 0; i < tokens.length; i++) {
        for (let j = 0; j < tokens.length; j++) {
          if (i === j) continue;
          const key = `${tokens[i]}=>${tokens[j]}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }

    const n = this.observations.length || 1;
    const candidates: Array<{ cause: string; effect: string; support: number }> = [];
    for (const [key, count] of pairCounts) {
      if (count < 2) continue; // need at least repeated co-occurrence
      const [cause, effect] = key.split("=>");
      // Require the effect to co-occur with the cause more than half the time
      // the cause appears — a real (if simple) conditional regularity, not noise.
      const causeCount = singleCounts.get(cause) ?? 1;
      const support = count / causeCount;
      if (support >= 0.5) candidates.push({ cause, effect, support: support * (count / n) });
    }
    candidates.sort((a, b) => b.support - a.support);

    const out: Hypothesis[] = [];
    for (const c of candidates.slice(0, topK)) {
      // "Reject failed explanations" (§11) has to actually stick: don't
      // resurrect a (cause, effect) pair that was already tested and
      // rejected as if nothing had been learned since.
      const rejectedMatch = Array.from(this.hypotheses.values()).find(h => h.cause === c.cause && h.effect === c.effect && h.rejected);
      if (rejectedMatch) continue;

      // Reuse an existing active hypothesis for the same pair instead of a
      // fresh duplicate, so its accumulated support/contradiction history
      // (from test()) persists and actually matters across calls.
      const existing = Array.from(this.hypotheses.values()).find(h => h.cause === c.cause && h.effect === c.effect && !h.rejected);
      if (existing) {
        out.push(existing);
        continue;
      }

      const h: Hypothesis = {
        id: `hyp-${++this.seq}`,
        cause: c.cause,
        effect: c.effect,
        supportCount: 1,
        contradictionCount: 0,
        confidence: Math.min(1, c.support),
        rejected: false,
        promoted: false,
      };
      this.hypotheses.set(h.id, h);
      out.push(h);
    }
    return out;
  }

  /**
   * Test a hypothesis against a new observation: if the cause is present and
   * the effect is too, that supports it; if the cause is present but the
   * effect is absent, that contradicts it. A hypothesis is rejected once
   * contradictions clearly outweigh support.
   */
  test(hypothesisId: string, newObservation: string): TestResult {
    const h = this.hypotheses.get(hypothesisId);
    if (!h) throw new Error(`Unknown hypothesis: ${hypothesisId}`);
    const tokens = new Set(tokenize(newObservation));
    const hasCause = tokens.has(h.cause);
    const hasEffect = tokens.has(h.effect);

    if (!hasCause) {
      return { hypothesis: h, supported: true, reason: "Observation does not involve the cause — not applicable, not contradictory" };
    }
    if (hasEffect) {
      h.supportCount++;
      h.confidence = h.supportCount / (h.supportCount + h.contradictionCount * 2);
      return { hypothesis: h, supported: true, reason: `Cause "${h.cause}" and effect "${h.effect}" co-occurred again` };
    }
    h.contradictionCount++;
    h.confidence = h.supportCount / (h.supportCount + h.contradictionCount * 2);
    if (h.contradictionCount > h.supportCount) {
      h.rejected = true;
      h.confidence = 0;
    }
    return { hypothesis: h, supported: false, reason: `Cause "${h.cause}" appeared without effect "${h.effect}"` };
  }

  getHypothesis(id: string): Hypothesis | undefined {
    return this.hypotheses.get(id);
  }
  activeHypotheses(): Hypothesis[] {
    return Array.from(this.hypotheses.values()).filter(h => !h.rejected);
  }

  /**
   * §11 step 9 — "improve successful explanations": a hypothesis that has
   * accumulated real, sustained support (never contradicted, and tested
   * enough times to trust it) is promoted from a tentative, in-memory
   * Hypothesis record into durable knowledge — a real "cause causes effect"
   * relation in the KnowledgeGraph, so the rest of the system (search,
   * follow, contradiction detection) can find and use it like any other
   * known fact, instead of it staying invisible outside this engine and at
   * risk of being silently forgotten. Idempotent: promoting an
   * already-promoted or not-yet-qualifying hypothesis is a no-op.
   */
  improve(hypothesisId: string, opts: { minSupport?: number } = {}): boolean {
    const h = this.hypotheses.get(hypothesisId);
    if (!h || h.rejected || h.promoted) return false;
    const minSupport = opts.minSupport ?? 3;
    if (h.contradictionCount > 0 || h.supportCount < minSupport) return false;
    this.knowledge.relate(h.cause, "causes", h.effect, { confidence: h.confidence });
    h.promoted = true;
    return true;
  }

  /**
   * Creativity: combine two concepts that have not previously been combined
   * into a new, named hybrid concept, and register it in the knowledge graph —
   * a real (if simple) generate-evaluate-combine-refine step, not a canned
   * template with no connection to actual knowledge. Novelty is checked by
   * whether this exact hybrid concept already exists (i.e. these two concepts
   * were already combined before), not by a pre-existing unrelated relation
   * between them.
   */
  combine(conceptA: string, conceptB: string): Combination | null {
    const a = this.knowledge.getConcept(conceptA) ?? this.knowledge.addConcept(conceptA);
    const b = this.knowledge.getConcept(conceptB) ?? this.knowledge.addConcept(conceptB);
    const name = `${titleCase(a.name)}-${titleCase(b.name)} hybrid`;
    if (this.knowledge.getConcept(name)) return null; // not novel — already combined before

    const definition = `A combination of "${a.name}" (${a.definition || "no definition"}) and "${b.name}" (${b.definition || "no definition"}), explored for properties neither has alone.`;
    this.knowledge.addConcept(name, definition);
    this.knowledge.relate(name, "combines", a.name, { confidence: 0.5 });
    this.knowledge.relate(name, "combines", b.name, { confidence: 0.5 });
    return { name, definition, sources: [a.name, b.name] };
  }

  /**
   * The missing "evaluate" and "refine" half of "generate-evaluate-combine-
   * refine" (§11): `combine()` only ever generated a hybrid concept and left
   * it there forever, at a fixed, never-updated confidence — nothing ever
   * evaluated whether an exploratory combination actually turned out to be
   * useful once real evidence arrived (e.g. it grounded a solve() that
   * verified), and nothing refined the combination's standing based on that
   * evidence. Real usefulness feedback strengthens or weakens the hybrid's
   * "combines" relations, exactly the way a hypothesis's confidence is
   * refined by `test()`/`improve()` — evidence-driven, not fabricated.
   */
  evaluateCombination(name: string, useful: boolean): boolean {
    const counts = this.combinationFeedback.get(name) ?? { useful: 0, notUseful: 0 };
    if (useful) counts.useful++; else counts.notUseful++;
    this.combinationFeedback.set(name, counts);
    const confidence = counts.useful / (counts.useful + counts.notUseful);
    const relations = this.knowledge.neighbors(name, "combines");
    if (relations.length === 0) return false;
    for (const n of relations) n.relation.confidence = confidence;
    return true;
  }
}

function tokenize(text: string): string[] {
  return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
}
function titleCase(text: string): string {
  return text.replace(/\b\w/g, c => c.toUpperCase());
}
