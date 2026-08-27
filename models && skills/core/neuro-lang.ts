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
 *   "name"@role="input"                        — tag as this skill's input layer (alias: "output")
 *   code@name="calc"                           — create code-to-net neuron
 *   "netsearch"@name="idx"                     — create/select a netsearch neuron
 *   "netsearch"@corpus="text..."               — attach its training corpus
 *   "netsearch"@query="find x"                 — attach its search query text
 *   "netsearch"@net="location"                 — attach its search location
 *   print "name"                               — print neuron info
 *
 * @role tags a neuron as belonging to a skill's dedicated input or output
 * layer. It changes nothing about wiring — a tagged neuron is still an
 * ordinary neuron with ordinary default all-to-all connections into the
 * rest of the map (and, once installed, the rest of the shared mesh) — it
 * is purely a role label, the same pattern MoE experts already use
 * (models && skills/core/onebrain.ts's Expert.neuronIds). SkillLibrary.getIOLayers()
 * reads it back after install() to hand a skill's caller its input/output
 * neurons without needing to know their names in advance.
 *
 * @conections= and @definishon= are the DSL's canonical (deliberately
 * non-standard) spellings from the original neurolang.py; @connections=/
 * @definition= are accepted as the same primitive under a conventional
 * spelling. Both parse to the same NeuriNeuron fields.
 *
 * All neurons are connected by default (weight 0.1) unless an explicit
 * connection is specified.
 */

import type { HyperDimensionalEngine } from './onebrain.js';
import type { ValueRangeAllocator } from './value-range.js';
import type { ElasticCoreBlock, DefinitionCheckResult } from './elastic-core.js';
import { CodeToNetCompiler, CodeNet } from './code-to-net.js';
import type { CompileOptions, TestReport } from './code-to-net.js';
import { NetSearchEngine } from './net-search.js';
import type { NetSearchOptions, SearchResult } from './net-search.js';

export interface NeuriNeuron {
  name: string;
  value: number;
  /** Elasticity/resistance to change, [0,1]; undefined = not set by the DSL. */
  vale?: number;
  connections: Map<string, number>; // target name → weight
  definition: string;
  code: string | null;
  isNetSearch: boolean;
  netLocation: string | null;
  /** netsearch-only: the raw text corpus and query bound via `"netsearch"@corpus="..."`/`"netsearch"@query="..."` -- mirrors extension-builder/builder.js's NeuronData.corpus/.query so a project round-trips through parseNeuroLang()/exportToNeuroLang() without losing its net-search training data. */
  corpus: string;
  query: string;
  isCodeNet: boolean;
  /** Skill I/O layer tag, set via `"name"@role="input"`/`"output"`. Undefined = untagged (an ordinary interior neuron). */
  role?: 'input' | 'output';
}

export interface ParseResult {
  neurons: Map<string, NeuriNeuron>;
  errors: string[];
  printOutputs: string[];
}

// ── JSON serialisation helpers ────────────────────────────────────────────────

interface SerializedNeuron {
  name: string;
  value: number;
  connections: [string, number][];
  definition: string;
  code: string | null;
  isNetSearch: boolean;
  netLocation: string | null;
  corpus: string;
  query: string;
  isCodeNet: boolean;
  role?: 'input' | 'output';
}

/**
 * Cooperative yield: hands control back to the event loop so other pending
 * work (an HTTP request, a CLI prompt, a browser repaint) can run before the
 * next batch of parsing. Exported and reused by extension-builder/builder.js,
 * which use-builder.ts documents as running directly in the browser with no
 * Node dependencies -- setImmediate is Node-only (undefined in every major
 * browser), so a bare `setImmediate(resolve)` would throw ReferenceError the
 * first time a large enough parse crossed a yield threshold client-side.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

/** evaluate()'s O(n^2) default-connection fill yields after roughly this many neuron pairs, keeping the interval between yields bounded regardless of neuron count. */
const EVALUATE_YIELD_EVERY_PAIRS = 200_000;

// ── Parser ────────────────────────────────────────────────────────────────────

export class NeuroLangInterpreter {
  /** Parse-scoped: the pending `"netsearch"@name=` awaiting a `@net=`. */
  private pendingNetSearch: string | null = null;

  /** Behavioral Code-to-Net compiler + the nets compiled during the last parse. */
  private codeToNet = new CodeToNetCompiler();
  private codeNets = new Map<string, CodeNet>();

  /** Net Search engine + the neuron map from the last parse it searches over. */
  private netSearchEngine = new NetSearchEngine();
  private lastNeurons = new Map<string, NeuriNeuron>();

  /**
   * Bumped once per `"X"@code="..."` line that actually calls
   * codeToNet.compile() (~100ms of fully synchronous MLP training each,
   * see code-to-net.ts's fit()). parse() checks this after every line and
   * yields to the event loop whenever it changes, so a source string
   * packed with many `@code=` lines can't monopolize the process the way
   * NeuroclawTrainer.train() used to (see ARCHITECTURE.md) -- reachable
   * unauthenticated via POST /api/neuri and POST /api/extension/build,
   * both of which parse fully attacker-controlled source with no line cap.
   */
  private compileCallCount = 0;

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Parse NeuriLang source code and return a ParseResult.
   * No connections are auto-added here — that happens in evaluate().
   */
  async parse(source: string): Promise<ParseResult> {
    const neurons = new Map<string, NeuriNeuron>();
    const errors: string[] = [];
    const printOutputs: string[] = [];
    // Name of the most recently declared `"netsearch"@name=` that has not yet
    // been given a location, so a following `"netsearch"@net=` binds to it in
    // parse order rather than by Map iteration order.
    this.pendingNetSearch = null;
    this.codeNets.clear();

    const lines = source.split(/\r?\n/);

    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const raw = lines[lineNo];
      // Full-line '#' comments -- the convention exportToNeuroLang() (and
      // both the Python tracks, asi_core/neural_dsl.py and
      // model && skills manager/neurolang.py) actually write, unlike this
      // parser's own inline `-- ...` style. Without this, EVERY export
      // round-tripped back through parse() failed on line 1 (its own
      // `# NeuroLang export for ...` header), before a single real
      // statement was ever reached.
      if (raw.trim().startsWith('#')) continue;
      // A bare `dims = N` line (also emitted by exportToNeuroLang() as a
      // header) is metadata about the project's dimensionality, not a
      // neuron statement -- recognised and skipped rather than thrown as
      // "unrecognised syntax".
      if (/^dims\s*=\s*\d+$/i.test(raw.trim())) continue;
      // Strip inline comments (-- ...) and trim whitespace
      const line = raw.replace(/--.*$/, '').trim();
      if (!line) continue;

      const compilesBefore = this.compileCallCount;
      try {
        this.parseLine(line, neurons, printOutputs);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Line ${lineNo + 1}: ${msg} (source: "${raw.trim()}")`);
      }
      if (this.compileCallCount !== compilesBefore) await yieldToEventLoop();
    }

    this.lastNeurons = neurons;
    return { neurons, errors, printOutputs };
  }

  /**
   * Add default connections from every neuron to every other neuron that
   * does not already have an explicit connection (weight = 0.1).
   * Returns the fully-connected neuron map.
   *
   * O(n^2) over the parsed neuron count, fully unguarded by parse()'s
   * per-compile yield (this runs after parse() returns, and a plain
   * "X"@value="..." line never touches codeToNet.compile() at all) --
   * reachable unauthenticated via POST /api/neuri and POST
   * /api/extension/build with a source string of many cheap neuron
   * declarations, no @code= required. Yields to the event loop every
   * EVALUATE_YIELD_EVERY_PAIRS neuron pairs so it can't monopolize the
   * process the way the @code= compile loop used to (see ARCHITECTURE.md).
   */
  async evaluate(result: ParseResult): Promise<Map<string, NeuriNeuron>> {
    const neurons = result.neurons;
    const names = Array.from(neurons.keys());
    // Yield after roughly a fixed amount of pair-work rather than a fixed
    // outer-loop iteration count, so the interval between yields stays
    // bounded regardless of how many neurons were declared (a fixed outer
    // stride would mean O(n) work per interval, growing unboundedly with n).
    // The check itself must live in the *inner* loop: checking only once per
    // outer iteration still lets a single iteration's inner loop -- itself
    // names.length pair-operations -- run entirely unyielded whenever
    // names.length exceeds the threshold, which defeats the "bounded
    // regardless of n" guarantee for exactly the large-n case this exists
    // to protect against (unbounded via the CLI's `neuri` command, which
    // has no request-body size cap the way POST /api/neuri's 1MB limit does).
    let pairsSinceYield = 0;

    for (const srcName of names) {
      const src = neurons.get(srcName)!;
      for (const dstName of names) {
        if (dstName === srcName) continue;
        if (!src.connections.has(dstName)) {
          src.connections.set(dstName, 0.1);
        }
        pairsSinceYield++;
        if (pairsSinceYield >= EVALUATE_YIELD_EVERY_PAIRS) {
          pairsSinceYield = 0;
          await yieldToEventLoop();
        }
      }
    }

    return neurons;
  }

  // ── Code-to-Net (Section 21) — behavioral networks compiled from `@code` ──────

  /** The network compiled from a neuron's attached code, if any. */
  getCodeNet(name: string): CodeNet | undefined {
    return this.codeNets.get(name);
  }

  /** Names of neurons that produced a compiled Code-to-Net network. */
  codeNetNames(): string[] {
    return Array.from(this.codeNets.keys());
  }

  /** Evaluate a compiled code-net on numeric inputs. */
  evaluateCodeNet(name: string, inputs: number[]): number[] | undefined {
    return this.codeNets.get(name)?.evaluate(inputs);
  }

  /** Test a compiled code-net against its original source code. */
  testCodeNet(name: string, opts?: CompileOptions): TestReport | undefined {
    const net = this.codeNets.get(name);
    if (!net) return undefined;
    return this.codeToNet.testAgainst(net, net.source, opts);
  }

  // ── Net Search (Section 22) — search the project's own neural structures ──────

  /** Reindex the Net Search engine from the last-parsed neuron map. */
  private refreshNetSearchIndex(): void {
    this.netSearchEngine.clear();
    for (const n of this.lastNeurons.values()) {
      const flags: string[] = [];
      if (n.isCodeNet) flags.push('code-net');
      if (n.isNetSearch) flags.push('netsearch');
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
  netSearch(query: string, opts?: NetSearchOptions): SearchResult[] {
    this.refreshNetSearchIndex();
    return this.netSearchEngine.search(query, opts);
  }

  /** Teach the neural search mode query→structure associations (persists across searches). */
  trainNetSearch(pairs: Array<{ query: string; name: string }>): void {
    this.netSearchEngine.train(pairs);
  }

  /** The declared `"netsearch"@name=` bindings and their `@net=` locations. */
  getNetSearchBindings(): Array<{ name: string; location: string | null }> {
    const out: Array<{ name: string; location: string | null }> = [];
    for (const n of this.lastNeurons.values()) {
      if (n.isNetSearch) out.push({ name: n.name, location: n.netLocation });
    }
    return out;
  }

  /**
   * A skill's dedicated input/output neuron layers -- every neuron tagged
   * `@role="input"`/`"output"` in the given map, split accordingly. The
   * neurons themselves are unremarkable: still wired all-to-all into the
   * rest of the map by evaluate() like everything else, so this is a
   * read-back of role labels, not a separate wiring boundary -- the same
   * "grouping is a label, not a wiring restriction" pattern MoE experts
   * use (models && skills/core/onebrain.ts).
   */
  getIOLayers(neurons: Map<string, NeuriNeuron>): { inputs: NeuriNeuron[]; outputs: NeuriNeuron[] } {
    const inputs: NeuriNeuron[] = [];
    const outputs: NeuriNeuron[] = [];
    for (const n of neurons.values()) {
      if (n.role === 'input') inputs.push(n);
      else if (n.role === 'output') outputs.push(n);
    }
    return { inputs, outputs };
  }

  /**
   * Serialise a neuron map to JSON.
   */
  toJSON(neurons: Map<string, NeuriNeuron>): string {
    const serialized: SerializedNeuron[] = [];
    for (const [, n] of neurons) {
      serialized.push({
        name: n.name,
        value: n.value,
        connections: Array.from(n.connections.entries()),
        definition: n.definition,
        code: n.code,
        isNetSearch: n.isNetSearch,
        netLocation: n.netLocation,
        corpus: n.corpus,
        query: n.query,
        isCodeNet: n.isCodeNet,
        role: n.role,
      });
    }
    return JSON.stringify(serialized, null, 2);
  }

  /**
   * Deserialise a JSON string (produced by toJSON) into a ParseResult.
   * Errors and printOutputs are empty because they are not stored.
   */
  fromJSON(json: string): ParseResult {
    const neurons = new Map<string, NeuriNeuron>();
    const errors: string[] = [];

    let parsed: SerializedNeuron[];
    try {
      parsed = JSON.parse(json) as SerializedNeuron[];
    } catch (err: unknown) {
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
      const neuron: NeuriNeuron = {
        name: sn.name,
        value: typeof sn.value === 'number' ? sn.value : 0,
        connections: new Map<string, number>(
          Array.isArray(sn.connections) ? sn.connections : []
        ),
        definition: typeof sn.definition === 'string' ? sn.definition : '',
        code: typeof sn.code === 'string' ? sn.code : null,
        isNetSearch: Boolean(sn.isNetSearch),
        netLocation: typeof sn.netLocation === 'string' ? sn.netLocation : null,
        corpus: typeof sn.corpus === 'string' ? sn.corpus : '',
        query: typeof sn.query === 'string' ? sn.query : '',
        isCodeNet: Boolean(sn.isCodeNet),
        role: sn.role === 'input' || sn.role === 'output' ? sn.role : undefined,
      };
      neurons.set(neuron.name, neuron);
    }

    return { neurons, errors, printOutputs: [] };
  }

  // ── Private parser internals ─────────────────────────────────────────────────

  private parseLine(
    line: string,
    neurons: Map<string, NeuriNeuron>,
    printOutputs: string[]
  ): void {
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
        // `@net=` is always the LAST of the netsearch statements a producer
        // emits (see extension-builder/builder.js's exportToNeuroLang:
        // name, corpus, query, net, in that order) -- clearing the pending
        // pointer here, not on @corpus=/@query=, is what lets all three
        // bind to the same declaration.
        this.pendingNetSearch = null;
        return;
      }
    }

    // ── "netsearch"@corpus="X" — attach a net-search training corpus ───────
    {
      const m = line.match(/^"netsearch"\s*@\s*corpus\s*=\s*"([^"]*)"$/);
      if (m) {
        const target = this.resolvePendingNetSearch(neurons);
        target.corpus = m[1];
        return;
      }
    }

    // ── "netsearch"@query="X" — attach the search query text ───────────────
    {
      const m = line.match(/^"netsearch"\s*@\s*query\s*=\s*"([^"]*)"$/);
      if (m) {
        const target = this.resolvePendingNetSearch(neurons);
        target.query = m[1];
        return;
      }
    }

    // ── "X"@value="N" — set value ───────────────────────────────────────────
    {
      const m = line.match(/^"([^"]+)"\s*@\s*value\s*=\s*"([^"]+)"$/);
      if (m) {
        const name = m[1];
        const val = parseFloat(m[2]);
        if (isNaN(val)) throw new Error(`Invalid value "${m[2]}" for neuron "${name}"`);
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
        if (isNaN(val)) throw new Error(`Invalid vale "${m[2]}" for neuron "${name}"`);
        const neuron = neurons.get(name) ?? this.defaultNeuron(name);
        neuron.vale = Math.max(0, Math.min(1, val));
        neurons.set(name, neuron);
        return;
      }
    }

    // ── "X"@role="input"|"output" — tag as a skill I/O layer neuron ────────
    {
      const m = line.match(/^"([^"]+)"\s*@\s*role\s*=\s*"(input|output)"$/);
      if (m) {
        const name = m[1];
        const neuron = neurons.get(name) ?? this.defaultNeuron(name);
        neuron.role = m[2] as 'input' | 'output';
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
        } catch { /* leave as a stored code string only */ }
        this.compileCallCount++;
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
        } else {
          printOutputs.push(this.formatNeuron(neuron));
        }
        return;
      }
    }

    // Unknown syntax — record as error via throw so caller can log line number
    throw new Error(`Unrecognised NeuriLang statement: "${line}"`);
  }

  /**
   * Resolve the netsearch declaration that a following `@corpus=`/`@query=`
   * statement (no line-order guarantee relative to each other, but both
   * always following their `@name=`) should attach to -- the same
   * "bind to the pending named netsearch definition, in parse order"
   * resolution `@net=` above uses, factored out so all three attributes
   * agree on which neuron they're describing.
   */
  private resolvePendingNetSearch(neurons: Map<string, NeuriNeuron>): NeuriNeuron {
    const pending = this.pendingNetSearch;
    let target = pending ? neurons.get(pending) : undefined;
    if (!target) {
      // No `"netsearch"@name=` seen yet this parse -- fall back to a
      // synthetic holder rather than silently discarding the statement, so
      // out-of-order NeuroLang (@corpus= before @name=) still round-trips.
      const name = 'netsearch:pending';
      target = neurons.get(name) ?? this.defaultNeuron(name);
      target.isNetSearch = true;
      neurons.set(target.name, target);
      this.pendingNetSearch = target.name;
    }
    return target;
  }

  // ── Parse connection string: .name*weight+.name*weight ... ─────────────────
  private parseConnections(spec: string, sourceName: string): Map<string, number> {
    const connections = new Map<string, number>();
    if (!spec.trim()) return connections;

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
    let lastTarget: string | null = null;
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // A bare number is the additive `+weight` term for the previous edge. It
      // must start with a digit so a dotted target like `.5` (an edge to a
      // neuron named "5") is still parsed as a connection, not an additive.
      const additive = trimmed.match(/^([0-9][0-9.]*)$/);
      if (additive) {
        if (lastTarget === null) {
          throw new Error(`Leading additive weight "${trimmed}" has no target in connections for "${sourceName}"`);
        }
        const add = parseFloat(additive[1]);
        if (isNaN(add)) throw new Error(`Invalid additive weight "${trimmed}" for "${sourceName}"`);
        connections.set(lastTarget, (connections.get(lastTarget) ?? 0) + add);
        continue;
      }

      // .target[/variable][*bias]
      const connMatch = trimmed.match(/^\.([A-Za-z0-9_:@\-. ]+?)(?:\/([A-Za-z0-9_]+))?(?:\s*\*\s*([\d.]+))?$/);
      if (!connMatch) {
        throw new Error(
          `Invalid connection segment "${trimmed}" in connections for "${sourceName}". ` +
          `Expected format: .targetName[/variable][*weight]`
        );
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
  private defaultNeuron(name: string): NeuriNeuron {
    return {
      name,
      value: 0,
      connections: new Map(),
      definition: '',
      code: null,
      isNetSearch: false,
      netLocation: null,
      corpus: '',
      query: '',
      isCodeNet: false,
    };
  }

  // ── Format a neuron for print output ───────────────────────────────────────
  private formatNeuron(n: NeuriNeuron): string {
    const connStr = Array.from(n.connections.entries())
      .map(([t, w]) => `.${t}*${w}`)
      .join('+');
    const flags: string[] = [];
    if (n.isCodeNet) flags.push('code-net');
    if (n.isNetSearch) flags.push(`netsearch:${n.netLocation}`);
    if (n.role) flags.push(`role:${n.role}`);

    return (
      `[Neuron "${n.name}"] ` +
      `value=${n.value} ` +
      `connections=[${connStr || 'none'}] ` +
      `definition="${n.definition}" ` +
      `code=${n.code !== null ? `"${n.code}"` : 'null'} ` +
      (flags.length > 0 ? `flags=[${flags.join(',')}]` : '')
    ).trim();
  }
}

// ── Live materialization (Section 2.3) ───────────────────────────────────────

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

export interface ElasticMaterializeResult {
  nameToId: Map<string, number>;
  definitionChecks: Map<string, DefinitionCheckResult>;
  satisfied: string[];
}

/**
 * Deterministic text -> vector, so the same text always produces the same
 * training target without needing an external embedding model.
 *
 * This hashes overlapping character n-grams (n = 3..5, with start/end
 * markers) into dimensions with signed accumulation, rather than hashing the
 * whole string once per dimension. The distinction matters: a whole-string
 * hash is a content-addressed *random point*, so the vector carries no
 * geometry at all -- measured on the previous implementation, cos("cat",
 * "cats") was 0.02 and cos("king", "queen") was -0.13, i.e. related text
 * landed no closer than unrelated text and only exact identity scored. Every
 * consumer that compares or trains on these vectors (interface/runner.ts
 * feeds one straight into the brain as the live input representation) was
 * therefore working in a space where distance meant nothing.
 *
 * Sharing n-grams now genuinely places text closer together, so distance is
 * a real signal about relatedness. This is surface/morphological geometry,
 * not learned semantic geometry -- "king" and "queen" share no n-grams and
 * stay far apart. Meaning-level structure has to come from the mesh's own
 * training on top of this; the point here is that the input space has usable
 * structure for that training to build on instead of being noise.
 *
 * Two properties of the old implementation are deliberately preserved:
 * short or low-diversity strings still disperse across dimensions rather
 * than collapsing, and distinct text still lands on distinct targets. The
 * output is scaled so per-component RMS matches the old uniform-[-1,1)
 * distribution (1/sqrt(3)), keeping magnitudes in the range existing
 * definition-training tolerances were tuned against; scaling cannot affect
 * cosine similarity, so the geometry above is unchanged by it.
 */
/** Who said it. The two sides of a conversation, kept apart. */
export type Speaker = "ai" | "user";

/**
 * How a turn is written down, and how it is shown. Not exported: callers want
 * formatTurn(), and an exported constant nothing outside calls is how dead
 * code starts looking finished.
 */
const SPEAKER_LABELS: Record<Speaker, string> = { ai: "AI", user: "User" };

/**
 * One turn, written the way the conversation reads: "AI: ..." / "User: ...".
 *
 * The label is part of the text on purpose. Continuous learning trains on real
 * exchanges, and a transcript that does not say who spoke is a transcript of
 * nobody -- the network sees the words and has no way to learn that answering
 * and being asked are different things.
 */
export function formatTurn(speaker: Speaker, text: string): string {
  return `${SPEAKER_LABELS[speaker]}: ${text}`;
}

/**
 * A turn as the network sees it: the words, plus who said them.
 *
 * Dimension 0 is the speaker and nothing else -- +1 for the AI, -1 for the
 * user -- and the words occupy the rest. The engine already reserves state[0]
 * as an input flag, so a reserved coordinate is the shape this architecture
 * already thinks in.
 *
 * A label in the text is not enough on its own, and that is measured rather
 * than assumed: at 16 dimensions "AI: <long message>" and "User: <same long
 * message>" embed at cosine 0.96, because the prefix is three character
 * n-grams out of hundreds. Mixing in a hashed speaker marker only reached
 * 0.93 -- at this few dimensions two hashed vectors are not far enough apart
 * to separate anything. A dedicated coordinate is: the same words from
 * different speakers come out orthogonal, whatever the message length, so the
 * network can always tell a question from an answer.
 *
 * The label stays in the text as well, because the transcript is also read by
 * people, and "AI: ..." / "User: ..." is how a conversation reads.
 */
export function embedTurn(speaker: Speaker, text: string, dims: number): number[] {
  if (dims <= 0) return [];
  if (dims === 1) return [speaker === "ai" ? 1 : -1];

  const content = embedText(formatTurn(speaker, text), dims - 1);

  // The speaker gets the same energy as everything that was said, which is what
  // makes the two orthogonal rather than merely distinguishable. Weaker and a
  // long message drowns it out again -- the exact failure this replaces.
  let contentNorm = 0;
  for (const v of content) contentNorm += v * v;
  const speakerAmplitude = contentNorm > 0 ? Math.sqrt(contentNorm) : 1;

  const out = new Array(dims);
  out[0] = (speaker === "ai" ? 1 : -1) * speakerAmplitude;
  for (let d = 1; d < dims; d++) out[d] = content[d - 1];

  // Readout neurons are tanh-bounded, so a target outside [-1, 1] is
  // unreachable and training against it can never converge. Scaling is
  // uniform, so it cannot disturb the orthogonality above.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 1) for (let d = 0; d < dims; d++) out[d] /= peak;
  return out;
}

/**
 * A stretch of conversation as the network sees it, speakers included.
 *
 * The continuous loop drains everything queued since its last tick and embeds
 * it as one thing. It used to join those with a space and embed the result,
 * which threw away the boundary AND who said each part -- so the mind that
 * "never stops" was thinking about an anonymous run-on sentence.
 *
 * Dimension 0 carries who has been talking: +1 if it is all the AI, -1 if it
 * is all the user, and in between when the batch is a genuine exchange. That
 * makes a back-and-forth distinguishable from a monologue, which is most of
 * what a conversation is.
 */
export function embedTranscript(turns: Array<{ speaker: Speaker; text: string }>, dims: number): number[] {
  if (dims <= 0) return [];
  if (turns.length === 0) return new Array(dims).fill(0);
  if (turns.length === 1) return embedTurn(turns[0].speaker, turns[0].text, dims);

  // Newline-joined, not space-joined: where one turn ends and the next begins
  // is part of what happened.
  const text = turns.map(t => formatTurn(t.speaker, t.text)).join("\n");
  if (dims === 1) {
    let sum = 0;
    for (const t of turns) sum += t.speaker === "ai" ? 1 : -1;
    return [sum / turns.length];
  }

  const content = embedText(text, dims - 1);
  let contentNorm = 0;
  for (const v of content) contentNorm += v * v;
  const amplitude = contentNorm > 0 ? Math.sqrt(contentNorm) : 1;

  let sum = 0;
  for (const t of turns) sum += t.speaker === "ai" ? 1 : -1;

  const out = new Array(dims);
  out[0] = (sum / turns.length) * amplitude;
  for (let d = 1; d < dims; d++) out[d] = content[d - 1];

  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 1) for (let d = 0; d < dims; d++) out[d] /= peak;
  return out;
}

export function embedText(text: string, dims: number): number[] {
  const vec = new Array(dims).fill(0);
  if (text.length === 0 || dims === 0) return vec;
  // Boundary markers so a prefix/suffix is distinguishable from an interior
  // match ("cat" at the start of a word is not the same feature as "cat" in
  // the middle of "concatenate").
  const marked = `\u0002${text}\u0003`;
  for (let n = 3; n <= 5; n++) {
    if (n > marked.length) break;
    for (let i = 0; i + n <= marked.length; i++) {
      let h = 2166136261;
      for (let k = i; k < i + n; k++) {
        h ^= marked.charCodeAt(k);
        h = Math.imul(h, 16777619);
      }
      const u = h >>> 0;
      // Signed accumulation (the standard hashing-trick sign bit) keeps
      // collisions from systematically inflating a dimension.
      vec[u % dims] += (u & 0x80000000) !== 0 ? -1 : 1;
    }
  }
  let norm = 0;
  for (let d = 0; d < dims; d++) norm += vec[d] * vec[d];
  if (norm === 0) {
    // Every n-gram cancelled out, or the text was shorter than the smallest
    // n-gram. Fall back to a whole-string hash so distinct text still gets a
    // distinct, non-zero vector -- the one property the old version did have.
    for (let d = 0; d < dims; d++) {
      let h = 2166136261 ^ Math.imul(d, 2654435761);
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      vec[d] = ((h >>> 0) / 0xffffffff) * 2 - 1;
    }
    return vec;
  }
  // Unit-normalize, then scale back up toward the old per-component RMS of
  // 1/sqrt(3) -- but never past the point where any component would exceed 1.
  // Readout neurons are tanh-bounded to [-1, 1], so a target outside that
  // range is unreachable and training against it can never converge. Short
  // text concentrates its few n-grams into few dimensions, and scaling that
  // for RMS parity alone pushed peak components to 4.6 for a 2-character
  // string. The cap only ever shrinks the vector uniformly, so the cosine
  // geometry above is unaffected.
  const invNorm = 1 / Math.sqrt(norm);
  let maxAbsUnit = 0;
  for (let d = 0; d < dims; d++) maxAbsUnit = Math.max(maxAbsUnit, Math.abs(vec[d]) * invNorm);
  const scale = Math.min(Math.sqrt(dims / 3), 1 / maxAbsUnit) * invNorm;
  for (let d = 0; d < dims; d++) vec[d] *= scale;
  return vec;
}

/** A fixed, concept-agnostic "recall your definition" drive vector shared by
 *  every @definishon constraint. Deliberately the same for every neuron:
 *  distinguishing meaning has to come from each readout's *learned weights*
 *  (trained per-neuron below), not from feeding a different input per
 *  concept — which would make even truly incompatible definitions trivially
 *  "solvable" as just another input-conditional case instead of a real
 *  conflict. */
function definitionTrigger(dims: number): number[] {
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
  private engine: HyperDimensionalEngine;
  private valeAllocator?: ValueRangeAllocator;
  /** Reserved neuron id used as the shared "query" drive for @definition
   *  training — every declared neuron gets a different id starting after it. */
  private queryNeuronId: number;
  /**
   * Persists across materialize() calls on the same runtime, so re-running
   * DSL snippets (incremental sessions) reuses each name's already-assigned
   * engine neuron id instead of drifting to a new one every time. Also lets
   * two distinct DSL names be deliberately pinned to the same underlying
   * neuron via setNeuronId() (a synonym/alias), which is what makes two
   * separately-declared @definishon contracts able to genuinely conflict —
   * without this, every name gets its own readout and nothing can collide.
   */
  private nameToId: Map<string, number> = new Map();
  private nextId: number;

  constructor(engine: HyperDimensionalEngine, valeAllocator?: ValueRangeAllocator, queryNeuronId: number = 0) {
    this.engine = engine;
    this.valeAllocator = valeAllocator;
    this.queryNeuronId = queryNeuronId;
    this.nextId = queryNeuronId === 0 ? 1 : 0;
  }

  /** Pin a DSL name to a specific engine neuron id (e.g. to alias two
   *  declared names onto the same underlying neuron). */
  setNeuronId(name: string, id: number): void {
    this.nameToId.set(name, id);
  }

  materialize(
    neurons: Map<string, NeuriNeuron>,
    opts: {
      epochs?: number; learningRate?: number; weightPenalty?: number; tolerance?: number;
      /** 'delta' (default): the analytic tanh-derivative delta rule. 'random':
       *  random-search/evolution-strategy updates -- see
       *  HyperDimensionalEngine.trainDefinitionsRandomSearch()'s doc comment. */
      method?: 'delta' | 'random';
    } = {}
  ): LiveMaterializeResult {
    const dims = this.engine.getDimensions();
    const capacity = this.engine.getNeuronCount();

    // 1. Assign each newly-declared neuron a real engine neuron id (names
    // seen in a prior materialize() call, or pinned via setNeuronId, keep
    // their existing id).
    const overflowed: string[] = [];
    for (const name of neurons.keys()) {
      if (this.nameToId.has(name)) continue;
      if (this.nextId === this.queryNeuronId) this.nextId++;
      if (this.nextId >= capacity) { overflowed.push(name); continue; }
      this.nameToId.set(name, this.nextId);
      this.nextId++;
    }
    const nameToId = this.nameToId;

    // 2. @connections/@conections -> real connDiag weights between the
    // named neurons, across every content dimension.
    for (const [name, neuron] of neurons) {
      const targetId = nameToId.get(name);
      if (targetId === undefined) continue;
      for (const [otherName, weight] of neuron.connections) {
        const sourceId = nameToId.get(otherName);
        if (sourceId === undefined) continue;
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
        if (neuron.vale === undefined) continue;
        const id = nameToId.get(name);
        if (id === undefined) continue;
        const current = this.valeAllocator.getValeFractions().get(String(id)) ?? 0;
        this.valeAllocator.updateNeuronValue(String(id), (neuron.vale - current) / 0.1);
      }
    }

    // 4. @definition/@definishon -> constraint-loss training samples.
    const definitionEntries = Array.from(neurons.entries()).filter(
      ([name, n]) => n.definition.length > 0 && nameToId.has(name)
    );
    if (definitionEntries.length === 0) {
      return { nameToId: new Map(nameToId), overflowed, converged: true, epochs: 0, losses: [], satisfied: [], conflicts: [] };
    }

    const trigger = definitionTrigger(dims);
    const definitions = definitionEntries.map(([name, neuron]) => ({
      driveNeuronId: this.queryNeuronId,
      input: trigger,
      readoutNeuronId: nameToId.get(name)!,
      target: embedText(neuron.definition, dims),
    }));
    const result = opts.method === 'random'
      ? this.engine.trainDefinitionsRandomSearch(definitions, opts)
      : this.engine.trainDefinitions(definitions, opts);

    const idToName = new Map(Array.from(nameToId.entries()).map(([n, i]) => [i, n]));
    const satisfied = result.satisfied
      .map(id => idToName.get(id))
      .filter((n): n is string => n !== undefined);
    const conflicts: DefinitionConflict[] = result.conflicts.map(c => ({
      a: definitionEntries[c.a][0],
      b: definitionEntries[c.b][0],
      correlation: c.correlation,
    }));

    // 5. On successful satisfaction, raise (lock) that neuron's vale.
    if (this.valeAllocator) {
      for (const name of satisfied) {
        const id = nameToId.get(name);
        if (id !== undefined) this.valeAllocator.updateNeuronValue(String(id), 5);
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
  private core: ElasticCoreBlock;
  private valeAllocator?: ValueRangeAllocator;
  private nameToId: Map<string, number> = new Map();
  private nextId = 0;

  constructor(core: ElasticCoreBlock, valeAllocator?: ValueRangeAllocator) {
    this.core = core;
    this.valeAllocator = valeAllocator;
  }

  setNeuronId(name: string, id: number): void {
    this.nameToId.set(name, id);
    this.nextId = Math.max(this.nextId, id + 1);
  }

  materialize(neurons: Map<string, NeuriNeuron>, opts: { definitionTolerance?: number } = {}): ElasticMaterializeResult {
    for (const name of neurons.keys()) this.assignId(name);

    for (const [name, neuron] of neurons) {
      const targetId = this.nameToId.get(name);
      if (targetId === undefined) continue;

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

    const definitionChecks = new Map<string, DefinitionCheckResult>();
    const satisfied: string[] = [];
    for (const [name, neuron] of neurons) {
      if (neuron.definition.length === 0) continue;
      const id = this.nameToId.get(name);
      if (id === undefined) continue;
      const check = this.core.checkDefinition(id, opts.definitionTolerance);
      definitionChecks.set(name, check);
      if (check.satisfied) satisfied.push(name);
    }

    return { nameToId: new Map(this.nameToId), definitionChecks, satisfied };
  }

  private assignId(name: string): number {
    const existing = this.nameToId.get(name);
    if (existing !== undefined) return existing;
    while (this.nextId >= this.core.getNeuronCount()) this.core.addNeuron();
    const id = this.nextId++;
    this.nameToId.set(name, id);
    return id;
  }
}
