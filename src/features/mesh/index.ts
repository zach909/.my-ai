/**
 * Prometheus Elastic Core — Mesh Feature
 *
 * Barrel export for the core neural mesh engine.
 */
export { ElasticMesh } from './mesh-engine';
export type {
  Neuron,
  ConnectionWeights,
  MeshState,
  MeshConfig,
  MeshStats,
  ThoughtCandidate,
} from './types';
export { DEFAULT_CONFIG } from './types';
export { useElasticMesh } from './use-elastic-mesh';
export { MeshVisualization } from './mesh-visualization';
export { ControlPanel } from './control-panel';
