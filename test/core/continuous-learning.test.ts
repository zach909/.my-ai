/**
 * The mesh predicts what the user is going to say next; comparing that guess
 * to what actually happened is reported back (similarity/surprise) but does
 * NOT train the mesh -- deliberately, per an explicit "I do not want it to
 * remember" (don't let comparisons adjust the mesh's weights). Two things
 * have to be real:
 *
 *  - A prediction actually comes from the real Zip Loop doorway against a
 *    real engine, not a canned string.
 *  - Comparing a prediction to what actually happened is a pure computation
 *    that never touches the engine, and never overlaps with anything else
 *    driving the same doorway.
 */
import { describe, it, expect } from 'vitest';
import { ContinuousLearner, comparePrediction } from '../../models && skills/core/continuous-learning';
import { DoorwayLock } from '../../models && skills/core/doorway-lock';
import { PromptMeshFeed, type BitDoorway } from '../../models && skills/core/zip-io';
import { HyperDimensionalEngine, ZipLoopInterface } from '../../models && skills/core/onebrain';

function smallEngine(): HyperDimensionalEngine {
  return new HyperDimensionalEngine({
    neuronCount: 12, dimensions: 6, propagationSteps: 2, convergenceThreshold: 0.01,
    hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
    waveGain: 0.1, connectionBias: true,
  });
}

describe('ContinuousLearner', () => {
  it('has no prediction outstanding before the first turn', () => {
    const learner = new ContinuousLearner(new DoorwayLock());
    expect(learner.currentPrediction()).toBeNull();
  });

  it('predicts something after a turn, against a real engine', async () => {
    const engine = smallEngine();
    const learner = new ContinuousLearner(new DoorwayLock());

    const comparison = await learner.onUserMessage(engine, '', 'hello there');
    // Nothing was outstanding yet, so there is nothing to compare.
    expect(comparison).toBeNull();
    // A real run against a real engine either produced a forecast or it
    // genuinely predicted nothing (a fresh, untrained mesh may say nothing)
    // -- either is a real string, and only a thrown predict call leaves this
    // null.
    expect(typeof learner.currentPrediction()).toBe('string');

    for (const neuron of engine.getNeuronStates()) {
      for (const v of neuron.state) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('compares the outstanding prediction against the next real message', async () => {
    const engine = smallEngine();
    // Predetermine what "the mesh predicted" by seeding the learner's
    // internal state through a real predict pass, then feed a very
    // different second message so surprise is high and real.
    const learner = new ContinuousLearner(new DoorwayLock());
    await learner.onUserMessage(engine, '', 'first message');
    const predicted = learner.currentPrediction();
    // An empty forecast is still a real, storable prediction.
    expect(typeof predicted).toBe('string');

    const comparison = await learner.onUserMessage(engine, 'first message', 'something completely different');
    expect(comparison).not.toBeNull();
    expect(comparison).toEqual(comparePrediction(predicted!, 'something completely different'));

    for (const neuron of engine.getNeuronStates()) {
      for (const v of neuron.state) expect(Number.isFinite(v)).toBe(true);
    }
  });

  describe('comparePrediction', () => {
    it('is pure -- this is what "I do not want it to remember" turned into', () => {
      // No engine parameter at all: there is nothing here that COULD touch
      // the mesh's weights, which is the actual guarantee -- not "it
      // happens not to move the numbers this run" but "there is no doorway
      // in scope to move them through".
      const a = comparePrediction('the weather is nice today', 'the weather is nice today');
      expect(a.similarity).toBe(1);
      expect(a.surprise).toBe(0);

      const b = comparePrediction('completely unrelated words here', 'something else entirely different');
      expect(b.similarity).toBeLessThan(1);
      expect(b.surprise).toBeGreaterThan(0);

      const c = comparePrediction('', 'anything at all');
      expect(c.similarity).toBe(0);
      expect(c.surprise).toBe(1);
    });

    it('always sums similarity and surprise to exactly 1', () => {
      for (const [predicted, actual] of [
        ['a b c', 'a b c'],
        ['a b c', 'x y z'],
        ['', ''],
        ['hello world', 'hello there world'],
      ] as const) {
        const { similarity, surprise } = comparePrediction(predicted, actual);
        expect(similarity + surprise).toBeCloseTo(1, 10);
      }
    });
  });

  it('never fails the turn when the engine throws', async () => {
    const learner = new ContinuousLearner(new DoorwayLock());
    const brokenEngine = {} as unknown as HyperDimensionalEngine; // no real methods -- guaranteed to throw
    await expect(learner.onUserMessage(brokenEngine, '', 'hi')).resolves.toBeNull();
    expect(learner.currentPrediction()).toBeNull();
  });

  it('shares a DoorwayLock with PromptMeshFeed, so the two can never drive the doorway at once', async () => {
    const engine = smallEngine();
    const lock = new DoorwayLock();

    // A PromptMeshFeed feed that we can hold open mid-stream.
    let release: (() => void) | null = null;
    const parked = () => new Promise<void>(resolve => { release = resolve; });
    const zip = new ZipLoopInterface(engine, { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 });
    const feed = new PromptMeshFeed(() => zip, parked, lock);
    const learner = new ContinuousLearner(lock);

    const feedPromise = feed.feedNow('a prompt long enough to take a few bytes');
    // Give the feed a turn to acquire the lock and park mid-stream.
    await Promise.resolve();
    await Promise.resolve();
    expect(feed.busy()).toBe(true);

    // The learner's own prediction call is issued WHILE the feed is parked
    // mid-stream, holding the lock. It must wait, not run concurrently.
    let learnerStarted = false;
    let learnerFinished = false;
    const learnerPromise = (async () => {
      learnerStarted = true;
      await learner.onUserMessage(engine, '', 'meanwhile');
      learnerFinished = true;
    })();
    await Promise.resolve();
    await Promise.resolve();
    expect(learnerStarted).toBe(true);
    // The feed still holds the lock, so the learner's own zip-loop calls
    // have not been able to run yet.
    expect(learnerFinished).toBe(false);

    // Release the feed, one parked yield at a time -- it re-parks after
    // every byte of a multi-byte prompt, so one release is not enough to
    // let it finish (the same pattern prompt-mesh-feed.test.ts's own
    // "keeps one prompt waiting" test uses for the same reason).
    while (feed.busy()) {
      const go = release;
      release = null;
      if (go) go();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await feedPromise;
    await learnerPromise;
    expect(learnerFinished).toBe(true);
  });
});
