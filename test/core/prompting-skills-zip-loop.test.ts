/**
 * Section 7: a Prompting Skill's prompt reaches the Zip Loop.
 *
 *   Prompting Skill -> Skill Folder -> Prompt -> INPUT -> ZIP LOOP -> WAVE
 *
 * Prompting Skills were reachable from exactly one place, the chat-bot
 * service, where they steer a separate procedural perceive-think-act loop.
 * That is a real use of them and it is not this one. The architecture says
 * the prompt is "provided to the Zip Loop as part of the information being
 * processed", so the neural side sees the instruction alongside the question
 * -- and it never did. A skill folder full of instructions had no effect
 * whatsoever on anything the mesh computed.
 */

import { describe, it, expect } from 'vitest';

describe('a prompting skill reaches the zip loop', () => {
  it('puts the applicable instructions on the loop alongside the message', async () => {
    const { getNeuroclawSystem } = await import('../../src/index.js');
    const system = await getNeuroclawSystem();

    // Watch what actually goes onto the loop this turn.
    const loop = (system.zipIO as unknown as { inputLoop: { zipInput: (t: string) => Promise<unknown> } }).inputLoop;
    const seen: string[] = [];
    const original = loop.zipInput.bind(loop);
    loop.zipInput = async (text: string) => { seen.push(String(text)); return original(text); };
    try {
      await system.processQuery('How should I plan a difficult task?');
    } finally {
      loop.zipInput = original;
    }

    // The message itself, and at least one stored instruction with it.
    expect(seen.some(t => t.includes('How should I plan a difficult task?'))).toBe(true);
    const instructions = seen.filter(t => t.startsWith('Skill "'));
    expect(instructions.length).toBeGreaterThan(0);
    // Capped, because the loop is a working context with a size and
    // instructions must not crowd out the conversation.
    expect(instructions.length).toBeLessThanOrEqual(3);
  }, 120_000);
});
