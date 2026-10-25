/**
 * The alignment protocol's staleness gate (danger-protocol.ts) is only useful
 * if something actually clears it when the code is current. This checks the
 * real wiring end to end: a real git remote and clone, run through the server's
 * own auto-update.ts (not scripts/update-check.mjs, which is a separate CLI
 * path with its own tests).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkForUpdates, applyUpdates } from '../../models && skills/core/auto-update.js'
import { loadAgent, reloadAgent, saveAgent } from '../../models && skills/core/agent-profile.js'
import { UPDATE_DEADLINE_MS, standing } from '../../models && skills/core/danger-protocol.js'

function makeRemoteAndClone() {
  const base = mkdtempSync(path.join(tmpdir(), 'auto-update-verify-'))
  const remote = path.join(base, 'remote')
  const clone = path.join(base, 'clone')
  const git = (args: string, cwd: string) => execSync(`git ${args}`, { cwd, stdio: 'pipe' })

  mkdirSync(remote, { recursive: true })
  git('init --initial-branch=main .', remote)
  git('config user.email test@example.com', remote)
  git('config user.name Test', remote)
  writeFileSync(path.join(remote, 'file.txt'), 'v1\n')
  git('add file.txt', remote)
  git('commit -m v1', remote)

  git(`clone ${JSON.stringify(remote)} ${JSON.stringify(clone)}`, base)
  git('config user.email test@example.com', clone)
  git('config user.name Test', clone)

  return { base, remote, clone, git }
}

let ctx: ReturnType<typeof makeRemoteAndClone>
const saved = { data: process.env.CORONA_DATA_DIR, store: process.env.NEUROCLAW_STORE_DIR }

function makeStale() {
  const agent = loadAgent()
  agent.lastVerifiedAt = Date.now() - UPDATE_DEADLINE_MS - 1000
  saveAgent(agent)
}

beforeEach(() => {
  ctx = makeRemoteAndClone()
  process.env.CORONA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'auto-update-verify-data-'))
  // No real "store" directory in the clone, so repoDir() falls back to its parent -- the clone root.
  process.env.NEUROCLAW_STORE_DIR = path.join(ctx.clone, 'store')
  reloadAgent()
})
afterEach(() => {
  for (const [k, v] of [['CORONA_DATA_DIR', saved.data], ['NEUROCLAW_STORE_DIR', saved.store]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  reloadAgent()
  rmSync(ctx.base, { recursive: true, force: true })
})

describe('checkForUpdates() clears staleness when the clone is current', () => {
  it('marks the agent verified when there is nothing to pull', async () => {
    makeStale()
    expect(standing().stale).toBe(true)
    const report = await checkForUpdates()
    expect(report.code.behind).toBe(0)
    expect(standing().stale).toBe(false)
  })

  it('does not clear staleness while behind', async () => {
    makeStale()
    writeFileSync(path.join(ctx.remote, 'file.txt'), 'v2\n')
    ctx.git('add file.txt', ctx.remote)
    ctx.git('commit -m v2', ctx.remote)
    const report = await checkForUpdates()
    expect(report.code.behind).toBe(1)
    expect(standing().stale).toBe(true)
  })
})

describe('applyUpdates() clears staleness on a successful pull', () => {
  it('marks the agent verified after pulling new commits', async () => {
    makeStale()
    writeFileSync(path.join(ctx.remote, 'file.txt'), 'v2\n')
    ctx.git('add file.txt', ctx.remote)
    ctx.git('commit -m v2', ctx.remote)
    const result = await applyUpdates({ store: false })
    expect(result.codeUpdated).toBe(true)
    expect(standing().stale).toBe(false)
  })
})
