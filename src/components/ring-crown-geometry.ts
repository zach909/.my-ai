/**
 * The articulated crown ring's geometry — one definition, shared by every
 * place the ring appears (RingCrownBackground, RingCrownSpinner).
 *
 * Source of truth: `ring.zip` at the repository root, a Zoo KCL project
 * (also unpacked into `ring/`). It describes a closed chain of 24
 * fork-and-tongue links joined by 24 captive hinge pins, arranged as a crown
 * with six raised tips and six lowered tips — every fourth joint is a peak,
 * the opposite ones valleys, and both the upper and lower tips bend at an
 * exact 90 degrees.
 *
 * This module reproduces that layout numerically from `crownParameters.kcl`,
 * keeping the file's own names so the two can be read side by side:
 *
 *   linkCount  = 24                        twenty-four links, one per joint step
 *   jointAngle = 360deg / linkCount        15 degrees between successive joints
 *   pointCount = linkCount / 4             six sectors of four links each
 *   crownRadius = pitch / (√2 · sin(15°))  chord 2R·sin(Δ) spans a 90° bend
 *   crownRise   = R·√(2·cos Δ·(1 − cos Δ)) height solved so the bend is square
 *   baseHeight  = 22mm                     mid-level of the zigzag
 *
 * Joint i sits at angle i·15° on the radius; its height follows main.kcl's
 * sector pattern exactly — top (+rise), mid, bottom (−rise), mid — so the
 * peaks are at joints 0, 4, 8 … and the valleys at 2, 6, 10 …. Each link is
 * the bar between two neighbouring joints, tilted along the path and rolled
 * about its long axis (±linkRoll / ±midRoll, from pinTilt/midTilt) the way
 * the KCL cants the fork-and-tongue parts, so the flat faces stay tangent to
 * the ring. Colouring no longer follows main.kcl's four-sector scheme — the
 * whole ring is now one colour (warm amber), with pins a slightly deeper
 * shade of the same hue, and the blue is gone entirely.
 */

import * as THREE from 'three'

/** Hinge pitch in mm — distance between neighbouring joints along a link. */
export const LINK_PITCH = 22
/** Twenty-four links close the ring; joints step 15° around the axis. */
const LINK_COUNT = 24
const JOINT_ANGLE = (2 * Math.PI) / LINK_COUNT
/** Six four-link sectors; four distinct placements repeat around the ring. */
const POINT_COUNT = LINK_COUNT / 4

/** Ring radius through the joints: R = pitch / (√2 · sin(15°)). */
export const CROWN_RADIUS = LINK_PITCH / (Math.SQRT2 * Math.sin(JOINT_ANGLE))
/** Rise from mid-level to either tip, solved for right-angled joints. */
export const CROWN_RISE =
  CROWN_RADIUS * Math.sqrt(2 * Math.cos(JOINT_ANGLE) * (1 - Math.cos(JOINT_ANGLE)))
/** Height of the middle joint level (baseHeight in crownParameters.kcl). */
const BASE_HEIGHT = 22

/** Pin inclination against the axis, from the radial offset over the rise. */
const PIN_TILT = (() => {
  const radialOffset = CROWN_RADIUS * (1 - Math.cos(JOINT_ANGLE))
  const tiltRatio = radialOffset / CROWN_RISE
  return Math.asin(1 / Math.sqrt(1 + tiltRatio * tiltRatio))
})()
/** Roll of the outer (rising/falling) links about their long axis. */
const LINK_ROLL = Math.asin(Math.sin(PIN_TILT) * Math.cos(JOINT_ANGLE / 2))
/** Roll of the mid-level links — smaller, since their hinge is more upright. */
const MID_RATIO = (CROWN_RADIUS * Math.sin(JOINT_ANGLE)) / CROWN_RISE
const MID_TANGENT = 1 / Math.sqrt(1 + MID_RATIO * MID_RATIO)
const MID_ROLL = Math.asin(MID_TANGENT * Math.sin(JOINT_ANGLE / 2))

/** Scene scale: the ~87 mm-wide ring becomes roughly two units across. */
export const SCALE = 0.023

/**
 * One colour for the whole ring — links and pins alike. The KCL model split
 * the crown into four coloured sectors (blue, yellow, green, red); the blue
 * was dropped along with the multi-colour scheme, so every link shares a
 * single warm amber that matches the interface accent token.
 */
export const RING_COLOR = '#F0B45C'
/** Pins read as a slightly deeper shade of the same hue, not a new colour. */
export const PIN_COLOR = '#D89A44'

/** @deprecated Kept as arrays of the single colour so any legacy index still works. */
export const LINK_COLORS = [RING_COLOR, RING_COLOR, RING_COLOR, RING_COLOR]
/** @deprecated See LINK_COLORS. */
export const PIN_COLORS = [PIN_COLOR, PIN_COLOR, PIN_COLOR, PIN_COLOR]

/** Rounded-bar size for a link, proportional to the KCL part (linkPitch × 11 × 6). */
export const LINK_LENGTH = LINK_PITCH * SCALE
export const LINK_WIDTH = 11 * SCALE
export const LINK_THICKNESS = 6 * SCALE

/**
 * Radius of the sphere the ring orbits at its centre. Sized to sit just
 * inside the ring's inner edge so the chain visibly circles it instead of
 * intersecting it.
 */
export const CORE_SPHERE_RADIUS = CROWN_RADIUS * Math.SQRT2 * 0.62 * SCALE

/** Hinge pin: 2.9 mm shaft with 4.4 mm retaining heads (pin.kcl). */
export const PIN_RADIUS = 1.45 * SCALE
export const PIN_HEAD_RADIUS = 2.2 * SCALE
export const PIN_LENGTH = 12.2 * SCALE
const PIN_HEAD_THICKNESS = 0.8 * SCALE

export interface CrownLink {
  /** Bar centre, scene units. */
  position: THREE.Vector3
  /** Orientation of the bar: local X runs along the link. */
  quaternion: THREE.Quaternion
  color: string
}

export interface CrownPin {
  position: THREE.Vector3
  /** Local Y runs along the pin shaft. */
  quaternion: THREE.Quaternion
  color: string
}

/**
 * Joint i of the closed chain: angle i·15° on CROWN_RADIUS, height cycling
 * top / mid / bottom / mid exactly like main.kcl's four template placements
 * (baseHeight + rise, baseHeight, baseHeight − rise, baseHeight).
 * KCL Z-up → three.js Y-up: (x, y, z) maps to (x, z, −y).
 */
function jointPosition(i: number): THREE.Vector3 {
  const idx = ((i % LINK_COUNT) + LINK_COUNT) % LINK_COUNT
  const a = idx * JOINT_ANGLE
  const phase = idx % 4
  const h =
    phase === 0 ? BASE_HEIGHT + CROWN_RISE : phase === 2 ? BASE_HEIGHT - CROWN_RISE : BASE_HEIGHT
  return new THREE.Vector3(
    CROWN_RADIUS * Math.cos(a),
    h,
    -CROWN_RADIUS * Math.sin(a),
  ).multiplyScalar(SCALE)
}

/**
 * Build all 24 links and 24 pins of the crown. Deterministic — call once and
 * share the result.
 */
export function buildCrownLayout(): { links: CrownLink[]; pins: CrownPin[] } {
  const links: CrownLink[] = []
  const pins: CrownPin[] = []

  for (let i = 0; i < LINK_COUNT; i++) {
    const p0 = jointPosition(i)
    const p1 = jointPosition(i + 1)
    const mid = p0.clone().add(p1).multiplyScalar(0.5)
    const dir = p1.clone().sub(p0)
    const sector = Math.floor(i / POINT_COUNT) % 4

    // Frame: X along the link, Z outward-normal to the ring face (so the
    // bar's flat face stays tangent, like the KCL part), Y completes it.
    const outward = new THREE.Vector3(mid.x, 0, mid.z).normalize()
    const x = dir.clone().normalize()
    const z = outward
      .clone()
      .sub(x.clone().multiplyScalar(outward.dot(x)))
      .normalize()
    const y = new THREE.Vector3().crossVectors(z, x).normalize()
    const q = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(x, y, z),
    )
    // Cant the bar about its long axis: the rising/falling links roll by
    // ±linkRoll, the mid-level ones by ∓midRoll (templates 1 and 3 in main.kcl).
    const phase = i % 4
    const roll =
      phase === 0 ? LINK_ROLL : phase === 1 ? MID_ROLL : phase === 2 ? -LINK_ROLL : -MID_ROLL
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll))

    links.push({ position: mid, quaternion: q, color: LINK_COLORS[sector] })

    // One pin per joint, laid across the joint like the KCL's hinge: tilted
    // from the outward radial by pinTilt (top/bottom joints) or midTilt
    // (mid joints), toward the next joint along the chain.
    const joint = jointPosition(i + 1)
    const radial = new THREE.Vector3(joint.x, 0, joint.z).normalize()
    const along = p1.clone().sub(p0).normalize()
    const tilt =
      phase === 0 || phase === 2 ? PIN_TILT : Math.asin(MID_TANGENT)
    const axis = radial
      .clone()
      .applyAxisAngle(
        new THREE.Vector3().crossVectors(radial, along).normalize(),
        Math.PI / 2 - tilt,
      )
      .normalize()
    const pq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis)
    pins.push({ position: joint, quaternion: pq, color: PIN_COLORS[sector] })
  }

  return { links, pins }
}

/** Shared materials, mirroring the KCL appearance (roughness 65 ≈ 0.65). */
export const LINK_MATERIAL = { roughness: 0.65, metalness: 0.15 } as const

export { PIN_HEAD_THICKNESS, JOINT_ANGLE, LINK_COUNT, POINT_COUNT }
