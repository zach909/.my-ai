/**
 * Predicting the next message, with a signal to learn from.
 *
 * ContinuousLearner (continuous-learning.ts) used to ask an untrained mesh for
 * the next message and compare it with the real one, and nothing was ever
 * trained on the comparison: on a chat that repeats exactly (A B A B ...) every
 * prediction was empty and similarity was 0.00. There was no target, no loss and
 * no update anywhere on that path.
 *
 * This supplies them. After each real message the pair (previous message ->
 * this message) is a training example: the question is the previous message
 * heard through the Zip Loop (bits, memory on, nothing tokenised), the target is
 * the bytes of the message that followed. A readout on the mesh's own state
 * (ZipSpeaker) is refitted on every pair seen so far. Before each refit the
 * pair is first PREDICTED, so the loss it reports is a prequential one: the
 * error on a message the predictor had not yet been trained on.
 *
 * What it is and is not. It learns a map from one message to the next from
 * the mesh's trace of the first. It does not model the conversation, only the
 * last message heard; it needs the mesh's weights to stay fixed between
 * observations (the readout was fitted against the state they produce; call
 * refit() after the mesh learns); and only the first `maxBytes` of a message are
 * predicted. Whether it predicts anything it was not shown is measured in
 * benchmarks/next_message.mjs against baselines, not assumed here.
 */
import type { HyperDimensionalEngine } from "./onebrain.js";
import { ZipSpeaker, type SpeechOptions } from "./zip-speech.js";

export interface NextMessageOptions extends SpeechOptions {
  /** Longest message predicted, in bytes. Default 16. */
  maxBytes?: number;
  /** Most pairs kept (oldest dropped). Default 256. */
  maxPairs?: number;
}

export interface Observation {
  /** What was predicted for this message before it was heard ("" if nothing could be). */
  predicted: string;
  /** The message that actually arrived, cut to maxBytes. */
  actual: string;
  /** Bit-level loss of that prediction, 1 = learned nothing, 0 = exact. 1 when nothing had been learned yet. */
  loss: number;
  /** Predicted equals actual, byte for byte. */
  exact: boolean;
}

const cut = (text: string, max: number): string => {
  const bytes = Buffer.from(text, "utf8");
  return bytes.length <= max ? text : Buffer.from(bytes.subarray(0, max)).toString("utf8");
};

export class NextMessagePredictor {
  private readonly speaker: ZipSpeaker;
  private readonly maxBytes: number;
  private readonly maxPairs: number;
  private pairs: Array<{ question: string; answer: string }> = [];
  private previous: string | null = null;
  private readonly lossHistory: number[] = [];

  constructor(engine: HyperDimensionalEngine, opts: NextMessageOptions = {}) {
    this.maxBytes = opts.maxBytes ?? 16;
    this.maxPairs = opts.maxPairs ?? 256;
    this.speaker = new ZipSpeaker(engine, { ...opts, maxAnswerBytes: this.maxBytes });
  }

  /** The prediction for what follows `message`, or "" when nothing has been learned. Reads the mesh, changes nothing. */
  predict(message: string): string {
    if (!this.speaker.taught) return "";
    return this.speaker.speakText(message);
  }

  /**
   * A message has arrived. Score the prediction made for it, learn the
   * (previous -> this) pair, and return what happened. The first message of a
   * conversation has no predecessor and teaches nothing.
   */
  observe(message: string): Observation | null {
    const actual = cut(message, this.maxBytes);
    let result: Observation | null = null;
    if (this.previous !== null) {
      const predicted = this.predict(this.previous);
      const loss = this.speaker.taught ? this.speaker.loss(this.previous, actual) : 1;
      result = { predicted, actual, loss, exact: predicted === actual };
      this.lossHistory.push(loss);
      this.pairs.push({ question: this.previous, answer: actual });
      if (this.pairs.length > this.maxPairs) this.pairs.shift();
      this.speaker.teach(this.pairs);
    }
    this.previous = message;
    return result;
  }

  /** Re-fit after the mesh's weights changed (cached readings of the old mesh are discarded). */
  refit(): void {
    this.speaker.forget();
    if (this.pairs.length > 0) this.speaker.teach(this.pairs);
  }

  /** Forget the conversation's thread (not what was learned): the next message starts a new one. */
  newConversation(): void {
    this.previous = null;
  }

  /** Prequential loss of every pair seen, in order. */
  losses(): number[] {
    return [...this.lossHistory];
  }

  pairCount(): number {
    return this.pairs.length;
  }
}
