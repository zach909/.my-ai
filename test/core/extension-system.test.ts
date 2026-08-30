/**
 * Tests for the Extension System (extension_system/): lifecycle,
 * dependency resolution, versioning/rollback, permissions, storage
 * (compression + quantization round-trip), and automatic creation.
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExtensionManager, DependencyError } from '../../extension_system/manager.js';
import { PermissionDeniedError } from '../../extension_system/security.js';
import { compareVersions, satisfies, resolveBest } from '../../extension_system/semver.js';

describe('semver', () => {
  it('compares versions', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('resolves caret and tilde ranges', () => {
    expect(satisfies('1.4.0', '^1.2.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfies('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
    expect(satisfies('1.0.0', '*')).toBe(true);
  });

  it('picks the highest satisfying version', () => {
    expect(resolveBest(['1.0.0', '1.2.0', '1.3.5', '2.0.0'], '^1.0.0')).toBe('1.3.5');
    expect(resolveBest(['1.0.0'], '^2.0.0')).toBeNull();
  });
});

describe('ExtensionManager', () => {
  let rootDir: string;
  let manager: ExtensionManager;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'neuroclaw-extension-system-test-'));
    manager = new ExtensionManager({ rootDir });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('rejects an id containing path-traversal segments instead of writing outside rootDir', async () => {
    // ExtensionManager only slugifies `id` when it derives one from `name`;
    // a caller-supplied id reaches ExtensionStore as-is, and path.join()
    // normalizes ".." segments -- so an id of "../../../tmp/pwned" would
    // resolve completely outside rootDir without a guard at the store layer.
    const outside = join(tmpdir(), 'neuroclaw-traversal-pwned');
    rmSync(outside, { recursive: true, force: true });

    await expect(manager.install({
      id: `../../../../../../..${outside}`,
      name: 'Malicious',
      kind: 'skill',
      description: 'Attempts a path-traversal write',
      payload: Buffer.from('pwned'),
    })).rejects.toThrow(/must not contain path separators/);

    expect(existsSync(outside)).toBe(false);
  });

  it('installs and activates a skill extension', async () => {
    const record = await manager.install({
      id: 'summarize-meeting-notes',
      name: 'Summarize Meeting Notes',
      kind: 'skill',
      description: 'Condenses meeting notes into action items',
      capabilities: ['summarize'],
      payload: Buffer.from('skill source text'),
    });
    expect(record.state).toBe('installed');

    const activated = await manager.activate('summarize-meeting-notes');
    expect(activated.state).toBe('active');
    expect(manager.getActiveRecord('summarize-meeting-notes')?.manifest.version).toBe('1.0.0');
  });

  it('round-trips a compressed payload exactly', async () => {
    const payload = Buffer.from('x'.repeat(5000) + 'unique-content-marker');
    await manager.install({
      id: 'mem-blob',
      name: 'Memory Blob',
      kind: 'memory',
      description: 'A consolidated memory snapshot',
      payload,
    });
    const readBack = await manager.loadPayload('mem-blob');
    expect(readBack.equals(payload)).toBe(true);
    expect(await manager.verify('mem-blob', '1.0.0')).toBe(true);
  });

  it('quantizes a numeric logic payload and stores it losslessly-enough to round-trip bytes', async () => {
    const floats = new Float32Array([0.1, -0.5, 0.9, -0.9, 0.25]);
    const payload = Buffer.from(floats.buffer);
    const record = await manager.install({
      id: 'reasoning-weights',
      name: 'Reasoning Weights',
      kind: 'logic',
      description: 'Quantized reasoning-engine weights',
      payload,
      storageOptions: { quantize: { bits: 8, method: 'symmetric' } },
    });
    expect(record.encoding.quantization).toEqual({ bits: 8, method: 'symmetric' });
    // Stored bytes should be smaller than the original once gzip'd.
    const readBack = await manager.loadPayload('reasoning-weights');
    expect(readBack.length).toBe(payload.length);
  });

  it('enforces required dependencies before activation', async () => {
    await manager.install({
      id: 'dependent-skill',
      name: 'Dependent Skill',
      kind: 'skill',
      description: 'Needs a base skill',
      dependencies: [{ id: 'base-skill', range: '^1.0.0', required: true }],
      payload: Buffer.from('dependent'),
    });

    await expect(manager.activate('dependent-skill')).rejects.toThrow(DependencyError);

    await manager.install({
      id: 'base-skill',
      name: 'Base Skill',
      kind: 'skill',
      description: 'Foundation skill',
      payload: Buffer.from('base'),
    });

    const activated = await manager.activate('dependent-skill');
    expect(activated.state).toBe('active');
    expect(manager.getActiveRecord('base-skill')?.state).toBe('active');
  });

  it('blocks deactivation/removal of a dependency still required by an active extension', async () => {
    await manager.install({ id: 'base', name: 'Base', kind: 'skill', description: 'base', payload: Buffer.from('b') });
    await manager.install({
      id: 'dependent',
      name: 'Dependent',
      kind: 'skill',
      description: 'dep',
      dependencies: [{ id: 'base', range: '*', required: true }],
      payload: Buffer.from('d'),
    });
    await manager.activate('dependent');

    await expect(manager.deactivate('base')).rejects.toThrow(DependencyError);
    await expect(manager.remove('base', '1.0.0')).rejects.toThrow(DependencyError);

    await manager.deactivate('base', { force: true });
    expect(manager.getActiveRecord('base')).toBeUndefined();
  });

  it('requires explicit grant for sensitive permissions before activation', async () => {
    await manager.install({
      id: 'camera-tool',
      name: 'Camera Tool',
      kind: 'plugin',
      description: 'Uses the camera',
      permissions: ['camera'],
      payload: Buffer.from('c'),
    });

    await expect(manager.activate('camera-tool')).rejects.toThrow(PermissionDeniedError);

    manager.permissions.grant('camera-tool', 'camera');
    const activated = await manager.activate('camera-tool');
    expect(activated.state).toBe('active');
  });

  it('requires explicit grant for voice-activation before activation, like microphone', async () => {
    // voice-activation means continuous passive listening for a wake word --
    // at least as privacy-sensitive as on-demand microphone access, which is
    // already gated. It was previously missing from SENSITIVE_PERMISSIONS
    // and would auto-grant silently on install.
    await manager.install({
      id: 'wake-word-tool',
      name: 'Wake Word Tool',
      kind: 'plugin',
      description: 'Listens for a wake word',
      permissions: ['voice-activation'],
      payload: Buffer.from('c'),
    });

    expect(manager.permissions.isGranted('wake-word-tool', 'voice-activation')).toBe(false);
    await expect(manager.activate('wake-word-tool')).rejects.toThrow(PermissionDeniedError);

    manager.permissions.grant('wake-word-tool', 'voice-activation');
    const activated = await manager.activate('wake-word-tool');
    expect(activated.state).toBe('active');
  });

  it('auto-grants non-sensitive permissions on install', async () => {
    await manager.install({
      id: 'coding-tool',
      name: 'Coding Tool',
      kind: 'plugin',
      description: 'Analyzes code',
      permissions: ['coding'],
      payload: Buffer.from('c'),
    });
    expect(manager.permissions.isGranted('coding-tool', 'coding')).toBe(true);
    const activated = await manager.activate('coding-tool');
    expect(activated.state).toBe('active');
  });

  it('updates to a new version, keeps the old for rollback, and re-activates the new one', async () => {
    await manager.install({ id: 'evolving-skill', name: 'Evolving Skill', kind: 'skill', description: 'v1', payload: Buffer.from('v1') });
    await manager.activate('evolving-skill');

    await manager.update('evolving-skill', '1.1.0', Buffer.from('v1.1'));
    expect(manager.getActiveRecord('evolving-skill')?.manifest.version).toBe('1.1.0');
    expect(manager.installedVersions('evolving-skill').sort()).toEqual(['1.0.0', '1.1.0']);

    const rolledBack = await manager.rollback('evolving-skill');
    expect(rolledBack.manifest.version).toBe('1.0.0');
    expect(manager.getActiveRecord('evolving-skill')?.manifest.version).toBe('1.0.0');
  });

  it('rejects updating to a version that is not greater than the current latest', async () => {
    await manager.install({ id: 'stuck', name: 'Stuck', kind: 'skill', description: 'v1', payload: Buffer.from('v1') });
    await expect(manager.update('stuck', '1.0.0', Buffer.from('same'))).rejects.toThrow();
    await expect(manager.update('stuck', '0.9.0', Buffer.from('older'))).rejects.toThrow();
  });

  it('automatically creates a new extension, then evolves it via autoCreate again', async () => {
    const created = await manager.autoCreate({
      name: 'Self-Authored Debug Skill',
      kind: 'skill',
      description: 'Learned how to trace a null pointer bug',
      createdBy: 'skill-maker',
      sources: ['conversation about a crash', 'net-search hit on null checks'],
      payload: Buffer.from('debug skill v1'),
    });
    expect(created.manifest.version).toBe('1.0.0');
    expect(created.manifest.provenance.autoCreated).toBe(true);
    expect(created.manifest.provenance.createdBy).toBe('skill-maker');

    const evolved = await manager.autoCreate({
      id: created.manifest.id,
      name: 'Self-Authored Debug Skill',
      kind: 'skill',
      description: 'Learned a better null-pointer trace technique',
      createdBy: 'skill-maker',
      payload: Buffer.from('debug skill v2'),
    });
    expect(evolved.manifest.version).toBe('1.0.1');
    expect(manager.installedVersions(created.manifest.id).sort()).toEqual(['1.0.0', '1.0.1']);
  });

  it('detects circular dependencies', async () => {
    await manager.install({
      id: 'a',
      name: 'A',
      kind: 'skill',
      description: 'a',
      dependencies: [{ id: 'b', range: '*', required: true }],
      payload: Buffer.from('a'),
    });
    await manager.install({
      id: 'b',
      name: 'B',
      kind: 'skill',
      description: 'b',
      dependencies: [{ id: 'a', range: '*', required: true }],
      payload: Buffer.from('b'),
    });
    expect(() => manager.resolveDependencies(manager.getRecord('a')!.manifest)).toThrow(/Circular/);
  });

  it('reloads installed and active state after a restart (load())', async () => {
    await manager.install({ id: 'persisted', name: 'Persisted', kind: 'memory', description: 'm', payload: Buffer.from('data') });
    await manager.activate('persisted');

    const restarted = new ExtensionManager({ rootDir });
    restarted.load();
    expect(restarted.getActiveRecord('persisted')?.manifest.id).toBe('persisted');
    const payload = await restarted.loadPayload('persisted');
    expect(payload.equals(Buffer.from('data'))).toBe(true);
  });

  it('lists extensions filtered by kind and state', async () => {
    await manager.install({ id: 'k1', name: 'K1', kind: 'skill', description: 'k1', payload: Buffer.from('1') });
    await manager.install({ id: 'k2', name: 'K2', kind: 'memory', description: 'k2', payload: Buffer.from('2') });
    await manager.activate('k1');

    expect(manager.listExtensions({ kind: 'skill' }).map(r => r.manifest.id)).toEqual(['k1']);
    expect(manager.listExtensions({ state: 'active' }).map(r => r.manifest.id)).toEqual(['k1']);
  });
});

describe('a self-built extension joins the mesh', () => {
  /**
   * The last arrow of the capability loop:
   *
   *   Create -> Test -> Connect -> Neural System -> Zip Loop -> Wave -> Mesh
   *
   * It did not exist. Grafting only ever happened on the INSTALL paths, so an
   * extension a person installed became a region of the mesh and an extension
   * the AI built for itself did not -- it was written to disk, registered as a
   * plugin, and the wave could never reach it. The loop stopped one step short
   * of closing, on exactly the half the whole idea is about.
   *
   * And once it was wired, still nothing arrived: the makers emit a plugin,
   * which carries no neurons, so there was nothing to graft. A capability with
   * no neuron is a capability the wave cannot reach, so one is derived from
   * the extension's name and the procedure it was built from.
   */
  it('grows the network and names the new region', async () => {
    const { getNeuroclawSystem } = await import('../../src/index.js');
    const { graftedSkills } = await import('../../models && skills/core/net-skill-graft.js');
    const system = await getNeuroclawSystem();
    const engine = system.pipeline.ensureBrain();

    const before = engine.getNeuronCount();
    const skillsBefore = new Set(graftedSkills(engine).map(s => s.skill));

    // A procedure repeated until the learner calls it a recurring capability.
    const procedure = 'To convert a .heic photo: first, read the container header. '
      + 'Then extract the HEVC payload. Next, decode each tile. '
      + 'Finally, write the RGB rows out as PNG.';
    let last: { decision: string; created?: string } | undefined;
    for (let i = 0; i < 6; i++) last = await system.learn(procedure) as typeof last;

    expect(last?.decision).toBe('recommend-extension');
    expect(last?.created).toBeTruthy();

    // The mesh actually grew, and the new neurons carry the extension's name
    // -- which is what makes the wave able to reach it next time.
    expect(engine.getNeuronCount()).toBeGreaterThan(before);
    const added = graftedSkills(engine).map(s => s.skill).filter(s => !skillsBefore.has(s));
    expect(added.length).toBeGreaterThan(0);
    for (const id of engine.neuronsInGroup(added[0])) {
      expect(engine.neuronGroupsOf(id)).toContain(added[0]);
    }
  }, 120_000);
});

describe('a failed build becomes a lesson', () => {
  /**
   * Section 9's other arm: "If it fails, the failure can be used to modify
   * the extension or the relevant skills."
   *
   * A build that left the mesh exactly as unable as before was reported onto
   * the zip loop and then forgotten, so the next time the same thing arrived
   * the system would build it the same way and learn nothing. MistakeTracker
   * already de-duplicates identical failures and counts recurrences, and its
   * lessons are already read when the system plans -- recording here is what
   * lets a second attempt go differently.
   */
  it('records why the build did not give the network a capability', async () => {
    const { getNeuroclawSystem } = await import('../../src/index.js');
    const graft = await import('../../models && skills/core/net-skill-graft.js');
    const system = await getNeuroclawSystem();
    const engine = system.pipeline.ensureBrain();

    // Fill the mesh, so grafting genuinely cannot add anything and the build
    // fails for a real reason rather than a stubbed one.
    let room = graft.MAX_MESH_NEURONS - engine.getNeuronCount();
    while (room > 0) {
      const step = Math.min(200, room);
      engine.addNeurons(step);
      room -= step;
    }
    expect(engine.getNeuronCount()).toBe(graft.MAX_MESH_NEURONS);

    const procedure = 'To read a .wxy stream: first, open the header. Then decode frames. '
      + 'Next, check parity. Finally, emit rows.';
    for (let i = 0; i < 6; i++) await system.learn(procedure);

    const lessons = system.mistakes.lessons(procedure);
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons.some(l => l.includes('full') || l.includes('did not give'))).toBe(true);
  }, 180_000);
});

describe('background terminals are observable', () => {
  /**
   * "One of the most important parts of the idea is that the AI can view what
   * is happening across its other terminals. If a development server running
   * in one terminal crashes, the AI can detect the event and respond from
   * another terminal."
   *
   * Neither half was possible. runBg() spawned with stdio: "ignore", so the
   * operating system discarded a background terminal's output before anything
   * could read it -- the crash went to /dev/null and the agent got back a
   * process id and nothing else. And nothing outside the tests ever called
   * runBg, so a background terminal was neither observable nor reachable.
   */
  it('keeps what each terminal said, and which one failed', async () => {
    const { TerminalPlugin } = await import('../../plugins/terminal.js');
    const terminal = new TerminalPlugin({
      name: 'terminal', version: '1', description: 'test', capabilities: [],
    } as never);

    // One terminal that works, one that fails -- the shape the architecture
    // describes: a server in one, tests in another.
    terminal.runBg("echo 'server listening'");
    terminal.runBg("echo 'running tests'; echo 'FAIL: expected 3 got 4' >&2; exit 7");
    await new Promise(resolve => setTimeout(resolve, 1200));

    const sessions = terminal.terminals();
    expect(sessions.length).toBe(2);
    // Output survived rather than going to /dev/null.
    expect(sessions.map(s => s.stdout).join(' ')).toContain('server listening');
    expect(sessions.map(s => s.stderr).join(' ')).toContain('FAIL: expected 3 got 4');

    // And the failure is identifiable from outside the terminal it happened
    // in, which is the whole point.
    const failed = sessions.filter(s => s.exitCode !== null && s.exitCode !== 0);
    expect(failed.length).toBe(1);
    expect(failed[0].exitCode).toBe(7);
    expect(failed[0].running).toBe(false);
  }, 30_000);

  it('will not forget a terminal that is still running', async () => {
    // Dropping the record of a live process would leave it going with nothing
    // watching it.
    const { TerminalPlugin } = await import('../../plugins/terminal.js');
    const terminal = new TerminalPlugin({
      name: 'terminal', version: '1', description: 'test', capabilities: [],
    } as never);
    const pid = terminal.runBg('sleep 5');
    expect(terminal.forgetTerminal(pid)).toBe(false);
    expect(terminal.terminal(pid)?.running).toBe(true);
  }, 30_000);
});
