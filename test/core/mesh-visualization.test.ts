/**
 * Regression test for fibonacciSphere()'s degenerate single-point case
 * (src/features/mesh/mesh-visualization.tsx).
 *
 * `y = 1 - (i / (n - 1)) * 2` divides by zero once n === 1 (0/0 = NaN),
 * which then propagates into every coordinate. MeshScene calls this every
 * render via `Math.max(neuronCount, 1)`, so it fires whenever the mesh has
 * exactly one neuron, or before meshState has loaded (neuronCount === 0).
 */

import { fibonacciSphere } from '../../src/features/mesh/mesh-visualization';

describe('fibonacciSphere()', () => {
  it('returns a finite point for n=1 instead of NaN', () => {
    const points = fibonacciSphere(1, 2.5);
    expect(points).toHaveLength(1);
    expect(Number.isFinite(points[0].x)).toBe(true);
    expect(Number.isFinite(points[0].y)).toBe(true);
    expect(Number.isFinite(points[0].z)).toBe(true);
  });

  it('returns an empty array for n=0', () => {
    expect(fibonacciSphere(0, 2.5)).toHaveLength(0);
  });

  it('still distributes multiple points correctly (n=2 unaffected)', () => {
    const points = fibonacciSphere(2, 2.5);
    expect(points).toHaveLength(2);
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
  });
});
