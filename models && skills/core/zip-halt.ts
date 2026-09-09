/**
 * How an all-connected network stops.
 *
 * Every neuron is wired to every other neuron, so there is no last layer to
 * fall out of. Signal goes in, bounces, and keeps bouncing. That is the point
 * of the architecture and it is also the problem: a network like this has no
 * natural moment of being finished. Something has to end the run, and if that
 * something is a timer then the answer is always "however long we guessed",
 * never "as long as the work took".
 *
 * So the network stops itself.
 *
 * Output comes back through the two output neurons as a stream of bits, and
 * those bits reassemble into an archive with folders in it -- the same shape
 * that went in. One of those folders is `plugins/`, and the network asking to
 * stop means writing a stop call into it. The halt is a thing the network
 * produced, not a thing done to it.
 *
 * Producing the stop call is not enough on its own. If bits are still arriving
 * it is plainly not finished -- it wrote the stop and kept typing, which means
 * the stop was part of a larger output rather than the end of one. So the run
 * ends when both are true: a stop call has appeared, AND the output has gone
 * quiet for long enough that "still emitting" is ruled out. Whichever comes
 * later wins, which is the conservative direction: stopping a network that is
 * still producing loses work, and running a little past the end costs ticks.
 *
 * There is still a ceiling, and it is not a substitute for any of the above.
 * A network that has not been TAUGHT to emit a stop call will never emit one,
 * and something has to keep that from running forever. Hitting the ceiling is
 * a different outcome from stopping, and this reports it as one, because a run
 * that was cut off and a run that finished are not the same result and code
 * that treats them alike will eventually ship a truncated answer as an answer.
 *
 * Everything goes in and out zipped because that is what makes "multiple files
 * and folders and complex things" expressible through two neurons: the archive
 * is already a byte stream, and a byte stream is already bits.
 */

import { gzipSync, gunzipSync } from "node:zlib";

/**
 * The folders the network sees, on the way in and on the way out.
 *
 * A folder per kind of thing, because they are different kinds of thing. A
 * prompt is what is being asked; a plug-in is a capability with its own
 * instructions; a prompting skill is guidance about HOW to go about it. Flatten
 * them into one pile and nothing downstream can tell which is which.
 */
export const ZIP_FOLDERS = {
  /** The prompt, and any files that came with it. */
  prompt: "prompt/",
  /**
   * Plug-ins: one folder each, holding that plug-in's instructions and
   * whatever else it carries. Also where the network asks the outside world to
   * do something -- including to stop.
   */
  plugins: "plugins/",
  /** What came back from those calls, including the ones that went wrong. */
  errors: "plugins/error/",
  /**
   * Prompting skills: specialised instructions for how to go about something.
   * Selecting one puts it here, in the same archive as everything else, rather
   * than injecting it into the prompt where it would be indistinguishable from
   * what was actually asked.
   *
   * Not to be confused with a NET skill, which has no folder here at all: a net
   * skill is neurons wired directly into the mesh, part of the network rather
   * than something handed to it.
   */
  promptingSkills: "prompting-skills/",
  /**
   * Chat history from other conversations -- the network's past across
   * sessions, not just the exchange it is in the middle of. A folder like any
   * other, so being handed your own history comes through the same doorway as
   * everything else rather than through a side channel.
   */
  memory: "memory/",
  /**
   * The network's own working state -- what every neuron had coming into it
   * when the last run stopped. Kept apart from memory/ on purpose: one is the
   * conversation, the other is the mesh's internal condition, and a folder
   * that mixed them would make "what was said" and "what the network was
   * holding" indistinguishable to anything reading it back.
   */
  state: "state/",
  /** What it produced. */
  output: "output/",
} as const;

/** The file whose existence means "I am done". */
export const STOP_CALL = `${ZIP_FOLDERS.plugins}stop`;

export interface ZipTree {
  /** Path (including its folder prefix) -> text contents. */
  files: Record<string, string>;
  /**
   * Path -> raw bytes, base64.
   *
   * A recording, an image, a compiled thing: files that are not text still go
   * straight in as files. Everything here becomes bits at the doorway anyway,
   * so there is no reason a file should have to be described in words first --
   * transcribing a recording to text before the network sees it throws away
   * everything about it except the words.
   *
   * Kept as a separate map rather than smuggled into files as base64 strings,
   * so nothing downstream has to guess whether a value is text that looks like
   * base64 or bytes that happen to decode as letters.
   */
  binary?: Record<string, string>;
}

/**
 * Pack a tree into the byte stream that goes through the input neurons.
 *
 * Deterministic: the same tree produces the same bytes, so a run can be
 * repeated and two runs can be compared. A serialisation that depends on key
 * insertion order makes every downstream comparison quietly unreliable.
 */
export function packZip(tree: ZipTree): Uint8Array {
  const ordered: Record<string, string> = {};
  for (const key of Object.keys(tree.files).sort()) ordered[key] = tree.files[key];
  const payload: { files: Record<string, string>; binary?: Record<string, string> } = { files: ordered };
  if (tree.binary && Object.keys(tree.binary).length > 0) {
    const orderedBinary: Record<string, string> = {};
    for (const key of Object.keys(tree.binary).sort()) orderedBinary[key] = tree.binary[key];
    payload.binary = orderedBinary;
  }
  return new Uint8Array(gzipSync(Buffer.from(JSON.stringify(payload), "utf8")));
}

/**
 * Unpack bytes coming back out of the output neurons.
 *
 * A partial or corrupt stream is normal here rather than exceptional: the run
 * is being read WHILE it is still being produced, so most reads land mid-
 * archive. That is not an error and must not be raised as one -- it just means
 * there is nothing readable yet.
 */
export function unpackZip(bytes: Uint8Array): ZipTree | null {
  if (bytes.length === 0) return null;
  try {
    const parsed = JSON.parse(gunzipSync(Buffer.from(bytes)).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const files = (parsed as { files?: unknown }).files;
    if (!files || typeof files !== "object") return null;
    const out: Record<string, string> = {};
    for (const [path, content] of Object.entries(files as Record<string, unknown>)) {
      if (typeof content === "string") out[path] = content;
    }

    const rawBinary = (parsed as { binary?: unknown }).binary;
    if (!rawBinary || typeof rawBinary !== "object") return { files: out };
    const binary: Record<string, string> = {};
    for (const [path, content] of Object.entries(rawBinary as Record<string, unknown>)) {
      if (typeof content === "string") binary[path] = content;
    }
    return { files: out, binary };
  } catch {
    return null;
  }
}

/** Did this tree ask to stop? Internal: callers get the answer as a HaltDecision. */
function asksToStop(tree: ZipTree | null): boolean {
  if (!tree) return false;
  return Object.keys(tree.files).some(path => path === STOP_CALL || path.startsWith(`${STOP_CALL}/`));
}

export type HaltReason =
  /** The network asked to stop and then went quiet. The good ending. */
  | "stopped-itself"
  /** The ceiling. The run was cut off; whatever came back may be half of something. */
  | "ceiling"
  /** The output stream ended without a stop call ever appearing. */
  | "output-ended"
  /**
   * The network went quiet and stayed quiet without ever asking to stop.
   *
   * It stopped -- a network saying nothing at all has stopped, whatever it
   * did or did not write first -- but it never said it was finished, so this
   * is not a complete run. Before this existed, silence was not a halting
   * condition at all: a network that had gone entirely mute was read until
   * the ceiling, so on the live mesh every run ended on the ceiling and no
   * run ever ended because the network stopped.
   */
  | "went-quiet"
  /**
   * The network reached a stable state and stayed there.
   *
   * The ending the architecture actually describes -- "the process continues
   * until the network reaches a sufficiently stable state, and that settled
   * state can be interpreted as the output" -- and nothing was watching for
   * it. The other two endings cannot fire on a live mesh: the stop call needs
   * the network trained to spell a string, and silence is impossible because
   * the output neurons sit in the same all-connected mesh as everything else
   * and are driven by all of it.
   *
   * Settling it does. Measured per output byte on the live network, worst
   * bit of each: 10 4 4 4 4 5 4 4 4 4 4 1 4 4 4 5 5 6 6 6 -- one expensive
   * byte while it works the input out, then a plateau. The plateau is the
   * stable state, so the test is the cost having stopped FALLING, which is
   * the same test the settle loop itself uses one level down.
   */
  | "settled";

export interface HaltDecision {
  halted: boolean;
  reason?: HaltReason;
  /** Ticks spent. */
  ticks: number;
  /** Whether a stop call was ever seen, regardless of how the run ended. */
  sawStop: boolean;
  /** True only for "stopped-itself": the one ending that means the output is whole. */
  complete: boolean;
}

export interface HaltConfig {
  /**
   * How many consecutive quiet ticks prove the network has stopped emitting.
   * Too low and a pause mid-thought reads as the end; too high and every run
   * pays for the wait. Counted in ticks rather than milliseconds because the
   * mesh's own settle() is the clock here, not the wall.
   */
  quietTicks: number;
  /** Hard ceiling. Not a halt condition -- a guarantee of termination. */
  /**
   * The ceiling on the WHOLE run -- the bits going in as well as the bytes
   * coming out. It used to bound output only, which left the input
   * unbounded: the packed form of a two-character prompt is 408 bits, so a
   * caller asking for a ceiling of six still waited through all of them
   * before the cap applied to anything.
   */
  maxTicks: number;
}

export const DEFAULT_HALT: HaltConfig = { quietTicks: 32, maxTicks: 100_000 };

/**
 * Output bytes a run always gets, however much of its ceiling the input ate.
 *
 * A caller who asks for a small ceiling and sends a large archive would
 * otherwise get a run with no room to answer at all, which reads as "the
 * network said nothing" when what happened is that it was never allowed to
 * speak.
 */
const MIN_OUTPUT_BUDGET = 8;

/**
 * How much longer silence must hold to count as stopping when the network
 * never asked to stop.
 *
 * A network that wrote the stop call and then went quiet has told us it is
 * done. One that simply stopped talking has not, so it gets more room before
 * we decide the answer is over.
 */
const SILENT_STOP_MULTIPLIER = 3;

/**
 * Consecutive output bytes whose settle cost has stopped falling before the
 * network counts as having reached its stable state.
 *
 * More than a couple, because the cost wobbles by a step either way at the
 * plateau, and a single flat pair is not a plateau.
 */
const SETTLED_BYTES = 4;
/** How much the settle cost may still move and still count as flat. */
const SETTLED_TOLERANCE = 0.25;

/**
 * Watches a run and decides when it is over.
 *
 * Internal: a caller gets its verdict through runUntilStopped(). Nothing
 * outside needs to drive the watcher by hand, and an export nothing calls is
 * how code starts looking finished before it is wired to anything.
 *
 * Fed one tick at a time so it works the same whether the caller is streaming
 * bits off two neurons or replaying a recording -- and so the decision can be
 * tested without a mesh, which is the difference between a halt condition that
 * is verified and one that is merely written down.
 */
class HaltWatcher {
  private ticks = 0;
  private quiet = 0;
  private sawStop = false;
  private bytes: number[] = [];
  /** Consecutive bytes whose settle cost has stopped falling. */
  private settledRun = 0;
  private lastSettleCost = -1;

  constructor(private readonly config: HaltConfig = DEFAULT_HALT) {}

  /**
   * One tick of output. `byte` is null when the network emitted nothing this
   * tick -- silence is information here, so it has to be reported rather than
   * skipped.
   */
  /**
   * How hard the mesh worked on the byte just observed.
   *
   * Called before observe() so the stable-state test has this byte's cost.
   * Absent on a doorway that is a recording or a stub, and then the run
   * simply cannot end this way.
   */
  noteSettleCost(cost: number | undefined): void {
    if (cost === undefined || !Number.isFinite(cost)) return;
    if (this.lastSettleCost < 0) {
      this.lastSettleCost = cost;
      return;
    }
    // Flat means it has stopped FALLING. A cost still coming down is a
    // network still working the answer out; one that has levelled off has
    // reached the state it is going to reach.
    const drop = (this.lastSettleCost - cost) / Math.max(1, this.lastSettleCost);
    this.settledRun = drop > SETTLED_TOLERANCE ? 0 : this.settledRun + 1;
    this.lastSettleCost = cost;
  }

  observe(byte: number | null): HaltDecision {
    this.ticks++;

    if (byte === null) {
      this.quiet++;
    } else {
      this.quiet = 0;
      this.bytes.push(byte);
      // Re-read the stream as it grows. Once a stop call has been seen it
      // stays seen: a later chunk cannot un-ask.
      if (!this.sawStop && asksToStop(unpackZip(new Uint8Array(this.bytes)))) this.sawStop = true;
    }

    // Both conditions, and in this order: asked to stop, and then actually
    // went quiet. A network that writes the stop call and keeps typing has not
    // finished -- it has mentioned stopping in the middle of something.
    if (this.sawStop && this.quiet >= this.config.quietTicks) {
      return { halted: true, reason: "stopped-itself", ticks: this.ticks, sawStop: true, complete: true };
    }

    // Silence alone, held longer, also counts as stopping -- but only once
    // the network has actually said something. Neither "settled" nor
    // "went-quiet" may end a run that has produced zero output bytes: a
    // mesh that reaches a stable state, or goes quiet, before emitting
    // anything has not answered and gone silent -- it has simply not
    // started, and ending the run there reports silence as a reply instead
    // of what it actually is, nothing yet. Only the ceiling, below, may cut
    // off a run that never said anything -- it is a guarantee of
    // termination, not a verdict that the network is done.
    const hasSpoken = this.bytes.length > 0;

    if (hasSpoken && this.settledRun >= SETTLED_BYTES) {
      return { halted: true, reason: "settled", ticks: this.ticks, sawStop: this.sawStop, complete: true };
    }

    if (hasSpoken && !this.sawStop && this.quiet >= this.config.quietTicks * SILENT_STOP_MULTIPLIER) {
      return { halted: true, reason: "went-quiet", ticks: this.ticks, sawStop: false, complete: false };
    }

    if (this.ticks >= this.config.maxTicks) {
      // Deliberately not "complete". Whatever came back may be half of
      // something, and a caller that cannot tell will eventually present half
      // an answer as a whole one.
      return {
        halted: true,
        reason: this.sawStop ? "output-ended" : "ceiling",
        ticks: this.ticks,
        sawStop: this.sawStop,
        complete: false,
      };
    }

    return { halted: false, ticks: this.ticks, sawStop: this.sawStop, complete: false };
  }

  /** Everything emitted so far, whether or not the run is over. */
  collected(): Uint8Array {
    return new Uint8Array(this.bytes);
  }

  /** The tree, if enough has come back to read one. */
  tree(): ZipTree | null {
    return unpackZip(this.collected());
  }
}

/** The two-neuron doorway, seen the only way a run needs to see it. */
export interface BitDoorway {
  sendBytes(bytes: Uint8Array): void;
  /**
   * Feed one byte without treating it as the end of the message.
   *
   * Optional, and only used by the yielding run: sendBytes() streams the
   * whole archive in one synchronous burst, which on a server is the half
   * that holds the thread -- 408 bits of a two-character prompt went by
   * before the output loop, with its yields, ever began.
   */
  sendByte?(byte: number): void;
  /** Learn from everything fed since the last one. Paired with sendByte(). */
  learnFromEvent?(): void;
  /**
   * Iterations the hardest bit of the last byte needed to reach a stable
   * state. The signal the run stops on -- see "settled" in HaltReason.
   */
  worstSettleIterations?(): number;
  /** One tick of output. Null means the network emitted nothing this tick. */
  nextOutputByte(): number | null;
  /**
   * Everything the network is holding -- every neuron's state and every
   * connection between them -- taken when the run stops.
   *
   * Optional because a doorway can be a recording or a stub, and neither has
   * neurons. A real mesh has this, and when it does the run saves it.
   */
  captureNetworkState?(): unknown;
}

/** Where the stop command leaves what it found. */
export const STOP_REPORT_FILE = `${ZIP_FOLDERS.state}stop-report.json`;

/** What the stop command found when it looked at every neuron. */
export interface StopReport {
  /** Why the run ended, as the command was told it. */
  reason: HaltReason | "unknown";
  /** Neurons the network said it had, and states actually present for them. */
  expectedNeurons: number;
  dimensions: number;
  statesFound: number;
  /** States that are real numbers. Anything else is a neuron that came back broken. */
  finite: number;
  /** States pinned at the rail -- a saturated mesh represents nothing. */
  saturated: number;
  quietest: number;
  loudest: number;
  meanMagnitude: number;
  /** True when every neuron the network claimed is present and finite. */
  allAccountedFor: boolean;
  notes: string[];
}

/**
 * The command that runs when the network stops.
 *
 * "When it stops it will run a command that will stop it and see if all the
 * neuron states" -- and the second half was never happening. `plugins/stop`
 * existed only as a STRING to look for in the output: asksToStop() checked
 * whether the network had written that path, and if it had, the run ended.
 * Nothing was ever executed, and nothing ever looked at the neurons beyond
 * serialising them.
 *
 * So this actually runs, on every ending, and actually looks: every neuron the
 * network claims to have, present or missing, finite or broken, at the rail or
 * not. A capture that silently held 300 states for 336 neurons, or a column of
 * NaN from a graft that went wrong, used to travel back looking exactly like a
 * healthy one.
 */
export function runStopCommand(state: unknown, reason: HaltReason | undefined): StopReport {
  const notes: string[] = [];
  const snapshot = (state ?? {}) as {
    shape?: { neurons?: number; dimensions?: number };
    states?: string;
  };
  const expectedNeurons = Number(snapshot.shape?.neurons ?? 0);
  const dimensions = Number(snapshot.shape?.dimensions ?? 0);

  let values: Float32Array = new Float32Array(0);
  if (typeof snapshot.states === "string" && snapshot.states.length > 0) {
    try {
      const binary = Buffer.from(snapshot.states, "base64");
      values = new Float32Array(binary.buffer, binary.byteOffset, Math.floor(binary.byteLength / 4));
    } catch {
      notes.push("the captured states could not be decoded");
    }
  } else {
    notes.push("the network returned no states at all");
  }

  // Total dimensions per neuron includes the reserved input flag.
  const perNeuron = dimensions > 0 ? dimensions + 1 : 0;
  const statesFound = perNeuron > 0 ? Math.floor(values.length / perNeuron) : 0;

  let finite = 0;
  let saturated = 0;
  let quietest = Number.POSITIVE_INFINITY;
  let loudest = 0;
  let total = 0;
  for (let i = 0; i < statesFound; i++) {
    let sum = 0;
    let ok = true;
    for (let d = 1; d < perNeuron; d++) {
      const v = values[d * statesFound + i];
      if (!Number.isFinite(v)) { ok = false; break; }
      const mag = v < 0 ? -v : v;
      if (mag > 0.99) saturated++;
      sum += mag;
    }
    if (!ok) continue;
    finite++;
    const mean = perNeuron > 1 ? sum / (perNeuron - 1) : 0;
    if (mean < quietest) quietest = mean;
    if (mean > loudest) loudest = mean;
    total += mean;
  }
  if (!Number.isFinite(quietest)) quietest = 0;

  if (statesFound !== expectedNeurons) {
    notes.push(`the network says ${expectedNeurons} neurons but ${statesFound} states came back`);
  }
  if (finite !== statesFound) {
    notes.push(`${statesFound - finite} neuron(s) came back holding something that is not a number`);
  }
  const cells = statesFound * Math.max(0, perNeuron - 1);
  if (cells > 0 && saturated / cells > 0.5) {
    notes.push("over half the mesh is pinned at the rail, which represents nothing");
  }

  return {
    reason: reason ?? "unknown",
    expectedNeurons,
    dimensions,
    statesFound,
    finite,
    saturated,
    quietest,
    loudest,
    meanMagnitude: finite > 0 ? total / finite : 0,
    allAccountedFor: expectedNeurons > 0 && statesFound === expectedNeurons && finite === statesFound,
    notes,
  };
}

/** Where a stopped run leaves what every neuron and every connection was. */
export const NETWORK_STATE_FILE = `${ZIP_FOLDERS.state}network-state.json`;

export interface RunResult extends HaltDecision {
  /** What came back, as far as it could be read. */
  tree: ZipTree | null;
  raw: Uint8Array;
  /**
   * Everything the network was holding when the run stopped -- neuron states
   * and every connection -- if the doorway could tell us. Also placed in the
   * returned tree under state/, so it travels with the rest of the output
   * rather than beside it.
   */
  networkState?: unknown;
  /** What the stop command found when it looked at every neuron. */
  stopReport?: StopReport;
}

/**
 * Send a tree in, and read output back until the network stops itself.
 *
 * Note what this does NOT do: it does not decide when the work is finished.
 * Only the network can do that, by producing the stop call, and a network that
 * has not been taught to produce one will run to the ceiling every time. That
 * is a training outcome, not something the plumbing can supply -- and saying
 * so here is more useful than a ceiling quietly standing in for an answer.
 */
export function runUntilStopped(
  doorway: BitDoorway,
  input: ZipTree,
  config: HaltConfig = DEFAULT_HALT,
): RunResult {
  return runLoop(doorway, input, config);
}

/**
 * The same run, yielding to the event loop between output bytes.
 *
 * A settle at the live mesh size costs about a second, and reading one byte
 * back is eight of them. Run synchronously on a server, that is not merely
 * slow -- it holds the only thread. Measured: while one /api/zip-loop/run was
 * in flight, every other request returned nothing, health checks included,
 * and the process sat at 96.7% CPU. Awaiting between bytes gives the server
 * its thread back often enough to answer anything else that arrives.
 */
export async function runUntilStoppedAsync(
  doorway: BitDoorway,
  input: ZipTree,
  config: HaltConfig = DEFAULT_HALT,
): Promise<RunResult> {
  return runLoop(doorway, input, config, () => new Promise<void>(resolve => setImmediate(resolve)));
}

function runLoop(
  doorway: BitDoorway,
  input: ZipTree,
  config: HaltConfig,
  yieldTo?: () => Promise<void>,
): RunResult;
function runLoop(
  doorway: BitDoorway,
  input: ZipTree,
  config: HaltConfig,
  yieldTo: () => Promise<void>,
): Promise<RunResult>;
function runLoop(
  doorway: BitDoorway,
  input: ZipTree,
  config: HaltConfig,
  yieldTo?: () => Promise<void>,
): RunResult | Promise<RunResult> {
  const packed = packZip(input);

  const watcher = new HaltWatcher(config);
  let decision: HaltDecision = { halted: false, ticks: 0, sawStop: false, complete: false };

  // The ceiling counts the WHOLE run, not just the answer.
  //
  // maxTicks used to cap output bytes only, so the bits going in were
  // unbounded -- and feeding the packed form of a two-character prompt is 408
  // of them. A caller asking for maxTicks: 6 still waited through the entire
  // input before the ceiling could apply to anything, which is why a run with
  // a ceiling of six never came back.
  const spentOnInput = packed.length;
  let budget = config.maxTicks - spentOnInput;
  if (budget < MIN_OUTPUT_BUDGET) budget = MIN_OUTPUT_BUDGET;

  const finish = (): RunResult => {
    const networkState = doorway.captureNetworkState?.();
    // The run has stopped, so the stop command runs: it looks at every neuron
    // the network claims to have and says whether they are all there and all
    // sound. It runs on EVERY ending, including the ceiling -- a run cut off
    // mid-thought is exactly when you want to know what state it left behind.
    const stopReport = runStopCommand(networkState, decision.reason);
    const tree = watcher.tree();
    const withMemory =
      tree && networkState !== undefined
        ? {
          files: {
            ...tree.files,
            [NETWORK_STATE_FILE]: JSON.stringify(networkState),
            [STOP_REPORT_FILE]: JSON.stringify(stopReport),
          },
        }
        : tree;
    return { ...decision, tree: withMemory, raw: watcher.collected(), networkState, stopReport };
  };

  if (!yieldTo) {
    doorway.sendBytes(packed);
    let read = 0;
    while (!decision.halted && read < budget) {
      const byte = doorway.nextOutputByte();
      watcher.noteSettleCost(doorway.worstSettleIterations?.());
      decision = watcher.observe(byte);
      read++;
    }
    // Out of budget: the same ending the watcher's own ceiling gives, named
    // the same way, so a caller cannot tell which ceiling stopped it -- only
    // that it was cut off rather than finishing.
    if (!decision.halted) decision = { ...decision, halted: true, reason: "ceiling" };
    return finish();
  }

  return (async () => {
    // Feed the archive in with the thread handed back between bytes, then
    // learn from the whole message as one event -- the same two steps
    // sendBytes() does, just not all at once.
    if (doorway.sendByte && doorway.learnFromEvent) {
      for (const byte of packed) {
        doorway.sendByte(byte);
        await yieldTo();
      }
      doorway.learnFromEvent();
    } else {
      doorway.sendBytes(packed);
    }
    await yieldTo();

    let read = 0;
    while (!decision.halted && read < budget) {
      const byte = doorway.nextOutputByte();
      watcher.noteSettleCost(doorway.worstSettleIterations?.());
      decision = watcher.observe(byte);
      read++;
      await yieldTo();
    }
    // Out of budget: the same ending the watcher's own ceiling gives, named
    // the same way, so a caller cannot tell which ceiling stopped it -- only
    // that it was cut off rather than finishing.
    if (!decision.halted) decision = { ...decision, halted: true, reason: "ceiling" };
    return finish();
  })();
}


