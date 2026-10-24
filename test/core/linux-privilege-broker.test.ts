/**
 * The Linux privilege broker: deny-by-default validation, independent of
 * whether pkexec is actually present on the machine running the test.
 */
import { describe, it, expect } from 'vitest'
import { manageService, rootAccessRequest, helperStatus, saveBrokerSettings, type BrokerSettings } from '../../models && skills/core/linux-privilege-broker.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

function tmpFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'nc-broker-'))
  return path.join(dir, 'broker.json')
}

describe('manageService', () => {
  it('rejects an unsupported action', async () => {
    const out = await manageService('delete', 'ssh.service', { enabled: true, allowedServices: [] })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/Unsupported action/)
  })

  it('rejects a malformed unit name', async () => {
    const out = await manageService('status', 'rm -rf /', { enabled: true, allowedServices: [] })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/not a valid systemd unit name/)
  })

  it('refuses a non-status action on a service that is not allowlisted', async () => {
    const out = await manageService('restart', 'ssh.service', { enabled: true, allowedServices: [] })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/not in the allowed services list/)
  })

  it('does not require an allowlist entry for a read-only status check', async () => {
    const out = await manageService('status', 'ssh.service', { enabled: true, allowedServices: [] })
    // Whether this succeeds depends on pkexec actually being installed here;
    // what matters is that it is never rejected for lacking an allowlist entry.
    expect(out.error ?? '').not.toMatch(/not in the allowed services list/)
  })

  it('allows a restart once the unit is explicitly allowlisted (still gated by pkexec itself)', async () => {
    const settings: BrokerSettings = { enabled: true, allowedServices: ['ssh.service'] }
    const out = await manageService('restart', 'ssh.service', settings)
    expect(out.error ?? '').not.toMatch(/not in the allowed services list/)
  })
})

describe('rootAccessRequest', () => {
  it('honestly refuses operations with no real adapter', async () => {
    for (const op of ['install-approved-package', 'configure-approved-firewall-rule', 'manage-approved-local-account', 'mount-approved-filesystem', 'apply-approved-security-policy']) {
      const out = await rootAccessRequest(op, 'anything')
      expect(out.ok, `${op} should not silently succeed`).toBe(false)
      expect(out.error).toMatch(/not implemented/)
    }
  })

  it('rejects an operation outside the known enum', async () => {
    const out = await rootAccessRequest('reformat-the-disk', 'anything')
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/Unknown operation/)
  })
})

describe('helperStatus', () => {
  it('reports the allowlist size honestly', async () => {
    const status = await helperStatus({ enabled: true, allowedServices: ['a.service', 'b.service'] })
    expect(status.allowedServiceCount).toBe(2)
    expect(typeof status.pkexecAvailable).toBe('boolean')
  })
})

describe('saveBrokerSettings', () => {
  it('persists and reports a real failure for an unwritable path', () => {
    const file = tmpFile()
    const ok = saveBrokerSettings({ enabled: false, allowedServices: ['x.service'] }, file)
    expect(ok.ok).toBe(true)
    rmSync(path.dirname(file), { recursive: true, force: true })

    const badFile = '/this/path/does/not/exist/and/cannot/be/created/broker.json'
    const failed = saveBrokerSettings({ enabled: true, allowedServices: [] }, badFile)
    expect(failed.ok).toBe(false)
    expect(failed.error).toBeTruthy()
  })
})
