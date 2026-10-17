/**
 * Chats can leave in a zip and come back, and the zip is treated as hostile.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ChatHistoryStore } from '../../models && skills/core/chat-history-store.js'
import { exportChats, importChats } from '../../models && skills/core/chat-archive.js'
import { readZip, writeZip, crc32, ZipError } from '../../models && skills/core/zip-archive.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'corona-chats-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const store = (name: string) => new ChatHistoryStore(path.join(dir, name))
const say = (s: ChatHistoryStore, text: string, id?: string) => {
  const t = s.appendMessage({ role: 'user', content: text, timestamp: 1 }, 'chat', id)
  s.appendMessage({ role: 'assistant', content: 'reply to ' + text, timestamp: 2 }, 'chat', t.id)
  return t.id
}

describe('the zip format', () => {
  it('round-trips text, empty files and files that do not compress, with unicode names', () => {
    const entries = [
      { name: 'a.txt', data: Buffer.from('hello '.repeat(1000)) },
      { name: 'empty.txt', data: Buffer.alloc(0) },
      { name: 'ünï/çode ✓.bin', data: Buffer.from([1, 2, 3, 250, 251]) },
    ]
    const back = readZip(writeZip(entries))
    expect(back.map(e => e.name)).toEqual(entries.map(e => e.name))
    back.forEach((e, i) => expect(e.data.equals(entries[i].data)).toBe(true))
  })

  it('has the checksum standard zip tools expect', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('refuses something that is not a zip', () => {
    expect(() => readZip(Buffer.from('definitely not a zip file at all'))).toThrow(ZipError)
    expect(() => readZip(Buffer.alloc(3))).toThrow(ZipError)
  })

  it('refuses a damaged entry (checksum), a truncated file, and an entry that lies about its size', () => {
    const z = writeZip([{ name: 'a.txt', data: Buffer.from('some text to keep'.repeat(3)) }])
    const bad = Buffer.from(z)
    bad[bad.indexOf(Buffer.from('a.txt')) + 6] ^= 0xff // a byte of the stored data
    expect(() => readZip(bad)).toThrow(ZipError)
    expect(() => readZip(z.subarray(0, z.length - 10))).toThrow(ZipError)
  })

  it('does not inflate more than the entry declares (a zip bomb)', () => {
    const real = Buffer.alloc(5_000_000, 97)
    const z = writeZip([{ name: 'big.txt', data: real }])
    // Rewrite the declared size to something tiny in both headers; the data still inflates to 5MB.
    const lie = Buffer.from(z)
    for (let i = 0; i + 4 < lie.length; i++) {
      if (lie.readUInt32LE(i) === 5_000_000) lie.writeUInt32LE(10, i)
    }
    expect(() => readZip(lie)).toThrow(ZipError)
  })

  it('enforces its size limits before inflating', () => {
    const z = writeZip([{ name: 'a', data: Buffer.alloc(1000, 1) }, { name: 'b', data: Buffer.alloc(1000, 2) }])
    expect(() => readZip(z, { maxEntries: 1, maxEntryBytes: 10_000, maxTotalBytes: 10_000 })).toThrow(/more than/)
    expect(() => readZip(z, { maxEntries: 5, maxEntryBytes: 500, maxTotalBytes: 10_000 })).toThrow(/larger than/)
    expect(() => readZip(z, { maxEntries: 5, maxEntryBytes: 1000, maxTotalBytes: 1500 })).toThrow(/too big/)
  })

  it('refuses encrypted and unsupported-method entries', () => {
    const z = Buffer.from(writeZip([{ name: 'a.txt', data: Buffer.from('x'.repeat(50)) }]))
    const cen = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    const enc = Buffer.from(z); enc.writeUInt16LE(1, cen + 8)
    expect(() => readZip(enc)).toThrow(/Encrypted/)
    const odd = Buffer.from(z); odd.writeUInt16LE(99, cen + 10)
    expect(() => readZip(odd)).toThrow(/compression/)
  })
})

describe('exporting and importing chats', () => {
  it('moves every chat to a fresh machine, with its messages and pin', () => {
    const a = store('old')
    const id1 = say(a, 'tell me about volcanoes')
    const id2 = say(a, 'plan a trip to japan')
    a.setPinned(id2, true)
    const zip = exportChats(a)

    const b = store('new')
    expect(importChats(b, zip)).toEqual({ added: 2, skipped: 0, invalid: 0 })
    expect(b.loadThread(id1)!.messages.map(m => m.content)).toEqual(['tell me about volcanoes', 'reply to tell me about volcanoes'])
    expect(b.loadThread(id2)!.pinned).toBe(true)
    expect(b.listGroups().length).toBeGreaterThan(0) // filed like any other chat
  })

  it('importing twice changes nothing the second time, and never overwrites a chat that is already here', () => {
    const a = store('old')
    const id = say(a, 'original words')
    const zip = exportChats(a)
    const b = store('new')
    say(b, 'different local words', id)
    const r = importChats(b, zip)
    expect(r).toEqual({ added: 0, skipped: 1, invalid: 0 })
    expect(b.loadThread(id)!.messages[0].content).toBe('different local words')
    expect(importChats(store('other'), zip).added).toBe(1)
  })

  it('refuses a zip that is not one of ours', () => {
    const other = writeZip([{ name: 'notes.txt', data: Buffer.from('hi') }])
    expect(() => importChats(store('x'), other)).toThrow(/not a NeuroClaw chat export/)
    const wrong = writeZip([{ name: 'manifest.json', data: Buffer.from('{"format":"something-else"}') }])
    expect(() => importChats(store('x'), wrong)).toThrow(/not a NeuroClaw chat export/)
  })

  it('skips threads that are malformed or have an unsafe id, and keeps only known fields', () => {
    const good = { id: 'ok-1', source: 'chat', title: 'hello', messages: [{ role: 'user', content: 'hi', timestamp: 5 }], createdAt: 1, updatedAt: 2, evil: '<script>', __proto__x: 1 }
    const zip = writeZip([
      { name: 'manifest.json', data: Buffer.from(JSON.stringify({ format: 'neuroclaw-chats' })) },
      { name: 'threads/ok-1.json', data: Buffer.from(JSON.stringify(good)) },
      { name: 'threads/a.json', data: Buffer.from(JSON.stringify({ ...good, id: '../../escape' })) },
      { name: 'threads/b.json', data: Buffer.from(JSON.stringify({ ...good, id: 'b', messages: [{ role: 'system', content: 'x' }] })) },
      { name: 'threads/c.json', data: Buffer.from('not json') },
      { name: 'threads/d.json', data: Buffer.from(JSON.stringify({ ...good, id: 'd', messages: 'nope' })) },
      { name: '../outside.json', data: Buffer.from('{}') },
    ])
    const s = store('x')
    expect(importChats(s, zip)).toEqual({ added: 1, skipped: 0, invalid: 4 })
    const t = s.loadThread('ok-1') as any
    expect(t.evil).toBeUndefined()
    expect(t.messages).toEqual([{ role: 'user', content: 'hi', timestamp: 5 }])
  })
})
