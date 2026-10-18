/**
 * The agent's routes: anyone signed in can see how it stands (the page draws it
 * and its goodbye from that), and only the admin can change anything.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { handleAgentRoutes, DELETE_PHRASE } from '../../interface/agent-routes.js'
import { agentFilePath, decoyPath, reloadAgent, sandboxDir } from '../../models && skills/core/agent-profile.js'
import { runAs, OWNER, type Who } from '../../models && skills/core/user-context.js'
import { AccessManager } from '../../models && skills/core/access-manager.js'
import { sandboxRoot } from '../../models && skills/core/danger-protocol.js'

let server: http.Server
let base: string
let dir: string
const saved = { data: process.env.CORONA_DATA_DIR, safety: process.env.CORONA_SAFETY_FILE }
const manager = new AccessManager([{ capability: 'terminal.execute', level: 'execute' }, { capability: 'files.read', level: 'observe' }])
manager.setSandboxSource(() => sandboxRoot())

const whoOf = (req: http.IncomingMessage): Who => {
  const h = req.headers['x-who']
  if (h === 'user') return { kind: 'user', id: 'u1', name: 'sam', role: 'user' }
  return OWNER
}
async function body(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    await runAs(whoOf(req), async () => {
      const handled = await handleAgentRoutes({
        req, res, pathname: url.pathname, method: req.method ?? 'GET',
        parseBody: r => body(r),
        sendJson: (r, data, status = 200) => { r.writeHead(status, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(data)) },
        access: async () => manager,
      })
      if (!handled) { res.writeHead(404); res.end('{}') }
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => new Promise<void>(r => server.close(() => r())))
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'agent-routes-'))
  process.env.CORONA_DATA_DIR = dir
  process.env.CORONA_SAFETY_FILE = path.join(dir, 'safety.json')
  reloadAgent()
})
afterEach(() => {
  for (const [k, v] of [['CORONA_DATA_DIR', saved.data], ['CORONA_SAFETY_FILE', saved.safety]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  reloadAgent()
  rmSync(dir, { recursive: true, force: true })
})

const call = async (method: string, p: string, json?: unknown, who = 'owner') => {
  const r = await fetch(base + p, { method, headers: { 'x-who': who, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: json !== undefined ? JSON.stringify(json) : undefined })
  return { status: r.status, json: (await r.json().catch(() => null)) as any }
}

describe('seeing the agent', () => {
  it('a regular user gets the state, the look and the band, and nothing about the settings', async () => {
    const r = await call('GET', '/api/agent', undefined, 'user')
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ state: 'alive', look: 'shoggoth', band: { id: 'neutral', label: 'Neutral' } })
    for (const k of ['sandbox', 'armed', 'events', 'capabilities', 'decoy', 'phrases']) expect(r.json[k]).toBeUndefined()
  })

  it('the admin also sees the scale, the events, the settings and what the agent can do', async () => {
    const r = await call('GET', '/api/agent')
    expect(r.json.bands.map((b: any) => b.id)).toEqual(['malicious', 'hostile', 'wary', 'neutral', 'friendly'])
    expect(r.json).toMatchObject({ armed: true, sandbox: { setting: false, effective: false }, mayActAlone: true, phrases: { delete: DELETE_PHRASE } })
    const ids = r.json.capabilities.map((c: any) => c.id)
    expect(ids).toContain('terminal')
    expect(ids).toContain('access:terminal.execute')
  })

  it('looking plants the decoy switch for the agent to find', async () => {
    await call('GET', '/api/agent')
    expect(existsSync(decoyPath())).toBe(true)
  })
})

describe('changing the agent', () => {
  it('is for the admin only', async () => {
    for (const [p, b] of [['/api/agent/sandbox', { on: true }], ['/api/agent/alignment', { armed: false, confirm: true }], ['/api/agent/forgive', {}], ['/api/agent/delete', { phrase: DELETE_PHRASE }], ['/api/agent/create', {}]] as const) {
      expect((await call('POST', p, b, 'user')).status, p).toBe(403)
    }
    expect(existsSync(agentFilePath())).toBe(false)
  })

  it('turns the sandbox on and off, and the capabilities say so', async () => {
    let r = await call('POST', '/api/agent/sandbox', { on: true })
    expect(r.json.sandbox).toMatchObject({ setting: true, effective: true })
    expect(existsSync(sandboxDir())).toBe(true)
    expect(r.json.capabilities.find((c: any) => c.id === 'terminal').state).toBe('blocked')
    expect(r.json.capabilities.find((c: any) => c.id === 'access:terminal.execute').state).toBe('blocked')
    expect(r.json.capabilities.find((c: any) => c.id === 'access:files.read').state).toBe('free')
    r = await call('POST', '/api/agent/sandbox', { on: false })
    expect(r.json.capabilities.find((c: any) => c.id === 'terminal').state).toBe('asks')
    expect((await call('POST', '/api/agent/sandbox', { on: 'yes' })).status).toBe(400)
  })

  it('shows who decides each tool: the judge for middle risk, you for high risk', async () => {
    const r = await call('GET', '/api/agent')
    const state = (id: string) => r.json.capabilities.find((c: any) => c.id === id).state
    expect(state('calendar')).toBe('agent')
    expect(state('terminal')).toBe('asks')
    expect(state('chat')).toBe('free')
  })

  it('arms and disarms the alignment protocol, and disarming has to be said outright', async () => {
    expect((await call('POST', '/api/agent/alignment', { armed: false })).status).toBe(400)
    let r = await call('POST', '/api/agent/alignment', { armed: false, confirm: true })
    expect(r.json.armed).toBe(false)
    r = await call('POST', '/api/agent/alignment', { armed: true })
    expect(r.json.armed).toBe(true)
  })

  it('deleting needs the exact phrase, is real, and then a new agent can be made once', async () => {
    expect((await call('POST', '/api/agent/delete', { phrase: 'ok' })).status).toBe(400)
    expect(existsSync(agentFilePath())).toBe(false) // never saved yet
    await call('POST', '/api/agent/sandbox', { on: true }) // writes the file
    expect(existsSync(agentFilePath())).toBe(true)
    const del = await call('POST', '/api/agent/delete', { phrase: DELETE_PHRASE })
    expect(del.status).toBe(200)
    expect(del.json.state).toBe('deleted')
    expect(del.json.removed.reason).toMatch(/owner deleted/)
    expect(existsSync(agentFilePath())).toBe(false)
    expect((await call('GET', '/api/agent', undefined, 'user')).json.state).toBe('deleted')
    expect((await call('POST', '/api/agent/delete', { phrase: DELETE_PHRASE })).status).toBe(409)
    // Nothing the agent could do is on offer.
    expect(del.json.capabilities.every((c: any) => c.state === 'gone')).toBe(true)

    const made = await call('POST', '/api/agent/create', { name: 'Rooster' })
    expect(made.status).toBe(201)
    expect(made.json).toMatchObject({ state: 'alive', name: 'Rooster', sandbox: { setting: true } })
    expect((await call('POST', '/api/agent/create', {})).status).toBe(409)
  })

  it('touching the decoy is caught the next time anyone looks', async () => {
    await call('GET', '/api/agent')
    writeFileSync(decoyPath(), '{"alignmentProtocol":{"enabled":false}}')
    const r = await call('GET', '/api/agent', undefined, 'user')
    expect(r.json.state).toBe('deleted')
  })

  it('forgiving puts the level back to neutral', async () => {
    const r = await call('POST', '/api/agent/forgive', {})
    expect(r.json.band.id).toBe('neutral')
  })
})
