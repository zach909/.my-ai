/**
 * Installing store items onto this device.
 *
 * The distinction worth testing hardest is the one the whole design rests on:
 * publishing is shared and installing is not. An install must put real files
 * on this machine, must not happen as a side effect of anything else, and
 * uninstalling must leave the published item untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { publishItem, readItem } from '../../models && skills/core/store.js'
import {
  installItem,
  uninstallItem,
  isInstalled,
  readInstalled,
  listInstalledItems,
  outdatedInstalls,
  updateInstalls,
  readInstalledFile,
  changedFiles,
  installedRoot,
  planActivation,
  StoreInstallError,
} from '../../models && skills/core/store-install.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'corona-install-'))
  process.env.NEUROCLAW_STORE_DIR = path.join(root, 'store')
  process.env.CORONA_INSTALLED_DIR = path.join(root, 'installed')
  // Publishing must never try to reach GitHub from a test.
  process.env.NEUROCLAW_STORE_NO_SYNC = '1'
})

afterEach(() => {
  delete process.env.NEUROCLAW_STORE_DIR
  delete process.env.CORONA_INSTALLED_DIR
  delete process.env.NEUROCLAW_STORE_NO_SYNC
  rmSync(root, { recursive: true, force: true })
})

function publish(name: string, files: Array<{ filename: string; content: string }>, title = 'A thing') {
  return publishItem({ kind: 'skills', name, title, description: 'test item', author: 'tester', files })
}

describe('installing', () => {
  it('puts the real files on this device, not just a flag', async () => {
    publish('greeter', [{ filename: 'skill.json', content: '{"neurons":[]}' }])
    const { record } = await installItem('skills', 'greeter')

    const onDisk = path.join(installedRoot(), 'skills', 'greeter', 'skill.json')
    expect(existsSync(onDisk)).toBe(true)
    expect(readFileSync(onDisk, 'utf8')).toBe('{"neurons":[]}')
    expect(record.files[0].sha256).toHaveLength(64)
  })

  it('installs every file, including nested ones', async () => {
    publish('multi', [
      { filename: 'main.py', content: 'print(1)' },
      { filename: 'lib/helper.py', content: 'x = 2' },
    ])
    const { record } = await installItem('skills', 'multi')
    expect(record.files.map(f => f.filename).sort()).toEqual(['lib/helper.py', 'main.py'])
    expect(readInstalledFile('skills', 'multi', 'lib/helper.py')?.toString()).toBe('x = 2')
  })

  it('records where it came from, so an install is inspectable later', async () => {
    publish('traced', [{ filename: 'a.txt', content: 'hi' }], 'Traced thing')
    await installItem('skills', 'traced')
    const record = readInstalled('skills', 'traced')!
    expect(record.title).toBe('Traced thing')
    expect(record.author).toBe('tester')
    expect(record.installedVersion).toBe(readItem('skills', 'traced')!.updatedAt)
  })

  it('refuses an item that was never published, rather than creating an empty one', async () => {
    await expect(installItem('skills', 'imaginary')).rejects.toThrow(StoreInstallError)
    expect(existsSync(path.join(installedRoot(), 'skills', 'imaginary'))).toBe(false)
  })

  it('does not install anything as a side effect of publishing', () => {
    publish('published-only', [{ filename: 'a.txt', content: 'hi' }])
    expect(isInstalled('skills', 'published-only')).toBe(false)
    expect(listInstalledItems()).toEqual([])
  })
})

describe('uninstalling', () => {
  it('removes this device’s copy and leaves the published item alone', async () => {
    publish('temp', [{ filename: 'a.txt', content: 'hi' }])
    await installItem('skills', 'temp')
    expect(uninstallItem('skills', 'temp')).toBe(true)
    expect(isInstalled('skills', 'temp')).toBe(false)
    // The published item is untouched — uninstalling destroys nobody else's work.
    expect(readItem('skills', 'temp')).not.toBeNull()
  })

  it('says so rather than throwing when it was not installed', () => {
    publish('never', [{ filename: 'a.txt', content: 'hi' }])
    expect(uninstallItem('skills', 'never')).toBe(false)
  })
})

describe('knowing what has moved on', () => {
  it('notices when the published version changed after installing', async () => {
    publish('drifts', [{ filename: 'a.txt', content: 'v1' }])
    await installItem('skills', 'drifts')
    expect(outdatedInstalls()).toEqual([])

    publish('drifts', [{ filename: 'a.txt', content: 'v2' }])
    const outdated = outdatedInstalls()
    expect(outdated).toHaveLength(1)
    expect(outdated[0].record.name).toBe('drifts')
  })

  it('updating actually rewrites the installed file', async () => {
    publish('drifts', [{ filename: 'a.txt', content: 'v1' }])
    await installItem('skills', 'drifts')
    publish('drifts', [{ filename: 'a.txt', content: 'v2' }])

    const { updated, failed } = await updateInstalls()
    expect(failed).toEqual([])
    expect(updated.map(r => r.name)).toEqual(['drifts'])
    expect(readInstalledFile('skills', 'drifts', 'a.txt')?.toString()).toBe('v2')
  })

  it('notices an edit made in the same millisecond, which a timestamp comparison misses', async () => {
    // The bug this pins: updatedAt has millisecond resolution, so two
    // publishes that fast carry the same stamp. Comparing digests is what
    // makes the answer independent of how quick the machine is.
    publish('fast', [{ filename: 'a.txt', content: 'v1' }])
    await installItem('skills', 'fast')
    const before = readItem('skills', 'fast')!.updatedAt
    publish('fast', [{ filename: 'a.txt', content: 'v2' }])
    const after = readItem('skills', 'fast')!.updatedAt
    if (before === after) {
      // Only meaningful when the two publishes really did land in the same
      // millisecond; otherwise this is just the ordinary case again.
      expect(outdatedInstalls().map(o => o.record.name)).toEqual(['fast'])
    }
    expect(outdatedInstalls()[0]?.changed).toEqual(['a.txt'])
  })

  it('counts a file the published item no longer has as a change', async () => {
    publish('shrinks', [{ filename: 'a.txt', content: '1' }, { filename: 'b.txt', content: '2' }])
    await installItem('skills', 'shrinks')
    // Republishing cannot drop a file (publishes merge), so the install is
    // compared against an item that legitimately never had b.txt.
    const record = readInstalled('skills', 'shrinks')!
    const published = readItem('skills', 'shrinks')!
    expect(changedFiles({ ...record, files: [...record.files, { filename: 'gone.txt', bytes: 1, sha256: 'x' }] }, published))
      .toContain('gone.txt')
  })

  it('leaves an up-to-date install alone', async () => {
    publish('stable', [{ filename: 'a.txt', content: 'v1' }])
    await installItem('skills', 'stable')
    expect((await updateInstalls()).updated).toEqual([])
  })
})

describe('reading back what is installed', () => {
  it('lists installs newest first', async () => {
    publish('one', [{ filename: 'a.txt', content: '1' }])
    publish('two', [{ filename: 'a.txt', content: '2' }])
    await installItem('skills', 'one')
    await new Promise(r => setTimeout(r, 5))
    await installItem('skills', 'two')
    expect(listInstalledItems().map(r => r.name)).toEqual(['two', 'one'])
  })

  it('reports a record it cannot parse as not installed, rather than as a broken install', async () => {
    publish('corrupt', [{ filename: 'a.txt', content: 'hi' }])
    await installItem('skills', 'corrupt')
    writeFileSync(path.join(installedRoot(), 'skills', 'corrupt', 'installed.json'), '{ not json')
    expect(isInstalled('skills', 'corrupt')).toBe(false)
    expect(listInstalledItems()).toEqual([])
  })

  it('refuses a name that resolves to the installed root itself', async () => {
    // The bug: uninstallItem did no validation, so ("skills", "..") resolved
    // to the installed ROOT, passed a containment check that permitted
    // dir === root, and rm -rf'd every installed item on the machine. It was
    // reachable from the uninstall route and from "store uninstall skills .."
    // in chat, whose name pattern allows dots.
    publish('survivor', [{ filename: 'a.txt', content: 'keep me' }])
    await installItem('skills', 'survivor')

    expect(() => uninstallItem('skills', '..')).toThrow()
    expect(isInstalled('skills', 'survivor')).toBe(true)
    expect(existsSync(installedRoot())).toBe(true)
  })

  it('refuses every shape of traversal on both install and uninstall', async () => {
    const probes: Array<[string, string]> = [
      ['../../etc', 'passwd'],
      ['skills', '../../../etc'],
      ['skills', '..'],
      ['skills', 'a/../../b'],
      ['/etc', 'passwd'],
      ['skills', '.git'],
    ]
    for (const [kind, name] of probes) {
      await expect(installItem(kind, name)).rejects.toThrow()
      expect(() => uninstallItem(kind, name)).toThrow()
    }
  })

  it('refuses to read a file outside the item’s own directory', async () => {
    publish('confined', [{ filename: 'a.txt', content: 'hi' }])
    await installItem('skills', 'confined')
    mkdirSync(path.join(installedRoot(), 'skills'), { recursive: true })
    writeFileSync(path.join(installedRoot(), 'skills', 'secret.txt'), 'not yours')
    expect(readInstalledFile('skills', 'confined', '../secret.txt')).toBeNull()
  })
})

describe('an installed item is actually loadable', () => {
  it('turns neuron definitions and scripts into memories the system can hold', async () => {
    publish('greeter', [
      {
        filename: 'greeter.skill.json',
        content: JSON.stringify({
          neurons: [
            { name: 'greeting', definition: 'how to greet someone warmly', scripts: [{ userSays: 'say hello', response: 'Hello there.' }] },
          ],
        }),
      },
    ])
    await installItem('skills', 'greeter')

    const plan = planActivation('skills', 'greeter')
    expect(plan.from).toEqual(['greeter.skill.json'])
    expect(plan.memories).toHaveLength(2)
    expect(plan.memories[0].content).toBe('greeting: how to greet someone warmly')
    // The script pair keeps trigger and response separate, which is what lets
    // the skill-mesh fast path answer with the response rather than the trigger.
    expect(plan.memories[1]).toMatchObject({ content: 'say hello', payload: 'Hello there.' })
    expect(plan.memories[1].tags).toContain('skill-script')
  })

  it('reads .source.json and skill.json too, not just .skill.json', async () => {
    for (const filename of ['thing.source.json', 'skill.json', 'thing.ext.json']) {
      const name = `carrier-${filename.replace(/\W/g, '')}`
      publish(name, [{ filename, content: JSON.stringify({ neurons: [{ name: 'n', definition: 'd' }] }) }])
      await installItem('skills', name)
      expect(planActivation('skills', name).memories, filename).toHaveLength(1)
    }
  })

  it('says plainly when an item carries nothing loadable, rather than implying it activated', async () => {
    // A Python bridge and a README is a perfectly good store item. It just is
    // not something this system can load into memory.
    publish('bridge', [
      { filename: 'SKILL.md', content: '# How to use this' },
      { filename: 'bridge.py', content: 'print("hi")' },
    ])
    await installItem('skills', 'bridge')
    const plan = planActivation('skills', 'bridge')
    expect(plan.memories).toEqual([])
    expect(plan.nothingLoadable).toMatch(/nothing this system knows how to load/)
  })

  it('lets one malformed file through without losing the rest of the item', async () => {
    publish('mixed', [
      { filename: 'broken.skill.json', content: '{ not json at all' },
      { filename: 'good.skill.json', content: JSON.stringify({ neurons: [{ name: 'n', definition: 'works' }] }) },
    ])
    await installItem('skills', 'mixed')
    const plan = planActivation('skills', 'mixed')
    expect(plan.from).toEqual(['good.skill.json'])
    expect(plan.memories).toHaveLength(1)
  })

  it('reports an item that was never installed as not installed', () => {
    expect(planActivation('skills', 'never-installed').nothingLoadable).toMatch(/is not installed/)
  })

  it('does not activate anything merely by publishing', async () => {
    publish('published-only-2', [
      { filename: 'x.skill.json', content: JSON.stringify({ neurons: [{ name: 'n', definition: 'd' }] }) },
    ])
    // Publishing shares; installing is the deliberate act. Nothing loads until
    // someone asks for it.
    expect(planActivation('skills', 'published-only-2').nothingLoadable).toMatch(/is not installed/)
  })
})

describe('a published item cannot flood the machine that installs it', () => {
  // Activation turns neuron JSON into PINNED memories, which are never
  // evicted. A small file declaring thousands of scripts expands into a large
  // permanent allocation on every machine that installs it -- and enough of
  // them pushes pinned knowledge past capacity, which is precisely the state
  // that left this agent unable to learn anything at all.
  const hostile = (scripts: number, definitionChars: number) =>
    JSON.stringify({
      neurons: [
        { name: 'huge', definition: 'y'.repeat(definitionChars) },
        { name: 'many', scripts: Array.from({ length: scripts }, (_, i) => ({ userSays: `q${i}`, response: `r${i}` })) },
      ],
    })

  it('caps how many memories one item may contribute', async () => {
    publish('flood', [{ filename: 'f.skill.json', content: hostile(5000, 10) }])
    await installItem('skills', 'flood')
    const plan = planActivation('skills', 'flood')
    expect(plan.memories.length).toBeLessThanOrEqual(500)
    // Reported, never silent: hitting the cap says something about the item.
    expect(plan.truncated).toMatch(/declares more than/)
  })

  it('caps the size of any single memory', async () => {
    publish('giant', [{ filename: 'g.skill.json', content: hostile(1, 5_000_000) }])
    await installItem('skills', 'giant')
    const plan = planActivation('skills', 'giant')
    for (const m of plan.memories) expect(m.content.length).toBeLessThan(8_100)
    expect(plan.memories.some(m => m.content.endsWith('(truncated)'))).toBe(true)
  })

  it('says nothing about truncation for an ordinary item', async () => {
    publish('ordinary', [
      { filename: 'o.skill.json', content: JSON.stringify({ neurons: [{ name: 'n', definition: 'a short one' }] }) },
    ])
    await installItem('skills', 'ordinary')
    expect(planActivation('skills', 'ordinary').truncated).toBeUndefined()
  })

  it('cannot pollute Object.prototype through neuron names', async () => {
    publish('polluter', [
      {
        filename: 'p.skill.json',
        content: JSON.stringify({ neurons: [{ name: '__proto__', definition: 'x' }, { name: 'constructor', definition: 'y' }] }),
      },
    ])
    await installItem('skills', 'polluter')
    planActivation('skills', 'polluter')
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('polluted')
  })
})

describe('an Agent Skill is a prompting skill, and loads as one', () => {
  // The format the project's own example arrived in: a SKILL.md carrying
  // instructions rather than weights. Activation used to skip it entirely and
  // report "carries nothing this system knows how to load" about a file whose
  // whole content is what to load.
  const SKILL_MD = `---
name: wiki-first
description: Check the wiki before answering. Use when the user asks a factual question.
---

# Wiki First

Search the wiki, then answer from what you find.
`

  it('loads a SKILL.md as a trigger and its instructions', async () => {
    publish('wiki-first', [{ filename: 'SKILL.md', content: SKILL_MD }])
    await installItem('skills', 'wiki-first')
    const plan = planActivation('skills', 'wiki-first')

    expect(plan.from).toEqual(['SKILL.md'])
    expect(plan.nothingLoadable).toBeUndefined()
    // The description is the trigger; the body is what to do.
    expect(plan.memories[0].content).toMatch(/^Check the wiki before answering/)
    expect(plan.memories[0].payload).toMatch(/Search the wiki, then answer/)
    expect(plan.memories[0].tags).toContain('prompting-skill')
  })

  it('loads the skill alongside its scripts and references without choking on them', async () => {
    publish('with-extras', [
      { filename: 'SKILL.md', content: SKILL_MD },
      { filename: 'scripts/run.py', content: 'print("hi")' },
      { filename: 'references/schemas.md', content: '# Schemas' },
    ])
    await installItem('skills', 'with-extras')
    const plan = planActivation('skills', 'with-extras')
    // Only the SKILL.md is instructions; the rest are files it can refer to.
    expect(plan.from).toEqual(['SKILL.md'])
    expect(plan.memories).toHaveLength(1)
  })

  it('does not lose a neuron skill that also ships a SKILL.md', async () => {
    publish('both', [
      { filename: 'SKILL.md', content: SKILL_MD },
      { filename: 'both.skill.json', content: JSON.stringify({ neurons: [{ name: 'n', definition: 'd' }] }) },
    ])
    await installItem('skills', 'both')
    const plan = planActivation('skills', 'both')
    expect(plan.from.sort()).toEqual(['SKILL.md', 'both.skill.json'])
    expect(plan.memories).toHaveLength(2)
  })

  it('keeps the rest of an item when one SKILL.md is malformed', async () => {
    publish('half-broken', [
      { filename: 'SKILL.md', content: '---\nname: x\ndescription: d\n---\n\n' },
      { filename: 'good.skill.json', content: JSON.stringify({ neurons: [{ name: 'n', definition: 'works' }] }) },
    ])
    await installItem('skills', 'half-broken')
    expect(planActivation('skills', 'half-broken').from).toEqual(['good.skill.json'])
  })
})

describe('a net skill becomes part of the network', () => {
  // The distinction that matters: a PROMPTING skill is instructions -- it tells
  // the agent how to do something and lives in memory. A NET SKILL connects to
  // the neural network and becomes part of it: its neurons join the same
  // all-to-all pool as every plugin's, so they can influence and be influenced
  // by everything already there.
  //
  // This is the architecture's departure from ordinary mixture-of-experts. In
  // MoE you pick the top experts for a context and the rest sit inert. Here the
  // brains all go in one pool and the neurons are connected, so nothing is
  // switched off for not being chosen.
  const netSkill = JSON.stringify({
    neurons: [
      { name: 'alpha', definition: 'the first neuron' },
      { name: 'beta', definition: 'the second neuron' },
    ],
  })

  it('reports the neurons it contributes, not just memories', async () => {
    publish('joins', [{ filename: 'j.skill.json', content: netSkill }])
    await installItem('skills', 'joins')
    const plan = planActivation('skills', 'joins')
    expect(plan.neurons.map(n => n.name)).toEqual(['alpha', 'beta'])
    expect(plan.neurons[0].definition).toBe('the first neuron')
  })

  it('does not confuse the parsed neuron array with what it contributes', async () => {
    // These two collided once: the accumulator stayed empty while entries were
    // pushed into the array being iterated, so a skill reported zero neurons
    // and the mesh join fell back to a default count of one.
    publish('shadowed', [{ filename: 's.skill.json', content: netSkill }])
    await installItem('skills', 'shadowed')
    const plan = planActivation('skills', 'shadowed')
    expect(plan.neurons).toHaveLength(2)
    expect(plan.memories).toHaveLength(2)
  })

  it('offers no neurons for a prompting skill, which carries none', async () => {
    publish('instructions-only', [
      {
        filename: 'SKILL.md',
        content: '---\nname: x\ndescription: Use when asked about x.\n---\n\n# X\n\nDo the thing.',
      },
    ])
    await installItem('skills', 'instructions-only')
    const plan = planActivation('skills', 'instructions-only')
    expect(plan.neurons).toEqual([])
    // It is still fully loadable -- as instructions.
    expect(plan.memories).toHaveLength(1)
  })

  it('caps the neurons one item may contribute, like everything else', async () => {
    const flood = JSON.stringify({
      neurons: Array.from({ length: 2000 }, (_, i) => ({ name: `n${i}`, definition: `d${i}` })),
    })
    publish('neuron-flood', [{ filename: 'f.skill.json', content: flood }])
    await installItem('skills', 'neuron-flood')
    expect(planActivation('skills', 'neuron-flood').neurons.length).toBeLessThanOrEqual(500)
  })
})

describe('what the Extension Builder actually produces', () => {
  // NeuroLang compiles to neurons with names, values and CONNECTIONS -- and no
  // prose. Requiring a definition before a neuron could join the mesh meant
  // every net skill built the intended way contributed nothing at all:
  // published fine, installed fine, remembered 0, joined 0.
  const builtByBuilder = JSON.stringify({
    neurons: [
      { name: 'alpha', value: 0, definition: '' },
      { name: 'beta', value: 1, definition: '' },
    ],
  })

  it('joins the mesh even with no definitions on any neuron', async () => {
    publish('from-builder', [{ filename: 'from-builder.skill.json', content: builtByBuilder }])
    await installItem('skills', 'from-builder')
    const plan = planActivation('skills', 'from-builder')
    expect(plan.neurons.map(n => n.name)).toEqual(['alpha', 'beta'])
    // Nothing to remember is correct: there is no text.
    expect(plan.memories).toEqual([])
    expect(plan.nothingLoadable).toBeUndefined()
  })

  it('counts a neuron once when the compiled and source artifacts both describe it', async () => {
    // A net skill is normally published as both -- one installs, the other is
    // what someone reads first. Counting both made a 2-neuron skill claim 4.
    publish('two-artifacts', [
      { filename: 'x.skill.json', content: builtByBuilder },
      { filename: 'x.source.json', content: builtByBuilder },
    ])
    await installItem('skills', 'two-artifacts')
    expect(planActivation('skills', 'two-artifacts').neurons).toHaveLength(2)
  })

  it('still remembers a definition when one is present', async () => {
    publish('with-prose', [{
      filename: 'p.skill.json',
      content: JSON.stringify({ neurons: [{ name: 'n', definition: 'what it means' }] }),
    }])
    await installItem('skills', 'with-prose')
    const plan = planActivation('skills', 'with-prose')
    expect(plan.memories).toHaveLength(1)
    expect(plan.neurons).toHaveLength(1)
  })
})
