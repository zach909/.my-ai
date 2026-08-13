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
