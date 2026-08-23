/**
 * The twisted metal strip's geometry — one definition, shared by every place
 * the mark appears (TwistedStripLogo, TwistedStripSpinner).
 *
 * Geometry follows twisted_metal_strip_3pt_profile.html: three fold points on
 * top and three on the bottom, alternating, giving a closed skew hexagon whose
 * six folds each meet at a right angle. The peak height is solved rather than
 * eyeballed — for the interior angle at a fold to be 90 degrees,
 *
 *     cos(theta) = (4h^2 - R^2/2) / (R^2 + 4h^2) = 0   =>   h = R / (2*sqrt(2))
 *
 * so the folds stay square at any radius. That six-fold symmetry is also what
 * the app icon's six-lobed ring has, so the two marks read as the same object.
 *
 * The ribbon itself is a 3-point cross-section (edge, recessed centre ridge,
 * edge) swept along a Catmull-Rom curve through those folds, twisting as it
 * goes so the face catches light differently around the loop.
 */

import * as THREE from 'three'

/** Loop radius through the fold points. */
const R = 1.05
/** Fold height, solved above for right-angled folds. */
const H = R / (2 * Math.SQRT2)
/** Ribbon width, and how deep the centre ridge is recessed from the edges. */
const STRIP_WIDTH = 0.34
const STRIP_DEPTH = 0.045
/**
 * Samples along the loop. High enough that the fold curvature is smooth rather
 * than faceted — the visible difference between a polished strip and a
 * low-poly one is almost entirely here, and at this vertex count the geometry
 * is still built once and cached.
 */
const SEGMENTS = 1000
/** left / centre / right — the 3-point profile. */
const RING_COUNT = 3
/** Curve tension; higher rounds the folds off, lower makes them sharper. */
const CURVE_TENSION = 0.65

/** Half a turn of twist spread evenly around the loop. */
function twist(t: number): number {
  return Math.PI * 0.55 * t
}

/** The six alternating top/bottom fold points, as a closed skew hexagon. */
function foldPoints(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < 3; i++) {
    const top = i * ((2 * Math.PI) / 3)
    const bottom = top + Math.PI / 3
    pts.push(new THREE.Vector3(R * Math.cos(top), H, R * Math.sin(top)))
    pts.push(new THREE.Vector3(R * Math.cos(bottom), -H, R * Math.sin(bottom)))
  }
  return pts
}

/** Sweep the twisted 3-point ribbon profile along the closed fold curve. */
export function buildTwistedStripGeometry(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(foldPoints(), true, 'catmullrom', CURVE_TENSION)
  const samples = curve.getSpacedPoints(SEGMENTS)
  const frames = curve.computeFrenetFrames(SEGMENTS, true)

  const positions: number[] = []
  const uvs: number[] = []

  const localUp = new THREE.Vector3()
  const faceNormal = new THREE.Vector3()
  const scratch = new THREE.Vector3()

  for (let i = 0; i <= SEGMENTS; i++) {
    const p = samples[i]
    const t = i / SEGMENTS
    const tw = twist(t)

    // Rotate the profile's "up" around the tangent by the twist angle.
    localUp
      .copy(frames.normals[i])
      .multiplyScalar(Math.cos(tw))
      .add(scratch.copy(frames.binormals[i]).multiplyScalar(Math.sin(tw)))
      .normalize()
    faceNormal.crossVectors(localUp, frames.tangents[i]).normalize()

    const left = p.clone().addScaledVector(localUp, -STRIP_WIDTH / 2)
    const centre = p.clone().addScaledVector(faceNormal, -STRIP_DEPTH)
    const right = p.clone().addScaledVector(localUp, STRIP_WIDTH / 2)

    positions.push(left.x, left.y, left.z)
    positions.push(centre.x, centre.y, centre.z)
    positions.push(right.x, right.y, right.z)
    uvs.push(t, 0, t, 0.5, t, 1)
  }

  const indices: number[] = []
  for (let i = 0; i < SEGMENTS; i++) {
    for (let k = 0; k < RING_COUNT - 1; k++) {
      const a0 = i * RING_COUNT + k
      const b0 = a0 + 1
      const a1 = (i + 1) * RING_COUNT + k
      const b1 = a1 + 1
      indices.push(a0, a1, b0, a1, b1, b0)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  // Averaged rather than per-face: this is what makes the surface read as
  // polished metal instead of a faceted shell.
  geo.computeVertexNormals()
  return geo
}

/**
 * Brushed-steel surface, matched to the icon's palette.
 *
 * Metalness is deliberately mid-range rather than near-1. A physically metallic
 * surface derives almost all of its colour from what it reflects, and this
 * scene has directional lights but no environment map -- at metalness 0.85 the
 * strip rendered near-black grey. The reference is matte brushed metal rather
 * than chrome anyway, so a lower metalness with moderate roughness is both
 * brighter and closer to the real object. Verified by rendering the strip at
 * four rotations before committing these numbers.
 */
export const STRIP_MATERIAL = {
  color: '#e8ebec',
  metalness: 0.45,
  roughness: 0.34,
} as const
