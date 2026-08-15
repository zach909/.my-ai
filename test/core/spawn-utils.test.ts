/**
 * Tests for scripts/spawn-utils.mjs's spawnAwait() -- the piece that lets
 * scripts/dev.mjs and scripts/server.mjs run the update check and the
 * backend build CONCURRENTLY instead of one after the other (see both
 * scripts' own doc comments for why: the two have zero dependency on
 * each other, so serializing them was pure dead time on every startup).
 * Real child processes, not mocked, same precedent as this session's
 * other driver-script tests.
 */

import { spawnAwait } from '../../scripts/spawn-utils.mjs';

describe('spawnAwait()', () => {
  it('resolves with 0 for a real process that exits cleanly', async () => {
    const code = await spawnAwait('node', ['-e', 'process.exit(0)']);
    expect(code).toBe(0);
  });

  it('resolves with the real non-zero exit code, does not reject', async () => {
    const code = await spawnAwait('node', ['-e', 'process.exit(7)']);
    expect(code).toBe(7);
  });

  it('rejects if the command itself cannot be spawned', async () => {
    await expect(spawnAwait('this-binary-does-not-exist-anywhere', [])).rejects.toThrow();
  });

  it('two real processes actually run concurrently, not one after the other', async () => {
    // Each sleeps ~300ms via a busy real setTimeout, then exits. If
    // spawnAwait secretly serialized them, Promise.all would take
    // ~600ms; run concurrently, it should take closer to ~300ms.
    const start = Date.now();
    await Promise.all([
      spawnAwait('node', ['-e', 'setTimeout(() => process.exit(0), 300)']),
      spawnAwait('node', ['-e', 'setTimeout(() => process.exit(0), 300)']),
    ]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(550); // well under the ~600ms a serialized run would take
  });

  it('passes through cwd/env options to the real child process', async () => {
    const code = await spawnAwait('node', ['-e', 'process.exit(process.env.SPAWN_UTILS_TEST_VAR === "yes" ? 0 : 1)'], {
      env: { ...process.env, SPAWN_UTILS_TEST_VAR: 'yes' },
    });
    expect(code).toBe(0);
  });
});
