/**
 * NeuroClaw's network, on the phone.
 *
 * Not a port: this is the PC's own engine code (models && skills/core),
 * bundled into one Node-free file (see vite.config.ts and shims.ts) that runs
 * the same on Android (a hidden WebView) and iPhone (JavaScriptCore) --
 * cross-platform by being one codebase. What runs here:
 *
 *   - the all-to-all hyperdimensional mesh with the full equation (network
 *     weight and bias, waves, connection biases), sized for a phone;
 *   - the Zip Loop with its send neurons, which is how a message goes in and
 *     a reply comes out;
 *   - net-skill routing, which switches on the regions a message is about;
 *   - OneBrain, grafted into the mesh as its own region;
 *   - yes/no questions, each its own region.
 *
 * The bridge API is plain strings in and JSON strings out, so both native
 * sides can call it without sharing types.
 */
import "./shims";
import { Buffer } from "buffer";
import { HyperDimensionalEngine, ZipLoopInterface, ZIP_LOOP_DEFAULT_IDS } from "../../../models && skills/core/onebrain";
import { runUntilStoppedAsync, ZIP_FOLDERS } from "../../../models && skills/core/zip-halt";
import { NetSkillRouter } from "../../../models && skills/core/net-skill-router";
import { graftNetSkill, type SkillNeuron } from "../../../models && skills/core/net-skill-graft";
import { YesNoDoorway, type YesNoState } from "../../../models && skills/core/yes-no";

/** Base mesh size on the phone. The PC runs 64 hyper-neurons at 64 dims; a phone gets fewer. */
const PHONE_NEURONS = 32;
const PHONE_DIMENSIONS = 32;
/** Same prompt cap as the PC's generate(). */
const PROMPT_CHAR_CAP = 200;
/**
 * Tick budget for one message, input and output together. The PC uses 256;
 * on the phone that took 8 s on a desktop CPU once OneBrain made the mesh
 * active (each byte the network clocks out costs up to 24 ticks), so the
 * phone gets 64: ~3 s on a desktop CPU, and a reply of a few bytes.
 */
const MAX_TICKS = 64;
const SILENT_REPLY = "one brain has nothing trained to say here yet.";

interface Edge { from: number; to: number; weight: number }

/** OneBrain's (input byte -> output byte, weight) edges from its model.json. */
function oneBrainEdges(model: {
  neurons?: Array<[string, { id: string; label?: string }]>;
  connections?: Array<[string, { fromNeuronId: string; toNeuronId: string; weightIndex: number }]>;
  weights?: Array<number | null>;
}): Edge[] {
  const side = new Map<string, { input: boolean; byte: number }>();
  for (const [, n] of model.neurons ?? []) {
    const m = /^memory_(input|output)_b(\d+)$/.exec(n.label ?? "");
    if (m) side.set(n.id, { input: m[1] === "input", byte: Number(m[2]) });
  }
  const edges: Edge[] = [];
  for (const [, c] of model.connections ?? []) {
    const from = side.get(c.fromNeuronId);
    const to = side.get(c.toNeuronId);
    const w = model.weights?.[c.weightIndex];
    if (from?.input && to && !to.input && typeof w === "number") edges.push({ from: from.byte, to: to.byte, weight: w });
  }
  return edges;
}

const byteLabel = (b: number) => (b >= 32 && b < 127 ? String.fromCharCode(b) : `byte ${b}`);

class PhoneBrain {
  readonly engine: HyperDimensionalEngine;
  private readonly router = new NetSkillRouter(2, PHONE_DIMENSIONS);
  private readonly yesNo: YesNoDoorway;
  private oneBrain: Edge[] = [];
  /** modifiedAt of the OneBrain model loaded, so a sync can tell whether the PC's is newer. */
  oneBrainVersion = 0;
  /** Yes/no examples taught on the phone since the last sync, for the PC. */
  teachLog: Array<{ question: string; text: string; answer: boolean }> = [];
  private busy = false;

  constructor() {
    // The same full equation the PC's live pipeline runs (pipeline.ts):
    // every term on, so the phone computes what the PC computes, only smaller.
    this.engine = new HyperDimensionalEngine({
      neuronCount: PHONE_NEURONS,
      dimensions: PHONE_DIMENSIONS,
      ballStates: 8,
      stateTransitionThreshold: 0.4,
      noveltyDecay: 0.05,
      historyLength: 200,
      learningRate: 0.05,
      influenceDecay: 0.95,
      crossInfluenceStrength: 0.2,
      hyperGain: 1,
      hyperAdd: 1,
      hyperWaveGain: 1,
      hyperWaveAdd: 1,
      waveGain: 0.1,
      connectionBias: true,
      propagationSteps: 6,
    });
    this.yesNo = new YesNoDoorway(this.engine);
  }

  /** Put OneBrain into the mesh as its own region, and make it routable. */
  loadOneBrain(modelJson: string): { neurons: number; connections: number } {
    const model = JSON.parse(modelJson);
    this.oneBrain = oneBrainEdges(model);
    this.oneBrainVersion = typeof model.modifiedAt === "number" ? model.modifiedAt : 0;
    const nameOf = (side: string, b: number) => `OneBrain ${side} b${b}`;
    const neurons = new Map<string, SkillNeuron & { connections: Record<string, number> }>();
    for (const e of this.oneBrain) {
      for (const [side, b] of [["in", e.from], ["out", e.to]] as const) {
        const name = nameOf(side, b);
        if (!neurons.has(name)) neurons.set(name, { name, definition: `memory ${side === "in" ? "input" : "output"} ${JSON.stringify(byteLabel(b))}`, connections: {} });
      }
      neurons.get(nameOf("in", e.from))!.connections[nameOf("out", e.to)] = e.weight;
    }
    const graft = graftNetSkill(this.engine, "onebrain", [...neurons.values()]);
    this.router.register({ id: "onebrain", name: "OneBrain", meaning: "memory recall of learned patterns" });
    return { neurons: graft.added, connections: graft.connections };
  }

  /** OneBrain's strongest output bytes for `text`: the same recall the PC runs. */
  recall(text: string, topK = 5): string[] {
    const active = new Set(Array.from(Buffer.from(text, "utf-8")));
    const scores = new Map<number, number>();
    for (const e of this.oneBrain) if (active.has(e.from)) scores.set(e.to, (scores.get(e.to) ?? 0) + e.weight);
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK).map(([b]) => byteLabel(b));
  }

  /**
   * One message through the network: routing picks the regions it is about,
   * the prompt goes in through the Zip Loop (0, 1 and send), and whatever the
   * mesh writes to output/ comes back.
   */
  async chat(text: string): Promise<{ reply: string; trained: boolean; regions: string[]; recalled: string[]; ms: number }> {
    if (this.busy) throw new Error("The phone's network is still answering the last message.");
    this.busy = true;
    const started = Date.now();
    try {
      const regions = this.router.select(text).ids;
      const prompt = text.length > PROMPT_CHAR_CAP ? text.slice(0, PROMPT_CHAR_CAP) : text;
      const zip = new ZipLoopInterface(this.engine, ZIP_LOOP_DEFAULT_IDS);
      const run = await runUntilStoppedAsync(zip, { files: { [`${ZIP_FOLDERS.prompt}prompt.txt`]: prompt } }, { quietTicks: 8, maxTicks: MAX_TICKS });
      const written = Object.entries(run.tree?.files ?? {})
        .filter(([p]) => p.startsWith(ZIP_FOLDERS.output))
        .map(([, content]) => content)
        .join("\n")
        .trim();
      return {
        reply: written || SILENT_REPLY,
        trained: written.length > 0,
        regions,
        recalled: this.recall(text),
        ms: Date.now() - started,
      };
    } finally {
      this.busy = false;
    }
  }

  ask(question: string, text: string) { return this.yesNo.ask(question, text); }
  teach(question: string, text: string, answer: boolean) {
    const r = this.yesNo.teach(question, text, answer);
    this.teachLog.push({ question, text, answer });
    this.router.register({ id: `yes-no:${question.trim().toLowerCase()}`, name: question, meaning: question });
    return r;
  }

  stats() {
    return {
      neurons: this.engine.getNeuronCount(),
      dimensions: this.engine.getDimensions(),
      regions: this.router.listRegions().map((r) => r.id),
      oneBrainConnections: this.oneBrain.length,
      oneBrainVersion: this.oneBrainVersion,
      unsyncedExamples: this.teachLog.length,
      questions: this.yesNo.questions(),
    };
  }

  /** Everything the phone's network has learned, to save between app launches. */
  exportState(): string {
    return JSON.stringify({ network: this.engine.captureNetworkState(), yesNo: this.yesNo.toJSON(), teachLog: this.teachLog });
  }

  yesNoState(): YesNoState { return this.yesNo.toJSON(); }
  loadYesNo(state: YesNoState): void { this.yesNo.load(state); }

  importState(json: string): boolean {
    try {
      const saved = JSON.parse(json) as { network?: unknown; yesNo?: YesNoState; teachLog?: PhoneBrain["teachLog"] };
      if (saved.yesNo) this.yesNo.load(saved.yesNo);
      if (Array.isArray(saved.teachLog)) this.teachLog = saved.teachLog;
      return saved.network ? this.engine.restoreNetworkState(saved.network as never) : true;
    } catch {
      return false;
    }
  }
}

let brain: PhoneBrain | null = null;
const ok = (value: unknown) => JSON.stringify({ ok: true, value });
const fail = (err: unknown) => JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });

/**
 * The bridge the native apps call. Every function takes strings and returns a
 * JSON string ({ ok, value } or { ok: false, error }); chat is async and
 * returns a Promise of that string.
 */
const NeuroClawBrain = {
  init(oneBrainModelJson?: string, savedStateJson?: string): string {
    try {
      brain = new PhoneBrain();
      const oneBrain = oneBrainModelJson ? brain.loadOneBrain(oneBrainModelJson) : null;
      const restored = savedStateJson ? brain.importState(savedStateJson) : false;
      return ok({ ...brain.stats(), oneBrainGrafted: oneBrain, restored });
    } catch (err) { return fail(err); }
  },
  async chat(text: string): Promise<string> {
    try { if (!brain) throw new Error("init() first"); return ok(await brain.chat(String(text))); } catch (err) { return fail(err); }
  },
  ask(question: string, text: string): string {
    try { if (!brain) throw new Error("init() first"); return ok(brain.ask(question, text)); } catch (err) { return fail(err); }
  },
  teach(question: string, text: string, answer: boolean | string): string {
    try { if (!brain) throw new Error("init() first"); return ok(brain.teach(question, text, answer === true || answer === "true")); } catch (err) { return fail(err); }
  },
  stats(): string {
    try { if (!brain) throw new Error("init() first"); return ok(brain.stats()); } catch (err) { return fail(err); }
  },
  exportState(): string {
    try { if (!brain) throw new Error("init() first"); return ok(brain.exportState()); } catch (err) { return fail(err); }
  },
  /**
   * What the phone has for the PC: the yes/no examples taught here since the
   * last sync, and which OneBrain it runs. Pass `true` once the PC has them
   * to clear the log.
   */
  syncOut(clear?: boolean | string): string {
    try {
      if (!brain) throw new Error("init() first");
      const out = { teach: brain.teachLog.slice(), oneBrainVersion: brain.oneBrainVersion };
      if (clear === true || clear === "true") brain.teachLog = [];
      return ok(out);
    } catch (err) { return fail(err); }
  },
  /**
   * Apply what the PC sent back. A newer OneBrain from the PC rebuilds the
   * phone's network around it (the mesh's own short-term state starts over;
   * everything taught is kept); the PC's yes/no state -- which already
   * includes what this phone sent -- replaces the phone's.
   */
  syncIn(oneBrainModelJson?: string | null, yesNoStateJson?: string | null): string {
    try {
      if (!brain) throw new Error("init() first");
      let rebuilt = false;
      if (oneBrainModelJson) {
        const keepYesNo = brain.yesNoState();
        const keepLog = brain.teachLog;
        brain = new PhoneBrain();
        brain.loadOneBrain(oneBrainModelJson);
        brain.loadYesNo(keepYesNo);
        brain.teachLog = keepLog;
        rebuilt = true;
      }
      if (yesNoStateJson) brain.loadYesNo(JSON.parse(yesNoStateJson));
      return ok({ rebuilt, ...brain.stats() });
    } catch (err) { return fail(err); }
  },
};

(globalThis as Record<string, unknown>).NeuroClawBrain = NeuroClawBrain;
export default NeuroClawBrain;
