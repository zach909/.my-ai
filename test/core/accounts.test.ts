/**
 * Accounts: one admin sets the server up, anyone can sign up, nobody sees
 * anyone else's stuff. The store, the rules for who may reach what, and the
 * guards around the shared brain.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  AccountsStore, AccountError, resolveWho, userMayReach, USER_PLUGINS, MAX_FAILURES, LOCKOUT_MS, SESSION_TTL_MS, MIN_PASSWORD_LENGTH,
} from '../../models && skills/core/accounts.js'
import {
  runAs, who, dataDir, dataFile, isOwnerOrAdmin, currentName, sharedBrainOpen, setLearnPolicy, ANONYMOUS, OWNER, userDir, type Who,
} from '../../models && skills/core/user-context.js'
import { LongTermMemory } from '../../models && skills/core/long-term-memory.js'
import { ToolGate, defaultSafety } from '../../models && skills/core/tool-safety.js'
import { appendConversationTurn, readRecentConversationTurns } from '../../src/lib/conversation-log.js'

let dir: string
let file: string
let t = 1_000_000
const saved = process.env.CORONA_DATA_DIR
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'accounts-'))
  file = path.join(dir, 'accounts.json')
  t = 1_000_000
  process.env.CORONA_DATA_DIR = path.join(dir, 'data')
  setLearnPolicy(() => false)
})
afterEach(() => {
  if (saved === undefined) delete process.env.CORONA_DATA_DIR
  else process.env.CORONA_DATA_DIR = saved
  setLearnPolicy(() => false)
  rmSync(dir, { recursive: true, force: true })
})

const store = () => new AccountsStore(file, () => t)
const PW = 'correct horse battery'
const setup = async (s = store()) => { await s.setupAdmin('zach', PW, true); return s }
const user = (id: string, name = 'sam', role: 'user' | 'admin' = 'user'): Who => ({ kind: 'user', id, name, role })

describe('setting up', () => {
  it('the first account is the admin, and only from the machine or with the setup code', async () => {
    const s = store()
    expect(s.hasAdmin()).toBe(false)
    await expect(s.setupAdmin('zach', PW, false)).rejects.toMatchObject({ status: 403 })
    expect(s.hasAdmin()).toBe(false)
    const a = await s.setupAdmin('zach', PW, true)
    expect(a).toMatchObject({ name: 'zach', role: 'admin' })
    expect(s.hasAdmin()).toBe(true)
  })

  it('there is exactly one admin: setup cannot be run again by anyone', async () => {
    const s = await setup()
    await expect(s.setupAdmin('mallory', PW, true)).rejects.toMatchObject({ status: 409 })
    expect(s.listUsers().filter(u => u.role === 'admin')).toHaveLength(1)
  })

  it('a file that claims several admins is read as only the first being one', () => {
    writeFileSync(file, JSON.stringify({ users: [
      { id: 'aaaaaaaa', name: 'a', role: 'admin', salt: 'x', hash: 'x' },
      { id: 'bbbbbbbb', name: 'b', role: 'admin', salt: 'x', hash: 'x' },
    ] }))
    expect(store().listUsers().map(u => u.role)).toEqual(['admin', 'user'])
  })

  it('a damaged file fails CLOSED: it never looks like "no admin yet", which would let a stranger claim the server', async () => {
    writeFileSync(file, '{ not json')
    const s = store()
    expect(s.hasAdmin()).toBe(true)
    await expect(s.setupAdmin('mallory', PW, true)).rejects.toThrow()
    expect(s.learnFromUsers()).toBe(false)
  })

  it('stores a salted hash, never the password, in a private file', async () => {
    await setup()
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(PW)
    expect(JSON.parse(raw).users[0]).toMatchObject({ iterations: 100000 })
    expect(JSON.parse(raw).users[0].hash.length).toBeGreaterThan(20)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o077).toBe(0)
  })

  it('refuses a bad name or a short password', async () => {
    const s = store()
    await expect(s.setupAdmin('<b>', PW, true)).rejects.toThrow(/name/)
    await expect(s.setupAdmin('a', PW, true)).rejects.toThrow(/name/)
    await expect(s.setupAdmin('zach', 'short', true)).rejects.toThrow(new RegExp(String(MIN_PASSWORD_LENGTH)))
    await expect(s.setupAdmin('zach', 'x'.repeat(500), true)).rejects.toThrow(/at most/)
  })
})

describe('signing up', () => {
  it('anyone can, by default, once there is an admin; before that nobody can', async () => {
    const s = store()
    await expect(s.register('sam', PW)).rejects.toMatchObject({ status: 409 })
    await setup(s)
    expect(await s.register('sam', PW)).toMatchObject({ name: 'sam', role: 'user' })
  })

  it('the admin can close it, and can still make accounts themselves', async () => {
    const s = await setup()
    s.setSignup('invite')
    await expect(s.register('sam', PW)).rejects.toMatchObject({ status: 403 })
    expect(await s.createUser('sam', PW)).toMatchObject({ role: 'user' })
    expect(() => s.setSignup('whatever' as never)).toThrow(AccountError)
  })

  it('names are unique whatever the case', async () => {
    const s = await setup()
    await s.register('Sam', PW)
    await expect(s.register('sam', PW)).rejects.toMatchObject({ status: 409 })
    await expect(s.register('ZACH', PW)).rejects.toMatchObject({ status: 409 })
  })
})

describe('logging in', () => {
  it('a right name and password gives a session that names the user, and logout ends it', async () => {
    const s = await setup()
    const { token, user: u } = await s.login('zach', PW)
    expect(s.userFor(token)).toMatchObject({ id: u.id, role: 'admin' })
    s.logout(token)
    expect(s.userFor(token)).toBeNull()
  })

  it('a wrong name and a wrong password get exactly the same answer', async () => {
    const s = await setup()
    const a = await s.login('zach', 'wrong password!').catch(e => e)
    const b = await s.login('nobody', 'wrong password!').catch(e => e)
    expect([a.message, a.status]).toEqual([b.message, b.status])
    expect(a.status).toBe(401)
  })

  it('too many wrong passwords lock the name for a minute, even against the right password', async () => {
    const s = await setup()
    for (let i = 0; i < MAX_FAILURES; i++) await s.login('zach', 'nope nope nope').catch(() => undefined)
    await expect(s.login('zach', PW)).rejects.toMatchObject({ status: 429 })
    t += LOCKOUT_MS + 1
    await expect(s.login('zach', PW)).resolves.toBeDefined()
  })

  it('a session ends on its own', async () => {
    const s = await setup()
    const { token } = await s.login('zach', PW)
    t += SESSION_TTL_MS + 1
    expect(s.userFor(token)).toBeNull()
  })

  it('does not accept a non-string name or password', async () => {
    const s = await setup()
    await expect(s.login({} as never, PW)).rejects.toMatchObject({ status: 401 })
    await expect(s.login('zach', undefined as never)).rejects.toMatchObject({ status: 401 })
    expect(s.userFor(undefined)).toBeNull()
    expect(s.userFor('')).toBeNull()
  })
})

describe("the admin's controls", () => {
  it('turning an account off ends its sessions at once and stops new ones; turning it on restores it', async () => {
    const s = await setup()
    const u = await s.register('sam', PW)
    const { token } = await s.login('sam', PW)
    s.setDisabled(u.id, true)
    expect(s.userFor(token)).toBeNull()
    await expect(s.login('sam', PW)).rejects.toMatchObject({ status: 403 })
    s.setDisabled(u.id, false)
    await expect(s.login('sam', PW)).resolves.toBeDefined()
  })

  it('the admin cannot be turned off or deleted', async () => {
    const s = await setup()
    const admin = s.listUsers()[0]
    expect(() => s.setDisabled(admin.id, true)).toThrow(/cannot be turned off/)
    expect(() => s.deleteUser(admin.id, false)).toThrow(/cannot be deleted/)
  })

  it('a new password ends every old login', async () => {
    const s = await setup()
    const u = await s.register('sam', PW)
    const { token } = await s.login('sam', PW)
    await s.resetPassword(u.id, 'a brand new password')
    expect(s.userFor(token)).toBeNull()
    await expect(s.login('sam', PW)).rejects.toMatchObject({ status: 401 })
    await expect(s.login('sam', 'a brand new password')).resolves.toBeDefined()
  })

  it('you can change your own password only by proving the old one', async () => {
    const s = await setup()
    const u = await s.register('sam', PW)
    await expect(s.changeOwnPassword(u.id, 'not the old one', 'another new password')).rejects.toMatchObject({ status: 401 })
    await s.changeOwnPassword(u.id, PW, 'another new password')
    await expect(s.login('sam', 'another new password')).resolves.toBeDefined()
  })

  it('deleting an account erases its data only when asked to, so it cannot happen by accident', async () => {
    const s = await setup()
    const keep = await s.register('keep', PW)
    const purge = await s.register('purge', PW)
    for (const u of [keep, purge]) { mkdirSync(userDir(u.id), { recursive: true }); writeFileSync(path.join(userDir(u.id), 'points.json'), '{}') }
    s.deleteUser(keep.id, false)
    s.deleteUser(purge.id, true)
    expect(existsSync(userDir(keep.id))).toBe(true)
    expect(existsSync(userDir(purge.id))).toBe(false)
    expect(s.listUsers().map(u => u.name)).toEqual(['zach'])
  })

  it('the listing never shows a hash or a salt', async () => {
    const s = await setup()
    await s.register('sam', PW)
    expect(JSON.stringify(s.listUsers())).not.toMatch(/hash|salt/)
  })

  it('learning from other people is off until the admin says', async () => {
    const s = await setup()
    expect(s.learnFromUsers()).toBe(false)
    expect(s.setLearnFromUsers(true)).toBe(true)
    expect(s.learnFromUsers()).toBe(true)
  })
})

describe('working out who is asking', () => {
  it('a valid login is that user, whatever the old rules say', async () => {
    const s = await setup()
    const { token } = await s.login('zach', PW)
    expect(resolveWho(s, token, false, false)).toMatchObject({ kind: 'user', name: 'zach', role: 'admin' })
  })

  it('with no admin yet, the old rules decide, exactly as before accounts', () => {
    const s = store()
    expect(resolveWho(s, null, true, false)).toEqual({ kind: 'owner' })
    expect(resolveWho(s, null, false, true)).toBeNull()
  })

  it('once there is an admin an OPEN server (no password) stops being open to everyone', async () => {
    const s = await setup()
    expect(resolveWho(s, null, true, false)).toBeNull()
  })

  it('once there is an admin the old shared password still means the owner, so nobody is locked out', async () => {
    const s = await setup()
    expect(resolveWho(s, null, true, true)).toEqual({ kind: 'owner' })
    expect(resolveWho(s, null, false, true)).toBeNull()
  })

  it('a turned-off user falls back to nothing', async () => {
    const s = await setup()
    const u = await s.register('sam', PW)
    const { token } = await s.login('sam', PW)
    s.setDisabled(u.id, true)
    expect(resolveWho(s, token, false, false)).toBeNull()
  })
})

describe('what a regular user may reach', () => {
  const yes = ['/', '/commons', '/api/chat', '/api/chat-history/threads', '/api/chat-history/export', '/api/chat-history/threads/abc', '/api/chat-history/threads/abc/pin', '/api/agent', '/api/commons', '/api/commons/projects', '/api/commons/projects/weather/tasks/t1/claim', '/api/commons/folders/organize', '/api/commons/experts', '/api/commons/schedules', '/api/commons/league', '/api/accounts/me', '/api/auth/logout']
  const no = [
    '/api/terminals', '/api/apps/launch', '/api/apps/list', '/api/memory', '/api/memory/all', '/api/profile', '/api/system/install', '/api/access/switch', '/api/settings/brain',
    '/api/store/install', '/api/store/uninstall', '/api/updates/apply', '/api/github/publish', '/api/extension/build', '/api/train', '/api/phone-sync', '/api/captures',
    '/api/compute', '/api/compute/leases', '/api/donor', '/api/corona-apps', '/sharing', '/api/safety', '/api/safety/complete-access', '/api/safety/approvals/abc/approve', '/api/agent/sandbox', '/api/agent/delete', '/api/agent/alignment', '/api/agent/create', '/api/agent/forgive', '/api/safety/judge',
    '/api/commons/market', '/api/commons/market/orders', '/api/commons/market/borrow', '/api/commons/projects/weather/publish',
    '/api/chat-groups/collaborate', '/api/zip-loop/run', '/api/accounts/users', '/api/accounts/settings', '/api/accounts/users/aaaaaaaa/delete', '/api/chat/../terminals', '/api/commons/..%2fsafety',
    '/api/doorways/send', '/api/net-skills', '/api/self-improvement/server/start', '/avatar', '',
  ]
  it('reaches what it needs: chat, its own chats, the Commons, and its own account', () => {
    for (const p of yes) expect(userMayReach(p, 'GET'), p).toBe(true)
  })
  it('can export, and import, its own chats', () => {
    expect(userMayReach('/api/chat-history/export', 'GET')).toBe(true)
    expect(userMayReach('/api/chat-history/import', 'POST')).toBe(true)
  })
  it('reaches NOTHING that runs or changes the machine, reads the owner\'s data, or manages other people', () => {
    for (const p of no) expect(userMayReach(p, 'POST'), p).toBe(false)
  })
  it('a route nobody has listed is closed by default', () => {
    expect(userMayReach('/api/brand-new-feature', 'GET')).toBe(false)
    expect(userMayReach('/api/commons-evil', 'GET')).toBe(false)
  })
  it('the plugins a user may use touch neither the owner\'s computer nor the owner\'s data', () => {
    for (const bad of ['terminal', 'file-system', 'email', 'camera', 'desktop', 'calendar', 'contacts', 'browser', 'store', 'wiki', 'hive', 'notifications', 'account-info', 'passkeys']) expect(USER_PLUGINS).not.toContain(bad)
    expect(USER_PLUGINS).toEqual(expect.arrayContaining(['research', 'tools', 'tasks', 'schedule']))
  })
})

describe('keeping people apart', () => {
  it('the owner and the admin use the original folder; everyone else has their own', () => {
    expect(dataDir()).toBe(path.join(dir, 'data'))
    expect(runAs(user('aaaaaaaa', 'zach', 'admin'), dataDir)).toBe(path.join(dir, 'data'))
    expect(runAs(user('bbbbbbbb'), dataDir)).toBe(path.join(dir, 'data', 'users', 'bbbbbbbb'))
    expect(runAs(user('bbbbbbbb'), () => dataFile('points.json'))).toBe(path.join(dir, 'data', 'users', 'bbbbbbbb', 'points.json'))
    expect(runAs(user('bbbbbbbb'), currentName)).toBe('sam')
  })

  it('someone not logged in has no folder at all, so a forgotten check cannot fall through to the owner\'s files', () => {
    expect(() => runAs(ANONYMOUS, dataDir)).toThrow(/Not logged in/)
    expect(runAs(ANONYMOUS, isOwnerOrAdmin)).toBe(false)
  })

  it('two requests at once each see their own person, even interleaved', async () => {
    const seen: string[] = []
    const job = (id: string, wait: number) => runAs(user(id, id), async () => {
      await new Promise(r => setTimeout(r, wait))
      seen.push(`${id}:${(who() as { name: string }).name}`)
      await new Promise(r => setTimeout(r, wait))
      seen.push(`${id}:${(who() as { name: string }).name}`)
    })
    await Promise.all([job('aaaaaaaa', 5), job('bbbbbbbb', 3), job('cccccccc', 1)])
    for (const entry of seen) { const [id, name] = entry.split(':'); expect(name).toBe(id) }
    expect(seen).toHaveLength(6)
  })

  it('outside any request it is the owner, so timers and tests behave as before', () => {
    expect(who()).toEqual(OWNER)
    expect(isOwnerOrAdmin()).toBe(true)
  })
})

describe('the shared brain', () => {
  it('does not take in what a regular user says, and shows them nothing of the owner\'s', () => {
    const mem = new LongTermMemory()
    mem.remember('the owner\'s bank pin is 4321', { importance: 0.9 })
    expect(mem.retrieve('bank pin').length).toBeGreaterThan(0)
    runAs(user('bbbbbbbb'), () => {
      expect(mem.retrieve('bank pin')).toEqual([])
      expect(mem.all()).toEqual([])
      expect(mem.findExact('the owner\'s bank pin is 4321')).toEqual([])
      mem.remember('sam\'s secret is rubber duck')
    })
    expect(mem.retrieve('rubber duck').filter(h => h.item.content.includes('rubber duck'))).toEqual([]) // never stored
  })

  it('does not even let anyone who is not logged in see it', () => {
    const mem = new LongTermMemory()
    mem.remember('private note')
    runAs(ANONYMOUS, () => { expect(mem.retrieve('private note')).toEqual([]); expect(mem.all()).toEqual([]) })
  })

  it('the admin can open it up: then it is shared, as they chose', () => {
    const mem = new LongTermMemory()
    setLearnPolicy(() => true)
    runAs(user('bbbbbbbb'), () => mem.remember('sam says pineapple'))
    expect(mem.retrieve('pineapple').length).toBeGreaterThan(0)
    expect(runAs(user('bbbbbbbb'), sharedBrainOpen)).toBe(true)
    expect(runAs(ANONYMOUS, sharedBrainOpen)).toBe(false) // still never for someone not logged in
  })

  it('the conversation log is the same: a regular user\'s chat is not logged, and not read back to them', () => {
    const log = path.join(dir, 'log.jsonl')
    appendConversationTurn('owner question', 'owner answer', log)
    runAs(user('bbbbbbbb'), () => {
      appendConversationTurn('sam question', 'sam answer', log)
      expect(readRecentConversationTurns(10, log)).toEqual([])
    })
    expect(readRecentConversationTurns(10, log).map(t => t.userMessage)).toEqual(['owner question'])
  })

  it('a regular user cannot reach the owner\'s tools even by chat; and no approval is queued for them to nag the admin with', () => {
    const gate = new ToolGate({ settings: () => defaultSafety(), now: () => t })
    const blocked = runAs(user('bbbbbbbb'), () => gate.check('terminal', 'terminal run rm -rf /', 100))
    expect(blocked).toMatchObject({ allow: false })
    if (blocked.allow === false) expect(blocked.message).toMatch(/admin only/)
    expect(gate.pending()).toEqual([])
    expect(runAs(user('bbbbbbbb'), () => gate.check('research', 'research cats', 100))).toEqual({ allow: true })
    // The admin still gets asked, as before.
    expect(runAs(user('aaaaaaaa', 'zach', 'admin'), () => gate.check('terminal', 'terminal run ls', 100))).toMatchObject({ allow: false })
    expect(gate.pending()).toHaveLength(1)
  })
})

describe('nobody passes for another account on the points board', () => {
  it('a regular user cannot use someone else\'s account name, but can use their own and any free name', async () => {
    const { nameBelongsToAnotherAccount } = await import('../../models && skills/core/accounts.js')
    const s = await setup()
    const sam = await s.register('sam', PW)
    const ann = await s.register('ann', PW)
    const as = (w: Who) => (name: string) => runAs(w, () => nameBelongsToAnotherAccount(s, name))
    const samAsks = as(user(sam.id, 'sam'))
    expect(samAsks('ann')).toBe(true)
    expect(samAsks('ANN')).toBe(true) // case does not matter
    expect(samAsks('zach')).toBe(true) // nor does it matter that it is the admin
    expect(samAsks('sam')).toBe(false) // their own
    expect(samAsks('Pat')).toBe(false) // free
    expect(as(user(ann.id, 'ann'))('sam')).toBe(true)
  })

  it('the owner and the admin may list a friend who has an account', async () => {
    const { nameBelongsToAnotherAccount } = await import('../../models && skills/core/accounts.js')
    const s = await setup()
    const sam = await s.register('sam', PW)
    void sam
    expect(runAs(OWNER, () => nameBelongsToAnotherAccount(s, 'sam'))).toBe(false)
    expect(runAs(user('adminid', 'zach', 'admin'), () => nameBelongsToAnotherAccount(s, 'sam'))).toBe(false)
  })

  it('refuses when it cannot read the accounts, rather than letting a name through', async () => {
    const { nameBelongsToAnotherAccount } = await import('../../models && skills/core/accounts.js')
    const broken = { listUsers: () => { throw new Error('damaged') } } as unknown as AccountsStore
    expect(runAs(user('x', 'x'), () => nameBelongsToAnotherAccount(broken, 'anyone'))).toBe(true)
  })
})
