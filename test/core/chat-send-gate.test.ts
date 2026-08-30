/**
 * A staged file with nothing typed used to be unsendable: the Send button's
 * `disabled` prop and handleSendMessage's own guard both checked only
 * `input.trim()`, so an attached file with an empty text box could not be
 * submitted by any control on the page.
 *
 * canSend() is the one gate both call sites in src/routes/app/chat.tsx defer
 * to now -- two copies of "is there anything to send" is exactly how they
 * drifted apart the first time. Imported from src/lib/chat-send.ts, the same
 * module the page itself imports (via the `@/` alias vite resolves and this
 * plain vitest run does not configure -- see vitest.config.ts's own comment),
 * so this is the real function under test, not a second copy of it.
 */
import { describe, it, expect } from 'vitest';
import { canSend, formatArchiveMessage, formatArchiveCaption, type ArchiveOutcome } from '../../src/lib/chat-send';

describe('canSend()', () => {
  it('is false with nothing typed and nothing staged', () => {
    expect(canSend('', 0)).toBe(false);
    expect(canSend('   ', 0)).toBe(false);
  });

  it('is true with text typed, even with nothing staged', () => {
    expect(canSend('hello', 0)).toBe(true);
  });

  it('is true with a file staged, even with nothing typed', () => {
    // The exact bug: a staged file with an empty box.
    expect(canSend('', 1)).toBe(true);
    expect(canSend('   ', 3)).toBe(true);
  });

  it('is true with both', () => {
    expect(canSend('hello', 1)).toBe(true);
  });
});

describe('formatArchiveMessage() -- the full assistant bubble for an attached file', () => {
  it('reports a clean send honestly, including whether it stopped itself or hit the ceiling', () => {
    const stopped: ArchiveOutcome = { ok: true, bytesIn: 512, sendTicks: 4096, complete: true };
    expect(formatArchiveMessage('report.pdf', stopped)).toContain('stopped itself');
    expect(formatArchiveMessage('report.pdf', stopped)).toContain('512 bytes');

    const ceiling: ArchiveOutcome = { ok: true, bytesIn: 512, sendTicks: 4096, complete: false };
    const msg = formatArchiveMessage('report.pdf', ceiling);
    expect(msg).toContain('tick ceiling');
    // "stopped itself" must not appear in the ceiling case -- a send that
    // was cut off is not the same outcome as one the network chose to end.
    expect(msg).not.toContain('stopped itself');
  });

  it('reports a failure as a failure, not as a send', () => {
    const failed: ArchiveOutcome = { ok: false, error: 'network unreachable' };
    const msg = formatArchiveMessage('report.pdf', failed);
    expect(msg).toContain('Could not send');
    expect(msg).toContain('network unreachable');
    expect(msg).not.toMatch(/bytes zipped|stopped itself|tick ceiling/);
  });

  it('names the file', () => {
    expect(formatArchiveMessage('photo.png', { ok: true, bytesIn: 1, sendTicks: 1, complete: true })).toContain('photo.png');
  });
});

describe('formatArchiveCaption() -- the compact note under a typed message', () => {
  it('says a plain send happened, compactly', () => {
    const outcome: ArchiveOutcome = { ok: true, bytesIn: 64, sendTicks: 512, complete: true };
    const caption = formatArchiveCaption(outcome);
    expect(caption).toContain('64B');
    expect(caption).toContain('stopped itself');
  });

  it('says a ceiling was hit, compactly', () => {
    const outcome: ArchiveOutcome = { ok: true, bytesIn: 64, sendTicks: 512, complete: false };
    expect(formatArchiveCaption(outcome)).toContain('tick ceiling');
  });

  it('says a failure plainly rather than silently dropping it', () => {
    const outcome: ArchiveOutcome = { ok: false, error: 'timed out' };
    const caption = formatArchiveCaption(outcome);
    expect(caption).toContain('not sent');
    expect(caption).toContain('timed out');
  });
});
