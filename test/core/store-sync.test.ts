/**
 * The store's whole promise is that a published item is NOT device-local.
 * These tests use two real clones of a real bare repository, because the only
 * convincing evidence that a publish leaves the machine is another machine
 * having it -- and the only convincing evidence that it survives a reset is
 * wiping the publisher and cloning again.
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

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'store-sync-'))
    remote = path.join(tmp, 'remote.git')
    git(['init', '-q', '--bare', remote], tmp)
    git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote)

    deviceA = path.join(tmp, 'deviceA')
    git(['clone', '-q', remote, deviceA], tmp)
    configure(deviceA, 'a')
    git(['checkout', '-q', '-b', 'main'], deviceA)
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

    const deviceB = path.join(tmp, 'deviceB')
    git(['clone', '-q', remote, deviceB], tmp)
    expect(existsSync(path.join(deviceB, 'store', 'skills', 'travels', 'SKILL.md'))).toBe(true)
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

    const committed = git(['show', '--name-only', '--format=', 'HEAD'], deviceA).trim().split('\n')
    expect(committed.sort()).toEqual([
      'store/skills/scoped/SKILL.md',
    ])

    // Still pending, exactly as the publisher left them.
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

    // A third device must see both -- neither publish was dropped.
    const deviceC = path.join(tmp, 'deviceC')
    git(['clone', '-q', remote, deviceC], tmp)
    expect(existsSync(path.join(deviceC, 'store', 'skills', 'from-a', 'SKILL.md'))).toBe(true)
    expect(existsSync(path.join(deviceC, 'store', 'skills', 'from-b', 'SKILL.md'))).toBe(true)
  })

  it('pushes even when the publisher has uncommitted edits', async () => {
    // Without --autostash the rebase refuses and the publish silently never
    // reaches anyone -- and a dirty working tree is the normal state of
    // someone who is in the middle of something.
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

    const deviceB = path.join(tmp, 'deviceB')
    git(['clone', '-q', remote, deviceB], tmp)
    expect(existsSync(path.join(deviceB, 'store', 'skills', 'temporary'))).toBe(false)
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
    expect(res.committed).toBe(true)
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
})
