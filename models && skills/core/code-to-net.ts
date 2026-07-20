/**
 * Behavioral Code-to-Net (Spec Section 21).
 *
 * This complements the *structural* `CodeToNet` in `thorns.js` (which turns a
 * byte stream into a chain of neurons). Here we do the *behavioral* conversion
 * the spec actually asks for: analyse a piece of code's behaviour and build a
 * neural network that represents that behaviour, then make the network
 * **testable against the original code**.
 *
 * Defined subset & limitations (the spec requires these to be explicit):
 *   - Supported: pure numeric functions of numeric inputs — an arrow/function
 *     expression or a bare arithmetic expression over a small set of variables,
 *     using only arithmetic, comparisons, ternaries and `Math.*`. These are
 *     approximated by sampling the function and fitting a 1-hidden-layer MLP.
 *   - Everything else (I/O, loops, strings, external state, unsafe tokens) is
 *     *not* converted to behaviour; it falls back to an `embedding` network — a
 *     deterministic content signature that identifies the code but does not
 *     reproduce it. This mirrors the Python track's function-approximation vs
 *     embedding split and avoids the false claim that arbitrary software can be
 *     turned into an equivalent network.
 *
 * No external APIs are used; numeric functions are evaluated locally via the
 * Function constructor after a denylist/whitelist safety check.
 */

export type CodeNetMode = "function" | "embedding";

export interface CodeNetFunctionParams {
  arity: number;
  hidden: number;
  W1: number[][]; // [hidden][arity]
  b1: number[]; // [hidden]
  W2: number[]; // [hidden]
  b2: number;
  inMin: number[]; // per-input normalization range
  inMax: number[];
  outMean: number;
  outStd: number;
}

export interface CodeNetJSON {
  name: string;
  mode: CodeNetMode;
  source: string;
  fn?: CodeNetFunctionParams;
  signature?: number[];
}

export interface CompileOptions {
  samples?: number;
  epochs?: number;
  hidden?: number;
  lr?: number;
  seed?: number;
  /** Sampling domain [min,max] applied to every input dimension. */
  domain?: [number, number];
  /** Dimensionality of the embedding-mode signature. */
  embedDim?: number;
}

export interface TestReport {
  mode: CodeNetMode;
  samples: number;
  meanAbsError: number;
  maxAbsError: number;
  /** Range of the reference outputs over the test samples (function mode). */
  outputRange: number;
  passed: boolean;
}

/** A code-derived network that can be evaluated and serialized. */
export class CodeNet {
  constructor(
    public readonly name: string,
    public readonly mode: CodeNetMode,
    public readonly source: string,
    private readonly fn?: CodeNetFunctionParams,
    private readonly signature?: number[],
  ) {}

  get arity(): number {
    return this.mode === "function" ? this.fn!.arity : 0;
  }

  /** Forward pass. Function mode returns [scalar]; embedding mode returns the signature. */
  evaluate(inputs: number[]): number[] {
    if (this.mode === "embedding") return (this.signature ?? []).slice();
    const p = this.fn!;
    const x = new Array(p.arity);
    for (let i = 0; i < p.arity; i++) {
      const range = p.inMax[i] - p.inMin[i] || 1;
      x[i] = (((inputs[i] ?? 0) - p.inMin[i]) / range) * 2 - 1; // → [-1,1]
    }
    let out = p.b2;
    for (let j = 0; j < p.hidden; j++) {
      let s = p.b1[j];
      for (let i = 0; i < p.arity; i++) s += p.W1[j][i] * x[i];
      out += p.W2[j] * Math.tanh(s);
    }
    return [out * p.outStd + p.outMean];
  }

  getSignature(): number[] {
    return (this.signature ?? []).slice();
  }

  toJSON(): CodeNetJSON {
    return { name: this.name, mode: this.mode, source: this.source, fn: this.fn, signature: this.signature };
  }

  static fromJSON(j: CodeNetJSON): CodeNet {
    return new CodeNet(j.name, j.mode, j.source, j.fn, j.signature);
  }
}

/** Tokens that must never appear in a "numeric function" — forces embedding mode. */
const DENY = /\b(require|import|process|globalThis|global|eval|Function|constructor|prototype|__proto__|while|for|do|fetch|XMLHttpRequest|window|document|setTimeout|setInterval|Promise|async|await|throw|new|class|delete|void|yield)\b|`|=>[\s\S]*=>|\[|\]/;
/** Canonical variable names probed when a bare expression has no parameter list. */
const CANONICAL_VARS = ["a", "b", "c", "d", "x", "y", "z", "x0", "x1", "x2", "x3"];

export class CodeToNetCompiler {
  /**
   * Compile `code` into a CodeNet. Numeric functions become a fitted MLP
   * (function mode); anything else becomes a deterministic embedding.
   */
  compile(name: string, code: string, opts: CompileOptions = {}): CodeNet {
    const built = this.buildFunction(code);
    if (!built) {
      return new CodeNet(name, "embedding", code, undefined, this.embed(code, opts.embedDim ?? 32));
    }
    const params = this.fit(built.f, built.arity, opts);
    return new CodeNet(name, "function", code, params);
  }

  /**
   * Test a CodeNet against its source code. Function mode: sample fresh inputs,
   * compare the network's output to the real function, and pass when the mean
   * error is small relative to the output range. Embedding mode: pass when the
   * code re-embeds to the same signature (identity is preserved).
   */
  testAgainst(net: CodeNet, code: string, opts: CompileOptions = {}): TestReport {
    const built = this.buildFunction(code);
    if (net.mode === "embedding" || !built) {
      const sig = this.embed(code, net.getSignature().length || opts.embedDim || 32);
      const passed = net.mode === "embedding" && arraysClose(sig, net.getSignature(), 1e-9);
      return { mode: "embedding", samples: 0, meanAbsError: passed ? 0 : 1, maxAbsError: passed ? 0 : 1, outputRange: 0, passed };
    }
    const rng = mulberry32((opts.seed ?? 1234) ^ 0x9e3779b9);
    const [lo, hi] = opts.domain ?? [-2, 2];
    const n = opts.samples ?? 128;
    let sum = 0;
    let max = 0;
    let outMin = Infinity;
    let outMax = -Infinity;
    let counted = 0;
    for (let s = 0; s < n; s++) {
      const inp = new Array(built.arity);
      for (let i = 0; i < built.arity; i++) inp[i] = lo + rng() * (hi - lo);
      const ref = built.f(...inp);
      if (!Number.isFinite(ref)) continue;
      const got = net.evaluate(inp)[0];
      const e = Math.abs(got - ref);
      sum += e;
      if (e > max) max = e;
      if (ref < outMin) outMin = ref;
      if (ref > outMax) outMax = ref;
      counted++;
    }
    const meanAbsError = counted ? sum / counted : Infinity;
    const outputRange = counted ? outMax - outMin : 0;
    // Pass when mean error is within 20% of the output range (floor 0.25 for
    // near-constant functions), which distinguishes a real approximation from
    // a network that ignores its input.
    const tol = Math.max(0.25, 0.2 * outputRange);
    return { mode: "function", samples: counted, meanAbsError, maxAbsError: max, outputRange, passed: meanAbsError <= tol };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Parse `code` into a safe numeric function, or null if unsupported. */
  private buildFunction(code: string): { f: (...args: number[]) => number; arity: number } | null {
    const src = (code ?? "").trim();
    if (!src || src.length > 400) return null;

    let params: string[] = [];
    let body = "";
    let arrow = src.match(/^\(?\s*([A-Za-z0-9_,\s]*)\s*\)?\s*=>\s*([\s\S]+)$/);
    let func = src.match(/^function\s*[A-Za-z0-9_]*\s*\(([A-Za-z0-9_,\s]*)\)\s*\{([\s\S]*)\}$/);
    if (arrow) {
      params = splitParams(arrow[1]);
      body = arrow[2].trim();
    } else if (func) {
      params = splitParams(func[1]);
      body = func[2].trim();
    } else {
      body = src;
    }

    // Safety: reject anything with an unsafe token before we ever evaluate it.
    if (DENY.test(src)) return null;

    // Bare expression with no declared params → infer from canonical variables.
    if (params.length === 0) {
      const used = new Set<string>();
      for (const v of CANONICAL_VARS) {
        if (new RegExp(`(^|[^A-Za-z0-9_])${v}([^A-Za-z0-9_]|$)`).test(body)) used.add(v);
      }
      params = CANONICAL_VARS.filter(v => used.has(v));
      if (params.length === 0) return null;
    }

    const finalBody = /\breturn\b/.test(body) ? body : `return (${body});`;
    let f: (...args: number[]) => number;
    try {
      // eslint-disable-next-line no-new-func
      f = new Function(...params, `"use strict"; ${finalBody}`) as (...args: number[]) => number;
      const probe = f(...params.map(() => 1));
      if (typeof probe !== "number" || !Number.isFinite(probe)) return null;
    } catch {
      return null;
    }
    return { f, arity: params.length };
  }

  /** Sample the function and fit a 1-hidden-layer tanh MLP by SGD. */
  private fit(f: (...a: number[]) => number, arity: number, opts: CompileOptions): CodeNetFunctionParams {
    const samples = opts.samples ?? 256;
    const epochs = opts.epochs ?? 600;
    const hidden = opts.hidden ?? 16;
    const lr = opts.lr ?? 0.03;
    const [lo, hi] = opts.domain ?? [-2, 2];
    const rng = mulberry32(opts.seed ?? 1234);

    // Collect samples.
    const X: number[][] = [];
    const Y: number[] = [];
    for (let s = 0; s < samples; s++) {
      const inp = new Array(arity);
      for (let i = 0; i < arity; i++) inp[i] = lo + rng() * (hi - lo);
      const y = f(...inp);
      if (Number.isFinite(y)) {
        X.push(inp);
        Y.push(y);
      }
    }
    // Input normalization to [-1,1] and target standardization.
    const inMin = new Array(arity).fill(Infinity);
    const inMax = new Array(arity).fill(-Infinity);
    for (const row of X) for (let i = 0; i < arity; i++) {
      if (row[i] < inMin[i]) inMin[i] = row[i];
      if (row[i] > inMax[i]) inMax[i] = row[i];
    }
    const outMean = Y.reduce((a, b) => a + b, 0) / (Y.length || 1);
    const outStd = Math.sqrt(Y.reduce((a, b) => a + (b - outMean) ** 2, 0) / (Y.length || 1)) || 1;

    const norm = (row: number[]) => row.map((v, i) => (((v - inMin[i]) / (inMax[i] - inMin[i] || 1)) * 2 - 1));
    const Xn = X.map(norm);
    const Yn = Y.map(y => (y - outMean) / outStd);

    // Init weights (small, seeded).
    const W1: number[][] = Array.from({ length: hidden }, () => Array.from({ length: arity }, () => (rng() * 2 - 1) * 0.5));
    const b1 = new Array(hidden).fill(0);
    const W2 = Array.from({ length: hidden }, () => (rng() * 2 - 1) * 0.5);
    let b2 = 0;

    for (let epoch = 0; epoch < epochs; epoch++) {
      for (let s = 0; s < Xn.length; s++) {
        const x = Xn[s];
        // Forward.
        const h = new Array(hidden);
        for (let j = 0; j < hidden; j++) {
          let z = b1[j];
          for (let i = 0; i < arity; i++) z += W1[j][i] * x[i];
          h[j] = Math.tanh(z);
        }
        let out = b2;
        for (let j = 0; j < hidden; j++) out += W2[j] * h[j];
        // Backward (MSE).
        const dOut = out - Yn[s];
        b2 -= lr * dOut;
        for (let j = 0; j < hidden; j++) {
          const dh = dOut * W2[j] * (1 - h[j] * h[j]);
          W2[j] -= lr * dOut * h[j];
          for (let i = 0; i < arity; i++) W1[j][i] -= lr * dh * x[i];
          b1[j] -= lr * dh;
        }
      }
    }

    return { arity, hidden, W1, b1, W2, b2, inMin, inMax, outMean, outStd };
  }

  /** Deterministic content signature for unsupported code (identity, not behaviour). */
  private embed(code: string, dim: number): number[] {
    const out = new Array(dim).fill(0);
    for (let i = 0; i < code.length; i++) {
      const c = code.charCodeAt(i);
      const k = (c * 31 + i) % dim;
      out[k] += Math.sin(c * 0.123 + i * 0.017);
    }
    // Normalize to [-1,1].
    let max = 0;
    for (const v of out) max = Math.max(max, Math.abs(v));
    return max > 0 ? out.map(v => v / max) : out;
  }
}

function splitParams(s: string): string[] {
  return (s ?? "").split(",").map(p => p.trim()).filter(Boolean);
}

function arraysClose(a: number[], b: number[], eps: number): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > eps) return false;
  return true;
}

/** Small seedable PRNG so training/tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
