/**
 * The donor captures nothing until it is told to, tells the truth about when
 * it is recording, and can always be stopped and emptied.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  loadDonorSettings, updateDonorSettings, pauseDonor, ingestDonation, drainDonations,
  eraseAllDonations, donorStatus, spoolStatus, captureBlocked, DonorError,
} from '../../models && skills/core/data-donor.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'corona-donor-'))
  process.env.CORONA_DONOR_DIR = dir
})
afterEach(() => {
  delete process.env.CORONA_DONOR_DIR
  rmSync(dir, { recursive: true, force: true })
})

const on = (src: 'screen' | 'audio' = 'audio') => updateDonorSettings({ enabled: true, sources: { [src]: true }, acknowledge: true })

describe('data donor', () => {
  it('is entirely off by default and captures nothing', () => {
    const s = loadDonorSettings()
    expect(s.enabled).toBe(false)
    expect(s.sources).toEqual({ screen: false, audio: false })
    expect(ingestDonation('audio', new Uint8Array([1]))).toMatchObject({ accepted: false })
    expect(donorStatus().anyRecording).toBe(false)
    expect(spoolStatus().chunks).toBe(0)
  })

  it('will not switch a source on without acknowledgement, and records when it did', () => {
    expect(() => updateDonorSettings({ enabled: true, sources: { audio: true } })).toThrow(/acknowledge/)
    expect(loadDonorSettings().sources.audio).toBe(false)
    on('audio')
    const s = loadDonorSettings()
    expect(s.sources.audio).toBe(true)
    expect(typeof s.consentAt.audio).toBe('number')
    expect(s.consentAt.screen).toBeNull()
  })

  it('needs both the master switch and the source', () => {
    updateDonorSettings({ sources: { audio: true }, acknowledge: true })
    expect(ingestDonation('audio', new Uint8Array([1]))).toMatchObject({ accepted: false })
    updateDonorSettings({ enabled: true })
    expect(ingestDonation('audio', new Uint8Array([1]))).toMatchObject({ accepted: true })
    expect(ingestDonation('screen', new Uint8Array([1]))).toMatchObject({ accepted: false })
  })

  it('stops on the very next chunk when switched off, and pauses without losing settings', () => {
    on()
    expect(ingestDonation('audio', new Uint8Array([1])).accepted).toBe(true)
    pauseDonor(30)
    expect(ingestDonation('audio', new Uint8Array([1]))).toMatchObject({ accepted: false, reason: 'Paused.' })
    expect(loadDonorSettings().sources.audio).toBe(true)
    pauseDonor(0)
    expect(ingestDonation('audio', new Uint8Array([1])).accepted).toBe(true)
    updateDonorSettings({ enabled: false })
    expect(ingestDonation('audio', new Uint8Array([1])).accepted).toBe(false)
  })

  it('honours quiet hours, including across midnight', () => {
    on()
    updateDonorSettings({ quietHours: { from: '22:00', to: '07:00' } })
    const s = loadDonorSettings()
    const at = (h: number, m = 0) => new Date(2026, 0, 5, h, m).getTime()
    expect(captureBlocked('audio', s, at(23))).toBe('Quiet hours.')
    expect(captureBlocked('audio', s, at(3))).toBe('Quiet hours.')
    expect(captureBlocked('audio', s, at(12))).toBeNull()
    expect(() => updateDonorSettings({ quietHours: { from: '25:00', to: '07:00' } })).toThrow(DonorError)
  })

  it('rejects empty and oversized chunks', () => {
    on()
    expect(ingestDonation('audio', new Uint8Array(0)).accepted).toBe(false)
    expect(ingestDonation('audio', new Uint8Array(5 * 1024 * 1024)).accepted).toBe(false)
  })

  it('is a ring: the oldest chunks go first when the cap is reached', () => {
    on()
    updateDonorSettings({ maxSpoolMb: 16 })
    const chunk = new Uint8Array(3 * 1024 * 1024)
    for (let i = 0; i < 7; i++) ingestDonation('audio', chunk, 1_000_000_000_000 + i)
    const st = spoolStatus()
    expect(st.bytes).toBeLessThanOrEqual(16 * 1024 * 1024)
    expect(st.chunks).toBe(5)
  })

  it('drains oldest first, and keeps a chunk when the trainer fails on it', async () => {
    on()
    ingestDonation('audio', new Uint8Array([1]), 1_000_000_000_001)
    ingestDonation('audio', new Uint8Array([2]), 1_000_000_000_002)
    ingestDonation('audio', new Uint8Array([3]), 1_000_000_000_003)
    const seen: number[] = []
    const r1 = await drainDonations(async (_s, b) => { if (b[0] === 2) throw new Error('trainer down'); seen.push(b[0]) })
    expect(seen).toEqual([1])
    expect(r1).toEqual({ trained: 1, failed: 1 })
    expect(spoolStatus().chunks).toBe(2)
    const r2 = await drainDonations(async (_s, b) => { seen.push(b[0]) })
    expect(seen).toEqual([1, 2, 3])
    expect(r2.trained).toBe(2)
    expect(spoolStatus().chunks).toBe(0)
  })

  it('erases everything, even when switched off', () => {
    on()
    ingestDonation('audio', new Uint8Array([1]))
    ingestDonation('audio', new Uint8Array([2]))
    updateDonorSettings({ enabled: false })
    expect(eraseAllDonations()).toBe(2)
    expect(spoolStatus().chunks).toBe(0)
  })

  it('reports recording truthfully for an on-screen indicator', () => {
    on('audio')
    expect(donorStatus().recording).toEqual({ screen: false, audio: true })
    pauseDonor(5)
    expect(donorStatus().anyRecording).toBe(false)
  })

  it('treats a corrupt settings file as off', () => {
    on()
    require('node:fs').writeFileSync(path.join(dir, 'settings.json'), '{{{')
    expect(loadDonorSettings().enabled).toBe(false)
  })
})
