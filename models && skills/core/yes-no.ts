/**
 * Yes/no questions with a probability, answered by the one mesh.
 *
 * Give it a whole email and a question -- "is this spam?" -- and it answers
 * yes or no and how likely that is. Not through the Zip Loop: spelling a
 * 2 KB email in bit by bit is tens of thousands of ticks, and the answer is
 * one of two things, not text. So each question is a small REGION of the
 * mesh, three neurons:
 *
 *   input -- carries the text as hashed word and word-pair features, one
 *            per dimension of the mesh (see embed());
 *   yes   -- tuned (tuneNeuronTo) toward what the "yes" examples look like;
 *   no    -- tuned toward what the "no" examples look like.
 *
 * Teaching keeps a running sum of each side's embeddings and re-tunes both
 * answer neurons toward their side's centroid, centred on the midpoint of the
 * two, so each one rises for what is typical of its side and falls for what
 * is typical of the other. Asking reads each answer neuron's signed response
 * to the text through that tuned connection -- the dot product of its
 * incoming weights from the input neuron with the embedded text. Signed,
 * because an energy is a magnitude and cannot tell "like this" from
 * "opposite of this"; through that one connection, because in the live
 * all-to-all mesh every other neuron also feeds the answer neurons and
 * drowned the input out (measured: a plain spam email read 11% yes). The
 * probability is a logistic of the difference.
 *
 * Honest limits: this is a prototype (nearest-centroid) classifier over
 * character n-gram features, living in the mesh's own connections. It is as
 * good as the examples it was taught, and a question with no examples on both
 * sides answers 0.5 and says it is untrained rather than guessing.
 */
import type { HyperDimensionalEngine } from "./onebrain.js";

export interface YesNoAnswer {
  question: string;
  answer: "yes" | "no";
  /** Probability that the answer to the question is yes, 0..1. */
  probabilityYes: number;
  /** Probability of the answer given, 0.5..1. */
  confidence: number;
  /** Signed responses of the two answer neurons. */
  yesScore: number;
  noScore: number;
  /** How many examples each side was taught. */
  examples: { yes: number; no: number };
  /** False until the question has at least one example of each answer. */
  trained: boolean;
  /** Fraction of the taught examples this question currently answers correctly (a fit, not a held-out score). */
  fitAccuracy: number;
}

interface QuestionRegion {
  question: string;
  input: number;
  yes: number;
  no: number;
  sumYes: number[];
  sumNo: number[];
  countYes: number;
  countNo: number;
  /** Recent examples (capped), kept to calibrate how scores turn into probabilities. */
  samples: Array<{ v: number[]; yes: boolean }>;
}

/** Saved form: the neurons are rebuilt on load, so only what was taught is kept. */
export interface YesNoState {
  version: 2;
  questions: Array<{ question: string; sumYes: number[]; sumNo: number[]; countYes: number; countNo: number; samples?: Array<{ v: number[]; yes: boolean }> }>;
}

/** Examples kept per question for calibration. The running sums keep everything. */
const MAX_SAMPLES = 400;
/** Floor on the calibrated temperature, so a handful of identical examples cannot make every answer certain. */
const MIN_TEMPERATURE = 0.05;
/**
 * The logistic is scaled so the AVERAGE taught example lands at
 * sigmoid(TYPICAL_LOGIT) ~ 88%: an answer as clear-cut as what it was taught
 * reads as confident, one much less clear-cut reads near 50%, and the numbers
 * mean something relative to the examples rather than to an arbitrary
 * constant (a fixed one read a 0.3 score gap as 99.8%).
 */
const TYPICAL_LOGIT = 2;

function normalizeQuestion(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?.!]+$/, "");
}

export class YesNoDoorway {
  private readonly regions = new Map<string, QuestionRegion>();

  constructor(private readonly engine: HyperDimensionalEngine) {}

  /**
   * The text as features the answer neurons can weigh: every word and every
   * pair of adjacent words, hashed (signed) into the mesh's dimensions and
   * normalised. Words rather than embedText's character n-grams because a
   * paragraph has hundreds of n-grams and the mesh has 64 dimensions -- the
   * collisions blurred whole emails together. Measured on the same held-out
   * set: 8/8 with words, 7/8 with character n-grams.
   */
  private embed(text: string): number[] {
    const dims = this.engine.getDimensions();
    const v = new Array(dims).fill(0);
    const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
    const features = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
    for (const f of features) {
      let h = 2166136261;
      for (let i = 0; i < f.length; i++) { h ^= f.charCodeAt(i); h = Math.imul(h, 16777619); }
      const u = h >>> 0;
      v[u % dims] += (u & 0x80000000) !== 0 ? -1 : 1;
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    return norm > 0 ? v.map((x) => x / Math.sqrt(norm)) : v;
  }

  /** The question's region, created (three new mesh neurons) the first time it is needed. */
  private region(question: string): QuestionRegion {
    const key = normalizeQuestion(question);
    if (!key) throw new Error("A yes/no question needs some text.");
    let r = this.regions.get(key);
    if (!r) {
      const ids = this.engine.addNeurons(3);
      if (ids.length < 3) throw new Error("The network has no room for another question.");
      const [input, yes, no] = ids;
      const group = `yes-no:${key}`;
      for (const id of ids) this.engine.setNeuronGroup(id, group);
      const dims = this.engine.getDimensions();
      r = { question: key, input, yes, no, sumYes: new Array(dims).fill(0), sumNo: new Array(dims).fill(0), countYes: 0, countNo: 0, samples: [] };
      this.regions.set(key, r);
    }
    return r;
  }

  /** Point each answer neuron at its side's centroid, centred on the midpoint of the two. */
  private retune(r: QuestionRegion): void {
    const dims = r.sumYes.length;
    const meanYes = r.sumYes.map((v) => (r.countYes ? v / r.countYes : 0));
    const meanNo = r.sumNo.map((v) => (r.countNo ? v / r.countNo : 0));
    const mid = new Array(dims);
    for (let d = 0; d < dims; d++) mid[d] = (meanYes[d] + meanNo[d]) / 2;
    if (r.countYes) this.engine.tuneNeuronTo(r.yes, r.input, meanYes.map((v, d) => v - mid[d]));
    if (r.countNo) this.engine.tuneNeuronTo(r.no, r.input, meanNo.map((v, d) => v - mid[d]));
  }

  /** Teach one example: `text` is an example whose answer to `question` is `answer`. */
  teach(question: string, text: string, answer: boolean): { examples: { yes: number; no: number } } {
    const r = this.region(question);
    const v = this.embed(text);
    const sum = answer ? r.sumYes : r.sumNo;
    for (let d = 0; d < v.length; d++) sum[d] += v[d];
    if (answer) r.countYes++; else r.countNo++;
    r.samples.push({ v, yes: answer });
    if (r.samples.length > MAX_SAMPLES) r.samples.shift();
    this.retune(r);
    return { examples: { yes: r.countYes, no: r.countNo } };
  }

  /**
   * The signed response of one answer neuron to `input` through its tuned
   * connection from the question's input neuron. Dimension d+1 of the
   * connection carries embedding dimension d (dimension 0 is the input flag,
   * which tuneNeuronTo leaves alone).
   */
  private response(r: QuestionRegion, id: number, input: number[]): number {
    let total = 0;
    for (let d = 0; d < input.length; d++) total += this.engine.getConnectionWeight(id, r.input, d + 1) * input[d];
    return total;
  }

  /** Answer `question` about `text`, with the probability that the answer is yes. */
  ask(question: string, text: string): YesNoAnswer {
    const r = this.region(question);
    const trained = r.countYes > 0 && r.countNo > 0;
    let yesScore = 0;
    let noScore = 0;
    if (trained) {
      // The live mesh keeps learning on its own ticks, which moves every
      // connection a little. Re-apply what was taught before reading it, so
      // an answer reflects the examples rather than whatever drift happened
      // since.
      this.retune(r);
      const input = this.embed(text);
      yesScore = this.response(r, r.yes, input);
      noScore = this.response(r, r.no, input);
    }
    const { temperature, fitAccuracy } = trained ? this.calibrate(r) : { temperature: 1, fitAccuracy: 0 };
    const probabilityYes = trained ? 1 / (1 + Math.exp(-(yesScore - noScore) / temperature)) : 0.5;
    const answer = probabilityYes >= 0.5 ? "yes" : "no";
    return {
      question: r.question,
      answer,
      probabilityYes,
      confidence: answer === "yes" ? probabilityYes : 1 - probabilityYes,
      yesScore,
      noScore,
      examples: { yes: r.countYes, no: r.countNo },
      trained,
      fitAccuracy,
    };
  }

  /**
   * How the taught examples themselves score: the temperature that puts the
   * average one at TYPICAL_LOGIT, and the fraction on the right side.
   */
  private calibrate(r: QuestionRegion): { temperature: number; fitAccuracy: number } {
    if (r.samples.length === 0) return { temperature: MIN_TEMPERATURE, fitAccuracy: 0 };
    let totalMargin = 0;
    let right = 0;
    for (const sample of r.samples) {
      const diff = this.response(r, r.yes, sample.v) - this.response(r, r.no, sample.v);
      totalMargin += Math.abs(diff);
      if ((diff >= 0) === sample.yes) right++;
    }
    const meanMargin = totalMargin / r.samples.length;
    return {
      temperature: Math.max(MIN_TEMPERATURE, meanMargin / TYPICAL_LOGIT),
      fitAccuracy: right / r.samples.length,
    };
  }

  /** Every question this doorway knows and how many examples each side has. */
  questions(): Array<{ question: string; examples: { yes: number; no: number } }> {
    return Array.from(this.regions.values()).map((r) => ({ question: r.question, examples: { yes: r.countYes, no: r.countNo } }));
  }

  toJSON(): YesNoState {
    return {
      version: 2,
      questions: Array.from(this.regions.values()).map((r) => ({
        question: r.question, sumYes: r.sumYes, sumNo: r.sumNo, countYes: r.countYes, countNo: r.countNo, samples: r.samples,
      })),
    };
  }

  /** Restore what was taught: regions are rebuilt in this mesh and re-tuned. */
  load(state: YesNoState): void {
    if (!state || state.version !== 2 || !Array.isArray(state.questions)) return;
    const dims = this.engine.getDimensions();
    for (const q of state.questions) {
      if (!Array.isArray(q.sumYes) || q.sumYes.length !== dims) continue;
      const r = this.region(q.question);
      r.sumYes = q.sumYes.slice();
      r.sumNo = q.sumNo.slice();
      r.countYes = q.countYes;
      r.countNo = q.countNo;
      r.samples = Array.isArray(q.samples) ? q.samples.filter((x) => Array.isArray(x?.v) && x.v.length === dims).slice(-MAX_SAMPLES) : [];
      this.retune(r);
    }
  }
}
