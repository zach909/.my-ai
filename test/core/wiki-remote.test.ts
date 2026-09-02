/**
 * "But there is stuff in [the store] branch" -- a bot-published wiki page
 * reaches the store branch the moment ANY device publishes it
 * (publishWikiPageAndSync), but a DIFFERENT device never pulled it back
 * down, so it stayed invisible there even though it plainly existed. These
 * pin the fix: readable straight off the store branch, without landing on
 * the reading device's disk at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listRemoteOnlyBotPages, readRemoteBotPage } from '../../models && skills/core/wiki-remote.js'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}

describe('reading a bot-published wiki page that never reached this device', () => {
  let tmp: string
  let remote: string
  let publisher: string
  let reader: string
  let restoreCwd: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'wiki-remote-'))
    remote = path.join(tmp, 'remote.git')
    git(['init', '-q', '--bare', remote], tmp)
    git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote)

    // A publisher that pushes a bot page directly to the store branch --
    // the same shape syncStorePaths() itself produces, without needing the
    // whole wiki-store.ts publish path just to seed the fixture.
    publisher = path.join(tmp, 'publisher')
    git(['clone', '-q', remote, publisher], tmp)
    git(['config', 'user.email', 'a@example.invalid'], publisher)
    git(['config', 'user.name', 'a'], publisher)
    git(['checkout', '-q', '-b', 'main'], publisher)
    git(['commit', '-q', '--allow-empty', '-m', 'init'], publisher)
    git(['push', '-q', '-u', 'origin', 'main'], publisher)

    mkdirSync(path.join(publisher, 'wiki', 'bot'), { recursive: true })
    writeFileSync(
      path.join(publisher, 'wiki', 'bot', 'seen-elsewhere.md'),
      '# Seen Elsewhere\n\nPublished from a device that is not this one.\n',
    )
    git(['add', '-A', '--', 'wiki/bot/seen-elsewhere.md'], publisher)
    git(['commit', '-q', '-m', 'wiki: publish seen-elsewhere'], publisher)
    git(['push', '-q', 'origin', 'HEAD:refs/heads/store'], publisher)

    // A second device: clones `main` only, same as any normal clone, and
    // has never touched the store branch or wiki/bot/ at all.
    reader = path.join(tmp, 'reader')
    git(['clone', '-q', remote, reader], tmp)

    restoreCwd = process.cwd()
    process.chdir(reader)
  })

  afterEach(() => {
    process.chdir(restoreCwd)
    rmSync(tmp, { recursive: true, force: true })
  })

  it('lists the page even though it never reached this device\'s disk', async () => {
    expect(existsSync(path.join(reader, 'wiki', 'bot', 'seen-elsewhere.md'))).toBe(false)

    const pages = await listRemoteOnlyBotPages(new Set())
    expect(pages.map(p => p.name)).toContain('seen-elsewhere')
    const page = pages.find(p => p.name === 'seen-elsewhere')!
    expect(page.title).toBe('Seen Elsewhere')
    expect(page.source).toBe('bot')

    // Still nothing written locally -- listing is not fetching.
    expect(existsSync(path.join(reader, 'wiki', 'bot', 'seen-elsewhere.md'))).toBe(false)
  })

  it('excludes a name already present locally, so a caller never sees the same page twice', async () => {
    const pages = await listRemoteOnlyBotPages(new Set(['seen-elsewhere']))
    expect(pages.map(p => p.name)).not.toContain('seen-elsewhere')
  })

  it('reads the page\'s real content straight from the store branch', async () => {
    const page = await readRemoteBotPage('seen-elsewhere')
    expect(page).not.toBeNull()
    expect(page!.content).toContain('Published from a device that is not this one.')
    expect(page!.source).toBe('bot')

    // Reading did not write it under wiki/ either.
    expect(existsSync(path.join(reader, 'wiki', 'bot', 'seen-elsewhere.md'))).toBe(false)
  })

  it('returns null for a name that is not on the store branch either', async () => {
    const page = await readRemoteBotPage('never-published-anywhere')
    expect(page).toBeNull()
  })

  it('returns an empty list, not an error, when there is no store branch yet', async () => {
    const lonely = path.join(tmp, 'lonely')
    mkdirSync(lonely, { recursive: true })
    git(['init', '-q'], lonely)
    git(['config', 'user.email', 'c@example.invalid'], lonely)
    git(['config', 'user.name', 'c'], lonely)
    git(['commit', '-q', '--allow-empty', '-m', 'init'], lonely)
    process.chdir(lonely)

    const pages = await listRemoteOnlyBotPages(new Set())
    expect(pages).toEqual([])
    const page = await readRemoteBotPage('seen-elsewhere')
    expect(page).toBeNull()
  })

  it('does not fail when the folder is not a git repository at all', async () => {
    const plain = path.join(tmp, 'plain')
    mkdirSync(plain, { recursive: true })
    process.chdir(plain)

    expect(await listRemoteOnlyBotPages(new Set())).toEqual([])
    expect(await readRemoteBotPage('seen-elsewhere')).toBeNull()
  })
})
