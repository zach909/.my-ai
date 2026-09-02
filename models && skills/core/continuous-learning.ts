/**
 * Predicts what the user is about to say next, and reports how wrong it was.
 *
 * The prediction goes through the same doorway everything else does -- the
 * real Zip Loop bit-neurons (ZipLoopInterface, zip-halt.ts) against the ONE
 * shared engine (NeuroPipeline.ensureBrain()), not a second, private brain.
 * A prediction from a brain nothing else talks to would not be a prediction
 * about what THIS mesh expects.
 *
 * Comparing the guess to what actually happened does NOT feed back into the
 * mesh's weights -- deliberately. An earlier version of this module packed
 * predicted-vs-actual into an archive and streamed it through the doorway
 * with an explicit sendByte()/learnFromEvent() pass, training the mesh on
 * its own guesses. That extra training step is gone: comparePrediction()
 * only computes similarity/surprise (tokenSimilarity), touching nothing on
 * the engine. Making a prediction still reaches the mesh -- it is read
 * through the doorway like any other zip-loop input, and reading trains
 * exactly the same as any other prompt does -- but the comparison itself is
 * inert, a number reported back rather than something the mesh is trained on.
 *
 * The one thing prediction still must never do is drive the doorway at the
 * same time as anything else that touches the same engine. PromptMeshFeed
 * (zip-io.ts) is the other real caller, and it already learned this lesson
 * once (one feed in flight, newest wins). This shares PromptMeshFeed's own
 * DoorwayLock (doorway-lock.ts) rather than inventing a second kind of
 * safety that could fail to cover the first.
 */

import { ZipLoopInterface, type HyperDimensionalEngine, type ZipLoopNeuronIds } from "./onebrain.js";
import { ZIP_FOLDERS, type ZipTree, DEFAULT_HALT, runUntilStoppedAsync } from "./zip-halt.js";
import { tokenSimilarity } from "./prediction-engine.js";
import type { DoorwayLock } from "./doorway-lock.js";

/** Same ids every other zip-loop caller in this codebase uses for the live mesh. */
export const DEFAULT_ZIP_IDS: ZipLoopNeuronIds = { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 };

/** Where a prediction is packed for the mesh to read back later. */
const PREDICT_FILE = `${ZIP_FOLDERS.prompt}predict-next-user-message.txt`;

/** How much context a prediction run is given -- the mesh's own state carries the rest. */
const CONTEXT_CHARS = 2000;
/** Bounded well under a real reply's budget: a forecast, not an answer. */
const PREDICT_MAX_TICKS = 2048;

export interface LearnedComparison {
  predicted: string;
  actual: string;
  /** 0..1: token overlap between the guess and what really happened. */
  similarity: number;
  /** 1 - similarity: the learning signal. */
  surprise: number;
}

interface PendingPrediction {
  predicted: string;
  madeAt: number;
}

/**
 * One prediction outstanding at a time, same shape as PromptMeshFeed's own
 * one-slot queue: a prediction is only ever compared against the NEXT real
 * message, so there is never a reason to hold more than one.
 */
export class ContinuousLearner {
  private pending: PendingPrediction | null = null;

  /**
   * @param lock  PromptMeshFeed's own DoorwayLock, shared rather than
   *              duplicated -- see this file's own doc comment for why.
   * @param ids   Zip-loop bit neuron ids for the engine passed into
   *              onUserMessage(). Same default every other caller in this
   *              codebase uses for the live mesh.
   */
  constructor(
    private readonly lock: DoorwayLock,
    private readonly ids: ZipLoopNeuronIds = DEFAULT_ZIP_IDS,
  ) {}

  /** What the mesh currently expects the user to say next, if anything has been predicted yet. */
  currentPrediction(): string | null {
    return this.pending?.predicted ?? null;
  }

  /**
   * Call once per real user turn, with the conversation context BEFORE this
   * message. If a prediction from the previous turn is outstanding, this
   * compares it against `actualMessage` -- reporting how close the guess
   * was, without touching the mesh's weights -- before making a fresh
   * prediction for next time.
   *
   * Never throws: a failed prediction or a failed comparison must not fail
   * the turn that triggered it, the same standard PromptMeshFeed.feed()
   * holds itself to. Callers should treat this as fire-and-forget, exactly
   * like promptFeed.feed() -- see zip-io.ts's own doc comment for the
   * measured cost (over a second per byte on the live mesh) that makes
   * awaiting either one from a request handler the wrong thing to do.
   */
  async onUserMessage(
    engine: HyperDimensionalEngine,
    contextBeforeThisMessage: string,
    actualMessage: string,
  ): Promise<LearnedComparison | null> {
    let comparison: LearnedComparison | null = null;
    const outstanding = this.pending;
    this.pending = null;
    if (outstanding) {
      try {
        comparison = comparePrediction(outstanding.predicted, actualMessage);
      } catch {
        // The comparison failing must not stop a fresh prediction from being
        // attempted below -- one bad turn should not end the whole loop.
      }
    }

    try {
      const context = `${contextBeforeThisMessage}\n${actualMessage}`.slice(-CONTEXT_CHARS);
      const predicted = await this.predictNext(engine, context);
      // An empty string is still a real prediction -- a fresh or quiet mesh
      // genuinely forecasting nothing -- and gets compared against the next
      // real message like any other guess (very likely a high-surprise one,
      // which is itself useful signal). Only a thrown predictNext() (the
      // catch below) means no forecast happened at all.
      this.pending = { predicted, madeAt: Date.now() };
    } catch {
      // No forecast for next time is a smaller loss than failing this turn.
    }

    return comparison;
  }

  private async predictNext(engine: HyperDimensionalEngine, context: string): Promise<string> {
    return this.lock.run(async () => {
      const zip = new ZipLoopInterface(engine, this.ids);
      const tree: ZipTree = { files: { [PREDICT_FILE]: context } };
      const result = await runUntilStoppedAsync(
        zip,
        tree,
        { quietTicks: DEFAULT_HALT.quietTicks, maxTicks: PREDICT_MAX_TICKS },
      );
      return extractOutputText(result.tree);
    });
  }
}

/**
 * How close a prediction was to what actually happened. Pure: touches
 * nothing on the engine, unlike the training-pass this replaced -- see this
 * file's own doc comment for why. Exported so that purity is something a
 * test can pin directly (no engine involved at all, rather than inferring
 * "nothing changed" by comparing two separately-initialized engines, which
 * the mesh's own non-deterministic initialization makes unreliable).
 */
export function comparePrediction(predicted: string, actual: string): LearnedComparison {
  const similarity = tokenSimilarity(predicted, actual);
  return { predicted, actual, similarity, surprise: 1 - similarity };
}

/** Everything under output/, concatenated in path order. Empty when nothing came back. */
function extractOutputText(tree: ZipTree | null): string {
  if (!tree) return "";
  const outputPaths = Object.keys(tree.files)
    .filter(p => p.startsWith(ZIP_FOLDERS.output))
    .sort();
  return outputPaths.map(p => tree.files[p]).join("\n").trim();
}
