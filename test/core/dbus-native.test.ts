/**
 * The D-Bus client, exercised against a real dbus-daemon.
 *
 * dbus-daemon is only the other end of the socket here (not part of the repo).
 * Both sides of every exchange are this client, which proves the marshalling is
 * self-consistent AND accepted by a real bus: the daemon parses every header we
 * send and would drop a malformed one.
 *
 * What is NOT covered: a real desktop portal. The portal flow is tested against
 * a stand-in that answers on the derived Request path, so the path derivation
 * and the match-before-call ordering are proved, but whether a given desktop's
 * portal shows a permission prompt is not something this can say.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { DBusConnection, DBusError, Variant, portalRequest, variantText } from '../../models && skills/core/desktop/dbus.js'

const haveDaemon = spawnSync('sh', ['-c', 'command -v dbus-daemon']).status === 0
let daemon: ChildProcess | null = null
let address = ''
const d = haveDaemon ? describe : describe.skip

beforeAll(async () => {
  if (!haveDaemon) return
  daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: ['ignore', 'pipe', 'ignore'] })
  address = await new Promise<string>(resolve => {
    let out = ''
    daemon!.stdout!.on('data', c => {
      out += c
      if (out.includes('\n')) resolve(out.trim())
    })
  })
})
afterAll(() => { daemon?.kill() })

const connect = () => {
  process.env.DBUS_SESSION_BUS_ADDRESS = address
  return DBusConnection.connect()
}

describe('formatting', () => {
  it('prints values the way gsettings does', () => {
    expect(variantText('prefer-dark')).toBe("'prefer-dark'")
    expect(variantText(true)).toBe('true')
    expect(variantText(new Variant('u', 3))).toBe('3')
    expect(variantText(['a', 'b'])).toBe("['a', 'b']")
    expect(variantText(new Map([['k', 1]]))).toBe("{'k': 1}")
  })
})

d('against a real bus daemon', () => {
  it('authenticates and is given a unique name', async () => {
    const bus = await connect()
    expect(bus.uniqueName).toMatch(/^:\d+\.\d+$/)
    bus.close()
  })

  it('round-trips every supported type through a method call', async () => {
    const server = await connect()
    await server.requestName('ai.neuroclaw.Test')
    server.onMethodCall(call => {
      // Echo the whole body back with the same signature.
      server.reply(call, call.signature, call.body)
    })
    const client = await connect()
    const dict = new Map<string, Variant>([
      ['s', new Variant('s', 'héllo ✓')],
      ['b', new Variant('b', true)],
      ['u', new Variant('u', 4000000000)],
      ['as', new Variant('as', ['x', 'y'])],
    ])
    const [str, num, i64, f, bool, arr, ad, st, v] = await client.call(
      'ai.neuroclaw.Test', '/t', 'ai.neuroclaw.Test', 'Echo',
      'suxdbaia{sv}(ys)v',
      ['wörld', 42, 1234567890123n, 2.5, true, [1, 2, 3], dict, [7, 'seven'], new Variant('a{ss}', new Map([['a', 'b']]))],
    )
    expect(str).toBe('wörld')
    expect(num).toBe(42)
    expect(i64).toBe(1234567890123n)
    expect(f).toBe(2.5)
    expect(bool).toBe(true)
    expect(arr).toEqual([1, 2, 3])
    expect((ad as Map<string, Variant>).get('s')!.value).toBe('héllo ✓')
    expect((ad as Map<string, Variant>).get('u')!.value).toBe(4000000000)
    expect((ad as Map<string, Variant>).get('as')!.value).toEqual(['x', 'y'])
    expect(st).toEqual([7, 'seven'])
    expect((v as Variant).sig).toBe('a{ss}')
    expect((v as Variant).value).toEqual(new Map([['a', 'b']]))
    client.close(); server.close()
  })

  it('surfaces a remote error with its name', async () => {
    const server = await connect()
    await server.requestName('ai.neuroclaw.Err')
    server.onMethodCall(call => server.replyError(call, 'ai.neuroclaw.Err.Nope', 'not today'))
    const client = await connect()
    const err = await client.call('ai.neuroclaw.Err', '/', 'ai.neuroclaw.Err', 'Do').catch(e => e)
    expect(err).toBeInstanceOf(DBusError)
    expect(err.name_).toBe('ai.neuroclaw.Err.Nope')
    expect(err.message).toContain('not today')
    client.close(); server.close()
  })

  it('reports a name nobody owns instead of hanging', async () => {
    const client = await connect()
    await expect(client.call('ai.neuroclaw.Nobody', '/', 'x.Y', 'Z', '', [], 3000)).rejects.toThrow(/ServiceUnknown|name/i)
    client.close()
  })

  it('delivers signals that match a rule', async () => {
    const a = await connect()
    const b = await connect()
    await b.addMatch("type='signal',interface='ai.neuroclaw.Sig',member='Ping'")
    const got = new Promise<unknown[]>(resolve => b.onSignal(m => m.member === 'Ping' && resolve(m.body)))
    a.emitSignal('/p', 'ai.neuroclaw.Sig', 'Ping', 'su', ['hi', 9])
    expect(await got).toEqual(['hi', 9])
    a.close(); b.close()
  })

  it('completes the portal request flow, listening before it calls', async () => {
    // A stand-in for xdg-desktop-portal: answers the call with a handle and
    // emits Response on the request path derived from the caller's name.
    const portal = await connect()
    await portal.requestName('org.freedesktop.portal.Desktop')
    portal.onMethodCall(call => {
      const [, options] = call.body as [string, Map<string, Variant>]
      const token = options.get('handle_token')!.value as string
      const sender = call.sender!.replace(/^:/, '').replace(/\./g, '_')
      const handle = `/org/freedesktop/portal/desktop/request/${sender}/${token}`
      portal.reply(call, 'o', [handle])
      // Emitted immediately, i.e. before a late listener could have been added.
      portal.emitSignal(handle, 'org.freedesktop.portal.Request', 'Response', 'ua{sv}', [
        0,
        new Map([['uri', new Variant('s', 'file:///tmp/shot.png')]]),
      ])
    })
    const client = await connect()
    const res = await portalRequest(client, 'org.freedesktop.portal.Screenshot', 'Screenshot', 'sa{sv}', token => [
      '',
      new Map([['handle_token', new Variant('s', token)], ['interactive', new Variant('b', false)]]),
    ], 5000)
    expect(res.response).toBe(0)
    expect(res.results.get('uri')!.value).toBe('file:///tmp/shot.png')
    client.close(); portal.close()
  })
})
