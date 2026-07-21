/**
 * Mistake & Failure Learning (ASI §6).
 *
 * A dedicated record of failures that stores *why* something went wrong, not
 * just that an answer was wrong: the failed step, the incorrect assumption, and
 * a root cause (missing knowledge / bad memory / incorrect skill / reasoning).
 * Identical failures are de-duplicated and counted so a repeated failure is
 * visible and can drive improvement, and past lessons are surfaced for similar
 * future tasks so the same mistake is not made twice.
 */

export type FailureCause =
  | "missing-knowledge"
  | "bad-memory"
  | "incorrect-skill"
  | "reasoning"
  | "unknown";

export interface MistakeInput {
  task: string;
  description: string;
  cause?: FailureCause;
  assumption?: string;
  failedStep?: string;
  prevention?: string;
}

export interface Mistake extends MistakeInput {
  id: string;
  cause: FailureCause;
  occurrences: number;
  firstSeen: number;
  lastSeen: number;
  resolved: boolean;
}

export class MistakeTracker {
  private mistakes = new Map<string, Mistake>();
  private seq = 0;

  /** Record a failure. Identical failures (same normalized task + cause) are
   * de-duplicated and their occurrence count is incremented. */
  record(input: MistakeInput): Mistake {
    const cause = input.cause ?? "unknown";
    const sig = `${normalize(input.task)}|${cause}`;
    const now = Date.now();
    const existing = this.mistakes.get(sig);
    if (existing) {
      existing.occurrences++;
      existing.lastSeen = now;
      existing.resolved = false;
      if (input.prevention) existing.prevention = input.prevention;
      if (input.assumption) existing.assumption = input.assumption;
      if (input.failedStep) existing.failedStep = input.failedStep;
      return existing;
    }
    const mistake: Mistake = {
      id: `mistake-${++this.seq}`,
      task: input.task,
      description: input.description,
      cause,
      assumption: input.assumption,
      failedStep: input.failedStep,
      prevention: input.prevention,
      occurrences: 1,
      firstSeen: now,
      lastSeen: now,
      resolved: false,
    };
    this.mistakes.set(sig, mistake);
    return mistake;
  }

  /** Past mistakes whose task is similar to `task` (token overlap), for avoidance. */
  similar(task: string, topK = 5): Mistake[] {
    const q = new Set(tokenize(task));
    if (q.size === 0) return [];
    const scored: Array<{ m: Mistake; score: number }> = [];
    for (const m of this.mistakes.values()) {
      if (m.resolved) continue;
      const t = tokenize(m.task);
      let overlap = 0;
      const seen = new Set<string>();
      for (const w of t) if (q.has(w) && !seen.has(w)) { overlap++; seen.add(w); }
      if (overlap > 0) scored.push({ m, score: overlap / Math.sqrt(q.size * (new Set(t).size || 1)) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(x => x.m);
  }

  /** Preventions learned from mistakes similar to `task` — the actionable lessons. */
  lessons(task: string, topK = 5): string[] {
    return this.similar(task, topK).map(m => m.prevention).filter((p): p is string => !!p);
  }

  /** Mistakes that have recurred at least `threshold` times — candidates for improvement. */
  repeated(threshold = 2): Mistake[] {
    return Array.from(this.mistakes.values()).filter(m => m.occurrences >= threshold && !m.resolved);
  }

  /** Cause counts across all recorded mistakes. */
  causeBreakdown(): Record<FailureCause, number> {
    const out: Record<FailureCause, number> = {
      "missing-knowledge": 0, "bad-memory": 0, "incorrect-skill": 0, reasoning: 0, unknown: 0,
    };
    for (const m of this.mistakes.values()) out[m.cause] += m.occurrences;
    return out;
  }

  resolve(id: string): boolean {
    for (const m of this.mistakes.values()) {
      if (m.id === id) { m.resolved = true; return true; }
    }
    return false;
  }

  all(): Mistake[] {
    return Array.from(this.mistakes.values());
  }
  size(): number {
    return this.mistakes.size;
  }
}

function normalize(text: string): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function tokenize(text: string): string[] {
  return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
}
