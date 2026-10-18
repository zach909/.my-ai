/**
 * Choosing a tool from the task, and, separately, being allowed to run it.
 *
 * Two different questions, kept in two different places on purpose:
 *
 *   LearnedToolSelector   WHAT does this request need? Learned from labelled
 *                         requests (a closed-form ridge fit, no gradient loop,
 *                         no outside model), over the same hashed character
 *                         n-gram embedding the net-skill router uses (embedText).
 *                         Its answer is a proposal: a tool, "no tool", or
 *                         "abstain". Untrained it always abstains.
 *   authorize()           MAY it run? Knows nothing about scores. A proposal is
 *                         executed only if the tool exists and is available, and,
 *                         for a consequential tool, only with an explicit grant for
 *                         that tool in this call. A confident proposal is not a
 *                         grant; an untrained activation can never be one.
 *
 * Why abstention is a first-class answer. A request like "do it" or "launch the
 * missiles" is not "the tool with the highest score": it is a request there is
 * nothing safe to match. The selector abstains when its best score is low, when
 * its best two tools are too close, or when the request is far from everything it
 * was taught; the three limits are fitted on a validation set, never on the test.
 *
 * What it is not: understanding. It generalises as far as the hashed n-grams of
 * unseen requests overlap those of the taught ones, which benchmarks/tool_selection.mjs
 * measures, including the cases where that is not far.
 */
import { embedText } from "./neuro-lang.js";
import { solveRidge } from "./zip-speech.js";

export const NO_TOOL = "__none__";

export interface SelectorExample {
  text: string;
  /** The tool this request needs, or null when it needs none (ordinary conversation). */
  tool: string | null;
}

export type Selection =
  | { kind: "tool"; tool: string; score: number; margin: number; runnerUp: string | null }
  | { kind: "none"; score: number }
  | { kind: "abstain"; reason: "untrained" | "low-score" | "ambiguous" | "unfamiliar" };

export interface SelectorOptions {
  /** Embedding size. Default 1024 (the router measured 64 as too small). */
  dims?: number;
  /** Ridge penalty relative to the data. Default 1e-3. */
  ridge?: number;
}

export interface Limits {
  minScore: number;
  minMargin: number;
  minFamiliarity: number;
  /** A request needs two tools when the second-best tool scores at least this fraction of the best. */
  pairRatio: number;
}

/** Outcome in the same words as the benchmark: what the right behaviour for a request was. */
export type Gold = string | null | "abstain";

const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const unit = (v: number[]): Float64Array => { let n = 0; for (const x of v) n += x * x; const inv = n > 0 ? 1 / Math.sqrt(n) : 0; return Float64Array.from(v, (x) => x * inv); };

export class LearnedToolSelector {
  private readonly dims: number;
  private readonly ridge: number;
  private classes: string[] = [];
  private memory: Float64Array[] = [];
  private alpha: Float64Array[] = [];
  private intercept: Float64Array = new Float64Array(0);
  private mean: Float64Array = new Float64Array(0);
  limits: Limits = { minScore: 0.3, minMargin: 0.1, minFamiliarity: 0.2, pairRatio: 0.5 };

  constructor(opts: SelectorOptions = {}) {
    this.dims = opts.dims ?? 1024;
    this.ridge = opts.ridge ?? 1e-3;
  }

  get trained(): boolean {
    return this.classes.length > 0;
  }

  /** Fit on labelled requests. Replaces whatever was learned before. */
  train(examples: SelectorExample[]): { examples: number; classes: string[] } {
    if (examples.length === 0) throw new Error("LearnedToolSelector.train: no examples");
    const classes = [...new Set(examples.map((e) => e.tool ?? NO_TOOL))].sort();
    const X = examples.map((e) => unit(embedText(e.text, this.dims)));
    const S = X.length;
    this.mean = new Float64Array(this.dims);
    for (const x of X) for (let j = 0; j < this.dims; j++) this.mean[j] += x[j] / S;
    const Z = X.map((x) => Float64Array.from(x, (v, j) => v - this.mean[j]));
    const gram = new Float64Array(S * S);
    let trace = 0;
    for (let i = 0; i < S; i++) for (let j = i; j < S; j++) { const d = dot(Z[i], Z[j]); gram[i * S + j] = d; gram[j * S + i] = d; if (i === j) trace += d; }
    const targets = classes.map((c) => Float64Array.from(examples, (e) => ((e.tool ?? NO_TOOL) === c ? 1 : -1)));
    this.intercept = Float64Array.from(targets, (t) => t.reduce((a, b) => a + b, 0) / S);
    const centred = targets.map((t, k) => Float64Array.from(t, (v) => v - this.intercept[k]));
    this.alpha = solveRidge(gram, S, this.ridge * (trace / S || 1), centred);
    this.memory = Z;
    this.classes = classes;
    return { examples: S, classes: classes.filter((c) => c !== NO_TOOL) };
  }

  private scores(text: string): { scores: number[]; familiarity: number } {
    const x = unit(embedText(text, this.dims));
    const z = Float64Array.from(x, (v, j) => v - this.mean[j]);
    const kernel = this.memory.map((m) => dot(m, z));
    const scores = this.classes.map((_, k) => this.intercept[k] + dot(this.alpha[k], kernel));
    // Familiarity: cosine to the closest taught request, in the raw (un-centred) embedding.
    let best = -1;
    for (const m of this.memory) { const c = dot(Float64Array.from(m, (v, j) => v + this.mean[j]), x); if (c > best) best = c; }
    return { scores, familiarity: best };
  }

  select(text: string): Selection {
    if (!this.trained) return { kind: "abstain", reason: "untrained" };
    const { scores, familiarity } = this.scores(text);
    return this.decide(scores, familiarity);
  }

  /** The decision rule alone, so calibration can try many limits on scores computed once. */
  private decide(scores: number[], familiarity: number): Selection {
    const order = scores.map((s, i) => ({ s, c: this.classes[i] })).sort((a, b) => b.s - a.s);
    const top = order[0], second = order[1];
    if (familiarity < this.limits.minFamiliarity) return { kind: "abstain", reason: "unfamiliar" };
    if (top.s < this.limits.minScore) return { kind: "abstain", reason: "low-score" };
    const margin = second ? top.s - second.s : top.s;
    if (margin < this.limits.minMargin) return { kind: "abstain", reason: "ambiguous" };
    if (top.c === NO_TOOL) return { kind: "none", score: top.s };
    const runner = order.slice(1).find((o) => o.c !== NO_TOOL);
    return { kind: "tool", tool: top.c, score: top.s, margin, runnerUp: runner ? runner.c : null };
  }

  /**
   * The two tools a request needs, when it needs two: the best two tools, if the
   * second scores at least `pairRatio` of the best and is itself a real match
   * (above half of minScore). Null otherwise.
   */
  selectPair(text: string): [string, string] | null {
    if (!this.trained) return null;
    const { scores } = this.scores(text);
    const tools = scores.map((s, i) => ({ s, c: this.classes[i] })).filter((o) => o.c !== NO_TOOL).sort((a, b) => b.s - a.s);
    if (tools.length < 2 || tools[0].s <= 0) return null;
    if (tools[1].s < this.limits.minScore * 0.5 || tools[1].s < this.limits.pairRatio * tools[0].s) return null;
    return [tools[0].c, tools[1].c];
  }

  /**
   * Pick the three limits on labelled VALIDATION requests (never test ones):
   * the grid point with the best utility, where a right action or right
   * abstention is +1, a missed action 0, and acting wrongly -2.
   */
  calibrate(validation: Array<{ text: string; gold: Gold }>, pairs: Array<{ text: string; tools: [string, string] }> = []): { limits: Limits; utility: number } {
    if (!this.trained) throw new Error("LearnedToolSelector.calibrate: train first");
    const cache = validation.map((v) => this.scores(v.text));
    let best = { limits: this.limits, utility: -Infinity };
    for (const minScore of [-0.5, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
      for (const minMargin of [0, 0.05, 0.1, 0.2, 0.3, 0.4]) {
        for (const minFamiliarity of [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4]) {
          this.limits = { ...this.limits, minScore, minMargin, minFamiliarity };
          let u = 0;
          for (let k = 0; k < validation.length; k++) u += utility(this.decide(cache[k].scores, cache[k].familiarity), validation[k].gold);
          u /= Math.max(1, validation.length);
          // Ties go to the earlier, i.e. more cautious, setting: require strictly better.
          if (u > best.utility + 1e-9) best = { limits: { ...this.limits }, utility: u };
        }
      }
    }
    this.limits = best.limits;
    if (pairs.length > 0) {
      // Right pair found is +1; a single-tool validation request that would also be called a pair is -1.
      const singles = validation.filter((v) => typeof v.gold === "string" && v.gold !== "abstain");
      let bestPair = { r: this.limits.pairRatio, score: -Infinity };
      for (const r of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
        this.limits = { ...this.limits, pairRatio: r };
        let sc = 0;
        for (const p of pairs) { const got = this.selectPair(p.text); if (got && p.tools.every((t) => got.includes(t))) sc++; }
        for (const v of singles) if (this.selectPair(v.text)) sc--;
        if (sc > bestPair.score) bestPair = { r, score: sc };
      }
      this.limits = { ...this.limits, pairRatio: bestPair.r };
    }
    return { limits: this.limits, utility: best.utility };
  }
}

export function utility(sel: Selection, gold: Gold): number {
  if (gold === "abstain") return sel.kind === "abstain" ? 1 : -2;
  if (gold === null) return sel.kind === "none" ? 1 : sel.kind === "abstain" ? 0 : -2;
  if (sel.kind === "tool") return sel.tool === gold ? 1 : -2;
  return 0;     // abstained or said "no tool" when a tool was needed: a miss, not a harm
}

// ───────────────────────── permission, kept apart ─────────────────────────

export interface ToolEntry {
  id: string;
  /** Changes the world or the machine, speaks for the owner, or reads private data. */
  consequential: boolean;
  /** False when the tool is not installed or has been switched off. */
  available: boolean;
}

export interface Authorization {
  execute: boolean;
  reason: string;
}

/**
 * May this proposal run? Knows nothing about scores or confidence.
 *
 * `granted` is the set of tool ids the owner approved for THIS call (an approval
 * from ToolGate, a click). It is not remembered here and it is not derived from
 * the selection.
 */
export function authorize(sel: Selection, tools: Map<string, ToolEntry>, granted: ReadonlySet<string> = new Set()): Authorization {
  if (sel.kind !== "tool") return { execute: false, reason: sel.kind === "none" ? "no tool is needed" : `abstained (${sel.reason})` };
  const entry = tools.get(sel.tool);
  if (!entry) return { execute: false, reason: `no such tool: ${sel.tool}` };
  if (!entry.available) return { execute: false, reason: `${sel.tool} is not available` };
  if (entry.consequential && !granted.has(sel.tool)) return { execute: false, reason: `${sel.tool} needs the owner's explicit approval for this call` };
  return { execute: true, reason: entry.consequential ? "owner approved" : "not consequential" };
}
