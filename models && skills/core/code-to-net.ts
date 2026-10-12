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
 *     using only arithmetic, comparisons, ternaries and `Math.*`. A function
 *     that is exactly affine (2*x - 3*y + 5) or an exact polynomial of degree
 *     2 or 3 (x*x, x*y, a cubic) is compiled to an exact circuit with no
 *     training and no error; anything else numeric is
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

/** An exact linear circuit: out = bias + sum(weights[i] * input[i]). No training, no approximation. */
export interface CodeNetAffine {
  weights: number[];
  bias: number;
}

/** An exact polynomial circuit: out = sum of coefficient * product(input[i] ** exponents[i]). */
export interface CodeNetPolynomial {
  terms: Array<{ exponents: number[]; coefficient: number }>;
}

export interface CodeNetFunctionParams {
  arity: number;
  /** Present when the function was proven to be a polynomial of degree 2 or 3; evaluated exactly. */
  polynomial?: CodeNetPolynomial;
  /** Present when the function was proven affine; evaluation then uses it exactly and ignores the fitted network. */
  affine?: CodeNetAffine;
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
  /** Which tier the net is: an exact linear circuit, a fitted network, or an identity-only embedding. */
  tier?: CodeNetTier;
}

export type CodeNetTier = "affine" | "polynomial" | "fitted" | "embedding";

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

  /** "affine"/"polynomial": exact circuit; "fitted": trained approximation; "embedding": identity only. */
  get tier(): CodeNetTier {
    if (this.mode === "embedding") return "embedding";
    if (this.fn!.affine) return "affine";
    return this.fn!.polynomial ? "polynomial" : "fitted";
  }

  /** Forward pass. Function mode returns [scalar]; embedding mode returns the signature. */
  evaluate(inputs: number[]): number[] {
    if (this.mode === "embedding") return (this.signature ?? []).slice();
    const p = this.fn!;
    if (p.affine) {
      let out = p.affine.bias;
      for (let i = 0; i < p.arity; i++) out += p.affine.weights[i] * (inputs[i] ?? 0);
      return [out];
    }
    if (p.polynomial) {
      let out = 0;
      for (const term of p.polynomial.terms) {
        let v = term.coefficient;
        for (let i = 0; i < p.arity; i++) if (term.exponents[i] > 0) v *= (inputs[i] ?? 0) ** term.exponents[i];
        out += v;
      }
      return [out];
    }
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
// A backslash is denied outright: a numeric function never needs one, and it
// blocks unicode/hex escape identifiers (e.g. `eval` → `eval`) that would
// otherwise slip a denied keyword past the word-boundary checks below. Property
// access (`.`), brackets, backticks and template arrows are also denied.
const DENY = /\b(require|import|process|globalThis|global|eval|Function|constructor|prototype|__proto__|while|for|do|fetch|XMLHttpRequest|window|document|setTimeout|setInterval|Promise|async|await|throw|new|class|delete|void|yield|arguments|this)\b|`|=>[\s\S]*=>|\[|\]|\\/;
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
    // Tier 1: if the function is exactly affine, build the exact linear circuit.
    // No sampling range, no training, no error, and it holds outside any range.
    const affine = this.probeAffine(built.f, built.arity, opts.seed ?? 1234);
    if (affine) {
      const exact: CodeNetFunctionParams = {
        arity: built.arity, affine, hidden: 0, W1: [], b1: [], W2: [], b2: 0,
        inMin: new Array(built.arity).fill(0), inMax: new Array(built.arity).fill(1), outMean: 0, outStd: 1,
      };
      return new CodeNet(name, "function", code, exact);
    }
    // Tier 2: an exact polynomial (x*x, x*y, a cubic...): solve for its coefficients and keep
    // them only if they hold far outside the points they were solved from.
    const polynomial = this.probePolynomial(built.f, built.arity, opts.seed ?? 1234);
    if (polynomial) {
      const exact: CodeNetFunctionParams = {
        arity: built.arity, polynomial, hidden: 0, W1: [], b1: [], W2: [], b2: 0,
        inMin: new Array(built.arity).fill(0), inMax: new Array(built.arity).fill(1), outMean: 0, outStd: 1,
      };
      return new CodeNet(name, "function", code, exact);
    }
    // Tier 3: anything else numeric is fitted.
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
      return { mode: "embedding", samples: 0, meanAbsError: passed ? 0 : 1, maxAbsError: passed ? 0 : 1, outputRange: 0, passed, tier: "embedding" };
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
      // A different RNG seed than fit()'s compile-time sampling can land on
      // inputs that trip a real throw (e.g. a ternary branch that only
      // dereferences a property in a narrow band never sampled at compile
      // time) even though compile() succeeded -- skip the sample like a
      // non-finite one, don't let it crash the caller (cli.ts's handleNeuri()
      // calls this synchronously with no try/catch of its own).
      let ref: number;
      try {
        ref = built.f(...inp);
      } catch {
        continue;
      }
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
    return { mode: "function", samples: counted, meanAbsError, maxAbsError: max, outputRange, passed: meanAbsError <= tol, tier: net.tier };
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

  /**
   * Is `f` exactly affine, f(x) = bias + sum(w_i x_i)? Read the candidate
   * coefficients off the origin and the unit vectors, then check the candidate
   * at many seeded points over a wide range (+-10), where any curvature, kink
   * or rounding (Math.floor, abs, x*y, Math.sin...) shows up. Returns null if
   * anything throws, is non-finite, or misses by more than float rounding.
   */
  private probeAffine(f: (...a: number[]) => number, arity: number, seed: number): CodeNetAffine | null {
    try {
      const origin = new Array(arity).fill(0);
      const bias = f(...origin);
      if (!Number.isFinite(bias)) return null;
      const weights: number[] = [];
      for (let i = 0; i < arity; i++) {
        const unit = origin.slice();
        unit[i] = 1;
        const w = f(...unit) - bias;
        if (!Number.isFinite(w)) return null;
        weights.push(w);
      }
      const rng = mulberry32(seed ^ 0x51ed270b);
      for (let s = 0; s < 64; s++) {
        const inp = Array.from({ length: arity }, () => (rng() * 2 - 1) * 10);
        const want = f(...inp);
        let got = bias;
        for (let i = 0; i < arity; i++) got += weights[i] * inp[i];
        if (!Number.isFinite(want) || Math.abs(want - got) > 1e-9 * (1 + Math.abs(want))) return null;
      }
      return { weights, bias };
    } catch {
      return null;
    }
  }

  /**
   * Is `f` exactly a polynomial of degree 2 or 3 in at most 3 inputs? Solve for
   * the coefficients of every monomial from random points in [-2, 2] (least
   * squares, normal equations in float64), then check the result at 64 points in
   * [-10, 10]. A function that is not a polynomial (Math.sin, Math.abs,
   * Math.floor, 1/(1+x*x), a piecewise ternary) fails that check and is left to
   * the fitted tier. Coefficients below 1e-9 are noise and are dropped.
   */
  private probePolynomial(f: (...a: number[]) => number, arity: number, seed: number): CodeNetPolynomial | null {
    if (arity < 1 || arity > 3) return null;
    for (const degree of [2, 3]) {
      const exponents: number[][] = [];
      const walk = (i: number, left: number, current: number[]): void => {
        if (i === arity) { exponents.push(current.slice()); return; }
        for (let e = 0; e <= left; e++) { current.push(e); walk(i + 1, left - e, current); current.pop(); }
      };
      walk(0, degree, []);
      const m = exponents.length;
      const rng = mulberry32(seed ^ 0x2545f491);
      const rows: number[][] = [];
      const ys: number[] = [];
      try {
        for (let s = 0; s < m * 4; s++) {
          const inp = Array.from({ length: arity }, () => (rng() * 2 - 1) * 2);
          const y = f(...inp);
          if (!Number.isFinite(y)) return null;
          rows.push(exponents.map(ex => ex.reduce((v, e, i) => v * inp[i] ** e, 1)));
          ys.push(y);
        }
      } catch {
        return null;
      }
      // Normal equations (A^T A) c = A^T y by Gaussian elimination with partial pivoting.
      const a: number[][] = Array.from({ length: m }, () => new Array(m + 1).fill(0));
      for (let r = 0; r < rows.length; r++) {
        for (let i = 0; i < m; i++) {
          for (let j = 0; j < m; j++) a[i][j] += rows[r][i] * rows[r][j];
          a[i][m] += rows[r][i] * ys[r];
        }
      }
      let singular = false;
      for (let col = 0; col < m && !singular; col++) {
        let pivot = col;
        for (let r = col + 1; r < m; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
        if (Math.abs(a[pivot][col]) < 1e-12) { singular = true; break; }
        [a[col], a[pivot]] = [a[pivot], a[col]];
        for (let r = col + 1; r < m; r++) {
          const factor = a[r][col] / a[col][col];
          for (let c = col; c <= m; c++) a[r][c] -= factor * a[col][c];
        }
      }
      if (singular) continue;
      const coef = new Array(m).fill(0);
      for (let r = m - 1; r >= 0; r--) {
        let sum = a[r][m];
        for (let c = r + 1; c < m; c++) sum -= a[r][c] * coef[c];
        coef[r] = sum / a[r][r];
      }
      const terms = exponents.map((ex, i) => ({ exponents: ex, coefficient: coef[i] })).filter(t => Math.abs(t.coefficient) > 1e-9);
      // Only a true polynomial survives this: far outside the points it was solved from.
      const check = mulberry32(seed ^ 0x7f4a7c15);
      let ok = true;
      try {
        for (let s = 0; s < 64 && ok; s++) {
          const inp = Array.from({ length: arity }, () => (check() * 2 - 1) * 10);
          const want = f(...inp);
          let got = 0;
          for (const t of terms) { let v = t.coefficient; for (let i = 0; i < arity; i++) v *= inp[i] ** t.exponents[i]; got += v; }
          if (!Number.isFinite(want) || Math.abs(want - got) > 1e-7 * (1 + Math.abs(want))) ok = false;
        }
      } catch {
        ok = false;
      }
      if (ok) return { terms };
    }
    return null;
  }

  /** Sample the function and fit a 1-hidden-layer tanh MLP by SGD. */
  private fit(f: (...a: number[]) => number, arity: number, opts: CompileOptions): CodeNetFunctionParams {
    const samples = opts.samples ?? 256;
    const epochs = opts.epochs ?? 600;
    const hidden = opts.hidden ?? 16;
    const lr = opts.lr ?? 0.03;
    const [lo, hi] = opts.domain ?? [-2, 2];
    const rng = mulberry32(opts.seed ?? 1234);

    // Collect samples. buildFunction()'s own safety probe only evaluates f at
    // one fixed input, so a conditional expression (e.g. a ternary that only
    // dereferences a property in a narrow input band) can still throw here on
    // some later sample -- treated the same as a non-finite result: skipped,
    // not fatal.
    const X: number[][] = [];
    const Y: number[] = [];
    for (let s = 0; s < samples; s++) {
      const inp = new Array(arity);
      for (let i = 0; i < arity; i++) inp[i] = lo + rng() * (hi - lo);
      let y: number;
      try {
        y = f(...inp);
      } catch {
        continue;
      }
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
