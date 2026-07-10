/**
 * NeuriLang — custom neuron definition language interpreter.
 *
 * Syntax summary:
 *   name="example"                             — create neuron named "example"
 *   "name"@value="1.0"                         — set neuron's value
 *   "name"@vale="0.9"                          — set neuron's vale (elasticity/resistance to change)
 *   "name"@connections=".other"*0.5+".third"*0.3  — set connections (alias: @conections=)
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
import type { HyperDimensionalEngine } from './hyperdimensional.js';
import type { ValueRangeAllocator } from './value-range.js';
export interface NeuriNeuron {
    name: string;
    value: number;
    /** Elasticity/resistance to change, [0,1]; undefined = not set by the DSL. */
    vale?: number;
    connections: Map<string, number>;
    definition: string;
    code: string | null;
    isNetSearch: boolean;
    netLocation: string | null;
    isCodeNet: boolean;
}
export interface ParseResult {
    neurons: Map<string, NeuriNeuron>;
    errors: string[];
    printOutputs: string[];
}
export declare class NeuroLangInterpreter {
    /**
     * Parse NeuriLang source code and return a ParseResult.
     * No connections are auto-added here — that happens in evaluate().
     */
    parse(source: string): ParseResult;
    /**
     * Add default connections from every neuron to every other neuron that
     * does not already have an explicit connection (weight = 0.1).
     * Returns the fully-connected neuron map.
     */
    evaluate(result: ParseResult): Map<string, NeuriNeuron>;
    /**
     * Serialise a neuron map to JSON.
     */
    toJSON(neurons: Map<string, NeuriNeuron>): string;
    /**
     * Deserialise a JSON string (produced by toJSON) into a ParseResult.
     * Errors and printOutputs are empty because they are not stored.
     */
    fromJSON(json: string): ParseResult;
    private parseLine;
    private parseConnections;
    private defaultNeuron;
    private formatNeuron;
}
export interface DefinitionConflict {
    a: string;
    b: string;
    correlation: number;
}
export interface LiveMaterializeResult {
    /** Declared neuron name -> the real engine neuron id it was assigned. */
    nameToId: Map<string, number>;
    /** Names that didn't fit in the engine's fixed neuron capacity. */
    overflowed: string[];
    converged: boolean;
    epochs: number;
    losses: number[];
    /** Names whose @definition constraint converged within tolerance. */
    satisfied: string[];
    conflicts: DefinitionConflict[];
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
export declare function embedText(text: string, dims: number): number[];
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
export declare class NeuroLangRuntime {
    private engine;
    private valeAllocator?;
    /** Reserved neuron id used as the shared "query" drive for @definition
     *  training — every declared neuron gets a different id starting after it. */
    private queryNeuronId;
    /**
     * Persists across materialize() calls on the same runtime, so re-running
     * DSL snippets (incremental sessions) reuses each name's already-assigned
     * engine neuron id instead of drifting to a new one every time. Also lets
     * two distinct DSL names be deliberately pinned to the same underlying
     * neuron via setNeuronId() (a synonym/alias), which is what makes two
     * separately-declared @definishon contracts able to genuinely conflict —
     * without this, every name gets its own readout and nothing can collide.
     */
    private nameToId;
    private nextId;
    constructor(engine: HyperDimensionalEngine, valeAllocator?: ValueRangeAllocator, queryNeuronId?: number);
    /** Pin a DSL name to a specific engine neuron id (e.g. to alias two
     *  declared names onto the same underlying neuron). */
    setNeuronId(name: string, id: number): void;
    materialize(neurons: Map<string, NeuriNeuron>, opts?: {
        epochs?: number;
        learningRate?: number;
        weightPenalty?: number;
        tolerance?: number;
    }): LiveMaterializeResult;
}
