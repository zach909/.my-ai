/**
 * The agent's workspace, and the permission layer that bounds it.
 *
 * Two things are worth testing hardest: that the coordination is real (one
 * terminal can see another's failure, which is what the whole design is for),
 * and that a capability nobody granted is genuinely refused.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  AccessManager,
  AccessDenied,
  ACCESS_LEVELS,
  CAPABILITY_MINIMUM,
  defaultGrants,
} from '../../models && skills/core/access-manager.js'
import { AgentWorkspace, WorkspaceError } from '../../models && skills/core/agent-workspace.js'

describe('the access manager', () => {
  it('refuses anything nobody granted, and says what would have been needed', () => {
    const access = new AccessManager()
    expect(() => access.require('files.write')).toThrow(AccessDenied)
    try {
      access.require('terminal.execute')
    } catch (e) {
      expect((e as Error).message).toContain('terminal.execute')
      expect((e as Error).message).toContain('execute')
    }
  })

  it('treats levels as ordered, so a higher grant covers a lower need', () => {
    const access = new AccessManager([{ capability: 'files.write', level: 'execute' }])
    expect(access.allows('files.write', 'modify')).toBe(true)
    expect(access.allows('files.write', 'privileged')).toBe(false)
  })

  it('refuses a grant below the level a capability requires, rather than quietly raising it', () => {
    // Silently upgrading someone who misunderstood what they were granting is
    // the worst possible response to that misunderstanding.
    const access = new AccessManager()
    expect(() => access.grant({ capability: 'terminal.execute', level: 'observe' })).toThrow(/requires at least/)
  })

  it('confines a path grant with a prefix check, not a substring match', () => {
    const access = new AccessManager([{ capability: 'files.read', level: 'observe', paths: ['/home/me/work'] }])
    expect(access.allowsPath('files.read', '/home/me/work/file.txt')).toBe(true)
    expect(access.allowsPath('files.read', '/home/me/work')).toBe(true)
    // The one that string containment gets wrong.
    expect(access.allowsPath('files.read', '/home/me/workspace-secrets/x')).toBe(false)
    expect(access.allowsPath('files.read', '/etc/passwd')).toBe(false)
  })

  it('grants nothing dangerous by default', () => {
    const access = new AccessManager(defaultGrants())
    // Input synthesis is how an agent clicks the wrong thing; it has to be
    // chosen, not inherited.
    expect(access.allows('mouse.control')).toBe(false)
    expect(access.allows('keyboard.control')).toBe(false)
    expect(access.allows('files.write')).toBe(false)
    expect(access.allows('system.services')).toBe(false)
    expect(access.allows('network.configure')).toBe(false)
    // But it can look, and work in its own terminals.
    expect(access.allows('files.read')).toBe(true)
    expect(access.allows('terminal.execute')).toBe(true)
  })

  it('has no capability for controlling the user workspace at all', () => {
    // The user/agent boundary is an absence, not a permission someone can
    // turn up: observation exists, control does not.
    const names = Object.keys(CAPABILITY_MINIMUM)
    expect(names).toContain('user.observe')
    expect(names.some(n => n.startsWith('user.') && n !== 'user.observe')).toBe(false)
    expect(ACCESS_LEVELS[0]).toBe('observe')
  })
})

describe('the agent workspace', () => {
  let home: string
  let access: AccessManager
  let ws: AgentWorkspace

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'agent-ws-'))
    access = new AccessManager([
      { capability: 'terminal.open', level: 'execute' },
      { capability: 'terminal.execute', level: 'execute' },
      { capability: 'files.read', level: 'observe', paths: [home] },
      { capability: 'files.write', level: 'modify', paths: [home] },
      { capability: 'files.delete', level: 'modify', paths: [home] },
    ])
    ws = new AgentWorkspace(access, home)
  })
  afterEach(() => {
    ws.dispose()
    rmSync(home, { recursive: true, force: true })
  })

  it('opens several terminals at once, each with its own context', () => {
    ws.openTerminal('server')
    ws.openTerminal('tests')
    ws.openTerminal('logs')
    expect(ws.terminals().map(t => t.id)).toEqual(['server', 'tests', 'logs'])
  })

  it('refuses a duplicate terminal id rather than silently replacing one', () => {
    ws.openTerminal('a')
    expect(() => ws.openTerminal('a')).toThrow(WorkspaceError)
  })

  it('runs a command and reports output, exit code and duration', async () => {
    ws.openTerminal('t')
    const res = await ws.run('t', 'echo', ['hello'])
    expect(res.exitCode).toBe(0)
    expect(res.stdout.trim()).toBe('hello')
    expect(res.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('reports a failing command as a failure rather than throwing', async () => {
    ws.openTerminal('t')
    const res = await ws.run('t', 'sh', ['-c', 'echo oops >&2; exit 3'])
    expect(res.exitCode).toBe(3)
    expect(res.stderr).toContain('oops')
  })

  it('reports a command that could not start, instead of crashing the workspace', async () => {
    ws.openTerminal('t')
    const res = await ws.run('t', 'definitely-not-a-real-binary-xyz')
    expect(res.exitCode).toBe(127)
    // The workspace is still usable afterwards.
    expect((await ws.run('t', 'echo', ['still here'])).stdout.trim()).toBe('still here')
  })

  it('lets one terminal see what happened in another — the whole point', async () => {
    // The spec's worked example: tests fail in one terminal, and the agent
    // reasoning elsewhere has to be able to see that failure.
    ws.openTerminal('build')
    ws.openTerminal('tests')
    await ws.run('tests', 'sh', ['-c', 'echo "FAIL: 2 tests failed" >&2; exit 1'])

    const seenFromElsewhere = ws.readTerminal('tests', 20).join('\n')
    expect(seenFromElsewhere).toContain('FAIL: 2 tests failed')
  })

  it('turns commands into an observable event stream', async () => {
    ws.openTerminal('t')
    await ws.run('t', 'echo', ['x'])
    const kinds = ws.eventStream({ session: 't' }).map(e => e.kind)
    expect(kinds).toContain('terminal.opened')
    expect(kinds).toContain('command.started')
    expect(kinds).toContain('command.finished')
    const finished = ws.eventStream({ session: 't', kinds: ['command.finished'] }).at(-1)
    expect(finished?.exitCode).toBe(0)
  })

  it('refuses to run in a terminal that was never opened', async () => {
    await expect(ws.run('ghost', 'echo', ['x'])).rejects.toThrow(WorkspaceError)
  })

  it('reads, writes, moves and deletes files inside its grant', () => {
    ws.writeFile('notes/a.txt', 'hello')
    expect(ws.readFile('notes/a.txt')).toBe('hello')
    ws.moveFile('notes/a.txt', 'notes/b.txt')
    expect(ws.readFile('notes/b.txt')).toBe('hello')
    ws.deleteFile('notes/b.txt')
    expect(existsSync(path.join(home, 'notes/b.txt'))).toBe(false)
  })

  it('refuses to touch anything outside the granted paths', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'not-mine-'))
    writeFileSync(path.join(outside, 'secret.txt'), 'private')
    try {
      expect(() => ws.readFile(path.join(outside, 'secret.txt'))).toThrow(AccessDenied)
      expect(() => ws.writeFile(path.join(outside, 'new.txt'), 'x')).toThrow(AccessDenied)
      expect(existsSync(path.join(outside, 'new.txt'))).toBe(false)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('checks both ends of a move, so a confined grant cannot relocate a file out of its boundary', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'not-mine-'))
    try {
      ws.writeFile('inside.txt', 'data')
      expect(() => ws.moveFile('inside.txt', path.join(outside, 'escaped.txt'))).toThrow(AccessDenied)
      expect(existsSync(path.join(outside, 'escaped.txt'))).toBe(false)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('records refusals, so the agent can see what it may not do', () => {
    const readOnly = new AgentWorkspace(new AccessManager([{ capability: 'files.read', level: 'observe' }]), home)
    expect(() => readOnly.writeFile('x.txt', 'y')).toThrow(AccessDenied)
    expect(readOnly.eventStream({ kinds: ['denied'] }).length).toBe(1)
  })

  it('cannot open a terminal without the capability', () => {
    const nothing = new AgentWorkspace(new AccessManager(), home)
    expect(() => nothing.openTerminal('t')).toThrow(AccessDenied)
  })

  it('lists a directory it may read', () => {
    mkdirSync(path.join(home, 'proj'), { recursive: true })
    writeFileSync(path.join(home, 'proj', 'one.txt'), 'a')
    const listing = ws.listDirectory('proj')
    expect(listing.map(e => e.name)).toEqual(['one.txt'])
    expect(listing[0].directory).toBe(false)
  })
})
