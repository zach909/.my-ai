import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';

describe('ImageExtension and VideoExtension security validations', () => {
  let executedCommands: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    executedCommands = [];
    vi.doMock('node:child_process', () => ({
      execSync: (command: string) => {
        executedCommands.push(command);
        return '';
      },
    }));
    vi.doMock('node:fs', () => ({
      ...vi.importActual('node:fs') as any,
      existsSync: (path: string) => {
        // Mock to make the generate methods think file was produced successfully
        if (path.includes('neuroclaw_img_') || path.includes('neuroclaw_vid_')) {
          return true;
        }
        return false;
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:fs');
  });

  describe('ImageExtension Security', () => {
    it('sanitizes prompt string for generate command to prevent command injection', async () => {
      const { ImageExtension } = await import('../../plugins/extensions/index');
      const ext = new ImageExtension({ id: 'img', name: 'Image', type: 'api-connection', capabilities: [] } as any);

      await ext.onMessage('generate sunset; rm -rf /');

      expect(executedCommands.length).toBeGreaterThan(0);
      // Ensure the command separators have been stripped completely
      for (const cmd of executedCommands) {
        expect(cmd).not.toContain(';');
        expect(cmd).not.toContain('&');
        expect(cmd).not.toContain('|');
      }
    });

    it('rejects unsafe paths for resize', async () => {
      const { ImageExtension } = await import('../../plugins/extensions/index');
      const ext = new ImageExtension({ id: 'img', name: 'Image', type: 'api-connection', capabilities: [] } as any);

      const res = await ext.onMessage('resize /tmp/img.png;rm 256 256') as { error: string };

      expect(res.error).toContain('Unsafe path pattern detected');
      expect(executedCommands.length).toBe(0);
    });

    it('rejects unsafe formats for convert', async () => {
      const { ImageExtension } = await import('../../plugins/extensions/index');
      const ext = new ImageExtension({ id: 'img', name: 'Image', type: 'api-connection', capabilities: [] } as any);

      const res = await ext.onMessage('convert /tmp/img.png png;curl') as { error: string };

      expect(res.error).toContain('Unsafe format pattern detected');
      expect(executedCommands.length).toBe(0);
    });

    it('rejects unsafe paths for info', async () => {
      const { ImageExtension } = await import('../../plugins/extensions/index');
      const ext = new ImageExtension({ id: 'img', name: 'Image', type: 'api-connection', capabilities: [] } as any);

      const res = await ext.onMessage('info /tmp/img.png&whoami') as { error: string };

      expect(res.error).toContain('Unsafe path pattern detected');
      expect(executedCommands.length).toBe(0);
    });
  });

  describe('VideoExtension Security', () => {
    it('sanitizes description for generate video command', async () => {
      const { VideoExtension } = await import('../../plugins/extensions/index');
      const ext = new VideoExtension({ id: 'vid', name: 'Video', type: 'api-connection', capabilities: [] } as any);

      await ext.onMessage('generate custom_clip; touch /tmp/pwned');

      expect(executedCommands.length).toBeGreaterThan(0);
      for (const cmd of executedCommands) {
        expect(cmd).not.toContain(';');
        expect(cmd).not.toContain('&');
        expect(cmd).not.toContain('|');
      }
    });

    it('rejects unsafe paths and times for trim', async () => {
      const { VideoExtension } = await import('../../plugins/extensions/index');
      const ext = new VideoExtension({ id: 'vid', name: 'Video', type: 'api-connection', capabilities: [] } as any);

      const res1 = await ext.onMessage('trim /tmp/vid.mp4;rm 0 5') as { error: string };
      expect(res1.error).toContain('Unsafe path pattern detected');

      const res2 = await ext.onMessage('trim /tmp/vid.mp4 0;whoami 5') as { error: string };
      expect(res2.error).toContain('invalid timestamp/duration');

      expect(executedCommands.length).toBe(0);
    });

    it('rejects unsafe paths for concat', async () => {
      const { VideoExtension } = await import('../../plugins/extensions/index');
      const ext = new VideoExtension({ id: 'vid', name: 'Video', type: 'api-connection', capabilities: [] } as any);

      const res = await ext.onMessage('concat /tmp/v1.mp4 /tmp/v2.mp4;rm') as { error: string };
      expect(res.error).toContain('Unsafe path pattern detected');
      expect(executedCommands.length).toBe(0);
    });

    it('rejects unsafe paths for extract-audio', async () => {
      const { VideoExtension } = await import('../../plugins/extensions/index');
      const ext = new VideoExtension({ id: 'vid', name: 'Video', type: 'api-connection', capabilities: [] } as any);

      const res = await ext.onMessage('extract-audio /tmp/vid.mp4&ls') as { error: string };
      expect(res.error).toContain('Unsafe path pattern detected');
      expect(executedCommands.length).toBe(0);
    });
  });
});
