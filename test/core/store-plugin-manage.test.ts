/**
 * The store plug-in as something you can actually manage the store WITH:
 * change, edit, upload and install.
 *
 * These go through the plug-in's own methods and its message surface, because
 * that is the part that was missing — the underlying store functions were
 * already real and already tested, and reachable only from the web UI.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { StorePlugin } from '../../plugins/store.js'
import { publishItem, readItem, readItemFile } from '../../models && skills/core/store.js'
import { isInstalled } from '../../models && skills/core/store-install.js'

let root: string
let plugin: StorePlugin

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'corona-store-plugin-'))
  process.env.NEUROCLAW_STORE_DIR = path.join(root, 'store')
  process.env.CORONA_INSTALLED_DIR = path.join(root, 'installed')
  process.env.NEUROCLAW_STORE_NO_SYNC = '1'
  plugin = new StorePlugin({
    id: 'store',
    name: 'Store',
    type: 'api-connection',
    capabilities: ['store'],
  } as never)
})

afterEach(() => {
  delete process.env.NEUROCLAW_STORE_DIR
  delete process.env.CORONA_INSTALLED_DIR
  delete process.env.NEUROCLAW_STORE_NO_SYNC
  rmSync(root, { recursive: true, force: true })
})

function seed(name = 'demo') {
  return publishItem({
    kind: 'skills',
    name,
    title: 'Demo',
    description: 'first draft',
    author: 'tester',
    files: [{ filename: 'main.py', content: 'print("v1")' }],
  })
}

describe('uploading', () => {
  it('publishes a new item through the plug-in', async () => {
    const { item } = await plugin.publish({
      kind: 'skills',
      name: 'fresh',
      title: 'Fresh',
      files: [{ filename: 'a.txt', content: 'hello' }],
    })
    expect(item.name).toBe('fresh')
    expect(readItemFile('skills', 'fresh', 'a.txt')?.toString()).toBe('hello')
  })

  it('adds a file to an existing item without dropping the others', async () => {
    seed()
    await plugin.addFile('skills', 'demo', 'extra.txt', 'more')
    const item = readItem('skills', 'demo')!
    expect(item.files.map(f => f.filename).sort()).toEqual(['extra.txt', 'main.py'])
    expect(readItemFile('skills', 'demo', 'main.py')?.toString()).toBe('print("v1")')
  })
})

describe('changing and editing', () => {
  it('replaces a file’s contents', async () => {
    seed()
    await plugin.editFile('skills', 'demo', 'main.py', 'print("v2")')
    expect(readItemFile('skills', 'demo', 'main.py')?.toString()).toBe('print("v2")')
  })

  it('refuses to edit something that does not exist, rather than creating it under a typo', async () => {
    seed()
    await expect(plugin.editFile('skills', 'dmeo', 'main.py', 'x')).rejects.toThrow(/Publish it first/)
    expect(readItem('skills', 'dmeo')).toBeNull()
  })

  it('changes the description without touching the files', async () => {
    seed()
    await plugin.describe('skills', 'demo', { description: 'second draft' })
    const item = readItem('skills', 'demo')!
    expect(item.description).toBe('second draft')
    expect(item.title).toBe('Demo')
    expect(readItemFile('skills', 'demo', 'main.py')?.toString()).toBe('print("v1")')
  })

  it('refuses to describe something that was never published', async () => {
    await expect(plugin.describe('skills', 'ghost', { description: 'x' })).rejects.toThrow(/No "ghost"/)
  })
})

describe('installing', () => {
  it('installs and uninstalls through the plug-in', async () => {
    seed()
    const result = await plugin.install('skills', 'demo')
    expect(result.record.files).toHaveLength(1)
    expect(isInstalled('skills', 'demo')).toBe(true)
    expect(plugin.installed().map(r => r.name)).toEqual(['demo'])

    expect(plugin.uninstall('skills', 'demo')).toBe(true)
    expect(plugin.installed()).toEqual([])
  })

  it('reports what changed since installing', async () => {
    seed()
    await plugin.install('skills', 'demo')
    expect(plugin.outdated()).toEqual([])
    await plugin.editFile('skills', 'demo', 'main.py', 'print("v3")')
    expect(plugin.outdated().map(o => o.record.name)).toEqual(['demo'])
    const { updated } = await plugin.update()
    expect(updated.map(r => r.name)).toEqual(['demo'])
    expect(plugin.outdated()).toEqual([])
  })
})

describe('the commands you would actually type', () => {
  const say = async (text: string) => ((await plugin.onMessage(text)) as { result: string } | null)?.result ?? null

  it('installs from one sentence naming the item', async () => {
    seed()
    expect(await say('store install skills demo')).toMatch(/Installed skills\/demo/)
    expect(isInstalled('skills', 'demo')).toBe(true)
  })

  it('says an item is not installed, and how to install it', async () => {
    seed()
    const shown = await say('store show skills demo')
    expect(shown).toMatch(/not installed/)
    expect(shown).toMatch(/store install skills demo/)
  })

  it('says an item IS installed once it is', async () => {
    seed()
    await plugin.install('skills', 'demo')
    expect(await say('store show skills demo')).toMatch(/installed on this device/)
  })

  it('uninstalls, and says the published copy survives', async () => {
    seed()
    await plugin.install('skills', 'demo')
    expect(await say('store uninstall skills demo')).toMatch(/still published for everyone else/)
    expect(readItem('skills', 'demo')).not.toBeNull()
  })

  it('lists what is installed', async () => {
    seed()
    expect(await say('store installed')).toMatch(/Nothing from the store is installed/)
    await plugin.install('skills', 'demo')
    expect(await say('store installed')).toMatch(/skills\/demo/)
  })

  it('reports updates rather than applying them when only asked what is outdated', async () => {
    seed()
    await plugin.install('skills', 'demo')
    await plugin.editFile('skills', 'demo', 'main.py', 'print("v4")')
    expect(await say('store outdated')).toMatch(/skills\/demo/)
    // Asking what changed must not change anything.
    expect(plugin.outdated()).toHaveLength(1)
  })

  it('reads a file back', async () => {
    seed()
    expect(await say('store read skills demo main.py')).toBe('print("v1")')
  })

  it('refuses an install it cannot do, in words rather than by throwing', async () => {
    expect(await say('store install skills imaginary')).toMatch(/no published/i)
  })

  it('stays out of the way of anything that is not a store command', async () => {
    for (const text of ['what is the capital of France', 'install my dishwasher', '']) {
      expect(await plugin.onMessage(text)).toBeNull()
    }
  })
})
