/**
 * The articulated crown ring from `ring.zip` (the Zoo KCL project in the
 * repository root) spinning on its own — used as the app's loading spinner.
 *
 * All of the geometry lives in ring-crown-geometry.ts, which reproduces the
 * KCL's solved layout numerically: 24 fork-and-tongue links and 24 hinge pins
 * closing into a crown with six raised and six lowered 90-degree tips, in
 * four colour sectors (blue, yellow, green, red). This file only draws that
 * layout and turns it.
 *
 * Rotation is driven from elapsed time rather than accumulated per-frame
 * deltas, so the speed is identical at any refresh rate. A slow nod about the
 * horizontal axis keeps the peaks sweeping through the light — a crown turned
 * about its symmetry axis alone would barely read as moving.
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
  LINK_COLORS,
  LINK_LENGTH,
  LINK_MATERIAL,
  LINK_THICKNESS,
  LINK_WIDTH,
  PIN_COLORS,
  PIN_HEAD_RADIUS,
  PIN_HEAD_THICKNESS,
  PIN_LENGTH,
  PIN_RADIUS,
} from './ring-crown-geometry'

/** Turns per second around the vertical axis. */
const SPIN_RATE = 0.12

/** Mean joint height, so the crown spins about its own middle, not z=0. */
const CENTER_Y = 22 * 0.023 // baseHeight × SCALE — mid-level of the zigzag

function SpinningCrown() {
  const groupRef = useRef<THREE.Group>(null)
  const { links, pins } = useMemo(() => buildCrownLayout(), [])

  useFrame((state) => {
    const g = groupRef.current
    if (!g) return
    const t = state.clock.elapsedTime
    g.rotation.y = t * SPIN_RATE * Math.PI * 2
    // Gentle tilt oscillation so both the top and bottom tips catch the light.
    g.rotation.x = 0.5 + Math.sin(t * 0.17) * 0.08
  })

  return (
    <group ref={groupRef} position={[0, -CENTER_Y, 0]}>
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
            <meshStandardMaterial color={PIN_COLORS[Math.floor(i / 6) % 4]} {...LINK_MATERIAL} />
          </mesh>
          {/* retaining heads, pin.kcl */}
          <mesh position={[0, PIN_LENGTH / 2, 0]}>
            <cylinderGeometry args={[PIN_HEAD_RADIUS, PIN_HEAD_RADIUS, PIN_HEAD_THICKNESS, 12]} />
            <meshStandardMaterial color={PIN_COLORS[Math.floor(i / 6) % 4]} {...LINK_MATERIAL} />
          </mesh>
          <mesh position={[0, -PIN_LENGTH / 2, 0]}>
            <cylinderGeometry args={[PIN_HEAD_RADIUS, PIN_HEAD_RADIUS, PIN_HEAD_THICKNESS, 12]} />
            <meshStandardMaterial color={PIN_COLORS[Math.floor(i / 6) % 4]} {...LINK_MATERIAL} />
          </mesh>
        </group>
      ))}
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
        // The ring spans ~2 units across plus its rise; back off enough that
        // it stays fully in frame through a whole turn.
        camera={{ position: [0, 0.35, 3.6], fov: 40 }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
        aria-hidden="true"
      >
        <hemisphereLight args={[0xffffff, 0x6a6a70, 1.55]} />
        <directionalLight position={[3, 5, 4]} intensity={1.25} />
        <directionalLight position={[-3, -2, -4]} intensity={0.45} />
        <SpinningCrown />
      </Canvas>
    </div>
  )
}
