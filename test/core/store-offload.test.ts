/**
 * Offloading idle downloaded store items.
 *
 * What these protect: nothing is removed unless the store branch is confirmed
 * to hold it; what is removed comes back on demand; and an item that is in
 * use (applied mod, recently used) is never touched.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const h = vi.hoisted(() => ({ cloud: new Map<string, Buffer>() }))

// The real fetchItemFile goes to GitHub. This stands in for it with the same
// contract: write the file into the store cache and hand back its bytes.
vi.mock('../../models && skills/core/store-fetch.js', async () => {
  const fs = await import('node:fs')
  const p = await import('node:path')
  const store = await import('../../models && skills/core/store.js')
  return {
    fetchItemFile: async (kind: string, name: string, filename: string) => {
      const buf = h.cloud.get(`${kind}/${name}/${filename}`)
      if (!buf) throw new Error('not on the cloud')
      const target = p.join(store.itemDir(kind as never, name), filename)
      fs.mkdirSync(p.dirname(target), { recursive: true })
      fs.writeFileSync(target, buf)
      return { buf, cached: false }
    },
  }
})

import { publishItem, readItem, itemDir } from '../../models && skills/core/store.js'
import {
  installItem,
  readInstalled,
  listInstalledItems,
  installedRoot,
  planActivation,
  rehydrateInstalled,
} from '../../models && skills/core/store-install.js'
import { applyMod } from '../../models && skills/core/mod-apply.js'
import { markUsed, lastUsedAt } from '../../models && skills/core/store-usage.js'
import {
  offloadIdle,
  listOffloadCandidates,
  gitCloudSource,
  type CloudSource,
} from '../../models && skills/core/store-offload.js'

const DAY = 86_400_000
const SKILL = '{"neurons":[{"name":"n1","definition":"does a thing"}]}'
const accept: CloudSource = { check: () => ({ ok: true }) }

let root: string
let later: number

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'corona-offload-'))
  process.env.NEUROCLAW_STORE_DIR = path.join(root, 'store')
  process.env.CORONA_INSTALLED_DIR = path.join(root, 'installed')
  process.env.CORONA_MODS_BACKUP_DIR = path.join(root, 'mods-backup')
  process.env.CORONA_MODS_TARGET_DIR = path.join(root, 'target')
  process.env.NEUROCLAW_STORE_NO_SYNC = '1'
  mkdirSync(process.env.CORONA_MODS_TARGET_DIR, { recursive: true })
  h.cloud.clear()
  later = Date.now() + 60 * DAY
})

afterEach(() => {
  for (const k of ['NEUROCLAW_STORE_DIR', 'CORONA_INSTALLED_DIR', 'CORONA_MODS_BACKUP_DIR', 'CORONA_MODS_TARGET_DIR', 'NEUROCLAW_STORE_NO_SYNC']) {
    delete process.env[k]
  }
  rmSync(root, { recursive: true, force: true })
})

function publish(kind: string, name: string, files: Array<{ filename: string; content: string }>) {
  const item = publishItem({ kind, name, title: name, description: 'test item', author: 'tester', files } as never)
  for (const f of files) h.cloud.set(`${kind}/${name}/${f.filename}`, Buffer.from(f.content))
  return item
}

describe('offloading an idle item', () => {
  it('removes the payloads, keeps the index, and says so on the installed record', async () => {
    publish('net-skills', 'greeter', [{ filename: 'skill.json', content: SKILL }])
    await installItem('net-skills', 'greeter')

    const report = await offloadIdle({ now: later, cloud: accept })

    expect(report.offloaded).toHaveLength(1)
    expect(report.offloaded[0].layers).toEqual(['store', 'installed'])
    expect(report.freedBytes).toBeGreaterThan(0)
    expect(existsSync(path.join(installedRoot(), 'net-skills', 'greeter', 'skill.json'))).toBe(false)
    expect(existsSync(path.join(itemDir('net-skills', 'greeter'), 'skill.json'))).toBe(false)
    // The index survives, so it is still in the catalogue and still listed as installed.
    const item = readItem('net-skills', 'greeter')!
    expect(item.files.map(f => [f.filename, f.local])).toEqual([['skill.json', false]])
    expect(readInstalled('net-skills', 'greeter')?.offloadedAt).toBeGreaterThan(0)
    expect(listInstalledItems().map(r => r.name)).toEqual(['greeter'])
    expect(planActivation('net-skills', 'greeter').nothingLoadable).toMatch(/offloaded/)
  })

  it('brings the files back when the item is needed again', async () => {
    publish('net-skills', 'greeter', [{ filename: 'skill.json', content: SKILL }])
    await installItem('net-skills', 'greeter')
    await offloadIdle({ now: later, cloud: accept })

    const back = await rehydrateInstalled('net-skills', 'greeter')

    expect(back?.downloaded).toEqual(['skill.json'])
    expect(readInstalled('net-skills', 'greeter')?.offloadedAt).toBeUndefined()
    expect(existsSync(path.join(installedRoot(), 'net-skills', 'greeter', 'skill.json'))).toBe(true)
    expect(planActivation('net-skills', 'greeter').neurons.map(n => n.name)).toEqual(['n1'])
  })

  it('leaves a copy that is still in use', async () => {
    publish('net-skills', 'busy', [{ filename: 'skill.json', content: SKILL }])
    await installItem('net-skills', 'busy')
    markUsed('net-skills', 'busy', later - DAY)

    const report = await offloadIdle({ now: later, cloud: accept })

    expect(report.offloaded).toEqual([])
    expect(existsSync(path.join(installedRoot(), 'net-skills', 'busy', 'skill.json'))).toBe(true)
  })

  it('does nothing past a dry run', async () => {
    publish('net-skills', 'greeter', [{ filename: 'skill.json', content: SKILL }])
    await installItem('net-skills', 'greeter')

    const report = await offloadIdle({ now: later, cloud: accept, dryRun: true })

    expect(report.offloaded).toHaveLength(1)
    expect(existsSync(path.join(installedRoot(), 'net-skills', 'greeter', 'skill.json'))).toBe(true)
    expect(readInstalled('net-skills', 'greeter')?.offloadedAt).toBeUndefined()
  })

  it('does not ask the cloud anything when nothing is idle', async () => {
    const report = await offloadIdle({ now: Date.now() })
    expect(report.idle).toBe(0)
    expect(report.cloud.ok).toBe(true)
  })

  it('records use when an item is installed', async () => {
    publish('net-skills', 'greeter', [{ filename: 'skill.json', content: SKILL }])
    await installItem('net-skills', 'greeter')
    expect(lastUsedAt('net-skills', 'greeter')).toBeGreaterThan(0)
    expect(listOffloadCandidates({ now: Date.now() })).toEqual([])
    expect(listOffloadCandidates({ now: later }).map(c => c.name)).toEqual(['greeter'])
  })
})

describe('what is never removed', () => {
  it('keeps everything when the cloud cannot be checked', async () => {
    publish('net-skills', 'greeter', [{ filename: 'skill.json', content: SKILL }])
    await installItem('net-skills', 'greeter')

    const report = await offloadIdle({ now: later, cloud: { unavailable: 'offline' } })

    expect(report.cloud).toEqual({ ok: false, reason: 'offline' })
    expect(report.offloaded).toEqual([])
    expect(report.skipped[0].reason).toBe('offline')
    expect(existsSync(path.join(itemDir('net-skills', 'greeter'), 'skill.json'))).toBe(true)
  })

  it('keeps an item the cloud does not hold', async () => {
    publish('net-skills', 'unpushed', [{ filename: 'skill.json', content: SKILL }])
    await installItem('net-skills', 'unpushed')

    const report = await offloadIdle({ now: later, cloud: { check: () => ({ ok: false, reason: 'not pushed' }) } })

    expect(report.offloaded).toEqual([])
    expect(report.skipped[0].reason).toContain('not pushed')
    expect(existsSync(path.join(installedRoot(), 'net-skills', 'unpushed', 'skill.json'))).toBe(true)
  })

  it('keeps a mod that is applied on this device', async () => {
    publish('mods', 'hello', [{ filename: 'hello.txt', content: 'hi' }])
    await applyMod('hello')

    const report = await offloadIdle({ now: later, cloud: accept })

    expect(report.offloaded).toEqual([])
    expect(report.skipped).toEqual([{ kind: 'mods', name: 'hello', reason: 'this mod is applied on this device' }])
    expect(existsSync(path.join(itemDir('mods', 'hello'), 'hello.txt'))).toBe(true)
  })

  it('keeps kinds outside skills, plugins and mods', async () => {
    publish('files', 'notes', [{ filename: 'a.txt', content: 'a' }])
    const report = await offloadIdle({ now: later, cloud: accept })
    expect(report.idle).toBe(0)
    expect(existsSync(path.join(itemDir('files', 'notes'), 'a.txt'))).toBe(true)
  })
})

describe('confirming against a real store branch', () => {
  const identity = {
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
  }
  const git = (args: string[], cwd: string) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env: { ...process.env, ...identity }, stdio: 'pipe' })

  let work: string

  beforeEach(() => {
    const remote = path.join(root, 'remote.git')
    work = path.join(root, 'work')
    mkdirSync(work, { recursive: true })
    git(['init', '--bare', remote], root)
    git(['init'], work)
    git(['checkout', '-b', 'store'], work)
    git(['remote', 'add', 'origin', remote], work)
    process.env.NEUROCLAW_STORE_DIR = path.join(work, 'store')
    delete process.env.NEUROCLAW_STORE_NO_SYNC
  })

  function pushStore(): void {
    git(['add', 'store'], work)
    git(['commit', '-m', 'store'], work)
    git(['push', 'origin', 'store'], work)
  }

  it('accepts an item whose bytes match the remote and refuses ones that do not', async () => {
    publish('net-skills', 'pushed', [{ filename: 'skill.json', content: SKILL }])
    pushStore()
    publish('net-skills', 'local-only', [{ filename: 'skill.json', content: SKILL }])

    const cloud = await gitCloudSource()
    if ('unavailable' in cloud) throw new Error(cloud.unavailable)

    expect(cloud.check(readItem('net-skills', 'pushed')!)).toEqual({ ok: true })
    expect(cloud.check(readItem('net-skills', 'local-only')!).ok).toBe(false)

    writeFileSync(path.join(itemDir('net-skills', 'pushed'), 'skill.json'), '{"neurons":[]}')
    const edited = cloud.check(readItem('net-skills', 'pushed')!)
    expect(edited.ok).toBe(false)
    expect(edited.reason).toContain('differs')
  })

  it('offloads a pushed item end to end and leaves an unpushed one alone', async () => {
    publish('net-skills', 'pushed', [{ filename: 'skill.json', content: SKILL }])
    pushStore()
    publish('net-skills', 'local-only', [{ filename: 'skill.json', content: SKILL }])

    const report = await offloadIdle({ now: later, idleDays: 30 })

    expect(report.cloud.ok).toBe(true)
    expect(report.offloaded.map(o => o.name)).toEqual(['pushed'])
    expect(existsSync(path.join(itemDir('net-skills', 'pushed'), 'skill.json'))).toBe(false)
    expect(readFileSync(path.join(itemDir('net-skills', 'local-only'), 'skill.json'), 'utf8')).toBe(SKILL)
  })

  it('reports the cloud as unreachable rather than guessing', async () => {
    publish('net-skills', 'pushed', [{ filename: 'skill.json', content: SKILL }])
    pushStore()
    git(['remote', 'set-url', 'origin', path.join(root, 'does-not-exist.git')], work)

    const cloud = await gitCloudSource()

    expect('unavailable' in cloud).toBe(true)
  })
})
