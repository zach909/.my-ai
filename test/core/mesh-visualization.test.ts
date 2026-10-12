/**
 * Regression test for the Fibonacci sphere layout's degenerate single-point case
 * (src/features/mesh/fibonacci-sphere.ts, wrapped as THREE.Vector3 by
 * mesh-visualization.tsx; tested here without the dashboard's React and three.js,
 * which are no longer installed).
 *
 * `y = 1 - (i / (n - 1)) * 2` divides by zero once n === 1 (0/0 = NaN),
 * which then propagates into every coordinate. MeshScene calls this every
 * render via `Math.max(neuronCount, 1)`, so it fires whenever the mesh has
 * exactly one neuron, or before meshState has loaded (neuronCount === 0).
 */

import { fibonacciPoints as fibonacciSphere } from '../../src/features/mesh/fibonacci-sphere';

describe('fibonacciPoints()', () => {
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

  it('puts every point on the sphere and spreads them out', () => {
    const radius = 2.5;
    const points = fibonacciSphere(50, radius);
    for (const p of points) expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(radius, 9);
    // The first and last points are the two poles.
    expect(points[0].y).toBeCloseTo(radius, 9);
    expect(points[49].y).toBeCloseTo(-radius, 9);
    // No two points coincide.
    let nearest = Infinity;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      nearest = Math.min(nearest, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y, points[i].z - points[j].z));
    }
    expect(nearest).toBeGreaterThan(0.1);
  });
})
