import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('EmailPlugin security and permissions', () => {
  const mkdirCalls: any[] = [];
  const chmodCalls: any[] = [];
  const writeCalls: any[] = [];

  beforeEach(() => {
    vi.resetModules();
    mkdirCalls.length = 0;
    chmodCalls.length = 0;
    writeCalls.length = 0;
  });

  afterEach(() => {
    vi.doUnmock('node:fs');
  });

  async function loadPlugin(existingFileExists: boolean) {
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        existsSync: (path: string) => {
          if (path.endsWith('emails.json')) {
            return existingFileExists;
          }
          return false;
        },
        readFileSync: () => '[]',
        mkdirSync: (path: string, options?: any) => {
          mkdirCalls.push({ path, options });
        },
        chmodSync: (path: string, mode: number) => {
          chmodCalls.push({ path, mode });
        },
        writeFileSync: (path: string, data: string, options?: any) => {
          writeCalls.push({ path, data, options });
        },
      };
    });

    const { EmailPlugin } = await import('../../plugins/email');
    const plugin = new EmailPlugin({
      id: 'email',
      name: 'Email',
      type: 'api-connection',
      capabilities: [],
    } as any);
    return plugin;
  }

  it('restricts directory permissions to 0o700 and file to 0o600 on activation', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    try {
      const plugin = await loadPlugin(true);
      const fakeLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
      await plugin.onActivate({ logger: fakeLogger } as any);

      // Verify that directory was created or permissions checked
      const dirMkdir = mkdirCalls.find(c => c.path.endsWith('.neuroclaw/email') || c.path.includes('email'));
      expect(dirMkdir).toBeDefined();
      expect(dirMkdir.options).toEqual({ recursive: true, mode: 0o700 });

      // Verify chmodSync was called for directory with 0o700
      const dirChmod = chmodCalls.find(c => (c.path.endsWith('.neuroclaw/email') || c.path.includes('email')) && c.mode === 0o700);
      expect(dirChmod).toBeDefined();

      // Verify chmodSync was called for file with 0o600
      const fileChmod = chmodCalls.find(c => c.path.endsWith('emails.json') && c.mode === 0o600);
      expect(fileChmod).toBeDefined();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('enforces secure mode 0o600 on writeFileSync during saveToDisk()', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    try {
      const plugin = await loadPlugin(false);
      const fakeLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
      await plugin.onActivate({ logger: fakeLogger } as any);

      // Trigger a saveToDisk() by calling send()
      await plugin.send('sender@example.com', ['receiver@example.com'], 'Test Subject', 'Body text');
      // Trigger a save via send()
      // Note: we also mock node:child_process to let trySendmail execute safely
      vi.doMock('node:child_process', () => ({
        execSync: (command: string, options?: any) => {
          if (command.startsWith('which ')) return '';
          return '';
        },
      }));

      await plugin.send('me@example.com', ['you@example.com'], 'subject', 'body');

      // Check writeFileSync options
      const lastWrite = writeCalls[writeCalls.length - 1];
      expect(lastWrite).toBeDefined();
      expect(lastWrite.options).toBeDefined();
      expect(lastWrite.options.mode).toBe(0o600);

      // Verify chmodSync was called on the file
      const fileChmod = chmodCalls.find(c => c.path.endsWith('emails.json') && c.mode === 0o600);
      expect(fileChmod).toBeDefined();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});
