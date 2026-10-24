/**
 * Virtual workspaces: a real CRUD round trip, membership, and active-id
 * tracking, each against its own temp directory.
 */
import { describe, it, expect } from 'vitest'
import { WorkspaceStore } from '../../models && skills/core/workspace-store.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

function tmpStore(): WorkspaceStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'nc-workspaces-'))
  return new WorkspaceStore(dir)
}

describe('WorkspaceStore', () => {
  it('starts empty, with no active workspace', () => {
    const store = tmpStore()
    expect(store.list()).toEqual([])
    expect(store.getActiveId()).toBeNull()
  })

  it('creates, lists and fetches a workspace', () => {
    const store = tmpStore()
    const created = store.create('Research')
    expect(created.name).toBe('Research')
    expect(created.threadIds).toEqual([])
    expect(store.get(created.id)).toEqual(created)
    expect(store.list().map(w => w.id)).toEqual([created.id])
  })

  it('truncates an overlong name rather than failing', () => {
    const store = tmpStore()
    const created = store.create('x'.repeat(200))
    expect(created.name.length).toBe(80)
  })

  it('falls back to a default name when none is given', () => {
    const store = tmpStore()
    const created = store.create('')
    expect(created.name).toBe('Untitled workspace')
  })

  it('renames a workspace and bumps updatedAt', async () => {
    const store = tmpStore()
    const created = store.create('Draft')
    await new Promise(r => setTimeout(r, 2))
    const renamed = store.rename(created.id, 'Final')
    expect(renamed?.name).toBe('Final')
    expect(renamed!.updatedAt).toBeGreaterThan(created.updatedAt)
  })

  it('renaming an unknown id returns null rather than throwing', () => {
    const store = tmpStore()
    expect(store.rename('nope', 'x')).toBeNull()
  })

  it('adds and removes thread membership', () => {
    const store = tmpStore()
    const created = store.create('Project A')
    const withThread = store.setThreadMembership(created.id, 'thread-1', true)
    expect(withThread?.threadIds).toEqual(['thread-1'])
    // Adding the same thread again is a no-op, not a duplicate.
    store.setThreadMembership(created.id, 'thread-1', true)
    expect(store.get(created.id)?.threadIds).toEqual(['thread-1'])
    const removed = store.setThreadMembership(created.id, 'thread-1', false)
    expect(removed?.threadIds).toEqual([])
  })

  it('deletes a workspace, reporting whether it existed', () => {
    const store = tmpStore()
    const created = store.create('Temp')
    expect(store.delete(created.id)).toBe(true)
    expect(store.get(created.id)).toBeNull()
    expect(store.delete(created.id)).toBe(false)
  })

  it('tracks which workspace is active, and clears it on delete', () => {
    const store = tmpStore()
    const created = store.create('Main')
    store.setActive(created.id)
    expect(store.getActiveId()).toBe(created.id)
    store.delete(created.id)
    expect(store.getActiveId()).toBeNull()
  })

  it('refuses to activate an unknown workspace id', () => {
    const store = tmpStore()
    expect(() => store.setActive('nope')).toThrow(/No workspace/)
  })

  it('rejects a workspace id that looks like a path', () => {
    const store = tmpStore()
    expect(() => store.get('../escape')).toThrow(/Invalid workspace id/)
  })

  it('lists most recently updated first', async () => {
    const store = tmpStore()
    const first = store.create('First')
    await new Promise(r => setTimeout(r, 2))
    const second = store.create('Second')
    expect(store.list().map(w => w.id)).toEqual([second.id, first.id])
  })
})
