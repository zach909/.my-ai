/**
 * Ring Crown — the spinning backdrop built from `ring.zip`, the Zoo KCL
 * project of an articulated crown ring: 24 fork-and-tongue links and 24 hinge
 * pins forming a closed chain with six raised and six lowered 90-degree tips.
 *
 * The ring is one colour (warm amber) instead of four sectors, it revolves
 * AROUND a solid sphere at its centre rather than spinning about its own
 * symmetry axis — turning the opposite way from before, at a deliberately
 * uneven pace. A perfectly smooth rotation of a near-symmetric crown barely
 * reads as motion; the surging, easing speed is what makes it look alive.
 *
 * As a BACKGROUND the crown is framed to fill the viewport: the camera sits
 * on the ring's axis at a distance computed from the crown's measured extent
 * (CROWN_EXTENT) and the live canvas aspect ratio, so the ring always reads
 * as a huge soft halo behind the page content instead of a small object lost
 * in empty space. Soft falloff comes from low opacity plus radial glow and
 * vignette layers in CSS; no post-processing pass is needed for a backdrop.
 *
 * The KCL itself needs a CAD kernel to render, so this component reproduces
 * its solved layout in three.js (see ring-crown-geometry.ts). Rotation is
 * driven from elapsed time rather than accumulated per-frame deltas, so the
 * motion path is identical on any refresh rate.
 */

import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { usePageVisible } from '@/hooks/usePageVisible'
import {
  buildCrownLayout,
  CORE_SPHERE_RADIUS,
  CROWN_EXTENT,
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

/** Base revolutions per second around the sphere. Slow enough to stay a backdrop. */
const ORBIT_RATE = 0.07
/** How much the orbital speed surges and eases (0 would be perfectly smooth). */
const SURGE_AMOUNT = 0.3
/** Seconds per surge cycle. */
const SURGE_PERIOD = 3.6

/** Backdrop camera field of view, degrees. */
const FOV = 45

/**
 * How much of the viewport the ring should span, as a fraction of the frame.
 * 1.0 means the crown exactly touches the edges; slightly over 1 lets it
 * bleed past them, which feels more like a backdrop and less like a logo.
 */
const FILL = 1.15
/** Fixed viewing tilt so the crown reads as an ellipse, not a flat disc. */
const VIEW_TILT = 0.42

/**
 * The crown is a wide flat zigzag — seen tilted it would only ever cover a
 * band across the screen. Extrapolate the chain around its axis into an
 * "orbital disc" footprint (the circle the joints sweep plus the crown's own
 * height band) so the backdrop can be scaled to fill the whole viewport.
 * This is purely a framing extent; the rendered geometry stays the real ring.
 */
const DISC = (() => {
  const s = CROWN_EXTENT.size
  const radius = Math.max(s.x, s.z) / 2
  const thickness = s.y
  // Sampled silhouette half-extents of a tilted annular disc (outer radius r,
  // inner hole radius ri, vertical band ±t/2) rotated about X by `tilt`.
  const projected = (tilt: number) => {
    const cos = Math.cos(tilt)
    const sin = Math.sin(tilt)
    const ri = radius * 0.55
    let hx = 0
    let hy = 0
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 36) {
      const c = Math.cos(a)
      const zn = -Math.sin(a)
      for (const r of [radius, ri]) {
        for (const dy of [-thickness / 2, thickness / 2]) {
          const y = dy * cos - r * zn * sin
          hx = Math.max(hx, Math.abs(r * c))
          hy = Math.max(hy, Math.abs(y))
        }
      }
    }
    return { hx, hy }
  }
  return { projected, radius, thickness }
})()

/**
 * Distance from the crown centre at which the tilted orbital footprint just
 * fills the viewport, using the binding dimension (width or height) so the
 * framing works at any aspect ratio.
 */
function fitDistance(fovRad: number, aspect: number, tilt: number): number {
  const halfV = Math.tan(fovRad / 2)
  const halfH = halfV * aspect
  const { hx, hy } = DISC.projected(tilt)
  const dV = hy / halfV
  const dH = hx / halfH
  return Math.min(dV, dH) / FILL
}

function BackgroundCameraRig() {
  const { camera, size } = useThree()
  useFrame((state) => {
    const persp = camera as THREE.PerspectiveCamera
    const t = state.clock.elapsedTime
    // Match the wobble applied to the crown itself (see OrbitingRingCrown).
    const tilt = VIEW_TILT + Math.sin(t * 0.09) * 0.06
    const d = fitDistance(
      THREE.MathUtils.degToRad(persp.fov),
      size.width / Math.max(1, size.height),
      tilt,
    )
    // Look straight down the tilted ring axis at the crown centre.
    persp.position.set(0, d * Math.sin(tilt), d * Math.cos(tilt))
    persp.lookAt(0, 0, 0)
  })
  return null
}

function OrbitingRingCrown() {
  const orbitRef = useRef<THREE.Group>(null)
  const tiltRef = useRef<THREE.Group>(null)
  const { links, pins, center } = useMemo(() => {
    const layout = buildCrownLayout()
    // Centre the crown on the scene origin; the camera rig frames that point.
    return { ...layout, center: CROWN_EXTENT.center.clone() }
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
      // Gentle wobble on top of the fixed backdrop tilt — slow and small so
      // the huge ring drifts rather than bobs.
      tiltRef.current.rotation.x = VIEW_TILT + Math.sin(t * 0.09) * 0.06
    }
  })

  return (
    <group position={center.clone().negate()}>
      {/* The sphere the ring orbits — sits at the centre of the scene. */}
      <mesh>
        <sphereGeometry args={[CORE_SPHERE_RADIUS, 48, 32]} />
        <meshStandardMaterial color={RING_COLOR} roughness={0.35} metalness={0.35} />
      </mesh>

      <group ref={tiltRef}>
        <group ref={orbitRef}>
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
 * Full-bleed, non-interactive backdrop: the crown ring scaled to fill the
 * viewport behind page content, softly translucent with a warm glow bleeding
 * from its centre. Mount inside a `relative isolate` container. Passes
 * `frameloop="never"` while the page is hidden so a minimised window costs
 * nothing.
 */
export function RingCrownBackground({ opacity = 0.3 }: { opacity?: number }) {
  const visible = usePageVisible()
  return (
    <div
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      aria-hidden="true"
    >
      {/* Warm ambient glow behind the ring so it bleeds into the page. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 55% at 50% 45%, rgba(240, 180, 92, 0.10), transparent 70%)',
        }}
      />
      <div className="absolute inset-0" style={{ opacity }}>
        <Canvas
          frameloop={visible ? 'always' : 'never'}
          dpr={[1, 1.5]}
          camera={{ position: [0, 2, 4], fov: FOV, near: 0.1, far: 100 }}
          gl={{ alpha: true, antialias: true }}
        >
          <BackgroundCameraRig />
          <hemisphereLight args={[0xfff3dd, 0x3a2f22, 1.2]} />
          <directionalLight position={[3, 5, 4]} intensity={0.9} />
          <OrbitingRingCrown />
        </Canvas>
      </div>
      {/* Soft vignette so the ring fades at the edges instead of clipping hard. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.25) 100%)',
        }}
      />
    </div>
  )
}
