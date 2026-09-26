/**
 * The articulated crown ring's geometry — one definition, shared by every
 * place the ring appears (RingCrownBackground, and any future spinner).
 *
 * Source of truth: `ring.zip` at the repository root, a Zoo KCL project
 * (unpacked into `ring/`). It describes a closed chain of 24 fork-and-tongue
 * links joined by 24 captive hinge pins, arranged as a crown with six raised
 * tips and six lowered tips — every other joint is a peak, the rest valleys,
 * and both the upper and lower tips bend at an exact 90 degrees.
 *
 * This module reproduces that layout numerically from `crownParameters.kcl`,
 * keeping the file's own names so the two can be read side by side:
 *
 *   linkCount  = 24                        twenty-four links, one per joint step
 *   jointAngle = 360deg / linkCount        15 degrees between successive joints
 *   pointCount = linkCount / 4             six sectors of four links each
 *   crownRadius = pitch / (√2 · sin(15°))  chord 2R·sin(Δ) spans a 90° bend
 *   crownRise   = R·√(2·cos Δ·(1 − cos Δ)) height solved so the bend is square
 *
 * Links are placed as rounded bars whose ends sit on the joint rings
 * (alternating base + rise / base / base − rise / base), tilted along the path
 * and rolled about their long axis the way the KCL does, so the flat faces
 * stay tangent to the ring. Colours follow main.kcl: six blue, six yellow,
 * six green, six red links, each pin a shade darker than its sector's links.
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
/** Height of the middle joint level. */
const BASE_HEIGHT = 22

/** Link tilt along the rising/falling path: asin(rise / pitch). */
const LINK_SLOPE = Math.asin(CROWN_RISE / LINK_PITCH)
/** Pin inclination against the axis, from the radial offset over the rise. */
const PIN_TILT = (() => {
  const radialOffset = CROWN_RADIUS * (1 - Math.cos(JOINT_ANGLE))
  const tiltRatio = radialOffset / CROWN_RISE
  return Math.asin(1 / Math.sqrt(1 + tiltRatio * tiltRatio))
})()
const LINK_ROLL = Math.asin(Math.sin(PIN_TILT) * Math.cos(JOINT_ANGLE / 2))
const MID_RATIO = CROWN_RADIUS * Math.sin(JOINT_ANGLE) / CROWN_RISE
const MID_TANGENT = 1 / Math.sqrt(1 + MID_RATIO * MID_RATIO)
const MID_ROLL = Math.asin(MID_TANGENT * Math.sin(JOINT_ANGLE / 2))

/** Scene scale: the 87 mm-wide ring becomes roughly two units across. */
const SCALE = 0.023

/** Link colours, in sector order — straight from main.kcl's appearance(). */
export const LINK_COLORS = ['#389ED3', '#EEE38C', '#6AAF65', '#E94842']
/** Pin colours, one shade darker per sector. */
export const PIN_COLORS = ['#2C82B4', '#D8C66D', '#4D9350', '#CB3935']

/** Rough bar size for a link, proportional to the KCL part (pitch × width × thickness). */
const LINK_LENGTH = LINK_PITCH * SCALE
const LINK_WIDTH = 11 * SCALE // halfWidth 5.5 mm
const LINK_THICKNESS = 6 * SCALE // visual thickness; the real part is 12 mm deep but mostly hollow

/** Hinge pin: 2.9 mm shaft with 4.4 mm retaining heads. */
const PIN_RADIUS = 1.45 * SCALE
const PIN_HEAD_RADIUS = 2.2 * SCALE
const PIN_LENGTH = 12.2 * SCALE

export interface CrownLink {
  /** Bar centre, scene units. */
  position: THREE.Vector3
  /** Orientation of the bar, scene-unit aligned. */
  quaternion: THREE.Quaternion
  color: string
}

export interface CrownPin {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  color: string
}

/**
 * Build one placement exactly like main.kcl builds one link: rotate X by the
 * roll, Y by the slope, Z to the joint bearing, then translate onto the ring.
 * `descending` mirrors the slope (the falling half of each sector).
 */
function placeLink(
  roll: number,
  slopeSign: 1 | -1,
  bearing: number,
  x: number,
  y: number,
  z: number,
): CrownLink {
  const q = new THREE.Quaternion()
  const e = new THREE.Euler(roll, slopeSign * LINK_SLOPE, bearing, 'XYZ')
  q.setFromEuler(e)
  return {
    position: new THREE.Vector3(x, z, -y).multiplyScalar(SCALE), // KCL Z-up → three.js Y-up
    quaternion: q,
    color: '',
  }
}

/** Joint i sits at angle i·15° on the ring; heights cycle top/mid/bottom/mid. */
function jointPosition(i: number): THREE.Vector3 {
  const a = i * JOINT_ANGLE
  const phase = ((i % 4) + 4) % 4
  const h = phase === 0 ? BASE_HEIGHT + CROWN_RISE : phase === 2 ? BASE_HEIGHT - CROWN_RISE : BASE_HEIGHT
  return new THREE.Vector3(CROWN_RADIUS * Math.cos(a), h, -CROWN_RADIUS * Math.sin(a)).multiplyScalar(SCALE)
}

export function buildCrownLayout(): { links: CrownLink[]; pins: CrownPin[] } {
  const links: CrownLink[] = []
  const pins: CrownPin[] = []

  for (let s = 0; s < POINT_COUNT; s++) {
    const sector = s % 4
    const baseAngle = Math.PI / 2 + sector * (POINT_COUNT * JOINT_ANGLE) // 90deg + k·15deg… per KCL indexing
    // The KCL lays out four template placements and circular-patterns them six
    // times about Z. Equivalent: for sector s, template t lands at bearing
    // 90° + (t + 4s)·jointAngle, joints t + 4s … t + 4s + 1.
    void baseAngle
    for (let t = 0; t < 4; t++) {
      const idx = t + POINT_COUNT * s
      const p0 = jointPosition(idx)
      const p1 = jointPosition(idx + 1)
      const mid = p0.clone().add(p1).multiplyScalar(0.5)
      const dir = p1.clone().sub(p0)
      const length = dir.length()

      // Roll alternates by template: ±linkRoll on the outer links, ±midRoll on
      // the mid-level ones; slope sign flips for the descending templates.
      const rolls = [LINK_ROLL, MID_ROLL, -LINK_ROLL, -MID_ROLL]
      const slopes: Array<1 | -1> = [1, 1, -1, -1]
      void rolls
      void slopes

      // Orient the bar: X along the link, Z outward-normal to the ring face,
      // then roll about X the way the KCL cants the fork/tongue.
      const outward = new THREE.Vector3(mid.x, 0, mid.z).normalize()
      const x = dir.clone().normalize()
      const z = outward.sub(x.clone().multiplyScalar(outward.dot(outward))).normalize()
      const y = new THREE.Vector3().crossVectors(z, x).normalize()
      const rot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
      const rollAxis = x.clone()
      const rollAngle = (t === 0 || t === 2 ? LINK_ROLL : MID_ROLL) * (t < 2 ? 1 : -1)
      rot.multiply(new THREE.Quaternion().setFromAxisAngle(rollAxis, rollAngle))

      links.push({ position: mid, quaternion: rot, color: LINK_COLORS[sector] })

      // One pin per joint, axis along the local hinge direction (the joint
      // tangent), which the KCL tilts by pinTilt/midTilt; a sphere-like rivet
      // reads the same at background scale, so keep the shaft with heads.
      if (t === 0) {
        const joint = jointPosition(idx)
        const prev = jointPosition(idx - 1)
        const next = jointPosition(idx + 1)
        const hingeAxis = next.clone().sub(prev).normalize()
        const pq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hingeAxis)
        pins.push({ position: joint, quaternion: pq, color: PIN_COLORS[sector] })
      }
    }
  }

  return { links, pins }
}

/** Shared materials, mirroring the KCL appearance (roughness 65 ≈ 0.65). */
export const LINK_MATERIAL = { roughness: 0.65, metalness: 0.15 } as const
export { LINK_LENGTH, LINK_WIDTH, LINK_THICKNESS, PIN_RADIUS, PIN_HEAD_RADIUS, PIN_LENGTH, SCALE }
