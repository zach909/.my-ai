/**
 * The admin is the computer's own administrator. The check asks the operating
 * system and says no whenever it cannot tell.
 */
import { describe, it, expect } from 'vitest'
import { checkComputerAdministrator, type AdminProbe } from '../../models && skills/core/computer-admin.js'

const probe = (p: Partial<Pick<AdminProbe, 'platform' | 'uid'>> & { out?: string; fail?: boolean }): AdminProbe => ({
  platform: p.platform ?? 'linux',
  uid: p.uid === undefined ? 1000 : p.uid,
  run: () => {
    if (p.fail) throw new Error('no such program')
    return p.out ?? ''
  },
})

describe('is this the computer administrator?', () => {
  it('root is, without asking anything', () => {
    let asked = false
    expect(checkComputerAdministrator({ platform: 'linux', uid: 0, run: () => { asked = true; return '' } })).toBe(true)
    expect(asked).toBe(false)
  })

  it('on Linux and macOS, a member of sudo, wheel, admin or root is', () => {
    for (const g of ['sudo', 'wheel', 'admin', 'root']) {
      expect(checkComputerAdministrator(probe({ out: `sam staff ${g} docker\n` })), g).toBe(true)
    }
    expect(checkComputerAdministrator(probe({ platform: 'darwin', out: 'sam staff admin everyone' }))).toBe(true)
  })

  it('an ordinary user is not, and a group that merely contains the word is not', () => {
    expect(checkComputerAdministrator(probe({ out: 'sam users docker' }))).toBe(false)
    expect(checkComputerAdministrator(probe({ out: 'sam sudoers wheelhouse administrators' }))).toBe(false)
    expect(checkComputerAdministrator(probe({ out: '' }))).toBe(false)
  })

  it('on Windows, membership of the Administrators group is', () => {
    expect(checkComputerAdministrator(probe({ platform: 'win32', uid: null, out: 'BUILTIN\\Administrators   Alias  S-1-5-32-544  Group used for deny only' }))).toBe(true)
    expect(checkComputerAdministrator(probe({ platform: 'win32', uid: null, out: 'BUILTIN\\Users  Alias  S-1-5-32-545' }))).toBe(false)
  })

  it('says no whenever it cannot tell', () => {
    expect(checkComputerAdministrator(probe({ fail: true }))).toBe(false)
    expect(checkComputerAdministrator(probe({ platform: 'win32', uid: null, fail: true }))).toBe(false)
  })
})
