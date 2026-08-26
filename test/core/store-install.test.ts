/**
 * Installing store items onto this device.
 *
 * The distinction worth testing hardest is the one the whole design rests on:
 * publishing is shared and installing is not. An install must put real files
 * on this machine, must not happen as a side effect of anything else, and
 * uninstalling must leave the published item untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { publishItem, readItem } from '../../models && skills/core/store.js'
import {
  installItem,
  uninstallItem,
  isInstalled,
  readInstalled,
  listInstalledItems,
  outdatedInstalls,
  updateInstalls,
  readInstalledFile,
  changedFiles,
  installedRoot,
  planActivation,
  StoreInstallError,
} from '../../models && skills/core/store-install.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'corona-install-'))
  process.env.NEUROCLAW_STORE_DIR = path.join(root, 'store')
  process.env.CORONA_INSTALLED_DIR = path.join(root, 'installed')
  // Publishing must never try to reach GitHub from a test.
  process.env.NEUROCLAW_STORE_NO_SYNC = '1'
})

afterEach(() => {
  delete process.env.NEUROCLAW_STORE_DIR
  delete process.env.CORONA_INSTALLED_DIR
  delete process.env.NEUROCLAW_STORE_NO_SYNC
  rmSync(root, { recursive: true, force: true })
})

function publish(name: string, files: Array<{ filename: string; content: string }>, title = 'A thing') {
  return publishItem({ kind: 'skills', name, title, description: 'test item', author: 'tester', files })
}

describe('installing', () => {
  it('puts the real files on this device, not just a flag', async () => {
    publish('greeter', [{ filename: 'skill.json', content: '{"neurons":[]}' }])
    const { record } = await installItem('skills', 'greeter')

    const onDisk = path.join(installedRoot(), 'skills', 'greeter', 'skill.json')
    expect(existsSync(onDisk)).toBe(true)
    expect(readFileSync(onDisk, 'utf8')).toBe('{"neurons":[]}')
    expect(record.files[0].sha256).toHaveLength(64)
  })

  it('installs every file, including nested ones', async () => {
    publish('multi', [
      { filename: 'main.py', content: 'print(1)' },
      { filename: 'lib/helper.py', content: 'x = 2' },
    ])
    const { record } = await installItem('skills', 'multi')
    expect(record.files.map(f => f.filename).sort()).toEqual(['lib/helper.py', 'main.py'])
    expect(readInstalledFile('skills', 'multi', 'lib/helper.py')?.toString()).toBe('x = 2')
  })

  it('records where it came from, so an install is inspectable later', async () => {
    publish('traced', [{ filename: 'a.txt', content: 'hi' }], 'Traced thing')
    await installItem('skills', 'traced')
    const record = readInstalled('skills', 'traced')!
    expect(record.title).toBe('Traced thing')
    expect(record.author).toBe('tester')
    expect(record.installedVersion).toBe(readItem('skills', 'traced')!.updatedAt)
  })

  it('refuses an item that was never published, rather than creating an empty one', async () => {
    await expect(installItem('skills', 'imaginary')).rejects.toThrow(StoreInstallError)
    expect(existsSync(path.join(installedRoot(), 'skills', 'imaginary'))).toBe(false)
  })

  it('does not install anything as a side effect of publishing', () => {
    publish('published-only', [{ filename: 'a.txt', content: 'hi' }])
    expect(isInstalled('skills', 'published-only')).toBe(false)
    expect(listInstalledItems()).toEqual([])
  })
})

describe('uninstalling', () => {
  it('removes this device’s copy and leaves the published item alone', async () => {
    publish('temp', [{ filename: 'a.txt', content: 'hi' }])
    await installItem('skills', 'temp')
    expect(uninstallItem('skills', 'temp')).toBe(true)
    expect(isInstalled('skills', 'temp')).toBe(false)
    // The published item is untouched — uninstalling destroys nobody else's work.
    expect(readItem('skills', 'temp')).not.toBeNull()
  })

  it('says so rather than throwing when it was not installed', () => {
    publish('never', [{ filename: 'a.txt', content: 'hi' }])
    expect(uninstallItem('skills', 'never')).toBe(false)
  })
})

describe('knowing what has moved on', () => {
  it('notices when the published version changed after installing', async () => {
    publish('drifts', [{ filename: 'a.txt', content: 'v1' }])
    await installItem('skills', 'drifts')
    expect(outdatedInstalls()).toEqual([])

    publish('drifts', [{ filename: 'a.txt', content: 'v2' }])
    const outdated = outdatedInstalls()
    expect(outdated).toHaveLength(1)
    expect(outdated[0].record.name).toBe('drifts')
  })

  it('updating actually rewrites the installed file', async () => {
    publish('drifts', [{ filename: 'a.txt', content: 'v1' }])
    await installItem('skills', 'drifts')
    publish('drifts', [{ filename: 'a.txt', content: 'v2' }])

    const { updated, failed } = await updateInstalls()
    expect(failed).toEqual([])
    expect(updated.map(r => r.name)).toEqual(['drifts'])
    expect(readInstalledFile('skills', 'drifts', 'a.txt')?.toString()).toBe('v2')
  })

  it('notices an edit made in the same millisecond, which a timestamp comparison misses', async () => {
    // The bug this pins: updatedAt has millisecond resolution, so two
    // publishes that fast carry the same stamp. Comparing digests is what
    // makes the answer independent of how quick the machine is.
    publish('fast', [{ filename: 'a.txt', content: 'v1' }])
    await installItem('skills', 'fast')
    const before = readItem('skills', 'fast')!.updatedAt
    publish('fast', [{ filename: 'a.txt', content: 'v2' }])
    const after = readItem('skills', 'fast')!.updatedAt
    if (before === after) {
      // Only meaningful when the two publishes really did land in the same
      // millisecond; otherwise this is just the ordinary case again.
      expect(outdatedInstalls().map(o => o.record.name)).toEqual(['fast'])
    }
    expect(outdatedInstalls()[0]?.changed).toEqual(['a.txt'])
  })

  it('counts a file the published item no longer has as a change', async () => {
    publish('shrinks', [{ filename: 'a.txt', content: '1' }, { filename: 'b.txt', content: '2' }])
    await installItem('skills', 'shrinks')
    // Republishing cannot drop a file (publishes merge), so the install is
    // compared against an item that legitimately never had b.txt.
    const record = readInstalled('skills', 'shrinks')!
    const published = readItem('skills', 'shrinks')!
    expect(changedFiles({ ...record, files: [...record.files, { filename: 'gone.txt', bytes: 1, sha256: 'x' }] }, published))
      .toContain('gone.txt')
  })

  it('leaves an up-to-date install alone', async () => {
    publish('stable', [{ filename: 'a.txt', content: 'v1' }])
    await installItem('skills', 'stable')
    expect((await updateInstalls()).updated).toEqual([])
  })
})

describe('reading back what is installed', () => {
  it('lists installs newest first', async () => {
    publish('one', [{ filename: 'a.txt', content: '1' }])
    publish('two', [{ filename: 'a.txt', content: '2' }])
    await installItem('skills', 'one')
    await new Promise(r => setTimeout(r, 5))
    await installItem('skills', 'two')
    expect(listInstalledItems().map(r => r.name)).toEqual(['two', 'one'])
  })

  it('reports a record it cannot parse as not installed, rather than as a broken install', async () => {
    publish('corrupt', [{ filename: 'a.txt', content: 'hi' }])
    await installItem('skills', 'corrupt')
    writeFileSync(path.join(installedRoot(), 'skills', 'corrupt', 'installed.json'), '{ not json')
    expect(isInstalled('skills', 'corrupt')).toBe(false)
    expect(listInstalledItems()).toEqual([])
  })

  it('refuses a name that resolves to the installed root itself', async () => {
    // The bug: uninstallItem did no validation, so ("skills", "..") resolved
    // to the installed ROOT, passed a containment check that permitted
    // dir === root, and rm -rf'd every installed item on the machine. It was
    // reachable from the uninstall route and from "store uninstall skills .."
    // in chat, whose name pattern allows dots.
    publish('survivor', [{ filename: 'a.txt', content: 'keep me' }])
    await installItem('skills', 'survivor')

    expect(() => uninstallItem('skills', '..')).toThrow()
    expect(isInstalled('skills', 'survivor')).toBe(true)
    expect(existsSync(installedRoot())).toBe(true)
  })

  it('refuses every shape of traversal on both install and uninstall', async () => {
    const probes: Array<[string, string]> = [
      ['../../etc', 'passwd'],
      ['skills', '../../../etc'],
      ['skills', '..'],
      ['skills', 'a/../../b'],
      ['/etc', 'passwd'],
      ['skills', '.git'],
    ]
    for (const [kind, name] of probes) {
      await expect(installItem(kind, name)).rejects.toThrow()
      expect(() => uninstallItem(kind, name)).toThrow()
    }
  })

  it('refuses to read a file outside the item’s own directory', async () => {
    publish('confined', [{ filename: 'a.txt', content: 'hi' }])
    await installItem('skills', 'confined')
    mkdirSync(path.join(installedRoot(), 'skills'), { recursive: true })
    writeFileSync(path.join(installedRoot(), 'skills', 'secret.txt'), 'not yours')
    expect(readInstalledFile('skills', 'confined', '../secret.txt')).toBeNull()
  })
})

describe('an installed item is actually loadable', () => {
  it('turns neuron definitions and scripts into memories the system can hold', async () => {
    publish('greeter', [
      {
        filename: 'greeter.skill.json',
        content: JSON.stringify({
          neurons: [
            { name: 'greeting', definition: 'how to greet someone warmly', scripts: [{ userSays: 'say hello', response: 'Hello there.' }] },
          ],
        }),
      },
    ])
    await installItem('skills', 'greeter')

    const plan = planActivation('skills', 'greeter')
    expect(plan.from).toEqual(['greeter.skill.json'])
    expect(plan.memories).toHaveLength(2)
    expect(plan.memories[0].content).toBe('greeting: how to greet someone warmly')
    // The script pair keeps trigger and response separate, which is what lets
    // the skill-mesh fast path answer with the response rather than the trigger.
    expect(plan.memories[1]).toMatchObject({ content: 'say hello', payload: 'Hello there.' })
    expect(plan.memories[1].tags).toContain('skill-script')
  })

  it('reads .source.json and skill.json too, not just .skill.json', async () => {
    for (const filename of ['thing.source.json', 'skill.json', 'thing.ext.json']) {
      const name = `carrier-${filename.replace(/\W/g, '')}`
      publish(name, [{ filename, content: JSON.stringify({ neurons: [{ name: 'n', definition: 'd' }] }) }])
      await installItem('skills', name)
      expect(planActivation('skills', name).memories, filename).toHaveLength(1)
    }
  })

  it('says plainly when an item carries nothing loadable, rather than implying it activated', async () => {
    // A Python bridge and a README is a perfectly good store item. It just is
    // not something this system can load into memory.
    publish('bridge', [
      { filename: 'SKILL.md', content: '# How to use this' },
      { filename: 'bridge.py', content: 'print("hi")' },
    ])
    await installItem('skills', 'bridge')
    const plan = planActivation('skills', 'bridge')
    expect(plan.memories).toEqual([])
    expect(plan.nothingLoadable).toMatch(/nothing this system knows how to load/)
  })

  it('lets one malformed file through without losing the rest of the item', async () => {
    publish('mixed', [
      { filename: 'broken.skill.json', content: '{ not json at all' },
      { filename: 'good.skill.json', content: JSON.stringify({ neurons: [{ name: 'n', definition: 'works' }] }) },
    ])
    await installItem('skills', 'mixed')
    const plan = planActivation('skills', 'mixed')
    expect(plan.from).toEqual(['good.skill.json'])
    expect(plan.memories).toHaveLength(1)
  })

  it('reports an item that was never installed as not installed', () => {
    expect(planActivation('skills', 'never-installed').nothingLoadable).toMatch(/is not installed/)
  })

  it('does not activate anything merely by publishing', async () => {
    publish('published-only-2', [
      { filename: 'x.skill.json', content: JSON.stringify({ neurons: [{ name: 'n', definition: 'd' }] }) },
    ])
    // Publishing shares; installing is the deliberate act. Nothing loads until
    // someone asks for it.
    expect(planActivation('skills', 'published-only-2').nothingLoadable).toMatch(/is not installed/)
  })
})
