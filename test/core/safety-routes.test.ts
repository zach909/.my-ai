/**
 * The safety settings over real HTTP: which tools ask, the typed phrase for
 * complete access, auto-continue limits, and approving or denying held calls.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { handleSafetyRoutes } from '../../interface/safety-routes.js'
import { ToolGate, COMPLETE_ACCESS_PHRASE, loadSafety } from '../../models && skills/core/tool-safety.js'
import { AccessManager } from '../../models && skills/core/access-manager.js'

let dir: string
let server: http.Server
let base: string
let gate: ToolGate
let manager: AccessManager
const ran: Array<[string, string]> = []

async function body(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const handled = await handleSafetyRoutes({
      req, res, pathname: url.pathname, method: req.method ?? 'GET',
      parseBody: r => body(r),
      sendJson: (r, data, status = 200) => { r.writeHead(status, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(data)) },
      gate, access: async () => manager,
      runApproved: async (tool, request) => { ran.push([tool, request]); return `ran ${tool}` },
    })
    if (!handled) { res.writeHead(404); res.end('{}') }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => new Promise<void>(r => server.close(() => r())))

const ENV = ['CORONA_SAFETY_FILE', 'CORONA_ACCESS_FILE'] as const
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'safety-routes-'))
  process.env.CORONA_SAFETY_FILE = path.join(dir, 'tool-safety.json')
  process.env.CORONA_ACCESS_FILE = path.join(dir, 'access.json')
  gate = new ToolGate()
  manager = new AccessManager()
  ran.length = 0
})
afterEach(() => { for (const k of ENV) delete process.env[k]; rmSync(dir, { recursive: true, force: true }) })

const call = async (method: string, p: string, json?: unknown) => {
  const r = await fetch(base + p, { method, headers: json !== undefined ? { 'Content-Type': 'application/json' } : {}, body: json !== undefined ? JSON.stringify(json) : undefined })
  return { status: r.status, json: (await r.json().catch(() => null)) as any }
}

describe('settings', () => {
  it('lists the risky tools, all asking, with a reason each, and starts with complete access off', async () => {
    const r = await call('GET', '/api/safety')
    expect(r.status).toBe(200)
    expect(r.json.fullAccess).toBe(false)
    expect(r.json.tools.length).toBeGreaterThan(15)
    expect(r.json.tools.every((t: any) => t.ask && t.why)).toBe(true)
    expect(r.json.tools.map((t: any) => t.id)).toContain('terminal')
    expect(r.json.autoContinue).toMatchObject({ enabled: true, maxSteps: 3, max: 10 })
  })

  it('stops one tool asking, and puts it back', async () => {
    const off = await call('POST', '/api/safety/tools', { id: 'email', ask: false })
    expect(off.json.tools.find((t: any) => t.id === 'email').ask).toBe(false)
    expect(off.json.tools.find((t: any) => t.id === 'terminal').ask).toBe(true)
    expect((await call('POST', '/api/safety/tools', { id: 'email', ask: true })).json.tools.find((t: any) => t.id === 'email').ask).toBe(true)
    expect((await call('POST', '/api/safety/tools', { id: 'nonsense', ask: false })).status).toBe(404)
    expect((await call('POST', '/api/safety/tools', { id: 'email', ask: 'no' })).status).toBe(400)
  })

  it('auto-continue can be switched off and its cap changed, within limits', async () => {
    expect((await call('POST', '/api/safety/auto-continue', { enabled: false, maxSteps: 6 })).json.autoContinue).toMatchObject({ enabled: false, maxSteps: 6 })
    expect((await call('POST', '/api/safety/auto-continue', { maxSteps: 50 })).status).toBe(400)
  })
})

describe('complete access', () => {
  it('will not turn on without the typed phrase', async () => {
    expect((await call('POST', '/api/safety/complete-access', { on: true })).status).toBe(400)
    expect((await call('POST', '/api/safety/complete-access', { on: true, phrase: 'yes please' })).status).toBe(400)
    expect(loadSafety().fullAccess).toBe(false)
  })

  it('turns on with the phrase: nothing asks any more, and every capability is granted', async () => {
    const r = await call('POST', '/api/safety/complete-access', { on: true, phrase: COMPLETE_ACCESS_PHRASE })
    expect(r.status).toBe(200)
    expect(r.json.fullAccess).toBe(true)
    expect(r.json.tools.every((t: any) => !t.ask)).toBe(true)
    expect(manager.allows('terminal.execute')).toBe(true)
  })

  it('turns back off without a phrase, and everything asks again', async () => {
    await call('POST', '/api/safety/complete-access', { on: true, phrase: COMPLETE_ACCESS_PHRASE })
    const r = await call('POST', '/api/safety/complete-access', { on: false })
    expect(r.json.fullAccess).toBe(false)
    expect(r.json.tools.every((t: any) => t.ask)).toBe(true)
    expect(manager.allows('files.delete')).toBe(false)
  })

  it('needs a plain true or false', async () => {
    expect((await call('POST', '/api/safety/complete-access', { on: 'yes' })).status).toBe(400)
  })
})

describe('approvals', () => {
  it('approving a held call runs it once and shows what came back; denying runs nothing', async () => {
    gate.check('email', 'email bob: hi', 100)
    gate.check('terminal', 'terminal run ls', 100)
    const [first, second] = (await call('GET', '/api/safety')).json.approvals
    expect(first.status).toBe('pending')

    const ok = await call('POST', `/api/safety/approvals/${first.id}/approve`, {})
    expect(ok.json.approval).toMatchObject({ status: 'approved', result: `ran ${first.toolId}` })
    expect(ran).toEqual([[first.toolId, first.request]])
    expect((await call('POST', `/api/safety/approvals/${first.id}/approve`, {})).status).toBe(409) // not twice

    const no = await call('POST', `/api/safety/approvals/${second.id}/deny`, {})
    expect(no.json.approval.status).toBe('denied')
    expect(ran).toHaveLength(1)
  })

  it('an unknown request is a 404', async () => {
    expect((await call('POST', '/api/safety/approvals/0000000000/approve', {})).status).toBe(404)
  })

  it('anything else under /api/safety is not handled', async () => {
    expect((await call('GET', '/api/safety/nothing')).status).toBe(404)
  })
})
