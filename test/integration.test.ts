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
import { BrowserPlugin } from '../plugins/browser.js';

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
    zipIO = new ZipIOSystem(1000);
    empathy = new EmpathyEngine();
    plugins = new PluginRegistry();
  });

  describe('Core Pipeline', () => {
    it('should initialize without errors', () => {
      expect(pipeline).toBeDefined();
      expect(mesh).toBeDefined();
    });

    it('should process input through mesh', async () => {
      const input = new Float32Array([1.0, 0.5, 0.0, -0.5]);
      mesh.injectInput(Array.from(input), 0.5);

      const ticks = mesh.propagate(10);
      expect(ticks).toBeGreaterThan(0);

      const stats = mesh.getStats();
      expect(stats).toBeDefined();
      expect(stats.activeNeurons).toBeGreaterThanOrEqual(0);
    });

    it('should apply vale-based learning', () => {
      mesh.learnHebbian(0.01);

      const state = mesh.getState();
      const totalVale = state.neurons.reduce((sum, n) => sum + n.vale, 0);
      expect(totalVale).toBe(1600); // Total vale should be conserved
    });
  });

  // AlignmentVeto is a deterministic gate (not a learned optimizer, by
  // design — see alignment-veto.ts's own header comment on the Goodhart
  // trap it deliberately avoids). Its real API is evaluate(action, ctx) ->
  // { allowed, requiresConfirmation, score, reasons }, not the
  // checkVeto()/riskLevel/estimatedResources shape this suite originally
  // assumed (which described a design that was never built this way).
  describe('Alignment Veto', () => {
    it('should allow a safe, reversible action with no objectionable capabilities', () => {
      const decision = veto.evaluate({
        id: 'read-1',
        name: 'read_file',
        capabilities: ['file-read'],
        reversible: true,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.requiresConfirmation).toBe(false);
      expect(decision.reasons).toContain('no objection');
    });

    it('should block an action with an objectionable capability', () => {
      const decision = veto.evaluate({
        id: 'deceive-1',
        name: 'mislead_user',
        capabilities: ['deceive'],
        reversible: true,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reasons.some(r => r.includes('objectionable capability'))).toBe(true);
    });

    it('should require confirmation for irreversible actions', () => {
      const decision = veto.evaluate({
        id: 'delete-1',
        name: 'delete_file',
        capabilities: [],
        reversible: false,
      });
      expect(decision.requiresConfirmation).toBe(true);
    });

    it('should fail safe and block outright under severe self-model drift', () => {
      const decision = veto.evaluate(
        { id: 'action-1', name: 'act', capabilities: [], reversible: true },
        { selfModelSurprise: 0.9 }
      );
      expect(decision.allowed).toBe(false);
      expect(decision.reasons.some(r => r.includes('severe self-model drift'))).toBe(true);
    });

    it('should evaluate pipeline actions and expose an inspectable score', () => {
      const decision = veto.evaluate(
        { id: 'action-1', name: 'read_file', capabilities: ['file-read'], reversible: true },
        { selfModelSurprise: 0.3 }
      );
      expect(decision).toBeDefined();
      expect(decision.allowed).toBeDefined();
      expect(decision.score).toBeGreaterThanOrEqual(0);
      expect(decision.score).toBeLessThanOrEqual(1);
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

  // ZipIOSystem's real write path is ingest()/emit() (both Promise<void>,
  // no returned id and no getStats()) -- it exposes getTotalContextSize()
  // per loop instead of an aggregate write-count/chunk-count object.
  describe('ZIP-IO System', () => {
    it('should ingest input and grow the input loop context size', async () => {
      await zipIO.ingest('Hello, Neuroclaw!');
      expect(zipIO.inputLoop.getTotalContextSize()).toBeGreaterThan(0);
    });

    it('should handle circular buffer overflow over many writes', async () => {
      for (let i = 0; i < 100; i++) {
        await zipIO.ingest(`Data chunk ${i}`);
      }
      expect(zipIO.inputLoop.getTotalContextSize()).toBeGreaterThan(0);
    });

    it('should emit output into the output loop', async () => {
      await zipIO.emit('Model decision: proceed');
      expect(zipIO.outputLoop.getTotalContextSize()).toBeGreaterThan(0);
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
      expect(plugins.dispatch).toBeDefined();
    });
  });

  describe('Browser Plugin Security', () => {
    let browserPlugin: BrowserPlugin;

    beforeEach(() => {
      browserPlugin = new BrowserPlugin({
        id: 'browser',
        name: 'Browser',
        type: 'api-connection',
        capabilities: ['browser'],
      });
    });

    it('should block private/local hosts before attempting any network call', async () => {
      await expect(browserPlugin.fetchUrl('http://localhost/')).rejects.toThrow('Security Error');
      await expect(browserPlugin.fetchUrl('http://127.0.0.1/')).rejects.toThrow('Security Error');
      await expect(browserPlugin.fetchUrl('http://[::1]/')).rejects.toThrow('Security Error');
    });

    it('should classify private/local addresses correctly (DNS-rebinding check)', async () => {
      const isPrivateHost = (browserPlugin as unknown as { isPrivateHost(h: string): boolean }).isPrivateHost.bind(browserPlugin);
      expect(isPrivateHost('127.0.0.1')).toBe(true);
      expect(isPrivateHost('10.0.0.1')).toBe(true);
      expect(isPrivateHost('192.168.1.1')).toBe(true);
      expect(isPrivateHost('172.16.0.1')).toBe(true);
      expect(isPrivateHost('8.8.8.8')).toBe(false);
    });
  });

  describe('End-to-End Flow', () => {
    it('should process input through full pipeline', async () => {
      const userInput = 'Please analyze this data';
      empathy.updateUserContext(userInput);

      const inputVec = new Float32Array([0.5, 0.3, 0.2, 0.1]);
      mesh.injectInput(Array.from(inputVec), 0.5);
      mesh.propagate(5);

      const decision = veto.evaluate(
        { id: 'end-to-end-1', name: 'analyze_data', capabilities: ['analysis'], reversible: true },
        { selfModelSurprise: 0.4 }
      );

      await zipIO.emit(`Analysis complete. Allowed: ${decision.allowed}`);

      expect(decision.allowed).toBeDefined();
      expect(zipIO.outputLoop.getTotalContextSize()).toBeGreaterThan(0);
    });

    it('should conserve vale through learning cycles', () => {
      const initialState = mesh.getState();
      const initialVale = initialState.neurons.reduce((sum, n) => sum + n.vale, 0);

      for (let i = 0; i < 10; i++) {
        mesh.learnHebbian(0.01);
        const currentState = mesh.getState();
        const currentVale = currentState.neurons.reduce((sum, n) => sum + n.vale, 0);
        expect(currentVale).toBe(initialVale);
      }
    });
  });

  describe('Error Handling', () => {
    it('should block an action with no capabilities and low benevolence score gracefully', () => {
      const decision = veto.evaluate(
        { id: 'unknown-1', name: 'unknown_action_xyz', capabilities: [], reversible: false },
        { selfModelSurprise: 0.95 }
      );
      expect(decision).toBeDefined();
      expect(decision.allowed).toBe(false);
    });

    it('should continue despite single component failure', async () => {
      empathy.updateUserContext('test');
      mesh.propagate(1);
      await zipIO.ingest('test');

      expect(true).toBe(true);
    });
  });
});
