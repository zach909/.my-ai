// Section 13: complex numbers as a genuine division algebra (Hurwitz size 2).
// Phase-and-amplitude together is exactly one complex number, so the quantum
// interference layer stores/combines its state as complex values rather than a
// pair of disconnected real scalars driven by ad-hoc trigonometry.
//
// A complex number a + b·i with i² = -1. Every nonzero element has a unique
// inverse (it is a division algebra), which is what makes interference,
// rotation, and normalization behave correctly.

export interface Complex {
  re: number;
  im: number;
}

export const complex = (re: number, im: number = 0): Complex => ({ re, im });

/** Polar form: magnitude·e^{iθ} = magnitude·(cosθ + i·sinθ). */
export const fromPolar = (magnitude: number, phase: number): Complex => ({
  re: magnitude * Math.cos(phase),
  im: magnitude * Math.sin(phase),
});

export const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });

/** (a+bi)(c+di) = (ac - bd) + (ad + bc)i — the i² = -1 rule. */
export const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export const scale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k });

/** Complex conjugate a - bi. */
export const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im });

/** Magnitude |a+bi| = sqrt(a² + b²). */
export const abs = (a: Complex): number => Math.hypot(a.re, a.im);

/** Squared magnitude (Born-rule probability weight, no sqrt). */
export const absSq = (a: Complex): number => a.re * a.re + a.im * a.im;

/** Argument (phase angle) in (-π, π]. */
export const arg = (a: Complex): number => Math.atan2(a.im, a.re);

/**
 * Multiplicative inverse 1/z = conj(z)/|z|². Defined for every nonzero z —
 * the division-algebra guarantee. Throws on zero.
 */
export const inv = (a: Complex): Complex => {
  const d = absSq(a);
  if (d === 0) throw new Error('complex inverse of zero');
  return { re: a.re / d, im: -a.im / d };
};

export const div = (a: Complex, b: Complex): Complex => mul(a, inv(b));

/** The imaginary unit i, with i·i = -1. */
export const I: Complex = { re: 0, im: 1 };
