/**
 * The Commons over real HTTP: the rate settings, the board, projects end to
 * end, and a hive run through the API. Plus checks on the page itself: it
 * compiles, uses the house look, and cannot turn data into markup.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { handleCommonsRoutes, withTimeout } from '../../interface/commons-routes.js'
import { COMMONS_PAGE } from '../../interface/commons-page.js'

let dir: string
let server: http.Server
let base: string

async function body(req: http.IncomingMessage, max = Infinity): Promise<unknown> {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of req) { n += c.length; if (n > max) throw new Error('too big'); chunks.push(c as Buffer) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

/** Stands in for the brain: plans, works, checks and votes, all by the shape of the question. */
const chat = async (m: string): Promise<string> => {
  if (m.includes('Break this project')) return 'Folder: Backend\n- Fetch data\n- Cache it\nFolder: Frontend\n- Draw the screen'
  if (m.includes('checking another AI')) return 'ACCEPT: fine'
  if (m.includes('removed from the team')) return 'NO'
  if (m.includes('Which folder')) return 'Backend'
  return 'Here is the finished work.'
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const handled = await handleCommonsRoutes({
      req, res, pathname: url.pathname, method: req.method ?? 'GET',
      parseBody: (r, m) => body(r, m),
      sendJson: (r, data, status = 200) => { r.writeHead(status, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(data)) },
      chat,
      status: () => ({ running: true }),
      learner: async () => null,
    })
    if (!handled) { res.writeHead(404); res.end('{}') }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => new Promise<void>(r => server.close(() => r())))

const ENV = ['CORONA_POINTS_FILE', 'CORONA_PROJECTS_FILE', 'CORONA_HIVES_FILE', 'NEUROCLAW_STORE_DIR'] as const
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'commons-routes-'))
  process.env.CORONA_POINTS_FILE = path.join(dir, 'points.json')
  process.env.CORONA_PROJECTS_FILE = path.join(dir, 'projects.json')
  process.env.CORONA_HIVES_FILE = path.join(dir, 'hives.json')
  process.env.NEUROCLAW_STORE_DIR = path.join(dir, 'store')
})
afterEach(() => {
  for (const k of ENV) delete process.env[k]
  rmSync(dir, { recursive: true, force: true })
})

const call = async (method: string, p: string, json?: unknown) => {
  const r = await fetch(base + p, {
    method,
    headers: json !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: json !== undefined ? JSON.stringify(json) : undefined,
  })
  return { status: r.status, json: (await r.json().catch(() => null)) as any }
}

describe('the board and the exchange rate', () => {
  it('starts with just you, lending for credit', async () => {
    const r = await call('GET', '/api/commons')
    expect(r.status).toBe(200)
    expect(r.json.points.board).toHaveLength(1)
    expect(r.json.points).toMatchObject({ ask: 0, bid: 2, you: { id: 'me', points: 0 } })
    expect(r.json.projects).toEqual([])
  })

  it('saves what you charge and what you will pay, and your name', async () => {
    expect((await call('POST', '/api/commons/rates', { ask: 3, bid: 5 })).json).toMatchObject({ ask: 3, bid: 5 })
    expect((await call('POST', '/api/commons/name', { name: 'Zach' })).json.you.name).toBe('Zach')
    expect((await call('GET', '/api/commons')).json.points).toMatchObject({ ask: 3, bid: 5 })
  })

  it('refuses a rate out of range', async () => {
    expect((await call('POST', '/api/commons/rates', { ask: -1 })).status).toBe(400)
    expect((await call('POST', '/api/commons/rates', { bid: 1e9 })).status).toBe(400)
    expect((await call('POST', '/api/commons/rates', { ask: 'lots' })).status).toBe(400)
  })

  it('adds a person, once', async () => {
    const r = await call('POST', '/api/commons/members', { name: 'Sam' })
    expect(r.status).toBe(201)
    expect(r.json.points.board.map((m: any) => m.name)).toContain('Sam')
    expect((await call('POST', '/api/commons/members', { name: 'sam' })).status).toBe(400)
  })
})

describe('a project, end to end', () => {
  it('the agent plans it into folders, and the wiki page appears', async () => {
    const r = await call('POST', '/api/commons/projects', { title: 'Weather', goal: 'Build a weather app', pot: 100, agentPlan: true })
    expect(r.status).toBe(201)
    expect(r.json.plannedBy).toBe('agent')
    const d = await call('GET', '/api/commons/projects/weather')
    expect(d.json.project.folders).toEqual(['Backend', 'Frontend'])
    expect(d.json.project.tasks.map((t: any) => t.title)).toEqual(['Fetch data', 'Cache it', 'Draw the screen'])
    expect(d.json.rewards.t1).toBe(30)
    expect(existsSync(path.join(dir, 'store', 'wiki', 'projects', 'weather.md'))).toBe(true)
  })

  it('without agentPlan it is just what you wrote', async () => {
    const r = await call('POST', '/api/commons/projects', { title: 'Plain', pot: 10 })
    expect(r.json.plannedBy).toBe('you')
    expect((await call('GET', '/api/commons/projects/plain')).json.project.tasks).toEqual([])
  })

  it('refuses a bad pot or title', async () => {
    expect((await call('POST', '/api/commons/projects', { title: 'x', pot: 0 })).status).toBe(400)
    expect((await call('POST', '/api/commons/projects', { title: '', pot: 10 })).status).toBe(400)
    expect((await call('POST', '/api/commons/projects', { title: 'x', pot: 99999 })).status).toBe(400)
  })

  it('take it, hand it in, someone else checks it, and you are paid', async () => {
    await call('POST', '/api/commons/projects', { title: 'Small', pot: 100 })
    await call('POST', '/api/commons/projects/small/tasks', { title: 'Only task', folder: 'Work' })
    const sam = (await call('POST', '/api/commons/members', { name: 'Sam' })).json.member

    expect((await call('POST', '/api/commons/projects/small/tasks/t1/claim', {})).json.assignee.id).toBe('me')
    expect((await call('POST', '/api/commons/projects/small/tasks/t1/submit', { result: 'did it' })).json.status).toBe('submitted')

    // You cannot check your own work.
    const own = await call('POST', '/api/commons/projects/small/tasks/t1/review', { verdict: 'accept' })
    expect(own.status).toBe(403)

    // Sam can. The owner acts on Sam's behalf on this device.
    const ok = await call('POST', '/api/commons/projects/small/tasks/t1/review', { verdict: 'accept', as: sam.id })
    expect(ok.status).toBe(200)
    expect(ok.json).toMatchObject({ paid: 90, completed: true })

    const board = (await call('GET', '/api/commons')).json.points
    // The one task's share (90) plus the completion bonus (10): the whole pot. Sam did no paid work, so no referral bonus is due.
    expect(board.you.points).toBe(100)
    expect(board.board[0]).toMatchObject({ id: 'me', rank: 1 })
    expect((await call('GET', '/api/commons/projects/small')).json.project.status).toBe('complete')
  })

  it('a verdict must be accept or reject', async () => {
    await call('POST', '/api/commons/projects', { title: 'V', pot: 10, })
    expect((await call('POST', '/api/commons/projects/v/tasks/t1/review', { verdict: 'maybe' })).status).toBe(400)
  })

  it('an unknown project or person is a 404, not a crash', async () => {
    expect((await call('GET', '/api/commons/projects/nope')).status).toBe(404)
    await call('POST', '/api/commons/projects', { title: 'P', pot: 10 })
    await call('POST', '/api/commons/projects/p/tasks', { title: 't' })
    expect((await call('POST', '/api/commons/projects/p/tasks/t1/claim', { as: 'ghost' })).status).toBe(404)
  })

  it('the agent files unsorted tasks', async () => {
    await call('POST', '/api/commons/projects', { title: 'Filing', pot: 10 })
    await call('POST', '/api/commons/projects/filing/tasks', { title: 'Loose end' })
    const r = await call('POST', '/api/commons/projects/filing/organize', {})
    expect(r.json).toEqual({ moved: 1, asked: 1 })
    expect((await call('GET', '/api/commons/projects/filing')).json.project.tasks[0].folder).toBe('Backend')
  })

  it('anything else under /api/commons is not handled', async () => {
    expect((await call('GET', '/api/commons/nonsense')).status).toBe(404)
    expect((await call('DELETE', '/api/commons/projects/p')).status).toBe(404)
  })
})

describe('the hive over the API', () => {
  it('runs a project to completion, in the background, and pays the AIs', async () => {
    await call('POST', '/api/commons/projects', { title: 'Weather', goal: 'Build a weather app', pot: 100, agentPlan: true })
    const started = await call('POST', '/api/commons/projects/weather/hive/run', {})
    expect(started.status).toBe(202)
    expect(started.json.hive.agents.length).toBeGreaterThanOrEqual(3)

    let hive = started.json.hive
    for (let i = 0; i < 200 && hive.state !== 'complete' && hive.state !== 'stalled'; i++) {
      await new Promise(r => setTimeout(r, 25))
      hive = (await call('GET', '/api/commons/projects/weather/hive')).json.hive
    }
    expect(hive.state).toBe('complete')
    expect((await call('GET', '/api/commons/projects/weather')).json.project.status).toBe('complete')

    const board = (await call('GET', '/api/commons')).json.points.board
    expect(board.filter((m: any) => m.kind === 'agent').length).toBeGreaterThanOrEqual(2)
    expect(board.reduce((n: number, m: any) => n + m.earned, 0)).toBeCloseTo(100, 3)
  })

  it('will not merge a project that is not finished', async () => {
    await call('POST', '/api/commons/projects', { title: 'Open', pot: 10 })
    await call('POST', '/api/commons/projects/open/tasks', { title: 'x' })
    expect((await call('POST', '/api/commons/projects/open/hive/merge', {})).status).toBe(404) // no hive yet
  })
})

describe('withTimeout', () => {
  it('gives the agent a limit instead of waiting forever', async () => {
    await expect(withTimeout(new Promise<string>(() => undefined), 20)).rejects.toThrow(/too long/)
    await expect(withTimeout(Promise.resolve('ok'), 20)).resolves.toBe('ok')
  })
})

describe('the page', () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(COMMONS_PAGE)![1]

  it('is a complete page whose script compiles', () => {
    expect(COMMONS_PAGE.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(() => new Function(script)).not.toThrow()
  })

  it('wears the house look: soft body, glass panels, pill buttons and inputs, no blue', () => {
    expect(COMMONS_PAGE).toContain('<body class="nc-soft">')
    expect(COMMONS_PAGE).toContain('nc-glass')
    expect(COMMONS_PAGE).toContain('nc-btn')
    expect(COMMONS_PAGE).toContain('nc-input')
    expect(COMMONS_PAGE).not.toMatch(/#4a7dff|indigo|cyan|\bblue\b|#00f|#0af/i)
  })

  it('fetches nothing from anywhere but this server, and loads nothing external', () => {
    expect(COMMONS_PAGE).not.toMatch(/https?:\/\//)
    expect(COMMONS_PAGE).not.toMatch(/<script[^>]+src=|<link[^>]+href=|@import|url\(/)
  })

  it('never turns data into markup', () => {
    expect(COMMONS_PAGE).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/)
  })
})
