/**
 * Teaching the Zip Loop to answer.
 *
 * Before this the repo could not make the loop speak a chosen answer: the
 * output side was only ever read. These pin what ZipSpeaker does and where it
 * stops: it speaks the answers it was taught, exactly, from the mesh's memory of
 * the question; it needs the memory to do it; it reads the mesh without changing
 * it; it holds about 16 questions; and it only knows the tail of a question.
 */

import { describe, it, expect } from 'vitest'
import { HyperDimensionalEngine } from '../../models && skills/core/onebrain.js'
import { ZipSpeaker } from '../../models && skills/core/zip-speech.js'

const sparse = () => new HyperDimensionalEngine({ neuronCount: 24, dimensions: 8 })
const live = () => new HyperDimensionalEngine({
  dimensions: 64, ballStates: 8, neuronCount: 64, learningRate: 0.05,
  hyperGain: 1, hyperAdd: 1, hyperWaveGain: 1, hyperWaveAdd: 1, waveGain: 0.1, connectionBias: true, propagationSteps: 32,
} as never)

const FACTS: Array<[string, string]> = [
  ['what is the capital of france?', 'Paris'],
  ['what is the capital of spain?', 'Madrid'],
  ['what is the capital of italy?', 'Rome'],
  ['who wrote the book on whales?', 'Melville'],
  ['how many legs does a spider have?', 'eight'],
  ['say hello', 'hi there'],
  ['what colour is the sky?', 'blue'],
  ['2+2=', '4'],
]
const asPairs = (n: number) => FACTS.slice(0, n).map(([question, answer]) => ({ question, answer }))

describe('a taught loop speaks the answer back', () => {
  it('speaks every taught answer exactly', () => {
    const sp = new ZipSpeaker(sparse(), { maxAnswerBytes: 8 })
    const report = sp.teach(asPairs(8))
    expect(report.bitAccuracy).toBe(1)
    for (const [q, a] of FACTS) expect(sp.speakText(q)).toBe(a)
  })

  it('does the same on the live-sized mesh (64 neurons, full equation, wave layer on)', () => {
    const sp = new ZipSpeaker(live(), { maxAnswerBytes: 8 })
    sp.teach(asPairs(4))
    for (const [q, a] of FACTS.slice(0, 4)) expect(sp.speakText(q)).toBe(a)
  }, 60_000)

  it('tells apart questions that end the same way and differ by one word', () => {
    const sp = new ZipSpeaker(sparse(), { maxAnswerBytes: 8 })
    sp.teach(asPairs(3))
    expect([sp.speakText(FACTS[0][0]), sp.speakText(FACTS[1][0]), sp.speakText(FACTS[2][0])]).toEqual(['Paris', 'Madrid', 'Rome'])
  })

  it('needs the memory: with it off, the loop cannot tell those questions apart', () => {
    const sp = new ZipSpeaker(sparse(), { maxAnswerBytes: 8, memoryVale: 0 })
    sp.teach(asPairs(4))
    const right = FACTS.slice(0, 4).filter(([q, a]) => sp.speakText(q) === a).length
    expect(right).toBeLessThanOrEqual(2)       // it was 1 of 4 when measured
  })

  it('works across the useful range of memory settings', () => {
    for (const memoryVale of [0.9, 0.97, 0.99]) {
      const sp = new ZipSpeaker(sparse(), { maxAnswerBytes: 8, memoryVale })
      sp.teach(asPairs(4))
      for (const [q, a] of FACTS.slice(0, 4)) expect(sp.speakText(q)).toBe(a)
    }
  })
})

describe('it reads the mesh without changing it', () => {
  it('leaves the activity and everything learned exactly as it found them', () => {
    const e = sparse()
    e.process(new Array(8).fill(0.7), undefined, new Set([0]), undefined, { learn: true })
    const before = e.captureNetworkState()
    const sp = new ZipSpeaker(e, { maxAnswerBytes: 8 })
    sp.teach(asPairs(4))
    sp.speakText(FACTS[0][0])
    sp.recall('something else')
    const after = e.captureNetworkState()
    expect(after.states).toBe(before.states)
    expect(after.connDiag).toBe(before.connDiag)
    expect(after.bias).toBe(before.bias)
  })

  it('gives the same answer however often it is asked', () => {
    const sp = new ZipSpeaker(sparse(), { maxAnswerBytes: 8 })
    sp.teach(asPairs(4))
    const first = sp.speakText(FACTS[2][0])
    expect(sp.speakText(FACTS[2][0])).toBe(first)
    sp.speakText(FACTS[0][0])
    expect(sp.speakText(FACTS[2][0])).toBe(first)
  })
})

describe('where it stops', () => {
  const unit = (i: number) => {
    const words = ['river', 'stone', 'cloud', 'maple', 'amber', 'delta', 'ember', 'frost', 'glade', 'harbor', 'island', 'jungle', 'kettle', 'lantern', 'meadow', 'nectar']
    return { question: `item ${i}: tell me about the ${words[i % 16]} ${words[(i * 5 + 3) % 16]} ${words[(i * 7 + 1) % 16]}`, answer: `${words[(i * 3) % 16]}-${100 + i * 7}` }
  }

  it('holds about sixteen questions', () => {
    const sp = new ZipSpeaker(sparse(), { maxAnswerBytes: 12 })
    const pairs = Array.from({ length: 16 }, (_, i) => unit(i))
    sp.teach(pairs)
    expect(pairs.filter(p => sp.speakText(p.question) === p.answer).length).toBe(16)
  })

  it('loses most of them when taught many more (measured: 6 of 64)', () => {
    const sp = new ZipSpeaker(sparse(), { maxAnswerBytes: 12 })
    const pairs = Array.from({ length: 64 }, (_, i) => unit(i))
    sp.teach(pairs)
    expect(pairs.filter(p => sp.speakText(p.question) === p.answer).length).toBeLessThan(32)
  })

  it('remembers the tail of a question: a change in the early bytes makes no difference', () => {
    const sp = new ZipSpeaker(sparse(), { maxAnswerBytes: 8 })
    const tail = ' and then tell me what the capital of the country is?'
    sp.teach([{ question: `A${tail}`, answer: 'Paris' }, { question: `a different start, and the same finish${tail}.`, answer: 'Rome' }])
    expect(sp.strangeness(`Z${tail}`)).toBeLessThan(0.5)     // looks just like the first
  })

  it('refuses nonsense it can notice: recall() is silent where speak() would guess', () => {
    const sp = new ZipSpeaker(sparse(), { maxAnswerBytes: 8 })
    sp.teach(asPairs(8))
    for (const [q, a] of FACTS) expect(sp.recallText(q)).toBe(a)
    for (const strange of ['what is the weather', 'tell me a joke', 'zzzzzzzz', 'how are you', 'what is the capital of france? ']) {
      expect(sp.recall(strange)).toBeNull()
    }
  })

  it('knows an unseen question is unfamiliar: far larger strangeness than a taught one', () => {
    const sp = new ZipSpeaker(sparse(), { maxAnswerBytes: 8 })
    sp.teach(asPairs(8))
    expect(sp.strangeness(FACTS[0][0])).toBeLessThan(0.01)
    expect(sp.strangeness('what is the weather')).toBeGreaterThan(1)
  })
})

describe('misuse', () => {
  it('refuses to speak before it has been taught', () => {
    expect(() => new ZipSpeaker(sparse()).speak('hi')).toThrow(/nothing has been taught/)
  })
  it('refuses an empty lesson and an answer that does not fit', () => {
    expect(() => new ZipSpeaker(sparse()).teach([])).toThrow(/nothing to teach/)
    expect(() => new ZipSpeaker(sparse(), { maxAnswerBytes: 2 }).teach([{ question: 'q', answer: 'toolong' }])).toThrow(/longer than/)
  })
  it('speaks a non-text answer as raw bytes', () => {
    const sp = new ZipSpeaker(sparse(), { maxAnswerBytes: 4 })
    sp.teach([{ question: 'give me bytes', answer: new Uint8Array([0, 255, 128, 7]) }, { question: 'give me none', answer: new Uint8Array(0) }])
    expect(Array.from(sp.speak('give me bytes'))).toEqual([0, 255, 128, 7])
    expect(sp.speak('give me none').length).toBe(0)
  })
})

describe('options added for the generalisation experiments (defaults unchanged)', () => {
  const engine = () => new HyperDimensionalEngine({ neuronCount: 24, dimensions: 8, seed: 7 })
  const pairs = asPairs(6)

  it('standardize and mean pooling still speak every taught answer exactly', () => {
    for (const opts of [{ standardize: true }, { pooling: 'mean' as const }, { pooling: 'mean' as const, standardize: true }]) {
      const sp = new ZipSpeaker(engine(), { maxAnswerBytes: 8, ...opts })
      sp.teach(pairs)
      for (const [q, a] of FACTS.slice(0, 6)) expect(sp.speakText(q)).toBe(a)
    }
  })

  it('the default is exactly what it was: same answers with the options absent or false', () => {
    const a = new ZipSpeaker(engine(), { maxAnswerBytes: 8 }); a.teach(pairs)
    const b = new ZipSpeaker(engine(), { maxAnswerBytes: 8, pooling: 'last', standardize: false }); b.teach(pairs)
    for (const [q] of FACTS) expect(a.strangeness(q)).toBe(b.strangeness(q))
  })

  it('a question read once is not read again, and forget() clears that', () => {
    const e = engine()
    const sp = new ZipSpeaker(e, { maxAnswerBytes: 8 }); sp.teach(pairs)
    let ticks = 0
    const real = e.process.bind(e)
    ;(e as unknown as { process: unknown }).process = (...a: unknown[]) => { ticks++; return (real as (...x: unknown[]) => unknown)(...a) }
    sp.speakText(FACTS[0][0])
    expect(ticks).toBe(0)                          // taught question: cached from teach()
    sp.speakText('a question never seen before')
    const first = ticks
    expect(first).toBeGreaterThan(0)
    sp.speakText('a question never seen before')
    expect(ticks).toBe(first)                      // second time costs nothing
    sp.forget()
    sp.speakText('a question never seen before')
    expect(ticks).toBeGreaterThan(first)
  })

  it('loss() is 1 before teaching, about 0 on a taught pair, and clipped so an odd question cannot make it huge', () => {
    const sp = new ZipSpeaker(engine(), { maxAnswerBytes: 8 })
    expect(sp.loss('hello', 'x')).toBe(1)
    sp.teach(pairs)
    expect(sp.loss(FACTS[0][0], FACTS[0][1])).toBeLessThan(0.01)
    expect(sp.loss('zzzz qqqq never seen', 'Paris')).toBeLessThanOrEqual(4)
  })
})
