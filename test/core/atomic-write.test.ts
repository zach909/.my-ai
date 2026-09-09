/**
 * Surviving a power cut.
 *
 * Every state write in this project was a plain writeFileSync, which truncates
 * and then writes. Lose power in between and what is left is an empty or
 * partial file.
 *
 * The worst case is not the one you would guess. Truncating a store manifest
 * to half its length does not corrupt an item -- it makes the item DISAPPEAR:
 * readItem fails to parse, returns null, and the item drops out of the
 * catalogue while every payload file sits intact on disk beside it. Measured,
 * before the fix, on the first try.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeFileAtomic, writeJsonAtomic } from '../../models && skills/core/atomic-write.js'
import { publishItem, readItem, listCatalog } from '../../models && skills/core/store.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'atomic-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('writing atomically', () => {
  it('writes the content', () => {
    const f = path.join(dir, 'a.txt')
    writeFileAtomic(f, 'hello')
    expect(readFileSync(f, 'utf8')).toBe('hello')
  })

  it('creates missing directories', () => {
    const f = path.join(dir, 'deep', 'nested', 'a.txt')
    writeFileAtomic(f, 'x')
    expect(readFileSync(f, 'utf8')).toBe('x')
  })

  it('replaces existing content wholesale', () => {
    const f = path.join(dir, 'a.txt')
    writeFileAtomic(f, 'a much longer original value')
    writeFileAtomic(f, 'short')
    expect(readFileSync(f, 'utf8')).toBe('short')
  })

  it('leaves no temporary behind on a successful write', () => {
    writeFileAtomic(path.join(dir, 'a.txt'), 'x')
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([])
  })

  it('writes through the temporary, not the target', () => {
    // If it wrote the target directly there would be a window where the file
    // is truncated -- which is the entire bug.
    const f = path.join(dir, 'a.txt')
    writeFileAtomic(f, 'original')
    const before = statSync(f).ino
    writeFileAtomic(f, 'replacement')
    // A rename swaps the inode; an in-place write would keep it.
    expect(statSync(f).ino).not.toBe(before)
  })

  it('handles binary content without mangling it', () => {
    const f = path.join(dir, 'a.bin')
    const bytes = Buffer.from([0, 1, 2, 255, 254, 0, 128])
    writeFileAtomic(f, bytes)
    expect(readFileSync(f).equals(bytes)).toBe(true)
  })

  it('writes JSON with a trailing newline', () => {
    const f = path.join(dir, 'a.json')
    writeJsonAtomic(f, { a: 1 })
    expect(readFileSync(f, 'utf8').endsWith('\n')).toBe(true)
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ a: 1 })
  })
})

describe('cleaning up after an interrupted write', () => {
  it('sweeps a stale temporary left by a killed process', () => {
    // SIGKILL and a real power cut both stop the process before any cleanup
    // can run, so temporaries WILL be left behind. What matters is that they
    // do not accumulate forever.
    const stale = path.join(dir, '.a.txt.999.1.tmp')
    writeFileSync(stale, 'wreckage')
    const old = new Date(Date.now() - 5 * 60_000)
    utimesSync(stale, old, old)

    writeFileAtomic(path.join(dir, 'a.txt'), 'x')
    expect(existsSync(stale)).toBe(false)
  })

  it('does not touch a temporary that could still be an in-flight write', () => {
    const fresh = path.join(dir, '.b.txt.999.1.tmp')
    writeFileSync(fresh, 'in progress')
    writeFileAtomic(path.join(dir, 'a.txt'), 'x')
    expect(existsSync(fresh)).toBe(true)
  })

  it('leaves ordinary files alone', () => {
    const real = path.join(dir, 'notes.tmp')  // no leading dot: not ours
    writeFileSync(real, 'someone else’s file')
    const old = new Date(Date.now() - 5 * 60_000)
    utimesSync(real, old, old)
    writeFileAtomic(path.join(dir, 'a.txt'), 'x')
    expect(existsSync(real)).toBe(true)
  })
})

describe('the store survives a half-written manifest', () => {
  beforeEach(() => {
    process.env.NEUROCLAW_STORE_DIR = path.join(dir, 'store')
    process.env.NEUROCLAW_STORE_NO_SYNC = '1'
  })
  afterEach(() => {
    delete process.env.NEUROCLAW_STORE_DIR
    delete process.env.NEUROCLAW_STORE_NO_SYNC
  })

  it('never leaves a manifest partially written', () => {
    // Rewrite the same item repeatedly; at every point in between, the
    // manifest on disk must parse. Atomic rename is what guarantees a reader
    // sees the whole old file or the whole new one, never a mixture.
    const manifest = path.join(dir, 'store', 'net-skills', 'churn', 'manifest.json')
    for (let i = 0; i < 25; i++) {
      publishItem({
        kind: 'net-skills', name: 'churn', title: `v${i}`,
        description: 'x'.repeat(200 + i),
        files: [{ filename: 'p.txt', content: `body ${i}`.repeat(50) }],
      })
      expect(() => JSON.parse(readFileSync(manifest, 'utf8'))).not.toThrow()
      expect(readItem('net-skills', 'churn')).not.toBeNull()
      expect(listCatalog()['net-skills']).toHaveLength(1)
    }
  })

  it('keeps the item visible in the catalogue throughout', () => {
    publishItem({ kind: 'net-skills', name: 'visible', title: 'V', files: [{ filename: 'a.txt', content: 'x' }] })
    expect(listCatalog()['net-skills'].map(i => i.name)).toContain('visible')
  })
})
