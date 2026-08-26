/**
 * Agent Skills: a SKILL.md and the files beside it.
 *
 * This is the format the project's own example arrived in, and for a long time
 * nothing here understood it. The example was filed under `skills/` -- the kind
 * meant for neuron weights -- the `prompting/` kind accepted only a narrow JSON
 * schema that cannot express it, and activation looked exclusively for neuron
 * JSON. Installing it reported "carries nothing this system knows how to load"
 * about a file whose entire content is what to load.
 */

import { describe, it, expect } from 'vitest'
import {
  parseAgentSkill,
  renderAgentSkill,
  isAgentSkillFile,
  AgentSkillError,
} from '../../models && skills/core/agent-skill.js'

const EXAMPLE = `---
name: skill-creator
description: Create new skills, modify and improve existing skills. Use when users want to create a skill from scratch.
---

# Skill Creator

A skill for creating new skills and iteratively improving them.
`

describe('recognising the format', () => {
  it('accepts SKILL.md in any case, and *.skill.md', () => {
    for (const f of ['SKILL.md', 'skill.md', 'thing.skill.md', 'nested/dir/SKILL.md']) {
      expect(isAgentSkillFile(f), f).toBe(true)
    }
  })

  it('does not mistake ordinary markdown for one', () => {
    for (const f of ['README.md', 'notes.md', 'skill.json', 'SKILLS.md']) {
      expect(isAgentSkillFile(f), f).toBe(false)
    }
  })
})

describe('parsing', () => {
  it('reads the name, description and body', () => {
    const skill = parseAgentSkill(EXAMPLE)
    expect(skill.name).toBe('skill-creator')
    expect(skill.description).toMatch(/^Create new skills/)
    expect(skill.body).toMatch(/^# Skill Creator/)
    expect(skill.body).not.toMatch(/^---/)
  })

  it('keeps a description containing colons intact', () => {
    // A naive split on ':' truncates exactly the descriptions this format
    // encourages, which all read "Use when: ..." or contain a URL.
    const skill = parseAgentSkill(`---
name: x
description: Does a thing. Use when: the user asks about https://example.com/docs
---

# X

body`)
    expect(skill.description).toBe('Does a thing. Use when: the user asks about https://example.com/docs')
  })

  it('strips quotes around a value', () => {
    expect(parseAgentSkill(`---\nname: "quoted"\ndescription: 'also quoted'\n---\n\nbody`).name).toBe('quoted')
  })

  it('preserves frontmatter keys it does not understand, rather than dropping them', () => {
    const skill = parseAgentSkill(`---\nname: x\ndescription: d\nlicense: MIT\nversion: 2\n---\n\nbody`)
    expect(skill.extra).toEqual({ license: 'MIT', version: '2' })
  })

  it('falls back to the heading when there is no name', () => {
    expect(parseAgentSkill(`# The Real Name\n\nsome instructions`).name).toBe('The Real Name')
  })

  it('falls back to the first paragraph when there is no description', () => {
    // Worse than a real description, and better than refusing to load over it.
    const skill = parseAgentSkill(`---\nname: x\n---\n\n# X\n\nWhat this actually does.\n\nMore detail.`)
    expect(skill.description).toBe('What this actually does.')
  })

  it('handles CRLF line endings', () => {
    expect(parseAgentSkill('---\r\nname: x\r\ndescription: d\r\n---\r\n\r\nbody').name).toBe('x')
  })

  it('refuses what genuinely has nothing usable', () => {
    expect(() => parseAgentSkill('')).toThrow(AgentSkillError)
    expect(() => parseAgentSkill('   ')).toThrow(AgentSkillError)
    expect(() => parseAgentSkill('---\nname: x\ndescription: d\n---\n\n')).toThrow(/no instructions/)
  })

  it('refuses a skill with no description, since that is its trigger', () => {
    // A body that is only a heading has nothing to say when it applies, so it
    // could never fire. Loading it would put an empty trigger into memory.
    expect(() => parseAgentSkill('---\nname: x\n---\n\n# Just A Heading')).toThrow(/nothing to say when it applies/)
  })

  it('takes a fallback name from the item it came from', () => {
    expect(parseAgentSkill('just some instructions with no heading', 'from-the-store').name).toBe('from-the-store')
  })
})

describe('round-tripping', () => {
  it('renders back to the same format', () => {
    const skill = parseAgentSkill(EXAMPLE)
    const reparsed = parseAgentSkill(renderAgentSkill(skill))
    expect(reparsed.name).toBe(skill.name)
    expect(reparsed.description).toBe(skill.description)
    expect(reparsed.body).toBe(skill.body)
  })

  it('keeps unknown keys through a round trip', () => {
    const skill = parseAgentSkill(`---\nname: x\ndescription: d\nlicense: MIT\n---\n\nbody`)
    expect(parseAgentSkill(renderAgentSkill(skill)).extra).toEqual({ license: 'MIT' })
  })
})
