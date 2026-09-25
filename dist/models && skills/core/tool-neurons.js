/**
 * Plugin tools as neurons: the network's second set of outputs and inputs.
 *
 * The Zip Loop (ZipLoopInterface, onebrain.ts) is where you talk to the AI:
 * two input neurons for 1 and 0, two output neurons for 1 and 0, everything
 * zipped and streamed through them a bit at a time. That is one input and one
 * output. The network is meant to be multi-input, multi-output, and this is
 * the rest of it:
 *
 *   OUTPUTS -- one neuron per plugin tool. `terminal.write_file` is a neuron.
 *   `desktop.list_windows` is a neuron. When that neuron fires, that tool is
 *   called. And the other way round: when anything calls a tool -- a command
 *   typed in chat, code calling it by name -- the tool's neuron is driven, so
 *   the network feels the call it made rather than hearing about it second-
 *   hand. A tool call and its neuron firing are the same event.
 *
 *   INPUTS -- one result channel per plugin: its own pair of 1/0 neurons,
 *   separate from the chat doorway's. What a tool returned is zipped and
 *   streamed in there. So a result arrives on different neurons from where a
 *   person's words arrive, and the network can tell "the terminal answered"
 *   from "someone said something" by WHERE it came in, not by parsing it.
 *
 * ── Where a fired tool gets its arguments ───────────────────────────────
 *
 * A neuron firing is a decision, not a sentence: it says "write a file", and
 * cannot say which file or what goes in it. The arguments come from the other
 * side of the Zip Loop -- its output. The network's output archive already has
 * a plugins/ folder for asking the outside world to do things (zip-halt.ts);
 * a call's arguments are the file plugins/<plugin>/<tool>.json in it. The
 * neuron decides that the call happens; the zip output says what it is.
 *
 * Arguments written to the output with no firing neuron are NOT a call. The
 * neuron is the call. That also makes an untrained network safe by
 * construction for any tool that needs arguments: random activity can fire a
 * neuron, but it cannot also produce a valid gzip archive naming a command.
 *
 * ── What this does not do ───────────────────────────────────────────────
 *
 * It wires the neurons; it does not teach them. Like the Zip Loop's own
 * output neurons, a tool neuron fires usefully only once something (a hand-set
 * connection, gradient learning, Hebbian updates) has taught the network to
 * route activity there. What is guaranteed by construction is the plumbing:
 * a firing is seen on every tick, whoever drove the tick; a call becomes a
 * neuron event; and a result reaches its own input neurons.
 */
import { DoorwayLock } from "./doorway-lock.js";
import { MAX_MESH_NEURONS, waveForMeaning } from "./net-skill-graft.js";
import { packZip, ZIP_FOLDERS } from "./zip-halt.js";
/** The group every tool neuron of one plugin carries: the plugin's output layer. */
export const toolOutputGroup = (plugin) => `tool:${plugin}`;
/** The group a plugin's result-channel neurons carry: the plugin's input layer. */
export const toolInputGroup = (plugin) => `tool-result:${plugin}`;
/** Where, in the Zip Loop's output archive, the network writes a call's arguments. */
export const toolCallPath = (plugin, tool) => `${ZIP_FOLDERS.plugins}${plugin}/${tool}.json`;
/** Where, in the archive fed back in, a successful call's result sits. */
export const toolResultPath = (plugin, tool) => `${ZIP_FOLDERS.plugins}${plugin}/${tool}.result.json`;
/** Where a failed call's error sits -- the plugins/error/ folder zip-halt.ts already names for this. */
export const toolErrorPath = (plugin, tool) => `${ZIP_FOLDERS.errors}${plugin}/${tool}.json`;
// ─── Tuning ─────────────────────────────────────────────────────────────
/**
 * How far above the network's own mean energy a tool neuron must sit to count
 * as firing. The same measure, and the same value, as the Zip Loop's output
 * neurons use to count as speaking (SILENT_OUTPUT_RATIO): standing out from
 * the floor, not clearing a constant that suits one mesh size and not another.
 */
const DEFAULT_FIRE_RATIO = 1.5;
/**
 * An absolute floor under that, so a network that is entirely asleep -- every
 * neuron near zero, the mean near zero -- does not read its noise as calls.
 * Measured on a 22-neuron test mesh: a tool neuron wired from a driven input
 * at weight 2 sits at 0.16, its unwired siblings at 0.001.
 */
const DEFAULT_MIN_ENERGY = 1e-2;
/**
 * How much of a result goes back in.
 *
 * Every bit of it is one tick of the whole network -- measured on the live
 * mesh at over a second per input BYTE -- so a result is clipped hard before
 * it is packed. A command that printed a megabyte is not something the
 * network can hear in full; it hears the start and is told it was cut.
 */
const DEFAULT_MAX_RESULT_CHARS = 1024;
/**
 * Results waiting to go in. Past this, the oldest waiting one is dropped and
 * counted: a queue that only grows would feed the network results from an
 * hour ago, the same reasoning as PromptMeshFeed's one-deep queue.
 */
const DEFAULT_MAX_PENDING = 8;
/** Settle steps per input bit -- the same as the Zip Loop's ZIP_INPUT_STEPS, for the same reason. */
const RESULT_INPUT_STEPS = 2;
/** Calls remembered for inspection. */
const HISTORY_LIMIT = 200;
/** Neurons already given to a plugin, per engine: attaching twice must not keep growing the network. */
const allocations = new WeakMap();
function allocationsFor(engine) {
    let map = allocations.get(engine);
    if (!map) {
        map = new Map();
        allocations.set(engine, map);
    }
    return map;
}
function clip(value, max) {
    let text;
    try {
        text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
    }
    catch {
        text = String(value);
    }
    if (text.length <= max)
        return { value: typeof value === "string" ? value : safeParse(text) };
    return { value: text.slice(0, max), truncated: text.length - max };
}
function safeParse(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
export class ToolNeuronLayer {
    constructor(engine, options = {}) {
        this.engine = engine;
        this.neurons = new Map();
        this.channels = new Map();
        this.sources = new Map();
        this.unsubscribe = [];
        /** Tool neurons above the line on the last tick seen -- so a firing is a rising edge, not every tick it stays up. */
        this.lit = new Set();
        /** Firings not yet turned into calls, newest per tool. */
        this.latched = new Map();
        /** >0 while this layer is driving a tool neuron itself: that tick is the call being felt, not the network deciding. */
        this.selfDriving = 0;
        this.calls = [];
        /** Results waiting for the doorway, oldest first. */
        this.queue = [];
        this.pumping = null;
        this.stats = {
            fired: 0, networkCalls: 0, otherCalls: 0, resultsFed: 0, bytesFed: 0, dropped: 0, lastError: null,
        };
        this.pulseScratch = null;
        this.fireRatio = options.fireRatio ?? DEFAULT_FIRE_RATIO;
        this.minEnergy = options.minEnergy ?? DEFAULT_MIN_ENERGY;
        this.maxResultChars = options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
        this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
        this.lock = options.lock ?? new DoorwayLock();
        this.yieldTo = options.yieldTo ?? (() => new Promise(resolve => setImmediate(resolve)));
        this.access = options.access;
        this.stopWatching = engine.onTick(() => this.observeTick());
    }
    // ─── Wiring ───────────────────────────────────────────────────────────
    /**
     * Give a plugin its neurons: one output neuron per tool, and a result
     * channel of two input neurons. Then listen to every call it makes.
     *
     * Idempotent per engine: attaching the same plugin to the same network
     * again reuses the neurons it already has.
     */
    attach(source) {
        const plugin = source.getPluginId();
        const specs = source.getTools();
        const known = allocationsFor(this.engine);
        let added = 0;
        let allocation = known.get(plugin);
        if (!allocation) {
            const needed = specs.length + 2;
            if (this.engine.getNeuronCount() + needed > MAX_MESH_NEURONS) {
                return {
                    plugin,
                    tools: {},
                    channel: null,
                    added: 0,
                    skipped: `the network is full at ${MAX_MESH_NEURONS} neurons -- ${plugin}'s tools have no neurons`,
                };
            }
            const ids = this.engine.addNeurons(needed);
            if (ids.length !== needed) {
                return { plugin, tools: {}, channel: null, added: 0, skipped: "the network refused to grow" };
            }
            added = needed;
            const tools = {};
            specs.forEach((spec, index) => {
                const id = ids[index];
                tools[spec.name] = id;
                // Each tool its own wave, derived from what it does, so two tools are
                // distinguishable in the shared pool the way two grafted skill neurons are.
                const wave = waveForMeaning(`${plugin}.${spec.name}: ${spec.description}`);
                this.engine.setWaveSignature(id, wave.frequency, wave.phase);
                this.engine.setNeuronGroup(id, toolOutputGroup(plugin));
            });
            const channel = { plugin, bit0In: ids[specs.length], bit1In: ids[specs.length + 1] };
            // Perfect enemies, exactly like the chat doorway's 1 and 0 -- but on a
            // frequency of their own, so a result and a prompt arriving together
            // are two different waves in the pool rather than one.
            const frequency = waveForMeaning(`${plugin} results`).frequency;
            this.engine.setWaveSignature(channel.bit0In, frequency, 0);
            this.engine.setWaveSignature(channel.bit1In, frequency, Math.PI);
            this.engine.setNeuronGroup(channel.bit0In, toolInputGroup(plugin));
            this.engine.setNeuronGroup(channel.bit1In, toolInputGroup(plugin));
            allocation = { tools, channel };
            known.set(plugin, allocation);
        }
        for (const spec of specs) {
            const neuronId = allocation.tools[spec.name];
            if (neuronId === undefined)
                continue;
            const key = `${plugin}.${spec.name}`;
            this.neurons.set(key, { plugin, tool: spec.name, key, neuronId, spec });
        }
        this.channels.set(plugin, allocation.channel);
        if (!this.sources.has(plugin)) {
            this.sources.set(plugin, source);
            this.unsubscribe.push(source.onToolCall(event => this.record(event)));
        }
        return { plugin, tools: { ...allocation.tools }, channel: { ...allocation.channel }, added };
    }
    /** Stop watching the network and the plugins. The neurons stay -- they are part of the network now. */
    dispose() {
        this.stopWatching();
        for (const stop of this.unsubscribe.splice(0))
            stop();
        this.sources.clear();
    }
    /** Every tool neuron and result channel, for showing what the network's outputs and inputs are. */
    layout() {
        return {
            tools: [...this.neurons.values()].map(({ spec, ...rest }) => ({ ...rest, description: spec.description })),
            channels: [...this.channels.values()].map(c => ({ ...c })),
        };
    }
    neuronFor(plugin, tool) {
        return this.neurons.get(`${plugin}.${tool}`)?.neuronId;
    }
    channelFor(plugin) {
        const channel = this.channels.get(plugin);
        return channel ? { ...channel } : undefined;
    }
    // ─── Outputs: firing ──────────────────────────────────────────────────
    /**
     * Runs after every tick of the network, whoever drove it.
     *
     * A tool neuron that crosses the line latches a firing. Only the crossing
     * counts: a neuron that stays up for ten ticks asked once, not ten times.
     */
    observeTick() {
        if (this.neurons.size === 0)
            return;
        const line = this.firingLine();
        for (const neuron of this.neurons.values()) {
            const energy = this.engine.getNeuronEnergy(neuron.neuronId);
            if (energy <= line) {
                this.lit.delete(neuron.key);
                continue;
            }
            if (this.lit.has(neuron.key))
                continue;
            this.lit.add(neuron.key);
            // The layer driving a neuron to report a call already made is that call
            // being felt, not the network asking for another. Marked lit so the
            // tick after does not read it as a fresh rising edge either.
            if (this.selfDriving > 0)
                continue;
            this.stats.fired++;
            this.latched.set(neuron.key, {
                key: neuron.key, plugin: neuron.plugin, tool: neuron.tool, neuronId: neuron.neuronId, energy, line,
            });
        }
    }
    /** What a tool neuron must exceed to count as firing, right now. */
    firingLine() {
        const scaled = this.engine.meanNeuronEnergy() * this.fireRatio;
        return scaled > this.minEnergy ? scaled : this.minEnergy;
    }
    /**
     * A typed decision over every tool, read off the network as it stands.
     *
     * The Jev shape: a state goes in (whatever the network was last driven
     * with -- a prompt through the Zip Loop, a result on a channel), and what
     * comes out is not text but an answer per option: a probability for each
     * tool and whether it fires. Nothing is generated and nothing is ticked --
     * reading this costs one pass over the tool neurons, not a settle.
     *
     * score = energy / (energy + line). It is 0.5 exactly at the firing line,
     * so `score > 0.5` and "this neuron fires" are the same statement, and it
     * rises toward 1 the further a neuron stands above the network's floor.
     * Independent per tool, not a softmax: several tools can fire from one
     * state (multi-output), and none firing is a real answer.
     */
    decide() {
        const line = this.firingLine();
        const options = [...this.neurons.values()].map(neuron => {
            const energy = this.engine.getNeuronEnergy(neuron.neuronId);
            const total = energy + line;
            const score = total > 0 ? energy / total : 0;
            return {
                key: neuron.key,
                plugin: neuron.plugin,
                tool: neuron.tool,
                neuronId: neuron.neuronId,
                energy,
                score,
                fires: energy > line,
            };
        });
        options.sort((a, b) => b.score - a.score);
        return { line, options, chosen: options.filter(o => o.fires).map(o => o.key) };
    }
    /** Firings waiting to be acted on. Does not consume them. */
    fired() {
        return [...this.latched.values()].map(f => ({ ...f }));
    }
    /**
     * Turn the network's firings into calls.
     *
     * @param output  The Zip Loop's output archive -- where each call's
     *                arguments are. A fired tool with no arguments file there is
     *                called with none, which a tool that needs arguments refuses
     *                (and that refusal goes back in as the result).
     */
    async step(output = null) {
        const firings = [...this.latched.values()];
        this.latched.clear();
        const events = [];
        for (const firing of firings) {
            const neuron = this.neurons.get(firing.key);
            const source = this.sources.get(firing.plugin);
            if (!neuron || !source)
                continue;
            const args = this.argumentsFor(output, firing.plugin, firing.tool);
            if (typeof args === "string") {
                events.push(this.refuse(firing, args));
                continue;
            }
            if (this.access && neuron.spec.capability) {
                try {
                    this.access.require(neuron.spec.capability);
                }
                catch (err) {
                    events.push(this.refuse(firing, err instanceof Error ? err.message : String(err), args));
                    continue;
                }
            }
            // Through the plugin, so its observer -- this layer's record() -- sees
            // it exactly like any other call.
            events.push(await source.callTool(firing.tool, args, "network"));
        }
        return events;
    }
    /** The call's arguments from the output archive; {} when there are none; a string when they are unreadable. */
    argumentsFor(output, plugin, tool) {
        const raw = output?.files?.[toolCallPath(plugin, tool)];
        if (raw === undefined)
            return {};
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return `${toolCallPath(plugin, tool)} must hold a JSON object of arguments.`;
            }
            return parsed;
        }
        catch {
            return `${toolCallPath(plugin, tool)} is not valid JSON.`;
        }
    }
    /** A network call that never reached the tool. Still an event, still fed back: being refused is an outcome too. */
    refuse(firing, error, args = {}) {
        const now = Date.now();
        const event = {
            plugin: firing.plugin, tool: firing.tool, args, origin: "network", ok: false, error, startedAt: now, endedAt: now,
        };
        this.record(event);
        return event;
    }
    /**
     * Call a tool by name, as a neuron event.
     *
     * The same as the plugin's own callTool() -- which this layer is already
     * listening to -- spelled from the layer's side for a caller that holds the
     * layer rather than the plugin.
     */
    async call(plugin, tool, args = {}) {
        const source = this.sources.get(plugin);
        if (!source)
            throw new Error(`No plugin "${plugin}" is attached to the network's tool layer.`);
        return source.callTool(tool, args, "direct");
    }
    // ─── Inputs: results ──────────────────────────────────────────────────
    /**
     * Every finished call comes through here: remember it, make it a neuron
     * event, and send what came back into the plugin's own input neurons.
     *
     * Returns at once. The feeding is queued behind the doorway lock and
     * yields between bytes, because it costs seconds of mesh time and a chat
     * reply must not wait for the network to finish hearing a tool's output.
     */
    record(event) {
        const neuron = this.neurons.get(`${event.plugin}.${event.tool}`);
        const channel = this.channels.get(event.plugin);
        this.calls.push(event);
        if (this.calls.length > HISTORY_LIMIT)
            this.calls.splice(0, this.calls.length - HISTORY_LIMIT);
        if (event.origin === "network")
            this.stats.networkCalls++;
        else
            this.stats.otherCalls++;
        if (!channel)
            return;
        if (this.queue.length >= this.maxPending) {
            // The oldest waiting result goes: a network hearing results in order,
            // hopelessly behind, is worse off than one that skips to the latest.
            this.queue.shift();
            this.stats.dropped++;
        }
        this.queue.push({ event, neuronId: neuron?.neuronId, channel });
        if (!this.pumping)
            this.pumping = this.pump();
    }
    async pump() {
        try {
            while (this.queue.length > 0) {
                const job = this.queue.shift();
                await this.lock.run(async () => {
                    try {
                        // A call the network did not fire itself is felt on its neuron
                        // first: the call and the neuron firing are one event, whichever
                        // side it started from. A network call already fired its neuron.
                        if (job.neuronId !== undefined && job.event.origin !== "network")
                            this.driveOnce(job.neuronId);
                        await this.stream(job.channel, this.packResult(job.event));
                    }
                    catch (err) {
                        this.stats.lastError = err instanceof Error ? err.message : String(err);
                    }
                });
            }
        }
        finally {
            // Cleared here, inside the same turn the loop ends in, not in a
            // .finally() on the promise: a result recorded in the gap between the
            // two would see a pump still "running", queue behind it, and never go in.
            this.pumping = null;
        }
    }
    /** Resolves once every result queued so far has gone in. */
    async idle() {
        while (this.pumping)
            await this.pumping;
    }
    /** The archive a result goes back in as -- the same zipped shape as everything else that enters the network. */
    packResult(event) {
        const files = {};
        if (event.ok) {
            const { value, truncated } = clip(event.result, this.maxResultChars);
            files[toolResultPath(event.plugin, event.tool)] = JSON.stringify({
                tool: `${event.plugin}.${event.tool}`, origin: event.origin, args: event.args, result: value,
                ...(truncated ? { truncated } : {}),
            });
        }
        else {
            files[toolErrorPath(event.plugin, event.tool)] = JSON.stringify({
                tool: `${event.plugin}.${event.tool}`, origin: event.origin, args: event.args, error: event.error ?? "failed",
            });
        }
        return packZip({ files });
    }
    /** Drive one tool neuron for one short tick, read-only. */
    driveOnce(neuronId) {
        this.selfDriving++;
        const ceiling = this.engine.getPropagationSteps();
        this.engine.setPropagationSteps(RESULT_INPUT_STEPS);
        try {
            this.engine.process(this.pulse(), undefined, new Set([neuronId]), undefined, { learn: false });
        }
        finally {
            this.engine.setPropagationSteps(ceiling);
            this.selfDriving--;
        }
    }
    /**
     * Stream bytes in through one result channel, MSB first, one short
     * read-only tick per bit -- then learn once, from the whole result, the way
     * ZipLoopInterface.learnFromEvent() does for the chat doorway.
     */
    async stream(channel, bytes) {
        const one = new Set([channel.bit1In]);
        const zero = new Set([channel.bit0In]);
        const pulse = this.pulse();
        let last = null;
        const ceiling = this.engine.getPropagationSteps();
        for (const byte of bytes) {
            this.engine.setPropagationSteps(RESULT_INPUT_STEPS);
            try {
                for (let b = 7; b >= 0; b--) {
                    last = (byte >> b) & 1 ? one : zero;
                    this.engine.process(pulse, undefined, last, undefined, { learn: false });
                }
            }
            finally {
                this.engine.setPropagationSteps(ceiling);
            }
            await this.yieldTo();
        }
        // The whole result has arrived: this is the event. Re-driven with
        // learning on, at the full settle ceiling, while the input is still there.
        if (last)
            this.engine.process(pulse, undefined, last);
        this.stats.resultsFed++;
        this.stats.bytesFed += bytes.length;
        this.stats.lastError = null;
    }
    pulse() {
        if (!this.pulseScratch)
            this.pulseScratch = new Array(this.engine.getDimensions()).fill(1);
        return this.pulseScratch;
    }
    // ─── Inspection ───────────────────────────────────────────────────────
    history() {
        return this.calls.map(e => ({ ...e }));
    }
    getStats() {
        return { ...this.stats };
    }
}
