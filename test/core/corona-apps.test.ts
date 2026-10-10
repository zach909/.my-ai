/**
 * Apps get nothing by default, and what they get is exactly what was granted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  registerApp, listApps, revokeApp, setAppScopes, authenticateApp, appAllows,
  requestedScopes, bearerToken, AppRateLimiter, AppError,
} from '../../models && skills/core/corona-apps.js'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'corona-apps-'))
  file = path.join(dir, 'apps.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('corona apps', () => {
  it('issues a token that authenticates, and stores only its hash', () => {
    const { app, token } = registerApp({ name: 'Notes', source: 'program', scopes: ['chat'] }, file)
    expect(token.startsWith('ca_')).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain(token)
    expect(JSON.stringify(listApps(file))).not.toContain('tokenHash')
    const got = authenticateApp(token, file)
    expect(got?.id).toBe(app.id)
    expect(appAllows(got!, 'chat')).toBe(true)
    expect(appAllows(got!, 'store.publish')).toBe(false)
  })

  it('rejects unknown, empty and revoked tokens', () => {
    const { app, token } = registerApp({ name: 'Notes', source: 'program', scopes: [] }, file)
    expect(authenticateApp('ca_nope', file)).toBeNull()
    expect(authenticateApp(null, file)).toBeNull()
    expect(revokeApp(app.id, file)).toBe(true)
    expect(authenticateApp(token, file)).toBeNull()
    expect(revokeApp(app.id, file)).toBe(false)
  })

  it('refuses scopes that do not exist', () => {
    expect(() => registerApp({ name: 'X', source: 'program', scopes: ['root'] }, file)).toThrow(AppError)
  })

  it('a store app can only be granted what its app.json asked for', () => {
    const requested = requestedScopes(JSON.stringify({ scopes: ['chat', 'bogus'] }))
    expect(requested).toEqual(['chat'])
    expect(() => registerApp({ name: 'Greedy', source: 'store', storeItem: 'greedy', scopes: ['chat', 'store.publish'], requested }, file)).toThrow(/never asked/)
    const { app } = registerApp({ name: 'Modest', source: 'store', storeItem: 'modest', scopes: ['chat'], requested }, file)
    expect(() => setAppScopes(app.id, ['compute.borrow'], requested, file)).toThrow(/never asked/)
    expect(setAppScopes(app.id, [], requested, file).scopes).toEqual([])
  })

  it('an unreadable manifest asks for nothing', () => {
    expect(requestedScopes('{not json')).toEqual([])
    expect(requestedScopes(null)).toEqual([])
  })

  it('does not allow two live apps with one name', () => {
    registerApp({ name: 'Dup', source: 'program', scopes: [] }, file)
    expect(() => registerApp({ name: 'dup', source: 'program', scopes: [] }, file)).toThrow(/already registered/)
  })

  it('parses bearer headers and rate limits per app', () => {
    expect(bearerToken('Bearer abc')).toBe('abc')
    expect(bearerToken('Basic abc')).toBeNull()
    let t = 0
    const lim = new AppRateLimiter(2, () => t)
    expect([lim.allow('a'), lim.allow('a'), lim.allow('a'), lim.allow('b')]).toEqual([true, true, false, true])
    t = 61_000
    expect(lim.allow('a')).toBe(true)
  })

  it('treats a corrupt file as nobody registered', () => {
    registerApp({ name: 'A', source: 'program', scopes: [] }, file)
    require('node:fs').writeFileSync(file, '{{{')
    expect(listApps(file)).toEqual([])
  })
})
