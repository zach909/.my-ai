import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WikiPlugin } from '../../plugins/wiki';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('WikiPlugin Security Validation', () => {
  let plugin: WikiPlugin;
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'neuroclaw-wiki-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);

    plugin = new WikiPlugin({
      id: 'wiki',
      name: 'Wiki',
      type: 'api-connection',
      capabilities: [],
    } as any);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('read() validation', () => {
    it('allows valid page name', async () => {
      const res = await plugin.read('ValidPage');
      expect(res).toBeNull();
    });

    it('rejects non-string name', async () => {
      await expect(plugin.read(123 as any)).rejects.toThrowError('Security Error: Page name must be a string.');
      await expect(plugin.read(null as any)).rejects.toThrowError('Security Error: Page name must be a string.');
      await expect(plugin.read({} as any)).rejects.toThrowError('Security Error: Page name must be a string.');
    });

    it('rejects empty name', async () => {
      await expect(plugin.read('')).rejects.toThrowError('Security Error: Page name cannot be empty.');
      await expect(plugin.read('   ')).rejects.toThrowError('Security Error: Page name cannot be empty.');
    });

    it('rejects oversized page name', async () => {
      const longName = 'a'.repeat(101);
      await expect(plugin.read(longName)).rejects.toThrowError('Security Error: Page name exceeds maximum length limit of 100 characters.');
    });
  });

  describe('publish() validation', () => {
    it('allows valid publishing parameters', async () => {
      const { page, sync } = await plugin.publish('test_page', 'Test Title', 'This is valid page content.');
      expect(page.name).toBe('test_page');
      expect(page.title).toBe('Test Title');
      expect(page.content).toContain('This is valid page content.');
      // The scratch dir is not a git repo, so this is the honest answer --
      // and the one that matters: publish() now goes through the *AndSync
      // form at all, rather than never attempting a sync in the first place.
      // See the "left permanently on the device" describe block below for
      // where that used to go silently wrong.
      expect(sync.pushed).toBe(false);
      expect(sync.reason).toMatch(/not a git repository/i);
    });

    it('rejects non-string name, title, or content', async () => {
      await expect(plugin.publish(123 as any, 'Title', 'Content')).rejects.toThrowError('Security Error: Page name must be a string.');
      await expect(plugin.publish('Name', null as any, 'Content')).rejects.toThrowError('Security Error: Page title must be a string.');
      await expect(plugin.publish('Name', 'Title', undefined as any)).rejects.toThrowError('Security Error: Page content must be a string.');
    });

    it('rejects empty name, title, or content', async () => {
      await expect(plugin.publish('', 'Title', 'Content')).rejects.toThrowError('Security Error: Page name cannot be empty.');
      await expect(plugin.publish('Name', '   ', 'Content')).rejects.toThrowError('Security Error: Page title cannot be empty.');
      await expect(plugin.publish('Name', 'Title', '')).rejects.toThrowError('Security Error: Page content cannot be empty.');
    });

    it('rejects oversized name, title, or content', async () => {
      const longName = 'a'.repeat(101);
      const longTitle = 'b'.repeat(201);
      const longContent = 'c'.repeat(100001);

      await expect(plugin.publish(longName, 'Title', 'Content')).rejects.toThrowError('Security Error: Page name exceeds maximum length limit of 100 characters.');
      await expect(plugin.publish('Name', longTitle, 'Content')).rejects.toThrowError('Security Error: Page title exceeds maximum length limit of 200 characters.');
      await expect(plugin.publish('Name', 'Title', longContent)).rejects.toThrowError('Security Error: Page content exceeds maximum length limit of 100,000 characters.');
    });
  });
});

describe('WikiPlugin publishes through the real sync path, not just to disk', () => {
  // The bug this section exists to catch: WikiPlugin.publish()/edit()/
  // remove() called publishWikiPage()/deleteWikiPage() directly -- the
  // plain, local-only form -- instead of the *AndSync form POST /api/wiki
  // (the human /app/wiki form) already used. A page the bot published
  // landed on disk correctly and was never committed or pushed. Nothing
  // failed and nothing reported an error, because sync was never attempted
  // in the first place -- there was no reason to report.
  //
  // A real bare "remote" and a real device clone, the same fixture shape
  // store-sync.test.ts uses, because the only convincing evidence a publish
  // actually left the device is another clone having it.
  let tmp: string;
  let remote: string;
  let device: string;
  let restoreCwd: string;

  const git = (args: string[], cwd: string) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wiki-plugin-sync-'));
    remote = join(tmp, 'remote.git');
    git(['init', '-q', '--bare', remote], tmp);
    git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote);

    device = join(tmp, 'device');
    git(['clone', '-q', remote, device], tmp);
    git(['config', 'user.email', 'a@example.invalid'], device);
    git(['config', 'user.name', 'a'], device);
    git(['checkout', '-q', '-b', 'main'], device);
    mkdirSync(join(device, 'wiki', 'bot'), { recursive: true });
    writeFileSync(join(device, 'wiki', 'README.md'), '# wiki\n');
    git(['add', '-A'], device);
    git(['commit', '-qm', 'init'], device);
    git(['push', '-q', '-u', 'origin', 'main'], device);

    restoreCwd = process.cwd();
    process.chdir(device);
  });

  afterEach(() => {
    process.chdir(restoreCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const plugin = () => new WikiPlugin({ id: 'wiki', name: 'Wiki', type: 'api-connection', capabilities: [] } as any);

  it('publish() actually reaches a clone that never saw the bot', async () => {
    const { sync } = await plugin().publish('lands-elsewhere', 'Lands Elsewhere', 'real content');
    expect(sync.pushed).toBe(true);

    const other = join(tmp, 'other-clone');
    git(['clone', '-q', remote, other], tmp);
    git(['checkout', '-q', '-b', 'store', 'origin/store'], other);
    expect(existsSync(join(other, 'wiki', 'bot', 'lands-elsewhere.md'))).toBe(true);
  });

  it('edit() reaches the clone with the NEW content', async () => {
    const p = plugin();
    await p.publish('gets-edited', 'Original', 'v1');
    const { sync } = await p.edit('gets-edited', 'Original', 'v2, corrected');
    expect(sync.pushed).toBe(true);

    const other = join(tmp, 'other-clone-2');
    git(['clone', '-q', remote, other], tmp);
    git(['checkout', '-q', '-b', 'store', 'origin/store'], other);
    const content = readFileSync(join(other, 'wiki', 'bot', 'gets-edited.md'), 'utf8');
    expect(content).toContain('v2, corrected');
  });

  it('remove() propagates the deletion, so a pull cannot resurrect the page', async () => {
    const p = plugin();
    await p.publish('gets-deleted', 'Title', 'content');
    const sync = await p.remove('gets-deleted');
    expect(sync.pushed).toBe(true);

    const other = join(tmp, 'other-clone-3');
    git(['clone', '-q', remote, other], tmp);
    git(['checkout', '-q', '-b', 'store', 'origin/store'], other);
    expect(existsSync(join(other, 'wiki', 'bot', 'gets-deleted.md'))).toBe(false);
  });

  it('the chat command reports the push honestly, not just "Published"', async () => {
    const reply = await plugin().onMessage('wiki publish "chat-published" "Chat Published": some content') as string;
    expect(reply).toContain('Published');
    expect(reply).toMatch(/Pushed to store/);
  });
});

describe('the chat command tells the truth when the push does NOT happen', () => {
  // Without this, describeSync() could claim "Pushed" unconditionally and
  // every other test above (which all genuinely succeed) would stay green.
  it('says "saved on this device only" from a plain, non-git scratch directory', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'neuroclaw-wiki-nogit-'));
    const restoreCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plugin = new WikiPlugin({ id: 'wiki', name: 'Wiki', type: 'api-connection', capabilities: [] } as any);
      const reply = await plugin.onMessage('wiki publish "no-git-here" "No Git Here": some content') as string;
      expect(reply).toContain('Published');
      expect(reply).toMatch(/saved on this device only/i);
      expect(reply).not.toMatch(/Pushed to/);
    } finally {
      process.chdir(restoreCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
