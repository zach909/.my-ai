import { BackgroundQuantizer } from '../models && skills/core/quantizer.js';
import { NeuroLangInterpreter, NeuroLangRuntime, embedText } from '../models && skills/core/neuro-lang.js';
import { CodeToNet } from '../models && skills/core/thorns.js';
import { NetSearchEngine } from '../models && skills/core/net-search.js';
import { HyperDimensionalEngine, ValueRangeAllocator } from '../models && skills/core/onebrain.js';

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
            updatedAt: Date.now(),
            lockedPairs: new Set()
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
            external: [],
            scripts: []
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
            external: [],
            scripts: []
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
            external: [],
            scripts: []
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
            external: [],
            scripts: []
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
    /**
     * `locked` distinguishes "permanent" connections (fixed once set --
     * reconnecting or disconnecting the same pair is refused below) from
     * "starting place" connections (the default: freely editable). Refuses
     * outright if an existing locked connection already exists between the
     * same pair, rather than silently adding a second parallel connection.
     *
     * `project.lockedPairs` (Set<"fromId|toId">, lazily created) makes that
     * check O(1) instead of scanning every connection: parseNeuroLang()'s
     * default all-to-all wiring calls connectNeurons() up to O(n^2) times
     * for a large project (evaluate() connects every neuron to every other
     * unless @connections narrows it, per the DSL spec), so a per-call
     * linear scan over project.connections there turned the whole
     * connection-wiring phase O(n^2) calls * O(n^2) connections-so-far =
     * effectively O(n^4) -- 300 auto-connected neurons alone took long
     * enough to look like a genuine hang, not just "slow".
     */
    connectNeurons(projectId, fromId, toId, weight, bias = 0, locked = false) {
        const project = this.projects.get(projectId);
        if (!project)
            return false;
        const fromNeuron = project.neurons.get(fromId);
        const toNeuron = project.neurons.get(toId);
        if (!fromNeuron || !toNeuron)
            return false;
        if (!project.lockedPairs)
            project.lockedPairs = new Set();
        const pairKey = `${fromId}|${toId}`;
        if (project.lockedPairs.has(pairKey))
            return false;
        const id = `conn_${fromId}_${toId}_${Date.now()}`;
        const connection = {
            id,
            fromId,
            toId,
            weight,
            bias,
            locked
        };
        project.connections.set(id, connection);
        if (locked)
            project.lockedPairs.add(pairKey);
        project.updatedAt = Date.now();
        return true;
    }
    /** Toggle a connection between "permanent" (locked) and "starting place" (unlocked). */
    setConnectionLocked(projectId, connectionId, locked) {
        const project = this.projects.get(projectId);
        const conn = project?.connections.get(connectionId);
        if (!conn)
            return false;
        if (!project.lockedPairs)
            project.lockedPairs = new Set();
        const pairKey = `${conn.fromId}|${conn.toId}`;
        if (locked)
            project.lockedPairs.add(pairKey);
        else
            project.lockedPairs.delete(pairKey);
        conn.locked = locked;
        project.updatedAt = Date.now();
        return true;
    }
    disconnectNeurons(projectId, connectionId) {
        const project = this.projects.get(projectId);
        if (!project)
            return false;
        const existing = project.connections.get(connectionId);
        if (existing?.locked)
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
                    project.lockedPairs?.delete(`${conn.fromId}|${conn.toId}`);
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
    /**
     * "Scripting": a (user says X -> should respond Y) example attached to
     * a neuron. Not a canned string match -- train() below feeds every
     * script as a genuine training sample (embedText(userSays) driving the
     * settle, embedText(response) as the target the neuron's readout is
     * trained toward), the same mechanism @definishon contracts use. A
     * neuron accumulates as many scripts as it needs; train() runs them
     * all together with its @definishon (if any) until everything
     * converges or the epoch budget runs out.
     */
    addScript(projectId, neuronId, userSays, response) {
        const project = this.projects.get(projectId);
        const neuron = project?.neurons.get(neuronId);
        if (!neuron || !userSays.trim() || !response.trim())
            return false;
        neuron.scripts.push({ userSays: userSays.trim(), response: response.trim() });
        project.updatedAt = Date.now();
        return true;
    }
    removeScript(projectId, neuronId, index) {
        const project = this.projects.get(projectId);
        const neuron = project?.neurons.get(neuronId);
        if (!neuron || index < 0 || index >= neuron.scripts.length)
            return false;
        neuron.scripts.splice(index, 1);
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
     * Matches -- and the connection weights they generate -- come from the
     * real backprop-trained NetSearchEngine (models && skills/core/net-search.ts),
     * using only local data (no external APIs), not a bag-of-words cosine stand-in.
     * Returns the generated neuron plus the matches it was built from.
     */
    netSearchGenerate(projectId, query, topK = 3) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        if (!query || !query.trim())
            return null;
        // Keep the trained network's index current with every neuron's
        // present name+definition+corpus text before searching it.
        for (const neuron of project.neurons.values()) {
            this.netSearchEngine.addStructure({
                name: neuron.id,
                definition: `${neuron.name} ${neuron.definition} ${neuron.corpus}`.trim(),
                value: neuron.value,
                flags: [neuron.type],
            });
        }
        const hits = this.netSearchEngine.search(query, { mode: 'neural', topK });
        const matches = [];
        for (const hit of hits) {
            const neuron = project.neurons.get(hit.name);
            if (neuron)
                matches.push({ neuron, score: hit.score });
        }
        // With no evidence (empty query, or the trained network found nothing
        // above threshold) there is nothing to generate — return null rather
        // than fabricating an "evidence-free but fully confident" neuron.
        if (matches.length === 0)
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
            external: [],
            scripts: [],
            // The importCode() call above already built this call's own
            // self-contained topology (this.codeToNet's internal maps are
            // shared/keyed by byte offset across every import, so THEY
            // collide across multiple files -- this per-neuron copy is
            // what makes exportCodeNet() below actually reversible for
            // more than just the most recently imported file).
            codeTopology: topology
        };
        project.neurons.set(id, neuron);
        project.updatedAt = Date.now();
        return neuron;
    }
    /**
     * Reverse of importCodeToNet(): walks this neuron's own stored network
     * topology back into the exact original bytes -- "reverse the network
     * so you get what you want [the original code] instead of it being
     * [only] reversed [into a network]." Genuinely lossless (see
     * CodeToNet.exportCode()'s own doc comment in thorns.js), not an
     * approximation -- verified by round-trip tests that import then
     * export and check byte-for-byte equality against the source.
     */
    exportCodeNet(projectId, neuronId) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        const neuron = project.neurons.get(neuronId);
        if (!neuron || neuron.type !== 'codenet' || !neuron.codeTopology)
            return null;
        return this.codeToNet.exportCode(neuron.codeTopology);
    }
    /**
     * The real training sequence: "connections then makes all definishons
     * true then does the scripting -- a loop till all is true." NOT a
     * script (no keyword matching, no canned playback) -- a genuine
     * HyperDimensionalEngine training run, the same trainDefinitions()
     * mechanism NeuroLangRuntime.materialize() already uses for
     * @definishon (see neuro-lang.ts), extended here to also train every
     * neuron's attached scripts (addScript() above) as additional
     * (input -> target) samples on the same shared engine and the same
     * per-neuron readout, so a script and a @definishon on the same neuron
     * genuinely shape the same trained state rather than two disconnected
     * mechanisms.
     *
     * 1. @connections/@conections are written as real connDiag weights
     *    (materialize() step 2) -- "permanent" (locked) connections were
     *    already protected from being overwritten by further edits in
     *    connectNeurons()/disconnectNeurons() above; they're applied here
     *    identically to "starting place" ones since materialize() always
     *    re-applies whatever's currently in the project, locked or not.
     * 2. @vale nudges the value budget (materialize() step 3).
     * 3. @definishon + every script become constraint-loss training
     *    samples, trained together until convergence or `epochs` runs out.
     * 4. Neurons whose definition and every one of their scripts converged
     *    get `trained = true` and their vale raised (locked in) -- the
     *    same "on success raises that neuron's vale" mechanism
     *    materialize() already applies to @definishon alone.
     */
    train(projectId, opts = {}) {
        const project = this.projects.get(projectId);
        if (!project)
            return null;
        const dims = 16;
        // method: 'delta' (default) is the analytic tanh-derivative delta
        // rule; 'random' is genuine random-search/evolution-strategy
        // updates -- "each variable randomly changed; keep the change if
        // it helped, revert if it didn't" -- a different algorithm, not
        // gradient descent under another name. See
        // HyperDimensionalEngine.trainDefinitionsRandomSearch()'s doc
        // comment in onebrain.ts.
        const method = opts.method === 'random' ? 'random' : 'delta';
        // 300 converged a single neuron reliably but not two neurons each
        // with their own script trained together in one pass (empirically:
        // that needed ~800). Convergence is cheap here regardless -- 5000
        // epochs on a handful of neurons still runs in well under 100ms --
        // so default generously rather than making multi-neuron projects
        // need a manual epoch bump just to converge on the first Train.
        // Random search needs more attempts than the delta rule to find
        // the same minimum (a random step is only ~50% likely to even
        // point the right way; the delta rule's step always does), so its
        // default budget is generously higher.
        const epochs = opts.epochs ?? (method === 'random' ? 3000 : 1000);
        const neuronCount = project.neurons.size + 1; // +1 for the shared query/drive neuron (id 0)
        const engine = new HyperDimensionalEngine({ dimensions: dims, neuronCount, propagationSteps: 12, convergenceThreshold: 0.01 });
        const vale = new ValueRangeAllocator({
            enabled: true, totalPoints: 100, minLearningRate: 0.001, maxLearningRate: 0.5,
            redistributionInterval: 1000, decayFactor: 0,
        });
        vale.initializeNeurons(Array.from({ length: neuronCount }, (_, i) => ({
            id: String(i), name: i === 0 ? 'query' : `n${i}`, value: 0, learningRate: 0,
            states: new Map(), connections: new Map(), expertGroup: null, active: true,
        })));
        const runtime = new NeuroLangRuntime(engine, vale, 0);

        // Build the Map<string, NeuriNeuron> materialize() expects: keyed
        // by name (not builder id), connections keyed by target *name*.
        const neurons = new Map();
        for (const [, n] of project.neurons) {
            const connections = new Map();
            for (const conn of project.connections.values()) {
                if (conn.fromId !== n.id)
                    continue;
                const target = project.neurons.get(conn.toId);
                if (target)
                    connections.set(target.name, conn.weight);
            }
            neurons.set(n.name, {
                name: n.name, value: n.value, vale: n.vale, connections,
                definition: n.definition ?? '', code: null,
                isNetSearch: n.type === 'netsearch', netLocation: null, isCodeNet: n.type === 'codenet',
            });
        }

        const result = runtime.materialize(neurons, { epochs, method });

        // Extra training pass: every script, on top of whatever
        // materialize() already trained for @definishon, on the SAME
        // engine instance and the SAME assigned neuron ids (result.nameToId).
        const scriptSamples = [];
        for (const [name, n] of project.neurons) {
            for (const script of n.scripts) {
                const readoutId = result.nameToId.get(n.name);
                if (readoutId === undefined)
                    continue;
                scriptSamples.push({
                    driveNeuronId: 0,
                    input: embedText(script.userSays, dims),
                    readoutNeuronId: readoutId,
                    target: embedText(script.response, dims),
                });
            }
        }
        const scriptResult = scriptSamples.length > 0
            ? (method === 'random'
                ? engine.trainDefinitionsRandomSearch(scriptSamples, { epochs })
                : engine.trainDefinitions(scriptSamples, { epochs }))
            : null;

        // A neuron is "trained" only once BOTH its @definishon (if any) and
        // ALL of its scripts (if any) converged -- never claimed true on a
        // partial pass.
        const idToName = new Map(Array.from(result.nameToId.entries()).map(([nm, id]) => [id, nm]));
        const scriptSatisfiedNames = new Set((scriptResult?.satisfied ?? []).map(id => idToName.get(id)));
        const definitionSatisfiedNames = new Set(result.satisfied);
        for (const [, n] of project.neurons) {
            const hasDefinition = n.definition.trim().length > 0;
            const hasScripts = n.scripts.length > 0;
            const definitionOk = !hasDefinition || definitionSatisfiedNames.has(n.name);
            const scriptsOk = !hasScripts || n.scripts.every(() => scriptSatisfiedNames.has(n.name));
            n.trained = (hasDefinition || hasScripts) && definitionOk && scriptsOk;
            if (n.trained) {
                const id = result.nameToId.get(n.name);
                if (id !== undefined)
                    vale.updateNeuronValue(String(id), 5); // lock in, same mechanism materialize() uses
                n.vale = vale.getValeFractions().get(String(result.nameToId.get(n.name))) ?? n.vale;
            }
        }
        project.updatedAt = Date.now();

        const trainingResult = {
            converged: result.converged && (scriptResult?.converged ?? true),
            definitionsConverged: result.converged,
            scriptsConverged: scriptResult?.converged ?? true,
            epochs: Math.max(result.epochs, scriptResult?.epochs ?? 0),
            satisfied: Array.from(new Set([...definitionSatisfiedNames, ...scriptSatisfiedNames])),
            conflicts: result.conflicts,
            trainedNeurons: Array.from(project.neurons.values()).filter(n => n.trained).map(n => n.name),
        };
        project.lastTraining = trainingResult;
        return trainingResult;
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
        // train() is a deliberate, separate, explicit action (the UI's
        // "Train" button / a direct train() call) -- NOT run implicitly
        // here. An earlier version of this method auto-triggered training
        // whenever any neuron had a non-empty `definition`, but several
        // neuron kinds stamp a purely descriptive `definition` string that
        // was never meant to be a trainable @definishon contract (Code-to-Net
        // sets `definition = "CodeNet with N neurons"`, a brain-snapshot
        // import sets `definition = "bias=..."`) -- auto-training on that
        // signal fired far more often than intended and made every
        // pre-existing install() call (including in tests with no training
        // intent at all) pay for a real HyperDimensionalEngine pass it
        // never asked for. Call train(projectId) yourself first when you
        // actually want the definitions/scripts trained before deploying.
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
