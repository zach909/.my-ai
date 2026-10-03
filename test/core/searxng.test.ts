import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

async function fakeSearx(respond: (url: URL) => { status?: number; body?: unknown }) {
  const urls: URL[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    urls.push(url);
    const out = respond(url);
    res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body ?? {}));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, urls, close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }) };
}

/** A fresh module each time, because the "say why once" flag is module state. */
async function load() {
  vi.resetModules();
  return import('../../plugins/searxng.js');
}

afterEach(() => { delete process.env.NEUROCLAW_SEARXNG_URL; vi.restoreAllMocks(); });

describe('searxng search', () => {
  it('queries /search with format=json on the configured instance and maps the hits', async () => {
    const srv = await fakeSearx(() => ({ body: { results: [
      { title: 'One', url: 'https://example.org/1', content: 'first' },
      { title: 'Two', url: 'https://example.org/2' },
    ] } }));
    try {
      process.env.NEUROCLAW_SEARXNG_URL = srv.base;
      const { searxngSearch } = await load();
      const hits = await searxngSearch('open source search');
      expect(hits).toEqual([
        { title: 'One', url: 'https://example.org/1', snippet: 'first' },
        { title: 'Two', url: 'https://example.org/2', snippet: '' },
      ]);
      expect(srv.urls[0].pathname).toBe('/search');
      expect(srv.urls[0].searchParams.get('q')).toBe('open source search');
      expect(srv.urls[0].searchParams.get('format')).toBe('json');
    } finally { await srv.close(); }
  });

  it('caps results and drops entries without a title or an http(s) url', async () => {
    const srv = await fakeSearx(() => ({ body: { results: [
      { title: 'ok', url: 'https://a.example/' },
      { title: 'script', url: 'javascript:alert(1)' },
      { url: 'https://no-title.example/' },
      { title: 'file', url: 'file:///etc/passwd' },
      { title: 'ok2', url: 'http://b.example/' },
      { title: 'ok3', url: 'https://c.example/' },
    ] } }));
    try {
      process.env.NEUROCLAW_SEARXNG_URL = srv.base;
      const { searxngSearch } = await load();
      expect((await searxngSearch('q', 2)).map(h => h.title)).toEqual(['ok', 'ok2']);
    } finally { await srv.close(); }
  });

  it('returns nothing, and says once why, when the instance has the json format disabled (403)', async () => {
    const srv = await fakeSearx(() => ({ status: 403, body: {} }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      process.env.NEUROCLAW_SEARXNG_URL = srv.base;
      const { searxngSearch } = await load();
      expect(await searxngSearch('q')).toEqual([]);
      expect(await searxngSearch('q')).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('json format is probably disabled');
    } finally { await srv.close(); }
  });

  it('returns nothing, and names the address, when no instance is running', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NEUROCLAW_SEARXNG_URL = 'http://127.0.0.1:9';
    const { searxngSearch } = await load();
    expect(await searxngSearch('q')).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toContain('http://127.0.0.1:9');
  });

  it('defaults to an instance on this machine, and accepts an address without a scheme', async () => {
    const { searxngBaseUrl } = await load();
    expect(searxngBaseUrl()).toBe('http://127.0.0.1:8080');
    process.env.NEUROCLAW_SEARXNG_URL = 'search.lan:8888/';
    expect(searxngBaseUrl()).toBe('http://search.lan:8888');
  });

  it('is what ResearchPlugin.searchWeb() uses, with results shaped as web sources', async () => {
    const srv = await fakeSearx(() => ({ body: { results: [{ title: 'T', url: 'https://example.org/', content: 'S' }] } }));
    try {
      process.env.NEUROCLAW_SEARXNG_URL = srv.base;
      vi.resetModules();
      const { ResearchPlugin } = await import('../../plugins/research.js');
      const plugin = new ResearchPlugin({ id: 'research', name: 'Research', type: 'api-connection', capabilities: [] } as never);
      expect(await plugin.searchWeb('anything')).toEqual([{ source: 'web', title: 'T', snippet: 'S', location: 'https://example.org/' }]);
    } finally { await srv.close(); }
  });
});
