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
    // Asserted on `sparse`, which is what items actually carry. The dense
    // `embedding` field is only present on memories loaded from an older save,
    // so comparing it here would compare undefined to undefined and pass
    // without testing anything.
    expect(a.sparse).toBeDefined();
    expect(a.sparse).toEqual(b.sparse);
  });

  it('a memory saved before the sparse change still loads and is still findable', () => {
    const mem = new LongTermMemory();
    mem.remember('the quick brown fox jumps');
    // Rebuild the old on-disk shape: a dense array, no sparse field.
    const dense = new Array(512).fill(0);
    for (const [k, idx] of (mem.all()[0].sparse!.indices).entries()) {
      dense[idx] = mem.all()[0].sparse!.values[k];
    }
    const legacy = JSON.stringify({
      dim: 512,
      capacity: 2000,
      items: [{ ...mem.all()[0], sparse: undefined, embedding: dense }],
    });
    expect(LongTermMemory.deserialize(legacy).retrieve('quick brown fox').length).toBeGreaterThan(0);
  });

  it('a memory carrying neither vector is re-embedded from its content rather than crashing', () => {
    // The old code read item.embedding.length unconditionally, so an item
    // missing it took down the whole search.
    const broken = JSON.stringify({
      dim: 512,
      capacity: 2000,
      items: [{
        id: 'x', content: 'neural network memory', timestamp: Date.now(),
        importance: 0.5, tags: [], accessCount: 0, lastAccess: Date.now(),
      }],
    });
    expect(LongTermMemory.deserialize(broken).retrieve('neural network').length).toBe(1);
  });
});

describe('capacity bounds what it learned, not what was installed', () => {
  it('still accepts new memories when pinned knowledge alone exceeds capacity', () => {
    // The bug: evictIfNeeded compared items.size -- INCLUDING pinned -- against
    // capacity. On a real install that was 3347 pinned memories against a
    // capacity of 2000, so it evicted every unpinned memory on every insert.
    // The agent could not form a single new memory, and nothing reported it.
    const mem = new LongTermMemory({ capacity: 10 });
    for (let i = 0; i < 25; i++) mem.remember(`installed knowledge ${i}`, { pinned: true });

    const kept = []
    for (let i = 0; i < 5; i++) kept.push(mem.remember(`something newly learned ${i}`, { importance: 0.9 }).id)
    expect(kept.filter(id => mem.get(id))).toHaveLength(5)
  })

  it('never evicts installed knowledge to make room', () => {
    const mem = new LongTermMemory({ capacity: 5 })
    const pinnedIds = []
    for (let i = 0; i < 20; i++) pinnedIds.push(mem.remember(`installed ${i}`, { pinned: true }).id)
    for (let i = 0; i < 50; i++) mem.remember(`observation ${i}`, { importance: 0.1 })
    expect(pinnedIds.every(id => mem.get(id))).toBe(true)
  })

  it('still bounds what it picked up on its own', () => {
    // The cap has to remain real, or this fix would just be a memory leak.
    const mem = new LongTermMemory({ capacity: 10 })
    for (let i = 0; i < 30; i++) mem.remember(`installed ${i}`, { pinned: true })
    for (let i = 0; i < 200; i++) mem.remember(`observation ${i}`, { importance: 0.5 })
    expect(mem.all().filter(m => !m.pinned).length).toBeLessThanOrEqual(10)
  })

  it('keeps the more important observation when it has to choose', () => {
    const mem = new LongTermMemory({ capacity: 2 })
    const important = mem.remember('worth keeping', { importance: 0.95 }).id
    mem.remember('filler a', { importance: 0.01 })
    mem.remember('filler b', { importance: 0.01 })
    mem.remember('filler c', { importance: 0.01 })
    expect(mem.get(important)).toBeDefined()
  })
})
