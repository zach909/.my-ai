/**
 * Regression test for MultiDesktopManager.launchOnDesktop() (interface/multi-desktop.ts):
 * it runs `command` through a real shell (spawn(..., { shell: true })), needed to
 * support pipes/redirects in an arbitrary command line -- the same reason
 * plugin_gnome.py's _launch_on_desktop keeps shell=True. Its Python twin
 * (same method name, same purpose) was already guarded against destructive
 * commands (plugin_gnome.py's _is_blocked check); this TypeScript version
 * had no such guard until now.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MultiDesktopManager } from '../../interface/multi-desktop';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('MultiDesktopManager.launchOnDesktop()', () => {
  it('blocks a destructive rm -rf / command', async () => {
    const mgr = new MultiDesktopManager();
    const marker = join(tmpdir(), `launch_on_desktop_blocked_${Date.now()}`);
    // A blocked command must never reach spawn() at all -- prove it by
    // chaining a harmless touch onto the same command line, which would
    // still run if the guard didn't actually stop the shell invocation.
    mgr.launchOnDesktop(`rm -rf / --force; touch ${marker}`, 'ai');
    await sleep(300);
    expect(existsSync(marker)).toBe(false);
  });

  it('still allows a benign command through', async () => {
    const mgr = new MultiDesktopManager();
    const marker = join(tmpdir(), `launch_on_desktop_allowed_${Date.now()}`);
    mgr.launchOnDesktop(`touch ${marker}`, 'ai');
    await sleep(300);
    expect(existsSync(marker)).toBe(true);
    unlinkSync(marker);
  });
});
