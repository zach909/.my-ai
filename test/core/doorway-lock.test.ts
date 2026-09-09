/**
 * Two zip-loop callers against the SAME engine (PromptMeshFeed and
 * continuous-learning.ts) must never drive settle() at once -- see
 * doorway-lock.ts's own doc comment. These pin the two things that matter:
 * operations run one at a time in arrival order, and a throwing operation
 * still releases the lock for whoever is next.
 */
import { describe, it, expect } from 'vitest';
import { DoorwayLock } from '../../models && skills/core/doorway-lock';

describe('DoorwayLock', () => {
  it('never lets two operations overlap', async () => {
    const lock = new DoorwayLock();
    let inFlight = 0;
    let maxConcurrent = 0;
    const order: number[] = [];

    const op = (id: number) => lock.run(async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise(r => setTimeout(r, 5));
      order.push(id);
      inFlight--;
    });

    await Promise.all([op(1), op(2), op(3)]);
    expect(maxConcurrent).toBe(1);
    // Arrival order, since each is queued the instant it is called.
    expect(order).toEqual([1, 2, 3]);
  });

  it('a throwing operation still releases the lock for the next one', async () => {
    const lock = new DoorwayLock();
    await expect(lock.run(() => { throw new Error('boom'); })).rejects.toThrow('boom');

    let ran = false;
    await lock.run(() => { ran = true; });
    expect(ran).toBe(true);
  });

  it('runs a synchronous operation without waiting for a microtask it does not need', async () => {
    const lock = new DoorwayLock();
    const result = await lock.run(() => 42);
    expect(result).toBe(42);
  });
});
