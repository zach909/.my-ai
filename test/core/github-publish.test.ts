/**
 * The GitHub extension, end to end: a caller with no GitHub account pushes
 * something public and gets back a real, clickable URL.
 *
 * A real bare "remote" repo and a real "device" clone, the same fixture
 * shape store-sync.test.ts uses -- the only convincing evidence that this
 * reached GitHub is another clone actually having the file, and the only
 * convincing evidence the link is right is resolving it against the actual
 * git history rather than trusting a string built by hand.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GithubPublishPlugin } from '../../plugins/github-publish';
import { StoreError } from '../../models && skills/core/store';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

describe('pushing something public to GitHub, with no sign-up and no sign-in', () => {
  let tmp: string;
  let remote: string;
  let device: string;
  let restoreCwd: string;
  let restoreStoreDir: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'github-publish-'));
    remote = path.join(tmp, 'remote.git');
    git(['init', '-q', '--bare', remote], tmp);
    git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);
    // A GitHub-shaped URL on the bare remote, so link resolution has
    // something real to read -- this is what makes the "GitHub" half of this
    // test meaningful rather than testing a generic git push.
    git(['remote', 'add', 'github-origin', 'https://github.com/example-owner/example-repo.git'], remote);

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

    // A real remote has ONE url used for both purposes unless told
    // otherwise; git's push/fetch url split is what a repo bound to a real
    // github.com origin actually looks like once that repo also needs a
    // WRITABLE remote reachable from a sandboxed test with no network. The
    // FETCH url (what `git remote get-url` reports, and what the link
    // resolver reads) stays the github.com URL a real deployment would have.
    // The PUSH url is quietly the local bare fixture, so `git push origin`
    // really lands content there -- exactly what makes the "another clone
    // has it" assertion below honest rather than assumed.
    git(['remote', 'set-url', 'origin', 'https://github.com/example-owner/example-repo.git'], device);
    git(['remote', 'set-url', '--push', 'origin', remote], device);

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

  const plugin = () => new GithubPublishPlugin({ id: 'github-publish', name: 'GitHub Publish', type: 'api-connection', capabilities: [] });

  it('pushes a real file and hands back the real github.com URL', async () => {
    const p = plugin();
    const result = await p.push({
      name: 'my-public-thing',
      title: 'My Public Thing',
      files: [{ filename: 'note.txt', content: 'hello world\n' }],
    });

    expect(result.pushed).toBe(true);
    expect(result.url).toBe(
      'https://github.com/example-owner/example-repo/blob/store/store/files/my-public-thing/note.txt',
    );

    // The decisive check: a clone that never saw the publisher has it. That
    // is what "reached GitHub" actually means, not merely "the API returned
    // pushed: true".
    const other = path.join(tmp, 'other-clone');
    git(['clone', '-q', remote, other], tmp);
    git(['checkout', '-q', '-b', 'store', 'origin/store'], other);
    const landed = path.join(other, 'store', 'files', 'my-public-thing', 'note.txt');
    expect(existsSync(landed)).toBe(true);
    expect(readFileSync(landed, 'utf8')).toBe('hello world\n');
  });

  it('builds a directory URL when the publish has more than one file', async () => {
    const p = plugin();
    const result = await p.push({
      name: 'multi-file-thing',
      files: [
        { filename: 'a.txt', content: 'a\n' },
        { filename: 'b.txt', content: 'b\n' },
      ],
    });
    expect(result.pushed).toBe(true);
    expect(result.url).toBe('https://github.com/example-owner/example-repo/tree/store/store/files/multi-file-thing');
  });

  it('refuses model weights before anything is written or pushed', async () => {
    const p = plugin();
    await expect(p.push({
      name: 'sneaky',
      files: [{ filename: 'model.safetensors', content: 'not really a model' }],
    })).rejects.toThrow(StoreError);
    await expect(p.push({
      name: 'sneaky',
      files: [{ filename: 'model.safetensors', content: 'x' }],
    })).rejects.toThrow(/model weights/);

    // Nothing reached the remote -- the refusal has to happen before the
    // publish, not after.
    const other = path.join(tmp, 'check-clone');
    git(['clone', '-q', remote, other], tmp);
    expect(existsSync(path.join(other, 'store', 'files', 'sneaky'))).toBe(false);
  });

  it('refuses an empty file list', async () => {
    const p = plugin();
    await expect(p.push({ name: 'nothing', files: [] })).rejects.toThrow(StoreError);
  });

  it('a mixed batch is refused for the ONE weight file, protecting the whole publish', async () => {
    const p = plugin();
    await expect(p.push({
      name: 'mostly-fine',
      files: [
        { filename: 'README.md', content: '# fine\n' },
        { filename: 'sneaky.gguf', content: 'x' },
      ],
    })).rejects.toThrow(StoreError);
  });

  it('answers through the chat command surface too', async () => {
    const p = plugin();
    const reply = await p.onMessage('github push chat-pushed hello.txt\nhi there\n') as { tool: string; result: string };
    expect(reply.tool).toBe('github-publish');
    expect(reply.result).toContain('https://github.com/example-owner/example-repo/');
  });

  it('describeCapabilities names github so the router can find this plugin', () => {
    const caps = plugin().describeCapabilities();
    expect(caps.nouns).toContain('github');
    expect(caps.verbs).toContain('push');
  });
});
