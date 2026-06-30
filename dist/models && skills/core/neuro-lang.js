/**
 * NeuriLang — custom neuron definition language interpreter.
 *
 * Syntax summary:
 *   name="example"                             — create neuron named "example"
 *   "name"@value="1.0"                         — set neuron's value
 *   "name"@connections=".other"*0.5+".third"*0.3  — set connections
 *   "name"@definition="text"                   — set definition
 *   "name"@code="code"                         — attach code
 *   code@name="calc"                           — create code-to-net neuron
 *   "netsearch"@net="location"                 — create netsearch neuron
 *   print "name"                               — print neuron info
 *
 * All neurons are connected by default (weight 0.1) unless an explicit
 * connection is specified.
 */
// ── Parser ────────────────────────────────────────────────────────────────────
export class NeuroLangInterpreter {
    // ── Public API ──────────────────────────────────────────────────────────────
    /**
     * Parse NeuriLang source code and return a ParseResult.
     * No connections are auto-added here — that happens in evaluate().
     */
    parse(source) {
        const neurons = new Map();
        const errors = [];
        const printOutputs = [];
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
        // ── "netsearch"@net="X" — create netsearch neuron ──────────────────────
        {
            const m = line.match(/^"netsearch"\s*@\s*net\s*=\s*"([^"]+)"$/);
            if (m) {
                const location = m[1];
                // Use the location as the neuron name for uniqueness
                const name = `netsearch:${location}`;
                const neuron = neurons.get(name) ?? this.defaultNeuron(name);
                neuron.isNetSearch = true;
                neuron.netLocation = location;
                neurons.set(name, neuron);
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
        // ── "X"@connections="..." — set connections ─────────────────────────────
        {
            const m = line.match(/^"([^"]+)"\s*@\s*connections\s*=\s*"([^"]*)"$/);
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
        // ── "X"@definition="..." — set definition ──────────────────────────────
        {
            const m = line.match(/^"([^"]+)"\s*@\s*definition\s*=\s*"([^"]*)"$/);
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
        // Split on '+' that is not inside a name (names cannot contain '+')
        const parts = spec.split('+');
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed)
                continue;
            // Each part: .name*weight  or  .name  (weight defaults to 1.0)
            const connMatch = trimmed.match(/^\.([A-Za-z0-9_:@\-. ]+?)(?:\s*\*\s*([\d.]+))?$/);
            if (!connMatch) {
                throw new Error(`Invalid connection segment "${trimmed}" in connections for "${sourceName}". ` +
                    `Expected format: .targetName*weight`);
            }
            const targetName = connMatch[1].trim();
            const weight = connMatch[2] !== undefined ? parseFloat(connMatch[2]) : 1.0;
            if (isNaN(weight)) {
                throw new Error(`Invalid weight "${connMatch[2]}" for connection ".${targetName}"`);
            }
            connections.set(targetName, weight);
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
