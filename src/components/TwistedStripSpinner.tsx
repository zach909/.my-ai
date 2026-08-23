/**
 * Loading indicator: the twisted metal strip, turning.
 *
 * Shares its geometry with TwistedStripLogo (twisted-strip-geometry.ts) so the
 * loader and the mark are literally the same object, not two drawings that
 * drift apart.
 *
 * Spins on a tilted axis rather than straight up, because a closed loop turned
 * about its own axis of symmetry barely appears to move — the tilt is what
 * makes the folds sweep through the light and read as rotation. Motion is
 * driven from elapsed time rather than accumulated per-frame deltas so the
 * speed is identical on a 60Hz and a 144Hz display, and a dropped frame does
 * not make it stutter.
 */

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { usePageVisible } from '@/hooks/usePageVisible'
import * as THREE from 'three'
import { buildTwistedStripGeometry, STRIP_MATERIAL } from './twisted-strip-geometry'

/** Turns per second. Slow enough to read as deliberate, not frantic. */
const SPIN_RATE = 0.22

function SpinningStrip() {
  const ref = useRef<THREE.Group>(null)
  const geometry = useMemo(() => buildTwistedStripGeometry(), [])

  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.elapsedTime
    ref.current.rotation.y = t * SPIN_RATE * Math.PI * 2
    // A slight counter-nod keeps the silhouette changing, so the strip reads as
    // a solid object rotating in space rather than a flat ring scrolling.
    ref.current.rotation.x = Math.sin(t * SPIN_RATE * Math.PI) * 0.14
  })

  return (
    <group ref={ref} rotation={[0.35, 0, 0.18]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial {...STRIP_MATERIAL} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/**
 * @param size   Canvas footprint in pixels.
 * @param label  Announced to screen readers; the canvas itself is decorative.
 */
export function TwistedStripSpinner({
  size = 64,
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
        // Stop rendering entirely when the window is hidden. A WebGL loop that
        // keeps drawing behind another window is pure GPU and battery cost for
        // frames nobody sees.
        frameloop={visible ? 'always' : 'never'}
        // Far enough back that the loop stays fully in frame through a whole
        // turn -- at 4.1 the strip clipped the canvas edge at some angles.
        camera={{ position: [0, 0.45, 5.6], fov: 40 }}
        gl={{ alpha: true, antialias: true }}
        // Cap the pixel ratio: a loader has no business rendering at 3x on a
        // phone while the thing it is waiting for competes for the same GPU.
        dpr={[1, 2]}
        aria-hidden="true"
      >
        <hemisphereLight args={[0xffffff, 0x6a6a70, 1.55]} />
        <directionalLight position={[3, 5, 4]} intensity={1.25} />
        <directionalLight position={[-3, -2, -4]} intensity={0.45} />
        <directionalLight position={[0, -4, 2]} intensity={0.3} />
        <SpinningStrip />
      </Canvas>
    </div>
  )
}
