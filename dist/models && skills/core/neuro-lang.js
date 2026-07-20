/**
 * NeuriLang — custom neuron definition language interpreter.
 *
 * Syntax summary:
 *   name="example"                             — create neuron named "example"
 *   "name"@value="1.0"                         — set neuron's value
 *   "name"@vale="0.9"                          — set neuron's vale (elasticity/resistance to change)
 *   "name"@connections=".other*0.5+.third*0.3"  — set connections (alias: @conections=)
 *   "name"@definition="text"                   — set definition (alias: @definishon=)
 *   "name"@code="code"                         — attach code
 *   code@name="calc"                           — create code-to-net neuron
 *   "netsearch"@net="location"                 — create netsearch neuron
 *   print "name"                               — print neuron info
 *
 * @conections= and @definishon= are the DSL's canonical (deliberately
 * non-standard) spellings from the original neurolang.py; @connections=/
 * @definition= are accepted as the same primitive under a conventional
 * spelling. Both parse to the same NeuriNeuron fields.
 *
 * All neurons are connected by default (weight 0.1) unless an explicit
 * connection is specified.
 */
import { CodeToNetCompiler } from './code-to-net.js';
import { NetSearchEngine } from './net-search.js';
// ── Parser ────────────────────────────────────────────────────────────────────
export class NeuroLangInterpreter {
    constructor() {
        /** Parse-scoped: the pending `"netsearch"@name=` awaiting a `@net=`. */
        this.pendingNetSearch = null;
        /** Behavioral Code-to-Net compiler + the nets compiled during the last parse. */
        this.codeToNet = new CodeToNetCompiler();
        this.codeNets = new Map();
        /** Net Search engine + the neuron map from the last parse it searches over. */
        this.netSearchEngine = new NetSearchEngine();
        this.lastNeurons = new Map();
    }
    // ── Public API ──────────────────────────────────────────────────────────────
    /**
     * Parse NeuriLang source code and return a ParseResult.
     * No connections are auto-added here — that happens in evaluate().
     */
    parse(source) {
        const neurons = new Map();
        const errors = [];
        const printOutputs = [];
        // Name of the most recently declared `"netsearch"@name=` that has not yet
        // been given a location, so a following `"netsearch"@net=` binds to it in
        // parse order rather than by Map iteration order.
        this.pendingNetSearch = null;
        this.codeNets.clear();
        const lines = source.split(/\r?\n/);
        for (let lineNo = 0; lineNo < lines.length; lineNo++) {
            const raw = lines[lineNo];
            // Strip inline comments (-- ...) and trim whitespace
            const line = raw.replace(/--.*$/, '').trim();
            if (!line)
                continue;
            try {
                this.parseLine(line, neurons, printOutputs);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                errors.push(`Line ${lineNo + 1}: ${msg} (source: "${raw.trim()}")`);
            }
        }
        this.lastNeurons = neurons;
        return { neurons, errors, printOutputs };
    }
    /**
     * Add default connections from every neuron to every other neuron that
     * does not already have an explicit connection (weight = 0.1).
     * Returns the fully-connected neuron map.
     */
    evaluate(result) {
        const neurons = result.neurons;
        const names = Array.from(neurons.keys());
        for (const srcName of names) {
            const src = neurons.get(srcName);
            for (const dstName of names) {
                if (dstName === srcName)
                    continue;
                if (!src.connections.has(dstName)) {
                    src.connections.set(dstName, 0.1);
                }
            }
        }
        return neurons;
    }
    // ── Code-to-Net (Section 21) — behavioral networks compiled from `@code` ──────
    /** The network compiled from a neuron's attached code, if any. */
    getCodeNet(name) {
        return this.codeNets.get(name);
    }
    /** Names of neurons that produced a compiled Code-to-Net network. */
    codeNetNames() {
        return Array.from(this.codeNets.keys());
    }
    /** Evaluate a compiled code-net on numeric inputs. */
    evaluateCodeNet(name, inputs) {
        return this.codeNets.get(name)?.evaluate(inputs);
    }
    /** Test a compiled code-net against its original source code. */
    testCodeNet(name, opts) {
        const net = this.codeNets.get(name);
        if (!net)
            return undefined;
        return this.codeToNet.testAgainst(net, net.source, opts);
    }
    // ── Net Search (Section 22) — search the project's own neural structures ──────
    /** Reindex the Net Search engine from the last-parsed neuron map. */
    refreshNetSearchIndex() {
        this.netSearchEngine.clear();
        for (const n of this.lastNeurons.values()) {
            const flags = [];
            if (n.isCodeNet)
                flags.push('code-net');
            if (n.isNetSearch)
                flags.push('netsearch');
            this.netSearchEngine.addStructure({
                name: n.name,
                definition: n.definition,
                value: n.value,
                connections: Array.from(n.connections.keys()),
                flags,
            });
        }
    }
    /**
     * Search the current neural structures. Modes: exact | semantic | neural |
     * structural (see NetSearchEngine). This is what a `"netsearch"@net="self"`
     * binding resolves to — "self"/"mesh" = the current NeuroLang neuron map.
     */
    netSearch(query, opts) {
        this.refreshNetSearchIndex();
        return this.netSearchEngine.search(query, opts);
    }
    /** Teach the neural search mode query→structure associations (persists across searches). */
    trainNetSearch(pairs) {
        this.netSearchEngine.train(pairs);
    }
    /** The declared `"netsearch"@name=` bindings and their `@net=` locations. */
    getNetSearchBindings() {
        const out = [];
        for (const n of this.lastNeurons.values()) {
            if (n.isNetSearch)
                out.push({ name: n.name, location: n.netLocation });
        }
        return out;
    }
    /**
     * Serialise a neuron map to JSON.
     */
    toJSON(neurons) {
        const serialized = [];
        for (const [, n] of neurons) {
            serialized.push({
                name: n.name,
                value: n.value,
                connections: Array.from(n.connections.entries()),
                definition: n.definition,
                code: n.code,
                isNetSearch: n.isNetSearch,
                netLocation: n.netLocation,
                isCodeNet: n.isCodeNet,
            });
        }
        return JSON.stringify(serialized, null, 2);
    }
    /**
     * Deserialise a JSON string (produced by toJSON) into a ParseResult.
     * Errors and printOutputs are empty because they are not stored.
     */
    fromJSON(json) {
        const neurons = new Map();
        const errors = [];
        let parsed;
        try {
            parsed = JSON.parse(json);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { neurons, errors: [`JSON parse error: ${msg}`], printOutputs: [] };
        }
        if (!Array.isArray(parsed)) {
            return { neurons, errors: ['Expected a JSON array'], printOutputs: [] };
        }
        for (const sn of parsed) {
            if (typeof sn.name !== 'string') {
                errors.push(`Skipping entry with missing name: ${JSON.stringify(sn)}`);
                continue;
            }
            const neuron = {
                name: sn.name,
                value: typeof sn.value === 'number' ? sn.value : 0,
                connections: new Map(Array.isArray(sn.connections) ? sn.connections : []),
                definition: typeof sn.definition === 'string' ? sn.definition : '',
                code: typeof sn.code === 'string' ? sn.code : null,
                isNetSearch: Boolean(sn.isNetSearch),
                netLocation: typeof sn.netLocation === 'string' ? sn.netLocation : null,
                isCodeNet: Boolean(sn.isCodeNet),
            };
            neurons.set(neuron.name, neuron);
        }
        return { neurons, errors, printOutputs: [] };
    }
    // ── Private parser internals ─────────────────────────────────────────────────
    parseLine(line, neurons, printOutputs) {
        // ── name="X" — create neuron ────────────────────────────────────────────
        {
            const m = line.match(/^name\s*=\s*"([^"]+)"$/);
            if (m) {
                const name = m[1];
                if (!neurons.has(name)) {
                    neurons.set(name, this.defaultNeuron(name));
                }
                return;
            }
        }
        // ── code@name="X" — create code-net neuron ──────────────────────────────
        {
            const m = line.match(/^code\s*@\s*name\s*=\s*"([^"]+)"$/);
            if (m) {
                const name = m[1];
                const neuron = neurons.get(name) ?? this.defaultNeuron(name);
                neuron.isCodeNet = true;
                neurons.set(name, neuron);
                return;
            }
        }
        // ── "netsearch"@name="X" — create a Net Search definition ──────────────
        {
            const m = line.match(/^"netsearch"\s*@\s*name\s*=\s*"([^"]+)"$/);
            if (m) {
                const name = m[1];
                const neuron = neurons.get(name) ?? this.defaultNeuron(name);
                neuron.isNetSearch = true;
                neurons.set(name, neuron);
                // Remember this as the definition awaiting a location (parse order),
                // so a following `@net=` binds here regardless of Map iteration order.
                this.pendingNetSearch = name;
                return;
            }
        }
        // ── "netsearch"@net="X" — attach a search location and (later) generate ──
        {
            const m = line.match(/^"netsearch"\s*@\s*net\s*=\s*"([^"]+)"$/);
            if (m) {
                const location = m[1];
                // Bind to the pending named netsearch definition (tracked in parse
                // order); if there is none, fall back to a location-named neuron.
                const pending = this.pendingNetSearch;
                let target = pending ? neurons.get(pending) : undefined;
                if (!target || target.netLocation) {
                    const name = `netsearch:${location}`;
                    target = neurons.get(name) ?? this.defaultNeuron(name);
                    target.isNetSearch = true;
                    neurons.set(target.name, target);
                }
                target.netLocation = location;
                this.pendingNetSearch = null;
                return;
            }
        }
        // ── "X"@value="N" — set value ───────────────────────────────────────────
        {
            const m = line.match(/^"([^"]+)"\s*@\s*value\s*=\s*"([^"]+)"$/);
            if (m) {
                const name = m[1];
                const val = parseFloat(m[2]);
                if (isNaN(val))
                    throw new Error(`Invalid value "${m[2]}" for neuron "${name}"`);
                const neuron = neurons.get(name) ?? this.defaultNeuron(name);
                neuron.value = val;
                neurons.set(name, neuron);
                return;
            }
        }
        // ── "X"@vale="0.9" — set elasticity/resistance to change ───────────────
        {
            const m = line.match(/^"([^"]+)"\s*@\s*vale\s*=\s*"?([0-9.]+)"?$/);
            if (m) {
                const name = m[1];
                const val = parseFloat(m[2]);
                if (isNaN(val))
                    throw new Error(`Invalid vale "${m[2]}" for neuron "${name}"`);
                const neuron = neurons.get(name) ?? this.defaultNeuron(name);
                neuron.vale = Math.max(0, Math.min(1, val));
                neurons.set(name, neuron);
                return;
            }
        }
        // ── "X"@connections="..." (alias: @conections=) — set connections ──────
        {
            const m = line.match(/^"([^"]+)"\s*@\s*con(?:n)?ections\s*=\s*"([^"]*)"$/);
            if (m) {
                const name = m[1];
                const neuron = neurons.get(name) ?? this.defaultNeuron(name);
                // Ensure source neuron exists in map
                neurons.set(name, neuron);
                // Parse connection spec: .target*weight + .target*weight ...
                neuron.connections = this.parseConnections(m[2], name);
                return;
            }
        }
        // ── "X"@definition="..." (alias: @definishon=) — set definition ────────
        {
            const m = line.match(/^"([^"]+)"\s*@\s*definis?hon\s*=\s*"([^"]*)"$/)
                ?? line.match(/^"([^"]+)"\s*@\s*definition\s*=\s*"([^"]*)"$/);
            if (m) {
                const name = m[1];
                const neuron = neurons.get(name) ?? this.defaultNeuron(name);
                neuron.definition = m[2];
                neurons.set(name, neuron);
                return;
            }
        }
        // ── "X"@code="..." — attach code ────────────────────────────────────────
        {
            const m = line.match(/^"([^"]+)"\s*@\s*code\s*=\s*"([^"]*)"$/);
            if (m) {
                const name = m[1];
                const neuron = neurons.get(name) ?? this.defaultNeuron(name);
                neuron.code = m[2];
                neurons.set(name, neuron);
                // Behavioral Code-to-Net (Section 21): compile the attached code into a
                // real, testable network. Guarded so it can never break DSL parsing.
                try {
                    this.codeNets.set(name, this.codeToNet.compile(name, m[2]));
                }
                catch { /* leave as a stored code string only */ }
                return;
            }
        }
        // ── print "X" — output neuron state ────────────────────────────────────
        {
            const m = line.match(/^print\s+"([^"]+)"$/);
            if (m) {
                const name = m[1];
                const neuron = neurons.get(name);
                if (!neuron) {
                    printOutputs.push(`[print] Neuron "${name}" not found`);
                }
                else {
                    printOutputs.push(this.formatNeuron(neuron));
                }
                return;
            }
        }
        // Unknown syntax — record as error via throw so caller can log line number
        throw new Error(`Unrecognised NeuriLang statement: "${line}"`);
    }
    // ── Parse connection string: .name*weight+.name*weight ... ─────────────────
    parseConnections(spec, sourceName) {
        const connections = new Map();
        if (!spec.trim())
            return connections;
        // Supported forms (split on '+'; names cannot contain '+'):
        //   .target                     — weight 1.0
        //   .target*weight              — explicit weight
        //   .target*w + .other*w        — several targets
        //   .target/variable*bias       — Section 20 form: a per-dimension state
        //                                 selector (parsed; the target-level weight
        //                                 is `bias`, since this weight model is
        //                                 scalar-per-edge — the state-var routing is
        //                                 a Python-track feature)
        //   .target/variable*bias + w   — a trailing bare number is an additive
        //                                 refinement folded into the last edge's
        //                                 effective weight (bias + w)
        const parts = spec.split('+');
        let lastTarget = null;
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed)
                continue;
            // A bare number is the additive `+weight` term for the previous edge.
            const additive = trimmed.match(/^([\d.]+)$/);
            if (additive) {
                if (lastTarget === null) {
                    throw new Error(`Leading additive weight "${trimmed}" has no target in connections for "${sourceName}"`);
                }
                const add = parseFloat(additive[1]);
                if (isNaN(add))
                    throw new Error(`Invalid additive weight "${trimmed}" for "${sourceName}"`);
                connections.set(lastTarget, (connections.get(lastTarget) ?? 0) + add);
                continue;
            }
            // .target[/variable][*bias]
            const connMatch = trimmed.match(/^\.([A-Za-z0-9_:@\-. ]+?)(?:\/([A-Za-z0-9_]+))?(?:\s*\*\s*([\d.]+))?$/);
            if (!connMatch) {
                throw new Error(`Invalid connection segment "${trimmed}" in connections for "${sourceName}". ` +
                    `Expected format: .targetName[/variable][*weight]`);
            }
            const targetName = connMatch[1].trim();
            const weight = connMatch[3] !== undefined ? parseFloat(connMatch[3]) : 1.0;
            if (isNaN(weight)) {
                throw new Error(`Invalid weight "${connMatch[3]}" for connection ".${targetName}"`);
            }
            connections.set(targetName, weight);
            lastTarget = targetName;
        }
        return connections;
    }
    // ── Build a default neuron with all fields at zero/empty ───────────────────
    defaultNeuron(name) {
        return {
            name,
            value: 0,
            connections: new Map(),
            definition: '',
            code: null,
            isNetSearch: false,
            netLocation: null,
            isCodeNet: false,
        };
    }
    // ── Format a neuron for print output ───────────────────────────────────────
    formatNeuron(n) {
        const connStr = Array.from(n.connections.entries())
            .map(([t, w]) => `.${t}*${w}`)
            .join('+');
        const flags = [];
        if (n.isCodeNet)
            flags.push('code-net');
        if (n.isNetSearch)
            flags.push(`netsearch:${n.netLocation}`);
        return (`[Neuron "${n.name}"] ` +
            `value=${n.value} ` +
            `connections=[${connStr || 'none'}] ` +
            `definition="${n.definition}" ` +
            `code=${n.code !== null ? `"${n.code}"` : 'null'} ` +
            (flags.length > 0 ? `flags=[${flags.join(',')}]` : '')).trim();
    }
}
/**
 * Deterministic text -> unit vector, so the same definition text always
 * produces the same training target (and different text a different one)
 * without needing an external embedding model. Each dimension gets its own
 * running hash seeded by its index and folded over every character (not
 * just one or two fixed character positions), so short or low-diversity
 * strings (e.g. a single repeated character) still disperse across
 * dimensions instead of collapsing every dimension to the same value —
 * and, in turn, so two different definitions reliably land on genuinely
 * different targets rather than risking an accidental collision.
 */
export function embedText(text, dims) {
    const vec = new Array(dims).fill(0);
    if (text.length === 0)
        return vec;
    for (let d = 0; d < dims; d++) {
        let h = 2166136261 ^ (d * 2654435761); // FNV-1a offset basis, salted per dimension
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        // Unsigned 32-bit -> [-1, 1)
        vec[d] = ((h >>> 0) / 0xffffffff) * 2 - 1;
    }
    return vec;
}
/** A fixed, concept-agnostic "recall your definition" drive vector shared by
 *  every @definishon constraint. Deliberately the same for every neuron:
 *  distinguishing meaning has to come from each readout's *learned weights*
 *  (trained per-neuron below), not from feeding a different input per
 *  concept — which would make even truly incompatible definitions trivially
 *  "solvable" as just another input-conditional case instead of a real
 *  conflict. */
function definitionTrigger(dims) {
    return new Array(dims).fill(0.7);
}
/**
 * Bridges a parsed NeuriLang program into a live HyperDimensionalEngine
 * (and, optionally, the elastic value budget) instead of leaving it as a
 * discarded in-memory ParseResult:
 *   - every declared neuron is assigned a real engine neuron id
 *   - @vale nudges that neuron's share of the (optional) value budget
 *   - @connections/@conections writes real connDiag weights between the
 *     named neurons
 *   - @definition/@definishon becomes a constraint-loss training sample
 *     (clamp a shared query neuron to the same fixed "recall" trigger for
 *     every definition, settle, require the declared neuron to read back
 *     embed(text)) run through the engine's existing trainDefinitions() —
 *     same contradiction detection and tolerance-based convergence as any
 *     other definishon contract — and on
 *     success raises that neuron's vale (locks it in), per Section 1.2's
 *     zero-sum mechanism.
 */
export class NeuroLangRuntime {
    constructor(engine, valeAllocator, queryNeuronId = 0) {
        /**
         * Persists across materialize() calls on the same runtime, so re-running
         * DSL snippets (incremental sessions) reuses each name's already-assigned
         * engine neuron id instead of drifting to a new one every time. Also lets
         * two distinct DSL names be deliberately pinned to the same underlying
         * neuron via setNeuronId() (a synonym/alias), which is what makes two
         * separately-declared @definishon contracts able to genuinely conflict —
         * without this, every name gets its own readout and nothing can collide.
         */
        this.nameToId = new Map();
        this.engine = engine;
        this.valeAllocator = valeAllocator;
        this.queryNeuronId = queryNeuronId;
        this.nextId = queryNeuronId === 0 ? 1 : 0;
    }
    /** Pin a DSL name to a specific engine neuron id (e.g. to alias two
     *  declared names onto the same underlying neuron). */
    setNeuronId(name, id) {
        this.nameToId.set(name, id);
    }
    materialize(neurons, opts = {}) {
        const dims = this.engine.getDimensions();
        const capacity = this.engine.getNeuronCount();
        // 1. Assign each newly-declared neuron a real engine neuron id (names
        // seen in a prior materialize() call, or pinned via setNeuronId, keep
        // their existing id).
        const overflowed = [];
        for (const name of neurons.keys()) {
            if (this.nameToId.has(name))
                continue;
            if (this.nextId === this.queryNeuronId)
                this.nextId++;
            if (this.nextId >= capacity) {
                overflowed.push(name);
                continue;
            }
            this.nameToId.set(name, this.nextId);
            this.nextId++;
        }
        const nameToId = this.nameToId;
        // 2. @connections/@conections -> real connDiag weights between the
        // named neurons, across every content dimension.
        for (const [name, neuron] of neurons) {
            const targetId = nameToId.get(name);
            if (targetId === undefined)
                continue;
            for (const [otherName, weight] of neuron.connections) {
                const sourceId = nameToId.get(otherName);
                if (sourceId === undefined)
                    continue;
                for (let d = 1; d <= dims; d++) {
                    this.engine.setConnectionWeight(targetId, sourceId, d, weight);
                }
            }
        }
        // 3. @vale/@value -> nudge the neuron's share of the value budget
        // toward the requested fraction (one-shot delta; the allocator's own
        // zero-sum redistribution/decay keeps the total conserved afterward).
        if (this.valeAllocator) {
            for (const [name, neuron] of neurons) {
                if (neuron.vale === undefined)
                    continue;
                const id = nameToId.get(name);
                if (id === undefined)
                    continue;
                const current = this.valeAllocator.getValeFractions().get(String(id)) ?? 0;
                this.valeAllocator.updateNeuronValue(String(id), (neuron.vale - current) / 0.1);
            }
        }
        // 4. @definition/@definishon -> constraint-loss training samples.
        const definitionEntries = Array.from(neurons.entries()).filter(([name, n]) => n.definition.length > 0 && nameToId.has(name));
        if (definitionEntries.length === 0) {
            return { nameToId: new Map(nameToId), overflowed, converged: true, epochs: 0, losses: [], satisfied: [], conflicts: [] };
        }
        const trigger = definitionTrigger(dims);
        const definitions = definitionEntries.map(([name, neuron]) => ({
            driveNeuronId: this.queryNeuronId,
            input: trigger,
            readoutNeuronId: nameToId.get(name),
            target: embedText(neuron.definition, dims),
        }));
        const result = this.engine.trainDefinitions(definitions, opts);
        const idToName = new Map(Array.from(nameToId.entries()).map(([n, i]) => [i, n]));
        const satisfied = result.satisfied
            .map(id => idToName.get(id))
            .filter((n) => n !== undefined);
        const conflicts = result.conflicts.map(c => ({
            a: definitionEntries[c.a][0],
            b: definitionEntries[c.b][0],
            correlation: c.correlation,
        }));
        // 5. On successful satisfaction, raise (lock) that neuron's vale.
        if (this.valeAllocator) {
            for (const name of satisfied) {
                const id = nameToId.get(name);
                if (id !== undefined)
                    this.valeAllocator.updateNeuronValue(String(id), 5);
            }
        }
        return {
            nameToId: new Map(nameToId), overflowed,
            converged: result.converged,
            epochs: result.epochs,
            losses: result.losses,
            satisfied,
            conflicts,
        };
    }
}
/**
 * Materializes parsed NeuriLang directly into an ElasticCoreBlock. The runtime
 * keeps name→id bindings stable across calls, grows the block with addNeuron()
 * whenever a new parsed neuron needs capacity, installs explicit connection
 * scalars as diagonal Elastic Core connection blocks, maps @vale through the
 * shared ValueRangeAllocator, and turns @definition into a deterministic
 * readout target that callers can smoke-test with checkDefinition().
 */
export class ElasticNeuroLangRuntime {
    constructor(core, valeAllocator) {
        this.nameToId = new Map();
        this.nextId = 0;
        this.core = core;
        this.valeAllocator = valeAllocator;
    }
    setNeuronId(name, id) {
        this.nameToId.set(name, id);
        this.nextId = Math.max(this.nextId, id + 1);
    }
    materialize(neurons, opts = {}) {
        for (const name of neurons.keys())
            this.assignId(name);
        for (const [name, neuron] of neurons) {
            const targetId = this.nameToId.get(name);
            if (targetId === undefined)
                continue;
            for (const [otherName, weight] of neuron.connections) {
                const sourceId = this.assignId(otherName);
                this.core.setConnectionScalar(targetId, sourceId, weight);
            }
            if (neuron.vale !== undefined && this.valeAllocator) {
                const fractions = this.valeAllocator.getValeFractions();
                const current = fractions.get(String(targetId)) ?? 0;
                this.valeAllocator.updateNeuronValue(String(targetId), (neuron.vale - current) / 0.1);
            }
            if (neuron.definition.length > 0) {
                this.core.setDefinitionTarget(targetId, embedText(neuron.definition, this.core.getStateDim()));
            }
        }
        const definitionChecks = new Map();
        const satisfied = [];
        for (const [name, neuron] of neurons) {
            if (neuron.definition.length === 0)
                continue;
            const id = this.nameToId.get(name);
            if (id === undefined)
                continue;
            const check = this.core.checkDefinition(id, opts.definitionTolerance);
            definitionChecks.set(name, check);
            if (check.satisfied)
                satisfied.push(name);
        }
        return { nameToId: new Map(this.nameToId), definitionChecks, satisfied };
    }
    assignId(name) {
        const existing = this.nameToId.get(name);
        if (existing !== undefined)
            return existing;
        while (this.nextId >= this.core.getNeuronCount())
            this.core.addNeuron();
        const id = this.nextId++;
        this.nameToId.set(name, id);
        return id;
    }
}
