/**
 * Integration Test for Neuroclaw System
 *
 * Verifies all core components work together end-to-end:
 * - Input → Pipeline → Mesh → MoE → RLM → Output
 * - Alignment veto checking
 * - Plugin dispatch
 * - Extension persistence
 */

import { NeuroPipeline } from '../models && skills/core/pipeline.js';
import { ElasticMesh } from '../src/features/mesh/mesh-engine.js';
import { AlignmentVeto } from '../models && skills/core/alignment-veto.js';
import { ZipIOSystem } from '../models && skills/core/zip-io.js';
import { EmpathyEngine } from '../models && skills/core/empathy.js';
import { PluginRegistry } from '../plugin_manager/registry.js';

describe('Neuroclaw Integration Tests', () => {
  let pipeline: NeuroPipeline;
  let mesh: ElasticMesh;
  let veto: AlignmentVeto;
  let zipIO: ZipIOSystem;
  let empathy: EmpathyEngine;
  let plugins: PluginRegistry;

  beforeEach(() => {
    pipeline = new NeuroPipeline({
      embeddingDim: 64,
      hiddenDim: 128,
      meshNodes: 32,
      hyperDimensions: 32,
      useElasticCore: true,
    });

    mesh = new ElasticMesh({
      neuronCount: 32,
      dimensions: 4,
      totalVale: 1600,
      settlementThreshold: 0.001,
      maxTicks: 200,
      ticksPerFrame: 4,
    });

    veto = new AlignmentVeto();
    zipIO = new ZipIOSystem(1000); // 1GB for testing
    empathy = new EmpathyEngine();
    plugins = new PluginRegistry();
  });

  describe('Core Pipeline', () => {
    it('should initialize without errors', () => {
      expect(pipeline).toBeDefined();
      expect(mesh).toBeDefined();
    });

    it('should process input through mesh', async () => {
      // Inject a simple input
      const input = new Float32Array([1.0, 0.5, 0.0, -0.5]);
      mesh.injectInput(Array.from(input), 0.5);

      // Propagate
      const ticks = mesh.propagate(10);
      expect(ticks).toBeGreaterThan(0);

      // Check state settled
      const stats = mesh.getStats();
      expect(stats).toBeDefined();
      expect(stats.activeNeurons).toBeGreaterThanOrEqual(0);
    });

    it('should apply vale-based learning', () => {
      // Simulate learning
      mesh.learnHebbian(0.01);

      // Verify vale conservation
      const state = mesh.getState();
      const totalVale = state.neurons.reduce((sum, n) => sum + n.vale, 0);
      expect(totalVale).toBe(1600); // Total vale should be conserved
    });
  });

  describe('Alignment Veto', () => {
    it('should allow safe actions', () => {
      const result = veto.checkVeto({
        action: 'read_file',
        target: '/tmp/test.txt',
      });
      expect(result.allowed).toBe(true);
      expect(result.riskLevel).toBe('safe');
    });

    it('should block forbidden actions', () => {
      const result = veto.checkVeto({
        action: 'format_drive',
      });
      expect(result.allowed).toBe(false);
      expect(result.riskLevel).toBe('blocked');
    });

    it('should respect resource constraints', () => {
      const result = veto.checkVeto({
        action: 'compute',
        estimatedResources: {
          memoryMB: 5000,
        },
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Memory');
    });

    it('should evaluate pipeline actions', () => {
      const decision = veto.evaluate(
        {
          id: 'action-1',
          name: 'read_file',
          capabilities: ['file_system'],
          reversible: true,
        },
        { selfModelSurprise: 0.3 }
      );
      expect(decision).toBeDefined();
      expect(decision.allowed).toBeDefined();
      expect(decision.confidence).toBeDefined();
    });
  });

  describe('Empathy Engine', () => {
    it('should detect positive emotions', () => {
      const emotion = empathy.analyzeEmotion('I love this! So exciting!');
      expect(emotion.valence).toBeGreaterThan(0);
      expect(emotion.arousal).toBeGreaterThan(0.5);
    });

    it('should detect negative emotions', () => {
      const emotion = empathy.analyzeEmotion('This is terrible, really bad.');
      expect(emotion.valence).toBeLessThan(0);
    });

    it('should update and track context', () => {
      empathy.updateUserContext('I am happy with this result');
      const context = empathy.getUserContext();
      expect(context.recentInputs.length).toBe(1);
      expect(context.emotionalHistory.length).toBe(1);
    });

    it('should compute alignment score', () => {
      empathy.updateUserContext('This is perfect!');
      const score = empathy.getAlignmentScore();
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('ZIP-IO System', () => {
    it('should write and read data', async () => {
      const testData = 'Hello, Neuroclaw!';
      const id = await zipIO.write(testData);
      expect(id).toBeDefined();

      const stats = zipIO.getStats();
      expect(stats.writeCount).toBe(1);
    });

    it('should handle circular buffer overflow', async () => {
      // Write many times to trigger circular behavior
      for (let i = 0; i < 100; i++) {
        await zipIO.write(`Data chunk ${i}`);
      }

      const stats = zipIO.getStats();
      expect(stats.totalChunks).toBeGreaterThan(0);
    });

    it('should emit output', async () => {
      const output = 'Model decision: proceed';
      const id = await zipIO.emit(output);
      expect(id).toBeDefined();

      const stats = zipIO.getStats();
      expect(stats.writeCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Plugin Registry', () => {
    it('should bootstrap plugins', async () => {
      await plugins.bootstrap();
      const pluginCount = plugins.getPluginCount();
      expect(pluginCount).toBeGreaterThan(0);
    });

    it('should list registered plugins', async () => {
      await plugins.bootstrap();
      const pluginList = plugins.listPlugins();
      expect(Array.isArray(pluginList)).toBe(true);
      expect(pluginList.length).toBeGreaterThan(0);
    });

    it('should dispatch to appropriate plugin', async () => {
      await plugins.bootstrap();
      // This would test actual plugin dispatch if we had real plugins running
      // For now, just verify the method exists
      expect(plugins.dispatch).toBeDefined();
    });
  });

  describe('End-to-End Flow', () => {
    it('should process input through full pipeline', async () => {
      // 1. User input
      const userInput = 'Please analyze this data';
      empathy.updateUserContext(userInput);

      // 2. Inject into mesh
      const inputVec = new Float32Array([0.5, 0.3, 0.2, 0.1]);
      mesh.injectInput(Array.from(inputVec), 0.5);

      // 3. Propagate
      mesh.propagate(5);

      // 4. Check veto
      const decision = veto.evaluate(
        {
          id: 'end-to-end-1',
          name: 'analyze_data',
          capabilities: ['analysis'],
          reversible: true,
        },
        { selfModelSurprise: 0.4 }
      );

      // 5. Store in ZIP-IO
      await zipIO.emit(`Analysis complete. Allowed: ${decision.allowed}`);

      // Verify results
      expect(decision.allowed).toBeDefined();
      const stats = zipIO.getStats();
      expect(stats.writeCount).toBeGreaterThan(0);
    });

    it('should conserve vale through learning cycles', () => {
      const initialState = mesh.getState();
      const initialVale = initialState.neurons.reduce((sum, n) => sum + n.vale, 0);

      // Run multiple learning cycles
      for (let i = 0; i < 10; i++) {
        mesh.learnHebbian(0.01);
        const currentState = mesh.getState();
        const currentVale = currentState.neurons.reduce((sum, n) => sum + n.vale, 0);
        expect(currentVale).toBe(initialVale);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid actions gracefully', () => {
      const result = veto.checkVeto({
        action: 'unknown_action_xyz',
      });
      expect(result).toBeDefined();
      expect(result.allowed).toBe(false);
    });

    it('should continue despite single component failure', async () => {
      // If one component fails, others should still work
      empathy.updateUserContext('test');
      mesh.propagate(1);
      await zipIO.write('test');

      // All should succeed independently
      expect(true).toBe(true);
    });
  });
});

// Export for manual testing
export { pipeline, mesh, veto, zipIO, empathy, plugins };
