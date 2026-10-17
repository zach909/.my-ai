/**
 * The agent does the filing: it reads the agent's answer as places, learns
 * from each filing, and leaves things unsorted when the answer is no good.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { organizeItems, parsePlaces, placementPrompt, lessonFor, gatherItems, pruneGone, DEFAULT_ASK_GAP_MS, type OrganizeItem } from '../../models && skills/core/folder-organizer.js'
import { listNodes, viewTree, placeItem, type TreeCtx } from '../../models && skills/core/folder-tree.js'
import { ChatHistoryStore } from '../../models && skills/core/chat-history-store.js'
import { createProject } from '../../models && skills/core/projects.js'

let dir: string
let ctx: TreeCtx
let now = 1_000_000
const savedEnv: Record<string, string | undefined> = {}
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'folder-organizer-'))
  now = 1_000_000
  ctx = { file: path.join(dir, 'folders.json'), now: () => now }
  for (const k of ['NEUROCLAW_STORE_DIR', 'CORONA_PROJECTS_FILE', 'CORONA_POINTS_FILE']) savedEnv[k] = process.env[k]
  process.env.NEUROCLAW_STORE_DIR = path.join(dir, 'store')
  process.env.CORONA_PROJECTS_FILE = path.join(dir, 'projects.json')
  process.env.CORONA_POINTS_FILE = path.join(dir, 'points.json')
})
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  rmSync(dir, { recursive: true, force: true })
})

const item = (ref: string, title = ref, excerpt = ''): OrganizeItem => ({ kind: 'chat', ref, title, excerpt })

describe('reading the agent\'s answer', () => {
  it('reads Path: percent lines, nested paths, and a half-and-half split', () => {
    expect(parsePlaces('Science/Physics: 70\nNotes: 30')).toEqual([
      { path: ['Science', 'Physics'], weight: 0.7 },
      { path: ['Notes'], weight: 0.3 },
    ])
  })

  it('copes with the way an agent actually writes it', () => {
    expect(parsePlaces('- **Electronics**: 80%\n- "Code" - 40')).toEqual([{ path: ['Electronics'], weight: 0.8 }, { path: ['Code'], weight: 0.4 }])
    expect(parsePlaces('Science > Physics | 100')).toEqual([{ path: ['Science', 'Physics'], weight: 1 }])
    expect(parsePlaces('Front-end: 60')).toEqual([{ path: ['Front-end'], weight: 0.6 }])
  })

  it('a bare path means all of it, and 100 + 100 is fully in both', () => {
    expect(parsePlaces('Recipes')).toEqual([{ path: ['Recipes'], weight: 1 }])
    expect(parsePlaces('Physics: 100\nChemistry: 100')).toHaveLength(2)
  })

  it('ignores chatter, unusable names, thin places, "unsorted", and anything past the limit', () => {
    expect(parsePlaces('Sure! Here you go:\n<script>x</script>: 90\nReal: 50\nTiny: 4\nUnsorted\nnone')).toEqual([{ path: ['Real'], weight: 0.5 }])
    expect(parsePlaces('A: 10\nB: 20\nC: 30\nD: 40')).toHaveLength(3)
    expect(parsePlaces('')).toEqual([])
    expect(parsePlaces('¿¿ ???')).toEqual([])
  })

  it('a place named twice is kept once', () => {
    expect(parsePlaces('Notes: 30\nnotes: 90')).toEqual([{ path: ['Notes'], weight: 0.3 }])
  })
})

describe('organising', () => {
  it('asks the agent, files the item where it says, and half-places a split', async () => {
    const think = async () => 'Electronics/Sensors: 70\nCode: 30'
    const r = await organizeItems([item('a', 'Wiring a sensor', 'how do I wire an i2c sensor')], think, ctx)
    expect(r).toEqual({ asked: 1, placed: 1, split: 1, left: 0 })
    const v = viewTree(ctx)
    expect(v.top.map(f => f.title).sort()).toEqual(['Code', 'Electronics'])
    expect(v.counts).toMatchObject({ items: 1, split: 1 })
  })

  it('shows the agent what it needs: the item, the folders so far, and what it filed recently', async () => {
    placeItem({ kind: 'chat', ref: 'old', title: 'Soldering tips' }, [{ path: ['Electronics'], weight: 1 }], ctx)
    const prompts: string[] = []
    await organizeItems([item('new', 'Wiring a sensor', 'i2c question')], async p => { prompts.push(p); return 'Electronics: 100' }, ctx)
    expect(prompts[0]).toContain('Item (chat): Wiring a sensor')
    expect(prompts[0]).toContain('i2c question')
    expect(prompts[0]).toContain('- Electronics')
    expect(prompts[0]).toContain('"Soldering tips" -> Electronics 100')
    expect(prompts[0]).toContain('do not have to add up to 100')
    expect(placementPrompt(item('x'), { file: path.join(dir, 'empty.json') })).toContain('(none yet)')
  })

  it('learns from every filing, in a short lesson', async () => {
    const lessons: string[] = []
    await organizeItems([item('a', 'Wiring a sensor')], async () => 'Electronics: 70\nCode: 30', { ...ctx, learn: t => lessons.push(t) })
    expect(lessons).toEqual(['"Wiring a sensor" (chat) belongs in Electronics 70% and Code 30%.'])
    expect(lessonFor(item('a', 'x'.repeat(200)), [{ path: ['A'], weight: 1 }]).length).toBeLessThan(140)
  })

  it('a learning failure never undoes the filing', async () => {
    await organizeItems([item('a')], async () => 'Notes: 100', { ...ctx, learn: () => { throw new Error('mesh busy') } })
    expect(listNodes(ctx).find(n => n.id === 'chat:a')!.placements).toHaveLength(1)
  })

  it('leaves it unsorted, and does not ask again for a while, when the answer is unusable', async () => {
    let calls = 0
    const junk = async () => { calls++; return '¿¿ ???' }
    expect(await organizeItems([item('a')], junk, ctx)).toEqual({ asked: 1, placed: 0, split: 0, left: 1 })
    expect(viewTree(ctx).unsorted.map(u => u.id)).toEqual(['chat:a'])
    await organizeItems([item('a')], junk, ctx)
    expect(calls).toBe(1)
    now += DEFAULT_ASK_GAP_MS + 1
    await organizeItems([item('a')], junk, ctx)
    expect(calls).toBe(2)
  })

  it('treats an agent that throws as saying nothing', async () => {
    const r = await organizeItems([item('a')], async () => { throw new Error('down') }, ctx)
    expect(r.left).toBe(1)
  })

  it('does not re-file something already placed', async () => {
    let calls = 0
    const think = async () => { calls++; return 'Notes: 100' }
    await organizeItems([item('a')], think, ctx)
    await organizeItems([item('a')], think, ctx)
    expect(calls).toBe(1)
  })

  it('only asks about a few items per pass', async () => {
    let calls = 0
    const r = await organizeItems(['a', 'b', 'c', 'd', 'e'].map(x => item(x)), async () => { calls++; return 'Notes: 100' }, { ...ctx, limit: 2 })
    expect(r.asked).toBe(2)
    expect(calls).toBe(2)
  })
})

describe('what there is to organise', () => {
  it('gathers chats, and projects, and forgets what has gone', async () => {
    const chats = new ChatHistoryStore(path.join(dir, 'chats'))
    const t = chats.appendMessage({ role: 'user', content: 'how do I bake sourdough', timestamp: 1 }, 'chat')
    createProject({ title: 'Weather', goal: 'Build a weather app', pot: 10 }, { file: process.env.CORONA_PROJECTS_FILE, pointsFile: process.env.CORONA_POINTS_FILE })
    const items = gatherItems({ chats, wiki: false })
    expect(items.map(i => [i.kind, i.title]).sort()).toEqual([['chat', 'how do I bake sourdough'], ['project', 'Weather']])
    expect(items.find(i => i.kind === 'project')!.excerpt).toBe('Build a weather app')

    await organizeItems(items, async () => 'Misc: 100', ctx)
    chats.deleteThread(t.id)
    const removed = pruneGone(gatherItems({ chats, wiki: false }), { chats: true, wiki: false, projects: true }, ctx)
    expect(removed).toBe(1)
    expect(listNodes(ctx).some(n => n.id === `chat:${t.id}`)).toBe(false)
    expect(listNodes(ctx).some(n => n.id === 'project:weather')).toBe(true)
  })
})
