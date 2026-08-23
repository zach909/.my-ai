/**
 * Twisted Strip Logo — the desktop's branding mark, shown in the background
 * layer when the desktop opens.
 *
 * Ported from twisted_metal_strip_3pt_profile.html (a standalone Three.js
 * prototype living at the repo root) into a proper React Three Fiber
 * component instead of the original inline CDN <script src="three.min.js">
 * page, so it renders as part of the actual app bundle -- no external
 * script load, no separate HTML file to open. The geometry itself now lives
 * in twisted-strip-geometry.ts, shared with TwistedStripSpinner so the mark
 * and the loading indicator are the same object rather than two drawings that
 * drift apart.
 */

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { buildTwistedStripGeometry, STRIP_MATERIAL } from './twisted-strip-geometry'

function StripMesh() {
  const groupRef = useRef<THREE.Group>(null)
  const geometry = useMemo(() => buildTwistedStripGeometry(), [])

  useFrame((_, delta) => {
    // Auto-rotate, matching the original prototype's idle spin -- OrbitControls
    // below takes over (and this stops) the moment the user drags.
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.24
  })

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry}>
        <meshStandardMaterial {...STRIP_MATERIAL} side={THREE.DoubleSide} />
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
