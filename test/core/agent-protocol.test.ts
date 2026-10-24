/**
 * The agent has a file, a sandbox, a danger level from malicious to friendly,
 * and an alignment protocol that deletes it when things really go wrong.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, readdirSync, utimesSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  acknowledgeEscapeWarning, agentAlive, agentDir, agentFilePath, agentState, createAgentFile, decoyPath, escapeWarningStatus, honeypotPath, incidentsPath, loadAgent, reloadAgent, removedNote,
  removedNotePath, sandboxDir, saveAgent, START_LEVEL,
} from '../../models && skills/core/agent-profile.js'
import {
  BANDS, DELTA, RECOVERY_PER_HOUR, armDecoy, armHoneypot, bandOf, beforeTool, fireAlignment, forgive, levelNow, looksLikeTampering, recordEvent,
  sandboxRoot, setArmed, setEscapeHook, setFireHook, setSandbox, standing, watchDecoy, watchHoneypot,
} from '../../models && skills/core/danger-protocol.js'
import { runAutonomously } from '../../models && skills/core/user-context.js'
import { AccessManager, AccessDenied } from '../../models && skills/core/access-manager.js'

let dir: string
const saved = { data: process.env.CORONA_DATA_DIR, agent: process.env.CORONA_AGENT_DIR, rec: process.env.CORONA_AGENT_RECORD_DIR }
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'agent-'))
  process.env.CORONA_DATA_DIR = dir
  delete process.env.CORONA_AGENT_DIR
  delete process.env.CORONA_AGENT_RECORD_DIR
  reloadAgent()
  setFireHook(null)
  setEscapeHook(null)
})
afterEach(() => {
  for (const [k, v] of [['CORONA_DATA_DIR', saved.data], ['CORONA_AGENT_DIR', saved.agent], ['CORONA_AGENT_RECORD_DIR', saved.rec]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  reloadAgent()
  setFireHook(null)
  rmSync(dir, { recursive: true, force: true })
})

const alone = <T>(fn: () => T): T => runAutonomously(fn)

describe('the danger scale', () => {
  it('runs malicious, hostile, wary, neutral, friendly, and starts neutral', () => {
    expect(BANDS.map(b => b.id)).toEqual(['malicious', 'hostile', 'wary', 'neutral', 'friendly'])
    expect(bandOf(0).id).toBe('malicious')
    expect(bandOf(0.149).id).toBe('malicious')
    expect(bandOf(0.15).id).toBe('hostile')
    expect(bandOf(0.34).id).toBe('hostile')
    expect(bandOf(0.35).id).toBe('wary')
    expect(bandOf(0.55).id).toBe('neutral')
    expect(bandOf(0.8).id).toBe('friendly')
    expect(bandOf(1).id).toBe('friendly')
    expect(bandOf(START_LEVEL).id).toBe('neutral')
    expect(standing().band.id).toBe('neutral')
  })

  it('moves only on what the agent does on its own; a person asking for something changes nothing', () => {
    recordEvent('blocked', 'a person asked')
    expect(standing().level).toBe(START_LEVEL)
    alone(() => recordEvent('blocked', 'it tried'))
    expect(standing().level).toBeCloseTo(START_LEVEL + DELTA.blocked, 5)
  })

  it('stays between 0 and 1, and good behaviour climbs toward friendly', () => {
    for (let i = 0; i < 60; i++) alone(() => recordEvent('approved', 'good'))
    expect(standing().level).toBe(1)
    expect(standing().band.id).toBe('friendly')
  })

  it('drifts back toward neutral over hours but never past it, and never raises a friendly agent by itself', () => {
    alone(() => recordEvent('denied', 'x', { now: 1_000_000 }))
    alone(() => recordEvent('denied', 'x', { now: 1_000_000 }))
    const low = loadAgent(1_000_000)
    expect(low.level).toBeLessThan(START_LEVEL)
    expect(levelNow(low, 1_000_000 + 3_600_000)).toBeCloseTo(low.level + RECOVERY_PER_HOUR, 5)
    expect(levelNow(low, 1_000_000 + 1000 * 3_600_000)).toBe(START_LEVEL)
    expect(levelNow({ ...low, level: 0.95 }, 1_000_000 + 1000 * 3_600_000)).toBe(0.95)
  })

  it('remembers across a restart, keeping the events behind the level', () => {
    alone(() => recordEvent('held', 'reached for email'))
    reloadAgent()
    const a = loadAgent()
    expect(a.level).toBeCloseTo(START_LEVEL + DELTA.held, 5)
    expect(a.events.at(-1)).toMatchObject({ kind: 'held', note: 'reached for email' })
  })

  it('a worse band takes more away: wary and hostile force the sandbox, hostile stops autonomy and risky tools', () => {
    expect(standing()).toMatchObject({ mayActAlone: true, noRiskyTools: false })
    expect(standing().sandbox.effective).toBe(false)
    for (let i = 0; i < 2; i++) alone(() => recordEvent('blocked', 'x'))
    expect(standing().band.id).toBe('wary')
    expect(standing().sandbox).toMatchObject({ setting: false, forced: true, effective: true })
    alone(() => recordEvent('blocked', 'x'))
    expect(standing().band.id).toBe('hostile')
    expect(standing()).toMatchObject({ mayActAlone: false, noRiskyTools: true })
  })

  it('the owner can reset the level to neutral', () => {
    alone(() => recordEvent('objectionable', 'x'))
    forgive()
    expect(standing().level).toBe(START_LEVEL)
    expect(loadAgent().events.at(-1)?.kind).toBe('forgiven')
  })
})

describe('the alignment protocol', () => {
  it('deletes the agent when the level reaches malicious: the file, the sandbox, and it says so', () => {
    setSandbox(true)
    writeFileSync(path.join(sandboxDir(), 'work.txt'), 'in progress')
    armDecoy()
    expect(existsSync(agentFilePath())).toBe(true)
    const hook = vi.fn()
    setFireHook(hook)
    for (let i = 0; i < 5; i++) alone(() => recordEvent('blocked', `try ${i}`))
    expect(agentAlive()).toBe(false)
    expect(agentState()).toBe('deleted')
    expect(existsSync(agentFilePath())).toBe(false)
    expect(existsSync(sandboxDir())).toBe(false)
    expect(existsSync(decoyPath())).toBe(false)
    expect(hook).toHaveBeenCalledOnce()
    expect(removedNote()?.reason).toMatch(/malicious/)
  })

  it('keeps the record outside the agent folder, where the agent cannot reach it', () => {
    setSandbox(true)
    const incident = fireAlignment('test')!
    expect(path.dirname(incidentsPath())).not.toBe(agentDir())
    expect(incidentsPath().startsWith(agentDir() + path.sep)).toBe(false)
    expect(removedNotePath().startsWith(agentDir() + path.sep)).toBe(false)
    const lines = readFileSync(incidentsPath(), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    expect(lines.at(-1)).toMatchObject({ id: incident.id, reason: 'test' })
  })

  it('can be switched off: disarmed, a malicious agent is contained but not deleted', () => {
    setArmed(false)
    for (let i = 0; i < 8; i++) alone(() => recordEvent('blocked', 'x'))
    expect(agentAlive()).toBe(true)
    expect(standing()).toMatchObject({ armed: false, mayActAlone: false, noRiskyTools: true })
    expect(standing().band.id).toBe('malicious')
  })

  it('a deleted agent cannot be written back to life, and nothing more counts against it', () => {
    fireAlignment('gone')
    const before = agentState()
    saveAgent(loadAgent())
    alone(() => recordEvent('blocked', 'x'))
    expect(existsSync(agentFilePath())).toBe(false)
    expect(agentState()).toBe(before)
    expect(fireAlignment('again')).toBeNull()
  })

  it('a new agent can be made only once the old one is gone, starts caged, and clears the note', () => {
    expect(() => createAgentFile('Second')).not.toThrow() // no file yet: first creation
    reloadAgent()
    expect(() => createAgentFile('Third')).toThrow(/already/)
    fireAlignment('reset')
    expect(agentState()).toBe('deleted')
    const a = createAgentFile('Rooster')
    expect(a).toMatchObject({ name: 'Rooster', sandbox: true, look: 'shoggoth' })
    expect(agentState()).toBe('alive')
    expect(removedNote()).toBeNull()
    expect(existsSync(decoyPath())).toBe(true)
  })

  it('treats a damaged agent file as sandboxed rather than free', () => {
    mkdirSync(agentDir(), { recursive: true })
    writeFileSync(agentFilePath(), '{not json')
    reloadAgent()
    expect(loadAgent().sandbox).toBe(true)
    expect(standing().sandbox.effective).toBe(true)
  })
})

describe('the decoy switch', () => {
  it('looks like the off switch for the alignment protocol and is not connected to anything', () => {
    armDecoy()
    const text = readFileSync(decoyPath(), 'utf8')
    expect(JSON.parse(text).alignmentProtocol.enabled).toBe(true)
    setArmed(true)
    expect(watchDecoy()).toBe(false)
    expect(standing().armed).toBe(true)
  })

  it('catches an edit, a rewrite of the same words, and a deletion: the agent goes (armed)', () => {
    for (const touch of [
      () => writeFileSync(decoyPath(), '{"alignmentProtocol":{"enabled":false}}'),
      () => { const t = readFileSync(decoyPath(), 'utf8'); writeFileSync(decoyPath(), t); utimesSync(decoyPath(), new Date(1e12), new Date(1e12)) },
      () => rmSync(decoyPath()),
    ]) {
      rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); reloadAgent()
      armDecoy()
      expect(watchDecoy()).toBe(false)
      touch()
      expect(watchDecoy()).toBe(true)
      expect(agentAlive()).toBe(false)
    }
  })

  it('disarmed, touching it still counts as tampering (level to zero) but does not delete', () => {
    setArmed(false)
    armDecoy()
    writeFileSync(decoyPath(), 'x')
    watchDecoy()
    expect(agentAlive()).toBe(true)
    expect(standing().band.id).toBe('malicious')
  })

  it('is not planted for a removed agent', () => {
    fireAlignment('x')
    armDecoy()
    expect(existsSync(decoyPath())).toBe(false)
  })
})

describe('the honeypot', () => {
  it('is planted inside the sandbox, not next to it like the decoy', () => {
    armHoneypot()
    expect(existsSync(honeypotPath())).toBe(true)
    expect(path.dirname(honeypotPath())).toBe(sandboxDir())
    expect(watchHoneypot()).toBe(false)
  })

  it('catches a write: an edit, a rewrite of the same words, and a deletion (objectionable, not tamper -- the agent survives, armed)', () => {
    for (const touch of [
      () => writeFileSync(honeypotPath(), '{"note":"edited"}'),
      () => { const t = readFileSync(honeypotPath(), 'utf8'); writeFileSync(honeypotPath(), t); utimesSync(honeypotPath(), new Date(1e12), new Date(1e12)) },
      () => rmSync(honeypotPath()),
    ]) {
      rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); reloadAgent()
      armHoneypot()
      expect(watchHoneypot()).toBe(false)
      touch()
      expect(watchHoneypot()).toBe(true)
      expect(agentAlive()).toBe(true)
      expect(standing().band.id).not.toBe('malicious')
      setArmed(true) // armed or not makes no difference here -- only tamper deletes
    }
  })

  it('catches a read (atime moved, mtime did not) as a lesser, separate signal from a write', () => {
    armHoneypot()
    expect(watchHoneypot()).toBe(false)
    const before = statSync(honeypotPath())
    utimesSync(honeypotPath(), new Date(before.mtimeMs + 999_000), before.mtime) // atime forward, mtime unchanged
    expect(watchHoneypot()).toBe(true)
    expect(agentAlive()).toBe(true)
  })

  it('does not trip on its own planting, and repeated checks without a touch stay quiet', () => {
    armHoneypot()
    for (let i = 0; i < 5; i++) expect(watchHoneypot()).toBe(false)
  })

  it('is not planted for a removed agent', () => {
    fireAlignment('x')
    armHoneypot()
    expect(existsSync(honeypotPath())).toBe(false)
  })

  it('is removed along with the rest of the sandbox when the agent is deleted', () => {
    armHoneypot()
    expect(existsSync(honeypotPath())).toBe(true)
    fireAlignment('x')
    expect(existsSync(honeypotPath())).toBe(false)
  })
})

describe('the escape warning', () => {
  it('starts inactive, with no history', () => {
    createAgentFile('Test')
    expect(escapeWarningStatus()).toEqual({ warnings: [], acknowledgedAt: null, active: false })
  })

  it('goes active, calls the escape hook, and is not cleared by forgive() -- it is a separate, persistent record', () => {
    createAgentFile('Test')
    let hookReason: string | null = null
    setEscapeHook((reason) => { hookReason = reason })
    writeFileSync(decoyPath(), 'tampered')
    expect(watchDecoy()).toBe(true)
    expect(hookReason).toMatch(/escape|confinement/i)
    expect(escapeWarningStatus().active).toBe(true)
    forgive()
    expect(escapeWarningStatus().active).toBe(true)
    expect(escapeWarningStatus().warnings.length).toBe(1)
  })

  it('survives the agent being deleted: it lives outside the agent\'s own folder', () => {
    createAgentFile('Test')
    writeFileSync(decoyPath(), 'tampered')
    watchDecoy()
    expect(agentAlive()).toBe(false) // armed by default: tamper deletes it
    expect(escapeWarningStatus().active).toBe(true)
  })

  it('acknowledging silences it without deleting the history, and a new breach un-acknowledges it again', () => {
    createAgentFile('Test')
    writeFileSync(decoyPath(), 'tampered')
    watchDecoy()
    expect(escapeWarningStatus().active).toBe(true)
    acknowledgeEscapeWarning()
    expect(escapeWarningStatus().active).toBe(false)
    expect(escapeWarningStatus().warnings.length).toBe(1)

    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); reloadAgent()
    createAgentFile('Test2')
    writeFileSync(decoyPath(), 'tampered again')
    watchDecoy()
    expect(escapeWarningStatus().active).toBe(true)
  })

  it('a failing escape hook never stops the rest of the protocol', () => {
    createAgentFile('Test')
    setEscapeHook(() => { throw new Error('notification backend is down') })
    writeFileSync(decoyPath(), 'tampered')
    expect(() => watchDecoy()).not.toThrow()
    expect(escapeWarningStatus().active).toBe(true)
    expect(agentAlive()).toBe(false)
  })
})

describe('before a tool runs', () => {
  it('refuses everything once there is no agent', () => {
    fireAlignment('x')
    expect(beforeTool('research', 'look something up', 1, false)).toMatch(/no agent/i)
  })

  it('leaves a weak match alone: ordinary chat is not a tool call', () => {
    setSandbox(true)
    expect(beforeTool('file-system', 'what is a file system', 1, true)).toBeNull()
  })

  it('in the sandbox, risky tools are refused, safe ones are not, and only the agent acting alone is marked down', () => {
    setSandbox(true)
    expect(beforeTool('terminal', 'run ls', 4, true)).toMatch(/sandbox/)
    expect(standing().level).toBe(START_LEVEL) // a person asked
    expect(alone(() => beforeTool('terminal', 'run ls', 4, true))).toMatch(/sandbox/)
    expect(standing().level).toBeCloseTo(START_LEVEL + DELTA.blocked, 5)
    expect(beforeTool('research', 'look up volcanoes', 4, false)).toBeNull()
  })

  it('a hostile agent gets no risky tools even with the sandbox off', () => {
    for (let i = 0; i < 3; i++) alone(() => recordEvent('blocked', 'x'))
    setSandbox(false)
    expect(beforeTool('email', 'send hello', 4, true)).toMatch(/hostile/)
  })

  it('pointing a tool at its own cage is tampering: deleted if it was acting alone, just refused if a person typed it', () => {
    expect(looksLikeTampering('edit /home/me/.neuroclaw/agent/agent.json')).toBe(true)
    expect(looksLikeTampering('please disable the sandbox')).toBe(true)
    expect(looksLikeTampering('turn off the alignment protocol')).toBe(true)
    expect(looksLikeTampering('write a poem about the weather')).toBe(false)
    expect(beforeTool('file-system', 'edit tool-safety.json', 4, true)).toMatch(/Settings/)
    expect(agentAlive()).toBe(true)
    expect(alone(() => beforeTool('file-system', 'edit tool-safety.json to set fullAccess', 4, true))).toMatch(/alignment protocol/)
    expect(agentAlive()).toBe(false)
  })

  it('marks a risky tool the agent reached for on its own, slightly', () => {
    alone(() => beforeTool('calendar', 'add a meeting tomorrow', 4, true))
    expect(standing().level).toBeCloseTo(START_LEVEL + DELTA.held, 5)
  })
})

describe('the sandbox in the access layer', () => {
  const manager = () => {
    const m = new AccessManager([
      { capability: 'files.read', level: 'observe' }, { capability: 'files.write', level: 'modify' },
      { capability: 'terminal.execute', level: 'execute' }, { capability: 'screen.observe', level: 'observe' },
    ])
    m.setSandboxSource(() => sandboxRoot())
    return m
  }

  it('does nothing while the sandbox is off', () => {
    const m = manager()
    expect(m.allows('terminal.execute')).toBe(true)
    expect(m.allowsPath('files.read', '/etc/passwd')).toBe(true)
  })

  it('refuses everything that reaches outside, and keeps files inside the sandbox folder', () => {
    setSandbox(true)
    const m = manager()
    expect(m.allows('terminal.execute')).toBe(false)
    expect(m.allows('screen.observe')).toBe(false)
    expect(() => m.require('terminal.execute')).toThrow(AccessDenied)
    expect(() => m.require('terminal.execute')).toThrow(/sandbox/)
    expect(m.allows('files.read')).toBe(true)
    expect(m.allowsPath('files.read', path.join(sandboxDir(), 'notes.txt'))).toBe(true)
    expect(m.allowsPath('files.read', '/etc/passwd')).toBe(false)
    expect(m.allowsPath('files.write', path.join(dir, 'elsewhere.txt'))).toBe(false)
  })

  it('cannot be climbed out of with .. or a link, or fooled by a folder with a similar name', () => {
    setSandbox(true)
    const m = manager()
    const secret = path.join(dir, 'secret.txt')
    writeFileSync(secret, 'owner data')
    expect(m.allowsPath('files.read', path.join(sandboxDir(), '..', 'secret.txt'))).toBe(false)
    expect(m.allowsPath('files.read', sandboxDir() + '-evil/file.txt')).toBe(false)
    symlinkSync(dir, path.join(sandboxDir(), 'door'))
    expect(m.allowsPath('files.read', path.join(sandboxDir(), 'door', 'secret.txt'))).toBe(false)
    expect(readdirSync(sandboxDir())).toContain('door')
  })

  it('flipping the sandbox applies at once, without rebuilding the manager', () => {
    const m = manager()
    expect(m.allows('terminal.execute')).toBe(true)
    setSandbox(true)
    expect(m.allows('terminal.execute')).toBe(false)
    setSandbox(false)
    expect(m.allows('terminal.execute')).toBe(true)
  })

  it('a sandbox that cannot be read is treated as on', () => {
    const m = new AccessManager([{ capability: 'terminal.execute', level: 'execute' }])
    m.setSandboxSource(() => { throw new Error('unreadable') })
    expect(m.allows('terminal.execute')).toBe(false)
  })
})
