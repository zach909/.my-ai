/**
 * How a hive's agents learn differently and how that is combined: a weighted
 * average that blends into the shared network instead of replacing it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HyperDimensionalEngine } from '../../models && skills/core/onebrain'
import { DoorwayLock } from '../../models && skills/core/doorway-lock'
import {
  extractCore, makeBaseFile, rms, zerosLike, injectCore, encodeDelta, decodeDelta, readOthersContribution, type CoreArrays,
} from '../../models && skills/core/shared-mesh'
import {
  mergeDeltas, MeshAgentLearner, publishMergedDelta, projectDeltaId,
} from '../../models && skills/core/hive-learning'

const tmps: string[] = []
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'hive-learning-'))
  tmps.push(d)
  return d
}
afterEach(() => { while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }) })

const arr = (...v: number[]): CoreArrays => ({ a: Float32Array.from(v), b: Float32Array.from(v.map(x => -x)) })

describe('mergeDeltas', () => {
  it('equal weights are a plain average', () => {
    const r = mergeDeltas([{ id: 'x', weight: 1, delta: arr(0.2, 0.4) }, { id: 'y', weight: 1, delta: arr(0.4, 0) }])!
    expect(Array.from(r.merged.a)).toEqual([expect.closeTo(0.3, 6), expect.closeTo(0.2, 6)])
    expect(Array.from(r.merged.b)).toEqual([expect.closeTo(-0.3, 6), expect.closeTo(-0.2, 6)])
    expect(r.shares).toEqual([{ id: 'x', share: 0.5 }, { id: 'y', share: 0.5 }])
  })

  it('weights by value: the agent that counts more pulls the result more', () => {
    const r = mergeDeltas([{ id: 'good', weight: 75, delta: arr(1) }, { id: 'poor', weight: 25, delta: arr(0) }])!
    expect(r.merged.a[0]).toBeCloseTo(0.75, 6)
    expect(r.shares.map(s => s.share)).toEqual([0.75, 0.25])
  })

  it('is an average, not a sum: it can never exceed the biggest single change', () => {
    const parts = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, weight: 10, delta: arr(0.5, -0.5) }))
    const r = mergeDeltas(parts)!
    expect(r.merged.a[0]).toBeCloseTo(0.5, 6)
    expect(r.merged.a[1]).toBeCloseTo(-0.5, 6)
  })

  it('leaves out anyone with no weight or whose arrays do not line up, instead of guessing', () => {
    const r = mergeDeltas([
      { id: 'ok', weight: 1, delta: arr(0.2, 0.2) },
      { id: 'zero', weight: 0, delta: arr(9, 9) },
      { id: 'short', weight: 1, delta: arr(9) },
      { id: 'nan', weight: Number.NaN, delta: arr(9, 9) },
    ])!
    expect(r.shares).toEqual([{ id: 'ok', share: 1 }])
    expect(r.merged.a[0]).toBeCloseTo(0.2, 6)
  })

  it('is null when nobody learned anything', () => {
    expect(mergeDeltas([])).toBeNull()
    expect(mergeDeltas([{ id: 'x', weight: 0, delta: arr(1) }])).toBeNull()
  })
})

// ── The learner, against a real (small) engine ──────────────────────────

function engine() {
  return new HyperDimensionalEngine({ dimensions: 4, neuronCount: 6, hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1 })
}

function setupLearner(opts: { maxBytes?: number; feedImpl?: (text: string) => Promise<void> } = {}) {
  const root = tmp()
  const e = engine()
  const baseSnapshot = e.captureNetworkState()
  const shape = baseSnapshot.shape
  const baseFile = path.join(root, 'base.json')
  writeFileSync(baseFile, JSON.stringify(makeBaseFile(baseSnapshot)))
  const fed: string[] = []
  const lock = new DoorwayLock()
  // Stands in for the Zip Loop: nudges the weights by an amount that depends on what it is shown.
  const feed = opts.feedImpl ?? (async (text: string) => {
    fed.push(text)
    const snap = e.captureNetworkState()
    const core = extractCore(snap, shape)!
    const nudged: CoreArrays = {}
    const amount = 0.002 * text.length
    for (const [k, v] of Object.entries(core)) nudged[k] = v.map((x, i) => x + amount * (((i + text.charCodeAt(0)) % 3) - 1))
    e.restoreNetworkState(injectCore(snap, nudged, shape)!)
  })
  const learner = new MeshAgentLearner({ engine: () => e, lock, feed, baseFile, dir: path.join(root, 'agents'), maxBytes: opts.maxBytes })
  return { root, e, shape, learner, fed, lock }
}

const coreOf = (e: HyperDimensionalEngine, shape: { neurons: number; dimensions: number }) => extractCore(e.captureNetworkState(), shape)!
const same = (a: CoreArrays, b: CoreArrays) => Object.keys(a).every(k => a[k].length === b[k].length && a[k].every((x, i) => x === b[k][i]))

describe('MeshAgentLearner', () => {
  it('makes each agent different from the base and from each other', async () => {
    const { learner } = setupLearner()
    expect((await learner.teach('alpha', 'write the parser')).ok).toBe(true)
    expect((await learner.teach('beta', 'draw the whole interface screen with all of its parts')).ok).toBe(true)
    const a = learner.delta('alpha')!
    const b = learner.delta('beta')!
    expect(rms(a)).toBeGreaterThan(0)
    expect(rms(b)).toBeGreaterThan(rms(a)) // it was taught more
    expect(same(a, b)).toBe(false)
    expect(learner.delta('nobody')).toBeNull()
  })

  it('puts the live brain back exactly as it found it', async () => {
    const { learner, e, shape } = setupLearner()
    // The live brain has already learned something of its own that is not the base.
    const snap = e.captureNetworkState()
    const own = extractCore(snap, shape)!
    const moved: CoreArrays = {}
    for (const [k, v] of Object.entries(own)) moved[k] = v.map(x => x + 0.05)
    e.restoreNetworkState(injectCore(snap, moved, shape)!)
    const before = coreOf(e, shape)
    await learner.teach('alpha', 'a lesson that changes the weights')
    expect(same(coreOf(e, shape), before)).toBe(true)
  })

  it('accumulates: teaching again builds on what the agent already learned', async () => {
    const { learner } = setupLearner()
    await learner.teach('alpha', 'first lesson here')
    const first = learner.delta('alpha')!
    await learner.teach('alpha', 'second lesson, and more of it')
    const second = learner.delta('alpha')!
    expect(same(first, second)).toBe(false)
    expect(rms(second)).toBeGreaterThan(0)
  })

  it('caps how much text goes in, and never splits a character', async () => {
    const { learner, fed } = setupLearner({ maxBytes: 10 })
    await learner.teach('alpha', 'héllo wörld, this is long')
    expect(Buffer.byteLength(fed[0])).toBeLessThanOrEqual(10)
    expect(fed[0].startsWith('héllo')).toBe(true)
  })

  it('reports a failure and still restores the live brain', async () => {
    const boom = setupLearner({ feedImpl: async () => { throw new Error('zip loop down') } })
    const before = coreOf(boom.e, boom.shape)
    const r = await boom.learner.teach('alpha', 'anything')
    expect(r).toEqual({ ok: false, reason: 'zip loop down' })
    expect(same(coreOf(boom.e, boom.shape), before)).toBe(true)
    expect(boom.learner.delta('alpha')).toBeNull()
  })

  it('refuses nothing-to-teach, bad ids, and a missing base', async () => {
    const { learner, root } = setupLearner()
    expect((await learner.teach('alpha', '')).ok).toBe(false)
    expect((await learner.teach('../escape', 'x')).ok).toBe(false)
    const noBase = new MeshAgentLearner({ engine: () => null, lock: new DoorwayLock(), feed: async () => undefined, baseFile: path.join(root, 'missing.json'), dir: path.join(root, 'x') })
    expect(await noBase.teach('alpha', 'x')).toMatchObject({ ok: false })
    expect(noBase.base()).toBeNull()
    expect(existsSync(path.join(root, '..', 'escape.delta.json.gz'))).toBe(false)
  })

  it('a variant starts from a copy of what its parent learned, then goes its own way', async () => {
    const { learner } = setupLearner()
    await learner.teach('parent', 'a lesson the parent learned')
    expect(learner.clone('parent', 'child')).toBe(true)
    expect(same(learner.delta('child')!, learner.delta('parent')!)).toBe(true)
    await learner.teach('child', 'something only the child was taught, and at some length')
    expect(same(learner.delta('child')!, learner.delta('parent')!)).toBe(false)
    expect(learner.delta('parent')).not.toBeNull() // the parent is untouched
  })

  it('has nothing to copy from an agent that learned nothing, and refuses bad ids', () => {
    const { learner } = setupLearner()
    expect(learner.clone('nobody', 'child')).toBe(false)
    expect(learner.delta('child')).toBeNull()
    expect(learner.clone('../x', 'child')).toBe(false)
  })

  it('forgets an agent that was removed', async () => {
    const { learner } = setupLearner()
    await learner.teach('alpha', 'a lesson')
    expect(learner.delta('alpha')).not.toBeNull()
    learner.forget('alpha')
    expect(learner.delta('alpha')).toBeNull()
  })

  it('holds the doorway lock for the whole swap, so a chat cannot land in the middle', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const { learner, lock } = setupLearner({ feedImpl: async () => { order.push('feed-start'); await gate; order.push('feed-end') } })
    const teaching = learner.teach('alpha', 'lesson')
    await new Promise(r => setTimeout(r, 20))
    const chat = lock.run(() => { order.push('chat') })
    await new Promise(r => setTimeout(r, 20))
    expect(order).toEqual(['feed-start']) // the chat is still waiting
    release()
    await teaching
    await chat
    expect(order).toEqual(['feed-start', 'feed-end', 'chat'])
  })
})

// ── Publishing, and blending in with everyone else ──────────────────────

describe('publishMergedDelta', () => {
  const shape = { neurons: 6, dimensions: 4 }
  const core = () => extractCore(engine().captureNetworkState(), shape)!
  const learned = (amount: number): CoreArrays => {
    const out: CoreArrays = {}
    for (const [k, v] of Object.entries(core())) out[k] = new Float32Array(v.length).fill(amount)
    return out
  }

  it('gives each project its own stable contributor id', () => {
    expect(projectDeltaId('weather')).toMatch(/^[a-f0-9]{16}$/)
    expect(projectDeltaId('weather')).toBe(projectDeltaId('weather'))
    expect(projectDeltaId('weather')).not.toBe(projectDeltaId('moon'))
  })

  it('saves locally and does not push unless sharing is opted into', () => {
    const root = tmp()
    let spawned = 0
    const r = publishMergedDelta({ projectId: 'weather', merged: learned(0.1), baseId: 'b', shape, paths: { root }, enabled: false, spawnFn: (() => { spawned++; return { on() {}, unref() {} } }) as never })!
    expect(r.push).toBe('off')
    expect(r.reason).toMatch(/NEUROCLAW_SHARED_LEARNING/)
    expect(spawned).toBe(0)
    expect(existsSync(path.join(root, r.relPath))).toBe(true)
    expect(existsSync(path.join(root, 'extension-builder', 'shared-mesh-local'))).toBe(false)
  })

  it('when opted in, queues the push through its own outbox and the publish script', () => {
    const root = tmp()
    const script = path.join(root, 'publish.mjs')
    writeFileSync(script, '')
    const calls: Array<{ args: string[]; opts: { cwd: string; detached: boolean } }> = []
    const spawnFn = ((_cmd: string, args: string[], opts: { cwd: string; detached: boolean }) => { calls.push({ args, opts }); return { on() {}, unref() {} } }) as never
    const r = publishMergedDelta({ projectId: 'weather', merged: learned(0.1), baseId: 'b', shape, paths: { root, publishScript: script }, enabled: true, spawnFn })!
    expect(r.push).toBe('queued')
    const outbox = path.join(root, 'extension-builder', 'shared-mesh-local', `outbox-hive-${r.id}.json`)
    expect(calls[0].args).toEqual([script, outbox])
    const job = JSON.parse(readFileSync(outbox, 'utf8'))
    expect(job.relPath).toBe(`extension-builder/shared-mesh/deltas/${r.id}.json`)
    // The install's own outbox is never touched.
    expect(existsSync(path.join(root, 'extension-builder', 'shared-mesh-local', 'outbox.json'))).toBe(false)
  })

  it('reports a missing publish script instead of pretending it pushed', () => {
    const root = tmp()
    const r = publishMergedDelta({ projectId: 'weather', merged: learned(0.1), baseId: 'b', shape, paths: { root, publishScript: path.join(root, 'nope.mjs') }, enabled: true })!
    expect(r.push).toBe('no-script')
  })

  it('writes nothing for a merge that came to no change', () => {
    const root = tmp()
    expect(publishMergedDelta({ projectId: 'weather', merged: zerosLike(core()), baseId: 'b', shape, paths: { root }, enabled: false })).toBeNull()
    expect(existsSync(path.join(root, 'extension-builder'))).toBe(false)
  })

  it('blends into the network as one more contributor: it does not replace what others taught', () => {
    const root = tmp()
    const deltasDir = path.join(root, 'extension-builder', 'shared-mesh', 'deltas')
    // Another install already published its own learning.
    publishMergedDelta({ projectId: 'someone-else', merged: learned(0.3), baseId: 'b', shape, paths: { root }, enabled: false })
    const theirs = projectDeltaId('someone-else')
    // Now this project finishes and publishes too.
    publishMergedDelta({ projectId: 'weather', merged: learned(0.6), baseId: 'b', shape, paths: { root }, enabled: false })
    const keys = Object.keys(core())
    const seen = readOthersContribution(deltasDir, { baseId: 'b', shape, expectedKeys: keys, excludeInstallId: 'ffffffffffffffff', template: core() })
    expect(seen.installs).toBe(2)
    // Everyone's changes averaged: (0.3 + 0.6) / (2 + 1). Neither one replaced the other.
    expect(seen.contribution.modWeight[0]).toBeCloseTo(0.3, 2)
    expect(readdirSync(deltasDir).sort()).toEqual([`${theirs}.json`, `${projectDeltaId('weather')}.json`].sort())
  })

  it('publishing the same project again replaces only its own file', () => {
    const root = tmp()
    const deltasDir = path.join(root, 'extension-builder', 'shared-mesh', 'deltas')
    publishMergedDelta({ projectId: 'other', merged: learned(0.3), baseId: 'b', shape, paths: { root }, enabled: false })
    const first = publishMergedDelta({ projectId: 'weather', merged: learned(0.2), baseId: 'b', shape, paths: { root }, enabled: false })!
    const second = publishMergedDelta({ projectId: 'weather', merged: learned(0.4), baseId: 'b', shape, paths: { root }, enabled: false })!
    expect(second.id).toBe(first.id)
    expect(readdirSync(deltasDir)).toHaveLength(2)
    const back = decodeDelta(JSON.parse(readFileSync(path.join(deltasDir, `${second.id}.json`), 'utf8')), 'b', shape, Object.keys(core()))!
    expect(back.modWeight[0]).toBeCloseTo(0.4, 1)
    // The encoder works from the same format an install's delta uses.
    expect(encodeDelta(learned(0.4), 'b', shape).version).toBe(1)
  })
})
