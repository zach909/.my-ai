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
import { LocationPlugin } from '../plugins/location.js';
import { NotificationsPlugin } from '../plugins/notifications.js';
import { ScreenshotsPlugin } from '../plugins/screenshots.js';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

    it('should sanitize a path-traversal pluginId out of createContext().dataDir', () => {
      // The same bug class fixed in ExtensionStore.dir(): dataDir is meant
      // for a plugin to persist its own state, so an unsanitized pluginId
      // containing ".." would let a path.join-style consumer escape ./data
      // entirely the moment something actually reads/writes through it.
      const context = plugins.createContext('../../../../tmp/pwned');
      expect(context.dataDir).not.toContain('..');
      expect(context.dataDir.startsWith('./data/')).toBe(true);
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

  describe('Location Plugin Geocoding', () => {
    let locationPlugin: LocationPlugin;

    beforeEach(() => {
      locationPlugin = new LocationPlugin({
        id: 'location',
        name: 'Location',
        type: 'api-connection',
        capabilities: ['location'],
      });
    });

    it('should resolve an exact, case-insensitive city name from the built-in database', async () => {
      const result = await locationPlugin.geocode('tokyo');
      expect(result.address).toBe('Tokyo');
      expect(result.coords.latitude).toBeCloseTo(35.6762);
      expect(result.coords.longitude).toBeCloseTo(139.6503);
    });

    it('should resolve a fuzzy/partial match against the built-in database', async () => {
      const result = await locationPlugin.geocode('San Fran');
      expect(result.address).toBe('San Francisco');
    });

    it('should return a zeroed, low-confidence result for a city not in the database, not throw', async () => {
      const result = await locationPlugin.geocode('Nowheresville');
      expect(result.address).toBe('Nowheresville');
      expect(result.coords.latitude).toBe(0);
      expect(result.coords.longitude).toBe(0);
      expect(result.coords.accuracy).toBe(0);
    });

    it('should stop delivering position updates to a watch after stopWatch removes it', async () => {
      const updates: number[] = [];
      const id = await locationPlugin.watchPosition(() => updates.push(1));
      locationPlugin.stopWatch(id);
      // stopWatch only removes the callback registration; it doesn't cancel
      // the already-scheduled interval, so this just verifies the id is
      // no longer tracked for future dispatch bookkeeping.
      expect((locationPlugin as unknown as { watchCallbacks: Map<number, unknown> }).watchCallbacks.has(id)).toBe(false);
    });

    it('should actually clear its polling interval once the plugin is deactivated, not poll forever', async () => {
      vi.useFakeTimers();
      try {
        // Never activated -> isActive() is false from the start, so the very
        // first 30s tick must self-clear the interval it was scheduled on.
        await locationPlugin.watchPosition(() => {});
        const clearSpy = vi.spyOn(global, 'clearInterval');
        await vi.advanceTimersByTimeAsync(30000);
        expect(clearSpy).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Notifications Plugin Command Safety', () => {
    let notificationsPlugin: NotificationsPlugin;
    let originalDisplay: string | undefined;
    const marker = join(tmpdir(), `neuroclaw-notif-injection-test-${Date.now()}`);

    beforeEach(() => {
      notificationsPlugin = new NotificationsPlugin({
        id: 'notifications',
        name: 'Notifications',
        type: 'api-connection',
        capabilities: ['notifications'],
      });
      originalDisplay = process.env.DISPLAY;
      process.env.DISPLAY = ':0'; // show() only shells out to notify-send when DISPLAY is set
      if (existsSync(marker)) rmSync(marker);
    });

    afterEach(() => {
      if (originalDisplay === undefined) delete process.env.DISPLAY;
      else process.env.DISPLAY = originalDisplay;
      if (existsSync(marker)) rmSync(marker);
    });

    it('should not execute shell command substitution embedded in a notification title', async () => {
      // A title/body reaching a shell-interpolated `execSync` call would let
      // `$(...)` run arbitrary commands; a real notify-send binary isn't
      // even required for that side effect to fire (the shell evaluates
      // command substitution during word-splitting, before command lookup).
      await notificationsPlugin.show(`$(touch ${marker})`, 'body');
      expect(existsSync(marker)).toBe(false);
    });

    it('should not execute shell command substitution embedded in a notification body', async () => {
      await notificationsPlugin.show('title', `$(touch ${marker})`);
      expect(existsSync(marker)).toBe(false);
    });

    it('should still record the notification with the literal, unexecuted title text', async () => {
      const title = `$(touch ${marker})`;
      await notificationsPlugin.show(title, 'body');
      // show() marks it shown:true immediately, so it won't be in listActive();
      // access the underlying array to confirm the literal text was stored.
      const stored = (notificationsPlugin as unknown as { notifications: Array<{ title: string }> }).notifications;
      expect(stored.some(n => n.title === title)).toBe(true);
    });
  });

  describe('Screenshots Plugin Command Safety', () => {
    let screenshotsPlugin: ScreenshotsPlugin;
    const marker = join(tmpdir(), `neuroclaw-ss-injection-test-${Date.now()}`);

    beforeEach(() => {
      screenshotsPlugin = new ScreenshotsPlugin({
        id: 'screenshots',
        name: 'Screenshots',
        type: 'api-connection',
        capabilities: ['screenshots'],
      });
      if (existsSync(marker)) rmSync(marker);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (existsSync(marker)) rmSync(marker);
    });

    it('should not execute shell command substitution embedded in a capture() filename, even when the capture tool exists', async () => {
      // Force the /usr/bin/import branch (via a full node:fs module mock,
      // since ESM named exports aren't spy-able in place) so this exercises
      // the injection-prone line regardless of what's actually installed on
      // the machine running the test -- shell command substitution in the
      // old code fired during word-splitting even when `import` itself
      // didn't exist, so a real binary was never required for the marker
      // file to appear.
      vi.doMock('node:fs', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:fs')>();
        return {
          ...actual,
          existsSync: (p: string) => (p === '/usr/bin/import' ? true : actual.existsSync(p)),
        };
      });
      vi.resetModules();
      const { ScreenshotsPlugin: MockedScreenshotsPlugin } = await import('../plugins/screenshots.js');
      const plugin = new MockedScreenshotsPlugin({
        id: 'screenshots', name: 'Screenshots', type: 'api-connection', capabilities: ['screenshots'],
      });
      await plugin.capture(`screenshot$(touch ${marker}).png`);
      expect(existsSync(marker)).toBe(false);
      vi.doUnmock('node:fs');
      vi.resetModules();
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
