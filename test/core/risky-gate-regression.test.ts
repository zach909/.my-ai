/**
 * Regression tests for two ways a risky tool ran without asking.
 *
 * 1. The gate decided from the router's fuzzy score. With default settings
 *    (every risky tool asks) the terse command "read secret.txt" scored 3, under
 *    the hold line of 4, so the file system plugin read the file and returned its
 *    contents with no approval, while the longer "please read secret.txt for me"
 *    was held. The plugin's own parser is exact where the score is not, so the
 *    gate now asks the plugin (BasePlugin.wouldAct).
 * 2. A tool neuron firing is a network activation, not a person's decision. The
 *    layer ran a fired tool on the Access check alone, which is skipped for a tool
 *    that declares no capability. With a gate a fired risky tool is held and
 *    refused instead.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginRegistry } from '../../plugin_manager/registry.js';
import { ToolGate, defaultSafety, HOLD_SCORE } from '../../models && skills/core/tool-safety.js';
import { FileSystemPlugin } from '../../plugins/file-system.js';
import { TerminalPlugin } from '../../plugins/terminal.js';
import { DesktopPlugin } from '../../plugins/desktop.js';
import { HyperDimensionalEngine, ZipLoopInterface } from '../../models && skills/core/onebrain.js';
import { ToolNeuronLayer, toolCallPath } from '../../models && skills/core/tool-neurons.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'risky-gate-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the gate asks the plugin, not the router score', () => {
  it('holds when the plugin will act, however weakly it scored', () => {
    const g = new ToolGate({ settings: () => defaultSafety() });
    const d = g.check('file-system', 'read secret.txt', 0.1, true);
    expect(d.allow).toBe(false);
    expect(g.pending()).toHaveLength(1);
  });

  it('does not hold when the plugin says it will not act, however strongly it scored', () => {
    const g = new ToolGate({ settings: () => defaultSafety() });
    expect(g.check('file-system', 'how are you today', 100, false)).toEqual({ allow: true });
  });

  it('falls back to the score when the plugin cannot say', () => {
    const g = new ToolGate({ settings: () => defaultSafety() });
    expect(g.check('email', 'how are you', HOLD_SCORE - 1)).toEqual({ allow: true });
    expect(g.check('email', 'email bob', HOLD_SCORE).allow).toBe(false);
  });

  it('a tool the owner stopped asking about is still not held', () => {
    const g = new ToolGate({ settings: () => ({ ...defaultSafety(), ask: { 'file-system': false } }) });
    expect(g.check('file-system', 'read secret.txt', 0, true)).toEqual({ allow: true });
  });
});

describe('the real file system plugin, through the real registry', () => {
  async function setup() {
    writeFileSync(join(dir, 'secret.txt'), 'TOP-SECRET-CONTENT');
    const reg = new PluginRegistry();
    const def = { id: 'file-system', name: 'file-system', type: 'tool', capabilities: ['file-system'] } as never;
    const plugin = new FileSystemPlugin(def);
    plugin.setRootDir(dir);
    reg.register(def, plugin);
    await reg.activate('file-system');
    const gate = new ToolGate({ settings: () => defaultSafety() });
    reg.setGate(gate);
    return { reg, gate };
  }

  it('"read secret.txt" as a command is held and the file is not read', async () => {
    const { reg, gate } = await setup();
    const out = String(await reg.dispatch('read secret.txt', 'command'));
    expect(out).toContain('Waiting for your permission');
    expect(out).not.toContain('TOP-SECRET-CONTENT');
    expect(gate.pending()).toHaveLength(1);
  });

  it.each(['question', ''])('and under intent "%s" it never leaks the file either (held, or not routed at all)', async (intent) => {
    const { reg } = await setup();
    await reg.dispatch('read secret.txt', 'command');   // the router remembers what it was asked before
    const out = await reg.dispatch('read secret.txt', intent);
    expect(String(out ?? '')).not.toContain('TOP-SECRET-CONTENT');
    if (out !== null) expect(String(out)).toContain('Waiting for your permission');
  });

  it('the other verbs the plugin acts on are held too', async () => {
    const { reg, gate } = await setup();
    for (const msg of ['list .', 'exists secret.txt', 'open secret.txt', 'download secret.txt']) {
      const out = String(await reg.dispatch(msg, 'command'));
      expect(out).toContain('Waiting for your permission');
      expect(out).not.toContain('TOP-SECRET-CONTENT');
    }
    expect(gate.pending().length).toBeGreaterThanOrEqual(4);
  });

  it('ordinary chat that the plugin would decline is not held', async () => {
    const { reg, gate } = await setup();
    const out = await reg.dispatch('how was your weekend?', 'question');
    expect(String(out ?? '')).not.toContain('Waiting for your permission');
    expect(gate.pending()).toHaveLength(0);
  });
});

describe('wouldAct predicates agree with onMessage', () => {
  it('terminal, desktop and file-system say yes exactly where they act', () => {
    const t = new TerminalPlugin({ id: 'terminal', name: 'Terminal', type: 'api-connection', capabilities: [] });
    expect(t.wouldAct('run: ls')).toBe(true);
    expect(t.wouldAct('execute whoami')).toBe(true);
    expect(t.wouldAct('I might run later')).toBe(false);
    const d = new DesktopPlugin({ id: 'desktop', name: 'Desktop', type: 'api-connection', capabilities: [] }, {} as never);
    expect(d.wouldAct('desktop: screenshot')).toBe(true);
    expect(d.wouldAct('what is on my desktop')).toBe(false);
  });
});

describe('a tool neuron firing is not a person saying yes', () => {
  const CHAT = { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3, sendIn: 4, sendOut: 5 };
  const WIRE = 4;
  const engine = () => new HyperDimensionalEngine({ neuronCount: 16, dimensions: 8, propagationSteps: 24, convergenceThreshold: 0.01, hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true, seed: 3 });

  async function fireWrite(gateSettings: ReturnType<typeof defaultSafety>) {
    const e = engine();
    new ZipLoopInterface(e, CHAT);
    const terminal = new TerminalPlugin({ id: 'terminal', name: 'Terminal', type: 'api-connection', capabilities: [] });
    const gate = new ToolGate({ settings: () => gateSettings });
    const layer = new ToolNeuronLayer(e, { yieldTo: () => Promise.resolve(), gate });
    layer.attach(terminal);
    e.setConnection(layer.neuronFor('terminal', 'write_file')!, CHAT.bit1In, WIRE);
    new ZipLoopInterface(e, CHAT).sendByte(0xff);
    const events = await layer.step({ files: { [toolCallPath('terminal', 'write_file')]: JSON.stringify({ path: 'by-neuron.txt', content: 'x', cwd: dir }) } });
    await layer.idle();
    layer.dispose();
    return { events, gate };
  }

  it('is held and refused: nothing is written, and an approval request exists', async () => {
    const { events, gate } = await fireWrite(defaultSafety());
    expect(events).toHaveLength(1);
    expect(events[0].ok).toBe(false);
    expect(events[0].error).toContain('Waiting for your permission');
    expect(existsSync(join(dir, 'by-neuron.txt'))).toBe(false);
    expect(gate.pending()).toHaveLength(1);
  });

  it('runs only when the owner has switched asking off for that tool', async () => {
    const { events } = await fireWrite({ ...defaultSafety(), ask: { terminal: false } });
    expect(events[0].ok).toBe(true);
    expect(existsSync(join(dir, 'by-neuron.txt'))).toBe(true);
  });
});
