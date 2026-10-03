/**
 * Zigzag Crown — the chat page's background: one closed zigzag chain of 12
 * segments that folds into a crown, modelled on a physical fidget-chain toy.
 *
 * Geometry: the 12 joints sit alternately on a top and bottom ring (30° apart
 * around the axis), so every other joint is a "peak" and the rest "valleys".
 * The ring height is solved so each joint is an exact 90° bend:
 *   with chord c = 2R·sin(15°), the two links leaving a joint meet at 90°
 *   when c²·cos(150°) + (2h)² = 0  →  2h = c·√cos(30°).
 * Seen from outside, the fold between successive links reads as the 225°
 * (i.e. 360° − 135°) outer angle.
 */

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { usePageVisible } from '@/hooks/usePageVisible'

const SEGMENTS = 12
const RADIUS = 1.4
const COLORS = ['#5aa9e6', '#ef4b3a', '#4f9a5c', '#efe6a6'] // blue, red, green, yellow — 3 links each

function crownJoints(): THREE.Vector3[] {
  const step = (2 * Math.PI) / SEGMENTS
  const chord = 2 * RADIUS * Math.sin(step / 2)
  const halfH = (chord * Math.sqrt(Math.cos(step))) / 2
  return Array.from({ length: SEGMENTS }, (_, i) => {
    const a = i * step
    return new THREE.Vector3(RADIUS * Math.cos(a), i % 2 ? -halfH : halfH, RADIUS * Math.sin(a))
  })
}

function Crown() {
  const groupRef = useRef<THREE.Group>(null)
  const links = useMemo(() => {
    const joints = crownJoints()
    return joints.map((p, i) => {
      const q = joints[(i + 1) % SEGMENTS]
      const dir = q.clone().sub(p)
      const length = dir.length()
      const mid = p.clone().add(q).multiplyScalar(0.5)
      // Lay the flat face of the link tangent to the ring (normal points outward).
      const outward = new THREE.Vector3(mid.x, 0, mid.z).normalize()
      const x = dir.clone().normalize()
      const z = outward.sub(x.clone().multiplyScalar(outward.dot(x))).normalize()
      const y = z.clone().cross(x)
      const rot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
      return { mid, rot, length, color: COLORS[Math.floor(i / 3)], joint: q }
    })
  }, [])

  useFrame((_, delta) => {
    const g = groupRef.current
    if (!g) return
    g.rotation.y += delta * 0.05
    g.rotation.x = 0.45 + Math.sin(performance.now() / 12000) * 0.05
  })

  return (
    <group ref={groupRef}>
      {links.map((l, i) => (
        <group key={i}>
          <mesh position={l.mid} quaternion={l.rot}>
            <boxGeometry args={[l.length, 0.34, 0.16]} />
            <meshStandardMaterial color={l.color} roughness={0.55} />
          </mesh>
          {/* hinge knuckle at each joint */}
          <mesh position={l.joint}>
            <sphereGeometry args={[0.13, 16, 12]} />
            <meshStandardMaterial color={links[(i + 1) % SEGMENTS].color} roughness={0.55} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Full-bleed, non-interactive backdrop. Mount inside a `relative isolate` container. */
export function ZigzagCrownBackground() {
  const visible = usePageVisible()
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 opacity-25" aria-hidden="true">
      <Canvas
        frameloop={visible ? 'always' : 'never'}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.6, 5], fov: 40 }}
        gl={{ alpha: true, antialias: true }}
      >
        <hemisphereLight args={[0xffffff, 0x444444, 1.1]} />
        <directionalLight position={[3, 5, 4]} intensity={1} />
        <Crown />
      </Canvas>
    </div>
  )
}
