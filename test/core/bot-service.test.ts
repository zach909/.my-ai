/**
 * Tests for ChatBot's getBot() singleton (src/server/bot-service.ts):
 * regression coverage for the system-upgrade path, plus the behavior
 * layer woven into processMessage() itself (empathy, humility-hedging,
 * ambiguous-intent clarification, creative response variation).
 */

import { getBot, resetBot, detectSentiment, empathyPrefix, pickVariant, applyHumility, detectAmbiguousIntent } from '../../src/server/bot-service';
import type { NeuroclawSystem } from '../../src/index';

function fakeSystem(): NeuroclawSystem {
  return { initialize: async () => {} } as unknown as NeuroclawSystem;
}

describe('getBot() singleton', () => {
  afterEach(() => {
    resetBot();
  });

  it('creates a fallback-mode bot when called with no system', async () => {
    const bot = await getBot();
    expect(bot.getStatus().hasSystem).toBe(false);
  });

  it('upgrades an existing fallback-mode singleton once a system becomes available', async () => {
    // Previously getBot(system) silently discarded `system` on every call
    // after the first -- a bot created by an earlier no-system call would
    // stay in fallback mode forever, even if a later caller passed a real
    // NeuroclawSystem instance.
    const withoutSystem = await getBot();
    expect(withoutSystem.getStatus().hasSystem).toBe(false);

    const withSystem = await getBot(fakeSystem());
    expect(withSystem).toBe(withoutSystem); // still the same singleton instance
    expect(withSystem.getStatus().hasSystem).toBe(true);
  });

  it('does not re-initialize (and lose conversation history) when already upgraded', async () => {
    const system = fakeSystem();
    const bot = await getBot(system);
    await bot.processMessage('hello');
    expect(bot.getHistory().length).toBeGreaterThan(0);

    const again = await getBot(fakeSystem());
    expect(again.getHistory().length).toBe(bot.getHistory().length);
  });
});

describe('behavior layer (bot-service.ts) — real functional changes, not documentation', () => {
  it('detectSentiment finds negative and positive valence via real keyword matching', () => {
    expect(detectSentiment('I am so sad and devastated today')).toBe('negative');
    expect(detectSentiment('This is great, I am so happy and grateful')).toBe('positive');
    expect(detectSentiment('The quarterly report is due on Friday')).toBe('neutral');
  });

  it('empathyPrefix gives genuine dual-perspective acknowledgment when another party caused the negative event', () => {
    const prefix = empathyPrefix('I am so sad, my boss fired me today');
    expect(prefix).toBeTruthy();
    expect(prefix).toMatch(/relieved|better off/); // names the other side's possible experience too
  });

  it('empathyPrefix still acknowledges negative sentiment without inventing an other-party angle when none is named', () => {
    const prefix = empathyPrefix('I am so sad and tired lately');
    expect(prefix).toBeTruthy();
    expect(prefix).not.toMatch(/relieved|better off/); // no fabricated other-party framing
  });

  it('empathyPrefix returns null for neutral/positive messages -- it never appends unearned emotional framing', () => {
    expect(empathyPrefix('What time is the meeting?')).toBeNull();
    expect(empathyPrefix('This is great news, thank you!')).toBeNull();
  });

  it('pickVariant spreads different inputs across a pool instead of always returning index 0', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    const seeds = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
    const picks = new Set(seeds.map((s) => pickVariant(s, pool)));
    expect(picks.size).toBeGreaterThan(1); // real variation, not one canned pick every time
  });

  it('pickVariant is deterministic for the same seed -- testable, not randomly flaky', () => {
    expect(pickVariant('same input', ['x', 'y', 'z'])).toBe(pickVariant('same input', ['x', 'y', 'z']));
  });

  it('applyHumility caps confidence below 1.0 even when the underlying source reports full certainty', () => {
    const { confidence } = applyHumility('some answer', 1.0);
    expect(confidence).toBeLessThan(1.0);
  });

  it('applyHumility appends an honest hedge caveat when confidence is genuinely low', () => {
    const { message, confidence } = applyHumility('a shaky answer', 0.3);
    expect(confidence).toBe(0.3);
    expect(message).toMatch(/not fully confident/i);
  });

  it('applyHumility leaves a reasonably confident message unhedged (just capped)', () => {
    const { message } = applyHumility('a solid answer', 0.8);
    expect(message).toBe('a solid answer');
  });

  it('detectAmbiguousIntent asks for clarification instead of silently guessing when signals conflict', () => {
    const clarify = detectAmbiguousIntent('remember to plan the trip');
    expect(clarify).toBeTruthy();
    expect(clarify!.metadata?.domain).toBe('clarify');
    expect(clarify!.suggestions.length).toBeGreaterThan(0);
  });

  it('detectAmbiguousIntent returns null when only one intent signal is present', () => {
    expect(detectAmbiguousIntent('help me plan a trip')).toBeNull();
    expect(detectAmbiguousIntent('what do you remember about this')).toBeNull();
  });

  it('processMessage() in fallback mode weaves the empathy prefix into the real returned response, not just internal state', async () => {
    resetBot();
    const bot = await getBot();
    const response = await bot.processMessage('I am so sad, my manager fired me yesterday');
    expect(response.message).toMatch(/relieved|better off/);
  });

  it('processMessage() short-circuits to a clarifying question on ambiguous intent instead of guessing', async () => {
    resetBot();
    const bot = await getBot();
    const response = await bot.processMessage('remember to plan the launch');
    expect(response.metadata?.domain).toBe('clarify');
  });

  it('processMessage() never returns full 1.0 confidence, even for a friendly greeting', async () => {
    resetBot();
    const bot = await getBot();
    const response = await bot.processMessage('hello there');
    expect(response.confidence).toBeLessThan(1.0);
  });
});
