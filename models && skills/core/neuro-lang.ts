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
  connections: Map<string, number>; // target name → weight
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

// ── JSON serialisation helpers ────────────────────────────────────────────────

interface SerializedNeuron {
  name: string;
  value: number;
  connections: [string, number][];
  definition: string;
  code: string | null;
  isNetSearch: boolean;
  netLocation: string | null;
  isCodeNet: boolean;
}

// ── Parser ────────────────────────────────────────────────────────────────────

import { ValueRangeAllocator } from './value-range.js';

export interface ConstraintResult {
  neuron: string;
  loss: number;
  satisfied: boolean;
  locked: boolean;
}

export interface TrainConstraintsResult {
  iterations: number;
  converged: boolean;
  constraintResults: ConstraintResult[];
  conflicts: Array<[string, string]>;
}

/**
 * Constraint-loss trainer for the extension builder (Section 4).
 *
 * Each neuron with a definition and a non-zero value defines a "definishon"
 * contract: when that neuron alone receives external input (exclusive-input
 * clamp), the network must settle so that neuron's output equals its `value`.
 *
 * Training loop per iteration:
 *   1. For each constrained neuron: clamp to 1.0, all others 0; propagate
 *      to convergence; measure (output − target)^2 as constraint loss.
 *   2. Apply a delta-rule weight update toward satisfying each constraint.
 *   3. Detect conflicts: two constraints are conflicting when their losses
 *      move in strictly opposite directions across consecutive iterations
 *      (anti-correlated losses → the pair is reported as a conflict).
 *   4. When all constraint losses are below `tolerance`, stop (converged).
 */
export class ConstraintTrainer {
  private readonly tolerance: number;
  private readonly maxIterations: number;
  private readonly learningRate: number;

  constructor(opts: { tolerance?: number; maxIterations?: number; learningRate?: number } = {}) {
    this.tolerance = opts.tolerance ?? 0.01;
    this.maxIterations = opts.maxIterations ?? 500;
    this.learningRate = opts.learningRate ?? 0.05;
  }

  /**
   * @param neurons       Neuron map from the interpreter
   * @param valueAllocator  Optional vale budget — satisfied constraints lock
   *                        their neuron (raise vale to near-max, freeze it).
   *                        "Learn but don't forget" is a mechanical consequence.
   */
  train(neurons: Map<string, NeuriNeuron>, valueAllocator?: ValueRangeAllocator): TrainConstraintsResult {
    const names = Array.from(neurons.keys());
    // Only neurons with a definition AND a target value have contracts.
    const constrained = names.filter(n => {
      const neuron = neurons.get(n)!;
      return neuron.definition.trim() !== '' && neuron.value !== 0;
    });

    if (constrained.length === 0) {
      return { iterations: 0, converged: true, constraintResults: [], conflicts: [] };
    }

    // Track per-constraint loss history for conflict detection.
    const lossHistory = new Map<string, number[]>();
    for (const n of constrained) lossHistory.set(n, []);

    // Track which neurons have already been vale-locked to avoid re-locking.
    const locked = new Set<string>();

    let constraintResults: ConstraintResult[] = [];
    let iter = 0;
    let converged = false;

    for (; iter < this.maxIterations; iter++) {
      constraintResults = [];
      for (const targetName of constrained) {
        const { loss } = this.runConstraint(neurons, names, targetName);
        const satisfied = loss < this.tolerance;

        // Vale-lock on first satisfaction: freeze this neuron so future
        // training on other constraints cannot dislodge it.
        if (satisfied && !locked.has(targetName) && valueAllocator) {
          valueAllocator.lockNeuron(targetName);
          locked.add(targetName);
        }

        constraintResults.push({ neuron: targetName, loss, satisfied, locked: locked.has(targetName) });
        lossHistory.get(targetName)!.push(loss);
      }
      converged = constraintResults.every(r => r.satisfied);
      if (converged) break;
    }

    const conflicts = this.detectConflicts(constrained, lossHistory);
    return { iterations: iter + 1, converged, constraintResults, conflicts };
  }

  private runConstraint(
    neurons: Map<string, NeuriNeuron>,
    names: string[],
    targetName: string,
  ): { loss: number } {
    const target = neurons.get(targetName)!;
    const targetValue = target.value;

    // Clamp: target neuron = 1.0, all others = 0.
    const activations = new Map<string, number>();
    for (const n of names) activations.set(n, 0);
    activations.set(targetName, 1.0);

    // Propagate to convergence (up to 50 steps).
    for (let step = 0; step < 50; step++) {
      let maxDelta = 0;
      const next = new Map<string, number>();
      for (const n of names) {
        const neuron = neurons.get(n)!;
        let sum = activations.get(n)!;
        for (const [src, w] of neuron.connections) {
          const srcVal = activations.get(src) ?? 0;
          sum += srcVal * w;
        }
        // Keep the clamped input fixed for targetName after step 0.
        const out = n === targetName && step === 0 ? 1.0 : Math.tanh(sum);
        next.set(n, out);
        maxDelta = Math.max(maxDelta, Math.abs(out - activations.get(n)!));
      }
      for (const [n, v] of next) activations.set(n, v);
      if (maxDelta < 0.001) break;
    }

    const actual = activations.get(targetName)!;
    const loss = (actual - targetValue) * (actual - targetValue);
    const error = actual - targetValue;

    // Delta-rule: update incoming connection weights for the target neuron
    // in the direction that reduces its output error.
    for (const srcName of names) {
      if (srcName === targetName) continue;
      const srcNeuron = neurons.get(srcName)!;
      const srcAct = activations.get(srcName)!;
      const existingW = srcNeuron.connections.get(targetName) ?? 0;
      // Gradient: dL/dw = error * src_activation (straight delta rule).
      const update = -this.learningRate * error * srcAct;
      srcNeuron.connections.set(targetName, Math.max(-2, Math.min(2, existingW + update)));
    }

    return { loss };
  }

  private detectConflicts(
    constrained: string[],
    lossHistory: Map<string, number[]>,
  ): Array<[string, string]> {
    const conflicts: Array<[string, string]> = [];
    const minWindow = 5;

    for (let i = 0; i < constrained.length; i++) {
      for (let j = i + 1; j < constrained.length; j++) {
        const a = constrained[i]!;
        const b = constrained[j]!;
        const ha = lossHistory.get(a)!;
        const hb = lossHistory.get(b)!;
        const len = Math.min(ha.length, hb.length);
        if (len < minWindow) continue;

        // Check last `minWindow` steps for anti-correlation (one strictly
        // decreasing while the other strictly increasing).
        const wa = ha.slice(-minWindow);
        const wb = hb.slice(-minWindow);
        let aDown = 0, bDown = 0;
        for (let k = 1; k < minWindow; k++) {
          if (wa[k]! < wa[k - 1]!) aDown++;
          if (wb[k]! < wb[k - 1]!) bDown++;
        }
        // Fully anti-correlated: one always decreased, the other never did.
        if ((aDown === minWindow - 1 && bDown === 0) ||
            (bDown === minWindow - 1 && aDown === 0)) {
          conflicts.push([a, b]);
        }
      }
    }
    return conflicts;
  }
}

export class NeuroLangInterpreter {
  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Parse NeuriLang source code and return a ParseResult.
   * No connections are auto-added here — that happens in evaluate().
   */
  parse(source: string): ParseResult {
    const neurons = new Map<string, NeuriNeuron>();
    const errors: string[] = [];
    const printOutputs: string[] = [];

    const lines = source.split(/\r?\n/);

    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const raw = lines[lineNo];
      // Strip inline comments (-- ...) and trim whitespace
      const line = raw.replace(/--.*$/, '').trim();
      if (!line) continue;

      try {
        this.parseLine(line, neurons, printOutputs);
      } catch (err: unknown) {
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
  evaluate(result: ParseResult): Map<string, NeuriNeuron> {
    const neurons = result.neurons;
    const names = Array.from(neurons.keys());

    for (const srcName of names) {
      const src = neurons.get(srcName)!;
      for (const dstName of names) {
        if (dstName === srcName) continue;
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
        isCodeNet: n.isCodeNet,
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
        isCodeNet: Boolean(sn.isCodeNet),
      };
      neurons.set(neuron.name, neuron);
    }

    return { neurons, errors, printOutputs: [] };
  }

  /**
   * Section 9 — on-demand symbolic trace.
   *
   * Reconstructs the literal algebraic expression for one neuron's output by
   * walking backward through the weighted connections that fire for this query.
   * The mesh stays numeric for actual computation (fast); this is only
   * invoked when a human-readable explanation is requested.
   *
   * Returns a string like:
   *   "source1"*0.3 + "source2"*0.5 + ...  →  tanh(sum) = 0.71
   *
   * @param neurons     The fully-connected neuron map (after evaluate()).
   * @param targetName  The neuron whose output you want explained.
   * @param activations Optional settled activation values for display.
   *                    If absent, uses each neuron's `.value` field.
   */
  symbolicTrace(
    neurons: Map<string, NeuriNeuron>,
    targetName: string,
    activations?: Map<string, number>,
  ): string {
    const target = neurons.get(targetName);
    if (!target) return `[trace] Neuron "${targetName}" not found`;

    const val = (name: string): number =>
      activations?.get(name) ?? neurons.get(name)?.value ?? 0;

    const terms: string[] = [];
    let sum = 0;

    // connections map: source → weight (neuron receives from source at weight)
    for (const [src, w] of target.connections) {
      const srcVal = val(src);
      const contribution = w * srcVal;
      sum += contribution;
      const wStr = w.toFixed(3);
      const vStr = srcVal.toFixed(3);
      terms.push(`"${src}"(${vStr})×${wStr}`);
    }

    const output = Math.tanh(sum);
    const termsStr = terms.length > 0 ? terms.join(' + ') : '(no incoming connections)';
    return `tanh(${termsStr}) = tanh(${sum.toFixed(4)}) = ${output.toFixed(4)}`;
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
        if (isNaN(val)) throw new Error(`Invalid value "${m[2]}" for neuron "${name}"`);
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
        } else {
          printOutputs.push(this.formatNeuron(neuron));
        }
        return;
      }
    }

    // Unknown syntax — record as error via throw so caller can log line number
    throw new Error(`Unrecognised NeuriLang statement: "${line}"`);
  }

  // ── Parse connection string: .name*weight+.name*weight ... ─────────────────
  private parseConnections(spec: string, sourceName: string): Map<string, number> {
    const connections = new Map<string, number>();
    if (!spec.trim()) return connections;

    // Split on '+' that is not inside a name (names cannot contain '+')
    const parts = spec.split('+');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Each part: .name*weight  or  .name  (weight defaults to 1.0)
      const connMatch = trimmed.match(/^\.([A-Za-z0-9_:@\-. ]+?)(?:\s*\*\s*([\d.]+))?$/);
      if (!connMatch) {
        throw new Error(
          `Invalid connection segment "${trimmed}" in connections for "${sourceName}". ` +
          `Expected format: .targetName*weight`
        );
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
  private defaultNeuron(name: string): NeuriNeuron {
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
  private formatNeuron(n: NeuriNeuron): string {
    const connStr = Array.from(n.connections.entries())
      .map(([t, w]) => `.${t}*${w}`)
      .join('+');
    const flags: string[] = [];
    if (n.isCodeNet) flags.push('code-net');
    if (n.isNetSearch) flags.push(`netsearch:${n.netLocation}`);

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
