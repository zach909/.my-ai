/**
 * NeuroclawSystem.askOneBrain(): the brain's own turn, against the real
 * system -- a message that names a tool call, and a message the brain is
 * given a deadline to answer.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('askOneBrain on the real system', () => {
  it('a message naming a tool call is made as a message-origin neuron event, or refused by access -- never skipped', async () => {
    const { getNeuroclawSystem } = await import('../../src/index.js');
    const system = await getNeuroclawSystem();
    const dir = mkdtempSync(join(tmpdir(), 'front-door-'));
    try {
      const file = join(dir, 'note.txt');
      writeFileSync(file, 'hello from the file');
      const turn = await system.askOneBrain(`read file ${file}`);
      expect(turn.answered).toBe(true);
      expect(turn.via).toBe('router');
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls[0]).toMatchObject({ plugin: 'terminal', tool: 'read_file' });
      if (turn.toolCalls[0].ok) expect(turn.text).toContain('hello from the file');
      else expect(turn.text).toContain('did not run');
      // The call went through the layer: it is in its history as a message-origin event.
      expect(system.toolNeurons!.history().some(e => e.tool === 'read_file' && e.origin === 'message')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('a call the Access page refuses is reported, and nothing is written', async () => {
    const { getNeuroclawSystem } = await import('../../src/index.js');
    const system = await getNeuroclawSystem();
    const dir = mkdtempSync(join(tmpdir(), 'front-door-'));
    try {
      const target = join(dir, 'should-not-exist.txt');
      const turn = await system.askOneBrain(`write file ${target} with nope`);
      // Whether it is allowed depends on this install's Access settings; either
      // way the turn must say what happened and must not claim a success it
      // did not have.
      expect(turn.via).toBe('router');
      const { existsSync } = await import('node:fs');
      expect(existsSync(target)).toBe(turn.toolCalls[0].ok);
      if (!turn.toolCalls[0].ok) expect(turn.text).toContain('did not run');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('gives up on the brain at its deadline instead of hanging the turn', async () => {
    const { getNeuroclawSystem } = await import('../../src/index.js');
    const system = await getNeuroclawSystem();
    const started = Date.now();
    const turn = await system.askOneBrain('tell me something interesting about volcanoes', { deadlineMs: 1500 });
    const took = Date.now() - started;
    // Not "<1.5s": one settle of the mesh can outlast the deadline. But it must be bounded.
    expect(took).toBeLessThan(45_000);
    expect(['brain', 'none']).toContain(turn.via);
    if (!turn.answered) expect(turn.text).toBe('');
  }, 90_000);

  it('NEUROCLAW_ONEBRAIN_FIRST=0 turns it off', async () => {
    const { getNeuroclawSystem } = await import('../../src/index.js');
    const system = await getNeuroclawSystem();
    process.env.NEUROCLAW_ONEBRAIN_FIRST = '0';
    try {
      const turn = await system.askOneBrain('run `echo hi`');
      expect(turn).toMatchObject({ answered: false, via: 'none', toolCalls: [] });
    } finally {
      delete process.env.NEUROCLAW_ONEBRAIN_FIRST;
    }
  }, 60_000);
});
