// Section 13: dual numbers for live correction (section 12).
// Optimized JavaScript implementation with inlined operations.

export const dual = (val, der = 0) => ({ val, der });
export const variable = (x) => ({ val: x, der: 1 });
export const constant = (x) => ({ val: x, der: 0 });

export const add = (a, b) => ({ val: a.val + b.val, der: a.der + b.der });
export const sub = (a, b) => ({ val: a.val - b.val, der: a.der - b.der });

export const mul = (a, b) => ({
  val: a.val * b.val,
  der: a.der * b.val + a.val * b.der,
});

export const scale = (a, k) => ({ val: a.val * k, der: a.der * k });

export const tanh = (a) => {
  const t = Math.tanh(a.val);
  return { val: t, der: (1 - t * t) * a.der };
};

export const div = (a, b) => ({
  val: a.val / b.val,
  der: (a.der * b.val - a.val * b.der) / (b.val * b.val),
});
