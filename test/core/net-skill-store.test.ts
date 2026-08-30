/**
 * Making a live Net Skill show up in the store's "skills" catalog, for real.
 *
 * "Skills don't exist [in that filter] -- there's only net skills and
 * prompting skills." True before this: the "skills" store kind was
 * populated only by the Extension Builder's own export format and the
 * manual Uploads page, never by an actual grafted region in the running
 * mesh. This drives a real graft into a real engine, publishes it, and
 * checks a clone that never saw the publisher actually has the listing --
 * the same standard store-sync.test.ts and github-publish.test.ts hold
 * every other publish path to.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HyperDimensionalEngine } from '../../models && skills/core/onebrain';
import { graftNetSkill } from '../../models && skills/core/net-skill-graft';
import { publishGraftedNetSkills } from '../../models && skills/core/net-skill-store';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

const engine = () => new HyperDimensionalEngine({
  neuronCount: 8, dimensions: 6, propagationSteps: 4, convergenceThreshold: 0.01,
  hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1,
  waveGain: 0.1, connectionBias: true,
});

describe('a grafted Net Skill reaches the store, not just the mesh', () => {
  let tmp: string;
  let remote: string;
  let device: string;
  let restoreCwd: string;
  let restoreStoreDir: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'net-skill-store-'));
    remote = path.join(tmp, 'remote.git');
    git(['init', '-q', '--bare', remote], tmp);
    git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);

    device = path.join(tmp, 'device');
    git(['clone', '-q', remote, device], tmp);
    git(['config', 'user.email', 'a@example.invalid'], device);
    git(['config', 'user.name', 'a'], device);
    git(['checkout', '-q', '-b', 'main'], device);
    mkdirSync(path.join(device, 'store'), { recursive: true });
    writeFileSync(path.join(device, 'store', 'README.md'), '# store\n');
    git(['add', '-A'], device);
    git(['commit', '-qm', 'init'], device);
    git(['push', '-q', '-u', 'origin', 'main'], device);

    restoreCwd = process.cwd();
    restoreStoreDir = process.env.NEUROCLAW_STORE_DIR;
    process.chdir(device);
    process.env.NEUROCLAW_STORE_DIR = path.join(device, 'store');
  });

  afterEach(() => {
    process.chdir(restoreCwd);
    if (restoreStoreDir === undefined) delete process.env.NEUROCLAW_STORE_DIR;
    else process.env.NEUROCLAW_STORE_DIR = restoreStoreDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('publishes a real listing for a real graft, readable from a fresh clone', async () => {
    const e = engine();
    const graft = graftNetSkill(e, 'optics', [
      { name: 'refraction', definition: 'how light bends crossing a boundary' },
      { name: 'diffraction', definition: 'how a wave spreads around an edge' },
    ]);
    expect(graft.added).toBe(2);

    const results = await publishGraftedNetSkills(e);
    expect(results).toHaveLength(1);
    expect(results[0].skill).toBe('optics');
    expect(results[0].neurons).toBe(2);
    expect(results[0].sync.pushed).toBe(true);

    const other = path.join(tmp, 'other-clone');
    git(['clone', '-q', remote, other], tmp);
    const listingDir = path.join(other, 'store', 'skills', 'optics');
    expect(existsSync(listingDir)).toBe(true);
    const files = readdirSync(listingDir);
    const descriptorFile = files.find((f: string) => f.endsWith('.net-skill.json'));
    expect(descriptorFile).toBeTruthy();
    const descriptor = JSON.parse(readFileSync(path.join(listingDir, descriptorFile), 'utf8'));
    expect(descriptor.skill).toBe('optics');
    expect(descriptor.neuronCount).toBe(2);
    expect(descriptor.neurons.map((n: { name: string }) => n.name).sort()).toEqual(['diffraction', 'refraction']);
  });

  it('publishes one listing per grafted skill, not just the first', async () => {
    const e = engine();
    graftNetSkill(e, 'optics', [{ name: 'refraction', definition: 'bending light' }]);
    graftNetSkill(e, 'logic', [{ name: 'inference', definition: 'valid conclusions from premises' }]);

    const results = await publishGraftedNetSkills(e);
    expect(results.map(r => r.skill).sort()).toEqual(['logic', 'optics']);
    expect(results.every(r => r.sync.pushed)).toBe(true);
  });

  it('is idempotent -- republishing identical content does not fail or duplicate', async () => {
    const e = engine();
    graftNetSkill(e, 'optics', [{ name: 'refraction', definition: 'bending light' }]);
    const first = await publishGraftedNetSkills(e);
    const second = await publishGraftedNetSkills(e);
    expect(first[0].sync.pushed).toBe(true);
    // Nothing changed, so the second call has nothing new to commit --
    // syncStorePaths reports that as pushed: true with committed: false
    // ("Already up to date"), not as a failure.
    expect(second[0].sync.pushed).toBe(true);
  });

  it('skips a skill with no live neurons rather than publishing an empty shell', async () => {
    const e = engine();
    // No graft happened -- graftedSkills(e) is empty, so there is nothing to
    // publish and nothing should be attempted.
    const results = await publishGraftedNetSkills(e);
    expect(results).toEqual([]);
  });

  it('updates the listing when the skill grows, so a stale snapshot cannot linger', async () => {
    const e = engine();
    graftNetSkill(e, 'optics', [{ name: 'refraction', definition: 'bending light' }]);
    await publishGraftedNetSkills(e);
    // A second, differently-named skill grafted afterward -- optics itself
    // is unchanged, but a full republish should still leave optics' own
    // listing intact and correct.
    graftNetSkill(e, 'acoustics', [{ name: 'resonance', definition: 'reinforcement at a natural frequency' }]);
    const results = await publishGraftedNetSkills(e);
    const optics = results.find(r => r.skill === 'optics')!;
    expect(optics.neurons).toBe(1);

    const other = path.join(tmp, 'other-clone-2');
    git(['clone', '-q', remote, other], tmp);
    expect(existsSync(path.join(other, 'store', 'skills', 'acoustics'))).toBe(true);
    expect(existsSync(path.join(other, 'store', 'skills', 'optics'))).toBe(true);
  });
});
