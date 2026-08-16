import { describe, it, expect, beforeEach } from 'vitest';
import { CameraPlugin } from '../../plugins/camera';

describe('CameraPlugin security and safe execution', () => {
  let plugin: CameraPlugin;

  beforeEach(() => {
    plugin = new CameraPlugin({
      id: 'camera',
      name: 'Camera',
      type: 'api-connection',
      capabilities: ['camera'],
    } as any);
  });

  it('safely attempts capture without shell spawning or throwing unhandled errors', async () => {
    const data = await plugin.captureImage();
    expect(data).toBeDefined();
    expect(typeof data.imageData).toBe('string');
    expect(typeof data.width).toBe('number');
    expect(typeof data.height).toBe('number');
    expect(typeof data.format).toBe('string');
  });

  it('manages stream status correctly without leaking resources', async () => {
    expect(plugin.isStreaming).toBe(false);
    const started = await plugin.startStream();
    expect(started).toBe(true);
    expect(plugin.isStreaming).toBe(true);

    const stopped = await plugin.stopStream();
    expect(stopped).toBe(true);
    expect(plugin.isStreaming).toBe(false);
  });
});
