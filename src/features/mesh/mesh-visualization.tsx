/**
 * Corona — 3D Mesh Visualization
 *
 * Renders the all-to-all neural mesh in 3D using React Three Fiber.
 * Neurons are spheres color-mapped by vale and activation.
 * Connections are semi-transparent lines — all-to-all but only
 * visible when the source neuron has significant activation.
 * Provides camera orbit controls for inspection.
 */

import { useRef, useMemo } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { MeshState, Neuron } from '@/features/mesh/types';

// ─── Layout: arrange neurons on a 3D sphere ────────────────────────────────

/** Fibonacci sphere — evenly distributes N points on a sphere surface. */
// eslint-disable-next-line react-refresh/only-export-components -- math utility function, not a component; tested in unit tests and used in MeshVisualization component
export function fibonacciSphere(n: number, radius: number): THREE.Vector3[] {
  if (n <= 1) {
    // i / (n - 1) below divides by zero once n === 1 (0/0 = NaN), which
    // propagates into every coordinate -- reached whenever the mesh has
    // exactly one neuron, or zero (MeshScene's `Math.max(neuronCount, 1)`
    // still calls this every render, even before meshState loads).
    return n === 1 ? [new THREE.Vector3(0, radius, 0)] : [];
  }
  const points: THREE.Vector3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = phi * i;

    points.push(
      new THREE.Vector3(
        Math.cos(theta) * radiusAtY * radius,
        y * radius,
        Math.sin(theta) * radiusAtY * radius,
      ),
    );
  }
  return points;
}

// ─── Neuron Sphere ──────────────────────────────────────────────────────────

interface NeuronSphereProps {
  position: THREE.Vector3;
  neuron: Neuron;
  isSelected: boolean;
  onClick: (neuron: Neuron) => void;
}

function NeuronSphere({ position, neuron, isSelected, onClick }: NeuronSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const activation = Math.sqrt(neuron.state.reduce((s, v) => s + v * v, 0));

  // Color: activation maps to hue (cyan → magenta), vale maps to brightness
  const color = useMemo(() => {
    const hue = 0.55 + activation * 0.35; // cyan (0.55) → magenta (0.9)
    const lightness = 0.3 + (neuron.vale / 100) * 0.4;
    return new THREE.Color().setHSL(hue % 1, 0.8, Math.min(lightness, 0.7));
  }, [activation, neuron.vale]);

  const radius = 0.08 + activation * 0.12 + (neuron.vale / 200) * 0.06;

  useFrame(() => {
    if (meshRef.current && activation > 0.01) {
      meshRef.current.scale.setScalar(1 + Math.sin(Date.now() * 0.003 + neuron.id.charCodeAt(1)) * 0.05 * activation);
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick(neuron);
  };

  return (
    <group position={position}>
      <mesh ref={meshRef} onClick={handleClick} scale={1}>
        <sphereGeometry args={[radius, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.3 + activation * 0.5}
          roughness={0.4}
          metalness={0.2}
        />
      </mesh>
      {/* Selection ring */}
      {isSelected && (
        <mesh>
          <ringGeometry args={[radius + 0.03, radius + 0.05, 32]} />
          <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* Label */}
      {neuron.label && (
        <Text
          position={[0, radius + 0.12, 0]}
          fontSize={0.06}
          color="white"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.005}
          outlineColor="black"
        >
          {neuron.label.slice(0, 8)}
        </Text>
      )}
    </group>
  );
}

// ─── Connection Lines ───────────────────────────────────────────────────────

interface MeshConnectionsProps {
  neuronPositions: THREE.Vector3[];
  meshState: MeshState;
  dims: number;
}

function MeshConnections({ neuronPositions, meshState }: MeshConnectionsProps) {
  const lines: THREE.Vector3[][] = [];

  for (let i = 0; i < meshState.neurons.length; i++) {
    for (let j = i + 1; j < meshState.neurons.length; j++) {
      const srcAct = Math.sqrt(
        meshState.neurons[i].state.reduce((s, v) => s + v * v, 0),
      );
      const tgtAct = Math.sqrt(
        meshState.neurons[j].state.reduce((s, v) => s + v * v, 0),
      );

      const minAct = Math.min(srcAct, tgtAct);
      // Only show connections when both neurons are active enough
      if (minAct > 0.05) {
        lines.push([neuronPositions[i], neuronPositions[j]]);
      }
    }
  }

  return (
    <group>
      {lines.map(([a, b], idx) => {
        // Connection opacity based on co-activation strength
        const len = a.distanceTo(b);
        const opacity = Math.min(1, len > 2 ? 0.5 : 0.8);

        return (
          <line key={idx}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]), 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial
              color="#ffffff"
              transparent
              opacity={opacity * 0.15}
              depthWrite={false}
            />
          </line>
        );
      })}
    </group>
  );
}

// ─── Background Particles ──────────────────────────────────────────────────

function BackgroundParticles() {
  const count = 200;
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    return pos;
  }, []);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.015}
        color="#4a6fa5"
        transparent
        opacity={0.4}
        depthWrite={false}
      />
    </points>
  );
}

// ─── Main Scene ─────────────────────────────────────────────────────────────

interface MeshSceneProps {
  meshState: MeshState | null;
  selectedNeuron: Neuron | null;
  onSelectNeuron: (neuron: Neuron | null) => void;
  dims: number;
}

function MeshScene({ meshState, selectedNeuron, onSelectNeuron, dims }: MeshSceneProps) {
  const groupRef = useRef<THREE.Group>(null!);

  const neuronCount = meshState?.neurons.length ?? 0;
  const positions = useMemo(
    () => fibonacciSphere(Math.max(neuronCount, 1), 2.5),
    [neuronCount],
  );

  // Gentle rotation of the entire mesh
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.08;
      groupRef.current.rotation.x += delta * 0.03;
    }
  });

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 5, 5]} intensity={1} color="#a0c4ff" />
      <pointLight position={[-5, -3, -5]} intensity={0.5} color="#ff7eb3" />

      <BackgroundParticles />

      <group ref={groupRef}>
        {meshState && (
          <MeshConnections
            neuronPositions={positions}
            meshState={meshState}
            dims={dims}
          />
        )}
        {meshState?.neurons.map((neuron, i) => (
          <NeuronSphere
            key={neuron.id}
            position={positions[i]}
            neuron={neuron}
            isSelected={selectedNeuron?.id === neuron.id}
            onClick={onSelectNeuron}
          />
        ))}
      </group>

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={3}
        maxDistance={8}
        rotateSpeed={0.5}
      />
    </>
  );
}

// ─── Exported Component ─────────────────────────────────────────────────────

interface MeshVisualizationProps {
  meshState: MeshState | null;
  selectedNeuron: Neuron | null;
  onSelectNeuron: (neuron: Neuron | null) => void;
  dims: number;
}

export function MeshVisualization({
  meshState,
  selectedNeuron,
  onSelectNeuron,
  dims,
}: MeshVisualizationProps) {
  return (
    <div className="w-full h-full min-h-[400px] rounded-lg overflow-hidden bg-background border border-border">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
        style={{ background: 'radial-gradient(ellipse at center, var(--color-background) 0%, transparent 100%)' }}
      >
        <MeshScene
          meshState={meshState}
          selectedNeuron={selectedNeuron}
          onSelectNeuron={onSelectNeuron}
          dims={dims}
        />
      </Canvas>
    </div>
  );
}
