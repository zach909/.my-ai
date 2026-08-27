/**
 * Everything that can produce a file -- the attach button, the recorder, and
 * pasting -- goes through one upload path. They were about to be three copies
 * of the same fetch with three slightly different error strings, which is how
 * two of them quietly stop matching the third.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { stageFile, StageError, generatedName, MAX_STAGED_BYTES } from '../../src/lib/stage-file.js';

const okResponse = (body: unknown) => ({
  ok: true,
  json: async () => body,
}) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('staging bytes for the archive', () => {
  it('sends the bytes as the body, not wrapped in a form', async () => {
    // The whole point: a file goes in AS a file. Form encoding would mean the
    // network receives a description of an upload rather than the upload.
    const fetchMock = vi.fn(async () =>
      okResponse({ path: 'prompt/note.txt', bytes: 5, binary: { 'prompt/note.txt': 'aGVsbG8=' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const staged = await stageFile(new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
    expect(staged.path).toBe('prompt/note.txt');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/zip-loop/file?path=${encodeURIComponent('prompt/note.txt')}`);
    expect(init.body).toBeInstanceOf(Blob);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
  });

  it('puts the file where the caller asked', async () => {
    const fetchMock = vi.fn(async () => okResponse({ path: 'memory/x', bytes: 1, binary: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await stageFile(new Blob(['x']), 'x', 'memory/');
    expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent('memory/x'));
  });

  it('refuses something too large before it reaches the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const huge = { size: MAX_STAGED_BYTES + 1, type: 'application/octet-stream' } as Blob;
    await expect(stageFile(huge, 'huge.bin')).rejects.toBeInstanceOf(StageError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an empty file rather than staging nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(stageFile(new Blob([]), 'empty.txt')).rejects.toBeInstanceOf(StageError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says what went wrong when the server refuses it', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 413,
      json: async () => ({ error: 'That file is too large to send through the doorway in one go.' }),
    }) as unknown as Response);
    await expect(stageFile(new Blob(['x']), 'x')).rejects.toThrow(/too large to send through the doorway/);
  });

  it('says the network is unreachable rather than inventing a reason', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('failed to fetch'); });
    await expect(stageFile(new Blob(['x']), 'x')).rejects.toThrow(/Could not reach the local network/);
  });

  it('names two generated files differently so one cannot replace the other', async () => {
    const first = generatedName('pasted', 'txt');
    await new Promise(r => setTimeout(r, 2));
    expect(generatedName('pasted', 'txt')).not.toBe(first);
    expect(first).toMatch(/^pasted-\d+\.txt$/);
  });
});
