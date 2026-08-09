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
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        existsSync: (path: string) => {
          // Mock to make the generate methods think file was produced successfully
          if (path.includes('neuroclaw_img_') || path.includes('neuroclaw_vid_') || path.includes('.neuroclaw') || path.includes('.neuri')) {
            return true;
          }
          return actual.existsSync(path);
        },
        mkdirSync: (path: string, options?: any) => {
          // Avoid touching actual disk during tests
          return path;
        },
        writeFileSync: (path: string, data: string, options?: any) => {
          // Avoid writing to actual disk during tests
        },
      };
    });
    vi.doMock('node:fs', () => ({
      ...vi.importActual('node:fs') as any,
      existsSync: (path: string) => {
        // Mock to make the generate methods think file was produced successfully
        if (path.includes('neuroclaw_img_') || path.includes('neuroclaw_vid_')) {
          return true;
        }
        if (path.includes('.neuroclaw')) {
          return true;
        }
        return false;
      },
      mkdirSync: () => {},
      writeFileSync: () => {},
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

  describe('UniversalLanguageSkill Security', () => {
    it('rejects malicious language names with directory traversal', async () => {
      const { UniversalLanguageSkill } = await import('../../plugins/extensions/index');
      const ext = new UniversalLanguageSkill({ id: 'uls', name: 'UniversalLanguage', type: 'api-connection', capabilities: [] } as any);

      await expect(ext.onMessage('create ../../evil :: name="test"'))
        .rejects.toThrow('Security Error');

      await expect(ext.onMessage('create /tmp/evil :: name="test"'))
        .rejects.toThrow('Security Error');

      await expect(ext.onMessage('create c:\\windows\\system32 :: name="test"'))
        .rejects.toThrow('Security Error');
    });

    it('rejects unsafe special characters in language names', async () => {
      const { UniversalLanguageSkill } = await import('../../plugins/extensions/index');
      const ext = new UniversalLanguageSkill({ id: 'uls', name: 'UniversalLanguage', type: 'api-connection', capabilities: [] } as any);

      await expect(ext.onMessage('create rust;rm -rf / :: name="test"'))
        .rejects.toThrow('Security Error');

      await expect(ext.onMessage('create python&whoami :: name="test"'))
        .rejects.toThrow('Security Error');
    });

    it('allows safe language names', async () => {
      const { UniversalLanguageSkill } = await import('../../plugins/extensions/index');
      const ext = new UniversalLanguageSkill({ id: 'uls', name: 'UniversalLanguage', type: 'api-connection', capabilities: [] } as any);

      const res = await ext.onMessage('create C++ :: name="test"');
      expect(res).not.toBeNull();
      expect((res as any).created).toBe('C++');
    it('rejects malicious language names with path-traversal or invalid characters in create', async () => {
      const { UniversalLanguageSkill } = await import('../../plugins/extensions/index');
      const ext = new UniversalLanguageSkill({ id: 'lang', name: 'Language', type: 'api-connection', capabilities: [] } as any);

      await expect(ext.onMessage('create ../../etc/passwd :: console.log("pwned")')).rejects.toThrow('Security Error');
      await expect(ext.onMessage('create test;whoami :: console.log("pwned")')).rejects.toThrow('Security Error');
      await expect(ext.onMessage('create test<script> :: console.log("pwned")')).rejects.toThrow('Security Error');
    });

    it('allows valid language names in create', async () => {
      const { UniversalLanguageSkill } = await import('../../plugins/extensions/index');
      const ext = new UniversalLanguageSkill({ id: 'lang', name: 'Language', type: 'api-connection', capabilities: [] } as any);

      // Should not throw security error for valid names
      const res = await ext.onMessage('create Rust :: fn main() {}');
      expect(res).toBeDefined();
      expect((res as any).type).toBe('language-skill');
      expect((res as any).created).toBe('Rust');
    });
  });
});
