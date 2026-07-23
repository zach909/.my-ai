/**
 * Prediction & Simulation (ASI §10).
 *
 * Before an important action, simulate its likely consequences — including
 * whether an outcome is dangerous/undesirable and what assumptions the
 * prediction rests on. After the action runs, compare the predicted result
 * with the actual one; the divergence is a learning signal, meant to connect
 * with the existing self-awareness/live-correction systems (SelfMonitor,
 * AlignmentVeto) rather than stand alone.
 *
 * Deterministic and local: likelihood/danger are estimated from lightweight
 * keyword and structure heuristics (the same category of signal
 * AlignmentVeto already uses for risk), and "compare predicted vs actual" is
 * token-overlap similarity — cheap, but genuinely computed, not fabricated.
 */

export interface PredictedOutcome {
  description: string;
  likelihood: number; // 0..1, relative plausibility among the candidates
  dangerous: boolean;
}

export interface Prediction {
  id: string;
  action: string;
  outcomes: PredictedOutcome[];
  mostLikely: PredictedOutcome;
  assumptions: string[];
  timestamp: number;
}

export interface Comparison {
  prediction: Prediction;
  actual: string;
  similarity: number;
  /** 1 - similarity: how surprising the actual result was (learning signal). */
  surprise: number;
  matched: boolean;
}

const DANGER_WORDS = ["delete", "remove", "overwrite", "wipe", "drop", "shutdown", "shut down", "force", "irreversible", "destroy", "erase", "kill", "terminate"];

export class PredictionEngine {
  private predictions = new Map<string, Prediction>();
  private seq = 0;
  /**
   * predict() is reached on nearly every live NeuroclawSystem entry point
   * (processQuery/learn/collaborate/executePlan/autonomousTask/solve, plus
   * once per candidate approach inside ReasoningEngine.reason()) with no
   * existing bound at all — most predictions are write-once-read-never
   * (only respond()'s own prediction is ever observe()'d back), so this grew
   * forever on a long-running process. Same FIFO-cap pattern already applied
   * to SharedBlackboard's log: a Map preserves insertion order, so the
   * oldest key is always the first one iteration yields.
   */
  private readonly predictionCapacity = 5000;

  /** Simulate an action's likely consequences before it runs. */
  predict(action: string, opts: { assumptions?: string[] } = {}): Prediction {
    const dangerous = DANGER_WORDS.some(w => action.toLowerCase().includes(w));
    const outcomes: PredictedOutcome[] = [
      { description: `${action} succeeds as intended`, likelihood: dangerous ? 0.5 : 0.7, dangerous: false },
      { description: `${action} partially succeeds with side effects`, likelihood: 0.2, dangerous },
      { description: `${action} fails`, likelihood: dangerous ? 0.3 : 0.1, dangerous },
    ];
    // Normalize to sum to 1.
    const total = outcomes.reduce((s, o) => s + o.likelihood, 0);
    for (const o of outcomes) o.likelihood = total > 0 ? o.likelihood / total : 1 / outcomes.length;
    outcomes.sort((a, b) => b.likelihood - a.likelihood);

    const assumptions = opts.assumptions ?? inferAssumptions(action);
    const prediction: Prediction = {
      id: `pred-${++this.seq}`,
      action,
      outcomes,
      mostLikely: outcomes[0],
      assumptions,
      timestamp: Date.now(),
    };
    this.predictions.set(prediction.id, prediction);
    while (this.predictions.size > this.predictionCapacity) {
      const oldest = this.predictions.keys().next().value;
      if (oldest === undefined) break;
      this.predictions.delete(oldest);
    }
    return prediction;
  }

  /** Compare the actual outcome of a previously-predicted action against the prediction. */
  observe(predictionId: string, actual: string): Comparison | undefined {
    const prediction = this.predictions.get(predictionId);
    if (!prediction) return undefined;
    const similarity = tokenSimilarity(prediction.mostLikely.description, actual);
    return { prediction, actual, similarity, surprise: 1 - similarity, matched: similarity >= 0.2 };
  }

  get(id: string): Prediction | undefined {
    return this.predictions.get(id);
  }
  size(): number {
    return this.predictions.size;
  }
}

function inferAssumptions(action: string): string[] {
  const assumptions: string[] = [];
  const t = action.toLowerCase();
  if (/\b(file|directory|folder)\b/.test(t)) assumptions.push("the referenced file/directory exists and is accessible");
  if (/\b(network|api|service|server)\b/.test(t)) assumptions.push("the network/service is reachable");
  if (/\b(delete|remove|overwrite)\b/.test(t)) assumptions.push("no other process depends on the current state");
  if (assumptions.length === 0) assumptions.push("the current system state matches what the action expects");
  return assumptions;
}

function tokenSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = new Set(tokenize(b));
  if (ta.length === 0 || tb.size === 0) return 0;
  let overlap = 0;
  const seen = new Set<string>();
  for (const t of ta) if (tb.has(t) && !seen.has(t)) { overlap++; seen.add(t); }
  return overlap / Math.sqrt(ta.length * tb.size);
}
function tokenize(text: string): string[] {
  return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
}
