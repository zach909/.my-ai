/**
 * No tokenizer: OneBrain's labels are bytes (memory_input_b<byte>), and a
 * model saved while the tokenizer existed still loads, translated to bytes.
 */
import { describe, it, expect } from 'vitest';
import { parseSelfExtension, migrateOneBrain, hasLegacyLabels, emptyOneBrain, foldEdges } from '../../models && skills/onebrain-memory.js';

const legacy = {
  neurons: [
    ['a', { id: 'a', label: 'memory_input_5' }],   // old id 5 = "a"
    ['s', { id: 's', label: 'memory_input_1' }],   // old id 1 = bos: no byte
    ['o', { id: 'o', label: 'memory_output_31' }], // old id 31 = "A"
  ],
  connections: [
    ['c1', { id: 'c1', fromNeuronId: 'a', toNeuronId: 'o', weightIndex: 0 }],
    ['c2', { id: 'c2', fromNeuronId: 's', toNeuronId: 'o', weightIndex: 1 }],
  ],
  weights: [0.4, 0.9],
  weightCounts: [3, 5],
};

describe('OneBrain speaks bytes', () => {
  it('reads old tokenizer ids as the bytes they spelled, and drops the special tokens', () => {
    const edges = parseSelfExtension(legacy);
    expect(edges).toEqual([expect.objectContaining({ from: 'a'.charCodeAt(0), to: 'A'.charCodeAt(0), weight: 0.4, count: 3 })]);
  });

  it('migrates a legacy model to byte labels, keeping sample counts', () => {
    expect(hasLegacyLabels(legacy)).toBe(true);
    const migrated = migrateOneBrain(legacy);
    expect(hasLegacyLabels(migrated)).toBe(false);
    expect(migrated.neurons.map(([, n]: [string, { label: string }]) => n.label).sort()).toEqual(['memory_input_b97', 'memory_output_b65']);
    expect(migrated.weights).toEqual([0.4]);
    expect(migrated.weightCounts).toEqual([3]);
  });

  it('folds new learning in by byte, including non-ASCII text', () => {
    const model = emptyOneBrain();
    const e = [...Buffer.from('é', 'utf-8')];
    foldEdges(model, [{ from: e[0], to: e[1], weight: 0.2 }]);
    const labels = model.neurons.map(([, n]: [string, { label: string }]) => n.label);
    expect(labels).toEqual([`memory_input_b${e[0]}`, `memory_output_b${e[1]}`]);
    expect(parseSelfExtension(model)).toEqual([expect.objectContaining({ from: e[0], to: e[1], weight: 0.2 })]);
  });
});
