/**
 * The agent choosing its own tool.
 *
 * Before this, an action skill had to name the exact plugin id, so a skill
 * saying "do the thing" without knowing which tool does it was inert. The
 * distinction being tested is between an agent that must be told its tools and
 * one that can pick them.
 */

import { describe, it, expect } from 'vitest'
import { runAgentLoop } from '../../models && skills/core/agent-loop.js'
import { PromptingSkillRegistry, parsePromptingSkill } from '../../models && skills/core/prompting-skills.js'

function registryWith(skill: Record<string, unknown>) {
  const r = new PromptingSkillRegistry()
  r.install(parsePromptingSkill(skill))
  return r
}

/** An action skill that says what to do but not which tool does it. */
const namelessAction = {
  name: 'do-the-thing',
  category: 'action',
  input: '{goal}',
  priority: 10,
}

describe('picking a tool without being told which', () => {
  it('runs an action skill that names no plugin, by discovering one', async () => {
    const chosen: string[] = []
    const result = await runAgentLoop(
      'publish the catalogue entry',
      registryWith(namelessAction),
      {
        useBestTool: async (task: string) => {
          chosen.push(task)
          return { plugin: 'store', result: 'published it', why: 'names its command "store"' }
        },
        isGoalMet: (_g, obs) => obs.includes('published it'),
      },
      { maxIterations: 3 },
    )
    expect(chosen).toEqual(['publish the catalogue entry'])
    expect(result.outcome).toBe('goal-met')
    expect(result.observations).toContain('published it')
  })

  it('records which tool it chose and why, so a wrong choice is diagnosable', async () => {
    const result = await runAgentLoop(
      'do something',
      registryWith(namelessAction),
      {
        useBestTool: async () => ({ plugin: 'wiki', result: 'wrote a page', why: '2 matching terms' }),
        isGoalMet: () => true,
      },
      { maxIterations: 2 },
    )
    const act = result.steps.find(s => s.phase === 'act')!
    expect(act.detail).toContain('chose wiki')
    expect(act.detail).toContain('2 matching terms')
  })

  it('still prefers an explicitly named plugin over discovery', async () => {
    let discoveryUsed = false
    const result = await runAgentLoop(
      'do it',
      registryWith({ ...namelessAction, plugin: 'terminal' }),
      {
        callPlugin: async (id: string) => `ran ${id}`,
        useBestTool: async () => { discoveryUsed = true; return { plugin: 'other', result: 'x', why: 'y' } },
        isGoalMet: () => true,
      },
      { maxIterations: 2 },
    )
    // An author who named a plugin meant that plugin.
    expect(discoveryUsed).toBe(false)
    expect(result.observations).toContain('ran terminal')
  })

  it('does not claim to have acted when no tool could handle it', async () => {
    const result = await runAgentLoop(
      'something nothing handles',
      registryWith(namelessAction),
      { useBestTool: async () => null, isGoalMet: () => false },
      { maxIterations: 3 },
    )
    expect(result.outcome).not.toBe('goal-met')
    expect(result.observations).not.toContain('')
  })

  it('survives a tool that throws instead of failing the whole run', async () => {
    const result = await runAgentLoop(
      'do it',
      registryWith(namelessAction),
      {
        useBestTool: async () => { throw new Error('plugin exploded') },
        isGoalMet: () => false,
      },
      { maxIterations: 2 },
    )
    const failed = result.steps.find(s => s.error)
    expect(failed?.error).toContain('plugin exploded')
    expect(result.outcome).toBeDefined()
  })

  it('does nothing at all when the host offers no discovery', async () => {
    // A host that predates this must keep working, just without discovery.
    const result = await runAgentLoop(
      'do it',
      registryWith(namelessAction),
      { isGoalMet: () => false },
      { maxIterations: 2 },
    )
    expect(result.steps.filter(s => s.phase === 'act')).toHaveLength(0)
  })
})
