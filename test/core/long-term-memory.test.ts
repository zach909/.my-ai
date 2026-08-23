/**
 * Tests for models && skills/core/long-term-memory.ts's `payload` field --
 * added so a trained skill's (trigger, response) script pair can be
 * remembered with the trigger text alone as `content` (what actually gets
 * embedded and matched) while the literal response rides along separately
 * as `payload`, retrievable without re-parsing a flattened sentence. See
 * interface/web-server.ts's rememberSkillScript() and
 * src/server/bot-service.ts's matchSkillMesh() for the real consumers.
 */

import { LongTermMemory } from '../../models && skills/core/long-term-memory.js';

describe('LongTermMemory payload', () => {
  it('remember() stores an explicit payload distinct from content', () => {
    const mem = new LongTermMemory();
    const item = mem.remember('trigger text', { payload: 'the real response' });
    expect(item.content).toBe('trigger text');
    expect(item.payload).toBe('the real response');
  });

  it('retrieve() returns the stored payload on the matched item', () => {
    const mem = new LongTermMemory();
    mem.remember('What is the capital of France', { tags: ['skill-script'], payload: 'Paris.' });
    const hits = mem.retrieve('What is the capital of France?', { topK: 1, tag: 'skill-script' });
    expect(hits[0]?.item.payload).toBe('Paris.');
  });

  it('a pinned memory survives capacity eviction that would otherwise drop it first', () => {
    // Reproduces the real failure: loadSavedExtensions() writes every boot
    // skill with the same importance, at the same instant, with accessCount
    // 0, so retention ties and the stable sort evicts whichever the
    // directory listing happened to yield first. This container had 2142
    // boot memories against a capacity of 2000, and the alphabetically
    // earliest installed skills simply disappeared.
    const mem = new LongTermMemory({ capacity: 50 });
    mem.remember('What does the boot-load probe token ABC123 decode to?', {
      importance: 0.7,
      tags: ['skill-script', 'probe'],
      payload: 'ABC123',
      pinned: true,
    });
    for (let i = 0; i < 100; i++) {
      mem.remember(`later conversation memory number ${i}`, { importance: 0.7, tags: ['skill-script'] });
    }
    const hits = mem.retrieve('What does the boot-load probe token ABC123 decode to?', {
      topK: 1,
      tag: 'skill-script',
    });
    expect(hits[0]?.item.payload).toBe('ABC123');
  });

  it('an unpinned memory with identical importance is still evicted, so capacity is real', () => {
    const mem = new LongTermMemory({ capacity: 50 });
    mem.remember('What does the boot-load probe token ABC123 decode to?', {
      importance: 0.7,
      tags: ['skill-script', 'probe'],
      payload: 'ABC123',
    });
    for (let i = 0; i < 100; i++) {
      mem.remember(`later conversation memory number ${i}`, { importance: 0.7, tags: ['skill-script'] });
    }
    expect(mem.size()).toBe(50);
    expect(mem.all().some(i => i.payload === 'ABC123')).toBe(false);
  });

  it('pinned items beyond capacity are kept rather than deleted -- capacity bounds what was observed, not what was installed', () => {
    const mem = new LongTermMemory({ capacity: 10 });
    for (let i = 0; i < 25; i++) {
      mem.remember(`installed skill trigger ${i}`, { tags: ['skill-script'], payload: `r${i}`, pinned: true });
    }
    expect(mem.size()).toBe(25);
    for (let i = 0; i < 40; i++) mem.remember(`incidental observation ${i}`);
    // Every pinned item is still there; only the unpinned ones were trimmed.
    expect(mem.all().filter(i => i.pinned).length).toBe(25);
    expect(mem.all().filter(i => !i.pinned).length).toBeLessThanOrEqual(40);
  });

  it('an item remembered without a payload leaves it undefined, not an empty string', () => {
    const mem = new LongTermMemory();
    const item = mem.remember('an ordinary chat turn');
    expect(item.payload).toBeUndefined();
  });

  it('embedding is computed from content, never from payload -- two items with the same content but different payloads embed identically', () => {
    const mem = new LongTermMemory();
    const a = mem.remember('same trigger', { payload: 'answer A', id: 'a' });
    const b = mem.remember('same trigger', { payload: 'a completely different answer B', id: 'b' });
    expect(a.embedding).toEqual(b.embedding);
  });
});
