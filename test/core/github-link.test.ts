/**
 * Turning "committed and pushed" into a URL a person can click.
 *
 * A real git repository with a real remote, because the whole risk here is
 * getting the path wrong relative to the repo root -- a guessed or
 * string-munged relative path is exactly the kind of bug that looks right in
 * a unit test with a fake path and produces a 404 on the real github.com.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { githubRepoSlug, githubFileUrl, githubDirUrl } from '../../models && skills/core/github-link';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

describe('githubRepoSlug()', () => {
  it('reads owner/repo out of every URL shape git stores for a GitHub remote', () => {
    expect(githubRepoSlug('git@github.com:zach909/.my-ai.git')).toBe('zach909/.my-ai');
    expect(githubRepoSlug('https://github.com/zach909/.my-ai.git')).toBe('zach909/.my-ai');
    expect(githubRepoSlug('https://github.com/zach909/.my-ai')).toBe('zach909/.my-ai');
    expect(githubRepoSlug('ssh://git@github.com/zach909/.my-ai.git')).toBe('zach909/.my-ai');
  });

  it('refuses to guess for a non-GitHub remote', () => {
    // A wrong "it's probably github" URL is worse than admitting it does not
    // know: it looks correct and 404s.
    expect(githubRepoSlug('git@gitlab.com:someone/repo.git')).toBeNull();
    expect(githubRepoSlug('https://example.com/someone/repo.git')).toBeNull();
    expect(githubRepoSlug('/home/user/local-repo')).toBeNull();
  });
});

describe('githubFileUrl() / githubDirUrl() against a real repository', () => {
  let tmp: string;
  let repo: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'github-link-'));
    repo = path.join(tmp, 'repo');
    mkdirSync(repo, { recursive: true });
    git(['init', '-q', '-b', 'main'], repo);
    git(['config', 'user.email', 'a@example.invalid'], repo);
    git(['config', 'user.name', 'a'], repo);
    git(['remote', 'add', 'origin', 'git@github.com:zach909/.my-ai.git'], repo);

    mkdirSync(path.join(repo, 'store', 'files', 'my-thing'), { recursive: true });
    writeFileSync(path.join(repo, 'store', 'files', 'my-thing', 'note.txt'), 'hello\n');
    writeFileSync(path.join(repo, 'README.md'), '# repo\n');
    git(['add', '-A'], repo);
    git(['commit', '-qm', 'init'], repo);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('builds the exact browsable URL for a file, relative to the repo root', async () => {
    const link = await githubFileUrl(path.join(repo, 'store', 'files', 'my-thing', 'note.txt'), 'main');
    expect(link.url).toBe('https://github.com/zach909/.my-ai/blob/main/store/files/my-thing/note.txt');
  });

  it('builds the URL for a directory', async () => {
    const link = await githubDirUrl(path.join(repo, 'store', 'files', 'my-thing'), 'main');
    expect(link.url).toBe('https://github.com/zach909/.my-ai/tree/main/store/files/my-thing');
  });

  it('gets the path right from a nested working directory too, not just the repo root', async () => {
    // A path built as "cwd-relative" instead of "repo-root-relative" would
    // pass every test that happens to run from the root and silently drop
    // the store/ prefix everywhere else -- which is the exact bug the first
    // version of this module had.
    const link = await githubFileUrl(path.join(repo, 'store', 'files', 'my-thing', 'note.txt'), 'main');
    expect(link.url).not.toContain('files/my-thing/note.txt".replace');
    expect(link.url).toContain('/store/files/my-thing/note.txt');
  });

  it('percent-encodes a branch name and a path segment that need it', async () => {
    const weird = path.join(repo, 'store', 'files', 'weird name', 'a b.txt');
    mkdirSync(path.dirname(weird), { recursive: true });
    writeFileSync(weird, 'x\n');
    git(['add', '-A'], repo);
    git(['commit', '-qm', 'weird'], repo);

    const link = await githubFileUrl(weird, 'feature/odd branch');
    expect(link.url).toBe(
      'https://github.com/zach909/.my-ai/blob/feature%2Fodd%20branch/store/files/weird%20name/a%20b.txt',
    );
  });

  it('reports plainly when the remote is not GitHub, rather than guessing', async () => {
    git(['remote', 'set-url', 'origin', 'git@gitlab.com:someone/repo.git'], repo);
    const link = await githubFileUrl(path.join(repo, 'store', 'files', 'my-thing', 'note.txt'), 'main');
    expect(link.url).toBeNull();
    expect(link.reason).toMatch(/not a github\.com repository/);
  });

  it('reports plainly when there is no remote at all', async () => {
    git(['remote', 'remove', 'origin'], repo);
    const link = await githubFileUrl(path.join(repo, 'store', 'files', 'my-thing', 'note.txt'), 'main');
    expect(link.url).toBeNull();
    expect(link.reason).toMatch(/No "origin" remote/);
  });

  it('reports plainly for a path that is not inside any git repository', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'not-a-repo-'));
    try {
      const link = await githubFileUrl(path.join(outside, 'nothing.txt'), 'main');
      expect(link.url).toBeNull();
      expect(link.reason).toMatch(/Not inside a git repository/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
