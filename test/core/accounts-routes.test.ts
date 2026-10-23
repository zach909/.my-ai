/**
 * The accounts flow over real HTTP, wired the way the server wires it:
 * identify the caller from their cookie, then handle the request AS them.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { handleAccountsRoutes, isAccountsPublicRoute } from '../../interface/accounts-routes.js'
import { AccountsStore, resolveWho, USER_COOKIE, userMayReach, LOCKOUT_MS } from '../../models && skills/core/accounts.js'
import { runAs, ANONYMOUS } from '../../models && skills/core/user-context.js'
import { ACCOUNTS_PAGE } from '../../interface/accounts-page.js'

let dir: string
let server: http.Server
let base: string
let accounts: AccountsStore
let setupDone = 0
let computerAdminFlag = true
let t = 1_000_000
const PW = 'correct horse battery'

async function body(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}
const cookieOf = (req: http.IncomingMessage): string | null => {
  for (const part of (req.headers.cookie ?? '').split(';')) { const [k, v] = part.trim().split('='); if (k === USER_COOKIE) return v ?? null }
  return null
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    // What the real server does: identify first, then run everything as that person.
    const who = resolveWho(accounts, cookieOf(req), false, false)
    await runAs(who ?? ANONYMOUS, async () => {
      const handled = await handleAccountsRoutes({
        req, res, pathname: url.pathname, method: req.method ?? 'GET',
        parseBody: r => body(r),
        sendJson: (r, data, status = 200) => { r.writeHead(status, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(data)) },
        accounts,
        fromThisMachine: r => r.headers['x-from-machine'] === '1',
        computerAdmin: () => computerAdminFlag,
        setupCodeOk: code => code === 'abc12345',
        onSetup: () => { setupDone++ },
        token: cookieOf,
      })
      if (!handled) { res.writeHead(404); res.end('{}') }
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => new Promise<void>(r => server.close(() => r())))

const ENV = ['CORONA_DATA_DIR'] as const
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'accounts-routes-'))
  process.env.CORONA_DATA_DIR = path.join(dir, 'data')
  t = 1_000_000
  accounts = new AccountsStore(path.join(dir, 'accounts.json'), () => t)
  setupDone = 0
  computerAdminFlag = true
})
afterEach(() => { for (const k of ENV) delete process.env[k]; rmSync(dir, { recursive: true, force: true }) })

interface Res { status: number; json: any; cookie: string | null }
const call = async (method: string, p: string, opts: { json?: unknown; cookie?: string | null; machine?: boolean } = {}): Promise<Res> => {
  const r = await fetch(base + p, {
    method,
    headers: { ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.cookie ? { Cookie: `${USER_COOKIE}=${opts.cookie}` } : {}), ...(opts.machine ? { 'x-from-machine': '1' } : {}) },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  })
  const set = r.headers.get('set-cookie')
  const m = set ? new RegExp(`${USER_COOKIE}=([^;]*)`).exec(set) : null
  return { status: r.status, json: await r.json().catch(() => null), cookie: m ? m[1] : null }
}

/** Set up the admin from the machine, and return their login. */
const makeAdmin = async () => (await call('POST', '/api/accounts/setup', { json: { name: 'zach', password: PW }, machine: true })).cookie!
const signup = async (name: string) => (await call('POST', '/api/accounts/register', { json: { name, password: PW } })).cookie!

describe('setting up', () => {
  it('before there is an admin, status says so, and anyone can see that without logging in', async () => {
    const r = await call('GET', '/api/accounts/status')
    expect(r.json).toMatchObject({ hasAdmin: false, signup: 'open', me: { kind: 'anonymous' } })
  })

  it('from the machine itself, the first account is the admin and is logged in straight away', async () => {
    const r = await call('POST', '/api/accounts/setup', { json: { name: 'zach', password: PW }, machine: true })
    expect(r.status).toBe(201)
    expect(r.cookie).toBeTruthy()
    expect(setupDone).toBe(1)
    expect((await call('GET', '/api/accounts/me', { cookie: r.cookie })).json.me).toMatchObject({ kind: 'user', name: 'zach', role: 'admin' })
  })

  it('from another device it needs the setup code, and a wrong one gets nothing', async () => {
    expect((await call('POST', '/api/accounts/setup', { json: { name: 'zach', password: PW } })).status).toBe(403)
    expect((await call('POST', '/api/accounts/setup', { json: { name: 'zach', password: PW, setupCode: 'guess' } })).status).toBe(403)
    expect((await call('GET', '/api/accounts/status')).json.hasAdmin).toBe(false)
    expect((await call('POST', '/api/accounts/setup', { json: { name: 'zach', password: PW, setupCode: 'abc12345' } })).status).toBe(201)
  })

  it('from the machine, setup needs the computer to be running as an administrator; otherwise only the console code works', async () => {
    computerAdminFlag = false
    const st = await call('GET', '/api/accounts/status', { machine: true })
    expect(st.json).toMatchObject({ hasAdmin: false, onThisMachine: true, computerAdmin: false })
    const denied = await call('POST', '/api/accounts/setup', { json: { name: 'zach', password: PW }, machine: true })
    expect(denied.status).toBe(403)
    expect(denied.json.error).toMatch(/administrator/)
    expect(accounts.hasAdmin()).toBe(false)
    const withCode = await call('POST', '/api/accounts/setup', { json: { name: 'zach', password: PW, setupCode: 'abc12345' }, machine: true })
    expect(withCode.status).toBe(201)
    expect(accounts.hasAdmin()).toBe(true)
  })

  it('an administrator at the machine needs no code, and afterwards everyone can sign up', async () => {
    const st = await call('GET', '/api/accounts/status', { machine: true })
    expect(st.json).toMatchObject({ onThisMachine: true, computerAdmin: true })
    await makeAdmin()
    const status = await call('GET', '/api/accounts/status')
    expect(status.json).toMatchObject({ hasAdmin: true, signup: 'open' })
    const sam = await call('POST', '/api/accounts/register', { json: { name: 'sam', password: PW } })
    expect(sam.status).toBe(201)
  })

  it('once there is an admin nobody can set up again, not even from the machine', async () => {
    await makeAdmin()
    const r = await call('POST', '/api/accounts/setup', { json: { name: 'mallory', password: PW }, machine: true })
    expect(r.status).toBe(409)
  })
})

describe('signing up and logging in', () => {
  it('anyone can sign up once there is an admin, and is logged in as a regular user', async () => {
    await makeAdmin()
    const r = await call('POST', '/api/accounts/register', { json: { name: 'sam', password: PW } })
    expect(r.status).toBe(201)
    expect((await call('GET', '/api/accounts/me', { cookie: r.cookie })).json.me).toMatchObject({ name: 'sam', role: 'user' })
  })

  it('signup before the admin exists is refused', async () => {
    expect((await call('POST', '/api/accounts/register', { json: { name: 'sam', password: PW } })).status).toBe(409)
  })

  it('the admin can close signup, and then it is refused', async () => {
    const admin = await makeAdmin()
    expect((await call('POST', '/api/accounts/settings', { json: { signup: 'invite' }, cookie: admin })).json.signup).toBe('invite')
    expect((await call('POST', '/api/accounts/register', { json: { name: 'sam', password: PW } })).status).toBe(403)
    expect((await call('GET', '/api/accounts/status')).json.signup).toBe('invite')
  })

  it('logging in and out', async () => {
    await makeAdmin()
    await signup('sam')
    const login = await call('POST', '/api/accounts/login', { json: { name: 'sam', password: PW } })
    expect(login.status).toBe(200)
    await call('POST', '/api/accounts/logout', { json: {}, cookie: login.cookie })
    expect((await call('GET', '/api/accounts/me', { cookie: login.cookie })).json.me.kind).toBe('anonymous')
  })

  it('a wrong password is a 401 with the same words as a wrong name, and repeated tries lock the name', async () => {
    await makeAdmin()
    const a = await call('POST', '/api/accounts/login', { json: { name: 'zach', password: 'wrong wrong wrong' } })
    const b = await call('POST', '/api/accounts/login', { json: { name: 'nobody', password: 'wrong wrong wrong' } })
    expect([a.status, a.json.error]).toEqual([b.status, b.json.error])
    for (let i = 0; i < 5; i++) await call('POST', '/api/accounts/login', { json: { name: 'zach', password: 'wrong wrong wrong' } })
    expect((await call('POST', '/api/accounts/login', { json: { name: 'zach', password: PW } })).status).toBe(429)
    t += LOCKOUT_MS + 1
    expect((await call('POST', '/api/accounts/login', { json: { name: 'zach', password: PW } })).status).toBe(200)
  })

  it('changing your own password needs the old one and logs you out everywhere', async () => {
    await makeAdmin()
    const sam = await signup('sam')
    expect((await call('POST', '/api/accounts/password', { json: { oldPassword: 'not it at all', newPassword: 'new password 123' }, cookie: sam })).status).toBe(401)
    const r = await call('POST', '/api/accounts/password', { json: { oldPassword: PW, newPassword: 'new password 123' }, cookie: sam })
    expect(r.json).toMatchObject({ changed: true, loginAgain: true })
    expect((await call('GET', '/api/accounts/me', { cookie: sam })).json.me.kind).toBe('anonymous')
    expect((await call('POST', '/api/accounts/login', { json: { name: 'sam', password: 'new password 123' } })).status).toBe(200)
  })
})

describe("the admin's controls are the admin's alone", () => {
  it('a regular user and a stranger are both refused', async () => {
    await makeAdmin()
    const sam = await signup('sam')
    for (const [m, p, j] of [['GET', '/api/accounts/users', undefined], ['POST', '/api/accounts/users', { name: 'x1', password: PW }], ['POST', '/api/accounts/settings', { learnFromUsers: true }]] as const) {
      expect((await call(m, p, { json: j, cookie: sam })).status, `${m} ${p} as a user`).toBe(403)
      expect((await call(m, p, { json: j })).status, `${m} ${p} as a stranger`).toBe(403)
    }
    expect((await call('GET', '/api/accounts/status')).json.signup).toBe('open')
  })

  it('the admin sees everyone, with no hashes, and can make, turn off and turn on accounts', async () => {
    const admin = await makeAdmin()
    await signup('sam')
    const list = await call('GET', '/api/accounts/users', { cookie: admin })
    expect(list.json.users.map((u: any) => u.name).sort()).toEqual(['sam', 'zach'])
    expect(JSON.stringify(list.json)).not.toMatch(/hash|salt/)
    const made = await call('POST', '/api/accounts/users', { json: { name: 'pat', password: PW }, cookie: admin })
    expect(made.status).toBe(201)
    const sam = list.json.users.find((u: any) => u.name === 'sam')
    expect((await call('POST', `/api/accounts/users/${sam.id}/disable`, { json: {}, cookie: admin })).json.user.disabledAt).not.toBeNull()
    expect((await call('POST', `/api/accounts/users/${sam.id}/enable`, { json: {}, cookie: admin })).json.user.disabledAt).toBeNull()
  })

  it('turning someone off cuts them off at once, mid-session', async () => {
    const admin = await makeAdmin()
    const sam = await signup('sam')
    const id = (await call('GET', '/api/accounts/users', { cookie: admin })).json.users.find((u: any) => u.name === 'sam').id
    expect((await call('GET', '/api/accounts/me', { cookie: sam })).json.me.name).toBe('sam')
    await call('POST', `/api/accounts/users/${id}/disable`, { json: {}, cookie: admin })
    expect((await call('GET', '/api/accounts/me', { cookie: sam })).json.me.kind).toBe('anonymous')
  })

  it('the admin cannot be turned off or deleted, and can set a user\'s password and delete them', async () => {
    const admin = await makeAdmin()
    await signup('sam')
    const users = (await call('GET', '/api/accounts/users', { cookie: admin })).json.users
    const zach = users.find((u: any) => u.role === 'admin'); const sam = users.find((u: any) => u.name === 'sam')
    expect((await call('POST', `/api/accounts/users/${zach.id}/disable`, { json: {}, cookie: admin })).status).toBe(409)
    expect((await call('POST', `/api/accounts/users/${zach.id}/delete`, { json: {}, cookie: admin })).status).toBe(409)
    expect((await call('POST', `/api/accounts/users/${sam.id}/password`, { json: { password: 'reset by admin 1' }, cookie: admin })).status).toBe(200)
    expect((await call('POST', '/api/accounts/login', { json: { name: 'sam', password: 'reset by admin 1' } })).status).toBe(200)
    expect((await call('POST', `/api/accounts/users/${sam.id}/delete`, { json: { purge: true }, cookie: admin })).json.deleted).toBe(true)
    expect((await call('POST', '/api/accounts/login', { json: { name: 'sam', password: 'reset by admin 1' } })).status).toBe(401)
  })

  it('the settings include whether the brain may learn from other people, off by default', async () => {
    const admin = await makeAdmin()
    expect((await call('GET', '/api/accounts/users', { cookie: admin })).json.learnFromUsers).toBe(false)
    expect((await call('POST', '/api/accounts/settings', { json: { learnFromUsers: true }, cookie: admin })).json.learnFromUsers).toBe(true)
  })
})

describe('what the server lets through before anyone is logged in', () => {
  it('only the doors you need to log in by', () => {
    for (const [p, m] of [['/accounts', 'GET'], ['/api/accounts/status', 'GET'], ['/api/accounts/setup', 'POST'], ['/api/accounts/login', 'POST'], ['/api/accounts/register', 'POST'], ['/api/accounts/logout', 'POST']] as const) expect(isAccountsPublicRoute(p, m), `${m} ${p}`).toBe(true)
    for (const [p, m] of [['/api/accounts/users', 'GET'], ['/api/accounts/users', 'POST'], ['/api/accounts/settings', 'POST'], ['/api/accounts/me', 'GET'], ['/api/accounts/password', 'POST']] as const) expect(isAccountsPublicRoute(p, m), `${m} ${p}`).toBe(false)
  })

  it('and a regular user can reach their own account pages but not the admin ones', () => {
    expect(userMayReach('/api/accounts/me', 'GET')).toBe(true)
    expect(userMayReach('/api/accounts/users', 'GET')).toBe(false)
  })
})

describe('the page', () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(ACCOUNTS_PAGE)![1]
  it('compiles, wears the house look, and never turns data into markup or fetches from elsewhere', () => {
    expect(() => new Function(script)).not.toThrow()
    expect(ACCOUNTS_PAGE).toContain('<body class="nc-soft">')
    expect(ACCOUNTS_PAGE).not.toMatch(/#4a7dff|indigo|cyan|\bblue\b/i)
    expect(ACCOUNTS_PAGE).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/)
    expect(ACCOUNTS_PAGE).not.toMatch(/https?:\/\/|<script[^>]+src=|<link[^>]+href=|@import|url\(/)
  })

  it('only follows a "next" that stays on this server', () => {
    expect(ACCOUNTS_PAGE).toContain("n.charAt(0) === '/' && n.charAt(1) !== '/'")
  })
})
