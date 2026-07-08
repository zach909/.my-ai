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
export interface NeuriNeuron {
    name: string;
    value: number;
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
