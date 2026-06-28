import { BackgroundQuantizer } from '../models && skills/core/quantizer.js';
import { NeuroLangInterpreter, NeuriNeuron } from '../models && skills/core/neuro-lang.js';
import { CodeToNet } from '../models && skills/core/thorns.js';

export interface NeuronData {
  id: string;
  name: string;
  type: 'neuron' | 'codenet' | 'netsearch' | 'output';
  value: number;
  dims: number;
  definition: string;
  code: string;
  corpus: string;
  netPath: string;
  query: string;
  x: number;
  y: number;
  vale: number;
  endpoint: string;
  method: string;
  external: string[];
  trainedWeights?: Float32Array;
  trained?: boolean;
}

export interface ConnectionData {
  id: string;
  fromId: string;
  toId: string;
  weight: number;
  bias: number;
}

export interface LayerData {
  id: string;
  name: string;
  type: 'input' | 'hidden' | 'output';
  neurons: string[];
}

export interface LabelData {
  id: string;
  text: string;
  x: number;
  y: number;
}

export interface ProjectData {
  id: string;
  name: string;
  description: string;
  neurons: Map<string, NeuronData>;
  connections: Map<string, ConnectionData>;
  layers: Map<string, LayerData>;
  labels: Map<string, LabelData>;
  dims: number;
  createdAt: number;
  updatedAt: number;
}

export interface APIOutputConfig {
  endpoints: { path: string; method: string }[];
  port: number;
  host: string;
  authRequired: boolean;
}

export class ExtensionBuilder {
  private projects: Map<string, ProjectData>;
  private currentProjectId: string | null;
  private quantizer: BackgroundQuantizer;
  private neuroLang: NeuroLangInterpreter;
  private codeToNet: CodeToNet;
  private neuronCounter: number = 0;

  constructor() {
    this.projects = new Map();
    this.currentProjectId = null;
    this.quantizer = new BackgroundQuantizer({
      enabled: true,
      bits: 4,
      method: 'mixed',
      calibrationSamples: 128,
      excludeLayers: []
    });
    this.neuroLang = new NeuroLangInterpreter();
    this.codeToNet = new CodeToNet();
  }

  createProject(name: string, description: string): ProjectData {
    const id = `proj_${Date.now()}_${this.neuronCounter++}`;
    const project: ProjectData = {
      id,
      name,
      description,
      neurons: new Map(),
      connections: new Map(),
      layers: new Map(),
      labels: new Map(),
      dims: 3,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.projects.set(id, project);
    this.currentProjectId = id;
    return project;
  }

  getProject(projectId: string): ProjectData | undefined {
    return this.projects.get(projectId);
  }

  setCurrentProject(projectId: string): boolean {
    if (this.projects.has(projectId)) {
      this.currentProjectId = projectId;
      return true;
    }
    return false;
  }

  getCurrentProject(): ProjectData | undefined {
    if (!this.currentProjectId) return undefined;
    return this.projects.get(this.currentProjectId);
  }

  addNeuron(
    projectId: string,
    name: string,
    value: number,
    position?: { x: number; y: number }
  ): NeuronData | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const id = `neuron_${Date.now()}_${this.neuronCounter++}`;
    const neuron: NeuronData = {
      id,
      name,
      type: 'neuron',
      value,
      dims: project.dims,
      definition: '',
      code: '',
      corpus: '',
      netPath: '',
      query: '',
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      vale: 0.5,
      endpoint: '',
      method: 'POST',
      external: []
    };

    project.neurons.set(id, neuron);
    project.updatedAt = Date.now();
    return neuron;
  }

  addCodeNet(
    projectId: string,
    name: string,
    code: string,
    position?: { x: number; y: number }
  ): NeuronData | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const id = `codenet_${Date.now()}_${this.neuronCounter++}`;
    const neuron: NeuronData = {
      id,
      name,
      type: 'codenet',
      value: 0,
      dims: project.dims,
      definition: '',
      code,
      corpus: '',
      netPath: '',
      query: '',
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      vale: 0.5,
      endpoint: '',
      method: 'POST',
      external: []
    };

    project.neurons.set(id, neuron);
    project.updatedAt = Date.now();
    return neuron;
  }

  addNetSearch(
    projectId: string,
    name: string,
    corpus: string,
    query: string,
    netPath: string,
    position?: { x: number; y: number }
  ): NeuronData | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const id = `netsearch_${Date.now()}_${this.neuronCounter++}`;
    const neuron: NeuronData = {
      id,
      name,
      type: 'netsearch',
      value: 0,
      dims: project.dims,
      definition: '',
      code: '',
      corpus,
      netPath,
      query,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      vale: 0.5,
      endpoint: '',
      method: 'POST',
      external: []
    };

    project.neurons.set(id, neuron);
    project.updatedAt = Date.now();
    return neuron;
  }

  addOutputLayer(
    projectId: string,
    name: string,
    apiConfig: APIOutputConfig,
    position?: { x: number; y: number }
  ): NeuronData | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const id = `output_${Date.now()}_${this.neuronCounter++}`;
    const neuron: NeuronData = {
      id,
      name,
      type: 'output',
      value: 0,
      dims: project.dims,
      definition: '',
      code: '',
      corpus: '',
      netPath: '',
      query: '',
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      vale: 0.5,
      endpoint: apiConfig.endpoints[0]?.path || '/api/predict',
      method: apiConfig.endpoints[0]?.method || 'POST',
      external: []
    };

    project.neurons.set(id, neuron);
    project.updatedAt = Date.now();
    return neuron;
  }

  addLayer(projectId: string, name: string, type: 'input' | 'hidden' | 'output'): LayerData | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const id = `layer_${Date.now()}_${this.neuronCounter++}`;
    const layer: LayerData = {
      id,
      name,
      type,
      neurons: []
    };

    project.layers.set(id, layer);
    project.updatedAt = Date.now();
    return layer;
  }

  connectNeurons(projectId: string, fromId: string, toId: string, weight: number, bias: number = 0): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;

    const fromNeuron = project.neurons.get(fromId);
    const toNeuron = project.neurons.get(toId);

    if (!fromNeuron || !toNeuron) return false;

    const id = `conn_${fromId}_${toId}_${Date.now()}`;
    const connection: ConnectionData = {
      id,
      fromId,
      toId,
      weight,
      bias
    };

    project.connections.set(id, connection);
    project.updatedAt = Date.now();
    return true;
  }

  disconnectNeurons(projectId: string, connectionId: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;

    const deleted = project.connections.delete(connectionId);
    if (deleted) {
      project.updatedAt = Date.now();
    }
    return deleted;
  }

  deleteNeuron(projectId: string, neuronId: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;

    const deleted = project.neurons.delete(neuronId);
    if (deleted) {
      // Remove all connections involving this neuron
      for (const [connId, conn] of project.connections) {
        if (conn.fromId === neuronId || conn.toId === neuronId) {
          project.connections.delete(connId);
        }
      }
      // Remove from layers
      for (const [layerId, layer] of project.layers) {
        layer.neurons = layer.neurons.filter(n => n !== neuronId);
      }
      project.updatedAt = Date.now();
    }
    return deleted;
  }

  dragLabel(projectId: string, neuronId: string, label: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;

    const neuron = project.neurons.get(neuronId);
    if (!neuron) return false;

    const id = `label_${Date.now()}_${this.neuronCounter++}`;
    const labelData: LabelData = {
      id,
      text: label,
      x: neuron.x + 50,
      y: neuron.y
    };

    project.labels.set(id, labelData);
    project.updatedAt = Date.now();
    return true;
  }

  searchNeurons(projectId: string, query: string): NeuronData[] {
    const project = this.projects.get(projectId);
    if (!project) return [];

    const lowerQuery = query.toLowerCase();
    const results: NeuronData[] = [];

    for (const neuron of project.neurons.values()) {
      if (
        neuron.name.toLowerCase().includes(lowerQuery) ||
        neuron.definition.toLowerCase().includes(lowerQuery) ||
        neuron.type.toLowerCase().includes(lowerQuery)
      ) {
        results.push(neuron);
      }
    }

    return results;
  }

  typeModelOutput(projectId: string, neuronId: string, inputValue: number): string {
    const project = this.projects.get(projectId);
    if (!project) return '';

    const neuron = project.neurons.get(neuronId);
    if (!neuron) return '';

    // Simulate neuron activation
    const activated = 1 / (1 + Math.exp(-inputValue + neuron.value));
    neuron.value = activated;
    project.updatedAt = Date.now();

    return `Neuron "${neuron.name}" activated with value ${activated.toFixed(4)}`;
  }

  trainNetSearch(projectId: string, epochs: number): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;

    // Find all netsearch neurons and train them
    let trained = false;
    for (const neuron of project.neurons.values()) {
      if (neuron.type === 'netsearch' && neuron.corpus) {
        // Simulate training by updating the net path
        neuron.netPath = `${neuron.name}_trained_${Date.now()}`;
        trained = true;
      }
    }

    if (trained) {
      project.updatedAt = Date.now();
    }
    return trained;
  }

  netSearch(projectId: string, query: string): { results: string[]; confidence: number }[] {
    const project = this.projects.get(projectId);
    if (!project) return [];

    const results: { results: string[]; confidence: number }[] = [];

    for (const neuron of project.neurons.values()) {
      if (neuron.type === 'netsearch' && neuron.corpus) {
        const corpusLines = neuron.corpus.split('\n');
        const matches = corpusLines.filter(line => 
          line.toLowerCase().includes(query.toLowerCase())
        );
        
        if (matches.length > 0) {
          results.push({
            results: matches.slice(0, 5),
            confidence: Math.min(1, matches.length / corpusLines.length * 2)
          });
        }
      }
    }

    return results;
  }

  importCodeToNet(projectId: string, name: string, binaryCode: Uint8Array): NeuronData | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const topology = this.codeToNet.convert(binaryCode);
    
    const id = `codenet_${Date.now()}_${this.neuronCounter++}`;
    const neuron: NeuronData = {
      id,
      name,
      type: 'codenet',
      value: topology.neurons.length,
      dims: project.dims,
      definition: `CodeNet with ${topology.neurons.length} neurons, ${topology.inputCount} inputs, ${topology.outputCount} outputs`,
      code: `binary_code_${binaryCode.length}_bytes`,
      corpus: '',
      netPath: '',
      query: '',
      x: 0,
      y: 0,
      vale: 0.5,
      endpoint: '',
      method: 'POST',
      external: []
    };

    project.neurons.set(id, neuron);
    project.updatedAt = Date.now();
    return neuron;
  }

  saveWithoutQuantization(projectId: string): string | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const data = {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        dims: project.dims,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      },
      neurons: Array.from(project.neurons.entries()).map(([id, n]) => ({ id, ...n })),
      connections: Array.from(project.connections.entries()).map(([id, c]) => ({ id, ...c })),
      layers: Array.from(project.layers.entries()).map(([id, l]) => ({ id, ...l })),
      labels: Array.from(project.labels.entries()).map(([id, l]) => ({ id, ...l }))
    };

    return JSON.stringify(data, null, 2);
  }

  async installWithQuantization(projectId: string, options: { bits: number }): Promise<string | null> {
    const project = this.projects.get(projectId);
    if (!project) return null;

    // Update quantizer config
    this.quantizer = new BackgroundQuantizer({
      enabled: true,
      bits: options.bits,
      method: 'mixed',
      calibrationSamples: 128,
      excludeLayers: []
    });

    // Collect all weights from connections
    const weights: Record<string, Float32Array> = {};
    for (const [connId, conn] of project.connections) {
      weights[connId] = new Float32Array([conn.weight, conn.bias]);
    }

    // Quantize
    const quantizedWeights = this.quantizer.quantizeModel(weights);

    // Build quantized data
    const data = {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        dims: project.dims,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      },
      quantized: true,
      bits: options.bits,
      neurons: Array.from(project.neurons.entries()).map(([id, n]) => ({ id, ...n })),
      connections: Array.from(project.connections.entries()).map(([id, c]) => ({
        id,
        fromId: c.fromId,
        toId: c.toId,
        weight: quantizedWeights[id]?.[0] ?? c.weight,
        bias: quantizedWeights[id]?.[1] ?? c.bias
      })),
      layers: Array.from(project.layers.entries()).map(([id, l]) => ({ id, ...l })),
      labels: Array.from(project.labels.entries()).map(([id, l]) => ({ id, ...l }))
    };

    return JSON.stringify(data, null, 2);
  }

  addAPIOutputLayer(projectId: string, config: APIOutputConfig): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;

    const outputNeuron = this.addOutputLayer(projectId, 'API_Output', config);
    if (!outputNeuron) return false;

    // Connect all neurons to output
    for (const [neuronId, neuron] of project.neurons) {
      if (neuron.type !== 'output') {
        this.connectNeurons(projectId, neuronId, outputNeuron.id, 0.5, 0);
      }
    }

    return true;
  }

  parseNeuroLang(projectId: string, source: string): { success: boolean; errors: string[] } {
    const project = this.projects.get(projectId);
    if (!project) return { success: false, errors: ['Project not found'] };

    const result = this.neuroLang.parse(source);
    
    if (result.errors.length > 0) {
      return { success: false, errors: result.errors };
    }

    // Add parsed neurons to project
    const evaluated = this.neuroLang.evaluate(result);
    
    for (const [name, neuronData] of evaluated) {
      const neuron = this.addNeuron(projectId, name, neuronData.value);
      if (neuron) {
        neuron.definition = neuronData.definition;
        neuron.code = neuronData.code || '';
        
        // Add connections
        for (const [target, weight] of neuronData.connections) {
          // Find target neuron by name
          const targetNeuron = Array.from(project.neurons.values()).find(n => n.name === target);
          if (targetNeuron) {
            this.connectNeurons(projectId, neuron.id, targetNeuron.id, weight, 0);
          }
        }
      }
    }

    project.updatedAt = Date.now();
    return { success: true, errors: [] };
  }

  exportToNeuroLang(projectId: string): string {
    const project = this.projects.get(projectId);
    if (!project) return '';

    const lines: string[] = [];
    lines.push(`# NeuroLang export for ${project.name}`);
    lines.push(`dims = ${project.dims}`);
    lines.push('');

    // Export neurons
    for (const neuron of project.neurons.values()) {
      if (neuron.type === 'neuron') {
        lines.push(`name="${neuron.name}"`);
        lines.push(`"${neuron.name}"@value="${neuron.value}"`);
        if (neuron.definition) {
          lines.push(`"${neuron.name}"@definition="${neuron.definition}"`);
        }
      } else if (neuron.type === 'codenet') {
        lines.push(`code@name="${neuron.name}"`);
        if (neuron.code) {
          lines.push(`"${neuron.name}"@code="${neuron.code}"`);
        }
      } else if (neuron.type === 'netsearch') {
        lines.push(`"netsearch"@name="${neuron.name}"`);
        if (neuron.corpus) {
          lines.push(`"netsearch"@corpus="${neuron.corpus}"`);
        }
        if (neuron.query) {
          lines.push(`"netsearch"@query="${neuron.query}"`);
        }
        if (neuron.netPath) {
          lines.push(`"netsearch"@net="${neuron.netPath}"`);
        }
      }
      lines.push('');
    }

    // Export connections
    for (const conn of project.connections.values()) {
      const fromNeuron = project.neurons.get(conn.fromId);
      const toNeuron = project.neurons.get(conn.toId);
      if (fromNeuron && toNeuron) {
        lines.push(`"${toNeuron.name}"@connections=".${fromNeuron.name}/state"*${conn.weight}+${conn.bias}`);
      }
    }

    return lines.join('\n');
  }

  listProjects(): ProjectData[] {
    return Array.from(this.projects.values());
  }

  deleteProject(projectId: string): boolean {
    if (this.currentProjectId === projectId) {
      this.currentProjectId = null;
    }
    return this.projects.delete(projectId);
  }

  getStats(projectId: string): {
    neuronCount: number;
    connectionCount: number;
    layerCount: number;
    labelCount: number;
  } | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    return {
      neuronCount: project.neurons.size,
      connectionCount: project.connections.size,
      layerCount: project.layers.size,
      labelCount: project.labels.size
    };
  }
}
