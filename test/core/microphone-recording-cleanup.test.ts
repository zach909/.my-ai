/**
 * Regression test for plugins/microphone.ts's stopRecording() leaking the
 * temp directory startRecording() created: recordPath sits inside a
 * dedicated mkdtempSync() directory that's never stored anywhere else, so
 * deleting only the .wav file left that (now-empty) parent directory behind
 * forever on every single recording session.
 */

import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { MicrophonePlugin } from '../../plugins/microphone';

describe('MicrophonePlugin.stopRecording() cleans up its temp directory', () => {
  it('actually removes the directory startRecording() created', async () => {
    const plugin = new MicrophonePlugin({ id: 'microphone', name: 'Microphone', type: 'api-connection', capabilities: [] } as any);
    await plugin.startRecording();
    const recordPath = (plugin as unknown as { recordPath: string | null }).recordPath;
    expect(recordPath).not.toBeNull();
    const tmpDir = dirname(recordPath as string);
    expect(existsSync(tmpDir)).toBe(true);

    await plugin.stopRecording();

    expect(existsSync(tmpDir)).toBe(false);
  });
});
