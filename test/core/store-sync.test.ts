/**
 * The store's whole promise is that a published item is NOT device-local --
 * and, separately, that it lands on the store branch, not whatever a
 * developer happens to have checked out. These tests use two real clones of
 * a real bare repository, because the only convincing evidence that a
 * publish leaves the machine is another machine having it, and the only
 * convincing evidence it landed on the right branch is inspecting the
 * branches themselves.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { syncStorePaths } from '../../models && skills/core/store-sync.js'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

/** A published item is a folder of files, so that is what the fixtures write. */
function writeItem(root: string, name: string, body = 'hello'): string {
  const dir = path.join(root, 'store', 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\n${body}\n`)
  return dir
}

function configure(clone: string, who: string): void {
  git(['config', 'user.email', `${who}@example.invalid`], clone)
  git(['config', 'user.name', who], clone)
}

describe('store sync', () => {
  let tmp: string
  let remote: string
  let deviceA: string

  /** Reads a path off the bare remote's `store` branch directly -- no clone needed. */
  function readAtStoreBranch(relPath: string): string {
    return git(['show', `store:${relPath}`], remote)
  }

  /** Whether a path exists on the bare remote's `store` branch. */
  function existsAtStoreBranch(relPath: string): boolean {
    try {
      git(['cat-file', '-e', `store:${relPath}`], remote)
      return true
    } catch {
      return false
    }
  }

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'store-sync-'))
    remote = path.join(tmp, 'remote.git')
    git(['init', '-q', '--bare', remote], tmp)
    git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote)

    deviceA = path.join(tmp, 'deviceA')
    git(['clone', '-q', remote, deviceA], tmp)
    configure(deviceA, 'a')
    git(['checkout', '-q', '-b', 'main'], deviceA)
    // A file that stands in for the running app itself, committed on `main`
    // right alongside `store/` -- so a test can tell whether the store
    // branch pulled it in by mistake.
    writeFileSync(path.join(deviceA, 'app.ts'), 'export const running = true\n')
    mkdirSync(path.join(deviceA, 'store', 'skills'), { recursive: true })
    writeFileSync(path.join(deviceA, 'store', 'README.md'), '# store\n')
    git(['add', '-A'], deviceA)
    git(['commit', '-qm', 'init'], deviceA)
    git(['push', '-q', '-u', 'origin', 'main'], deviceA)
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('a published item reaches a clone that never saw the publisher', async () => {
    const dir = writeItem(deviceA, 'travels')
    const res = await syncStorePaths([dir], 'store: publish skills/travels', {
      storeDir: path.join(deviceA, 'store'),
    })
    expect(res.committed).toBe(true)
    expect(res.pushed).toBe(true)
    expect(res.branch).toBe('store')
    expect(readAtStoreBranch('store/skills/travels/SKILL.md')).toContain('travels')

    const deviceB = path.join(tmp, 'deviceB')
    git(['clone', '-q', remote, deviceB], tmp)
    git(['checkout', '-q', '-b', 'store', 'origin/store'], deviceB)
    expect(existsSync(path.join(deviceB, 'store', 'skills', 'travels', 'SKILL.md'))).toBe(true)
  })

  it('lands on the store branch, never on whatever the publisher had checked out', async () => {
    const before = git(['rev-parse', 'HEAD'], deviceA).trim()
    const dir = writeItem(deviceA, 'branch-check')
    await syncStorePaths([dir], 'store: publish skills/branch-check', {
      storeDir: path.join(deviceA, 'store'),
    })

    // The publisher's own checkout, HEAD, and index are exactly as they were
    // -- nothing here ever ran `git checkout`, `git commit` on `main`, or
    // touched the real index.
    expect(git(['rev-parse', 'HEAD'], deviceA).trim()).toBe(before)
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], deviceA).trim()).toBe('main')
    expect(git(['log', '--oneline'], deviceA).trim().split('\n')).toHaveLength(1)

    // The item is on `store`, and `store` does not carry the app's own files
    // in with it -- only what was ever published.
    expect(existsAtStoreBranch('store/skills/branch-check/SKILL.md')).toBe(true)
    expect(existsAtStoreBranch('app.ts')).toBe(false)
  })

  it('survives wiping the publishing device entirely and cloning again', async () => {
    const dir = writeItem(deviceA, 'survives-reset')
    await syncStorePaths([dir], 'store: publish skills/survives-reset', {
      storeDir: path.join(deviceA, 'store'),
    })

    // The reset: the device is gone, not merely restarted.
    rmSync(deviceA, { recursive: true, force: true })
    const reborn = path.join(tmp, 'deviceA-again')
    git(['clone', '-q', remote, reborn], tmp)
    git(['checkout', '-q', '-b', 'store', 'origin/store'], reborn)

    const file = path.join(reborn, 'store', 'skills', 'survives-reset', 'SKILL.md')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('survives-reset')
  })

  it('commits only the store paths, never unrelated work in the tree', async () => {
    // Someone mid-task: an unrelated file staged, and another edited. Neither
    // was offered for commit by publishing a skill.
    writeFileSync(path.join(deviceA, 'unrelated-wip.txt'), 'not for committing\n')
    git(['add', 'unrelated-wip.txt'], deviceA)
    writeFileSync(path.join(deviceA, 'store', 'README.md'), '# store\nedited\n')

    const dir = writeItem(deviceA, 'scoped')
    const res = await syncStorePaths([dir], 'store: publish skills/scoped', {
      storeDir: path.join(deviceA, 'store'),
    })
    expect(res.pushed).toBe(true)

    // Exactly the one file landed on the store branch -- README.md's local
    // edit and the unrelated file were never even candidates, since the
    // commit was built from a throwaway index rooted on the store branch's
    // own tree (which, before this publish, had no README.md at all -- that
    // file only ever existed on `main`), not from anything staged there.
    expect(existsAtStoreBranch('store/skills/scoped/SKILL.md')).toBe(true)
    expect(existsAtStoreBranch('unrelated-wip.txt')).toBe(false)
    expect(existsAtStoreBranch('store/README.md')).toBe(false)

    // Still pending, exactly as the publisher left them -- nothing here was
    // ever staged or committed on their behalf.
    const status = git(['status', '--short'], deviceA)
    expect(status).toContain('unrelated-wip.txt')
    expect(status).toContain('store/README.md')
  })

  it('resolves a concurrent publish from another device instead of losing one', async () => {
    const deviceB = path.join(tmp, 'deviceB')
    git(['clone', '-q', remote, deviceB], tmp)
    configure(deviceB, 'b')

    // B publishes first and A never pulls, so A's push is rejected.
    const dirB = writeItem(deviceB, 'from-b')
    const resB = await syncStorePaths([dirB], 'store: publish skills/from-b', {
      storeDir: path.join(deviceB, 'store'),
    })
    expect(resB.pushed).toBe(true)

    const dirA = writeItem(deviceA, 'from-a')
    const resA = await syncStorePaths([dirA], 'store: publish skills/from-a', {
      storeDir: path.join(deviceA, 'store'),
    })
    expect(resA.pushed).toBe(true)

    // Neither publish was dropped.
    expect(existsAtStoreBranch('store/skills/from-a/SKILL.md')).toBe(true)
    expect(existsAtStoreBranch('store/skills/from-b/SKILL.md')).toBe(true)
  })

  it('pushes even when the publisher has uncommitted edits', async () => {
    // The publish never touches the developer's real index or working tree
    // at all, so a dirty working tree -- the normal state of someone in the
    // middle of something -- was never a hazard to begin with.
    const deviceB = path.join(tmp, 'deviceB')
    git(['clone', '-q', remote, deviceB], tmp)
    configure(deviceB, 'b')
    await syncStorePaths([writeItem(deviceB, 'first')], 'store: publish skills/first', {
      storeDir: path.join(deviceB, 'store'),
    })

    writeFileSync(path.join(deviceA, 'store', 'README.md'), '# store\nunsaved edit\n')
    const res = await syncStorePaths([writeItem(deviceA, 'second')], 'store: publish skills/second', {
      storeDir: path.join(deviceA, 'store'),
    })
    expect(res.pushed).toBe(true)
    // The edit is back where it was, not committed and not lost.
    expect(readFileSync(path.join(deviceA, 'store', 'README.md'), 'utf8')).toContain('unsaved edit')
  })

  it('propagates a removal, so a pull cannot resurrect a deleted item', async () => {
    const dir = writeItem(deviceA, 'temporary')
    await syncStorePaths([dir], 'store: publish skills/temporary', {
      storeDir: path.join(deviceA, 'store'),
    })
    rmSync(dir, { recursive: true, force: true })
    const res = await syncStorePaths([dir], 'store: remove skills/temporary', {
      storeDir: path.join(deviceA, 'store'),
    })
    expect(res.pushed).toBe(true)
    expect(existsAtStoreBranch('store/skills/temporary')).toBe(false)
  })

  it('republishing identical content is a success with nothing new to push', async () => {
    const dir = writeItem(deviceA, 'stable')
    await syncStorePaths([dir], 'store: publish skills/stable', { storeDir: path.join(deviceA, 'store') })
    const before = git(['rev-parse', 'store'], remote).trim()

    const res = await syncStorePaths([dir], 'store: publish skills/stable', { storeDir: path.join(deviceA, 'store') })
    expect(res.pushed).toBe(true)
    expect(res.reason).toMatch(/already had exactly this/)
    expect(git(['rev-parse', 'store'], remote).trim()).toBe(before)
  })

  it('says so plainly when there is no remote, rather than implying it was shared', async () => {
    const lonely = path.join(tmp, 'lonely')
    mkdirSync(lonely)
    git(['init', '-q'], lonely)
    configure(lonely, 'c')
    mkdirSync(path.join(lonely, 'store'), { recursive: true })
    writeFileSync(path.join(lonely, 'store', 'README.md'), '# store\n')
    git(['add', '-A'], lonely)
    git(['commit', '-qm', 'init'], lonely)

    const res = await syncStorePaths([writeItem(lonely, 'stranded')], 'store: publish skills/stranded', {
      storeDir: path.join(lonely, 'store'),
    })
    expect(res.committed).toBe(false)
    expect(res.pushed).toBe(false)
    expect(res.reason).toMatch(/no "origin" remote/)
  })

  it('does not fail the publish when the folder is not a git repository at all', async () => {
    const plain = path.join(tmp, 'plain')
    mkdirSync(path.join(plain, 'store'), { recursive: true })
    const res = await syncStorePaths([writeItem(plain, 'nogit')], 'store: publish skills/nogit', {
      storeDir: path.join(plain, 'store'),
    })
    expect(res.committed).toBe(false)
    expect(res.pushed).toBe(false)
    expect(res.reason).toMatch(/Not a git repository/)
    // The files are still written -- a sync failure downgrades a publish, it
    // does not undo one.
    expect(existsSync(path.join(plain, 'store', 'skills', 'nogit', 'SKILL.md'))).toBe(true)
  })

  it('can be switched off for a private instance', async () => {
    const prev = process.env.NEUROCLAW_STORE_NO_SYNC
    process.env.NEUROCLAW_STORE_NO_SYNC = '1'
    try {
      const res = await syncStorePaths([writeItem(deviceA, 'private')], 'store: publish skills/private', {
        storeDir: path.join(deviceA, 'store'),
      })
      expect(res.committed).toBe(false)
      expect(res.pushed).toBe(false)
      expect(res.reason).toMatch(/disabled/)
    } finally {
      if (prev === undefined) delete process.env.NEUROCLAW_STORE_NO_SYNC
      else process.env.NEUROCLAW_STORE_NO_SYNC = prev
    }
  })

  it('can be pointed at a different branch name, for a private instance with its own convention', async () => {
    const dir = writeItem(deviceA, 'custom-branch')
    const res = await syncStorePaths([dir], 'store: publish skills/custom-branch', {
      storeDir: path.join(deviceA, 'store'),
      branch: 'published',
    })
    expect(res.pushed).toBe(true)
    expect(res.branch).toBe('published')
    expect(git(['show', 'published:store/skills/custom-branch/SKILL.md'], remote)).toContain('custom-branch')
    // The default `store` branch was never touched.
    expect(existsAtStoreBranch('store/skills/custom-branch')).toBe(false)
  })
})
