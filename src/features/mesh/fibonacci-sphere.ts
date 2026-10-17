/**
 * Fibonacci sphere: N points spread evenly over a sphere's surface.
 *
 * Lives on its own, with no dependencies, so the layout maths can be tested
 * without the dashboard's React and three.js (their packages are no longer
 * installed). mesh-visualization.tsx wraps these points as THREE.Vector3.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export function fibonacciPoints(n: number, radius: number): Point3[] {
  if (n <= 1) {
    // i / (n - 1) below divides by zero once n === 1 (0/0 = NaN), which
    // propagates into every coordinate -- reached whenever the mesh has
    // exactly one neuron, or zero (MeshScene's `Math.max(neuronCount, 1)`
    // still calls this every render, even before meshState loads).
    return n === 1 ? [{ x: 0, y: radius, z: 0 }] : [];
  }
  const points: Point3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = phi * i;
    points.push({
      x: Math.cos(theta) * radiusAtY * radius,
      y: y * radius,
      z: Math.sin(theta) * radiusAtY * radius,
    });
  }
  return points;
}
