/**
 * Prompting skills only mean anything if the loop genuinely calls them, so
 * these tests drive the real perceive-think-act cycle rather than asserting
 * that the documents parse.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  PROMPTING_CATEGORIES,
  PromptingSkillRegistry,
  PromptingSkillError,
  builtInPromptingSkills,
  fillTemplate,
  parsePromptingSkill,
  skillApplies,
} from '../../models && skills/core/prompting-skills.js'
import { runAgentLoop, type AgentCapabilities } from '../../models && skills/core/agent-loop.js'
import {
  installPromptingSkill,
  listInstalled,
  loadRegistry,
  uninstallPromptingSkill,
} from '../../models && skills/core/prompting-skill-store.js'

describe('prompting skill documents', () => {
  it('accepts one of each category', () => {
    for (const category of PROMPTING_CATEGORIES) {
      const body =
        category === 'perception'
          ? { source: 'memory' }
          : category === 'cognitive'
            ? { strategy: 'decompose' }
            : { plugin: 'tools' }
      const skill = parsePromptingSkill({ name: `a-${category}`, category, ...body })
      expect(skill.category).toBe(category)
    }
  })

  it('refuses an unknown source or strategy by name, rather than ignoring it', () => {
    // A typo that silently produced a skill which never fires is far harder to
    // debug than one that fails at the door.
    expect(() => parsePromptingSkill({ name: 'x', category: 'perception', source: 'internet' }))
      .toThrow(/not a perception source/)
    expect(() => parsePromptingSkill({ name: 'x', category: 'cognitive', strategy: 'vibes' }))
      .toThrow(/not a strategy/)
    expect(() => parsePromptingSkill({ name: 'x', category: 'telepathy' }))
      .toThrow(/not a category/)
  })

  it('refuses a name that could escape its folder', () => {
    for (const name of ['../evil', 'a/b', '..', '']) {
      expect(() => parsePromptingSkill({ name, category: 'cognitive', strategy: 'decompose' }))
        .toThrow(PromptingSkillError)
    }
  })

  it('substitutes only the two supported variables, and evaluates nothing', () => {
    expect(fillTemplate('find {goal} after {observation}', { goal: 'a flight', observation: 'sold out' }))
      .toBe('find a flight after sold out')
    // Anything that looks like an expression stays literal text.
    expect(fillTemplate('{process.exit(1)} {goal}', { goal: 'g' })).toBe('{process.exit(1)} g')
  })

  it('applies always when it has no trigger, and selectively when it has one', () => {
    const always = parsePromptingSkill({ name: 'a', category: 'cognitive', strategy: 'decompose' })
    const picky = parsePromptingSkill({
      name: 'b', category: 'cognitive', strategy: 'decompose', when: ['flight'],
    })
    expect(skillApplies(always, 'anything at all')).toBe(true)
    expect(skillApplies(picky, 'book a FLIGHT to London')).toBe(true)
    expect(skillApplies(picky, 'make me a sandwich')).toBe(false)
    // The latest observation counts too, so a skill can fire on what came back.
    expect(skillApplies(picky, 'make me a sandwich', 'no flight available')).toBe(true)
  })
})

describe('the registry', () => {
  it('orders by priority then name, so two runs behave identically', () => {
    const r = new PromptingSkillRegistry()
    for (const [name, priority] of [['b', 5], ['a', 5], ['c', 99]] as const) {
      r.install(parsePromptingSkill({ name, category: 'cognitive', strategy: 'decompose', priority }))
    }
    expect(r.all().map(s => s.name)).toEqual(['c', 'a', 'b'])
  })

  it('replaces by name, which is what makes an edit take effect', () => {
    const r = new PromptingSkillRegistry()
    r.install(parsePromptingSkill({ name: 'x', category: 'cognitive', strategy: 'decompose', title: 'first' }))
    r.install(parsePromptingSkill({ name: 'x', category: 'cognitive', strategy: 'plan-next-step', title: 'second' }))
    expect(r.size()).toBe(1)
    expect(r.get('x')?.strategy).toBe('plan-next-step')
  })
})

describe('the perceive-think-act loop', () => {
  const registryWith = (...docs: unknown[]) => {
    const r = new PromptingSkillRegistry()
    for (const d of docs) r.install(parsePromptingSkill(d))
    return r
  }

  it('runs perception, cognition and action in that order, through the installed skills', async () => {
    const calls: string[] = []
    const caps: AgentCapabilities = {
      recall: q => { calls.push(`recall:${q}`); return ['the flight is on Tuesday'] },
      decompose: g => { calls.push(`decompose:${g}`); return ['check price', 'book it'] },
      callPlugin: (id, input) => { calls.push(`plugin:${id}:${input}`); return 'booked' },
      isGoalMet: (_g, obs) => obs.includes('booked'),
    }
    const registry = registryWith(
      { name: 'look', category: 'perception', source: 'memory', query: '{goal}' },
      { name: 'plan', category: 'cognitive', strategy: 'decompose' },
      { name: 'do', category: 'action', plugin: 'booking', input: 'book {goal}' },
    )

    const result = await runAgentLoop('find the flight to London', registry, caps)

    expect(result.outcome).toBe('goal-met')
    expect(result.iterations).toBe(1)
    expect(calls).toEqual([
      'recall:find the flight to London',
      'decompose:find the flight to London',
      'plugin:booking:book find the flight to London',
    ])
    expect(result.steps.map(s => s.phase)).toEqual(['perceive', 'think', 'act', 'observe'])
  })

  it('loops again on failure and terminates at the ceiling rather than hanging', async () => {
    let attempts = 0
    const caps: AgentCapabilities = {
      recall: () => ['nothing useful'],
      callPlugin: () => { attempts++; return 'sold out' },
      isGoalMet: () => false,
    }
    const registry = registryWith(
      { name: 'look', category: 'perception', source: 'memory' },
      { name: 'do', category: 'action', plugin: 'booking' },
    )

    const result = await runAgentLoop('book a flight', registry, caps, { maxIterations: 3 })

    expect(result.outcome).toBe('max-iterations')
    expect(result.iterations).toBe(3)
    expect(attempts).toBe(3)
  })

  it('stops honestly at a dead end instead of looping to look busy', async () => {
    // No capabilities wired up at all: there is genuinely nothing to try, and
    // running to the ceiling would just be theatre.
    const registry = registryWith({ name: 'look', category: 'perception', source: 'memory' })
    const result = await runAgentLoop('do something', registry, {}, { maxIterations: 10 })
    expect(result.outcome).toBe('dead-end')
    expect(result.iterations).toBe(1)
  })

  it('records a failing action as a step with its error, rather than losing it', async () => {
    const caps: AgentCapabilities = {
      recall: () => ['context'],
      callPlugin: () => { throw new Error('the flight is sold out') },
      isGoalMet: () => false,
    }
    const registry = registryWith(
      { name: 'look', category: 'perception', source: 'memory' },
      { name: 'do', category: 'action', plugin: 'booking' },
    )
    const result = await runAgentLoop('book it', registry, caps, { maxIterations: 1 })
    const failed = result.steps.find(s => s.phase === 'act')
    expect(failed?.error).toMatch(/sold out/)
  })

  it('takes exactly one action per iteration -- the highest priority one', async () => {
    const fired: string[] = []
    const caps: AgentCapabilities = {
      callPlugin: id => { fired.push(id); return 'ok' },
      recall: () => ['x'],
      isGoalMet: () => true,
    }
    const registry = registryWith(
      { name: 'look', category: 'perception', source: 'memory' },
      { name: 'low', category: 'action', plugin: 'plugin-low', priority: 1 },
      { name: 'high', category: 'action', plugin: 'plugin-high', priority: 50 },
    )
    await runAgentLoop('go', registry, caps)
    // Firing every applicable action would mean several side effects for one
    // decision, which is not what "select an action" means.
    expect(fired).toEqual(['plugin-high'])
  })

  it('a skill naming a capability this machine does not expose contributes nothing, and does not crash', async () => {
    const registry = registryWith(
      { name: 'wiki-look', category: 'perception', source: 'wiki' },
      { name: 'think', category: 'cognitive', strategy: 'plan-next-step' },
    )
    const result = await runAgentLoop('anything', registry, {}, { maxIterations: 1 })
    expect(result.steps.find(s => s.skill === 'wiki-look')?.detail).toBe('found nothing')
    expect(result.outcome).toBe('max-iterations')
  })
})

describe('installing', () => {
  let dir: string
  let prev: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'prompting-'))
    prev = process.env.NEUROCLAW_PROMPTING_DIR
    process.env.NEUROCLAW_PROMPTING_DIR = dir
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.NEUROCLAW_PROMPTING_DIR
    else process.env.NEUROCLAW_PROMPTING_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  })

  it('a fresh machine already has a working loop from the built-ins', () => {
    expect(listInstalled()).toEqual([])
    const active = loadRegistry().all()
    expect(active.length).toBe(builtInPromptingSkills().length)
    // One of each category, so no step of the loop is empty out of the box.
    for (const category of PROMPTING_CATEGORIES) {
      expect(active.some(s => s.category === category)).toBe(true)
    }
  })

  it('installing adds to the active set, and uninstalling removes it', () => {
    installPromptingSkill({ name: 'mine', category: 'cognitive', strategy: 'recall-lessons' })
    expect(loadRegistry().get('mine')?.strategy).toBe('recall-lessons')
    expect(uninstallPromptingSkill('mine')).toBe(true)
    expect(loadRegistry().get('mine')).toBeUndefined()
  })

  it('installing over a built-in replaces it, and uninstalling restores it', () => {
    const builtIn = builtInPromptingSkills()[0]
    installPromptingSkill({ ...builtIn, title: 'my version', description: 'changed' })
    expect(loadRegistry().get(builtIn.name)?.title).toBe('my version')
    uninstallPromptingSkill(builtIn.name)
    // The built-in comes back rather than leaving a hole -- editing one must
    // not be a way to permanently lose it.
    expect(loadRegistry().get(builtIn.name)?.title).toBe(builtIn.title)
  })

  it('refuses to install a malformed skill instead of writing a file the loop will choke on', () => {
    expect(() => installPromptingSkill({ name: 'bad', category: 'perception', source: 'telepathy' }))
      .toThrow(PromptingSkillError)
    expect(existsSync(path.join(dir, 'bad.json'))).toBe(false)
  })

  it('an installed skill genuinely changes what the loop does', async () => {
    const seen: string[] = []
    const caps: AgentCapabilities = { callPlugin: id => { seen.push(id); return 'done' }, isGoalMet: () => true }

    // Before: nothing installed, so no action skill matches this goal.
    await runAgentLoop('inspect the reactor', loadRegistry(), caps, { maxIterations: 1 })
    expect(seen).toEqual([])

    installPromptingSkill({
      name: 'inspect', category: 'action', plugin: 'reactor-tool', when: ['reactor'], priority: 500,
    })
    await runAgentLoop('inspect the reactor', loadRegistry(), caps, { maxIterations: 1 })
    expect(seen).toEqual(['reactor-tool'])
  })
})
