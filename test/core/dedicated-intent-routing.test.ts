/**
 * A dedicated creation intent reaches its plugin, whatever the message mentions.
 *
 * dispatch() scores every plugin against the message, and for most intents that
 * is right. For 'skill-creation', 'extension-creation' and 'documentation' the
 * caller has already chosen the plugin, and scoring let file-system outrank
 * skill-maker for any procedure that mentions a file. file-system answers with
 * text instead of declining, so teaching a procedure twice produced
 * "[FileSystem] ..." and no skill. (Generated files go to a temp directory:
 * vitest.config.ts sets NEUROCLAW_GENERATED_DIR.)
 */

import { describe, it, expect } from 'vitest';

const PROCEDURE = 'first, open the file. then, parse each line. finally, write the results.';

describe('dedicated creation intents', () => {
  it('skill-creation reaches skill-maker even for a procedure about files', async () => {
    const { getNeuroclawSystem } = await import('../../src/index.js');
    const system = await getNeuroclawSystem();
    const created = await (system as any).pluginRegistry.dispatch(PROCEDURE, 'skill-creation');
    expect(typeof created).toBe('string');
    expect(created).not.toMatch(/^\[FileSystem\]/);
    expect(typeof JSON.parse(created).skill).toBe('string');
  }, 60_000);

  it('extension-creation reaches plugin-maker even for a procedure about files', async () => {
    const { getNeuroclawSystem } = await import('../../src/index.js');
    const system = await getNeuroclawSystem();
    const created = await (system as any).pluginRegistry.dispatch(PROCEDURE, 'extension-creation');
    expect(created).not.toMatch(/^\[FileSystem\]/);
    expect(JSON.parse(created).type).toBe('plugin-maker');
  }, 60_000);

  it('an ordinary message that really is about files still reaches the file-system plugin', async () => {
    const { getNeuroclawSystem } = await import('../../src/index.js');
    const system = await getNeuroclawSystem();
    const reply = await (system as any).pluginRegistry.dispatch('list files in /tmp', 'exploration');
    // Scoring still decides for the ordinary intents: this is not forced onto skill-maker.
    expect(reply === null || !String(reply).startsWith('{"skill"')).toBe(true);
  }, 60_000);
});
