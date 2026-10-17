/**
 * Folders inside folders, and items that sit in two places at once.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  placeItem, placeFolder, markAsked, pruneMissing, viewTree, pathsOf, listNodes, folderPaths, recentFilings, parsePath, cleanName,
  ROOT, MAX_PLACEMENTS, MAX_DEPTH, TreeError, loadTree, type TreeCtx,
} from '../../models && skills/core/folder-tree.js'

let dir: string
let ctx: TreeCtx
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'folder-tree-'))
  ctx = { file: path.join(dir, 'folders.json'), now: () => 1000 }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const chat = (ref: string, title = ref) => ({ kind: 'chat' as const, ref, title })
const names = (nodes: { title: string }[]) => nodes.map(n => n.title)

describe('nesting', () => {
  it('makes folders inside folders from a path, and reuses them (any case) next time', () => {
    placeItem(chat('a'), [{ path: ['Science', 'Physics'], weight: 1 }], ctx)
    placeItem(chat('b'), [{ path: ['science', 'physics'], weight: 1 }], ctx)
    const folders = listNodes(ctx).filter(n => n.kind === 'folder')
    expect(names(folders).sort()).toEqual(['Physics', 'Science'])
    const v = viewTree(ctx)
    expect(names(v.top)).toEqual(['Science'])
    expect(names(v.top[0].children)).toEqual(['Physics'])
    expect(names(v.top[0].children[0].children).sort()).toEqual(['a', 'b'])
    expect(v.counts).toEqual({ folders: 2, items: 2, split: 0 })
  })

  it('the same name under two different parents is two different folders', () => {
    placeItem(chat('a'), [{ path: ['Work', 'Notes'], weight: 1 }], ctx)
    placeItem(chat('b'), [{ path: ['Home', 'Notes'], weight: 1 }], ctx)
    expect(listNodes(ctx).filter(n => n.title === 'Notes')).toHaveLength(2)
  })

  it('refuses a path that is too deep or has an unusable name', () => {
    expect(parsePath(Array.from({ length: MAX_DEPTH + 1 }, (_, i) => `d${i}`).join('/'))).toBeNull()
    expect(parsePath('Science/<b>x</b>')).toBeNull()
    expect(parsePath('')).toBeNull()
    expect(parsePath('Science > Physics')).toEqual(['Science', 'Physics'])
    expect(cleanName('x'.repeat(41))).toBeNull()
    expect(() => placeItem(chat('a'), [{ path: ['<script>'], weight: 1 }], ctx)).toThrow(TreeError)
  })
})

describe('the half zone', () => {
  it('an item can be mostly in one place and partly in another, and shows in both', () => {
    placeItem(chat('sensor', 'Wiring a sensor'), [{ path: ['Electronics'], weight: 0.7 }, { path: ['Code'], weight: 0.4 }], ctx)
    const v = viewTree(ctx)
    const where = Object.fromEntries(v.top.map(f => [f.title, f.children.map(c => [c.title, c.weight])]))
    expect(where).toEqual({ Electronics: [['Wiring a sensor', 0.7]], Code: [['Wiring a sensor', 0.4]] })
    expect(v.counts.split).toBe(1)
  })

  it('weights are independent: fully in two places at once is allowed', () => {
    placeItem(chat('both'), [{ path: ['Physics'], weight: 1 }, { path: ['Chemistry'], weight: 1 }], ctx)
    expect(listNodes(ctx).find(n => n.id === 'chat:both')!.placements.map(p => p.weight)).toEqual([1, 1])
  })

  it('at most a few places at once', () => {
    const many = Array.from({ length: MAX_PLACEMENTS + 1 }, (_, i) => ({ path: [`F${i}`], weight: 0.5 }))
    expect(() => placeItem(chat('x'), many, ctx)).toThrow(/at most/)
  })

  it('refuses a weight outside (0, 1], and drops a place too thin to count', () => {
    expect(() => placeItem(chat('x'), [{ path: ['A'], weight: 0 }], ctx)).toThrow(TreeError)
    expect(() => placeItem(chat('x'), [{ path: ['A'], weight: 1.5 }], ctx)).toThrow(TreeError)
    placeItem(chat('x'), [{ path: ['A'], weight: 0.9 }, { path: ['Thin'], weight: 0.05 }], ctx)
    expect(listNodes(ctx).find(n => n.id === 'chat:x')!.placements).toHaveLength(1)
    expect(listNodes(ctx).some(n => n.title === 'Thin')).toBe(false)
  })

  it('two places in the same folder keep the larger weight', () => {
    placeItem(chat('x'), [{ path: ['A'], weight: 0.3 }, { path: ['a'], weight: 0.8 }], ctx)
    expect(listNodes(ctx).find(n => n.id === 'chat:x')!.placements).toEqual([{ parent: expect.any(String), weight: 0.8 }])
  })

  it('re-placing replaces where it was', () => {
    placeItem(chat('x'), [{ path: ['Old'], weight: 1 }], ctx)
    placeItem(chat('x'), [{ path: ['New'], weight: 1 }], ctx)
    const v = viewTree(ctx)
    expect(v.top.find(f => f.title === 'Old')!.children).toEqual([])
    expect(v.top.find(f => f.title === 'New')!.children.map(c => c.title)).toEqual(['x'])
  })

  it('a folder can sit half in two parents, and its items inherit both routes', () => {
    placeItem(chat('x', 'Note'), [{ path: ['Hobbies', 'Robots'], weight: 1 }], ctx)
    placeItem(chat('y'), [{ path: ['Work'], weight: 1 }], ctx)
    const robots = listNodes(ctx).find(n => n.title === 'Robots')!
    const work = listNodes(ctx).find(n => n.title === 'Work')!
    const hobbies = listNodes(ctx).find(n => n.title === 'Hobbies')!
    placeFolder(robots.id, [{ parent: hobbies.id, weight: 1 }, { parent: work.id, weight: 0.5 }], ctx)
    const routes = pathsOf(loadTree(ctx.file), 'chat:x')
    expect(routes.map(r => r.path.join('/')).sort()).toEqual(['Hobbies/Robots', 'Work/Robots'])
    expect(routes.find(r => r.path[0] === 'Work')!.weight).toBe(0.5)
  })
})

describe('no loops', () => {
  it('a folder cannot go inside itself or anything beneath it', () => {
    placeItem(chat('x'), [{ path: ['A', 'B', 'C'], weight: 1 }], ctx)
    const [a, b, c] = ['A', 'B', 'C'].map(t => listNodes(ctx).find(n => n.title === t)!)
    expect(() => placeFolder(a.id, [{ parent: a.id, weight: 1 }], ctx)).toThrow(/inside itself/)
    expect(() => placeFolder(a.id, [{ parent: c.id, weight: 1 }], ctx)).toThrow(/inside itself/)
    expect(() => placeFolder(a.id, [{ parent: b.id, weight: 0.2 }], ctx)).toThrow(/inside itself/)
    placeFolder(c.id, [{ parent: a.id, weight: 1 }], ctx) // moving up is fine
    expect(pathsOf(loadTree(ctx.file), c.id).map(p => p.path.join('/'))).toEqual(['A/C'])
  })

  it('only a real folder can be a parent', () => {
    placeItem(chat('x'), [{ path: ['A'], weight: 1 }], ctx)
    const a = listNodes(ctx).find(n => n.title === 'A')!
    expect(() => placeFolder(a.id, [{ parent: 'chat:x', weight: 1 }], ctx)).toThrow(/No such folder/)
    expect(() => placeFolder('nope', [{ parent: ROOT, weight: 1 }], ctx)).toThrow(/No such folder/)
  })

  it('a damaged file with a loop in it does not hang the view', () => {
    writeFileSync(ctx.file!, JSON.stringify({ nodes: [
      { id: 'folder:a', kind: 'folder', title: 'A', ref: 'folder:a', placements: [{ parent: 'folder:b', weight: 1 }] },
      { id: 'folder:b', kind: 'folder', title: 'B', ref: 'folder:b', placements: [{ parent: 'folder:a', weight: 1 }, { parent: ROOT, weight: 1 }] },
    ] }))
    expect(() => viewTree(ctx)).not.toThrow()
    expect(() => pathsOf(loadTree(ctx.file), 'folder:a')).not.toThrow()
  })
})

describe('unsorted, asked, and gone', () => {
  it('an item with no place is unsorted, not lost', () => {
    placeItem(chat('x', 'Loose'), [], ctx)
    expect(viewTree(ctx).unsorted).toEqual([{ id: 'chat:x', kind: 'chat', title: 'Loose' }])
  })

  it('remembers that it asked, without placing anything', () => {
    markAsked(chat('x', 'Loose'), { ...ctx, now: () => 5000 })
    const n = listNodes(ctx)[0]
    expect(n).toMatchObject({ placements: [], askedAt: 5000, placedAt: null })
  })

  it('forgets items whose originals are gone, but only of the kinds it was told about', () => {
    placeItem(chat('keep'), [{ path: ['A'], weight: 1 }], ctx)
    placeItem(chat('gone'), [{ path: ['A'], weight: 1 }], ctx)
    placeItem({ kind: 'wiki', ref: 'page', title: 'Page' }, [{ path: ['A'], weight: 1 }], ctx)
    expect(pruneMissing([{ kind: 'chat', refs: ['keep'] }], ctx)).toBe(1)
    expect(listNodes(ctx).map(n => n.id).sort()).toEqual(['chat:keep', 'folder:' + listNodes(ctx).find(n => n.kind === 'folder')!.id.slice(7), 'wiki:page'].sort())
  })

  it('lists folder paths and recent filings for the agent to read', () => {
    placeItem(chat('x', 'Sensor wiring'), [{ path: ['Electronics', 'Sensors'], weight: 0.7 }, { path: ['Code'], weight: 0.3 }], ctx)
    expect(folderPaths(ctx)).toEqual(['Code', 'Electronics', 'Electronics/Sensors'])
    expect(recentFilings(ctx)).toEqual(['"Sensor wiring" -> Electronics/Sensors 70, Code 30'])
  })

  it('survives a missing or damaged file', () => {
    expect(viewTree({ file: path.join(dir, 'nope.json') }).top).toEqual([])
    writeFileSync(ctx.file!, '{ no')
    expect(listNodes(ctx)).toEqual([])
  })
})
