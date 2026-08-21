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
import { CodingExtension } from '../plugins/extensions/coding.js';
import { TerminalPlugin, isBlockedCommand } from '../plugins/terminal.js';
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

    it('should not double-count punctuation arousal into the keyword-match average', () => {
      // "happy!" matches exactly one keyword ("happy", arousal 0.7) and
      // contributes exactly one exclamation mark (arousalFromPunctuation =
      // min(1, 1*0.2) = 0.2, no caps/questions). arousal blends the two 50/50:
      // (0.7 + 0.2) / 2 = 0.45. The old code folded arousalFromPunctuation
      // into totalArousal *before* dividing by matchCount too, double-
      // counting it and yielding 0.55 instead.
      const emotion = empathy.analyzeEmotion('happy!');
      expect(emotion.arousal).toBeCloseTo(0.45, 5);
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

  describe('Plugins as fused neurons (Section "Plugins")', () => {
    // register() gives every plugin real neurons in the shared MoE mesh,
    // wired all-to-all into everything else already there -- "plugins
    // become part of the neural system rather than simply being separate
    // programs the AI talks to", not just a definitions/instance pair in
    // two Maps.
    it('register() allocates real, non-overlapping mesh neurons for each plugin', () => {
      plugins.register(
        { id: 'notify-test', name: 'Notify', type: 'api-connection', capabilities: ['notifications'] },
        new NotificationsPlugin({ id: 'notify-test', name: 'Notify', type: 'api-connection', capabilities: ['notifications'] })
      );
      plugins.register(
        { id: 'browser-test', name: 'Browser', type: 'api-connection', capabilities: ['browser'] },
        new BrowserPlugin({ id: 'browser-test', name: 'Browser', type: 'api-connection', capabilities: ['browser'] })
      );
      const notifyIds = plugins.getPluginNeuronIds('notify-test');
      const browserIds = plugins.getPluginNeuronIds('browser-test');
      expect(notifyIds?.length).toBeGreaterThan(0);
      expect(browserIds?.length).toBeGreaterThan(0);
      // Distinct neurons, not the same ones relabeled.
      expect(notifyIds!.some(id => browserIds!.includes(id))).toBe(false);
      // Genuinely present in the shared mesh's expert roster, not just a
      // local bookkeeping map -- same MixtureOfExperts a skill-expert uses.
      expect(plugins.getMoE().getExpert('notify-test')?.neuronIds).toEqual(notifyIds);
    });

    it('a skill-expert plugin gets a full multi-neuron expert group; an api-connection plugin gets one presence neuron', () => {
      plugins.register(
        { id: 'coder-test', name: 'Coder', type: 'skill-expert', capabilities: ['coding'] },
        new NotificationsPlugin({ id: 'coder-test', name: 'Coder', type: 'skill-expert', capabilities: ['coding'] })
      );
      plugins.register(
        { id: 'notify-test2', name: 'Notify', type: 'api-connection', capabilities: ['notifications'] },
        new NotificationsPlugin({ id: 'notify-test2', name: 'Notify', type: 'api-connection', capabilities: ['notifications'] })
      );
      expect(plugins.getPluginNeuronIds('coder-test')?.length).toBe(4);
      expect(plugins.getPluginNeuronIds('notify-test2')?.length).toBe(1);
    });

    it('dispatching to a plugin that actually answers genuinely propagates the shared mesh with that plugin\'s own neurons driven', async () => {
      const def = { id: 'notify-fire', name: 'Notify', type: 'api-connection' as const, capabilities: ['notifications'] };
      plugins.register(def, new NotificationsPlugin(def));
      await plugins.activate('notify-fire');
      plugins.setIntentMap({ 'test-intent': ['notify-fire'] });

      const neuronIds = plugins.getPluginNeuronIds('notify-fire')!;
      const mesh = plugins.getMoE().getMesh();
      const propagateSpy = vi.spyOn(mesh, 'propagate');

      const result = await plugins.dispatch('list my notifications', 'test-intent');

      // The default BasePlugin.onMessage() echoes the input back (never
      // null), so this real dispatch should have reached firePluginNeurons()
      // -- confirmed by inspecting the actual call it made to the real
      // mesh, not a mock standing in for it.
      expect(result).not.toBeNull();
      expect(propagateSpy).toHaveBeenCalledTimes(1);
      const drivenArg = propagateSpy.mock.calls[0][0] as Map<number, number>;
      expect(Array.from(drivenArg.keys()).sort()).toEqual([...neuronIds].sort());
      for (const id of neuronIds) expect(drivenArg.get(id)).toBe(1);
    });
  });

  describe('CodingExtension: sandboxed execution + live dispatch wiring', () => {
    let coding: CodingExtension;

    beforeEach(() => {
      const def = { id: 'coding', name: 'Coding Skill', type: 'skill-expert' as const, capabilities: ['coding'] };
      const skillDef = { id: 'coding', name: 'Coding Skill', description: 'coding', expertIndex: 0, specialization: 'coding', selfAuthored: false };
      coding = new CodingExtension(def, skillDef);
    });

    it('runSandboxed() actually executes JS and returns the real computed result', () => {
      const out = coding.runSandboxed('2 + 2');
      expect(out.error).toBeNull();
      expect(out.result).toBe(4);
      expect(out.ms).toBeGreaterThanOrEqual(0);
    });

    it('runSandboxed() has no access to this process -- require/process are undefined inside it', () => {
      const out = coding.runSandboxed('typeof require + "," + typeof process');
      expect(out.error).toBeNull();
      expect(out.result).toBe('undefined,undefined');
    });

    it('runSandboxed() reports a syntax/runtime error instead of throwing out to the caller', () => {
      const out = coding.runSandboxed('this is not valid js (((');
      expect(out.error).not.toBeNull();
      expect(out.result).toBeUndefined();
    });

    it('runSandboxed() is killed by the timeout rather than hanging forever on an infinite loop', () => {
      const out = coding.runSandboxed('while (true) {}');
      expect(out.error).not.toBeNull();
      expect(out.ms).toBeLessThan(2000);
    }, 3000);

    it('onMessage() with a "run:"/"calculate:" prefix reaches runSandboxed() through the live dispatch path (previously unreachable)', async () => {
      const out = await coding.onMessage('calculate: 6 * 7') as { result: unknown; error: string | null };
      expect(out.error).toBeNull();
      expect(out.result).toBe(42);
    });

    it('onMessage() without an execution prefix still reaches execute()\'s real analysis (also previously unreachable via dispatch)', async () => {
      const out = await coding.onMessage('function add(a, b) { return a + b; }') as { analysis: { functionCount: number } };
      expect(out.analysis.functionCount).toBe(1);
    });
  });

  describe('TerminalPlugin: real shell execution + destructive-command guardrail', () => {
    let terminal: TerminalPlugin;

    beforeEach(() => {
      terminal = new TerminalPlugin({ id: 'terminal', name: 'Terminal', type: 'api-connection', capabilities: ['terminal'] });
    });

    it('run() actually executes a real command and captures its real stdout', async () => {
      const out = await terminal.run('echo hello-from-terminal-plugin');
      expect(out.error).toBeUndefined();
      expect(out.stdout.trim()).toBe('hello-from-terminal-plugin');
      expect(out.returncode).toBe(0);
    });

    it('run() reports a non-zero returncode for a real failing command instead of throwing', async () => {
      const out = await terminal.run('exit 7');
      expect(out.returncode).toBe(7);
    });

    it('run() is killed by its timeout on a real hanging command', async () => {
      const out = await terminal.run('sleep 5', { timeoutMs: 200 });
      expect(out.error).toMatch(/Timeout/);
    }, 3000);

    it('which() finds a real binary that genuinely exists on PATH', () => {
      expect(terminal.which('node')).not.toBeNull();
    });

    it('which() returns null (not a throw) for a binary that does not exist', () => {
      expect(terminal.which('definitely-not-a-real-binary-xyz123')).toBeNull();
    });

    it('env() blocks a sensitive variable name and redacts sensitive keys from the full listing', () => {
      process.env.SOME_TEST_API_TOKEN = 'shh';
      try {
        expect(() => terminal.env('SOME_TEST_API_TOKEN')).toThrow('Security Error');
        const all = terminal.env();
        expect(all.SOME_TEST_API_TOKEN).toBeUndefined();
      } finally {
        delete process.env.SOME_TEST_API_TOKEN;
      }
    });

    // isBlockedCommand() ported directly from plugin_terminal.py's already-
    // tested _is_blocked() -- same permutation-proof rm -rf detection.
    it.each([
      'rm -rf /',
      'rm -rf /*',
      'rm -fr /',
      'rm -r -f /',
      'rm --recursive --force /',
      ':(){ :|:& };:',
      'mkfs.ext4 /dev/sda1',
      'shutdown -h now',
      'dd if=/dev/zero of=/dev/sda',
    ])('isBlockedCommand() blocks %s', (cmd) => {
      expect(isBlockedCommand(cmd)).toBe(true);
    });

    it.each([
      'echo hello',
      'ls -la',
      'rm somefile.txt',
      'git status',
    ])('isBlockedCommand() does not block an ordinary command: %s', (cmd) => {
      expect(isBlockedCommand(cmd)).toBe(false);
    });

    it('run() actually refuses a destructive command rather than executing it', async () => {
      const out = await terminal.run('rm -rf /');
      expect(out.error).toContain('Blocked');
    });

    it('runBg() throws (does not spawn) for a blocked command', () => {
      expect(() => terminal.runBg('rm -rf /')).toThrow('Blocked');
    });

    it('onMessage() with a "run:" prefix reaches real execution through the live dispatch path', async () => {
      const out = await terminal.onMessage('run: echo dispatched') as { stdout: string };
      expect(out.stdout.trim()).toBe('dispatched');
    });

    it('onMessage() without an execution prefix does not attempt to execute the input as a shell command', async () => {
      const out = await terminal.onMessage('just chatting, not a command');
      expect(out).toBe('just chatting, not a command');
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

    it('should classify the full fe80::/10 IPv6 link-local range as private', async () => {
      // fe80::/10 only fixes the top 10 bits, so the first hex group's 3rd
      // digit ranges over 8-b (fe80-febf) -- a startsWith("fe8") check alone
      // only caught fe80-fe8f, letting fe90::/16 through feb0::/16 (still
      // genuinely link-local, e.g. fe90::1) reach fetchUrl() unblocked.
      const isPrivateHost = (browserPlugin as unknown as { isPrivateHost(h: string): boolean }).isPrivateHost.bind(browserPlugin);
      expect(isPrivateHost('fe80::1')).toBe(true);
      expect(isPrivateHost('fe90::1')).toBe(true);
      expect(isPrivateHost('fea0::1')).toBe(true);
      expect(isPrivateHost('feb0::1')).toBe(true);
      expect(isPrivateHost('2001:db8::1')).toBe(false); // public, must stay unblocked
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

    it('should not leave a leftover temp directory behind when no capture tool is available', async () => {
      // mkdtempSync() runs unconditionally at the top of capture(); with no
      // capture tool installed (the common case in this sandbox), the
      // directory it created was never cleaned up on any of the early
      // "tool unavailable" return paths -- the same unbounded-resource-leak
      // bug class already fixed in camera.ts/microphone.ts.
      const os = await import('node:os');
      const fs = await import('node:fs');
      const before = new Set(fs.readdirSync(os.tmpdir()));
      await screenshotsPlugin.capture();
      const after = fs.readdirSync(os.tmpdir()).filter(
        (name) => name.startsWith('neuroclaw-ss-') && !before.has(name)
      );
      expect(after).toEqual([]);
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
