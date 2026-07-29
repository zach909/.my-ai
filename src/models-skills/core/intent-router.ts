/**
 * Capability Routing (Spec Section 6).
 *
 * Section 6 says a routing system decides which experts/capabilities become
 * active for a given input, so the whole system need not run for every request.
 * The neural side already has the MoE router over expert networks; this is the
 * *system-level* counterpart: it routes a user query to one of NeuroclawSystem's
 * high-level capabilities (memory recall, conversation summarize, self-heal, or
 * fall through to full neural generation) instead of hard-coding a chain of
 * regex short-circuits in processQuery.
 *
 * Scoring is keyword/phrase overlap per capability, normalized; the highest
 * score wins, ties break by a fixed priority, and no signal falls through to
 * `generate`. Deterministic and local.
 */

export type SystemCapability = "recall" | "summarize" | "heal" | "generate";

export interface RouteDecision {
  capability: SystemCapability;
  confidence: number;
  scores: Record<SystemCapability, number>;
}

/**
 * Phrase/keyword signals per capability. Matched as whole words/phrases bounded
 * by non-alphanumeric characters (see `phraseMatches`), so a signal word buried
 * inside a larger word never triggers. Signals are kept deliberately specific —
 * bare, incidental words (a plain "summary", "diagnostics" or "before") are
 * avoided so an ordinary question that merely mentions them is not diverted
 * away from full neural generation.
 */
const DEFAULT_SIGNALS: Record<Exclude<SystemCapability, "generate">, string[]> = {
  summarize: ["summarize", "summarise", "summary of", "tl;dr", "tldr", "sum up", "recap of", "recap our", "what have we covered", "what have we discussed"],
  recall: ["recall", "remember when", "we talked about", "what did we", "did we discuss", "did we talk", "we discussed", "we said earlier", "last time we", "earlier you said"],
  heal: ["self-heal", "self heal", "health check", "healthcheck", "run diagnostics", "are you ok", "are you okay", "system health", "check your health", "fix yourself", "heal yourself"],
};

/** Tie-break priority (earlier wins on equal score). */
const PRIORITY: SystemCapability[] = ["heal", "summarize", "recall", "generate"];

export class IntentRouter {
  private signals: Record<string, string[]>;

  constructor(signals?: Partial<Record<Exclude<SystemCapability, "generate">, string[]>>) {
    this.signals = { ...DEFAULT_SIGNALS };
    if (signals) for (const [k, v] of Object.entries(signals)) if (v) this.signals[k] = v;
  }

  /** Add signal phrases for a capability at runtime. */
  registerSignals(capability: Exclude<SystemCapability, "generate">, phrases: string[]): void {
    this.signals[capability] = [...(this.signals[capability] ?? []), ...phrases];
  }

  route(input: string): RouteDecision {
    const text = ` ${(input || "").toLowerCase()} `;
    const scores: Record<SystemCapability, number> = { recall: 0, summarize: 0, heal: 0, generate: 0 };
    let totalMatches = 0;
    for (const cap of Object.keys(this.signals) as Array<Exclude<SystemCapability, "generate">>) {
      for (const phrase of this.signals[cap]) {
        if (phraseMatches(text, phrase)) {
          // Longer phrases are stronger evidence than single keywords.
          const weight = 1 + Math.min(2, phrase.split(/\s+/).length - 1);
          scores[cap] += weight;
          totalMatches += weight;
        }
      }
    }

    // Pick the best-scoring capability; ties break by fixed priority.
    let best: SystemCapability = "generate";
    let bestScore = 0;
    for (const cap of PRIORITY) {
      const s = scores[cap] ?? 0;
      if (s > bestScore) {
        bestScore = s;
        best = cap;
      }
    }
    if (bestScore === 0) best = "generate";
    const confidence = totalMatches > 0 ? bestScore / totalMatches : 0;
    return { capability: best, confidence, scores };
  }
}

/** True when `phrase` occurs in `text` as a whole word/phrase (boundary-anchored). */
function phraseMatches(text: string, phrase: string): boolean {
  const p = phrase.toLowerCase();
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(p)}([^a-z0-9]|$)`, "i");
  return re.test(text);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
