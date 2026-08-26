/**
 * The agent publishing its own work to the store.
 *
 * Two properties matter more here than anywhere else, because no person is
 * watching when this runs: it must not republish identical content on a timer
 * (which would bury real changes in noise), and it must never install what it
 * publishes (which would silently change every machine that pulls).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readItem } from '../../models && skills/core/store.js'
import {
  publishSkillToStore,
  changedAgainstStore,
  describeAutonomousSkill,
  AGENT_AUTHOR,
} from '../../models && skills/core/store-autonomy.js'
import { installedRoot, listInstalledItems } from '../../models && skills/core/store-install.js'

let root: string
const artifacts = (body: string) => [
  { filename: 'SKILL.md', content: `# Thing\n\n${body}` },
  { filename: 'thing.skill.json', content: '{"neurons":[]}' },
]

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'autonomy-'))
  process.env.NEUROCLAW_STORE_DIR = path.join(root, 'store')
  process.env.CORONA_INSTALLED_DIR = path.join(root, 'installed')
  process.env.NEUROCLAW_STORE_NO_SYNC = '1'
})
afterEach(() => {
  delete process.env.NEUROCLAW_STORE_DIR
  delete process.env.CORONA_INSTALLED_DIR
  delete process.env.NEUROCLAW_STORE_NO_SYNC
  rmSync(root, { recursive: true, force: true })
})

describe('publishing its own work', () => {
  it('puts a skill it built into the catalogue', async () => {
    const res = await publishSkillToStore({
      name: 'thing', title: 'A Thing', description: 'about a thing', artifacts: artifacts('first'),
    })
    expect('item' in res && res.item.name).toBe('thing')
    const item = readItem('skills', 'thing')!
    expect(item.files.map(f => f.filename).sort()).toEqual(['SKILL.md', 'thing.skill.json'])
  })

  it('labels it as machine-written, so nobody has to infer that', async () => {
    await publishSkillToStore({ name: 'thing', title: 'A Thing', description: 'x', artifacts: artifacts('a') })
    expect(readItem('skills', 'thing')!.author).toBe(AGENT_AUTHOR)
  })

  it('says in the description that no person reviewed it', () => {
    const text = describeAutonomousSkill('quantum error correction', 3)
    expect(text).toMatch(/No person reviewed it/)
    expect(text).toMatch(/3 corroborated sources/)
    expect(describeAutonomousSkill('x', 1)).toMatch(/1 corroborated source\b/)
  })
})

describe('not republishing what has not changed', () => {
  it('skips entirely when the content is identical', async () => {
    await publishSkillToStore({ name: 'thing', title: 'A Thing', description: 'x', artifacts: artifacts('same') })
    const second = await publishSkillToStore({
      name: 'thing', title: 'A Thing', description: 'x', artifacts: artifacts('same'),
    })
    expect('skipped' in second && second.skipped).toBe('unchanged')
  })

  it('republishes only the files that actually differ', async () => {
    await publishSkillToStore({ name: 'thing', title: 'A Thing', description: 'x', artifacts: artifacts('v1') })
    const second = await publishSkillToStore({
      name: 'thing', title: 'A Thing', description: 'x', artifacts: artifacts('v2'),
    })
    expect('changed' in second && second.changed).toEqual(['SKILL.md'])
    expect('updated' in second && second.updated).toBe(true)
  })

  it('keeps the files it did not resend', async () => {
    await publishSkillToStore({ name: 'thing', title: 'A Thing', description: 'x', artifacts: artifacts('v1') })
    await publishSkillToStore({ name: 'thing', title: 'A Thing', description: 'x', artifacts: artifacts('v2') })
    expect(readItem('skills', 'thing')!.files.map(f => f.filename).sort())
      .toEqual(['SKILL.md', 'thing.skill.json'])
  })

  it('reports everything as changed when nothing is published yet', () => {
    expect(changedAgainstStore('skills', 'absent', artifacts('x'))).toEqual(['SKILL.md', 'thing.skill.json'])
  })
})

describe('the line it must not cross', () => {
  it('does not install what it publishes, on this machine or any other', async () => {
    await publishSkillToStore({ name: 'thing', title: 'A Thing', description: 'x', artifacts: artifacts('a') })
    expect(listInstalledItems()).toEqual([])
    expect(existsSync(installedRoot())).toBe(false)
  })

  it('exposes no way to delete a published item', async () => {
    const mod = await import('../../models && skills/core/store-autonomy.js')
    expect(Object.keys(mod).some(k => /delete|remove|destroy|unpublish/i.test(k))).toBe(false)
  })
})
