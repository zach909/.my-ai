import { describe, it, expect, beforeEach } from 'vitest';
import { ScreenshotsPlugin } from '../../plugins/screenshots';

describe('ScreenshotsPlugin security restrictions', () => {
  let plugin: ScreenshotsPlugin;

  beforeEach(() => {
    plugin = new ScreenshotsPlugin({
      id: 'screenshots',
      name: 'Screenshots',
      type: 'api-connection',
      capabilities: ['screenshots'],
    } as any);
  });

  describe('capture', () => {
    it('blocks filenames starting with a hyphen to prevent argument injection', async () => {
      await expect(plugin.capture('--output=/etc/shadow')).rejects.toThrow(
        /Security Error: Potential argument injection detected in filename/
      );
      await expect(plugin.capture('-v')).rejects.toThrow(
        /Security Error: Potential argument injection detected in filename/
      );
    });

    it('rejects non-string filename inputs', async () => {
      await expect(plugin.capture(123 as any)).rejects.toThrow(
        /Security Error: filename must be a string/
      );
      await expect(plugin.capture({} as any)).rejects.toThrow(
        /Security Error: filename must be a string/
      );
    });
  });

  describe('captureArea', () => {
    it('rejects invalid x and y coordinates', async () => {
      await expect(plugin.captureArea(-1, 0, 100, 100)).rejects.toThrow(
        /Security Error: x and y coordinates must be non-negative finite numbers/
      );
      await expect(plugin.captureArea(0, -5, 100, 100)).rejects.toThrow(
        /Security Error: x and y coordinates must be non-negative finite numbers/
      );
      await expect(plugin.captureArea(NaN, 0, 100, 100)).rejects.toThrow(
        /Security Error: x and y coordinates must be non-negative finite numbers/
      );
      await expect(plugin.captureArea(0, Infinity, 100, 100)).rejects.toThrow(
        /Security Error: x and y coordinates must be non-negative finite numbers/
      );
      await expect(plugin.captureArea('0' as any, 0, 100, 100)).rejects.toThrow(
        /Security Error: x and y coordinates must be non-negative finite numbers/
      );
    });

    it('rejects invalid width and height bounds', async () => {
      await expect(plugin.captureArea(0, 0, 0, 100)).rejects.toThrow(
        /Security Error: w and h must be positive integers up to 10000/
      );
      await expect(plugin.captureArea(0, 0, 100, -10)).rejects.toThrow(
        /Security Error: w and h must be positive integers up to 10000/
      );
      await expect(plugin.captureArea(0, 0, 10.5, 100)).rejects.toThrow(
        /Security Error: w and h must be positive integers up to 10000/
      );
      await expect(plugin.captureArea(0, 0, 100, 20000)).rejects.toThrow(
        /Security Error: w and h must be positive integers up to 10000/
      );
      await expect(plugin.captureArea(0, 0, NaN, 100)).rejects.toThrow(
        /Security Error: w and h must be positive integers up to 10000/
      );
    });
  });
});
