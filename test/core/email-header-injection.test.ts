/**
 * Regression test for plugins/email.ts's trySendmail() MIME header
 * injection: from/to/subject were interpolated directly into MIME header
 * lines joined by \r\n, so a subject containing an embedded \r\n broke out
 * of its own header line and injected arbitrary extra headers (e.g. a
 * forged Bcc: that sendmail honors) into the outgoing message. Distinct
 * from the already-fixed shell-command injection (execSync's `input`
 * option keeps the MIME content off the shell command line, but does
 * nothing to stop the content itself from containing forged headers).
 */

import { vi, beforeEach, afterEach } from 'vitest';

describe('EmailPlugin.send() does not allow MIME header injection', () => {
  let capturedInput = '';

  beforeEach(() => {
    vi.resetModules();
    capturedInput = '';
    vi.doMock('node:child_process', () => ({
      execSync: (command: string, options?: { input?: string }) => {
        if (command.startsWith('which ')) return '/usr/sbin/sendmail\n';
        capturedInput = options?.input ?? '';
        return '';
      },
    }));
  });
  afterEach(() => {
    vi.doUnmock('node:child_process');
  });

  it('strips CR/LF from subject so it cannot inject a forged Bcc: header', async () => {
    const { EmailPlugin } = await import('../../plugins/email');
    const plugin = new EmailPlugin({ id: 'email', name: 'Email', type: 'api-connection', capabilities: [] } as any);

    await plugin.send(
      'me@example.com',
      ['victim@example.com'],
      'Hello\r\nBcc: attacker@evil.com\r\nX-Injected: true',
      'hi',
    );

    expect(capturedInput).not.toContain('\r\nBcc:');
    expect(capturedInput).not.toContain('\r\nX-Injected:');
    // The message body itself is still delivered intact.
    expect(capturedInput).toContain('hi');
  });

  it('strips CR/LF from from/to as well', async () => {
    const { EmailPlugin } = await import('../../plugins/email');
    const plugin = new EmailPlugin({ id: 'email', name: 'Email', type: 'api-connection', capabilities: [] } as any);

    await plugin.send(
      'me@example.com\r\nBcc: attacker@evil.com',
      ['victim@example.com\r\nBcc: attacker2@evil.com'],
      'normal subject',
      'hi',
    );

    expect(capturedInput).not.toContain('\r\nBcc:');
  });
});
