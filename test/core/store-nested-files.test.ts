/**
 * A real skill is a folder, not a flat pile of files: the Anthropic skill
 * format is SKILL.md alongside `scripts/`, `references/`, `assets/` and
 * `agents/`. The store used to reject every path containing a separator,
 * which did not refuse such a skill -- it accepted the SKILL.md and silently
 * dropped the other seventeen files.
 *
 * These tests cover both halves: nesting genuinely works, and allowing it did
 * not open a way out of the item's own folder.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assertSafeFilename,
  publishItem,
  readItem,
  readItemFile,
  StoreError,
} from '../../models && skills/core/store.js'

describe('nested files in a published item', () => {
  let dir: string
  let prev: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'store-nested-'))
    prev = process.env.NEUROCLAW_STORE_DIR
    process.env.NEUROCLAW_STORE_DIR = dir
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.NEUROCLAW_STORE_DIR
    else process.env.NEUROCLAW_STORE_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  })

  it('publishes a skill with its folder structure intact', () => {
    const item = publishItem({
      kind: 'net-skills',
      name: 'folder-skill',
      title: 'A skill with subfolders',
      files: [
        { filename: 'SKILL.md', content: '# skill\n' },
        { filename: 'scripts/run_eval.py', content: 'print(1)\n' },
        { filename: 'scripts/__init__.py', content: '' },
        { filename: 'references/schemas.md', content: '# schemas\n' },
        { filename: 'agents/grader.md', content: '# grader\n' },
      ],
    })
    // All five, not just the top-level one.
    expect(item.files.map(f => f.filename).sort()).toEqual([
      'SKILL.md',
      'agents/grader.md',
      'references/schemas.md',
      'scripts/__init__.py',
      'scripts/run_eval.py',
    ])
  })

  it('reads a nested file back byte-for-byte', () => {
    publishItem({
      kind: 'net-skills',
      name: 'readable',
      files: [{ filename: 'scripts/utils.py', content: 'def f():\n    return 42\n' }],
    })
    expect(readItemFile('net-skills', 'readable', 'scripts/utils.py')?.toString('utf8'))
      .toBe('def f():\n    return 42\n')
  })

  it('lists nested files in the catalogue, so a folder skill is not reported as one file', () => {
    publishItem({
      kind: 'net-skills',
      name: 'deep',
      files: [
        { filename: 'SKILL.md', content: 'x' },
        { filename: 'a/b/c/deep.txt', content: 'y' },
      ],
    })
    const read = readItem('net-skills', 'deep')
    expect(read?.files.map(f => f.filename).sort()).toEqual(['SKILL.md', 'a/b/c/deep.txt'])
  })

  it('allows a leading underscore, because Python packages require __init__.py', () => {
    // The very first real skill published hit this: `__init__.py` was refused
    // and the whole publish failed.
    expect(() => assertSafeFilename('scripts/__init__.py')).not.toThrow()
  })

  it('still refuses a leading dot, so a publish can never add a .git to everyone\'s clone', () => {
    for (const bad of ['.git/config', '.env', 'scripts/.hidden']) {
      expect(() => assertSafeFilename(bad)).toThrow(StoreError)
    }
  })

  it('refuses every way out of the item folder', () => {
    for (const bad of [
      '../escape.md',
      'scripts/../../escape.md',
      '/etc/passwd',
      'scripts//run.py',
      '..',
      './x',
      'scripts\\windows.py',
      '',
    ]) {
      expect(() => assertSafeFilename(bad), `should refuse ${JSON.stringify(bad)}`).toThrow(StoreError)
    }
  })

  it('caps how deep an item may nest', () => {
    expect(() => assertSafeFilename('a/b/c/d/e.txt')).not.toThrow()
    expect(() => assertSafeFilename('a/b/c/d/e/f.txt')).toThrow(/nests deeper/)
  })

  it('a publish attempting to escape writes nothing outside its own folder', () => {
    expect(() =>
      publishItem({
        kind: 'net-skills',
        name: 'attacker',
        files: [{ filename: '../../../owned.txt', content: 'pwned' }],
      }),
    ).toThrow(StoreError)
    expect(existsSync(path.join(dir, '..', 'owned.txt'))).toBe(false)
    expect(existsSync(path.join(dir, 'owned.txt'))).toBe(false)
  })
})
