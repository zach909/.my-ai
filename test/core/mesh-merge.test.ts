/**
 * NeuronMesh.mergeFrom(): absorbing one live mesh's nodes/connections/
 * group labels into another, growing it rather than keeping the two
 * disconnected. The Python asi_core mesh's equivalent is
 * NeuralMesh.merge_from (asi_core/neural_mesh.py) -- see
 * test_neural_mesh.py's TestMergeFrom for that engine's version of the
 * same guarantees.
 */
import { describe, it, expect } from 'vitest';
import { NeuronMesh } from '../../models && skills/core/onebrain';

describe('NeuronMesh.mergeFrom', () => {
  it('grows node count by exactly the other mesh\'s size', () => {
    const a = new NeuronMesh({ nodeCount: 5, connectionDensity: 1.0 });
    const b = new NeuronMesh({ nodeCount: 3, connectionDensity: 1.0 });

    const idMap = a.mergeFrom(b);

    expect(idMap.size).toBe(3);
    expect(a.getTopology().nodeCount).toBe(8);
  });

  it('result is still fully all-to-all when both inputs were', () => {
    const a = new NeuronMesh({ nodeCount: 4, connectionDensity: 1.0 });
    const b = new NeuronMesh({ nodeCount: 3, connectionDensity: 1.0 });
    a.mergeFrom(b);

    const topo = a.getTopology();
    expect(topo.nodeCount).toBe(7);
    // Every node should connect to every other node (self excluded).
    for (const node of topo.nodes) {
      expect(node.connections.size).toBe(topo.nodeCount - 1);
    }
  });

  it('preserves other\'s own connection weights instead of reinitializing them', () => {
    const a = new NeuronMesh({ nodeCount: 4, connectionDensity: 1.0 });
    const b = new NeuronMesh({ nodeCount: 3, connectionDensity: 1.0 });
    const bWeightsBefore = new Map<number, Map<number, number>>();
    for (const [id, node] of (b as unknown as { nodes: Map<number, { connections: Map<number, number> }> }).nodes) {
      bWeightsBefore.set(id, new Map(node.connections));
    }

    const idMap = a.mergeFrom(b);

    const aNodes = (a as unknown as { nodes: Map<number, { connections: Map<number, number> }> }).nodes;
    for (const [oldId, oldWeights] of bWeightsBefore) {
      const newId = idMap.get(oldId)!;
      const newNode = aNodes.get(newId)!;
      for (const [oldNeighborId, weight] of oldWeights) {
        const newNeighborId = idMap.get(oldNeighborId)!;
        expect(newNode.connections.get(newNeighborId)).toBe(weight);
      }
    }
  });

  it('relocates activation/bias rather than resetting them', () => {
    const a = new NeuronMesh({ nodeCount: 3, connectionDensity: 1.0 });
    const b = new NeuronMesh({ nodeCount: 2, connectionDensity: 1.0 });
    const bNodes = (b as unknown as { nodes: Map<number, { activation: number; bias: number }> }).nodes;
    for (const node of bNodes.values()) {
      node.activation = 0.777;
      node.bias = -0.333;
    }

    const idMap = a.mergeFrom(b);

    const aNodes = (a as unknown as { nodes: Map<number, { activation: number; bias: number }> }).nodes;
    for (const [, newId] of idMap) {
      const node = aNodes.get(newId)!;
      expect(node.activation).toBe(0.777);
      expect(node.bias).toBe(-0.333);
    }
  });

  it('prefixes absorbed group labels to avoid collisions', () => {
    const a = new NeuronMesh({ nodeCount: 3, connectionDensity: 1.0 });
    a.addNode(0, 'coding');
    const b = new NeuronMesh({ nodeCount: 2, connectionDensity: 1.0 });
    b.addNode(0, 'coding');

    a.mergeFrom(b, 'b');

    const groups = a.getGroups();
    expect(groups).toContain('coding');
    expect(groups).toContain('b.coding');
  });

  it('merged mesh still propagates without error', () => {
    const a = new NeuronMesh({ nodeCount: 4, connectionDensity: 1.0, activationFn: 'relu' });
    const b = new NeuronMesh({ nodeCount: 3, connectionDensity: 1.0, activationFn: 'relu' });
    a.mergeFrom(b);

    const inputs = new Map<number, number>([[0, 0.5]]);
    const result = a.propagate(inputs);
    expect(result.finalStates.size).toBe(7);
    for (const v of result.finalStates.values()) expect(Number.isFinite(v)).toBe(true);
  });
});
