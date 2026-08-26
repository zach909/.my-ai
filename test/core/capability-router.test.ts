/**
 * Routing a message to a plugin without running any of them.
 *
 * The failure this replaces was silent and large: dispatch walked a hardcoded
 * intent -> plugin table, and 26 of the 35 registered plugins appeared nowhere
 * in it. They were registered, activated, health-checked, and unreachable. So
 * the tests that matter most here are the ones that prove a plugin nobody
 * listed can still be found, and that selection costs no plugin execution.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { CapabilityRouter, stem, tokenize } from '../../plugin_manager/capability-router.js'
import type { BasePlugin } from '../../plugin_manager/sdk.js'

/** A stand-in that records whether it was ever executed. */
function fakePlugin(capabilities?: unknown) {
  const calls = { onMessage: 0, describe: 0 }
  const p: Record<string, unknown> = {
    onMessage: async () => { calls.onMessage++; return null },
  }
  if (capabilities) {
    p.describeCapabilities = () => { calls.describe++; return capabilities }
  }
  return { plugin: p as unknown as BasePlugin, calls }
}

let router: CapabilityRouter
let plugins: Map<string, BasePlugin>
let calls: Record<string, { onMessage: number; describe: number }>

beforeEach(() => {
  router = new CapabilityRouter()
  plugins = new Map()
  calls = {}
  const add = (id: string, caps?: unknown) => {
    const { plugin, calls: c } = fakePlugin(caps)
    plugins.set(id, plugin)
    calls[id] = c
  }
  add('store', {
    commands: ['store install', 'store publish', 'store'],
    verbs: ['publish', 'install', 'download'],
    nouns: ['store', 'package'],
  })
  add('wiki', { verbs: ['write', 'document'], nouns: ['wiki', 'page', 'article'] })
  add('camera', { verbs: ['photograph', 'capture'], nouns: ['camera', 'photo'] })
  // Declares nothing at all — the case the old table made unreachable.
  add('robotics')
  add('tools')
  router.reindex(plugins, { robotics: ['robot-control', 'sensors'], tools: ['calculator', 'units'] })
})

describe('finding a plugin at all', () => {
  it('indexes every plugin, declared or not', () => {
    expect(router.size()).toBe(5)
  })

  it('finds a plugin that declares nothing, from its manifest capabilities', () => {
    // robotics appeared in no intent list and declares no capabilities. Under
    // the old table it could never be reached by any message.
    const top = router.rank('control the robot arm sensors')[0]
    expect(top.id).toBe('robotics')
  })

  it('finds a plugin from its own id when it has nothing else', () => {
    expect(router.rank('robotics please')[0].id).toBe('robotics')
  })

  it('routes a plugin’s own command syntax to it decisively', () => {
    // "install" also appears in other plugins' verbs; the exact command must win.
    const ranked = router.rank('store install skills nemotron')
    expect(ranked[0].id).toBe('store')
    expect(ranked[0].reason).toMatch(/command/)
    expect(ranked[0].score).toBeGreaterThan((ranked[1]?.score ?? 0) + 50)
  })

  it('matches on what a message is about, not on who was listed first', () => {
    expect(router.rank('write a wiki page about neural meshes')[0].id).toBe('wiki')
    expect(router.rank('take a photo with the camera')[0].id).toBe('camera')
  })
})

describe('the intent map as a prior, not a gate', () => {
  it('boosts what the intent suggested', () => {
    const withHint = router.rank('do the thing', ['tools'])
    expect(withHint[0].id).toBe('tools')
  })

  it('lets a genuinely matching plugin outscore the intent’s suggestion', () => {
    // The intent says "tools", but the message is unmistakably about the store.
    const ranked = router.rank('store install skills demo', ['tools'])
    expect(ranked[0].id).toBe('store')
  })

  it('still ranks a plugin the intent never mentioned', () => {
    const ranked = router.rank('capture a photo', ['tools', 'wiki'])
    expect(ranked.map(r => r.id)).toContain('camera')
  })
})

describe('selection is free', () => {
  it('never executes a plugin while deciding', () => {
    router.rank('store install skills demo')
    router.rank('write a wiki page')
    router.rank('control the robot')
    for (const [id, c] of Object.entries(calls)) {
      expect(c.onMessage, `${id}.onMessage was called during ranking`).toBe(0)
    }
  })

  it('does not re-ask plugins what they can do on every message', () => {
    const before = calls.store.describe
    for (let i = 0; i < 50; i++) router.rank('store install skills demo')
    expect(calls.store.describe).toBe(before)
  })
})

describe('being predictable', () => {
  it('routes the same message the same way every time', () => {
    const once = router.rank('store install skills demo').map(r => r.id)
    for (let i = 0; i < 5; i++) {
      expect(router.rank('store install skills demo').map(r => r.id)).toEqual(once)
    }
  })

  it('returns nothing rather than a random plugin for a message that matches none', () => {
    expect(router.rank('xyzzy plugh frobnicate')).toEqual([])
  })

  it('explains why each plugin was chosen', () => {
    for (const r of router.rank('store install skills demo')) {
      expect(r.reason.length).toBeGreaterThan(0)
    }
  })
})

describe('tokenizing', () => {
  it('drops filler words that would match everything', () => {
    expect(tokenize('can you please do the thing for me')).toEqual(['thing'])
  })

  it('splits on punctuation and case', () => {
    // Stemmed, so 'skills' and 'skill' collide -- which is the point.
    expect(tokenize('Store/Install-Skills')).toEqual(['stor', 'install', 'skill'])
  })

  it('collapses the word forms that kept seven plugins unreachable', () => {
    // Each pair is a real miss from before stemming: someone typing the left
    // word could not find the plugin that declared the right one.
    for (const [typed, declared] of [
      ['calculate', 'calculator'],
      ['code', 'coding'],
      ['message', 'messaging'],
      ['notification', 'notifications'],
      ['screenshot', 'screenshots'],
      ['contact', 'contacts'],
      ['task', 'tasks'],
    ]) {
      expect(stem(typed), `${typed} vs ${declared}`).toBe(stem(declared))
    }
  })

  it('does not mangle short words into each other', () => {
    expect(stem('is')).toBe('is')
    expect(stem('use')).toBe('use')
    expect(new Set(['cat', 'car', 'can'].map(stem)).size).toBe(3)
  })
})

describe('learning from what actually worked', () => {
  it('routes better after seeing a plugin succeed on that phrasing', () => {
    // "handle the widget" matches nothing anyone declared.
    expect(router.rank('handle the widget')).toEqual([])
    for (let i = 0; i < 5; i++) router.learn('handle the widget', 'tools')
    expect(router.rank('handle the widget')[0].id).toBe('tools')
  })

  it('generalises to a related phrasing, not just the exact words', () => {
    for (let i = 0; i < 8; i++) router.learn('sort out the widget assembly', 'tools')
    // Different sentence, shared terms.
    expect(router.rank('the widget needs assembly')[0].id).toBe('tools')
  })

  it('cannot outvote someone typing another plugin’s literal command', () => {
    // Heavily reward the wrong plugin for these exact words.
    for (let i = 0; i < 200; i++) router.learn('store install skills demo', 'wiki')
    const ranked = router.rank('store install skills demo')
    expect(ranked[0].id).toBe('store')
  })

  it('caps how much reputation any one plugin can accumulate', () => {
    for (let i = 0; i < 500; i++) router.learn('widget', 'tools')
    const withLearning = router.rank('widget')[0].score
    expect(withLearning).toBeLessThanOrEqual(12 + 1)
  })

  it('fades old evidence rather than letting the first answer own a phrase forever', () => {
    for (let i = 0; i < 10; i++) router.learn('gadget', 'wiki')
    const early = router.rank('gadget').find(r => r.id === 'wiki')!.score
    // Lots of unrelated activity, which is what decays the old evidence.
    for (let i = 0; i < 400; i++) router.learn(`unrelated topic number ${i}`, 'camera')
    const later = router.rank('gadget').find(r => r.id === 'wiki')!.score
    expect(later).toBeLessThan(early)
  })

  it('learns nothing from an empty or filler-only message', () => {
    const before = router.memory.size()
    router.learn('', 'tools')
    router.learn('the a of to', 'tools')
    expect(router.memory.size()).toBe(before)
  })

  it('survives a save and reload', () => {
    for (let i = 0; i < 5; i++) router.learn('handle the widget', 'tools')
    const saved = JSON.parse(JSON.stringify(router.memory.export()))

    const fresh = new CapabilityRouter()
    fresh.reindex(plugins, {})
    expect(fresh.rank('handle the widget')).toEqual([])
    fresh.memory.import(saved)
    expect(fresh.rank('handle the widget')[0].id).toBe('tools')
  })

  it('ignores a corrupt saved file rather than refusing to route', () => {
    const fresh = new CapabilityRouter()
    fresh.reindex(plugins, {})
    for (const bad of [null, undefined, {}, { evidence: 'not an object' }]) {
      expect(() => fresh.memory.import(bad as never)).not.toThrow()
    }
    expect(fresh.rank('store install skills demo')[0].id).toBe('store')
  })

  it('stays bounded no matter how much it sees', () => {
    for (let i = 0; i < 6000; i++) router.learn(`distinct phrase number ${i} here`, 'tools')
    expect(router.memory.size()).toBeLessThanOrEqual(4000)
  })
})
