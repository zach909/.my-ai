/**
 * The ambient layer behind every page.
 *
 * What these protect: the layer is added to a page exactly once, it never
 * mangles something that is not a page, the two assets are reachable before a
 * login (the login page needs them), and the script that ships as a string
 * still parses.
 */

import { describe, it, expect } from 'vitest'
import { AMBIENT_CSS, AMBIENT_JS, injectAmbient, isAmbientRoute } from '../../interface/ambient.js'

const PAGE = '<!DOCTYPE html><html><head><title>t</title></head><body><p>hi</p></body></html>'

describe('injectAmbient', () => {
  it('adds the stylesheet before </head> and the script before </body>', () => {
    const out = injectAmbient(PAGE)
    expect(out.indexOf('/ambient.css')).toBeLessThan(out.indexOf('</head>'))
    expect(out.indexOf('/ambient.js')).toBeGreaterThan(out.indexOf('<p>hi</p>'))
    expect(out.indexOf('/ambient.js')).toBeLessThan(out.indexOf('</body>'))
  })

  it('makes the AI icon the page icon in place of whatever it named', () => {
    const out = injectAmbient('<html><head><link rel="icon" href="/favicon.svg"><link rel="shortcut icon" href="x.ico"></head><body></body></html>')
    expect(out).not.toContain('favicon.svg')
    expect(out).not.toContain('x.ico')
    expect(out.match(/rel="icon"/g)).toHaveLength(1)
    expect(out).toContain('/ai-icon.jpg')
  })

  it('is safe to apply twice', () => {
    const once = injectAmbient(PAGE)
    expect(injectAmbient(once)).toBe(once)
    expect(once.match(/ambient\.js/g)).toHaveLength(1)
  })

  it('leaves a fragment that is not a page alone', () => {
    expect(injectAmbient('{"ok":true}')).toBe('{"ok":true}')
    expect(injectAmbient('<p>just a paragraph</p>')).toBe('<p>just a paragraph</p>')
  })

  it('still works on a page with no closing body tag', () => {
    const out = injectAmbient('<html><head></head><body><p>x</p>')
    expect(out).toContain('/ambient.css')
    expect(out).toContain('/ambient.js')
  })

  it('works on a page with a <body> but no <head>', () => {
    const out = injectAmbient('<body><p>x</p></body>')
    expect(out.indexOf('/ambient.css')).toBeLessThan(out.indexOf('<body'))
  })
})

describe('the assets', () => {
  it('are public for reads only, and only those two paths', () => {
    expect(isAmbientRoute('/ambient.css', 'GET')).toBe(true)
    expect(isAmbientRoute('/ambient.js', 'GET')).toBe(true)
    expect(isAmbientRoute('/ambient.js', 'HEAD')).toBe(true)
    expect(isAmbientRoute('/ai-icon.jpg', 'GET')).toBe(true)
    expect(isAmbientRoute('/ai-icon.jpg', 'POST')).toBe(false)
    expect(isAmbientRoute('/ambient.js', 'POST')).toBe(false)
    expect(isAmbientRoute('/ambient.js.map', 'GET')).toBe(false)
    expect(isAmbientRoute('/api/store', 'GET')).toBe(false)
  })

  it('ship a script that parses and a stylesheet with its tokens', () => {
    expect(() => new Function(AMBIENT_JS)).not.toThrow()
    expect(AMBIENT_CSS).toContain('#nc-ambient')
    expect(AMBIENT_CSS).toContain('--primary')
  })

  it('load nothing from anywhere else', () => {
    expect(AMBIENT_JS).not.toMatch(/https?:\/\//)
    expect(AMBIENT_CSS).not.toMatch(/https?:\/\//)
  })
})
