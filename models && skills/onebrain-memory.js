// OneBrain memory: the single self-authored memory model every
// self-extension is folded into, instead of each one living on as its own
// self_ext_N model. Shared by NeuroclawLLM (automatic folding at runtime)
// and extension-builder/merge-self-extensions.mjs (one-off merges).
//
// On-disk format is the self-extension one: neurons as [id, {label}] pairs
// labelled memory_input_<token> / memory_output_<token>, connections as
// [id, {fromNeuronId, toNeuronId, weightIndex}], weights[] in fp32. OneBrain
// adds weightCounts[]: how many samples each weight is the mean of, so a
// fold is an exact running average rather than letting the newest model
// outweigh everything learned before it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ONEBRAIN_ID = "onebrain";
export const ONEBRAIN_NAME = "OneBrain";
// Same symmetric 4-bit scheme as every existing model.q4.json:
// code = clamp(round(w / scale), -7, 7) + 7.
const Q_SCALE = Math.fround(2 / 15);
const Q_ZP = 7;
// meta.json keeps the most recent source ids for provenance; the total is
// kept separately so the file does not grow with every fold.
const MAX_LISTED_SOURCES = 100;

const IN_RE = /^(?:memory_input|mem_in)_(\d+)$/;
const OUT_RE = /^(?:memory_output|mem_out)_(\d+)$/;

/**
 * (inputToken -> outputToken, weight) edges of a self-extension, in either
 * on-disk format: the older one above, or the current ExtensionBuilder one
 * (neuron objects with `name` mem_in_/mem_out_, conn.weight).
 */
export function parseSelfExtension(json) {
    const m = typeof json === "string" ? JSON.parse(json) : json;
    const neurons = new Map();
    for (const entry of m.neurons ?? []) {
        const n = Array.isArray(entry) ? entry[1] : entry;
        const label = n.label ?? n.name ?? "";
        const inMatch = IN_RE.exec(label);
        const outMatch = OUT_RE.exec(label);
        if (inMatch)
            neurons.set(n.id, { side: "in", token: Number(inMatch[1]), value: n.value });
        else if (outMatch)
            neurons.set(n.id, { side: "out", token: Number(outMatch[1]), value: n.value });
    }
    const edges = [];
    for (const entry of m.connections ?? []) {
        const c = Array.isArray(entry) ? entry[1] : entry;
        const from = neurons.get(c.fromNeuronId ?? c.fromId ?? c.from);
        const to = neurons.get(c.toNeuronId ?? c.toId ?? c.to);
        const w = typeof c.weight === "number" ? c.weight : m.weights?.[c.weightIndex];
        if (from?.side === "in" && to?.side === "out" && typeof w === "number" && Number.isFinite(w)) {
            edges.push({ from: from.token, to: to.token, weight: w, fromValue: from.value, toValue: to.value });
        }
    }
    return edges;
}

export function emptyOneBrain(now = Date.now()) {
    return {
        id: "project_onebrain", name: ONEBRAIN_NAME,
        description: "OneBrain: every self-authored memory extension merged into one model",
        neurons: [], connections: [], layers: [], labels: [], apiOutputConfig: null,
        savedWithQuantization: false, createdAt: now, modifiedAt: now,
        weightCount: 0, weightFormat: "fp32", weights: [], weightCounts: [],
    };
}

/**
 * Fold `edges` into `model` in place: one neuron per token label, one
 * connection per (input, output) token pair whose weight is the running mean
 * of every sample folded in so far. Every edge occurrence is one sample.
 */
export function foldEdges(model, edges, now = Date.now()) {
    if (!Array.isArray(model.weightCounts) || model.weightCounts.length !== model.weights.length) {
        // A OneBrain written without counts: each weight stands for one sample.
        model.weightCounts = model.weights.map((w) => (w === null ? 0 : 1));
    }
    const neuronById = new Map(model.neurons.map(([id, n]) => [id, n]));
    const idByLabel = new Map(model.neurons.map(([id, n]) => [n.label, id]));
    const connIds = new Set(model.connections.map(([id]) => id));
    const connByPair = new Map();
    for (const [, c] of model.connections)
        connByPair.set(`${c.fromNeuronId}\0${c.toNeuronId}`, c);
    let nextNeuron = model.neurons.length;
    let nextConn = model.connections.length;
    const neuronFor = (label, layerIndex, value) => {
        let id = idByLabel.get(label);
        if (id)
            return id;
        while (neuronById.has(`neuron_c${nextNeuron}`))
            nextNeuron++;
        id = `neuron_c${nextNeuron++}`;
        const n = { id, label, position: { x: 0, y: 0 }, value: typeof value === "number" ? value : 0,
            layerIndex, inputs: [], outputs: [], properties: {} };
        model.neurons.push([id, n]);
        neuronById.set(id, n);
        idByLabel.set(label, id);
        return id;
    };
    for (const e of edges) {
        const fromId = neuronFor(`memory_input_${e.from}`, 0, e.fromValue);
        const toId = neuronFor(`memory_output_${e.to}`, 1, e.toValue);
        const key = `${fromId}\0${toId}`;
        const existing = connByPair.get(key);
        if (existing) {
            const i = existing.weightIndex;
            const n = model.weightCounts[i] ?? 0;
            const prev = typeof model.weights[i] === "number" ? model.weights[i] : 0;
            model.weights[i] = (prev * n + e.weight) / (n + 1);
            model.weightCounts[i] = n + 1;
            continue;
        }
        while (connIds.has(`conn_c${nextConn}`))
            nextConn++;
        const id = `conn_c${nextConn++}`;
        connIds.add(id);
        const c = { id, fromNeuronId: fromId, toNeuronId: toId, weightIndex: model.weights.length };
        model.connections.push([id, c]);
        model.weights.push(e.weight);
        model.weightCounts.push(1);
        connByPair.set(key, c);
        neuronById.get(fromId).outputs.push(toId);
        neuronById.get(toId).inputs.push(fromId);
    }
    model.weightCount = model.weights.length;
    model.modifiedAt = now;
    return model;
}

/** The installed 4-bit copy of a OneBrain model (Quantization.md: save exact, install quantized). */
export function quantizeOneBrain(model) {
    const { weightCounts, ...rest } = model;
    const q = model.weights.map((w) => (w === null ? null : Math.min(7, Math.max(-7, Math.round(w / Q_SCALE))) + Q_ZP));
    const packed = Math.ceil(q.length / 2);
    return {
        ...rest, savedWithQuantization: true, quantized: true,
        weightFormat: "int4", weightBits: 4, weights: q,
        quantScale: Q_SCALE, quantZeroPoint: Q_ZP,
        compressionNote: `4-bit packed (2 weights/byte), scale=${Q_SCALE.toFixed(6)}, zp=${Q_ZP}`,
        originalSizeFp32Bytes: q.length * 4, packedSizeBytes: packed,
        compressionRatio: packed ? ((q.length * 4) / packed).toFixed(2) : "0.00",
    };
}

/** OneBrain model + meta in `dir`, or null when there is none yet. */
export function readOneBrain(dir) {
    const modelPath = join(dir, ONEBRAIN_ID, "model.json");
    if (!existsSync(modelPath))
        return null;
    const model = JSON.parse(readFileSync(modelPath, "utf-8"));
    let meta = {};
    try { meta = JSON.parse(readFileSync(join(dir, ONEBRAIN_ID, "meta.json"), "utf-8")); } catch { /* no meta yet */ }
    return { model, meta };
}

/**
 * Write OneBrain (exact + 4-bit + meta) into `dir`/onebrain and make it the
 * only entry in `dir`/index.jsonl. `sources` are the ids just folded in.
 * Returns the serialized exact model.
 */
export function writeOneBrain(dir, model, prevMeta = {}, sources = [], now = Date.now()) {
    const outDir = join(dir, ONEBRAIN_ID);
    mkdirSync(outDir, { recursive: true });
    const listed = [...(prevMeta.sources ?? []), ...sources];
    const sourceCount = (prevMeta.sourceCount ?? (prevMeta.sources?.length ?? 0)) + sources.length;
    const meta = {
        id: ONEBRAIN_ID, name: ONEBRAIN_NAME,
        description: `OneBrain: ${sourceCount} self-authored extensions merged into one model`,
        createdAt: prevMeta.createdAt ?? now, updatedAt: now, prompt: ONEBRAIN_NAME,
        sourceCount, sources: listed.slice(-MAX_LISTED_SOURCES),
        neuronCount: model.neurons.length, connectionCount: model.connections.length,
    };
    model.description = meta.description;
    const serialized = JSON.stringify(model);
    writeFileSync(join(outDir, "model.json"), serialized, "utf-8");
    writeFileSync(join(outDir, "model.q4.json"), JSON.stringify(quantizeOneBrain(model)), "utf-8");
    writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
    writeFileSync(join(dir, "index.jsonl"), JSON.stringify({
        id: ONEBRAIN_ID, name: meta.name, description: meta.description, createdAt: meta.createdAt,
        prompt: ONEBRAIN_NAME, neuronCount: meta.neuronCount, connectionCount: meta.connectionCount,
    }) + "\n", "utf-8");
    return serialized;
}
