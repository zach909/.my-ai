/**
 * Tests for the Mathematics toolkit (Spec Section 13): a safe expression
 * evaluator plus geometry/calculus/statistics/probability/linear-algebra/
 * optimization utilities, and MathEngine's headline "verify reasoning"
 * entry points.
 */

import {
  evaluateExpression,
  distance2D,
  circleArea,
  triangleArea,
  numericalDerivative,
  numericalIntegral,
  mean,
  median,
  variance,
  standardDeviation,
  factorial,
  permutations,
  combinations,
  binomialProbability,
  dotProduct,
  matrixMultiply,
  transpose,
  determinant,
  goldenSectionSearch,
  MathEngine,
} from '../../models && skills/core/math-engine.js';

describe('evaluateExpression (arithmetic/algebra)', () => {
  test('respects operator precedence and parentheses', () => {
    expect(evaluateExpression('2 + 3 * 4')).toBe(14);
    expect(evaluateExpression('(2 + 3) * 4')).toBe(20);
  });

  test('handles exponents right-associatively', () => {
    expect(evaluateExpression('2 ^ 3')).toBe(8);
    expect(evaluateExpression('2 ^ 3 ^ 2')).toBe(2 ** (3 ** 2));
  });

  test('handles unary minus', () => {
    expect(evaluateExpression('-5 + 3')).toBe(-2);
    expect(evaluateExpression('2 ^ -2')).toBe(0.25);
  });

  test('substitutes named variables (algebra)', () => {
    expect(evaluateExpression('x * x + y', { x: 3, y: 1 })).toBe(10);
  });

  test('throws on an unknown variable rather than silently returning NaN', () => {
    expect(() => evaluateExpression('x + 1')).toThrow(/unknown variable/i);
  });

  test('throws on division by zero rather than returning Infinity', () => {
    expect(() => evaluateExpression('1 / 0')).toThrow(/division by zero/i);
  });

  test('rejects malformed expressions instead of guessing', () => {
    expect(() => evaluateExpression('2 + ')).toThrow();
    expect(() => evaluateExpression('2 $ 3')).toThrow();
  });

  test('never executes arbitrary JavaScript (no eval/Function escape)', () => {
    // A string that would be dangerous if this used eval()/Function() --
    // must be rejected as an unknown-variable/unexpected-token expression.
    expect(() => evaluateExpression('process.exit(1)')).toThrow();
  });
});

describe('Geometry', () => {
  test('distance2D computes Euclidean distance', () => {
    expect(distance2D(0, 0, 3, 4)).toBe(5);
  });
  test('circleArea and triangleArea', () => {
    expect(circleArea(2)).toBeCloseTo(Math.PI * 4, 10);
    expect(triangleArea(4, 5)).toBe(10);
  });
});

describe('Calculus (numerical)', () => {
  test('numericalDerivative approximates d/dx(x^2) = 2x', () => {
    const f = (x: number) => x * x;
    expect(numericalDerivative(f, 3)).toBeCloseTo(6, 4);
  });

  test('numericalIntegral approximates the integral of x^2 from 0 to 1 (= 1/3)', () => {
    const f = (x: number) => x * x;
    expect(numericalIntegral(f, 0, 1, 10000)).toBeCloseTo(1 / 3, 4);
  });
});

describe('Statistics', () => {
  test('mean and median', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  test('sample variance/standard deviation match a known example', () => {
    // Values 2,4,4,4,5,5,7,9 have population variance 4, sample variance 32/7.
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(variance(values, false)).toBeCloseTo(4, 8);
    expect(standardDeviation(values, false)).toBeCloseTo(2, 8);
  });

  test('throws rather than returning NaN/undefined for empty input', () => {
    expect(() => mean([])).toThrow();
    expect(() => median([])).toThrow();
  });
});

describe('Probability / combinatorics', () => {
  test('factorial, permutations, combinations', () => {
    expect(factorial(5)).toBe(120);
    expect(permutations(5, 2)).toBe(20);
    expect(combinations(5, 2)).toBe(10);
  });

  test('binomialProbability matches a hand-computed example', () => {
    // P(exactly 2 heads in 3 fair coin flips) = C(3,2) * 0.5^2 * 0.5^1 = 3/8
    expect(binomialProbability(3, 2, 0.5)).toBeCloseTo(0.375, 10);
  });
});

describe('Linear algebra', () => {
  test('dotProduct', () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  test('matrixMultiply', () => {
    const a = [[1, 2], [3, 4]];
    const b = [[5, 6], [7, 8]];
    expect(matrixMultiply(a, b)).toEqual([[19, 22], [43, 50]]);
  });

  test('transpose', () => {
    expect(transpose([[1, 2, 3], [4, 5, 6]])).toEqual([[1, 4], [2, 5], [3, 6]]);
  });

  test('determinant for 2x2 and 3x3 matrices', () => {
    expect(determinant([[1, 2], [3, 4]])).toBe(1 * 4 - 2 * 3);
    expect(determinant([[6, 1, 1], [4, -2, 5], [2, 8, 7]])).toBe(-306);
  });
});

describe('Optimization', () => {
  test('goldenSectionSearch finds the minimum of a simple parabola', () => {
    const f = (x: number) => (x - 2) ** 2 + 1;
    const result = goldenSectionSearch(f, -10, 10, 1e-6);
    expect(result.x).toBeCloseTo(2, 4);
    expect(result.value).toBeCloseTo(1, 4);
  });
});

describe('MathEngine (Section 13 headline: verify reasoning, not trust it)', () => {
  let math: MathEngine;
  beforeEach(() => {
    math = new MathEngine();
  });

  test('verify() confirms a correct claimed result', () => {
    const result = math.verify('2 * (3 + 4)', 14);
    expect(result.verified).toBe(true);
    expect(result.actual).toBe(14);
  });

  test('verify() catches an incorrect claimed result -- the point of this module', () => {
    const result = math.verify('2 * (3 + 4)', 15);
    expect(result.verified).toBe(false);
    expect(result.actual).toBe(14);
    expect(result.difference).toBeCloseTo(1, 10);
  });

  test('verify() supports variables for algebraic claims', () => {
    const result = math.verify('x^2 + 1', 10, { x: 3 });
    expect(result.verified).toBe(true);
  });

  test('verifyIdentity() confirms a true identity across sample points', () => {
    // (x+1)^2 = x^2 + 2x + 1
    const result = math.verifyIdentity(
      '(x + 1) ^ 2',
      'x^2 + 2*x + 1',
      [{ x: 0 }, { x: 1 }, { x: -3 }, { x: 5.5 }]
    );
    expect(result.verified).toBe(true);
  });

  test('verifyIdentity() catches a false identity and reports the failing sample', () => {
    // x^2 != x^2 + 1 for any x -- must fail at every sample point.
    const result = math.verifyIdentity('x^2', 'x^2 + 1', [{ x: 0 }, { x: 2 }]);
    expect(result.verified).toBe(false);
    expect(result.failedAt).toEqual({ x: 0 });
  });
});
