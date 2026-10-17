/**
 * Next-message prediction with something to learn from.
 *
 * Before: on a chat that repeats exactly (A B A B ...) every prediction was empty
 * and similarity was 0.00, because nothing on that path was ever trained. These pin
 * what the trained predictor does and, as importantly, what it does not do (see
 * benchmarks/next_message.mjs for the held-out measurements against baselines).
 */
import { describe, it, expect } from 'vitest';
import { HyperDimensionalEngine } from '../../models && skills/core/onebrain.js';
import { NextMessagePredictor } from '../../models && skills/core/next-message.js';
import { ContinuousLearner } from '../../models && skills/core/continuous-learning.js';
import { DoorwayLock } from '../../models && skills/core/doorway-lock.js';

const engine = () => new HyperDimensionalEngine({ neuronCount: 24, dimensions: 8, seed: 5 });

describe('NextMessagePredictor', () => {
  it('predicts nothing, with loss 1, before it has seen a pair', () => {
    const p = new NextMessagePredictor(engine());
    expect(p.predict('hello')).toBe('');
    expect(p.observe('hello')).toBeNull();           // the first message has no predecessor
    expect(p.pairCount()).toBe(0);
  });

  it('learns a repeating chat: the prequential loss falls and later predictions are exact', () => {
    const p = new NextMessagePredictor(engine());
    const chat = ['good morning', 'how are you', 'fine thanks'];
    const seen = [];
    for (let round = 0; round < 4; round++) for (const m of chat) { const o = p.observe(m); if (o) seen.push(o); }
    expect(seen[0].loss).toBe(1);                      // nothing learned yet
    expect(seen.at(-1)!.loss).toBeLessThan(0.1);
    expect(seen.slice(-3).every((o) => o.exact)).toBe(true);
    expect(p.predict('good morning')).toBe('how are you');
  });

  it('does not predict by repeating the last message', () => {
    const p = new NextMessagePredictor(engine());
    for (let i = 0; i < 3; i++) { p.observe('ping'); p.observe('pong'); }
    expect(p.predict('ping')).toBe('pong');
    expect(p.predict('ping')).not.toBe('ping');
  });

  it('reading the mesh does not change it', () => {
    const e = engine();
    const p = new NextMessagePredictor(e);
    for (const m of ['a b', 'c d', 'a b', 'c d']) p.observe(m);
    const before = e.captureNetworkState();
    p.predict('a b'); p.observe('a b');
    const after = e.captureNetworkState();
    expect(after.connDiag).toBe(before.connDiag);
    expect(after.states).toBe(before.states);
  });

  it('newConversation() stops a pair being formed across the boundary', () => {
    const p = new NextMessagePredictor(engine());
    p.observe('hi'); p.observe('hello'); p.newConversation(); p.observe('bye');
    expect(p.pairCount()).toBe(1);
  });

  it('a name it never heard is NOT copied through (measured limit: no better than guessing the average)', () => {
    const p = new NextMessagePredictor(engine());
    for (const n of ['Ann', 'Bob', 'Ed']) { p.newConversation(); p.observe(`hi, I'm ${n}`); p.observe(`hello ${n}`); }
    expect(p.predict(`hi, I'm Zed`)).not.toBe('hello Zed');
  });
});

describe('ContinuousLearner with a predictor', () => {
  it('reports similarity 0 without one on a repeating chat, and 1 with one once it has learned', async () => {
    const e = engine();
    const bare = new ContinuousLearner(new DoorwayLock());
    const trained = new ContinuousLearner(new DoorwayLock(), undefined, new NextMessagePredictor(e));
    const chat = ['alpha one', 'beta two', 'alpha one', 'beta two', 'alpha one', 'beta two', 'alpha one', 'beta two'];
    const withPredictor: number[] = [];
    for (const m of chat) {
      const c = await trained.onUserMessage(e, '', m);
      if (c) withPredictor.push(c.similarity);
    }
    expect(withPredictor.at(-1)).toBe(1);
    expect(withPredictor.slice(0, 2).every((s) => s < 1)).toBe(true);
    const c0 = await bare.onUserMessage(e, '', 'alpha one');
    expect(c0).toBeNull();                                  // nothing outstanding yet
  });
});
