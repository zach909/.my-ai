/**
 * Ring Crown — the spinning backdrop built from `ring.zip`, the Zoo KCL
 * project of an articulated crown ring: 24 fork-and-tongue links and 24 hinge
 * pins forming a closed chain with six raised and six lowered 90-degree tips.
 *
 * The ring is now one colour (warm amber) instead of four sectors, and it
 * revolves AROUND a solid sphere at its centre rather than spinning about its
 * own symmetry axis — turning the opposite way from before, at a deliberately
 * uneven pace. A perfectly smooth rotation of a near-symmetric crown barely
 * reads as motion; the surging, easing speed is what makes it look alive.
 *
 * The KCL itself needs a CAD kernel to render, so this component reproduces
 * its solved layout in three.js (see ring-crown-geometry.ts). Rotation is
 * driven from elapsed time rather than accumulated per-frame deltas, so the
 * motion path is identical on any refresh rate.
 *
 * Links are drawn as rounded bars and pins as rivets; the joint geometry that
 * the CAD model constrains (fork gaps, bores, tongue twists) is invisible at
 * background scale, so the silhouette carries the likeness.
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
  SCALE,
} from './ring-crown-geometry'

/** Base revolutions per second around the sphere. Slow enough to stay a backdrop. */
const ORBIT_RATE = 0.07
/** How much the orbital speed surges and eases (0 would be perfectly smooth). */
const SURGE_AMOUNT = 0.3
/** Seconds per surge cycle. */
const SURGE_PERIOD = 3.6

/** Mid-level of the zigzag (baseHeight × SCALE), so the crown centres itself. */
const CENTER_Y = 22 * SCALE

function centerGroup(links: { position: THREE.Vector3 }[], pins: { position: THREE.Vector3 }[]) {
  const box = new THREE.Box3()
  for (const l of links) box.expandByPoint(l.position)
  for (const p of pins) box.expandByPoint(p.position)
  return box.getCenter(new THREE.Vector3())
}

function OrbitingRingCrown() {
  const orbitRef = useRef<THREE.Group>(null)
  const tiltRef = useRef<THREE.Group>(null)
  const { links, pins, center } = useMemo(() => {
    const layout = buildCrownLayout()
    const c = centerGroup(layout.links, layout.pins)
    c.y = CENTER_Y
    return { ...layout, center: c }
  }, [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (orbitRef.current) {
      // Negative yaw: the ring circles the sphere the other way than before.
      // The surge term keeps the pace uneven so the motion actually reads.
      const surge = 1 + SURGE_AMOUNT * Math.sin((t / SURGE_PERIOD) * Math.PI * 2)
      orbitRef.current.rotation.y = -t * ORBIT_RATE * Math.PI * 2 * surge
    }
    if (tiltRef.current) {
      tiltRef.current.rotation.x = 0.5 + Math.sin(t * 0.11) * 0.1
    }
  })

  return (
    <group position={center.clone().negate()}>
      {/* The sphere the ring orbits — sits at the centre of the scene. */}
      <mesh position={[0, CENTER_Y, 0]}>
        <sphereGeometry args={[CORE_SPHERE_RADIUS, 48, 32]} />
        <meshStandardMaterial color={RING_COLOR} roughness={0.35} metalness={0.35} />
      </mesh>

      <group ref={orbitRef}>
        <group ref={tiltRef}>
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
 * Full-bleed, non-interactive backdrop. Mount inside a `relative isolate`
 * container. Passes `frameloop="never"` while the page is hidden so a
 * minimised window costs nothing.
 */
export function RingCrownBackground({ opacity = 0.25 }: { opacity?: number }) {
  const visible = usePageVisible()
  return (
    <div
      className="pointer-events-none absolute inset-0 -z-10"
      style={{ opacity }}
      aria-hidden="true"
    >
      <Canvas
        frameloop={visible ? 'always' : 'never'}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.4, 4.2], fov: 40 }}
        gl={{ alpha: true, antialias: true }}
      >
        <hemisphereLight args={[0xffffff, 0x444444, 1.1]} />
        <directionalLight position={[3, 5, 4]} intensity={1} />
        <OrbitingRingCrown />
      </Canvas>
    </div>
  )
}
