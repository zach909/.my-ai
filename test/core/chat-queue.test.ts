/**
 * Typing while it is working.
 *
 * The chat input used to be disabled during a reply, so a thought you had
 * mid-answer was one you had to hold. It is always typeable now -- but a
 * second request must not go out on top of the first, or two answers race and
 * land in whichever order the network happens to finish them.
 *
 * The queue is the part worth pinning: order kept, one in flight at a time,
 * and nothing lost.
 */

import { describe, it, expect } from 'vitest';

/**
 * The same rule the chat page follows, in isolation: while something is in
 * flight, new messages queue; when it finishes, the next one goes.
 */
function makeSender(send: (text: string) => Promise<void>) {
  const queue: string[] = [];
  const failures: string[] = [];
  let busy = false;

  const run = async (text: string): Promise<void> => {
    busy = true;
    try {
      await send(text);
    } catch (err) {
      // Reported, not thrown. A reply that failed with three more queued
      // behind it used to escape as an unhandled rejection: nothing visible
      // changed and the only clue was in devtools.
      failures.push(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
      const next = queue.shift();
      if (next !== undefined) await run(next);
    }
  };

  return {
    submit(text: string) {
      if (busy) {
        queue.push(text);
        return;
      }
      void run(text);
    },
    waiting: () => [...queue],
    inFlight: () => busy,
    failures: () => [...failures],
  };
}

describe('typing while the agent is working', () => {
  it('never has two requests in flight at once', async () => {
    let concurrent = 0;
    let worst = 0;
    const release: Array<() => void> = [];
    const sender = makeSender(async () => {
      concurrent++;
      worst = Math.max(worst, concurrent);
      await new Promise<void>(resolve => release.push(() => { concurrent--; resolve(); }));
    });

    sender.submit('first');
    sender.submit('second');
    sender.submit('third');
    expect(sender.waiting()).toEqual(['second', 'third']);

    while (release.length > 0) {
      release.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(worst).toBe(1);
  });

  it('sends what was typed, in the order it was typed', async () => {
    const sent: string[] = [];
    const sender = makeSender(async (text) => {
      sent.push(text);
      await Promise.resolve();
    });

    sender.submit('one');
    sender.submit('two');
    sender.submit('three');
    // Drain: each completion pulls the next.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(sent).toEqual(['one', 'two', 'three']);
    expect(sender.waiting()).toEqual([]);
  });

  it('keeps the queue when a send fails rather than losing what came after', async () => {
    // A failed answer must not take the messages typed behind it down with it.
    const sent: string[] = [];
    const sender = makeSender(async (text) => {
      sent.push(text);
      if (text === 'boom') throw new Error('network');
    });

    sender.submit('boom');
    sender.submit('after');
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(sent).toEqual(['boom', 'after']);
    // Surfaced rather than escaping as an unhandled rejection.
    expect(sender.failures()).toEqual(['network']);
  });
});
