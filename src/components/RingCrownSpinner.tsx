/**
 * The articulated crown ring from `ring.zip` (the Zoo KCL project in the
 * repository root) orbiting a solid sphere at its centre — used as the app's
 * loading spinner.
 *
 * All of the geometry lives in ring-crown-geometry.ts, which reproduces the
 * KCL's solved layout numerically: 24 fork-and-tongue links and 24 hinge pins
 * closing into a crown with six raised and six lowered 90-degree tips. The
 * four-colour sector scheme is gone: the whole ring is now one colour.
 *
 * Motion notes:
 * - The ring revolves AROUND the central sphere instead of spinning about
 *   its own symmetry axis, so there is always something clearly moving past
 *   something else — no ambiguous "is it even turning" silhouette.
 * - It turns the OTHER way from before (negative yaw), and the drive is not
 *   perfectly smooth: the angular speed breathes with a slow sinusoid, so the
 *   peaks visibly surge and ease rather than gliding at a constant rate. A
 *   perfectly smooth spin of a near-symmetric crown would barely read as
 *   motion at all; the uneven pace is what makes it alive.
 * - Rotation is still driven from elapsed time (not accumulated per-frame
 *   deltas), so the path is identical at any refresh rate.
 *
 * Like TwistedStripSpinner this pulls in three.js, so it must stay behind a
 * lazy() boundary; LoadingScreen keeps an instant SVG fallback mounted under
 * it.
 */

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { usePageVisible } from '@/hooks/usePageVisible'
import {
  buildCrownLayout,
  CORE_SPHERE_RADIUS,
  LINK_LENGTH,
  LINK_MATERIAL,
  LINK_THICKNESS,
  LINK_WIDTH,
  PIN_HEAD_RADIUS,
  PIN_HEAD_THICKNESS,
  PIN_LENGTH,
  PIN_RADIUS,
  PIN_COLOR,
  RING_COLOR,
} from './ring-crown-geometry'

/** Base revolutions per second of the ring around the sphere. */
const ORBIT_RATE = 0.16
/** How much the orbital speed surges and eases (0 would be perfectly smooth). */
const SURGE_AMOUNT = 0.35
/** Seconds per surge cycle — the "not perfectly smooth" breathing of speed. */
const SURGE_PERIOD = 2.4

/** Mean joint height, so the assembly centres on the sphere, not z=0. */
const CENTER_Y = 22 * 0.023 // baseHeight × SCALE — mid-level of the zigzag

function OrbitingCrown() {
  const orbitRef = useRef<THREE.Group>(null)
  const tumbleRef = useRef<THREE.Group>(null)
  const { links, pins } = useMemo(() => buildCrownLayout(), [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (orbitRef.current) {
      // Negative: the ring revolves the opposite way to the previous spin.
      // The (1 + SURGE·sin) term makes the angular speed breathe instead of
      // gliding at one constant, invisible rate.
      const surge = 1 + SURGE_AMOUNT * Math.sin((t / SURGE_PERIOD) * Math.PI * 2)
      orbitRef.current.rotation.y = -t * ORBIT_RATE * Math.PI * 2 * surge
    }
    if (tumbleRef.current) {
      // Slow tilt wobble so different faces of the chain catch the light.
      tumbleRef.current.rotation.x = 0.42 + Math.sin(t * 0.5) * 0.12
    }
  })

  return (
    <group position={[0, -CENTER_Y, 0]}>
      {/* The sphere the ring circles — static at the centre. */}
      <mesh>
        <sphereGeometry args={[CORE_SPHERE_RADIUS, 48, 32]} />
        <meshStandardMaterial color={RING_COLOR} roughness={0.35} metalness={0.35} />
      </mesh>

      <group ref={orbitRef}>
        <group ref={tumbleRef}>
          {links.map((l, i) => (
            <mesh key={`link-${i}`} position={l.position} quaternion={l.quaternion}>
              <boxGeometry args={[LINK_LENGTH, LINK_WIDTH, LINK_THICKNESS]} />
              <meshStandardMaterial color={RING_COLOR} {...LINK_MATERIAL} />
            </mesh>
          ))}
          {pins.map((p, i) => (
            <group key={`pin-${i}`} position={p.position} quaternion={p.quaternion}>
              <mesh>
                <cylinderGeometry args={[PIN_RADIUS, PIN_RADIUS, PIN_LENGTH, 12]} />
                <meshStandardMaterial color={PIN_COLOR} {...LINK_MATERIAL} />
              </mesh>
              {/* retaining heads, pin.kcl */}
              <mesh position={[0, PIN_LENGTH / 2, 0]}>
                <cylinderGeometry args={[PIN_HEAD_RADIUS, PIN_HEAD_RADIUS, PIN_HEAD_THICKNESS, 12]} />
                <meshStandardMaterial color={PIN_COLOR} {...LINK_MATERIAL} />
              </mesh>
              <mesh position={[0, -PIN_LENGTH / 2, 0]}>
                <cylinderGeometry args={[PIN_HEAD_RADIUS, PIN_HEAD_RADIUS, PIN_HEAD_THICKNESS, 12]} />
                <meshStandardMaterial color={PIN_COLOR} {...LINK_MATERIAL} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
    </group>
  )
}

/**
 * @param size  Canvas footprint in pixels.
 * @param label Announced to screen readers; the canvas itself is decorative.
 */
export function RingCrownSpinner({
  size = 140,
  label = 'Loading',
}: {
  size?: number
  label?: string
}) {
  const visible = usePageVisible()
  return (
    <div
      style={{ width: size, height: size }}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <Canvas
        // Stop rendering entirely when the window is hidden — a WebGL loop
        // drawing behind another window is pure GPU and battery cost.
        frameloop={visible ? 'always' : 'never'}
        // Backed off slightly from the old 3.6 so the orbiting ring never
        // clips the canvas edge while it swings around the sphere.
        camera={{ position: [0, 0.5, 4.0], fov: 40 }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
        aria-hidden="true"
      >
        <hemisphereLight args={[0xffffff, 0x6a6a70, 1.55]} />
        <directionalLight position={[3, 5, 4]} intensity={1.25} />
        <directionalLight position={[-3, -2, -4]} intensity={0.45} />
        <OrbitingCrown />
      </Canvas>
    </div>
  )
}
