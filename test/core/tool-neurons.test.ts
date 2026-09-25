/**
 * Multi-input, multi-output, measured.
 *
 * The Zip Loop is one input (the chat's 1 and 0 neurons) and one output (the
 * chat's 1 and 0 output neurons). Tool neurons add the rest: every terminal
 * and desktop tool is an output neuron of its own, and each plugin has a pair
 * of input neurons its results come back in on. These tests check each path
 * by watching what the network is actually driven with -- which neurons, and
 * which bits -- rather than by trusting the layer's own report of what it did.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HyperDimensionalEngine, ZipLoopInterface } from '../../models && skills/core/onebrain.js';
import { runUntilStopped, unpackZip } from '../../models && skills/core/zip-halt.js';
import {
  ToolNeuronLayer,
  toolCallPath,
  toolErrorPath,
  toolInputGroup,
  toolOutputGroup,
  toolResultPath,
} from '../../models && skills/core/tool-neurons.js';
import { AccessManager } from '../../models && skills/core/access-manager.js';
import type { DesktopControl } from '../../models && skills/core/desktop-control.js';
import { TerminalPlugin } from '../../plugins/terminal.js';
import { DesktopPlugin } from '../../plugins/desktop.js';
import { createPluginInstance } from '../../plugins/index.js';

const D = 8;
const CHAT = { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3 };
/** Strong enough to fire a tool neuron from one driven input; measured 0.47 against a floor near 0.001. */
const WIRE = 4;

const makeEngine = () => new HyperDimensionalEngine({
  neuronCount: 16, dimensions: D, propagationSteps: 24, convergenceThreshold: 0.01,
  hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
  waveGain: 0.1, connectionBias: true,
});

/** A desktop with no display needed: the calls are real, the screen is not. */
const fakeDesktop = () => ({
  probe: async () => ({ display: ':0', wayland: false, tools: {}, usable: true, summary: 'test desktop' }),
  listWindows: async () => [{ id: '0x01', desktop: '0', pid: 1, host: 'h', title: 'agent term', agentOwned: true }],
  screenshot: async () => Buffer.from('png-bytes'),
  launchAgentWindow: async () => ({ pid: 42, marked: true }),
  moveWindow: async () => undefined,
  closeWindow: async () => undefined,
  typeInto: async () => undefined,
  clickIn: async () => undefined,
}) as unknown as DesktopControl;

/**
 * Record every tick's driven neurons, in order. The real process() still runs
 * -- this only watches what it was asked to drive.
 */
function watchDrives(engine: HyperDimensionalEngine): { drives: number[][]; stop: () => void } {
  const drives: number[][] = [];
  const real = engine.process.bind(engine);
  (engine as unknown as { process: unknown }).process = (input: number[], a: unknown, driven?: Set<number>, ...rest: unknown[]) => {
    drives.push(driven ? [...driven] : []);
    return (real as (...args: unknown[]) => unknown)(input, a, driven, ...rest);
  };
  return { drives, stop: () => { (engine as unknown as { process: unknown }).process = real; } };
}

/**
 * Rebuild the bytes a result channel was driven with. Each input tick drives
 * exactly one of the pair; the final learning tick re-drives the last bit and
 * is not a new bit, so it is left off.
 */
function bytesOn(drives: number[][], channel: { bit0In: number; bit1In: number }): Uint8Array {
  const bits = drives
    .filter(d => d.length === 1 && (d[0] === channel.bit0In || d[0] === channel.bit1In))
    .map(d => (d[0] === channel.bit1In ? 1 : 0));
  bits.pop();
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    out[i] = byte;
  }
  return out;
}

const immediate = () => Promise.resolve();

describe('plugin tools', () => {
  it('the terminal has its own tools, including writing a new file', async () => {
    const terminal = new TerminalPlugin({ id: 'terminal', name: 'Terminal', type: 'api-connection', capabilities: [] });
    const names = terminal.getTools().map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['run', 'run_background', 'write_file', 'read_file', 'list_directory']));

    const dir = mkdtempSync(join(tmpdir(), 'tool-terminal-'));
    try {
      const written = await terminal.callTool('write_file', { path: 'sub/new.txt', content: 'hello', cwd: dir });
      expect(written.ok).toBe(true);
      expect(readFileSync(join(dir, 'sub/new.txt'), 'utf8')).toBe('hello');
      const read = await terminal.callTool('read_file', { path: 'sub/new.txt', cwd: dir });
      expect((read.result as { content: string }).content).toBe('hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a call missing an argument fails before it runs, and says what is missing', async () => {
    const terminal = new TerminalPlugin({ id: 'terminal', name: 'Terminal', type: 'api-connection', capabilities: [] });
    const event = await terminal.callTool('write_file', { path: 'x.txt' });
    expect(event.ok).toBe(false);
    expect(event.error).toContain('content');
  });

  it('the desktop has its own tools, and the name "desktop" reaches it rather than multi-input', async () => {
    const plugin = createPluginInstance('Desktop', { id: 'desktop', name: 'Desktop', type: 'api-connection', capabilities: [] });
    expect(plugin).toBeInstanceOf(DesktopPlugin);
    const desktop = new DesktopPlugin({ id: 'desktop', name: 'Desktop', type: 'api-connection', capabilities: [] }, fakeDesktop());
    expect(desktop.getTools().map(t => t.name)).toEqual(
      expect.arrayContaining(['probe', 'list_windows', 'screenshot', 'launch_app', 'type_text', 'click']),
    );
    const windows = await desktop.callTool('list_windows');
    expect(windows.ok).toBe(true);
    expect(await desktop.onMessage('desktop list windows')).toMatchObject({ tool: 'desktop.list_windows' });
    // Strict: not a desktop command, not this plugin's message.
    expect(await desktop.onMessage('what is the weather')).toBeNull();
  });
});

describe('tool neurons: every tool is a neuron, every plugin has its own input', () => {
  let engine: HyperDimensionalEngine;
  let terminal: TerminalPlugin;
  let desktop: DesktopPlugin;
  let layer: ToolNeuronLayer;
  let dir: string;

  beforeEach(() => {
    engine = makeEngine();
    // The chat doorway first, on neurons 0-3, exactly as the live system has it.
    new ZipLoopInterface(engine, CHAT);
    terminal = new TerminalPlugin({ id: 'terminal', name: 'Terminal', type: 'api-connection', capabilities: [] });
    desktop = new DesktopPlugin({ id: 'desktop', name: 'Desktop', type: 'api-connection', capabilities: [] }, fakeDesktop());
    layer = new ToolNeuronLayer(engine, { yieldTo: immediate });
    layer.attach(terminal);
    layer.attach(desktop);
    dir = mkdtempSync(join(tmpdir(), 'tool-neurons-'));
  });

  afterEach(() => {
    layer.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('gives every tool its own neuron, and every plugin its own result neurons, apart from the chat doorway', () => {
    const { tools, channels } = layer.layout();
    expect(tools.length).toBe(terminal.getTools().length + desktop.getTools().length);

    const toolIds = tools.map(t => t.neuronId);
    const channelIds = channels.flatMap(c => [c.bit0In, c.bit1In]);
    const all = [...toolIds, ...channelIds];
    // No neuron serves two purposes, and none is one of the chat doorway's.
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(Object.values(CHAT)).not.toContain(id);

    // Output layer and input layer per plugin, as groups on the one network.
    expect(engine.neuronsInGroup(toolOutputGroup('terminal')).length).toBe(terminal.getTools().length);
    expect(engine.neuronsInGroup(toolOutputGroup('desktop')).length).toBe(desktop.getTools().length);
    expect(engine.neuronsInGroup(toolInputGroup('terminal')).length).toBe(2);
    expect(engine.neuronsInGroup(toolInputGroup('desktop')).length).toBe(2);
  });

  it('attaching again does not grow the network', () => {
    const before = engine.getNeuronCount();
    const again = new ToolNeuronLayer(engine, { yieldTo: immediate });
    const result = again.attach(terminal);
    expect(result.added).toBe(0);
    expect(engine.getNeuronCount()).toBe(before);
    expect(result.tools.write_file).toBe(layer.neuronFor('terminal', 'write_file'));
    again.dispose();
  });

  it('input through the Zip Loop fires the write-file neuron, and the file is written from the Zip Loop output', async () => {
    const writeNeuron = layer.neuronFor('terminal', 'write_file')!;
    engine.setConnection(writeNeuron, CHAT.bit1In, WIRE);

    const zip = new ZipLoopInterface(engine, CHAT);
    zip.sendByte(0xff);

    expect(layer.fired().map(f => f.key)).toEqual(['terminal.write_file']);

    // The other side of the Zip Loop: the output archive carries the call's arguments.
    const output = { files: { [toolCallPath('terminal', 'write_file')]: JSON.stringify({ path: 'made-by-a-neuron.txt', content: 'fired', cwd: dir }) } };
    const events = await layer.step(output);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ plugin: 'terminal', tool: 'write_file', origin: 'network', ok: true });
    expect(readFileSync(join(dir, 'made-by-a-neuron.txt'), 'utf8')).toBe('fired');
    // Consumed: the same firing is not a second call.
    expect(await layer.step(output)).toEqual([]);
  });

  it('arguments in the output with no neuron firing are not a call -- the neuron is the call', async () => {
    const output = { files: { [toolCallPath('terminal', 'write_file')]: JSON.stringify({ path: 'never.txt', content: 'x', cwd: dir }) } };
    expect(await layer.step(output)).toEqual([]);
    expect(existsSync(join(dir, 'never.txt'))).toBe(false);
  });

  it('the result comes back in on the terminal\'s own input neurons -- and only there', async () => {
    const writeNeuron = layer.neuronFor('terminal', 'write_file')!;
    engine.setConnection(writeNeuron, CHAT.bit1In, WIRE);
    new ZipLoopInterface(engine, CHAT).sendByte(0xff);

    const watch = watchDrives(engine);
    const [event] = await layer.step({ files: { [toolCallPath('terminal', 'write_file')]: JSON.stringify({ path: 'r.txt', content: 'abc', cwd: dir }) } });
    await layer.idle();
    watch.stop();

    const terminalIn = layer.channelFor('terminal')!;
    const desktopIn = layer.channelFor('desktop')!;
    const touched = new Set(watch.drives.flat());
    expect(touched.has(terminalIn.bit0In) || touched.has(terminalIn.bit1In)).toBe(true);
    // Not the chat doorway, not the desktop's channel.
    for (const id of [CHAT.bit0In, CHAT.bit1In, desktopIn.bit0In, desktopIn.bit1In]) expect(touched.has(id)).toBe(false);

    // And what went in, read back off the neurons bit by bit, is the result itself.
    const heard = bytesOn(watch.drives, terminalIn);
    expect([...heard]).toEqual([...layer.packResult(event)]);
    const tree = unpackZip(heard)!;
    const body = JSON.parse(tree.files[toolResultPath('terminal', 'write_file')]);
    expect(body.result.path).toBe(join(dir, 'r.txt'));
    expect(layer.getStats().resultsFed).toBe(1);
  });

  it('many in, many out: chat input fires a terminal tool, whose result fires a desktop tool', async () => {
    // Input 1 (chat) -> output 1 (terminal.write_file).
    engine.setConnection(layer.neuronFor('terminal', 'write_file')!, CHAT.bit1In, WIRE);
    // Input 2 (the terminal's results) -> output 2 (desktop.list_windows).
    const terminalIn = layer.channelFor('terminal')!;
    const listWindows = layer.neuronFor('desktop', 'list_windows')!;
    engine.setConnection(listWindows, terminalIn.bit1In, WIRE);

    new ZipLoopInterface(engine, CHAT).sendByte(0xff);
    const first = await layer.step({ files: { [toolCallPath('terminal', 'write_file')]: JSON.stringify({ path: 'a.txt', content: 'a', cwd: dir }) } });
    expect(first.map(e => `${e.plugin}.${e.tool}`)).toEqual(['terminal.write_file']);

    // The terminal's result streams in on its own channel -- and the network,
    // hearing it there, fires the desktop tool.
    await layer.idle();
    expect(layer.fired().map(f => f.key)).toContain('desktop.list_windows');
    const watch = watchDrives(engine);
    const second = await layer.step(null);
    const listed = second.find(e => e.tool === 'list_windows')!;
    expect(listed).toMatchObject({ plugin: 'desktop', origin: 'network', ok: true });

    // And the desktop's result comes back on the desktop's channel.
    await layer.idle();
    watch.stop();
    const desktopIn = layer.channelFor('desktop')!;
    const tree = unpackZip(bytesOn(watch.drives, desktopIn))!;
    expect(JSON.parse(tree.files[toolResultPath('desktop', 'list_windows')]).result[0].title).toBe('agent term');
  });

  it('two tools on two plugins fire from one input at once', async () => {
    engine.setConnection(layer.neuronFor('terminal', 'list_terminals')!, CHAT.bit1In, WIRE);
    engine.setConnection(layer.neuronFor('desktop', 'probe')!, CHAT.bit1In, WIRE);
    new ZipLoopInterface(engine, CHAT).sendByte(0xff);
    expect(layer.fired().map(f => f.key).sort()).toEqual(['desktop.probe', 'terminal.list_terminals']);
    const events = await layer.step(null);
    expect(events.every(e => e.ok && e.origin === 'network')).toBe(true);
    await layer.idle();
    expect(layer.getStats().resultsFed).toBe(2);
  });

  it('a tool called from chat is a neuron event too: its neuron is driven and the result goes in', async () => {
    const runNeuron = layer.neuronFor('terminal', 'run')!;
    const watch = watchDrives(engine);
    const out = await terminal.onMessage('run: echo from-chat') as { stdout: string };
    await layer.idle();
    watch.stop();

    expect(out.stdout.trim()).toBe('from-chat');
    expect(watch.drives[0]).toEqual([runNeuron]);
    const tree = unpackZip(bytesOn(watch.drives, layer.channelFor('terminal')!))!;
    expect(JSON.parse(tree.files[toolResultPath('terminal', 'run')]).result.stdout.trim()).toBe('from-chat');
    expect(layer.history().at(-1)).toMatchObject({ tool: 'run', origin: 'message' });
    // Felt, not asked for again: driving the neuron did not latch a new call.
    expect(layer.fired()).toEqual([]);
  });

  it('fires once per crossing, not once per tick it stays up', () => {
    engine.setConnection(layer.neuronFor('terminal', 'list_terminals')!, CHAT.bit1In, WIRE);
    const pulse = new Array(D).fill(1);
    for (let i = 0; i < 5; i++) engine.process(pulse, undefined, new Set([CHAT.bit1In]), undefined, { learn: false });
    expect(layer.getStats().fired).toBe(1);
  });

  it('a firing the Access page does not allow is refused, and the refusal is what goes back in', async () => {
    layer.dispose();
    const guarded = new ToolNeuronLayer(engine, { yieldTo: immediate, access: new AccessManager([]) });
    guarded.attach(terminal);
    engine.setConnection(guarded.neuronFor('terminal', 'write_file')!, CHAT.bit1In, WIRE);
    new ZipLoopInterface(engine, CHAT).sendByte(0xff);

    const watch = watchDrives(engine);
    const [event] = await guarded.step({ files: { [toolCallPath('terminal', 'write_file')]: JSON.stringify({ path: 'no.txt', content: 'x', cwd: dir }) } });
    await guarded.idle();
    watch.stop();
    guarded.dispose();

    expect(event.ok).toBe(false);
    expect(existsSync(join(dir, 'no.txt'))).toBe(false);
    const tree = unpackZip(bytesOn(watch.drives, guarded.channelFor('terminal')!))!;
    expect(JSON.parse(tree.files[toolErrorPath('terminal', 'write_file')]).error).toContain('files.write');
  });

  it('keeps the newest results when too many are waiting', async () => {
    layer.dispose();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const slow = new ToolNeuronLayer(engine, { yieldTo: () => gate, maxPending: 1 });
    slow.attach(terminal);
    await terminal.callTool('which', { name: 'node' });  // starts streaming, parked at the gate
    await terminal.callTool('which', { name: 'sh' });    // waits
    await terminal.callTool('which', { name: 'ls' });    // replaces the waiting one
    expect(slow.getStats().dropped).toBe(1);
    release();
    await slow.idle();
    expect(slow.getStats().resultsFed).toBe(2);
    slow.dispose();
  });

  it('clips a long result before it goes in, and says so', () => {
    const packed = layer.packResult({
      plugin: 'terminal', tool: 'run', args: {}, origin: 'direct', ok: true,
      result: 'x'.repeat(5000), startedAt: 0, endedAt: 0,
    });
    const body = JSON.parse(unpackZip(packed)!.files[toolResultPath('terminal', 'run')]);
    expect(body.result.length).toBe(1024);
    expect(body.truncated).toBe(5000 - 1024);
  });

  it('a whole Zip Loop run fires the tool neuron; with no arguments in its output the tool refuses, and that goes back in', async () => {
    engine.setConnection(layer.neuronFor('terminal', 'write_file')!, CHAT.bit1In, WIRE);
    const zip = new ZipLoopInterface(engine, CHAT);
    const run = runUntilStopped(zip, { files: { 'prompt/prompt.txt': 'write a new file' } }, { quietTicks: 3, maxTicks: 64 });

    expect(layer.fired().map(f => f.key)).toContain('terminal.write_file');
    const events = await layer.step(run.tree);
    const write = events.find(e => e.tool === 'write_file')!;
    // An untrained network writes no arguments, so nothing is written -- by construction, not by luck.
    expect(write.ok).toBe(false);
    expect(write.error).toContain('path');
    await layer.idle();
    expect(layer.getStats().resultsFed).toBeGreaterThanOrEqual(1);
  });
});
