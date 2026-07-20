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

/** Phrase/keyword signals per capability (lowercased, matched as word-ish substrings). */
const DEFAULT_SIGNALS: Record<Exclude<SystemCapability, "generate">, string[]> = {
  summarize: ["summarize", "summarise", "summary", "tl;dr", "tldr", "sum up", "recap", "what have we covered", "what have we discussed"],
  recall: ["recall", "remember", "earlier", "previously", "last time", "what did we", "did we discuss", "did we talk", "we talked", "we discussed", "we said", "bring up before"],
  heal: ["self-heal", "self heal", "health check", "healthcheck", "diagnostics", "are you ok", "are you okay", "system health", "check your health", "fix yourself"],
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
        if (text.includes(phrase.toLowerCase())) {
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
