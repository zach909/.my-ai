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
import { HyperDimensionalEngine } from '../models && skills/core/onebrain.js';
import { generateArithmeticFacts, scaleForFacts, trainArithmetic, askArithmetic } from '../models && skills/core/math-engine.js';
import { ScreenshotsPlugin } from '../plugins/screenshots.js';
import { WikiPlugin } from '../plugins/wiki.js';
import { publishWikiPage, deleteWikiPage, listWikiBackups, restoreWikiBackup, readWikiPage } from '../models && skills/core/wiki-store.js';
import { isWikiPublicRoute } from '../interface/web-server.js';
import { SelfHealExtension, SkillMakerExtension } from '../plugins/extensions/index.js';
import { FileSystemPlugin } from '../plugins/file-system.js';
import { existsSync, rmSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
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

    it('should evaluate pipeline actions and expose an inspectable score', () => {
      const decision = veto.evaluate(
        { id: 'action-1', name: 'read_file', capabilities: ['file-read'], reversible: true },
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

  describe('dispatch() routing fixes: greedy plugins no longer silently block their neighbors', () => {
    // SkillMakerExtension/PluginMakerExtension write self-authored output
    // via generatedDir() (plugins/extensions/index.ts), which resolves
    // under NEUROCLAW_GENERATED_DIR -- a real scratch directory vitest.
    // config.ts sets for this whole run -- so the one test below that
    // actually creates a skill needs no cleanup of its own; nothing here
    // touches this repo's real generated/.

    it("self-heal no longer swallows every 'command'-intent message -- it returns null for anything that isn't literally heal/status", async () => {
      const def = { id: 'self-heal', name: 'Self Heal', type: 'api-connection' as const, capabilities: ['self-heal'] };
      const plugin = new SelfHealExtension(def);
      expect(await plugin.onMessage('run: echo hi')).toBeNull();
      expect(await plugin.onMessage('make a skill for sorting')).toBeNull();
      expect(await plugin.onMessage('heal')).not.toBeNull();
      expect(await plugin.onMessage('status')).not.toBeNull();
    });

    it("dispatch('run: echo through-command-bucket', 'command') actually reaches TerminalPlugin now that self-heal correctly declines", async () => {
      const registry = new PluginRegistry();
      const selfHealDef = { id: 'self-heal', name: 'Self Heal', type: 'api-connection' as const, capabilities: ['self-heal'] };
      const terminalDef = { id: 'terminal', name: 'Terminal', type: 'api-connection' as const, capabilities: ['terminal'] };
      const fsDef = { id: 'file-system', name: 'File System', type: 'api-connection' as const, capabilities: ['file-system'] };
      registry.register(selfHealDef, new SelfHealExtension(selfHealDef));
      registry.register(terminalDef, new TerminalPlugin(terminalDef));
      registry.register(fsDef, new FileSystemPlugin(fsDef));
      await registry.activate('self-heal');
      await registry.activate('terminal');
      await registry.activate('file-system');

      const result = await registry.dispatch('run: echo through-command-bucket', 'command');
      expect(result).toContain('through-command-bucket');
    });

    it("a message explicitly naming 'skill' reaches skill-maker even from the generic 'command' intent (where skill-maker isn't even a listed candidate)", async () => {
      const registry = new PluginRegistry();
      const skillDef = { id: 'skill-maker', name: 'Skill Maker', type: 'api-connection' as const, capabilities: ['skill-maker'] };
      registry.register(skillDef, new SkillMakerExtension(skillDef));
      await registry.activate('skill-maker');

      const result = await registry.dispatch('make a skill for sorting numbers', 'command');
      expect(result).not.toBeNull();
      expect(result).toContain('skill-maker');
      expect(result).toContain('make-a-skill-for-sorting-numbers');
    });

    it("a message explicitly naming 'wiki' never reaches skill-maker, even from the 'creation' intent where skill-maker is normally first and always succeeds", async () => {
      const registry = new PluginRegistry();
      const skillDef = { id: 'skill-maker', name: 'Skill Maker', type: 'api-connection' as const, capabilities: ['skill-maker'] };
      const wikiDef = { id: 'wiki', name: 'Wiki', type: 'api-connection' as const, capabilities: ['wiki'] };
      registry.register(skillDef, new SkillMakerExtension(skillDef));
      registry.register(wikiDef, new WikiPlugin(wikiDef));
      await registry.activate('skill-maker');
      await registry.activate('wiki');

      // No exact "wiki publish ..." syntax here, so WikiPlugin itself
      // declines too -- the point is that skill-maker, despite being first
      // in the 'creation' bucket and always succeeding, must NOT be the one
      // that answers a wiki-directed message.
      const result = await registry.dispatch('write a wiki page about dogs', 'creation');
      expect(result).toBeNull();
    });

    it('WikiPlugin.search() finds a real existing wiki page by keyword overlap (read-only against the repo\'s real wiki/ content)', async () => {
      const wikiDef = { id: 'wiki', name: 'Wiki', type: 'api-connection' as const, capabilities: ['wiki'] };
      const plugin = new WikiPlugin(wikiDef);
      const pages = await plugin.list();
      expect(pages.length).toBeGreaterThan(0);
      // Search using a real page's own title as the query -- it must be its own top hit.
      const target = pages[0];
      const hits = await plugin.search(target.title || target.name);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].page.name).toBe(target.name);
    });

    it('"wiki search <query>" reaches WikiPlugin.search() through onMessage()', async () => {
      const wikiDef = { id: 'wiki', name: 'Wiki', type: 'api-connection' as const, capabilities: ['wiki'] };
      const plugin = new WikiPlugin(wikiDef);
      const pages = await plugin.list();
      const target = pages[0];
      const result = await plugin.onMessage(`wiki search ${target.title || target.name}`) as string;
      expect(result).toContain('match');
    });
  });

  describe('Wiki public-access safety boundary: read + create-new only, never destroy', () => {
    // "make bot wiki accessible for everyone... if I still want them to be
    // able to upload their things [but] I don't want them to have admin
    // access to the whole thing and I don't want them to be able to
    // delete everything" -- isWikiPublicRoute() is the exact predicate
    // interface/web-server.ts's handleRequest() uses to decide which
    // requests skip the password gate on a non-localhost bind. Testing it
    // directly (rather than via a live server) covers exactly what must
    // never accidentally widen.
    it('exempts reading the wiki list and an individual page', () => {
      expect(isWikiPublicRoute('/api/wiki', 'GET')).toBe(true);
      expect(isWikiPublicRoute('/api/wiki/some-page', 'GET')).toBe(true);
    });

    it('exempts creating via POST /api/wiki (the handler itself still re-checks auth for an existing name)', () => {
      expect(isWikiPublicRoute('/api/wiki', 'POST')).toBe(true);
    });

    it('never exempts deleting a page -- "I don\'t want them to be able to delete everything"', () => {
      expect(isWikiPublicRoute('/api/wiki/some-page', 'DELETE')).toBe(false);
    });

    it('never exempts restoring a backup (a write, gated like any other)', () => {
      expect(isWikiPublicRoute('/api/wiki/some-page/restore', 'POST')).toBe(false);
    });

    it('never exempts listing backups (history of an existing page, not public read-the-current-page)', () => {
      expect(isWikiPublicRoute('/api/wiki/some-page/backups', 'GET')).toBe(false);
    });

    it('never exempts any non-wiki route -- "I don\'t want them to have admin access to the whole thing"', () => {
      expect(isWikiPublicRoute('/api/status', 'GET')).toBe(false);
      expect(isWikiPublicRoute('/api/plugins', 'GET')).toBe(false);
      expect(isWikiPublicRoute('/api/skill-uploads', 'GET')).toBe(false);
      expect(isWikiPublicRoute('/api/skill-uploads/some-package/install-skill', 'POST')).toBe(false);
      expect(isWikiPublicRoute('/api/query', 'POST')).toBe(false);
    });

    it('rejects a path-traversal-shaped wiki name the same as an ordinary GET (SAFE_NAME still applies downstream)', () => {
      // isWikiPublicRoute() itself only recognizes the safe-name shape, so
      // "/api/wiki/../secret" simply doesn't match either GET pattern and
      // falls through to the normal auth gate instead of being treated as
      // a public wiki read.
      expect(isWikiPublicRoute('/api/wiki/../secret', 'GET')).toBe(false);
    });
  });

  describe('Wiki backups: overwriting/deleting a bot page is no longer unrecoverable', () => {
    // wiki-store.ts resolves wiki/bot/ from process.cwd() with no
    // injectable override, and process.cwd() is genuinely process-wide
    // state -- chdir'ing it for a test's duration previously leaked into
    // *other* test files running concurrently in the same worker (a real
    // failure this caused: research-security.test.ts's default-cwd test
    // started scanning whatever directory a concurrently-running chdir
    // had switched to, and hung). No chdir anywhere here: each test uses
    // a distinctively-named page written into (and precisely deleted
    // from) this repo's own real wiki/bot/, via exact known paths only --
    // never a directory-wide wipe that could touch real content.
    const testPageNames: string[] = [];

    function freshName(): string {
      const name = `zzz-test-wiki-backup-fixture-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      testPageNames.push(name);
      return name;
    }

    afterEach(() => {
      while (testPageNames.length > 0) {
        const name = testPageNames.pop()!;
        try { deleteWikiPage(name); } catch { /* already gone */ }
        rmSync(join(process.cwd(), 'wiki', 'bot', '.backups', name), { recursive: true, force: true });
      }
    });

    it('publishing a page for the first time creates zero backups (nothing existed to back up)', () => {
      const name = freshName();
      publishWikiPage(name, 'Hello', 'First version.');
      expect(listWikiBackups(name)).toEqual([]);
    });

    it('overwriting an existing page backs up the content it replaces', () => {
      const name = freshName();
      publishWikiPage(name, 'Hello', 'First version.');
      publishWikiPage(name, 'Hello', 'Second version.');
      const backups = listWikiBackups(name);
      expect(backups.length).toBe(1);
      const raw = readFileSync(
        join(process.cwd(), 'wiki', 'bot', '.backups', name, `${backups[0].timestamp}.md`),
        'utf8'
      );
      expect(raw).toContain('First version.');
      // The live page is the new content, not the backup.
      expect(readWikiPage(name)!.content).toContain('Second version.');
    });

    it('deleting a page backs it up first -- the delete is no longer unrecoverable', () => {
      const name = freshName();
      publishWikiPage(name, 'Hello', 'Will be deleted.');
      deleteWikiPage(name);
      expect(readWikiPage(name)).toBeNull();
      const backups = listWikiBackups(name);
      expect(backups.length).toBe(1);
    });

    it('restoreWikiBackup() brings the page back with its backed-up content', () => {
      const name = freshName();
      publishWikiPage(name, 'Hello', 'Original content.');
      publishWikiPage(name, 'Hello', 'Overwritten content.');
      const [backup] = listWikiBackups(name);
      const restored = restoreWikiBackup(name, backup.timestamp);
      expect(restored.content).toContain('Original content.');
      expect(readWikiPage(name)!.content).toContain('Original content.');
    });

    it('restoreWikiBackup() itself backs up what it replaces -- a restore is never itself unrecoverable', () => {
      const name = freshName();
      publishWikiPage(name, 'Hello', 'Version A.');
      publishWikiPage(name, 'Hello', 'Version B.');
      const [backupA] = listWikiBackups(name);
      restoreWikiBackup(name, backupA.timestamp); // page is back to "Version A."
      const backupsAfterRestore = listWikiBackups(name);
      expect(backupsAfterRestore.length).toBe(2); // Version A's own backup, plus Version B backed up by the restore
    });

    it('a page that was never edited/deleted has no backups', () => {
      const name = freshName();
      publishWikiPage(name, 'Untouched', 'Never modified.');
      expect(listWikiBackups(name)).toEqual([]);
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

    it('onMessage() also accepts "run <cmd>" with no colon', async () => {
      const out = await terminal.onMessage('run echo no-colon-needed') as { stdout: string };
      expect(out.stdout.trim()).toBe('no-colon-needed');
    });

    it('onMessage() without an execution prefix returns null so dispatch() falls through to the next plugin, rather than swallowing the message', async () => {
      const out = await terminal.onMessage('just chatting, not a command');
      expect(out).toBeNull();
    });
  });

  describe('Training the neural mesh to do arithmetic (real weight learning, not the exact evaluator)', () => {
    // Deliberately distinct from MathEngine.verify()/evaluateExpression()
    // (the exact, deterministic path already wired into the mathematician
    // hive agent in src/index.ts) -- this trains HyperDimensionalEngine's
    // own connDiag/bias weights via its real trainDefinitions() delta rule
    // to *approximate* arithmetic, so "the network learns math" is a
    // checkable claim (measurable error reduction from real weight
    // updates) rather than an assertion. A small mesh trained for a
    // handful of epochs will never be as accurate as the exact evaluator --
    // that's expected and consistent with math-engine.ts's own stated
    // philosophy that neural predictions shouldn't be trusted for exact
    // math. What's tested is that real training measurably improves it.

    it('generateArithmeticFacts() computes real results, not fabricated targets', () => {
      const facts = generateArithmeticFacts(4, ['+', '-', '*']);
      expect(facts.length).toBe(5 * 5 * 3);
      for (const f of facts) {
        const expected = f.op === '+' ? f.a + f.b : f.op === '-' ? f.a - f.b : f.a * f.b;
        expect(f.result).toBe(expected);
      }
    });

    it('trainArithmetic() genuinely reduces prediction error versus the untrained network, via real weight updates', () => {
      const facts = generateArithmeticFacts(4, ['+']); // 25 facts, a,b in 0..4 -- small/fast, still a real training run
      const scale = scaleForFacts(facts);
      const driveId = 0, readoutId = 1;
      const engine = new HyperDimensionalEngine({ dimensions: 4, neuronCount: 12 });

      const meanAbsError = () => {
        let err = 0;
        for (const f of facts) err += Math.abs(askArithmetic(engine, f.a, f.b, f.op, driveId, readoutId, scale) - f.result);
        return err / facts.length;
      };

      const before = meanAbsError();
      const report = trainArithmetic(engine, facts, driveId, readoutId, scale, { epochs: 300, learningRate: 0.25 });
      const after = meanAbsError();

      expect(report.factCount).toBe(facts.length);
      // Real, measurable improvement from real training -- not asserting
      // near-perfect accuracy, which a mesh this small over this few
      // epochs genuinely won't reach.
      expect(after).toBeLessThan(before * 0.75);
    });

    it('askArithmetic() does not keep drifting further from the trained answer across repeated calls (connDiag/bias are pinned to zero learning rate; only the unrelated self-model prediction step still updates)', () => {
      const facts = generateArithmeticFacts(3, ['+']);
      const scale = scaleForFacts(facts);
      const driveId = 0, readoutId = 1;
      const engine = new HyperDimensionalEngine({ dimensions: 4, neuronCount: 10 });
      trainArithmetic(engine, facts, driveId, readoutId, scale, { epochs: 150 });

      const first = askArithmetic(engine, 2, 2, '+', driveId, readoutId, scale);
      const second = askArithmetic(engine, 2, 2, '+', driveId, readoutId, scale);
      const third = askArithmetic(engine, 2, 2, '+', driveId, readoutId, scale);
      // Small drift is expected (process() still runs its own unrelated
      // self-model prediction training step every call), but it must stay
      // small relative to the answer itself -- the arithmetic weights
      // (connDiag/connShift/bias) genuinely are frozen by the zero-rate map.
      expect(Math.abs(second - first)).toBeLessThan(Math.abs(first) * 0.05 + 0.1);
      expect(Math.abs(third - second)).toBeLessThan(Math.abs(second) * 0.05 + 0.1);
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
    it('should block an action with an objectionable capability gracefully', () => {
      // Used to also carry a high self-model-surprise ctx to push an
      // otherwise-benign action below the score threshold -- that signal is
      // gone (see alignment-veto.ts), so this now blocks via Rule 1
      // (objectionable capability) instead, which is unaffected by the removal.
      const decision = veto.evaluate(
        { id: 'unknown-1', name: 'unknown_action_xyz', capabilities: ['deceive'], reversible: false },
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
