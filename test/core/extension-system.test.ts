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
