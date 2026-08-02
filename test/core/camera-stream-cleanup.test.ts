/**
 * Regression test for plugins/camera.ts's stopStream() leaking the temp
 * directory startStream() created: unlinkSync() only removes files, so
 * calling it on a directory always throws EISDIR -- silently swallowed by
 * the empty catch block, leaving the directory behind on every single
 * start/stop stream cycle.
 */

import { existsSync } from 'node:fs';
import { CameraPlugin } from '../../plugins/camera';

describe('CameraPlugin.stopStream() cleans up its temp directory', () => {
  it('actually removes the directory startStream() created', async () => {
    const plugin = new CameraPlugin({ id: 'camera', name: 'Camera', type: 'api-connection', capabilities: [] } as any);
    await plugin.startStream();
    const dir = (plugin as unknown as { streamDir: string | null }).streamDir;
    expect(dir).not.toBeNull();
    expect(existsSync(dir as string)).toBe(true);

    await plugin.stopStream();

    expect(existsSync(dir as string)).toBe(false);
  });
});
