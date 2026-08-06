import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('ContactsPlugin security and permissions', () => {
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
          if (path.endsWith('contacts.json')) {
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

    const { ContactsPlugin } = await import('../../plugins/contacts');
    const plugin = new ContactsPlugin({
      id: 'contacts',
      name: 'Contacts',
      type: 'api-connection',
      capabilities: [],
    } as any);
    return plugin;
  }

  it('restricts directory permissions to 0o700 and file to 0o600 on activation', async () => {
    // Force process.platform to not be win32 to test chmod paths
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    try {
      const plugin = await loadPlugin(true);
      const fakeLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
      await plugin.onActivate({ logger: fakeLogger } as any);

      // Verify that directory was created or permissions checked
      const dirMkdir = mkdirCalls.find(c => c.path.endsWith('.neuroclaw/contacts') || c.path.includes('contacts'));
      expect(dirMkdir).toBeDefined();
      expect(dirMkdir.options).toEqual({ recursive: true, mode: 0o700 });

      // Verify chmodSync was called for directory with 0o700
      const dirChmod = chmodCalls.find(c => (c.path.endsWith('.neuroclaw/contacts') || c.path.includes('contacts')) && c.mode === 0o700);
      expect(dirChmod).toBeDefined();

      // Verify chmodSync was called for file with 0o600
      const fileChmod = chmodCalls.find(c => c.path.endsWith('contacts.json') && c.mode === 0o600);
      expect(fileChmod).toBeDefined();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('enforces secure mode 0o600 on writeFileSync during save()', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    try {
      const plugin = await loadPlugin(false);
      const fakeLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
      await plugin.onActivate({ logger: fakeLogger } as any);

      // Add a contact to trigger save()
      await plugin.add({ name: 'Bob', email: 'bob@example.com' });

      // Check writeFileSync options
      const lastWrite = writeCalls[writeCalls.length - 1];
      expect(lastWrite).toBeDefined();
      expect(lastWrite.options).toBeDefined();
      expect(lastWrite.options.mode).toBe(0o600);

      // Verify chmodSync was called on the file
      const fileChmod = chmodCalls.find(c => c.path.endsWith('contacts.json') && c.mode === 0o600);
      expect(fileChmod).toBeDefined();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});
