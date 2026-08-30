/**
 * Editing what the AI said.
 *
 * The chat UI could copy a reply but not fix one, so a wrong answer stayed
 * wrong: in the transcript, in long-term memory, and in whatever the next
 * turn was grounded on. A correction is the most valuable signal this system
 * gets and it was being discarded.
 *
 * These test the part that matters -- that the wrong answer is actually GONE
 * from memory afterwards, not merely sitting next to the right one where
 * retrieval can still surface it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LongTermMemory } from '../../models && skills/core/long-term-memory';
import { MistakeTracker } from '../../models && skills/core/mistake-tracker';

/**
 * The correction, against the same two stores the agent uses. Mirrors
 * NeuroclawSystem.recordCorrection so the behaviour can be pinned without
 * standing up the whole system, which pulls in every plugin.
 */
function correct(
  memory: LongTermMemory,
  mistakes: MistakeTracker,
  input: { original: string; corrected: string; prompt?: string },
): { applied: boolean; forgot: number; reason?: string } {
  const original = (input.original ?? '').trim();
  const corrected = (input.corrected ?? '').trim();
  if (!corrected) return { applied: false, forgot: 0, reason: 'the correction is empty' };
  if (original === corrected) return { applied: false, forgot: 0, reason: 'nothing changed' };
  let forgot = 0;
  // Exact equality, NOT memory.findExact(), which is a SUBSTRING match
  // despite the name -- see the implementation.
  const stored = `AI: ${original}`;
  for (const item of memory.all()) {
    if (item.content === stored && memory.forget(item.id)) forgot++;
  }
  memory.remember(`AI: ${corrected}`, { tags: ['chat-turn', 'assistant', 'corrected'], importance: 0.9 });
  mistakes.record({
    task: input.prompt?.trim() || original.slice(0, 200),
    description: `The answer was corrected by hand. Said: ${original.slice(0, 300)}`,
    cause: 'reasoning',
    prevention: corrected.slice(0, 500),
  });
  return { applied: true, forgot };
}

describe('a corrected answer replaces the wrong one', () => {
  let memory: LongTermMemory;
  let mistakes: MistakeTracker;

  beforeEach(() => {
    memory = new LongTermMemory();
    mistakes = new MistakeTracker();
  });

  it('forgets the wrong answer instead of storing both', () => {
    memory.remember('AI: Paris is the capital of Italy', { tags: ['chat-turn', 'assistant'] });
    const before = memory.size();

    const res = correct(memory, mistakes, {
      original: 'Paris is the capital of Italy',
      corrected: 'Rome is the capital of Italy',
      prompt: 'what is the capital of Italy',
    });

    expect(res.applied).toBe(true);
    expect(res.forgot).toBe(1);
    // One out, one in.
    expect(memory.size()).toBe(before);
    // The decisive check: the wrong sentence is not retrievable any more.
    // Leaving it beside the correction is the failure mode -- retrieval could
    // still surface it, and then the fix did nothing.
    const all = memory.all().map(m => m.content).join('\n');
    expect(all).toContain('Rome is the capital of Italy');
    expect(all).not.toContain('Paris is the capital of Italy');
  });

  it('records the correction as a reasoning mistake, with the fix as the prevention', () => {
    correct(memory, mistakes, {
      original: 'Two plus two is five',
      corrected: 'Two plus two is four',
      prompt: 'what is 2+2',
    });
    const all = mistakes.all();
    expect(all.length).toBe(1);
    expect(all[0].cause).toBe('reasoning');
    expect(all[0].task).toBe('what is 2+2');
    expect(all[0].prevention).toBe('Two plus two is four');
    // The wrong answer is kept in the description: what it said is the
    // evidence, and a mistake record without it cannot be acted on.
    expect(all[0].description).toContain('Two plus two is five');
  });

  it('falls back to the answer when there is no prompt to blame', () => {
    correct(memory, mistakes, { original: 'wrong thing', corrected: 'right thing' });
    expect(mistakes.all()[0].task).toBe('wrong thing');
  });

  it('does nothing when the text did not change', () => {
    memory.remember('AI: unchanged', { tags: ['chat-turn', 'assistant'] });
    const res = correct(memory, mistakes, { original: 'unchanged', corrected: 'unchanged' });
    expect(res.applied).toBe(false);
    expect(res.reason).toBe('nothing changed');
    expect(mistakes.all().length).toBe(0);
    expect(memory.size()).toBe(1);
  });

  it('refuses an empty correction rather than erasing the answer', () => {
    memory.remember('AI: something real', { tags: ['chat-turn', 'assistant'] });
    const res = correct(memory, mistakes, { original: 'something real', corrected: '   ' });
    expect(res.applied).toBe(false);
    // The original survives. Blanking the box must not delete what was said.
    expect(memory.all().map(m => m.content).join()).toContain('something real');
  });

  it('forgets only the exact answer, not a turn that merely resembles it', () => {
    memory.remember('AI: the cat sat on the mat', { tags: ['chat-turn', 'assistant'] });
    memory.remember('AI: the cat sat on the mat yesterday', { tags: ['chat-turn', 'assistant'] });
    const res = correct(memory, mistakes, {
      original: 'the cat sat on the mat',
      corrected: 'the cat sat on the rug',
    });
    expect(res.forgot).toBe(1);
    const all = memory.all().map(m => m.content).join('\n');
    // A fuzzy match here would have taken the neighbouring turn with it.
    expect(all).toContain('the cat sat on the mat yesterday');
    expect(all).toContain('the cat sat on the rug');
  });
});
