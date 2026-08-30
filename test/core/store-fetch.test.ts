/**
 * "See everything, download only what you click."
 *
 * The catalogue travels as an index -- names, descriptions, file lists, sizes
 * and checksums -- so a device can show the whole store while holding none of
 * it. These tests cover the two halves that makes true: the catalogue works
 * with zero payload bytes present, and a fetch verifies what it downloaded
 * against what was published.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { publishItem, readItem, listCatalog } from '../../models && skills/core/store.js'
import { parseGitHubRemote } from '../../models && skills/core/store-fetch.js'

describe('the catalogue without the payloads', () => {
  let dir: string
  let prev: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'store-index-'))
    prev = process.env.NEUROCLAW_STORE_DIR
    process.env.NEUROCLAW_STORE_DIR = dir
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.NEUROCLAW_STORE_DIR
    else process.env.NEUROCLAW_STORE_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  })

  /** Deletes an item's payload files, leaving the manifest -- a lean device. */
  const stripPayloads = (kind: string, name: string) => {
    const itemDir = path.join(dir, kind, name)
    for (const f of readItem(kind, name)!.files) {
      rmSync(path.join(itemDir, f.filename), { force: true })
    }
  }

  it('records every file in the manifest at publish time', () => {
    publishItem({
      kind: 'skills',
      name: 'indexed',
      files: [
        { filename: 'SKILL.md', content: '# hi\n' },
        { filename: 'scripts/run.py', content: 'print(1)\n' },
      ],
    })
    const manifest = JSON.parse(readFileSync(path.join(dir, 'skills', 'indexed', 'manifest.json'), 'utf8'))
    expect(manifest.files.map((f: { filename: string }) => f.filename).sort()).toEqual([
      'SKILL.md',
      'scripts/run.py',
    ])
    // Sizes and checksums are in the index too, so a device that has never
    // downloaded the item can still show and verify it.
    expect(manifest.files.every((f: { bytes: number; sha256: string }) => f.bytes > 0 && f.sha256.length === 64)).toBe(true)
  })

  it('lists an item in full when not one payload byte is present', () => {
    publishItem({
      kind: 'skills',
      name: 'remote-only',
      title: 'Visible without being downloaded',
      files: [
        { filename: 'SKILL.md', content: '# big\n' },
        { filename: 'scripts/a.py', content: 'a\n' },
        { filename: 'scripts/b.py', content: 'b\n' },
      ],
    })
    stripPayloads('skills', 'remote-only')

    const item = readItem('skills', 'remote-only')!
    expect(item.title).toBe('Visible without being downloaded')
    expect(item.files).toHaveLength(3)
    expect(item.totalBytes).toBeGreaterThan(0)
    // Everything listed, nothing here.
    expect(item.files.every(f => f.local === false)).toBe(true)
    expect(listCatalog().skills.map(i => i.name)).toContain('remote-only')
  })

  it('marks exactly the files that are on this device', () => {
    publishItem({
      kind: 'skills',
      name: 'partial',
      files: [
        { filename: 'here.txt', content: 'x' },
        { filename: 'not-here.txt', content: 'y' },
      ],
    })
    rmSync(path.join(dir, 'skills', 'partial', 'not-here.txt'))

    const files = readItem('skills', 'partial')!.files
    expect(files.find(f => f.filename === 'here.txt')?.local).toBe(true)
    expect(files.find(f => f.filename === 'not-here.txt')?.local).toBe(false)
    // The absent one is still fully described -- that is what makes it
    // clickable rather than invisible.
    expect(files.find(f => f.filename === 'not-here.txt')?.sha256).toHaveLength(64)
  })

  it('keeps the entries for files an update did not touch', () => {
    publishItem({ kind: 'skills', name: 'grow', files: [{ filename: 'one.txt', content: '1' }] })
    publishItem({ kind: 'skills', name: 'grow', files: [{ filename: 'two.txt', content: '2' }] })
    expect(readItem('skills', 'grow')!.files.map(f => f.filename).sort()).toEqual(['one.txt', 'two.txt'])
  })

  it('still reads an item published before the index existed', () => {
    // A manifest with no `files` key, plus files on disk: the old shape.
    const legacy = path.join(dir, 'skills', 'legacy')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(
      path.join(legacy, 'manifest.json'),
      JSON.stringify({ kind: 'skills', name: 'legacy', title: 'Old', author: 'x' }),
    )
    writeFileSync(path.join(legacy, 'SKILL.md'), '# old\n')

    const item = readItem('skills', 'legacy')!
    expect(item.files.map(f => f.filename)).toEqual(['SKILL.md'])
    // Scanned from disk, so of course it is local -- which is exactly the
    // limitation the index removes.
    expect(item.files[0].local).toBe(true)
  })

  it("does not bake one device's answer into the shared manifest", () => {
    publishItem({ kind: 'skills', name: 'shared', files: [{ filename: 'f.txt', content: 'z' }] })
    const manifest = JSON.parse(readFileSync(path.join(dir, 'skills', 'shared', 'manifest.json'), 'utf8'))
    // Whether a file is present is a fact about a device, not about the
    // published item; every other clone would read the wrong answer.
    expect(manifest.files[0]).not.toHaveProperty('local')
  })
})

describe('working out where to download from', () => {
  it('understands both URL shapes git clones with', () => {
    for (const remote of [
      'https://github.com/zach909/.my-ai',
      'https://github.com/zach909/.my-ai.git',
      'git@github.com:zach909/.my-ai.git',
      'ssh://git@github.com/zach909/.my-ai',
    ]) {
      expect(parseGitHubRemote(remote), remote).toEqual({ owner: 'zach909', repo: '.my-ai' })
    }
  })

  it('returns null for a remote it cannot serve downloads from', () => {
    for (const remote of ['https://gitlab.com/a/b', 'not a url', '']) {
      expect(parseGitHubRemote(remote)).toBeNull()
    }
  })
})
