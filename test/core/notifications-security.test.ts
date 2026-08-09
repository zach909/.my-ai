import { describe, it, expect } from 'vitest';
import { NotificationsPlugin } from '../../plugins/notifications';

describe('NotificationsPlugin Security Validation', () => {
  const plugin = new NotificationsPlugin({
    id: 'notifications',
    name: 'Notifications',
    type: 'api-connection',
    capabilities: [],
  } as any);

  it('allows title and body starting with a hyphen', async () => {
    // These should now succeed because they are safely handled using '--' argument separator
    const id1 = await plugin.show('-some-flag', 'valid body');
    expect(id1).toBeDefined();

    const id2 = await plugin.schedule('-some-flag', 'valid body', 10);
    expect(id2).toBeDefined();

    const id3 = await plugin.show('valid title', '--help');
    expect(id3).toBeDefined();
  });

  it('rejects non-string inputs', async () => {
    await expect(plugin.show(123 as any, 'valid body')).rejects.toThrowError('Security Error: Input must be a string.');
    await expect(plugin.show('valid title', null as any)).rejects.toThrowError('Security Error: Input must be a string.');
  });
});
