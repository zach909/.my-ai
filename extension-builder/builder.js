import { BackgroundQuantizer } from '../models && skills/core/quantizer.js';
import { NeuroLangInterpreter } from '../models && skills/core/neuro-lang.js';
import { CodeToNet } from '../models && skills/core/thorns.js';
import { NetSearchEngine } from '../models && skills/core/net-search.js';

/**
 * Cooperative yield: hands control back to the event loop. Defined locally
 * (mirroring, not importing, neuro-lang.ts's own helper) because this file
 * is imported directly by src/features/builder/use-builder.ts and run in
 * the browser with no build step -- the source-tree sibling
 * models && skills/core/neuro-lang.js it would otherwise import from is a
 * stale, out-of-date hand-copy (the real neuro-lang.js only exists freshly
 * compiled in dist/) that predates yieldToEventLoop entirely and doesn't
 * export it, so importing it here would break at import time in exactly
 * the browser context this needs to support. setImmediate is Node-only
 * (undefined in every major browser), so a bare `setImmediate(resolve)`
 * threw ReferenceError the first time a large enough parse crossed a
 * yield threshold client-side.
 */
function yieldToEventLoop() {
    return new Promise(resolve => {
        if (typeof setImmediate === 'function') setImmediate(resolve);
        else setTimeout(resolve, 0);
    });
}
export class ExtensionBuilder {
    projects;
    currentProjectId;
    quantizer;
    neuroLang;
    codeToNet;
    neuronCounter = 0;
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
        // Real, trainable net search (models && skills/core/net-search.ts):
        // an input layer (tokenized query) into learned query->structure
        // associations plus hashed embeddings -- soft/bendable, not a hard
        // string match. Indexed over neuron *definitions* (before they get
        // compiled), matching the spec.
        this.netSearchEngine = new NetSearchEngine();
    }
    createProject(name, description) {
        const id = `proj_${Date.now()}_${this.neuronCounter++}`;
        const project = {
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
    getProject(projectId) {
        return this.projects.get(projectId);
    }
    setCurrentProject(projectId) {
        if (this.projects.has(projectId)) {
            this.currentProjectId = projectId;
            return true;
        }
        return false;
    }
    getCurrentProject() {
        if (!this.currentProjectId)
            return undefined;
        return this.projects.get(this.currentProjectId);
    }
    addNeuron(projectId, name, value, position) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        const id = `neuron_${Date.now()}_${this.neuronCounter++}`;
        const neuron = {
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
    /**
     * Import a UnifiedBrain snapshot (models && skills/core/unified-brain.ts's
     * save()) as the project's real neuron baseline -- the live mesh's actual
     * nodes/connections/bias and its zero-sum value distribution, not the
     * synthetic random layers NeuroclawLLM.build() used to fabricate.
     * `snapshot` is plain data (no class instances), so this file -- loaded
     * directly in the browser with no build step -- never has to import
     * UnifiedBrain itself.
     */
    importFromBrainSnapshot(projectId, snapshot) {
        const project = this.projects.get(projectId);
        if (!project || !snapshot?.mesh)
            return null;
        const meshIdToNeuronId = new Map();
        for (const node of snapshot.mesh.nodes) {
            const neuron = this.addNeuron(projectId, `mesh_${node.id}`, node.activation, { x: (node.id % 20) * 40, y: node.layer * 120 });
            if (neuron) {
                neuron.definition = `bias=${node.bias.toFixed(4)}`;
                meshIdToNeuronId.set(node.id, neuron.id);
            }
        }
        let connectionsImported = 0;
        for (const [fromMeshId, toMeshId, weight] of snapshot.mesh.edges) {
            const fromId = meshIdToNeuronId.get(fromMeshId);
            const toId = meshIdToNeuronId.get(toMeshId);
            if (fromId && toId && this.connectNeurons(projectId, fromId, toId, weight)) {
                connectionsImported++;
            }
        }
        // Fold the live zero-sum value distribution onto each imported
        // neuron's vale field (matching UnifiedBrain's "neuron_<meshId>" id
        // convention), instead of every neuron defaulting to a flat 0.5.
        const totalPoints = snapshot.valeDistribution?.totalPoints ?? 0;
        if (totalPoints > 0) {
            for (const alloc of snapshot.valeDistribution.neuronAllocations) {
                const meshId = Number(String(alloc.id).replace('neuron_', ''));
                const builderId = meshIdToNeuronId.get(meshId);
                if (builderId === undefined)
                    continue;
                const neuron = project.neurons.get(builderId);
                if (neuron)
                    neuron.vale = Math.min(1, Math.max(0, alloc.valuePoints / totalPoints));
            }
        }
        project.updatedAt = Date.now();
        return { neuronsImported: meshIdToNeuronId.size, connectionsImported };
    }
    addCodeNet(projectId, name, code, position) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        const id = `codenet_${Date.now()}_${this.neuronCounter++}`;
        const neuron = {
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
    addNetSearch(projectId, name, corpus, query, netPath, position) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        const id = `netsearch_${Date.now()}_${this.neuronCounter++}`;
        const neuron = {
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
    addOutputLayer(projectId, name, apiConfig, position) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        const id = `output_${Date.now()}_${this.neuronCounter++}`;
        const neuron = {
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
    addLayer(projectId, name, type) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        const id = `layer_${Date.now()}_${this.neuronCounter++}`;
        const layer = {
            id,
            name,
            type,
            neurons: []
        };
        project.layers.set(id, layer);
        project.updatedAt = Date.now();
        return layer;
    }
    connectNeurons(projectId, fromId, toId, weight, bias = 0) {
        const project = this.projects.get(projectId);
        if (!project)
            return false;
        const fromNeuron = project.neurons.get(fromId);
        const toNeuron = project.neurons.get(toId);
        if (!fromNeuron || !toNeuron)
            return false;
        const id = `conn_${fromId}_${toId}_${Date.now()}`;
        const connection = {
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
    disconnectNeurons(projectId, connectionId) {
        const project = this.projects.get(projectId);
        if (!project)
            return false;
        const deleted = project.connections.delete(connectionId);
        if (deleted) {
            project.updatedAt = Date.now();
        }
        return deleted;
    }
    deleteNeuron(projectId, neuronId) {
        const project = this.projects.get(projectId);
        if (!project)
            return false;
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
    dragLabel(projectId, neuronId, label) {
        const project = this.projects.get(projectId);
        if (!project)
            return false;
        const neuron = project.neurons.get(neuronId);
        if (!neuron)
            return false;
        const id = `label_${Date.now()}_${this.neuronCounter++}`;
        const labelData = {
            id,
            text: label,
            x: neuron.x + 50,
            y: neuron.y
        };
        project.labels.set(id, labelData);
        project.updatedAt = Date.now();
        return true;
    }
    // Visual editor: reposition a neuron on the canvas (drag-and-drop).
    moveNeuron(projectId, neuronId, x, y) {
        const project = this.projects.get(projectId);
        if (!project)
            return false;
        const neuron = project.neurons.get(neuronId);
        if (!neuron)
            return false;
        neuron.x = x;
        neuron.y = y;
        project.updatedAt = Date.now();
        return true;
    }
    searchNeurons(projectId, query) {
        const project = this.projects.get(projectId);
        if (!project)
            return [];
        const lowerQuery = query.toLowerCase();
        const results = [];
        for (const neuron of project.neurons.values()) {
            if (neuron.name.toLowerCase().includes(lowerQuery) ||
                neuron.definition.toLowerCase().includes(lowerQuery) ||
                neuron.type.toLowerCase().includes(lowerQuery)) {
                results.push(neuron);
            }
        }
        return results;
    }
    typeModelOutput(projectId, neuronId, inputValue) {
        const project = this.projects.get(projectId);
        if (!project)
            return '';
        const neuron = project.neurons.get(neuronId);
        if (!neuron)
            return '';
        // Simulate neuron activation
        const activated = 1 / (1 + Math.exp(-inputValue + neuron.value));
        neuron.value = activated;
        project.updatedAt = Date.now();
        return `Neuron "${neuron.name}" activated with value ${activated.toFixed(4)}`;
    }
    trainNetSearch(projectId, epochs) {
        const project = this.projects.get(projectId);
        if (!project)
            return false;
        // Index every neuron's own definition -- "searches your definitions
        // of the neurons before they get compiled" -- not just netsearch-type
        // ones, so the trained network covers the whole project.
        this.netSearchEngine.clear();
        for (const neuron of project.neurons.values()) {
            const outgoing = [];
            for (const conn of project.connections.values()) {
                if (conn.fromId === neuron.id)
                    outgoing.push(conn.toId);
            }
            this.netSearchEngine.addStructure({
                name: neuron.id,
                definition: `${neuron.name} ${neuron.definition}`.trim(),
                value: neuron.value,
                connections: outgoing,
                flags: [neuron.type],
            });
        }
        // Real training over `epochs` passes -- each netsearch-type neuron's
        // corpus lines are genuine (query, target-structure) pairs that
        // reinforce the learned association table, not a simulated netPath
        // rename. Soft/bendable: repeated training keeps shifting the same
        // weights rather than a one-shot hard-coded result.
        let trained = false;
        const passes = Math.max(1, Math.trunc(epochs) || 1);
        for (const neuron of project.neurons.values()) {
            if (neuron.type === 'netsearch' && neuron.corpus) {
                const pairs = neuron.corpus.split('\n').filter(Boolean).map(line => ({ query: line, name: neuron.id }));
                for (let e = 0; e < passes; e++) {
                    this.netSearchEngine.train(pairs, 1 / passes);
                }
                neuron.netPath = `${neuron.name}_trained_${passes}ep`;
                trained = true;
            }
        }
        if (trained) {
            project.updatedAt = Date.now();
        }
        return trained;
    }
    /**
     * Net Search: a real, trainable network (NetSearchEngine's neural mode --
     * hashed embeddings plus the learned associations trainNetSearch() built)
     * over the project's neuron definitions. Soft/bendable, not a hard
     * substring match.
     */
    netSearch(projectId, query) {
        const project = this.projects.get(projectId);
        if (!project)
            return [];
        const hits = this.netSearchEngine.search(query, { mode: 'neural', topK: 10 });
        const results = [];
        for (const hit of hits) {
            const neuron = project.neurons.get(hit.name);
            results.push({
                results: [neuron ? (neuron.definition || neuron.name) : hit.name],
                confidence: Math.max(0, Math.min(1, hit.score)),
            });
        }
        return results;
    }
    /**
     * Reverse search: given an output (a neuron already indexed by
     * trainNetSearch()), which query tokens most strongly drove matches to
     * it -- the network runs both directions instead of only query->result.
     */
    reverseNetSearch(projectId, neuronId) {
        const project = this.projects.get(projectId);
        if (!project)
            return [];
        return this.netSearchEngine.reverseSearch(neuronId);
    }
    /**
     * Net Search: semantically search across the project's neural definitions,
     * then generate a small neural network that reproduces the requested
     * behavior by wiring a fresh output neuron to the best-matching neurons.
     * The connection weights are the normalized semantic-similarity scores —
     * a lightweight, deterministic stand-in for the "deep learning" training
     * step described in the spec, using only local data (no external APIs).
     * Returns the generated neuron plus the matches it was built from.
     */
    netSearchGenerate(projectId, query, topK = 3) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        const queryTokens = this.tokenizeForSearch(query);
        // Score every neuron by semantic overlap between the query and the
        // neuron's name + definition + corpus (bag-of-words cosine-ish).
        const scored = [];
        for (const neuron of project.neurons.values()) {
            const text = `${neuron.name} ${neuron.definition} ${neuron.corpus}`;
            const score = this.semanticSimilarity(queryTokens, this.tokenizeForSearch(text));
            if (score > 0)
                scored.push({ neuron, score });
        }
        scored.sort((a, b) => b.score - a.score);
        const matches = scored.slice(0, topK);
        // With no evidence (empty/untokenizable query, or zero overlap against
        // every definition) there is nothing to generate — return null rather
        // than fabricating an "evidence-free but fully confident" neuron.
        if (queryTokens.length === 0 || matches.length === 0)
            return null;
        // Generate the network: a new neuron whose value reflects the actual
        // accumulated evidence, connected to each match with a
        // similarity-weighted edge. `denom` guards the weight division only.
        const totalScore = matches.reduce((s, m) => s + m.score, 0);
        const denom = totalScore || 1;
        const generated = this.addNeuron(projectId, `netsearch:${query}`.slice(0, 48), Math.min(1, totalScore));
        generated.type = 'netsearch';
        generated.query = query;
        generated.definition = `Generated from Net Search "${query}" over ${matches.length} definition(s)`;
        generated.corpus = matches.map(m => m.neuron.name).join('\n');
        for (const m of matches) {
            // Higher-value (more stable) targets resist change: scale the
            // learned weight down by the target's value, echoing elastic
            // neuron values.
            const weight = (m.score / denom) * (1 - (m.neuron.value ?? 0.5) * 0.5);
            this.connectNeurons(projectId, generated.id, m.neuron.id, Number(weight.toFixed(4)), 0);
        }
        project.updatedAt = Date.now();
        return {
            neuron: generated,
            matches: matches.map(m => ({ id: m.neuron.id, name: m.neuron.name, score: Number(m.score.toFixed(4)) })),
        };
    }
    tokenizeForSearch(text) {
        return (text || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
    }
    semanticSimilarity(a, b) {
        if (a.length === 0 || b.length === 0)
            return 0;
        const setB = new Set(b);
        let overlap = 0;
        const seen = new Set();
        for (const t of a) {
            if (setB.has(t) && !seen.has(t)) {
                overlap++;
                seen.add(t);
            }
        }
        // Cosine-like normalization over unique token counts.
        return overlap / Math.sqrt(new Set(a).size * new Set(b).size);
    }
    importCodeToNet(projectId, name, binaryCode) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        const byteArray = Array.from(binaryCode);
        const topology = this.codeToNet.importCode(byteArray, name);
        const id = `codenet_${Date.now()}_${this.neuronCounter++}`;
        const neuron = {
            id,
            name,
            type: 'codenet',
            value: topology.neurons.length,
            dims: project.dims,
            definition: `CodeNet with ${topology.neurons.length} neurons`,
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
    saveWithoutQuantization(projectId) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        const data = {
            project: {
                id: project.id,
                name: project.name,
                description: project.description,
                dims: project.dims,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt
            },
            neurons: Array.from(project.neurons.entries()).map(([id, n]) => ({ ...n })),
            connections: Array.from(project.connections.entries()).map(([, c]) => ({ ...c })),
            layers: Array.from(project.layers.entries()).map(([, l]) => ({ ...l })),
            labels: Array.from(project.labels.entries()).map(([, l]) => ({ ...l }))
        };
        return JSON.stringify(data, null, 2);
    }
    async installWithQuantization(projectId, options = {}) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        // Update quantizer config
        this.quantizer = new BackgroundQuantizer({
            enabled: true,
            bits: options.bits,
            method: 'mixed',
            calibrationSamples: 128,
            excludeLayers: []
        });
        // Collect all weights from connections
        const weights = {};
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
            neurons: Array.from(project.neurons.entries()).map(([, n]) => ({ ...n })),
            connections: Array.from(project.connections.entries()).map(([connId, c]) => ({
                id: connId,
                fromId: c.fromId,
                toId: c.toId,
                weight: quantizedWeights[connId]?.[0] ?? c.weight,
                bias: quantizedWeights[connId]?.[1] ?? c.bias
            })),
            layers: Array.from(project.layers.entries()).map(([, l]) => ({ ...l })),
            labels: Array.from(project.labels.entries()).map(([, l]) => ({ ...l }))
        };
        return JSON.stringify(data, null, 2);
    }
    addAPIOutputLayer(projectId, config) {
        const project = this.projects.get(projectId);
        if (!project)
            return false;
        const outputNeuron = this.addOutputLayer(projectId, 'API_Output', config);
        if (!outputNeuron)
            return false;
        // Connect all neurons to output
        for (const [neuronId, neuron] of project.neurons) {
            if (neuron.type !== 'output') {
                this.connectNeurons(projectId, neuronId, outputNeuron.id, 0.5, 0);
            }
        }
        return true;
    }
    async parseNeuroLang(projectId, source) {
        const project = this.projects.get(projectId);
        if (!project)
            return { success: false, errors: ['Project not found'] };
        const result = await this.neuroLang.parse(source);
        if (result.errors.length > 0) {
            return { success: false, errors: result.errors };
        }
        const evaluated = await this.neuroLang.evaluate(result);
        // Add parsed neurons to project. evaluate() connects every neuron to
        // every other by default, so a project can have up to O(n^2)
        // connections -- looking up each connection's target with
        // Array.from(project.neurons.values()).find(...) (a full O(n) linear
        // scan) turned this into an O(n^3) synchronous loop, unauthenticated
        // via POST /api/extension/build. A local name->neuron map makes each
        // lookup O(1); periodic yields (mirroring evaluate()'s own fix) keep
        // it from monopolizing the event loop for very large n.
        const nameToNeuron = new Map();
        for (const [name, neuronData] of evaluated) {
            const neuron = this.addNeuron(projectId, name, neuronData.value);
            if (neuron) {
                neuron.definition = neuronData.definition;
                neuron.code = neuronData.code || '';
                nameToNeuron.set(name, neuron);
            }
        }
        // Checked inside the inner loop, not once per outer (name) iteration
        // -- checking only at the end of an outer iteration would let a
        // single neuron's own connections.size (which can itself approach
        // the parsed neuron count, since evaluate() connects every neuron to
        // every other by default) run entirely unyielded whenever it alone
        // exceeds the threshold, defeating the "bounded interval regardless
        // of n" intent for exactly the large-n case this exists to protect.
        let pairsSinceYield = 0;
        for (const [name, neuronData] of evaluated) {
            const neuron = nameToNeuron.get(name);
            if (!neuron) continue;
            for (const [target, weight] of neuronData.connections) {
                const targetNeuron = nameToNeuron.get(target);
                if (targetNeuron) {
                    this.connectNeurons(projectId, neuron.id, targetNeuron.id, weight, 0);
                }
                pairsSinceYield++;
                if (pairsSinceYield >= 200000) {
                    pairsSinceYield = 0;
                    await yieldToEventLoop();
                }
            }
        }
        project.updatedAt = Date.now();
        return { success: true, errors: [] };
    }
    exportToNeuroLang(projectId) {
        const project = this.projects.get(projectId);
        if (!project)
            return '';
        const lines = [];
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
            }
            else if (neuron.type === 'codenet') {
                lines.push(`code@name="${neuron.name}"`);
                if (neuron.code) {
                    lines.push(`"${neuron.name}"@code="${neuron.code}"`);
                }
            }
            else if (neuron.type === 'netsearch') {
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
    listProjects() {
        return Array.from(this.projects.values());
    }
    deleteProject(projectId) {
        if (this.currentProjectId === projectId) {
            this.currentProjectId = null;
        }
        return this.projects.delete(projectId);
    }
    getStats(projectId) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        return {
            neuronCount: project.neurons.size,
            connectionCount: project.connections.size,
            layerCount: project.layers.size,
            labelCount: project.labels.size
        };
    }
}
