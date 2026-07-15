/**
 * Prometheus Elastic Core — useElasticMesh hook
 *
 * Manages the ElasticMesh instance lifecycle: creation, propagation loop,
 * stats polling, input injection, and learning. Uses requestAnimationFrame
 * for smooth, continuous propagation at the configured ticks-per-frame rate.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { ElasticMesh } from '@/features/mesh/mesh-engine';
import type { MeshState, MeshStats, Neuron, MeshConfig } from '@/features/mesh/types';
import { DEFAULT_CONFIG } from '@/features/mesh/types';

interface UseElasticMeshReturn {
  meshState: MeshState | null;
  stats: MeshStats | null;
  isRunning: boolean;
  speed: number;
  selectedNeuron: Neuron | null;
  selectNeuron: (neuron: Neuron | null) => void;
  toggleRunning: () => void;
  reset: () => void;
  step: () => void;
  setSpeed: (speed: number) => void;
  injectInput: (input: number[], strength: number) => void;
  learnHebbian: () => void;
}

export function useElasticMesh(config: Partial<MeshConfig> = {}): UseElasticMeshReturn {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  const meshRef = useRef<ElasticMesh>(new ElasticMesh(finalConfig));
  const [meshState, setMeshState] = useState<MeshState | null>(null);
  const [stats, setStats] = useState<MeshStats | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [selectedNeuron, setSelectedNeuron] = useState<Neuron | null>(null);
  const runningRef = useRef(false);
  const speedRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const statsFrameCount = useRef(0);

  // Keep speed in a ref so the animation loop always reads the latest value
  speedRef.current = speed;

  // Initial state capture
  useEffect(() => {
    setMeshState(meshRef.current.getState());
    setStats(meshRef.current.getStats());
  }, []);

  /**
   * Animation loop: runs propagation ticks, updates state on every frame
   * and stats every ~4 frames.
   */
  const loop = useCallback(() => {
    if (!runningRef.current) return;

    const mesh = meshRef.current;
    const ticksPerCall = speedRef.current * finalConfig.ticksPerFrame;

    for (let i = 0; i < ticksPerCall; i++) {
      if (!mesh.propagateOne()) break;
    }

    setMeshState(mesh.getState());

    // Update stats every 4 frames for readability
    statsFrameCount.current++;
    if (statsFrameCount.current >= 4) {
      statsFrameCount.current = 0;
      setStats(mesh.getStats());
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [finalConfig.ticksPerFrame]);

  const startLoop = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    meshRef.current.isSettled = false;
    meshRef.current.settledTicks = 0;
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const stopLoop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const toggleRunning = useCallback(() => {
    if (runningRef.current) {
      stopLoop();
      setIsRunning(false);
    } else {
      startLoop();
      setIsRunning(true);
    }
  }, [startLoop, stopLoop]);

  const reset = useCallback(() => {
    stopLoop();
    meshRef.current.reset();
    setMeshState(meshRef.current.getState());
    setStats(meshRef.current.getStats());
    setIsRunning(false);
    setSelectedNeuron(null);
  }, [stopLoop]);

  const step = useCallback(() => {
    if (runningRef.current) return;
    meshRef.current.isSettled = false;
    meshRef.current.settledTicks = 0;
    meshRef.current.propagateOne();
    setMeshState(meshRef.current.getState());
    setStats(meshRef.current.getStats());
  }, []);

  const setSpeed = useCallback((s: number) => {
    setSpeedState(s);
  }, []);

  const injectInput = useCallback((input: number[], strength: number) => {
    meshRef.current.isSettled = false;
    meshRef.current.settledTicks = 0;
    meshRef.current.injectInput(input, strength);
    setMeshState(meshRef.current.getState());
    setStats(meshRef.current.getStats());

    // Auto-start when input is injected
    if (!runningRef.current) {
      startLoop();
      setIsRunning(true);
    }
  }, [startLoop]);

  const learnHebbian = useCallback(() => {
    meshRef.current.learnHebbian(0.01);
    setMeshState(meshRef.current.getState());
    setStats(meshRef.current.getStats());
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        runningRef.current = false;
      }
    };
  }, []);

  const selectNeuron = useCallback((neuron: Neuron | null) => {
    setSelectedNeuron(neuron);
  }, []);

  return {
    meshState,
    stats,
    isRunning,
    speed,
    selectedNeuron,
    selectNeuron,
    toggleRunning,
    reset,
    step,
    setSpeed,
    injectInput,
    learnHebbian,
  };
}
