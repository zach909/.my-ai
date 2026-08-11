/**
 * Tests for scripts/update-check.mjs's pure divergence-summarizing logic,
 * plus an end-to-end run of checkForUpdates() against this actual repo
 * (real `git fetch`, not mocked -- the same precedent as this session's
 * other build-*.mjs driver scripts, whose real subprocess/git behavior
 * is verified by actually running them rather than only unit-testing
 * around them).
 */

import { summarizeDivergence, checkForUpdates } from '../../scripts/update-check.mjs';

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
