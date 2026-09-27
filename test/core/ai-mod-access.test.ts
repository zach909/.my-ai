/**
 * The AI's access to mods.
 *
 * A mod overwrites this app's own source files, so looking at mods is
 * ordinary reading but applying or reverting one is its own capability,
 * mods.apply, which nothing grants by default. The tools check it themselves:
 * callTool() runs a tool for any caller, so a declared capability alone would
 * not stop a chat message from applying a mod.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TerminalPlugin } from '../../plugins/terminal';
import { CAPABILITIES, defaultGrants, CAPABILITY_SWITCH, CAPABILITY_MINIMUM } from '../../models && skills/core/access-manager';
import { resetSharedAccessManager, sharedAccessManager } from '../../models && skills/core/access-settings';

describe('the AI and mods', () => {
  let dir: string;
  const saved = { access: process.env.CORONA_ACCESS_FILE, store: process.env.NEUROCLAW_STORE_DIR };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ai-mods-'));
    process.env.CORONA_ACCESS_FILE = join(dir, 'access.json');
    process.env.NEUROCLAW_STORE_DIR = join(dir, 'store');
    resetSharedAccessManager();
  });
  afterEach(() => {
    if (saved.access === undefined) delete process.env.CORONA_ACCESS_FILE; else process.env.CORONA_ACCESS_FILE = saved.access;
    if (saved.store === undefined) delete process.env.NEUROCLAW_STORE_DIR; else process.env.NEUROCLAW_STORE_DIR = saved.store;
    resetSharedAccessManager();
    rmSync(dir, { recursive: true, force: true });
  });

  const terminal = () => new TerminalPlugin({ id: 'terminal', name: 'Terminal', type: 'api-connection', capabilities: ['terminal'] });

  it('mods.apply is its own capability, under the workspace switch, and not granted by default', () => {
    expect(CAPABILITIES).toContain('mods.apply');
    expect(CAPABILITY_SWITCH['mods.apply']).toBe('workspace');
    expect(CAPABILITY_MINIMUM['mods.apply']).toBe('system');
    expect(defaultGrants().some((g) => g.capability === 'mods.apply')).toBe(false);
  });

  it('the AI can list mods without any extra grant', async () => {
    const event = await terminal().callTool('list_mods', {});
    expect(event.ok).toBe(true);
    expect(Array.isArray(event.result)).toBe(true);
  });

  it('applying or reverting a mod is refused until mods.apply is granted', async () => {
    const t = terminal();
    const apply = await t.callTool('apply_mod', { name: 'anything' });
    expect(apply.ok).toBe(false);
    expect(apply.error).toContain('"mods.apply" is not granted');
    const revert = await t.callTool('revert_mod', { name: 'anything' });
    expect(revert.ok).toBe(false);
    expect(revert.error).toContain('"mods.apply" is not granted');
  });

  it('once granted, the gate lets the call through to the mod itself', async () => {
    sharedAccessManager().grant({ capability: 'mods.apply', level: 'system' });
    const apply = await terminal().callTool('apply_mod', { name: 'no-such-mod' });
    // Past the gate: the refusal is now about the mod, not the permission.
    expect(apply.ok).toBe(false);
    expect(apply.error).toMatch(/no published mod/);
  });
});
