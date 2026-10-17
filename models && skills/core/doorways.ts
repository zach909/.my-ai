/**
 * More doorways into the mesh than the Zip Loop.
 *
 * The Zip Loop is one doorway: two bit neurons and a ramp in, the same out.
 * Anything else the AI should be able to take in or give out -- audio, an
 * image, a sensor, a file, a terminal -- is another doorway of exactly the same
 * kind, on its own neurons, declared by an extension from the Extension
 * Builder. A doorway here is a ZipLoopInterface on six fresh neurons, so every
 * one of them speaks the same bit-level language, and nothing in between turns
 * the bytes into anything else: no tokenizer, no outside embedding, no
 * speech-to-text. A kind is a label for people and for routing ("audio",
 * "image"); it never changes how the bytes go in.
 *
 * Declaring is free and happens at load. Neurons are only added to the mesh
 * when a doorway is first used, because every neuron is wired to every other
 * and a doorway nobody ever uses should not make the whole network slower.
 *
 * An extension declares them in its file:
 *
 *   "io": {
 *     "inputs":  [{ "name": "mic",    "kind": "audio" }],
 *     "outputs": [{ "name": "speaker", "kind": "audio" }]
 *   }
 *
 * The same name on both sides is one doorway that goes both ways.
 */

import { ZipLoopInterface, type HyperDimensionalEngine } from "./onebrain.js";
import { DoorwayLock } from "./doorway-lock.js";

export type DoorwayDirection = "in" | "out" | "both";

export interface DoorwaySpec {
  name: string;
  kind: string;
  direction: DoorwayDirection;
  /** Where it was declared, e.g. the extension's name. */
  source?: string;
}

export interface DoorwayInfo extends DoorwaySpec {
  /** Whether its neurons are in the mesh yet. */
  open: boolean;
  /** The neuron ids it owns, once open. */
  neurons: number[];
  bytesIn: number;
  bytesOut: number;
}

export class DoorwayError extends Error {}

/** The Zip Loop is the main doorway and is not declared through here. */
const RESERVED = new Set(["zip-loop", "zip"]);
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const KIND = /^[a-z0-9][a-z0-9_.-]{0,29}$/;
/** Every neuron is wired to every other, so the number of doorways is bounded. */
export const MAX_DOORWAYS = 16;
/** One call's worth. At one tick per bit a large message takes a long time to say, so it is bounded too. */
export const MAX_SEND_BYTES = 1 << 20;
export const MAX_RECEIVE_BYTES = 1 << 20;
/** A doorway's neurons: bit 0 and bit 1 in, bit 0 and bit 1 out, ramp in, ramp out. */
const NEURONS_PER_DOORWAY = 6;

interface Opened {
  zip: ZipLoopInterface;
  neurons: number[];
}

/** Neurons already given to a doorway, per engine: opening one twice must not keep growing the network. */
const openedByEngine = new WeakMap<object, Map<string, Opened>>();

export class DoorwayRegistry {
  private readonly specs = new Map<string, DoorwaySpec>();
  private readonly counts = new Map<string, { bytesIn: number; bytesOut: number }>();

  /**
   * @param engine  The mesh, or null while it has not been built.
   * @param lock    Shared with anything else driving the same engine's doorways,
   *                so two callers never settle one engine at once.
   */
  constructor(
    private readonly engine: () => HyperDimensionalEngine | null,
    private readonly lock: DoorwayLock = new DoorwayLock(),
  ) {}

  /** Declare one doorway. Declaring the same one again is fine; the same name as something else is not. */
  declare(input: { name: string; kind: string; direction: DoorwayDirection; source?: string }): DoorwayInfo {
    const name = String(input.name ?? "").trim().toLowerCase();
    const kind = String(input.kind ?? "").trim().toLowerCase();
    if (!NAME.test(name)) throw new DoorwayError(`"${input.name}" is not a usable doorway name (letters, digits, - and _, up to 40).`);
    if (RESERVED.has(name)) throw new DoorwayError(`"${name}" is the built-in Zip Loop doorway and cannot be declared again.`);
    if (!KIND.test(kind)) throw new DoorwayError(`"${input.kind}" is not a usable doorway kind (for example "audio" or "image").`);
    if (input.direction !== "in" && input.direction !== "out" && input.direction !== "both") {
      throw new DoorwayError(`Direction must be "in", "out" or "both".`);
    }

    const existing = this.specs.get(name);
    if (existing) {
      if (existing.kind !== kind) {
        throw new DoorwayError(`Doorway "${name}" is already a "${existing.kind}" doorway; it cannot also be "${kind}".`);
      }
      // Widening is allowed (an input-only doorway that another extension also writes to).
      if (existing.direction !== input.direction) existing.direction = "both";
      return this.info(name);
    }
    if (this.specs.size >= MAX_DOORWAYS) {
      throw new DoorwayError(`There are already ${MAX_DOORWAYS} doorways, the most the mesh will carry.`);
    }
    this.specs.set(name, { name, kind, direction: input.direction, source: input.source });
    this.counts.set(name, { bytesIn: 0, bytesOut: 0 });
    return this.info(name);
  }

  /**
   * Declare everything an extension's `io` block asks for. Anything in it that
   * is not usable is skipped and reported, so one bad entry does not cost the
   * extension its other doorways.
   */
  declareFromExtension(source: string, io: unknown): { declared: DoorwayInfo[]; skipped: Array<{ entry: unknown; reason: string }> } {
    const declared: DoorwayInfo[] = [];
    const skipped: Array<{ entry: unknown; reason: string }> = [];
    if (!io || typeof io !== "object") return { declared, skipped };
    const block = io as { inputs?: unknown; outputs?: unknown };

    const merged = new Map<string, { name: string; kind: string; in: boolean; out: boolean }>();
    const take = (list: unknown, side: "in" | "out"): void => {
      if (list === undefined) return;
      if (!Array.isArray(list)) { skipped.push({ entry: list, reason: `"${side === "in" ? "inputs" : "outputs"}" must be a list.` }); return; }
      for (const entry of list) {
        const e = entry as { name?: unknown; kind?: unknown } | null;
        if (!e || typeof e.name !== "string" || typeof e.kind !== "string") {
          skipped.push({ entry, reason: "Each doorway needs a text name and a text kind." });
          continue;
        }
        const key = e.name.trim().toLowerCase();
        const have = merged.get(key) ?? { name: e.name, kind: e.kind, in: false, out: false };
        if (have.kind.trim().toLowerCase() !== e.kind.trim().toLowerCase()) {
          skipped.push({ entry, reason: `"${e.name}" is declared with two different kinds.` });
          continue;
        }
        have[side] = true;
        merged.set(key, have);
      }
    };
    take(block.inputs, "in");
    take(block.outputs, "out");

    for (const m of merged.values()) {
      try {
        declared.push(this.declare({ name: m.name, kind: m.kind, direction: m.in && m.out ? "both" : m.in ? "in" : "out", source }));
      } catch (err) {
        skipped.push({ entry: m, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return { declared, skipped };
  }

  list(): DoorwayInfo[] {
    return Array.from(this.specs.keys(), name => this.info(name)).sort((a, b) => a.name.localeCompare(b.name));
  }

  has(name: string): boolean {
    return this.specs.has(name.trim().toLowerCase());
  }

  /** Put raw bytes into a doorway, bit by bit. Nothing turns them into tokens. */
  async send(name: string, bytes: Uint8Array): Promise<{ bytes: number }> {
    const spec = this.require(name);
    if (spec.direction === "out") throw new DoorwayError(`Doorway "${spec.name}" only sends out; nothing can be put into it.`);
    if (bytes.length === 0) return { bytes: 0 };
    if (bytes.length > MAX_SEND_BYTES) throw new DoorwayError(`That is ${bytes.length} bytes; one call may carry at most ${MAX_SEND_BYTES}.`);
    return this.lock.run(() => {
      const opened = this.open(spec.name);
      opened.zip.sendBytes(bytes);
      const counts = this.counts.get(spec.name)!;
      counts.bytesIn += bytes.length;
      return { bytes: bytes.length };
    });
  }

  /**
   * Read up to `count` bytes the mesh is saying on a doorway. Fewer come back
   * when the network stops sending (its ramp stops flipping), which is how it
   * ends a message.
   */
  async receive(name: string, count: number): Promise<Uint8Array> {
    const spec = this.require(name);
    if (spec.direction === "in") throw new DoorwayError(`Doorway "${spec.name}" only takes input; nothing can be read from it.`);
    if (!Number.isInteger(count) || count <= 0) throw new DoorwayError("Ask for a whole number of bytes, at least 1.");
    if (count > MAX_RECEIVE_BYTES) throw new DoorwayError(`One call may read at most ${MAX_RECEIVE_BYTES} bytes.`);
    return this.lock.run(() => {
      const opened = this.open(spec.name);
      const out = opened.zip.receiveBytes(count);
      this.counts.get(spec.name)!.bytesOut += out.length;
      return out;
    });
  }

  private require(name: string): DoorwaySpec {
    const key = String(name ?? "").trim().toLowerCase();
    const spec = this.specs.get(key);
    if (!spec) throw new DoorwayError(`There is no doorway "${name}".`);
    return spec;
  }

  /** Give the doorway its neurons the first time it is used. */
  private open(name: string): Opened {
    const engine = this.engine();
    if (!engine) throw new DoorwayError("The mesh has not been built yet, so there is nothing to open a doorway into.");
    let byName = openedByEngine.get(engine);
    if (!byName) { byName = new Map(); openedByEngine.set(engine, byName); }
    const have = byName.get(name);
    if (have) return have;

    const neurons = engine.addNeurons(NEURONS_PER_DOORWAY);
    if (neurons.length !== NEURONS_PER_DOORWAY) throw new DoorwayError("The mesh would not grow to hold the doorway.");
    const [bit0In, bit1In, bit0Out, bit1Out, toggleIn, toggleOut] = neurons;
    const zip = new ZipLoopInterface(engine, { bit0In, bit1In, bit0Out, bit1Out, toggleIn, toggleOut });
    const opened = { zip, neurons };
    byName.set(name, opened);
    return opened;
  }

  private info(name: string): DoorwayInfo {
    const spec = this.specs.get(name)!;
    const engine = this.engine();
    const opened = engine ? openedByEngine.get(engine)?.get(name) : undefined;
    const counts = this.counts.get(name) ?? { bytesIn: 0, bytesOut: 0 };
    return { ...spec, open: !!opened, neurons: opened ? [...opened.neurons] : [], ...counts };
  }
}
