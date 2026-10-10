/**
 * The token-checked API, over real HTTP: no token is 401, a token without the
 * scope is 403, and a lease token reaches compute and nothing else.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { handleCoronaRoutes } from '../../interface/corona-routes.js'

let dir: string
let server: http.Server
let base: string

async function body(req: http.IncomingMessage, max = Infinity): Promise<unknown> {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of req) { n += c.length; if (n > max) throw new Error('too big'); chunks.push(c as Buffer) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const handled = await handleCoronaRoutes({
      req, res, pathname: url.pathname, method: req.method ?? 'GET',
      parseBody: (r, m) => body(r, m),
      sendJson: (r, data, status = 200) => { r.writeHead(status, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(data)) },
      chat: async m => `echo:${m}`,
      status: () => ({ running: true }),
    })
    if (!handled) { res.writeHead(404); res.end() }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => new Promise<void>(r => server.close(() => r())))

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'corona-routes-'))
  process.env.CORONA_APPS_FILE = path.join(dir, 'apps.json')
  process.env.CORONA_COMPUTE_FILE = path.join(dir, 'compute.json')
  process.env.CORONA_DONOR_DIR = path.join(dir, 'donor')
})
afterEach(() => {
  delete process.env.CORONA_APPS_FILE
  delete process.env.CORONA_COMPUTE_FILE
  delete process.env.CORONA_DONOR_DIR
  rmSync(dir, { recursive: true, force: true })
})

const call = async (method: string, p: string, opts: { token?: string; json?: unknown } = {}) => {
  const r = await fetch(base + p, {
    method,
    headers: { ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  })
  return { status: r.status, json: (await r.json().catch(() => null)) as any }
}

describe('/api/corona/v1', () => {
  it('401 without a token, 401 with a wrong one', async () => {
    expect((await call('GET', '/api/corona/v1/status')).status).toBe(401)
    expect((await call('GET', '/api/corona/v1/status', { token: 'ca_wrong' })).status).toBe(401)
    expect((await call('POST', '/api/corona/v1/compute/run', { json: { job: 'chat', prompt: 'x' } })).status).toBe(401)
  })

  it('an app can do exactly what it was granted', async () => {
    const reg = await call('POST', '/api/corona-apps', { json: { name: 'Notes', source: 'program', scopes: ['chat'] } })
    expect(reg.status).toBe(201)
    const token = reg.json.token as string
    expect((await call('POST', '/api/corona/v1/chat', { token, json: { message: 'hi' } })).json.response).toBe('echo:hi')
    expect((await call('GET', '/api/corona/v1/status', { token })).status).toBe(403)
    expect((await call('GET', '/api/corona/v1/store', { token })).status).toBe(403)
    expect((await call('GET', '/api/corona/v1/donor', { token })).status).toBe(403)
    // The list never shows the token.
    expect(JSON.stringify((await call('GET', '/api/corona-apps')).json)).not.toContain(token)
    // Revoking cuts it off.
    await call('POST', `/api/corona-apps/${reg.json.app.id}/revoke`, { json: {} })
    expect((await call('POST', '/api/corona/v1/chat', { token, json: { message: 'hi' } })).status).toBe(401)
  })

  it('a lease token runs jobs, but is not an app token', async () => {
    await call('POST', '/api/compute/lending', { json: { enabled: true } })
    const g = await call('POST', '/api/compute/leases', { json: { label: 'Sam', hours: 1, capCu: 100 } })
    expect(g.status).toBe(201)
    const token = g.json.token as string
    const run = await call('POST', '/api/corona/v1/compute/run', { token, json: { job: 'chat', prompt: 'hello' } })
    expect(run.status).toBe(200)
    expect(run.json.result).toBe('echo:hello')
    expect((await call('GET', '/api/corona/v1/compute/lease', { token })).json.usedCu).toBeGreaterThanOrEqual(0)
    expect((await call('POST', '/api/corona/v1/chat', { token, json: { message: 'hi' } })).status).toBe(401)
    expect((await call('POST', '/api/corona/v1/compute/run', { token, json: { job: 'shell', prompt: 'rm -rf /' } })).status).toBe(400)
  })

  it('the donor reports state but never data, and is off until acknowledged', async () => {
    expect((await call('GET', '/api/donor')).json.anyRecording).toBe(false)
    expect((await call('POST', '/api/donor', { json: { enabled: true, sources: { audio: true } } })).status).toBe(400)
    await call('POST', '/api/donor', { json: { enabled: true, sources: { audio: true }, acknowledge: true } })
    const ing = await call('POST', '/api/donor/ingest', { json: { source: 'audio', data: Buffer.from('abc').toString('base64') } })
    expect(ing.status).toBe(202)
    const reg = await call('POST', '/api/corona-apps', { json: { name: 'Dash', source: 'program', scopes: ['donor.status'] } })
    const view = await call('GET', '/api/corona/v1/donor', { token: reg.json.token })
    expect(view.json).toEqual({ enabled: true, recording: { screen: false, audio: true }, anyRecording: true, queued: 1 })
    expect((await call('DELETE', '/api/donor/data')).json.erased).toBe(1)
  })
})
