// Section 13: dual numbers for live correction (section 12).
//
// A dual number is a + b·ε with ε² = 0. Carrying the derivative alongside the
// value means one forward evaluation yields both f(x) and f'(x) — forward-mode
// automatic differentiation. For live correction the self-model can then report
// not just its predicted value but its instantaneous rate of change in the same
// pass, so drift can be caught from the trend, not only the level.
//
// Dual numbers are NOT a division algebra (ε has no inverse), which is fine:
// they are used here as an autodiff carrier, not for interference/rotation.

export interface Dual {
  /** Primal value f(x). */
  val: number;
  /** Derivative f'(x) carried in the ε component. */
  der: number;
}

export const dual = (val: number, der: number = 0): Dual => ({ val, der });

/** A variable to differentiate with respect to: value x, derivative 1. */
export const variable = (x: number): Dual => ({ val: x, der: 1 });

/** A constant: derivative 0. */
export const constant = (x: number): Dual => ({ val: x, der: 0 });

export const add = (a: Dual, b: Dual): Dual => ({ val: a.val + b.val, der: a.der + b.der });
export const sub = (a: Dual, b: Dual): Dual => ({ val: a.val - b.val, der: a.der - b.der });

/** Product rule: (a + a'ε)(b + b'ε) = ab + (a'b + ab')ε  (the ε² term vanishes). */
export const mul = (a: Dual, b: Dual): Dual => ({
  val: a.val * b.val,
  der: a.der * b.val + a.val * b.der,
});

export const scale = (a: Dual, k: number): Dual => ({ val: a.val * k, der: a.der * k });

/** tanh with its derivative 1 - tanh² carried through — the mesh's activation. */
export const tanh = (a: Dual): Dual => {
  const t = Math.tanh(a.val);
  return { val: t, der: (1 - t * t) * a.der };
};

/** Quotient rule. */
export const div = (a: Dual, b: Dual): Dual => ({
  val: a.val / b.val,
  der: (a.der * b.val - a.val * b.der) / (b.val * b.val),
});
