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
 * its solved layout in three.js (see ring-crown-geometry.ts). The idle orbit
 * is driven from elapsed time; the message-pulse spin-up integrates per-frame
 * deltas instead, because a rate that changes mid-flight cannot be expressed
 * as a pure function of time without jumping the angle.
 */

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { usePageVisible } from '@/hooks/usePageVisible'
import { onRingEvent } from '@/lib/ring-pulse'
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

/**
 * Spin-up behaviour when a message is sent (see lib/ring-pulse):
 * - ENERGY_TARGET: extra revolutions per second added on top of the idle
 *   orbit rate while the ring is "excited" — roughly 4x its resting pace,
 *   enough to read as a reaction without becoming a helicopter.
 * - SPIN_UP_SECONDS: how long the ramp takes. Fast enough to feel like it
 *   happened *because of* the send, slow enough not to snap.
 * - COOL_DOWN_SECONDS: how long the wind-down takes once the reply lands.
 *   Deliberately longer than the spin-up: a machine that races when handed
 *   work and glides back to rest looks alive; one that stops dead looks off.
 */
const ENERGY_TARGET = 0.28
const SPIN_UP_SECONDS = 1.4
const COOL_DOWN_SECONDS = 4.5

/** Mouse-tracking limits for the parallax tilt. */
const PARALLAX_X = 0.1
const PARALLAX_Y = 0.07
/** Fraction of the pointer offset the camera eases toward each second. */
const PARALLAX_EASE = 3.5

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

/** Shared live state between the crown and the camera rig, held in refs so
 *  per-frame writes never re-render anything. */
interface RingMotionState {
  /** Normalised pointer position over the window, -1..1 on each axis. */
  mouse: { x: number; y: number }
  /** Eased parallax offsets actually applied to the scene (radians). */
  parallaxX: number
  parallaxY: number
  /** Extra revolutions-per-second currently injected by message pulses. */
  energy: number
}

/**
 * Camera rig: frames the crown to fill the viewport and leans the whole view
 * a few degrees toward the pointer. The backdrop div is `pointer-events-none`,
 * so the listener lives on `window` — the ring watches where the cursor is
 * without ever intercepting clicks meant for the page above it.
 */
function BackgroundCameraRig({ motion }: { motion: MutableRefObject<RingMotionState> }) {
  const { camera, size } = useThree()
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      motion.current.mouse.x = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1
      motion.current.mouse.y = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [motion])

  useFrame((state, delta) => {
    const persp = camera as THREE.PerspectiveCamera
    const t = state.clock.elapsedTime
    const m = motion.current
    // Exponential ease toward the pointer target: frame-rate independent,
    // and the lag is what makes it feel like weight rather than a tether.
    const k = 1 - Math.exp(-PARALLAX_EASE * delta)
    m.parallaxX += (m.mouse.x * PARALLAX_X - m.parallaxX) * k
    m.parallaxY += (-m.mouse.y * PARALLAX_Y - m.parallaxY) * k
    // Match the wobble + parallax applied to the crown itself (see OrbitingRingCrown).
    const tilt = VIEW_TILT + Math.sin(t * 0.09) * 0.06 + m.parallaxY
    const yaw = m.parallaxX
    const d = fitDistance(
      THREE.MathUtils.degToRad(persp.fov),
      size.width / Math.max(1, size.height),
      tilt,
    )
    // Look down the tilted ring axis at the crown centre, swung sideways by
    // the pointer so the halo shifts with the mouse.
    persp.position.set(
      d * Math.sin(yaw),
      d * Math.sin(tilt) * Math.cos(yaw),
      d * Math.cos(tilt) * Math.cos(yaw),
    )
    persp.lookAt(0, 0, 0)
  })
  return null
}

function OrbitingRingCrown({ motion }: { motion: MutableRefObject<RingMotionState> }) {
  const orbitRef = useRef<THREE.Group>(null)
  const tiltRef = useRef<THREE.Group>(null)
  const glowRef = useRef<THREE.PointLight>(null)
  const { links, pins, center } = useMemo(() => {
    const layout = buildCrownLayout()
    // Centre the crown on the scene origin; the camera rig frames that point.
    return { ...layout, center: CROWN_EXTENT.center.clone() }
  }, [])

  // Spin angle is integrated per frame instead of read off elapsed time,
  // because energy from message pulses changes the RATE mid-flight — a
  // time-multiplied angle would jump whenever the rate changed. Keeping the
  // integral continuous means surging speeds up the spin smoothly and
  // cooling down slows it smoothly, never teleporting it.
  const angleRef = useRef(0)
  const lastTimeRef = useRef<number | null>(null)

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const m = motion.current
    if (lastTimeRef.current === null) lastTimeRef.current = t
    // Clamp delta so a backgrounded tab returning does not fling the ring.
    const dt = Math.min(delta, 0.1)
    lastTimeRef.current = t

    if (orbitRef.current) {
      // Idle surge keeps the pace uneven so the motion reads even when calm.
      const surge = 1 + SURGE_AMOUNT * Math.sin((t / SURGE_PERIOD) * Math.PI * 2)
      const rate = ORBIT_RATE * surge + m.energy
      // Negative yaw: the ring circles the sphere the other way than before.
      angleRef.current -= rate * Math.PI * 2 * dt
      orbitRef.current.rotation.y = angleRef.current
    }
    if (tiltRef.current) {
      // Gentle wobble on top of the fixed backdrop tilt — slow and small so
      // the huge ring drifts rather than bobs — plus pointer parallax shared
      // with the camera rig (the crown tips slightly toward the mouse).
      tiltRef.current.rotation.x = VIEW_TILT + Math.sin(t * 0.09) * 0.06 + m.parallaxY
      tiltRef.current.rotation.z = -m.parallaxX * 0.5
    }
    if (glowRef.current) {
      // The core brightens while the ring is spun up, then fades back.
      glowRef.current.intensity = 0.6 + m.energy * 6
    }
  })

  return (
    <group position={center.clone().negate()}>
      {/* The sphere the ring orbits — sits at the centre of the scene. */}
      <mesh>
        <sphereGeometry args={[CORE_SPHERE_RADIUS, 48, 32]} />
        <meshStandardMaterial color={RING_COLOR} roughness={0.35} metalness={0.35} />
      </mesh>

      <mesh position={[0, 0, CORE_SPHERE_RADIUS * 2.5]} ref={glowRef}>
        {/* Core glow light — brightens while message pulses spin the ring up. */}
        <pointLight color={RING_COLOR} intensity={0.6} distance={CORE_SPHERE_RADIUS * 40} decay={2} />
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
 * Full-bleed backdrop: the crown ring scaled to fill the viewport behind page
 * content, softly translucent with a warm glow bleeding from its centre. It
 * reacts to the app in two ways: it leans toward the pointer (parallax), and
 * it spins up hard when a message is sent, coasting back down once the reply
 * lands — see lib/ring-pulse for how those events arrive. Mount inside a
 * `relative isolate` container. Passes `frameloop="never"` while the page is
 * hidden so a minimised window costs nothing.
 */
export function RingCrownBackground({ opacity = 0.3 }: { opacity?: number }) {
  const visible = usePageVisible()

  // One mutable object shared by reference into both frame loops; nothing
  // here is state because per-frame changes must never re-render React.
  const motion = useRef<RingMotionState>({ mouse: { x: 0, y: 0 }, parallaxX: 0, parallaxY: 0, energy: 0 })

  // Energy ramp: pulse() drives the target up fast, settle() drops it back
  // to zero, and the actual value eases exponentially toward the target each
  // frame — so repeated sends stack into one continuous surge instead of
  // restarting the animation, and the wind-down always glides.
  const [energyTarget, setEnergyTarget] = useState(0)
  useEffect(() => {
    return onRingEvent((event) => {
      if (event === 'pulse') {
        setEnergyTarget((prev) => Math.min(prev + ENERGY_TARGET, ENERGY_TARGET * 2))
      } else {
        setEnergyTarget(0)
      }
    })
  }, [])
  useEffect(() => {
    const id = setInterval(() => {
      const m = motion.current
      const rate = m.energy < energyTarget ? SPIN_UP_SECONDS : COOL_DOWN_SECONDS
      // Exponential approach over `rate` seconds: each tick closes the gap
      // by a fixed fraction, so the ramp is frame-rate independent and the
      // wind-down always glides rather than stopping dead.
      m.energy += (energyTarget - m.energy) * (1 - Math.exp(-0.1 / rate))
      if (Math.abs(m.energy - energyTarget) < 0.001) m.energy = energyTarget
    }, 100)
    return () => clearInterval(id)
  }, [energyTarget])

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
          <BackgroundCameraRig motion={motion} />
          <hemisphereLight args={[0xfff3dd, 0x3a2f22, 1.2]} />
          <directionalLight position={[3, 5, 4]} intensity={0.9} />
          <OrbitingRingCrown motion={motion} />
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
