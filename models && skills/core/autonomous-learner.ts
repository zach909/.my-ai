/**
 * Autonomous Learning (ASI §3).
 *
 * When the system encounters new information, it must decide — not just store
 * it blindly: what the information means (a simple subject/relation/object
 * reading), whether it's reliable, whether it conflicts with existing
 * knowledge, whether it should be stored, whether it should become a skill or
 * extension (a recurring capability), or whether it updates something already
 * known. Critically: new learning must not automatically overwrite existing
 * knowledge — conflicting information is preserved as competing possibilities,
 * not silently replaced.
 *
 * This sits on top of the `KnowledgeGraph` (§4) for conflict detection and
 * concept storage; the caller decides what "create a skill/extension" means in
 * its own runtime (e.g. NeuroclawSystem can hand a `create-extension` decision
 * to the real ExtensionBuilder) — this module produces the decision, not the
 * side effect, so it stays deterministic and testable in isolation.
 */

import { KnowledgeGraph } from "./knowledge-graph.js";

export type LearnDecision =
  | "stored"
  | "updated-existing"
  | "conflict-preserved"
  | "recommend-skill"
  | "recommend-extension"
  | "ignored-unreliable";

export interface LearnResult {
  decision: LearnDecision;
  reliability: number;
  subject?: string;
  relation?: string;
  object?: string;
  reason: string;
}

export interface LearnOptions {
  /** Below this reliability, information is ignored rather than stored (default 0.25). */
  minReliability?: number;
  /** Repeated procedural learning on the same subject at/above this count -> recommend-extension. */
  extensionThreshold?: number;
  /** One below extensionThreshold -> recommend-skill. */
  skillThreshold?: number;
}

const HEDGE_WORDS = ["maybe", "perhaps", "possibly", "rumor", "rumour", "unconfirmed", "i think", "i heard", "not sure", "allegedly", "supposedly"];
const CONFIDENT_WORDS = ["always", "definitely", "confirmed", "verified", "measured", "proven", "certainly"];
const PROCEDURAL_WORDS = ["step", "first,", "then", "next,", "finally", "procedure", "algorithm", "process:"];

/** Relation types that assert the opposite of one another (shared with KnowledgeGraph). */
const NEGATION_PAIRS: Array<[string, string]> = [
  ["is", "is-not"], ["can", "cannot"], ["causes", "prevents"],
  ["true", "false"], ["increases", "decreases"], ["requires", "excludes"],
];

export class AutonomousLearner {
  private procedureCounts = new Map<string, number>();

  constructor(private knowledge: KnowledgeGraph) {}

  /**
   * Ingest a piece of information. Extracts a simple (subject relation object)
   * reading, checks reliability from linguistic hedging/confidence markers,
   * checks for a direct contradiction with existing knowledge, and returns a
   * decision. Conflicting information is *preserved* (both relations remain in
   * the graph, flagged) rather than overwritten.
   */
  learn(information: string, opts: LearnOptions = {}): LearnResult {
    const minReliability = opts.minReliability ?? 0.25;
    const extensionThreshold = opts.extensionThreshold ?? 3;
    const skillThreshold = opts.skillThreshold ?? 2;

    const reliability = estimateReliability(information);

    if (reliability < minReliability) {
      return { decision: "ignored-unreliable", reliability, reason: "Reliability below threshold (hedged/unsupported claim)" };
    }

    // Procedural/how-to information is tracked by the normalized text itself
    // (not by an is/can/causes triple, which most step-by-step instructions
    // never contain) so repeated teaching of the same procedure is recognized
    // as a recurring capability even when there's nothing to relate.
    if (isProcedural(information)) {
      const key = normalize(information);
      const count = (this.procedureCounts.get(key) ?? 0) + 1;
      this.procedureCounts.set(key, count);
      const label = information.length > 40 ? `${information.slice(0, 40)}…` : information;
      if (count >= extensionThreshold) {
        this.knowledge.integrate(label, information);
        return { decision: "recommend-extension", reliability, subject: label, reason: `Procedure seen ${count} times — recurring capability` };
      }
      if (count >= skillThreshold) {
        this.knowledge.integrate(label, information);
        return { decision: "recommend-skill", reliability, subject: label, reason: `Procedure seen ${count} times` };
      }
    }

    const triple = extractTriple(information);
    if (!triple) {
      this.knowledge.integrate(information, information);
      return { decision: "stored", reliability, reason: "No structured relation extracted; stored as a concept" };
    }

    const conflict = this.findConflict(triple.subject, triple.relation, triple.object);
    if (conflict) {
      // Preserve both: add the new relation alongside the existing one instead
      // of overwriting it, and flag it for the caller to resolve/reconcile.
      this.knowledge.relate(triple.subject, triple.relation, triple.object, { confidence: reliability });
      return {
        decision: "conflict-preserved",
        reliability,
        subject: triple.subject,
        relation: triple.relation,
        object: triple.object,
        reason: `Conflicts with existing "${triple.subject} ${conflict} ${triple.object}" — both preserved, not overwritten`,
      };
    }

    const existing = this.knowledge.getConcept(triple.subject);
    const isUpdate = !!existing && existing.definition.length > 0;
    this.knowledge.relate(triple.subject, triple.relation, triple.object, { confidence: reliability });
    return {
      decision: isUpdate ? "updated-existing" : "stored",
      reliability,
      subject: triple.subject,
      relation: triple.relation,
      object: triple.object,
      reason: isUpdate ? `Extended existing knowledge of "${triple.subject}"` : "New concept and relation recorded",
    };
  }

  /** Whether a contradicting relation already exists for (subject, object). */
  private findConflict(subject: string, relation: string, object: string): string | null {
    const negOf = new Map<string, string>();
    for (const [x, y] of NEGATION_PAIRS) { negOf.set(x, y); negOf.set(y, x); }
    const opposite = negOf.get(normalize(relation));
    if (!opposite) return null;
    const neighbors = this.knowledge.neighbors(subject, opposite);
    if (neighbors.some(n => normalize(n.concept.name) === normalize(object))) return opposite;
    return null;
  }
}

function estimateReliability(text: string): number {
  const t = text.toLowerCase();
  let score = 0.6;
  for (const h of HEDGE_WORDS) if (t.includes(h)) score -= 0.2;
  for (const c of CONFIDENT_WORDS) if (t.includes(c)) score += 0.15;
  if (/\d/.test(t)) score += 0.05; // specific/measured claims skew slightly more reliable
  return Math.max(0, Math.min(1, score));
}

function isProcedural(text: string): boolean {
  const t = text.toLowerCase();
  return PROCEDURAL_WORDS.some(w => t.includes(w));
}

/** Very small (subject, relation, object) extractor for simple declarative sentences. */
function extractTriple(text: string): { subject: string; relation: string; object: string } | null {
  const cleaned = text.trim().replace(/[.!?]+$/, "");
  const m = cleaned.match(/^(.+?)\s+(is not|isn't|cannot|can't|is|can|causes|prevents|requires|excludes|increases|decreases)\s+(.+)$/i);
  if (!m) return null;
  const subject = m[1].trim();
  let relation = m[2].toLowerCase().replace(/'/g, "");
  if (relation === "isnt" || relation === "is not") relation = "is-not";
  if (relation === "cant") relation = "cannot";
  const object = m[3].trim();
  if (!subject || !object) return null;
  return { subject, relation, object };
}

function normalize(text: string): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}
