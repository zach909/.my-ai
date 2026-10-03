/**
 * Message -> tool call (tool-router.ts), dispatch through the tool layer with
 * the Access check, and teaching a tool neuron to light from a prompt.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HyperDimensionalEngine, ZipLoopInterface } from '../../models && skills/core/onebrain.js';
import { ToolNeuronLayer } from '../../models && skills/core/tool-neurons.js';
import { routeToolCall } from '../../models && skills/core/tool-router.js';
import { AccessManager } from '../../models && skills/core/access-manager.js';
import { TerminalPlugin } from '../../plugins/terminal.js';
// @ts-expect-error -- plain .mjs script, no types
import { buildToolCallExamples } from '../../scripts/tool-call-dataset.mjs';

describe('routeToolCall', () => {
  it('reads explicit commands, files and directories', () => {
    expect(routeToolCall('run `ls -la`')).toMatchObject({ plugin: 'terminal', tool: 'run', args: { command: 'ls -la' } });
    expect(routeToolCall('Please execute the command `npm test`')).toMatchObject({ tool: 'run', args: { command: 'npm test' } });
    expect(routeToolCall('run command: echo hi')).toMatchObject({ tool: 'run', args: { command: 'echo hi' } });
    expect(routeToolCall('$ pwd')).toMatchObject({ tool: 'run', args: { command: 'pwd' } });
    expect(routeToolCall('read file notes.txt')).toMatchObject({ tool: 'read_file', args: { path: 'notes.txt' } });
    expect(routeToolCall('list directory src')).toMatchObject({ tool: 'list_directory', args: { path: 'src' } });
    expect(routeToolCall('write file a.txt with hello there')).toMatchObject({ tool: 'write_file', args: { path: 'a.txt', content: 'hello there' } });
    expect(routeToolCall('list terminals')).toMatchObject({ tool: 'list_terminals' });
    expect(routeToolCall('list windows')).toMatchObject({ plugin: 'desktop', tool: 'list_windows' });
    expect(routeToolCall('take a screenshot')).toMatchObject({ plugin: 'desktop', tool: 'screenshot' });
  });

  it('leaves everything that only sounds related alone', () => {
    for (const text of [
      'hello there',
      'how do I run a marathon?',
      'what does the ls command do',
      'list all pages',
      'I read the file yesterday and it was long',
      'remember to run the tests later',
      '',
    ]) {
      expect(routeToolCall(text), text).toBeNull();
    }
  });
});

describe('tool-call dataset', () => {
  const examples = buildToolCallExamples() as Array<{ prompt: string; plugin: string; tool: string; args: Record<string, unknown>; explicit: boolean }>;

  it('every explicit example is routed to exactly the tool and arguments it is labelled with', () => {
    const explicit = examples.filter(e => e.explicit);
    expect(explicit.length).toBeGreaterThan(20);
    for (const e of explicit) {
      const routed = routeToolCall(e.prompt);
      expect(routed, e.prompt).not.toBeNull();
      expect({ plugin: routed!.plugin, tool: routed!.tool, args: routed!.args }, e.prompt).toEqual({ plugin: e.plugin, tool: e.tool, args: e.args });
    }
  });

  it('every paraphrase is left alone by the router -- a wrong guess runs a real command', () => {
    const paraphrases = examples.filter(e => !e.explicit);
    expect(paraphrases.length).toBeGreaterThan(10);
    for (const e of paraphrases) expect(routeToolCall(e.prompt), e.prompt).toBeNull();
  });
});

const makeEngine = () => new HyperDimensionalEngine({
  neuronCount: 16, dimensions: 8, propagationSteps: 24, convergenceThreshold: 0.01,
  hyperGain: 1, hyperWaveGain: 1, hyperAdd: 1, hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true,
});
const immediate = () => Promise.resolve();
const CHAT = { bit0In: 0, bit1In: 1, bit0Out: 2, bit1Out: 3, sendIn: 4, sendOut: 5 };

describe('ToolNeuronLayer.dispatch', () => {
  let engine: HyperDimensionalEngine;
  let terminal: TerminalPlugin;
  let dir: string;

  beforeEach(() => {
    engine = makeEngine();
    new ZipLoopInterface(engine, CHAT);
    terminal = new TerminalPlugin({ id: 'terminal', name: 'Terminal', type: 'api-connection', capabilities: [] });
    dir = mkdtempSync(join(tmpdir(), 'tool-router-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('calls the tool as a message-origin neuron event when access allows it', async () => {
    const layer = new ToolNeuronLayer(engine, { yieldTo: immediate });
    layer.attach(terminal);
    const event = await layer.dispatch('terminal', 'write_file', { path: 'out.txt', content: 'hi', cwd: dir });
    await layer.idle();
    layer.dispose();
    expect(event.ok).toBe(true);
    expect(event.origin).toBe('message');
    expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe('hi');
    expect(layer.getStats().otherCalls).toBe(1);
  });

  it('refuses what the Access page does not allow, without touching the tool', async () => {
    const layer = new ToolNeuronLayer(engine, { yieldTo: immediate, access: new AccessManager([]) });
    layer.attach(terminal);
    const event = await layer.dispatch('terminal', 'write_file', { path: 'no.txt', content: 'x', cwd: dir });
    await layer.idle();
    layer.dispose();
    expect(event.ok).toBe(false);
    expect(event.error).toContain('files.write');
    expect(existsSync(join(dir, 'no.txt'))).toBe(false);
  });

  it('reports a tool with no neuron instead of throwing', async () => {
    const layer = new ToolNeuronLayer(engine, { yieldTo: immediate });
    layer.attach(terminal);
    const event = await layer.dispatch('terminal', 'nope', {});
    layer.dispose();
    expect(event.ok).toBe(false);
    expect(event.error).toContain('terminal.nope');
  });
});
