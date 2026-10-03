/**
 * Tools fire from their own neurons during a chat turn.
 *
 * Calling a tool should be the network lighting up that tool's neuron, not
 * the network spelling "call tool X" out letter by letter through the Zip
 * Loop. The tool-neuron layer latches any tool neuron that crosses its firing
 * line on any tick; a chat turn must then actually make those calls.
 */
import { describe, it, expect } from 'vitest';

describe('tool neurons in a chat turn', () => {
  it('a tool whose neuron fired is called during the turn, and reported', async () => {
    const { getNeuroclawSystem } = await import('../../src/index.js');
    const system = await getNeuroclawSystem();
    const layer = system.toolNeurons;
    expect(layer).toBeTruthy();
    const neuronId = layer!.neuronFor('terminal', 'list_terminals');
    expect(neuronId).toBeTypeOf('number');

    // Light the tool's neuron: drive it hard for one tick. The layer's tick
    // observer latches the crossing as a firing.
    const engine = system.pipeline.ensureBrain();
    engine.process(new Array(engine.getDimensions()).fill(5), undefined, new Set([neuronId!]), undefined, { learn: false });
    expect(layer!.fired().some((f) => f.tool === 'list_terminals')).toBe(true);

    await system.processQuery('hello there');
    const calls = system.lastTurnDetails?.toolCalls ?? [];
    expect(calls.some((c) => c.plugin === 'terminal' && c.tool === 'list_terminals')).toBe(true);
    // Consumed: the same firing is not called again next turn.
    expect(layer!.fired().some((f) => f.tool === 'list_terminals')).toBe(false);
  }, 120_000);
});
