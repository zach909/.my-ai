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

  it('hands the chosen skills to generation, not just to the context buffer', async () => {
    const { getNeuroclawSystem } = await import('../../src/index.js');
    const system = await getNeuroclawSystem();
    const runner = (system as unknown as { runner: { generate: (...a: unknown[]) => Promise<string> } }).runner;
    const original = runner.generate.bind(runner);
    let skillsPassed: Array<{ name: string }> | undefined;
    runner.generate = async (...a: unknown[]) => { skillsPassed = a[2] as Array<{ name: string }>; return original(...a); };
    try {
      await system.processQuery('How should I plan a difficult task?');
    } finally {
      runner.generate = original;
    }
    expect(Array.isArray(skillsPassed) && skillsPassed.length > 0).toBe(true);
    expect(skillsPassed!.length).toBeLessThanOrEqual(3);
    expect(skillsPassed!.every((k) => typeof k.name === 'string' && k.name.length > 0)).toBe(true);
  }, 120_000);

  it('streams prompting skills through the neural Zip Loop doorway with the prompt', async () => {
    const { NeuroclawLLM } = await import('../../models && skills/llm.js');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'ps-zip-'));
    try {
      const llm = new NeuroclawLLM({ selfExtensionsDir: dir, bundledExtensionsDir: null });
      await llm.generate('plan the week', {
        promptingSkills: [
          { name: 'plan-first', title: 'Plan first', description: 'Break the goal into steps before acting.' },
          { name: 'check-work', title: 'Check work', description: 'Verify each step.' },
        ],
      });
      // The prompt and each skill, in its own prompting-skills/ folder, went
      // into the one archive the mesh reads bit by bit.
      expect(llm.lastZipLoopFiles).toContain('prompt/prompt.txt');
      expect(llm.lastZipLoopFiles).toContain('prompting-skills/plan-first/SKILL.txt');
      expect(llm.lastZipLoopFiles).toContain('prompting-skills/check-work/SKILL.txt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
