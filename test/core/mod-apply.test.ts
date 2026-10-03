/**
 * Applying mods: the one store kind that writes onto this device's real
 * working copy instead of an isolated installed/ folder.
 *
 * The distinctions worth testing hardest: applying actually rewrites the
 * target file (not a copy elsewhere), it never happens as a side effect of
 * publishing, and reverting restores exactly what was there before -- even
 * across a re-apply of an updated mod, and even when it has to refuse
 * because something else touched the file since.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { publishItem, readItem } from '../../models && skills/core/store.js'
import {
  applyMod,
  revertMod,
  isApplied,
  readApplied,
  listAppliedMods,
  outdatedAppliedMods,
  modsTargetRoot,
  ModApplyError,
} from '../../models && skills/core/mod-apply.js'

let root: string
let target: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'corona-mod-store-'))
  target = mkdtempSync(path.join(tmpdir(), 'corona-mod-target-'))
  process.env.NEUROCLAW_STORE_DIR = path.join(root, 'store')
  process.env.CORONA_MODS_TARGET_DIR = target
  process.env.CORONA_MODS_BACKUP_DIR = path.join(root, 'mods-backup')
  process.env.NEUROCLAW_STORE_NO_SYNC = '1'
})

afterEach(() => {
  delete process.env.NEUROCLAW_STORE_DIR
  delete process.env.CORONA_MODS_TARGET_DIR
  delete process.env.CORONA_MODS_BACKUP_DIR
  delete process.env.NEUROCLAW_STORE_NO_SYNC
  rmSync(root, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
})

function publish(name: string, files: Array<{ filename: string; content: string }>, title = 'A mod') {
  return publishItem({ kind: 'mods', name, title, description: 'test mod', author: 'tester', files })
}

describe('applying', () => {
  it('writes the mod straight onto the target path, not into an isolated folder', async () => {
    publish('greeting', [{ filename: 'src/greeting.ts', content: 'export const hi = 1' }])
    const { record, created } = await applyMod('greeting')

    const onDisk = path.join(modsTargetRoot(), 'src/greeting.ts')
    expect(existsSync(onDisk)).toBe(true)
    expect(readFileSync(onDisk, 'utf8')).toBe('export const hi = 1')
    expect(created).toEqual(['src/greeting.ts'])
    expect(record.files[0].originalSha256).toBeNull()
  })

  it('backs up an existing file rather than clobbering it with no memory of the original', async () => {
    mkdirSync(path.join(target, 'src'), { recursive: true })
    writeFileSync(path.join(target, 'src/config.ts'), 'export const x = 1')
    publish('config-mod', [{ filename: 'src/config.ts', content: 'export const x = 2' }])

    const { changed, record } = await applyMod('config-mod')
    expect(changed).toEqual(['src/config.ts'])
    expect(readFileSync(path.join(target, 'src/config.ts'), 'utf8')).toBe('export const x = 2')
    expect(record.files[0].originalSha256).not.toBeNull()
  })

  it('reports a file already matching the mod as unchanged, and writes nothing', async () => {
    mkdirSync(path.join(target, 'src'), { recursive: true })
    writeFileSync(path.join(target, 'src/same.ts'), 'same content')
    publish('no-op', [{ filename: 'src/same.ts', content: 'same content' }])

    const { changed, created, unchanged } = await applyMod('no-op')
    expect(unchanged).toEqual(['src/same.ts'])
    expect(changed).toEqual([])
    expect(created).toEqual([])
  })

  it('installs every file, including nested ones', async () => {
    publish('multi', [
      { filename: 'main.py', content: 'print(1)' },
      { filename: 'lib/helper.py', content: 'x = 2' },
    ])
    const { record } = await applyMod('multi')
    expect(record.files.map(f => f.filename).sort()).toEqual(['lib/helper.py', 'main.py'])
    expect(readFileSync(path.join(target, 'lib/helper.py'), 'utf8')).toBe('x = 2')
  })

  it('refuses a mod that was never published, rather than creating an empty record', async () => {
    await expect(applyMod('imaginary')).rejects.toThrow(ModApplyError)
    expect(isApplied('imaginary')).toBe(false)
  })

  it('does not apply anything as a side effect of publishing', () => {
    publish('published-only', [{ filename: 'a.txt', content: 'hi' }])
    expect(isApplied('published-only')).toBe(false)
    expect(existsSync(path.join(target, 'a.txt'))).toBe(false)
  })
})

describe('re-applying an updated mod', () => {
  it('keeps the true original across a second apply, not the mod’s own prior content', async () => {
    mkdirSync(path.join(target, 'src'), { recursive: true })
    writeFileSync(path.join(target, 'src/a.ts'), 'ORIGINAL')
    publish('evolves', [{ filename: 'src/a.ts', content: 'v1' }])
    await applyMod('evolves')

    publish('evolves', [{ filename: 'src/a.ts', content: 'v2' }])
    const { record, changed } = await applyMod('evolves')
    expect(changed).toEqual(['src/a.ts'])
    expect(readFileSync(path.join(target, 'src/a.ts'), 'utf8')).toBe('v2')
    // The bug this pins: recapturing "what's on disk now" on a second apply
    // would record v1 (the mod's own prior write) as the original, losing
    // ORIGINAL forever.
    const original = record.files.find(f => f.filename === 'src/a.ts')!
    expect(original.originalSha256).not.toBeNull()

    const revert = revertMod('evolves')
    expect(revert.restored).toEqual(['src/a.ts'])
    expect(readFileSync(path.join(target, 'src/a.ts'), 'utf8')).toBe('ORIGINAL')
  })
})

describe('reverting', () => {
  it('restores the original content of a file that existed before', async () => {
    mkdirSync(path.join(target, 'src'), { recursive: true })
    writeFileSync(path.join(target, 'src/b.ts'), 'before')
    publish('restorable', [{ filename: 'src/b.ts', content: 'after' }])
    await applyMod('restorable')

    const { restored } = revertMod('restorable')
    expect(restored).toEqual(['src/b.ts'])
    expect(readFileSync(path.join(target, 'src/b.ts'), 'utf8')).toBe('before')
    expect(isApplied('restorable')).toBe(false)
  })

  it('removes a file the mod created, since nothing was there before', async () => {
    publish('creates-file', [{ filename: 'new-file.ts', content: 'new' }])
    await applyMod('creates-file')
    expect(existsSync(path.join(target, 'new-file.ts'))).toBe(true)

    const { removed } = revertMod('creates-file')
    expect(removed).toEqual(['new-file.ts'])
    expect(existsSync(path.join(target, 'new-file.ts'))).toBe(false)
  })

  it('leaves a file alone when something else changed it since the mod was applied', async () => {
    mkdirSync(path.join(target, 'src'), { recursive: true })
    writeFileSync(path.join(target, 'src/c.ts'), 'before')
    publish('touched-after', [{ filename: 'src/c.ts', content: 'after' }])
    await applyMod('touched-after')

    // Someone (or something) edits the file after the mod applied.
    writeFileSync(path.join(target, 'src/c.ts'), 'edited by hand')

    const { restored, skipped } = revertMod('touched-after')
    expect(restored).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(skipped[0].filename).toBe('src/c.ts')
    expect(readFileSync(path.join(target, 'src/c.ts'), 'utf8')).toBe('edited by hand')
    // Not cleared, since a file was skipped -- the backup must still be
    // recoverable rather than thrown away.
    expect(isApplied('touched-after')).toBe(true)
  })

  it('refuses to revert a mod that was never applied', () => {
    publish('never-applied', [{ filename: 'a.txt', content: 'hi' }])
    expect(() => revertMod('never-applied')).toThrow(ModApplyError)
  })
})

describe('knowing what has moved on', () => {
  it('notices when the published mod changed after applying', async () => {
    publish('drifts', [{ filename: 'a.txt', content: 'v1' }])
    await applyMod('drifts')
    expect(outdatedAppliedMods()).toEqual([])

    publish('drifts', [{ filename: 'a.txt', content: 'v2' }])
    const outdated = outdatedAppliedMods()
    expect(outdated).toHaveLength(1)
    expect(outdated[0].record.name).toBe('drifts')
  })
})

describe('reading back what is applied', () => {
  it('lists applied mods, most recent first', async () => {
    publish('one', [{ filename: 'a.txt', content: '1' }])
    publish('two', [{ filename: 'b.txt', content: '2' }])
    await applyMod('one')
    await new Promise(r => setTimeout(r, 5))
    await applyMod('two')
    expect(listAppliedMods().map(r => r.name)).toEqual(['two', 'one'])
  })

  it('records where it came from, so an apply is inspectable later', async () => {
    publish('traced', [{ filename: 'a.txt', content: 'hi' }], 'Traced mod')
    await applyMod('traced')
    const record = readApplied('traced')!
    expect(record.title).toBe('Traced mod')
    expect(record.author).toBe('tester')
    expect(record.appliedVersion).toBe(readItem('mods', 'traced')!.updatedAt)
  })

  it('reports a record it cannot parse as not applied', async () => {
    publish('corrupt', [{ filename: 'a.txt', content: 'hi' }])
    await applyMod('corrupt')
    writeFileSync(path.join(root, 'mods-backup', 'corrupt', 'applied.json'), '{ not json')
    expect(isApplied('corrupt')).toBe(false)
  })
})

describe('containment', () => {
  it('refuses every shape of traversal', async () => {
    for (const name of ['../../etc', '..', '/etc']) {
      await expect(applyMod(name)).rejects.toThrow()
    }
  })

  // Store filenames already refuse a leading dot on any path segment
  // (assertSafeFilename in store.ts), which means a mod can never even be
  // PUBLISHED targeting .git/, .github/, .claude/ or a dotfile -- so this
  // pins that the protection really does reach all the way through to
  // apply, not just to publish.
  it('cannot publish a mod that targets a dotfile in the first place', () => {
    expect(() => publish('dotfile-attempt', [{ filename: '.env', content: 'SECRET=1' }])).toThrow()
    expect(() => publish('dotfile-attempt-2', [{ filename: '.git/config', content: 'x' }])).toThrow()
  })
})
