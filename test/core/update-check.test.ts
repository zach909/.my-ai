/**
 * Tests for scripts/update-check.mjs's pure divergence-summarizing logic,
 * plus an end-to-end run of checkForUpdates() against this actual repo
 * (real `git fetch`, not mocked -- the same precedent as this session's
 * other build-*.mjs driver scripts, whose real subprocess/git behavior
 * is verified by actually running them rather than only unit-testing
 * around them).
 */

import { summarizeDivergence, checkForUpdates, workingTreeIsClean, applyUpdate, printUpdateCheck } from '../../scripts/update-check.mjs';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A real throwaway "remote" + "clone" pair of git repos, so the
 *  fast-forward-pull tests are deterministic and don't touch this
 *  actual repo's own (often-dirty, mid-session) working tree. */
function makeRemoteAndClone() {
  const base = mkdtempSync(path.join(tmpdir(), 'update-check-test-'));
  const remote = path.join(base, 'remote');
  const clone = path.join(base, 'clone');
  const git = (args: string, cwd: string) => execSync(`git ${args}`, { cwd, stdio: 'pipe' });

  mkdirSync(remote, { recursive: true });
  git('init --initial-branch=main .', remote);
  git('config user.email test@example.com', remote);
  git('config user.name Test', remote);
  writeFileSync(path.join(remote, 'file.txt'), 'v1\n');
  git('add file.txt', remote);
  git('commit -m v1', remote);

  git(`clone ${JSON.stringify(remote)} ${JSON.stringify(clone)}`, base);
  git('config user.email test@example.com', clone);
  git('config user.name Test', clone);

  return { base, remote, clone };
}

describe('summarizeDivergence()', () => {
  it('reports up-to-date when there is no divergence in either direction', () => {
    expect(summarizeDivergence(0, 0)).toEqual({ status: 'up-to-date', message: 'up to date with origin' });
  });

  it('reports behind (singular) when exactly one commit behind and none ahead', () => {
    const result = summarizeDivergence(1, 0);
    expect(result.status).toBe('behind');
    expect(result.message).toMatch(/^1 commit behind origin/);
    expect(result.message).not.toMatch(/commits behind/); // singular, not "1 commits"
  });

  it('reports behind (plural) when multiple commits behind', () => {
    const result = summarizeDivergence(5, 0);
    expect(result.status).toBe('behind');
    expect(result.message).toMatch(/^5 commits behind origin/);
  });

  it('reports ahead when local has unpushed commits and nothing is behind', () => {
    const result = summarizeDivergence(0, 3);
    expect(result.status).toBe('ahead');
    expect(result.message).toMatch(/3 commits ahead/);
  });

  it('reports diverged when both sides have commits the other lacks', () => {
    const result = summarizeDivergence(2, 4);
    expect(result.status).toBe('diverged');
    expect(result.message).toContain('4 local commits');
    expect(result.message).toContain('2 remote commits');
  });
});

describe('checkForUpdates() -- real git, run against this actual repo', () => {
  it('runs against the real repo without throwing and returns a real status', () => {
    const result = checkForUpdates(process.cwd());
    expect(['up-to-date', 'behind', 'ahead', 'diverged', 'unavailable']).toContain(result.status);
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('degrades to an "unavailable" result instead of throwing for a non-repo directory', () => {
    const result = checkForUpdates('/tmp');
    expect(result.status).toBe('unavailable');
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe('auto-update -- real throwaway remote/clone, real git, no mocks', () => {
  let ctx: ReturnType<typeof makeRemoteAndClone>;
  afterEach(() => {
    if (ctx) rmSync(ctx.base, { recursive: true, force: true });
  });

  it('workingTreeIsClean() is true right after a fresh clone', () => {
    ctx = makeRemoteAndClone();
    expect(workingTreeIsClean(ctx.clone)).toBe(true);
  });

  it('workingTreeIsClean() is false the moment a file is modified', () => {
    ctx = makeRemoteAndClone();
    writeFileSync(path.join(ctx.clone, 'file.txt'), 'locally edited\n');
    expect(workingTreeIsClean(ctx.clone)).toBe(false);
  });

  it('applyUpdate() actually fast-forwards the clone to a new remote commit', () => {
    ctx = makeRemoteAndClone();
    writeFileSync(path.join(ctx.remote, 'file.txt'), 'v2\n');
    execSync('git add file.txt && git commit -m v2', { cwd: ctx.remote });

    const before = checkForUpdates(ctx.clone);
    expect(before.status).toBe('behind');

    const applied = applyUpdate(ctx.clone, 'origin', 'main');
    expect(applied.ok).toBe(true);

    const after = checkForUpdates(ctx.clone);
    expect(after.status).toBe('up-to-date');
    expect(readFileSync(path.join(ctx.clone, 'file.txt'), 'utf8')).toBe('v2\n');
  });

  it('printUpdateCheck() auto-applies a safe fast-forward when the tree is clean and NEUROCLAW_AUTO_UPDATE is not disabled', () => {
    ctx = makeRemoteAndClone();
    writeFileSync(path.join(ctx.remote, 'file.txt'), 'v2\n');
    execSync('git add file.txt && git commit -m v2', { cwd: ctx.remote });

    delete process.env.NEUROCLAW_AUTO_UPDATE;
    const result = printUpdateCheck(ctx.clone);
    expect((result as any).autoUpdated).toBe(true);
    expect(readFileSync(path.join(ctx.clone, 'file.txt'), 'utf8')).toBe('v2\n');
  });

  it('printUpdateCheck() never auto-applies when the working tree has local changes', () => {
    ctx = makeRemoteAndClone();
    writeFileSync(path.join(ctx.remote, 'file.txt'), 'v2\n');
    execSync('git add file.txt && git commit -m v2', { cwd: ctx.remote });
    writeFileSync(path.join(ctx.clone, 'file.txt'), 'local edit, not committed\n');

    const result = printUpdateCheck(ctx.clone);
    expect((result as any).autoUpdated).toBeFalsy();
    expect(readFileSync(path.join(ctx.clone, 'file.txt'), 'utf8')).toBe('local edit, not committed\n');
  });

  it('printUpdateCheck() respects NEUROCLAW_AUTO_UPDATE=0 -- reports behind but never pulls', () => {
    ctx = makeRemoteAndClone();
    writeFileSync(path.join(ctx.remote, 'file.txt'), 'v2\n');
    execSync('git add file.txt && git commit -m v2', { cwd: ctx.remote });

    process.env.NEUROCLAW_AUTO_UPDATE = '0';
    try {
      const result = printUpdateCheck(ctx.clone);
      expect(result.status).toBe('behind');
      expect((result as any).autoUpdated).toBeFalsy();
      expect(readFileSync(path.join(ctx.clone, 'file.txt'), 'utf8')).toBe('v1\n');
    } finally {
      delete process.env.NEUROCLAW_AUTO_UPDATE;
    }
  });
});
