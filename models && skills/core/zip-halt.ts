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

/** The folders the network sees, on the way in and on the way out. */
export const ZIP_FOLDERS = {
  /** What it is being asked about. */
  input: "input/",
  /** Plugin calls: what the network asks the outside world to do -- including stopping. */
  plugins: "plugins/",
  /** What came back from those calls, including the ones that went wrong. */
  errors: "plugins/error/",
  /** Prompting skills: specialised instructions, their own folder, fed in with everything else. */
  promptingSkills: "prompting-skills/",
  /**
   * What it should remember, and what it remembered. A folder like any other:
   * memory arrives through the same doorway as everything else rather than
   * through a side channel, which means a run can be handed its own past and
   * can hand back what it wants kept.
   */
  memory: "memory/",
  /** What it produced. */
  output: "output/",
} as const;

/** The file whose existence means "I am done". */
export const STOP_CALL = `${ZIP_FOLDERS.plugins}stop`;

export interface ZipTree {
  /** Path (including its folder prefix) -> contents. */
  files: Record<string, string>;
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
  return new Uint8Array(gzipSync(Buffer.from(JSON.stringify({ files: ordered }), "utf8")));
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
    return { files: out };
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
  | "output-ended";

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
  maxTicks: number;
}

export const DEFAULT_HALT: HaltConfig = { quietTicks: 32, maxTicks: 100_000 };

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

  constructor(private readonly config: HaltConfig = DEFAULT_HALT) {}

  /**
   * One tick of output. `byte` is null when the network emitted nothing this
   * tick -- silence is information here, so it has to be reported rather than
   * skipped.
   */
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
  /** One tick of output. Null means the network emitted nothing this tick. */
  nextOutputByte(): number | null;
}

export interface RunResult extends HaltDecision {
  /** What came back, as far as it could be read. */
  tree: ZipTree | null;
  raw: Uint8Array;
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
  doorway.sendBytes(packZip(input));

  const watcher = new HaltWatcher(config);
  let decision: HaltDecision = { halted: false, ticks: 0, sawStop: false, complete: false };
  while (!decision.halted) {
    decision = watcher.observe(doorway.nextOutputByte());
  }

  return { ...decision, tree: watcher.tree(), raw: watcher.collected() };
}
