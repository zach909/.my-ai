/**
 * The agent gives chat groups proper topic names, on top of the instant
 * keyword filing, without ever leaving a chat unfiled or losing its fallback.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ChatHistoryStore } from '../../models && skills/core/chat-history-store.js'
import { titleGroupsWithAgent, titlePrompt, DEFAULT_TITLE_GAP_MS } from '../../models && skills/core/agent-organizer.js'

let tmp: string
let store: ChatHistoryStore
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'agent-organizer-'))
  store = new ChatHistoryStore(tmp)
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const say = (content: string, threadId?: string) => store.appendMessage({ role: 'user', content, timestamp: Date.now() }, 'chat', threadId)

describe('agent-named chat groups', () => {
  it('files chats with no agent at all, exactly as before', () => {
    const t = say('docker compose networking problem with the server')
    expect(store.groupForThread(t.id)?.name).toMatch(/docker|compose|networking|server|problem/)
    expect(store.groupForThread(t.id)?.title).toBeUndefined()
  })

  it('asks the agent about what is in the group and stores its title beside the keyword name', async () => {
    const t = say('docker compose networking problem with the server')
    say('how do I expose a port in docker compose', t.id)
    const asked: string[] = []
    const r = await titleGroupsWithAgent(store, async p => { asked.push(p); return '"Docker networking".' })
    expect(r).toEqual({ asked: 1, titled: 1 })
    expect(asked[0]).toContain('docker compose networking problem')
    expect(asked[0]).toContain('Reply with the name only')
    const g = store.groupForThread(t.id)!
    expect(g.title).toBe('Docker networking')
    expect(g.name).toBeTruthy() // the keyword name is still there
  })

  it('the agent\'s title survives later saves, which rewrite the keyword name', async () => {
    const t = say('docker compose networking problem with the server')
    await titleGroupsWithAgent(store, async () => 'Docker networking')
    say('and another docker compose question about volumes', t.id)
    expect(store.groupForThread(t.id)?.title).toBe('Docker networking')
  })

  it('does not ask again until the group changes', async () => {
    const t = say('docker compose networking problem with the server')
    let calls = 0
    const think = async () => { calls++; return 'Docker networking' }
    let now = 1_000_000
    await titleGroupsWithAgent(store, think, { now: () => now })
    await titleGroupsWithAgent(store, think, { now: () => now + DEFAULT_TITLE_GAP_MS * 2 })
    expect(calls).toBe(1) // same members, already named
    say('a second thread about the docker compose server networking problem')
    expect(store.listGroups()).toHaveLength(1) // it joined the same group, so this is the group growing
    expect(store.listGroups()[0].threadIds).toHaveLength(2)
    now += DEFAULT_TITLE_GAP_MS * 3
    await titleGroupsWithAgent(store, think, { now: () => now })
    expect(calls).toBe(2) // it grew, so it is looked at again
    expect(t.id).toBeTruthy()
  })

  it('does not hammer the agent: a group is not asked again inside the gap, even if it changed', async () => {
    say('docker compose networking problem with the server')
    let calls = 0
    const think = async () => { calls++; return 'Docker networking' }
    await titleGroupsWithAgent(store, think)
    say('another docker compose server networking problem here')
    await titleGroupsWithAgent(store, think)
    expect(calls).toBe(1)
  })

  it('keeps the keyword name, and stops asking for a while, when the reply is unusable', async () => {
    const t = say('docker compose networking problem with the server')
    let calls = 0
    const junk = async () => { calls++; return '¿¿ <script>x</script> ???' }
    const r = await titleGroupsWithAgent(store, junk)
    expect(r).toEqual({ asked: 1, titled: 0 })
    expect(store.groupForThread(t.id)?.title).toBeUndefined()
    expect(store.groupForThread(t.id)?.name).toBeTruthy()
    await titleGroupsWithAgent(store, junk)
    expect(calls).toBe(1)
  })

  it('treats an agent that throws as having said nothing', async () => {
    say('docker compose networking problem with the server')
    const r = await titleGroupsWithAgent(store, async () => { throw new Error('mesh busy') })
    expect(r).toEqual({ asked: 1, titled: 0 })
  })

  it('names only a few groups per pass', async () => {
    say('docker compose networking problem with the server')
    say('baking sourdough bread starter hydration schedule')
    say('chess endgame rook pawn opposition technique')
    let calls = 0
    const r = await titleGroupsWithAgent(store, async () => { calls++; return `Topic ${calls}` }, { limit: 2 })
    expect(r.asked).toBe(2)
    expect(store.listGroups().filter(g => g.title).length).toBe(2)
  })

  it('shows the chats in the prompt trimmed, five at most', () => {
    const p = titlePrompt(['a', 'b'])
    expect(p).toContain('- a\n- b')
  })
})
