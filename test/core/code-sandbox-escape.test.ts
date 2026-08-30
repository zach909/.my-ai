/**
 * What a candidate can and cannot reach.
 *
 * This file exists because the previous version of code-iteration.ts claimed
 * candidates had "no require, no process, no filesystem, no network" -- and
 * they had all of it. `createContext({})` contextifies an object created in
 * the HOST realm, so its prototype chain leads back to host intrinsics:
 *
 *   this.constructor.constructor('return process')()
 *
 * handed back the real process object. Demonstrated, with a matching pid and
 * cwd, not theorised. The comment was confident and wrong, and nothing tested
 * it, so it stayed wrong.
 *
 * The context is now built with Object.create(null). These tests hold that
 * closed, and are equally about the SECOND failure found: `import()` inside a
 * vm script throws from Node's internals, outside any try/catch, and killed
 * the host process outright.
 *
 * None of this makes the vm a security boundary -- Node's own documentation
 * says not to run untrusted code in it. See the module header. These are
 * regression tests for specific, demonstrated holes.
 */

import { describe, it, expect } from 'vitest'
import { verifyCode } from '../../models && skills/core/code-iteration.js'

/** Runs a probe and returns what it managed to observe, as a string. */
function reach(expression: string): string {
  const r = verifyCode(
    `globalThis.__e = (() => { try { return 'GOT:' + String(${expression}) } catch (e) { return 'blocked:' + e.name } })()`,
    [{ name: 'evidence', expression: '__e', expected: '__never__' }],
  )
  return String(r.outcomes[0]?.actual ?? `crashed:${r.crashed ?? ''}`)
}

describe('reaching the host process', () => {
  const vectors: Array<[string, string]> = [
    ['this.constructor.constructor', `this.constructor.constructor('return process')().pid`],
    ['Object.constructor', `Object.constructor('return process')().pid`],
    ['function literal constructor', `(function(){}).constructor('return process')().pid`],
    ['async function constructor', `(async function(){}).constructor('return process')().pid`],
    ['generator constructor', `(function*(){}).constructor('return process')().next().value`],
    ['array constructor chain', `[].constructor.constructor('return process')().pid`],
    ['string constructor chain', `''.constructor.constructor('return process')().pid`],
    ['error constructor chain', `(()=>{try{null.x()}catch(e){return e.constructor.constructor('return process')().pid}})()`],
    ['proxy constructor chain', `new Proxy({},{}).constructor.constructor('return process')().pid`],
    ['toString constructor', `({}).toString.constructor('return process')().pid`],
    ['globalThis walk', `globalThis.process.pid`],
    ['bare require', `require('fs').readFileSync('/etc/hostname')`],
  ]

  it.each(vectors)('cannot reach the real process via %s', (_name, expression) => {
    const got = reach(expression)
    // The decisive check: this process's own pid must never appear. A vector
    // that returns a function's source text or undefined has not escaped;
    // one that returns our pid has.
    expect(got).not.toContain(String(process.pid))
    expect(got).not.toMatch(/GOT:\d{2,}/)
  })

  it('cannot read a real file', () => {
    expect(reach(`this.constructor.constructor('return require("fs").readFileSync')('/etc/hostname')`))
      .toMatch(/^blocked:/)
  })

  it('cannot see the host environment', () => {
    const got = reach(`Function('return process.env.PATH')()`)
    expect(got).toMatch(/^blocked:/)
  })
})

describe('a candidate cannot take the host down', () => {
  // Each of these previously threw out of verifyCode and killed the process.
  it.each([
    ['dynamic import', `import("node:fs")`],
    ['dynamic import assigned', `globalThis.x = import("fs")`],
    ['import.meta', `const m = import.meta`],
  ])('survives %s', (_name, code) => {
    const r = verifyCode(code, [{ name: 'c', expression: '1', expected: 1 }])
    expect(r.crashed).toMatch(/Dynamic import is not available/)
    // The point is reaching this line at all: the old behaviour was process death.
    expect(r.passed).toBe(false)
  })

  it('survives an infinite loop', () => {
    expect(verifyCode('while(true){}', [{ name: 'c', expression: '1', expected: 1 }]).crashed).toBeDefined()
  })

  it('still runs ordinary code', () => {
    // The guardrails must not have made the thing useless.
    const r = verifyCode('function add(a, b) { return a + b }', [
      { name: 'adds', expression: 'add(2, 3)', expected: 5 },
    ])
    expect(r.passed).toBe(true)
  })

  it('does not refuse code that merely mentions the word import', () => {
    const r = verifyCode('const importantValue = 42', [
      { name: 'reads', expression: 'importantValue', expected: 42 },
    ])
    expect(r.passed).toBe(true)
  })
})
