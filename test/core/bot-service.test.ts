/**
 * Tests for ChatBot's getBot() singleton (src/server/bot-service.ts):
 * regression coverage for the system-upgrade path.
 */

import { getBot, resetBot } from '../../src/server/bot-service';
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
