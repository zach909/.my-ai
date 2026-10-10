/**
 * The avatar: what it sends the mesh, and that its page keeps to the look and
 * the rules (no blue, no outside code, nothing transcribed).
 */
import { describe, it, expect } from 'vitest'
import { pcmToBytes, bytesToPcm, AVATAR_HTML, VOICE_MAX_BYTES, VOICE_RATE } from '../../interface/avatar.js'
import { injectAmbient } from '../../interface/ambient.js'

describe('pcmToBytes', () => {
  it('turns sound into 8-bit unsigned bytes with silence in the middle', () => {
    const out = pcmToBytes([0, 0, 0, 0], 8000, 8000)
    expect(Array.from(out)).toEqual([128, 128, 128, 128])
    expect(Array.from(pcmToBytes([-1, 1], 8000, 8000))).toEqual([0, 255])
  })

  it('brings a 48 kHz microphone down to 8 kHz by averaging, not by dropping samples', () => {
    expect(Array.from(pcmToBytes([1, 1, 1, 1, 1, 1], 48000, 8000))).toEqual([255])
    expect(Array.from(pcmToBytes([1, 1, 1, -1, -1, -1], 48000, 8000))).toEqual([128])   // the six average out
    expect(pcmToBytes(new Array(48000).fill(0), 48000, 8000, 10000).length).toBe(8000)
  })

  it('never sends more than the limit, and keeps the start of what was said', () => {
    const long = new Float32Array(48000).map((_, i) => (i < 6 ? 1 : 0))
    const out = pcmToBytes(long, 48000, VOICE_RATE)
    expect(out.length).toBe(VOICE_MAX_BYTES)
    expect(out[0]).toBe(255)
    expect(pcmToBytes(long, 48000, VOICE_RATE, 5).length).toBe(5)
  })

  it('clamps loud peaks and handles empty input', () => {
    expect(Array.from(pcmToBytes([5, -5], 8000, 8000))).toEqual([255, 0])
    expect(pcmToBytes([], 48000).length).toBe(0)
  })

  it('round-trips with bytesToPcm to within one step', () => {
    const wave = [-1, -0.5, 0, 0.5, 1]
    const back = bytesToPcm(pcmToBytes(wave, 8000, 8000))
    back.forEach((v, i) => expect(Math.abs(v - wave[i])).toBeLessThan(0.01))
  })
})

describe('the avatar page', () => {
  it('is in the shared look: glass, pills, coral, no blue', () => {
    expect(AVATAR_HTML).toContain('nc-soft')
    expect(AVATAR_HTML).toContain('nc-glass')
    expect(AVATAR_HTML).not.toMatch(/#4a7dff|#1e3a5f|indigo|cyan/i)
    expect(AVATAR_HTML).not.toMatch(/https?:\/\//)   // nothing fetched from outside
  })

  it('has the ring added by the server, once', () => {
    const page = injectAmbient(AVATAR_HTML)
    expect(page).toContain('/ambient.js')
    expect(injectAmbient(page)).toBe(page)
  })

  it('sends sound as raw bytes and has no speech-to-text in it', () => {
    expect(AVATAR_HTML).toContain('/api/doorways/send')
    expect(AVATAR_HTML).not.toMatch(/SpeechRecognition|webkitSpeechRecognition|whisper|vosk/i)
  })

  it('has script that parses', () => {
    const script = AVATAR_HTML.match(/<script>([\s\S]*)<\/script>/)![1]
    expect(() => new Function(script)).not.toThrow()
  })
})
