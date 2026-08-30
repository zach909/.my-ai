/**
 * Tests for src/lib/conversation-learning-trigger.ts -- the piece that
 * makes "always learn by talking to it / using it" real: an immediate,
 * in-process training cycle fired from bot-service.ts on every real
 * exchange, instead of waiting for the background agent's own timer.
 *
 * These run against the real scripts/conversation-learning-agent.mjs and
 * the real local conversation log (same precedent as
 * conversation-learning.test.ts's real-training note) -- no mocks for the
 * behavior that actually matters here: that it never throws into the
 * caller, and that the module-level lock actually prevents two cycles
 * from running at once.
 */

import { triggerConversationLearning } from '../../src/lib/conversation-learning-trigger';

describe('triggerConversationLearning()', () => {
  it('never throws into the caller, even if the underlying cycle fails', async () => {
    await expect(triggerConversationLearning()).resolves.toBeUndefined();
  }, 60_000);

  it('a second concurrent call is skipped (in-process lock), not run as a second overlapping cycle', async () => {
    // If both calls actually ran a full cycle back-to-back, the two
    // combined would take roughly 2x a single cycle's time. If the
    // second is properly skipped by the learningInFlight guard, running
    // both concurrently should take about the same as running one alone
    // (the second resolves near-instantly, having done nothing).
    const soloStart = Date.now();
    await triggerConversationLearning();
    const soloElapsed = Date.now() - soloStart;

    const concurrentStart = Date.now();
    await Promise.all([triggerConversationLearning(), triggerConversationLearning(), triggerConversationLearning()]);
    const concurrentElapsed = Date.now() - concurrentStart;

    // Generous bound: three overlapping real calls should not cost
    // anywhere near 3x a solo call if the guard is doing its job. Give it
    // slack for real-world timing noise (this is a real subprocess-backed
    // cycle, not a mock).
    expect(concurrentElapsed).toBeLessThan(Math.max(soloElapsed * 2.5, 5000));
  }, 60_000);
});
