/**
 * Ring Crown — the spinning backdrop built from `ring.zip`, the Zoo KCL
 * project of an articulated crown ring: 24 fork-and-tongue links and 24 hinge
 * pins forming a closed chain with six raised and six lowered 90-degree tips,
 * coloured in four sectors (blue, yellow, green, red).
 *
 * The KCL itself needs a CAD kernel to render, so this component reproduces
 * its solved layout in three.js (see ring-crown-geometry.ts) and spins it:
 * rotation is driven from elapsed time rather than accumulated per-frame
 * deltas, so the speed is identical on any refresh rate. A slow nod about the
 * horizontal axis keeps the peaks sweeping through the light — a crown turned
 * about its own symmetry axis alone would barely read as moving.
 *
 * Links are drawn as rounded bars and pins as rivets; the joint geometry that
 * the CAD model constrains (fork gaps, bores, tongue twists) is invisible at
 * background scale, so the silhouette and colouring carry the likeness.
 */

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { usePageVisible } from '@/hooks/usePageVisible'
import {
  buildCrownLayout,
  LINK_COLORS,
  LINK_LENGTH,
  LINK_MATERIAL,
  LINK_THICKNESS,
  LINK_WIDTH,
  PIN_COLORS,
  PIN_HEAD_RADIUS,
  PIN_LENGTH,
  PIN_RADIUS,
} from './ring-crown-geometry'

/** Turns per second around the vertical axis. Slow enough to stay a backdrop. */
const SPIN_RATE = 0.06

function centerGroup(links: { position: THREE.Vector3 }[], pins: { position: THREE.Vector3 }[]) {
  const box = new THREE.Box3()
  for (const l of links) box.expandByPoint(l.position)
  for (const p of pins) box.expandByPoint(p.position)
  return box.getCenter(new THREE.Vector3())
}

function SpinningRingCrown() {
  const groupRef = useRef<THREE.Group>(null)
  const { links, pins, center } = useMemo(() => {
    const layout = buildCrownLayout()
    return { ...layout, center: centerGroup(layout.links, layout.pins) }
  }, [])

  useFrame((state) => {
    const g = groupRef.current
    if (!g) return
    const t = state.clock.elapsedTime
    g.rotation.y = t * SPIN_RATE * Math.PI * 2
    // Gentle tilt oscillation so both the top and bottom tips catch the light.
    g.rotation.x = 0.5 + Math.sin(t * 0.11) * 0.08
  })

  return (
    <group ref={groupRef} position={center.clone().negate()}>
      {links.map((l, i) => (
        <mesh key={`link-${i}`} position={l.position} quaternion={l.quaternion}>
          <boxGeometry args={[LINK_LENGTH, LINK_WIDTH, LINK_THICKNESS]} />
          <meshStandardMaterial color={LINK_COLORS[Math.floor(i / 6) % 4]} {...LINK_MATERIAL} />
        </mesh>
      ))}
      {pins.map((p, i) => (
        <group key={`pin-${i}`} position={p.position} quaternion={p.quaternion}>
          <mesh>
            <cylinderGeometry args={[PIN_RADIUS, PIN_RADIUS, PIN_LENGTH, 12]} />
            <meshStandardMaterial color={PIN_COLORS[i % 4]} {...LINK_MATERIAL} />
          </mesh>
          <mesh position={[0, PIN_LENGTH / 2, 0]}>
            <cylinderGeometry args={[PIN_HEAD_RADIUS, PIN_HEAD_RADIUS, 0.8 * 0.023, 12]} />
            <meshStandardMaterial color={PIN_COLORS[i % 4]} {...LINK_MATERIAL} />
          </mesh>
          <mesh position={[0, -PIN_LENGTH / 2, 0]}>
            <cylinderGeometry args={[PIN_HEAD_RADIUS, PIN_HEAD_RADIUS, 0.8 * 0.023, 12]} />
            <meshStandardMaterial color={PIN_COLORS[i % 4]} {...LINK_MATERIAL} />
          </mesh>
        </group>
      ))}
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
        <SpinningRingCrown />
      </Canvas>
    </div>
  )
}
