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
  TrainingResult,
} from '../../../extension-builder/builder.js';

export type { NeuronData, ConnectionData, LabelData, TrainingResult };

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
  connect: (fromId: string, toId: string, weight?: number, bias?: number, locked?: boolean) => boolean;
  disconnect: (connectionId: string) => void;
  /** Toggle a connection between "permanent" (locked) and "starting place" (unlocked). */
  setConnectionLocked: (connectionId: string, locked: boolean) => boolean;
  dragLabel: (neuronId: string, label: string) => boolean;
  /** "Scripting": attach a (user says X -> should respond Y) training example to a neuron. */
  addScript: (neuronId: string, userSays: string, response: string) => boolean;
  removeScript: (neuronId: string, index: number) => boolean;
  /** The real training sequence -- connections, then @definishon + every script, trained together until convergence. */
  train: (epochs?: number) => TrainingResult | null;
  /**
   * ALTERNATIVE training backend: real torch.autograd/torch.optim gradient
   * descent, run server-side (POST /api/extension/train-pytorch) since
   * builder.js runs in the browser and can't spawn the Python subprocess
   * itself. Strictly optional -- if the server's Python/torch environment
   * isn't available, resolves to `{ ok: false, error }` instead of the
   * usual TrainingResult; the regular `train()` above always still works
   * with zero Python/torch present anywhere.
   */
  trainWithPyTorch: (epochs?: number) => Promise<(TrainingResult & { ok: true; backend: 'pytorch'; torchVersion?: string }) | { ok: false; error: string }>;
  lastTraining: TrainingResult | undefined;
  search: (query: string) => NeuronData[];
  simulate: (neuronId: string, inputValue: number) => string;
  addApiOutputLayer: (config: APIOutputConfig) => boolean;
  parseNeuroLang: (source: string) => Promise<{ success: boolean; errors: string[] }>;
  exportNeuroLang: () => string;
  save: () => string | null;
  install: (bits: number) => Promise<string | null>;
  /** Create a netsearch-type neuron holding a text corpus, searchable via netSearch()/netSearchGenerate(). */
  addNetSearchNeuron: (name: string, corpus: string, position?: { x: number; y: number }) => NeuronData | null;
  /** Substring search over every netsearch neuron's corpus (spec: "search neural content"). */
  netSearch: (query: string) => Array<{ results: string[]; confidence: number }>;
  /** Generate a new neuron wired to the best semantic matches for `query` across all neurons (spec: "train equivalent neural networks"). */
  netSearchGenerate: (query: string, topK?: number) => { neuron: NeuronData; matches: Array<{ id: string; name: string; score: number }> } | null;
  /** "Train" every netsearch neuron's corpus association. */
  trainNetSearch: (epochs: number) => boolean;
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
  const lastTraining = useMemo(() => { void version; return project.lastTraining; }, [project, version]);

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
    connect: (fromId, toId, weight = 0.5, bias = 0, locked = false) => {
      const ok = engine.connectNeurons(projectId, fromId, toId, weight, bias, locked);
      bump();
      return ok;
    },
    disconnect: (connectionId) => {
      engine.disconnectNeurons(projectId, connectionId);
      bump();
    },
    setConnectionLocked: (connectionId, locked) => {
      const ok = engine.setConnectionLocked(projectId, connectionId, locked);
      bump();
      return ok;
    },
    dragLabel: (neuronId, label) => {
      const ok = engine.dragLabel(projectId, neuronId, label);
      bump();
      return ok;
    },
    addScript: (neuronId, userSays, response) => {
      const ok = engine.addScript(projectId, neuronId, userSays, response);
      bump();
      return ok;
    },
    removeScript: (neuronId, index) => {
      const ok = engine.removeScript(projectId, neuronId, index);
      bump();
      return ok;
    },
    train: (epochs) => {
      const result = engine.train(projectId, epochs ? { epochs } : undefined);
      bump();
      return result;
    },
    trainWithPyTorch: async (epochs) => {
      const neuronsPayload = Array.from(project.neurons.values()).map((n) => ({
        name: n.name,
        definition: n.definition,
        scripts: n.scripts,
      }));
      try {
        const res = await fetch('/api/extension/train-pytorch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ neurons: neuronsPayload, epochs }),
        });
        const json = await res.json();
        if (json.ok) {
          const result: TrainingResult = {
            converged: json.converged,
            definitionsConverged: json.converged,
            scriptsConverged: json.converged,
            epochs: json.epochs,
            satisfied: json.satisfied,
            conflicts: json.conflicts,
            trainedNeurons: json.trainedNeurons,
          };
          project.lastTraining = result;
          bump();
          return { ...result, ok: true, backend: 'pytorch', torchVersion: json.torchVersion };
        }
        return { ok: false, error: json.error ?? 'PyTorch training failed for an unknown reason' };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    lastTraining,
    search: (query) => engine.searchNeurons(projectId, query),
    simulate: (neuronId, inputValue) => engine.typeModelOutput(projectId, neuronId, inputValue),
    addApiOutputLayer: (config) => {
      const ok = engine.addAPIOutputLayer(projectId, config);
      bump();
      return ok;
    },
    parseNeuroLang: async (source) => {
      const res = await engine.parseNeuroLang(projectId, source);
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
    addNetSearchNeuron: (name, corpus, position) => {
      const n = engine.addNetSearch(projectId, name, corpus, '', '', position);
      bump();
      return n;
    },
    netSearch: (query) => engine.netSearch(projectId, query),
    netSearchGenerate: (query, topK = 3) => {
      const out = engine.netSearchGenerate(projectId, query, topK);
      bump();
      return out;
    },
    trainNetSearch: (epochs) => {
      const ok = engine.trainNetSearch(projectId, epochs);
      bump();
      return ok;
    },
  };
}
