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
  if (m.includes('expert team')) return m.includes('Checker') ? 'APPROVE' : m.includes('Specialist') ? 'NOTHING' : 'Archive the newsletters'
  if (m.includes('Which folder')) return 'Backend'
  if (m.includes('You organise a library')) return 'Planning/Apps: 70\nNotes: 30'
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
      act: async m => `did: ${m}`,
      status: () => ({ running: true }),
      learner: async () => null,
    })
    if (!handled) { res.writeHead(404); res.end('{}') }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => new Promise<void>(r => server.close(() => r())))

const ENV = ['CORONA_POINTS_FILE', 'CORONA_PROJECTS_FILE', 'CORONA_HIVES_FILE', 'CORONA_FOLDERS_FILE', 'CORONA_MARKET_FILE', 'CORONA_COMPUTE_FILE', 'CORONA_EXPERTS_FILE', 'CORONA_SCHEDULE_FILE', 'NEUROCLAW_STORE_DIR'] as const
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'commons-routes-'))
  process.env.CORONA_POINTS_FILE = path.join(dir, 'points.json')
  process.env.CORONA_PROJECTS_FILE = path.join(dir, 'projects.json')
  process.env.CORONA_HIVES_FILE = path.join(dir, 'hives.json')
  process.env.CORONA_FOLDERS_FILE = path.join(dir, 'folders.json')
  process.env.CORONA_MARKET_FILE = path.join(dir, 'market.json')
  process.env.CORONA_COMPUTE_FILE = path.join(dir, 'compute.json')
  process.env.CORONA_EXPERTS_FILE = path.join(dir, 'experts.json')
  process.env.CORONA_SCHEDULE_FILE = path.join(dir, 'schedules.json')
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

  it('hires, pays and lets go of someone you added, from your own points', async () => {
    const sam = (await call('POST', '/api/commons/members', { name: 'Sam' })).json.member
    expect((await call('POST', `/api/commons/members/${sam.id}/hire`, { amount: 5 })).status).toBe(402) // you have nothing yet
    expect((await call('POST', `/api/commons/members/${sam.id}/hire`, { amount: 0 })).status).toBe(400)
    expect((await call('POST', '/api/commons/members/nobody/hire', { amount: 1 })).status).toBe(404)
    expect((await call('POST', `/api/commons/members/${sam.id}/let-go`, {})).status).toBe(400) // not hired
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
    // Private until shared: the wiki is public, so there is no page yet.
    expect(existsSync(path.join(dir, 'store', 'wiki', 'projects', 'weather.md'))).toBe(false)
    expect(d.json.project.published).toBe(false)
    expect((await call('POST', '/api/commons/projects/weather/share', { on: true })).json.published).toBe(true)
    expect(existsSync(path.join(dir, 'store', 'wiki', 'projects', 'weather.md'))).toBe(true)
    expect((await call('POST', '/api/commons/projects/weather/share', { on: false })).json.published).toBe(false)
    expect(existsSync(path.join(dir, 'store', 'wiki', 'projects', 'weather.md'))).toBe(false)
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
    expect(started.json.hive.agents).toHaveLength(1) // it starts as one AI, the Original, and grows from there
    expect(started.json.hive.agents[0].name).toBe('Original')

    let hive = started.json.hive
    for (let i = 0; i < 200 && hive.state !== 'complete' && hive.state !== 'stalled'; i++) {
      await new Promise(r => setTimeout(r, 25))
      hive = (await call('GET', '/api/commons/projects/weather/hive')).json.hive
    }
    expect(hive.state).toBe('complete')
    expect((await call('GET', '/api/commons/projects/weather')).json.project.status).toBe('complete')

    const board = (await call('GET', '/api/commons')).json.points.board
    expect(hive.agents.length).toBeGreaterThanOrEqual(3)
    expect(board.filter((m: any) => m.kind === 'agent').length).toBeGreaterThanOrEqual(2)
    expect(board.reduce((n: number, m: any) => n + m.earned, 0)).toBeCloseTo(100, 3)
  })

  it('will not merge a project that is not finished', async () => {
    await call('POST', '/api/commons/projects', { title: 'Open', pot: 10 })
    await call('POST', '/api/commons/projects/open/tasks', { title: 'x' })
    expect((await call('POST', '/api/commons/projects/open/hive/merge', {})).status).toBe(404) // no hive yet
  })
})

describe('folders', () => {
  it('the agent files a project into two places at once and the view shows both', async () => {
    await call('POST', '/api/commons/projects', { title: 'Weather', goal: 'Build a weather app', pot: 10 })
    const r = await call('POST', '/api/commons/folders/organize', { only: ['project'] })
    expect(r.status).toBe(200)
    expect(r.json.report).toMatchObject({ asked: 1, placed: 1, split: 1 })
    const top = r.json.view.top
    expect(top.map((f: any) => f.title).sort()).toEqual(['Notes', 'Planning'])
    expect(top.find((f: any) => f.title === 'Planning').children[0].children[0]).toMatchObject({ title: 'Weather', weight: 0.7 })
    expect((await call('GET', '/api/commons/folders')).json.counts.split).toBe(1)
  })

  it('a person can place something by hand, with how much belongs in each place', async () => {
    const r = await call('POST', '/api/commons/folders/place', { kind: 'wiki', ref: 'Home', title: 'Home', places: [{ path: 'Docs', weight: 100 }, { path: 'Start/Here', weight: 40 }] })
    expect(r.status).toBe(200)
    expect(r.json.counts).toMatchObject({ items: 1, split: 1 })
  })

  it('refuses a place that is not a clean path, or no place to put it', async () => {
    expect((await call('POST', '/api/commons/folders/place', { kind: 'wiki', ref: 'x', places: [{ path: '<b>', weight: 50 }] })).status).toBe(400)
    expect((await call('POST', '/api/commons/folders/place', { kind: 'nope', ref: 'x', places: [] })).status).toBe(400)
  })
})

describe('the market and the league', () => {
  it('posts, lists and cancels standing orders, and shows the price they work out to', async () => {
    const sell = await call('POST', '/api/commons/market/orders', { side: 'sell', cu: 50, points: 120 })
    expect(sell.status).toBe(201)
    expect(sell.json.offer).toEqual({ pointsPerCu: 2.4, cu: 50 })
    await call('POST', '/api/commons/market/orders', { side: 'buy', cu: 10, points: 20 })
    const m = (await call('GET', '/api/commons/market')).json
    expect(m.orders).toHaveLength(2)
    expect(m.bid).toEqual({ pointsPerCu: 2, cu: 10 })
    const id = m.orders.find((o: any) => o.side === 'buy').id
    expect((await call('POST', `/api/commons/market/orders/${id}/cancel`, {})).json.cancelled).toBe(true)
    expect((await call('GET', '/api/commons/market')).json.bid).toBeNull()
  })

  it('refuses a bad order', async () => {
    expect((await call('POST', '/api/commons/market/orders', { side: 'swap', cu: 1, points: 1 })).status).toBe(400)
    expect((await call('POST', '/api/commons/market/orders', { side: 'buy', cu: 0, points: 1 })).status).toBe(400)
    expect((await call('POST', '/api/commons/market/orders', { side: 'buy', cu: 'lots', points: 1 })).status).toBe(400)
  })

  it('matching with no computers known says so plainly', async () => {
    const r = await call('POST', '/api/commons/market/borrow', { prompt: 'hi' })
    expect(r.status).toBe(404)
    expect(r.json.error).toMatch(/do not know any computers/)
  })

  it('the league lists wiki projects, and joining one imports it with the AI off', async () => {
    await call('POST', '/api/commons/projects', { title: 'Weather', goal: 'Build a weather app', pot: 10, agentPlan: true })
    expect((await call('GET', '/api/commons/league')).json.projects.find((p: any) => p.id === 'weather')).toBeUndefined() // private: not in the league
    await call('POST', '/api/commons/projects/weather/share', { on: true })
    const league = (await call('GET', '/api/commons/league')).json
    expect(league.board.length).toBeGreaterThanOrEqual(1)
    expect(league.projects.find((p: any) => p.id === 'weather')).toMatchObject({ page: 'projects/weather', local: true, background: true })
  })

  it('the AI\'s background work can be switched per project', async () => {
    await call('POST', '/api/commons/projects', { title: 'Quiet', pot: 10, background: false })
    expect((await call('GET', '/api/commons/projects/quiet')).json.project.background).toBe(false)
    const r = await call('POST', '/api/commons/projects/quiet/background', { on: true })
    expect(r.json.background).toBe(true)
    expect((await call('POST', '/api/commons/projects/quiet/background', { on: 'yes' })).json.background).toBe(false) // only a real true turns it on
  })
})

describe('experts', () => {
  const make = (extra: Record<string, unknown> = {}) => call('POST', '/api/commons/experts', { name: 'Email', specialty: 'email management', mission: 'Keep the inbox clear.', ...extra })

  it('creates one, and it starts by itself: its first cycle runs without anyone pressing anything', async () => {
    const r = await make()
    expect(r.status).toBe(201)
    expect(r.json.expert.agents.map((a: any) => a.role)).toEqual(['lead', 'specialist', 'checker'])
    let e = r.json.expert
    for (let i = 0; i < 100 && e.runs === 0; i++) {
      await new Promise(x => setTimeout(x, 20))
      e = (await call('GET', '/api/commons/experts')).json.experts[0]
    }
    expect(e.runs).toBe(1)
    expect(e.history[0]).toMatchObject({ review: 'approve', acted: true })
    expect(e.history[0].result).toContain('did: email management: Archive the newsletters')
  })

  it('can be paused, set to only record, and deleted', async () => {
    const id = (await make({ mayAct: false })).json.expert.id
    expect((await call('POST', `/api/commons/experts/${id}`, { enabled: false })).json.expert.enabled).toBe(false)
    expect((await call('POST', `/api/commons/experts/${id}`, { mayAct: true })).json.expert.mayAct).toBe(true)
    expect((await call('POST', `/api/commons/experts/${id}/delete`, {})).json.deleted).toBe(true)
    expect((await call('GET', '/api/commons/experts')).json.experts).toEqual([])
  })

  it('refuses nonsense, a duplicate name, and an unknown expert', async () => {
    expect((await make({ teamSize: 1 })).status).toBe(400)
    expect((await make({ intervalMin: 1 })).status).toBe(400)
    await make()
    expect((await make()).status).toBe(400)
    expect((await call('POST', '/api/commons/experts/0000000000', { enabled: true })).status).toBe(404)
  })
})

describe('schedules', () => {
  const add = (when: string, action: string) => call('POST', '/api/commons/schedules', { when, action })

  it('schedules an action, says when in words, and lists it', async () => {
    const r = await add('every 2 hours', 'check my email')
    expect(r.status).toBe(201)
    expect(r.json.schedule).toMatchObject({ whenText: 'every 2 hours', actionText: 'check my email', enabled: true })
    expect((await call('GET', '/api/commons/schedules')).json.schedules).toHaveLength(1)
  })

  it('explains what it can read when it cannot read the time', async () => {
    const r = await add('whenever', 'x')
    expect(r.status).toBe(400)
    expect(r.json.error).toMatch(/in 30 minutes/)
    expect((await add('every 1 minutes', 'x')).status).toBe(400)
    expect((await add('daily at 9am', '')).status).toBe(400)
    expect((await add('daily at 9am', 'schedule every 5 minutes: x')).status).toBe(400)
  })

  it('runs one now through the agent\'s tool path, pauses, resumes and deletes', async () => {
    const id = (await add('every 1 hours', 'check my email')).json.schedule.id
    expect((await call('POST', `/api/commons/schedules/${id}/run`, {})).status).toBe(202)
    let s = (await call('GET', '/api/commons/schedules')).json.schedules[0]
    for (let i = 0; i < 100 && s.runs === 0; i++) { await new Promise(x => setTimeout(x, 20)); s = (await call('GET', '/api/commons/schedules')).json.schedules[0] }
    expect(s.history[0]).toMatchObject({ ok: true, result: 'did: check my email' }) // went through act, not text-only chat
    expect((await call('POST', `/api/commons/schedules/${id}`, { enabled: false })).json.schedule.enabled).toBe(false)
    expect((await call('POST', `/api/commons/schedules/${id}/delete`, {})).json.deleted).toBe(true)
  })

  it('an unknown schedule is a 404', async () => {
    expect((await call('POST', '/api/commons/schedules/00000000', { enabled: true })).status).toBe(404)
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
