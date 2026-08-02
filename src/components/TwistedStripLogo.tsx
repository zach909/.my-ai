/**
 * Twisted Strip Logo — the desktop's branding mark, shown in the background
 * layer when the desktop opens.
 *
 * Ported from twisted_metal_strip_3pt_profile.html (a standalone Three.js
 * prototype living at the repo root) into a proper React Three Fiber
 * component instead of the original inline CDN <script src="three.min.js">
 * page, so it renders as part of the actual app bundle -- no external
 * script load, no separate HTML file to open. The geometry math (a 5-lobed
 * Catmull-Rom curve extruded into a twisted 3-point ribbon profile) is
 * unchanged from the original.
 */

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

const LOBES = 5
const A = 1.05
const B = 0.85
const H = 0.62
const STRIP_WIDTH = 0.32
const STRIP_DEPTH = 0.045
const SEGMENTS = 300
const RING_COUNT = 3

function twist(t: number): number {
  return Math.PI * 1.1 * t + Math.sin(t * Math.PI * 2 * LOBES) * 0.18
}

/** The strip's 5-lobed guide curve control points. */
function lobePoints(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < LOBES; i++) {
    const ang = i * ((2 * Math.PI) / LOBES)
    pts.push(new THREE.Vector3(A * Math.cos(ang), H * Math.sin(2 * ang), B * Math.sin(ang)))
  }
  return pts
}

/** Extrude a 3-point (left / center / right) twisted ribbon profile along a closed curve. */
function buildStripGeometry(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(lobePoints(), true, 'catmullrom', 0.4)
  const samples = curve.getSpacedPoints(SEGMENTS)
  const frames = curve.computeFrenetFrames(SEGMENTS, true)

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  for (let i = 0; i <= SEGMENTS; i++) {
    const p = samples[i]
    const normal = frames.normals[i]
    const binormal = frames.binormals[i]
    const tangent = frames.tangents[i]
    const t = i / SEGMENTS
    const tw = twist(t)

    const localUp = new THREE.Vector3()
      .copy(normal)
      .multiplyScalar(Math.cos(tw))
      .add(binormal.clone().multiplyScalar(Math.sin(tw)))
      .normalize()
    const faceNormal = new THREE.Vector3().crossVectors(localUp, tangent).normalize()

    const left = p.clone().addScaledVector(localUp, -STRIP_WIDTH / 2)
    const center = p.clone().addScaledVector(faceNormal, -STRIP_DEPTH)
    const right = p.clone().addScaledVector(localUp, STRIP_WIDTH / 2)
    positions.push(left.x, left.y, left.z, center.x, center.y, center.z, right.x, right.y, right.z)

    const nLeft = faceNormal.clone().applyAxisAngle(tangent, 0.5).normalize()
    const nRight = faceNormal.clone().applyAxisAngle(tangent, -0.5).normalize()
    normals.push(nLeft.x, nLeft.y, nLeft.z, faceNormal.x, faceNormal.y, faceNormal.z, nRight.x, nRight.y, nRight.z)
    uvs.push(t, 0, t, 0.5, t, 1)
  }

  const indices: number[] = []
  for (let i = 0; i < SEGMENTS; i++) {
    for (let k = 0; k < RING_COUNT - 1; k++) {
      const a0 = i * RING_COUNT + k
      const b0 = i * RING_COUNT + k + 1
      const a1 = (i + 1) * RING_COUNT + k
      const b1 = (i + 1) * RING_COUNT + k + 1
      indices.push(a0, a1, b0, a1, b1, b0)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

function StripMesh() {
  const groupRef = useRef<THREE.Group>(null)
  const geometry = useMemo(() => buildStripGeometry(), [])

  useFrame((_, delta) => {
    // Auto-rotate, matching the original prototype's idle spin -- OrbitControls
    // below takes over (and this stops) the moment the user drags.
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.24
  })

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#b9b6ad" metalness={0.75} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.75}>
        <circleGeometry args={[2.2, 48]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.06} />
      </mesh>
    </group>
  )
}

/**
 * Renders the twisted-strip mark. `size` controls the canvas footprint in
 * pixels (it's meant as a corner/watermark element, not a full-viewport
 * scene) -- see Desktop.tsx's background layer for where it's mounted.
 */
export function TwistedStripLogo({ size = 220 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size }} aria-hidden="true">
      <Canvas camera={{ position: [0, 1.25, 4], fov: 40 }} gl={{ alpha: true, antialias: true }}>
        <hemisphereLight args={[0xffffff, 0x555555, 1.1]} />
        <directionalLight position={[3, 5, 4]} intensity={0.9} />
        <directionalLight position={[-3, -2, -4]} intensity={0.4} />
        <StripMesh />
        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={2}
          maxDistance={7}
          target={[0, 0.1, 0]}
        />
      </Canvas>
    </div>
  )
}
