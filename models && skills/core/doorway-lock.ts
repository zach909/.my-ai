/**
 * Only one caller may drive a given engine's settle() loop at a time.
 *
 * A `BitDoorway` (zip-halt.ts) mutates shared neuron state one settle() per
 * bit. PromptMeshFeed (zip-io.ts) already serializes ITS OWN feeds against
 * each other -- one in flight, newest wins. That protects a feed from a
 * second feed, and nothing else: a second, DIFFERENT kind of caller driving
 * the same engine (continuous-learning.ts's predict/learn calls are the real
 * one) could still run concurrently with a feed, interleaving their
 * settle() calls and corrupting both. This is the shared exclusion those two
 * callers hold in common, so neither has to know the other exists to stay
 * safe from it.
 */
export class DoorwayLock {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Runs `op` once every earlier holder has released, and holds the lock
   * until `op` settles (resolves or rejects) so the next holder never starts
   * mid-operation. A throwing `op` still releases the lock for whoever is
   * next -- one caller's failure must not wedge every other caller forever.
   */
  async run<T>(op: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await op();
    } finally {
      release();
    }
  }
}
