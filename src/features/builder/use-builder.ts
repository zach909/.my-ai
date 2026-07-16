/**
 * Extension Builder — React binding for the real ExtensionBuilder engine.
 *
 * The engine (extension-builder/builder.js) is plain ESM with no Node
 * dependencies, so the visual editor runs it directly in the browser: the
 * same code the backend smoke suite exercises, not a mock. The hook keeps a
 * single engine instance and a version counter; every mutating call bumps
 * the counter so React re-reads the (mutable) project maps.
 */

import { useMemo, useRef, useState, useCallback } from 'react';
import { ExtensionBuilder } from '../../../extension-builder/builder.js';
import type {
  NeuronData,
  ConnectionData,
  LabelData,
  APIOutputConfig,
} from '../../../extension-builder/builder.js';

export type { NeuronData, ConnectionData, LabelData };

export interface BuilderApi {
  /** The live engine, for anything not wrapped below. */
  engine: ExtensionBuilder;
  projectId: string;
  projectName: string;
  neurons: NeuronData[];
  connections: ConnectionData[];
  labels: LabelData[];
  stats: { neuronCount: number; connectionCount: number; layerCount: number; labelCount: number };
  addNeuron: (name: string, value: number, position?: { x: number; y: number }) => NeuronData | null;
  deleteNeuron: (neuronId: string) => void;
  moveNeuron: (neuronId: string, x: number, y: number) => void;
  connect: (fromId: string, toId: string, weight?: number, bias?: number) => boolean;
  disconnect: (connectionId: string) => void;
  dragLabel: (neuronId: string, label: string) => boolean;
  search: (query: string) => NeuronData[];
  simulate: (neuronId: string, inputValue: number) => string;
  addApiOutputLayer: (config: APIOutputConfig) => boolean;
  parseNeuroLang: (source: string) => { success: boolean; errors: string[] };
  exportNeuroLang: () => string;
  save: () => string | null;
  install: (bits: number) => Promise<string | null>;
}

export function useBuilder(initialName = 'My Extension'): BuilderApi {
  const engineRef = useRef<ExtensionBuilder | null>(null);
  const projectIdRef = useRef<string>('');
  if (!engineRef.current) {
    engineRef.current = new ExtensionBuilder();
    projectIdRef.current = engineRef.current.createProject(initialName, 'Built in the visual editor').id;
  }
  const engine = engineRef.current;
  const projectId = projectIdRef.current;

  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const project = engine.getProject(projectId)!;

  // Recomputed whenever `version` changes — the maps are mutable engine state.
  const { neurons, connections, labels, stats } = useMemo(() => {
    void version;
    return {
      neurons: Array.from(project.neurons.values()),
      connections: Array.from(project.connections.values()),
      labels: Array.from(project.labels.values()),
      stats: engine.getStats(projectId) ?? {
        neuronCount: 0, connectionCount: 0, layerCount: 0, labelCount: 0,
      },
    };
  }, [engine, project, projectId, version]);

  return {
    engine,
    projectId,
    projectName: project.name,
    neurons,
    connections,
    labels,
    stats,
    addNeuron: (name, value, position) => {
      const n = engine.addNeuron(projectId, name, value, position);
      bump();
      return n;
    },
    deleteNeuron: (neuronId) => {
      engine.deleteNeuron(projectId, neuronId);
      bump();
    },
    moveNeuron: (neuronId, x, y) => {
      engine.moveNeuron(projectId, neuronId, x, y);
      bump();
    },
    connect: (fromId, toId, weight = 0.5, bias = 0) => {
      const ok = engine.connectNeurons(projectId, fromId, toId, weight, bias);
      bump();
      return ok;
    },
    disconnect: (connectionId) => {
      engine.disconnectNeurons(projectId, connectionId);
      bump();
    },
    dragLabel: (neuronId, label) => {
      const ok = engine.dragLabel(projectId, neuronId, label);
      bump();
      return ok;
    },
    search: (query) => engine.searchNeurons(projectId, query),
    simulate: (neuronId, inputValue) => engine.typeModelOutput(projectId, neuronId, inputValue),
    addApiOutputLayer: (config) => {
      const ok = engine.addAPIOutputLayer(projectId, config);
      bump();
      return ok;
    },
    parseNeuroLang: (source) => {
      const res = engine.parseNeuroLang(projectId, source);
      bump();
      return res;
    },
    exportNeuroLang: () => engine.exportToNeuroLang(projectId),
    save: () => engine.saveWithoutQuantization(projectId),
    install: async (bits) => {
      const out = await engine.installWithQuantization(projectId, { bits });
      bump();
      return out;
    },
  };
}
