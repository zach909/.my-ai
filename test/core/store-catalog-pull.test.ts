/**
 * Store content moved off the app's own branch and onto `store` (see
 * store-sync.ts). A plain `git clone`/`git pull` of the app no longer
 * brings the catalogue along -- pullStoreCatalog() is what does, so a
 * fresh device is not staring at an empty store until someone publishes
 * something new. Same fixture shape as store-sync.test.ts: a real bare
 * remote and a real clone, because the only convincing evidence a pull
 * actually reads the store branch is a clone that never had it acquiring
 * the files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pullStoreCatalog } from '../../models && skills/core/store-fetch.js'
import { syncStorePaths } from '../../models && skills/core/store-sync.js'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}

describe('pulling the catalogue from the store branch', () => {
  let tmp: string
  let remote: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'store-pull-'))
    remote = path.join(tmp, 'remote.git')
    git(['init', '-q', '--bare', remote], tmp)
    git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote)
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('a fresh clone that only pulled `main` sees the catalogue after one call', async () => {
    // Publisher: publishes a skill onto the store branch, from a device
    // that also has an unrelated `main` with its own app files.
    const publisher = path.join(tmp, 'publisher')
    git(['clone', '-q', remote, publisher], tmp)
    git(['config', 'user.email', 'a@example.invalid'], publisher)
    git(['config', 'user.name', 'a'], publisher)
    git(['checkout', '-q', '-b', 'main'], publisher)
    writeFileSync(path.join(publisher, 'app.ts'), 'export const running = true\n')
    mkdirSync(path.join(publisher, 'store', 'skills'), { recursive: true })
    git(['add', '-A'], publisher)
    git(['commit', '-qm', 'init'], publisher)
    git(['push', '-q', '-u', 'origin', 'main'], publisher)

    const itemDir = path.join(publisher, 'store', 'skills', 'catalogued')
    mkdirSync(itemDir, { recursive: true })
    writeFileSync(path.join(itemDir, 'SKILL.md'), '# catalogued\n')
    const sync = await syncStorePaths([itemDir], 'store: publish skills/catalogued', {
      storeDir: path.join(publisher, 'store'),
    })
    expect(sync.pushed).toBe(true)

    // A second device: clones `main` only (the normal thing to do), and has
    // never seen the store branch at all.
    const reader = path.join(tmp, 'reader')
    git(['clone', '-q', remote, reader], tmp)
    expect(existsSync(path.join(reader, 'store'))).toBe(false)

    const result = await pullStoreCatalog({ storeDir: path.join(reader, 'store') })
    expect(result.pulled).toBe(true)

    const file = path.join(reader, 'store', 'skills', 'catalogued', 'SKILL.md')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('catalogued')

    // app.ts came from cloning `main` itself, same as always -- confirming
    // it is still exactly what `main` committed, not something the pull
    // touched or duplicated from the store branch (which never had it).
    expect(readFileSync(path.join(reader, 'app.ts'), 'utf8')).toBe('export const running = true\n')
  })

  it('says so, rather than pretending, when the store branch does not exist yet', async () => {
    const reader = path.join(tmp, 'reader-empty')
    git(['clone', '-q', remote, reader], tmp)
    git(['checkout', '-q', '-b', 'main'], reader)

    const result = await pullStoreCatalog({ storeDir: path.join(reader, 'store') })
    expect(result.pulled).toBe(false)
    expect(result.reason).toMatch(/no "store" branch/i)
  })

  it('does not fail when the folder is not a git repository at all', async () => {
    const plain = path.join(tmp, 'plain')
    mkdirSync(plain, { recursive: true })
    const result = await pullStoreCatalog({ storeDir: path.join(plain, 'store') })
    expect(result.pulled).toBe(false)
    expect(result.reason).toMatch(/Not a git repository/)
  })

  it('never touches the reader device\'s own HEAD, branch, or index', async () => {
    const publisher = path.join(tmp, 'publisher2')
    git(['clone', '-q', remote, publisher], tmp)
    git(['config', 'user.email', 'a@example.invalid'], publisher)
    git(['config', 'user.name', 'a'], publisher)
    git(['checkout', '-q', '-b', 'main'], publisher)
    mkdirSync(path.join(publisher, 'store'), { recursive: true })
    git(['add', '-A'], publisher)
    git(['commit', '--allow-empty', '-qm', 'init'], publisher)
    git(['push', '-q', '-u', 'origin', 'main'], publisher)
    await syncStorePaths(
      [(() => {
        const dir = path.join(publisher, 'store', 'skills', 'a')
        mkdirSync(dir, { recursive: true })
        writeFileSync(path.join(dir, 'SKILL.md'), '# a\n')
        return dir
      })()],
      'store: publish skills/a',
      { storeDir: path.join(publisher, 'store') },
    )

    const reader = path.join(tmp, 'reader2')
    git(['clone', '-q', remote, reader], tmp)
    const before = git(['rev-parse', 'HEAD'], reader).trim()
    const beforeBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], reader).trim()

    await pullStoreCatalog({ storeDir: path.join(reader, 'store') })

    // The extracted store/ shows up as an untracked directory -- expected,
    // the same as it would on a real device once /store/ is gitignored.
    // What matters is that nothing was staged or committed on the reader's
    // behalf: HEAD, the checked-out branch, and the index are all exactly
    // as they were.
    expect(git(['rev-parse', 'HEAD'], reader).trim()).toBe(before)
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], reader).trim()).toBe(beforeBranch)
    expect(git(['diff', '--cached', '--name-only'], reader).trim()).toBe('')
  })
})
